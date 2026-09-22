# 分片 core-store-p1 — A 组（14 条清单条目 + 4 条跨分片交接项）

A 组文件：`src/core/store/{Store,ActionManager,BatchManager,stateVersion,factory,index}.ts`。
清单：`.ocr-fix/groups5/core-store-p1.md`。B 组（`dirtyTracking.ts`、`StateProxy.ts`）见 `core-store-p1-B.md`。

前任两个 agent 在回合上限处断掉，代码大量落盘但无台账。本台账由 A 组 agent 逐条对账后补写：
14 条清单条目里 12 条前任已落地且经复核成立（含既有回归用例），2 条是半截工程由本片补完
（R5-109 守卫后残留的死码兜底 —— 它同时把 `ActionManager.ts` 的单文件 functions 门槛压到
95.83%；R5-130 新增的 `(补丁, 目标)` 去重守卫零覆盖）；R5-110 的 ActionHistory 半截在 B 组边界外。
另有 4 条跨分片交接项 + 1 条 plugins 分片交接项由本片落地（见「跨分片交接项」）。
门禁前置的 `Store.ts` `no-extra-semi` 已被前任清掉（本片复核，见文末）。

---

## 清单条目

### R5-108  verdict=FIXED  收尾上报归口 `_reportSettledFailure` + `_settleAfterDispatch`，异步拒绝分支两步都不抛错故无需 finally

`ActionManager.ts`：`_safeRefreshCache` 的 `emit('onError')` 改走 `_reportSettledFailure`；同步 catch 的
收尾（补刷缓存 + 补发通知）收敛为 `_settleAfterDispatch`（`try/catch` 归口），收尾自身抛错不再顶掉
`ACTION_EXECUTION_ERROR`；异步拒绝分支由「裸 emit → onSettled」改为「`_reportSettledFailure` → `onSettled`」。
报告的 `finally` 要求未照搬：`_reportSettledFailure` 自带 `console.error` 兜底、`onSettled` 内部已 try/catch，
两步都不可能抛错，`finally` 反而会把「不可能」写成「防一手」——该推理已写进拒绝分支注释，与代码事实一致。
终端 catch 保留（宿主自定义 thenable 的 `.then` 返回值可能是已 rejected 的 promise），不再二次上报同一错误。
验证：`npx jest --ci --silent tests/unit/r5-core-store-p1-action.test.ts` → 8 例全绿（含「onError 处理器抛错
时补发不跳过且只报一次」「收尾自身抛错不顶掉原始错误」「thenable 终端 catch」）。

### R5-109  verdict=FIXED  `notifyOnlyOnChange` 缺 `getMutationCount` 早失败；并删掉守卫之后已成死码的 `() => 0` 兜底

前任只落了守卫（`options.getMutationCount === undefined` 即抛 `TypeError`），
但保留了 `this._getMutationCount = options.getMutationCount ?? (() => 0)`——**守卫之后这个兜底
在任何可达配置下都不会被调用**：`_notifyOnlyOnChange` 为真时它必然是调用方提供的那个函数，
为假时两个读点（`execute` 的三元式、`_shouldNotifyNow` 的 `!开关 ||` 短路）都不取它。
后果不只是难看：`src/core/**` 的单文件门槛是 functions 98%，那个永不调用的箭头让
`ActionManager.ts` 掉到 **95.83%（23/24）**，全量 `--coverage` 直接报
`Coverage for functions does not meet threshold`。这是分片门禁会拦的第二处（第一处是 `no-extra-semi`）。

