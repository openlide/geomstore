# 分片 core-store-p2 — 第五轮（ocrreview.md）10 条判定

清单：`.ocr-fix/groups5/core-store-p2.md`。
owned 源码：`src/core/store/{StoreCache,SubscriptionManager,types,utils}.ts`。
回归锁：新建 `tests/unit/r5-core-store-p2-notify-and-limit.test.ts`（4 例）；
同步的既有用例见各条（`tests/unit/store/modules/{StoreCache,SubscriptionManager,utils}.test.ts`、
`tests/unit/store/deep-freeze.test.ts`、`tests/unit/store/production-mode-silence.test.ts`）。

## 断片对账结论

**前任在被打断前已把这 10 条全部落到代码里**（含 `tests/unit/store/**` 的断言同步），
判定台账是唯一缺失项。题面「R5-140/141/142 大概率完全没做」与磁盘现状不符：三条都已完成
（`utils.ts:46` 去门控、`utils.ts:79-84` 键范围口径、`utils.ts:158-159` 空值回退），按现状记账。
复核后本分片补 4 处失真 + 4 条回归锁，**未新增任何功能改动**：

1. `SubscriptionManager.notify` 文档段称「Store 仅在无**可写**订阅者时传 false」——失实：
   `Store.ts:1191` 无条件 `notify(payload, false)`（是否克隆由它自己的 `needsClone` 决定）。已改写为
   按「拷贝归属」表述，并点明 `false` 档的隔离责任在调用方（R5-122 未闭环的正是这一档）。
2. 同函数内共存守卫的注释称「Store 侧按 `hasWritableListeners()` 传值不会触发」——同样失实：
   该告警在「存在可写订阅者的每一轮 dispatch」都会打出（dev-only）。已改为如实描述，行为不动
   （主会话按下方 NEEDS-MAIN 改 Store 后，这条自然退化成只兜直连调用方）。
3. `onSubscriberEvicted` 的 JSDoc 把尚不存在的 Store 接线写成既成事实。已改为「宿主可接、库内未接」。
4. `tests/unit/store/modules/StoreCache.test.ts:8` 的未用 `State` 导入（HEAD 起即失用，非本片引入）删除，
   否则 `lint:ci --max-warnings 0` 挂。

计数：FIXED 10 / FP 0 / REJECT 0 / NEEDS-MAIN 0（另有 4 条衔接项，见文末汇总）。
行为变更 7 条，见「## 行为变更（API-CHANGE）汇总」。

## 自验口径（全部在改完后执行）

- `npx tsc -p tsconfig.json --noEmit`：全仓零报错。
- `npx tsc -p tsconfig.tests.json --noEmit`：本分片 4 个源码与 6 个测试文件零报错；残留 7 条全在他分片
  （`tests/types/integration-types.typecheck.ts:297`、`tests/types/store-config-base.typecheck.ts:102`、
  `tests/unit/r5-core-store-p1-action.test.ts:91`、`tests/unit/r5-extras-error-reporters.test.ts:215/228`）。
- `npx eslint <4 源码 + 5 既有测试 + 1 新测试>`：0 error / 0 warning。
- `npx jest --ci --silent tests/unit/store tests/unit/r5-core-store-p2 tests/unit/regression tests/unit/core tests/unit/integrations`
  → 51 suites / 1571 例全绿（含 `tests/unit/core/compose/composeStore.test.ts` 的订阅额度两例，见 R5-123）。
- 全仓 `npx jest --ci --silent` → 141 suites 中 3 挂 / 6 例失败，全在
  `tests/unit/r5-core-store-p1-state-proxy.test.ts`（R5-114/118/119）与
  `tests/unit/extras/ocr-medium-round4-p3|p4.test.ts`（#286/#304），属并行分片中间态；
  两条失败用例的 import 闭包（`extras/snapshot/**`、`core/store/stateVersion.js`、`extras/error/**`）
  不含本分片任何文件，已逐个核对。
- 覆盖率（`--collectCoverageFrom` 限定本片 3 个有运行时代码的文件）：`StoreCache.ts`、
  `SubscriptionManager.ts`、`utils.ts` 均 **100% stmts / 100% branch / 100% funcs / 100% lines**
  （门槛 85/98/98/98）；`types.ts` 纯类型无运行时覆盖。
- `tests/unit/hot-round5.test.ts`（25 例，主会话 hot-p0 回归锁）与 `tests/unit/store/production-mode-silence.test.ts`
  在改动后仍全绿：R5-122 未回退「仅只读订阅 → 零拷贝」判定，R5-124 的生产静默口径保住。

