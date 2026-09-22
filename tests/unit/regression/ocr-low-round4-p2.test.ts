/**
 * 第四轮 ocr 复审 low 波次（G1-core p2）的回归用例
 *
 * 只覆盖本轮**有行为可观测差异**的改动（#172 / #187 / #191 / #192）与
 * barrel 类型出口的一致性锁（#166）；纯文档/注释类 finding 不在此列。
 * 用例名里的 #N 对应 .ocr-fix/groups/G1-core-low-p2.md 的条目编号。
 */

import {
  createStore,
  ActionManager,
  BatchManager,
  StateProxyManager,
  StoreCacheManager,
  SubscriptionManager,
  type ActionManagerOptions,
  type StateProxyOptions,
  type StoreCacheOptions,
  type SubscriptionManagerOptions,
} from '@/core/store/index.js'
import { createMutationErrorMessage } from '@/core/store/utils.js'
import { deepEqual } from '@/core/utils/equality.js'

describe('#166 core/store barrel 同时导出管理器类与其选项类型', () => {
  it('#166 四个选项类型可从 barrel 取到（编译期锁：类型缺失则 tsc 失败）', () => {
    // 类的值导入参与断言，避免这些导出被误判为未使用而删除
    const exported = [createStore, ActionManager, BatchManager, StateProxyManager, StoreCacheManager, SubscriptionManager]
    expect(exported.every((x) => typeof x === 'function')).toBe(true)

    type BarrelOptionTypes = [ActionManagerOptions, StateProxyOptions, StoreCacheOptions, SubscriptionManagerOptions]
    const optionTypes: BarrelOptionTypes | undefined = undefined
    expect(optionTypes).toBeUndefined()
  })
})

describe('#172 createMutationErrorMessage 必须不抛错', () => {
  /** JSON.stringify 与 String() 两条路径都会抛的宿主值（Proxy 陷阱 + Symbol.toPrimitive） */
  function makeHostileValue(): object {
    return new Proxy(
      {},
      {
        get(_target, key): unknown {
          if (key === Symbol.toPrimitive) {
            return () => {
              throw new TypeError('#172 toPrimitive 抛出')
            }
          }
          throw new TypeError('#172 get 陷阱抛出')
        },
      },
    )
  }

  it('#172 String() 也失败时回退到 typeof 占位串，不向外抛', () => {
    expect(() => createMutationErrorMessage('a.b', makeHostileValue(), 'set')).not.toThrow()
    const message = createMutationErrorMessage('a.b', makeHostileValue(), 'set')
    expect(message).toContain('<unserializable object>')
    // 保护错误本身仍可定位
    expect(message).toContain('"a.b"')
    expect(message).toContain('Operation: set')
  })

  it('#172 String() 可用时仍走 String 回退（BigInt 场景不回归为占位串）', () => {
    const message = createMutationErrorMessage('big', 10n, 'set')
    expect(message).toContain('Attempted value: 10')
    expect(message).not.toContain('<unserializable')
  })
})

describe('#187 setStateProtection 的销毁后守卫', () => {
  it('#187 销毁后调用抛错，与其余写接口同口径', () => {
    const store = createStore({ name: 'p2-187', state: { count: 0 } })
    expect(() => store.setStateProtection(false)).not.toThrow()
    store.destroy()

    expect(() => store.setStateProtection(false)).toThrow(/destroyed Store/)
    expect(() => store.setStateProtection(true)).toThrow(/destroyed Store/)
    // 只读侧按既有约定豁免
    expect(() => store.isStateProtectionEnabled()).not.toThrow()
    expect(() => store.getStateProtectionConfig()).not.toThrow()
  })
})

describe('#188 getters 在销毁后返回保留的定义（更正「返回空对象」的文档）', () => {
  it('#188 销毁后 getters 仍含定义，getter() 则抛错', () => {
    const store = createStore({
      name: 'p2-188',
      state: { count: 1 },
      getters: {
        double(state) {
          return state.count * 2
        },
      },
    })
    expect(Object.keys(store.getters)).toEqual(['double'])
    store.destroy()

    expect(Object.keys(store.getters)).toEqual(['double'])
    expect(store.getGetterNames()).toEqual([])
    expect(() => store.getter('double')).toThrow(/destroyed Store/)
  })
})

/**
 * #191/#192 用的嵌套 Set 构造器
 *
 * levels 层「Set 套 Set」，每层再挂一个叶子对象凑成多候选（让深度分支被多次命中）。
 */
function nestedSets(levels: number, extraLeaf: boolean): Set<unknown> {
  let value: unknown = { leaf: 'x' }
  for (let i = 0; i < levels; i++) {
    value = extraLeaf ? new Set<unknown>([value, { tag: i }]) : new Set<unknown>([value])
  }
  return value as Set<unknown>
}

describe('#191/#192 deepEqual 的深度累加与告警去重', () => {
  const warnMessages: string[] = []
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    warnMessages.length = 0
    warnSpy = jest.spyOn(console, 'warn').mockImplementation((msg?: unknown) => {
      warnMessages.push(String(msg))
    })
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('#191 深度预算跨 Set 边界累加，超深嵌套 Set 不再绕过 maxDepth', () => {
    const a = nestedSets(15, false)
    const b = nestedSets(15, false)
    // 旧实现每个 Set 边界都把深度重置为 0，15 层嵌套在 maxDepth=10 下会误判为相等
    expect(deepEqual(a, b, 10)).toBe(false)
    // 同一结构在足够预算下仍相等（证明差异来自深度口径而非比较语义）
    expect(deepEqual(a, b, 100)).toBe(true)
    expect(deepEqual(nestedSets(2, true), nestedSets(2, true), 10)).toBe(true)
  })

  it('#191 Map 值分支与 Set 元素的深度口径一致', () => {
    const deep = nestedSets(12, false)
    const mapA = new Map<string, unknown>([['k', deep]])
    const mapB = new Map<string, unknown>([['k', nestedSets(12, false)]])
    expect(deepEqual(mapA, mapB, 10)).toBe(false)
    expect(deepEqual(mapA, mapB, 100)).toBe(true)
  })

  it('#192 一次顶层比较只警一条（Set 候选循环不再逐候选刷日志）', () => {
    const a = nestedSets(6, true)
    const b = nestedSets(6, true)
    expect(deepEqual(a, b, 3)).toBe(false)
    expect(warnMessages.filter((m) => m.includes('Maximum depth'))).toHaveLength(1)

    // 下一次顶层比较重新计一条，去重不等于永久静默
    expect(deepEqual(a, b, 3)).toBe(false)
    expect(warnMessages.filter((m) => m.includes('Maximum depth'))).toHaveLength(2)
  })

  it('#192 未超限时不产生告警', () => {
    expect(deepEqual(nestedSets(6, true), nestedSets(6, true), 100)).toBe(true)
    expect(warnMessages).toHaveLength(0)
  })
})
