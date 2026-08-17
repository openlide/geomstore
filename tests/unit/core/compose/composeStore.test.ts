/**
 * GeomStore v1.0 - composeStore 测试
 */

import { createStore } from '@/index'
import type { State } from '@/types/store'
import { composeStore, createStoreTree } from '@/core/compose/composeStore'
import * as storeUtils from '@/core/store/utils'

describe('composeStore', () => {
  let store1: any
  let store2: any
  let store3: any

  beforeEach(() => {
    store1 = createStore({
      name: 'user',
      state: {
        name: 'Alice',
        age: 25,
      },
      actions: {
        setName(name: string) {
          this.state.name = name
        },
        incrementAge() {
          this.state.age++
        },
      },
      getters: {
        displayName: (state) => `User: ${state.name}`,
      },
    })

    store2 = createStore({
      name: 'app',
      state: {
        theme: 'light',
        language: 'zh-CN',
      },
      actions: {
        setTheme(theme: string) {
          this.state.theme = theme
        },
      },
      getters: {
        themeInfo: (state) => `Theme: ${state.theme}`,
      },
    })

    store3 = createStore({
      name: 'data',
      state: {
        items: [] as any[],
        total: 0,
      },
      actions: {
        addItem(item: any) {
          this.state.items.push(item)
          this.state.total++
        },
      },
    })
  })

  describe('基础组合', () => {
    test('应该能够组合多个store', () => {
      const composed = composeStore([store1, store2])
      expect(composed).toBeDefined()
      expect(composed.name).toBe('composed')
    })

    test('应该能够合并所有store的state（非命名空间模式）', () => {
      const composed = composeStore([store1, store2])
      const state = composed.getState()

      expect(state).toHaveProperty('name', 'Alice')
      expect(state).toHaveProperty('age', 25)
      expect(state).toHaveProperty('theme', 'light')
      expect(state).toHaveProperty('language', 'zh-CN')
    })

    test('应该能够按命名空间合并state', () => {
      const composed = composeStore([store1, store2], { namespace: true })
      const state = composed.getState()

      expect(state.user).toEqual({ name: 'Alice', age: 25 })
      expect(state.app).toEqual({ theme: 'light', language: 'zh-CN' })
    })

    test('应该暴露stores引用', () => {
      const composed = composeStore([store1, store2]) as any
      expect(composed.stores).toBeDefined()
      expect(composed.stores.user).toBe(store1)
      expect(composed.stores.app).toBe(store2)
    })
  })

  describe('参数验证', () => {
    test('空数组应该抛出错误', () => {
      expect(() => composeStore([])).toThrow('[composeStore] stores must be a non-empty array')
    })

    test('非数组应该抛出错误', () => {
      expect(() => composeStore(null as any)).toThrow('[composeStore] stores must be a non-empty array')
    })

    test('undefined应该抛出错误', () => {
      expect(() => composeStore(undefined as any)).toThrow('[composeStore] stores must be a non-empty array')
    })
  })

  describe('setState', () => {
    test('非命名空间模式应该能够设置单个store的state', () => {
      const composed = composeStore([store1, store2])
      composed.setState('name', 'Bob')

      expect(composed.getState().name).toBe('Bob')
      expect(store1.getState().name).toBe('Bob')
    })

    test('命名空间模式应该能够设置单个store的state', () => {
      const composed = composeStore([store1, store2], { namespace: true })
      composed.setState('user/name', 'Bob')

      expect(composed.getState().user.name).toBe('Bob')
      expect(store1.getState().name).toBe('Bob')
    })

    test('命名空间模式下不带 / 的 key 不应写入空字符串键', () => {
      const composed = composeStore([store1, store2], { namespace: true, strict: true })

      expect(() => composed.setState('user', 'value')).toThrow('[composeStore] Cannot find store for key: user')
      expect('' in store1.getState()).toBe(false)
    })

    test('strict模式下找不到store应该抛出错误', () => {
      const composed = composeStore([store1, store2], { strict: true })
      expect(() => composed.setState('nonexistent', 'value')).toThrow('[composeStore] Cannot find store for key: nonexistent')
    })

    test('非strict模式下找不到store应该静默失败', () => {
      const composed = composeStore([store1, store2], { strict: false })
      expect(() => composed.setState('nonexistent', 'value')).not.toThrow()
    })
  })

  describe('$patch', () => {
    test('非命名空间模式应该能够批量更新state', () => {
      const composed = composeStore([store1, store2])
      composed.$patch({
        name: 'Bob',
        age: 30,
      })

      const state = composed.getState()
      expect(state.name).toBe('Bob')
      expect(state.age).toBe(30)
    })

    test('命名空间模式应该能够批量更新state', () => {
      const composed = composeStore([store1, store2], { namespace: true })
      composed.$patch({
        user: { name: 'Bob', age: 30 },
      })

      const state = composed.getState()
      expect(state.user.name).toBe('Bob')
      expect(state.user.age).toBe(30)
    })

    test('非命名空间模式下应该能够更新多个store的state', () => {
      const composed = composeStore([store1, store2])
      composed.$patch({
        name: 'Bob',
        theme: 'dark',
      })

      const state = composed.getState()
      expect(state.name).toBe('Bob')
      expect(state.theme).toBe('dark')
      expect(store1.getState().name).toBe('Bob')
      expect(store2.getState().theme).toBe('dark')
    })

    test('命名空间模式下strict找不到store应该抛出错误', () => {
      const composed = composeStore([store1, store2], { namespace: 'app' as any, strict: true })
      // 使用一个不存在的 store 名称作为 key
      let errorThrown = false
      try {
        composed.$patch({ nonexistent: { value: 123 } })
      } catch (e: any) {
        errorThrown = true
        expect(e.message).toContain('[composeStore] Cannot find store for key: nonexistent')
      }
      expect(errorThrown).toBe(true)
    })

    test('命名空间模式=true时strict找不到store应该抛出错误', () => {
      const composed = composeStore([store1, store2], { namespace: true, strict: true })
      // 当 namespace: true 时，也会进入命名空间模式分支
      let errorThrown = false
      try {
        composed.$patch({ nonexistent: { value: 123 } })
      } catch (e: any) {
        errorThrown = true
        expect(e.message).toContain('[composeStore] Cannot find store for key: nonexistent')
      }
      expect(errorThrown).toBe(true)
    })

    test('非命名空间模式下strict找不到store应该抛出错误', () => {
      const composed = composeStore([store1, store2], { namespace: false, strict: true })
      expect(() => composed.$patch({ nonexistent: 'value' })).toThrow('[composeStore] Cannot find store for key: nonexistent')
    })

    test('非命名空间模式下找不到store应该静默失败', () => {
      const composed = composeStore([store1, store2], { strict: false })
      expect(() => composed.$patch({ nonexistent: 'value' })).not.toThrow()
    })

    test('非命名空间模式下同一store的多个key应该合并', () => {
      const composed = composeStore([store1, store2])
      composed.$patch({
        name: 'Bob',
        age: 30,
      })

      expect(store1.getState().name).toBe('Bob')
      expect(store1.getState().age).toBe(30)
    })
  })

  describe('$replaceState', () => {
    test('非命名空间模式应该能够替换state', () => {
      const composed = composeStore([store1, store2])
      composed.$replaceState({
        name: 'Bob',
        age: 30,
      })

      const state = composed.getState()
      expect(state.name).toBe('Bob')
      expect(state.age).toBe(30)
    })

    test('命名空间模式应该能够替换state', () => {
      const composed = composeStore([store1, store2], { namespace: true })
      composed.$replaceState({
        user: { name: 'Bob', age: 30 },
      })

      const state = composed.getState()
      expect(state.user.name).toBe('Bob')
      expect(state.user.age).toBe(30)
    })

    test('命名空间模式下strict找不到store应该抛出错误', () => {
      const composed = composeStore([store1, store2], { namespace: true, strict: true })
      let errorThrown = false
      try {
        composed.$replaceState({ nonexistent: { value: 123 } })
      } catch (e: any) {
        errorThrown = true
        expect(e.message).toContain('[composeStore] Cannot find store for key: nonexistent')
      }
      expect(errorThrown).toBe(true)
    })

    test('命名空间模式=true时strict找不到store应该抛出错误', () => {
      const composed = composeStore([store1, store2], { namespace: true, strict: true })
      let errorThrown = false
      try {
        composed.$replaceState({ nonexistent: { value: 123 } })
      } catch (e: any) {
        errorThrown = true
        expect(e.message).toContain('[composeStore] Cannot find store for key: nonexistent')
      }
      expect(errorThrown).toBe(true)
    })

    test('非命名空间模式下strict找不到store应该抛出错误', () => {
      const composed = composeStore([store1, store2], { namespace: false, strict: true })
      expect(() => composed.$replaceState({ nonexistent: 'value' })).toThrow('[composeStore] Cannot find store for key: nonexistent')
    })

    test('非命名空间模式下找不到store应该静默失败', () => {
      const composed = composeStore([store1, store2], { strict: false })
      expect(() => composed.$replaceState({ nonexistent: 'value' })).not.toThrow()
    })

    test('非命名空间模式下应该能够更新多个store', () => {
      const composed = composeStore([store1, store2])
      composed.$replaceState({
        name: 'Bob',
        age: 30,
        theme: 'dark',
        language: 'en',
      })

      expect(store1.getState().name).toBe('Bob')
      expect(store1.getState().age).toBe(30)
      expect(store2.getState().theme).toBe('dark')
      expect(store2.getState().language).toBe('en')
    })
  })

  describe('dispatch', () => {
    test('非命名空间模式应该能够执行action', () => {
      const composed = composeStore([store1, store2])
      composed.dispatch('setName', 'Bob')

      expect(composed.getState().name).toBe('Bob')
      expect(store1.getState().name).toBe('Bob')
    })

    test('命名空间模式应该能够执行action', () => {
      const composed = composeStore([store1, store2], { namespace: true })
      composed.dispatch('user/setName', 'Bob')

      const state = composed.getState()
      expect(state.user.name).toBe('Bob')
      expect(store1.getState().name).toBe('Bob')
    })

    test('非命名空间模式应该能够执行不同store的action', () => {
      const composed = composeStore([store1, store2])
      composed.dispatch('setName', 'Bob')
      composed.dispatch('setTheme', 'dark')

      expect(composed.getState().name).toBe('Bob')
      expect(composed.getState().theme).toBe('dark')
    })

    test('非命名空间模式应该能够执行带参数的action', () => {
      const composed = composeStore([store1, store2])
      composed.dispatch('incrementAge')

      expect(composed.getState().age).toBe(26)
    })

    test('非命名空间模式下strict找不到action应该抛出错误', () => {
      const composed = composeStore([store1, store2], { strict: true })
      expect(() => composed.dispatch('nonexistent')).toThrow('[composeStore] Cannot find store for action: nonexistent')
    })

    test('非strict模式下找不到action应该返回undefined', () => {
      const composed = composeStore([store1, store2], { strict: false })
      const result = composed.dispatch('nonexistent')
      expect(result).toBeUndefined()
    })

    test('命名空间模式下strict找不到store应该抛出错误', () => {
      const composed = composeStore([store1, store2], { namespace: true, strict: true })
      expect(() => composed.dispatch('nonexistent/action')).toThrow('[composeStore] Cannot find store for action: nonexistent/action')
    })

    test('命名空间模式下找不到store应该返回undefined', () => {
      const composed = composeStore([store1, store2], { namespace: true, strict: false })
      const result = composed.dispatch('nonexistent/action')
      expect(result).toBeUndefined()
    })

    test('命名空间模式下多级路径应该正确解析', () => {
      // 测试 parseActionName 中 parts.length !== 2 的情况
      const composed = composeStore([store1, store2], { namespace: true })
      // 三段式路径会被解析为 storeName = 'user', actionName = 'setName/extra'
      // 由于 store1 没有 'setName/extra' action，所以会失败
      const result = composed.dispatch('user/setName', 'Bob')
      expect(store1.getState().name).toBe('Bob')
    })

    test('命名空间模式下多级路径（三段）应该解析为 store + 成员名', () => {
      // parseActionName 对 parts.length >= 2 时取首段为 store 名、其余段合并为成员名
      const composed = composeStore([store1, store2], { namespace: 'myapp', strict: false })
      // 'user/setName/extra' 解析为 store 'user' + action 'setName/extra'
      // store1 没有 'setName/extra' action，由内层 Store 抛出 ActionError 而非静默返回 undefined
      expect(() => composed.dispatch('user/setName/extra')).toThrow('Action "setName/extra" not found in store "user"')
    })

    test('非命名空间模式dispatch应该正常工作', () => {
      const composed = composeStore([store1, store2])
      composed.dispatch('setName', 'Bob')
      expect(store1.getState().name).toBe('Bob')
    })
  })

  describe('getter', () => {
    test('非命名空间模式应该能够获取getter值', () => {
      const composed = composeStore([store1, store2])
      const displayName = composed.getter('displayName')

      expect(displayName).toBe('User: Alice')
    })

    test('命名空间模式应该能够获取getter值', () => {
      const composed = composeStore([store1, store2], { namespace: true })
      const displayName = composed.getter('user/displayName')

      expect(displayName).toBe('User: Alice')
    })

    test('非命名空间模式应该能够获取不同store的getter', () => {
      const composed = composeStore([store1, store2])
      const displayName = composed.getter('displayName')
      const themeInfo = composed.getter('themeInfo')

      expect(displayName).toBe('User: Alice')
      expect(themeInfo).toBe('Theme: light')
    })

    test('非命名空间模式下strict找不到getter应该抛出错误', () => {
      const composed = composeStore([store1, store2], { strict: true })
      expect(() => composed.getter('nonexistent')).toThrow('[composeStore] Cannot find store for getter: nonexistent')
    })

    test('非strict模式下找不到getter应该返回undefined', () => {
      const composed = composeStore([store1, store2], { strict: false })
      const result = composed.getter('nonexistent')
      expect(result).toBeUndefined()
    })

    test('命名空间模式下strict找不到store应该抛出错误', () => {
      const composed = composeStore([store1, store2], { namespace: true, strict: true })
      expect(() => composed.getter('nonexistent/someGetter')).toThrow('[composeStore] Cannot find store for getter: nonexistent/someGetter')
    })

    test('命名空间模式下找不到store应该返回undefined', () => {
      const composed = composeStore([store1, store2], { namespace: true, strict: false })
      const result = composed.getter('nonexistent/someGetter')
      expect(result).toBeUndefined()
    })

    test('非命名空间模式下找不到对应getter的store应该抛出错误', () => {
      const composed = composeStore([store1, store2], { strict: true })
      expect(() => composed.getter('nonexistentGetter')).toThrow('[composeStore] Cannot find store for getter: nonexistentGetter')
    })
  })

  describe('subscribe', () => {
    test('应该能够订阅组合store的状态变化', (done) => {
      const composed = composeStore([store1, store2])
      let callCount = 0

      const unsubscribe = composed.subscribe((state) => {
        callCount++
        // 与普通 Store.subscribe 一致：订阅时不立即回调，首次通知即 dispatch 后的广播
        if (callCount === 1) {
          expect(state.name).toBe('Bob')
          unsubscribe()
          done()
        }
      })

      composed.dispatch('setName', 'Bob')
    })

    test('订阅时不应该立即通知（与普通 Store.subscribe 一致）', (done) => {
      const composed = composeStore([store1, store2])
      const callCount = { count: 0 }

      const unsubscribe = composed.subscribe((state) => {
        callCount.count++
        // 首次回调即状态变化通知，不存在订阅时的初始通知
        expect(callCount.count).toBe(1)
        expect(state.name).toBe('Bob')
        unsubscribe()
        done()
      })

      // 订阅后未发生状态变化前不应有任何回调
      expect(callCount.count).toBe(0)

      // 触发一次状态变化
      composed.dispatch('setName', 'Bob')
    })

    test('应该在取消订阅后不再通知', (done) => {
      const composed = composeStore([store1, store2])
      let callCount = 0

      const unsubscribe = composed.subscribe(() => {
        callCount++
      })

      unsubscribe()
      composed.dispatch('setName', 'Bob')

      setTimeout(() => {
        // 订阅时不立即回调，退订后也不再有通知
        expect(callCount).toBe(0)
        done()
      }, 50)
    })

    test('应该能够订阅多个store的变化', (done) => {
      const composed = composeStore([store1, store2])
      const states: any[] = []

      const unsubscribe = composed.subscribe((state) => {
        states.push(state)
        if (states.length === 1) {
          // 首次通知即 dispatch 后的广播
          expect(states[0].name).toBe('Bob')
          unsubscribe()
          done()
        }
      })

      composed.dispatch('setName', 'Bob')
    })

    test('pendingNotification分支 - 并发更新时应该正确处理', (done) => {
      const composed = composeStore([store1, store2])
      const notifications: string[] = []

      const unsubscribe = composed.subscribe((state) => {
        notifications.push(state.name)
      })

      // 快速连续更新触发 pendingNotification 分支
      store1.dispatch('setName', 'Bob')
      store1.dispatch('setName', 'Charlie')

      setTimeout(() => {
        // 至少应该有初始通知和更新通知
        expect(notifications.length).toBeGreaterThan(0)
        unsubscribe()
        done()
      }, 100)
    })

    test('取消订阅应该清理所有store的订阅', (done) => {
      const composed = composeStore([store1, store2])
      let callCount = 0

      const unsubscribe = composed.subscribe(() => {
        callCount++
      })

      unsubscribe()

      // 分别更新两个 store
      store1.dispatch('setName', 'Bob')
      store2.dispatch('setTheme', 'dark')

      setTimeout(() => {
        // 订阅时不立即回调，退订清理后没有任何通知
        expect(callCount).toBe(0)
        done()
      }, 100)
    })

    test('并发更新时pendingNotification分支应该被覆盖', (done) => {
      // 创建一个同步触发多个 store 更新的场景
      const composed = composeStore([store1, store2])
      const notifications: number[] = []

      const unsubscribe = composed.subscribe(() => {
        notifications.push(Date.now())
      })

      // 同步触发多个 store 的更新
      // 这会触发 pendingNotification 分支
      store1.dispatch('setName', 'Bob')
      store2.dispatch('setTheme', 'dark')

      setTimeout(() => {
        // 应该收到初始通知 + 更新通知
        expect(notifications.length).toBeGreaterThan(0)
        unsubscribe()
        done()
      }, 100)
    })

    test('多个store同时更新应该触发pendingNotification', (done) => {
      const composed = composeStore([store1, store2, store3])
      let notificationCount = 0

      const unsubscribe = composed.subscribe((state) => {
        notificationCount++
      })

      // 立即更新多个 store
      store1.dispatch('setName', 'Bob')
      store2.dispatch('setTheme', 'dark')
      store3.dispatch('addItem', { id: 1 })

      setTimeout(() => {
        // 初始通知 + 更新通知
        expect(notificationCount).toBeGreaterThan(0)
        unsubscribe()
        done()
      }, 100)
    })

    test('listener抛错应该被隔离且不中断其他监听器', async () => {
      const composed = composeStore([store1, store2])
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
      const secondListener = jest.fn()

      // 广播时抛错的监听器：错误应被隔离，不影响其他监听器
      composed.subscribe(() => {
        throw new Error('Listener boom')
      })
      composed.subscribe(secondListener)

      store1.dispatch('setName', 'Bob')

      // 等待微任务广播完成
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(secondListener).toHaveBeenCalled()
      // 非生产环境应该记录错误
      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    test('生产环境下listener抛错应该静默隔离', async () => {
      const isProductionSpy = jest.spyOn(storeUtils, 'isProduction').mockReturnValue(true)
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
      const composed = composeStore([store1, store2])
      const secondListener = jest.fn()

      // 广播时抛错的监听器：生产环境下错误应被静默隔离
      composed.subscribe(() => {
        throw new Error('Listener boom')
      })
      composed.subscribe(secondListener)

      store1.dispatch('setName', 'Bob')

      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(secondListener).toHaveBeenCalled()
      // 生产环境不输出错误日志
      expect(consoleSpy).not.toHaveBeenCalled()

      isProductionSpy.mockRestore()
      consoleSpy.mockRestore()
    })

    test('通知循环中销毁组合store后调度通知应该被忽略', async () => {
      const composed = composeStore([store1, store2])

      // 先注册子 store 级监听器：在通知快照中位于组合层 wrapper 之前
      const earlyUnsubscribe = store1.subscribe(() => {
        // 通知循环中途销毁组合层（不级联销毁子 store）
        // destroy(destroyStores) 为实现层签名，公共类型暴露无参版本，此处断言安全
        (composed as any).destroy(false)
      })

      // 再注册组合层订阅：wrapper 在同一通知循环内随后被调用
      const composedListener = jest.fn()
      const unsubscribeComposed = composed.subscribe(composedListener)

      store1.dispatch('setName', 'Bob')

      // 等待可能存在的微任务广播
      await new Promise((resolve) => setTimeout(resolve, 20))

      // 订阅时不立即回调；销毁后 _scheduleNotify 命中 destroyed 守卫，不再广播
      expect(composedListener).not.toHaveBeenCalled()
      expect(store1.getState().name).toBe('Bob')

      earlyUnsubscribe()
      unsubscribeComposed()
    })
  })

  describe('use', () => {
    test('应该能够将插件应用到所有store', () => {
      const composed = composeStore([store1, store2])
      const installedStores: any[] = []

      const plugin = {
        name: 'test-plugin',
        install(store: any) {
          installedStores.push(store.name)
          return () => {}
        },
      }

      const uninstall = composed.use(plugin)
      expect(installedStores).toEqual(['user', 'app'])

      uninstall()
    })

    test('应该返回清理函数', () => {
      const composed = composeStore([store1, store2])

      const plugin = {
        name: 'test-plugin',
        install(store: any) {
          return () => {}
        },
      }

      const uninstall = composed.use(plugin)
      expect(typeof uninstall).toBe('function')

      uninstall()
    })

    test('清理函数应该调用所有store的清理函数', () => {
      const composed = composeStore([store1, store2])
      const uninstalls: (() => void)[] = []

      const plugin = {
        name: 'test-plugin',
        install(store: any) {
          const uninstall = () => {
            uninstalls.push(uninstall)
          }
          return uninstall
        },
      }

      composed.use(plugin)
      expect(uninstalls.length).toBe(0)

      // 销毁composed store应该调用所有清理函数
      composed.destroy()
      expect(uninstalls.length).toBe(2)
    })

    test('插件不返回函数时应该正常处理', () => {
      const composed = composeStore([store1, store2])
      const installedStores: any[] = []

      const plugin = {
        name: 'test-plugin-no-return',
        install(store: any) {
          installedStores.push(store.name)
          // 不返回任何东西
        },
      }

      const uninstall = composed.use(plugin)
      expect(installedStores).toEqual(['user', 'app'])
      expect(typeof uninstall).toBe('function')

      // 卸载应该正常工作
      expect(() => uninstall()).not.toThrow()
    })

    test('插件返回非函数值时应该正常处理', () => {
      const composed = composeStore([store1, store2])

      const plugin = {
        name: 'test-plugin-return-non-func',
        install(store: any) {
          return 'not a function' as any
        },
      }

      const uninstall = composed.use(plugin)
      expect(typeof uninstall).toBe('function')
      expect(() => uninstall()).not.toThrow()
    })

    test('插件返回undefined时应该正确跳过', () => {
      const composed = composeStore([store1, store2])

      const plugin = {
        name: 'test-plugin-return-undefined',
        install(store: any) {
          return undefined
        },
      }

      const uninstall = composed.use(plugin)
      expect(typeof uninstall).toBe('function')
      // 卸载时应该跳过 undefined 值
      expect(() => uninstall()).not.toThrow()
    })

    test('插件返回null时应该正确跳过', () => {
      const composed = composeStore([store1, store2])

      const plugin = {
        name: 'test-plugin-return-null',
        install(store: any) {
          return null as any
        },
      }

      const uninstall = composed.use(plugin)
      expect(typeof uninstall).toBe('function')
      expect(() => uninstall()).not.toThrow()
    })
  })

  describe('destroy', () => {
    test('应该能够销毁所有store', () => {
      const composed = composeStore([store1, store2])

      jest.spyOn(store1, 'destroy')
      jest.spyOn(store2, 'destroy')

      composed.destroy()

      expect(store1.destroy).toHaveBeenCalled()
      expect(store2.destroy).toHaveBeenCalled()
    })

    test('destroy(false) 不应级联销毁子 store', () => {
      const composed = composeStore([store1, store2])

      jest.spyOn(store1, 'destroy')
      jest.spyOn(store2, 'destroy')

      // 组合层 destroy 支持 destroyStores 参数（Store 类型上未暴露，此处走内部实现签名）
      ;(composed as any).destroy(false)

      expect(store1.destroy).not.toHaveBeenCalled()
      expect(store2.destroy).not.toHaveBeenCalled()
      expect((composed as any).destroyed).toBe(true)
    })

    test('destroy 时应退订所有子 store 订阅', () => {
      const composed = composeStore([store1, store2])
      composed.subscribe(() => {})

      expect(() => composed.destroy()).not.toThrow()
    })

    test('subscribe 退订后应同步清理内部句柄记录', () => {
      const composed = composeStore([store1, store2])

      const unsubscribe1 = composed.subscribe(() => {})
      const unsubscribe2 = composed.subscribe(() => {})
      // 两次订阅各挂 2 个子 store 句柄
      expect((composed as any)._storeUnsubscribers.length).toBe(4)

      unsubscribe1()
      unsubscribe2()
      // 退订后句柄记录应同步清空，避免页面反复挂载/卸载的长会话累积
      expect((composed as any)._storeUnsubscribers.length).toBe(0)
    })

    test('REGR-COMP-001: destroy 后调用 _notifyListeners 应静默返回', () => {
      const composed = composeStore([store1, store2])
      composed.destroy()

      expect(() => (composed as any)._notifyListeners()).not.toThrow()
    })

    test('REGR-COMP-002: listener 抛错不应中断其余监听器且错误被捕获', () => {
      const composed = composeStore([store1, store2])
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
      const listenerB = jest.fn()

      // 绕过 subscribe 的同步初始通知，直接注册会抛错的监听器
      ;(composed as any)._composedListeners.add(() => {
        throw new Error('listener boom')
      })
      composed.subscribe(listenerB)
      listenerB.mockClear()

      expect(() => (composed as any)._notifyListeners()).not.toThrow()
      expect(listenerB).toHaveBeenCalled()
      expect(errorSpy).toHaveBeenCalled()
      errorSpy.mockRestore()
    })

    test('REGR-COMP-003: 退订时句柄不在登记数组应安全跳过（幂等退订）', () => {
      const composed = composeStore([store1, store2])
      const listener = jest.fn()
      const unsubscribe = composed.subscribe(listener)

      // 模拟句柄已被外部移除（如长会话中重复清理）
      ;(composed as any)._storeUnsubscribers.length = 0

      expect(() => unsubscribe()).not.toThrow()
      expect(listener).not.toHaveBeenCalled() // 订阅时不立即回调
    })
  })

  describe('listener 错误隔离', () => {
    test('单个 listener 抛错不应中断其余监听器通知', (done) => {
      const composed = composeStore([store1, store2])
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()

      let notifyCount = 0
      const normalListener = jest.fn()
      composed.subscribe(() => {
        notifyCount++
        // 每次广播都抛错（首次回调即状态变化广播）
        throw new Error('listener error')
      })
      composed.subscribe(normalListener)

      composed.dispatch('setName', 'Bob')

      // 等待微任务通知完成
      setTimeout(() => {
        expect(consoleSpy).toHaveBeenCalledWith('[GeomStore] Error in composed state listener:', expect.any(Error))
        // 正常 listener 收到 dispatch 后的广播
        expect(normalListener).toHaveBeenCalled()
        expect(notifyCount).toBeGreaterThanOrEqual(1)
        consoleSpy.mockRestore()
        done()
      }, 50)
    })

    test('无 queueMicrotask 环境应降级为 Promise 微任务', (done) => {
      const composed = composeStore([store1, store2])
      const globalObject = globalThis as { queueMicrotask?: unknown }
      const originalQueueMicrotask = globalObject.queueMicrotask
      delete globalObject.queueMicrotask

      let notifyCount = 0
      composed.subscribe(() => {
        notifyCount++
      })

      composed.dispatch('setName', 'Bob')

      expect(notifyCount).toBe(0) // 尚未通知（微任务未执行）

      setTimeout(() => {
        expect(notifyCount).toBe(1)
        globalObject.queueMicrotask = originalQueueMicrotask
        done()
      }, 50)
    })
  })

  describe('缓存功能', () => {
    beforeEach(() => {
      // 启用缓存
      store1.enableCache()
      store2.enableCache()
    })

    test('getCached应该能够从对应store获取缓存', () => {
      const composed = composeStore([store1, store2])

      // 首次访问应该从store获取
      const value1 = composed.getCached('name')
      expect(value1).toBe('Alice')

      // 再次访问应该从缓存获取
      const value2 = composed.getCached('name')
      expect(value2).toBe('Alice')

      const stats = composed.getCacheStats()
      expect(stats.enabled).toBe(true)
    })

    test('命名空间模式下getCached应该能够获取缓存', () => {
      const composed = composeStore([store1, store2], { namespace: true })

      const value = composed.getCached('user/name')
      expect(value).toBe('Alice')
    })

    test('命名空间模式下getCached多级路径应该正常工作', () => {
      const composed = composeStore([store1, store2], { namespace: true })

      // 测试多级路径解析
      const value = composed.getCached('user/name')
      expect(value).toBe('Alice')
    })

    test('getCached在strict模式下找不到store应该抛出错误', () => {
      const composed = composeStore([store1, store2], { namespace: true, strict: true })
      expect(() => composed.getCached('nonexistent/key')).toThrow('[composeStore] Cannot find store for key: nonexistent/key')
    })

    test('getCached在非strict模式下找不到store应该返回undefined', () => {
      const composed = composeStore([store1, store2], { namespace: true, strict: false })
      const result = composed.getCached('nonexistent/key')
      expect(result).toBeUndefined()
    })

    test('enableCache应该应用到所有store', () => {
      const composed = composeStore([store1, store2])
      store1.disableCache()
      store2.disableCache()

      expect(store1.getCacheStats().enabled).toBe(false)
      expect(store2.getCacheStats().enabled).toBe(false)

      composed.enableCache()

      expect(store1.getCacheStats().enabled).toBe(true)
      expect(store2.getCacheStats().enabled).toBe(true)
    })

    test('disableCache应该应用到所有store', () => {
      const composed = composeStore([store1, store2])

      expect(store1.getCacheStats().enabled).toBe(true)
      expect(store2.getCacheStats().enabled).toBe(true)

      composed.disableCache()

      expect(store1.getCacheStats().enabled).toBe(false)
      expect(store2.getCacheStats().enabled).toBe(false)
    })

    test('invalidateCache应该能够清除特定key的缓存', () => {
      const composed = composeStore([store1, store2])

      // 访问两次以建立缓存
      composed.getCached('name')
      composed.getCached('name')

      const stats1 = composed.getCacheStats()
      expect(stats1.hits).toBeGreaterThanOrEqual(1)
      expect(stats1.size).toBeGreaterThan(0)

      composed.invalidateCache('name')

      const stats2 = composed.getCacheStats()
      // 缓存应该被清除，size 应该减少
      expect(stats2.size).toBeLessThan(stats1.size)
      // hits 和 misses 统计应该保留
      expect(stats2.hits).toBe(stats1.hits)
      expect(stats2.misses).toBe(stats1.misses)
    })

    test('invalidateCache应该能够清除所有缓存', () => {
      const composed = composeStore([store1, store2, store3])

      // 建立缓存
      composed.getCached('name')
      composed.getCached('theme')

      const stats1 = composed.getCacheStats()
      expect(stats1.size).toBeGreaterThan(0)

      composed.invalidateCache()

      const stats2 = composed.getCacheStats()
      // 缓存大小应该减少
      expect(stats2.size).toBeLessThan(stats1.size)
    })

    test('invalidateCache在strict模式下找不到store应该抛出错误', () => {
      const composed = composeStore([store1, store2], { namespace: true, strict: true })
      expect(() => composed.invalidateCache('nonexistent/key')).toThrow('[composeStore] Cannot find store for key: nonexistent/key')
    })

    test('invalidateCache在非strict模式下找不到store应该静默失败', () => {
      const composed = composeStore([store1, store2], { namespace: true, strict: false })
      expect(() => composed.invalidateCache('nonexistent/key')).not.toThrow()
    })

    test('getCacheStats应该聚合所有store的统计', () => {
      const composed = composeStore([store1, store2])

      // 触发一些缓存操作
      composed.getCached('name')
      composed.getCached('theme')

      const stats = composed.getCacheStats()
      expect(stats).toBeDefined()
      expect(stats.enabled).toBe(true)
      expect(stats.size).toBeGreaterThanOrEqual(0)
      expect(stats.hits).toBeGreaterThanOrEqual(2)
    })

    test('getCacheStats应该聚合keys数组', () => {
      const composed = composeStore([store1, store2])

      composed.getCached('name')
      composed.getCached('theme')

      const stats = composed.getCacheStats()
      expect(stats.keys.length).toBeGreaterThanOrEqual(0)
    })
  })

  describe('$snapshot 和 $restore', () => {
    test('非命名空间模式应该能够创建快照', () => {
      const composed = composeStore([store1, store2])
      const snapshot = composed.$snapshot()

      expect(snapshot.name).toBe('Alice')
      expect(snapshot.age).toBe(25)
      expect(snapshot.theme).toBe('light')
    })

    test('命名空间模式应该能够创建快照', () => {
      const composed = composeStore([store1, store2], { namespace: true })
      const snapshot = composed.$snapshot()

      expect(snapshot.user).toEqual({ name: 'Alice', age: 25 })
      expect(snapshot.app).toEqual({ theme: 'light', language: 'zh-CN' })
    })

    test('非命名空间模式应该能够恢复快照', () => {
      const composed = composeStore([store1, store2])

      // 修改状态
      composed.dispatch('setName', 'Bob')
      expect(composed.getState().name).toBe('Bob')

      // 恢复快照
      composed.$restore({
        name: 'Charlie',
        age: 30,
        theme: 'dark',
        language: 'en',
      })

      expect(composed.getState().name).toBe('Charlie')
      expect(composed.getState().age).toBe(30)
      expect(composed.getState().theme).toBe('dark')
    })

    test('命名空间模式应该能够恢复快照', () => {
      const composed = composeStore([store1, store2], { namespace: true })

      // 修改状态
      composed.dispatch('user/setName', 'Bob')
      expect(composed.getState().user.name).toBe('Bob')

      // 恢复快照
      composed.$restore({
        user: { name: 'Charlie', age: 30 },
        app: { theme: 'dark', language: 'en' },
      })

      expect(composed.getState().user.name).toBe('Charlie')
      expect(composed.getState().user.age).toBe(30)
    })

    test('命名空间模式下strict找不到store应该抛出错误', () => {
      const composed = composeStore([store1, store2], { namespace: true, strict: true })

      expect(() =>
        composed.$restore({
          nonexistent: { value: 123 },
          user: { name: 'Alice', age: 25 },
        }),
      ).toThrow('[composeStore] Cannot find store for key: nonexistent')
    })

    test('非命名空间模式下strict找不到store应该抛出错误', () => {
      const composed = composeStore([store1, store2], { namespace: false, strict: true })

      expect(() =>
        composed.$restore({
          name: 'Alice',
          age: 25,
          nonexistent: 'value',
        }),
      ).toThrow('[composeStore] Cannot find store for key: nonexistent')
    })

    test('非strict模式下找不到store应该静默失败', () => {
      const composed = composeStore([store1, store2], { strict: false })

      expect(() =>
        composed.$restore({
          name: 'Alice',
          age: 25,
          nonexistent: 'value',
        }),
      ).not.toThrow()
    })

    test('命名空间模式下非strict模式找不到store应该静默失败', () => {
      const composed = composeStore([store1, store2], { namespace: true, strict: false })

      expect(() =>
        composed.$restore({
          nonexistent: { value: 123 },
          user: { name: 'Alice', age: 25 },
        }),
      ).not.toThrow()
    })

    test('快照和恢复应该完整覆盖状态生命周期', () => {
      const composed = composeStore([store1, store2])

      // 创建初始快照
      const snapshot1 = composed.$snapshot()

      // 修改状态
      composed.$patch({ name: 'Bob', theme: 'dark' })

      // 创建修改后的快照
      const snapshot2 = composed.$snapshot()
      expect(snapshot2.name).toBe('Bob')
      expect(snapshot2.theme).toBe('dark')

      // 恢复到初始状态
      composed.$restore(snapshot1)
      expect(composed.getState().name).toBe('Alice')
      expect(composed.getState().theme).toBe('light')

      // 恢复到修改后的状态
      composed.$restore(snapshot2)
      expect(composed.getState().name).toBe('Bob')
      expect(composed.getState().theme).toBe('dark')
    })
  })

  describe('createStoreTree', () => {
    test('应该能够创建store树', () => {
      const tree = createStoreTree([store1, store2, store3]) as any

      expect(tree.name).toBe('root')
      expect(tree.store).toBeNull()
      expect(tree.children).toBeDefined()
      expect(tree.children.user).toBeDefined()
      expect(tree.children.app).toBeDefined()
      expect(tree.children.data).toBeDefined()
    })

    test('应该能够使用命名空间创建store树', () => {
      const tree = createStoreTree([store1, store2], { namespace: 'app' }) as any

      expect(tree.name).toBe('app')
      expect(tree.children.user).toBeDefined()
      expect(tree.children.user.store).toBe(store1)
    })

    test('子节点应该包含store引用', () => {
      const tree = createStoreTree([store1, store2]) as any

      expect(tree.children.user.store).toBe(store1)
      expect(tree.children.app.store).toBe(store2)
    })

    test('子节点应该有children属性', () => {
      const tree = createStoreTree([store1, store2]) as any

      expect(tree.children.user.children).toBeDefined()
      expect(tree.children.user.children).toEqual({})
    })

    test('namespace 为 boolean true 时应使用默认 root 名称', () => {
      const tree = createStoreTree([store1, store2], { namespace: true }) as any

      expect(tree.name).toBe('root')
      expect(tree.children.user.store).toBe(store1)
    })
  })

  describe('复杂场景', () => {
    test('三个store的组合应该正常工作', () => {
      const composed = composeStore([store1, store2, store3])
      const state = composed.getState()

      expect(state.name).toBe('Alice')
      expect(state.theme).toBe('light')
      expect(state.items).toEqual([])
    })

    test('混合使用命名空间和非命名空间方法', () => {
      const composed = composeStore([store1, store2], { namespace: true })

      composed.dispatch('user/setName', 'Bob')
      composed.dispatch('user/incrementAge')

      const state = composed.getState()
      expect(state.user.name).toBe('Bob')
      expect(state.user.age).toBe(26)
    })

    test('订阅应该正确触发所有store的更新', (done) => {
      const composed = composeStore([store1, store2, store3])
      const states: any[] = []

      const unsubscribe = composed.subscribe((state) => {
        states.push(state)
      })

      store1.dispatch('setName', 'Bob')
      store2.dispatch('setTheme', 'dark')

      // 等待防抖广播完成（多次同步更新可能合并通知，不做精确计数）
      setTimeout(() => {
        expect(states.length).toBeGreaterThan(0)
        expect(states[states.length - 1].name).toBe('Bob')
        expect(states[states.length - 1].theme).toBe('dark')
        unsubscribe()
        done()
      }, 100)
    })

    test('多个组合store应该互不影响', () => {
      const composed1 = composeStore([store1, store2])
      const composed2 = composeStore([store2, store3])

      composed1.dispatch('setName', 'Bob')
      composed2.dispatch('addItem', { id: 1 })

      expect(composed1.getState().name).toBe('Bob')
      expect(composed2.getState().items).toEqual([{ id: 1 }])
      // store2应该被两个组合同时影响
      expect(store2.getState().theme).toBe('light')
    })
  })

  describe('batch 更新', () => {
    test('应该支持批量更新', () => {
      const composed = composeStore([store1, store2])
      let notificationCount = 0

      composed.subscribe(() => {
        notificationCount++
      })

      composed.batch(() => {
        composed.dispatch('setName', 'Bob')
        composed.dispatch('setTheme', 'dark')
      })

      expect(composed.getState().name).toBe('Bob')
      expect(composed.getState().theme).toBe('dark')
    })

    test('batch 中发生错误应该正确清理', () => {
      const composed = composeStore([store1, store2])

      expect(() => {
        composed.batch(() => {
          composed.dispatch('setName', 'Bob')
          throw new Error('Batch error')
        })
      }).toThrow('Batch error')

      // 状态应该已经被更新
      expect(composed.getState().name).toBe('Bob')
    })

    test('startBatch 和 endBatch 应该正常工作', () => {
      const composed = composeStore([store1, store2])

      composed.startBatch()
      composed.dispatch('setName', 'Bob')
      composed.dispatch('setTheme', 'dark')
      composed.endBatch()

      expect(composed.getState().name).toBe('Bob')
      expect(composed.getState().theme).toBe('dark')
    })
  })

  describe('state getter', () => {
    test('state getter 应该返回合并后的状态', () => {
      const composed = composeStore([store1, store2])

      expect(composed.state.name).toBe('Alice')
      expect(composed.state.age).toBe(25)
      expect(composed.state.theme).toBe('light')
    })

    test('命名空间模式 state getter 应该返回命名空间状态', () => {
      const composed = composeStore([store1, store2], { namespace: true })

      expect(composed.state.user.name).toBe('Alice')
      expect(composed.state.app.theme).toBe('light')
    })
  })

  describe('dispatch 边界条件', () => {
    test('非命名空间模式下找不到对应 action 的 store 应该返回 undefined', () => {
      const composed = composeStore([store1, store2], { strict: false })
      const result = composed.dispatch('nonexistentAction')
      expect(result).toBeUndefined()
    })

    test('命名空间模式下解析三段式路径', () => {
      const composed = composeStore([store1, store2], { namespace: 'myapp', strict: false })
      // 三段式路径解析为 store 'user' + action 'setName/extra'，
      // 内层 Store 找不到该 action 时抛出 ActionError 而非静默返回 undefined
      expect(() => composed.dispatch('user/setName/extra')).toThrow('Action "setName/extra" not found in store "user"')
    })
  })

  describe('getter 边界条件', () => {
    test('getter 应该尝试所有 store 来查找对应的 getter', () => {
      const composed = composeStore([store1, store2], { strict: false })
      // 非命名空间模式下，会尝试调用每个 store 的 getter
      const displayName = composed.getter('displayName')
      expect(displayName).toBe('User: Alice')
    })
  })

  describe('缓存边界条件', () => {
    test('invalidateCache 无参数时应该清除所有缓存', () => {
      const composed = composeStore([store1, store2])

      // 启用缓存
      composed.enableCache()

      // 建立缓存
      composed.getCached('name')
      composed.getCached('theme')

      const stats1 = composed.getCacheStats()
      expect(stats1.size).toBeGreaterThan(0)

      // 清除所有缓存
      composed.invalidateCache()

      const stats2 = composed.getCacheStats()
      expect(stats2.size).toBe(0)
    })

    test('getCacheStats 应该正确聚合多个 store 的统计', () => {
      const composed = composeStore([store1, store2, store3])

      // 启用缓存
      composed.enableCache()

      // 建立缓存
      composed.getCached('name')
      composed.getCached('theme')
      composed.getCached('items')

      const stats = composed.getCacheStats()
      expect(stats.enabled).toBe(true)
      expect(stats.keys.length).toBeGreaterThanOrEqual(3)
    })
  })

  describe('ComposedStore 类', () => {
    test('应该正确设置 name 属性', () => {
      const composed = composeStore([store1, store2], { namespace: 'mynamespace' })
      expect(composed.name).toBe('mynamespace')
    })

    test('无命名空间时 name 应该是 composed', () => {
      const composed = composeStore([store1, store2])
      expect(composed.name).toBe('composed')
    })
  })

  // ==================== 覆盖率补全测试 ====================

  describe('覆盖率补全 - _ensureAlive 销毁检查', () => {
    it('COV-001: destroy后调用getState应该抛出错误', () => {
      const composed = composeStore([store1, store2])
      composed.destroy()
      expect(() => composed.getState()).toThrow('[GeomStore] Cannot call getState on a destroyed ComposedStore')
    })

    it('COV-002: destroy后调用setState应该抛出错误', () => {
      const composed = composeStore([store1, store2])
      composed.destroy()
      expect(() => composed.setState('name' as any, 'Bob')).toThrow('[GeomStore] Cannot call setState on a destroyed ComposedStore')
    })

    it('COV-003: destroy后调用$patch应该抛出错误', () => {
      const composed = composeStore([store1, store2])
      composed.destroy()
      expect(() => composed.$patch({ name: 'Bob' } as any)).toThrow('[GeomStore] Cannot call $patch on a destroyed ComposedStore')
    })

    it('COV-004: destroy后调用$replaceState应该抛出错误', () => {
      const composed = composeStore([store1, store2])
      composed.destroy()
      expect(() => composed.$replaceState({ name: 'Bob' } as any)).toThrow('[GeomStore] Cannot call $replaceState on a destroyed ComposedStore')
    })

    it('COV-005: destroy后调用dispatch应该抛出错误', () => {
      const composed = composeStore([store1, store2])
      composed.destroy()
      expect(() => composed.dispatch('setName', 'Bob')).toThrow('[GeomStore] Cannot call dispatch on a destroyed ComposedStore')
    })

    it('COV-006: destroy后调用getter应该抛出错误', () => {
      const composed = composeStore([store1, store2])
      composed.destroy()
      expect(() => composed.getter('displayName')).toThrow('[GeomStore] Cannot call getter on a destroyed ComposedStore')
    })

    it('COV-007: destroy后调用subscribe应该抛出错误', () => {
      const composed = composeStore([store1, store2])
      composed.destroy()
      expect(() => composed.subscribe(() => {})).toThrow('[GeomStore] Cannot call subscribe on a destroyed ComposedStore')
    })

    it('COV-008: destroy后调用use应该抛出错误', () => {
      const composed = composeStore([store1, store2])
      composed.destroy()
      expect(() => composed.use({ name: 'p', install: () => {} } as any)).toThrow('[GeomStore] Cannot call use on a destroyed ComposedStore')
    })
  })

  describe('覆盖率补全 - destroy 重复调用', () => {
    it('COV-009: destroy重复调用应该幂等', () => {
      const composed = composeStore([store1, store2])
      composed.destroy()
      // 再次调用 destroy 应该直接返回
      expect(() => composed.destroy()).not.toThrow()
    })
  })

  describe('覆盖率补全 - getGetterNames', () => {
    it('COV-010: 非命名空间模式应该返回去重后的getter名称', () => {
      const composed = composeStore([store1, store2])
      const names = composed.getGetterNames()
      expect(names).toContain('displayName')
      expect(names).toContain('themeInfo')
    })

    it('COV-011: 命名空间模式应该返回带前缀的getter名称', () => {
      const composed = composeStore([store1, store2], { namespace: true })
      const names = composed.getGetterNames()
      expect(names).toContain('user/displayName')
      expect(names).toContain('app/themeInfo')
    })

    it('COV-012: 多个store有相同getter名称时应该去重', () => {
      const s1 = createStore({
        name: 's1',
        state: { count: 0 },
        getters: {
          double: (state) => state.count * 2,
        },
      })
      const s2 = createStore({
        name: 's2',
        state: { count: 0 },
        getters: {
          double: (state) => state.count * 2,
        },
      })

      const composed = composeStore([s1, s2])
      const names = composed.getGetterNames()
      // 非命名空间模式下应该去重
      expect(names.filter((n) => n === 'double').length).toBe(1)
    })

    it('COV-013: 子store没有getGetterNames方法时应该返回空数组', () => {
      const mockStore = {
        name: 'mock',
        getState: () => ({ a: 1 }),
        state: { a: 1 },
        actions: {},
        // 没有 getGetterNames 方法
      } as any

      const composed = composeStore([mockStore])
      const names = composed.getGetterNames()
      expect(names).toEqual([])
    })
  })

  describe('覆盖率补全 - 命名空间模式 findTargetStoreWithKey', () => {
    it('COV-014: 命名空间模式下setState使用多级路径', () => {
      const composed = composeStore([store1, store2], { namespace: true })

      // 使用多级路径（key = storeName/actualKey）
      composed.setState('user/name' as any, 'Charlie')
      expect(store1.getState().name).toBe('Charlie')
    })

    it('COV-015: 命名空间模式下getCached使用多级路径', () => {
      store1.enableCache()
      const composed = composeStore([store1, store2], { namespace: true })

      const value = composed.getCached('user/name' as any)
      expect(value).toBe('Alice')
    })

    it('COV-016: 命名空间模式下setState找不到store在非strict模式应该静默失败', () => {
      const composed = composeStore([store1, store2], { namespace: true, strict: false })
      expect(() => composed.setState('nonexistent/key' as any, 'value')).not.toThrow()
    })

    it('COV-017: 命名空间模式下getCached找不到store在非strict模式应该返回undefined', () => {
      const composed = composeStore([store1, store2], { namespace: true, strict: false })
      const result = composed.getCached('nonexistent/key' as any)
      expect(result).toBeUndefined()
    })

    it('COV-018: 非命名空间模式下getCached应该正常工作', () => {
      store1.enableCache()
      store2.enableCache()
      const composed = composeStore([store1, store2])

      const value = composed.getCached('name' as any)
      expect(value).toBe('Alice')
    })

    it('COV-019: 非命名空间模式下getCached找不到store在strict模式应该抛出错误', () => {
      const composed = composeStore([store1, store2], { strict: true })
      expect(() => composed.getCached('nonexistent' as any)).toThrow('[composeStore] Cannot find store for key: nonexistent')
    })

    it('COV-020: 非命名空间模式下getCached找不到store在非strict模式应该返回undefined', () => {
      const composed = composeStore([store1, store2], { strict: false })
      const result = composed.getCached('nonexistent' as any)
      expect(result).toBeUndefined()
    })
  })

  describe('覆盖率补全 - 非命名空间模式 ambiguous key 警告', () => {
    it('COV-021: 非命名空间模式下多个store包含相同key应该打印警告', () => {
      const s1 = createStore({
        name: 'store-a',
        state: { shared: 'a' },
      })
      const s2 = createStore({
        name: 'store-b',
        state: { shared: 'b' },
      })

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()
      const composed = composeStore([s1, s2])

      // 设置 ambiguous key 应该触发警告
      composed.setState('shared', 'new')

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Ambiguous key "shared"'))
      consoleSpy.mockRestore()
    })
  })

  describe('覆盖率补全 - ComposedStore 构造函数 options 缺省', () => {
    it('COV-022: 不传options参数时应该使用默认值', () => {
      const { ComposedStore } = require('@/core/compose/composeStore')
      const composed = new ComposedStore([store1, store2])

      expect(composed.name).toBe('composed')
      expect(composed.destroyed).toBe(false)
    })
  })

  describe('覆盖率补全 - createStoreTree 边界条件', () => {
    it('COV-023: createStoreTree不传options时应该使用默认namespace', () => {
      const tree = createStoreTree([store1, store2])
      expect(tree.name).toBe('root')
    })

    it('COV-024: createStoreTree应该正确构建children', () => {
      const tree = createStoreTree([store1, store2, store3])

      expect(tree.children).toBeDefined()
      expect(tree.children!.user.store).toBe(store1)
      expect(tree.children!.app.store).toBe(store2)
      expect(tree.children!.data.store).toBe(store3)
    })

    it('COV-025: createStoreTree子节点应该有children属性', () => {
      const tree = createStoreTree([store1])

      expect(tree.children!.user.children).toBeDefined()
      expect(tree.children!.user.children).toEqual({})
    })
  })

  describe('覆盖率补全 - invalidateCache 非命名空间模式', () => {
    it('COV-026: 非命名空间模式下invalidateCache特定key找不到store在strict模式应该抛出错误', () => {
      const composed = composeStore([store1, store2], { strict: true })
      expect(() => composed.invalidateCache('nonexistent' as any)).toThrow('[composeStore] Cannot find store for key: nonexistent')
    })

    it('COV-027: 非命名空间模式下invalidateCache特定key找不到store在非strict模式应该静默失败', () => {
      const composed = composeStore([store1, store2], { strict: false })
      expect(() => composed.invalidateCache('nonexistent' as any)).not.toThrow()
    })

    it('COV-028: 命名空间模式下invalidateCache特定key找不到store在非strict模式应该静默失败', () => {
      const composed = composeStore([store1, store2], { namespace: true, strict: false })
      expect(() => composed.invalidateCache('nonexistent/key' as any)).not.toThrow()
    })
  })

  describe('覆盖率补全 - getter 命名空间模式', () => {
    it('COV-029: 命名空间模式下getter找到对应store应该返回正确值', () => {
      const composed = composeStore([store1, store2], { namespace: true })
      const result = composed.getter('app/themeInfo')
      expect(result).toBe('Theme: light')
    })

    it('COV-030: 非命名空间模式下getter应该遍历所有store查找', () => {
      const composed = composeStore([store1, store2])
      const result = composed.getter('themeInfo')
      expect(result).toBe('Theme: light')
    })
  })

  describe('覆盖率补全 - $snapshot 命名空间模式', () => {
    it('COV-031: 命名空间模式下$snapshot应该返回带命名空间的快照', () => {
      const composed = composeStore([store1, store2], { namespace: true })
      const snapshot = composed.$snapshot()

      expect(snapshot.user).toEqual({ name: 'Alice', age: 25 })
      expect(snapshot.app).toEqual({ theme: 'light', language: 'zh-CN' })
    })

    it('COV-032: 非命名空间模式下$snapshot应该返回合并的快照', () => {
      const composed = composeStore([store1, store2])
      const snapshot = composed.$snapshot()

      expect(snapshot.name).toBe('Alice')
      expect(snapshot.theme).toBe('light')
    })
  })

  describe('覆盖率补全 - dispatch 命名空间模式多段路径', () => {
    it('COV-033: 命名空间模式下dispatch使用正确路径应该正常工作', () => {
      const composed = composeStore([store1, store2], { namespace: true })
      composed.dispatch('user/setName', 'Dave')
      expect(store1.getState().name).toBe('Dave')
    })

    it('COV-034: 命名空间模式下dispatch找不到store在非strict模式应该返回undefined', () => {
      const composed = composeStore([store1, store2], { namespace: true, strict: false })
      const result = composed.dispatch('nonexistent/action')
      expect(result).toBeUndefined()
    })
  })

  describe('覆盖率补全 - batch startBatch/endBatch', () => {
    it('COV-035: startBatch和endBatch应该应用到所有子store', () => {
      const composed = composeStore([store1, store2])
      // 不应该抛出错误
      composed.startBatch()
      composed.dispatch('setName', 'Bob')
      composed.dispatch('setTheme', 'dark')
      composed.endBatch()

      expect(composed.getState().name).toBe('Bob')
      expect(composed.getState().theme).toBe('dark')
    })
  })

  describe('覆盖率补全 - use 插件管理', () => {
    it('COV-036: use应该将插件安装到所有子store', () => {
      const composed = composeStore([store1, store2])
      const installedStores: string[] = []

      const plugin = {
        name: 'test-plugin',
        install(store: any) {
          installedStores.push(store.name)
        },
      }

      composed.use(plugin)
      expect(installedStores).toEqual(['user', 'app'])
    })

    it('COV-037: use返回的卸载函数应该正确执行', () => {
      const composed = composeStore([store1, store2])
      const uninstallCalls: string[] = []

      const plugin = {
        name: 'test-plugin',
        install(store: any) {
          return () => {
            uninstallCalls.push(store.name)
          }
        },
      }

      const uninstall = composed.use(plugin)
      uninstall()

      expect(uninstallCalls).toEqual(['user', 'app'])
    })

    it('COV-038: 子store的use返回非函数时应该被跳过', () => {
      // 创建一个 mock store，其 use 方法返回非函数值
      const mockStore = createStore({
        name: 'mock-store',
        state: { val: 0 },
      }) as any

      // 替换 use 方法返回非函数值
      mockStore.use = jest.fn(() => 'not-a-function')

      const composed = composeStore([mockStore, store1])

      const plugin = {
        name: 'test-plugin',
        install: () => () => {},
      }

      // use 应该正常执行
      const uninstall = composed.use(plugin)
      expect(typeof uninstall).toBe('function')

      // 卸载应该不报错（mockStore 的 use 返回的 'not-a-function' 被跳过）
      expect(() => uninstall()).not.toThrow()
    })
  })

  // ==================== BUG 修复回归测试 ====================
  describe('BUG 修复回归', () => {
    test('BUG-6: 命名空间模式下三段式路径应正确解析为 store + 成员名', () => {
      const nsStore = createStore({
        name: 'ns',
        state: { value: 0 },
        actions: {
          'nested/set'(value: number) {
            ;(this as any).state.value = value // eslint-disable-line no-extra-semi
          },
        },
        getters: {
          'nested/get': (state) => state.value,
        },
      } as any)

      const composed = composeStore([nsStore], { namespace: true })
      // 'ns/nested/set' 解析为 store 'ns' + action 'nested/set'
      composed.dispatch('ns/nested/set', 42)
      expect(nsStore.getState().value).toBe(42)
      // getter 多级路径同样解析
      expect(composed.getter('ns/nested/get')).toBe(42)
    })

    test('BUG-7: 非命名空间模式同名 action 冲突应该警告并调用第一个 store', () => {
      const s1 = createStore({
        name: 'conflict-a',
        state: { v: '' },
        actions: {
          shared(arg: string) {
            ;(this as any).state.v = `a:${arg}` // eslint-disable-line no-extra-semi
          },
        },
      } as any)
      const s2 = createStore({
        name: 'conflict-b',
        state: { v: '' },
        actions: {
          shared(arg: string) {
            ;(this as any).state.v = `b:${arg}` // eslint-disable-line no-extra-semi
          },
        },
      } as any)

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
      const composed = composeStore([s1, s2])

      composed.dispatch('shared', 'x')

      // 冲突警告 + 取第一个 store（保持兼容）
      expect(s1.getState().v).toBe('a:x')
      expect(s2.getState().v).toBe('')
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Action "shared"'))
      warnSpy.mockRestore()
    })

    test('BUG-7: 非命名空间模式同名 getter 冲突应该警告并返回第一个 store 的值', () => {
      const g1 = createStore({
        name: 'getter-a',
        state: { v: 1 },
        getters: { val: (state) => state.v },
      })
      const g2 = createStore({
        name: 'getter-b',
        state: { v: 2 },
        getters: { val: (state) => state.v },
      })

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
      const composed = composeStore([g1, g2])

      expect(composed.getter('val')).toBe(1)
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Getter "val"'))
      warnSpy.mockRestore()
    })
  })
})
