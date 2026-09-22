# 分片 core-misc-p1（第五轮 ocrreview.md，25 条）— 接手台账

清单：`.ocr-fix/groups5/core-misc-p1.md`。拥有文件：`src/core/cache/{LRUCache,types}.ts`、
`src/core/compose/{composeStore,helpers,merge,StoreRegistry}.ts`、`src/core/errors/GeomStoreError.ts`、
`src/core/hooks/HookSystem.ts`、`src/core/performance/AsyncBatchNotifier.ts`。

**接手状态**：前一个 agent 在回合上限处停止且未写本台账。逐条对账结论：25 条**全部有落地痕迹**，
其中 1 条只做半截（R5-078 只做了 context 浅拷贝，`cause` 一支未做）、3 条落地方式有缺陷并留下新故障
（R5-107 的告警判据、R5-083 抽出的共享判据对 `stores: null` 抛 TypeError、R5-072 的重入分支会把本次
要注册的实例销毁后再挂上）、1 条注释与事实相反（R5-104 称 `getGetterNames` 在接口上可选，实际是必选）。
以上均由本接手补齐/改正，并各补了用例。测试锁：`tests/unit/r5-core-misc-p1-regressions.test.ts`（47 例，
前任 38 例 + 本接手 9 例）。

自验（本机 Node v22.22.2 / win32）：
`npx tsc -p tsconfig.json --noEmit` → 零输出；
`npx tsc -p tsconfig.tests.json --noEmit` → 仅 `tests/types/store-config-base.typecheck.ts`、
`tests/unit/r5-core-store-p1-action.test.ts`、`tests/unit/r5-extras-error-reporters.test.ts` 四条（他分片文件），
按 `r5-core-misc-p1|core/compose|core/cache|errors/GeomStoreError|HookSystem|AsyncBatchNotifier` 过滤后零输出；
`npx eslint <9 个源文件 + 新测试>` → 零输出；
`npx jest --ci --silent tests/unit/core tests/integration` → 22 suites / 1063 tests 全绿；
`npx jest --ci tests/unit/r5-core-misc-p1-regressions.test.ts` → 47 passed；
`npx jest --ci --silent tests/unit/cache tests/unit/hooks tests/unit/store tests/unit/error tests/unit/regression tests/unit/property`
→ 30 suites / 748 tests 全绿（本分片改动的邻近爆炸面）。
全量 `tests/unit tests/integration` 剩 3 个失败套件：`r5-core-store-p2-notify-and-limit`（单独运行为 PASS，
`src/core/store/**` 正被并行 agent 改写）、`tests/unit/extras/ocr-medium-round4-p3/p4`
（失败点全部在 `src/extras/snapshot/clone.ts` 的环路/`cloneError` 口径，属 extras-snapshot 分片），
无一落在本分片文件上。
覆盖率（`--coverage` 全量 unit+integration，`./src/core/**` 单文件门槛 branch 85 / funcs 98 / lines 98 / stmts 98）：
LRUCache 100/100/100/100、cache/types（随 LRUCache 套）100、StoreRegistry 100/100/100/100、
merge 100/100/100/100、GeomStoreError 100/100/100/100、HookSystem 100/100/100/100、
AsyncBatchNotifier 100/100/100/100、compose/helpers 100/98.36/100/100、composeStore 99.73/98.31/98.52/100，
全部在门槛之上（composeStore 残余未覆盖分支是 `isProduction()` 的另一侧与订阅回滚，属修复前既有形态）。

NEEDS-MAIN：无（25 条全部落在本分片拥有的 9 个文件内；未改任何他分片文件，
`tests/unit/core/compose/*.test.ts` 与 `tests/integration/**` 的断言也无需同步——旧文案
`'[StoreRegistry] Invalid store object'`、`'"b" wins'` 都是 `toThrow`/`stringContaining` 的子串，改动后仍通过）。

---

### R5-084  verdict=FIXED  highResNow 已移到类 JSDoc 之前，类文档重新贴住 LRUCache

