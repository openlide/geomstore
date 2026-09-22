# 架构设计

## 1. 设计目标与约束

| 目标 | 约束下的做法 |
| --- | --- |
| **小程序优先**：主包体积是第一约束 | 核心只保留运行必需 API（约 49 行的 `extras/index.ts` 之外，可选能力全部走 `extras/*` 子路径按需引入） |
| **视图层开销可控** | 脏追踪（`isStateKeyDirty`）让集成层跳过未变化的 `setData`；通知可合并（`notify.async`） |
| **行为可观测** | 统一的错误账本（`errors` + `onError` 降级）、性能指标采集、快照隔离 |
| **类型完备** | 公共契约集中在 `src/types`，实现层引用契约；`PageThis` / `ComponentThis` 等集成类型保证 `this` 精确 |
| **纯 ESM** | 源码/测试/脚本一律 `import`，构建产物为 ESM 并写入 module-type 标记 |

## 2. 分层与依赖方向

```
             ┌────────────────────────────────────────────┐
 入口层      │ src/index.ts → core/index.ts                │
             │ extras/*（snapshot|selector|action|…）       │
             └───────────────┬────────────────────────────┘
                             │ 只能向下依赖
             ┌───────────────▼────────────────────────────┐
 能力层      │ core/store   core/cache   core/compose      │
             │ core/hooks   core/performance  core/utils   │
             └───────────────┬────────────────────────────┘
                             │
             ┌───────────────▼────────────────────────────┐
 集成/插件层 │ integrations/*（withPageStore / enterprise） │
             │ plugins/*（builtin / devtools / performance）│
             └───────────────┬────────────────────────────┘
                             │
             ┌───────────────▼────────────────────────────┐
 契约层      │ types/*（store|action|selector|error|…）     │
             └────────────────────────────────────────────┘
```

**强制规则**：

- `core` **不得**反向依赖 `extras` / `plugins`（钩子与插件运行时的契约放在 `core/hooks` + `types/plugin.ts`，plugin 实现只依赖契约）
- `extras` 可以依赖 `core`；`extras/*` 之间尽量不互相依赖
- 契约统一放 `src/types`，实现层不重复定义公共类型

## 3. 目录结构与职责

```
src/
  index.ts                      11 行：re-export core（主入口 = 核心）
  core/
    index.ts                    核心 API 汇总（Store/工厂/工具/钩子/集成/组合/LRU）
    store/       13 文件        Store 门面与运行时职责拆分
    cache/        3 文件        LRUCache（容量淘汰 + TTL + 统计）
    compose/      5 文件        composeStore / StoreRegistry / 合并与辅助
    hooks/        2 文件        HookSystem 与 usePlugin
    performance/  4 文件        PerformanceMonitor / AsyncBatchNotifier / metrics
    utils/        3 文件        helpers（深合并/相等/克隆/ID）与 equality
    errors/       1 文件        核心层错误基础设施
  extras/
    index.ts                   49 行：可选能力聚合入口（体积最大，仅调试用）
    snapshot.ts / selector.ts / action.ts / performance.ts / plugins.ts / enterprise.ts
                                ← 逐能力的公开子路径入口
    snapshot/     6 文件        同步 + 异步克隆引擎、diff、管理器
    selector/     5 文件        SelectorFactory / 组合器 / 重试
    action/       7 文件        ActionLoader / withLoading / ActionUtils / ActionExecutor
      decorators/ 8 文件        withLog|Debounce|Throttle|Cache|Retry|Timeout + common
    error/        7 文件        ErrorBoundary / ErrorRecovery / ErrorMonitoring / 类族
      reporters/  2 文件        ConsoleReporter / HttpReporter
  integrations/   4 文件        withPageStore / withComponentStore / withAppStore / utils
    enterprise/   8 文件        账号态、离线队列、后台同步、热更新
  plugins/        3 文件        builtin（logger/persistence/devtools）/ globalRegistry
    devtools/     2 文件        timeTravelPlugin
    performance/  2 文件        analyzerPlugin
  types/         10 文件        公共契约（store/action/selector/error/…）
```

## 4. 核心模块

### 4.1 `core/store`：门面 + 运行时职责拆分

`Store` 是**门面**，把运行时关注点拆给专职对象（都通过构造期装配，运行期无动态创建）：

