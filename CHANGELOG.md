# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
[Unreleased]: https://github.com/openlide/GeomStore/compare/v0.2.0...HEAD
