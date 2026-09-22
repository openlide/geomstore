/**
 * 第五轮 core-store-p1 分片：状态保护代理的契约与分流实现
 *
 * R5-114（warn/silent 只保证保护层自己不抛，不保证底层写得进）、
 * R5-115（越界的 productionHandler 在构造期失败）、R5-116（子值包装只留一份分流实现）、
 * R5-117（绑定方法按 (owner, key) 复用）、R5-118（根数组走数组代理）、
 * R5-119（内建对象判定与 realm 无关）。
 *
 * 跨 realm 对象用 node:vm 的新 realm 造，并把「instanceof 判假」本身写成断言，
 * 以免将来 vm 行为变化时用例静默退化成「同 realm 也过」。
 */
import { runInNewContext } from 'node:vm'
import { StateProxyManager, createProxyCache, isBuiltinObject } from '@/core/store/StateProxy.js'
import { createDirtyTrackingCache, createDirtyTrackingProxy } from '@/core/store/dirtyTracking.js'
import type { InternalStateProtectionConfig } from '@/core/store/types.js'
import type { State } from '@/types/store.js'
import { createStore } from '@/core/store/factory.js'

function makeManager(protection: Partial<InternalStateProtectionConfig> = {}) {
  let isInternal = false
  const manager = new StateProxyManager<State>({
    protection: { enabled: true, deep: true, productionHandler: 'warn', ...protection } as InternalStateProtectionConfig,
    proxyCache: createProxyCache(),
    isInternalAccess: () => isInternal,
  })
  return {
    manager,
    setInternal: (value: boolean): void => {
      isInternal = value
    },
  }
}

describe('R5-114 warn/silent 的放行边界只到保护层为止', () => {
  const originalEnv = process.env.NODE_ENV
  // isProduction 的结果在模块实例内永久缓存，且 warn/silent 处理器只在生产生效：
  // 必须按库口径重载模块，否则这里测到的是开发模式的保护抛错
  let prodManager: (protection: Partial<InternalStateProtectionConfig>) => StateProxyManager<State>

  beforeEach(async () => {
    jest.resetModules()
    process.env.NODE_ENV = 'production'
    const mod: typeof import('@/core/store/StateProxy.js') = await import('@/core/store/StateProxy.js')
    prodManager = (protection) =>
      new mod.StateProxyManager({
        protection: { enabled: true, deep: true, productionHandler: 'warn', ...protection } as InternalStateProtectionConfig,
        proxyCache: mod.createProxyCache(),
        isInternalAccess: () => false,
      })
  })

  afterEach(() => {
    process.env.NODE_ENV = originalEnv
    jest.resetModules()
  })

  it.each(['warn', 'silent'] as const)('productionHandler=%s 时处理器自己不抛，但冻结目标上的写入仍由引擎判负', (handler) => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const manager = prodManager({ productionHandler: handler })
      const frozen = Object.freeze({ x: 1 })
      const state = { ok: 0, nested: frozen } as Record<string, unknown>
      const proxy = manager.createStateProxy(state as State, '') as Record<string, any>

      // 契约的正半句：处理器不拦，底层写得进的就是写得进
      proxy.ok = 5
      expect(state.ok).toBe(5)
      warn.mockClear()

      // 契约的反半句：底层写不进（目标是 Object.freeze 的快照）时陷阱如实返回 false，
      // 严格模式下由引擎就那次赋值抛 TypeError——保护层不代为吞掉
      expect(() => {
        'use strict'
        proxy.nested.x = 2
      }).toThrow(TypeError)
      expect(Reflect.set(proxy.nested, 'x', 3)).toBe(false)
      expect(frozen.x).toBe(1)
      // 'warn' 只留一行告警，'silent' 连告警都没有
      expect(warn).toHaveBeenCalledTimes(handler === 'warn' ? 2 : 0)
    } finally {
      warn.mockRestore()
    }
  })
})

describe('R5-115 越界的 productionHandler 早失败', () => {
  it('构造期即抛配置错误，而不是退化成「生产环境静默升级为抛错模式」', () => {
    expect(() => makeManager({ productionHandler: 'loud' as never })).toThrow(/productionHandler must be 'error' \| 'warn' \| 'silent', got loud/)
    expect(() => makeManager({ productionHandler: undefined as never })).toThrow(/productionHandler/)
  })

  it('公共入口 createStore 同样在配置点失败，三个合法取值照常建店', () => {
    expect(() => createStore({ name: 'bad-handler', state: { a: 1 }, stateProtection: { productionHandler: 'throw' } as never })).toThrow(/productionHandler/)
    for (const handler of ['error', 'warn', 'silent'] as const) {
      const store = createStore({ name: `ok-handler-${handler}`, state: { a: 1 }, stateProtection: { productionHandler: handler } })
      try {
        expect(store.getState().a).toBe(1)
      } finally {
        store.destroy()
      }
    }
  })
})

