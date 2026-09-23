# hot-p0（第六轮 critical + high，主会话直接做）

条数：9｜FIXED 9 / FP 0 / REJECT 0 / NEEDS-MAIN 0
回归锁统一在 `tests/unit/hot-round6.test.ts`（16 例全绿；下列每条标出对应用例）。
自验命令与结果见文件末尾「本分片自验」。

## R6-001 high examples/advanced/compose-stores.ts:L94-99
verdict: FIXED
改动: 订阅片段改成 `demoComposeSubscription()` 异步流程——dispatch 后让出一个宏任务再 `unsubscribe()`，并在注释里写清「组合层通知一律按微任务合并，同 tick 退订会把本轮广播整批丢掉」；顺带把 `'night'` 换成类型允许的 `'dark'`。
回归锁: tests/unit/hot-round6.test.ts › R6-001 组合层通知按微任务合并（示例口径）（同 tick 退订 → `[]`，让出宏任务后退订 → `['night']`）
文档: 无（示例自身即文案）

## R6-002 high examples/basic/03-getters.ts:L1-5
verdict: FIXED
改动: 覆盖清单与两处注释删掉「依赖未变时复用缓存」，改为「每次 `getter()` 都按当前状态重算，Store 侧无 getter 结果缓存」，并把「需要依赖未变则复用」指向 `extras/selector` 的 `createSelector`。
回归锁: 纯文案修正，不加锁（库行为未变）
文档: **docs/GUIDE.md:244 与 docs/API.md:88 是同一段假话**，需按同口径改（报告点名但文件在本轮可评审集外）

## R6-003 high examples/cache/01-basic-cache.ts:L19-30
verdict: FIXED
改动: 读取改走 `getCached('profile')`（`getState()` 不查缓存，hits/misses 恒 0）；「写入会失效缓存」改成「写穿更新，下次读取仍命中且拿到新值」；新增 `invalidateCache('profile')` 演示真正的失效入口，并注明 `$replaceState` 整体清空。
回归锁: 与 f1-01 的 `tests/unit/r6-f1-01-cache-observability.test.ts` 同一判据（该锁已实跑旧示例先红）；本文件按 `typecheck:examples` + 命令级核对
文档: docs 缓存章节若同样写着「setState 失效缓存」需同步为写穿口径

## R6-004 high packages/benchmark/src/runner.ts:L308-316
verdict: FIXED
改动: 第 4 判定项（缓存命中率）改为只在 `scenario.cacheConfig !== undefined` 时计入 `details`，非缓存场景恢复「3 项 ⇒ 必须全过」，与 `MIN_PASS_RATIO` 上方注释一致；命中率对非缓存场景降级为纯观测。同时删掉 `isCacheTestScenario` 这个恒真分支（门限直接取 `CACHE_SCENARIO_MIN_HIT_RATE`）。
判据: `enableCache: true` 保留——写穿路径本身是要测的成本之一，砍掉会让 basic-read 系列测到另一条代码路径
回归锁: benchmark 不在 jest 采集范围内，验证方式为命令级冒烟 `pnpm bench`（`packages/benchmark` 内 `tsc && node dist/smoke.js`）exit 0；`npx tsc --noEmit`（benchmark 包）0 错
文档: 若 CHANGELOG 提过「非缓存场景容许 1 项失败」需按修正后口径说明

## R6-005 high src/core/compose/composeStore.ts:L295-311
verdict: FIXED
改动: 三条读路径（`getState` / `state` / `$snapshot`）的 pick 统一过新增的 `_readablePick`——子 store 已被独立销毁时并入**空视图**并按 store 去重告警一次（`_warnedDestroyedChildren` WeakSet），与写侧 `applyToStore` 的「跳过＋告警」同口径；`_ensureMergedCacheFresh`/`_recordChildVersions` 改用 `_childVersion`，把「已销毁」编成 `-1` 哨兵，避免死店此前并入的键被当作新鲜数据继续读；`compose/helpers.ts` 的 `findTargetStoreWithKey` 平铺分支不再对死店调 `getState()`（改由 `warnDestroyedChildOnce` 一次性告警）。
回归锁: tests/unit/hot-round6.test.ts › R6-005（3 例：命名空间读容错＋只告警一次、三条读路径口径一致、平铺模式归属判定不再抛）
文档: 组合层「子 store 独立销毁」语义从「读崩」变成「读空视图＋告警」，属行为变更，需写进 CHANGELOG 与 GUIDE 的组合章节

## R6-006 high src/core/store/StateProxy.ts:L219-228
verdict: FIXED
改动: 新增 `_readChild`，在包装前先兑现 Proxy [[Get]] 不变量——自有数据属性「既不可配置也不可写」时原样返回裸值，深代理与数组代理（symbol 键 / 数字索引 / 自定义属性三处）统一走它；判据与 `dirtyTracking.ts` 已有守卫一致，代价（这类属性不被包装/保护、写入不计数）写进注释。`_createDeepProxy` 的 get 注释同步改口径。
回归锁: tests/unit/hot-round6.test.ts › R6-006（3 例：冻结节点、`$snapshot()` 深冻结子树写回、冻结数组索引）——修复前第 2 例直接抛 TypeError
文档: stateProtection 文档需补一句「冻结/不可写属性拿到的是裸引用，不受保护代理拦截」

