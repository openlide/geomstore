/**
 * 高级示例：插件（内置 + 自定义）
 *
 * 覆盖：loggerPlugin / devtoolsPlugin 直接安装、persistencePlugin 的同步后端与 filter、
 * builtinPlugins 批量安装，以及自定义插件的 install/清理契约。
 *
 * 发布包等价导入：`@openlide/geomstore/extras/plugins`
 */

import { createStore } from '../../src/index.js'
import { builtinPlugins, loggerPlugin, persistencePlugin } from '../../src/extras/plugins.js'

// 先定义状态类型：filter 等回调直接引用它
interface DemoState {
  count: number
  message: string
}

const store = createStore({
  name: 'plugin-demo',
  state: (): DemoState => ({
    count: 0,
    message: '',
  }),
  actions: {
    // action 的 this 由 Store 自动注入，无需手写标注
    increment(): void {
      this.$patch({ count: this.state.count + 1 })
    },
    setMessage(message: string): void {
      this.$patch({ message })
    },
  },
})

// ==================== 内置插件 ====================

// 日志插件：打印 dispatch 的 action 名与实参数组（beforeDispatch）、action 名与返回值
// （afterDispatch）、setState 的键值（before/afterSetState），并另挂一条只读订阅打印整份状态。
// 它不统计耗时——要耗时/慢 action 分析请用 `@openlide/geomstore/extras/performance` 的 analyzerPlugin；
// 且生产环境（isProduction()）下它整体静默，什么都不打
store.use(loggerPlugin)

/**
 * 持久化后端：**必须同步**（异步实现会被显式拒绝，避免写入静默丢失）。
 *
 * - 小程序：`WxStorageBackend`（或自行封装 `wx.getStorageSync`/`wx.setStorageSync`）
 * - 浏览器：可直接传 `localStorage`
 */
const memoryBackend = {
  getItem: (_key: string): string | null => null,
  setItem: (_key: string, _value: string): void => {},
  removeItem: (_key: string): void => {},
}

// 持久化插件：filter 指定落盘的状态子集，debounce 控制写入频率
store.use(
  persistencePlugin<DemoState>({
    key: 'demo-store',
    storage: memoryBackend,
    filter: (state) => ({ count: state.count }),
    debounce: 300,
  }),
)

store.dispatch('increment')
store.dispatch('setMessage', 'Hello from plugin!')
console.log('状态:', store.getState())

// 批量安装：logger → persistence → devtools 顺序注册
const another = createStore({ name: 'plugin-batch', state: () => ({ n: 0 }) })
builtinPlugins.forEach((plugin) => another.use(plugin))

// ==================== 自定义插件 ====================

// 插件契约：name + install(store) → 返回卸载函数
// 泛型化后可标注精确的状态类型（`Plugin<DemoState>`），install 的 store 参数随之精确
const myLoggerPlugin = {
  name: 'my-logger',
  install(target: { subscribe: (fn: (state: DemoState) => void) => () => void }) {
    console.log('\n[MyLogger] 插件已安装')
    const unsubscribe = target.subscribe((state) => console.log('[MyLogger] 状态变化:', state))
    return () => {
      unsubscribe()
      console.log('[MyLogger] 插件已卸载')
    }
  },
}

// 安装方式一：Store 方法（推荐，返回值即卸载函数）
const uninstall = store.use(myLoggerPlugin)
store.dispatch('increment')
uninstall() // 手动卸载：触发订阅清理

// 安装方式二：独立函数 `usePlugin(plugin, store)` 等价；泛型从 store 反推，无需断言
// （插件需与 store 的状态类型匹配；状态无关的插件写作 `Plugin<State>`）

console.log('\n✅ 插件示例完成')
