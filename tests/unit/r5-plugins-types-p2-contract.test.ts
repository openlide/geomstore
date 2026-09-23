/**
 * 第五轮 · 分片 plugins-types-p2 的契约回归锁（src/types/{integration,store,performance}.ts）
 *
 * 编译期断言锁「类型给出的形状」，运行期断言锁「类型所依据的那条运行时次序」——
 * 本分片只改类型与注释，运行时一侧的断言是为了：类型注释里的口径一旦和实现分叉，
 * 这里会红，而不是留下一个「看起来对、实际谎报」的公开契约。
 *
 * 覆盖：R5-327（调试 API 的 subscribe options 与 `__store__` 别名）、
 * R5-328（mapState / mapGetters 撞名时 getter 赢）、R5-329（框架事件键不作自定义方法）、
 * R5-330（撞名 action 不再声成可调用的 `globalData`）、R5-326（裸 `StoreConfig` 的 `cacheKeys`）、
 * R5-314（`getMetrics` 交出的是独立副本）。
 *
 * @file tests/unit/r5-plugins-types-p2-contract.test.ts
 */

import { exposeStoreAPI } from '@/integrations/utils.js'
import { PerformanceMonitor } from '@/core/performance/index.js'
import { createStore, withAppStore } from '@/index.js'
import type { AppThis, ComponentThis, ConnectOptions, ExtractPageData, PageOwnMethods } from '@/types/integration.js'
import type { Actions, Getters, State, Store, StoreConfig } from '@/types/store.js'

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

interface St extends State {
  count: number
  name: string
}

interface Ac extends Actions {
  ping: () => void
  globalData: () => string
}

/** getter 与状态键撞名：`count` 返回 string，状态里的 `count` 是 number */
type Gl = { count: (s: St) => string; name: (s: St) => number }

/**
 * 编译期断言集中处：只被类型检查，永不被调用。
 *
 * 写成函数而不是模块顶层语句，有两个真实原因：
 * - `declare const` 会被 ts-jest 的 transpile 擦除，模块顶层一执行就 ReferenceError；
 * - `@ts-expect-error` 那几条要取属性/调用，占位值是 `null`，真跑会 TypeError。
 */
function _typeLocks(): void {
  // ==================== R5-327：调试 API 的运行时形状 ====================
  const appApi = null as unknown as AppThis<St, Ac, Getters<St>, ConnectOptions<St, Ac, Getters<St>>>
  // `exposeStoreAPI` 的实现是 `subscribe(cb, options ?? { readOnly: true })`，其注释明确要求
  // 「确需就地改载荷的调用方显式传 { readOnly: false }」——此前签名少了这个可选位点，
  // 那句指示根本写不出来（TS2554），类型与它声称镜像的运行时契约互相矛盾。
  const writable: () => void = appApi.subscribe(() => {}, { readOnly: false })
  void writable
  // `__store__` 与展平成员同源（同一个 api 对象），类型此前完全没声明它
  const viaAlias: St = appApi.__store__.getState()
  const viaFlat: St = appApi.getState()
  void [viaAlias, viaFlat]
  // @ts-expect-error `__store__` 别名里没有 `store` 自身（运行时 api 只含五个方法）
  appApi.__store__.store
  // `store` / `__store__` 同在「撞名让位」清单里：exposeStoreAPI 对这两个键同样无条件覆写，
  // 于是把 action 命名为 `__store__` 时，实例上留下来的是别名对象而不是那个 action
  interface ClashActions extends Actions {
    __store__: () => string
  }
  const clash = null as unknown as AppThis<St, ClashActions, Getters<St>, { mapActions: ['__store__'] }>
  // @ts-expect-error 留在实例上的是调试 API 别名（不可调用）
  clash.__store__()

  // ==================== R5-328：撞名键按运行时次序归 getter ====================
  type Collide = ExtractPageData<St, { mapState: ['count']; mapGetters: ['count'] }, Gl>
  const collideIsGetterResult: Equal<Collide['count'], string> = true
  void collideIsGetterResult

  // getter 名恰好是状态键、但没写进 mapState 时同样让位（`Partial<S>` 那份 `T | undefined` 也要剔）
  type PartialCollide = ExtractPageData<St, { mapGetters: ['name'] }, Gl>
  const partialCollideIsGetterResult: Equal<PartialCollide['name'], number> = true
  void partialCollideIsGetterResult

  // 不撞名时两侧各自保持精确（收紧过度会把 state 侧一起抹掉）
  type NoCollide = ExtractPageData<St, { mapState: ['count']; mapGetters: ['name'] }, Gl>
  const stateSide: Equal<NoCollide['count'], number> = true
  const getterSide: Equal<NoCollide['name'], number> = true
  void [stateSide, getterSide]

  // 组件侧共用同一个 data 口径（InjectedDataShape → ExtractPageData）
  type CpData = ComponentThis<St, Ac, Gl, { mapState: ['count']; mapGetters: ['count'] }>['data']
  const componentSideSame: Equal<CpData['count'], string> = true
  void componentSideSame

  // ==================== R5-329：页面框架事件键不入自定义方法 ====================
  type PageCfgShape = { customMethod: (n: number) => string; onRouteDone: () => void }
  const onlyUserMethod: Equal<keyof PageOwnMethods<PageCfgShape>, 'customMethod'> = true
  void onlyUserMethod

  // ==================== R5-330：`globalData` 是保留本地名 ====================
  const appThis = null as unknown as AppThis<St, Ac, Getters<St>, { mapActions: ['ping', 'globalData'] }>
  // 数据形状仍在（`onLaunch` 先把映射写进 this.globalData）
  const globalDataCount: number | undefined = appThis.globalData.count
  void globalDataCount
  // 运行时 `bindActions` 的 defineProperty 会把那份数据整个顶掉，故类型不再承认它是可调用的
  // @ts-expect-error 撞名 action 让位给 globalData 数据形状，`this.globalData()` 不再通过编译
  appThis.globalData()
  // 未撞名的 action 保持精确签名
  const pingSide: void = appThis.ping()
  void pingSide

  // ==================== R5-326：裸 StoreConfig（不写类型实参） ====================
  const bareConfig: StoreConfig = { state: { count: 1 }, cacheKeys: ['count'] }
  void bareConfig
  const bareSatisfies = { state: { count: 1 }, cacheKeys: ['count'] } satisfies StoreConfig
  void bareSatisfies
  // 工厂写法不受影响：`state: () => S` 仍归一到 S 的键集
  const factoryConfig: StoreConfig<() => St> = { state: () => ({ count: 1, name: 'x' }), cacheKeys: ['count'] }
  void factoryConfig
  // 具名状态类型下仍是键集精确，不是「退化成任意字符串」
  // @ts-expect-error 'nope' 不是 St 的键
  const strictKeys: StoreConfig<St> = { state: { count: 1, name: 'x' }, cacheKeys: ['nope'] }
  void strictKeys
}