## R6-007 security src/core/store/Store.ts:L336-365
verdict: FIXED
改动: `setState` 对 `PROTO_SENSITIVE_KEYS`（`__proto__`/`constructor`/`prototype`）改走 `defineOwnProperty`，与 `deepMerge`、`$patch`、`$replaceState` 同一份判据；相等性检查对敏感键改按**自有属性描述符**取值（`state.__proto__` 的 getter 返回原型而非写入值），于是「什么都没写成功却推进 `_mutationCount`/脏键/通知」的分支不存在了。为消除重复判据，把 `PROTO_SENSITIVE_KEYS` 与 `defineOwnProperty` 从 `core/utils/helpers.ts` 导出、Store 侧不再各留一份。
回归锁: tests/unit/hot-round6.test.ts › R6-007（2 例：原型不被换＋注入键不可经链读到、重复写同一值短路不再广播）
文档: 公开写入路径的原型污染口径需在 CHANGELOG 记一条（`setState('__proto__', …)` 从「换掉原型」变为「承载为自有数据属性」）

## R6-008 high src/extras/snapshot/clone.ts:L367-497
verdict: FIXED
改动: 与 `core/utils/clone.ts` 合流三道门槛——① 新增导出的 `isSlotBearingBuiltin`（`Object.prototype.toString` tag + `ArrayBuffer.isView`）命中的值（Promise/装箱原始值/ArrayBuffer/TypedArray/DataView/WeakMap/WeakSet/Error/Function/Generator）保留原引用，不再产出 `instanceof` 仍真却缺内部槽位的空壳；② `Date/RegExp/Map/Set/Array` 各分支加 `isExactly` 门槛，子类保留原引用（不再被 `new Map()` 降级成基类副本）；③ 类实例仍按既有契约重建为同类实例。`clone-async.ts` 同一段代码一起改（两条路径同步）。
回归锁: tests/unit/hot-round6.test.ts › R6-008（5 例：内建容器子类、槽位值保留引用、diff 不误报变更、异步引擎同口径、普通对象/类实例既有契约不破）
文档: 快照对「子类与不可克隆对象」从重建改为保留原引用，属行为变更，需在 CHANGELOG / snapshot types 文档 / SKILL 里写明；`customCloner` 是宿主对象的兜底出口

## R6-009 high src/integrations/enterprise/background-sync.ts:L87-108
verdict: FIXED
改动: 「非活跃时间过长，刷新状态」的日志移到 `refreshData` 守卫**之后**、按实际结果打印；缺 action 时改为一次性 `logger.warn` 点名缺失的 action 与后果（`BackgroundSyncHandler` 新增 `refreshActionMissingWarned`，push 处初始化），不再留下与事实相反的账。
回归锁: tests/unit/hot-round6.test.ts › R6-009（2 例：缺 refreshData 只告警一次且不打印刷新日志、有 refreshData 打印一次并派发）
文档: `BackgroundSyncConfig.maxInactiveTime` 字段注释与 docs/API.md:629 需写明「store 必须自带名为 refreshData 的 action」

## 本分片自验

- `npx jest tests/unit/hot-round6.test.ts --ci` → 16 passed
- `npx jest tests/unit/core/compose tests/unit/core/store tests/unit/core/utils tests/unit/extras/snapshot --ci` → 全绿（compose 6 suites/298、store+utils 与 snapshot 合计 173+210 例）
- `npx jest tests/unit/core --ci` → 除 f1 在飞文件外全绿；`tests/integration/enterprise.test.ts` 3 条离线队列用例红，落在 **f1-08 正在改的 `offline.ts`**，非本分片改动所致（gate 阶段复核）
- `npx tsc -p tools/tsconfig.examples.json --noEmit` → 我这三个 example 文件零错（其余报错来自 f1-02 在飞文件与遗留探针文件）
- `packages/benchmark`：`npx tsc --noEmit` 0 错、`pnpm bench` 冒烟 exit 0
- `git status --porcelain`：本分片只动 `src/core/{compose/*,store/Store.ts,store/StateProxy.ts,utils/{clone.ts,helpers.ts}}`、`src/extras/snapshot/{clone.ts,clone-async.ts}`、`src/integrations/enterprise/background-sync.ts`、`packages/benchmark/src/runner.ts`、3 个 examples 文件、`tests/unit/hot-round6.test.ts`

## 主会话尾巴（不在 hot 分片内、需后续处理）

1. **报告外缺陷**：`src/extras/snapshot/diff.ts` 的叶子比较对「无自有可枚举键的内建值」判等——`compareSnapshots({n:new Number(1)}, {n:new Number(2)})` 仍报 `changed:false`。R6-008 消除的是空壳，这条根因在 diff.ts 自身的比较口径，待 f1-08 交回 `diff.ts` 后处理（已把那条「两份不同装箱值不再被报成无差异」的用例从 hot 锁里换掉，避免留假锁）。
2. **R6-009 的另一半**：让库自带的 `createUserStore` 提供 `refreshData`（委托 `syncWithServer`）以闭环自带示例——`user-store.ts` 归 f1-09，等它交回后由主会话补，属新增公开 action（行为变更，需 CHANGELOG + 文档）。
3. **R6-007 的旁证**：`src/plugins/builtin.ts:427` 注释「键的合法性由核心在运行时兜住」现在才成立；该文件归 f1-09，若它没顺手改注释则主会话补。
4. `src/core/utils/helpers.ts` 的 `PROTO_SENSITIVE_KEYS`/`defineOwnProperty` 已改为导出，`deepMerge` 侧行为零变化。
