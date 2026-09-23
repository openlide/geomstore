/**
 * 钩子参数类型契约（编译期断言）— #401 / #402
 *
 * 本文件为「纯类型测试」，不参与 jest 运行时（文件名不以 .test/.spec 结尾），
 * 仅由 `pnpm typecheck:tests`（tsc --noEmit）做编译期校验。
 *
 * 锁定行为：
 * - #401 `on` 的处理器形参与 `emit` 的实参都按 `HookName` 关联 `HookArgsMap`：
 *   - 传字面量钩子名时，无标注处理器形参获得**上下文精确类型**
 *     （探针 `X extends … ? true : false`：X 为隐式 any 时展开成 boolean，赋给 `true` 即报错）
 *   - `emit` 的实参个数/顺序/类型受检（漏传 value、afterDispatch 少传 args 都编译失败）
 *   - 组合层桥接（钩子名为 `HookName` 联合变量）仍可用擦除形状 `HookHandler`
 *   - 契约面是 `IHookSystem`（`Store` 接口的 `hooks` 成员，插件 install 拿到的即此类型）；
 *     `createStore()` 返回的**实现类** `Store.hooks` 目前仍是类自身签名（`hooks: HookSystem`），
 *     需 core 侧把该字段声明收窄回 `IHookSystem`（本轮记为 NEEDS-MAIN，见 src/core/store/Store.ts），
 *     故本文件的断言面是契约面。**该 gap 本身另有编译期断言兜底**（见 `_createStoreHooksFaceGap`），
 *     不再只靠本段注释声明
 * - #402 `HookHandler` 不再带 `TResult` 结果泛型（emit 丢弃返回值，留着只会误导）
 *
 * @file tests/types/plugin-hook-args.typecheck.ts
 */

import { createStore } from '@/index.js'
import type { HookArgsMap, HookHandler, HookHandlerFor, HookName, IHookSystem, Plugin, PluginHook } from '@/types/plugin.js'

/** 双向精确类型相等断言（与 tests/types/integration-types.typecheck.ts 同口径） */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

interface CounterState {
  count: number
  label: string
}

const store = createStore({
  name: 'hook-args-types',
  state: (): CounterState => ({ count: 0, label: '' }),
  actions: {
    bump(n: number) {
      void n
    },
  },
})

/** 契约面视图（与 `Plugin` 的 `install(store)` 拿到的 `store.hooks` 同一类型） */
const hooks: IHookSystem = store.hooks

// ==================== 断言面落在真实返回值上（#R5-348） ====================

// 插件作者视角（`PluginHook` 的形参即 `Store` **接口**）拿到的 `hooks` 确为契约面：
// 本行是「契约已随接口落地」的正向断言，接口一旦把成员改宽（例如退回 `HookSystem`）即报错。
const _pluginFaceIsContract: Equal<Parameters<PluginHook<CounterState>>[0]['hooks'], IHookSystem> = true

// 而 `createStore()` 返回的是**实现类**，其 `hooks` 字段仍声明为 `HookSystem`（src/core/store/Store.ts），
// 于是本文件下面的 @ts-expect-error 断言全部只作用于契约面。这里把差异钉成断言而不是注释：
// core 侧把该字段收窄回 `IHookSystem` 后，本行的 `false` 会不再成立而报错，
// 提醒把整份文件的断言面切到 `store.hooks` 并删除文件头描述的 gap。
const _createStoreHooksFaceGap: Equal<typeof store.hooks, IHookSystem> = false

void [_pluginFaceIsContract, _createStoreHooksFaceGap]

// ==================== #401 正例：无标注处理器的上下文推断 ====================

hooks.on('beforeDispatch', (actionName, args) => {
  const nameIsString: true = null as unknown as typeof actionName extends string ? true : false
  const argsIsTuple: true = null as unknown as typeof args extends readonly unknown[] ? true : false
  void nameIsString
  void argsIsTuple
  // 形参本体仅出现在 `typeof` 类型位，补一行值读用，避免被当成未用形参
  void args
})

hooks.on('beforeSetState', (key, value) => {
  const keyIsPropertyKey: true = null as unknown as typeof key extends string | number | symbol ? true : false
  void keyIsPropertyKey
  void value
})

hooks.on('afterDispatch', (actionName, args, result) => {
  const nameIsString: true = null as unknown as typeof actionName extends string ? true : false
  const argsIsTuple: true = null as unknown as typeof args extends readonly unknown[] ? true : false
  void nameIsString
  void argsIsTuple
  void result
})

