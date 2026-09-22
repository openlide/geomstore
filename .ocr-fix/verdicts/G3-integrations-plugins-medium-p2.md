# G3-integrations-plugins-medium-p2 判定记录
#343 | fix | 对象分支 `mapping as Record<string,string>` 直返入参：数字/符号值原样流向 storeKey 查表、且调用方写入回灌用户配置；两分支统一归一并返回新对象，数组分支赋值累积去掉 O(n²) 展开
#347 | fix | Store 只有 getCached、无 hasCached，运行时无法区分「未缓存」与「值确为 undefined」；按报告第一方案补汇总 console.warn + JSDoc 写明跳过语义
#348 | fix | 实测确认：subscribe(cb) 不带 options → SubscriptionManager.add readOnly=false → _writableCount>0 → Store._notifyListeners needsClone=true 整树深拷贝；utils 与 devtoolsAPI 两处默认 { readOnly: true } 并透传调用方 options
#349 | fix | 5 个方法在 target 与 target.__store__ 各写一份（改动必分叉）；提取 api 单点定义 + Object.assign，清理函数按 own-property 记录原值，宿主自有 getState 等还原而非 delete
#350 | fix | 「入队 + rethrow」双通道：调用方捕获 rejection 自行重试会与队列重放叠加，非幂等操作执行两次；按报告备选方案去掉 rethrow（队列成为唯一重放入口，失败记 logger.error 保留原错误），execute 契约改为「失败返回 null=已入队待重放」；同时 JSDoc 写明重放按 (type,payload) 组装、闭包不被重放
#351 | fix | storage.set 返回 false 被丢弃，操作只存内存即被后续落盘覆盖，与 at-least-once 契约冲突；saveQueue 返回布尔（disposed 视为一致）、enqueue 与 syncQueue finally 失败即 warn
#355 | fix | 新包装 wrappedApp 闭包遍历的正是同一模块级 backgroundSyncHandlers（旧包装的回调也读同一数组），清空毫无必要且会静默停用其他模块的 refreshData/onForeground；改为保留 + warn
#356 | fix | `userOnShow?.apply` 只判空不判可调用，options 来自宿主 App({...})，非函数真值（JS 调用/as any）会 TypeError 中断整条 onShow；按报告加 typeof === 'function' 守卫
#359 | fix | 复现成立：syncQueue 的 syncing 互斥让第二次 onShow 立刻 resolve，其 finally 在首次同步仍在跑时 hideLoading；加模块内 syncInFlight，仅发起方 show/hide，重复触发整段跳过
#360 | fix（限本文件） | onLaunch 4 步背靠背，热更新抛错即跳过后台同步与 OfflineManager 创建（onShow 同步永久静默失效）且异常外抛中断宿主；逐步 try/catch + logger.error。报告另述的 with-app-store.ts 不在本分组可改清单内，留待办
#363 | fix | 属主表可被外部/旧版本占位为原始值/冻结对象（ESM 严格模式下写属性抛 TypeError），storeName=store.name 可控，`table['__proto__']=api` 会 setPrototypeOf 污染共享表；容器校验后换表 + defineProperty 写入 + hasOwnProperty 判定（lib=ES2020，Object.hasOwn 不可用，用等价 call）
#364 | fix | 按引用比对不是「本次注册」守卫：devtoolsPlugin 注册的是 store 实例本身，重复安装复用同一引用 → 先装的卸载删掉后装条目；原始值 api 退化为值比较。改为模块内 registrationOwners 令牌表（键位→自增序号），条目仍不可信的自有引用判定作二次守卫

## 主控需知
- 3 条既有测试固化了报告所说的旧行为，已按「代码正确、测试反转」改测试：UTIL-002（`toBe(mapping)` 断言返回入参本身）、ENTERPRISE-070（断言外部替换 App 后清空注册表）、enterprise-background-sync.test.ts 的 console.error 计数（原先依赖清空注册表做跨用例隔离，改为 afterEach 显式 unregisterBackgroundSync）。
- #350 是对外 API 契约变更：`OfflineManager.execute` 在线失败不再 reject（返回 null=已入队待重放，原错误记 logger.error）。调用方若原先 catch 它做重试需改为读队列/返回值；CHANGELOG 与 docs/API.md、skill references/extras-enterprise.md 需同步（文档越界，留 Wave D）。
- #348 行为变更：exposeStoreAPI / devtoolsAPI 的 subscribe 默认 readOnly=true，回调收到的是只读保护 Proxy 而非深拷贝副本——就地改载荷者会触发状态保护告警（原先是静默改到一次性副本），需显式传 { readOnly: false }。
- #347/#349/#351/#355/#359/#360 新增 console.warn/logger 输出，若有测试以「无 console 噪声」为前提需关注（本次全量 2691 例通过）。
- 报告 #356 同时点名的 with-store.ts 生命周期 typeof 混用、#360 点名的 with-app-store.ts 绑定流程，均不在本分组可改文件清单内 → 待办（归属 integrations 其他分组）。