本片把「开关 + 计数源」两个字段合并为一个 `_mutationGate?: () => number`
（`undefined` = 未启用该模式），非法组合「开关为真但计数源缺失」在类型上不再存在；
守卫保留（对外契约 `notifyOnlyOnChange` + `getMutationCount` 成对，未变），
赋值改为 `options.notifyOnlyOnChange ? options.getMutationCount : undefined`。
`_shouldNotifyNow` 的判据由 `!_notifyOnlyOnChange || _getMutationCount() > baseline`
变为 `!_mutationGate || _mutationGate() > baseline`，在所有可达输入上结果逐位相同。
`getMutationCount` 保持可选（未改成必填）：`Store` 之外的 4 处测试构造点
（`tests/unit/regression/ocr-{low-round4-p1,medium-wave}.test.ts`）依赖可省，收紧迫成 API 破坏。
验证：`npx jest --ci --silent --coverage` → `ActionManager.ts 100 | 100 | 100 | 100`；
`tests/unit/store/modules/ActionManager.test.ts:135` 段（R5-109 注释点名的早失败用例）全绿。

### R5-110  verdict=FIXED（ActionManager 侧）  `boundActions` 与 `initialize` 临时表改空原型；ActionHistory 半截在 B 组边界外

两处容器均为 `Object.create(null)`（字段默认值 + `initialize` 局部表），`__proto__` 命名的 action
不再命中原型 setter。`execute` 的 `hasOwnProperty` 存在性判定在空原型上等价且更干净。
NEEDS-MAIN: `src/extras/action/ActionHistory.ts` —— 报告点名的第二处「stats aggregation」在本分片
禁改清单内（`src/extras/**`），未由任何分片认领；其聚合表若仍是 `{}` 字面量则同一失效模式仍在。

### R5-101  verdict=FIXED  `BatchManager.reset()` 批进行中留开发期告警

`BatchManager.ts:88-91`：`!isProduction() && this._depth > 0` 时 `console.warn`，与 `end()` 的未配对
告警同一口径（同文件既有 `!isProduction()` 门控）。只加诊断、不改语义：批内被抑制的变更仍不补发
（`reset()` 是 teardown 入口，补发会让 destroy 路径多一次通知）。
验证：`tests/unit/r5-core-store-p1-batch.test.ts` 4 例全绿（告警内容 / 配平后静默 / 与 `end()` 告警不互吞 /
生产模式静默）。

### R5-120  verdict=FIXED  入参校验收紧为「非对象或数组」，冗余 `undefined` 分支删除

`factory.ts:104`：`options === null || typeof options !== 'object' || Array.isArray(options)`。
`undefined` 由 `typeof` 命中同一 throw，语义不变。注释按代码事实改写：原注释称「null 会一路走到
`options.name` 抛 TypeError」，实际数组配置更糟——`name`/`state` 都取不到值，静默建出空 store。
验证：`tests/unit/r5-core-store-p1-factory.test.ts` 4 例全绿（null/undefined/数组拒绝、报错口径唯一、
两种合法配置照常建店）；`r5-core-store-p1-store.test.ts:296` 一条锁住「构造器不拦数组」的必要性。

### R5-121  verdict=FIXED  三处签名收敛到共享基座 `StoreConfigWithoutState`

`factory.ts:41` 新增 `type StoreConfigWithoutState<S, A, G> = Omit<StoreConfig<S, A, G>, 'state'>`，
两个重载配置类型与实现签名各自 `& { state: ... }`，`Omit<...,'state'>` 由三处降为一处。
基座刻意不加泛型约束并在注释里说明原因（实现签名要以 `S | (() => S)` 实例化 `StoreConfig`，
`Getters<S>` 装不进 `Getters<S | (() => S)>` 的逆变位），避免后续「顺手补约束」把那条实例化挡掉。
纯类型层重构，运行时无变化；`npx tsc -p tsconfig.json --noEmit` 零报错。

### R5-125  verdict=FIXED  `getStateVersion` 只认自有属性，原型链上的外来版本号不再被采信