describe('R5-116 子值包装只有一份分流实现', () => {
  it('同一嵌套数组经索引路径与数组自定义属性路径拿到同一个代理、报同一种路径', () => {
    const matrix = [[1, 2]] as number[][]
    const state = { rows: matrix } as Record<string, unknown>
    // 数组上的自定义属性指回同一棵子树：两条访问路径原先由「深代理」和「数组包装」各写一遍
    ;(matrix as unknown as Record<string, unknown>).extra = matrix
    const { manager } = makeManager()
    const proxy = manager.createStateProxy(state as State, '') as any

    const viaIndex = proxy.rows[0]
    const viaCustomProp = proxy.rows.extra[0]

    // 缓存按对象身份建：两份实现各建各的代理时这里会给出两个不同对象
    expect(viaCustomProp).toBe(viaIndex)
    // 都是数组代理：变异方法按数组口径拦截，路径用方括号
    expect(() => viaIndex.push(3)).toThrow(/Direct mutation of state "rows\[0\]"/)
    expect(() => viaCustomProp.push(3)).toThrow(/Direct mutation of state "rows\[0\]"/)
    expect(matrix[0]).toHaveLength(2)
  })

  it('内建对象豁免在两条访问路径上口径一致', () => {
    const date = new Date(0)
    const nested = { d: date }
    const state = { rows: [nested], alias: nested } as Record<string, unknown>
    const { manager } = makeManager()
    const proxy = manager.createStateProxy(state as State, '') as any

    // 一条经数组索引、一条经对象键，原先由两份同构实现分别负责
    expect(proxy.rows[0]).toBe(proxy.alias)
    expect(proxy.rows[0].d).toBe(date)
    expect(proxy.alias.d).toBe(date)
  })
})

describe('R5-117 绑定方法的身份稳定', () => {
  it('类实例方法多次读取同一引用，且仍绑定到原始接收者', () => {
    class Service {
      count = 0
      bump(): number {
        this.count += 1
        return this.count
      }
    }
    const service = new Service()
    const state = { svc: service, plain: { helper() {} } }
    const { manager } = makeManager()
    const proxy = manager.createStateProxy(state as State, '') as any

    // 修复前每次属性读取都 bind 一个新函数：proxy.svc.bump !== proxy.svc.bump
    expect(proxy.svc.bump).toBe(proxy.svc.bump)
    expect(proxy.svc.bump()).toBe(1)
    expect(service.count).toBe(1)
    // 接收者是原始对象（有意的保护豁免），不是代理
    expect(proxy.svc).not.toBe(service)

    // 普通对象的方法不绑定：返回原函数本身，热路径上不产生分配
    expect(proxy.plain.helper).toBe(state.plain.helper)
    expect(proxy.plain.helper).toBe(proxy.plain.helper)
  })

  it('方法被整体替换后重新绑定，不再返回旧实现的绑定', () => {
    class Service {
      tag = 'first'
      read(): string {
        return this.tag
      }
    }
    const service = new Service()
    const state = { svc: service } as unknown as Record<string, unknown>
    const { manager, setInternal } = makeManager()
    const proxy = manager.createStateProxy(state as State, '') as any

    const original = proxy.svc.read
    expect(proxy.svc.read).toBe(original)

    // 内部访问（action 里）把方法整个换掉：只按 (owner,key) 无条件复用缓存时，
    // 代理会一直返回旧实现的绑定，调用方读到的是已被替换掉的函数
    setInternal(true)
    proxy.svc.read = function (this: Service): string {
      return 'replaced'
    }
    setInternal(false)
    expect(service.read()).toBe('replaced')

    const rebound = proxy.svc.read
    expect(rebound).not.toBe(original)
    expect(rebound()).toBe('replaced')
    // 新实现同样引用稳定
    expect(proxy.svc.read).toBe(rebound)
  })
})

