/**
 * 第五轮审查 · 分片 core-misc-p1 的回归锁
 *
 * 覆盖本分片修复的行为面：
 * - LRUCache：容量单副本、回填导致淘汰不收敛时的单次诊断（R5-085/R5-086）
 * - composeStore：投递次数快照、可选 getGetterNames 的一致性、可写计数单点记账（R5-103/104/105）
 * - compose/merge：同名不同实例的覆盖告警、读写分裂文案（R5-106/107）
 * - compose/helpers：命名空间分支的两段式校验、竞态吞异常收窄、嵌套判据单点（R5-080/082/083）
 * - StoreRegistry：重入注册、别名一并摘除、销毁守卫与校验单点、clear 的重入契约（R5-072~076）
 * - GeomStoreError：原型对齐、context 浅拷贝与环路/BigInt 安全序列化（R5-077/078/079）
 * - HookSystem：退订句柄一次性、已销毁 Store 的误用冒泡（R5-087/088）
 * - AsyncBatchNotifier：批次内退订不再收本批次投递（R5-100）
 * - 三处歧义告警的生产模式静默（R5-081）
 */

import { LRUCache } from '@/core/cache/LRUCache.js'
import { composeStore, StoreRegistry } from '@/core/compose/index.js'
import { dispatchByNamespace, findTargetStoreWithKey } from '@/core/compose/helpers.js'
import { mergeStateMaps } from '@/core/compose/merge.js'
import { createError, ErrorCode, GeomStoreError, StateError } from '@/core/errors/GeomStoreError.js'
import { HookSystem, usePlugin } from '@/core/hooks/index.js'
import { AsyncBatchNotifier } from '@/core/performance/index.js'
import { createStore } from '@/core/store/index.js'
import type { Store } from '@/types/store.js'
import type { Plugin } from '@/types/plugin.js'

/** 最小可用子 store 桩件：只覆盖组合层实际调用到的成员 */
function fakeChild(name: string, state: Record<string, unknown>, extra: Record<string, unknown> = {}): Store {
  return {
    name,
    destroyed: false,
    state,
    actions: {},
    getters: {},
    getState: () => state,
    hooks: { on: () => () => {} },
    subscribe: () => () => {},
    destroy: () => {},
    ...extra,
  } as unknown as Store
}

/** 改写桩件的 destroyed：`Store` 把它声明为只读，按形状收窄后才能赋值 */
function markDestroyed(store: Store, value = true): void {
  const target = store as unknown as { destroyed: boolean }
  target.destroyed = value
}

describe('R5 core-misc-p1 · LRUCache', () => {
  it('R5-085: 规范化后的容量只有一份，options 里不再留原始值', () => {
    const cache = new LRUCache<string, number>({ capacity: NaN })
    const options = (cache as unknown as { options: Record<string, unknown> }).options

    expect(cache.getCapacity()).toBe(100)
    // 「原始值与生效值分叉」的前提是两处各存一份，这里直接消除第二份
    expect('capacity' in options).toBe(false)

    cache.resize(0)
    expect(cache.getCapacity()).toBe(1)
    expect('capacity' in options).toBe(false)
  })

  it('R5-086: onEvict 每次回填被逐出的键时报告一次「容量无法收敛」，且不随写入刷屏', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const cache = new LRUCache<string, number>({
      capacity: 3,
      onEvict: (key, value) => {
        // 写回式回调：每次淘汰都把刚交出的键填回来
        cache.set(key, value)
      },
    })
    cache.set('a', 1).set('b', 2).set('c', 3)
    cache.set('d', 4)

    // 淘汰与回填互相抵消：本轮确实无法达成上限，尺寸仍超限
    expect(cache.size()).toBeGreaterThan(3)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('onEvict 回调在淘汰过程中写入了新条目'))

    cache.set('e', 5)
    cache.set('f', 6)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    warnSpy.mockRestore()
  })

  it('R5-086: 回调有限回填、本轮能收敛时不误报', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    let refills = 0
    const cache = new LRUCache<string, number>({
      capacity: 2,
      onEvict: () => {
        if (refills < 1) {
          refills++
          cache.set('replacement', 99)
        }
      },
    })
    cache.set('a', 1).set('b', 2).set('c', 3)

    expect(cache.size()).toBeLessThanOrEqual(2)
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('R5-086: resize 触发的同类冲突共用一条收敛路径', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const cache = new LRUCache<string, number>({
      capacity: 3,
      onEvict: (key, value) => {
        cache.set(key, value)
      },
    })
    cache.set('a', 1).set('b', 2).set('c', 3)
    cache.resize(1)

    expect(cache.size()).toBeGreaterThan(1)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('超出容量上限 1'))
    warnSpy.mockRestore()
  })
})

