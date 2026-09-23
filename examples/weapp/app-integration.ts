/**
 * GeomStore 微信小程序集成示例：App
 *
 * 覆盖：withAppStore 包装 App 配置——启动时初始化状态、映射状态挂到 globalData、
 * 映射 action 绑到 App 实例、前后台生命周期与错误回调。
 *
 * 更完整的账号隔离/离线队列/热更新场景见 `@openlide/geomstore/extras/enterprise`。
 */

import { createStore } from '../../src/index.js'
import { withAppStore } from '../../src/integrations/index.js'

// 先定义状态类型：空串等初始值不再需要 `as` 断言
interface AppState {
  launchedAt: number
  scene: string
  cartCount: number
}

export const appStore = createStore({
  name: 'app',
  state: (): AppState => ({
    launchedAt: 0,
    scene: '',
    cartCount: 0,
  }),
  actions: {
    // action 的 this 由 Store 自动注入，无需手写标注
    markLaunched(scene: string): void {
      this.$patch({ launchedAt: Date.now(), scene })
    },
  },
})

/**
 * App 配置
 *
 * 导出给测试与非小程序环境复用；宿主注册见文件末尾的守卫。
 *
 * 映射必须显式配：withAppStore 只在 `options.mapState` / `mapGetters` / `mapActions`
 * 存在时才绑定，什么都不传的话 globalData 里不会多出任何 store 键、实例上也不会有
 * `markLaunched`（只剩 exposeStoreAPI 那套调试 API）。
 */
export const appOptions = withAppStore(appStore, {
  mapState: ['launchedAt', 'scene', 'cartCount'],
  mapActions: ['markLaunched'],
})({
  globalData: {
    appName: 'GeomStore Demo',
  },
  // this 由集成层注入：globalData 上是 mapState 的映射状态（与自定义的 appName 并存），
  // 实例上是 mapActions 绑好的 markLaunched，无需手写标注
  onLaunch(options?: { scene?: string }) {
    // 启动时把启动场景写回 Store：走实例上注入的 action，而不是绕过去直接 dispatch
    this.markLaunched(String(options?.scene ?? ''))
    // 映射键由 store 订阅同步刷新，故 dispatch 之后读到的就是新值
    console.log('App launched:', this.globalData.appName, this.globalData.scene)
  },
  onShow() {
    console.log('App 进入前台')
  },
  onHide() {
    console.log('App 进入后台')
  },
  onError(error: unknown) {
    // 全局错误回调：可在此接入错误上报
    console.error('App error:', error)
  },
})

// 宿主守卫：`App` 只存在于微信小程序运行时，仓库里 examples/global.d.ts 的那条
// `declare function App` 是纯编译期声明、不产出任何运行时代码。写在模块顶层裸调用，
// 会让本文件在 Node（脚本、jest、文档生成器）里一被 import 就抛
// `ReferenceError: App is not defined`，而不是「只是不执行」
if (typeof App === 'function') {
  App(appOptions)
}

console.log('✅ App 集成示例已定义（需在微信小程序环境中运行）')