`stateVersion.ts:85` 改 `Object.prototype.hasOwnProperty.call(state, STATE_VERSION) ? ... : undefined`。
`Object.create(旧状态)`（`deepCloneState` 按同原型克隆，见 `core/utils/clone.ts`）或原型上有同名
symbol 时，此前两个不同对象报出同一版本，`getStateVersion(root) !== indexedVersion` 恒 false ⇒
脏追踪索引不重算、缓存 TTL 内持续命中陈旧值。`hasOwnProperty` 走 `[[GetOwnProperty]]`，
保护 Proxy 未拦该陷阱、照常转发到原始状态，`store.state` 主读取路径不受影响（用例已锁）。
验证：`npx jest --ci --silent tests/unit/store/stateVersion.test.ts` 全绿，含 `:41` 派生对象与
`:48` 原型污染两条。

### R5-126  verdict=FIXED  `STATE_VERSION` 导出并由测试引用，`Symbol.for` 的取舍按代码事实重写

`stateVersion.ts:29` 改 `export const STATE_VERSION: unique symbol`；`tests/unit/store/stateVersion.test.ts`
已改为 import 该常量，散落的字面量不再需要（`tests/unit/store/stateVersion.test.ts` 属 B/其它分片可写范围，
本片未改）。文件头注释重写：原「core/store 与 extras/selector 分处不同模块需保证取到同一个键」失实
（跨模块共用的是 `getStateVersion` 函数），现行理由是**同一包的重复副本**（分包各自打包）；
并显式写明「本键不是安全边界」+ 读不到版本号时的兜底路径按不可信设计，回应可伪造性质疑。
纯注释 + 可见性变更，无运行时行为差异。
API-CHANGE: `src/core/store/stateVersion.ts` 新增导出 `STATE_VERSION`（模块级，`core/store` barrel 未导出；
不在包 `exports` 映射内的子路径，包外不可见）。

---

### R5-130  verdict=FIXED  别名脏键的扫描目标改为「deepMerge 会就地改写的嵌套对象」

`Store.ts` 新增 `_collectInPlaceMergedObjects(dst, src)`，在 `deepMerge` **之前**采集会被就地改写的
对象（合并后「被就地改写的对象」与「被换成新克隆的值」在状态里同形，事后不可区分），
`_markAliasedKeys(mergedInPlace, patched)` 改收该集合。报告给的场景（`state.c = state.a.nested`
+ `$patch({a:{nested:{…}}})`）此前 `c` 永不标脏、集成层跳过 setData、视图永久停在旧值——现已覆盖。
判据与 `core/utils/helpers.ts:192-200` 的递归条件逐条对齐（仅「补丁值与目标位置同为纯对象」就地改写），
`seenPairs` 守卫也按同构形状复刻（键=补丁节点、值=已合并进它的目标节点集），
`__proto__/constructor/prototype` 位置宁可多收一个（多标一次脏，方向安全）。
验证：`tests/unit/r5-core-store-p1-store.test.ts`「R5-130」3 例 + 本片新增
`r5-core-store-p1-A-notify-and-eviction.test.ts`「(补丁节点, 目标节点) 去重守卫」1 例
（该例同时补上前任留下的 `Store.ts:1065-1066` 未覆盖守卫，现 Store.ts 分支 98.06%）。

### R5-131  verdict=FIXED  按报告的第二条出路处理：把「setState 保留引用」写成文档化契约 + 用例锁

`setState` 的 JSDoc 补齐：值按引用保存（与 `_initializeState`/`$replaceState` 的深拷贝不同），
这是别名脏键与脏追踪索引成立的前提（二者都按对象身份做可达性判定，写入时换克隆等于
把「同一对象被多个顶层键引用」从状态图里抹掉）；并写明代价（调用方事后再改入参不被追踪：
无计数、无脏键、无钩子、缓存里就是同一引用）与出路（读 `$snapshot()`；要「写入即定格」用 `$patch`）。
**不改成写入即克隆**：那会同时废掉 `_markAliasedKeys` 与 `dirtyTracking` 的归属索引两条路径。
注释里「deepMerge 从不把调用方的对象引用落进状态」按 `helpers.ts:185-210` 逐分支核过为真
（非就地分支一律 `clone(...)`，原语直存），不是愿望。
验证：`r5-core-store-p1-store.test.ts:91` 一条同时锁两件事（setState 保留引用 / $patch 不保留）。

