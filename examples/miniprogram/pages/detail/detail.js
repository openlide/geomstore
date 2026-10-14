/**
 * 二级页：验证「页面栈 ≥2 层时，同一份 Store 的映射仍然更新」
 *
 * 订阅上限（默认 50，_evict-oldest_）被耗尽时的症状就是「某些页面不刷新」，
 * 所以每一层页面都必须能证明自己还在收到通知。e2e 会连开两层再返回，检查计数同步。
 */

const { withPageStore } = require('@openlide/geomstore/integrations')
const app = getApp()

Page(
  withPageStore({
    store: app.globalData.store,
    mapState: ['count', 'theme'],
    mapActions: ['increment'],
  })({
    data: {
      depth: 0,
      // 本地累加：与 store.count 同比增长才能证明本页订阅存活未被驱逐
      localTicks: 0,
    },
    onLoad() {
      this.setData({ depth: getCurrentPages().length })
    },
    onTapOpenAnother() {
      wx.navigateTo({ url: '/pages/detail/detail' })
    },
    onTapIncrement() {
      this.increment()
      this.setData({ localTicks: this.data.localTicks + 1 })
    },
  }),
)
