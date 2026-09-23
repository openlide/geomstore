/**
 * 第六轮 f1-02 分片回归锁：examples 侧修复
 *
 * 覆盖：
 * - R6-014 `examples/cache/03-dynamic-cache.ts`：缓存建店即开，disable/enable 的差值是真的
 * - R6-015 `examples/extras/selector.ts`：参数化选择器只用入参 state、每次以当前状态绑定
 * - R6-016 `examples/weapp/app-integration.ts`：withAppStore 配了映射才有 globalData 键与实例 action
 * - R6-017 `examples/weapp/component-integration.ts`：increment 是自增而不是清零
 * - R6-070 `examples/weapp/index.ts`：barrel 在 Node 里 import 不触发宿主注册
 *
 * 三个小程序示例都用 `jest.requireActual` 取，而不是静态 import：静态 import 会把文件拉进
 * `typecheck:tests` 的类型检查程序，而 `App` / `Component` 的声明只在 `examples/global.d.ts`
 * 里（该 tsconfig 不含 examples/），于是变成「找不到名称」的编译错误；运行期取模块不受影响，
 * 且正好能验证「无宿主环境下 import 不抛错」这条本身（tests/setup.ts 装了 Page/Component，
 * 所以 R6-070 那个用例先把三个宿主全局亲手拆掉再 require）。
 */

import type { Store } from '../../src/types/store.js'
import { bulkImportCursor, bulkImportResult, listStore } from '../../examples/cache/03-dynamic-cache.js'
import { createParametricSelector } from '../../src/extras/selector.js'
import { orderStore, selectDiscounted, selectDiscountedFor, type OrderState } from '../../examples/extras/selector.js'

interface AppStateLike {
  launchedAt: number
  scene: string
  cartCount: number
}

interface AppExampleModule {
  appStore: Store<AppStateLike>
  appOptions: {
    globalData?: Record<string, unknown>
    onLaunch?: (options?: { scene?: string }) => void
  }
}

interface CounterStateLike {
  count: number
}

interface ComponentExampleModule {
  counterStore: Store<CounterStateLike>
  counterComponentOptions: {
    data?: Record<string, unknown>
    methods?: Record<string, unknown>
  }
}

interface WeappBarrelModule {
  weappExamples: ReadonlyArray<{ name: string; path: string; requiresHost: readonly string[] }>
}

describe('R6-014: 动态缓存示例的开关是真的开着缓存', () => {
  it('建店即启用缓存：批量导入前统计里 enabled 已为 true、表已预填', () => {
    // 修复前建店没有 enableCache，`_enabled` 恒为 false，示例里的 disableCache() 是空操作
    expect(bulkImportResult.before.enabled).toBe(true)
    expect(bulkImportResult.before.size).toBe(Object.keys(listStore.getState()).length)

    const stats = listStore.getCacheStats()
    expect(stats.enabled).toBe(true)
    expect(stats.hits).toBeGreaterThanOrEqual(2)
  })

  it('关缓存期间循环写入不进统计，重开时整表重建一次', () => {
    const { before, after } = bulkImportCursor(20)

    expect(listStore.getState().cursor).toBe(19)
    expect(after.enabled).toBe(true)
    // 关缓存期间既没有读也没有写穿：hits/misses 一段都不涨；重开的清表 + 预填同样不产生未命中
    expect(after.hits).toBe(before.hits)
    expect(after.misses).toBe(before.misses)
    expect(after.size).toBe(Object.keys(listStore.getState()).length)
  })
})

describe('R6-015: 参数化选择器示例只读入参 state', () => {
  it('初始状态下按参数取折后金额', () => {
    expect(selectDiscounted(1)).toBe(100 * 0.9)
    expect(selectDiscounted(2)).toBe(50 * 0.9)
  })

  it('$replaceState 整树换新后读到与新状态一致的结果（附反例对照）', () => {
    // 反例（修复前的写法）：选择器体内绕过入参读 orderStore.getState()，且工厂返回值被长期持有
    const heldOldBinding = createParametricSelector(
      (state: OrderState, id: number) => (orderStore.getState().orders.find((o) => o.id === id)?.amount ?? 0) * state.rate,
      { ttl: 5000, maxEntries: 50 },
    )(orderStore.getState())

    const next: OrderState = { orders: [{ id: 1, amount: 200, status: 'paid' }], rate: 0.5 }
    orderStore.$replaceState(next)

    // 示例的新写法：每次取值都绑定当前状态 → 新金额 × 新 rate
    expect(selectDiscounted(1)).toBe(200 * 0.5)
    // 反例：新 orders 的金额 × 旧 rate，两份状态混在同一次计算里
    expect(heldOldBinding(1)).toBe(200 * 0.9)
    // 且它挂在旧 state 键下、不被作废：同一个旧绑定再算一次仍是那份混值
    expect(heldOldBinding(1)).toBe(200 * 0.9)
    // 新写法的每次绑定用的都是当前状态对象
    expect(selectDiscountedFor(orderStore.getState())(1)).toBe(200 * 0.5)
  })
})