前任把 helper 连同其单行注释整体上移到 `// ==== 增强型LRU缓存类 ====` 横幅之前，
`增强型LRU缓存类` 的 JSDoc 现在直接紧邻 `export class LRUCache<K, V>`（现文件 16-46 行），`@class/@example` 不再挂到函数上。
纯文档位置调整，无断言变化；`npx tsc -p tsconfig.json --noEmit` 零输出。

### R5-085  verdict=FIXED  容量单副本：options 里不再存 capacity

没有采纳报告给出的「回写 `this.options.capacity`」写法（那是把两份真相继续留着、靠同步维持），
而是把 `capacity` 从字段类型里摘掉：`private options: Required<Omit<CacheOptions<K, V>, 'capacity'>>`，
归一化结果只存在于 `this.capacity`（构造器与 `resize()` 两处入口），`getStats().capacity`/`getCapacity()` 同源。
`grep -n "options\.capacity" src/core/cache/LRUCache.ts` 只剩注释里的 1 处提及，无读取点，
「未来有人按 options.capacity 判淘汰」在类型上不再可能。用例断言 `capacity: NaN`/`resize(0)` 后 `'capacity' in options === false`。
无公开 API 变化（`options` 是 private）。

### R5-086  verdict=FIXED  淘汰预算耗尽仍超限时给出一次性诊断，set/resize 共用同一收敛路径

采纳报告的第一种方案（检测 + 记录），并顺手把 set() 与 resize() 里两份逐字重复的收敛循环抽成
`_enforceCapacity()`：循环结束后 `if (!this.evicting && this._size > this.capacity)` 即「回填抵消了淘汰减量」，
经 `_reportUnconvergedCapacity()` 输出一次 `console.warn`（每实例一次，避免「每次写净增一条」变成刷屏）。
选择「有界 + 可见」而不是继续追淘汰：回填条数由回调决定，追下去会把单帧变成无界循环。
三条用例：容量 3 + 每次回填 → 仍超限但只告警 1 次、后续两次写入不追加日志；有限回填能收敛 → 不误报；`resize(1)` 同场景共用该路径。
API-CHANGE: 新增一条 `[LRUCache] 淘汰循环结束仍有 N 条超出容量上限` 告警（此前该故障完全静默）。

### R5-061  verdict=FIXED  evictions 的契约改写为「onEvict 触发次数」并给出区分方法

报告给的是「澄清契约 / snapshot-diff / 配置性清空不回调」三选一，选澄清：清空逐条回调是
`clear()` 的既有契约（与 `evictLRU` 同一计数、同一异常兜底口径），改成不回调会让 write-back 型调用方丢数据。
`src/core/cache/types.ts` 的 `evictions` 字段现明确写出「契约是 onEvict 触发次数，clear() 等配置性清空亦计入，
**并非**因容量上限被挤出的条目数」，并要求需要的调用方在配置性清空前后各读一次求差。
文档引用的事实已核对：`LRUCache.clear()` 确实 `this.evictionCount += nodes.length` 并逐条回调；
类名写作 `StoreCacheManager`（`src/core/store/StoreCache.ts:36` 实到名），非报告正文里的 `StoreCache`。

### R5-062  verdict=FIXED  CacheOptions.capacity 就地注明默认值与归一化规则

按报告给的 diff 落在配置字段上（`capacity?: number`，types.ts:107-114）：默认 100、非有限值回退 100、
小于 1 夹到 1、小数不取整且说明「等效上限为 floor(capacity) 条」（淘汰判定是 `size > capacity`，故 2.5 实际容 2 条）。
交叉引用 `LRUCacheStats.capacity`（该字段文档在 types.ts:37-43，口径一致）与 `getCapacity()`；
并补一句「构造后改动此字段不会生效」——这是 R5-085 归一为单副本后的必然结论。纯文档。

### R5-103  verdict=FIXED  投递次数改为进入本轮时快照，回调内退订不再截断同一轮

`for (const [listener, entry] of entries) { for (let i = 0; i < entry.total; i++) }` 读的是活对象，
回调里 `_releaseListener` 就地 `entry.total -= 1` 会把本轮剩余投递吃掉。现解构为 `for (const [listener, times] of entries)`，
次数随 `[...this._composedListeners]` 一次性快照，与 `SubscriptionManager.notify` 的扁平快照语义一致。
用例：同一 listener 注册两次，回调内释放自己第一份 → 仍收到 2 次，且 Map 里剩 1 份。
API-CHANGE: 组合层监听器在回调内退订时，本轮投递次数按进入本轮时的在册次数计算（此前会被截断）。

