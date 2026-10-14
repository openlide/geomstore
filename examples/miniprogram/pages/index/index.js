/**
 * 首页：验证「页面集成 + 状态映射 + 持久化 + 页面栈」
 *
 * 关注点：
 * - `mapState` / `mapGetters` / `mapActions` 三类映射合并到**一条只读订阅**（省订阅额度、
 *   也避免一帧多次 setData，并让通知走零拷贝路径）；
 * - `onUnload` 自动退订由 withPageStore 处理；
 * - count 由持久化插件写盘，增量有 100ms 防抖（见 README 的 e2e 断言策略）。
 */

const { withPageStore } = require('@openlide/geomstore/integrations')
const app = getApp()

function pageCountRefresh() {
  // 页面栈层数刷新：e2e 用它验证多级 navigateTo 后 mapState 仍在更新（订阅未被驱逐）
  this.setData({ stackDepth: getCurrentPages().length })
}

Page(
  withPageStore(app.globalData.store, {
    mapState: { count: 'count', theme: 'theme', visits: 'visits' },
    mapGetters: { doubled: 'doubled' },
    mapActions: ['increment', 'incrementBy', 'toggleTheme', 'reset'],
  })({
    data: {
      stackDepth: 1,
      env: '',
      persisted: '',
    },
    onLoad() {
      this.setData({ env: app.globalData.env })
      pageCountRefresh.call(this)
    },
    onShow() {
      pageCountRefresh.call(this)
      this.refreshPersisted()
    },
    // 读取磁盘上的实际内容，供 e2e 断言落盘结果（正常业务逻辑不需要这样做）
    refreshPersisted() {
      let raw = null
      try {
        raw = wx.getStorageSync('geomstore_demo_app')
      } catch (e) {
        raw = null
      }
      this.setData({ persisted: raw || '' })
    },
    onTapIncrement() {
      this.increment()
      // 防抖窗口内读到的仍是旧值，下一轮 microtask/宏任务后才会落盘
      setTimeout(() => this.refreshPersisted(), 200)
    },
    onTapIncrementTen() {
      this.incrementBy(10)
      setTimeout(() => this.refreshPersisted(), 200)
    },
    onTapToggleTheme() {
      this.toggleTheme()
      setTimeout(() => this.refreshPersisted(), 200)
    },
    onTapReset() {
      this.reset()
      setTimeout(() => this.refreshPersisted(), 200)
    },
    onTapGoDetail() {
      wx.navigateTo({ url: '/pages/detail/detail' })
    },
    onTapGoList() {
      wx.navigateTo({ url: '/pages/list/list' })
    },
  }),
)