### R5-132  verdict=FIXED  整体替换的补丁路径不再跑 O(顶层键数 × 全图) 扫描

`_markAliasedKeys` 开头 `if (mergedInPlace.length === 0) return`。数组 / Map / Set / Date / RegExp /
类实例与类型冲突位的补丁值都会被 deepMerge 换成新克隆、不可能被别的顶层键提前引用，
故这些常见补丁直接跳过扫描（此前每个对象型补丁值都进 `targets`）。
验证：`r5-core-store-p1-store.test.ts:119`（替换型补丁零扫描 / 就地合并型才扫描）。

### R5-133  verdict=FIXED  destroy 的插件排空收敛为 _drainPluginUninstalls 并移入 finally

原实现把「teardown 必须全空」的兜底写在 `try` 尾部：2~6 任一步抛错即跳到 `catch`，
整段收尾被跳过；且清理中重入 `use()` 装进来的插件只被 `this._plugins = []` 丢空，
其 `uninstall()` 永不执行（install 注册的订阅与全局副作用泄漏）。
现抽 `_drainPluginUninstalls()`（后装先卸、逐条从映射消费、代际令牌先删使旧句柄失效），
`try` 内排一次、`finally` 再排一次，`MAX_PLUGIN_UNINSTALL_ROUNDS = 10` 兜住不自收敛的病态清理
并在超限时告警说明丢弃数量。类文档第 7 步同步改为「兜底闸门（finally）」，不再声称权威清空点在步骤 1。
「代际令牌先删」经 `pluginSupport.ts:createPluginUninstaller` 核实为真（令牌比对 `installations.get(plugin)`）。
验证：`r5-core-store-p1-store.test.ts`「R5-133」3 例（重入插件被卸载 / 卸载抛错不阻断 / 轮数上限）。

### R5-134  verdict=FIXED  batch 回调内销毁 Store 时收尾不再调 endBatch

`Store.ts` 的 `batch()` finally 改 `if (!this._destroyed) this.endBatch()`。
改前回调的返回值或其原始错误会被 `endBatch` 的「Cannot call endBatch on a destroyed Store」顶掉，
真实故障消失；组件在 batch 里卸载是可达路径。销毁已作废批量语义（深度归零、监听器全退订），
收尾无事可做，不是吞错。
验证：`r5-core-store-p1-store.test.ts`「R5-134」3 例（返回值不被顶掉 / 原始错误不被替换 /
未销毁时仍照常 endBatch）。

### R5-135  verdict=FIXED  isStateKeyDirty 形参放宽为 string | symbol

`Store.ts:473`。脏键集合按 `Reflect.ownKeys` 收集（`_markAliasedKeys` 与 action 侧脏追踪代理都会给出
symbol 根键），形参只收 `string` 会让 symbol 顶层键永远查不到脏位、脏跳过优化对它静默失效。
`src/types/store.ts` 未声明该方法（`Store` 契约面即这个类），故签名即公开签名。
组合层 `src/core/compose/composeStore.ts:632` 的同名方法仍是 `string`（不在本分片可改范围）：
方法参数按双变比较，`tsc` 不报错，但两侧口径不一致。
NEEDS-MAIN: `src/core/compose/composeStore.ts:632` —— `isStateKeyDirty(key: string)` 同步放宽为
`string | symbol`，与 Store 侧一致（子 store 名是 string，但命名空间模式下透传的语义应当同形）。
API-CHANGE: `Store.isStateKeyDirty` 形参由 `string` 放宽为 `string | symbol`（对调用方向后兼容，
只允许更多实参；symbol 键此前必然抛类型错误或查不到）。
验证：`r5-core-store-p1-store.test.ts:263` 一条（symbol 顶层键可查询）。