| 文件 | 职责 |
| --- | --- |
| `Store.ts` | 公开 API 门面：状态读写、快照/恢复、缓存开关、订阅、批量、插件安装、销毁守卫 |
| `factory.ts` | `createStore`：选项归一化（默认值、状态工厂求值、缓存配置） |
| `StateProxy.ts` | 状态保护：深/浅/数组代理拦截非法写入；Action 可写脏跟踪由 `dirtyTracking.ts` 单独实现 |
| `dirtyTracking.ts` | 默认与 `onlyOnChange` 模式共用的 Action 可写代理；跟踪变更计数与所有受影响的顶层脏键 |
| `ActionManager.ts` | dispatch 生命周期：深度计数、action 上下文、仅最外层通知、异步结算补发、`onError` 钩子 |
| `SubscriptionManager.ts` | 订阅注册/退订/上限策略（引用计数；重复订阅计次） |
| `BatchManager.ts` | 批开始/结束与嵌套；批内变更基线 |
| `StoreCache.ts` | 缓存开关、按键失效与统计（`enableCache` / `invalidateCache` / `getCacheStats`） |
| `stateVersion.ts` | 状态版本号：为选择器与缓存提供 O(1) 变更判定 |
| `pluginSupport.ts` | 插件安装与回滚、钩子接线 |
| `types.ts` / `utils.ts` / `index.ts` | 局部类型、内部工具与出口 |

**写入追踪**：`setState` / `$patch` / `$replaceState` 推进版本并更新缓存；Action 可写代理对对象 / 数组 / Map / Set 的变异递增计数并标记顶层脏键，dispatch 收尾及异步结算时刷新键缓存（包含已删除键），整体替换则清空缓存后按新状态回填。代理按对象复用：归属关系按需求构建一次索引，标量写入 O(1) 查表；仅在结构变更（增删键、写入对象值、长度变化）或状态版本被外部推进时失效重建，因此覆盖未读取的别名、循环与重新挂接，逐项更新列表不再退化为平方级遍历。归属查找与构建都不求值访问器。类实例与类型化数组同样经代理包装：属性/元素写入正常标记，读取时方法绑定到原始接收者（`#private` 字段与内部槽位可用），实例方法调用保守标记所属键。Date/RegExp/WeakMap/WeakSet 仍保留原引用、内部变异不跟踪，应显式替换值。

### 4.2 `core/cache`：LRUCache

容量淘汰 + TTL + 统计（`hits` / `misses` / `avgAccessTime` / `missRate`）。构造与 `resize` 对 NaN/Infinity 回退默认值；`forEach` 先取后继再回调，遍历中删除当前项安全。Store 的键级缓存建立在其上。

### 4.3 `core/compose`：组合 Store

- `composeStore(stores, { namespace, strict })`：命名空间模式下子 store 按 `name` 嵌套，dispatch 支持 `'store/action'`
- 组合层 N 个监听器只占用每个子 store **一份**订阅（避免成倍挤占外部直连订阅的额度）
- 子 Store 以**只读**订阅注册，通知因此免深拷贝；组合层自己仅在存在可写监听器时对合并结果深拷贝一次（与 `Store._notifyListeners` 的 `hasWritableListeners()` 判据同口径）；`isStateKeyDirty` 在命名空间模式下精确追踪脏子 store，通知回调内的重入写入归下一轮
- `getState()` / `state` 读取合并缓存前校验子 Store 版本，批内及异步通知前也能读到最新值；无版本号的子 Store（含嵌套组合）每次读取保守失效
- 合并子 Store 的 `actions` 注册表，嵌套组合支持外层裸名 dispatch；非命名空间模式同名 action 取第一个 Store
- `StoreRegistry` / `globalRegistry` 提供按名字管理

### 4.4 `core/hooks`：钩子与插件运行时

`HookSystem` 提供 `on` / `emit` / `size` / `listenerCount`；`usePlugin` 是独立于 Store 方法的安装入口。契约来自 `types/plugin.ts`，因此插件实现（`plugins/*`）与核心之间是**依赖契约而非依赖实现**。

### 4.5 `core/performance`

`PerformanceMonitor`（`record` 时会顺手清理超时未结束的计时条目）、`MetricsCollector`、`AsyncBatchNotifier`。**实现保留在 core**（被 store 与插件共用），对外入口在 `extras/performance`。

