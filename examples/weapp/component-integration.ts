/**
 * GeomStore 微信小程序集成示例：Component
 *
 * 覆盖：withComponentStore 把 Store 状态/action 注入自定义组件，
 * 组件销毁时自动退订，避免 detached 后仍触发 setData。
 */

import { createStore } from '../../src/index.js'
import { withComponentStore } from '../../src/integrations/index.js'

// 先定义状态类型：state / getter / action 共用一份
interface CounterState {
  count: number
}

const counterStore = createStore({
  name: 'counter',
  state: (): CounterState => ({
    count: 0,
  }),
  getters: {
    doubled: (state: CounterState) => state.count * 2,
  },
  actions: {
    // action 的 this 由 Store 自动注入，无需手写标注
    increment(): void {
      this.$patch({ count: 0 })
    },
    add(step: number): void {
      this.$patch({ count: this.state.count + step })
    },
  },
})

// 自定义组件：状态与 action 一并注入
Component(
  withComponentStore(counterStore, {
    mapState: ['count'],
    mapGetters: ['doubled'],
    mapActions: ['add'],
  })({
    data: {
      label: '计数器',
    },
    methods: {
      // this 由集成层注入（含 mapActions 的 add 与 this.data），无需手写标注
      onTapPlus() {
        this.add(1)
      },
    },
    lifetimes: {
      attached() {
        // 组件生命周期内的 this 同样是注入后的实例类型，可直接访问 this.data
        console.log('组件挂载，当前计数:', this.data.count)
      },
      detached() {
        // 集成层在 detached 时自动退订
        console.log('组件销毁，订阅已自动清理')
      },
    },
  }),
)

console.log('✅ Component 集成示例已定义（需在微信小程序环境中运行）')