### R5-111  verdict=FIXED  ttl 在构造期归一为「有限非负」并留开发期告警

`StoreCache.ts:43-55`：`const ttl = options.ttl ?? 0` → `Number.isFinite(ttl) && ttl >= 0 ? ttl : 0`，
归一时打一条 `[GeomStore] cacheConfig.ttl=<x> 不是有效的过期时长…已按 0（不过期）处理`。
比报告建议式（`typeof ttl === 'number' && Number.isFinite(ttl) && ttl > 0 ? ttl : 0`）多一个信号、
少一个副作用：合法的 `ttl: 0` 不会被告警，算错的配置不会再无声吞掉。口径与
`src/core/cache/LRUCache.ts:128` 的 capacity 守卫（`Number.isFinite` + 归一到默认值）对齐，已在注释里点名。
API-CHANGE: `ttl: Infinity/NaN/负数` 此前依赖「`Date.now()-ts > Infinity` 恒 false」或「`> NaN` 恒 false」
意外得到永不过期，现在显式归一为 0；对外结果同为不过期，差别只在 dev 多一条告警。
验证：`tests/unit/store/modules/StoreCache.test.ts` 的 `describe('StoreCacheManager ttl 有效性守卫')`
逐值断言内部 `_ttl === 0` + 告警文案（NaN/Infinity/-Infinity/-1000 四条），另有三条反向锁：
归一后缓存仍命中（getter 不被回读）、合法 `0`/`1000` 原样保留且不告警、不传 `ttl` 保持 0 且不告警。

### R5-112  verdict=FIXED  两条 Map 的删除语义收进 _deleteEntry / _clearEntries

`StoreCache.ts:175-188` 新增两个私有方法；5 个调用点全部改走它们（`grep -n "_cache.delete|_timestamps.delete|
_cache.clear|_timestamps.clear"` 在文件内只剩这两个方法体里的 4 行）：`_writeEntry` 的 undefined 分支（162）、
`invalidate(key)`（249）、`invalidate()`（251）、`enable()` 的重建清空（133）、`disable()`（238）。
报告点名的「历史上 clearOldState 漏过 timestamps」随该方法的删除一并消失（见 R5-113）。
签名比报告少一层 `<K extends keyof S>`：调用点传的都是已窄化的 `keyof S`，泛型只增加噪音。
验证：`StoreCache.test.ts` 把原先直接调 `clearOldState` 的 #15 回归段改写为 3 条「由仍在线的公开入口
复验两表同步」（`invalidate(key)` / `refreshFromState` 写 undefined / `disable()`+`invalidate()`），
用 `_timestamps` 窥测内部状态，全部通过。

### R5-113  verdict=FIXED  删除不可达的 clearOldState（报告的第一个方案）

报告的事实成立且已复核：`grep -rn clearOldState src tests` 现在零命中（改前只命中定义与本文件的单测，
`.cache/` 下的命中是旧构建产物）；`Store.ts:420-422` 的 `$replaceState` 走的确实是 `invalidate()` 整表清空，
注释里写明「仅按旧状态键清理会漏掉已从状态删除的键」。保留接线（第二方案）会把 `$replaceState`
从「整表清空 + 按新状态回填」退化成按键遍历，正是那条注释警告过的漏法，故不采纳。
API-CHANGE: `StoreCacheManager.clearOldState(stateKeys)` 从类面上移除。可达性核实为仅内部件——
`StoreCacheManager` 只由 `src/core/store/index.ts:23` 的 barrel 出口，而该 barrel 不在 `package.json`
的 `exports` 映射里（`.`/`./core`/`./integrations`/`./extras*`），`src/index.ts`、`src/core/index.ts` 均未再导出。
`CHANGELOG.md:379` 那句「clearOldState 的 _timestamps 泄漏已修」属 `[0.1.3] - 2026-08-22` 的历史条目，不改。

### R5-122  verdict=FIXED  notify 按「注册的可写性」分配载荷：可写注册各一份克隆，只读共用一份

