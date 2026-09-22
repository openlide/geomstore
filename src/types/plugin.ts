/**
 * GeomStore - 插件与钩子类型定义（契约层）
 *
 * 本文件是钩子/插件体系的类型契约源头：
 * - types 层定义接口，core/hooks 提供 HookSystem 实现，plugins 层依赖二者
 * - 依赖方向：plugins → core → types，禁止反向依赖
 */

import type { Actions, Getters, State, Store } from './store.js'

/**
 * 钩子名称枚举
 */
export type HookName =
  | 'beforeSetState'
  | 'afterSetState'
  | 'beforePatch'
  | 'afterPatch'
  | 'beforeDispatch'
  | 'afterDispatch'
  | 'beforeReplaceState'
  | 'afterReplaceState'
  | 'onError'

/**
 * 钩子名 → 处理器实参元组
 *
 * 本表是「`on` 注册的处理器形参」与「`emit` 传入的实参」的唯一真相来源：
 * 两端都按 `HookName` 索引到同一个元组，编译期即可查出参数顺序/个数写错的调用点
 * （例如 `emit('afterDispatch', name, result)` 漏掉 `args`）。
 *
 * 参数类型取实现层实际传出的形状（见 core/store/Store.ts、core/store/ActionManager.ts）：
 * - `beforeSetState` / `afterSetState` 的 key 是 `keyof S`，故为 `string | number | symbol`
 * - `beforeDispatch` / `afterDispatch` 的 args 是 action 实参数组本体（非展开）
 * - `onError` 的 error 为 `unknown`：`catch` 捕获值可抛任意内容，
 *   刻意不写成 `Error`（处理器需自行 `instanceof Error` 收窄）
 */
export interface HookArgsMap {
  beforeSetState: [key: string | number | symbol, value: unknown]
  afterSetState: [key: string | number | symbol, value: unknown]
  beforePatch: [partialState: Record<string, unknown>]
  afterPatch: [partialState: Record<string, unknown>]
  beforeDispatch: [actionName: string, args: readonly unknown[]]
  afterDispatch: [actionName: string, args: readonly unknown[], result: unknown]
  beforeReplaceState: [newState: object]
  afterReplaceState: [newState: object]
  onError: [error: unknown, source?: string]
}

/**
 * `T` 是否为联合类型（标准写法：`T` 分发到自身各成员时才会出现 `[B] extends [T]` 为 false）
 */
type IsUnion<T, B = T> = T extends B ? ([B] extends [T] ? false : true) : never

/**
 * 指定钩子的处理器签名
 *
 * - 单一钩子名（绝大多数调用点）：形参直接取 {@link HookArgsMap} 的元组，
 *   可写精确类型（`on('beforeDispatch', (name, args) => …)` 中 `name: string`），
 *   形参写错即编译报错。
 * - 钩子名为联合（组合层「一个 forward 转发全部钩子」的桥接口，见 core/compose/composeStore.ts）：
 *   此时参数元组无法由单一钩子确定，退化为既有的擦除形状 `HookHandler`。
 *
 * 联合分支不可省略为「`HookHandlerFor<K> | HookHandler`」：联合形参会让 TS 放弃上下文类型推断，
 * 实测无标注箭头的形参全部退化为隐式 any（正是本条修复要消除的现象）。
 */
export type HookHandlerFor<K extends HookName> = IsUnion<K> extends true ? HookHandler : (...args: HookArgsMap[K]) => void

/**
 * 钩子处理函数
 *
 * 返回值一律被忽略（`emit` 的返回类型是 `void`，实现层调用 `handler(...args)` 后不收集结果），
 * 故本类型不带结果泛型：钩子只用于观察/改写载荷，需要「拦截并否决」的语义请走
 * `beforeXxx` 内的异常抛出（`onError` 通道）。此前存在的 `TResult = void` 参数
 * 会让 `HookHandler<[], boolean>` 这类写法看起来可被观察，实际永远拿不到返回值。
 *
 * 默认 `TArgs = unknown[]` 是实现层（core/hooks 的 `Map<HookName, Set<HookHandler>>`）
 * 用来擦除钩子差异的内部形状；面向插件作者的签名是 {@link HookHandlerFor}。
 */
export type HookHandler<TArgs extends unknown[] = unknown[]> = (...args: TArgs) => void

/**
 * 钩子系统契约接口
 *
 * 由 core/hooks 的 HookSystem 类实现；类型层仅依赖此接口，
 * 避免 types 反向依赖实现类。
 *
 * `on` / `emit` 都按 `HookName` 关联 {@link HookArgsMap}：处理器可写出精确形参
 * （`on('beforeDispatch', (name, args) => …)` 中 `name: string`，无需再写 `unknown`），
 * `emit` 的实参顺序/个数也在编译期受检。
 *
 * 为什么 `on` 的处理器形参要经过 {@link HookHandlerFor} 的联合分支判定，而不是直接
 * `handler: (...args: HookArgsMap[K]) => void`：实现类 `HookSystem.on` 的形参是类型擦除的
 * `HookHandler`（`Map<HookName, Set<HookHandler>>` 的存储形状），精确元组在参数逆变下无法满足
 * 接口成员（实测 TS2416）；而写成 `HookHandlerFor<K> | HookHandler` 虽然通过实现检查，却会让
 * 联合形参失去上下文类型推断（实测无标注箭头形参全部退化为隐式 any），正好丢掉本次修复的目的。
 * `IsUnion` 分支让两端同时成立：调用点传字面量钩子名得到精确签名，实现类与组合层桥接
 * （传 `HookName` 联合变量）走擦除分支。
 */
export interface IHookSystem {
  /** 注册钩子处理器，返回取消注册函数；处理器形参由 HookArgsMap 按钩子名给出 */
  on<K extends HookName>(hookName: K, handler: HookHandlerFor<K>): () => void
  /** 触发钩子：实参元组由 HookArgsMap 按钩子名给出，顺序/个数不符即编译报错 */
  emit<K extends HookName>(hookName: K, ...args: HookArgsMap[K]): void
  /** 清除钩子（指定名称或全部） */
  clear(hookName?: HookName): void
  /** 查询钩子数量：传入 hookName 返回该钩子的 handler 数，不传返回已注册的钩子名称数 */
  size(hookName?: HookName): number
}

/**
 * 插件安装钩子 - 返回可选的卸载函数
 *
 * 泛型只开放**状态类型 S**：插件实现几乎只需要精确的 state 形状（如 `filter: (state) => …`），
 * actions / getters 使用其默认约束即可。若把 A / G 也开放，调用方传具体 Store 时会因
 * 参数逆变而在每个使用点被迫断言。
 *
 * 省略类型参数即得「适用于任意 Store」的插件（`Plugin` = `Plugin<State>`），
 * 例如 logger / analyzer 这类与状态形状无关的插件。
 */
export type PluginHook<S extends State = State> = (store: Store<S, Actions, Getters<S>>) => void | (() => void)

/**
 * 插件接口
 *
 * ```ts
 * const plugin: Plugin<UserState> = {
 *   name: 'user-analytics',
 *   install(store) {            // store: Store<UserState, …>，getState() 类型精确
 *     store.subscribe((state) => track(state.userInfo))
 *   },
 * }
 * const uninstall = store.use(plugin)   // 无需断言
 * ```
 */
export interface Plugin<S extends State = State> {
  name: string
  install: PluginHook<S>
}
