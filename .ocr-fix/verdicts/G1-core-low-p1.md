# G1-core low p1 判定记账（30 条 · src/core）

| #id | verdict | 依据 |
| --- | --- | --- |
| #83 | fix | 成立：`grep -rn "lastAccessedAt\|accessCount" src tests` 只有写入点（LRUCache 147/167/217/227/256/257），无任何读取方；LRUNode 不经 cache/index、core/index 任何 barrel 外泄（仅 LRUCache.ts 内部使用），故按报告第一方案删除两个死字段与其全部写入点 |
| #84 | fix | 成立：LRUCache.getStats() 实测返回 0-100 且 `Math.round(x*100)/100` 两位小数、totalAccesses=0 时 hitRate/missRate 均为 0（与「全未命中」同值）；types.ts JSDoc 已补单位/范围/精度与哨兵语义，并要求用 totalAccesses 区分 |
| #85 | fix(更正报告口径) | 成立但报告口径本身不实：capacity 实现**不保证正整数**——实测 `new LRUCache({capacity:2.5})` → `getCapacity()` 仍为 2.5、`_size > 2.5` 使缓存只容 2 条；`capacity:0` 夹到 1、NaN→100、`resize(Infinity)` 保持旧值（四条均由临时 jest 用例验证后删除）。文档因此写实现真正保证的「有限且 ≥1、小数不取整＝floor 条」并注明读到的是生效容量。avgAccessTime 的 0 兼具「hits=0」与「未开启计时/统计」两义、avgItemLifetime 的 0 兼具「空缓存」，已逐项写入哨兵说明 |
| #116 | fix | 三点分别处置：(1) 死字段随 #83 一并删除，热路径每命中省一次 Date.now + 两次属性写；(2) set() 的无条件盖时间戳与 get() 的 trackAccessTime 门控矛盾随之消失（改后 set 不再触碰访问时间，门控只在 get 内自洽），并在注释里写明 trackAccessTime 不影响 LRU 顺序；(3) 采纳——计时改到命中判定之后，未命中不再丢弃一次高精度时钟调用，测量区间为命中收尾（计数+摘挂链） |
| #117 | fix(部分) | 成立并已处置错误处理：clear() 的 onEvict 异常改为与 evictLRU 同口径的无条件 `console.error`（此前一处静默一处打印，同类故障可见性不一致）。淘汰计数语义按报告的第二方案文档化（`evictions` 契约＝onEvict 触发次数，配置性清空亦计入，并给出区分方法）：不新增 reset API、也不清空计数——StoreCache.enable() 的清空是「重建键集」的有意行为（该方法已有注释），改计数口径会让既有的 onEvict/统计契约漂移 |
| #99 | fix | 成立：退订闭包只做 `set.delete(handler)`，空 Set 与键永久留在 Map。改为末位监听者退订时 `hooks.delete(hookName)`；`on()` 本就先 get 再建，重订阅不受影响。既有断言全为 `size(name)`（缺失键返回 0）与 `clear()` 路径，不受影响；新增 #99 回归用例锁 size() 双语义 |
| #100 | fix | 成立（口径未写明）：emit 的 console.error 确为无门控，且与同文件 usePlugin 的 debug 门控不一致。按报告第一方案「显式化该取舍」——加注释说明钩子故障无其他上报通道、生产不静默（与 LRUCache.evict/set 淘汰回调、usePlugin 安装失败的 console.error 同口径），并按报告建议把字符串拼接改模板字面量；不改门控行为 |
| #110 | fix | 成立：`for…in` 会枚举 payload 原型链可枚举属性，而本文件其余处（findTargetStoreWithKey/nested 判定）刻意用 hasOwnProperty 防原型链，两处循环（namespaced/非 namespaced）均改 `Object.keys(data)`；新增 #110 回归用例（原型挂可枚举键 → 不作为 store 名分发、strict 也不抛） |
| #111 | fix | 成立且注释确为失实：parseActionName 无 stores 入参、不做查找，直接 `['', fullName]`。按报告建议改写，并在 composeStore 的 dispatch/getter 两条调用点已核对（storeName 为空即走「按裸名遍历全部子 store」），注释与该回退契约一致 |
| #114 | fix | 成立：`Object.keys(pick(store))` 对 null/undefined 直接抛 TypeError，而 mergeNamespaced 对同值只是挂上去不抛，两函数对空值的容忍度不一致。按报告兜底 `?? {}`，并把 pick 的返回类型放开为 `Record<string, unknown> \| null \| undefined` 让守卫在类型上成立（调用方传更窄的函数仍可赋值） |
| #103 | reject | 问题（堆栈含包路径）真实，但报告主方案不采纳：`toJSON()` 的契约是开发者诊断，tests/unit/core/error/GeomStoreError.test.ts ERROR-008 明确断言 `stack: expect.any(String)`，去掉或按 NODE_ENV 分支会让生产排障只剩 code。按报告前置选项「确认该暴露是有意」执行——JSDoc 补 @remarks 写明用途边界（回传客户端/持久化只取 name/message/code/context）。零行为变更 |
| #104 | fix | 成立且比报告说得更严重：基类那句无条件 `Object.setPrototypeOf(this, GeomStoreError.prototype)` 在 target ES2020 下会**把派生原型降级**，全靠 6 个子类各补一句复位才没错位。按报告方向抽干基类构造器（新增第 4 参 name，默认 'GeomStoreError'），复位改为 `if (new.target)`（super() 调用时 new.target 为 undefined，故不能照抄报告示例的 `new.target` 取名字——该写法在派生类里恒 undefined）。name 仍传字面量而不取 `this.constructor.name`：dist 经 esbuild/terser 压缩会改写类名。缺陷实测（node -e 同构最小复现）：基类无条件复位时 `class B extends A` 的实例 `instanceof B === false`，改 `if (new.target)` 后为 true；回归用例见 #104 两条 |
| #126 | fix | 成立：实测空采集器 `getPercentile(-1)` 返回 0、有数据才抛 RangeError，同一非法入参两种结果。校验前置到短路之前，并补 `@throws`；既有越界用例（metrics.test.ts:695-697，非空集）行为不变，另加 #126 空集用例 |
| #127 | fix | 成立：analyzeBottlenecks 对每个出现过的操作都出一条（未超阈值者 severity:'low'），既有 MONITOR 用例正断言全量返回。JSDoc 与 @returns 改为「全部操作分组，按 avgDuration 降序，非过滤后的瓶颈子集」，并说明 2x/3x 的分级门槛 |
| #128 | fix | 部分成立：`collect(metrics)` 复数命名与 JSDoc/单条语义矛盾，按报告改 `metric`；但「遮蔽私有 metrics 字段」的前提不成立——MetricsCollector 的字段是 buffer/oldest/_count/_maxSize，无 metrics 字段（那是 PerformanceMonitor 的），故只改名不动结构 |
| #133 | fix | 报告两点中「logger 收到原始 metrics」已被上一波改掉（现传副本 record），残余问题是可读性：局部变量 `record` 与方法 `record()` 同名 → 按报告建议重命名 `metricRecord`，判断条件一并改用副本，并补注释说明为何传副本（logger 需看到 memoryUsage、入参可能被复用）。行为不变（副本的 exceedThreshold 与入参同值） |
| #136 | fix | 成立：每次计时都 `wx.getPerformance()`，setup.ts 的 mock 实测每次返回新对象（分配开销真实），且不同实例的原点差异会让 `endTime-startTime` 与 MAX_OPERATION_AGE_MS 判定失真。改为实例级 `cachedWxPerformance` 缓存（undefined=未探测/null=不可用），并补两道有效性校验：`now` 非函数或工厂抛错→不缓存、走 Date.now；`now()` 返回非有限值→撤缓存降级（NaN 会让 duration/阈值恒失效）。刻意按实例而非模块级缓存，避免测试与多监控器互相污染 |
| #120 | fix(部分) | 死分支成立：`_depth` 只在 start() 自增、只在 `>0` 时自减、reset() 置 0，全库无任何路径能带成负数 → 守卫改精确的 `=== 0`，并删掉方法注释里失实的「修复：添加深度为负数时的警告」。第二点（要求常驻告警/可注入 logger）**不采纳**：本库口径是开发期提示类日志不进生产控制台，该取舍由 tests/unit/store/modules/BatchManager.test.ts:107「生产环境静默行为」锁定；end() 处抛错会把一次无害误用变成业务崩溃点，理由已写进注释 |
| #121 | fix | 成立：`reset()` 归零深度而不触发 `_onEnd`，批内被抑制的变更确实永不补发；唯一调用点是 `Store.destroy()`（已核对 src 内 `new BatchManager`/reset 调用面）。采纳报告第二方案——JSDoc 写明「仅限 teardown」的职责边界与「需要结束并通知请用 end() 配平」，不改行为 |
| #122 | fix | 成立：BatchManager 类经 `core/store/index.js` 导出（"供高级用户使用"），JS 调用方传非函数只在最外层 end() 才炸；构造器加 `typeof !== 'function'` 早失败并把 `_onEnd` 收为 readonly。属行为变更（新抛 TypeError），带 #122 回归用例；既有 6 处 `new BatchManager(onEnd)` 均传函数，无测例覆盖非函数入参 |
| #129 | fix | 成立：core/index.ts 头部声称「仅最小接口集合、可选能力全在 ../extras」，同文件 36/41-43 行却静态再导出小程序接入与插件钩子；且把「企业微信集成（WeCom，确在 extras/enterprise）」与「微信小程序集成」混为一句。按报告第一方案改写文档：给出「瘦＝是否被核心运行链路直接依赖」的真实判据、列出留在核心的小程序接入与钩子并说明依赖方向原因、单列 @remarks 澄清 WeCom 与小程序两组 API 的归属。术语与 extras/index.ts:14 的口径核对一致 |
| #139 | fix | 成立：get 陷阱 `if (typeof prop === 'symbol') return undefined` 在查 target 之前短路，boundActions 只按字符串键登记、上一行的 hasOwnProperty 已排除全部 symbol，故该分支纯属遮蔽 context 自身的 symbol 成员（Symbol.toStringTag/iterator/toPrimitive、Store 的 GEOMSTORE_BRAND 均取不到）。删掉短路、落到 `target[prop]`。既有 tests/unit/store/modules/ActionManager.test.ts:311 用未定义的 Symbol('test')，改后仍返回 undefined、用例不失效（该用例内注释已同步更正） |
| #141 | fix | 成立：`.then(onSettled, onReject)` 的派生 promise 被丢弃，onSettled（补刷缓存→通知链路）或 onError emit 自身抛错即成 unhandledRejection。补终端 catch 归口 `hooks.emit('onError', …)`，钩子再失败退到 console.error（最后一级不再抛）。用 `Promise.resolve(settled).catch()` 而非整体改成 `Promise.resolve(result).then()`：原生 Promise 下 Promise.resolve 是恒等返回，补发的微任务时序与原实现一致；返回给调用方仍是原始 result。行为变更（异常从全局 unhandled 变为 onError），带 #141 回归用例 |
| #142 | fix | 成立：同一判据在 catch 路径/同步成功路径/异步 onSettled 各写一遍。抽 `_shouldNotifyNow(baseline)`；注意三处并非完全同参——异步路径基线是 `_getLastNotifiedMutationCount() ?? -1`、同步与失败路径是 dispatch 前计数，故基线作参数传入，判定式（深度+batch+onlyOnChange 计数）单点维护。纯重构，两处布尔式与真值表逐字等价 |
| #148 | fix(取报告第二方案) | 成立但报告的主动方案（无条件 console.error）与既有契约冲突：tests/unit/store/production-mode-silence.test.ts:106-118 明确锁定「监听器抛错在生产静默」，直接放开即破坏该用例与库口径。改按第二条方案：SubscriptionManagerOptions 增可选 `onListenerError`，Store 构造处接到 `hooks.emit('onError', …)`，生产由此获得可上报的监控入口而控制台仍静默；上报通道自身抛错被兜住。dev 打印保持。行为变更（onError 钩子新增一类事件源），带 #148 回归用例 |
| #149 | fix(文档路线) | 成立且为有意行为：按报告第一方案在 notify 快照处写明口径（本轮派发对象＝进入 notify 时在册的注册；回调内退订/被 evict-oldest 驱逐者本轮仍收最后一次，对齐 Redux 快照语义），并记录不逐个复核的两点代价（热路径回查 Map、失效时点取决于回调顺序）与调用方对策。不改成「调用前确认在册」：那会把同一轮内各监听器可见的变更集合变得更不确定，且在每次通知加一遍 O(n) 回查 |
| #150 | fix + reject(第 2 点) | 第 1 点成立并修复：实测 `dist` 侧 `performance` stub 由 scripts/generate-subpath-stubs.mjs:43 映射到 core/performance，而 CHANGELOG:134 记载的 LRUCache 聚合出口在 87db0d1 随 Optimizations 一起被删（该提交动机是清理已不存在的性能工具转发，不是取消缓存聚合），从 `@openlide/geomstore/performance` 取 LRUCache 现为 undefined。CHANGELOG 属越界文件不能改，故按报告第一方案恢复 `LRUCache` + `LRUCacheStats/CacheOptions` 再导出（纯增量、定义仍在 cache/index 单点）并在 barrel 头写明「这是已发布子路径的公开面」。第 2 点不采纳「删掉 AsyncBatchNotifier 导出」：它同样在已发布子路径上，删除即破坏性变更；「从 extras/performance 转发」需改 src/extras（越界），已列为待办并附证据（Store.ts:53 深导入的原因写进注释），非「忘了改」 |
| #154 | fix(文档路线) | 机制描述成立、结论不成立：refreshFromState 重置时间戳所写的值正是「刚从状态源读出的当前值」，此时让条目按墙钟过期只会多一次返回同值的回读，故不构成正确性缺陷；风险仅在于把 ttl 当硬过期用的调用方。按报告第一方案在 JSDoc 写清语义（TTL＝距最后一次与状态源对齐的时长；高频 dispatch 会不断推迟过期；需硬过期不要依赖 ttl）。不改「仅在值变化时刷新时间戳」：那要在 dispatch 热路径为每个键做值比较，收益是负 |
| #158 | fix | 成立：访问器描述符无 value 字段，`descriptor.value` 恒 undefined，报错的 `Attempted value:` 一行失去信息。按报告建议改判 `'value' in descriptor`，非数据描述符传 `[accessor descriptor: get=…, set=…]` 标识；新增 #158 用例（Reflect.defineProperty 挂 getter 时消息含该标识、不含 undefined） |
| #159 | fix | 成立：`_wrapArrayChild` 一律 `_createDeepProxy`，嵌套数组拿到通用深代理，索引路径塌成 `matrix.0` 而非 `matrix[0]`，且 ARRAY_MUTATING_METHODS 的专用拦截分支被绕过（push 会以「给属性 'push' 赋值」文案抛出）。按报告在此判 `Array.isArray` 并走 `_createArrayProxy`，路径与拦截口径与顶层数组统一；既有 tracking-and-proxy-branches.test.ts:184 只读 `matrix[0].filter`（非变异方法，仍原样返回）不受影响。行为变更（错误路径文案/数组方法拦截），带 #159 回归用例 |

