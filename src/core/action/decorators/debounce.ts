/**
 * GeomStore v1.0 - 防抖装饰器
 *
 * 延迟执行方法，如果在延迟时间内再次调用，则重置定时器
 *
 * 修复说明：原实现将 timeoutId / pendingResolves 等状态声明在工厂函数作用域，
 * 导致同一装饰器装饰的所有方法/实例共享同一份状态（闭包陷阱）。
 * 现改为按宿主对象（this）隔离状态，每个实例拥有独立的定时器与 pending 队列。
 *
 * @since 1.0.0
 */

/** 单个宿主对象的防抖状态 */
interface DebounceState {
  timeoutId: ReturnType<typeof setTimeout> | null
  pendingResolves: Array<(value: unknown) => void>
  pendingRejects: Array<(error: unknown) => void>
  pendingArgs: unknown[]
}

/**
 * 创建防抖装饰器
 *
 * 延迟执行方法，如果在延迟时间内再次调用，则重置定时器
 * 适用于搜索、输入框等场景
 *
 * @param {number} [delay=300] - 延迟时间（毫秒）
 * @returns {MethodDecorator} 方法装饰器
 *
 * @example
 * ```typescript
 * class SearchComponent {
 *   @withDebounce(500)
 *   async search(query: string) {
 *     return await searchAPI(query)
 *   }
 * }
 *
 * // 用户快速输入，只会在最后一次输入后500ms执行一次搜索
 * searchComponent.search('a')
 * searchComponent.search('ap')
 * searchComponent.search('app') // 只执行这次
 * ```
 */
export function withDebounce(delay: number = 300): MethodDecorator {
  // 按宿主对象隔离状态，避免多实例共享；使用 WeakMap 以便宿主被回收时自动清理。
  const store = new WeakMap<object, DebounceState>()

  const getState = (host: unknown): DebounceState => {
    // 宿主不是对象（如 undefined / 基本类型）时，用一个一次性本地状态兜底，
    // 保证不会跨调用串扰，也不影响装饰器主用例（类方法）。
    if (typeof host !== 'object' || host === null) {
      return {
        timeoutId: null,
        pendingResolves: [],
        pendingRejects: [],
        pendingArgs: [],
      }
    }
    let state = store.get(host)
    if (!state) {
      state = {
        timeoutId: null,
        pendingResolves: [],
        pendingRejects: [],
        pendingArgs: [],
      }
      store.set(host, state)
    }
    return state
  }

  return function (_target: unknown, _propertyKey: string | symbol, descriptor: PropertyDescriptor): PropertyDescriptor {
    const originalMethod = descriptor.value

    descriptor.value = function (this: unknown, ...args: unknown[]) {
      const state = getState(this)

      if (state.timeoutId) {
        clearTimeout(state.timeoutId)
      }

      state.pendingArgs = args

      return new Promise((resolve, reject) => {
        state.pendingResolves.push(resolve)
        state.pendingRejects.push(reject)

        state.timeoutId = setTimeout(async () => {
          const resolves = state.pendingResolves
          const rejects = state.pendingRejects
          const runArgs = state.pendingArgs
          // 清空 pending 队列与定时器引用，防止重复结算
          state.pendingResolves = []
          state.pendingRejects = []
          state.pendingArgs = []
          state.timeoutId = null
          try {
            const result = await originalMethod.apply(this, runArgs.length ? runArgs : args)
            resolves.forEach((r) => r(result))
          } catch (error) {
            rejects.forEach((r) => r(error))
          }
        }, delay)
      })
    }

    return descriptor
  }
}
