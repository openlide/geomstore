/**
 * `SelectorOptions.equalityFn` 的形参方差锁（主会话落地 plugins-types-p1 的交接项）
 *
 * 只编译不运行（`pnpm run typecheck:tests`）。锁四件事：
 * 1. 调用方按**具体状态**标注的比较器必须可赋——`unknown` 形参在 `strictFunctionTypes` 下
 *    因逆变把它拒了（实测 `TS2322: Type 'unknown' is not assignable to type 'OrderState'`），
 *    等于「默认 deepEqual 之外的写法全都写不出来」。
 * 2. 放宽只发生在逆变的形参位：返回非 `boolean` 的实现依然被拒，
 *    否则这条放宽就变成了「随便传个函数都能当相等判定」。
 * 3. 同一个比较器的**两条公开入口**（`SelectorOptions.equalityFn` 与
 *    `createMemoizedSelector` 的第二位置形参）**方差口径一致**，不接受只放宽其中一条。
 *    ⚠️ 本条只锁形参/返回的方差，别读成「两条入口所有选项同形」：两条入口在 `snapshotState`
 *    上**刻意不一致**——`createMemoizedSelector` 根本不暴露该选项（其文档写明无版本号的普通对象
 *    状态一律缓存内容快照），只比引用的写法得走
 *    `createSelector(fn, { cache: true, equalityFn, snapshotState: false })`。
 * 4. `equalityFn` 与 `snapshotState` 是一对耦合选项（#R6-111）：引用相等比较器只有同时把
 *    `snapshotState` 置 `false` 才成立。本文件是这两条选项写法的参照物，故下面的示例按**可抄的
 *    正确形态**摆，并用形状断言钉住 `snapshotState` 仍在 `SelectorOptions` 上、类型仍是 `boolean`
 *    （把它从接口上删掉，此前整批类型测试照样编译通过）。
 */
import { createMemoizedSelector } from '@/extras/selector/createSelector.js'
import type { SelectorOptions } from '@/types/selector.js'

/**
 * 双向精确类型相等断言（与 `tests/types/integration-types.typecheck.ts` 同口径）：
 * `const _x: true = ...` 这类可赋值断言在成员被漂成 `any`、或整块塌成 `never` 时都会白过。
 */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

interface OrderState {
  id: string
  amount: number
}

// 具体状态标注的引用相等比较器：这是业务侧最常见的写法。**深比较**配默认的
// `snapshotState: true`（缓存内容快照）才是正确形态，故这里刻意不写第二项
const byId: SelectorOptions = {
  equalityFn: (a: OrderState, b: OrderState) => a.id === b.id,
}
void byId

// 同一状态的深比较器（自定义实现，非内置 deepEqual 引用）也必须可赋
const deep: SelectorOptions = {
  equalityFn: (a: OrderState, b: OrderState) => a.id === b.id && a.amount === b.amount,
}
void deep

// 无标注写法照旧可赋（`unknown` 形参时代这一类本来就通过）。
// ⚠️ 引用相等比较器**必须**成对写 `snapshotState: false`：默认那档会缓存内容快照，
// 命中判定就成了 `equalityFn(克隆体, 活引用)`，永不相等 ⇒ 缓存静默永不命中。
// 本处按可抄的正确形态书写（而不是只断言「可赋」），因为本文件就是 equalityFn 写法的参照物。
const inferred: SelectorOptions = {
  equalityFn: (a, b) => a === b,
  snapshotState: false,
}
void inferred

// 上面那条耦合的**形状**锁（#R6-111）：`snapshotState` 必须是 `SelectorOptions` 上的可选
// `boolean`。只把它从接口上删掉，此前的本批次文件全部照样编译通过（缺成员在字面量上才是错，
// 而 `equalityFn: (a,b)=>a===b` 单独那份在删掉成员后仍然可赋），故这里逐字断言成员存在与类型。
const _snapshotOptionExact: Equal<NonNullable<SelectorOptions['snapshotState']>, boolean> = true
void _snapshotOptionExact
// 同一条还得是**可选**成员：漂成必填会让所有既有 options 字面量报缺成员（另一种漂移）
type SnapshotIsOptional = [undefined] extends [SelectorOptions['snapshotState']] ? true : false
const _snapshotOptionOptional: Equal<SnapshotIsOptional, true> = true
void _snapshotOptionOptional
// 反例：非 boolean 的「快照开关」不放行
const _snapshotBad: SelectorOptions = {
  // @ts-expect-error snapshotState 只接受 boolean
  snapshotState: 'lazy',
}
void _snapshotBad

const badReturn: SelectorOptions = {
  // @ts-expect-error 返回位不放宽：非 boolean 的「比较器」仍然是错的
  equalityFn: () => 'equal',
}
void badReturn

// `createMemoizedSelector` 的第二形参是同一个比较器的另一条公开入口：它曾独立写成
// `(a: unknown, b: unknown) => boolean`，于是 options 位能写的业务比较器在位置参数位被拒。
// 这一半锁的是「同一判据的两条入口不得**方差口径**不一致」——注意只锁方差：本条入口不接
// `snapshotState`（无版本号的普通对象一律缓存内容快照），所以在它上面传 `(a, b) => a === b`
// 得到的是「永不命中」的缓存，要只比引用请改走 `createSelector(fn, { …, snapshotState: false })`。
const factoryById = createMemoizedSelector<OrderState, number>(
  (s) => s.amount,
  (a: OrderState, b: OrderState) => a.id === b.id,
)
void factoryById

const factoryBadReturn = createMemoizedSelector<OrderState, number>(
  (s) => s.amount,
  // @ts-expect-error 返回位同样不放宽
  () => 'equal',
)
void factoryBadReturn

export {}
