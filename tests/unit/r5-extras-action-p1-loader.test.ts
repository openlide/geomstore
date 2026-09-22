/**
 * 第五轮 extras-action-p1 分片回归（loader / utils / executor）
 *
 * 每条用例断言的是**修复后**的语义，修复前这些断言全部会失败。
 * 编号对应 `.ocr-fix/groups5/extras-action-p1.md`。
 */

import { ActionLoader, type ActionErrorData } from '@/extras/action/ActionLoader.js'
import { ActionUtils } from '@/extras/action/ActionUtils.js'
import { ActionExecutor } from '@/extras/action/AsyncActionSupport.js'
import { raceWithTimeout, TIMEOUT_ERROR_CODE, createTimeoutError, type TimeoutError } from '@/extras/action/async-core.js'
// R5-128：`withLog` 的选项类型与 getStats 的返回类型都必须能从公开子入口取到，
// 否则调用方只能深链子文件（该入口自己的 JSDoc 就写着不要深链）。这两行本身就是断言：
// 少了任何一个导出，`tsc -p tsconfig.tests.json` 就会在这里报错
// R5-185 连带：LogDecoratorOptions 的 sink/redact 引用了 LogSink/LogPhase，
// 只转发 LogDecoratorOptions 一个名字的话调用方仍要深链才能给自定义 sink 标类型
import type { LogDecoratorOptions, LogSink, LogPhase, ActionStats } from '@/extras/action.js'

it('R5-128 extras/action 入口再导出 LogDecoratorOptions 与 ActionStats', () => {
  const logOptions: LogDecoratorOptions = { sink: undefined, redact: (value) => value }
  const stats: ActionStats = new ActionExecutor().getStats('never-called')

  // `sink: undefined` 仍是自有可枚举键，Object.keys 把它算进去
  expect(Object.keys(logOptions).sort()).toEqual(['redact', 'sink'])
  expect(stats).toEqual({ total: 0, success: 0, failure: 0, avgDuration: 0, successRate: 0 })
})

it('R5-128 / R5-185 extras/action 入口同步转发 LogSink 与 LogPhase', () => {
  // 编译期断言：这两个类型名必须能从公开入口取到，且能直接给 withLog 的选项标注
  const sink: LogSink = { log: () => undefined, error: () => undefined }
  const redact = (value: unknown, _phase: LogPhase): unknown => value
  const options: LogDecoratorOptions = { sink, redact }

  expect(options.sink).toBe(sink)
})

/** 收集 (key, value) 形态的状态写入 */
function recordWrites(): { writes: Array<[string, unknown]>; setState: (key: string, value: unknown) => void } {
  const writes: Array<[string, unknown]> = []

  return {
    writes,
    setState: (key: string, value: unknown): void => {
      writes.push([key, value])
    },
  }
}

/** 一个手动结算的 gate */
function createGate<T>(value: T): { promise: Promise<T>; release: () => void } {
  let release: () => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    release = () => resolve(value)
  })

  return { promise, release }
}

afterEach(() => {
  jest.restoreAllMocks()
  jest.useRealTimers()
})

describe('R5-160 decrement 必须绑定到自己那次 increment', () => {
  it('clear() 之后新起的调用不会被旧调用的收尾吞掉计数', async () => {
    const loader = new ActionLoader()
    const { writes, setState } = recordWrites()
    const first = createGate('c1')
    const second = createGate('c2')

    const running1 = loader.wrap(async () => await first.promise, 'a', setState)()
    expect(loader.isLoading('a')).toBe(true)

    loader.clear()
    expect(loader.getAllLoading()).toEqual({})

    const running2 = loader.wrap(async () => await second.promise, 'a', setState)()
    expect(loader.isLoading('a')).toBe(true)

    writes.length = 0
    first.release()
    // 修复前：旧调用读到新调用的计数 1 → 写 0 → loading 在 C2 仍飞行时翻成 false
    await running1
    expect(loader.isLoading('a')).toBe(true)
    expect(writes).toEqual([])

    second.release()
    await running2
    expect(loader.isLoading('a')).toBe(false)
  })

  it('外部清空注入的共享计数后，收尾的调用不补写 false、也不留下 0 记账', async () => {
    const shared = new Map<string, number>()
    const loader = new ActionLoader({ sharedLoadingCounts: shared })
    const { writes, setState } = recordWrites()
    const gate = createGate('done')

    const running = loader.wrap(async () => await gate.promise, 'a', setState)()
    shared.clear()
    gate.release()
    await running

    expect(loader.isLoading('a')).toBe(false)
    expect(writes).toEqual([
      ['loading', true],
      ['error', null],
      ['errorData', null],
    ])
  })

  it('increment 时 setState 抛错只回滚计数，不把键写成 0', async () => {
    const loader = new ActionLoader()
    const setState = jest.fn((): never => {
      throw new Error('store destroyed')
    })

    await expect(loader.wrap(async () => 'never-reached', 'a', setState)()).rejects.toThrow('store destroyed')
    // 修复前：回滚走的是「按名重算键 + `?? 1` 兜底」的 decrement，会把 0 记账塞回表里
    expect(loader.getAllLoading()).toEqual({})
    expect(loader.isLoading('a')).toBe(false)
  })

  it('回滚时别人仍在同一键上计数：只退自己那一份，不清空键', async () => {
    const shared = new Map<string, number>()
    const loaderA = new ActionLoader({ sharedLoadingCounts: shared })
    const loaderB = new ActionLoader({ sharedLoadingCounts: shared })
    const gateB = createGate('b')
    let kickedOff = false
    const setStateA = (key: string): void => {
      // 真实形态之一是「写状态顺手触发了另一个被托管的调用」：回滚时计数已是 2
      if (!kickedOff) {
        kickedOff = true
        void loaderB.wrap(
          async () => await gateB.promise,
          'a',
          () => undefined,
        )()
      }
      expect(shared.get(key)).toBe(2)
      throw new Error('store destroyed')
    }

    await expect(loaderA.wrap(async () => 'x', 'a', setStateA)()).rejects.toThrow('store destroyed')
    expect(shared.get('loading')).toBe(1)
    gateB.release()
  })

  it('回滚时记账已被清掉：不凭空补一个键', async () => {
    const loader = new ActionLoader()
    let cleared = false
    const setState = (): void => {
      if (!cleared) {
        cleared = true
        loader.clear()
      }
      throw new Error('store destroyed')
    }

    await expect(loader.wrap(async () => 'x', 'a', setState)()).rejects.toThrow('store destroyed')
    expect(loader.getAllLoading()).toEqual({})
  })
})