### R5-104  verdict=FIXED  getter 查找与 getGetterNames() 两处一致地对未实现降级

`s.getGetterNames().includes(...)` → `const names = s.getGetterNames ? s.getGetterNames() : []`，
与同文件 `getGetterNames()`（第 486 行）和 `plugins/builtin.ts:406` 的既有写法同口径，异构/桩子 store 不再在只读路径抛 TypeError。
**修正前任注释的事实错误**：原文写「该成员在 Store 接口上是可选的」，实际 `src/types/store.ts:381` 把它声明为**必选**；
现注释改为「接口必选、但组合层接受鸭子类型 store，未实现时按无 getter 降级」（`src/types/store.ts` 不属本分片，未动）。
用例覆盖 `composed.getter('half')` 命中有 getter 的 store、`getter('missing')` 返回 undefined。

### R5-105  verdict=FIXED  per-listener writable 字段删除，可写额度由 _composedWritableCount 单点记账

`_composedListeners` 的值类型从 `{ total; writable }` 收成 `number`：注册 `set(listener, existing + 1)`、
释放 `set(listener, total - 1)`，`writable` 的三处写点全部删除（`entry.writable -= 1` 等），
深/浅拷贝档位的唯一判据仍是 `_composedWritableCount > 0`。附带好处：Map 值不再是共享可变对象，
R5-103 的快照因此是纯数字、天然不受回调内改写影响。`grep "writable" src/core/compose/composeStore.ts` 只剩 `_composedWritableCount`。
用例断言可写订阅时载荷是深拷贝（`not.toBe(getState())`）、退订后只读订阅时载荷即合并缓存本体。
无公开 API 变化（字段为 private）。

### R5-080  verdict=FIXED  命名空间分支改两段式，strict 校验失败时零写入

`dispatchByNamespace` 的命名空间分支原先边找边写：后面的键找不到 store 抛错时，前面的 store 已落库且无法回滚。
现先 `pending.push([targetStore, data[key]])` 完成全部查找与 strict 校验，再统一 `applyToStore`，
与非命名空间分支（先分组校验、后统一写入）口径一致。`grep` 见两分支同形。
两条用例：strict + `{a, missing}` → 抛 `Cannot find store for key: missing` 且 handler 零调用；
正常两 store → 按原顺序各写一次。
API-CHANGE: 命名空间 + strict 的批量写入不再产生「前一半已写入」的中间态（要么全校验通过后全部写入，要么一个都不写）。

### R5-081  verdict=FIXED  三处歧义告警统一 !isProduction() 门控

报告点名的三处全部落地：`helpers.ts` 的 `findTargetStoreWithKey` 歧义键告警、
`composeStore.ts` 的 dispatch 同名 action 告警、getter 同名告警（`matches.length > 1 && !isProduction()`）。
`isProduction()` 在两个文件里都已是既有导入（同文件的重名/降级告警第四轮就门控过），无新增依赖。
取值行为两种模式一致（都取第一个），只关日志。
回归覆盖按要求补：新测试用 `jest.resetModules()` + 加载期 `NODE_ENV=production` 取一组全新模块
（与既有 `production-mode-silence.test.ts` 同法，因 `isProduction()` 结果按模块实例缓存），
自检断言 `isProduction() === true` 后验证 dispatch/getter/setState 三处零告警且取值不变，
并配一条开发模式对照用例（同输入确实告警），避免空过。

### R5-082  verdict=FIXED  竞态吞异常收窄为「destroyed 且错误是销毁守卫」