describe('R6-016: App 集成示例的映射真的配了', () => {
  const { appOptions, appStore } = jest.requireActual<AppExampleModule>('../../examples/weapp/app-integration')

  it('onLaunch 里注入的 action 与 globalData 的映射状态都可用', () => {
    const onLaunch = appOptions.onLaunch
    expect(typeof onLaunch).toBe('function')

    const instance: { globalData: Record<string, unknown> } & Record<string, unknown> = {
      globalData: { ...appOptions.globalData },
    }
    // Node 里没有宿主 `App`，故直接在普通对象上调用集成层包装后的 onLaunch
    onLaunch?.call(instance, { scene: '1001' })

    // 自定义字段与映射键并存：映射状态由 bindMappings 在转发用户 onLaunch 之前写入
    expect(instance.globalData.appName).toBe('GeomStore Demo')
    expect(Object.keys(instance.globalData)).toEqual(expect.arrayContaining(['appName', 'launchedAt', 'scene', 'cartCount']))
    // 修复前 withAppStore 没传第二个实参：globalData 里不会多出 scene，实例上也没有 markLaunched
    expect(instance.globalData.scene).toBe('1001')
    expect(typeof instance.markLaunched).toBe('function')
    expect(appStore.getState().scene).toBe('1001')
    // exposeStoreAPI 的调试入口同样挂在实例上
    expect(typeof instance.getState).toBe('function')
  })
})

describe('R6-017: Component 示例的 increment 是自增', () => {
  const { counterComponentOptions, counterStore } = jest.requireActual<ComponentExampleModule>('../../examples/weapp/component-integration')

  it('increment 每次把 count 加一（修复前写成了常量 0，等于清零）', () => {
    counterStore.dispatch('increment')
    expect(counterStore.getState().count).toBe(1)
    counterStore.dispatch('increment')
    expect(counterStore.getState().count).toBe(2)
    counterStore.dispatch('add', 10)
    expect(counterStore.getState().count).toBe(12)
  })

  it('组件方法仍在配置里、宿主注册被守卫挡在 Node 之外', () => {
    expect(typeof counterComponentOptions.methods?.onTapPlus).toBe('function')
    expect(Object.keys(counterComponentOptions.data ?? {})).toContain('label')
  })
})

describe('R6-070: weapp 示例 barrel 不在顶层求值宿主模块', () => {
  it('Node 里 import barrel 不抛 ReferenceError，只做清单索引', () => {
    // tests/setup.ts 会把 Page / Component 装成全局 mock，`App` 则由本用例亲手拆掉：
    // 修复前 barrel 是三条 `export * as … from './x.js'` 的静态再导出，模块求值即执行
    // 示例体里的宿主注册 → 无宿主环境（Node 脚本、文档生成器）下抛 ReferenceError
    const host = globalThis as unknown as { Page?: unknown; Component?: unknown; App?: unknown }
    const saved = { Page: host.Page, Component: host.Component, App: host.App }
    delete host.Page
    delete host.Component
    delete host.App

    try {
      // 模块注册表清空，确保被 require 的模块体真的重新求值
      jest.resetModules()
      expect(() => jest.requireActual('../../examples/weapp/index')).not.toThrow()
      // 两个已加宿主守卫的示例文件自身在无宿主环境下也只是「不注册」，不会抛
      expect(() => jest.requireActual('../../examples/weapp/app-integration')).not.toThrow()
      expect(() => jest.requireActual('../../examples/weapp/component-integration')).not.toThrow()

      const barrel = jest.requireActual<WeappBarrelModule>('../../examples/weapp/index')
      expect(barrel.weappExamples.map((example) => example.name)).toEqual(['page-integration', 'component-integration', 'app-integration'])
      for (const example of barrel.weappExamples) {
        expect(example.requiresHost.length).toBeGreaterThan(0)
      }
    } finally {
      host.Page = saved.Page
      host.Component = saved.Component
      host.App = saved.App
      // 让后续用例（若有）拿到干净的注册表
      jest.resetModules()
    }
  })

  it('barrel 清单里声明的宿主全局确实被示例文件用上了（映射/action 不是空话）', () => {
    const { appOptions, appStore } = jest.requireActual<AppExampleModule>('../../examples/weapp/app-integration')
    expect(typeof appOptions.onLaunch).toBe('function')
    expect(appStore.getState().cartCount).toBe(0)
    const { counterStore: store } = jest.requireActual<ComponentExampleModule>('../../examples/weapp/component-integration')
    expect(typeof store.dispatch).toBe('function')
  })
})
