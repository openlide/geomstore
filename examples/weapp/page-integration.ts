/**
 * GeomStore 微信小程序集成示例 - Page 集成
 *
 * 演示如何在微信小程序 Page 中使用 GeomStore
 */

import { createStore } from '../../src'
import { withPageStore } from '../../src/integrations'

// 创建全局 Store
const appStore = createStore({
  name: 'app-store',
  state: {
    userInfo: null as { name: string; avatar: string } | null,
    isLoggedIn: false,
    theme: 'light',
  },
  actions: {
    login(userInfo: { name: string; avatar: string }) {
      // @ts-ignore
      this.setState('userInfo', userInfo)
      // @ts-ignore
      this.setState('isLoggedIn', true)
    },
    logout() {
      // @ts-ignore
      this.setState('userInfo', null)
      // @ts-ignore
      this.setState('isLoggedIn', false)
    },
    setTheme(theme: string) {
      // @ts-ignore
      this.setState('theme', theme)
    },
  },
})

// ==================== Page 集成示例 ====================

// 简写形式：数组映射
Page(
  withPageStore(appStore, {
    mapState: ['userInfo', 'isLoggedIn', 'theme'],
    mapActions: ['login', 'logout', 'setTheme'],
  })({
    data: {
      localData: 'page local data',
    },
    onLoad() {
      console.log('Page loaded')
      console.log('User info:', this.data.userInfo)
      console.log('Is logged in:', this.data.isLoggedIn)

      // 调用 action
      if (!this.data.isLoggedIn) {
        this.login({ name: 'Test User', avatar: 'avatar.png' })
      }
    },
    onUnload() {
      console.log('Page unloaded, subscriptions cleaned up automatically')
    },
    onReady() {
      console.log('Page ready')
    },
  })
)

// 高级用法：对象形式（别名映射）
Page(
  withPageStore(appStore, {
    mapState: {
      currentUser: 'userInfo',
      loggedIn: 'isLoggedIn',
      currentTheme: 'theme',
    },
    mapActions: {
      doLogin: 'login',
      doLogout: 'logout',
      changeTheme: 'setTheme',
    },
  })({
    data: {
      pageTitle: 'User Profile',
    },
    onLoad() {
      // 通过别名访问
      console.log('Current user:', this.data.currentUser)
      console.log('Logged in:', this.data.loggedIn)

      // 通过别名调用 action
      this.changeTheme('dark')
    },
  })
)

console.log('✅ Page integration examples defined')
console.log('Note: These examples are for demonstration. Run in WeChat Mini Program environment.')