describe('R5 core-misc-p1 · composeStore 订阅', () => {
  it('R5-103: 回调内释放自己的一份重复注册，本轮仍按进入时的在册次数投递', async () => {
    const child = createStore({ name: 'r5-c', state: { n: 0 } })
    const composed = composeStore([child])

    let firstHandle = () => {}
    const listener = jest.fn(() => {
      firstHandle()
    })
    firstHandle = composed.subscribe(listener)
    composed.subscribe(listener)

    child.setState('n', 1)
    await Promise.resolve()

    // 修复前：投递次数取自活对象 entry.total，被回调内退订就地递减后第二次投递被截断
    expect(listener).toHaveBeenCalledTimes(2)
    // 退订本身仍然生效：只剩一份注册
    const listeners = (composed as unknown as { _composedListeners: Map<unknown, number> })._composedListeners
    expect(listeners.get(listener)).toBe(1)

    composed.destroy()
  })

  it('R5-105: 载荷是否深拷贝只由「可写注册总数」决定', async () => {
    const child = createStore({ name: 'r5-w', state: { n: 0 } })
    const composed = composeStore([child])
    const writableListener = jest.fn()
    const unsubscribe = composed.subscribe(writableListener)

    child.setState('n', 1)
    await Promise.resolve()
    expect(writableListener).toHaveBeenCalledTimes(1)
    // 存在可写订阅者：载荷必须是深拷贝，就地改它不得写回子 store
    expect(writableListener.mock.calls[0][0]).not.toBe(composed.getState())

    unsubscribe()
    const readOnlyListener = jest.fn()
    composed.subscribe(readOnlyListener, { readOnly: true })

    child.setState('n', 2)
    await Promise.resolve()
    expect(readOnlyListener).toHaveBeenCalledTimes(1)
    // 可写注册清零后回到零拷贝路径：载荷即合并缓存本体（per-listener writable 已删除，
    // 回收只经 _composedWritableCount 一处，少减一次就会永久停在深拷贝档）
    expect(readOnlyListener.mock.calls[0][0]).toBe(composed.getState())

    composed.destroy()
  })

  it('R5-104: 子 store 未实现可选的 getGetterNames 时按「无 getter」降级，不抛 TypeError', () => {
    const bare = fakeChild('bare', { n: 1 })
    const withGetter = fakeChild('with', { m: 1 }, { getGetterNames: () => ['half'], getter: () => 'H' })
    const composed = composeStore([bare, withGetter])

    expect(composed.getGetterNames()).toEqual(['half'])
    expect(() => composed.getter('half')).not.toThrow()
    expect(composed.getter('half')).toBe('H')
    expect(composed.getter('missing')).toBeUndefined()

    composed.destroy()
  })
})

