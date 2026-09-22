/**
 * 第五轮 extras-error 分片回归（R5-197 / R5-202 / R5-203 / R5-204 / R5-205）
 *
 * 覆盖的公开行为：
 * - 重试额度不因容量淘汰而被误清（周期窗按各键自身到期时刻判定，刷新窗口的键不会被当成最旧键）
 * - ErrorRecovery 策略内部失败统一抛 GeomStoreError（可按 error.code 分支、保留 cause）
 * - 策略表按字符串键查不到 `Object.prototype` 成员
 * - 未归因重试键在诊断里可识别
 * - 聚合器「同一指纹 ⇒ 同一组 ID」在邻居组被驱逐后仍成立
 */

import { ErrorRecovery, RecoveryStrategy, ErrorCode, isGeomStoreError, ErrorAggregator } from '@/extras/error/index.js'
import { GeomStoreError } from '@/core/errors/GeomStoreError.js'
import { MAX_RETRY_KEYS } from '@/extras/error/recoveryTypes.js'

/** 取私有字段（容量守卫与重试计数的观测点只有内部表） */
function internals(recovery: ErrorRecovery): { retryCycleEnd: Map<string, number>; retryCount: Map<string, number> } {
  return recovery as unknown as { retryCycleEnd: Map<string, number>; retryCount: Map<string, number> }
}

/** 跳过真实退避等待，避免用例被 cycleWindow 级别的延迟拖慢 */
function withoutBackoff(recovery: ErrorRecovery): void {
  const target = recovery as unknown as { delay: () => Promise<void> }
  target.delay = async () => {}
}

