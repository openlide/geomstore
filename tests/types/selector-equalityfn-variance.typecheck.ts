/**
 * `SelectorOptions.equalityFn` 的形参方差锁（主会话落地 plugins-types-p1 的交接项）
 *
 * 只编译不运行（`pnpm run typecheck:tests`）。锁三件事：
 * 1. 调用方按**具体状态**标注的比较器必须可赋——`unknown` 形参在 `strictFunctionTypes` 下
 *    因逆变把它拒了（实测 `TS2322: Type 'unknown' is not assignable to type 'OrderState'`），
 *    等于「默认 deepEqual 之外的写法全都写不出来」。
 * 2. 放宽只发生在逆变的形参位：返回非 `boolean` 的实现依然被拒，
 *    否则这条放宽就变成了「随便传个函数都能当相等判定」。
 * 3. 同一个比较器的**两条公开入口**（`SelectorOptions.equalityFn` 与
 *    `createMemoizedSelector` 的第二位置形参）口径一致，不接受只放宽其中一条。
 */
import { createMemoizedSelector } from '@/extras/selector/createSelector.js'
import type { SelectorOptions } from '@/types/selector.js'

interface OrderState {
  id: string
  amount: number
}

// 具体状态标注的引用相等比较器：这是业务侧最常见的写法
const byId: SelectorOptions = {
  equalityFn: (a: OrderState, b: OrderState) => a.id === b.id,
}
void byId

// 同一状态的深比较器（自定义实现，非内置 deepEqual 引用）也必须可赋
const deep: SelectorOptions = {
  equalityFn: (a: OrderState, b: OrderState) => a.id === b.id && a.amount === b.amount,
}
void deep

// 无标注写法照旧可赋（`unknown` 形参时代这一类本来就通过）
const inferred: SelectorOptions = {
  equalityFn: (a, b) => a === b,
}
void inferred

const badReturn: SelectorOptions = {
  // @ts-expect-error 返回位不放宽：非 boolean 的「比较器」仍然是错的
  equalityFn: () => 'equal',
}
void badReturn

// `createMemoizedSelector` 的第二形参是同一个比较器的另一条公开入口：它曾独立写成
// `(a: unknown, b: unknown) => boolean`，于是 options 位能写的业务比较器在位置参数位被拒。
// 这一半锁的是「同一判据的两条入口不得方差口径不一致」。
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
