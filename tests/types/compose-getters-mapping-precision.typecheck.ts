/**
 * 组合 getter 与映射精度回归（第四轮复审 #393 / #426，编译期断言）
 *
 * 本文件为「纯类型测试」，不参与 jest 运行时，仅由 `pnpm typecheck:tests` 校验。
 *
 * 锁定行为：
 * - ExtractGetters 不再因元组中某个 store 未声明 getters 而整体塌成 never
 *   （never & X = never ⇒ keyof G 退化为 string | number | symbol，任意 getter 名都编译通过）
 * - mapState/mapActions 未声明时不得被当作「全量映射」，未注入的成员必须保持不可用
 *
 * @file tests/types/compose-getters-mapping-precision.typecheck.ts
 */

import { composeStore, createStore } from '@/index.js'
import type { ConnectOptions, ExtractPageData } from '@/types/integration.js'

// ==================== ExtractGetters：末位 store 无 getters ====================

const withGetters = createStore({
  name: 'getter-precision-a',
  state: { count: 0 },
  getters: { double: (s: { count: number }) => s.count * 2 },
})
const withoutGetters = createStore({ name: 'getter-precision-b', state: { label: 'x' } })

const composed = composeStore([withGetters, withoutGetters])

// 正例：已声明的 getter 类型仍精确
const _double: number = composed.getters.double({ count: 1 })

// 反例：G 塌成 never 时 `keyof never` = string | number | symbol，getter 类型安全静默失效
type ComposedGetters = typeof composed.getters
const _gettersNotNever: [ComposedGetters] extends [never] ? false : true = true

// ==================== 未声明映射 ≠ 全量映射 ====================

type DemoState = { count: number; name: string }

/** 显式声明了 mapState 的配置（数组形式） */
type Declared = { mapState: readonly ['count'] }

/** 可选且未声明 mapState（`ConnectOptions<S>` 即此形态） */
type Undeclared = ConnectOptions<DemoState>

const declaredData = null as unknown as ExtractPageData<DemoState, Declared>
// 已映射键：精确类型，无需判空
const _declaredCount: number = declaredData.count
// 未映射键：仍是 Partial 语义
const _declaredName: string | undefined = declaredData.name

const undeclaredData = null as unknown as ExtractPageData<DemoState, Undeclared>
// @ts-expect-error 未声明 mapState 时不得把 count 当作已注入的精确类型
const _undeclaredStrict: number = undeclaredData.count
// 未声明映射下按未注入处理：可选访问
const _undeclaredOptional: number | undefined = undeclaredData.count
