# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

暂无。

## [0.6.0] - 2026-09-23

本版本汇总**第四、五两轮 ocr 复审**与两处复审登记的语义债：第四轮 454 条（critical 6 / high 31 / medium 239 / low 178，分波提交 `1097621`、`5616cbb`、`4f08963`、`5a677d2`、`a954078`、`02bd20f`、`1510829`）、Wave E 四项公开面改造（`dba29b9`、`2e95032` + `841d1ab`、`c7027a0`、`666e1ea`）、第五轮 376 条（`b83d2df`）、`deepEqual` 的内建类型口径修复（`ffc810d`）。逐条判定与证据在 `.ocr-fix/decisions.md` + `.ocr-fix/verdicts/*.md`（第四轮）与 `.ocr-fix/decisions5.md` + `.ocr-fix/verdicts5/*.md`（第五轮）。本节只列**用户可感知**的语义变化，内部健壮性 / 注释类修复不逐条重复。

> **本版含破坏性变更，因此升的是 minor（0.5.1 → 0.6.0）**：下面「Breaking」一节有类型面收紧与若干判据反转（`equalityFn` 快照选项、`SnapshotResult.data`、`WxStorageBackend` 抛错、`maxSubscribers` 硬上界、`deepEqual` 子类 / 装箱判不等）。按 `^0.5.1`（展开为 `>=0.5.1 <0.6.0`）锁定的宿主**不会被自动升级**，需要主动改依赖，并照 [docs/MIGRATION.md](./docs/MIGRATION.md) 的「需要改代码」一节逐条迁移。

### Breaking（类型面与对外契约）

- **`HookHandler` 只剩一个类型参数**：`HookHandler<TArgs extends unknown[] = unknown[]>`，`TResult` 已删除——`emit` 从不读处理器的返回值，需要否决请走异常通道。`IHookSystem.on` / `emit` 改按 `HookArgsMap` 与钩子名关联实参：`emit('afterDispatch', name, result)` 这类参数顺序 / 个数写错的代码从「静默通过」变成编译错误（单一钩子名拿到精确形参，联合钩子名沿用擦除形状以兼容组合层桥接）。新增导出类型 `HookArgsMap` / `HookHandlerFor`。
- **`IHookSystem` 新增必需成员 `listenerCount(hookName): number`**：双语义的 `size()`（无参＝总注册数、带参＝单钩子数）从此有无歧义替代。仓库内唯一实现方 `HookSystem` 已提供该方法；自行实现 `IHookSystem` 的第三方需补上。
- **`ActionDecorator` 改为 `MethodDecorator` 的别名**：此前反向不可赋值，`const d: ActionDecorator = withRetry()` 编译不过（库内 8 个公开装饰器返回的都是 `MethodDecorator`）。
- **`ActionResult` 收紧为判别联合**：`success: true` 的结果不再能携带 `error`。未收窄直接读 `data` / `error` 仍得到 `T | undefined` / `Error | undefined`，收窄后精确。
- **`ActionExecutionContext` 默认泛型收紧**为 `S extends State = State, A extends Actions = Actions`：默认写法下 `ctx.actions.x()` 可调用（此前 `A = unknown` 不可调用）。副作用：以 `interface` 声明的 action 集合不满足 `Actions` 的 `Record` 索引签名约束，需改用 `type` 别名。action 名与基座成员同名（如 `getState`）时，`this.getState` 不再合成成「既像 action 又像基座」的重载集，而是按 action 解析——与运行时（`exposeStoreAPI` 之后仍是基座 API 胜出）一致。
- **`persistencePlugin({ storage })` 在 `store.use()` 安装期校验后端完整性**：缺少 `getItem` / `setItem` / `removeItem` 任一项即抛 `TypeError` 并点名缺失方法（此前只检查 `getItem`，缺写入方法的「只读后端」会推迟到首次落盘才炸、且被 `saveState` 吞成一条日志；悄悄回落到 `wx` / 内存则把数据写到另一个后端）。`Store.use` 原样上抛安装异常，`usePlugin` 仍按既有口径吞掉并 `console.error`。
- **`OfflineManager.execute` 失败不再抛错**：在线执行失败时返回 `null`（语义＝本次未执行、已交队列重放），原错误记 `logger.error`。此前「入队 + reject」双通道会让非幂等操作（下单 / 提交表单）被执行两次；原先 `catch` 它做重试的调用方请改读返回值或队列长度。
- **`createUserStore({ userId })` 拒绝空标识**：`userId` 非字符串、空串或纯空白即抛错。此前会派生出 `user-store-` 这类畸形键，不同账号在存储与 `StoreManager` 上撞同一键＝跨账号数据泄漏。`createEnterpriseApp` 冷启动读到历史脏标识时按未登录处理（清键并记日志，不再中断 `App` 构造）。
- **`syncWithServer()` 校验响应体**：`statusCode` 为 2xx 但响应体没有 `userInfo` 对象时改为 reject（此前把 `undefined` 直接写进 `userInfo: UserInfo | null` 的契约，UI 侧看到「同步成功但无用户」）。同步地址由 `syncUrl` 配置——**0.6.0 第五轮复审已把内置默认端点整个删除**，未配置即不发请求直接 reject，详见下方「第五轮复审」的 Breaking 条。
- **`setStateProtection()` 在销毁后抛错**：与 `setState` / `$patch` / `subscribe` / `use` / `cache` / `batch` 同口径（消息 `[GeomStore] Cannot call setStateProtection on a destroyed Store`）；只读的 `isStateProtectionEnabled` / `getStateProtectionConfig` 仍豁免。
- **Store 品牌 Symbol 键更名**：`Symbol.for('__geomstore_brand__')` → `Symbol.for('@openlide/geomstore:brand')`，带包名命名空间以降低与第三方符号偶然碰撞，且刻意不加版本号（加版本会重新制造「分包副本 A 认不出副本 B 的 Store」）。`isGeomStore()` 用法不变；直接按旧键名读该 symbol 的代码需同步。该键不是安全边界，写入保护始终来自状态代理与内部访问令牌。

### Added（新入口，Wave E）

- **`withThrottle` / `withDebounce` 各三个宿主级收尾入口**（六个函数，Wave E）：`cancelThrottledCalls(host, method?)` / `flushThrottledCalls(host, method?)` / `disposeThrottledState(host)`、`cancelDebouncedCalls(host, method?)` / `flushDebouncedCalls(host, method?)` / `disposeDebouncedState(host)`，从 `@openlide/geomstore/extras/action` 或 `@openlide/geomstore/extras` 引入，供 Page `onUnload` / Component `lifetimes.detached` 调用。三个语义互斥：`cancel` **丢弃**挂起调用（原方法不再执行）、`flush` **立即执行且只执行一次**（与窗口 / 延迟自然到期同语义；无挂起调用时不凭空执行，队列已空则再次 flush 为 no-op）、`dispose` = 取消挂起调用 **+ 释放该宿主的整张状态表**（节流连窗口计时 `lastCallTime` 与异步观测标记一起归零，防抖删掉该宿主的整张槽位表），三者都幂等。
  - **入口以宿主为参数、而不是装饰期发句柄**：装饰器表达式在类定义期求值后即被丢弃，卸载点手里只有 `this`，因此状态表从工厂闭包上提到模块级 `WeakMap<宿主, Map<slotKey, 状态>>`（`slotKey` 是每个被装饰方法一个 `Symbol`，隔离度与旧实现等价；键是宿主本身，宿主被回收时整条状态随之消失）。`method` 省略时覆盖该宿主上所有被装饰方法，传入时按方法名筛选（`Symbol` 身份同样精确匹配，不按描述串误命中）。
  - **被取消的调用拿到什么**：防抖挂起的每个 Promise 都以 `Error('[withDebounce] pending call was cancelled')` 拒绝——拒绝前先给它们补一个 `catch` 处理器，只消全局未处理告警，真正 `await` 的调用方仍看得到这条 rejection（不结算会永久挂起调用方）。节流被抑制的那次调用**在调用时刻就已**以 `undefined` 结算（异步方法或 `assumeAsync: true` 时是 `Promise<undefined>`），`cancel` / `flush` 处理的只是尚未发出的尾随补发，补发失败按既有口径就地记日志、不外抛。宿主为基本类型 / `null` 时六个入口一律 no-op（与装饰器自身的降级口径一致）。

### Changed（行为变更）

- **`persistencePlugin` 未传 `storage` 时的默认后端统一为 `WxStorageBackend`**（Wave E，`666e1ea`）：`builtin.ts` 里那段内联 wx 适配器整段删除，默认路径与显式 `storage: new WxStorageBackend()` 从此是同一份实现（缺失键归一化、异步守卫、可用性判定都不再各写一份）。四条可观测变化：
  1. `getStorageSync` 返回 `''` 归一为 `null`（此前内联适配器只把 `undefined` / `null` 当缺失，`''` 会被当成「有数据」交给 `JSON.parse('')` 并在恢复路径报一条解析错误）；非字符串载荷（wx 会原样返回写入过的非字符串值）一律按无数据处理，不再被 `as string` 塞进 `JSON.parse`。
  2. 三个方法的返回值仍过异步守卫，命中 Promise 时**抛错并记一条 `[WxStorage] <方法> error:` 日志**（内联适配器原本也抛错，但不打日志）。对显式传 `new WxStorageBackend()` 的调用方这是新行为：该类的 `getItem` 此前会把 Promise 洗成 `null`＝「有数据误判无数据」，下一次落盘即覆盖真实数据；`setItem` / `removeItem` 此前完全不看返回值。
  3. 可用性判定由「有 `getStorageSync`」收紧为「`getStorageSync` / `setStorageSync` / `removeStorageSync` 三方法齐备」（与安装期校验用户后端的严格度同口径）：只提供读方法的残缺 `wx` 不再被当成可用后端、每次落盘抛 `TypeError`，而是走内存降级（开发模式 `console.warn`、生产模式 `emit('onError', …, 'persistence')`）。
  4. 降级文案（`degradeMessage`）补「wx 同步 API 不齐备」：`[GeomStore][persistence] 未检测到可用的 storage 后端（非微信环境、wx 同步 API 不齐备，且未传入 storage），降级为内存存储，持久化不生效`——按文案匹配日志 / `onError` 的调用方需同步。
