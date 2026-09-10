/**
 * GeomStore 微信小程序集成示例：Page
 *
 * 覆盖：withPageStore 的数组简写与对象别名映射；页面卸载时订阅自动清理。
 *
 * 注：本仓库内示例从 `src/` 相对导入以便类型检查；发布包中的等价写法为
 * `import { withPageStore } from '@openlide/geomstore'`。
 */

import { createStore } from '../../src/index.js'
import { withPageStore } from '../../src/integrations/index.js'

// 会话状态：先定义类型，state / actions 共用一份（避免 `as` 断言与字面量重复）
interface SessionState {
  userInfo: { name: string; avatar: string } | null
  isLoggedIn: boolean
  theme: string
}

// 全局 Store：跨页面共享的会话状态
const appStore = createStore({
  name: 'session',
  state: (): SessionState => ({
    userInfo: null,
    isLoggedIn: false,
    theme: 'light',
  }),
  actions: {
    // action 的 this 由 Store 自动注入（state / setState / $patch / dispatch 等），无需手写标注
    login(userInfo: { name: string; avatar: string }): void {
      this.$patch({ userInfo, isLoggedIn: true })
    },
    logout(): void {
      this.$patch({ userInfo: null, isLoggedIn: false })
    },
    setTheme(theme: string): void {
      this.$patch({ theme })
    },
  },
})

// 写法一：数组简写（状态键与 action 名同名注入）
Page(
  withPageStore(appStore, {
    mapState: ['userInfo', 'isLoggedIn', 'theme'],
    mapActions: ['login', 'logout', 'setTheme'],
  })({
    data: {
      localData: 'page local data',
    },
    // 页面方法的 this 由集成层注入（入参类型带 ThisType<PageThis<…>>），
    // 因此 this.data 与注入的 action 都有类型，无需手写 this 标注
    onLoad() {
      if (!this.data.isLoggedIn) {
        this.login({ name: 'Ada', avatar: 'avatar.png' })
      }
    },
    onUnload() {
      // 订阅由集成层在 onUnload 自动清理，无需手动退订
      console.log('页面卸载，订阅已自动清理')
    },
  }),
)

// 写法二：对象别名映射（避免与页面本地字段重名）
Page(
  withPageStore(appStore, {
    mapState: { currentUser: 'userInfo', loggedIn: 'isLoggedIn' },
    mapActions: { changeTheme: 'setTheme' },
  })({
    data: {
      pageTitle: 'User Profile',
    },
    onLoad() {
      console.log('登录状态:', this.data.loggedIn)
      this.changeTheme('dark')
    },
  }),
)

console.log('✅ Page 集成示例已定义（需在微信小程序环境中运行）')