void _typeLocks

describe('R5-327 exposeStoreAPI 的订阅选项与 __store__ 别名', () => {
  it('原样透传 subscribe 的第二个实参，未传时按只读登记', () => {
    const unsubscribe = jest.fn()
    const store = { subscribe: jest.fn(() => unsubscribe) } as unknown as Store<St>
    const target: Record<string, unknown> = {}
    const unbind = exposeStoreAPI(target, store)
    const cb = () => {}
    const subscribe = target.subscribe as (c: () => void, o?: { readOnly?: boolean }) => () => void

    subscribe(cb)
    subscribe(cb, { readOnly: false })

    expect(store.subscribe).toHaveBeenNthCalledWith(1, cb, { readOnly: true })
    expect(store.subscribe).toHaveBeenNthCalledWith(2, cb, { readOnly: false })
    // 别名与展平成员是同一个函数对象（api 只定义一次），不是一新一旧两份实现
    expect((target.__store__ as Record<string, unknown>).subscribe).toBe(target.subscribe)
    expect(Object.keys(target.__store__ as Record<string, unknown>).sort()).toStrictEqual(['dispatch', 'getCached', 'getState', 'getStore', 'subscribe'])
    unbind()
    expect(target.__store__).toBeUndefined()
  })
})

describe('R5-328 / R5-330 App 集成的运行时次序', () => {
  it('同一本地键被 mapState 与 mapGetters 映射时留下 getter 的值', () => {
    const store = createStore({
      state: { count: 0, name: 'n' },
      getters: {
        count: (s: { count: number }) => `#${s.count}`,
        name: (s: { name: string }) => s.name.length,
      },
    })
    const config = withAppStore(store, { mapState: ['count'], mapGetters: ['count'] })({ globalData: {}, onLaunch() {} })
    ;(config as unknown as { onLaunch?: () => void }).onLaunch?.()

    const globalData = (config as unknown as { globalData: Record<string, unknown> }).globalData
    expect(globalData.count).toBe('#0')
  })

  it('名为 globalData 的 action 会顶掉注入的数据对象（类型让位的依据）', () => {
    const store = createStore({
      state: { count: 0 },
      actions: {
        globalData() {
          return 'clobbered'
        },
      },
    })
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const config = withAppStore(store, { mapState: ['count'], mapActions: ['globalData'] })({ globalData: {}, onLaunch() {} })
    ;(config as unknown as { onLaunch?: () => void }).onLaunch?.()

    // globalData 成了 action 本体：映射进来的 count 不复存在
    expect(typeof (config as unknown as { globalData: unknown }).globalData).toBe('function')
    expect((config as unknown as { globalData: () => string }).globalData()).toBe('clobbered')
    // 覆盖时留痕，不是静默改名
    expect(warn.mock.calls.some((args) => String(args[0]).includes('globalData'))).toBe(true)
    warn.mockRestore()
  })
})

describe('R5-314 PerformanceMonitor.getMetrics 的副本契约', () => {
  it('数组元素也是副本，改写返回对象不会写脏内部数据', () => {
    const monitor = new PerformanceMonitor()
    monitor.record({ operation: 'setState:count', type: 'setState', duration: 5, timestamp: 1000 })

    const first = monitor.getMetrics()
    first[0].duration = 999
    first[0].operation = 'mutated'

    expect(monitor.getMetrics()[0]).toMatchObject({ operation: 'setState:count', duration: 5 })
    expect(monitor.getStats().byOperation['setState:count'].avgDuration).toBe(5)
    monitor.clear()
  })

  it('内置插桩只产出五个标签，未产出的标签查询恒为空（类型不收窄的理由）', () => {
    const monitor = new PerformanceMonitor()
    monitor.record({ operation: 'x', type: 'state-update', duration: 1, timestamp: 1 })

    expect(monitor.getMetricsByType('state-update')).toHaveLength(1)
    expect(monitor.getMetricsByType('notify')).toHaveLength(0)
    monitor.clear()
  })
})
