import { Store } from './Store'
import type { StoreOptions, State, Actions, Getters } from '../../types/store'

/**
 * 创建 Store 实例，支持完整的类型推断
 *
 * 独立于根入口存放，避免集成层（integrations）反向依赖根入口形成循环引用。
 *
 * @param options - Store 配置项，包含 state、actions、getters
 * @returns 返回新建的 Store 实例，类型完整推断
 *
 * @example
 * ```typescript
 * // 完整类型推断示例
 * const store = createStore({
 *   state: { count: 0, name: 'test' },
 *   actions: {
 *     // action 通过 this.state 读写状态，参数为调用时传入的用户参数
 *     increment() { this.state.count++ },
 *     add(n: number) { this.state.count += n }
 *   },
 *   getters: {
 *     double(state) { return state.count * 2 },
 *     greeting(state) { return `Hello, ${state.name}` }
 *   }
 * })
 *
 * // 类型推断：
 * store.dispatch('add', 10)      // 参数类型自动推断为 number
 * store.dispatch('increment')    // 无参数 action
 * const doubled = store.getter('double')  // 返回类型自动推断为 number
 * const msg = store.getter('greeting')    // 返回类型自动推断为 string
 * ```
 */
export function createStore<S extends State, A extends Actions = Actions, G extends Getters<S> = Getters<S>>(options: StoreOptions<S, A, G>): Store<S, A, G> {
  return new Store(options) as Store<S, A, G>
}