describe('R5 core-misc-p1 · compose/merge', () => {
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  const pickState = (store: Store) => store.getState() as Record<string, unknown>

  it('R5-107: 两个不同实例共用名字时的静默覆盖必须告警（按名字比较会把它抑制掉）', () => {
    const first = fakeChild('a', { shared: 1 })
    const twin = fakeChild('a', { shared: 2 })
    const warned = new Set<string>()

    const merged = mergeStateMaps([first, twin], pickState, warned)

    expect(merged.shared).toBe(2)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('State key "shared" exists in multiple stores (a, a)'))
    expect([...warned]).toEqual(['shared(a,a)'])
  })

  it('R5-107: 同一实例被重复列入 stores 不产生覆盖，不告警', () => {
    const only = fakeChild('a', { shared: 1 })
    const warned = new Set<string>()

    const merged = mergeStateMaps([only, only], pickState, warned)

    expect(merged.shared).toBe(1)
    expect(warnSpy).not.toHaveBeenCalled()
    expect(warned.size).toBe(0)
  })

  it('R5-106: 三方同名键的告警成链报告「上一个写入者 → 当前写入者」，不永远停在第一个', () => {
    const a = fakeChild('s1', { k: 1 })
    const b = fakeChild('s2', { k: 2 })
    const c = fakeChild('s3', { k: 3 })
    const warned = new Set<string>()

    mergeStateMaps([a, b, c], pickState, warned)

    expect([...warned]).toEqual(['k(s1,s2)', 'k(s2,s3)'])
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('(s2, s3)'))
  })

  it('R5-106: 告警同时给出读取侧最终归属与写入侧第一命中，且与真实行为一致', () => {
    const a = createStore({ name: 'w-a', state: { shared: 'from-a', onlyA: 1 } })
    const b = createStore({ name: 'w-b', state: { shared: 'from-b' } })
    const composed = composeStore([a, b])

    // 读取侧：最后一个含该键的 store 决定合并视图
    expect(composed.getState().shared).toBe('from-b')
    // 写入侧：第一个含该键的 store 接收写入，故这次写入在 getState() 里看不见
    composed.setState('shared', 'written')
    expect(a.getState().shared).toBe('written')
    expect(b.getState().shared).toBe('from-b')
    expect(composed.getState().shared).toBe('from-b')

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"w-b" wins in merged state/snapshot'))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('而写入（setState/$patch/dispatch/getter）路由到**第一个**含该键的 store'))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('请使用命名空间模式消除歧义'))
    composed.destroy()
  })
})

