/**
 * GeomStore 微信小程序集成示例 - App 集成
 *
 * 演示如何在微信小程序 App 中使用 GeomStore
 */

import { createStore } from '../../src'
import { withAppStore } from '../../src/integrations'

// 创建应用级 Store
const appStore = createStore({
  name: 'app-store',
  state: {
    userInfo: null as { id: number; name: string; role: string } | null,
    appConfig: {
      theme: 'light',
      language: 'zh-CN',
      version: '1.0.0',
    },
    isReady: false,
  },
  actions: {
    async initApp() {
      // 模拟异步初始化
      await new Promise((resolve) => setTimeout(resolve, 100))

      // @ts-ignore
      this.setState('userInfo', { id: 1, name: 'Admin', role: 'admin' })
      // @ts-ignore
      this.setState('isReady', true)

      console.log('App initialized')
    },
    setTheme(theme: string) {
      // @ts-ignore
      const config = { ...this.state.appConfig, theme }
      // @ts-ignore
      this.setState('appConfig', config)
    },
    updateUserInfo(userInfo: { name: string; role: string }) {
      // @ts-ignore
      this.setState('userInfo', { ...this.state.userInfo, ...userInfo })
    },
  },
})

// ==================== App 集成示例 ====================

App(
  withAppStore(appStore, {
    mapState: ['userInfo', 'appConfig', 'isReady'],
    mapActions: ['initApp', 'setTheme', 'updateUserInfo'],
  })({
    globalData: {
      appName: 'My Mini Program',
    },
    onLaunch() {
      console.log('App launched')

      // 初始化应用
      this.initApp().then(() => {
        console.log('User info:', this.globalData.userInfo)
        console.log('App config:', this.globalData.appConfig)
      })
    },
    onShow() {
      console.log('App shown')
    },
    onHide() {
      console.log('App hidden')
    },
    onError(error: Error) {
      console.error('App error:', error)
    },
  })
)

// 使用说明：
// 在其他 Page 或 Component 中可以通过以下方式访问：
// const app = getApp()
// app.getStore()           // 获取 store 实例
// app.getState()           // 获取状态
// app.dispatch('setTheme', 'dark')  // dispatch action
// app.subscribe(callback)   // 订阅状态变化

console.log('✅ App integration example defined')
console.log('Note: These examples are for demonstration. Run in WeChat Mini Program environment.')