hooks.on('onError', (error, source) => {
  // error 刻意保持 unknown（catch 可抛任意值），处理器自行收窄
  if (error instanceof Error) void error.message
  const sourceIsString: true = null as unknown as typeof source extends string | undefined ? true : false
  // 上一条探针对「可选性丢失」无感：`source` 退化成必填 `string` 时 `string extends string | undefined`
  // 仍为 true，故再补一条可选性探针（`undefined extends typeof source`）拦住这一半退化。
  const sourceIsOptional: true = null as unknown as undefined extends typeof source ? true : false
  void [sourceIsString, sourceIsOptional]
  // 形参本体仅出现在 `typeof` 类型位，补一行值读用，避免被当成未用形参
  void source
})

// 显式写出精确形参的处理器（修复前因参数逆变被拒，插件层只能通篇写 unknown）
hooks.on('beforeDispatch', (actionName: string, args: readonly unknown[]) => {
  void actionName.toUpperCase()
  void args.length
})

// 少写形参（只观察首个参数）仍然合法
hooks.on('beforeSetState', (key: string | number | symbol) => void key)

// 插件侧的真实写法：install 参数即契约面，无需 unknown 兜底
const narrowPlugin: Plugin<CounterState> = {
  name: 'narrow-hook-plugin',
  install(s) {
    s.hooks.on('afterDispatch', (actionName: string, _args: readonly unknown[], result: unknown) => {
      void actionName
      void result
    })
    s.hooks.on('beforeSetState', (key, value) => {
      // key 精确到 string | number | symbol，可安全用于 setState 的键收窄
      if (key === 'count') s.setState('count', Number(value))
    })
  },
}
store.use(narrowPlugin)

// ==================== #401 反例：emit 实参顺序/个数/类型受检 ====================

declare const key: string
declare const value: unknown
declare const actionName: string
declare const callArgs: readonly unknown[]

// @ts-expect-error beforeSetState 需要 [key, value]，漏传 value
hooks.emit('beforeSetState', key)
// @ts-expect-error afterDispatch 需要 [actionName, args, result]，把 result 顶到 args 位上会被检出
hooks.emit('afterDispatch', actionName, value)
// @ts-expect-error beforeDispatch 的第二个实参是 args 数组本体，传单值不再被静默接受
hooks.emit('beforeDispatch', actionName, actionName)
// @ts-expect-error beforePatch 载荷是对象，传字符串编译失败
hooks.emit('beforePatch', 'partial')
// @ts-expect-error afterDispatch 缺最后一个参数
hooks.emit('afterDispatch', actionName, callArgs)
// @ts-expect-error 不存在的钩子名
hooks.emit('beforeCommit')
// @ts-expect-error 处理器形参类型与 HookArgsMap 不符（beforeSetState 的 key 不是 number）
hooks.on('beforeSetState', (bad: number) => void bad)
// @ts-expect-error 形参精确类型必须落在对应钩子的元组上（beforeDispatch 的首参是 action 名）
hooks.on('beforeDispatch', (payload: { id: string }) => void payload)

// 正例：完整且顺序正确的 emit
hooks.emit('beforeSetState', key, value)
hooks.emit('beforeDispatch', actionName, callArgs)
hooks.emit('afterDispatch', actionName, callArgs, null)
hooks.emit('onError', new Error('boom'), 'test-source')
hooks.emit('beforePatch', { count: 1 })

// ==================== #401 桥接口：钩子名为联合变量时走擦除分支 ====================

const ALL_HOOK_NAMES: readonly HookName[] = ['beforeSetState', 'afterDispatch']
for (const hookName of ALL_HOOK_NAMES) {
  const forward: HookHandler = (...args: unknown[]) => void args
  hooks.on(hookName, forward)
}

// ==================== HookArgsMap 自身形状 ====================

type ArgsOfBeforeDispatch = HookArgsMap['beforeDispatch']
const _argsShape: [actionName: string, args: readonly unknown[]] = null as unknown as ArgsOfBeforeDispatch
void _argsShape
// @ts-expect-error afterDispatch 是三元组，与二元组不可互赋
const _shapeMismatch: ArgsOfBeforeDispatch = null as unknown as HookArgsMap['afterDispatch']
void _shapeMismatch

// ==================== #402：HookHandler 不再接受结果泛型 ====================

const erased: HookHandler = (...args: unknown[]) => void args
hooks.on('beforePatch', erased)
// @ts-expect-error TResult 已删除：HookHandler 只有 1 个类型参数
const withResult: HookHandler<[], boolean> = () => true
void withResult
// 处理器返回值被忽略（void 返回位可赋任意返回值的函数），语义由 HookHandlerFor 固定为 void。
// 这里刻意不用 `as` 断言：`x as T` 只要「任一方向可赋」即通过，`T` 本身怎么写都不会失败，
// 于是「返回位固定为 void」这件事过去没有任何检查覆盖（#R5-347）。直接赋值后，
// 若 `HookHandlerFor<'beforePatch'>` 改回带结果泛型（返回值不再是 void 特例），本行立即报错。
const returnsValue: HookHandlerFor<'beforePatch'> = (partial: Record<string, unknown>) => partial.count
void returnsValue

export {}
