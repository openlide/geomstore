# G3 integrations/plugins low 判定记账（29 条）

#327 | fix | 成立但修法受限于本组文件范围：src 内无任何版本单一来源可用（全仓仅 hot-update.ts 硬编码，与 package.json 0.5.1 已脱节），改为注释如实说明「手工维护、漏 bump 只会让版本告警静默失效、不影响恢复」，构建期注入留待办
#328 | fix | 成立：单槽 `hotUpdateManagerInstalled` 在 manager 交替返回时会对同一实例重复安装累加式监听，改 WeakSet 按实例幂等（单例场景行为不变）
#330 | fix | 成立：`!value` 把外部写入的原始 0/false 也当缺失；改显式 `value === '' || undefined || null` 并在 JSDoc 写明 wx 对缺失键返回 ''、空串与缺失平台级不可区分
#333 | fix | 成立：remove 返回 void 使登出/会话清理无法核验；改返回 boolean（与 set 同口径），库内调用点仍以尽力而为为主
#338 | fix | 成立但按报告的第二条出路处理：lastSyncTime 明确记为会话级（filter 与 UserState 文档补「刻意不持久化」的理由），不改持久化载荷=无行为变更
#341 | FP | 前提已不成立：createUserStore 入口对空/纯空白 userId 抛错（medium 波 #337，回归用例 ocr-medium-round4-p1.test.ts:199 已锁），switchUser('') 在赋值前即抛，currentUserId 只可能是 null 或非空串，`!x` 等价 `x === null`；仅补注释说明该不变量
#342 | fix | 成立：clearAll 只毁内存实例、CURRENT_USER_KEY 与 user-store-* 留存；按报告的「显式化」出路在 JSDoc 写清 memory-only 语义与 logout 的差异（改内存+存储会越权删数据，风险更高）
#344 | fix | 成立：全 undefined 映射时仍 setData({})，与本函数 updateAll 的 changed 空更新门禁不一致，补 `Object.keys().length > 0` 守卫
#345 | fix | 成立：safeEqual 注释「对象值不做比较、始终纳入更新」与 updateAll 实现（引用比较 + changedKeys）矛盾，改写并显式记录 getters 无 changedKeys 时脏检查失效的限制
#352 | reject | 现象成立但修法方向不对：getQueueLength 是公开语义，纳入在途段会让 wechat-enterprise onShow 门禁在网络触发的同步期间空跑 showLoading/hideLoading、抢同一个全局 toast（正是该处 syncInFlight 注释刻意规避的）；保留返回值口径并把「不含在途段」写进 JSDoc
#353 | fix | 成立：loadQueue 有 isValidOfflineAction 过滤而 getDeadLetters 原样吐损坏条目给业务层；补同口径过滤 + 丢弃条数告警
#354 | fix | 成立：dispose 后 execute 仍入队并打「操作已缓存」，而 saveQueue 短路 → 静默丢失；改 disposed 早退 + 告警（返回值契约仍为 null）
#357 | fix | 成立：wrapper 就地改写 options，同一 config 再进 App 会二次包装使检查/refreshData 翻倍；用模块级 Symbol 标记（不可枚举）做幂等，保留就地改写（tests/integration/enterprise.test.ts R5-002 依赖该契约，不用浅拷贝）
#358 | fix | 成立：'refreshData' 字面量在守卫与 dispatch 两处重复、且 `in` 命中原型链；提取 REFRESH_DATA_ACTION 常量并改 hasOwnProperty（与 core dispatch、offline.executeAction 同口径）
#361 | fix | 成立但按报告的「文档化」出路：不新增 unregisterHotUpdate（微信无 off API，注销只能靠读注册表判活），在 logout 处写明 destroyed 守卫即预期清理路径
#362 | fix | 成立：@example 里 store 未创建、且宣称公开 API 是 `store.__timeTravel__`（该字段由内部交叉类型挂载、不在 Store 公共类型上、生产构建不存在），改为自含 createStore + globalThis.__GEOMSTORE_TIME_TRAVEL__ 读取路径，并用 @remarks 说明 __timeTravel__ 非公开契约；顺带把同一 doc 块里 @module 的 `@geomstore/...` 错包名改为已发布子路径
#365 | fix | 成立：末条目卸载后空表长期占住 globalThis 键位，读方无法区分「无插件」与「有插件但为空」；卸载分支内补 `Object.keys(current).length === 0 → delete g[globalKey]`，同步调整 3 处既有断言（可选链读条目 + 断言容器已摘），用例 #364 的身份守卫保证未变
#366 | fix | 成立：helper 是 fail-open 的（依赖每个调用方记得守卫）；registerGlobalEntry 内置 isProduction() 短路返回 no-op，改为 fail-safe，JSDoc 同步（库内 3 个调用方原有守卫保留，只为省闭包/日志开销，回归用例 #366 直接调用 helper 证明新守卫独立生效）
#367 | reject | 修法方向不成立：把处理器 this 改标 `AppThis<S,A,G,O,C>` 实测报 TS2322（`this.globalData = {}` 无法赋给 ExtractMappedState；且 ExtractPageData 刻意不带索引签名，`Object.assign(... as Record<string, unknown>)` 与 bindActions/exposeStoreAPI 的形参视图仍需断言，断言总数不降）；能落地的部分是 `as unknown as AppOptions` 的双重断言实测可降为单层 `as AppOptions`，已改
#368 | fix | 成立：头注释列「自动清理订阅」与实现（App 级订阅随运行期常驻、onHide 不清理）矛盾，改为如实描述
#373 | fix | 成立：`Store` 默认泛型 S = State = object → `keyof S` 为 never，setState/$patch/$replaceState 的形参在类型上只接受 never，故三处 `as never` 是必要的，补注释说明原因与何时可删；`use(plugin: unknown) → store.use(plugin as never)` 无此约束（Plugin 已在 Store.use 形参联合里），改为 `plugin: Plugin` 并删掉断言
#374 | fix | 成立：`let lastSaved` 声明在 store.subscribe 之后而 saveState 闭包引用它，属潜在 TDZ；上移到订阅之前（防抖三件已在订阅前，无需再动），无行为变更
#375 | reject | 前提已大部分不成立：可复用部分（resolveMappings/createStoreSubscriber/bindMappings/performAutoInject/cleanupBindings/bindActions）本就在 integrations/utils，三个入口共享；剩余是各入口的接线差异（setData vs Object.assign(globalData)、state 传 isStateKeyDirty 而 getters 不传、退订登记时机、Component action 走 methods 合并），再合一只会把差异塞成回调参数，已在 with-store.ts 注明边界
#377 | fix | 成立：`{ timestamp, ...clone }` 会把顶层 Date/Map/Set 压成 `{ timestamp }`、数组退化为数字键，而上方注释承诺「同一克隆策略、保留支持的类型」；按报告的第二条出路把口径写进注释（改结构属破坏性变更，docs/API.md 的对应描述不在本组可改范围，列待办）
#378 | fix | 成立：currentIndex 在 $replaceState 之前推进，抛错即索引与状态失步并把坏索引传给后续 undo/redo；改为回放成功后推进，undo/redo 不再预先自增/自减索引（异常路径行为变更，回归用例 #378）
#379 | fix | 成立：`snapshots.push(...valid)` 以展开传参，条目数由输入决定，超 V8 实参上限即 RangeError；改循环 push，保留现有钳制+偏移裁剪（回归用例 #379 用 20 万条历史验证）
#380 | fix | 结论采纳：不做预截取（预截取会让 index=90/100 条漂移成 49 而非 40），保持「先按完整输入钳制、再按 overflow 偏移」，并补注释锁定该顺序（回归用例 #380）
#381 | fix | 部分成立：「消费者无法从公开入口取到 PerformanceOptions」不成立（src/extras/performance.ts:12、src/extras/index.ts:37、src/core/performance/index.ts:11 均已再导出），但 plugins 两个入口与 PersistenceOptions/TimeTravelOptions 口径不一致为真，按建议补 type-only 再导出；注意 src/extras/plugins.ts 本就未再导出 analyzer（该文件不在本组范围，已列待办）
#382 | reject | 「不存在该子路径」不成立：scripts/generate-subpath-stubs.mjs 的 subpathEntries 含 plugins→dist/plugins，由 prepack 生成、package.json files 收录，正是给不支持 exports 的微信小程序「构建 npm」用的老式别名；按更准确口径改写头注释（exports 声明的是 extras/plugins，plugins 为兼容别名），而非替换成单一子路径
