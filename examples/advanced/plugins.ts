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
 *
 * 本例给一个真会读写的内存后端：Map 兜住落盘数据，让 filter/debounce/restore
 * 行为可观察（此前 `getItem: () => null` + `setItem: () => {}` 的静默 no-op
 * 会让读者以为持久化「跑通了」，实际什么都没存下）
 */
const backendStore = new Map<string, string>()
const memoryBackend = {
  getItem: (key: string): string | null => backendStore.get(key) ?? null,
  setItem: (key: string, value: string): void => {
    backendStore.set(key, value)
  },
  removeItem: (key: string): void => {
    backendStore.delete(key)
  },
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

// 批量安装：logger → persistence → devtools 顺序注册。
// 逐个捕获 uninstaller，示例收工前统一调用作废；否则 devtoolsPlugin 注册的
// globalThis.__GEOMSTORE_STORES__ / __GEOMSTORE_DEVTOOLS__、logger/persistence 的订阅
// 与钩子都会留驻进程；persistence 缺省 storage 无 wx 会静默降级为 in-memory，
// 这里显式传后端保证行为可观察
const another = createStore({ name: 'plugin-batch', state: () => ({ n: 0 }) })
const batchUninstallers = builtinPlugins.map((plugin) => another.use(plugin))

// ==================== 自定义插件 ====================

// 插件契约：name + install(store) → 返回卸载函数
// 泛型化后可标注精确的状态类型（`Plugin<DemoState>`），install 的 store 参数随之精确
const myLoggerPlugin = {
  name: 'my-logger',
  install(target: { subscribe: (fn: (state: DemoState) => void, options?: { readOnly?: boolean }) => () => void }) {
    console.log('\n[MyLogger] 插件已安装')
    // 只读订阅：只要日志、不写回 state。传 readOnly 让 Store 跳过对整棵状态树的
    // 深克隆（否则每条变更多付一次克隆，与内置 loggerPlugin 同口径）
    const unsubscribe = target.subscribe((state) => console.log('[MyLogger] 状态变化:', state), { readOnly: true })
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

// 安装方式二：`store.use(plugin)` 与 `usePlugin(plugin, store)` 等价。
// 后者作为独立函数入口存在于 src/plugins 内部（`usePlugin` 未从 `extras/plugins`
// barrel 再导出），消费者按方式一写即可；如需函数式，从主入口 `@openlide/geomstore`
// 引入 `usePlugin` 后写作 `usePlugin(plugin, store)`
batchUninstallers.forEach((dispose) => dispose())
another.destroy()

console.log('\n✅ 插件示例完成')
