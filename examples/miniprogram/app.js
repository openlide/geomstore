/**
 * 小程序 Demo 的 App 入口
 *
 * 本文件承担三件库本身不管、但**上线必做**的事，每一条都对应生产可行性评估里的一个结论项：
 *
 * 1. 【P0】把宿主宣告的运行环境转成库认得的信号
 *    GeomStore 判定生产的顺序是 `process.env.NODE_ENV` → `__DEV__` → `wx.getAccountInfoSync()`
 *    → 兜底开发模式。原生小程序里前两个都不存在，0.9.0 之前的版本会在**正式版里一直按开发
 *    模式运行**——非法直写抛错、`productionHandler` 不生效、生产日志不静默。
 *    新版库自己会读 `getAccountInfoSync`，本文件的赋值用于向后兼容旧版本（以及对 github
 *    上的 fork 生效），保持写的正是同一个语义：非 develop 即生产。
 *
 * 2. 【P1】给 `onError` 挂上报处理器
 *    生产模式控制台是静默的，持久化降级/写失败、恢复被跳过、监听器抛错、订阅者被驱逐都
 *    只从这条钩子出来。不挂 = 线上这些问题零可见性。
 *
 * 3. 【P1】把 Store 挂到 globalData + 让页面共享同一个实例
 */

const { createStore } = require('@openlide/geomstore')
const { persistencePlugin } = require('@openlide/geomstore/extras/plugins')
const { withAppStore } = require('@openlide/geomstore/integrations')

// ---------- 1. 环境信号（必须早于第一次 createStore） ----------
;(function bridgeEnvironment() {
  const env = (() => {
    try {
      return wx.getAccountInfoSync().miniProgram.envVersion
    } catch (e) {
      return 'develop'
    }
  })()
  // 只在没有任何现有信号时写入，避免覆盖宿主/构建期的显式配置
  if (typeof __DEV__ === 'undefined' && globalThis.__DEV__ === undefined) {
    globalThis.__DEV__ = env !== 'develop'
  }
  // 环境届提供给 e2e / 页面展示，不参与任何库判定
  globalThis.__GEOM_ENV__ = env
})()

// ---------- 2. Store ----------
const appStore = createStore({
  name: 'demo-app',
  state: {
    count: 0,
    theme: 'light',
    visits: 0,
  },
  getters: {
    doubled: (s) => s.count * 2,
    // 反例警示：不要这样写 getter——每次返回新对象会让 mapGetters 的脏检查失效，
    // 每次通知都整包 setData（已知限制 #345）。稳定引用的写法见下面 summary
    // summary: (s) => ({ count: s.count, doubled: s.count * 2 }),
  },
  actions: {
    increment() {
      this.setState('count', this.state.count + 1)
    },
    incrementBy(step) {
      this.setState('count', this.state.count + step)
    },
    toggleTheme() {
      this.setState('theme', this.state.theme === 'light' ? 'dark' : 'light')
    },
    reset() {
      this.setState('count', 0)
    },
  },
})

// ---------- 3. 持久化（显式配置，不用默认值） ----------
// debounce 默认是 0：一次 setState = 一次 JSON.stringify(整棵树) + 一次同步 wx.setStorageSync（阻塞 I/O）。
// 生产必须显式配（本 demo 取 100ms）；要求「写即落盘」的场景改回 0。
appStore.use(
  persistencePlugin({
    key: 'geomstore_demo_app',
    debounce: 100,
    // 只落盘必要字段：减少序列化体积，也避免把临时 UI 状态写进磁盘
    filter: (s) => ({ count: s.count, theme: s.theme }),
  }),
)

// ---------- 4. 错误上报（生产唯一的信号出口） ----------
const errorLog = []
appStore.hooks.on('onError', (error, source) => {
  errorLog.push({ source, message: error && error.message ? error.message : String(error), at: Date.now() })
  // 真实项目换成 wx.reportMonitor / wx.reportEvent / 自有 APM
  // wx.reportMonitor('geomstore_error', 1)
})
globalThis.__GEOM_ERRORS__ = errorLog

App(
  withAppStore({
    store: appStore,
    mapState: ['count', 'theme'],
    mapGetters: { doubledText: 'doubled' },
    mapActions: ['increment', 'toggleTheme'],
  })({
    globalData: {
      store: appStore,
      env: globalThis.__GEOM_ENV__,
    },
    onLaunch() {
      // 冷启动即 +1 visits：用于 e2e 区分「冷启动计数」与「持久化恢复计数」
      appStore.setState('visits', appStore.state.visits + 1)
    },
    onShow() {
      appStore.setState('visits', appStore.state.visits + 1)
    },
  }),
)