`catch { if (store.destroyed) ... }` 会连带吞掉同一 tick 内恰好被销毁的订阅者回调抛错、状态保护拦截等真实故障，
且文案（「在写入期间被销毁」）与原因不符。现判据为 `store.destroyed && isDestroyedStoreError(error)`，
后者按固定文案 `/Cannot call .+ on a destroyed (?:Composed)?Store$/` 匹配。
文案覆盖面已核：`Store.ts` 15 处守卫 + `composeStore.ts:252` 的 ComposedStore 变体全部落在该模板内（grep 全仓无第三种措辞）。
两条用例：destroyed 但抛「与销毁无关的真实故障」→ 冒泡；`$patch ... destroyed Store` 与 `batch ... destroyed ComposedStore` → 静默跳过。
API-CHANGE: 已销毁子 store 上抛出的非销毁类异常不再被吞掉，改为向调用方冒泡。

### R5-083  verdict=FIXED  嵌套归属判断抽成 ownsNestedStore 单点，并补空值守卫

前任抽出 `ownsNestedStore(store, head)` 供 `dispatchByNamespace` 的嵌套分组与 `findTargetStoreWithKey` 的斜杠回退共用
（读写两处不再各写一遍 `nested && separator > 0 && hasOwnProperty`），这一步方向正确。
**但它的判据把原实现的 `nested &&` 真值判断收窄成 `nested !== undefined`**，`store.stores === null`
（鸭子类型 store 的常见未初始化形态）会让 `hasOwnProperty.call(null, head)` 抛
`TypeError: Cannot convert undefined or null to object`——重构自己引入了新故障，且抛在只读路径上。
改正为 `typeof nested === 'object' && nested !== null && hasOwnProperty.call(nested, head)`。
证据（先还原后跑）：把判据改回 `nested !== undefined` 后
`npx jest --ci -t "stores 为 null" tests/unit/r5-core-misc-p1-regressions.test.ts` → FAIL，栈顶正是 `ownsNestedStore (src/core/compose/helpers.ts:53)`；
改回后 PASS。新用例同时锁住「null stores 下 'leaf/deep' 既不抛也回退为未找到」。

### R5-106  verdict=FIXED  同名键告警补上写入侧路由与读写分裂说明

告警文案在保留 `"${store.name}" wins` 原句式（`tests/unit/core/compose/merge.test.ts:70,96` 的子串断言仍通过）
之后追加「（读取侧最终由最后一个含该键的 store 决定），而写入（setState/$patch/dispatch/getter）路由到**第一个**含该键的 store：
两者可能不是同一个 store，故这类键上的写入在 getState() 里看不见」；函数头 JSDoc 同步写清读/写分裂是本模块既有语义。
用例用真 store 锁住文案描述的事实：`composeStore([a,b])` 均有 `shared` → `getState().shared === 'from-b'`，
而 `composed.setState('shared', …)` 只改到 `a`，`getState()` 里看不见；并断言 3+ 冲突时告警按
「上一个写入者 → 当前写入者」成链（`warnedConflicts` 为 `k(s1,s2)`、`k(s2,s3)`），不再永远停在第一个。
API-CHANGE: 冲突告警文案扩充（原 `"X" wins in merged state/snapshot.` 前缀保持不变）。

### R5-107  verdict=FIXED  keyOwners 按实例记并比较身份（前任只记身份、漏了比较）

前任把 `keyOwners` 从 `Map<string, string>`（名字）改成 `Map<string, Store>`（实例）并对
`previousOwner !== undefined` 无条件告警，理由写在注释里：「Object.keys 不会在同一 store 上给出重复键，
故同实例回环本就不可达」。这个前提是错的：`composeStore` 构造期不去重（`this._stores = stores`，composeStore.ts:95），
`composeStore([a, a])` 就会让同一实例在列表里出现两次，于是报告要防的「(a, a) 假冲突」以另一种形式回来了。
按报告原方案补回身份比较：`previousOwner !== undefined && previousOwner !== store`，消息仍打印 `previousOwner.name`。
证据：把条件还原成前任写法后
`npx jest --ci -t "同一实例被重复列入" tests/unit/r5-core-misc-p1-regressions.test.ts` → FAIL，
实际收到 `... exists in multiple stores (a, a); "a" wins ...`；恢复后 PASS。
另一条用例锁住真正的目标场景：两个**不同**实例共用名字 `a` 且键重叠 → 必须告警（按名字比较时正是这一条被抑制）。
API-CHANGE: 同名不同实例的静默覆盖不再被抑制；同一实例重复出现在 stores 列表则明确不告警。

