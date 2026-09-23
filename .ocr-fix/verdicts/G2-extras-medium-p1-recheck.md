# G2 extras medium P1 补审计（4f08963 一次性落地、原判定表缺失的回填）

审计基线：`git show 4f08963 -- src/extras` + HEAD 现状核对；本轮补做见文末。
格式：`#id | verdict | 一句话依据`

#180 | fix | getHistory/clear 均改 `actionName !== undefined`（ActionHistory.ts:96/167），并补 @remarks 说明空串是合法桶名
#194 | fix | 构造参数落为 `private readonly actions`（ActionUtils.ts:55），execute 加重载：省略首参用绑定 actions，显式传 A 仍兼容
#196 | fix | 新增 async-core.toError，入口统一规范化：recordOutcome/executeParallel/executeSerial/shouldRetry/onRetry 均收 Error，对外仍抛原始值
#197 | fix | 逐次尝试走不记账的 run()，recordOutcome 只在整体结果处记一条；JSDoc 明确 total/successRate 按逻辑调用口径
#198 | fix | executeWithTimeout 的记账挂在 race 之外，超时即落一条失败，底层迟到结算不再写历史；Promise 不可取消已在 JSDoc 声明
#200 | fix | createDecorator 的 reportError：onError 包 try/catch（回调异常只记 console.error，不顶替原始错误），值先过 toError
#201 | fix | before/after 结果 isThenable 检测接续：async before 被等待、rejection 走 onError；异步主链 after 接回返回值；同步路径兜住 rejection 防 unhandled
#203 | fix | 退避 delay 归一到 [0, 2^31-1]（NaN/负→0、超限截断）；raceWithTimeout 走 normalizeTimeout（非有限/<=0 抛 RangeError，有限值截到 2^31-1）
#205 | fix | ActionLoader 记住 lastSetState，clear() 先 resetDerivedState 给 loading/error/errorData 各键补写复位值再清内部记账（也可显式传 setState）
#206 | fix | 删除实例私有 loadingStates 镜像，isLoading/getAllLoading 直接以（可共享的）loadingRefCounts 为准（ActionLoader.ts:337）
#207 | fix | setOptions 检测 loadingKey/errorKey/errorDataKey/perActionKeys 变化，与 autoLoading 切换同样先 resetDerivedState 再丢弃旧记账
#208 | fix | wrap 泛型约束放宽为 `(...args: never[]) => Promise<unknown>`（逆变安全，无需 any+eslint-disable）；本轮删除测试里遗留的两处 `as any`
#213 | fix | withDebounce：descriptor.value 显式收窄类型 + 装饰阶段 `typeof !== 'function'` 抛 TypeError，不再晚到失败被 catch 吞
#214 | fix | 删除死回退 `runArgs.length ? runArgs : args`，定时器只触发最后一个调用、pendingArgs 刚同步写入，直接传 runArgs
#217 | fix | 在途占位条目 expiry 由 MAX_SAFE_INTEGER 改为 `now + max(ttl, MIN_IN_FLIGHT_TTL=60s)`，set 前先 reclaimExpired；「pending 数上限」为报告可选项，有限生存期已封住泄漏
#218 | fix | writeCache 容量淘汰循环 `if (entry.pending) continue` 跳过在途占位，保住同参并发去重；同步修正/删除不成立的 istanbul ignore else 断言
#219 | fix | Map/Set 包装由对象字面量 `{__map}` 改为数组 `['__map', entries]`：数组元素位的字符串必被标记成 `s:"..."`，用户参数无法伪造裸标记，撞键串用结果不再可能
#221 | fix | decorators/index.ts 补 CacheDecoratorOptions/RetryDecoratorOptions/DecoratorOptions（外加 Log 三型）再导出，action/index.ts 不再深链子模块
#222 | fix | withLog 增 redact 钩子；生产（isProduction()）缺省 summarize：只留类型/长度/键数等结构信息，token/PII 内容不入日志
#224 | fix | withLog 增 sink 注入（LogSink，缺省 console），与 PerformanceMonitor 的 logger 同思路；生产内容侧由 #222 的缺省摘要门控
#225 | fix | action/index.ts 头注释改为如实（ActionHistory 为内部层、ActionStats 补导出）；装饰器类型统一走桶；extras/index.ts 明确 selector/error 不经总入口、走子入口
#226 | fix-partial | withTimeout/withErrorBoundary/withDebounce 均有装饰阶段守卫，但 withRetry 当时漏改 → 本轮在 retry.ts 补齐同款 TypeError 守卫
#227 | fix | withTimeout 工厂阶段 normalizeTimeout：0/负数/NaN/Infinity 直接 RangeError（不等装饰的方法执行），有限值截到 2^31-1
#233 | fix | 类 JSDoc 下移紧贴 `export class ErrorHandlerImpl`，DEFAULT_MAX_LOG_SIZE 只留自身单行注释，悬空文档块消除
#234 | fix | 新增 copyContext：getErrorLog/getLastError/getErrorsByOperation/getErrorsByLevel 四个出口全部给浅拷贝副本，外部改不污染内部
