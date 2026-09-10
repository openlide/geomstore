# 常见问题

按症状归类。每条都指向对应的机制说明——排查时先看「为什么」，再改代码。

## 状态与通知

### 我改了状态，为什么监听器没被调用？

三种常见原因，按可能性排序：

1. **没有真正改变状态**：开启 `notify.onlyOnChange` 后，dispatch / batch 期间没有实际写入就不会通知。请确认写入是否真的发生（例如 patch 的键是否存在于状态中）。
2. **`notify.async` 合并了通知**：同一 tick 内的多次写入只发一次；如果你的断言在同一个 tick 里，看到的是「还没通知」。
3. **改的是克隆出来的副本**：`$patch` / `setState` 写入的是内部状态；如果你拿 `deepClone(state)` 的结果去改，不影响 Store。

### 监听器为什么收不到 `prevState`？

`StateListener<S>` 的签名是 **`(state: S) => void`**——只有一个参数。需要前后对比请在闭包里自行保存上一次的值：

```ts
let last = store.getState().count
store.subscribe((state) => {
  console.log(last, '→', state.count)
  last = state.count
})
```

### 直接写 `state.x = 1` 为什么会抛错？

状态保护（默认开启）拦截绕过 `setState` / `$patch` 的直接变异，包括 `Object.defineProperty` 与数组元素赋值。请改用受控写入：

```ts
store.setState('x', 1)
store.$patch({ x: 1 })
```

确实有性能或兼容需求时可用 `stateProtection: { deep: false }` 只保护顶层，但**不建议关闭保护**——就地变异是许多「数据不更新」问题的根源。

### 异步 action 的通知次数和我想的不一样

统一规则（只有一条）：

- 异步 action 的**同步段不单独通知**，其变更由完成时（fulfill 或 reject）的补发覆盖一次
- `await` 之后的变更同样在结算时补发
- **嵌套 dispatch 仅最外层通知**
- 与 batch 交叉时由 batch 收尾统一通知

因此「同步段改一次 + 续段改一次」只会看到一次通知，这是刻意去重的结果。若你希望中间态可见，请在 action 内显式 `startBatch` / `endBatch` 之外单独写入，或拆成两个 action。

### `batch` 里 `await` 之后为什么不合并了？

批保护只在**同步段**有效——`await` 之后的变更会逐条通知（开发模式下有显式告警）。异步场景请让 action 承担合并职责，或在 `await` 之后重新 `startBatch` / `endBatch`。

### `isStateKeyDirty` 有什么用？

供集成层判断「自上次通知以来某键是否变化」，据此跳过无意义的 `setData`（小程序视图层更新是主要开销）。组合 Store 的命名空间模式下它会精确判断**子 store** 是否变化。

## 缓存与选择器

### 缓存命中率很低 / 选择器返回了陈旧值

- **命中率低**：只缓存热点键（`enableCache(['visibleRows'])`）；状态频繁整体替换（`$replaceState`）会让缓存反复失效
- **陈旧值**：选择器命中判定优先用**状态版本号**（O(1)）；当状态不带版本号（例如你把普通对象直接传给选择器）时才回退 `equalityFn`（默认 `deepEqual`）。如果你自定义了 `equalityFn` 且它过于宽松，就会误命中——检查它是否只比较自有属性

### `enableCache` 的 stats 会影响性能吗？

会带来少量开销（每次读写都要计数）。`cacheConfig.enableStats` 默认关闭，只在测量时开启。

## 快照

### 快照里为什么少了字段 / 出现了 `undefined`？

这是**隔离契约**的预期行为：无法安全克隆的节点一律**丢弃**，绝不把原始活引用兜底进结果。具体表现：

| 容器 | 丢弃时的表现 |
| --- | --- |
| 对象属性 | 该属性不写入 |
| 数组 | 保留位置（留洞，`1 in arr === false`） |
| `Set` | 不添加该元素 |
| `Map` | 跳过整条 entry |
| 根节点 | `data` 为 `undefined` |

