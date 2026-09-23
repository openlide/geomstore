/**
 * 组合 getter 与映射精度回归（第四轮复审 #393 / #426，编译期断言）
 *
 * 本文件为「纯类型测试」，不参与 jest 运行时，仅由 `pnpm typecheck:tests` 校验。
 *
 * 锁定行为：
 * - ExtractGetters 不再因元组中某个 store 未声明 getters 而整体塌成 never
 *   （never & X = never ⇒ keyof G 退化为 string | number | symbol，任意 getter 名都编译通过）
 * - mapState（`ExtractPageData`）/ mapActions（`ExtractMappedActions`）未声明时不得被当作
 *   「全量映射」，未注入的成员必须保持不可用
 *
 * @file tests/types/compose-getters-mapping-precision.typecheck.ts
 */

import { composeStore, createStore } from '@/index.js'
import type { ConnectOptions, ExtractMappedActions, ExtractPageData } from '@/types/integration.js'

/** 双向精确类型相等断言（与 tests/types/integration-types.typecheck.ts 同口径） */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

// ==================== ExtractGetters：末位 store 无 getters ====================

const withGetters = createStore({
  name: 'getter-precision-a',
  state: { count: 0 },
  getters: { double: (s: { count: number }) => s.count * 2 },
})
const withoutGetters = createStore({ name: 'getter-precision-b', state: { label: 'x' } })

const composed = composeStore([withGetters, withoutGetters])

// 正例：已声明的 getter 类型仍精确（G 塌成 never 时这一行就取不到值）
const _double: number = composed.getters.double({ count: 1 })

// 反例：G 塌成 never 时 `keyof never` = string | number | symbol，getter 类型安全静默失效。
// 「不为 never」这一条探针不足以覆盖 all 退化（#R5-339）：变成 `any` 或被注入索引签名时它仍为 true。
type ComposedGetters = typeof composed.getters
const _gettersNotNever: [ComposedGetters] extends [never] ? false : true = true

// ==================== 键集合精确锁定（两端都声明 getters 的组合） ====================
// 「未声明 getter 的 store 参与组合」这一路（上面的 `composed`）在本夹具里**无法**做键集合断言：
// `createStore` 省略 `getters` 时 `G` 落到默认值 `Getters<S>`（即 `{[K: string]: (state: S) => unknown}`，
// 实测 `ExtractGetters<[typeof withGetters, typeof withoutGetters]>` 的交叉里含 `Getters<{ label: string }>`），
// 于是组合结果自带字符串索引签名，任意 getter 名都编译通过、`keyof` 含 `string`。
// 该现状属 src 侧精度缺口（本轮记为 NEEDS-MAIN：src/core/store/factory.ts 的 G 默认值 /
// types/store.ts 的 Getters），收窄后应把下面这组断言同时施加到上面的 `composed` 上。
// 这里先用两端都声明 getters 的夹具，把「键集合恰为已声明的那些」真正锁住：
// 塌成 never（keyof never = string|number|symbol）、漂白成 any、注入索引签名、键丢失四类退化都会让它报错。
const withSecondGetters = createStore({
  name: 'getter-precision-c',
  state: { label: 'x' },
  getters: { upper: (s: { label: string }) => s.label.toUpperCase() },
})
const composedBoth = composeStore([withGetters, withSecondGetters])
type ComposedBothGetters = typeof composedBoth.getters
const _bothGetterKeysExact: Equal<keyof ComposedBothGetters, 'double' | 'upper'> = true
// @ts-expect-error 'triple' 不是已声明的 getter（键集合一旦被放宽，本指令会变为 unused）
composedBoth.getters.triple
// 已声明键的返回类型精确
const _upper: string = composedBoth.getters.upper({ label: 'x' })

void [_double, _gettersNotNever, _bothGetterKeysExact, _upper]

// ==================== 未声明映射 ≠ 全量映射 ====================

type DemoState = { count: number; name: string }

/** 显式声明了 mapState 的配置（数组形式） */
type Declared = { mapState: readonly ['count'] }

/** 可选且未声明 mapState（`ConnectOptions<S>` 即此形态） */
type Undeclared = ConnectOptions<DemoState>

const declaredData = null as unknown as ExtractPageData<DemoState, Declared>
// 已映射键：精确类型，无需判空
const _declaredCount: number = declaredData.count
// 未映射键：仍是 Partial 语义。单向赋值锁不住方向性——`string | undefined` 能过，
// 被错误收窄成必填 `string` 同样能过，故补一条反向断言（#R5-338）：
// 未映射键一旦被收成必填（过度映射回归），下面的 @ts-expect-error 会变为 unused 而让 typecheck:tests 失败。
const _declaredName: string | undefined = declaredData.name
// @ts-expect-error 未映射键不得被收成必填 string
const _declaredNameRequired: string = declaredData.name

const undeclaredData = null as unknown as ExtractPageData<DemoState, Undeclared>
// @ts-expect-error 未声明 mapState 时不得把 count 当作已注入的精确类型
const _undeclaredStrict: number = undeclaredData.count
// 未声明映射下按未注入处理：可选访问
const _undeclaredOptional: number | undefined = undeclaredData.count

// 逐键精确锁定（#R5-342）：上面的「可赋值」断言在结果被漂白成 `any`、或交叉里混进
// `never` / 索引签名时都会白过，这里把手写期望类型与 `ExtractPageData` 的结果逐键比对。
type DeclaredData = typeof declaredData
type UndeclaredData = typeof undeclaredData
const _declaredCountExact: Equal<DeclaredData['count'], number> = true
const _declaredNameExact: Equal<DeclaredData['name'], string | undefined> = true
const _undeclaredCountOptional: Equal<UndeclaredData['count'], number | undefined> = true

void [_declaredCount, _declaredName, _declaredNameRequired, _undeclaredStrict, _undeclaredOptional]

// ==================== mapActions 分支（#R5-337） ====================
// 上面的 mapState 断言走的是 ExtractPageData，而 actions 由 `ExtractMappedActions` 单独映射
// （ExtractPageData 不含 actions），文件头承诺的「mapActions 未声明不得当作全量映射」
// 此前落在这份夹具里没有任何断言。守卫 `undefined extends M['mapActions']` 一旦失效，
// 只有下面这两组断言拦得住。

type DemoActions = { login: (id: string) => Promise<boolean>; logout: () => void }

/** 显式声明了 mapActions 的配置（数组形式，只映射 login） */
type DeclaredActions = { mapActions: readonly ['login'] }

/** 可选且未声明 mapActions（`ConnectOptions<S, A>` 即此形态） */
type UndeclaredActions = ConnectOptions<DemoState, DemoActions>

const declaredMapped = null as unknown as ExtractMappedActions<DemoActions, DeclaredActions>
// 已映射 action：签名逐字精确（形参被放宽成 any 时下面这条 @ts-expect-error 会失效）
const _login: Promise<boolean> = declaredMapped.login('u1')
// @ts-expect-error login 的形参仍是 string，未被放宽
declaredMapped.login(1)
// @ts-expect-error 未映射的 logout 不得出现在注入结果里
declaredMapped.logout()

const undeclaredMapped = null as unknown as ExtractMappedActions<DemoActions, UndeclaredActions>
// @ts-expect-error 未声明 mapActions 时不得按「全量映射」把 logout 当作已注入成员
undeclaredMapped.logout()

void [_login, declaredMapped, undeclaredMapped]
