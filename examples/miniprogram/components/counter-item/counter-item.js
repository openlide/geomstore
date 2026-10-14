/**
 * counter-item：组件集成的最小样例
 *
 * 生命周期**必须写在 `lifetimes` 里**（基础库 3.15.0+ 的写法）：写在配置顶层的
 * `attached` / `detached` 不会被调用，也就不会退订——这是最常见的订阅泄漏来源。
 */

const { withComponentStore } = require('@openlide/geomstore/integrations')
const app = getApp()

Component(
  withComponentStore({
    store: app.globalData.store,
    mapState: ['count'],
    mapActions: ['increment'],
  })({
    properties: {
      seq: Number,
      name: String,
    },
    // 注意：这里不能放 attached/detached，必须放进 lifetimes
    data: {
      local: 0,
    },
    lifetimes: {
      attached() {
        this.setData({ local: this.data.count })
      },
      detached() {
        // withComponentStore 已在此生命周期自动退订，这里只做业务自己的清理
        this.setData({ local: 0 })
      },
    },
    methods: {
      onTapLocal() {
        this.setData({ local: this.data.local + 1 })
      },
      onTapShared() {
        this.increment()
      },
    },
  }),
)