`SubscriptionManager.ts:279-298`：删掉整轮共用的单个 `payload`，改为 `listeners`/`payloads` 两条平行数组，
`payloads.push(cloneOnNotify && !readOnly ? deepCloneState(state) : sharedPayload)`，
`sharedPayload` 仅在本轮存在只读注册时才拷一份（`hasReadOnlyRegistration`，279 行）。
兑现报告主方案，也修正了原注释那条不成立的「单次克隆已能保证监听器间的引用隔离」；
只读订阅继续共用一份，第四轮锁定的「仅只读订阅 → 零拷贝」判定（`Store.ts:1163` 的 `needsClone`）
与 `cloneOnNotify=false` 档的引用语义一字未动。克隆份数由 R5-123 的上限封顶，不随重复注册无界扩张。
本分片另把 `notify` 的文档与守卫注释改成如实口径（见「断片对账结论」第 1、2 条）。
API-CHANGE: `cloneOnNotify=true` 档每次通知的深拷贝次数由 1 变成「可写注册数 +（有只读注册则 +1）」，
代价换回监听器之间的隔离；`false` 档零变化。
NEEDS-MAIN: `src/core/store/Store.ts:1159-1191` —— `_notifyListeners` 目前**无条件**传
`notify(payload, false)`，可写订阅者存在时它自己只克隆一份，所以公开 `store.subscribe(fn)` 路径上
「先执行的可写回调改载荷 → 后面监听器读到半成品」仍未闭环，本分片改不到那行。最小改法：
`needsClone` 为真时改 `this._subscriptionManager.notify(this._state, true)`（克隆交给管理器按注册分配），
`false` 分支保持传保护代理 + `false`；这样只读订阅的零拷贝档与 R5-124 的告警噪音同时恢复正常。
未钉 Store 侧用例是故意的：现在钉上就等于把这条待修缺陷固化成期望行为。

### R5-123  verdict=FIXED  上限门禁覆盖每一次注册（含同一监听器的重复注册），无界增长路径关闭

`SubscriptionManager.ts:132-149` 把 `_totalCount >= _maxSubscribers` 的检查提到 `add` 的入口、
先于「已在册」分支，达限时交给新的 `_enforceLimit(listener)`（166-190）：`throw` 策略照抛；
`evict-oldest` 下**本次是重复注册就让位该监听器自己最早的一份**（`selfDuplicated` 判定，172 行），
否则驱逐全局最旧的一份注册，两侧都以「一份注册」为单位、不整条删除。
`size <= maxSubscribers` 从此是常态不变量（唯一例外 `maxSubscribers <= 0` 配 evict-oldest，已写进文档），
报告所述「循环订阅同一函数耗尽内存」不再可达。第四轮结论「已达上限时重复订阅不再驱逐无辜的最旧监听器」
被保住——让位的是它自己那一笔。
API-CHANGE: 达上限时的重复注册由「免检、静默加一笔」变成「挤掉自己最早的一笔 / `throw` 策略下抛错」，
`size` 由「可高于 maxSubscribers」变成硬上界。旧用例 `SubscriptionManager.test.ts` 的「引用计数不影响上限驱逐语义」按新契约重写为
「上限对每一次注册生效：重复注册不再越界，新监听器仍按全局最旧驱逐」（310 行，原断言
`size=3 > max=2` 正是本条要找的洞），并新增泄漏护栏用例（333 行，200 次 `subscribe(同一函数)`
→ `size===4`、`registrations` 子 Map 只留 4 笔）。
衔接核对：`composeStore` 的单路订阅（`_ensureChildSubscriptions` 由 `_childSubscriptionsReady` 闩住、
每子 store 仅 add 一次匿名箭头函数）走的是「新监听器」路径，与修复前逐字一致；
`tests/unit/core/compose/composeStore.test.ts` 的 mux-sub 额度例（2068 行）与 rollback-b `onLimit:'throw'`
例（2167 行）均通过。`maxSubscribers<=0` 与 `firstListener===undefined` 两个边界用例照旧绿。

### R5-124  verdict=FIXED  驱逐改走宿主上报通道，并在告警里带出被驱逐者标识

