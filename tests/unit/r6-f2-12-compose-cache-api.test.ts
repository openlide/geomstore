/**
 * 第六轮 f2-12 分片回归锁：组合层的 store 名合法性与缓存 API 的命名空间路由
 *
 * 覆盖 R6-034（构造期不校验 name 能否当路由键 + `stores['__proto__'] = …` 走 [[Set]] 被
 * Object.prototype 的 setter 吞掉）、R6-035（缓存 API 是组合层里唯一不做命名空间路由的一组）、
 * R6-079（`getters` 合并对鸭子类型子 store 没有兜底）。
 *
 * 判据沿用 hot 层的既定口径：子 store 可被独立销毁 → 读侧按空视图 / 跳过并一次性告警
 * （`_readablePick`、helpers 的 `applyToStore`），本分片把同一条判据补到缓存 API 上。
 */

import { createStore } from '@/index.js'
import { composeStore, createStoreTree } from '@/core/compose/composeStore.js'

/** 与 composeStore-degraded 同一形状的鸭子类型桩子店：刻意不实现 getters / actions */
function fakeChildWithoutGetters(name: string, state: Record<string, unknown>) {
  return {
    name,
    destroyed: false,
    state,
    getState: () => state,
    hooks: { on: () => () => undefined },
    destroy: () => undefined,
    subscribe: () => () => undefined,
  }
}

/**
 * `composeStore` 的类型面是 `Store<…>`（对外契约里不含路由映射表），运行时实例则是
 * `ComposedStore`，那张表按 `public stores: Record<string, Store>` 暴露
 * （src/core/compose/composeStore.ts:47）。本用例要验的正是这张表自身，故按实现暴露的
 * 字段名窄化一次取回——不给 `Store` 接口加宽，也不落到 `any`。
 */
interface StoresMapOwner {
  stores: Record<string, unknown>
}

function storesMapOf(composed: unknown): Record<string, unknown> {
  return (composed as StoresMapOwner).stores
}