### R5-072  verdict=FIXED  覆盖注册显式处理 destroy 期间的重入注册，且不会误毁本次实例

前任的骨架正确：`_detachInstance` 先摘链再销毁，销毁返回后回读 `this.stores.get(name)`，
发现被重入改写就按同一条覆盖流程让重入实例退场（报告允许「keep it or destroy it」，这里选 destroy，
外层调用方的契约是「返回后 `get(name) === store`」），两个实例都不被静默遗弃。
**补一个它漏掉的分岔**：重入写入的实例若**正是本次要注册的那个**（回调替调用方先行装好），
`reentrant !== existingStore` 成立 → 它会先被销毁、随后又被 `set(name, store)` 挂成在册 live store。
判据加 `&& reentrant !== store`。
证据：还原该行后 `npx jest --ci -t "重入注册的正是本次要登记的实例" ...` → FAIL
（`incoming.destroy` 被调用 1 次）；恢复后 PASS。另两条既有用例覆盖「重入实例照常销毁 + 告警」与「重入里 setDefault 后默认仍指向本次实例」。
API-CHANGE: destroy 回调里对同名的重入注册不再被静默顶掉，该实例会被摘链并销毁（此前留下无人持有、无人清理的悬挂 store）。

### R5-073  verdict=FIXED  别名与实例生命周期绑定：注销/覆盖会一并摘除同一实例的其它名字

报告给了两个可选解法（默认引用按「是否还有条目指向该实例」判定 / 默认存名字按需解析），
前任选了更彻底的一种并复用给 register 的覆盖分支：`_detachInstance(name, store)` 先遍历删除所有
`candidate === store` 的名字，再销毁，因此不存在「`get('a')` 继续返回已销毁 store」的形态，
`unregister` 的 `if (this.defaultStore === store) this.defaultStore = undefined` 也就不再留下悬空默认引用。
`register` 的默认指针判定同步收窄为 `this.defaultStore !== undefined && superseded.includes(this.defaultStore)`，
避免「注册全新名字且从未 setDefault」时 defaultStore 与 existingStore 同为 undefined 而隐式成为默认。
两条用例：`register('a',s)+register('b',s)+setDefault('a')` → `unregister('b')` 后 destroy 一次、`get('a')`/`get('b')`/`getDefault()` 全为 undefined、无关条目不受影响；
覆盖注册同样摘除旧实例别名（`size()` 为 1）。
API-CHANGE: `unregister(name)`/同名覆盖注册在实例被多个名字持有时，一并摘除该实例的**全部**名字并只销毁一次（此前其余名字继续返回已销毁实例）。

### R5-074  verdict=FIXED  销毁守卫与异常兜底收敛为 isDestroyable + _destroyInstance

新增模块级 `isDestroyable(store)`（`typeof store.destroy === 'function' && !store.destroyed`）与私有
`_destroyInstance(name, store)`，register 覆盖分支、unregister、clear 三条路径统一走它：
缺 `destroy` 的鸭子类型实例不再以 TypeError 收场（此前会被 catch 成一条错误日志、**清理静默不发生**），
已在外部销毁的实例不再二次 destroy。`register` 的告警文案随之按实情生成
（`already registered, ${isDestroyable(...) ? 'destroying old store and ' : ''}overwriting`）。
用例：三种清理路径上 `getState`-only 的桩 store 全部不抛错、`errorSpy` 零调用、条目照常摘除。
API-CHANGE: `[StoreRegistry] ... already registered` 告警在旧实例不可销毁时不再声称 "destroying old store"。

### R5-075  verdict=FIXED  register 与 registerAll 的条目校验共用 _assertValidEntry