describe('R5-118 状态根是数组时同样只有一种数组代理', () => {
  it('深保护模式下根数组走数组代理：变异方法被拦住且路径与嵌套数组同口径', () => {
    const state = [{ v: 1 }] as unknown as State
    const { manager } = makeManager()
    const proxy = manager.createStateProxy(state, '') as unknown as Array<{ v: number }>

    // 修复前根数组交给深代理：push 被当作普通方法绑定到裸数组，直接改穿状态且不给任何提示
    expect(() => proxy.push({ v: 2 })).toThrow(/Direct mutation of state ""/)
    expect(state).toHaveLength(1)
    // 索引路径是方括号口径，与 _wrapChild 的下属数组同格式（修复前是 `0.v`）
    expect(() => {
      proxy[0].v = 9
    }).toThrow(/Direct mutation of state "\[0\]\.v"/)
    expect(state[0]).toEqual({ v: 1 })
  })

  it('浅保护模式不改道：其契约是只保护顶层', () => {
    const state = [{ v: 1 }] as unknown as State
    const { manager } = makeManager({ deep: false })
    const proxy = manager.createStateProxy(state, '') as unknown as Array<{ v: number }>
    const shallow = proxy as unknown as Record<string, unknown>
    expect(() => {
      shallow.v = 1
    }).toThrow(/Direct mutation of state "v"/)
    // 嵌套层不受保护是浅模式的既有语义
    proxy[0].v = 7
    expect(state[0].v).toBe(7)
  })
})

describe('R5-119 内建对象判定与 realm 无关', () => {
  it('跨 realm 的 Map/Set/Date 仍判为内建对象，不被当普通对象代理', () => {
    const foreignMap = runInNewContext('new Map([["k", { v: 1 }]])') as Map<string, { v: number }>
    const foreignSet = runInNewContext('new Set([{ v: 2 }])') as Set<{ v: number }>
    const foreignDate = runInNewContext('new Date(0)') as Date
    // 前提：这些确实是本 realm instanceof 判不出的对象，否则本用例什么都锁不住
    expect(foreignMap instanceof Map).toBe(false)
    expect(foreignSet instanceof Set).toBe(false)
    expect(foreignDate instanceof Date).toBe(false)
    expect(isBuiltinObject(foreignMap)).toBe(true)
    expect(isBuiltinObject(foreignSet)).toBe(true)
    expect(isBuiltinObject(foreignDate)).toBe(true)
    // 同 realm 的普通对象与数组不受影响
    expect(isBuiltinObject({})).toBe(false)
    expect(isBuiltinObject([])).toBe(false)

    const state = { m: foreignMap, s: foreignSet, d: foreignDate } as unknown as Record<string, unknown>
    const { manager } = makeManager()
    const proxy = manager.createStateProxy(state as State, '') as Record<string, any>

    expect(proxy.m).toBe(foreignMap)
    expect(proxy.s).toBe(foreignSet)
    expect(proxy.d).toBe(foreignDate)
    // 修复前它们被当普通对象代理：Map.prototype.set 以代理为 this 会抛
    // 「incompatible receiver」，Date 的取值/写入则整体失效
    expect(() => proxy.m.set('x', { v: 3 })).not.toThrow()
    expect(foreignMap.get('k')).toEqual({ v: 1 })
  })

  it('脏追踪把跨 realm 集合的键值/成员当成普通边收录并继续追踪', () => {
    const foreignMap = runInNewContext('new Map()') as Map<string, unknown>
    const foreignSet = runInNewContext('new Set()') as Set<unknown>
    const inMap = { v: 0 }
    const inSet = { v: 0 }
    foreignMap.set('k', inMap)
    foreignSet.add(inSet)
    const root = { m: foreignMap, s: foreignSet, other: { v: 0 } } as Record<string, unknown>
    const reports: string[][] = []
    const proxy = createDirtyTrackingProxy(root, createDirtyTrackingCache(), (keys) => {
      reports.push([...keys].map(String).sort())
    }) as Record<string, any>

    // 先建立索引（首次上报才惰性建索引，这一笔不是被测判定），并把基线清空
    ;(proxy.other as Record<string, unknown>).v = 1
    reports.length = 0

    // 经代理取出的集合成员再写入：归属要解析到装着它的那个顶层键。
    // 修复前 rebuildOwners 走不到跨 realm 集合的内部槽位（自有属性恒为空），
    // 这两个节点不在索引里，成员对象的读取还会被当成「类实例方法」每次调用都上报
    const fromMap = proxy.m.get('k') as Record<string, unknown>
    const [fromSet] = [...(proxy.s as Set<unknown>)]
    reports.length = 0
    fromMap.v = 2
    expect(reports).toEqual([['m']])
    ;(fromSet as Record<string, unknown>).v = 2
    expect(reports).toEqual([['m'], ['s']])
    expect(inMap.v).toBe(2)
    expect(inSet.v).toBe(2)
  })
})