describe('R5-202 重试窗口容量淘汰', () => {
  it('自身周期窗更长的活跃键不因硬编码阈值被误删，额度继续累计', async () => {
    let now = 1_000_000
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now)
    const attempts: number[] = []
    const recovery = new ErrorRecovery()
    withoutBackoff(recovery)
    // retryDelay 100s × maxRetries 3 且非指数退避 → cycleWindow = 600s，远大于旧的硬编码 60s 阈值
    recovery.configure({
      LONG_WINDOW: {
        strategy: RecoveryStrategy.RETRY,
        maxRetries: 3,
        retryDelay: 100_000,
        exponentialBackoff: false,
        onRetry: (_error, attempt) => attempts.push(attempt),
      },
    })
    const internal = internals(recovery)

    try {
      const mk = () => new GeomStoreError('boom', 'LONG_WINDOW', { storeName: 's', operation: 'op' })
      // 先塞 999 个仍在自身窗口内的键，让观测键落在队尾（否则「最旧插入优先淘汰」会
      // 合法地把它当最旧键删掉，与本题无关）
      const seed = (count: number, from = 0) => {
        for (let i = from; i < from + count; i++) {
          internal.retryCycleEnd.set(`other-${i}`, now + 600_000)
          internal.retryCount.set(`other-${i}`, 1)
        }
      }
      seed(MAX_RETRY_KEYS - 1)
      await expect(recovery.recover(mk())).rejects.toThrow('boom')
      expect(attempts).toEqual([1])
      // 再塞 2 个，令表在下次 recover 时处于超限状态
      seed(2, MAX_RETRY_KEYS - 1)

      // 90s 后：活跃键静默 90s，仍远在自身 600s 窗口内
      now += 90_000
      await expect(recovery.recover(mk())).rejects.toThrow('boom')

      // 修复前：过期扫描用 `now - 60_000` 做阈值，该键的周期起点(t=0) 已被判过期、
      // 连计数一起删掉，于是这次调用从 0 重新起算（onRetry 再报 attempt 1）——风控被削弱
      expect(attempts).toEqual([1, 2])
      expect(internal.retryCount.get('LONG_WINDOW:s:op')).toBe(2)
      // 被淘汰的是队首的键，而非仍在窗口内的活跃键
      expect(internal.retryCycleEnd.has('other-0')).toBe(false)
      expect(internal.retryCycleEnd.has('LONG_WINDOW:s:op')).toBe(true)
      expect(internal.retryCycleEnd.size).toBeLessThanOrEqual(MAX_RETRY_KEYS)
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('开启新周期的键会被重新插到队尾，不被「最旧插入」淘汰', async () => {
    let now = 2_000_000
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now)
    const recovery = new ErrorRecovery()
    withoutBackoff(recovery)
    recovery.configure({ CAP_CODE: { strategy: RecoveryStrategy.RETRY, maxRetries: 5, retryDelay: 0, exponentialBackoff: false } })
    const internal = internals(recovery)
    const key = 'CAP_CODE:s:op'

    try {
      // 让观测键先占住 Map 队首（旧实现刷新窗口只 set，位置留在队首）
      await expect(recovery.recover(new GeomStoreError('boom', 'CAP_CODE'), { storeName: 's', operation: 'op' })).rejects.toThrow('boom')
      for (let i = 0; i < MAX_RETRY_KEYS; i++) {
        internal.retryCycleEnd.set(`other-${i}`, now + 600_000)
        internal.retryCount.set(`other-${i}`, 1)
      }

      // 越过该键自身的 60s 窗口 → 开启新周期；此时表内没有任何「已到期」的键，
      // 超限只能按插入顺序淘汰队首——刚重开周期的活跃键不该是队首
      now += 61_000
      await expect(recovery.recover(new GeomStoreError('boom', 'CAP_CODE'), { storeName: 's', operation: 'op' })).rejects.toThrow('boom')

      const order = [...internal.retryCycleEnd.keys()]
      expect(order[order.length - 1]).toBe(key)
      expect(internal.retryCycleEnd.has(key)).toBe(true)
      expect(internal.retryCycleEnd.has('other-0')).toBe(false)
      expect(internal.retryCycleEnd.size).toBeLessThanOrEqual(MAX_RETRY_KEYS)
      // 新周期从 0 起算，计数与周期窗同时存在
      expect(internal.retryCount.get(key)).toBe(1)
    } finally {
      nowSpy.mockRestore()
    }
  })
})

describe('R5-203 策略内部失败统一抛 GeomStoreError', () => {
  it.each([
    ['未知策略', () => ({ strategy: 'nope' as RecoveryStrategy }), 'Unknown recovery strategy'],
    ['无回退值', () => ({ strategy: RecoveryStrategy.FALLBACK }), 'No fallback value or function configured'],
    ['无 recoverFn', () => ({ strategy: RecoveryStrategy.RECOVER }), 'No recover function configured'],
  ])('%s：抛出物带 code 与 cause，调用方可按 code 分支', async (_label, config, expectedMessage) => {
    const recovery = new ErrorRecovery()
    recovery.configure({ CODE_META: config() })
    const error = new GeomStoreError('原始失败', 'CODE_META')

    const caught = (await recovery.recover(error).catch((reason: unknown) => reason)) as GeomStoreError & { cause?: unknown }
    expect(caught.message).toContain(expectedMessage)
    expect(isGeomStoreError(caught)).toBe(true)
    expect(caught.code).toBe(ErrorCode.INTERNAL_ERROR)
    // cause 保留原始抛出值：换成 GeomStoreError 不得丢失现场
    expect(caught.cause).toBe(error)
  })

  it('达到重试上限：抛 GeomStoreError 并带 retryKey/attempts 与 cause', async () => {
    const recovery = new ErrorRecovery()
    withoutBackoff(recovery)
    recovery.configure({ CODE_MAX: { strategy: RecoveryStrategy.RETRY, maxRetries: 1, retryDelay: 0, exponentialBackoff: false } })
    const error = new GeomStoreError('超时', 'CODE_MAX', { storeName: 's', operation: 'op' })
    await expect(recovery.recover(error)).rejects.toThrow('超时')

    const caught = (await recovery.recover(error).catch((reason: unknown) => reason)) as GeomStoreError & { cause?: unknown }
    expect(isGeomStoreError(caught)).toBe(true)
    expect(caught.code).toBe(ErrorCode.INTERNAL_ERROR)
    expect(caught.message).toContain('Max retries (1) exceeded')
    expect(caught.context).toMatchObject({ retryKey: 'CODE_MAX:s:op', attempts: 1 })
    expect(caught.cause).toBe(error)
  })
})

describe('R5-204 策略表不落在原型链上', () => {
  it('原型成员名不作为配置返回', () => {
    const recovery = new ErrorRecovery()

    expect(recovery.getConfig('constructor')).toBeUndefined()
    expect(recovery.getConfig('toString')).toBeUndefined()
    expect(recovery.getConfig('__proto__')).toBeUndefined()
  })

  it('以原型成员名为错误码 recover 时，报「未配置策略」而非误导性的 Unknown recovery strategy', async () => {
    const recovery = new ErrorRecovery()
    const error = new GeomStoreError('boom', 'constructor')

    const caught = (await recovery.recover(error).catch((reason: unknown) => reason)) as GeomStoreError
    expect(caught.message).toContain('No recovery strategy configured for error code: constructor')
  })

  it('configure 写入 __proto__ 键不改动原型', () => {
    const recovery = new ErrorRecovery()
    const strategies = JSON.parse('{"__proto__":{"strategy":"ignore"}}') as Record<string, { strategy: RecoveryStrategy }>

    expect(() => recovery.configure(strategies)).not.toThrow()
    expect(Object.getPrototypeOf(recovery) === ErrorRecovery.prototype).toBe(true)
    expect(({} as Record<string, unknown>).strategy).toBeUndefined()
    expect(recovery.getConfig('__proto__')?.strategy).toBe(RecoveryStrategy.IGNORE)
  })
})

describe('R5-205 未归因重试键可识别', () => {
  it('storeName 与 operation 都缺失时键为 <code>:unattributed 并回传在诊断里', async () => {
    const recovery = new ErrorRecovery()
    withoutBackoff(recovery)
    recovery.configure({ CODE_NA: { strategy: RecoveryStrategy.RETRY, maxRetries: 1, retryDelay: 0, exponentialBackoff: false } })

    await expect(recovery.recover(new GeomStoreError('boom', 'CODE_NA'))).rejects.toThrow('boom')
    const caught = (await recovery.recover(new GeomStoreError('boom', 'CODE_NA')).catch((reason: unknown) => reason)) as GeomStoreError
    expect(caught.context?.retryKey).toBe('CODE_NA:unattributed')
  })

  it('只缺一个维度时仍按已报出的维度隔离', async () => {
    const recovery = new ErrorRecovery()
    withoutBackoff(recovery)
    recovery.configure({ CODE_PART: { strategy: RecoveryStrategy.RETRY, maxRetries: 1, retryDelay: 0, exponentialBackoff: false } })

    await expect(recovery.recover(new GeomStoreError('boom', 'CODE_PART'), { storeName: 'only-store' })).rejects.toThrow('boom')
    const caught = (await recovery
      .recover(new GeomStoreError('boom', 'CODE_PART'), { storeName: 'only-store' })
      .catch((reason: unknown) => reason)) as GeomStoreError
    expect(caught.context?.retryKey).toBe('CODE_PART:only-store:unknown')
  })
})

describe('R5-197 同一指纹在同一组存活期间不分裂', () => {
  // 'Error:aaa:' 与 'Error:abB:' 在该哈希下碰撞（base 同为 'bksp05'）——
  // 用真实碰撞而不是桩化哈希，才能验证探测链与索引在驱逐后仍一致
  const COLLIDE_A = 'aaa'
  const COLLIDE_B = 'abB'

  const ctx = (message: string, storeName: string, timestamp: number) => {
    // 指纹取 `name:message:堆栈前缀`，这里把堆栈清空，让两条指纹正好是
    // 上面那对碰撞串（'Error:aaa:' / 'Error:abB:'）
    const error = new Error(message)
    error.stack = ''
    return { storeName, operation: 'dispatch' as const, error, level: 'error' as const, timestamp }
  }

  it('邻居组被驱逐后，原指纹仍解析到它自己的组（计数不重置）', () => {
    const aggregator = new ErrorAggregator(2)
    const base = aggregator.addError(ctx(COLLIDE_A, 's1', 1000))
    const probed = aggregator.addError(ctx(COLLIDE_B, 's2', 2000))
    // 两条指纹同哈希 → 第二条必须落到探测键，否则碰撞就被静默折叠了
    expect(base?.groupId).not.toBe(probed?.groupId)
    expect(probed?.groupId).toBe(`${base?.groupId}~2`)

    // 第三个组挤掉最久未出现的 COLLIDE_A（lastSeen 1000）
    aggregator.addError(ctx('other', 's3', 3000))
    expect(aggregator.getStats().totalGroups).toBe(2)

    // COLLIDE_B 的组仍存活：再次出现必须并入原组，而不是在已腾空的 base 上另起一灶
    aggregator.addError(ctx(COLLIDE_B, 's4', 4000))

    const groups = aggregator.getGroups()
    expect(groups).toHaveLength(2)
    const merged = groups.find((group) => group.message === COLLIDE_B)
    expect(merged?.groupId).toBe(probed?.groupId)
    expect(merged?.count).toBe(2)
    expect(merged?.affectedStores).toEqual(['s2', 's4'])
    // 账目自洽：byStore 合计恒等于 totalErrors
    const stats = aggregator.getStats()
    expect(Object.values(stats.byStore).reduce((sum, n) => sum + n, 0)).toBe(stats.totalErrors)
  })

  it('自身组被驱逐后再次出现才算新组（副本语义下调用方改不动内部账目）', () => {
    const aggregator = new ErrorAggregator(1)
    const created = aggregator.addError(ctx(COLLIDE_A, 's1', 1000))
    expect(created).toBeDefined()
    created!.count = 999
    created!.affectedStores.push('tampered')
    created!.sampleError.level = 'critical'

    expect(aggregator.getStats().totalErrors).toBe(1)
    expect(aggregator.getGroups()[0].affectedStores).toEqual(['s1'])
    expect(aggregator.getGroups()[0].sampleError.level).toBe('error')

    // 驱逐唯一一组后重建：ID 可以变，但绝不能与仍存活的组并存
    const second = aggregator.addError(ctx(COLLIDE_B, 's2', 2000))
    expect(aggregator.getStats().totalGroups).toBe(1)
    expect(aggregator.getGroups().map((group) => group.groupId)).toEqual([second?.groupId])
  })
})