`_assertValidEntry(name, store)` 单点承载两条判据（非空字符串名、`typeof store.getState === 'function'`），
`register()` 与 `registerAll()` 的预校验循环都调它，文案不再按路径分叉（原 register 是
`Invalid store object`、registerAll 是 `Invalid store object for name "x"`）。
用例断言四条路径（register 空名 / registerAll 空名 / register 无效 store / registerAll 无效 store）文案两两一致。
`tests/unit/core/compose/StoreRegistry.test.ts:51-57` 与 `tests/unit/regression/ocr-medium-wave.test.ts:87`
用 `toThrow(string)` 的子串匹配，统一成带 name 的版本后仍通过，未改动这些既有用例。
API-CHANGE: `register()` 无效 store 的抛错文案由 `[StoreRegistry] Invalid store object` 变为
`[StoreRegistry] Invalid store object for name "<name>"`（旧串仍是新串前缀）。

### R5-076  verdict=FIXED  clear 的重入契约按「文档化偏差」处理并写进 JSDoc

报告允许「加 clearing 标志挡写入」或「显式记录偏差」，选后者：clearing 标志会让**合法**的重入注册抛错，
而 `clear()` 的既有重入保护只针对 unregister/register 的摘链顺序，抛错反而是新的破坏面。
`clear()` 的 `@remarks` 现明确写出：契约是「进入本方法时在册的条目全部注销」，
destroy 回调里重入 `register()`/`registerAll()` 新增的条目**会保留下来**，此时 `size()` 不为 0，
要求彻底为空应在无重入注册时清空或再清一次；示例注释同步改成「清空所有Store（无 destroy 重入注册时）」。
用例锁住该偏差即契约：destroy 里 `register('late', x)` → `clear()` 后 `get('late') === x`、x 未被销毁、`size() === 1`。

### R5-077  verdict=FIXED  new.target 守卫删除，原型对齐无条件执行且注释改对

`new.target` 对**任何**经 `new` 的调用都为真（派生类经 `super()` 时它是派生构造器），旧注释把语义说反了。
按报告给的第一种方案：`if (new.target)` 整体去掉，直接 `Object.setPrototypeOf(this, new.target.prototype)`，
注释改写为「直构 → GeomStoreError.prototype、派生经 super() → 派生原型；new.target 只在不经 new 调用类时才是 undefined，
而 class 语法做不到，这句只是兜住把构造器当函数转译的构建产物」。
用例断言两层派生（`class OuterError extends GeomStoreError`）的 `Object.getPrototypeOf` 与两个 instanceof。

### R5-078  verdict=FIXED  context 浅拷贝（前任已做）+ cause 参数与转发（本接手补齐）

前任做了报告前半：`this.context = context ? { ...context } : undefined`，
用例验证「调用方事后改写/删除入参字段不影响已捕获现场与 getFriendlyMessage() 输出」。
**报告后半「the constructor offers no `cause` parameter … consider accepting/forwarding `{ cause }`」未做**，本接手补上：
基类新增第 5 形参 `cause?: unknown`（`name` 之后），6 个派生类各加第 4 形参并转发，`createError()` 同步加参、
default 分支以 `new GeomStoreError(message, code, context, undefined, cause)` 占位；
target/lib 为 ES2020 时 `Error` 无 `cause` 选项签名，按仓库既有口径（`extras/error/ErrorRecovery.ts` 的 attachCause）用属性赋值，
且**仅在提供时**挂属性，未包装时 `'cause' in error === false`、`toJSON()` 输出形状不变（ERROR-008 仍锁五键）。
`toJSON()` 里 cause 过 `toSerializableCause`：Error 显式取 `{name, message}`（通用归一会把 message/stack 这类
不可枚举自有属性塌成 `{}`，cause 的全部价值就没了），其余值走 R5-079 的同一套环路/BigInt 安全通道。
四条用例：包装 TypeError 后 `error.cause` 同一引用 + `toJSON().cause` + `JSON.stringify(error)` 链路；无 cause 时的形状；
`createError` 转发 + 环路 cause 不二次抛错。
API-CHANGE: `GeomStoreError` 构造器新增可选第 5 参 `cause`（派生类第 4 参、`createError` 第 4 参），
实例新增 `cause` 属性；提供 cause 时 `toJSON()` 多一个 `cause` 键。原有三/四位调用与无 cause 的输出完全不变。

### R5-079  verdict=FIXED  toJSON 的 context 过环路/BigInt/取值安全归一

