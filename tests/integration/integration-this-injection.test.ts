/**
 * 集成层 this 注入回归测试
 *
 * 三处集成都应把注入后的 `this` 交给配置方法的上下文，因此这些方法**不需要**手写 `this` 标注。
 * 一旦注入失效，本文件会因 ts-jest 报错而失败（例如 `Property 'add' does not exist on type ...`），
 * 这是它相对 examples 的价值：examples 依赖单独的 typecheck 步骤，而它在测试运行时即暴露。
 */

import { createStore, withAppStore, withComponentStore } from '../../src/index.js'

describe('集成层 this 注入', () => {
  it('Component：methods 与 lifetimes 内可直接访问注入的 action 与 data', () => {
    const store = createStore({
      name: 'cmp-this',
      state: { count: 0 },
      actions: {
        add(step: number): void {
          this.$patch({ count: this.state.count + step })
        },
      },
    })

    const config = withComponentStore(store, { mapState: ['count'], mapActions: ['add'] })({
      data: { label: '计数器' },
      methods: {
        // 关键：此处刻意不写 this 标注
        onTapPlus() {
          this.add(1)
          // data 亦来自注入（含 mapState 映射的 count）
          return this.data.count
        },
      },
      lifetimes: {
        // 各生命周期均在注入范围内（created 内同样可直接调用注入的方法）
        created() {
          this.add(1)
        },
        attached() {
          // 生命周期内同样可访问注入的方法
          this.add(0)
        },
      },
      pageLifetimes: {
        // 页面级生命周期同样在注入范围内
        resize(res) {
          this.add(res.size.windowWidth > 0 ? 1 : 0)
        },
      },
    })

    // 返回的配置仍需保留原始成员（lifetimes / pageLifetimes / methods 不因注入而丢失）
    expect(typeof config.methods?.onTapPlus).toBe('function')
    expect(typeof config.lifetimes?.created).toBe('function')
    expect(typeof config.lifetimes?.attached).toBe('function')
    expect(typeof config.pageLifetimes?.resize).toBe('function')
  })

  it('App：onLaunch 内可直接访问 this.globalData 与注入的 action', () => {
    const store = createStore({
      name: 'app-this',
      state: { launchedAt: 0 },
      actions: {
        markLaunched(scene: string): void {
          this.$patch({ launchedAt: scene.length })
        },
      },
    })

    const config = withAppStore(store, { mapState: ['launchedAt'], mapActions: ['markLaunched'] })({
      globalData: { appName: 'demo' },
      // 关键：此处刻意不写 this 标注（写成 this: AppOptions 会使 globalData 退回可选）
      onLaunch() {
        this.markLaunched(this.globalData.appName)
      },
    })

    // 返回的配置保留 globalData 的字面量类型
    expect(config.globalData.appName).toBe('demo')

    // 运行时：onLaunch 会把映射状态写入 globalData，并绑定注入的 action
    config.onLaunch?.()
    expect(store.getState().launchedAt).toBe('demo'.length)
  })
})