排查方式：读 `result.errors`（每项含 `path` / `type` / `message`），并按需用 `customCloner` 接管该节点。存在 `cloneError` 时 `success` 为 `false`——**先看成功标志，再信任数据**。

### `$snapshot()` 和 `createSnapshot()` 有什么区别？

| | `store.$snapshot()` | `createSnapshot(data)` |
| --- | --- | --- |
| 归属 | 核心 | `extras/snapshot` |
| 结果 | 深克隆 + 递归冻结的只读状态 | `{ data, success, errors, metadata, stats }` |
| 错误处理 | 无账本（失败即抛） | 逐节点落账 + `onError` 降级策略 |
| 适用 | 需要只读副本 / 回滚点 | 需要错误可见性、进度、大对象分片 |

### 什么时候该用异步快照？

数据量导致单次克隆会阻塞主线程时。`createSnapshotAsync` 按 `batchSize`（默认 100）分片并在批间让出控制权，可配 `onProgress` 显示进度、`timeout` 限制总耗时。

### 快照能克隆类实例 / Date / Map 吗？

- 类实例：保留原型（快照后仍可调用原型方法）
- 访问器属性：以 getter 求值结果克隆（**不会二次触发** getter）
- `Date` / `Map` / `Set`：按类型正确克隆；循环引用检测始终生效（`detectCircular` 只控制是否**上报**）

## 装饰器

### `withThrottle` / `withCache` 为什么返回了 `undefined`？

当方法**不是 `async` 语法但返回 Promise**（包装函数、手写 thenable）时，装饰器无从观测返回值。若首次调用即被抑制（`leading: false`）或命中缓存，它会按同步方法返回 `undefined`，而后续调用却真的返回 Promise——调用方 `await` 就可能崩。

处理：显式声明异步语义。

```ts
withThrottle(200, { assumeAsync: true })
withCache({ ttl: 30_000, assumeAsync: true })
```

### 同一个装饰器实例用在多个方法上会串数据吗？

不会。装饰器状态按**方法**隔离（`withCache` / `withDebounce` / `withThrottle` 均分桶）；`withLoading` 的引用计数按 (宿主, loading 键) 集中，多装饰器并发不会提前翻转 `loading`。

### `withThrottle` 的间隔参数写在哪里？

```ts
withThrottle(100, { leading: true, trailing: true })   // 间隔是第一个位置参数
```

默认 `leading` 与 `trailing` 均为 `true`：窗口结束时以**最新参数**补发被抑制的调用。

## 插件与持久化

### 持久化没有生效 / 恢复后字段丢了？

- **后端必须同步**：`getItem` / `setItem` / `removeItem` 返回 Promise 的实现会被**显式拒绝**（避免写入静默丢失）。小程序用 `WxStorageBackend` 或自封装同步实现；浏览器可直接用 `localStorage`
- **恢复是合并语义**（走 `$patch`）：未被持久化的键保留初始值，不会被覆盖
- 用 `filter` 指定落盘子集；用 `debounce` 控制写入频率（卸载时会同步补写窗口内最后一次变更）
- 需要卸载即清理时用 `clearOnUninstall: true`（此时待写数据会被丢弃）

### 生产环境为什么看不到插件日志？

`NODE_ENV=production` 下插件安装/卸载、订阅驱逐、子 store 竞态等路径**静默**（仅开发模式打日志）。这是刻意设计，排查时临时切到开发模式即可。

### 插件安装失败会留下半成品吗？

不会。`store.use(plugin)` 在 `install` 抛错时会回滚入列，重试不会累积重复条目。`usePlugin(plugin, store)` 是等价的独立函数，泛型从 `store` 反推、**无需断言**（插件需与其状态类型匹配；状态无关的插件写作 `Plugin<State>`）。

## 集成与工程

### 小程序里 `require` 报错？

包已切换为**纯 ESM**：请使用 `import`。若你的构建链路仍产出 CJS，请在打包器侧做转换。

### 组件里收不到 `attached` / `detached`？

组件生命周期必须写在 `lifetimes` 字段内（基础库 3.15.0+）；写在配置顶层的 `attached` / `detached` 不会被调用。

