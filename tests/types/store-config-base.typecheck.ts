/**
 * Store 配置接口的共享基座与状态归一化别名（编译期断言）— #421
 *
 * 本文件为「纯类型测试」，不参与 jest 运行时（文件名不以 .test/.spec 结尾），
 * 仅由 `pnpm typecheck:tests`（tsc --noEmit）做编译期校验。
 *
 * 锁定行为：
 * - `StoreConfig`（免泛型推断）与 `StoreOptions`（显式泛型）的非差异选项
 *   由同一个 `StoreOptionsBase` 声明：两者都能按基座形状取值，且基座的键集合就是那 7 项
 *   （新增选项只需改一处，不会再各自漂移）
 * - `ResolvedState<S>` 即此前逐字复制三遍的归一化表达式：对象字面量与工厂函数两种
 *   `state` 写法都归一到同一个 S
 * - 两个配置接口的差异成员（actions / getters / cacheKeys）保持原语义
 *
 * @file tests/types/store-config-base.typecheck.ts
 */

import type { ResolvedState, StoreConfig, StoreOptions, StoreOptionsBase } from '@/types/store.js'

interface CounterState {
  count: number
}

// ==================== 共享基座：两个配置接口都满足 ====================

const configAsBase: StoreOptionsBase<CounterState> = null as unknown as StoreConfig<CounterState>
const optionsAsBase: StoreOptionsBase<CounterState> = null as unknown as StoreOptions<CounterState>
void [configAsBase, optionsAsBase]

// 基座的键集合恰为共享的 7 项（基座多写/漏写成员都会在这两条双向断言里失败）
type SharedKeys = keyof StoreOptionsBase<CounterState>
type ExpectedSharedKeys = 'name' | 'state' | 'enableCache' | 'cacheConfig' | 'stateProtection' | 'subscription' | 'notify'
const _baseKeys: ExpectedSharedKeys[] = null as unknown as SharedKeys[]
const _expected: SharedKeys[] = null as unknown as ExpectedSharedKeys[]
void [_baseKeys, _expected]

// actions 属差异成员，不在共享基座内
// @ts-expect-error 'actions' 不是 StoreOptionsBase 的键
const _notShared: SharedKeys = 'actions'
void _notShared

// 共享选项在两个接口上都只需书写一次（编译期即证明不存在第二份声明）
const sharedOnly = {
  name: 'base-shared',
  enableCache: true,
  cacheConfig: { capacity: 10, ttl: 1000, trackAccessTime: false, enableStats: true },
  stateProtection: { enabled: true, deep: false, productionHandler: 'silent' as const },
  subscription: { maxSubscribers: 5, onLimit: 'throw' as const },
  notify: { clone: false, onlyOnChange: true, async: true },
}
const inferredForm: StoreConfig<CounterState> = { ...sharedOnly, state: (): CounterState => ({ count: 1 }), cacheKeys: ['count'] }
const explicitForm: StoreOptions<CounterState> = { ...sharedOnly, state: { count: 1 }, cacheKeys: ['count'] }
void [inferredForm, explicitForm]

// ==================== ResolvedState：两种 state 写法归一到同一形状 ====================

type FromLiteral = ResolvedState<CounterState>
type FromFactory = ResolvedState<() => CounterState>

const _fromLiteral: FromLiteral = { count: 1 }
const _fromFactory: FromFactory = { count: 2 }
// 交叉断言：两种写法的归一结果必须互为可赋值（同一类型）
const _same1: FromFactory = null as unknown as FromLiteral
const _same2: FromLiteral = null as unknown as FromFactory
void [_fromLiteral, _fromFactory, _same1, _same2]

// 归一失败（S = unknown 的裸配置）时退回 State，仍可按键索引的是 getter 侧的兜底形状
type Unresolved = ResolvedState<unknown>
const _unresolved: Unresolved = {}
void _unresolved

// cacheKeys 仍精确到归一后状态的键
const _cacheOk: StoreConfig<CounterState>['cacheKeys'] = ['count']
void _cacheOk
// @ts-expect-error 拼错的状态键
const _cacheBad: StoreConfig<CounterState>['cacheKeys'] = ['cont']
void _cacheBad
// 工厂写法下 cacheKeys 同样按归一后的状态取键
const _cacheFromFactory: StoreConfig<() => CounterState>['cacheKeys'] = ['count']
void _cacheFromFactory

export {}