describe('R5 core-misc-p1 · compose/helpers', () => {
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('R5-080: 命名空间 + strict 的校验先于任何写入，不再留下半更新状态', () => {
    const a = fakeChild('a', { x: 1 })
    const handler = jest.fn()

    expect(() => dispatchByNamespace([a], true, { a: { x: 2 }, missing: { y: 1 } }, true, handler)).toThrow('[composeStore] Cannot find store for key: missing')
    expect(handler).not.toHaveBeenCalled()
  })

  it('R5-080: 命名空间模式下校验通过的条目按原顺序全部落库', () => {
    const a = fakeChild('a', { x: 1 })
    const b = fakeChild('b', { y: 1 })
    const handler = jest.fn()

    dispatchByNamespace([a, b], true, { a: { x: 2 }, b: { y: 2 } }, false, handler)

    expect(handler).toHaveBeenCalledTimes(2)
    expect(handler).toHaveBeenNthCalledWith(1, a, { x: 2 })
    expect(handler).toHaveBeenNthCalledWith(2, b, { y: 2 })
  })

  it('R5-082: 已销毁子 store 上抛出的非销毁类异常必须冒泡', () => {
    const alive = fakeChild('alive', { x: 1 })
    const midDestroy = jest.fn((store: Store) => {
      markDestroyed(store)
      throw new Error('状态保护拦截：与销毁无关的真实故障')
    })

    expect(() => dispatchByNamespace([alive], true, { alive: { x: 3 } }, false, midDestroy)).toThrow('与销毁无关的真实故障')
  })

  it('R5-082: 只有销毁守卫的固定文案（含 ComposedStore 变体）才被吞掉', () => {
    const run = (message: string) => {
      const store = fakeChild('s', { x: 1 })
      const handler = jest.fn((target: Store) => {
        markDestroyed(target)
        throw new Error(message)
      })
      return () => dispatchByNamespace([store], true, { s: { x: 2 } }, false, handler)
    }

    expect(run('[GeomStore] Cannot call $patch on a destroyed Store')).not.toThrow()
    expect(run('[GeomStore] Cannot call batch on a destroyed ComposedStore')).not.toThrow()
    expect(run('[GeomStore] something else on a destroyed thing')).toThrow('destroyed thing')
  })

  it('R5-083: 只挂在原型上的内层名在读写两处都不算嵌套', () => {
    // 判据已收敛到 ownsNestedStore 单点：两处必须一致地把「原型链上的内层名」
    // 当作非嵌套，否则 dispatch 能路由而 setState 静默失败
    const outer = fakeChild('outer', { 'inherited/x': 1 }, { stores: Object.create({ inherited: {} }) })
    const handler = jest.fn()

    dispatchByNamespace([outer], undefined, { 'inherited/x': 2 }, false, handler)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(outer, { 'inherited/x': 2 })
    expect(findTargetStoreWithKey('inherited/x', [outer])).toEqual([outer, 'inherited/x'])
  })

  it('R5-083: 自有键的嵌套分组与回退查找结果一致', () => {
    const outer = fakeChild('outer', { 'leaf/n': 1 }, { stores: { leaf: {} } })
    const handler = jest.fn()

    dispatchByNamespace([outer], undefined, { 'leaf/n': 2 }, false, handler)

    expect(handler).toHaveBeenCalledWith(outer, { leaf: { n: 2 } })
    expect(findTargetStoreWithKey('leaf/n', [outer])).toEqual([outer, 'leaf/n'])
  })

  it('R5-083: stores 为 null 的鸭子类型子 store 在两条路径上都只按「非嵌套」处理，不抛 TypeError', () => {
    // 共享判据对空值的口径：hasOwnProperty.call(null, …) 会抛，鸭子类型 store 常把
    // 未初始化的 stores 置成 null，只读路径（渲染/getState）不能因此崩
    const weird = fakeChild('weird', { owned: 1 }, { stores: null })
    const handler = jest.fn()

    expect(findTargetStoreWithKey('owned', [weird])).toEqual([weird, 'owned'])
    expect(() => findTargetStoreWithKey('leaf/deep', [weird])).not.toThrow()
    expect(findTargetStoreWithKey('leaf/deep', [weird])).toEqual([undefined, 'leaf/deep'])
    expect(() => dispatchByNamespace([weird], undefined, { 'leaf/deep': 2 }, false, handler)).not.toThrow()
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('R5 core-misc-p1 · StoreRegistry', () => {
  let warnSpy: jest.SpyInstance
  let errorSpy: jest.SpyInstance

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  function entry(name: string): Store {
    const store = {
      name,
      destroyed: false,
      getState: () => ({ n: 1 }),
      $replaceState: jest.fn(),
      destroy: jest.fn(),
    }
    store.destroy.mockImplementation(() => {
      store.destroyed = true
    })
    return store as unknown as Store
  }

  it('R5-072: destroy 期间重入注册同名 store 不被静默顶掉，重入实例照常销毁', () => {
    const registry = new StoreRegistry()
    const oldStore = entry('old')
    const reentrant = entry('re')
    const incoming = entry('in')
    registry.register('x', oldStore)

    let done = false
    ;(oldStore.destroy as jest.Mock).mockImplementation(() => {
      markDestroyed(oldStore)
      if (!done) {
        done = true
        registry.register('x', reentrant)
      }
    })

    registry.register('x', incoming)

    expect(registry.get('x')).toBe(incoming)
    expect(reentrant.destroy).toHaveBeenCalledTimes(1)
    expect(reentrant.destroyed).toBe(true)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('在旧实例 destroy() 期间被重新注册'))
    registry.clear()
  })

  it('R5-072: 重入注册改写过默认引用时，默认仍指向本次注册的实例', () => {
    const registry = new StoreRegistry()
    const oldStore = entry('old')
    const reentrant = entry('re')
    const incoming = entry('in')
    registry.register('x', oldStore)
    registry.setDefault('x')

    let done = false
    ;(oldStore.destroy as jest.Mock).mockImplementation(() => {
      markDestroyed(oldStore)
      if (!done) {
        done = true
        registry.register('x', reentrant)
        registry.setDefault('x')
      }
    })

    registry.register('x', incoming)

    expect(registry.getDefault()).toBe(incoming)
    registry.clear()
  })

  it('R5-072: 重入注册的正是本次要登记的实例时，不得先销毁它再挂上', () => {
    const registry = new StoreRegistry()
    const oldStore = entry('old')
    const incoming = entry('in')
    registry.register('x', oldStore)

    let done = false
    ;(oldStore.destroy as jest.Mock).mockImplementation(() => {
      markDestroyed(oldStore)
      if (!done) {
        done = true
        registry.register('x', incoming)
      }
    })

    registry.register('x', incoming)

    expect(registry.get('x')).toBe(incoming)
    expect(incoming.destroy).not.toHaveBeenCalled()
    expect(incoming.destroyed).toBe(false)
    registry.clear()
  })

  it('R5-073: 注销一个别名会一并摘除同一实例的其它名字，不留已销毁条目', () => {
    const registry = new StoreRegistry()
    const shared = entry('shared')
    const other = entry('other')
    registry.register('a', shared)
    registry.register('b', shared)
    registry.register('c', other)
    registry.setDefault('a')

    registry.unregister('b')

    expect(shared.destroy).toHaveBeenCalledTimes(1)
    expect(registry.get('a')).toBeUndefined()
    expect(registry.get('b')).toBeUndefined()
    expect(registry.getDefault()).toBeUndefined()
    // 不相关的条目不受影响
    expect(registry.get('c')).toBe(other)
    registry.clear()
  })

  it('R5-073: 覆盖注册同样摘除旧实例的别名', () => {
    const registry = new StoreRegistry()
    const shared = entry('shared')
    registry.register('a', shared)
    registry.register('b', shared)

    registry.register('a', entry('fresh'))

    expect(shared.destroy).toHaveBeenCalledTimes(1)
    expect(registry.get('b')).toBeUndefined()
    expect(registry.size()).toBe(1)
    registry.clear()
  })

  it('R5-074: 鸭子类型缺 destroy 的实例在三条清理路径上都不抛错、不产生错误日志', () => {
    const registry = new StoreRegistry()
    const duck = { name: 'duck', destroyed: false, getState: () => ({}) } as unknown as Store

    registry.register('duck', duck)
    registry.register('duck', entry('replacement'))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('already registered, overwriting'))

    registry.register('duck2', { name: 'duck2', destroyed: false, getState: () => ({}) } as unknown as Store)
    registry.unregister('duck2')
    expect(registry.has('duck2')).toBe(false)

    registry.register('duck3', { name: 'duck3', destroyed: false, getState: () => ({}) } as unknown as Store)
    expect(() => registry.clear()).not.toThrow()
    expect(errorSpy).not.toHaveBeenCalled()
    expect(registry.size()).toBe(0)
  })

  it('R5-075: register 与 registerAll 的校验判据与文案完全一致', () => {
    const registry = new StoreRegistry()
    const invalid = { nope: true } as unknown as Store

    expect(() => registry.register('', entry('x'))).toThrow('[StoreRegistry] Store name must be a non-empty string')
    expect(() => registry.registerAll({ '': entry('x') })).toThrow('[StoreRegistry] Store name must be a non-empty string')
    expect(() => registry.register('k', invalid)).toThrow('[StoreRegistry] Invalid store object for name "k"')
    expect(() => registry.registerAll({ k: invalid })).toThrow('[StoreRegistry] Invalid store object for name "k"')
  })

  it('R5-076: 重入注册留下的条目按契约不被连带销毁', () => {
    const registry = new StoreRegistry()
    const a = entry('a')
    const latecomer = entry('late')
    registry.register('a', a)
    ;(a.destroy as jest.Mock).mockImplementation(() => {
      markDestroyed(a)
      registry.register('late', latecomer)
    })

    registry.clear()

    expect(registry.get('late')).toBe(latecomer)
    expect(latecomer.destroy).not.toHaveBeenCalled()
    expect(registry.size()).toBe(1)
    registry.clear()
  })
})

describe('R5 core-misc-p1 · GeomStoreError', () => {
  it('R5-077: 两层派生的原型对齐不依赖 new.target 分支', () => {
    class OuterError extends GeomStoreError {}
    const outer = new OuterError('boom', 'UNKNOWN_ERROR')

    expect(outer).toBeInstanceOf(OuterError)
    expect(outer).toBeInstanceOf(GeomStoreError)
    expect(Object.getPrototypeOf(outer)).toBe(OuterError.prototype)
    expect(Object.getPrototypeOf(new GeomStoreError('boom', 'UNKNOWN_ERROR'))).toBe(GeomStoreError.prototype)
  })

  it('R5-078: 调用方事后改写传入的 context 不影响已捕获的错误现场', () => {
    const context: Record<string, unknown> = { storeName: 'user-store', operation: 'login' }
    const error = new GeomStoreError('boom', 'ACTION_EXECUTION_ERROR', context)

    context.storeName = 'changed'
    delete context.operation

    expect(error.context).toEqual({ storeName: 'user-store', operation: 'login' })
    expect(error.getFriendlyMessage()).toBe("boom in store 'user-store': login")
  })

  it('R5-078: 无 context 时不凭空造对象', () => {
    const error = new GeomStoreError('boom', 'UNKNOWN_ERROR')

    expect(error.context).toBeUndefined()
    expect(error.toJSON().context).toBeUndefined()
  })

  it('R5-078: 包装底层异常时原始错误随 cause 保留，并带着 name/message 进入 toJSON', () => {
    const original = new TypeError('JSON 解析失败')
    const error = new StateError('Persist state failed', 'STATE_UPDATE_ERROR', { key: 'user' }, original)

    expect(error).toBeInstanceOf(GeomStoreError)
    expect(error.cause).toBe(original)
    expect(error.toJSON().cause).toEqual({ name: 'TypeError', message: 'JSON 解析失败' })
    // Error 的 message/stack 是不可枚举自有属性，通用归一会把它塌成 {}，故 cause 单独取形
    expect(JSON.parse(JSON.stringify(error)).cause.message).toBe('JSON 解析失败')
  })

  it('R5-078: 未提供 cause 时既不挂自有属性，也不改变既有输出形状', () => {
    const error = new GeomStoreError('boom', 'UNKNOWN_ERROR', { k: 1 })

    expect(Object.prototype.hasOwnProperty.call(error, 'cause')).toBe(false)
    expect(error.toJSON()).toEqual({
      name: 'GeomStoreError',
      message: 'boom',
      code: 'UNKNOWN_ERROR',
      context: { k: 1 },
      stack: expect.any(String),
    })
  })

  it('R5-078: createError 转发 cause，环路 cause 同样不会让序列化二次抛错', () => {
    const loop: Record<string, unknown> = {}
    loop.self = loop

    const error = createError(ErrorCode.STATE_UPDATE_ERROR, 'boom', undefined, loop)

    expect(error).toBeInstanceOf(StateError)
    expect(error.cause).toBe(loop)
    expect(JSON.parse(JSON.stringify(error.toJSON())).cause).toEqual({ self: '[Circular]' })
  })

  it('R5-079: 循环引用 / BigInt / 取值即抛的访问器都不会让 JSON.stringify(error) 二次抛错', () => {
    const circular: Record<string, unknown> = { name: 'node' }
    circular.self = circular
    const state = {
      user: {
        nested: circular,
        get boom(): number {
          throw new Error('getter 抛错')
        },
      },
      total: 1234n,
    }
    const error = new GeomStoreError('state failed', 'STATE_UPDATE_ERROR', state as unknown as Record<string, unknown>)

    const serialized = JSON.parse(JSON.stringify(error)) as { context: Record<string, { nested: Record<string, unknown>; boom: string; total: string }> }

    expect(serialized.context.user.nested).toEqual({ name: 'node', self: '[Circular]' })
    expect(serialized.context.user.boom).toBe('[Unreadable]')
    expect(serialized.context.total).toBe('1234n')
    expect(() => error.toJSON()).not.toThrow()
  })

  it('R5-079: 共享引用（非循环）不被误标，带 toJSON 的对象按其自身序列化器处理', () => {
    const shared = { v: 1 }
    const error = new GeomStoreError('boom', 'UNKNOWN_ERROR', { a: shared, b: shared, when: new Date(0) })

    const json = error.toJSON()

    expect(json.context).toEqual({ a: { v: 1 }, b: { v: 1 }, when: new Date(0) })
    expect((json.context as { when: unknown }).when).toBeInstanceOf(Date)
    expect(JSON.parse(JSON.stringify(error)).context.when).toBe('1970-01-01T00:00:00.000Z')
  })

  it('R5-079: 数组元素同规则归一，超过深度上限的分支截断', () => {
    const deep: Record<string, unknown> = { level: 0 }
    let cursor = deep
    for (let level = 1; level <= 10; level++) {
      const next: Record<string, unknown> = { level }
      cursor.child = next
      cursor = next
    }
    const error = new GeomStoreError('boom', 'UNKNOWN_ERROR', { list: [1, 2n, deep], empty: [] })

    const json = error.toJSON() as { context: { list: unknown[]; empty: unknown[] } }

    expect(json.context.list[0]).toBe(1)
    expect(json.context.list[1]).toBe('2n')
    expect(json.context.empty).toEqual([])
    expect(JSON.stringify(json.context.list[2])).toContain('[Truncated]')
  })

  it('R5-079: 自有 __proto__ 键仍以数据属性承载，不污染序列化结果', () => {
    const context = JSON.parse('{"__proto__": {"polluted": true}, "k": 1}')
    const error = new GeomStoreError('boom', 'UNKNOWN_ERROR', context)

    const roundTripped = JSON.parse(JSON.stringify(error.toJSON()))

    expect(Object.prototype.hasOwnProperty.call(roundTripped.context, '__proto__')).toBe(true)
    expect(roundTripped.polluted).toBeUndefined()
    expect(roundTripped.context.k).toBe(1)
  })
})

describe('R5 core-misc-p1 · HookSystem', () => {
  it('R5-087: 失效句柄的重复调用不会删掉之后重新注册的同一 handler', () => {
    const hooks = new HookSystem()
    const handler = jest.fn()

    const off1 = hooks.on('beforeSetState', handler)
    off1()
    const off2 = hooks.on('beforeSetState', handler)
    off1()

    expect(hooks.listenerCount('beforeSetState')).toBe(1)
    hooks.emit('beforeSetState', 'k', 1)
    expect(handler).toHaveBeenCalledTimes(1)

    off2()
    expect(hooks.size()).toBe(0)
  })

  it('R5-087: 同一句柄重复调用幂等，不会二次摘键', () => {
    const hooks = new HookSystem()
    const off = hooks.on('onError', jest.fn())

    off()
    expect(() => off()).not.toThrow()
    expect(hooks.size()).toBe(0)
  })

  it('R5-088: 在已销毁的 Store 上装插件按 Store.use 的 @throws 契约抛出', () => {
    const store = createStore({ name: 'r5-destroyed', state: { n: 1 } })
    store.destroy()
    const plugin: Plugin = { name: 'p', install: () => () => {} }

    expect(() => usePlugin(plugin, store)).toThrow('[GeomStore] Cannot call use on a destroyed Store')
  })

  it('R5-088: 插件安装失败仍按 PLUGIN-002 降级，不抛出', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const store = createStore({ name: 'r5-plugin-fail', state: { n: 1 } })
    const broken: Plugin = {
      name: 'broken',
      install: () => {
        throw new Error('install boom')
      },
    }

    const uninstall = usePlugin(broken, store)

    expect(() => uninstall()).not.toThrow()
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to install plugin "broken"'), expect.any(Error))
    errorSpy.mockRestore()
  })
})

describe('R5 core-misc-p1 · AsyncBatchNotifier', () => {
  it('R5-100: 批次迭代中退订的监听器不再收到本次投递', async () => {
    const notifier = new AsyncBatchNotifier<number>()
    let secondOff = () => {}
    const second = jest.fn()
    const early = jest.fn(() => {
      secondOff()
    })

    notifier.subscribe(early)
    secondOff = notifier.subscribe(second)
    notifier.notify(1)
    await Promise.resolve()

    expect(early).toHaveBeenCalledTimes(1)
    // 修复前：快照已含 second，即便它已退订仍会被投递一次（对已卸载的组件跑最后一次状态）
    expect(second).not.toHaveBeenCalled()
  })

  it('R5-100: 监听器内调用 clear() 后其余在册监听器不再收本批次', async () => {
    const notifier = new AsyncBatchNotifier<number>()
    const rest = jest.fn()
    notifier.subscribe(() => {
      notifier.clear()
    })
    notifier.subscribe(rest)

    notifier.notify(2)
    await Promise.resolve()

    expect(rest).not.toHaveBeenCalled()
    expect(notifier.size()).toBe(0)
  })

  it('R5-100: 迭代中新增的订阅者不参与本批次，下一批次开始收到', async () => {
    const notifier = new AsyncBatchNotifier<number>()
    const late = jest.fn()
    let added = false
    notifier.subscribe(() => {
      if (!added) {
        added = true
        notifier.subscribe(late)
      }
    })

    notifier.notify(3)
    await Promise.resolve()
    expect(late).not.toHaveBeenCalled()

    notifier.notify(4)
    await Promise.resolve()
    expect(late).toHaveBeenCalledTimes(1)
    expect(late).toHaveBeenCalledWith(4)
  })

  it('R5-100: 失效句柄不会误删之后重新建立的订阅', async () => {
    const notifier = new AsyncBatchNotifier<number>()
    const listener = jest.fn()
    const off1 = notifier.subscribe(listener)
    off1()
    notifier.subscribe(listener)
    off1()

    notifier.notify(5)
    await Promise.resolve()
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('R5 core-misc-p1 · 生产模式静默', () => {
  let mod: {
    isProduction: () => boolean
    composeStore: (stores: Store[], options?: { namespace?: string | boolean }) => ReturnType<typeof composeStore>
    findTargetStoreWithKey: typeof findTargetStoreWithKey
  }
  let warnSpy: jest.SpyInstance
  let prevEnv: string | undefined

  beforeAll(async () => {
    // isProduction() 的结果在模块实例内永久缓存：加载期置 NODE_ENV=production 并
    // resetModules，取一组按生产模式判定的全新模块（同 production-mode-silence.test.ts）
    prevEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    jest.resetModules()
    mod = {
      isProduction: (await import('@/core/store/utils.js')).isProduction,
      composeStore: (await import('@/core/compose/index.js')).composeStore,
      findTargetStoreWithKey: (await import('@/core/compose/helpers.js')).findTargetStoreWithKey,
    }
  })

  afterAll(() => {
    process.env.NODE_ENV = prevEnv
  })

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('自检：本次加载的模块确实按生产模式判定', () => {
    expect(mod.isProduction()).toBe(true)
  })

  it('R5-081: 歧义键 / action / getter 三处告警在生产模式静默，取值行为不变', () => {
    const a = fakeChild(
      'a',
      { shared: 1 },
      { actions: { run: () => 1 }, dispatch: jest.fn(() => 'A'), getGetterNames: () => ['half'], getter: jest.fn(() => 'ga') },
    )
    const b = fakeChild(
      'b',
      { shared: 2 },
      { actions: { run: () => 2 }, dispatch: jest.fn(() => 'B'), getGetterNames: () => ['half'], getter: jest.fn(() => 'gb') },
    )
    const composed = mod.composeStore([a, b])

    expect(composed.dispatch('run')).toBe('A')
    expect(composed.getter('half')).toBe('ga')
    expect(mod.findTargetStoreWithKey('shared', [a, b], undefined)[0]).toBe(a)

    expect(warnSpy).not.toHaveBeenCalled()
    composed.destroy()
  })

  it('R5-081 对照：同一条写入在开发模式下确实会告警（否则上一条是空过）', () => {
    const a = fakeChild('a', { shared: 1 }, { getGetterNames: () => ['half'] })
    const b = fakeChild('b', { shared: 2 }, { getGetterNames: () => ['half'] })

    findTargetStoreWithKey('shared', [a, b], undefined)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Ambiguous key "shared"'))
  })
})
