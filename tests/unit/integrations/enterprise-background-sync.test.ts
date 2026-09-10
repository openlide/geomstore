/**
 * 企业集成 - 后台同步的失败兜底
 *
 * 覆盖：refreshData 同步抛错、onForeground / onBackground 回调抛错均不中断生命周期，
 * 以及 App 无参调用的空配置路径。
 */

import { initBackgroundSync } from '@/integrations/enterprise/background-sync.js'

describe('后台同步的失败兜底', () => {
  const originalApp = (globalThis as any).App

  afterEach(() => {
    (globalThis as any).App = originalApp
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
    installAppStub()
    initBackgroundSync({ store })

    expect(() => (globalThis as any).App()).not.toThrow()
  })
})
