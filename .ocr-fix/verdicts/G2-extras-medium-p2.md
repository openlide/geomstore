# G2-extras medium p2 判定记账

| #id | verdict | 依据 |
| --- | --- | --- |
| #254 | fix | configure/ErrorRecovery.ts:83-85、224-226 确实静默补 3/1000/true，接口 JSDoc 无任何默认值与取值域说明，补文档 |
| #255 | fix | executeRestartStrategy 无配置可消费、恒返回 undefined，与 RETRY「库内无引用只能上报意图」同构；按报告给的第二个选项在枚举注释中显式声明 RESTART 不接受配置 |
| #258 | FP | 超时≠成功是文档化的有意取舍（ErrorMonitoring.ts:175-176「否则弱网下被直接丢弃」、224-225「否则网络抖动期间错误被静默丢弃」）；报告的前提「若要求至多一次」在本库契约中不成立，其建议（超时后排除重试）会把重复上报换成弱网场景必然漏报 |
| #259 | fix | doFlushReports:164 仅快照入口时刻队列属实；flushReports JSDoc「立即上报所有队列中的错误」在 isFlushing 分支下过度承诺，澄清语义（排空保证仅由 shutdown 提供） |
| #260 | fix | clear() 后 consecutiveFlushFailures 残留会使新批次提前触发「丢弃批次」（doFlushReports:229-237），补计数重置并写明 clear() 不停调度器；带回归测试 |
| #262 | fix | recoverable:true 显式且未配 fallback（或 setFallbackState(undefined)）时 handleError 返回 undefined，`as T \| F` 掩盖；签名放宽为 T \| F \| undefined 并去掉 cast；src 内无调用方受影响（typecheck include 仅 src） |
| #263 | fix | instanceof Promise 漏掉跨 realm/自定义 thenable，rejection 绕过 executeAsync 成 unhandled rejection；改 then 鸭子类型判定，带回归测试 |
| #267 | fix | 与 ErrorRecovery.ts:274-276 自述不变量「不按 code 级联全清」直接矛盾：164 与 354 两处走 clearRetryCount(code) 级联清；改按当前 retryKey 精确删除，删除随之死掉的 clearRetryCount（noUnusedLocals 会报） |
| #268 | fix | 两处元错误丢原始 error；不抛 GeomStoreError（「非 GeomStoreError」伪装成域错误会被 isGeomStoreError 路由再喂回 recover，且 ES2020 lib 下 cause 需赋值），改为 attach cause |
| #271 | fix | wx 分支确实只透传 method/header/body；补 timeout 透传（wx.request 原生支持，缺失时不加键保持既有调用形态）并文档化其余 RequestInit 字段在 wx 分支被忽略 |
| #272 | FP | 「阻塞 ErrorMonitoring flush 管线」不成立：doFlushReports:193-199 对每个 reporter 任务 race reportTimeout，allSettled 等的是竞速结果而非 task 本体（tests/unit/extras/error/error-followups.test.ts:118-139 已固化该语义）；reporter 内再设超时与监控层重复，#271 透传后挂起请求在平台侧也会 fail |
| #273 | fix | 直传 body 字符串省 stringify→parse→再序列化往返（wx 默认 content-type 即 application/json，字符串按其发送，落盘字节不变）；throw 路径经 createDefaultRequest 私有性实际不可达，但重复转换与维护成本成立，且 JsonBody 注释需随之改写 |
