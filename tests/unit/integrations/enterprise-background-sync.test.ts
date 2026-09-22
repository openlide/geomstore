/**
 * 企业集成 - 后台同步的失败兜底
 *
 * 覆盖：refreshData 同步抛错、onForeground / onBackground 回调抛错均不中断生命周期，
 * 以及 App 无参调用的空配置路径。
 */

import { initBackgroundSync, unregisterBackgroundSync } from '@/integrations/enterprise/background-sync.js'

describe('后台同步的失败兜底', () => {
  const originalApp = (globalThis as any).App
  // 本模块的处理器注册表是模块级的：#355 后 App 被外部替换不再顺带清空它，
  // 跨用例残留会让下一条用例的 console.error 计数失真，故逐条显式注销
  const registeredStores: any[] = []

  afterEach(() => {
    registeredStores.splice(0).forEach((store) => unregisterBackgroundSync(store))
    ;(globalThis as any).App = originalApp
  })

  function installAppStub(): void {
    (globalThis as any).App = function App(options: unknown) {
      return options
    }
  }

  it('refreshData 同步抛错时被接住，且用户 onShow 仍执行', () => {
    const store: any = {
      name: 'sync-throw',
      destroyed: false,
      actions: { refreshData() {} },
      dispatch(): never {
        throw new Error('sync dispatch boom')
      },
      getState: () => ({ x: 1 }),
      subscribe: () => () => {},
    }
    registeredStores.push(store)
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    installAppStub()
    initBackgroundSync({ store, maxInactiveTime: -1 })

    const userOnShow = jest.fn()
    const appOptions = (globalThis as any).App({ onShow: userOnShow }) as { onShow: () => void }

    try {
      expect(() => appOptions.onShow()).not.toThrow()
      expect(userOnShow).toHaveBeenCalled()
      expect(errorSpy).toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('onForeground 回调抛错不中断生命周期；onBackground 抛错同样被接住', () => {
    const store: any = {
      name: 'callback-throw',
      destroyed: false,
      actions: {},
      dispatch: () => undefined,
      getState: () => ({ x: 1 }),
      subscribe: () => () => {},
    }
    registeredStores.push(store)
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    installAppStub()
    initBackgroundSync({
      store,
      onForeground: () => {
        throw new Error('foreground boom')
      },
      onBackground: () => {
        throw new Error('background boom')
      },
    })

    const appOptions = (globalThis as any).App({}) as { onShow: () => void; onHide: () => void }

    try {
      expect(() => appOptions.onShow()).not.toThrow()
      expect(() => appOptions.onHide()).not.toThrow()
      expect(errorSpy).toHaveBeenCalledTimes(2)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('App 不带参数调用时按空配置处理', () => {
    const store: any = {
      name: 'no-args-app',
      destroyed: false,
      actions: {},
      dispatch: () => undefined,
      getState: () => ({ x: 1 }),
      subscribe: () => () => {},
    }
    registeredStores.push(store)
    installAppStub()
    initBackgroundSync({ store })

    expect(() => (globalThis as any).App()).not.toThrow()
  })

  it('#355 回归: 全局 App 被外部替换后再次 init 保留其他调用方的处理器', () => {
    const otherStore: any = {
      name: 'other-caller-store',
      destroyed: false,
      refreshCount: 0,
      actions: { refreshData() {} },
      dispatch(this: any) {
        this.refreshCount += 1
      },
      getState: () => ({}),
      subscribe: () => () => {},
    }
    const lateStore: any = {
      name: 'late-caller-store',
      destroyed: false,
      actions: {},
      dispatch: () => undefined,
      getState: () => ({}),
      subscribe: () => () => {},
    }
    registeredStores.push(otherStore, lateStore)

    installAppStub()
    // 先注册的调用方（如另一个模块的 initBackgroundSync）
    initBackgroundSync({ store: otherStore, maxInactiveTime: -1 })

    // 外部替换全局 App（如框架重新注入 / 测试重置）后再注册
    ;(globalThis as any).App = function App(options: unknown) {
      return options
    }
    initBackgroundSync({ store: lateStore, maxInactiveTime: -1 })

    const appOptions = (globalThis as any).App({}) as { onShow: () => void }
    appOptions.onShow()

    // 新包装遍历同一注册表：先注册的处理器仍被调用，不被静默丢弃
    expect(otherStore.refreshCount).toBe(1)
  })

  it('#356 回归: 非函数的 onShow/onHide 不抛 TypeError，其余生命周期逻辑继续', () => {
    const store: any = {
      name: 'non-fn-hook',
      destroyed: false,
      actions: {},
      dispatch: () => undefined,
      getState: () => ({}),
      subscribe: () => () => {},
    }
    registeredStores.push(store)
    const onForeground = jest.fn()
    installAppStub()
    initBackgroundSync({ store, onForeground })

    // JS 调用方 / `as any` 可传入非函数的真值回调
    const appOptions = (globalThis as any).App({ onShow: 'not-a-function', onHide: 42 }) as {
      onShow: () => void
      onHide: () => void
    }

    expect(() => appOptions.onShow()).not.toThrow()
    expect(() => appOptions.onHide()).not.toThrow()
    expect(onForeground).toHaveBeenCalledTimes(1)
  })
})