---

## 跨分片交接项（主会话指派本片落地）

### HANDOVER-1  verdict=FIXED  Store 接上 `SubscriptionManager.onSubscriberEvicted`

来自 `.ocr-fix/verdicts5/core-store-p2.md` R5-124 的 NEEDS-MAIN。`Store.ts:207-225` 构造订阅管理器处
补 `onSubscriberEvicted`，把驱逐事件包成带 `store 名 / 上限 / evict-oldest / 被驱逐监听器名 /
驱逐后在册注册数` 的 `Error` 交给 `hooks.emit('onError', err, 'subscribe')`。
第二参刻意用 `'subscribe'` 而非 `'dispatch'`：注册可能发生在 action 体内（嵌套 dispatch 中途），
点名任何操作配对键都会让 analyzerPlugin 弹掉与本次驱逐无关的进行中计时；`'subscribe'` 不是配对键
（`pendingEnds` 只有 setState/patch/replaceState/dispatch 四类），只作来源标识。
`info.size` 的文案（「驱逐后在册注册数、不含本次新注册」）按 `SubscriptionManager._enforceLimit`
的调用序核过：`delete(evicted)` 先于 `_reportEviction`，`add` 的 `_totalCount += 1` 在其后。
API-CHANGE: 达到 `maxSubscribers` 并触发 evict-oldest 时，`onError` 钩子多一次发射（此前生产完全静默）。

### HANDOVER-2  verdict=FIXED  `_notifyListeners` 的 needsClone 分支改传 `notify(this._state, true)`

来自 core-store-p2 R5-122 的 NEEDS-MAIN。`Store.ts:1192` 载荷改为 `needsClone || !保护开启 ? this._state : 保护 Proxy`，
`notify(payload, needsClone)`。可写注册各一份独立深拷贝、只读注册共用一份的分配规则就此在
公开 `store.subscribe(fn)` 路径上生效（此前 Store 自备一份克隆再以 `false` 下发，等于替管理器
处置好载荷，管理器只能全员共用）。副产物：每轮 dispatch 的
「cloneOnNotify=false 与可写订阅者共存」dev 告警不再无条件响。
只读档未受影响：`needsClone=false` 仍传缓存的保护 Proxy，`seen[0] === seen[1] === store.state`（用例锁）。
深拷贝份数由 `maxSubscribers` 封顶，不随监听器数量无界扩张（R5-123 的既有不变量）。
归因侧无变化：脏键集合、`_deferredDirtyKeys` 与 `_lastNotifiedMutationCount` 三条逻辑一行未动。
API-CHANGE: 同一轮通知里，两个可写订阅者收到的载荷对象不再是同一个引用（每个可写注册一份克隆）。
**连带**：`tests/unit/store/notify-optimizations.test.ts` 的 NOTIFY-002 由绿转红，见 NEEDS-MAIN 第 1 条。

### HANDOVER-3  verdict=FIXED  `SubscriberEvictionInfo` 随 barrel 导出

`src/core/store/index.ts:21` 的 `export type { SubscriptionManagerOptions }` 行并入
`SubscriberEvictionInfo`，与第四轮 #166「选项类型与类同出口」口径一致；HANDOVER-1 接线后
宿主注册该回调需要拿到载荷类型，否则只能去深路径取或手抄字段。
纯类型再导出，运行时零变化（barrel 的 functions 覆盖率仍 100%）。
验证：`r5-core-store-p1-A-notify-and-eviction.test.ts` 一条编译期锁（`import type` 自 `@/core/store/index.js`）。

### HANDOVER-4  verdict=NEEDS-MAIN  docs/ 的「各回调独立深拷贝」旧口径待主会话统一改写

