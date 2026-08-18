import { Store } from './Store'
import type { StoreConfig, State, Actions, Getters } from '../../types/store'

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
 * // ✅ 免泛型自动推导（推荐）：类型由字面量自动推断
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

/**
 * 创建 Store 实例 - 免泛型自动推导（推荐）
 *
 * 设计要点：
 * - `S` / `A` / `G` 均作为独立泛型参数，由 `StoreConfig` 的
 *   state / actions / getters 字面量直接推断，无需 Infer* 反推工具，
 *   避免自引用循环导致退化为 object / unknown。
 * - `state` 通过**函数重载**提供两种形态，各自精确推断：
 *   1. 工厂函数 `state: () => S`（Pinia 同款，避免共享引用 / 惰性初始化）
 *   2. 对象字面量 `state: S`
 * - 工厂重载置于对象重载之前：函数类型本身可赋给 `State`（object），
 *   若顺序颠倒，`state: () => ({...})` 会被对象重载误判为 `S` 即函数类型，
 *   导致 getter / action 上下文退化。重载前置后 `S` 直接收敛为工厂函数
 *   的返回值类型，getter 上下文因此获得精确的 State 类型，彻底去除隐式 any。
 * - 重载配置通过 `Omit<StoreConfig, 'state'>` 剥离 `state` 后再固定其类型，
 *   避免与 `StoreConfig.state?: S` 交叉成 `S & (() => S)` 引发推断歧义。
 */
/**
 * 工厂函数形式配置：state 类型固定为 `() => S`。
 * 必须用 Omit 剥离 `StoreConfig.state?: S`——否则与 `{ state: () => S }` 交集
 * 成 `S & (() => S)`，S 从两个位置产生冲突候选（函数与返回值），
 * 导致 getter 上下文中 `ResolveState<S>` 退化为 `(() => S) | S`。
 */
type FactoryStoreConfig<S extends State, A extends Actions = Actions, G extends Getters<S> = Getters<S>> = Omit<StoreConfig<S, A, G>, 'state'> & {
  state: () => S
}

/** 对象字面量形式配置：state 类型固定为 `S` */
type LiteralStoreConfig<S extends State, A extends Actions = Actions, G extends Getters<S> = Getters<S>> = Omit<StoreConfig<S, A, G>, 'state'> & { state: S }

// 重载 1：state 工厂函数形式（state: () => S）
export function createStore<S extends State, A extends Actions = Actions, G extends Getters<S> = Getters<S>>(
  options: FactoryStoreConfig<S, A, G>,
): Store<S, A, G>

// 重载 2：state 对象字面量形式（state: S）
export function createStore<S extends State, A extends Actions = Actions, G extends Getters<S> = Getters<S>>(
  options: LiteralStoreConfig<S, A, G>,
): Store<S, A, G>

// 实现签名（对外不可见，仅需兼容上述重载）
export function createStore<S extends State, A extends Actions = Actions, G extends Getters<S> = Getters<S>>(
  options: Omit<StoreConfig<S | (() => S), A, G>, 'state'> & { state: S | (() => S) },
): Store<S, A, G> {
  return new Store(options)
}