`toSerializableValue` 按自有可枚举键展开，三类会让 `JSON.stringify(error)` 抛错或误导的来源被收敛：
循环引用（只把**当前分支上的祖先**当环，兄弟共享引用不误报）→ `'[Circular]'`、
BigInt → `'123n'`、取值即抛的访问器（包装已销毁 Store 的 getter）→ `'[Unreadable]'`，
另有 `MAX_CONTEXT_DEPTH = 6` 的 `'[Truncated]'` 兜深树、带 `toJSON` 的对象（Date 等）原样交给 JSON 引擎、
自有 `'__proto__'` 键走 `defineProperty`（与 clone/merge 处的守卫同口径，否则该键被丢且结果原型被换）。
四条用例覆盖环路/抛错 getter/BigInt/数组与空数组/深度截断/共享引用不误标/`__proto__` 污染。
`toJSON()` 的 `@remarks` 同时写明「该序列化器自身抛错不在兜底范围内」。
API-CHANGE: `toJSON().context` 不再是入参的逐字拷贝，而是可 JSON 化的等价结构（环路/BigInt/不可读访问器变成字符串标记）。

### R5-087  verdict=FIXED  退订句柄一次性化，失效句柄的重复调用变 no-op

按报告给的 diff 落地：`on()` 返回的闭包用 `let unsubscribed = false` 守卫，二次调用直接 return。
于是 `on → off → on → off(旧句柄)` 不会把新注册摘掉，也保住「最后一个监听者退订即摘键 → 无参 `size()` 统计已注册钩子种类数」的观测自洽。
两条用例：报告给的复现序列（`off1(); off2 = on(...); off1()` 后 `listenerCount === 1`、emit 仍回调 1 次、`off2()` 后 `size() === 0`）；
同一句柄重复调用不抛错且不二次摘键。
API-CHANGE: `HookSystem.on()` 的退订句柄改为一次性（此前重复调用会按当前 Map 内容再次删除，可能删掉之后重新注册的同一 handler）。

### R5-088  verdict=FIXED  已销毁 Store 上的 usePlugin 误用改为原样冒泡

PLUGIN-002 的降级只该罩住「插件自身安装失败」。`catch` 里先判 `if (store.destroyed) throw error`，
让 `store.use` 按 `@throws` 抛出的 `Cannot call use on a destroyed Store` 照常冒泡；
其余异常仍走既有的 `console.error` + 空卸载函数（并保留「install 返回非函数」两层 TypeError 的隔离说明）。
顺带把 `console.debug('...installed')` 与卸载包装挪出 try：安装成功后不再被 install 兜底路径覆盖，
失败路径也不再返回一个会去调 `undefined()` 的句柄。
两条用例：destroyed store 上 `usePlugin` 抛出固定文案；install 抛错的插件仍降级、返回的句柄可安全调用。
API-CHANGE: 在已销毁 Store 上调用 `usePlugin` 从「只 console.error + 静默空卸载」改为抛出原始异常。

### R5-100  verdict=FIXED  批次迭代中退订/被 clear 的监听器不再收本批次投递

采纳报告的第二种方案（跳过活集合里已不存在的监听器）而非「只补文档」：`for (const listener of Array.from(this.listeners))`
循环体首加 `if (!this.listeners.has(listener)) continue`。快照语义仍然成立（迭代期间新增的订阅者不参与本批次），
但「回调里退订自己/被别的监听器 clear 掉」的消费者（典型是已卸载组件）不会再被投递一次。
同时把 `subscribe()` 的句柄一次性化——它与 R5-087 同形（按身份 delete 会让旧句柄摘掉新订阅），
`@remarks` 与 `notify()` 的注释一并把「新增订阅者不参与本批次 + 已退订者不收本批次」两面都写清。
四条用例：批次内退订的监听器零调用、监听器内 `clear()` 后其余监听器零调用且 `size() === 0`、
新增订阅者本批次不收/下批次收、失效句柄不误删重新建立的订阅。
API-CHANGE: 同一批次迭代中退订（或被 `clear()` 移除）的监听器不再收到本次回调（此前快照语义下仍会被投递一次）。
