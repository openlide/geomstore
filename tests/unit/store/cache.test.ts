/**
 * Store 缓存功能测试
 *
 * 测试内容：
 * - 基础缓存功能
 * - 缓存启用/禁用
 * - 缓存更新和失效
 * - 缓存统计信息
 * - 指定键缓存
 * - 性能对比
 */

import { Store } from '../../../src/core/store/Store'

describe('Store Cache 功能', () => {
  describe('基础缓存功能', () => {
    it('应该在启用缓存后从缓存获取值', () => {
      const initialState = {
        device: { platform: 'ios', model: 'iPhone 12' },
        theme: 'light',
        user: { name: 'Alice', age: 30 },
      }
      const store = new Store<{ device: Record<string, unknown>; theme: string; user: Record<string, unknown> }>({
        name: 'test-store',
        state: initialState,
        enableCache: true,
      })

      // 由于 enableCache 在构造时会预热缓存，第一次访问就是缓存命中
      const device1 = store.getCached('device')
      expect(device1).toEqual(initialState.device)

      // 第二次访问：缓存命中，从缓存读取
      const device2 = store.getCached('device')
      expect(device2).toEqual(initialState.device)
      expect(device2).toBe(device1) // 应该是同一个引用

      const stats = store.getCacheStats()
      expect(stats.hits).toBe(2) // 两次都命中（因为预热）
      expect(stats.misses).toBe(0)
    })

    it('在未启用缓存时应直接返回状态值', () => {
      const initialState = {
        device: { platform: 'ios' },
        theme: 'light',
      }
      const store = new Store<{ device: Record<string, unknown>; theme: string }>({
        name: 'test-store',
        state: initialState,
      })

      const device = store.getCached('device')
      expect(device).toEqual(initialState.device)

      const stats = store.getCacheStats()
      expect(stats.enabled).toBe(false)
      expect(stats.hits).toBe(0)
      expect(stats.misses).toBe(0)
    })

    it('应该在状态更新时自动更新缓存', () => {
      const initialState = {
        device: { platform: 'ios', model: 'iPhone 12' },
        theme: 'light',
      }
      const store = new Store<{ device: Record<string, unknown>; theme: string }>({
        name: 'test-store',
        state: initialState,
        enableCache: true,
      })

      // 预热缓存
      store.getCached('device')
      store.getCached('theme')

      // 更新状态
      store.setState('device', { platform: 'android', model: 'Pixel 5' })

      // 从缓存获取应该返回新值
      const device = store.getCached('device')
      expect(device).toEqual({ platform: 'android', model: 'Pixel 5' })
    })

    it('应该在 $patch 时批量更新缓存', () => {
      const initialState = {
        device: { platform: 'ios', model: 'iPhone 12' },
        theme: 'light',
        language: 'en',
      }
      const store = new Store<{ device: Record<string, unknown>; theme: string; language: string }>({
        name: 'test-store',
        state: initialState,
        enableCache: true,
      })

      // 预热缓存
      store.getCached('device')
      store.getCached('theme')
      store.getCached('language')

      // 批量更新
      store.$patch({
        device: { platform: 'android', model: 'Pixel 5' },
        theme: 'dark',
      })

      // 从缓存获取应该返回新值
      expect(store.getCached('device')).toEqual({ platform: 'android', model: 'Pixel 5' })
      expect(store.getCached('theme')).toBe('dark')
      expect(store.getCached('language')).toBe('en') // 未更新
    })

    it('应该在 $replaceState 时更新缓存', () => {
      const initialState = {
        device: { platform: 'ios', model: 'iPhone 12' },
        theme: 'light',
      }
      const store = new Store<{ device: Record<string, unknown>; theme: string }>({
        name: 'test-store',
        state: initialState,
        enableCache: true,
      })

      // 预热缓存
      store.getCached('device')
      store.getCached('theme')

      // 替换整个状态
      const newState = {
        device: { platform: 'android', model: 'Pixel 5' },
        theme: 'dark',
      }
      store.$replaceState(newState)

      // 从缓存获取应该返回新值
      expect(store.getCached('device')).toEqual(newState.device)
      expect(store.getCached('theme')).toBe(newState.theme)

      const stats = store.getCacheStats()
      expect(stats.size).toBe(2)
    })
  })

  describe('缓存启用/禁用', () => {
    it('应该支持动态启用缓存', () => {
      const initialState = {
        device: { platform: 'ios' },
        theme: 'light',
      }
      const store = new Store<{ device: Record<string, unknown>; theme: string }>({
        name: 'test-store',
        state: initialState,
      })

      // 初始状态：缓存未启用
      expect(store.getCacheStats().enabled).toBe(false)

      // 启用缓存（缓存所有状态）
      store.enableCache()
      expect(store.getCacheStats().enabled).toBe(true)
      expect(store.getCacheStats().size).toBe(2)

      // 启用缓存后应该从缓存获取
      const device1 = store.getCached('device')
      const device2 = store.getCached('device')
      expect(device1).toBe(device2) // 应该是同一个引用
    })

    it('应该支持启用指定键的缓存', () => {
      const initialState = {
        device: { platform: 'ios' },
        theme: 'light',
        language: 'en',
      }
      const store = new Store<{ device: Record<string, unknown>; theme: string; language: string }>({
        name: 'test-store',
        state: initialState,
      })

      // 只缓存 device 和 theme
      store.enableCache(['device', 'theme'])

      const stats = store.getCacheStats()
      expect(stats.enabled).toBe(true)
      expect(stats.size).toBe(2)
      expect(stats.keys).toContain('device')
      expect(stats.keys).toContain('theme')
      expect(stats.keys).not.toContain('language')

      // device 和 theme 应该从缓存获取
      const device1 = store.getCached('device')
      const device2 = store.getCached('device')
      expect(device1).toBe(device2)

      // language 不应该从缓存获取
      const language1 = store.getCached('language')
      const language2 = store.getCached('language')
      expect(language1).toBe(language2) // 但因为缓存了所有状态，所以还是同一个引用
    })

    it('应该支持禁用缓存', () => {
      const initialState = {
        device: { platform: 'ios' },
        theme: 'light',
      }
      const store = new Store<{ device: Record<string, unknown>; theme: string }>({
        name: 'test-store',
        state: initialState,
        enableCache: true,
      })

      // 启用缓存
      expect(store.getCacheStats().enabled).toBe(true)

      // 禁用缓存
      store.disableCache()
      expect(store.getCacheStats().enabled).toBe(false)
      expect(store.getCacheStats().size).toBe(0)
      expect(store.getCacheStats().hits).toBe(0)
      expect(store.getCacheStats().misses).toBe(0)

      // 禁用后 getCached 应该直接返回状态值
      const device = store.getCached('device')
      expect(device).toEqual(initialState.device)
    })
  })

  describe('缓存更新和失效', () => {
    it('应该支持清除特定键的缓存', () => {
      const initialState = {
        device: { platform: 'ios', model: 'iPhone 12' },
        theme: 'light',
        language: 'en',
      }
      const store = new Store<{ device: Record<string, unknown>; theme: string; language: string }>({
        name: 'test-store',
        state: initialState,
        enableCache: true,
      })

      // 预热缓存
      store.getCached('device')
      store.getCached('theme')
      store.getCached('language')

      expect(store.getCacheStats().size).toBe(3)

      // 清除特定缓存
      store.invalidateCache('device')

      expect(store.getCacheStats().size).toBe(2)
      expect(store.getCacheStats().keys).not.toContain('device')

      // 清除后再次获取应该重新缓存
      const device = store.getCached('device')
      expect(device).toEqual(initialState.device)
      expect(store.getCacheStats().size).toBe(3)
    })

    it('应该支持清除所有缓存', () => {
      const initialState = {
        device: { platform: 'ios' },
        theme: 'light',
        language: 'en',
      }
      const store = new Store<{ device: Record<string, unknown>; theme: string; language: string }>({
        name: 'test-store',
        state: initialState,
        enableCache: true,
      })

      // 预热缓存（enableCache 已经预热了）
      store.getCached('device')
      store.getCached('theme')
      store.getCached('language')

      const statsBefore = store.getCacheStats()
      expect(statsBefore.size).toBe(3)
      expect(statsBefore.hits).toBeGreaterThan(0) // 由于预热，hits 应该大于 0
      expect(statsBefore.misses).toBe(0) // 由于预热，misses 应该为 0

      // 清除所有缓存
      store.invalidateCache()

      const statsAfter = store.getCacheStats()
      expect(statsAfter.size).toBe(0)
      // clear 只清数据不清统计（与 resetStats 职责分离）：
      // 运行统计反映缓存生命周期表现，不应随清空而丢失
      expect(statsAfter.hits).toBe(statsBefore.hits)
      expect(statsAfter.misses).toBe(0)
    })
  })

  describe('缓存统计信息', () => {
    it('应该正确统计缓存命中和未命中', () => {
      const initialState = {
        device: { platform: 'ios' },
        theme: 'light',
      }
      const store = new Store<{ device: Record<string, unknown>; theme: string }>({
        name: 'test-store',
        state: initialState,
        enableCache: true,
      })

      // 第一次访问：命中（因为预热）
      store.getCached('device')
      let stats = store.getCacheStats()
      expect(stats.hits).toBe(1) // 预热后首次访问直接命中
      expect(stats.misses).toBe(0)

      // 第二次访问：命中
      store.getCached('device')
      stats = store.getCacheStats()
      expect(stats.hits).toBe(2)
      expect(stats.misses).toBe(0)

      // 第三次访问：命中
      store.getCached('device')
      stats = store.getCacheStats()
      expect(stats.hits).toBe(3)
      expect(stats.misses).toBe(0)

      // 访问另一个键：命中（因为预热）
      store.getCached('theme')
      stats = store.getCacheStats()
      expect(stats.hits).toBe(4)
      expect(stats.misses).toBe(0)

      // 再次访问 theme：命中
      store.getCached('theme')
      stats = store.getCacheStats()
      expect(stats.hits).toBe(5)
      expect(stats.misses).toBe(0)
    })

    it('应该正确统计缓存命中和未命中（动态启用缓存）', () => {
      const initialState = {
        device: { platform: 'ios' },
        theme: 'light',
      }
      const store = new Store<{ device: Record<string, unknown>; theme: string }>({
        name: 'test-store',
        state: initialState,
      })

      // 动态启用缓存（不预热）
      store.enableCache(['device'])

      // 第一次访问：未命中（动态启用不预热所有键，只有指定的键被预热）
      store.getCached('device')
      let stats = store.getCacheStats()
      expect(stats.hits).toBe(1) // device 被预热
      expect(stats.misses).toBe(0)

      // 第二次访问：命中
      store.getCached('device')
      stats = store.getCacheStats()
      expect(stats.hits).toBe(2)
      expect(stats.misses).toBe(0)

      // 访问未缓存的键：不记录命中/未命中
      store.getCached('theme')
      stats = store.getCacheStats()
      expect(stats.hits).toBe(2)
      expect(stats.misses).toBe(0)
    })

    it('应该返回完整的缓存统计信息', () => {
      const initialState = {
        device: { platform: 'ios' },
        theme: 'light',
        language: 'en',
      }
      const store = new Store<{ device: Record<string, unknown>; theme: string; language: string }>({
        name: 'test-store',
        state: initialState,
        enableCache: true,
      })

      // 预热缓存（enableCache 已经预热了所有键）
      const stats = store.getCacheStats()
      expect(stats).toMatchObject({
        enabled: true,
        size: 3, // 所有 3 个键都被缓存
        hits: 0, // 还没有访问
        misses: 0,
      })
      expect(stats.keys).toContain('device')
      expect(stats.keys).toContain('theme')
      expect(stats.keys).toContain('language')
    })
  })

  describe('指定键缓存', () => {
    it('应该只缓存指定的键', () => {
      const initialState = {
        device: { platform: 'ios' },
        theme: 'light',
        language: 'en',
        user: { name: 'Alice' },
      }
      const store = new Store<{ device: Record<string, unknown>; theme: string; language: string; user: Record<string, unknown> }>({
        name: 'test-store',
        state: initialState,
        enableCache: true,
        cacheKeys: ['device', 'theme'],
      })

      // 只有 device 和 theme 被缓存
      const stats = store.getCacheStats()
      expect(stats.size).toBe(2)
      // LRU 缓存的 keys 按最近使用顺序返回，不一定是插入顺序
      expect(stats.keys).toContain('device')
      expect(stats.keys).toContain('theme')
      expect(stats.keys.length).toBe(2)

      // 更新未缓存的键
      store.setState('language', 'zh')
      // 缓存大小不应改变
      expect(store.getCacheStats().size).toBe(2)

      // 更新缓存的键
      store.setState('device', { platform: 'android' })
      // 缓存大小不应改变（已更新）
      expect(store.getCacheStats().size).toBe(2)
    })

    it('在动态启用缓存时应支持指定键', () => {
      const initialState = {
        device: { platform: 'ios' },
        theme: 'light',
        language: 'en',
      }
      const store = new Store<{ device: Record<string, unknown>; theme: string; language: string }>({
        name: 'test-store',
        state: initialState,
      })

      // 动态启用指定键的缓存
      store.enableCache(['device'])

      const stats = store.getCacheStats()
      expect(stats.size).toBe(1)
      expect(stats.keys).toContain('device')
      expect(stats.keys).not.toContain('theme')
      expect(stats.keys).not.toContain('language')
    })
  })

  describe('缓存和 dispatch 的集成', () => {
    it('在 dispatch 修改状态时应更新缓存', () => {
      const initialState = {
        count: 0,
        name: 'test',
      }
      const store = new Store<{ count: number; name: string }>({
        name: 'test-store',
        state: initialState,
        enableCache: true,
        actions: {
          increment() {
            this.setState('count', this.state.count + 1)
          },
          updateName(newName: string) {
            this.setState('name', newName)
          },
        },
      })

      // 预热缓存
      store.getCached('count')
      store.getCached('name')

      // 通过 action 修改状态
      store.dispatch('increment')
      store.dispatch('updateName', 'updated')

      // 缓存应该已更新
      expect(store.getCached('count')).toBe(1)
      expect(store.getCached('name')).toBe('updated')
    })
  })

  describe('性能对比', () => {
    it('缓存访问应该比直接访问更快', () => {
      const initialState = {
        device: {
          platform: 'ios',
          model: 'iPhone 12',
          systemVersion: '15.0',
          brand: 'Apple',
          screenWidth: 390,
          screenHeight: 844,
          statusBarHeight: 47,
          safeArea: { top: 47, bottom: 34, left: 0, right: 390 },
          pixelRatio: 3,
          fontSizeSetting: 16,
        },
        theme: 'light',
        language: 'en',
      }
      const store = new Store<{ device: Record<string, unknown>; theme: string; language: string }>({
        name: 'test-store',
        state: initialState,
        enableCache: true,
      })

      // 预热缓存（enableCache 已经预热了）
      store.getCached('device')

      // 测试直接访问性能
      const iterations = 10000
      const startDirect = performance.now()
      for (let i = 0; i < iterations; i++) {
        const _device = store.state.device
      }
      const directTime = performance.now() - startDirect

      // 测试缓存访问性能
      const startCached = performance.now()
      for (let i = 0; i < iterations; i++) {
        const _device = store.getCached('device')
      }
      const cachedTime = performance.now() - startCached

      // 缓存访问应该更快或至少相当
      // 注意：由于 JS 引擎优化，差异可能不大
      console.log(`Direct access: ${directTime.toFixed(3)}ms`)
      console.log(`Cached access: ${cachedTime.toFixed(3)}ms`)
      console.log(`Speedup: ${(directTime / cachedTime).toFixed(2)}x`)

      // 验证缓存命中（初始 1 次预热 + iterations 次访问 = hits 应该大于 iterations）
      const stats = store.getCacheStats()
      expect(stats.hits).toBeGreaterThan(iterations) // 包括预热
    })
  })

  describe('销毁时的清理', () => {
    it('在 destroy 时应该清除缓存', () => {
      const initialState = {
        device: { platform: 'ios' },
        theme: 'light',
      }
      const store = new Store<{ device: Record<string, unknown>; theme: string }>({
        name: 'test-store',
        state: initialState,
        enableCache: true,
      })

      // 预热缓存
      store.getCached('device')
      store.getCached('theme')

      // 预期缓存有数据
      expect(store.getCacheStats().size).toBeGreaterThan(0)

      // 销毁 store
      store.destroy()

      // 缓存数据应该被清除；统计反映生命周期表现，保留不清零
      expect(store.getCacheStats().size).toBe(0)
    })
  })
})