- **`WxStorageBackend` 的实现文件从 `src/types/persistence.ts` 迁到 `src/plugins/WxStorageBackend.ts`**（Wave E，`c7027a0`；**非破坏性**）：公开子入口不变——`@openlide/geomstore/extras/plugins` 与 `@openlide/geomstore/extras` 拿到的仍是同名同类，`exports` 与 prepack 子路径表一字未动，逐入口比对的导出符号集（`extras` 76 / `extras/plugins` 9 / `plugins` 18）完全一致，只换了内部 `from` 说明符。类体与 `WxStorageApi` 迁移前后逐字节相同（本次零行为变更，行为变更来自上面那条的默认后端统一）。只有直接深链源码路径的写法需要换文件。`@openlide/geomstore/plugins`（prepack 生成的兼容别名）本就不导出该类，值导出面未扩。
- **`ActionLoader` 与 `withLoading` 的选项缺省值单点化**（Wave E，`666e1ea`）：`loadingKey` / `errorKey` / `errorDataKey` / `autoLoading` / `perActionKeys` 的默认值与归一化收口到 `ActionLoader.ts` 的 `ACTION_LOADER_DEFAULTS` + `normalizeActionLoaderOptions`，`withLoading` 的第二份镜像整块删除（**值一字未改，无行为变更**）。这两个默认值此前漂移过一次，后果不是「值不好看」而是注册表分桶错配（有效配置相同的装饰器被拆开、配置不同的落进同一桶）。`ACTION_LOADER_DEFAULTS` 仅供库内复用，未经 barrel 再导出，**不是公开 API**。
- **错误日志上限的默认值改为单一来源**（Wave E，`666e1ea`）：`ErrorHandler.errorLog`、`setMaxLogSize` 的非有限值回退与 `ErrorBoundary.errorHistory` 的裁剪都取同一个 `DEFAULT_MAX_LOG_SIZE`（值仍为 100，无行为变更；此前 `ErrorBoundary` 另持一份字面量、注释却自称「与 ErrorHandler 同口径」）。该常量同样只在同目录复用，未公开。
- **`createDecorator` 不再把同步方法包成 `async`**：同步方法原样同步返回，返回 Promise 的方法才以 `.then` 挂 `after` / `onError`。`before` 返回 Promise 时整次调用降级为异步并等它 settle（其 rejection 走 `onError`）；`after` 返回 Promise 时只有被装饰方法本身是异步的才被接回返回值，同步路径就地兜住 rejection 并记日志，不再留下 unhandled rejection。`onError` 收到的是**规范化后的 `Error`**（`throw 'str'` 被包成带原文的 Error），且它自身抛错只记一条 `[Action] onError callback threw`，不再顶替原始失败。装饰非函数描述符（`get` / `set` 访问器）在装饰阶段即抛 `TypeError`；包装函数保留原方法的 `name` 与 `length`。
- **`withLog` 新增 `sink` 与 `redact`**：`withLog(name?, options?)`，`sink` 接入项目 logger（缺省 `console`），`redact(value, phase)` 按 `args` / `result` / `error` 阶段决定脱敏形态。**生产构建默认只输出摘要**（类型 / 长度 / 键数），不再原样打印参数与返回值——action 参数常带 token、密码与用户数据；开发构建仍原样输出，显式传 `redact` 即视为自行决定了脱敏策略。
- **快照失败不再回传活引用**：同步 / 异步快照在异常或中止路径上把 `data` 置为 `undefined`（此前是 `data as T` 原样带出调用方的活动对象，一次「失败快照」就能改到宿主状态）。中止根节点同理，`data` 为 `undefined`。
- **快照计数口径统一**：`metadata.nodeCount` 两条路径都取「实际进入克隆的节点数」（不含在计数前就被 `maxDepth` 截断的节点），此前异步侧按「处理过的任务数」计，同一输入两边对不上；驱动层的 `processedCount` 只服务 `onProgress`。`SnapshotProgress.total` / `percentage` 为近似值（估算深度上限 10），不可当完成判据。
- **`onProgress` 抛错不再判整次快照失败**：进度回调就地兜住，落一条 `unknown` 账（不参与 `success` 判定）并在首次异常后停止调用，克隆结果照常交付。`onError` 仍按「决策回调」对待：它抛错会让整次快照失败。
- **克隆的类型判定纳入 `onError` 链路**：`value instanceof Date` / `getTime()` / `Object.getPrototypeOf(...)` 在 Proxy 陷阱抛错时，此前会绕过节点级错误处理，只留一条路径含糊的驱动层 `cloneError`（根节点为陷阱对象时连失败结果都不交付）；现按节点落账 → 咨询 `onError` → 继续则丢子树。`Map` 的 **Symbol 键**不再让快照抛 `ToString(Symbol)` 崩溃（异步路径原本就是 `String(k)`）。
- **`compareSnapshots` 不再把「深过护栏」当成差异**：超出 100 层逐路径展开上限后退化为迭代式 `deepEqual`（深度预算不限，避免二次触发它的告警），两侧逐字节相同的超深结构不再永远 `changed`，依赖该结果的缓存 / 去重不再全量失效。
- **组合 Store 通知期间新脏子 store 留给下一轮**：引入与单 Store 同款的延后脏集合，通知回调内的重入写入不再被本轮收尾清空（集成层对稳定引用对象值的「未变化」跳过判定会永久漏更新）。收尾语义为「本轮脏键作废、新脏键进入下一轮」。
- **嵌套键路由不再受 `warnMissingKeys` 影响**：非命名空间外层包含命名空间内层时，`'子store/键'` 的归属只按数据形状判定，同一份写入在开发与生产走同一分支（此前 `$replaceState` 的告警开关被当成了路由开关）。命名空间分发只认 payload 的**自有键**，原型链上挂的可枚举属性不再被当作 store 名写入。
- **`subscribe(fn, { readOnly })` 的拷贝判定真正落地**：载荷形态按「是否存在可写订阅者」决定——全部只读时走零拷贝（状态保护开启则收到只读保护 Proxy，关闭则是原始引用），存在可写订阅者时深拷贝。`notify.clone` 未显式配置即为自动模式；显式 `true` 强制深拷贝，显式 `false` 仍在有可写订阅者时拷贝以防污染。页面 / 组件 / App 绑定本身是只读订阅，因此**默认场景下通知不再深拷贝整棵状态树**。
- **监听器与 action 收尾链路的异常有了归口**：订阅回调抛错在生产仍不刷控制台（库口径不变），但会通过 `onError` 钩子上报（`hooks.emit('onError', error)`），监控插件不再失明；action 结算链路自身抛错（补刷缓存 → 通知）此前变成 `unhandledRejection`，现同样归口 `onError`，钩子再失败才退到 `console.error`。
- **`$replaceState` 把「被删掉的旧键」也标脏**：脏键取新旧键集合并集，此前只标新状态的键，被这次替换删掉的键在 `isStateKeyDirty` 上恒为 `false`，视图会一直留着已消失键的值。
- **`deepEqual` 的深度预算跨 Set 累加**：Set 元素配对不再让深度归零，超深结构按保守语义判不等（与 Map 值分支同口径）；同一次顶层调用的「超过最大深度」告警只出一次。`symbol` 与不可枚举属性不参与比较的口径写入签名文档。
- **嵌套数组走数组代理**：`this.state.matrix[0][0] = 1` 的错误路径恢复为 `matrix[0][0]`（此前塌成 `matrix.0.0`），且 `push` / `splice` 等变异方法重新命中数组专用拦截分支（此前以「给属性 'push' 赋值」文案抛出）。动作上下文代理不再屏蔽 `Symbol` 键成员（`Symbol.toStringTag`、Store 品牌键等此前一律读到 `undefined`）。
- **错误聚合统计随组驱逐一致**：`ErrorAggregator` 的 `byStore` 改为与错误组同生命周期计数，组被 `maxGroups` 驱逐时一并删除，`sum(byStore) === totalErrors` 在长期运行后仍成立；组内 `storeHits` 不再让跨 Store 的错误组把整组次数重复计入每个 Store。
- **错误组样例不再携带 `payload`**：`sampleError` 改为只含标量字段 + `error` 引用的浅拷贝，并随每次命中刷新为最近一次出现。此前它强引用调用方的 `ErrorContext`（其 `payload` 常指向 store / 页面节点），等于让进程级缓存钉住整棵对象树。组 ID 命中后还会严格比对指纹原文，32 位哈希碰撞不再把无关错误静默并组。
- **`reportTimeout <= 0` 表示「不超时」**：不再创建 0ms 定时器，直接等待 reporter 任务（此前真实异步上报几乎必然被判超时 → 重入队 → 按 `maxFlushRetries` 丢弃）。`clear()` 同时复位「连续全部失败」计数，避免新批次被提前判定丢弃；`clear()` 不停止调度器。
- **`ErrorBoundary` 接受非 Error 抛出值**：`throw 'str'` / `throw 42` 先归一化为 `Error` 再写入 `errorHistory`、传给 `onError` 与 `fallback`（此前这些位置声明 `Error` 却拿到原始值，读 `.message` / `.stack` 得 `undefined`）；重抛时仍是**原始值**，捕获方语义不变。`execute` / `executeAsync` 的返回类型补上 `undefined`（显式 `recoverable: true` 而未配 `fallback` 时的真实结果）。
- **`ErrorRecovery` 的受控字段不被调用方覆盖**：`recover(error, context)` 的 `error` / `config` / `attempt` 一律由库内后写，此前展开顺序让调用方传入的同名字段能替换查表得到的策略与重试记账键（实际执行的策略与 `error.code` 不一致）。清除重试计数改按键精确删除，不再按错误码级联全清；`RecoveryContext.attempt` 现在反映真实重试次数（此前恒为 0）。
- **重试与退避的回调异常被隔离**：`retryWithBackoff` 的 `onRetry` 抛错不再中断循环、不再顶替真实失败（与 `ErrorRecovery` 同口径）；`createRetrySelector` / `createRetrySelectorAsync` 的 `shouldRetry` 抛错按「不再重试」处理、`delay` 函数抛错按 0 等待继续，抛出的原始错误照常带真实 `attempts`。`withCache` 的用户 `keyFn` 抛错时该次调用退化为「不缓存并直接执行」，不再让整个方法失败。
- **企业级集成的存储与账号切换**：`switchUser` 现在写回当前用户键（此前只在 `login` 写，其它入口换号后冷启动恢复旧身份）；备份键与用户 store 键改由单点派生；损坏备份的 `timestamp` 缺失不再让过期门禁静默绕过；`get` 读取失败补日志、`remove` 返回 `boolean`；序列化结果为 `undefined`（值为 `undefined` / 函数 / symbol）时不再误报写入成功。存储后端不可用时的降级在**生产环境改走 `onError` 钩子**（非生产仍 `console.warn`），持久化彻底静默失效从此可被监控发现；`clearOnUninstall` 的删除失败不再被吞掉。
- **集成层调试入口收紧**：`exposeStoreAPI` / `devtoolsPlugin` 的 `subscribe` 默认按只读注册，回调收到的是只读保护 Proxy 而非深拷贝副本（就地改载荷会触状态保护告警，需显式传 `{ readOnly: false }`）；`bindActions` 改用自有属性写入（`__proto__` / `constructor` 不再沿原型链污染宿主），冲突时告警并在解绑时恢复宿主原值；同一份 `App` 配置被重复包装不再让热更新检查与 `refreshData` 翻倍触发；devtools 注册表改按自增令牌登记（同一引用重复安装不再让先装的卸载删掉后装的条目）。
- **时间旅行与历史导入**：`importHistory` 跳过 `state` 为数组或自带 `__proto__` 自有键的条目（此前入栈后 `goTo` / `undo` 会在核心抛 `$replaceState: newState must be a plain object`）；`undo` / `redo` 改在回放成功后推进索引，抛错不再留下与状态失步的坏索引；超大历史（数十万条）导入不再因展开传参触 `RangeError`。
- **插件全局入口**：`registerGlobalEntry` 改为 fail-safe（生产环境直接 no-op，不再依赖每个调用方自带守卫）；末位条目卸载后空容器从 `globalThis` 摘除，读方得以区分「无插件」与「有插件但为空」；analyzer 卸载只摘仍属于本实例的包装，之后 `store.getter()` 不再向已清理的监控器写幽灵指标。

### Fixed

- `new BatchManager(非函数)` 在构造期抛 `TypeError`（此前只在最外层 `end()` 才炸）；`clear()` 中 `onEvict` 抛错改为与淘汰路径一致的 `console.error`；`hooks` 末位监听者退订后摘除空键，不再让 Map 只增不减。
- `PerformanceMonitor` 的 `maxSize` 规范化（此前负数会在空数组上死循环）、`getPercentile` 越界参数校验前置、`sampleRate` / `threshold` 双向规范化、阈值预警与采样解耦（logger 收到的是记录副本）、`wx.getPerformance()` 按实例缓存并对不可用形状与 `NaN` 读数降级 `Date.now`。指标出口（`getMetrics` / `getMetricsByType` / `getRecentMetrics`）返回元素副本，`MetricsCollector` 改环形缓冲。
- `ConsoleReporter` 在 `console.group` 存在但调用即抛的基础库上降级为平铺输出并保证 `groupEnd` 恰好一次；批量路径的级别标签与字段打印与单条路径统一，残缺 `context`（缺 `level` / 非法时间戳 / 非数组入参）不再让上报链抛错。`HttpReporter` 的 `Headers` 形参数按鸭子类型归一化（此前真实 `Headers` 会被展开成空对象而丢头）、透传 `timeout` 到 `wx.request`、避免 body 的 `stringify → parse → 再 stringify` 往返。
- `StorageBackend.getItem` 对「键不存在」的判定收紧为 `typeof value === 'string' && value !== ''`（微信缺失键返回空串），`getStorageSync` 的返回类型放宽为 `unknown` 使该守卫有意义；`WxStorageBackend.removeItem` 由吞异常改为抛错（恢复路径无法区分「无数据」与「读失败」时，静默继续会在下次落盘覆盖真实数据）。
- `ErrorLevel` 的日志映射改 `switch` + `never` 穷尽守卫（新增级别不再被静默降级为 `console.info`）；`warn` 标 `@deprecated` 但保留（已随包发布）；`ErrorHandler` 的四个诊断出口返回浅拷贝，`ErrorMonitoring.clear()` 复位连续失败计数。
- 类型面：`ExtractGetters` 与 `ExtractStates` / `ExtractActions` 收敛到共用的 `ExtractField` 并修掉可选 `getters` 塌成 `never` 的问题；`ExtractMappedState` / `ExtractMappedGetters` / `ExtractMappedActions` 补 `undefined` 守卫，`withAppStore` 的映射类型改按实参推断（与 `withPageStore` 一致，此前 `keyof S` 会退化成 `never`）；`ParametricSelector` 补 `S` / `P` / `R` 默认值；`SelectorComposerInput` 新增可选 `R` 使 `combiner` 返回类型精确；`createStructuredSelector` 的映射参数保持可选并写明「缺键静默跳过」的代价；`ResolvedState` / `StoreOptionsBase` / `SubscriptionOptions` / `NotifyOptions` / `ActionsWithThis` 导出，`PageReservedKeys` 补 `onShareTimeline` / `onAddToFavorites` / `onSaveExitState` / `options`。
- `deepMerge` 的 `fallbackClone` 对 `__proto__` 走 `defineProperty`；快照的 `mode: 'json'` 在顶层与嵌套口径一致；类实例 / 空原型对象的克隆不再走 `JSON` 兜底。

### Performance

- **脏键归属索引改增量维护**（`dirtyTracking`，ocr #178，Wave E `dba29b9`）：0.5.1 的做法是「按需构建一次索引，遇结构性写入整体失效重建」，列表逐项更新因此仍呈平方级。现按一次写入对被索引图的影响分三档处理——**纯新增边**（容器写入一个此前不是对象的位置）只把容器的归属键并入新子树，子树里某节点已含全部这批键时它的子树早已覆盖、直接剪枝；**图不变**（标量改写、同对象自赋值、数组 `length` 改写没删掉尾部对象、`Set` 重复 `add`）原样复用索引；**删边**（覆盖已有的对象值、`delete` 掉对象值键、`Map#set` 覆盖一个值已是对象的键、`Map` / `Set` 的 `delete` / `clear`、覆盖自有访问器、调用会自行改状态的实例方法）以及状态版本被外部推进时，一律退化为全量重建。**这是一处有意的保守分类，不是无脑 O(1)**：删边后旧子树是否仍从别的顶层键可达无法廉价判定，猜错的代价是漏报，而漏报等于变更对页面永久不可见，所以宁可多花一次重建。
  - 量化（同进程 A/B，2000 元素列表 + 500 元素嵌套列表）：`2000× list.push(对象)` 的 `rebuildOwners` 由 4000 次降到 1 次、耗时 185567ms → 104.9ms；`10000×` 混合写入同样 4000 → 1 次、189827ms → 178.0ms；**原位替换对象值与 `delete` 按设计仍走全量重建，耗时不变**；标量写入路径不退化（≈450ms → ≈437ms）。整套单测 + 集成从 411s 降到 9.3s。
  - 索引不变量本身未变：`owners(X)` 仍等于「沿被索引的边（数据属性值 / Map 键值 / Set 成员）能走到 X 的顶层键」，访问器一律不求值，解析不出归属时仍按「标记全部顶层键」多报不漏报。增量依赖的前提是「改变可达性的写入要么走代理陷阱、要么推进状态版本」——拿到内部引用后的裸写本来就不在追踪契约内，旧实现靠每次重建偶然捞回它，增量实现不再兜这种写（兜底方向仍是多报）。`benchmark` 的吞吐基线本轮未重标。
