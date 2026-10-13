/**
 * 第八轮 ocr 全量核查后 A 档（P1 十六条）W1 波次的回归锁
 *
 * 每条用例名标注对应 finding 编号（#N）。本文件只锁**有行为可观测差异**的改动：
 * #44 组合层对死店降级、#45 槽位探针不再缓存、#109 注入的计数提供者抛错归口、
 * #111 action 上下文的 has 陷阱、#125 SharedArrayBuffer 按字节比较、
 * #130 shallow 克隆保空洞与附加自有键、#164 异步快照数组长度对齐、#173 入口估算的节点预算。
 *
 * #142（debounce 残留回调的空队列守卫）**不在本文件**：它只在「同一批到期回调里 cancel/flush
 * 先跑、旧定时器回调已从本批快照出队」的真实 Node 定时器相位下可达，jest fake timers 会跳过
 * 已 disposed 的定时器，无法稳定复现——与 withThrottle 的同源守卫（其注释亦标明不可测）同处置。
 */
import { runInNewContext } from 'node:vm'
import { composeStore } from '@/core/compose/index.js'
import { createStore } from '@/core/store/factory.js'
import { ActionManager } from '@/core/store/ActionManager.js'
import { isBuiltinObject } from '@/core/store/StateProxy.js'
import { clone, deepEqual } from '@/core/utils/helpers.js'
import { compareSnapshots } from '@/extras/snapshot/diff.js'
import { createSnapshot, createSnapshotAsync } from '@/extras/snapshot/SnapshotManager.js'
import type { ActionContextBase, State } from '@/types/store.js'

