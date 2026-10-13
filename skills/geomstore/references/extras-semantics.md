# 可选能力（extras）语义与易误用点

> [`../SKILL.md`](../SKILL.md) 的长尾参考（`extras/*` 各子入口），只写「会影响你怎么写代码」的结论，变更背景见仓库 `CHANGELOG.md`；精确签名先看 [`api/index.md`](./api/index.md) 的入口一览再按需打开对应子入口文件，默认值与设计意图查仓库 `docs/API.md`。

## 目录

- [1. 快照（`extras/snapshot`）](#1-快照extrassnapshot)
  - [成功判据](#成功判据)
  - [隔离契约](#隔离契约)
  - [diff 与 inputTrusted](#diff-与-inputtrusted)
  - [路径方言](#路径方言)
- [2. 选择器（`extras/selector`）](#2-选择器extrasselector)
- [3. Action 装饰器与增强（`extras/action`）](#3-action-装饰器与增强extrasaction)
- [4. 错误处理（`extras/error`）](#4-错误处理extraserror)
  - [ErrorBoundary](#errorboundary)
- [5. 性能监控（`extras/performance`）](#5-性能监控extrasperformance)

---

## 1. 快照（`extras/snapshot`）

```ts
import { SnapshotManager, createSnapshot, createSnapshotAsync, compareSnapshots } from '@openlide/geomstore/extras/snapshot'

const result = createSnapshot(store.getState()) // { data, metadata, success, errors, stats }
if (result.success) use(result.data)
const diff = new SnapshotManager().compareSnapshots(result, createSnapshot(next)) // 传完整 SnapshotResult，不是 .data
```

### 成功判据

**先判 `success` 再用 `data`**：`data` 的类型是 `T | undefined`——异常 / 中止 / 根节点被丢弃时就是 `undefined`（失败结果不回传活引用），异步超时下甚至是半成品。

**`errors` 是完整账本，不是失败信号**：

- 入账类型：`circular`（写占位符继续）、`maxDepth`（降级）、`onProgress` 抛错记的 `unknown`——它们**都不影响 `success`**
- 只有 `cloneError`、超时、顶层异常三类会让 `success` 变 false
- 故 `success: true` 时 `errors` **可以非空**；`success: false` 时 `errors` 必非空

### 隔离契约

**无法安全克隆的节点一律丢弃**，绝不把原值兜底进快照（对象属性不写入、数组留洞、`Set` 不添加、`Map` 跳过整条 entry）。

**`onError` 按真值解释**：判定写法是 `if (!shouldContinue)`——不写 `return` 的箭头函数等价「拒绝继续」。纯观测请显式 `return true` 或改用 `onProgress`（后者抛错被就地兜住，不影响快照）。「拒绝继续」的后果分岔：`cloneError` 抛 `SnapshotAbortError`（`success: false`），`circular` 只写 `'[Circular Reference]'` 占位并继续；`maxDepth` / `timeout` 不经该回调。

**同步克隆有与选项无关的栈安全硬上限**：深度上限取 `min(maxDepth, HARD_MAX_CLONE_DEPTH = 1000)`（微信基础库栈更小故留了一倍余量）。超出部分按 `maxDepth` 的降级口径入账，**不会**以 `RangeError` 伪装成某条属性的 `cloneError`。要处理更深的结构走 `createSnapshotAsync`（任务队列代替调用栈，**不**叠加该硬上限）；`batchSize` 非法值构造期与逐次调用共用同一归一化（`0` / 负数夹到 1，`NaN` / `Infinity` 回落 100）。

**两类值「保留原引用」而不是重建**（与核心 `deepCloneState` 同一份判据，同步 / 异步两条路径同时生效）：

1. `Map` / `Set` / `Date` / `RegExp` / `Array` 的**子类**实例
2. 状态住在**内部槽位**里的内建值——`Promise`、装箱原始值（`new Number` / `new String` / …）、`ArrayBuffer` / TypedArray / `DataView`、`WeakMap` / `WeakSet`、`Error`、函数与生成器

它们与活状态是**同一个对象**：改 `snap.data.myMap` 会串回活状态，「快照即隔离」对这批值不成立。要真副本请自行 `slice(0)` / 结构化克隆，或用 `customCloner`——**`customCloner` 是宿主对象的唯一兜底出口**：没有内建 tag、状态又不在自有可枚举属性上的宿主对象（自定义 native 包装、部分 `wx` 返回值）引擎识别不到，会被重建成 `instanceof` 仍真却缺内部槽位的空壳。类实例仍按既有契约重建为**同类实例**（方法 / 继承链可用）。

**两条同口径修正**：数组上的**附加自有键**（`arr.meta = 'v2'`）会被克隆，并且**参与差异比较**（`root.list.meta` 路径）；`includeNonEnumerable: true` 带进来的属性在产物里一律 `enumerable: true`（否则它不进 `Object.keys` / `JSON.stringify` / diff 键集，等于没有这个选项）。

**与 Store 自身快照的区别**：`store.$snapshot()` 是深克隆 + 冻结纯对象 / 数组链（Date / RegExp / Map / Set 触达的节点仍可变），`store.$restore(snap)` 经 `$replaceState` 恢复、不重复深拷贝。

### diff 与 inputTrusted

**`compareSnapshots` 先看 `inputTrusted`**：`SnapshotDiff` 有必填字段 `inputTrusted: boolean`，任一侧快照 `success: false` 时为 `false`，此时引擎**不逐路径比对**，而是交付一条 `path: 'root'` 的整体差异并把 `changed` **恒置为 true**。

- 也就是说 `changed: true` 有两种来源——「输入不可信」与「内容确有差异」。做回滚判定 / 去重时**先判 `inputTrusted`**，为 `false` 就回上游重取快照（别把这条 root 差异当成一次真实变更）
- 100 层逐路径护栏只终止展开、不把超深路径无条件记为差异（超出后退化为整体 `deepEqual`）
- 对象的自有 `undefined` 属性与缺失键**不同**，新增 / 删除会产生对应 `kind`；继承属性不参与

### 路径方言

**差异路径**（`changes[].path`，与克隆账本 `errors[].path` 逐字一致）：

| 容器             | 值差异                          | 键 / 条目的增删                                                                                 |
| ---------------- | ------------------------------- | ----------------------------------------------------------------------------------------------- |
| `Map`            | `root[<String(key)>]`           | `root.key[<String(key)>]`（按键身份，可当条目身份用）                                           |
| `Set`            | —                               | `[removed:i]` / `[added:i]`（**报告序下标、不是身份**，跨快照配对请读 `oldValue` / `newValue`） |
| 数组的附加自有键 | `root.list.version`（`.` 连接） | `added` / `removed`，与普通对象键同形                                                           |

`Symbol` 键走 `String()`，`toString` 抛错的键退回 `<unstringifiable key>`。Date / RegExp / Map / Set / 装箱原始值按**内容**比较（`new Number(1)` vs `new Number(2)` 报 `changed: true`；同一引用仍短路）。**其余住在内部槽位的值按引用比较**——`ArrayBuffer` / TypedArray / `DataView` / `Promise` / `WeakMap` / `WeakSet` / `Error` 在克隆时本就保留原引用（内容比不出来，引用是唯一可得的信号），换一个实例即记一次差异；同一实例被原地改字节则无从分辨，不报差异。

## 2. 选择器（`extras/selector`）

```ts
import {
  createSelector, createMemoizedSelector, createParametricSelector, createStructuredSelector,
} from '@openlide/geomstore/extras/selector'

const selectCount = createSelector((s: CounterState) => s.count)
const byId = createParametricSelector((s: CounterState, id: string) => /* ... */)(store.getState())
```

**缓存命中同时比较状态对象身份与版本号**（O(1)）；跨 Store 的相同版本不会串值。

**状态无版本号时（直接传普通对象）改用 `equalityFn` 判等**，此时缓存里放什么由选项 `snapshotState` 决定：

- **默认 `true` = 缓存内容深拷贝快照**，`equalityFn(快照, 当前状态)` 比内容，就地变异能被感知、任何深比较器都成立
- **只有确认 `equalityFn` 是引用相等（`(a, b) => a === b`）时才显式传 `snapshotState: false`** 改缓存活引用、省掉整棵状态树的克隆
- 默认值下配引用相等比较器会因「克隆体永不与活引用相等」而**永远 miss**（不返回错值，只是 memo 失效）。`createMemoizedSelector(fn, equalityFn)` 的第二参只给比较器、**不会**顺手关掉快照；要走引用相等请用 `createSelector(fn, { equalityFn, snapshotState: false })`

**两套归一化不是同一套，别互相套用**：

| 选项        | `NaN` / 非 number | `0` / 负数 | `Infinity`                 |
| ----------- | ----------------- | ---------- | -------------------------- |
| `cacheTTL`  | 回落默认 5000ms   | 回落默认   | **有意放行**＝不按时间过期 |
| `cacheSize` | 回落 10           | 夹到 1     | 回落 10                    |

**默认比较器 `deepEqual` 先判原型一致再判内容**：`class MyMap extends Map` 的实例与 `Map` 实例判不等（哪怕都为空）、装箱原始值按 `valueOf` 判（`new Number(1)` ≠ `new Number(2)`）。别把 `Map` 子类实例与基类 `Map` 当同一份状态来源来回切换（只会让缓存永不命中，而不是误报相等）。`equalityFn` 形参声明为 `(a: any, b: any) => boolean`，收窄参数的自定义比较器可直接传入。

**类型参数**：`createStructuredSelector` 与 `SelectorComposer.combine` **需显式给出状态类型参数**（TS 无法反推）。`combine` 的结果类型 `R` 由 `combiner` 的返回类型反推并透传到 combiner 的返回位——显式写 `combine<S, R>(…)` 而 combiner 返回别的东西（拼错属性名、多包一层）**会编译失败**；两参数写法 `SelectorComposerInput<S, T>` 的 `R` 仍取默认 `unknown`。

`createRetrySelector` / `createRetrySelectorAsync` 的重试错误带不可枚举的 `attempts` 记录真实执行次数。

## 3. Action 装饰器与增强（`extras/action`）

**装饰器是 `MethodDecorator` 工厂**（不是函数包装器），只能用于类方法，需 `experimentalDecorators`。代码示例见 [`../SKILL.md`](../SKILL.md)「Action 装饰器（`extras/action`）」一节；精确签名见 [`api/extras-action.md`](./api/extras-action.md)。

`withDebounce` / `withThrottle` / `withCache` 支持实例方法与静态方法，按宿主和方法隔离状态；复用装饰器时，同描述 Symbol 方法与同名字符串方法互不干扰。

**逐条语义**：

- **`createDecorator` 不把同步方法包成 `async`**：同步方法仍同步返回值，只有被装饰方法（或 `before`）返回 Promise 时调用才返回 Promise。`before` 返回 Promise 会被等待（其 rejection 走 `onError`）；`onError` 收到规范化 `Error`，它自身抛错只记日志、不顶替原始失败
- **`withLog`**：
  - 生产构建默认强制摘要（类型 / 长度 / 键数，`Error` 只留 `name`、**不含 `message`**），不打印参数与返回值内容
  - `redact: (value, phase) => …`（`phase` 为 `'args' | 'result' | 'error'`）在**非生产**下就是最终输出
  - 生产下 `redact` 的返回值**还要再过一道摘要**；要让 `redact` 全权决定形态，必须显式传 `summarizeInProduction: false`
  - 换输出出口传 `sink`（`{ log, error }`）
  - `sink` / `redact` 抛错都与业务调用隔离：只 `console.warn` 一句，既不中断被装饰的 action，也不把成功的调用改判成失败
- **`withCache` 的用户 `keyFn` 抛错时**该次调用退化为「不缓存、直接执行」，不会让整个业务方法失败
- **`withRetry` 的包装函数是 `async`**：装饰同步方法会让返回类型变成 `Promise<T>`，原本的同步抛出也变成 rejection（退避要 `await` 定时器）。靠同步返回值或 `try/catch` 接结果的调用点必须随之改写；不想改调用方就别给同步方法加它。`shouldRetry` 收到的是规范化 `Error`，`retries` 是首次执行**之外**的次数（总尝试 = `retries + 1`）
- **超时错误**：
  - 身份判据是 `error.code === TIMEOUT_ERROR_CODE`（值 `'ACTION_TIMEOUT'`），**不要按 message 匹配**
  - `@withTimeout` 的文案是 `Timeout after <n>ms`、`ActionExecutor.executeWithTimeout` 是 `Action timeout after <n>ms`，两入口文本不同且**只作展示**——按 message 匹配判超时既会漏判也会被底层 action 恰好含该字样的错误骗过
  - **超时不可取消**：只让本调用提前 reject，底层 Promise 仍在后台跑完
- `withThrottle` 的 `leading` / `trailing` 默认均为 `true`；方法「非 `async` 语法但返回 Promise」时置 `assumeAsync: true`，使被抑制的调用同样返回 Promise
- 函数式场景用 `ActionExecutor` / `ActionLoader` / `withLoading`；`ActionLoader` 默认让多个异步 action **共用** `loadingKey` / `errorKey` / `errorDataKey`（并发时互相覆盖），传 `perActionKeys: true` 后状态键派生成 `${baseKey}_${actionName}`（如 `loading_fetchUser`）

**宿主卸载点的收尾**：防抖 / 节流各有 `cancel*Calls` / `flush*Calls` / `dispose*State`（共 6 个，`cancel*` 丢弃挂起调用、`flush*` 立即执行且只执行一次、`dispose*` = 取消 + 释放该宿主整张状态表）。

- **适用范围只有一个前提：被装饰的方法要能被调用方拿到那个 `this`**——装饰 Page / Component / 自己 new 出来的类上的方法；**装饰 store action 时六个入口一律静默 no-op**（store action 的 `this` 是 `ActionManager` 内部为一次 dispatch 现造的上下文 Proxy，不挂在任何公开成员上）。替代路径：装饰页面 / 组件方法让它去 `dispatch`，或在 store 外自己包一层并拿住那个宿主
- 入口认的是**调用被装饰方法时的 `this`**，不是装饰期那个类对象；`method` 参数可省略（覆盖该宿主上所有被装饰方法）；宿主为基本类型 / `null` 时都是 no-op；`withCache` / `withRetry` **没有**对应入口
- 被取消的防抖调用：其 Promise 以 `Error('[withDebounce] pending call was cancelled')` 拒绝；节流的被抑制调用当时就已返回 `undefined`（或 `Promise<undefined>`），没有可取消的 Promise

**本入口的符号面不止装饰器**：`LogSink` / `LogPhase` / `ActionErrorData` / `RetryOptions` / `TimeoutError` / `TIMEOUT_ERROR_CODE` 等类型与超时错误件都**从这里引**，不要深链 `decorators/log` 之类叶子路径（`exports` 未声明它们）。

## 4. 错误处理（`extras/error`）

```ts
import { ErrorBoundary, GeomStoreError, ErrorCode, createError } from '@openlide/geomstore/extras/error'

const boundary = new ErrorBoundary({ fallback: [], onError: (e) => console.error(e) })
boundary.execute(() => riskyOperation()) // 未给 fallback 时默认 fail-loud（重抛）
```

### ErrorBoundary

**默认 fail-loud**：未配置 `fallback` 时错误重抛；提供 `fallback` 即声明恢复意图。`fallback` 自身抛错时**重抛原始错误**。非 `Error` 的抛出值先归一化为 `Error` 再记账；重抛时仍是原始值。显式 `recoverable: true` 而未配 `fallback` 时返回 `undefined`。

## 5. 性能监控（`extras/performance`）

```ts
import { PerformanceMonitor, analyzerPlugin } from '@openlide/geomstore/extras/performance'
store.use(analyzerPlugin) // 调试入口：globalThis.__GEOMSTORE_ANALYZER__[store.name]
```

- **`duration` 为 `NaN` / `±Infinity` 的样本不进入 `avg` / `max` / `min`**，只计入次数（`totalCount` / `exceedThreshold` 口径不变）；一组样本全非有限时耗时统计为 `0`。被排除的样本数**没有**对外字段
- `analyzeBottlenecks(threshold)` / `detectRegression(threshold)` 的**非法阈值**按默认值 / 0 归一：`NaN` 会让判据整体恒假（瓶颈列表变空、回归检测「一条都没退化」，看着像「没有性能问题」），负阈值会让 `0ms` 的操作被判 `severity: 'high'`
- 调试表只在非生产环境挂载，表键是 `store.name`（见 `core-semantics.md` §6）