describe('R5-161 increment/decrement 用同一份配置快照', () => {
  it('在途时 autoLoading 由 false 切到 true：收尾不得减别人的计数', async () => {
    const shared = new Map<string, number>()
    const loaderA = new ActionLoader({ autoLoading: false, sharedLoadingCounts: shared })
    const loaderB = new ActionLoader({ sharedLoadingCounts: shared })
    const { writes, setState } = recordWrites()
    const gateA = createGate('a')
    const gateB = createGate('b')

    const runningA = loaderA.wrap(async () => await gateA.promise, 'x', setState)()
    // A 从不计数；中途把它打开后，A 的收尾若重读开关就会多减一次
    loaderA.setOptions({ autoLoading: true })

    const runningB = loaderB.wrap(async () => await gateB.promise, 'x', setState)()
    expect(shared.get('loading')).toBe(1)

    gateA.release()
    await runningA
    expect(shared.get('loading')).toBe(1)
    // 修复前：A 的收尾按切换后的开关重算，把 B 的计数减到 0 并写下 loading=false
    expect(writes.filter(([key]) => key === 'loading')).toEqual([['loading', true]])

    gateB.release()
    await runningB
    expect(shared.get('loading')).toBe(0)
  })

  it('在途时改 loadingKey：收尾不碰新键，新键由切换之后的调用独占', async () => {
    const loader = new ActionLoader()
    const { writes, setState } = recordWrites()
    const gate = createGate('v')

    const running = loader.wrap(async () => await gate.promise, 'a', setState)()
    loader.setOptions({ loadingKey: 'isLoading' })
    writes.length = 0

    gate.release()
    await running
    // 代际变了 → 这次调用的收尾整体跳过（含错误键）：新键只属于切换之后的调用
    expect(writes).toEqual([])
    expect(loader.getAllLoading()).toEqual({})
    expect(loader.getAllErrors()).toEqual({})
  })
})

describe('R5-162 wrap 转发调用方 receiver', () => {
  it('包装未绑定的方法引用时，action 内的 this 仍是调用方', async () => {
    const loader = new ActionLoader()

    class Api {
      prefix = 'p'

      async fetch(id: string): Promise<string> {
        return `${this.prefix}:${id}`
      }
    }
    const api = new Api()

    const wrapped = loader.wrap(api.fetch, 'fetch', () => undefined)

    await expect(wrapped.call(api, 'x')).resolves.toBe('p:x')
    // 修复前：`action(...args)` 以 undefined 为 receiver 调用，这里直接 TypeError
    await expect(wrapped.call(api, 'x')).resolves.toBe('p:x')
  })
})

describe('R5-163 getErrorData 有类型', () => {
  it('返回 ActionErrorData，示例里的 timestamp/stack 直接可读', async () => {
    const loader = new ActionLoader()
    const { setState } = recordWrites()

    await expect(
      loader.wrap(
        async (): Promise<never> => {
          throw new Error('boom')
        },
        'a',
        setState,
      ),
    ).rejects.toThrow('boom')

    const data: ActionErrorData | undefined = loader.getErrorData('a')
    expect(data?.message).toBe('boom')
    expect(typeof data?.timestamp).toBe('number')
    // 无错误时仍是 undefined（setError(null) 走 delete 分支）
    expect(new ActionLoader().getErrorData('a')).toBeUndefined()
  })
})