按指派未动 `docs/**` 与 `CHANGELOG.md`。HANDOVER-2 落地后，core-store-p2 台账点名的
`docs/CONCEPTS.md:18/23/105`、`docs/GUIDE.md:255/349`、`docs/BEST_PRACTICES.md:72`、`docs/API.md:57/89`
应改写为「可写注册各一份、只读注册共用一份」，并可去掉该行原先要注的
「该承诺仅在 `cloneOnNotify=true` 档成立」——Store 侧现在就走 `true` 档。
另需同步：`.codebuddy/skills/geomstore/references/api/*` 由 `pnpm run skill:api` 重生成。

### HANDOVER-5  verdict=FIXED  ActionManager 的中止路径为 onError 补 `'dispatch'` 来源

来自 `.ocr-fix/verdicts5/plugins-types-p1.md` 的 NEEDS-MAIN。核实前任**未做**：
`_reportSettledFailure` 此前恒为 `emit('onError', error)` 单参。
现形参加 `source?: string`，只有 `execute` 的同步 catch（全库唯一 `afterDispatch` 永不再来的路径）
传 `'dispatch'`，其余 4 条共用路径（Promise 拒绝分支、派生 promise 的兜底 catch、
`_settleAfterDispatch`、`_safeRefreshCache`）继续单参发射。
分两条发射而不是统一传 `source`：统一传会让原本只带错误的四条路径多出第二个 `undefined` 实参，
`toHaveBeenCalledWith(error)` 一类按元数判定的既有用例无谓改变（`modules/ActionManager.test.ts:508` 实测如此）。
`analyzerPlugin.discardPendingEnd` 因此重新生效：被中止的 dispatch 会作废自己那条进行中计时。
验证：`r5-core-store-p1-A-notify-and-eviction.test.ts` 两条（同步失败带 `'dispatch'` /
异步 reject 仍单参）+ `tests/unit/plugins/performance/analyzerPlugin.test.ts` 43 例全绿。

---

## 门禁前置项

### 已知的 `no-extra-semi` error（`Store.ts:1070`）  verdict=FIXED（前任已清，本片复核）

`npx eslint src/core/store/Store.ts` → 退出 0、零输出；全仓 `src/core/store/*.ts` 已 grep 不到 `;;`。
报告给的行号是前任落地期间的状态，现已不成立。
另两处（`tests/unit/r5-core-store-p1-dirty-tracking.test.ts:143`、
`...-state-proxy.test.ts:187`）属 B 组，本片未碰。

---

## NEEDS-MAIN 汇总（5 条）

1. `tests/unit/store/notify-optimizations.test.ts:31-54`（NOTIFY-002）—— **本片唯一的红测试**。
   它用 `store.subscribe(fn)`（默认可写注册）却断言「两次通知收到同一缓存 Proxy」，
   注释与标题（「监听器收到只读保护 Proxy」）和实参自相矛盾：可写注册根本走不到零拷贝档。
   HANDOVER-2 落地后，同一轮里两条可写注册各拿一份克隆（R5-122 的既定契约），
   `expect(second).toBe(received)` 即失效。
   **该断言此前能过，恰恰是把「全员共用 Store 自备的那一份克隆」这个待修缺陷固化成了期望**。
   最小改法（已在本片用例上验证等价语义）：该用例的两处 `store.subscribe(...)` 补 `{ readOnly: true }`，
   则 `needsClone=false` ⇒ 载荷就是缓存的保护 Proxy，四条断言原样成立
   （对照 `r5-core-store-p1-A-notify-and-eviction.test.ts` 的「仅只读订阅时保持零拷贝」例：
   `seen[0] === seen[1] === store.state` 且 `!== store.getState()`）。
   该片测试文件不在本分片可写清单内，故未自改。
2. `src/extras/action/ActionHistory.ts` —— R5-110 点名的第二处容器（stats aggregation）仍是普通字面量，
   与 `ActionManager.boundActions` 同一失效模式（`__proto__` 键名）。不在本分片可改范围（`src/extras/**`）。
