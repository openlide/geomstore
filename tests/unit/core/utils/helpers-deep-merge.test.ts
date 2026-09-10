/**
 * deepMerge：嵌套对象的环路守卫
 */

import { deepMerge } from '@/core/utils/helpers.js'

describe('deepMerge 的嵌套环路守卫', () => {
  it('同一源对象的嵌套对象被重复合并到同一目标时短路', () => {
    const target: Record<string, any> = { nested: { a: 1 } }
    const source: Record<string, any> = { nested: { b: 2 } }

    const merged = deepMerge(target, source, source) as Record<string, any>

    expect(merged.nested).toEqual({ a: 1, b: 2 })
  })

  it('菱形共享：同一源子对象合并进不同目标时不被短路', () => {
    // shared 同时挂在 a / b 两个键上：合并 a 与 b 时 src 相同、dst 不同，
    // 守卫不得误判为环路（否则第二个分支会静默丢字段）
    const shared: Record<string, any> = { s: 1 }
    const target: Record<string, any> = { a: {}, b: {} }
    const source: Record<string, any> = { a: shared, b: shared }

    const merged = deepMerge(target, source) as Record<string, any>

    expect(merged.a).toEqual({ s: 1 })
    expect(merged.b).toEqual({ s: 1 })
  })
})
