/**
 * 选择器全族的「无索引签名 interface 状态」回归
 *
 * `Selector` / `ParametricSelector` / `SelectorComposerInput` 及各创建函数的约束
 * 已由 `Record<string, unknown>` 放宽为 `State`（即 `object`），业务 interface 应当处处可用。
 *
 * 本文件用同一个 interface 状态走一遍全族 API：任一处的约束未跟上，都会让 `S` 推断失败
 * 而由 ts-jest 报错——这正是运行时覆盖率摸不到的那部分。
 *
 * 注：`createStructuredSelector` / `SelectorComposer.combine` 需要**显式给出类型参数**。
 * 二者的 `S` 只出现在「对另一个类型参数取索引」的嵌套位置（`Selector<S, R[K]>` /
 * `Selector<S, unknown>[]`），TS 无法据此反推 `S` 并退回约束 `State`。这是既有的推断限制
 * （与本次约束放宽无关），调用方需写出 `S` 与结果类型。
 */

import { createMemoizedSelector, createParametricSelector, createSelector, createStructuredSelector, SelectorFactory } from '../../../../src/extras/selector.js'
import { SelectorComposer } from '../../../../src/extras/selector/selectorComposer.js'
import { createRetrySelector, createRetrySelectorAsync } from '../../../../src/extras/selector/retrySelector.js'

interface Order {
  id: number
  amount: number
  status: 'paid' | 'unpaid'
}

interface OrderState {
  orders: Order[]
  rate: number
}

interface OrderSummary {
  rate: number
  count: number
}

const state: OrderState = {
  orders: [
    { id: 1, amount: 100, status: 'paid' },
    { id: 2, amount: 50, status: 'unpaid' },
  ],
  rate: 0.9,
}

describe('选择器全族支持无索引签名的 interface 状态', () => {
  it('createSelector / createMemoizedSelector / createStructuredSelector', () => {
    expect(createSelector((s: OrderState) => s.rate)(state)).toBe(0.9)
    expect(createMemoizedSelector((s: OrderState) => s.orders.length)(state)).toBe(2)

    // 需显式类型参数：S 无法从映射值反推（见文件头说明）
    const structured = createStructuredSelector<OrderState, OrderSummary>({
      rate: (s) => s.rate,
      count: (s) => s.orders.length,
    })
    expect(structured(state)).toEqual({ rate: 0.9, count: 2 })
  })

  it('createParametricSelector / SelectorFactory', () => {
    const amountById = createParametricSelector(
      (s: OrderState, id: number) => s.orders.find((o) => o.id === id)?.amount ?? 0,
      { ttl: 100, maxEntries: 4 },
    )(state)
    expect(amountById(1)).toBe(100)

    const factory = new SelectorFactory((s: OrderState) => s.rate)
    expect(factory.execute(state)).toBe(0.9)
    // withCacheResult() 返回带缓存的选择器
    expect(typeof factory.withCacheResult()).toBe('function')
  })

  it('SelectorComposer 的 combine / pipe / derived / object / conditional / default', () => {
    // 需显式类型参数：S 无法从 selectors 元组反推（见文件头说明）
    const combined = SelectorComposer.combine<OrderState, number>({
      selectors: [(s: OrderState) => s.rate, (s: OrderState) => s.orders.length],
      combiner: (...nums: number[]) => nums.reduce((a, b) => a * b, 1),
    })
    expect(combined(state)).toBeCloseTo(1.8)

    const piped = SelectorComposer.pipe((s: OrderState) => s.orders.length)
    expect(piped(state)).toBe(2)

    const derived = SelectorComposer.createDerived(
      (s: OrderState) => s.orders.length,
      (n: number) => String(n),
    )
    expect(derived(state)).toBe('2')

    // 注意：createObjectSelector 对状态的**每个键**应用选择器（返回同键名对象），
    // 故 K 取 keyof S，而不是某一单个键
    const objectSelector = SelectorComposer.createObjectSelector((key) => (s: OrderState) => s[key])
    expect(objectSelector(state)).toEqual({ orders: state.orders, rate: 0.9 })

    const conditional = SelectorComposer.createConditionalSelector(
      (s: OrderState) => s.orders.length > 0,
      (s: OrderState) => s.orders[0].amount,
      () => 0,
    )
    expect(conditional(state)).toBe(100)

    const withDefault = SelectorComposer.createDefaultSelector<OrderState, number>(() => {
      throw new Error('boom')
    }, -1)
    expect(withDefault(state)).toBe(-1)
  })

  it('重试族与节流 / 防抖族（后者仅作类型检查，不触发定时器）', async () => {
    const retried = createRetrySelector((s: OrderState) => s.orders.length, { retries: 1 })
    expect(retried(state)).toBe(2)

    const asyncRetried = createRetrySelectorAsync((s: OrderState) => s.orders.length, { retries: 1 })
    await expect(asyncRetried(state)).resolves.toBe(2)

    const debounced = SelectorComposer.createDebouncedSelector((s: OrderState) => s.orders.length)
    const throttled = SelectorComposer.createThrottledSelector((s: OrderState) => s.orders.length)
    expect(typeof debounced).toBe('function')
    expect(typeof throttled).toBe('function')
  })
})