## 5. 可选能力层（extras）

### 实现位置与入口的关系

可选能力的**实现**位于 `extras/*`，**入口**是同目录的 barrel（`extras/xxx.ts`）。这样安排有两点收益：

1. 依赖方向诚实：核心不「物理包含」只有少数用户需要的能力，`core` 的引用图即可证明主包不含它们
2. 深链内部路径的行为可预测：`src/extras/snapshot/...` 与公开入口同目录，不会出现「入口在 extras、实现在 core」的错位

**例外**：`cache` / `hooks` / `performance` 的实现保留在 `core`（`core/store` 直接依赖 `LRUCache`、`HookSystem`、`AsyncBatchNotifier`），仅入口在 `extras/*`。

### 体积模型

```
主入口（core）            常驻：Store / 集成 / 组合 / LRU / 工具 / 钩子
extras/snapshot           需要快照时引入
extras/selector           需要选择器缓存时引入
extras/action             需要 ActionLoader / 装饰器时引入
extras/performance        需要指标采集时引入
extras/plugins            需要内置插件实现时引入
extras/error              需要错误边界 / 恢复 / 上报时引入
extras/enterprise         需要账号态 / 离线 / 热更新时引入
extras（聚合）            仅调试或全都要用；会把以上全部拉入产物
```

## 6. 集成层（integrations）

`with-store.ts` / `with-app-store.ts` 共用 `resolveMappings`（解析 `mapState` / `mapGetters` / `mapActions` / `inject` 的数组与对象两种写法），差异只在生命周期接线：

| 集成 | 订阅建立 | 订阅清理 |
| --- | --- | --- |
| `withPageStore` | `onLoad` | `onUnload` |
| `withComponentStore` | `lifetimes.attached` | `lifetimes.detached` |
| `withAppStore` | 包装全局 `App` 构造器 | 不做清理（生命周期贯穿运行期，仅防重复绑定） |

Page 的 `onUnload` / Component 的 `lifetimes.detached` 先调用用户钩子，再在 `finally` 中清理绑定，即使钩子同步抛错也会清理；用户钩子的同步段仍可使用映射 actions。包装器不等待异步钩子的 Promise，`await` 后不能依赖绑定仍存在。

**只识别 `lifetimes` 写法**（基础库 3.15.0+）；组件 methods 上的运行时注入改为实例级拷贝，多实例挂载不互相覆盖。

`enterprise/` 提供账号态 Store、离线队列、后台同步与热更新；`initBackgroundSync` 包装 `App` 构造器注入 `onShow` / `onHide`（改 `App.prototype` 在微信中不生效）。

## 7. 插件层（plugins）

| 插件 | 说明 |
| --- | --- |
| `loggerPlugin` | 打印 dispatch 名称、参数、耗时 |
| `persistencePlugin(options)` | 状态持久化；**后端必须同步且三方法齐备**（安装期校验，缺项抛 `TypeError`）；卸载时同步补写防抖窗口内容；生产降级信号走 `onError` |
| `devtoolsPlugin` / `timeTravelPlugin` | 调试与时间旅行（卸载带身份守卫，只清理属于本实例的全局项） |
| `analyzerPlugin` | 接入 dispatch / setState / getter 计时；`onError` 精确清理配对栈 |

插件在 `NODE_ENV=production` 下的安装/卸载日志静默；安装抛错会回滚入列。

## 8. 关键数据流

### 8.1 一次 `setState`

```
setState('count', 1)
  → 销毁守卫 → 保护代理判定合法
  → 写入状态 + 推进版本号 + 脏计数 +1
  → 失效 count 相关缓存
  → beforeSetState / afterSetState 钩子（插件、监控在此接入）
  → 通知调度：notify.async 决定立即或微任务合并；载荷形态按「有无只读以外的可写订阅者」决定（notify.clone 未显式配置＝自动，显式 true 强制深拷贝）
  → 监听器收到新状态；isStateKeyDirty('count') 为 true → 集成层更新 setData
```

### 8.2 一次 `dispatch`

