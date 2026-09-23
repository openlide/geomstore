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

export const counterStore = createStore({
  name: 'counter',
  state: (): CounterState => ({
    count: 0,
  }),
  getters: {
    doubled: (state: CounterState) => state.count * 2,
  },
  actions: {
    // action 的 this 由 Store 自动注入，无需手写标注
    // increment 刻意以 `this.state.count` 为基数（与下面的 add 同口径）：
    // 写成常量就等于「自增」实为重置，count 恰为 0 时连订阅都不触发，抄走即中招
    increment(): void {
      this.$patch({ count: this.state.count + 1 })
    },
    add(step: number): void {
      this.$patch({ count: this.state.count + step })
    },
  },
})

/**
 * 组件配置：状态与 action 一并注入
 *
 * 导出给测试与非小程序环境复用；宿主注册见文件末尾的守卫。
 */
export const counterComponentOptions = withComponentStore(counterStore, {
  mapState: ['count'],
  mapGetters: ['doubled'],
  mapActions: ['increment', 'add'],
})({
  data: {
    label: '计数器',
  },
  methods: {
    // this 由集成层注入（含 mapActions 的 increment / add 与 this.data），无需手写标注
    onTapPlus() {
      this.increment()
    },
    onTapPlusTen() {
      this.add(10)
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
})

// 宿主守卫：`Component` 只存在于微信小程序运行时（examples/global.d.ts 里的声明是纯编译期的），
// 顶层裸调用会让本文件在 Node 里一被 import 就抛 `ReferenceError: Component is not defined`
if (typeof Component === 'function') {
  Component(counterComponentOptions)
}

console.log('✅ Component 集成示例已定义（需在微信小程序环境中运行）')
