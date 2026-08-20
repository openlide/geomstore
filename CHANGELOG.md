# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- 文档全面审阅与更新：全部文档示例代码与 API 引用与源码对齐（GUIDE / API / BEST_PRACTICES / TECHNICAL_DOCUMENTATION / CONCEPTS / ARCHITECTURE / FAQ / MIGRATION / README），并修正若干无效示例（命名空间组合 Store 的 mapState 路径、autoUpdateOnShow 依赖 autoInject、ErrorRecovery 配置键、ErrorCode 枚举等）。

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
[Unreleased]: https://github.com/openlide/GeomStore/compare/v0.1.1...HEAD