```
dispatch('load', id)
  → _enterDispatch()（深度 +1，用于「仅最外层通知」判定）
  → 记录 onlyOnChange 基线计数
  → 执行 action（this = action 上下文）
      ├─ 同步返回：深度归零且非 batch 时通知（onlyOnChange 下比对计数）
      └─ 返回 Promise：注册 onSettled（结算补发），失败同时补发 onError 钩子
  → finally 深度 -1
```

### 8.3 一次异步快照

```
createSnapshotAsync(data, options)
  → 根治任务入队（队列 + queueHead 游标，避免 Array#shift 的 O(n²)）
  → 按 batchSize 分片处理，批间 await 让出控制权；推进 processedCount 并回调 onProgress
  → 单节点失败：落账 cloneError → 咨询 onError
        ├─ 继续 → 返回丢弃哨兵；processQueue 跳过填充（prop 占位一并删除）
        └─ 中止 → 抛 SnapshotAbortError
  → 超时：置 hasTimedOut，外层循环退出（不再入队新任务）
  → 汇总 metadata / stats / errors，success = 无 cloneError 且未超时
```

### 8.4 一次小程序 `setData`

```
Store 通知 → 集成层合并订阅回调
  → 对每个映射值判断是否需要更新
      ├─ 原始值：值未变则跳过
      ├─ mapState 对象值：引用未变且顶层键未变脏才跳过
      └─ 无脏键信息的对象映射（如 mapGetters）：保守下发
  → 过滤 undefined，合并补丁；仅有更新时调用一次 setData
```

## 9. 构建与产物

| 环节 | 脚本 | 作用 |
| --- | --- | --- |
| 清理 | `prebuild` → `clean-dist.mjs` | 删除旧 `dist`（避免残留过期产物） |
| 编译 | `build` → `tsc -p tsconfig.build.json` | 产出 `dist/**`（结构保留，供子路径导出） |
| 收尾 | `postbuild-dist.mjs` | 写入 `dist/package.json` 的 `{"type":"module"}` 标记并移除 sourcemap |
| 压缩 | `minify-dist.mjs`（`build:min` / `build:release`） | `build:release` 为**严格模式**：无可用压缩器时以退出码 1 中止 |
| 子路径转发 | `generate-subpath-stubs.mjs`（`prepack` / `postpack`） | 生成/清理 `store/`、`hooks/`、`plugins/`、`integrations/` 等转发目录，供微信「构建 npm」使用 |

`exports` 映射是运行时的唯一权威（`.` / `./core` / `./extras` / `./extras/*`）；转发子目录只是为不支持 `exports` 子路径的环境兜底。

## 10. 质量门禁

| 层次 | 机制 |
| --- | --- |
| 类型 | 多套 tsconfig：源码 / Jest / 测试 / 构建 / 类型检查 / 示例，全部零错误 |
| 测试 | `tests/unit`（按领域分目录） + `tests/integration`；62+ 套件、2300+ 用例 |
| 覆盖率 | 语句 / 分支 / 函数 / 行 **四项 100%**；确实不可达的防御分支用 `/* istanbul ignore … */` 标注并**写明原因** |
| 静态检查 | ESLint（`lint:ci` 带警告上限）；禁止 CJS 写法 |
| CI | lint → typecheck（src/examples）→ test:ci → build → **ESM + 子路径冒烟** → 覆盖率产物上传；Node 22/24 双跑 |

## 11. 刻意保留的取舍

| 取舍 | 原因 |
| --- | --- |
| 就地变异状态（非不可变） | 小程序场景看重性能与写法简洁；用 `$snapshot()` / `createSnapshot()` 提供隔离副本 |
| 钩子/插件的错误被隔离处理 | 监控插件不得因自身异常影响主流程；`onError` 是唯一观察点 |
| 持久化后端强制同步 | 微信同步存储是主流；异步后端会因竞态导致写入静默丢失 |
| 生产模式日志静默 | 减少发布包日志噪声；需要被监控发现的问题（持久化降级、监听器抛错、落盘 / 清理失败）统一 `emit('onError', …, source)`，排查时也可临时切开发模式 |
| `customCloner` 抛错不降级为「原值兜底」 | 宁可丢弃节点也不能让活引用穿透隔离契约 |
| 覆盖率为 100% 但不为数字改写语义 | 等价改写须可证明；不可达分支用带原因的标注，而非删除防御 |
