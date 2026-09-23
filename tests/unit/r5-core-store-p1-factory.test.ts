/**
 * 第五轮 core-store-p1 分片：createStore 的入参校验
 *
 * R5-120：数组形状的配置此前会一路进入 Store 构造器（`options.name`/`options.state`
 * 都取不到），静默产出一个空 store；现在与 null/非对象同口径就地拒绝。
 */
import { createStore } from '@/core/store/factory.js'

describe('R5-120 createStore 入参校验', () => {
  it.each([
    ['null', null],
    ['数组', []],
    ['数字', 42],
    ['字符串', 'state'],
    ['布尔', true],
    ['函数', () => ({})],
  ] as const)('%s 一律以 TypeError 拒绝', (_label, value) => {
    expect(() => createStore(value as never)).toThrow(TypeError)
  })

  it('undefined 同样以 TypeError 拒绝（不再退化为默认空配置）', () => {
    expect(() => createStore(undefined as never)).toThrow('[GeomStore] createStore: options must be a valid object')
  })

  it('报错口径唯一：拒绝消息指向 createStore 本身', () => {
    expect(() => createStore([] as never)).toThrow(/createStore: options must be a valid object/)
  })

  it('合法的对象字面量与工厂式配置照常建店', () => {
    const literal = createStore({ state: { count: 1 } })
    const factory = createStore({ state: () => ({ count: 2 }) })
    try {
      expect(literal.getState().count).toBe(1)
      expect(factory.getState().count).toBe(2)
    } finally {
      literal.destroy()
      factory.destroy()
    }
  })
})