## 汇总

30 条：fix 28（其中纯文档/注释路线 6 条：#84、#85、#111、#121、#149、#154）· reject 1（#103，保留 stack 并显式化契约）· fix+reject 混合 1（#150：第 1 点恢复聚合出口，第 2 点不删公开导出）。FP 0——本轮无整条误报，但四处**报告前提不实或方向不成立**已在依据里更正并留证：#85（capacity 实际不保证正整数）、#128（MetricsCollector 无私有 `metrics` 字段可遮蔽）、#117/#120（报告的主动改法与既有契约或既有记账口径冲突，取报告自带的备选方案）。

### 本轮引入的行为变更（均带 #编号用例，见 tests/unit/regression/ocr-low-round4-p1.test.ts）

| # | 变更 | 用例 |
| --- | --- | --- |
| #99 | 末位监听者退订后 `hooks.delete(hookName)`，无参 `size()` 回落 | #99 两条 |
| #110 | `dispatchByNamespace` 只按自有键分发（原型链键不再写入/不再触发 strict 抛错） | #110 两条 |
| #116 | `LRUCache` 节点删掉 `lastAccessedAt/accessCount`；`avgAccessTime` 测量区间改为「命中后的收尾成本」，未命中不再取高精度时钟 | #83/#116 三条 |
| #117 | `clear()` 中 onEvict 抛错改为无条件 `console.error`（与 evictLRU 对齐） | #117 |
| #122 | `new BatchManager(非函数)` 构造期抛 TypeError | #122 |
| #136 | `wx.getPerformance()` 结果按监控器实例缓存 + 两道有效性校验（不可用形状/工厂抛错/读数非有限值均降级 Date.now） | #136 四条 |
| #141 | action 收尾链路自身抛错不再成为 unhandledRejection，改由 `onError` 承接（钩子再失败退 console.error） | #141 两条 |
| #148 | 监听器异常新增 `onListenerError` 上报通道，Store 接到 `hooks.emit('onError', …)`（生产控制台仍静默，静默用例不失效） | #148 三条 |
| #150 | `core/performance/index` 恢复 `LRUCache` + `LRUCacheStats/CacheOptions` 再导出（对齐已发布子路径与 CHANGELOG:134） | #150 |
| #158 | 访问器描述符的报错值改为 `[accessor descriptor: get=…, set=…]` | #158 两条 |
| #159 | 嵌套数组改走 `_createArrayProxy`，错误路径 `matrix[0][0]`、变异方法走 ARRAY_MUTATING_METHODS 分支 | #159 两条 |

### 待办（越界，需后续波次处理）

1. #150：`AsyncBatchNotifier` 仍只在 `core/performance/index` 暴露，`src/extras/performance.ts` 未转发（改 src/extras 越界）→ 由 extras 波次补转发 + `tests/unit/extras/entry-exports.test.ts` 覆盖。
2. #150：若判定「performance 子路径不该再聚合缓存」，需改 CHANGELOG.md:134 的记载（docs/根文件越界），当前按恢复代码处理。
3. #103：如需给客户端上报做脱敏，属 `src/extras/error` 侧（ConsoleReporter/HttpReporter 的 payload 组装）工作，核心只保留诊断口径文档。
4. 验证：两个 tsc 与 eslint 均零输出；`npx jest --ci --silent tests/unit/{core,store,cache,hooks,property,regression}` = 43 套件 / 1537 用例全绿（本轮新增 30 条）；越界自查另跑 `tests/unit/{extras,integrations,plugins}` 53 套件 / 999 用例、`tests/integration` 6 套件 / 212 用例均绿，确认源码改动无外部连带破坏。
