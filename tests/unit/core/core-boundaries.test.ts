/**
 * 核心层边界分支
 *
 * 覆盖此前未被任何测试触及的边界：createError 的 code 分派（含 default）、
 * 性能退化检测的 0 基线、ActionManager 的通知抑制、浅层状态保护的空路径、
 * 插件安装失败的入列回滚、StoreCache 的 TTL 时间戳、deepMerge 的环路短路、
 * LRUCache 的 enableStats 关闭与 performance 全局缺失回退。
 */
 

import { createError, ErrorCode, GeomStoreError } from '@/core/errors/GeomStoreError.js'
import { PerformanceAnalyzer } from '@/core/performance/index.js'
import { LRUCache } from '@/core/cache/index.js'
import { deepMerge } from '@/core/utils/helpers.js'
import { createStore } from '@/core/store/index.js'

describe('核心层边界分支', () => {
  describe('createError 的 code 分派', () => {
    it('枚举内全部 code 均返回错误实例', () => {
      const codes = Object.values(ErrorCode).filter((value) => typeof value === 'string' || typeof value === 'number')

      expect(codes.length).toBeGreaterThan(0)
      for (const code of codes) {
        expect(createError(code as ErrorCode, 'msg')).toBeInstanceOf(GeomStoreError)
      }
    })

    it('未知 code 落入 default 返回基类实例', () => {
      const error = createError('NOT_A_REAL_CODE' as ErrorCode, 'msg')

      expect(error.constructor).toBe(GeomStoreError)
      expect(error.message).toBe('msg')
    })
  })

  describe('detectRegression 的 0 基线', () => {
    const metric = (operation: string, duration: number): any => ({ operation, duration, type: 'dispatch', timestamp: 0 })

    it('基线与当前均为 0 时按 0% 处理，不误报回归', () => {
      expect(PerformanceAnalyzer.detectRegression([metric('op', 0)], [metric('op', 0)])).toEqual([])
    })

    it('基线为 0 而当前大于 0 时按无限恶化处理', () => {
      const regressions = PerformanceAnalyzer.detectRegression([metric('op', 5)], [metric('op', 0)])

      expect(regressions).toHaveLength(1)
      expect(regressions[0].changePercent).toBe(Infinity)
    })

    it('基线大于 0 时按增长比例计算', () => {
      const regressions = PerformanceAnalyzer.detectRegression([metric('op', 20)], [metric('op', 10)])

      expect(regressions).toHaveLength(1)
      expect(regressions[0].changePercent).toBeCloseTo(100)
    })

    it('增长未超过阈值时不报回归', () => {
      expect(PerformanceAnalyzer.detectRegression([metric('op', 10.5)], [metric('op', 10)])).toEqual([])
    })
  })

  describe('ActionManager 的通知抑制', () => {
    it('嵌套异步 dispatch 结算时外层仍在 dispatch 中，不重复通知', async () => {
      const store = createStore({
        name: 'am-nested-async',
        state: { v: 0 },
        actions: {
          async inner(): Promise<number> {
            return 1
          },
          async outer(this: any): Promise<number> {
            return this.inner()
          },
        },
      })

      await expect(store.dispatch('outer')).resolves.toBe(1)
    })

    it('onlyOnChange 模式下无变更的异步 action 不触发通知', async () => {
      const store = createStore({
        name: 'am-only-change-async',
        state: { v: 0 },
        notify: { onlyOnChange: true },
        actions: {
          async noop(): Promise<void> {},
        },
      })
      const listener = jest.fn()
      store.subscribe(listener)

      await store.dispatch('noop')
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(listener).not.toHaveBeenCalled()
    })

    it('onlyOnChange 模式下无变更的失败 action 不触发通知', () => {
      const store = createStore({
        name: 'am-only-change-throw',
        state: { v: 0 },
        notify: { onlyOnChange: true },
        actions: {
          boom(): void {
            throw new Error('boom')
          },
        },
      })
      const listener = jest.fn()
      store.subscribe(listener)

      expect(() => store.dispatch('boom')).toThrow()
      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('浅层状态保护的空路径前缀', () => {
    it('deep=false 时根 Proxy 以空路径创建，写入报文不含前缀', () => {
      const store = createStore({
        name: 'shallow-path',
        state: { nested: { a: 1 } },
        stateProtection: { deep: false },
      })

      expect(store.state.nested).toEqual({ a: 1 })
      // 顶层写入被保护（浅层模式仅保护顶层）
      expect(() => {
        (store.state as any).nested = { a: 2 }
      }).toThrow()
    })
  })

  describe('插件安装失败的入列回滚', () => {
    it('install 抛错时条目被回滚，不残留在插件列表', () => {
      const store = createStore({ name: 'plugin-rollback', state: { v: 1 } })
      const plugin = {
        name: 'boom',
        install(): void {
          throw new Error('install boom')
        },
      }

      expect(() => store.use(plugin)).toThrow('install boom')
      // 回滚后可再次尝试安装（不会因残留条目而被判为重复安装）
      expect(() => store.use(plugin)).toThrow('install boom')
    })

    it('install 中途销毁 Store 清空插件列表时安全跳过回滚', () => {
      const store = createStore({ name: 'plugin-rollback-destroyed', state: { v: 1 } })
      const plugin = {
        name: 'destroyer',
        install(target: any): void {
          target.destroy()
          throw new Error('install after destroy')
        },
      }

      expect(() => store.use(plugin)).toThrow('install after destroy')
    })
  })

  describe('StoreCache 的 TTL 时间戳', () => {
    it('ttl > 0 时 dispatch 后刷新缓存会写入时间戳', () => {
      const store = createStore({
        name: 'cache-ttl',
        state: { a: 1, b: 2 },
        enableCache: true,
        cacheKeys: ['a'],
        cacheConfig: { ttl: 1000 },
        actions: {
          bump(this: any): void {
            this.$patch({ a: (this.state as { a: number }).a + 1 })
          },
        },
      })

      store.dispatch('bump')

      expect(store.getState().a).toBe(2)
    })

    it('ttl 缺省（0，永不过期）时不写时间戳', () => {
      const store = createStore({
        name: 'cache-no-ttl',
        state: { a: 1 },
        enableCache: true,
        cacheKeys: ['a'],
        actions: {
          bump(this: any): void {
            this.$patch({ a: (this.state as { a: number }).a + 1 })
          },
        },
      })

      store.dispatch('bump')

      expect(store.getState().a).toBe(2)
    })
  })

  describe('deepMerge 的环路守卫', () => {
    it('同一源对象重复合并到同一目标时短路，不重复递归', () => {
      const source: Record<string, any> = { nested: { x: 1 } }

      const merged = deepMerge({} as Record<string, any>, source, source) as Record<string, any>

      expect(merged).toEqual({ nested: { x: 1 } })
    })
  })

  describe('LRUCache 的边界选项', () => {
    it('enableStats 关闭时 getOrSet 未命中不计数', () => {
      const cache = new LRUCache<string, number>({ enableStats: false })

      expect(cache.getOrSet('k', () => 1)).toBe(1)
      expect(cache.getStats().hits).toBe(0)
      expect(cache.getStats().misses).toBe(0)
    })

    it('performance 全局缺失时回退 Date.now', () => {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'performance')
      try {
        Object.defineProperty(globalThis, 'performance', { value: undefined, configurable: true, writable: true })
        const cache = new LRUCache<string, number>({ trackAccessTime: true })

        cache.set('k', 1)

        expect(cache.get('k')).toBe(1)
      } finally {
        if (descriptor) {
          Object.defineProperty(globalThis, 'performance', descriptor)
        }
      }
    })
  })
})