describe('R6-034 子 store 名作为路由键的合法性', () => {
  it('命名空间模式下名字含斜杠直接抛错（此前永远路由不到却一声不响）', () => {
    const leaf = createStore({ name: 'user/info', state: { count: 1 } })
    const other = createStore({ name: 'cart', state: { items: 2 } })

    expect(() => composeStore([leaf, other] as never, { namespace: true } as never)).toThrow('命名空间模式下子 store 名称必须是「非空且不含')
    leaf.destroy()
    other.destroy()
  })

  it('平铺模式不抛错，只在开发模式告警（name 只是 stores 映射的键）', () => {
    const leaf = createStore({ name: 'user/info', state: { count: 1 } })
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect(() => composeStore([leaf] as never)).not.toThrow()
    expect(warn.mock.calls.some((args) => String(args[0]).includes('命名空间路由键'))).toBe(true)

    warn.mockRestore()
    leaf.destroy()
  })

  it("'__proto__' 仍是合法 store 名：stores 映射以自有键承载，原型不被换掉", () => {
    const tricky = createStore({ name: '__proto__', state: { count: 7 } })
    const composed = composeStore([tricky] as never, { namespace: true } as never)

    // 旧写法 `this.stores[store.name] = store` 走 [[Set]] ⟹ 触发 Object.prototype 的
    // __proto__ setter：条目不会成为自有键，而 stores 的原型被换成那个 Store 实例，
    // 于是 composed.stores.getState / destroy / state 全部变成可调用（对外泄漏一整套 Store 方法）
    const composedStores = storesMapOf(composed)
    expect(Object.prototype.hasOwnProperty.call(composedStores, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(composedStores)).toBe(Object.prototype)
    expect(composedStores.getState).toBeUndefined()
    expect(composedStores.destroy).toBeUndefined()
    // 路由照旧可用：'__proto__/count' 能读到、能写
    expect(composed.getCached('__proto__/count' as never) as unknown).toBe(7)
    composed.setState('__proto__/count' as never, 9 as never)
    expect(tricky.getState().count).toBe(9)

    composed.destroy()
  })

  it('createStoreTree 的 children 同样以 DefineOwnProperty 语义写入', () => {
    const tricky = createStore({ name: '__proto__', state: { count: 1 } })
    const tree = createStoreTree([tricky] as never)

    expect(Object.prototype.hasOwnProperty.call(tree.children, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(tree.children)).toBe(Object.prototype)
    // StoreTreeNode.children 按类型契约是可选字段（src/types/compose.ts:47），先按契约判一次
    // 再取下标：拿不到 children 时这条断言就是失败，而不是被 `!` 掩盖成一次运行时炸
    expect(tree.children?.['__proto__']?.store).toBe(tricky)
    expect((tree.children as unknown as Record<string, unknown>).getState).toBeUndefined()

    tricky.destroy()
  })
})

describe('R6-035 缓存 API 的命名空间路由', () => {
  it('带前缀的键只投递给归属 store，不再越权开启未点名的 store', () => {
    const user = createStore({ name: 'u', state: { profile: 'p', other: 1 } })
    const cart = createStore({ name: 'c', state: { profile: 'q' } })
    const composed = composeStore([user, cart] as never, { namespace: true } as never)

    composed.enableCache(['u/profile'] as never)

    expect(user.getCacheStats().enabled).toBe(true)
    expect(user.getCacheStats().keys).toContain('profile')
    // 旧实现把 ['u/profile'] 原样透传给每个子店：两边都匹配不到裸键 ⟹ 缓存静默不生效
    expect(cart.getCacheStats().enabled).toBe(false)

    composed.destroy()
    user.destroy()
    cart.destroy()
  })

  it('getCacheStats().keys 回填 storeName/key，可直接喂回 getCached', () => {
    const user = createStore({ name: 'u', state: { profile: 'p' } })
    const cart = createStore({ name: 'c', state: { cartTotal: 3 } })
    const composed = composeStore([user, cart] as never, { namespace: true } as never)
    composed.enableCache(['u/profile', 'c/cartTotal'] as never)

    const stats = composed.getCacheStats()
    expect(stats.keys.sort()).toEqual(['c/cartTotal', 'u/profile'])
    // 旧形状下这里是子店的本地裸键，与 getCached 的入参不同构 ⟹ 恒为 undefined
    for (const key of stats.keys) {
      expect(composed.getCached(key as never)).toBeDefined()
    }

    composed.destroy()
    user.destroy()
    cart.destroy()
  })

  it('无归属键按 strict 口径处理：strict 抛错，非 strict 告警后忽略', () => {
    const user = createStore({ name: 'u', state: { profile: 'p' } })
    const strictComposed = composeStore([user] as never, { namespace: true, strict: true } as never)
    expect(() => strictComposed.enableCache(['nope/profile'] as never)).toThrow('Cannot find store for key')

    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const loose = composeStore([user] as never, { namespace: true } as never)
    expect(() => loose.enableCache(['nope/profile'] as never)).not.toThrow()
    expect(user.getCacheStats().enabled).toBe(false)
    expect(warn.mock.calls.some((args) => String(args[0]).includes('不属于任何子 store'))).toBe(true)

    warn.mockRestore()
    loose.destroy()
    strictComposed.destroy()
    user.destroy()
  })

  it('平铺模式下多店同名键在 keys 里只出现一次', () => {
    const a = createStore({ name: 'a', state: { shared: 1 } })
    const b = createStore({ name: 'b', state: { shared: 2 } })
    const composed = composeStore([a, b] as never)
    composed.enableCache()

    const keys = composed.getCacheStats().keys
    expect(keys.filter((key) => key === 'shared')).toEqual(['shared'])

    composed.destroy()
    a.destroy()
    b.destroy()
  })

  it('已被独立销毁的子店不再让缓存 API 抛错，只告警一次（与读路径同口径）', () => {
    const live = createStore({ name: 'l', state: { keep: 1 } })
    const dead = createStore({ name: 'd', state: { gone: 1 } })
    const composed = composeStore([live, dead] as never, { namespace: true } as never)
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)

    dead.destroy()

    expect(() => composed.getCacheStats()).not.toThrow()
    expect(() => composed.enableCache(['l/keep'] as never)).not.toThrow()
    expect(() => composed.invalidateCache()).not.toThrow()
    expect(() => composed.disableCache()).not.toThrow()
    const calls = warn.mock.calls.filter((args) => String(args[0]).includes('已销毁')).length
    expect(calls).toBe(1)
    composed.getCacheStats()
    expect(warn.mock.calls.filter((args) => String(args[0]).includes('已销毁')).length).toBe(calls)

    warn.mockRestore()
    composed.destroy()
    live.destroy()
  })
})

describe('R6-079 getters 合并对鸭子类型子 store 的兜底', () => {
  it('未实现 getters 的子 store 按「无 getter」降级，不再在只读路径上抛 TypeError', () => {
    const stub = fakeChildWithoutGetters('stub', { a: 1 })
    const composed = composeStore([stub] as never)

    expect(() => composed.getters).not.toThrow()
    expect(composed.getters).toEqual({})
    // 同一形状下的同类读路径也必须照旧可用（口径一致）
    expect(composed.getGetterNames()).toEqual([])
  })

  it('混合场景：有 getters 的子店照常合并，命名空间模式带前缀', () => {
    const real = createStore({ name: 'r', state: { n: 2 }, getters: { doubled: (s: { n: number }) => s.n * 2 } })
    const stub = fakeChildWithoutGetters('stub', { a: 1 })
    const composed = composeStore([stub, real] as never, { namespace: true } as never)

    expect(Object.keys(composed.getters)).toEqual(['r/doubled'])
    expect(composed.getter('r/doubled' as never) as unknown).toBe(4)

    composed.destroy()
    real.destroy()
  })
})
