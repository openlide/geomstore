/**
 * 列表页：订阅容量与退订的验证场
 *
 * 每个 <counter-item /> 组件用 withComponentStore 订阅同一个 Store（一条只读订阅/实例）。
 * 默认上限是 50 条注册，超过后按 evict-oldest 静默驱逐最早的实例——症状是「最早那几个
 * 组件不再刷新」。本页默认渲染 20 个（安全区），e2e 里可把它调到 60 复现驱逐，
 * 用来确认「onError('subscribe')」确实能在生产被观测到。
 */

const { withPageStore } = require('@openlide/geomstore/integrations')
const app = getApp()

Page(
  withPageStore(app.globalData.store, {
    mapState: ['count'],
    mapActions: ['increment'],
  })({
    data: {
      itemCount: 20,
      items: [],
      evicted: 0,
    },
    onLoad() {
      this.renderItems()
      // 订阅者被驱逐时累加计数：库经 hooks.emit('onError', …, 'subscribe') 上报，
      // 生产控制台是静默的，页面把计数显示出来让 e2e 可直接断言
      app.globalData.store.hooks.on('onError', (error, source) => {
        if (source === 'subscribe') {
          this.setData({ evicted: this.data.evicted + 1 })
        }
      })
    },
    renderItems() {
      const items = []
      for (let i = 1; i <= this.data.itemCount; i += 1) {
        items.push({ id: i, name: `item-${i}` })
      }
      this.setData({ items })
    },
    onTapIncrement() {
      this.increment()
    },
    onTapMore() {
      this.setData({ itemCount: this.data.itemCount + 20 }, () => this.renderItems())
    },
  }),
)