两条方案都做了：`SubscriberEvictionInfo` + 新可选 `SubscriptionManagerOptions.onSubscriberEvicted`
（`SubscriptionManager.ts:21-28`、`onSubscriberEvicted` 在 63 行）由 `_reportEviction`（198-209）投递，
通道自身抛错被就地兜住（dev 打 `console.error`、生产静默），与 #148 那轮的 `onListenerError` 同构；
dev 告警文案（176-184）从光秃秃的「达到上限」升级为带 `evicted.name || '(匿名函数)'` 与
「重复订阅让位自己最早一份 / 已驱逐最早监听器」的分支说明。`onLimit:'throw'` 分支不产生驱逐事件。
`SubscriptionManagerOptions` 为此加类型参数（默认 `State`，逆变位点需要），`src/core/store/index.ts:21`
与 `tests/unit/regression/ocr-low-round4-p2.test.ts:30` 的裸用法照旧编译。
API-CHANGE: 纯增项——新增一个可选配置与一个导出接口；未配置时除 dev 告警文案变长外行为不变。
本分片另把该选项的 JSDoc 从「Store 转成 hooks 的 onError 事件」改为「库内尚未接线」（对账结论第 3 条）。
NEEDS-MAIN: `src/core/store/Store.ts:207-215` —— 构造 `SubscriptionManager` 处补
`onSubscriberEvicted: (info) => this._hooks.emit('onError', <带 listener/maxSubscribers 上下文的错误>)`，
`onListenerError` 已在同一段；不接则生产仍是「静默驱逐 + 无指标」，本条只完成了一半。
NEEDS-MAIN: `src/core/store/index.ts:21` 旁补 `export type { SubscriberEvictionInfo }`（按第四轮 #166
「选项类型与类同出口」的口径，缺它宿主只能去深路径取类型）。

### R5-127  verdict=FIXED  删掉注释的自我更正史，只留现行可见性口径

`src/core/store/types.ts` 整片唯一改动：删去第 11 行「原注释笼统写『不对外暴露』，与 barrel 的
实际再导出不一致，故按上述口径更正」。保留的 6-10 行已经完整描述现行契约（四个类型由
`core/store` barrel 再导出、该子路径不在 `package.json` 的 `exports` 映射里、包外只拿得到 `./core`、
故形状不承诺稳定），正是报告要求的「只留现行口径」。纯注释改动，无行为影响，无测试可钉。

### R5-140  verdict=FIXED  去掉 typeof process 门控，让内联后的 NODE_ENV 真正生效

`utils.ts:44-53`：`const nodeEnv = process.env.NODE_ENV` 直读，门控删除；函数文档新增一段
「反向要求：不得再加 `typeof process` 门控」并写明后果链（打包器只内联成员表达式 → 浏览器产物
无 `process` 垫片 → `&&` 左侧恒 false → 内联结果被丢弃 → 退回 `__DEV__`/开发兜底 →
`StateProxy._handleIllegalMutation` 在 `isProduction()===false` 时无条件 throw，直写状态由 warn 变崩溃）。
真无 `process` 时属性访问抛 `ReferenceError`，由既有 try/catch 吞掉并回退 `__DEV__` 分支，不外溢。
API-CHANGE: 全库共用工具的判定结果变化——「NODE_ENV 已内联 + 无 process 全局」的产物里由
`false` 变 `true`。消费面已按 `grep -rln isProduction src` 核对（19 个文件，含 StateProxy/Store/
compose/merge/HookSystem/analyzerPlugin/timeTravelPlugin/builtin/globalRegistry 与 extras/cache）。
模块级缓存 `cachedProductionState` 语义不变（构建期常量，只在首次判定后缓存）。
验证：`tests/unit/store/modules/utils.test.ts` 新增两条——`NODE_ENV 必须优先于 __DEV__`（生产判定赢过
`__DEV__=true`）与 `不得用 typeof process 门控`（对 `isProduction.toString()` 断言函数体不含该门控、
含 `process.env.NODE_ENV`）；后者是本条唯一能在 Node 运行时下区分两种写法的锁法（Node 下两者等价）。

### R5-141  verdict=FIXED  按报告第一方案把「键的范围有界」写进 @remarks，不改行为

`utils.ts:79-84`：在既有「部分冻结」口径后补一段——只遍历自有**可枚举字符串键**（数组按下标），
symbol 键（如 `Symbol.for('geomstore.stateVersion')`）、非可枚举自有属性、数组非下标自有属性指向的
子对象都不在冻结范围内，并说明这是与「冻结范围 ⊆ deepCloneState 隔离范围」那条不变量配套的选择
（已核 `src/core/utils/clone.ts:146/164` 只用 `Object.keys`，这些键根本进不了快照），
要 `Reflect.ownKeys` 口径请自行实现。
不采纳改实现的方案：`$snapshot` 路径本就踩不到这些键，改递归范围只会把冻结面扩到活状态别名上。
纯文档 + 一条锁行为的用例：`tests/unit/store/deep-freeze.test.ts` 新增用例，断言 symbol 键 / 非可枚举属性 /
数组非下标属性指向的三个子对象在 `deepFreezeState` 后 `Object.isFrozen === false`，父对象与其可枚举子对象为 `true`。