- `LRUCache` 删掉两个只写不读的死字段（每次命中少一次 `Date.now` 与两次属性写），访问计时改到命中之后，未命中不再丢弃高精度时钟调用；淘汰加 `evicting` 重入标志与有界预算（回调内回填不再递归到 `RangeError`）。
- 错误组的驱逐改为一次线性扫描取 `lastSeen` 最小值（此前每次 `addError` 达上限后都复制数组再排序）。
- `withThrottle` 的尾随助手提升到装饰阶段，每次调用少分配两个闭包；`SelectorFactory` 的 `execute` 与 `withCacheResult` 合并为单条 `resolve()` 路径；`$patch` 别名标脏时的目标集合一次性建好（不再每个顶层键重建 `Set`）。

### Docs

- `README.md` / `docs/API.md` / `docs/CONCEPTS.md` / `docs/GUIDE.md` / `docs/BEST_PRACTICES.md` / `docs/FAQ.md` 与本轮语义同步：`notify.clone` 与 `readOnly` 的载荷判定、`$snapshot()` 的「部分冻结」口径、快照 `onError` 的真值语义与失败结果 `data`、`HookSystem` 的按钩子签名、持久化后端契约与生产降级信号、`withLog` 的 `sink` / `redact`、`LRUCache.resize` 的实际归一化规则。
- `pnpm run skill:api` 重新生成 `.codebuddy/skills/geomstore/references/api/*`（机械映射，请勿手改）；`SKILL.md` 的 `withLog` / `createDecorator` 签名、`$snapshot` 冻结口径与持久化 `storage` 要求同步修正。
- Wave E 四项的文档同步：`docs/API.md` 补 `cancel*` / `flush*` / `dispose*` 六个入口与宿主卸载点用法、`docs/GUIDE.md` 与 `docs/BEST_PRACTICES.md` 把「页面 / 组件卸载点收尾」写成具体片段并列入反模式、`docs/FAQ.md` 新增「宿主卸载后挂起的防抖 / 节流怎么办」与默认后端相关问答；`docs/ARCHITECTURE.md` 的写入追踪段改述为三档增量口径、`plugins/` 目录清单含 `WxStorageBackend.ts`，并把「`src/types` 只放类型与接口」从描述升为硬约定（`CONTRIBUTING.md` 同步）；`docs/API.md` 与 `docs/FAQ.md` 的持久化默认后端表述（`''` 归一、Promise 守卫、三方法齐备判定）按新实现订正，并顺手删掉 `ActionLoaderOptions` 表里并不存在的 `autoError` 一行。
- 文档化的既有实现口径（本轮只写清、不改行为）：`$snapshot()` 冻结的是纯对象与数组链，经 Date/RegExp/Map/Set 触达的节点仍可变；`cloneDeep` 是**递归**实现（栈深＝数据深度，默认 `maxDepth: 100` 兜住，超深结构走异步路径）；`ActionLoaderOptions.sharedLoadingCounts` 仅构造期读取、`setOptions()` 忽略；`withTimeout` 的超时错误是普通 `Error` 且 `Timeout after <n>ms` 属稳定文案；`destroy()` 不注销 getter 定义（销毁后 `store.getters` 返回初始化时登记的那份）。

### Tooling（工程链）

- **CI**（`.github/workflows/ci.yml`）：新增 `Typecheck (tests)` 步骤（此前 `typecheck:tests` 从不进 CI，测试代码的类型错误永不被发现）；补 `concurrency`（非长期分支取消旧运行，main / master / develop 保留完整验证记录）与顶层 `permissions`（`contents: read` + `actions: write`，产物上传需要）；`verify` job 加 `timeout-minutes: 20`；产物冒烟改为从 `package.json` 的 `exports` 读出各子路径的实际 default 目标再 `import`（此前导的是 `tsc` 顺带产出、从不发布的路径，等于自证空转）。
- **构建脚本**：`postbuild-dist` 先校验 `dist` 存在且非空再写标记（并把 `dist/package.json` 由覆写改为解析后合并，解析失败退出 1）；`clean-dist` 加「目标不可信」守卫（`realpath` 与 `root/dist` 全等才允许删除）并把清理失败降为告警；`minify-dist` 探测顺序改为 terser 优先并写明理由，两后端统一 `ECMASCRIPT_TARGET=2020`、补 terser 的 `mangle.toplevel` / `format.comments:false` 与 esbuild 的 `format:'esm'` / `legalComments:'none'`（此前 `ecma` 被放进 mangle 选项集会 `DefaultsError`），删掉不支持 ESM 的 uglify-js 兜底分支，改为全部结果先备在内存再统一落盘，零文件与 `-NaN%` 提前短路并区分宽松 / `--strict` 失败等级；`.map` 清理收紧为 `.(js|d.ts).map`；`tryRequire` 只吞 `MODULE_NOT_FOUND`；subpath stubs 与 skill 参考生成脚本补 dist 目标存在性、`exports` 一致性与输出文件名冲突校验；`tools/fix-errors.sh` 加 `set -euo pipefail` 并按脚本位置定位仓库根。
- **配置清理**：基线 `tsconfig.json` 的 `lib` 去掉 DOM（src 无任何 DOM 标识符；测试里唯一依赖 DOM 的 `TimerHandler` 标注已改为 `Parameters<typeof setTimeout>[0]`，`tsconfig.jest.json` / `tsconfig.tests.json` 的临时回补项同时撤除）；`tsconfig.build.json` 收敛为「extends + 真实 override」，删掉与 postbuild 互斥的 `sourceMap` / `declarationMap`（此前产物留着指向已删除文件的死链），移除全仓零使用的 `@tests/*` 路径别名；`jest.config.js` 删掉无消费者的 `emitDecoratorMetadata`（与 `isolatedModules` 冲突）；`eslint.config.js` 删掉只有 `no-undef` 一类规则才消费、因而从不参与判定的两块 `globals` 与冗余 override；`.prettierrc.json` 删三个被 Prettier 3.8 明确忽略的键并把 `jsxBracketSameLine` 更名为 `bracketSameLine`；`.gitignore` 的 `.env*` 口径收敛为 `.env` + `.env.*` + `!.env.example`；`.npmignore` 头注释改为如实描述（`package.json` 的 `files` 才是发布清单，实测 213 文件；本文件只在 `files` 被删 / 放宽时兜底），并补 `.npmrc` / `.env*` / `coverage/` / IDE / `.ocr-fix/` 等兜底项。
- **benchmark**：吞吐阈值由耗时阈值推导（此前两组常量互不可满足）并留 0.5 安全系数，`datasetSize` 类型对齐联合，HTML 报告转义场景名与元数据，`runScenario` 的 `store.destroy()` 移入 `finally`，并发池按同步预约槽位写入结果（此前可超跑 `total` 次且顺序不定），`mergeCacheStats` 汇总 `evictions`，peer 依赖 `^0.4.0` → `^0.5.1`。
- 删除 `tests/jest.d.ts`（顶层 `JestMatchers` 从不被 `expect()` 引用，且内含误拼的 `toHaveBeenCalledNthWith`）；`createTestStore` 不再写回入参对象。

### 明确不修（避免后人重复踩）

- **脏标记的上报时机保留「调用前」**（`dirtyTracking`）：改成「先调用后上报」会把「多报」换成「漏报」——方法内改完状态再抛错时脏标记丢失，视图永久漏更新。现状是注释明示的「宁可多报」保守契约；同步方法调用后抛错会多标一次键，属预期。
- **`pnpm-workspace.yaml` 的 `allowBuilds` 不是拼写错误**：pnpm 12.3.4 实际识别并回写该键（见 `node_modules/.modules.yaml`）与 `nodeLinker: hoisted`（Windows junction / 重解析点的安全策略权衡已在该文件注释中记录）。按报告改回 `onlyBuiltDependencies` 会让白名单失效、`pnpm -r exec` 的行为反而需要重建布局复验。
- **`no-extra-semi` 仍是 ESLint 9 的内置规则**：报告称「v9 已移除」不成立（该规则 v8.53 弃用、v10 才移除），`eslint --print-config` 输出 `[2]`、`pnpm lint` 退出 0。**第五轮已消掉它依赖的历史分歧**：`tests/**` 的两条豁免（`no-unused-vars`、`no-empty`）被取消、`lint:ci` 收到 `--max-warnings 0`，而行首 `;(` 这类「prettier 要加、no-extra-semi 要删」的写法已统一改写为不以 `(` 开头的等价形式（引入局部常量承接断言），两个工具不再互相顶回（见下方第五轮 Tooling）。
- **Wave E 未收口的四项（另立议题）**：
  - `withRetry` 的退避等待没有取消口——`retryWithBackoff` 的 `delay * 2^(n-1)` 定时器一旦排程，宿主卸载后在途重试仍会跑到次数用尽。本轮只给防抖 / 节流开了入口：重试的挂起态在 Promise 链里、且「取消后原调用返回什么」要先定义（`undefined` 还是 rejection），不是照抄 `cancel` 就行。`withCache` 同样没有 `dispose` 口（缓存表随装饰器实例存活），与本源同一议题。
  - `isTrackableHost`（「宿主是否可作为状态键」）在 `debounce.ts` 与 `throttle.ts` 各写一份、`cache.ts` 是同型内联判断，三处未合并：合并要新起内部模块并让 `cache` 依赖它，收益只是整洁度，不动行为。
  - `src/integrations/enterprise/env.ts` 的 storage 工具仍自己写一份缺失键判定（`value === '' || undefined || null → null`，此外还把非字符串载荷原样返回），**未接** `WxStorageBackend.ts` 的 `normalizeWxStoredValue`。两处语义不同源，接齐会让 `enterprise` 子入口依赖 `plugins`；本轮只把 wx 后端路径收口。
  - #386 `ErrorContext.timestamp` 双写（`createErrorContext` 生成、`ErrorAggregator` 又以 `context.timestamp || Date.now()` 兜一层，且 `||` 会把合法的 `0` 当缺省）保留现状：彻底收口要把时钟做成可注入项（新公开配置），不在本轮范围。
- **CI 第三方 action 尚未钉 SHA**：`pnpm/action-setup@v4` 仍按可变 tag 引用，需在有外网的机器上核验 `refs/tags/v4` 指向后换成 commit SHA（`packageManager` 字段已用 sha512 锁住 pnpm 本体）。

### 第五轮复审（`ocrreview.md`，376 条 = critical 2 / high 12 / medium 167 / low 195）

与上面第四轮 + Wave E 的条目同属 0.6.0、独立成块：本轮审查对象就是那些改动之后的代码。逐条判定与证据在 `.ocr-fix/verdicts5/*.md`（19 个分片，其中 core-store-p1 因两度中断拆成 A/B 两份，另有主会话的 `hot-p0.md`），跨分片交接与裁决集中在 `.ocr-fix/verdicts5/main-followups.md`。计数：**376 条全部逐条判定 —— FIXED 366 / 判误报 7 / 明确不修 3（R5-296、R5-317、R5-346）**。判误报与不修都带命令级证据；分片台账原先记作「交主会话」的 5 条已按最终去向改判（R5-175 / R5-355 落地为 FIXED，R5-317 / R5-346 改判 REJECT 并在各自台账写明改判理由，R5-365 于发布后补做完成），`.ocr-fix/decisions5.md` 由脚本按改判后的台账重算。下面只列用户可感知的语义变化。

#### Breaking（对外契约与类型面）

