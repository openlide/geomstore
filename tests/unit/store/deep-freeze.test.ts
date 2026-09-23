/**
 * deepFreezeState 单元测试
 *
 * 该函数此前只被 $snapshot 间接覆盖，循环引用守卫（WeakSet）路径从未被执行，
 * 故此处补齐：嵌套冻结、原语直返、循环引用与外部共享 visited 集合。
 */
import { deepFreezeState } from '@/core/store/utils.js'

describe('deepFreezeState', () => {
  it('递归冻结纯对象与数组', () => {
    const state = { a: { b: 1 }, list: [{ c: 2 }] }
    deepFreezeState(state)

    expect(Object.isFrozen(state)).toBe(true)
    expect(Object.isFrozen(state.a)).toBe(true)
    expect(Object.isFrozen(state.list)).toBe(true)
    expect(Object.isFrozen(state.list[0])).toBe(true)
  })

  it('原语直接返回，不做处理', () => {
    expect(deepFreezeState(1)).toBe(1)
    expect(deepFreezeState(null)).toBe(null)
    expect(deepFreezeState('s')).toBe('s')
    expect(deepFreezeState(undefined)).toBeUndefined()
  })

  it('循环引用不无限递归（WeakSet 守卫）', () => {
    const state: Record<string, unknown> = { n: 1 }
    state.self = state

    expect(() => deepFreezeState(state)).not.toThrow()
    expect(Object.isFrozen(state)).toBe(true)
    expect(state.self).toBe(state)
  })

  it('可复用外部传入的 visited 集合', () => {
    const seen = new WeakSet<object>()
    const shared = { s: 1 }
    const state = { x: shared, y: shared }

    deepFreezeState(state, seen)

    expect(seen.has(shared)).toBe(true)
    expect(Object.isFrozen(state)).toBe(true)
    expect(Object.isFrozen(shared)).toBe(true)
  })

  it('嵌套循环引用（互相指向）同样只访问一次', () => {
    const a: Record<string, unknown> = {}
    const b: Record<string, unknown> = { a }
    a.b = b

    expect(() => deepFreezeState(a)).not.toThrow()
    expect(Object.isFrozen(a)).toBe(true)
    expect(Object.isFrozen(b)).toBe(true)
  })

  it('冻结只覆盖自有可枚举字符串键：symbol 键与非可枚举属性指向的子对象保持可变', () => {
    // 与函数文档的「部分冻结」口径同锁（R5-141）：deepCloneState 不复制这些键，
    // 冻结它们等于经快照去改活状态，故刻意不覆盖，而非实现遗漏
    const symKey = Symbol.for('geomstore.test.nested')
    const viaSymbol = { n: 1 }
    const viaHidden = { n: 2 }
    const viaIndexLike = { n: 3 }
    const state: Record<string, unknown> = { visible: { n: 0 } }
    Object.defineProperty(state, symKey, { value: viaSymbol, enumerable: false, configurable: true })
    Object.defineProperty(state, 'hidden', { value: viaHidden, enumerable: false, configurable: true })
    const list: unknown[] = [1]
    Object.defineProperty(list, 'extra', { value: viaIndexLike, enumerable: false, configurable: true })

    deepFreezeState(state)
    deepFreezeState(list)

    expect(Object.isFrozen(state)).toBe(true)
    expect(Object.isFrozen(state.visible)).toBe(true)
    expect(Object.isFrozen(viaSymbol)).toBe(false)
    expect(Object.isFrozen(viaHidden)).toBe(false)
    expect(Object.isFrozen(viaIndexLike)).toBe(false)
  })
})
