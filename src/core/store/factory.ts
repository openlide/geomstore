import { Store } from './Store.js'
import type { StoreConfig, State, Actions, Getters } from '../../types/store.js'

// createStore 的设计要点。写成行注释而非 JSDoc：只有紧邻声明的 JSDoc 会被
// IDE/typedoc 绑定，此前三块文档叠在 type FactoryStoreConfig 之上，下面两块
// 永远取不到（悬空注释），故把不绑定单一声明的部分降级为普通注释，
// 把使用文档移到重载之上（见下方 overload 1）。
//
// 设计要点：
// - `S` / `A` / `G` 均作为独立泛型参数，由 `StoreConfig` 的
//   state / actions / getters 字面量直接推断，无需 Infer* 反推工具，
//   避免自引用循环导致退化为 object / unknown。
// - `state` 通过**函数重载**提供两种形态，各自精确推断：
//   1. 工厂函数 `state: () => S`（Pinia 同款，避免共享引用 / 惰性初始化）
//   2. 对象字面量 `state: S`
// - 工厂重载置于对象重载之前：函数类型本身可赋给 `State`（object），
//   若顺序颠倒，`state: () => ({...})` 会被对象重载误判为 `S` 即函数类型，
//   导致 getter / action 上下文退化。重载前置后 `S` 直接收敛为工厂函数
//   的返回值类型，getter 上下文因此获得精确的 State 类型，彻底去除隐式 any。
// - 重载配置通过 `Omit<StoreConfig, 'state'>` 剥离 `state` 后再固定其类型，
//   避免与 `StoreConfig.state?: S` 交叉成 `S & (() => S)` 引发推断歧义。
//
// 显式泛型调用 `createStore<AppState>({...})` 的已知限制（TypeScript 语义，非本库缺陷）：
// 类型参数只要显式给出一个，其余未给出的就落到默认值而**不参与推断**——`A` 退化为
// `Actions`（`keyof A` 塌成 string）、`G` 退化为 `Getters<S>`。因此该写法下
// `dispatch('拼错的action')` 不再报错、`getter('x')` 退化为 unknown，
// 失去上面两型别名的全部约束。需要精确的 action/getter 类型请省略泛型、
// 由 state/actions/getters 字面量反推（推荐写法），或显式写全三个类型参数。

/**
 * 三处签名共用的基座：`StoreConfig` 剥掉 `state` 之后的形状。
 *
 * `state` 的形态是重载唯一要改的东西，其余选项必须逐字一致；同一表达式各写一遍
 * （此前是两个重载配置 + 实现签名共三处）等于给「改一处漏两处」留口子——StoreConfig
 * 一旦调整 state 的处理方式，漏改的那处会静默漂移（多带/少带一个选项编译器都不报）。
 *
 * 不加类型参数约束：`StoreConfig` 自身三个参数都无约束，实现签名要用
 * `S | (() => S)` 实例化它（`Getters<S>` 装不进 `Getters<S | (() => S)>` 的逆变位），
 * 在这里补约束会把那条实例化挡掉。约束由各使用处的签名声明负责。
 */
type StoreConfigWithoutState<S, A, G> = Omit<StoreConfig<S, A, G>, 'state'>

/**
 * 工厂函数形式配置：state 类型固定为 `() => S`。
 * 必须用 Omit 剥离 `StoreConfig.state?: S`——否则与 `{ state: () => S }` 交集
 * 成 `S & (() => S)`，S 从两个位置产生冲突候选（函数与返回值），
 * 导致 getter 上下文中 `ResolveState<S>` 退化为 `(() => S) | S`。
 */
type FactoryStoreConfig<S extends State, A extends Actions = Actions, G extends Getters<S> = Getters<S>> = StoreConfigWithoutState<S, A, G> & {
  state: () => S
}

/** 对象字面量形式配置：state 类型固定为 `S` */
type LiteralStoreConfig<S extends State, A extends Actions = Actions, G extends Getters<S> = Getters<S>> = StoreConfigWithoutState<S, A, G> & { state: S }

// 重载 1：state 工厂函数形式（state: () => S）
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
export function createStore<S extends State, A extends Actions = Actions, G extends Getters<S> = Getters<S>>(
  options: FactoryStoreConfig<S, A, G>,
): Store<S, A, G>

// 重载 2：state 对象字面量形式（state: S）
export function createStore<S extends State, A extends Actions = Actions, G extends Getters<S> = Getters<S>>(
  options: LiteralStoreConfig<S, A, G>,
): Store<S, A, G>

// 实现签名（对外不可见，仅需兼容上述重载）。state 取两种形状的并集，
// 其余选项与两个重载走同一个 StoreConfigWithoutState 基座
export function createStore<S extends State, A extends Actions = Actions, G extends Getters<S> = Getters<S>>(
  options: StoreConfigWithoutState<S | (() => S), A, G> & { state: S | (() => S) },
): Store<S, A, G> {
  // Store 构造器的 `options = {}` 默认值只对 undefined 生效，且 `typeof` 判定会放过数组：
  // 数组配置一路进入构造器，`options.name`/`options.state` 都取不到值，
  // 结果是静默建出一个空 store（比抛错更难查），故与 null/非对象同口径就地拒绝
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('[GeomStore] createStore: options must be a valid object')
  }
  return new Store(options)
}