- **`SnapshotResult<T>.data` 由 `T` 改为 `T | undefined`**（R5-238）：三条失败来源（中止 / 顶层异常 / 根节点被丢弃）交付的就是 `undefined`，旧声明靠 `undefined as T` 圆场。**用前必须先判 `success`**——异步超时交付的是半成品，所以没做成「`success: false` 时必空」的判别联合。
- **删除公开类型 `SnapshotErrorContext.recoverable`**（R5-239）：两处咨询点都能降级，该标记恒真、无分流价值；回调要按错误种类分流请读 `SnapshotError.type`。读取该字段的 `onError` 回调会编译失败。
- **`result.errors` 现在包含 `circular` 条目**（R5-254）：此前循环引用只进 `stats` / `metadata`，三处账目「两有一无」。`success` 仍为 `true`（只有 `cloneError` 参与 success 判定）。
- **同步快照的深度上限变为 `min(maxDepth, 1000)`**（R5-257）：`maxDepth: NaN` 不再等于取消一切上限；超出部分按 `maxDepth` 降级记账，此前表现为一次 `RangeError` 伪装成某属性的 `cloneError` 且整次 `success: false`。
- **未配置 `syncUrl` 时 `syncWithServer()` 不再发请求**（R5-273）：内置业务端点 `DEFAULT_SYNC_URL = '/api/user/sync'` 整条删除，改为 reject 并记日志——配置缺失不再伪装成网络错误。
- **`StoreManager.clearAll()` 现在会删除持久化的当前身份键**（R5-268）：依赖「clearAll 后冷启动仍恢复旧身份」的宿主需显式写回。
- **`onBeforeUpdate` 抛错或备份写入失败时仍执行 `applyUpdate()`**（R5-270）：此前整段更新被跳过；备份失败的损失范围收敛为「本次更新无状态恢复」。
- **`WxStorageBackend` 在 `wx` 或对应 `*StorageSync` 缺失时抛错**（R5-279）：不再用 `?.` 短路成「写入 / 删除成功」与「键无数据」——后者会让随后一次落盘覆盖真实数据。环境整体不具备可用 wx 时应走 `persistencePlugin` 的降级分支。
- **`ErrorRecovery` 达到 `maxRetries` 后在同一故障周期内持续拦截**（R5-201）：此前会清掉计数与周期键，于是调用方在同一失败循环里每轮都能领到全新额度，上限保护只对触发超限的那一次生效。
- **`ErrorRecovery` 策略内部失败改抛 `GeomStoreError`**（R5-203，`code: INTERNAL_ERROR`，带 `cause` / `context`）；以 `Object.prototype` 成员名作错误码时不再命中原型链成员（R5-204）；未归因的重试键由 `CODE:unknown:unknown` 变为 `CODE:unattributed`（R5-205）。
- **`@withErrorBoundary` 的回退值不再被 await**（R5-206）：带 `then` 的回退值此前会把 `Promise<fallback>` 原样返回给调用方。
- **同一轮通知里两个可写订阅者的载荷不再是同一引用**（R5-122）：`cloneOnNotify=true` 档每轮深拷贝次数变为「可写注册数（+1，若有只读注册）」，代价换回监听器之间的隔离；`false` 档零变化。
- **达到 `maxSubscribers` 时触发驱逐会向 `onError` 钩子发一次事件**（HANDOVER-1，生产从完全静默变为可观测）；重复注册同样受上限约束（挤掉自己最早的一笔，`throw` 策略下抛错），`size` 变为硬上界（R5-123）。
- **`StoreCacheManager.clearOldState` 从类面上移除**（R5-113）：可达性核实为仅内部件。
- **`withLog` 生产构建的默认摘要里 `Error` 只留 `name`**（R5-178）：依赖摘要含 message 的调用方需显式 `summarizeInProduction: false` 并自带 `redact`。新增可选字段 `summarizeInProduction`（R5-177）——此前「自带宽松 redact」会在生产构建里绕过脱敏策略。
- **`createSelector` 的缓存失效凭证改为显式选项 `snapshotState`**（R5-224）：默认 `true` = 写缓存时深拷贝状态内容。**只传 `equalityFn: (a, b) => a === b` 而不传 `snapshotState: false` 的调用方，缓存会从「命中」变成「永不命中」**（不返回错值，但 memo 失效）；旧判据「`equalityFn` 是否恰好等于内置 `deepEqual`」在自定义深比较器（lodash `isEqual`、`(a,b)=>deepEqual(a,b)` 包装、ESM/CJS 双副本）下会把活引用当快照存，就地变异看不见、TTL 内持续返回陈旧值。
- **`cacheTTL` 现在有取值守卫**（R5-225）：`NaN` / `<= 0` / 非数值一律回落 5000（此前 `NaN` 使条目永不过期、`0` 静默关缓存却仍付克隆成本）；`Infinity` 明确允许（= 不按时间过期）。
- **`SelectorComposer.combine` 的入参类型改为 `SelectorComposerInput<S, T, R>`**（R5-232）：未显式给 `R` 时由 `combiner` 返回类型反推；显式给 `R` 而 combiner 返回别的东西现在编译失败。运行期行为不变。
- **`shouldRetry` 的入参在抛出值不是 Error 时改为规范化后的 `Error`**（R5-221）：与 `withRetry` 家族同口径；抛给调用方的 rejection 原因仍是原值。
- **`HookSystem.on()` 的退订句柄改为一次性**（R5-087）：此前重复调用会按当前 Map 内容再次删除，可能删掉之后重新注册的同一 handler。
- **在已销毁 Store 上调用 `usePlugin` 从「只 `console.error` + 静默空卸载」改为抛出原始异常**（R5-088）。
- **命名空间 + `strict` 的批量写入变为原子**（R5-080）：要么全校验通过后全部写入，要么一个都不写，不再留下「前一半已写入」的中间态。
- **组合层同名注册的告警与顶替行为收紧**（R5-072 / R5-073 / R5-107）：`destroy` 回调里的重入注册不再被静默顶掉（该实例被摘链并销毁）；一个实例被多个名字持有时 `unregister` 一并摘除全部名字且只销毁一次；同名**不同实例**的静默覆盖不再被抑制告警。
- **已销毁子 store 上抛出的非销毁类异常改为向调用方冒泡**（R5-082），不再被吞掉。
- **`PerformanceMonitor.record()` 不再持有入参引用**（R5-090）：此前同一入参对象的后续改动会改写已记录的历史指标。
- **`getRecentMetrics(limit)` 传负数或 `Infinity` 现在返回空数组**（R5-096）：此前分别是「返回其余条目」和「返回全部」。
- **`Store.isStateKeyDirty` 形参放宽为 `string | symbol`**（R5-135），并与 `Store` 接口、`composeStore` 三侧口径统一。
- **`stateProtection.productionHandler` 非法取值改为构造期抛 `TypeError`**（R5-115）：此前要等首次非法写入才表现为生产抛错；三个合法取值行为不变。
- **保护代理上非普通实例的方法多次读取返回同一函数引用**（R5-117）：此前每读一次就 `bind` 一个新函数；方法被整体替换后返回新实现的绑定。
- **`deepEqual` 的快速路径（SameValueZero）先于深度检查**（R5-143）：`deepEqual(x, x, n)` 与同一原始值在任意 `n` 下都为 `true`——此前恰好落在 `maxDepth` 那一层的同一引用被判不等，且该分支的 `return` 还会取消栈上其余兄弟分支的比较。
- **克隆语义两处对齐**：数组副本与源在**空洞与附加属性**上等价（R5-136，此前 `length` 相同但槽位性质不同、附加属性丢失）；状态里的**内建类型子类实例**（`class MyMap extends Map`）在快照/克隆后与活状态共享同一实例（R5-137，此前是丢方法的基类副本）；`shallow` 模式对非纯对象返回原引用、null 原型对象保留 null 原型（R5-166）。
- **`StoreConfig` 的 `S` 默认值由 `unknown` 改为 `Record<string, unknown>`**（R5-326）：裸写 `StoreConfig` 作形参类型时 `state` 不再接受无索引签名的 interface 值，换来 `cacheKeys` 在退化输入下可用（此前恒 `never[]`）。走 `createStore` 的调用不经过该默认值。新增导出别名 `ConfigState<S>`。
- **公开别名 `ComposedStore` 形状改变**（R5-312）：成员从 `{name,state,stores}` 扩为整个 `Store<S>` 面，类型实参新增 `extends State` 约束。
- **`ExtractPageData` 在键相交时的结果由 `never` 改为 getter 返回类型**（R5-328，共用它的 `PageThis` / `PageConfig` / `ComponentThis` / `ComponentConfig` / `AppThis.globalData` 同步）；`HostStoreApi` 新增必填成员 `__store__`、`subscribe` 多一个可选形参（R5-327）；`PageReservedKeys` 补 `onRouteDone`（R5-329）；`AppThis` 上 `globalData` 不再可调用（R5-330）。
- **`AsyncActions` 与 `SelectorOptions.equalityFn` 的形参由 `unknown` 放宽为 `any`**（R5-316 + 主会话交接）：`strictFunctionTypes` 下 `unknown` 形参会因逆变拒掉调用方按具体状态标注的写法（`(a: MyState, b: MyState) => boolean`）。放宽只在逆变的形参位，返回位仍受检查，两侧各有一条编译期锁。**同一处方本轮补到 `createMemoizedSelector` 的第二位置形参**（它此前独立写成 `unknown`，于是 options 位能写的比较器在这个位点仍报 `TS2345`）——两条入口的口径现在由 `tests/types/selector-equalityfn-variance.typecheck.ts` 一起锁；同时改掉它的示例：示例原先教「传 `(a, b) => a === b`」，而本工厂没有 `snapshotState` 出口，默认档下那是**永不命中**的缓存，现改为指向 `createSelector(fn, { cache: true, equalityFn, snapshotState: false })`。
- **`timeTravelAPI.importHistory` 对非法 JSON 由抛错改为静默跳过**（R5-297，与既有「结构非法即跳过」并轨）；`timeTravelPlugin({ maxSize })` 非法取值按默认 50 生效（R5-298）。
- **`analyzerPlugin` 卸载后的实例形状**：`getter` 由「可枚举自有绑定函数」恢复为原型方法（R5-320，只影响做 `Object.keys(store)` / 展开 / 身份比较的消费方）。被中止的 dispatch 因 `ActionManager` 显式点名 `'dispatch'` 来源而恢复弹栈，**该次中止会产出一条「到抛错为止」的短耗时指标**（R5-319 + HANDOVER-5）——看指标时要知道这条代表中止而非成功。
- **`deepEqual` 的内建类型分支改为「原型一致」优先，并补上装箱原始值一档**（`core-misc-p2` 登记的两处真缺陷，`ocrreview.md` 376 条之外，2026-09-23 单独修）：原先 Date/RegExp/Map/Set 的按内容分支直接 `continue`，跑在原型检查**之前**，于是空的 `class MyMap extends Map` 实例与空的 `new Map()` 判等（`Set`/`Date`/`RegExp` 同理，`MyMap` 带相同条目也照判等）；装箱原始值则因 `Object.keys` 恒为空而把 `new Number(1)` 与 `new Number(2)` 判等（`String`/`Boolean`/`BigInt`/`Symbol` 同样）。现在：① 原型检查提到所有内建分支之前，**子类实例与基类实例一律判不等**（同原型的一对不受影响，仍按内容比）；② 新增装箱原始值一档，先按 `Object.is(a.valueOf(), b.valueOf())` 比内部值，**比完不跳过**通用键比较，故带自有属性的装箱子类仍完整比较。`deepEqual` 是选择器缓存的默认比较器：此前那两类「假相等」会让 `equalityFn` 命中并**向调用方返回陈旧值**，方向上是最坏的一种，故按破坏性变更处理。回归锁在 `tests/unit/core/utils/equality-builtin-classes.test.ts`（20 例；对旧实现跑同一文件为 10 failed，全部是 expected-false-got-true 方向）。
- **打包脚本三处口径**：`prepack` 新增「同名真实目录不得覆写」前置校验，命中即以退出码 1 提前失败（R5-024，改前会覆写该目录的 `package.json` 后正常出包）；`postpack` 清理面从「mapping 里的 14 个名字」扩到「仓库根一级目录里形状匹配的本脚本产物」（R5-025）；`build:release` 在 terser 装坏时改为失败退出，不再退回幽灵依赖 esbuild 压一遍并发布（R5-031）；dist 里「只有注释」的 `.js` 压缩后内容变为空（R5-027，`dist 下全部 js 已压缩` 这条承诺不再靠跳过实现）。

#### Added（纯增量）

- `@openlide/geomstore/extras/action` 子入口新增导出 `TIMEOUT_ERROR_CODE` 与类型 `TimeoutError` / `RetryOptions` / `ActionErrorData` / `LogSink` / `LogPhase`（该入口导出符号 29 → 35，实测自 `dist/extras/action/index.d.ts`：值导出 18 个、类型 17 个，改名/删除为零，用 TS 编译器 API 前后比对锁过）。超时错误的**跨入口判据是 `code`，不再是消息文本**（两个入口的消息文案本就不同）。
- `@openlide/geomstore/extras/selector` 子入口新增值导出 `createRetrySelector` / `createRetrySelectorAsync`（此前要深链叶子模块；`SelectorComposer` 静态方法两条路径都保留）。
- `@openlide/geomstore/core/store` barrel 补类型再导出 `SubscriberEvictionInfo`；`stateVersion.ts` 新增导出 `STATE_VERSION`（仅子路径内可见，不进包 `exports` 映射）。
- `ErrorReport.summary` 新增 `droppedErrors`（R5-210 的交接）：上报队列溢出丢弃量此前只能靠 `getDroppedErrors()` 现取，拿到报告快照的下游（写日志 / 上传 / 看板）看到的是一份「总数对得上」的报表，丢包完全不可见。
- 几何多处新增可观测性：LRUCache 超容量残留告警（R5-086）、`[StoreRegistry]` 冲突告警文案扩充（R5-074 / R5-106）、`[withAppStore] globalData 已有成员将被覆盖` 告警（R5-287）、绑定阶段抛错时三类接入层告警并回滚订阅（R5-291）。
- 工程链：`ci.yml` 新增 `Typecheck (examples)`、把 lint/typecheck 抽成单腿 `verify-static`，并**新增 benchmark 子包的冒烟步骤**（此前该包只被编译、从不被执行）；`packages/benchmark` 新增 `src/smoke.ts` 与 `bench` 脚本（42 条断言）；`tools/fix-errors.sh` 改用 pnpm 并前置自查依赖与 pnpm 本体。

#### Changed（行为变更，非破坏）

- `composeStore` 构造期订阅失败现在会 `console.warn` 留痕（R5-102）：降级为「每次读取重新合并」此前完全静默，且该状态终身不可恢复。
- `withLog` 的 `sink` / `redact` 抛错与业务调用隔离（R5-176）：此前 sink 在 `before` 抛错会让 action 本体根本不执行、在 `after` 抛错会把一次成功的调用改判为失败。
- `withThrottle` 判定异步性改用共享的 `isThenable`（R5-193，连同 `withCache` 的 `instanceof Promise`）：手写 thenable 与跨 realm Promise 不再被漏判，被抑制调用的返回类型不再随调用顺序翻转。
- `createRetrySelector` 保留 falsy 抛出值（R5-220，critical）：`throw null` / `throw 0` / `throw ''` 此前会被真值判定丢弃，调用方拿到的是合成的 "failed without error"，既丢原始值也丢 `attempts` 标注。
- `PerformanceMonitor` 时钟基准降级时作废在途计时（R5-089，high）：不再产出 `Date.now() - wxNow` 这种 ~1.7e12 的脏 duration 污染 `getStats()` / `exportJSON()`。
- `ErrorAggregator` 对非 Error 抛出值改为保护式取值并「先建组再计数」（R5-192）：此前一条 `throw null` 会留下永不清理的孤儿计数，使 `sum(byStore)` 永久大于 `totalErrors`。
- `LRUCache` 的 `ttl` 非法值（`Infinity` / `NaN` / 负数）显式归一为 0（R5-111）：对外结果同为不过期，差别只在 dev 多一条告警。
- `HttpReporter` 对非 Error 的 `context.error` 不再抛 `TypeError`（R5-213）；含 BigInt / 循环引用的 `payload` 由「整批 reject 并被监控层无限重入队」改为「该条降级为字符串标记、批次照常发送」（R5-214）；自定义 `HttpReporterOptions` 时默认请求实现补上 `Content-Type: application/json`（R5-215）。
- `ConsoleReporter` 两处输出：falsy 的 `payload` 不再被静默丢弃（R5-198）、缺失 storeName 时输出 `in UNKNOWN:` 而非 `in undefined:`（R5-200）。
- `MonitoringConfig.maxQueueSize < 1` 按 1 生效、`maxFlushRetries < 0` 按 0 生效（R5-212）。
- `errorLog` 与聚合视图对外交副本（R5-187 / R5-211）：改用户 handler 收到的上下文不再回写内部记录，改 `getGroups()` / `generateReport()` 的结果不再污染账目。
- 返回 Promise 的 error handler，其 rejection 由「未处理拒绝（Node 下可终止进程）」变为一条 `[ErrorHandler] Error in error handler:` 日志（R5-188）。
- `App` 的非对象实参（`App(null)` / `App('x')`）原样透传给宿主，不再在包装器里抛 `TypeError` 让 `App` 启动失败（R5-247，high）；`autoUpdateOnShow` 现在对 `withAppStore` 生效（R5-285）；`bindActions` / `exposeStoreAPI` 遇到不可重写的宿主成员改为跳过并告警，不再中途抛错中断整批注入（R5-277）；本地键名为 `'__proto__'` 的映射不再被静默丢弃（R5-276）。
- `dist` 产物链：`clean-dist` 对 `dist` **内部**的符号链接 / junction 用 lstat + realpath 双判据分类，只删链接本身（R5-018，critical）；子路径 stub 的清理判据由子串匹配改为与生成值全等（R5-022，high，此前 `main` 含 `dist` 字样的真实目录会被递归删除）。
- 其余为注释 / JSDoc 与代码事实不符的批量纠正（本轮单独立项的「注释说假话」类修复约四十处）：包括 `composeStore.isStateKeyDirty` 的「始终返回 true」、`analyzerPlugin` 的「onError 一律不弹栈」、`SubscriptionManager.notify` 的拷贝归属、`src/extras/snapshot/index.ts` 的「迭代式深度克隆」等。