3. `src/core/compose/composeStore.ts:632` —— `isStateKeyDirty(key: string)` 同步放宽为 `string | symbol`
   （R5-135 的对偶项；方法参数双变所以 `tsc` 不报，但两侧口径已分叉）。
4. `src/plugins/performance/analyzerPlugin.ts:200` —— 「当前库内还不存在这样的发射点（即 onError 一律不弹栈）」
   已被 HANDOVER-5 推翻，现该分支确实命中；同段下一句「补上之后会重新被正确清理」应改为既成事实口径。
5. `docs/**` 与 `CHANGELOG.md`：见 HANDOVER-4。另需为 HANDOVER-1 记一条
   「达到 `maxSubscribers` 触发 evict-oldest 时会向 `onError` 钩子发一次 Error」。

## 行为变更（API-CHANGE）汇总（5 条）

1. HANDOVER-1：evict-oldest 驱逐时多一次 `onError` 发射（生产从完全静默变为可观测）。
2. HANDOVER-2：同一轮通知里两个**可写**订阅者的载荷不再是同一引用。
3. HANDOVER-3：`core/store` barrel 新增类型再导出 `SubscriberEvictionInfo`。
4. R5-135：`Store.isStateKeyDirty` 形参 `string` → `string | symbol`（向后兼容的放宽）。
5. HANDOVER-5：被中止的 dispatch 的 `onError` 现在带第二参 `'dispatch'`，
   `analyzerPlugin` 对被中止计时恢复弹栈（即该 dispatch 重新产出一条「到抛错为止」的耗时指标）。
   （R5-109 的 `_mutationGate` 内部重构**不是** API-CHANGE：`ActionManagerOptions` 未变，
   可达输入上判定逐位相同。）

## 自验口径（全部在改完后执行）

- `npx tsc -p tsconfig.json --noEmit`：全仓零报错。
- `npx tsc -p tsconfig.tests.json --noEmit`：本片 6 个源文件 + 新测试零报错；残留 2 条在
  `tests/types/compose-getters-inference.typecheck.ts`（他分片文件）。
- `npx eslint <A 组 6 源文件 + 新测试>`：退出 0，0 error / 0 warning。
- `npx prettier --check` 同集合：全部一致（`dirtyTracking.ts`、`StateProxy.ts` 的 2 处不一致属 B 组）。
- `npx jest --ci --silent`（全量 144 suites）：**3406 passed / 1 failed**，
  唯一失败即 NEEDS-MAIN 第 1 条（`notify-optimizations.test.ts` NOTIFY-002）。
- `npx jest --ci --silent --coverage`：无 `Jest: Coverage ... does not meet threshold` 报出；
  A 组单文件 `Store.ts 99.44 / 98.06 / 100 / 99.43`，
  `ActionManager.ts`、`BatchManager.ts`、`stateVersion.ts`、`factory.ts`、`index.ts` 均 100。
- 新增回归锁：`tests/unit/r5-core-store-p1-A-notify-and-eviction.test.ts` 10 例（交接项 1/2/3/5 + 别名扫描守卫）。
  既有回归锁沿用前任落地的 `r5-core-store-p1-{action,store,factory,batch}.test.ts` 与
  `store/modules/{ActionManager,ActionManager-notify,BatchManager}.test.ts`、`store/stateVersion.test.ts`，
  本片未新增重复用例、也未修改这些文件的任何断言。

## 计数

A 组 14 条清单条目 + 5 项交接（含文档项）+ 1 项门禁前置：
`FIXED 18` / `FP 0` / `REJECT 0` / `NEEDS-MAIN 1`（HANDOVER-4 文档项，按指派不当判定处理、只记待同步）。
其中前任已落地并经本片复核成立 13 条，本片补做/改正 1 条（R5-109 的死码清理），
交接项 4 条全部落地，新增 1 条被守卫漏覆盖的分支用例。