describe('#44 组合层对已独立销毁的子 store 一律降级', () => {
  /** 组合层的这三条只读/缓存 API 在测试里只按名字调用，故收窄成最小形状 */
  function makeComposed() {
    const child = createStore({
      name: 'user',
      state: { profile: 'alice' },
      getters: {
        upper: (state: { profile: string }) => state.profile.toUpperCase(),
      },
    })
    const composed = composeStore([child], { namespace: true }) as unknown as {
      getCached: (key: string) => unknown
      getter: (name: string) => unknown
      getState: () => Record<string, unknown>
    }
    return { child, composed }
  }

  it('#44 命名空间模式下 getCached/getter 不再抛「destroyed Store」，与 setState/dispatch 同口径', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { child, composed } = makeComposed()
      expect(composed.getter('user/upper')).toBe('ALICE')

      child.destroy()

      // 修复前：findTargetStoreWithKey 的命名空间分支只按名字解析、不过滤死店，
      // 于是 Store.getCached / Store.getter 各自抛「Cannot call … on a destroyed Store」，
      // 而同一时刻 setState / dispatch / invalidateCache / getCacheStats 全都优雅降级
      expect(() => composed.getCached('user/profile')).not.toThrow()
      expect(composed.getCached('user/profile')).toBeUndefined()
      expect(() => composed.getter('user/upper')).not.toThrow()
      expect(composed.getter('user/upper')).toBeUndefined()
      // 死店按「一次性告警 + 降级」处理，与读路径 _readablePick 同一口径
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})

describe('#45 槽位探针不再按标签/原型缓存', () => {
  it('#45 伪造标签的对象不再永久毒化该类型：之后的真跨 realm Map 仍被识别', () => {
    const forged = { [Symbol.toStringTag]: 'Map' }
    expect(isBuiltinObject(forged)).toBe(false)

    const foreignMap = runInNewContext('new Map([["k", 1]])') as Map<string, number>
    // 前提：确实是本 realm instanceof 判不出的对象，否则本用例什么都锁不住
    expect(foreignMap instanceof Map).toBe(false)
    // 修复前：上面那次伪造已把 'Map' 记进模块级负缓存，这里恒为 false
    // ⇒ 真的跨 realm Map 被当普通对象代理，proxy.set(k,v) 抛「incompatible receiver」
    expect(isBuiltinObject(foreignMap)).toBe(true)

    const foreignSet = runInNewContext('new Set([1])') as Set<number>
    expect(isBuiltinObject(foreignSet)).toBe(true)
  })

  it('#45 已验证过的原型不再让无槽位对象 escape 写保护', () => {
    // 跨 realm 的 Map 子类实例：instanceof 判假 ⇒ 必走探针 ⇒ 修复前其原型被记进「已验证」集合
    const foreign = runInNewContext('class MyMap extends Map {}; new MyMap()') as object
    expect(foreign instanceof Map).toBe(false)
    expect(isBuiltinObject(foreign)).toBe(true)

    // 同原型但没有内部槽位的空壳：修复前因原型命中直接判 true，逃过代理与写保护
    const hollow = Object.create(Object.getPrototypeOf(foreign)) as object
    expect(isBuiltinObject(hollow)).toBe(false)
  })
})

describe('#109 注入的计数提供者抛错时就地归口', () => {
  function createHooks() {
    const errors: unknown[] = []
    const names: string[] = []
    const hooks = {
      emit: (name: string, ...args: unknown[]): void => {
        names.push(name)
        if (name === 'onError') errors.push(args[0])
      },
      on: () => () => {},
      off: (): void => {},
      clear: (): void => {},
      size: () => 0,
    }
    return { hooks, errors, names, messages: () => errors.map((e) => (e as Error).message) }
  }

  function createManager(hooks: unknown, notifyListeners: () => void, extra: Record<string, unknown> = {}) {
    return new ActionManager({
      storeName: 'r8-am',
      withInternalAccess: <T>(fn: () => T): T => fn(),
      setDispatching: () => {},
      notifyListeners,
      hooks: hooks as never,
      ...extra,
    })
  }

  function createContext(): ActionContextBase<State> {
    return {
      name: 'r8-am',
      get state() {
        return {} as State
      },
      setState: () => {},
      $patch: () => {},
      $replaceState: () => {},
      getState: () => ({}) as State,
      dispatch: () => {},
    } as unknown as ActionContextBase<State>
  }

  it('#109 onlyOnChange 下两个提供者都抛错：execute 不外溢，promise 照常落定，错误经 onError 归口', async () => {
    const { hooks, messages } = createHooks()
    const notifyListeners = jest.fn()
    // execute:193 也会读一次 getMutationCount（采集基线），那一处不在本次修复范围内，
    // 故让提供者从**第二次**调用起抛错，才能真正走到 _flushAfterSyncSegment 与 settle 收尾
    let countCalls = 0
    const manager = createManager(hooks, notifyListeners, {
      notifyOnlyOnChange: true,
      getMutationCount: () => {
        if (++countCalls >= 2) throw new Error('count boom')
        return 0
      },
      getLastNotifiedMutationCount: () => {
        throw new Error('baseline boom')
      },
    })
    manager.initialize({ go: async () => await Promise.resolve() }, createContext())

    // 修复前：_flushAfterSyncSegment 在 execute 里被调用得比 .then 挂载还早，
    // 提供者抛错直接冲出 execute（同步抛），action 返回的 promise 无人处理 ⇒ unhandledRejection
    await expect(manager.execute('go')).resolves.toBeUndefined()
    expect(messages()).toContain('baseline boom')
    expect(messages()).toContain('count boom')
  })

  it('#109 提供者抛错不让收尾整段被跳过：默认模式下补发通知照常发生', async () => {
    const { hooks, messages } = createHooks()
    const notifyListeners = jest.fn()
    let count = 0
    const manager = createManager(hooks, notifyListeners, {
      // 不启用 notifyOnlyOnChange：_mutationGate 缺席，走「计数把关 + 无条件通知」那一支
      getMutationCount: () => ++count,
      getLastNotifiedMutationCount: () => {
        throw new Error('baseline boom')
      },
    })
    manager.initialize({ go: async () => await Promise.resolve() }, createContext())

    await manager.execute('go')

    // 修复前 onSettled 把 `getLastNotifiedMutationCount()` 作为实参在 try 之外求值，
    // 抛错会顶掉整段收尾（缓存回刷 + 补发通知）；现在退回 fallback 并照常补发
    expect(notifyListeners).toHaveBeenCalled()
    expect(messages()).toContain('baseline boom')
  })
})

describe('#111 action 上下文的 in 运算符与属性访问一致', () => {
  it('#111 `other in this` 不再与 this.other 给出相反答案', () => {
    const hooks = { emit: jest.fn(), on: jest.fn(() => () => {}), off: jest.fn(), clear: jest.fn(), size: jest.fn(() => 0) }
    const manager = new ActionManager({
      storeName: 'r8-has',
      withInternalAccess: <T>(fn: () => T): T => fn(),
      setDispatching: () => {},
      notifyListeners: () => {},
      hooks: hooks as never,
    })
    const seen: Record<string, unknown> = {}
    manager.initialize(
      {
        probe: function (this: Record<string | symbol, unknown>) {
          seen.hasOther = 'other' in this
          seen.hasMissing = 'missing' in this
          seen.hasContextMember = 'setState' in this
          seen.otherType = typeof this.other
        },
        other: () => 'called',
      },
      {
        name: 'r8-has',
        get state() {
          return {} as State
        },
        setState: () => {},
        $patch: () => {},
        $replaceState: () => {},
        getState: () => ({}) as State,
        dispatch: () => {},
      } as unknown as ActionContextBase<State>,
    )

    manager.execute('probe')

    // action 名只登记在 boundActions、不在 Proxy target 上；修复前缺 has 陷阱 ⇒ false
    expect(seen.hasOther).toBe(true)
    expect(seen.otherType).toBe('function')
    // 不存在的名仍判假，context 自身成员仍可见（has 陷阱不得改变这两类的答案）
    expect(seen.hasMissing).toBe(false)
    expect(seen.hasContextMember).toBe(true)
  })
})

describe('#125 SharedArrayBuffer 按字节内容比较', () => {
  function sab(bytes: number[]): SharedArrayBuffer {
    const buffer = new SharedArrayBuffer(bytes.length)
    new Uint8Array(buffer).set(bytes)
    return buffer
  }

  it('#125 字节相同的两个 SAB 判等', () => {
    expect(deepEqual({ b: sab([1, 2, 3]) }, { b: sab([1, 2, 3]) })).toBe(true)
  })

  it('#125 同大小不同字节判不等（修复前静默判等）', () => {
    // SAB 的自有可枚举键恒空、byteLength 在原型上 ⇒ 通用键比较零次循环后返回 true
    expect(deepEqual({ b: sab([1, 2, 3]) }, { b: sab([1, 2, 4]) })).toBe(false)
  })

  it('#125 不同大小同样判不等（修复前 byteLength 根本没参与比较）', () => {
    expect(deepEqual({ b: sab([1, 2, 3]) }, { b: sab([1, 2]) })).toBe(false)
  })
})

describe('#130 shallow 克隆的数组保空洞与附加自有键', () => {
  it('#130 空洞不被物化成 undefined，副本与源在 deepEqual 下等价', () => {
    const src: number[] = new Array(3)
    src[1] = 1
    src[2] = 2
    expect(Object.prototype.hasOwnProperty.call(src, 0)).toBe(false)

    const copy = clone(src, { mode: 'shallow' })

    // 修复前 `[...obj]` 走迭代器协议，把索引 0 的洞物化成值为 undefined 的实槽位
    expect(Object.prototype.hasOwnProperty.call(copy, 0)).toBe(false)
    expect(copy).toHaveLength(3)
    expect(deepEqual(copy, src)).toBe(true)
  })

  it('#130 非下标自有键与符号键不再静默丢失', () => {
    const tag = Symbol('meta')
    const src = Object.assign([1, 2], { meta: 'v' }) as unknown as number[] & Record<string | symbol, unknown>
    src[tag] = 's'

    const copy = clone(src, { mode: 'shallow' })

    // 修复前迭代器只带下标，附加键整个丢掉 ⇒ 数据静默消失且与源恒不等
    expect(copy.meta).toBe('v')
    expect(copy[tag]).toBe('s')
    expect(deepEqual(copy, src)).toBe(true)
  })

  it('#130 浅拷贝语义不变：元素仍是共享引用', () => {
    const inner = { v: 1 }
    const src = [inner]
    const copy = clone(src, { mode: 'shallow' })
    expect(copy[0]).toBe(inner)
  })
})

describe('#164 异步快照的数组长度与同步路径对齐', () => {
  it('#164 尾部元素被丢弃时两条路径产出等长，diff 不再报出调用方从未做过的 removed', async () => {
    const poison = { boom: true }
    const data = { list: [{ a: 1 }, { a: 2 }, poison] }
    const options = {
      // 抛错 = 交由 onError 裁决；返回 true = 丢弃该节点（该下标永不填充）
      customCloner: (value: unknown) => {
        if (value === poison) throw new Error('discard this node')
        return undefined
      },
      onError: () => true,
    }

    const sync = createSnapshot(data, options)
    const async = await createSnapshotAsync(data, options)

    const syncList = (sync.data as { list: unknown[] }).list
    const asyncList = (async.data as { list: unknown[] }).list
    expect(syncList).toHaveLength(3)
    // 修复前异步产出 length === 2（cloned 的长度只由实际写到的最大索引决定）
    expect(asyncList).toHaveLength(3)

    // 长度分叉的直接后果：compareSnapshots 的数组分支按 maxLen 逐索引比，
    // 把「被丢弃」读成调用方从未做过的 [removed:2]
    const diff = compareSnapshots(sync, async)
    expect(diff.changes.some((c) => c.kind === 'removed')).toBe(false)
  })
})

describe('#173 异步快照入口的节点估算有预算上限', () => {
  it('#173 宽结构下 onProgress 报出的 total 被预算截断，不再逐键扫完整棵树', async () => {
    const wide: Record<string, number> = {}
    for (let i = 0; i < 30000; i++) {
      wide['k' + i] = i
    }

    let total = -1
    const result = await createSnapshotAsync({ wide }, { onProgress: (p) => (total = p.total) })

    expect(result.success).toBe(true)
    expect(total).toBeGreaterThan(0)
    // 修复前 total ≈ 30001：estimateNodeCount 只限深度不限广度，30000 个键逐个
    // getOwnPropertyDescriptor，全部发生在第一个 await 之前 —— 正是这个 API 承诺不做的阻塞
    expect(total).toBeLessThan(30000)
  })
})