#### Tooling（工程与门禁）

- `tests/**` 不再整条关掉 `@typescript-eslint/no-unused-vars` 与 `no-empty`（R5-001），`lint:ci` 阈值由 `--max-warnings 70` 收到 `0`（R5-012）。代价是本轮清扫了豁免撤掉后立刻暴露的 62 处历史告警（4 error / 58 warning）：未用形参改 `^_` 前缀（保留 arity，因装饰器与内核按 `Function.length` 判行为）、死绑定删除或改为显式 `void`、3 处空 `catch` 改为收集 rejection 并断言（断言只增不减）。
- 解决 prettier 与 `no-extra-semi` 的顶牛：`printWidth: 160` 下 prettier 会在以 `(` 开头的语句前补 `;`，而 ESLint 9 判它多余，`eslint --fix` 与 `prettier --write` 互相回退。21 个文件共 98 处统一改写为不以 `(` 开头的等价形式（`const slot = target as Record<string, unknown>` 这类「用 `const` 绑定断言结果」，断言本身不放宽），**不加 `eslint-disable`、不关规则、不改 `printWidth`**。
- `jest.config.js` 删掉死掉的 `@tests/*` 别名单边映射（R5-003）；`tsconfig.typecheck.json` 不再整组重写 `exclude`（R5-010）；`@eslint/js` 补为显式 devDependency（R5-011）；`.npmignore` / `.prettierignore` / `.gitignore` 收口（审查素材与本地台账整目录忽略、判定台账白名单放开；`coverage-*.json` 锚定到根）。
- **`examples/` 不再是「本地试验目录」**：取消整目录忽略并把 9 个源文件纳管（R5-373）——CI 的 `typecheck:examples` 依赖 `examples/global.d.ts` 声明 `App` / `Page` / `Component`，干净检出必报 4 条 `TS2304`。
- `packages/benchmark` 定性为仓库内部工具（`private: true` 且无发布通道）：删除全部发布元数据与硬 `peerDependencies`、devDeps 与根包对齐（R5-006 / R5-008 / R5-009）；根 `package.json` 删除 npm 风格的 `workspaces`（pnpm 下是死配置，只会让 npm/yarn 与 pnpm 得出两套拓扑），并在 `pnpm-workspace.yaml` 注释里写清子包如何编译。阈值口径同步改为从配置推导（`DISPATCH_AVG 0.2→0.5`、`REPLACE_STATE_AVG 0.3→1.0`、`DISPATCH_MIN 2500→1000`）。
- **CI 的第三方 Action 全部钉到完整 commit SHA**（R5-365，发布后补做）：`actions/checkout@11d5960a…` (# v4.4.0)、`actions/setup-node@49933ea5…` (# v4.4.0)、`actions/upload-artifact@ea165f8d…` (# v4.6.2)、`pnpm/action-setup@b906affc…` (# v4.3.0)。取的是「当时 `v4` ref 实际解析到的 commit」，故**零行为变化**；四个值都用 `/repos/<r>/tags` 与 `/repos/<r>/commits/<sha>` 双向核对过（`pnpm/action-setup` 的 `v4` 是 annotated tag，需再剥一层）。升级姿势写在 `ci.yml` 头部注释。同处改掉一条已失真注释：`actions: write` 并非 upload-artifact 文档要求的前置权限（已核 v4.6.2 README），该收窄是「拿不准就按最小面授予」的处置。

#### 文档与 skill 同步

- `README.md`、`docs/{API,GUIDE,CONCEPTS,BEST_PRACTICES,FAQ,ARCHITECTURE,MIGRATION}.md`、`CONTRIBUTING.md`
  全部按本轮改完后的源码重写口径：本轮新增的选项（`SelectorOptions.snapshotState`、
  `withLog` 的 `summarizeInProduction`）、
  破坏性变更（`syncUrl` 默认端点删除、`WxStorageBackend` 抛错、`ExtractPageData` 撞名形状）、
  以及两处此前只在源码注释里的有意豁免（保护代理方法绑定不过陷阱、`cacheTTL` 有意放行 `Infinity`）。
- **改掉「覆盖率四项 100%」的假话**（`README` 两处、`BEST_PRACTICES` 一处、`ARCHITECTURE` 两处）：
  门禁一直是 `jest.config.js` 的 `coverageThreshold`（global 语句/分支/函数/行 98/95/98/98 +
  `core`/`snapshot`/`selector`/`action` 单文件分支 85），本轮实测 99.86 / 99.08 / 99.82 / 99.91。
  **调文档措辞，不调阈值、不删数字**；`[0.5.0]` 条目里的历史陈述不改写。
  同处 `ARCHITECTURE` 的「62+ 套件、2300+ 用例」按实测改为 144 套件 / 3408 用例。
- `examples/extras/snapshot.ts` 改为「先判 `success` 再取 `data`」：`SnapshotResult.data` 收成
  `T | undefined` 后该示例在 `typecheck:examples` 上报 TS18048——`examples/` 此前整目录被忽略，
  所以这条一直没人跑到。示例按新契约写，而不是加 `!` 断言把示例写成反面教材。
- `.codebuddy/skills/geomstore/references/api/*` 由 `pnpm run skill:api` 重新生成（11 个入口 / 373 个符号），
  `SKILL.md` 的订阅上限、持久化后端、选择器缓存三段契约同步。

#### 明确不修（第五轮新增，避免后人重复踩）

- **`StoreOptionsBase<S>.state` 不做「拒绝非对象工厂」收紧**（R5-346）：实现这条要往 `state` 里塞条件类型，
  会把 `S` 推进不可推断位置——同一接口上已有实测教训（R5-326 里报告建议的 `Array<keyof ConfigState<S>>`
  打断 `core/store/factory.ts` 的 `new Store(options)` 反向推断，TS2322 + TS2345，显式类型实参与
  `NoInfer` 都救不回）。收益只是多拦一种写法，代价换掉最常用入口的推断；`create-test-store-config.typecheck.ts`
  末尾已把探针证据与「收紧后该补哪条反例」写清，下一轮不必重新试探。
- **`deepEqual` 剩余一处债不在本轮范围**：跨 realm 的 `Map` / `Set` 判定仍走 `instanceof`，未与 `StateProxy` 导出的 `isMapLike` / `isSetLike`（`instanceof` ∪ `Object.prototype.toString` 标签并集）统一（R5-119 的另一半）——要做对得把标签判据下沉到 `core/utils` 供两处共用，反向 import 会形成 utils → store 的分层倒置。**`shallowEqual({}, Object.create(null)) === true` 而 `deepEqual` 判不等**同样维持：`shallowEqual` 是主入口公开导出（`src/core/index.ts`），统一原型口径是一次独立的行为变更，且它在 `src/` 内零调用方。
- **`sharedLoadingCounts` 不搬进内部通道**：它已是 `docs/API.md` 列出的公开选项、6 处测试按公开方式使用，搬到二次构造参数等于制造真破坏性变更。改为删掉说谎的 `@internal` 标签、把「只在构造期读一次 / `setOptions()` 忽略它的原因 / 不变量归注入方」写成消费者能读的契约，并在 `ActionLoader` 构造器补一次 `instanceof Map` 准入判定。
- **`deepEqual` 与 `StateProxy` 的跨 realm 判定统一**（`core-store-p1-B` R5-119 的另一半）：要真做对得把标签判据下沉到 `core/utils` 供两处共用（反向 import 会形成 utils → store 的分层倒置），且与上一条是同一段代码，两笔一起改才自洽。
- **`combine` 的 `S` 仍无推断来源**：`R` 已透传（R5-232），但 `S` 未标注时落到约束 `object`——A/B 实测同一个调用形状在改前后同样报错，不是本轮引入的回归。

## [0.5.1] - 2026-09-17

### Fixed（第三轮复审）

- **类实例与类型化数组的变异恢复可追踪**：上一轮为修 `#private` 方法把非普通对象整体改为原样返回，导致其内部写入既不报脏键也不计数（默认模式视图陈旧、`onlyOnChange` 完全不通知）。改为保留写陷阱，并在读取时把实例方法绑定到原始接收者；实例属性写入与类型化数组元素写入正常标记，方法调用保守标记所属键。
- **保护代理的方法绑定**：`store.state.<实例>.method()` 与类型化数组的 `[...buf]`/`slice()` 此前会因 `this` 是代理而抛错（`Cannot read private member` / `this is not a typed array`）。
- **时间旅行手动 `record()` 不再被吞**：回放吞并判断此前对所有记录路径生效，`undo()` 后的首次手动 `record()` 会静默无效（异步模式下还会让回放再次截断 redo）。判断现在只作用于订阅通知路径。
- **`readOnly` 按注册而非按监听器条目判定**：同一函数先只读后只写注册时，可写注册会被当成只读，通知跳过深拷贝并把受保护的活动状态交给可写回调（写入抛错；关闭保护时会静默改活状态）。
- **`deepEqual` 对等价循环/别名图不再单向误判**：配对表由 A→B 单值映射改为「对象对」集合，同一对象与不同伙伴的比较不再互相挤掉，比较终止且对称（此前单向耗尽深度上限返回 false，并被 Set 匹配继承）。
- **`destroy()` 期间的插件清理重入**：清理函数调用其他插件句柄时，实时数组下标迭代会因 `splice` 移位重复执行同一清理并打乱顺序；改为先快照并逐个消费映射再调用。
- **`$patch` 就地改写别名对象时标记所有受影响键**：只映射别名（而非补丁键）的视图此前永远看不到更新。
- **已 `dispose()` 的离线管理器不再覆写共享队列键**：在途同步收尾会抹掉同键新实例刚入队的操作（登录切换模板下可达，重启后丢失）；dispose 后同步停止且不再落盘。
- **离线队列的损坏条目不再永久卡死同步**：队列中混入 `null` 等畸形条目会让每次 `syncQueue()` 抛 `TypeError` 并饿死后续操作；现在按元素校验并丢弃，其余操作继续同步。
- **持久化恢复不再回写磁盘**：`notify.async` 下安装后的延迟通知会覆写同一 tick 内其他写入的新数据，且每次启动都重写；恢复自身的通知现被吸收，真实变更照常落盘。
- **防抖选择器不再被一次 `null` 状态永久毒化**：共享槽位未清理会让后续调用永远复用同一个已拒绝的 Promise；现在该次调用拒绝后立即恢复。
- **`usePlugin()` 与 `store.use()` 语义对齐**：此前绕过宿主登记，`destroy()` 不执行清理、两者混用会双重安装、插件全局入口（如 time travel）在销毁后残留。
- **`ActionHistory.setMaxHistory` 立即裁剪已有桶**：缩容后桶长此前被 push/shift 抵消钉死在旧上限；`NaN` 会让上限完全失效（无界增长），现回退文档下限 1 并向下取整。
- **重试内核非有限/负数 `retries` 归一为 0**：此前整段循环不执行，函数一次都没跑却抛出「Retry failed without error」这种与真实原因无关的错误。
- **类型层**：`persistencePlugin<UserState>(…)` 与 `ComposedStore.use` 的插件参数类型此前被抹成 `Plugin<State>`，无法赋给 `store.use`（参数为 `Plugin<自身状态类型>`）；现保留状态类型参数并统一签名。
- **文档**：`createParametricSelector` 的 `ttl: 0` 语义统一为「立即过期（等同禁用缓存）」（此前三处文档写作永不过期，与实现和测试相悖）；`ActionHistory.getHistory` 的返回顺序说明与实现对齐。

### Fixed（第二轮，998af4e）

- **Action 脏追踪按归属索引复用**：此前每次写入都按顶层键遍历可达对象图，列表逐项更新呈平方级增长（2000 项约 7s，10000 项约 3 分钟）。现改为按需构建一次归属索引，仅结构变更（新增/删除键、写入对象值、长度变化）与外部版本推进时失效重建，标量写入为 O(1) 查表。
- **Action 状态代理保留非普通实例的原始接收者**：类实例（含 `#private` 字段、getter 依赖内部槽位）不再被代理包装，`this.state.instance.method()` 不再抛 "Cannot read private member"；其内部变异与 Date 等同属「不追踪」契约，需通过 `setState`/`$patch` 替换值。
- **退订句柄按注册标识精确退订**：被驱逐的旧句柄不再误删同一回调的重新注册（此前旧句柄会把新注册一并移除，导致新订阅静默失效）；组合 Store 的退订句柄同样幂等。
- **插件卸载句柄绑定安装代际**：旧句柄不再卸载同一插件的新一次安装；清理函数抛错时同一句柄重复调用不再二次执行。
- **异步通知中的重入写入保留脏键**：通知回调内的写入归下一轮通知，此前会被本轮收尾清空，集成层对稳定引用对象值判定「未变化」而永久漏更新。
- **`beforeDispatch` 钩子内的写入不再丢失通知**：`onlyOnChange` 的变更基线改在钩子之前采集，覆盖完整 dispatch 事务。
- **离线队列失败项不再重复落盘**：同步收尾先归并再落盘，修复「内存 1 条、磁盘 2 条」导致重启后重复执行的问题。
- **死信落盘失败不再丢数据**：`storage.set` 返回 false 时操作保留在队列中等待重试，而非被静默丢弃。
- **持久化在通知未送达即销毁时补写最后一次变更**：`notify.async` 下 `setState` 后立即销毁的场景此前既不通知也不落盘；现于卸载时直接读取当前状态落盘（与上次写入比较，无变化不重复写）。
- **时间旅行在 `notify.async` 下不再丢 redo 历史**：回放触发的延迟通知按状态版本号识别并跳过记录，不再被当作新分支截断历史。
- **选择器混合输入不再返回陈旧值**：缓存条目为版本化（活动引用）而输入是无版本普通对象时一律 miss，避免 `deepEqual` 命中已变异的旧结果。
- **异步重试选择器真正重试**：`createRetrySelectorAsync` 对 Promise rejection 生效（此前 `return selector(state)` 使 catch 永不触发，重试与 `error.attempts` 均失效）。
- **循环 Set 比较与快照 diff**：Set 元素配对共享循环防护并在候选失败时回滚配对，自引用 Set 不再被判不等或误报差异。
- **缓存装饰器乱序完成保护**：同参新调用已替换占位或已写入新值时，旧请求的结果不再回写（此前慢请求会覆盖快请求的新值）。
- **节流尾随执行的同步异常就地兜住**：不再逃逸为 `uncaughtException`。
- **`LRUCache` 缩容/写入维持容量不变量**：`onEvict` 重入 `set()` 时循环淘汰至上限，不再永久超容量。
- **`ErrorRecovery` 重试额度按调用上下文隔离**：`recover(error, { storeName, operation })` 的第二参数参与重试键，不同 Store 不再互相挤占额度。
- **`ErrorMonitoring` 上报超时定时器回收**：上报先落地时取消未到期的定时器，不再每次 flush 残留句柄。
- **`ErrorAggregator.getStats().byStore` 按实际次数统计**：跨 Store 错误组不再把整组次数重复计入每个 Store，各项之和等于 `totalErrors`。
- **`PerformanceMonitor.setOptions({ maxSize })` 立即裁剪**：缩小容量后不再长期保留超限的历史记录。
- **嵌套组合的键路由**：非命名空间外层包含命名空间内层时，`setState`/`$patch` 支持 `'子store名/键'` 斜杠路径，并在构造期提示书写形式（此前 dispatch 可用而写入静默失效）。

### Fixed（第一轮，cb686d4 起）

- `createSelector` / `SelectorFactory` 的缓存同时校验状态身份与版本号，避免不同 Store 的相同版本串用结果。
- Store 在 action 完成刷新缓存时移除已删除状态键；`$replaceState` 清空整个键级缓存后回填，避免遗留孤立条目。
- `subscribe` 返回的退订句柄幂等，重复调用不会抵消同一监听器的其他注册。
- 组合 Store 在读取合并缓存前校验子 store 版本，修复批内与异步通知等待期间的陈旧读取；无版本号的子 store（含嵌套组合）保守失效。
- 组合 Store 汇总子 actions 注册表，支持嵌套非命名空间组合按裸名 dispatch 并保留参数、返回值。
- Page 的 `onUnload` 与 Component 的 `lifetimes.detached` 先执行用户钩子，再在 `finally` 清理绑定；同步钩子内仍可调用映射 actions，抛错也完成清理。异步钩子的 Promise 不会被等待。
- `withDebounce` / `withThrottle` / `withCache` 支持函数宿主（静态方法），且隔离同描述 Symbol 方法及其同名字符串方法的状态。
- 快照 diff 按对象对识别循环，避免等价循环被误报为变化；对象比较区分自有 `undefined` 属性的新增与删除。
- 时间旅行 `getSnapshots()` 克隆每条历史状态，防止返回值中的普通对象、数组及受支持内建类型被修改后污染历史。沿用核心克隆契约：类实例、函数、Promise、弱集合等仍共享引用，不承诺完全隔离。
- action 直接变异在默认与 `onlyOnChange` 模式下均累积顶层脏键，覆盖嵌套对象、数组、Map/Set、共享别名与批量/异步通知路径。

### Changed

- 同步 API、指南、架构说明与 GeomStore skill 的行为契约；补充脏键追踪开销、卸载同步边界及时间旅行克隆范围。版本号仍为 0.5.0，上述内容尚未发布。

## [0.5.0] - 2026-09-10

### Added

- **`withThrottle` 新增 `assumeAsync` 选项**：对「非 `async` 语法但返回 Promise」的方法（包装函数、手写 thenable），首次调用被抑制（`leading: false`）时也返回 Promise，避免调用方 `await` 拿到 `undefined` 而与后续调用返回类型不一致。
- **`MonitoringConfig` 新增 `maxQueueSize` / `maxFlushRetries`**：错误队列容量与「全部报告器连续失败」的重入队上限开放为可配置项（默认 1000 / 3，行为不变）。
- **`Plugin` / `PluginHook` 泛型化**（`Plugin<S extends State = State>`）：插件作者在 `install(store)` 中可拿到精确的 `Store<S, …>`（`filter: (state) => …` 等回调随之获得类型），`usePlugin(plugin, store)` 与 `store.use(plugin)` 传具体 Store **不再需要断言**。省略类型参数即得「适用于任意 Store」的插件（`Plugin<State>`），既有写法不受影响；唯一新增的编译错误是「插件与 Store 状态类型不匹配」这种本就错误的组合。
- **`exports` 新增 `./integrations`**：`parseMapping` / `bindMappings` / `bindActions` / `performAutoInject` / `exposeStoreAPI` / `cleanupBindings` 等底层小程序绑定工具此前仅转发子目录可达，现在 `@openlide/geomstore/integrations` 在 ESM 解析器下同样可用。
- 覆盖率四项（语句 / 分支 / 函数 / 行）达到 **100%**；不可达的防御分支统一以 `/* istanbul ignore … */` 标注并**写明原因**。

### Changed

- **文档全面重写**：README 与 `docs/`（GUIDE / API / ARCHITECTURE / CONCEPTS / BEST_PRACTICES / FAQ / MIGRATION）及 CONTRIBUTING 以源码为唯一依据重写；`examples/` 同步重写并新增 `extras/` 分类（覆盖已下沉的可选能力与新增选项），全部示例纳入 `pnpm typecheck:examples` 校验。
- **快照 / 选择器 / Action 增强的实现**由 `src/core/**` 移至 `src/extras/**`（此前仅入口在 `extras`）。通过公开子路径 `extras/*` 引入的代码不受影响；深链内部源码路径需同步调整（见 MIGRATION.md）。`cache` / `hooks` / `performance` 的实现保留在 `core`（被核心直接依赖），仅入口在 `extras/*`。
- 测试按领域重组至 `tests/unit/{core,extras,store,integrations,plugins}/**`，不再使用按批次命名的文件。
- `ErrorRecovery` 逐出循环去掉单轮淘汰上限：键数远超上限时一次调用即收敛（此前需多轮调用，且每轮重做一次 O(n) 过期扫描）。
- 语义等价改写以消除不可达分支：`equalityFn` 在构造期归一化后恒为函数、`HttpReporter` 请求体由私有方法唯一产出、快照描述符标志两条路径统一归一化。
- `ErrorMonitoring` 的 `batchInterval` / `batchThreshold` / `reportTimeout` 由 `||` 改为 `??`：显式传入的 `0` 不再被静默替换为默认值。
- `SnapshotManager` 声明的默认 `batchSize` 与异步路径的实际回落值统一为 100（此前声明 1000 但永不生效）。

### Fixed

- 修复同步/异步快照对 `customCloner` 抛错语义不一致：同步路径此前会直接中断整次克隆，现与异步路径一致（落账 `cloneError` → 咨询 `onError` → 继续则丢弃该节点 / 中止则抛 `SnapshotAbortError`）。
- 修复 `usePlugin` 之外的自定义克隆器抛错路径缺少错误记账的问题（`stats` / `errors` 不再漏记）。
- **修复 `withComponentStore` / `withAppStore` 未注入方法 `this` 类型的问题**：此前这两处必须手写 `this` 标注才能访问注入的 action 与 `globalData`。现在 `withComponentStore` 把 `ThisType<ComponentThis<…>>` 挂到 `methods` / `lifetimes` / `pageLifetimes` **各命名空间本身**（`ThisType` 只作用于它所标注的那个对象字面量，挂在配置顶层不会下传），`withAppStore` 与 `withPageStore` 同款注入 `ThisType<AppThis<…>>`。
- `ComponentThis` 将注入成员展平到顶层（微信会把 `methods` 条目提升到组件实例，故 `this.add` 与 `this.methods.add` 均可用），新增 `WithComponentThis` / `AppThis` / `HostStoreApi` 类型。
- **最低 TypeScript 版本为 5.4**：`Store.use` / `usePlugin` 的公开签名使用 `NoInfer`（用于阻止逆变位置污染 `S` 的推断）。备选方案「独立类型参数 `P extends Plugin<S>`」已实测否决——宽插件 `Plugin<State>` 会因 `Store` 自身含 `use` 成员而在约束校验时递归比较失败。低于 5.4 的消费者在未开启 `skipLibCheck` 时会遇到 `Cannot find name 'NoInfer'`（TS2304）。
- `createStructuredSelector` 的结果记录类型 `R` 由 `Record<string, unknown>` 放宽为 `object`，使未声明索引签名的 interface 也能作为结果形状（此前只放宽了状态类型 `S`，漏了 `R`）。
- `ComponentOptions.pageLifetimes` 与 `lifetimes` 口径对齐：补 `resize`（微信官方支持，参数为 `{ size: { windowWidth, windowHeight } }`）并**移除** `[key: string]: unknown` 索引签名，使拼错的生命周期名在编译期报错。此项属**类型收紧**：若曾在 `pageLifetimes` 里传过自定义键，需删除。
- `ComponentOptions.lifetimes` 补齐微信官方的 `created` / `ready` / `moved` / `error`（此前只有 `attached` / `detached` 且无索引签名，导致这些合法生命周期触发多余属性报错）；仍不放开索引签名，生命周期名拼错会在编译期报错。
- **拆分「方法 this 类型」与「返回配置形状」**：新增 `PageConfig` / `ComponentConfig` 描述装饰器返回的配置对象；`PageThis` / `ComponentThis` 改为**只用于注入方法内的 `this`**。此前两个装饰器的返回类型直接复用了展平的 this 类型，于是声明出配置对象上并不存在的成员（例如 `withComponentStore(…)({ … }).add` 能通过编译，运行时却是 `undefined`）。
- `AppOptions.onLaunch` 与 `ComponentOptions.lifetimes` / `pageLifetimes` 不再声明 `this`：这些声明会**覆盖**集成层注入的 `this`（表现为 `globalData` / `data` 退回可选、注入方法被索引签名吞成 `unknown`），且与「运行时传入增强后的实例」不符。
- **修复「未声明索引签名的业务 interface」无法作为状态类型用于 `composeStore` 与选择器族的问题**：`StoreLike.state`、`Selector<S>` / `ParametricSelector<S>` / `SelectorComposerInput<S>` 及选择器各创建函数的约束此前写作 `Record<string, unknown>`，而 interface 没有隐式索引签名，会被拒之门外，与 `State = object` 的既定口径（见 types/store.ts 的说明）不一致。现统一放宽为 `State`，**默认值仍为 `Record<string, unknown>`**，既有写法行为不变。

- **模块体系全面切换为 ESM**：根 `package.json` 新增 `"type": "module"`，构建产物由 CJS 改为纯 ESM（`dist/` 内额外写入 `{"type":"module"}` 标记）。
- 构建配置 `tsconfig.cjs.json` 更名为 `tsconfig.build.json`，`module` / `moduleResolution` 统一为 `NodeNext` / `nodenext`；移除未被引用的 `tsconfig.node.json`（原 `module: commonjs`）。
- 源码、测试、示例与 `packages/benchmark` 的相对导入 / 导出补齐 `.js` 扩展名，目录索引显式写成 `./xxx/index.js`（ESM 不做目录索引回退）。
- 脚本与配置全部 ESM 化：`scripts/*.cjs` → `scripts/*.mjs`（改用 `import.meta.url`），`jest.config.cjs` → ESM 的 `jest.config.js`，`eslint.config.js` 改为 `export default`；`tests/setup.js` 改为 `tests/setup.ts`。
- Jest 新增 `moduleNameMapper` 规则，把 ESM 写法中的 `.js` 后缀映射回无后缀后再交给 ts-jest 解析；需要新模块实例的测试改用 `jest.resetModules()` / `jest.isolateModulesAsync()` + `await import()`。
- ESLint 规则 `@typescript-eslint/no-require-imports` 由 `off` 改为 `error`，禁止在源码与测试中出现 CommonJS 写法。
- CI 产物冒烟由 CJS `require` 改为 ESM `import`（并修正 `dist/cjs/**` 这一已失效路径与 `GeomStoreError` 主入口断言）。

### Breaking

- 产物格式由 CJS 变为 ESM：`require('@openlide/geomstore')` 需改成 `import { createStore } from '@openlide/geomstore'`（复制安装同理，入口仍为 `dist/index.js`）。ESM 不做目录索引回退，引用内部路径时请写全 `dist/xxx/index.js`。

### Removed

- 移除 `require()` / `module.exports` / `tsconfig` 中的 `commonjs` 配置，以及文档示例里的全部 CommonJS 写法（改为 `import` / `export`）。
- 移除 `packages/benchmark` 的 ESM 双产物字段 `"module"`，并修正 `types` 指向 `dist/index.d.ts`。

## [0.4.0] - 2026-09-06

### Added

- 新增 `tests/utils/createTestStore` 测试辅助工厂：为未显式命名的测试 Store 补充确定性唯一名称，使测试更稳定可复现。

### Changed

- **性能**：`createSelector` 缓存比较由每次 `execute` 的全树 `deepEqual` 改为状态版本号 O(1) 整数比较，复杂选择器（如 2000 键状态树）性能由 ~8s 降至亚毫秒级。
- **性能**：组合 Store 子 Store 订阅在无非只读订阅者时采用零拷贝，避免通知路径上的整树深拷贝。
- **性能**：`ComposedStore.isStateKeyDirty` 在命名空间模式下精确追踪脏子 Store（此前恒返回 `true`），恢复 `withPageStore`/`withComponentStore`/`withAppStore` 集成层对未变化映射键的 `setData` 跳过优化。
- LRUCache 转发层收口：移除 `core/performance/Optimizations` 对缓存类的非必要重导出，LRUCache 出口收敛为 `cache/index`（定义）→ `core/index`（主入口）与 `core/performance/index`（子路径聚合），`createLRUCache` 保持单一定义。

### Fixed

- 修复 `ErrorRecovery` 在动态 operation id 场景（如 `fetchUser:${id}`）下 `retryWindowStart` / `retryCount` 无界增长的问题：新增容量守卫（`MAX_RETRY_KEYS = 1000`），超过阈值时清理过期窗口并淘汰最旧键，避免长期运行内存泄漏。

### Breaking（行为变更，需同步调整调用方）

- **错误子系统从核心入口下沉至 `extras/error`**：`@openlide/geomstore` 主入口不再导出错误类（`GeomStoreError`、`createError`、`ErrorCode`、`isGeomStoreError` 及子类、`ErrorRecovery`、`ErrorMonitoring`、`ErrorBoundary`、`ErrorHandler` 等）。请改为从子路径引入：
  ```ts
  import { createError, ErrorCode, ErrorRecovery } from '@openlide/geomstore/extras/error'
  ```
- **代码库瘦核心（thin-core）收口**：移除 `TypeValidator` 模块、`core/index` 中已废弃的零碎 barrel 与工厂函数等死代码。

### Removed

- 合并双份 `ErrorRecovery` 单元测试（保留更全的 1478 行 / 83 用例版本，删除旧 544 行副本）。

## [0.3.0] - 2026-09-06

### Added

- 瘦核心（thin-core）拆分：插件 / 选择器 / 快照 / 性能监控 / 异步动作增强 / 企业微信集成等可选能力迁移至 `src/extras`，并通过 `@openlide/geomstore/extras/*` 子路径按需引入（如 `extras/snapshot`、`extras/selector`、`extras/performance`、`extras/action`、`extras/enterprise`、`extras/plugins`）；核心入口仅保留 `createStore` 与小程序集成等核心 API，减小主包体积。

### Changed

- 构建产物目录扁平化：CJS 产物由 `dist/cjs/**` 改为 `dist/**`，`main`、`types` 与 `exports` 全部同步（入口现为 `dist/index.js`）。**Breaking（复制安装）**：直接引用 `dist/cjs/...` 路径的项目请改为 `dist/...`；NPM 安装方式不受影响。
- 子路径转发 stub（`store/`、`hooks/`、`plugins/`、`integrations/` 等 14 个）不再由 `postbuild` 写入仓库根目录：改由 `prepack` 在打包/发布前生成、`postpack` 清理，并新增 `pnpm stubs` / `pnpm stubs:clean` 手动入口；`.gitignore` 中对应的 11 条忽略规则随之移除。

### Breaking（行为变更，需同步调整调用方）

- **移除微信旧式顶层 `attached`/`detached` 兼容**：`withComponentStore` / `withPageStore` 现在仅识别 `lifetimes` 写法（基础库 3.15.0+ 要求），旧式写在组件配置顶层的 `attached`/`detached` 不再被调用。请迁移到 `lifetimes: { attached, detached }`。
- **`SubscriptionManager` API 重命名（内部类）**：`subscribe` → `add`、`unsubscribe` → `delete`；`size` 由方法改为 getter；移除 `has`。通过 `store.subscribe` 的公共 API 不受影响。
- **`persistencePlugin` 直接作为插件安装时不再透传第二参数**：`install(store, options)` 的 `options` 被忽略；传入自定义 `storage` / `key` / `filter` / `validate` 等请使用工厂形式 `persistencePlugin(options)`。
- **热更新备份新增 `version` 字段**：`backupState` 写入库版本常量；`restoreFromHotUpdate` 在备份版本与库版本不一致时仅告警、仍按合并语义（`$patch`）恢复（不再硬门禁白丢用户数据）。
- **零拷贝通知语义收紧**：`notify.clone=false` 且状态保护关闭时，仅当**无可读写订阅者**（如只读订阅）才返回原始状态引用；存在可读写订阅者时出于安全仍克隆，避免外部篡改内部状态。
- **`withCache` 命中日志从 `console.log` 改为 `console.debug`**（格式 `[Cache] Hit for <method>`）；移除 `createRetrySelector` 数字参数、`clone` 的 `deep`/`safe` 旧选项的「已废弃」告警（功能仍按旧签名兼容）。
- **组合 Store 订阅复用单路合并订阅**：组合层 N 个监听器只占用每个子 Store 一份订阅（此前每监听器各占一份），外部直连子 Store 的订阅不再因组合层订阅被静默驱逐。

## [0.2.1] - 2026-08-28

### Added

- 主入口新增值导出 `WxStorageBackend`（内置微信同步存储后端）与 `ComposedStore`；类型导出 `ErrorFallback`、`CacheStats`、`ThrottleDecoratorOptions`。

### Fixed（全量代码审查第三轮修复 + 第四轮回归修复）

**数据 / 视图一致性**

- `deepMerge`（`$patch` 底层）仅对纯对象递归合并：源值为 Date/RegExp/Map/Set/数组/类实例等非纯对象时整体替换为深拷贝——此前 Date/RegExp 的自有可枚举键恒为空，补丁值会被静默丢弃。
- `createSelector` 默认比较器从 `shallowEqual` 改为 `deepEqual`（显式传入 falsy 值视同未提供）；缓存比较基于写入时的状态**快照**而非活动引用——Store 状态为就地变异，此前缓存自比较会在 `$patch` 后误命中并返回陈旧值。
- `bindMappings`：对象值不做引用脏检查、始终纳入 `setData` 更新（`$patch` 原地深合并后引用不变，引用比较无法感知内部变化）；`undefined` 字段被过滤出 `setData` 更新与初始值（微信 `setData` 不接受 `undefined`，清除字段请使用 `null`）。
- `shallowEqual` / `deepEqual` 仅比较自有属性（`hasOwnProperty`），不再沿原型链取值导致假相等。

**错误子系统**

- `HttpReporter.report` / `reportBatch` 失败向上抛出（此前 `console.error` 吞错，导致「全部 reporter 失败则重入队重试」机制成为死代码）；直接调用方需自行 `catch`，内部批量管线已有兜底。
- 默认请求实现校验 `response.ok`：4xx/5xx 抛出 `HTTP <status>`，服务端拒绝不再被当作上报成功。
- 批量 flush 对每个 reporter 做 `ok / fail / timeout` 三态判定：仅任务真正 resolve 才算成功；超时（`reportTimeout`）告警后批次重入队重试——此前超时被当作成功，弱网/服务端黑洞（最需要重试的场景）下批次被直接丢弃。
- `ErrorBoundary` 的 `fallback` 计算函数自身抛错时：记录后**重抛原始错误**（此前 fallback 的异常会顶替原错误逃逸，丢失现场）。
- `ErrorRecovery` RETRY 重试额度按**故障周期**计量，周期以时间窗判定（窗口 = `max(60s, 本周期全部退避总时长 × 2)`）：窗口内额度持续累计、与错误实例身份无关——修复第三轮「新错误实例即重置额度」修复引入的回归（文档化的「每次失败 `createError` 新实例再 `recover`」用法下 `maxRetries` 防重试风暴保护完全失效）；超过窗口视为新周期重置额度。达到上限仅清除当前键（`code:storeName:operation`）的计数与周期窗，不再按错误码级联全清（同码其他 store/operation 的进行中额度不受影响）。

**类型层**

- `ActionExecutor` / `ActionUtils` 泛型约束从 `AsyncActions` 放宽为 `Actions`（同步 / 异步 action 均可，`AsyncActions` 仅作默认值）；全部方法返回 `Promise<Awaited<ReturnType<A[K]>>>`，消除异步 action 的 `Promise<Promise<T>>` 类型谎言。
- `ExtractStates` / `ExtractActions` / `ExtractGetters` 基例从 `Record<string, never>` 改为 `Record<never, never>`：不再向交叉类型注入 `[x: string]: never` 索引签名污染组合 Store 的属性类型。
- `ExtractMappedState` / `ExtractMappedGetters` / `ExtractMappedActions` 重构（never 守卫前置 + `Arr[number]` 收窄），修复映射配置下的类型推断失败。
- `withPageStore` 入参类型改为同态映射 `WithPageThis<C, PageThis<...>> & { data: object } & ThisType<...>`：为 `C` 提供推断位点，自定义方法在返回值上保留精确类型（此前退化为 `unknown` 导致编译报错）。

## [0.2.0] - 2026-08-22

### Fixed（全量代码审查第二轮修复，约 25 项）

**Store 核心**

- dispatch 进行中（action 体内调用 `store.batch`）时批收尾不再提前通知：中间态不外泄，由 dispatch 收尾统一补发一次；`batch(fn)` 传入异步回调时开发模式显式告警批保护边界（await 之后的变更逐条通知）。
- 异步 action 以 reject 结束时先补发 `onError` 钩子再进入失败收尾（拒绝值保持原始错误不包装），监控/上报插件对异步失败不再失明。
- `use()` 安装抛错时回滚入列，半安装插件不再残留（捕获后重试 use 不累积重复条目）。
- SubscriptionManager 改引用计数：同一监听器注册 N 次被通知 N 次，每次退订只抵消一份、归零才真正移除；重复订阅不计入上限、不触发驱逐。
- StateProxy 数组子值统一经 `_wrapArrayChild` 缓存代理返回：索引 / symbol 键 / 自定义属性上的对象值不再有绕过写保护的裸引用。

**快照**

- `compareSnapshots` 数组 vs 数组改逐元素比较：新增元素产出 `path[added:i]`（kind `'added'`）、删除产出 `path[removed:i]`（kind `'removed'`），数组与非数组比较报告整体 changed。
- 克隆保留源对象原型：类实例快照后仍可调用原型方法；克隆失败节点记入 `errors` 并丢弃子树，绝不把活引用兜底进快照；同步路径克隆错误计入 success 判定（存在 cloneError 即 `success: false`），onError 的「中止」决定深层直传不被降级。

**错误系统**

- `defaultErrorHandler` 补齐 critical / warn 级别映射（此前落入 info 分支只打 console.info 且无堆栈）。
- ErrorMonitoring：全部 reporter 失败的报文按序重入队等待下次 flush 重试（超容量从队尾淘汰）；shutdown 排空阶段不再重排队，避免对已退出上报端无限等待导致 shutdown 永不返回。

**性能 / 工具**

- debounce 定时器先复位再执行、throttle 尾随补发捕获同步抛错并记录，定时器回调异常不再成为 uncaught exception。
- StateFingerprint 数字哈希改 IEEE754 位模式混合：时间戳量级的增量（~1.7e12 +4181）不再塌缩为相同指纹。
- `shallowEqual` 对 Date/RegExp/Map/Set 按内容比较（内建对象自有键恒为空，此前 `new Date(1)` 与 `new Date(2)` 被误判相等——该函数是 createSelector 默认比较器，误判会向用户返回陈旧值）。
- `deepMerge` 增加循环引用防护（WeakMap 配对跟踪）：自引用 / 互引用结构不再栈溢出。

**选择器**

- createRetrySelector / createRetrySelectorAsync 抛出的错误带不可枚举 `attempts` 属性，记录真实执行次数（shouldRetry 提前拒绝时不再是上限值）；throttled selector 取值成功后才推进节流窗口，首次抛错不再吞掉窗口内的重试。

**插件**

- timeTravelPlugin 卸载增加身份守卫：只清理仍属于本实例的 `__timeTravel__` 与全局注册项，同 store 后装的实例不受影响。

**组合**

- composeStore 桥接子 Store 全部生命周期钩子到 `composed.hooks`（此前组合层钩子监听器收不到任何回调）；通知去重简化避免双发相同状态；getters 合并改 own-property 判定；子 store 插件安装失败整体回滚；销毁守卫补齐 enableCache/invalidateCache/getCacheStats/$snapshot/$restore。

**缓存**

- LRUCache 容量 NaN/Infinity 回退默认值（构造与 resize 同守卫）；`getOrSet` 未命中计入 misses 统计；`forEach` 遍历先取后继再回调（回调内删除当前项安全）；avgAccessTime / missRate 口径修正；withCache Symbol 参数表设上限防无界增长；缓存清理条目时同步移除 TTL 时间戳。

**企业版（微信小程序）**

- storage 工具层收敛为尽力而为语义：`set` 返回 boolean（配额满等异常仅记日志）、`remove` 吞异常。
- 热更新契约收紧：备份改至用户确认时执行；备份写入失败则不写待更新标记并跳过 applyUpdate（避免重启后凭空执行一次无源恢复）；onUpdateFailed 清理标记与备份。
- OfflineManager 同步期间落盘完整联合队列视图（同步窗口进程被杀不再丢失未处理操作）；网络恢复自动同步与 App.onShow 启动同步补齐 promise 异常兜底（记日志而非 unhandled rejection）。

## [0.1.3] - 2026-08-22

### Breaking Changes（0.x 阶段行为契约变更）

- **StorageBackend 收窄为纯同步接口**：`getItem/setItem/removeItem` 不再接受 Promise 返回值；传入异步后端时恢复/保存路径会显式报错（此前被静默当作数据处理，恢复失败无感知）。异步持久化请在外部自行订阅 store 实现。
- **ErrorFallback 泛型参数反转**：`ErrorFallback<S>` → `ErrorFallback<F, S>`（回退值类型前置，与状态类型解耦），直接引用该类型的下游代码需同步调整。

- **withErrorBoundary / ErrorBoundary 默认 fail-loud**：未配置 `fallback` 时错误默认重抛，不再吞错返回 `undefined`；提供 `fallback` 即视为声明恢复意图（显式 `recoverable` 配置仍优先）。吞错路径的 warn 现输出完整错误对象（含堆栈）。
- **ErrorBoundary 泛型诚实化**：`ErrorBoundary<S, F = undefined>`，fallback 类型 `F` 与状态类型解耦；`execute<T>` 返回 `T | F` 与实际配置一致（此前 fallback 被强转为 `T`）。
- **withThrottle / throttle 补 trailing**：默认 `{ leading: true, trailing: true }`（与 lodash 对齐）——窗口内被抑制的调用在窗口结束时以**最新参数**补发（fire-and-forget）；`trailing: false` 可回到纯 leading 旧行为。`throttle`（core/performance）此前 trailing 用的是首次被抑制调用的参数，已修正为最新参数。
- **clone 选项重构**：`{ deep, safe }` 选项改为 `{ mode: 'deep' | 'shallow' | 'safe' | 'json' }`（默认 deep）。`safe` 语义重定义为"尽力深拷贝且绝不抛错"（Date/Map/Set 正确克隆，仅克隆器真正失败时降级返回原引用并告警）；旧 safe 的 JSON 序列化语义（有损）移至显式命名的 `json` 模式；旧 `deep: false` 对应 `mode: 'shallow'`。
- **compareSnapshots 集合语义**：Set 比较不再按插入顺序配对（无序结构匹配，差异以 `kind: 'added' | 'removed'` 报告）；Map 键在引用匹配失败后进行结构匹配（结构等价键视为同一键，仅比较值）。`SnapshotDiff.changes` 条目新增可选 `kind` 字段。
- **createRetrySelector 选项化**：第二参数由 `maxRetries: number` 改为 `{ retries?, shouldRetry? }`；负数在创建期抛 `TypeError`；失败抛出的错误带不可枚举 `attempts` 属性（总尝试次数）。新增 `createRetrySelectorAsync`（支持 `delay` 退避与 `shouldRetry`）。

### Fixed（全量代码审查修复，约 50 项）

**Store 核心**

- 异步 action 完成时统一补发通知：此前 `await` 之后的变更（直接变异或 setState）不通知或重复通知；失败路径（同步抛错 / Promise 拒绝）同样补发已发生变更的通知；嵌套 dispatch 仅最外层通知；dispatch 与 batch 交叉时由 batch 收尾统一通知。
- `dispatch`/`getter` 存在性检查改 own-property 判定：`dispatch('toString')` 等原型链属性名正确报 ACTION_NOT_FOUND，而非误导性 TypeError。
- 状态保护补齐 `Object.defineProperty` 绕过漏洞（深层/浅层/数组/脏跟踪四类代理）；变异报错消息对 BigInt / 循环引用值安全（不再抛序列化 TypeError）。
- 订阅管理：已达上限时重复订阅不再驱逐无辜的最旧监听器；onlyOnChange 模式下无变更的 batch 结束不再空通知。
- 缓存：`enableCache([])` 静默全禁、`clearOldState` 的 `_timestamps` 泄漏等修复。

**composeStore**

- `composed.state` 只读化：顶层冻结、嵌套经子 store 保护代理（此前嵌套写入会静默穿透子 store 内部状态）。
- `subscribe` 单路复用：N 个组合层监听器只占每个子 store 一份订阅额度（此前成倍挤占、静默驱逐外部直连订阅者）。
- 非命名空间模式 state 键冲突开发模式告警（每组合一次）；路由与 action 查找改 own-property；销毁守卫补齐（getCached/startBatch/endBatch/batch）；batch 内销毁不再掩盖返回值/异常。

**SnapshotManager**

- `maxDepth` 超限返回占位符而非活引用（快照隔离不再被穿透）；异步快照对不可写属性永久挂起修复；访问器属性（getter）以求值结果克隆；异步 Map/Set 克隆保序；`metadata.size` 真实估算；diff 的 Set 无序匹配与 Map 键结构匹配（`changes` 条目新增可选 `kind: 'added' | 'removed'`）。

**错误系统**

- `flushReports`：reporter 同步抛错不再使 `isFlushing` 永久卡死（监控系统瘫痪）；小程序分支校验 HTTP statusCode；`shutdown` 等待在途 flush；`defaultMonitoring` 惰性代理的属性写入不再静默丢弃；ErrorBoundary 错误历史上限 100；事后 `setFallbackState` 正确切换恢复模式。

**装饰器 / ActionLoader**

- 同一装饰器实例复用于多个方法时状态按方法隔离（withCache 此前会静默返回错误数据）；withCache 并发同参调用 in-flight 去重、Symbol 参数唯一键；withDebounce/withThrottle 状态分桶；withLoading 引用计数按 (宿主, loading 键) 集中（多装饰器并发不再提前翻转 loading）；increment 失败回滚计数。

**性能**

- 状态指纹 DAG 记忆化（共享结构不再指数耗时 / 误判循环引用）；±Infinity 指纹区分；metrics 大数组栈溢出修复；`record` 不再变异调用方对象；超时计时条目惰性清理。

**企业版（微信小程序）**

- StoreManager 真正 LRU（命中刷新顺序）且不再淘汰当前登录用户的 store；`syncQueue` 异常路径完整回填队列（此前会话内丢操作、冷启动重复执行）；离线队列未知 action 走重试→死信路径（不再被当作成功静默丢弃）；在线失败保留原始错误 cause；热更新：确认更新写入重启标记（拒绝更新后的普通重启不再回滚状态）、监听幂等安装不随 login 累积、首次登录也注册保护、备份异常隔离；前台检查按 handler 异常隔离（单个 store 失败不再中断 App.onShow）。

**插件 / 工具**

- 持久化插件：卸载时同步落盘防抖窗口内最后一次变更；timeTravel `importHistory` 对 null JSON 防御；analyzer 卸载清理实例引用、onError 精确丢弃配对栈；`helpers.set` 中间路径为原始值时不再静默替换；TypeValidator 回边类型层校验、嵌套 schema 约束执行、DAG 记忆化、自引用 schema 深度守卫；`throttle`（工具函数版）trailing 使用最新参数。

## [0.1.2] - 2026-08-20

### Changed

- 文档全面审阅与更新：全部文档示例代码与 API 引用与源码对齐（GUIDE / API / BEST_PRACTICES / TECHNICAL_DOCUMENTATION / CONCEPTS / ARCHITECTURE / FAQ / MIGRATION / README / CONTRIBUTING），并修正若干无效示例（命名空间组合 Store 的 mapState 路径、autoUpdateOnShow 依赖 autoInject、ErrorRecovery 配置键与 ErrorCode 枚举、Store 变量命名不统一等）。
- 文档导入方式统一：示例代码一律使用 NPM 包路径（`@openlide/geomstore` 及 `/integrations`、`/plugins` 子路径），废弃复制安装的目录形式 require（微信 require 不支持目录解析）；GUIDE / BEST_PRACTICES 补充复制安装时的路径替换说明。
- CONTRIBUTING 同步构建现状：CJS 单产物（移除 ESM 双产物表述）、14 个子路径导出（原 15）。
- 文档与示例统一使用 `state` 工厂函数形式（`state: () => ({ ... })`）：README / GUIDE / API / BEST_PRACTICES / CONCEPTS / ARCHITECTURE / FAQ / MIGRATION / TECHNICAL_DOCUMENTATION / PRODUCTION_READINESS_REPORT 及全部 examples 已同步。工厂函数形式在创建 Store 时执行一次并深拷贝，避免数组 / Set 等引用类型被多个实例共享。
- composeStore 类型签名改进：移除多余的非泛型重载，避免多重重载下 TS 推断吸收 `[...Stores]` 元素类型、导致 `ExtractStates` 退化为 `Record<string, never>`；实现签名改用 `StoreLike[]`。
- 示例修正：compose-stores.ts 改用数组形式 `composeStore([...], { namespace: true })`（对齐 composeStore 实际 API，废弃 `{ stores: { ... } }` 对象形式）；plugins.ts 修正 loggerPlugin 直接安装、persistencePlugin 的 filter 用法与 usePlugin 双参调用。
- 文档版本标记统一为 v0.1.2（API / BEST_PRACTICES / MIGRATION / PRODUCTION_READINESS_REPORT / TECHNICAL_DOCUMENTATION）。

## [0.1.1] - 2026-08-19

第二轮全量源码审阅修复（16 项），全量测试 40 套件 / 2040 用例通过，typecheck 0 错误。

### Fixed

- **persistencePlugin**：启动恢复改用 `$patch` 合并语义，未持久化的键（如被 `filter` 过滤的键）保留初始值，不再被覆盖丢失；未显式传入 `storage` 且检测不到 `wx` 同步存储时降级为进程内内存存储并输出开发告警，不再抛错。
- **analyzerPlugin**：dispatch / setState / getter 执行抛错时在 `onError` 结束并清理未完成的计时配对，避免监控器内部残留悬挂条目；卸载时若 `store.getter` 已被后续插件重新包装则跳过恢复并告警，不再破坏其他插件的包装链。
- **withErrorBoundary**：错误边界改按宿主对象以 `WeakMap` 隔离，多个实例共享同一方法时不再互相污染恢复策略。
- **createSelector（SelectorFactory）**：缓存命中范围扩展到 LRU `cacheHistory`，交替状态序列不再退化为重复计算。
- **withComponentStore**：`methods` 上的 `attached` / `detached` 运行时注入改为实例级拷贝，多实例挂载不再互相覆盖/残留。
- **withCache / withThrottle**：异步方法判定改为函数原型比较（辅以运行时观测兜底），构建压缩（混淆 `constructor.name`）后依然可靠；异步缓存命中直接返回缓存的 `Promise`，节流跳过的异步调用返回 `Promise<undefined>`。
- **ActionLoader / withLoading**：装饰器的 loader 实例按宿主对象懒创建隔离，多实例并发调用不再共享 loading 引用计数导致永久卡 `true`；`setError` 单次构建 `errorData` 保证引用一致；`setOptions` 中途切换 `autoLoading` 时重置计数，避免残留计数永久占用 loading。
- **ErrorRecovery.clearRetryCount**：改为错误码精确匹配，不再误清同前缀的其他错误码计数（如 `AUTH` 不再影响 `AUTH_FAILED`）。
- **composeStore.$replaceState**：非命名空间模式整体替换缺键时，开发模式下输出 `console.warn` 提示将丢失的键（替换语义保留，如需保留请用 `$patch`）。
- **initBackgroundSync（企业微信集成）**：改为包装全局 `App` 构造器注入 `onShow` / `onHide`，修复修改 `App.prototype` 在微信框架中不生效的问题；检测到 `App` 被替换时自动重新包装并重置注册表。
- **Store.$snapshot**：快照改为递归深冻结（嵌套纯对象/数组含数组元素），彻底不可变；原 state 可变性不受影响。

### Changed

- 修复微信小程序 `wx` 全局标识符无类型声明导致的 TS2304 编译错误：`wechat-enterprise.ts` 增加模块级 wx API 类型声明（不污染全局类型空间，不与下游 miniprogram 类型包冲突）；`PerformanceMonitor` / `WxStorageBackend` 改经 `globalThis` 读取 wx。`tsc --noEmit` 全量 0 错误。
- StateProxy 非法变更拒绝路径统一为抛错（清理不可达的死代码分支），开发模式行为不变。
- `isProduction` 模块级缓存、`helpers.deepEqual` 超深返回 `false`、`clone` safe 返回原引用等既有语义补充注释文档化。

## [0.1.0] - 2026-08-17

### Added

- 初始版本发布
- 核心 Store 创建与管理（createStore）
- Actions / Getters / State 完整类型推断
- 微信小程序集成（withPageStore / withComponentStore / withAppStore）
- PageThis / ComponentThis 原生精确推导（装饰器自动重写 this 类型）
- 插件系统（Plugin）与钩子系统（Hooks）
- 选择器（Selector）与组合 Store（composeStore）
- 快照管理（Snapshot）与缓存（LRU Cache）
- Action 装饰器（@cache / @debounce / @log / @throttle / @retry / @timeout）
- 错误边界与错误恢复机制
- 性能监控（Performance Monitor）
- 开发工具插件（Time Travel）
- CJS 构建产物（CJS-only），14 个子路径导出（含微信「构建 npm」兼容的转发 stub），sideEffects: false
- TypeScript strict mode，完整类型推断
- 40 个测试套件 / 2000+ 测试用例

[0.1.0]: https://github.com/openlide/GeomStore/releases/tag/v0.1.0
[0.1.1]: https://github.com/openlide/GeomStore/releases/tag/v0.1.1
[0.1.2]: https://github.com/openlide/GeomStore/releases/tag/v0.1.2
[0.2.0]: https://github.com/openlide/GeomStore/releases/tag/v0.2.0
[Unreleased]: https://github.com/openlide/GeomStore/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/openlide/GeomStore/releases/tag/v0.6.0
[0.5.1]: https://github.com/openlide/GeomStore/releases/tag/v0.5.1
[0.5.0]: https://github.com/openlide/GeomStore/releases/tag/v0.5.0
