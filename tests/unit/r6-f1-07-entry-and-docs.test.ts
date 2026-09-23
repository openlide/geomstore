/**
 * 第六轮 f1-07 分片回归（R6-092 / R6-096 / R6-097 / R6-098）
 *
 * 覆盖的公开行为：
 * - 超时判据落在 `code === TIMEOUT_ERROR_CODE` 上（文档示例的口径可落地），
 *   且该常量与 `LogSink` / `LogPhase` 一样经 `@openlide/geomstore/extras` 可达
 * - `extras/selector` 薄壳文档列出的重试工厂确实在入口上，示例签名可运行
 * - `createSelector` 文档新增的「对象键 Map → 快照路径永不命中」口径与实现一致
 */

import * as extrasEntry from '@/extras/index.js'
import * as selectorEntry from '@/extras/selector.js'
// 类型同一性检查：任一侧缺项即编译报错（R6-096 的漂移正是「本入口漏写」）
import type { LogPhase as LogPhaseFromExtras, LogSink as LogSinkFromExtras } from '@/extras/index.js'
import type { LogPhase as LogPhaseFromAction, LogSink as LogSinkFromAction } from '@/extras/action.js'

const { TIMEOUT_ERROR_CODE, withTimeout } = extrasEntry
const { createSelector } = selectorEntry

describe('R6-096 extras 总入口的类型清单与 ./action.js 子入口一致', () => {
  it('LogSink / LogPhase 在两个入口上都是同一类型', () => {
    const sink: LogSinkFromExtras = {} as LogSinkFromAction
    const sinkBack: LogSinkFromAction = sink
    const phase: LogPhaseFromExtras = 'result' as LogPhaseFromAction
    const phaseBack: LogPhaseFromAction = phase as LogPhaseFromExtras

    expect([sinkBack, phaseBack]).toHaveLength(2)
  })

  it('TIMEOUT_ERROR_CODE 经总入口可达（跨入口识别超时的判据不必深链）', () => {
    expect(typeof (extrasEntry as Record<string, unknown>).TIMEOUT_ERROR_CODE).toBe('string')
    expect(TIMEOUT_ERROR_CODE).toBe('ACTION_TIMEOUT')
  })
})

describe('R6-092 超时判定按 code，不按消息文本', () => {
  it('withTimeout 抛出的错误带 code，且两个入口的消息文本确实不同', async () => {
    const descriptor: PropertyDescriptor = {
      value: async () =>
        new Promise<string>((resolve) => {
          setTimeout(() => resolve('late'), 30)
        }),
    }
    withTimeout(5)({}, 'slow', descriptor)

    const call = descriptor.value as () => Promise<unknown>
    const caught = (await call().catch((reason: unknown) => reason)) as Error & { code?: unknown }

    expect(caught.code).toBe(TIMEOUT_ERROR_CODE)
    // 文本判据不可靠的实证：本入口是 `Timeout after`，执行器入口是小写 `Action timeout after`，
    // 按 `includes('Timeout after')` 匹配会漏判后者
    expect(caught.message).toContain('Timeout after 5ms')
  })
})

describe('R6-097 selector 薄壳文档与入口一致', () => {
  it('文档列出的值导出全部在入口上（含两个重试工厂）', () => {
    const entry = selectorEntry as Record<string, unknown>
    const documented = [
      'createSelector',
      'createMemoizedSelector',
      'createStructuredSelector',
      'createParametricSelector',
      'createRetrySelector',
      'createRetrySelectorAsync',
      'SelectorFactory',
      'SelectorComposer',
    ]

    expect(documented.filter((name) => typeof entry[name] !== 'function')).toEqual([])
  })

  it('文档示例的真实签名可运行：单参 selectorFn，第二个参数是 options', () => {
    const selectDouble = createSelector((s: { count: number }) => s.count * 2)
    expect(selectDouble({ count: 21 })).toBe(42)

    // reselect 风格的两参写法会把组合函数当 options 静默忽略——本用例固化「不会有两参语义」
    const twoArg = createSelector((s: { count: number }) => s.count, ((n: number) => n * 2) as unknown as undefined)
    expect(twoArg({ count: 21 })).toBe(21)
  })
})

describe('R6-098 无版本号快照路径：对象键 Map 让缓存永不命中', () => {
  it('Map 键是对象时每次调用都重算；键是原始值时命中缓存', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})

    const objectKeyCompute = jest.fn((s: { dict: Map<object, number> }) => s.dict.size)
    const objectKeySelector = createSelector(objectKeyCompute)
    const objectKeyState = { dict: new Map([[{ id: 1 }, 10]]) }
    objectKeySelector(objectKeyState)
    objectKeySelector(objectKeyState)
    objectKeySelector(objectKeyState)
    // deepEqual(克隆体, 活状态) 在对象键 Map 上恒 false → 每次 miss（文档新增的口径）
    expect(objectKeyCompute).toHaveBeenCalledTimes(3)

    const primitiveKeyCompute = jest.fn((s: { dict: Map<string, number> }) => s.dict.size)
    const primitiveKeySelector = createSelector(primitiveKeyCompute)
    const primitiveKeyState = { dict: new Map([['a', 10]]) }
    primitiveKeySelector(primitiveKeyState)
    primitiveKeySelector(primitiveKeyState)
    // 纯对象/原始值键的 Map 走快照路径可正常命中
    expect(primitiveKeyCompute).toHaveBeenCalledTimes(1)

    warn.mockRestore()
  })
})
