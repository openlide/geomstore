# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

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
- **快照 / 选择器 / Action 增强的**实现**由 `src/core/**` 移至 `src/extras/**`**（此前仅入口在 `extras`）。通过公开子路径 `extras/*` 引入的代码不受影响；深链内部源码路径需同步调整（见 MIGRATION.md）。`cache` / `hooks` / `performance` 的实现保留在 `core`（被核心直接依赖），仅入口在 `extras/*`。
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
[Unreleased]: https://github.com/openlide/GeomStore/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/openlide/GeomStore/releases/tag/v0.5.0
