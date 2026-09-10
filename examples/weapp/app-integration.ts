/**
 * GeomStore 微信小程序集成示例：App
 *
 * 覆盖：withAppStore 包装 App 配置——启动时初始化状态、全局数据挂载、
 * 前后台生命周期与错误回调。
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

const appStore = createStore({
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

App(
  withAppStore(appStore)({
    globalData: {
      appName: 'GeomStore Demo',
    },
    // this 由集成层注入（含 globalData 的映射状态与 mapActions 的 markLaunched），无需手写标注
    onLaunch(options?: { scene?: string }) {
      // 启动时把启动场景写回 Store
      appStore.dispatch('markLaunched', String(options?.scene ?? ''))
      console.log('App launched:', this.globalData.appName, appStore.getState().scene)
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
  }),
)

console.log('✅ App 集成示例已定义（需在微信小程序环境中运行）')
