import { createStore as _createStore } from '@/index.js'
import type { Store as StoreInstance } from '@/core/store/Store.js'
import type { Actions, Getters, State, StoreOptions } from '@/types/store.js'

let _seq = 0

/**
 * 测试专用 Store 工厂的入参形状：`StoreOptions<S, A, G>` + **必填** `state`。
 *
 * 此前直接写 `StoreOptions<S>`，其 `state?: S | (() => S)` 是可选的，于是
 * `createTestStore({})`（漏写初始状态）在编译期完全合法 —— 而 `createStore` 的两个公开
 * 重载（`FactoryStoreConfig` / `LiteralStoreConfig`）都要求 `state`。这里显式补回该约束。
 *
 * ⚠️ 对齐的**只是 `state` 的必填性**，不含它的形状接受面（#R6-113，别照这段去「补齐」）：
 * 交叉成 `StoreOptions<S, A, G> & { state: S | (() => S) }` 后，`S` 同时收到「函数」与
 * 「函数返回值」两个推断候选，于是**带形参的 state 工厂**
 * `state: (seed: number) => ({ count: seed })` 在本工厂上报 TS2322（错误文案形如
 * `({...} | (() => {...}) | undefined) & ({...} | (() => {...}))`，与「state 必填」毫无相似之处），
 * 而公开入口 `createStore` 今天**不拒**它（重载 1 的 `() => S` 匹配失败后落到重载 2，
 * `S extends State`（= `object`）直接把函数类型吸收进去）。两侧已在同一份 compilerOptions 下实测复现。
 *
 * 该不对称刻意保留：真正该收紧的是 `createStore` 那一侧——它让 store 的类型谎称 state 是函数，
 * 而运行时 `_initializeState` 按**无参**调用工厂（`Store.ts` 的 `(state as () => S)()`），
 * 得到的是 `{ count: undefined }`。工厂这里先拒绝，等于替 src 兜了底；把工厂放宽去「对齐」
 * 只会把这个缺口固化，故 src 侧修好之前本工厂保持更严。
 *
 * `A` / `G` 作为独立类型参数穿透：入参形状里写 `StoreOptions<S, A, G>` 时它们仍出现在
 * 可推断位置，actions / getters 的字面量形状会被真正推断下来，返回的 Store 因此保留
 * 精确的 action/getter 映射（与 `createStore` 的推断型配置同口径），而不是退化成
 * `Actions` / `Getters<S>` 的索引签名兜底。两者都带默认值，仅传 state 的旧调用点不变。
 *
 * 不按 `StoreConfig` 复刻两个重载：`StoreConfig.actions` 的 `ThisType` 实参含
 * `ResolveState<S> extends State ? …` 条件类型，`S` 仍是类型参数时它无法展开，
 * 实测 action 内的 `this` 会退化成 `{}`（`this.state` / `this.setState` 全部 TS2339）。
 */
export type TestStoreConfig<S extends State, A extends Actions = Actions, G extends Getters<S> = Getters<S>> = StoreOptions<S, A, G> & {
  state: S | (() => S)
}

/**
 * 以 `StoreOptions` 为入参的调用入口（等价于 createStore 的**实现签名**，后者对外不可见）。
 *
 * 这是本工厂唯一的类型让步，且只做一次、只针对函数形状：`StoreOptions<S>` 的 `getters`
 * （`Getters<S>`，索引签名 `(state: S) => unknown`）与 `cacheKeys`（`Array<keyof S>`）在
 * `S` 仍是类型参数时，与推断型配置里对应的条件类型互不可比（实测 TS2769 恰好只报在这两个
 * 成员上），运行时则是纯透传。
 *
 * 用在这里的是断言而不是 `@ts-expect-error`：后者锚在整个调用表达式上，该表达式里**任何**
 * 其它类型错误（将来新增成员、参数写错）都会被一并吞掉；断言只放弃这一次函数形状的匹配，
 * 入参对象与返回类型仍走正常检查。返回类型取 `createStore` 实际返回的**实现类**
 * （`core/store/Store`），与既有调用方一致（类上另有 `setStateProtection` 等接口未声明的成员）。
 */
const createStoreFromOptions = _createStore as unknown as <S extends State, A extends Actions, G extends Getters<S>>(
  options: StoreOptions<S, A, G>,
) => StoreInstance<S, A, G>

/**
 * 测试专用 Store 工厂。
 *
 * 在 `createStore` 之上为未显式命名的 store 补充确定性唯一 name，避免测试中未命名
 * 引入的随机/冲突，使测试更稳定、可复现；其余参数完全透传，不改变任何既有语义。
 *
 * 状态约束与全 API 一致取 `S extends State`（= `object`）：`Record<string, unknown>`
 * 会额外要求隐式字符串索引签名，interface 声明的状态（无签名）会被拒收，而真实
 * `createStore` 接受同样的输入；默认值仍保留 `Record<string, unknown>` 与本库
 * `Selector<S extends State = Record<string, unknown>>` 的口径对齐。
 *
 * 用法：`const store = createTestStore({ state: { count: 0 } })`
 */
export function createTestStore<S extends State = Record<string, unknown>, A extends Actions = Actions, G extends Getters<S> = Getters<S>>(
  options: TestStoreConfig<S, A, G>,
) {
  // 不改写调用方传入的 options：把生成的 name 写回入参，会让复用同一 fixture 的
  // 后续调用跳过计数器、全部落到同一个 name（正是本工厂要防的冲突），
  // 入参被 Object.freeze 时更直接抛错
  //
  // name 用真值判断而不是 `=== undefined`：本库对「空字符串名称」的既定语义就是「未命名」——
  // `Store` 构造函数写的正是 `options.name || 'store-N'`（src/core/store/Store.ts，
  // 由 tests/unit/store/store.test.ts 的 STORE-088 锁定）。`''` 若被原样透传，
  // 最终仍会被 Store 换成非确定性的 `store-N`，恰恰丢掉本工厂要保证的唯一名可复现性
  const resolved: TestStoreConfig<S, A, G> = options.name ? options : { ...options, name: `test-store-${++_seq}` }
  return createStoreFromOptions(resolved)
}