```ts
withComponentStore(store, { mapState: ['count'] })({
  lifetimes: { attached() {}, detached() {} },
})
```

### 组件 / App 里要不要手写 `this` 类型？

**不需要**。三处集成都已注入 `this` 类型，方法内直接写即可：

```ts
// Store action：this 由 createStore 注入（state / setState / $patch / dispatch 等）
actions: { login(userInfo: string) { this.$patch({ userInfo, isLoggedIn: true }) } }

// Page：this.data（含 mapState / mapGetters）与 mapActions 注入的方法
onLoad() { if (!this.data.isLoggedIn) this.login('Ada') }

// Component：注入方法与 data（运行时 methods 会被提升到实例，this.add 与 this.methods.add 都可用）
methods: { onTapPlus() { this.add(1) } }

// App：this.globalData（含映射状态）与注入的 action
onLaunch(options) { console.log(this.globalData.appName); this.markLaunched(String(options?.scene ?? '')) }
```

三者的差别只在注入形态：`withPageStore` 的方法在顶层、`withComponentStore` 写在 `methods` 里（但实例上可平级调用）、`withAppStore` 的状态落在 `globalData` 上。

**别手写 `this` 标注**：它会覆盖集成层注入的类型。例如写成 `onLaunch(this: { globalData: { appName: string } })` 会把 `globalData` 收窄回字面量类型、丢掉映射进来的状态键；而 `this: AppOptions` 之类会让 `globalData` 退回可选。

### `@openlide/geomstore/xxx` 解析不到？

- 先确认该子路径在 `exports` 映射中（`core`、`extras`、`extras/*`）
- `@openlide/geomstore/{store,hooks,plugins,integrations}` 这类**转发子目录**是为微信「构建 npm」（不支持 `exports` 子路径）准备的，由 `pnpm stubs` 生成；Node / 打包器请优先用 `extras/*`
- 注意 `bindMappings` 等底层绑定工具**不在主入口**，需从 `@openlide/geomstore/integrations` 引入（已在 `exports` 声明）；日常优先用 `withPageStore` / `withComponentStore` / `withAppStore`

### 主包体积变大了

最常见原因是引入了聚合入口 `@openlide/geomstore/extras`（它会把全部可选能力拉进产物）。改为按需子路径：

```diff
- import { createSnapshot, createSelector, withThrottle } from '@openlide/geomstore/extras'
+ import { createSnapshot } from '@openlide/geomstore/extras/snapshot'
+ import { createSelector } from '@openlide/geomstore/extras/selector'
+ import { withThrottle } from '@openlide/geomstore/extras/action'
```

### 报错 `Cannot call … on a destroyed Store`

Store 已 `destroy()`。销毁后除只读统计（如 `getCacheStats`）外的所有方法都会抛错；请在销毁前完成收尾，或在使用前判断生命周期。

### 长期运行的进程内存持续增长 / 定时器不退出？

- `ErrorMonitoring` 的队列有容量上限（`maxQueueSize`，默认 1000，超容量按最旧优先淘汰），「全部 reporter 连续失败」的重入队也有上限（`maxFlushRetries`，默认 3）——避免永久失败批次无限空转
- `ErrorRecovery` 的重试键有容量守卫（`MAX_RETRY_KEYS = 1000`），动态 operation id（如 `fetchUser:${id}`）不会导致无界增长
- 内部定时器做 `unref` 探测：小程序 / 浏览器无该 API 时自动跳过，不会阻止进程退出
- `PerformanceMonitor.record` 会清理超时未结束的计时条目（调用方遗漏 `end()` 时的兜底）

### 为什么同一个功能在同步和异步路径行为不同？

**不应该**。若你发现差异，请提 issue 并附复现——本项目把「两条路径同语义」当作契约，例如快照的 `customCloner` 抛错语义已收敛为同一实现（落账 → 咨询 `onError` → 继续丢子树 / 中止抛错）。

## 参与开发

提交前的门禁、测试与文档约定见 [CONTRIBUTING](../CONTRIBUTING.md)；版本迁移见 [MIGRATION](./MIGRATION.md)。