### R5-142  verdict=FIXED  JSON.stringify 的 undefined 返回补一次 String() 回退

`utils.ts:155-159`：`const json = JSON.stringify(value) as string | undefined` →
`serialized = json ?? String(value)`，并注释说明 `@types` 把返回类型简化成 `string`、运行期确有空值。
函数 / Symbol / `undefined` 三种值由此不再同渲染成 `Attempted value: undefined`；
`String()` 自身抛错（`Symbol.toPrimitive`/`toString` 钩子）仍由下面那层 catch 接住，
最终兜到 `<unserializable <typeof>>`，兑现「本函数在生产 warn/silent 路径上绝不抛错」的契约。
API-CHANGE: 报错文案变化——写入函数时由 `Attempted value: undefined` 变为
`Attempted value: function 名字`、写入 Symbol 变为 `Attempted value: Symbol(desc)`；
写入 `undefined` 的文案不变。
验证：`tests/unit/store/modules/utils.test.ts` 一条用例三分支（函数 / `Symbol('mySymbol')` / `undefined`）；
回归 `tests/unit/regression/ocr-low-round4-p2.test.ts:57` 的 `<unserializable object>` 兜底例仍绿。

## NEEDS-MAIN 汇总（4 条，均不在本分片可改文件内）

- NEEDS-MAIN: `src/core/store/Store.ts:207-215` 构造 `SubscriptionManager` 处补 `onSubscriberEvicted`
  → `hooks.emit('onError', …)`（R5-124 的生产可观测性闭环）。
- NEEDS-MAIN: `src/core/store/Store.ts:1159-1191` `_notifyListeners` 的 `needsClone` 分支改传
  `notify(this._state, true)`，让 R5-122 的按注册隔离在公开 `subscribe(fn)` 路径上生效（当前该行
  无条件传 `false`，顺带也是那条 dev 告警每轮 dispatch 都响的原因）。
- NEEDS-MAIN: `src/core/store/index.ts` 的 barrel 补 `export type { SubscriberEvictionInfo }`（R5-124）。
- NEEDS-MAIN: 文档与 CHANGELOG 同步（`docs/**`、`CHANGELOG.md`、`.codebuddy/skills/geomstore/references/api/*`
  由 `pnpm run skill:api` 重生成，均不在本分片可改范围）。已定位的失实段落：
  `docs/CONCEPTS.md:18/23/105`、`docs/GUIDE.md:255/349`、`docs/BEST_PRACTICES.md:72`、`docs/API.md:57/89`
  ——它们写的是「存在可写订阅者时本轮所有回调各拿一份独立深拷贝」，按 R5-122 改后应写成
  「可写注册各一份、只读注册共用一份」，并在 Store 接线落地前注明该承诺仅在
  `cloneOnNotify=true` 档成立；另需记 `maxSubscribers` 变硬上界（R5-123）、
  `StoreCacheManager.clearOldState` 移除（R5-113）、非法 `ttl` 归一（R5-111）、
  变异报错文案变更（R5-142）、`isProduction` 在内联产物里的判定变更（R5-140）。

## 行为变更（API-CHANGE）汇总（7 条）

1. R5-111 `StoreCacheOptions.ttl` 非法值归一为 0 并新增 dev 告警（对外结果不变，多一条信号）。
2. R5-113 `StoreCacheManager.clearOldState()` 移除（仅内部 barrel 可达，不在包 `exports` 里）。
3. R5-122 `cloneOnNotify=true` 档每次通知的深拷贝次数由 1 变为「可写注册数 (+1 若有只读注册)」；
   `false` 档与 Store 主路径零变化。
4. R5-123 `size` 由「可高于 `maxSubscribers`」变硬上界；达限时的重复注册改为挤掉自己最早一笔
   （`onLimit:'throw'` 时抛错）。
5. R5-124 新增可选 `SubscriptionManagerOptions.onSubscriberEvicted` 与导出接口
   `SubscriberEvictionInfo`；`SubscriptionManagerOptions` 增加类型参数（默认 `State`，裸用法不变）；
   dev 驱逐告警文案变更。
6. R5-140 `isProduction()` 在「NODE_ENV 已内联 + 无 `process` 全局」的产物里由 `false` 变 `true`。
7. R5-142 `createMutationErrorMessage` 对函数 / Symbol 值的 `Attempted value:` 不再是 `undefined`。