describe('R5-145 / R5-146 ActionUtils.execute 的入参判定', () => {
  type NumericKeyActions = { 0: () => Promise<string> }
  type NamedActions = { fetch: (id: string) => Promise<string> }

  /** 以 JS 调用方的形态打坏入参：重载签名挡不住他们，运行时判定必须自己兜住 */
  function looseExecute(utils: ActionUtils<NamedActions>, ...params: unknown[]): Promise<unknown> {
    return (utils.execute as unknown as (...callArgs: unknown[]) => Promise<unknown>)(...params)
  }

  it('R5-145 数字键的 action 按「省略 actions」形态正确派发', async () => {
    const zero = jest.fn(async (): Promise<string> => 'zero')
    const utils = new ActionUtils<NumericKeyActions>({ 0: zero })

    await expect(utils.execute(0)).resolves.toBe('zero')
    expect(zero).toHaveBeenCalledTimes(1)
  })

  it('R5-145 缺少 actionName 时抛 TypeError，而不是深入执行器才炸', async () => {
    const executor = new ActionExecutor()
    const utils = new ActionUtils<NamedActions>({ fetch: async (id: string) => id }, { executor })

    await expect(looseExecute(utils, undefined)).rejects.toThrow(/缺少 actionName/)
    await expect(looseExecute(utils)).rejects.toThrow(/缺少 actionName/)
    // 修复前：这次「不是 action 执行的失败」会被记进 executor 历史
    expect(executor.getHistory()).toHaveLength(0)
  })

  it('R5-146 actionName 不存在时给出可定位的错误且不写历史', async () => {
    const executor = new ActionExecutor()
    const utils = new ActionUtils<NamedActions>({ fetch: async (id: string) => id }, { executor })

    await expect(looseExecute(utils, 'nope')).rejects.toThrow('action "nope" 不存在或不是函数')
    await expect(looseExecute(utils, {}, 'nope')).rejects.toThrow('不存在或不是函数')
    expect(executor.getHistory()).toHaveLength(0)
  })

  it('R5-146 构造期传进非对象 actions 时同样早失败', async () => {
    const utils = new ActionUtils<NamedActions>(null as unknown as NamedActions)

    await expect(looseExecute(utils, 'fetch', 'x')).rejects.toThrow('action "fetch" 不存在或不是函数')
  })

  it('R5-145 显式 actions 形态与正常派发不受校验影响', async () => {
    const actions: NamedActions = { fetch: async (id: string) => `u-${id}` }
    const utils = new ActionUtils(actions)

    await expect(utils.execute(actions, 'fetch', '1')).resolves.toBe('u-1')
    await expect(utils.execute('fetch', '2')).resolves.toBe('u-2')
  })
})

describe('R5-151 executeWithTimeout 先校验 timeout', () => {
  for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    it(`非法 timeout（${String(bad)}）不启动 action、不记失败历史，仍抛 RangeError`, async () => {
      const executor = new ActionExecutor()
      let started = false
      const actions = {
        work: async (): Promise<string> => {
          started = true

          return 'done'
        },
      }

      await expect(executor.executeWithTimeout(actions, 'work', [], bad)).rejects.toBeInstanceOf(RangeError)
      expect(started).toBe(false)
      expect(executor.getStats('work')).toMatchObject({ total: 0, success: 0, failure: 0 })
      expect(executor.getHistory()).toHaveLength(0)
    })
  }

  it('合法 timeout 的计时与记账语义不变', async () => {
    const executor = new ActionExecutor()
    const actions = {
      slow: async (): Promise<string> =>
        await new Promise<string>((resolve) => {
          setTimeout(() => resolve('late'), 50)
        }),
    }

    await expect(executor.executeWithTimeout(actions, 'slow', [], 5)).rejects.toThrow('Action timeout after 5ms')
    expect(executor.getStats('slow').total).toBe(1)
  })
})

describe('R5-175（p2 NEEDS-MAIN，落于本分片）超时错误按 code 统一识别', () => {
  it('createTimeoutError 产出带 code 的 Error', () => {
    const error: TimeoutError = createTimeoutError('Timeout after 5ms')

    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe('Timeout after 5ms')
    expect(error.code).toBe(TIMEOUT_ERROR_CODE)
  })

  it('raceWithTimeout 与 executeWithTimeout 共用同一构造点（文案仍各自拼，识别按 code）', async () => {
    await expect(raceWithTimeout(new Promise<string>(() => undefined), 1, 'Timeout after 1ms')).rejects.toMatchObject({
      message: 'Timeout after 1ms',
      code: TIMEOUT_ERROR_CODE,
    })

    const executor = new ActionExecutor()
    const actions = { hang: async (): Promise<string> => await new Promise<string>(() => undefined) }
    await expect(executor.executeWithTimeout(actions, 'hang', [], 1)).rejects.toMatchObject({
      message: 'Action timeout after 1ms',
      code: TIMEOUT_ERROR_CODE,
    })
  })
})
