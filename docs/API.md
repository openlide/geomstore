# API 参考

按**引入路径**组织：未特别标注的符号属核心、从主入口引入并始终进入产物；`extras/*` 各节的符号从对应子路径引入，不进入主包。

```ts
import { createStore, withPageStore } from '@openlide/geomstore' // 核心
import { createSnapshot } from '@openlide/geomstore/extras/snapshot' // extras
```

## 本文的职责边界（先读这一段）

**逐字签名不由本文负责。** 精确签名、重载与 JSDoc 的事实来源是这两处，它们随版本自动产出、无需人工同步：

| 你是谁        | 签名看哪里                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 在本仓库开发  | `pnpm build && pnpm skill:api` 产出的 `.codebuddy/skills/geomstore/references/api/*.md`（从 `dist/**/*.d.ts` 生成，按入口拆分） |
| 已安装 npm 包 | `node_modules/@openlide/geomstore/dist/**/*.d.ts`（随包发布，与你装的版本必然一致）                                             |

本文只维护**上面两处产出不了的东西**：选项默认值、跨 API 的语义契约、设计意图、易误用点。这两类内容一旦写重了就会各自漂移，所以本文**不复制签名块**——需要签名请走上表。

其余分工：机制语义与设计原理见 [CONCEPTS.md](./CONCEPTS.md)（那里是唯一正本，本文不重述），接入写法见 [GUIDE.md](./GUIDE.md)，按症状排查见 [FAQ.md](./FAQ.md)，行为的历史对照见 [MIGRATION.md](./MIGRATION.md)（本文只写当前行为）。未在此列出的类型请查阅 `src/types/*.ts`。

## 目录

- [入口一览](#入口一览)
- [核心（主入口）](#核心主入口)：[createStore](#createstore) · [Store 实例](#store-实例) · [工具函数](#工具函数) · [钩子与插件](#钩子与插件) · [小程序集成](#小程序集成) · [组合](#组合) · [LRUCache](#lrucache)
- [extras/snapshot（快照）](#extrassnapshot快照)
- [extras/selector（选择器）](#extrasselector选择器)
- [extras/action（Action 增强）](#extrasactionaction-增强)
- [extras/performance（性能监控）](#extrasperformance性能监控)
- [extras/plugins（插件实现）](#extrasplugins插件实现)
- [extras/error（错误处理）](#extraserror错误处理)
- [extras/enterprise（企业微信集成）](#extrasenterprise企业微信集成)
- [易误用点](#易误用点)
- [版本与变更](#版本与变更)

## 入口一览

| 引入路径                                                 | 内容                                                                                                                                                                                                                                                                     | 体积                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| `@openlide/geomstore`                                    | 核心：Store / 工厂 / 工具 / 钩子 / 小程序集成 / 组合 / LRU                                                                                                                                                                                                               | 常驻                    |
| `@openlide/geomstore/core`                               | 与主入口同源的显式核心子入口                                                                                                                                                                                                                                             | 常驻                    |
| `@openlide/geomstore/integrations`                       | 小程序集成底层绑定工具（`bindMappings` 等）                                                                                                                                                                                                                              | 按需                    |
| `@openlide/geomstore/extras`                             | 全部可选能力聚合                                                                                                                                                                                                                                                         | 最大，仅调试/全都要用时 |
| `@openlide/geomstore/extras/snapshot`                    | 快照引擎                                                                                                                                                                                                                                                                 | 按需                    |
| `@openlide/geomstore/extras/selector`                    | 选择器与组合器                                                                                                                                                                                                                                                           | 按需                    |
| `@openlide/geomstore/extras/action`                      | ActionLoader / withLoading / 装饰器 / 防抖·节流的宿主收尾入口                                                                                                                                                                                                            | 按需                    |
| `@openlide/geomstore/extras/performance`                 | 性能监控与 analyzer 插件                                                                                                                                                                                                                                                 | 按需                    |
| `@openlide/geomstore/extras/plugins`                     | 内置插件实现与存储后端                                                                                                                                                                                                                                                   | 按需                    |
| `@openlide/geomstore/extras/error`                       | 错误类族 / 边界 / 恢复 / 监控 / 上报器                                                                                                                                                                                                                                   | 按需                    |
| `@openlide/geomstore/extras/enterprise`                  | 企业微信集成                                                                                                                                                                                                                                                             | 按需                    |
| `@openlide/geomstore/{store,hooks,plugins,integrations}` | 转发子目录（`pnpm stubs` 生成，供不解析 `exports` 子路径的老式场景；指向 `dist` 的 ESM）                                                                                                                                                                                 | —                       |
| 包根 `dist-weapp/`（非引入路径）                         | 微信「构建 npm」专用产物：`miniprogram` 字段指向的目录，**不是引入路径、不要按路径 import 它**。与 `dist` 一比一对应的 CJS 镜像，公开子路径入口齐备、导出面逐项一致。形态成因与「为什么不能用 Node 验证它」见 [CONTRIBUTING 的构建与发布](../CONTRIBUTING.md#构建与发布) | 仅微信侧                |

---

## 核心（主入口）

### createStore

`createStore` 有两个重载：`state` 传工厂函数、或传对象字面量。工厂重载置于对象重载**之前**——函数类型本身可赋给 `State`，顺序颠倒会让 `state: () => ({...})` 被对象重载误判成 `S` 即函数类型，导致 getter / action 上下文退化。两种形态返回同一 `Store<S, A, G>`：

```ts
// 工厂函数形式（推荐：避免引用类型被多实例共享）
createStore<S extends State, A extends Actions = Actions, G extends Getters<S> = Getters<S>>(
  options: FactoryStoreConfig<S, A, G>,
): Store<S, A, G>

// 对象字面量形式
createStore<S extends State, A extends Actions = Actions, G extends Getters<S> = Getters<S>>(
  options: LiteralStoreConfig<S, A, G>,
): Store<S, A, G>
```

> `FactoryStoreConfig` / `LiteralStoreConfig` 是内部的**未导出**别名，各自等价于 `Omit<StoreConfig<S, A, G>, 'state'>` 再把 `state` 固定为 `() => S` / `S`（即「下方选项表 + 该形态的 `state`」）。另有导出的 `StoreOptions`，那是给「显式泛型场景」使用的构造配置，**不是** `createStore` 的形参类型。
>
> `StoreConfig<S = Record<string, unknown>, …>` 的 `S` 默认值是 `Record<string, unknown>`（不是 `unknown`）：若它是 `unknown`， `state?: unknown` 什么都能装，但 `cacheKeys?: Array<keyof ResolvedState<S>>` 会退化成 `never[]`，裸写 `StoreConfig` 的人连 `cacheKeys: ['count']` 都写不出来。代价是这个默认值不接受无索引签名的 interface 作为 `state`；走 `createStore` 的 调用不经过它。同一文件另导出别名 `ConfigState<S>`（getter 侧的退化兜底）。`StoreConfig` 与 `ConfigState` 均已列入主入口的精选再导出，可直接从 `@openlide/geomstore` 导入——本包的 `exports` 没有深路径通配，`dist/types/*` 在发布形态下不可达。

| 选项                                | 类型                            | 默认             | 说明                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------- | ------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                              | `string`                        | —                | Store 名称（日志、组合命名空间、错误上下文）                                                                                                                                                                                                                                                                                                                                                                    |
| `state`                             | `S \| (() => S)`                | —                | **推荐工厂函数**：创建时执行一次，避免引用类型被多实例共享                                                                                                                                                                                                                                                                                                                                                      |
| `actions`                           | `A`                             | —                | 方法集合；`this` 为 action 上下文（`state` / `setState` / `$patch` / `$replaceState` / `dispatch` / `getState`）                                                                                                                                                                                                                                                                                                |
| `getters`                           | `G`                             | —                | 纯函数，**只接收 `state`**                                                                                                                                                                                                                                                                                                                                                                                      |
| `notify.clone`                      | `boolean`                       | 未显式配置＝自动 | 通知时是否深拷贝载荷。**未显式配置**时按订阅者构成决定：仅有只读订阅者（页面 / 组件绑定）走零拷贝，存在可写订阅者才深拷贝；显式 `true` 强制深拷贝；显式 `false` 仍在有可写订阅者时深拷贝（防共享载荷被改）。判定为需要拷贝时，**可写注册各拿一份独立深拷贝、只读注册共用一份**（共用一份时，只要其中一个可写回调改入参，后面的监听器就读到半成品——故可写注册不共享）；份数由 `subscription.maxSubscribers` 封顶 |
| `notify.async`                      | `boolean`                       | `false`          | 微任务合并同一 tick 内的多次写入                                                                                                                                                                                                                                                                                                                                                                                |
| `notify.onlyOnChange`               | `boolean`                       | `false`          | 根据变更计数抑制未检测到写入的 dispatch / batch 通知；脏键追踪不依赖此开关，同值写入也可能推进计数                                                                                                                                                                                                                                                                                                              |
| `stateProtection.deep`              | `boolean`                       | `true`           | 是否递归保护嵌套对象（`false` 只保护顶层）                                                                                                                                                                                                                                                                                                                                                                      |
| `stateProtection.productionHandler` | `'error' \| 'warn' \| 'silent'` | `'warn'`         | 生产模式下非法写入的处理方式；**取值在构造期校验**，越界值（含未类型化调用方传的任意字符串）让 `createStore` 当场抛 `TypeError`，而不是留到很远的一次状态写入才以别的面目失败                                                                                                                                                                                                                                   |
| `cacheConfig.enableStats`           | `boolean`                       | `true`           | 是否采集缓存命中统计（有额外开销）                                                                                                                                                                                                                                                                                                                                                                              |
| `cacheConfig.ttl`                   | `number`                        | `0`（不过期）    | 键级缓存过期毫秒数；非有限值与负数（`NaN` / `Infinity` / `-1`）归一为 `0` 并留一条开发期告警（配置算错必须有信号，判据本身不接受「恒假＝永不过期」这种意外结果）                                                                                                                                                                                                                                                |
| `subscription.maxSubscribers`       | `number`                        | `50`             | 在册**注册**数上限（同一监听器注册两次计两笔）；达限时重复注册会让位该监听器自己最早的一笔。取值在构造期归一（与 `LRUCache` capacity / `cacheConfig.ttl` 同一条守卫）：**非有限值（`NaN` / `Infinity` / `-Infinity`）回落默认 50 并在开发模式告警**、小数向下取整（`2.5` → 2）、`0` 与负数按「add 文档既有语义」保留                                                                                            |
| `subscription.onLimit`              | `'evict-oldest' \| 'throw'`     | `'evict-oldest'` | 订阅数达上限时的策略。`evict-oldest` 驱逐一份注册时，Store 会向 `onError` 钩子发一条带 Store 名 / 上限 / 被驱逐监听器标识的 `Error`（第二参 `'subscribe'`），生产不再完全静默；`throw` 分支不产生该事件                                                                                                                                                                                                         |

### Store 实例

#### 状态

| 方法            | 签名                                             | 说明                                                                                                                                                                                                                                                                                                                                                             |
| --------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getState`      | `(): S`                                          | 返回活动引用（就地变异语义）                                                                                                                                                                                                                                                                                                                                     |
| `setState`      | `<K extends keyof S>(key: K, value: S[K]): void` | 单键写入。**值按引用保存**，敏感键走 DefineOwnProperty → 注 2                                                                                                                                                                                                                                                                                                    |
| `$patch`        | `(partialState: Partial<S>): void`               | 多键合并（底层 `deepMerge`，仅对纯对象递归）。**「合并即隔离」只对可安全克隆的值成立**：类实例、`Promise`、WeakMap/WeakSet、字节缓冲等非纯对象按引用并入，副本与补丁实参是同一个对象（要真隔离请自己先克隆）。顶层键的「改没改」按与 `setState` 同一条 `Object.is` 判据：命中的键整键跳过——不推进变更计数、不标脏、不写缓存、不通知，`$patch({})` 因此什么都不做 |
| `$replaceState` | `(newState: S \| (() => S)): void`               | 整体替换；未列出的键会丢失，且这些**消失的旧键同样被标脏**（`isStateKeyDirty` 对它们为 `true`）                                                                                                                                                                                                                                                                  |
| `$snapshot`     | `(): Readonly<S>`                                | 深克隆后**部分冻结**：纯对象与数组链上深度只读；经 Date / RegExp / Map / Set 或非纯对象（类实例等）触达的节点仍可变，`Readonly<S>` 只是类型层面的承诺                                                                                                                                                                                                            |
| `$restore`      | `(snapshot: Readonly<S>): void`                  | 从快照恢复（经 `$replaceState`，不重复深拷贝）                                                                                                                                                                                                                                                                                                                   |

**注 1 · `$patch` 的键集含符号键**：与 `setState` / 脏键表 / `isStateKeyDirty(key: string | symbol)` 一致，`$patch({ [sym]: v })` 会真的写入、标脏并触发通知；嵌套补丁对象上的符号键同样参与合并与别名归因。（早前只有字符串键走通这条链路，符号键补丁会被静默丢弃——照常发钩子、照常返回，却什么都没写。）

**注 2 · `setState` 的两个不显然处**：① **值按引用保存**（与 `_initializeState` / `$replaceState` 的深拷贝不同）——别名脏键归因与脏追踪索引都以对象身份做可达性判定，写入时换成克隆会把「同一对象被多个顶层键引用」从状态图里抹掉。代价是调用方事后再改入参不被追踪（无计数、无脏键、无钩子）；要「写入即定格」用 `$patch`，要隔离副本读 `$snapshot()`。② **原型链敏感键**（`__proto__` / `constructor` / `prototype`）走 DefineOwnProperty 而不是裸 `[[Set]]`，与 `deepMerge` / `$patch` / `$replaceState` 同一份判据：`setState('__proto__', { inj: 1 })` 只是在状态对象上承载一个自有数据属性，原型不动、注入键也不经原型链可见。相等性判定对这类键按**自有描述符**取值（`state.__proto__` 的 `[[Get]]` 返回的是原型而非写入值），所以「值非对象、setter 静默丢弃、什么都没写成功」的那次写入不会推进变更计数 / 脏键 / 通知。

#### Action 与 Getter

| 方法             | 签名                                                          | 说明                                                                                                                                                                                                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dispatch`       | `(name, ...args) => ReturnType<A[name]>`                      | 返回值原样透传（异步 action 返回 Promise）                                                                                                                                                                                                                                                                                                |
| `getter`         | `<K extends keyof G>(getterName: K): InferGetterReturn<G, K>` | 每次调用都执行一次 getter 函数。**Store 层没有 getter 结果缓存**（无版本号比较、无记忆表、无缓存键），所以「依赖未变时复用结果」不成立：连续读同一个 getter 就是连续重算 N 次。要「依赖未变则复用」请用 `extras/selector` 的 `createSelector`（失效凭证是状态对象身份 + 版本号，见第三节）；getter 保持纯函数，副作用会在每次读取时都执行 |
| `getGetterNames` | `(): string[]`                                                | 供调试 / DevTools                                                                                                                                                                                                                                                                                                                         |

#### 订阅与批量

| 方法                      | 签名                                                                         | 说明                                                                                                                                                                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `subscribe`               | `(listener: StateListener<S>, options?: { readOnly?: boolean }): () => void` | 监听器**只接收新状态**；返回值为退订函数。`readOnly: true` 声明回调不写状态，全部订阅者都只读时通知载荷免深拷贝（开启状态保护时为只读保护 Proxy，关闭时为原始引用）；需要隔离时按注册可写性分配载荷——**可写注册各一份独立深拷贝，只读注册共用一份** |
| `isStateKeyDirty`         | `(key: string \| symbol): boolean`                                           | 自上次通知以来该键是否变更（集成层据此跳过 `setData`）；脏键按 `Reflect.ownKeys` 收集，故 `symbol` 顶层键同样可查                                                                                                                                   |
| `batch`                   | `<T>(fn: () => T): T`                                                        | 期间合并通知，结束时统一发一次（返回值与异常原样透传）                                                                                                                                                                                              |
| `startBatch` / `endBatch` | `(): void`                                                                   | 手动批量（支持嵌套，仅最外层收尾时通知）                                                                                                                                                                                                            |

- 同一监听器注册 N 次会收到 N 次通知。每个返回的退订句柄只抵消一份注册，**重复调用同一句柄无效**，不会移除其他注册。`maxSubscribers` 是**每一次注册**都生效的硬上界（含同一监听器的重复注册）：达限时重复注册挤掉自己最早的一笔，`onLimit: 'throw'` 下抛错，在册注册数不会超过上限。
- 直连 `SubscriptionManager` 的宿主可以配 `onSubscriberEvicted`（载荷类型 `SubscriberEvictionInfo`：`listener` / `maxSubscribers` / `size`，`size` 是「驱逐完成后、新注册写入前」的在册数），`'throw'` 策略不产生该事件。这两个名字只随内部 barrel `src/core/store/index.ts` 出口，该子路径不在 `package.json` 的 `exports` 映射里；**用 `createStore` 的调用方不需要它**——Store 已把驱逐事件接到 `onError` 钩子上（见 1.1 的 `subscription.onLimit`）。
- 回调抛错被逐个隔离（不影响其余监听器）：开发模式打印，生产模式改由 `onError` 钩子承接（控制台仍静默），因此「某个订阅者一直在抛错」有可上报的入口。本轮派发对象是进入通知时在册的注册，回调内退订自己仍会收到本次这最后一次更新。
- action 内通过 `this.state` 修改对象、数组及 Map/Set 时，会累积受影响的**顶层键**；共享别名可能同时使多个键变脏。这在默认模式与 `onlyOnChange` 模式下均生效。
- 在同步订阅回调内读取 `isStateKeyDirty(key)`；脏键在通知结束后清空，批处理或异步通知等待期间会累积。`batch` 延迟的是通知，不是状态写入。
- **异步 action 的通知在两个时点各补发一次**：返回 thenable 时，**同步段结束当场补发一次**（覆盖 action 在第一个 `await` 之前写入的格子），settle 时再补发一次（覆盖 `await` 之后的续段变更）。为什么同步段必须自己补发：Store 侧的写入抑制是硬开关（`setState` / `$patch` / `$replaceState` 都看「是否在 dispatch 中」），返回**永不 settle** 的 promise（等用户交互才 resolve、`wx.request` 无回调也不 reject、超时未 reject）时，缺了这一次当场补发，同步段那一格状态就要等「下一个不相干的通知」才顺带浮出来——`dialogVisible = true` 得等对话框关掉之后才可见（而它根本没显示出来）。口径：**默认模式下「同步段有写入且最终 settle」的 action 收到 2 次通知**（按通知打点的宿主据此设期望），`notify.onlyOnChange` 按变更计数去重、算一次；同步段没有写入时不多刷（无变更的异步 action 是 0 次），`batch` 期间不提前通知。action 返回值是**手写 thenable** 时的状态可见性同样依赖这条兜底。这一处计数差异的升级对照见 [MIGRATION.md 的 0.7.0 一节](./MIGRATION.md#升级到-070)。
- Date 等其他内建对象的内部变异不在此代理追踪范围；需要通知时，通过 `setState` 等 API 替换所属状态键。`getState()` 返回的裸引用不是 action 脏追踪视图。
- **有意的保护豁免（非普通实例的方法）**：类实例、类型化数组等挂在状态里的对象，其方法被读取时绑定到**原始接收者**（绑到保护代理会让 `#private` 字段的品牌检查与类型化数组的内部槽位直接抛错）。后果是方法内部的写入（`this.count++`）不经过 set / deleteProperty / defineProperty 陷阱——既不被状态保护拦截，也不推进脏键与版本计数。这类状态请经 `setState` / `$patch` 修改。同一条读取上返回的是**同一个**函数引用（`state.method === state.method` 成立），方法被整体替换后则返回新实现的绑定。
- **有意的追踪空洞（被锁死的数据属性）**：既不可配置也不可写变的自有数据属性，Proxy 不变量要求原样返回该值，调用方拿到的是裸对象，此后对它的写入不标脏、不推版本、不通知。这种属性只适合承载「不再被改的引用」。**读取口径**：深保护代理与数组代理（symbol 键 / 数字索引 / 附加自有键三处）在包装对象子值前先兑现 `[[Get]]` 不变量，命中上述不变量时**原样返回裸引用、不抛 `TypeError: 'get' on proxy: property 'x' is a read-only and non-configurable data property …`**（典型来路是 `setState('user', otherStore.$snapshot().user)` 或 `setState('cfg', Object.freeze({ inner: {...} }))`，`stateProtection` 默认就是 `deep: true`），代价是这类属性不受写保护与脏追踪（与 `dirtyTracking` 那条形同豁免的判定同一口径）。要写保护请放在可配置 / 可写的属性上，或经 `setState` / `$patch` 整体替换。
- Map / Set 的判定按「`instanceof` ∪ `Symbol.toStringTag` 标签」取并集，跨 realm 的集合（worker / iframe 传入）同样被识别为集合，内部写入照常过陷阱、挂在其中的子树同样进脏追踪索引。

#### 缓存

| 方法              | 签名                                 | 说明                                                                                                                                                                                                                              |
| ----------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enableCache`     | `(keys?: Array<keyof S>): void`      | 省略 `keys`（`undefined`）表示缓存全部顶层键；**显式传空数组 `[]` ＝一个键都不缓存**（这两条是不同的语义，别用 `Object.keys(state).filter(...)` 的结果去表达「全缓存」——筛空了就变成不缓存）。`createStore` 的 `cacheKeys` 同口径 |
| `disableCache`    | `(): void`                           | 关闭缓存                                                                                                                                                                                                                          |
| `getCached`       | `<K extends keyof S>(key: K): S[K]`  | **缓存的唯一读取入口**，只有它计 `hits` / `misses`                                                                                                                                                                                |
| `invalidateCache` | `<K extends keyof S>(key?: K): void` | 显式失效；省略 `key` 清空全部                                                                                                                                                                                                     |
| `getCacheStats`   | `(): CacheStats`                     | 只读，销毁后仍可调用                                                                                                                                                                                                              |

**缓存是写穿（write-through），不是失效（invalidate）**——这一条决定「怎么读才命中」：

- `setState(key, value)` 与 `$patch` 在写入状态的同时把新值**写进**缓存条目（`$patch` 按合并后的最终值回写），既不清条目也不算未命中。所以「写完再读会重新计算」是错的：下次 `getCached(key)` 仍命中，并且拿到的就是新值。
- `getState()` / `store.state` **完全不查缓存**（直接返回活动引用 / 保护代理）。连续 `getState()` 多少次都不产生 `hits`，`getCacheStats()` 会一直是 `hits: 0 / misses: 0`——想知道命没命中只有 `getCached()` 与 `getCacheStats()` 这一条路。
- 真正的失效入口只有两个：`invalidateCache(key?)`（按键 / 整表）与 `$replaceState`（先整表清空再按新状态回填）。`enableCache()` 本身只做「开关 + 清旧条目 + 预填」，不计命中。
- 小程序集成层的自动注入走的就是 `store.getCached`（`autoInject` / `autoUpdateOnShow`），所以页面侧看到的「缓存生效」是这条路径，不需要手写 `getCached`。

action 完成时，缓存刷新同时检查已有缓存键与当前状态键，移除已被 `delete this.state.key` 删除的条目；`$replaceState` 则先清空整个键级缓存再按新状态回填。不要依赖 action 尚未完成时 `getCached` 已反映直接变异。

实现这些动作的 `StoreCacheManager` 只由内部 barrel（`src/core/store/index.ts`）出口，该子路径不在 `package.json` 的 `exports` 映射里；它原先那个「按旧状态键清理」的入口 `clearOldState()` 已从类面移除——`$replaceState` 走的 `invalidate()` 整表清空才是可达语义，按键遍历会漏掉已从状态里删除的键。

#### 插件与生命周期

| 方法      | 签名                           | 说明                                     |
| --------- | ------------------------------ | ---------------------------------------- |
| `use`     | `(plugin: Plugin): () => void` | 返回卸载函数；`install` 抛错会回滚入列   |
| `hooks`   | `HookSystem`                   | `on` / `emit` / `size` / `listenerCount` |
| `destroy` | `(): void`                     | 销毁后所有写操作抛错（只读统计仍可用）   |

> 除 `getCacheStats` 等只读操作外，销毁后调用任何方法都会抛 `[GeomStore] Cannot call … on a destroyed Store`。

### 工具函数

```ts
import {
  isObject,
  isPlainObject,
  isFunction,
  isArray,
  isPromise,
  shallowEqual,
  deepEqual,
  deepMerge,
  get,
  set,
  noop,
  identity,
  uniqueId,
  clone,
} from '@openlide/geomstore'
import type { CloneMode } from '@openlide/geomstore'
```

| 函数                            | 说明                                                                                                                                                                                                            |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shallowEqual` / `deepEqual`    | 仅比较**自有属性**。`deepEqual` 是迭代实现（栈安全）→ 注 1                                                                                                                                                      |
| `deepMerge(target, ...sources)` | 仅对纯对象递归；其余类型整体替换；内置循环引用防护（WeakMap 配对跟踪）。整体替换走 `clone` 默认档，因此类实例 / `Promise` / WeakMap 等不可安全克隆的值是**按引用**并入 `target` 的（`$patch` 的共享来源即此处） |
| `clone(value, mode?)`           | `mode`: `'deep'`（默认）/ `'shallow'` / `'safe'`（尽力且绝不抛错）/ `'json'`（有损）→ 注 2                                                                                                                      |
| `uniqueId(prefix?)`             | 递增唯一 ID                                                                                                                                                                                                     |
| `get` / `set`                   | 路径读写（`set` 遇到中间路径为原始值时不静默替换）                                                                                                                                                              |

**注 2 · 各 `mode` 的保真边界**：`'deep'` 下数组保留**空洞**与非下标的自有属性（`length` 之外的槽位性质与附加属性都跟着还原，副本与源在 `deepEqual` 下等价）；Date/RegExp/Map/Set/Array 的**子类**实例按引用返回——其构造参数与内部槽位不可知，重建必然得到丢方法的残缺副本，所以克隆后与活状态共享同一实例。`'shallow'` 只展开有「保类型的一层展开」办法的容器：类实例 / Error / WeakMap / Promise 返回**原引用**（不会得到丢掉全部方法的空壳），null 原型对象的副本仍保留 null 原型。

**注 1 · `deepEqual(a, b, maxDepth?)` 的四条判据**：① 默认深度预算 1000，**超出即判不等**，且一次顶层调用内只告警一次（告警状态随每次比较创建，重入的 `deepEqual` 各自计一条）；深度沿 `Set` 元素同样累加，不跨 `Set` 归零；`symbol` 键与不可枚举属性不参与比较。② 内建类型一律**先判原型一致、再判内容**：Date 比时间值、RegExp 比 `source`+`flags`、Map 比键集（键按引用）与值、Set 比无序元素、**装箱原始值比 `valueOf()`**（`new Number(1)` ≠ `new Number(2)`；`Object.keys` 对它们是空的，只比键集会漏）。③ 原型优先的直接后果是**子类实例与基类实例判不等**（空的 `class MyMap extends Map` ≠ 空的 `new Map()`）——这是默认比较器最关键的一条：判错方向产生的「假相等」会让选择器命中并返回陈旧值。④ **自反性优先于深度预算**：`deepEqual(x, x, n)`（含同一原始值）在任意 `n` 下都是 `true`，即使该引用恰好落在 `maxDepth` 上，选择器缓存因此不会白算一次。`shallowEqual` 则对 Date/RegExp/Map/Set 按内容比较。

### 钩子与插件

```ts
interface IHookSystem {
  // 处理器形参与 emit 实参都按钩子名从 HookArgsMap 取，写错参数个数/顺序即编译错误
  on<K extends HookName>(hookName: K, handler: HookHandlerFor<K>): () => void
  emit<K extends HookName>(hookName: K, ...args: HookArgsMap[K]): void
  clear(hookName?: HookName): void
  size(hookName?: HookName): number         // 量纲随入参变化：无参＝钩子名称数，带参＝该钩子的处理器数
  listenerCount(hookName: HookName): number // 数某个钩子挂了几个处理器，请用这个无歧义版本
}

type HookHandler<TArgs extends unknown[] = unknown[]> = (...args: TArgs) => void
type HookHandlerFor<K extends HookName> = IsUnion<K> extends true ? HookHandler : (...args: HookArgsMap[K]) => void

usePlugin<S extends State, A extends Actions, G extends Getters<S>>(
  plugin: Plugin<S>,
  store: Store<S, A, G>,
): () => void
```

> `HookHandler` 的第二个类型参数（旧的 `TResult`）已删除：`emit` 一律忽略处理器返回值，需要否决请抛异常。精确形参在插件侧（`install(store)` 拿到的 `Store` 接口）已生效；`createStore(...).hooks` 直连调用目前仍是实现类 `HookSystem` 的擦除签名（该字段声明为实现类类型），待源码把位点换成 `IHookSystem` 后统一。

> **`emit` 的失败语义**：逐个处理器 `try/catch`，单个抛错既不中断其余处理器也不传播给 `emit` 调用方；错误先 `console.error` 再转投 `onError` 钩子（`emit('onError', error, hookName)`），`onError` 自身抛错只落 `console.error` 不递归。要让异常冒泡到业务方请走 action 的错误边界，不要指望钩子。

- `on()` 返回的退订句柄是**一次性**的：第二次调用是 no-op，不会顺带摘掉后来建立的同函数注册（`off1() → on(同一 handler) → off1()` 之后那份新注册仍在册）。

**钩子名**：`beforeDispatch` / `afterDispatch` / `beforeSetState` / `afterSetState` / `beforePatch` / `afterPatch` / `beforeReplaceState` / `afterReplaceState` / `beforeGet` / `afterGet` / `onError`。

**插件契约**：`{ name: string; install(store: Store): (() => void) | void }`。

> `usePlugin(plugin, store)` 的泛型从 `store` 反推，传入具体 Store **无需断言**；`plugin` 需与其状态类型匹配，状态无关的插件写作 `Plugin<State>`（如 `loggerPlugin`）。日常也可直接用 `store.use(plugin)`（返回值同为卸载函数）。

### 小程序集成

```ts
withPageStore<S, A, G, O>(store, options?: ConnectOptions<S, A, G>): <C>(config: C) => PageThis<...>
withComponentStore<S, A, G, O>(store, options?: ConnectOptions<S, A, G>): <C>(config: C) => ComponentThis<...>
withAppStore<S, A, G>(store, options?: ConnectOptions<S, A, G>): <C>(config: C) => C
```

**`ConnectOptions` 映射形式**（三端一致）：

| 字段         | 简写             | 别名                         |
| ------------ | ---------------- | ---------------------------- |
| `mapState`   | `['isLoggedIn']` | `{ loggedIn: 'isLoggedIn' }` |
| `mapGetters` | `['greet']`      | `{ hello: 'greet' }`         |
| `mapActions` | `['login']`      | `{ doLogin: 'login' }`       |
| `inject`     | —                | 注入额外值 / 方法            |

- `onUnload`（Page）/ `lifetimes.detached`（Component）先执行用户生命周期，再在 `finally` 中清理订阅与映射 actions；用户钩子同步执行期间仍可调用映射方法，抛错也会完成清理。包装器**不等待异步钩子返回的 Promise**，不要在 `await` 后依赖仍存在的映射方法。App 级绑定不随 `onHide` 清理。
- 组件生命周期必须写在 `lifetimes` 字段内；配置顶层的 `attached` / `detached` 不会被执行
- 三处集成的配置方法内 `this` 均已注入（`PageThis` / `ComponentThis` / `AppThis`），**无需手写 `this` 标注**；Component 的注入方法与 `data` 同时出现在顶层与 `methods` 下（微信会把 `methods` 条目提升到实例）
- 类型分工：`PageThis` / `ComponentThis` / `AppThis` 描述**方法内的 `this`**（含实例侧注入的 action）；装饰器**返回的配置对象**由 `PageConfig` / `ComponentConfig` 描述，不含这些实例侧成员
- `mapState` 对象值仅在引用未变且对应顶层键未变脏时跳过更新；`mapGetters` 等没有脏键信息的对象映射保守下发。原始值按值比较；`undefined` 字段被过滤（清除字段请用 `null`）。本地键写作 `__proto__` 时同样会进入 `setData` / `globalData` 载荷（累积器与 App 侧写 `globalData` 一律按自有属性写入，不再被 `[[Set]]` 吞成宿主对象的原型而静默丢键）。
- `autoInject` 建立注入映射后，再开 `autoUpdateOnShow` 会在**页面 `onShow` / 组件 `pageLifetimes.show` / App `onShow`** 按 `getCached` 重新注入一次（App 侧走 `onShow` 而非 `onLaunch`，`onLaunch` 时尚无缓存的键因此在 `onShow` 那一轮补上）；App 的 `globalData` 尚未建立时只转发用户 `onShow`、不注入，用户钩子由 `try/finally` 保住，注入失败不会吞掉它。宿主 `globalData` 上已有同名成员会被映射值覆盖，开发模式一条 `[withAppStore] globalData 已有成员 … 将被 store 映射值覆盖` 告警。
- 绑定段（解析映射 → 订阅 → 注入）抛错时**回滚已建立的订阅**、告警并把原错误抛回框架，不留「方法已合并但无订阅」的中间态（Component 的 `methods` 合并并入同一段）。
- `exposeStoreAPI` / `bindActions` 遇到宿主上不可重写的同名成员（非 `configurable`、或只读数据属性）时**跳过该键并汇总一条告警**，不再中途抛错让整批注入失效；写入按 `defineProperty` 落自有属性，宿主只有继承来的同名访问器时不再触发其 setter，解绑按原描述符回放。
- **`mapActions` 与组件自身同名方法**：Component 侧与 Page / App 的 `bindActions` 同口径——合并前先检查 `ComponentConfig.methods` 的自有同名键，命中就 `console.warn` 点名冲突方法与其对应的 action，并把原值登记进遮蔽表；**绑定期间 action 仍优先**（映射必须生效，这与 Page / App 一致），`detached` 时**有遮蔽原值就按自有属性回放原方法**、没有才 `delete` 掉绑定的那个，所以组件自己的方法不会在解绑后消失（页面复用同一实例形状时不出现「按钮点不动」）。App 侧 `globalData` 的覆盖告警覆盖映射键与 `autoInject` 的**注入目标键**两类，注入进去的同名成员被覆盖不会无声
- 底层绑定工具 `parseMapping` / `bindMappings` / `bindActions` / `performAutoInject` / `exposeStoreAPI` / `cleanupBindings` **不在主入口**，需从 `@openlide/geomstore/integrations` 引入（已在 `exports` 声明）；日常优先使用上述高阶函数
- 类型层的三条口径：`mapState` 与 `mapGetters` 撞到同一个本地键时，该键的类型取**赢家（getter）的返回类型**而非 `never`；`AppThis` 上名为 `globalData` 的 action 让位——`this.globalData` 是数据对象、不可调用，需要调用请起别名 `mapActions: { setGlobalData: 'globalData' }`；`PageReservedKeys` 清单补 `onRouteDone`（该键不再被当作用户方法）

### 组合

```ts
composeStore(stores: StoreLike[], options?: ComposeOptions): ComposedStore
createStoreTree(config: StoreTreeNode, options?: ComposeOptions): ComposedStore
class StoreRegistry { register / get / has / delete / list … }
export const globalRegistry: StoreRegistry
```

| `ComposeOptions` | 默认    | 说明                                                             |
| ---------------- | ------- | ---------------------------------------------------------------- |
| `namespace`      | `false` | 子 store 按 `name` 嵌套，dispatch 使用 `'store/action'` 斜杠路径 |
| `strict`         | `false` | 冲突与非法访问按严格模式处理                                     |

> **`lazy` / `tree` 与 `NamespaceConfig` 是「已声明、未实现」项**：三个名字都还在公开类型面上（`ComposeOptions.lazy` / `ComposeOptions.tree` 与 `NamespaceConfig`，后者经 `core` / `compose` / `plugins` 三个入口再导出），但运行时**零消费方**——`composeStore` 与 `createStoreTree` 的构造函数只读 `options.namespace` 与 `options.strict`，命名空间分隔符在实现里硬编码为 `'/'`（`separator` / `autoPrefix` 无人接受）。写了编译通过、静默无效，**不要按它安排懒加载或前缀策略**。是否在 0.7.0 一并删除是一个尚未拍板的公开决策（删成员与删导出都是破坏性变更），当前口径是「标注未实现、不静默删导出」。

`ComposedStore`：`getState` / `dispatch`（支持斜杠路径）/ `subscribe` / `isStateKeyDirty`（形参同为 `string | symbol`）/ `hooks` / `$patch` / `$replaceState` / `destroy` 等，语义与单 Store 一致。导出的类型别名 `ComposedStore<S extends State = State>` 的形状是 `Store<S> & { stores }`——直接交叉同一份契约，而不是手抄 `name/state/stores` 三件套，实现类增删成员时这里会编译报错而非让按别名书写的调用方静默少 API。

- `$patch` / `$replaceState` 在**命名空间 + `strict`** 下是原子操作：先完成全部子 store 查找与严格校验再统一写入，校验失败时一个 store 都不写（不留「前一半已落库」且调用方无法回滚的半更新态）。
- 子 store 在写入期间被销毁时，只有「销毁守卫」那一类异常被静默跳过；同一 tick 内该订阅者回调抛出的其它真实故障（状态保护拦截、监听器自身抛错）**照常冒泡**给调用方。
- **子 store 在组合之外被独立销毁后的读取语义**：三条读路径（`composed.getState()` / `composed.$snapshot()` / `composed.state`）的取值统一过同一个容错包装——**该子 store 按空视图并入**（其余子 store 照常可读、都不抛错），并按 store 去重**一次性告警** `[composeStore] 子 store "<name>" 已销毁，读取按空视图处理（其余子 store 不受影响）`；平铺模式的键归属判定（`findTargetStoreWithKey`）不对死店调 `getState()`，合并缓存的版本校验把「已销毁」编成哨兵值，避免死店销毁前并入的键被当作新鲜数据继续读。**读写同一口径**：都不抛，都跳过，都只告警一次（写路径 `$patch` / `$replaceState` / `startBatch` / `endBatch` 同样是「已销毁即跳过 + 一次性告警」）。要判归属请用显式的 `store.destroyed`，别把「读得到」当成「还活着」。
- **命名空间模式下子 store 名字是路由键**（构造期一次性校验）：`name` 为空串或含 `'/'` 时**抛错**并点名不合法的名字——这类名字不校验就会「读得到写不进」（`'user/info/count'` 被按首段解析成 store `user` + 键 `info/count`，该子店在 `setState` / `getCached` / `dispatch` / `getter` 上永远路由不到）。平铺模式下 `name` 不参与路由（只是 `stores` 映射的键与告警文案），因此同样只开发模式告警、不抛错。名字为 `'__proto__'` 是**合法**的：映射按 DefineOwnProperty 语义承载，不会被 `[[Set]]` 吞成状态对象的原型。
- `getState()` / `state` 的合并缓存在读取前校验子 store 版本，批内或 `notify.async` 尚未通知时也能读取最新状态；无版本号的子 store（含嵌套组合）保守地在每次读取时使缓存失效。
- `actions` 汇总子 store 的 action 名称，外层非命名空间组合可以把裸名 `dispatch('increment', ...args)` 路由到内层非命名空间组合；同名 action 取第一个。命名空间模式仍使用 `'store/action'` 路径。
- 非命名空间组合包含**命名空间内层**时，其子 store 的键以「子 store 名/键」出现在合并状态里：读写用完整斜杠路径（`setState('leaf/count', 1)`、`$patch({ 'leaf/count': 2 })`），构造期会在开发模式提示书写形式。`$replaceState` 不支持该路径（整树替换需按内层命名空间形状传值）。该路由判定**只看数据形状**，与 `warnMissingKeys`（`$replaceState` 的丢键告警开关）无关，开发/生产走同一分支
- 通知回调内的重入写入会把对应子 store 记为「下一轮的脏」：本轮收尾只作废本轮脏键（与单 Store 的 `_deferredDirtyKeys` 同口径），集成层对稳定引用对象值的「未变化」跳过判定因此不会漏更新。覆盖注册子 store 时，旧实例 `destroy()` 抛错只记日志，注册一定会完成
- `globalRegistry` 的作用域是**进程内**，不是「当前模块副本」：它存放在 `globalThis` 的品牌槽位（`Symbol.for('@openlide/geomstore:store-registry')`）上，同一进程里的多份包副本（分包各自打包、宿主库把本库一起打进来、ESM 与 CJS 双份）拿到的是**同一个**注册表（它不是模块级常量，副本各持一册会让 A 副本 `register` 的 store 在 B 副本 `get` 不到、`setDefault` 也不同步，两侧都「成功」而静默丢引用）。键名带包名命名空间但**不带版本号**（加版本会重新制造副本分裂）。`globalThis` 被冻结 / 该符号键不可写时退回本副本私有实例并出声一条告警（宁可退回单副本语义也不抛错，但副本分裂必须可见）
- `StoreRegistry` 的别名与实例同生命周期：一个实例被登记在多个名字下时，`unregister(name)` 与同名覆盖注册会一并摘除该实例的**全部**名字并只销毁一次（不存在其余名字继续返回已销毁实例的窗口）。`clear()` 的契约是「进入本方法时在册的条目全部注销」——destroy 回调里重入 `register()` 新增的条目会保留，`size()` 因此可以不为 0。缺 `destroy` 的鸭子类型实例不会以 `TypeError` 收场，`register()` 无效 store 的文案统一为 `[StoreRegistry] Invalid store object for name "<name>"`。幂等重注册与覆盖注册的两条提示**只在非生产输出**（幂等那条同时由 log 降为 debug）

### LRUCache

```ts
new LRUCache<K, V>(options?: CacheOptions)
```

| 方法                                       | 说明                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `get` / `set` / `has` / `delete` / `clear` | 基础读写（命中刷新顺序）                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `getOrSet(key, factory)`                   | 未命中时计算并写入（未命中计入 `misses`）                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `resize(size)`                             | 调整容量：只接受**有限值**并夹到 `≥ 1`（小数不取整，实际条目数为向下取整）；`NaN` / `Infinity` 保持当前容量不变                                                                                                                                                                                                                                                                                                                                                                                  |
| `getStats(): LRUCacheStats`                | `hits` / `misses` / `size` / `avgAccessTime` / `missRate`。`hitRate` / `missRate` 为 0–100 的百分比（两位小数），`totalAccesses === 0` 时两者同为 0，需先看 `totalAccesses`；`avgAccessTime` / `avgItemLifetime` 的 `0` 兼作「无样本 / 未开启计时」哨兵。`evictions` 计的是 `onEvict` 触发次数（配置性清空亦计入）；`keys` 为字符串化后的键，需要原始键请用 `keys()`                                                                                                                             |
| `forEach(fn)`                              | **进入时取一次键快照**再逐键回查：回调内删除当前项、删除后面的项、重排顺序都不会漏访问未删条目，也不会回调已删条目（该键此刻不在表里就跳过）。遍历期间**新写入**的键本次不访问；值取回调时刻的当前值（不是进入遍历时的快照）。不采用「预取后继再回调」的手动链表遍历——那会有两类静默失真（摘链会把 `prev/next` 置 `null` ⇒ 后继可能指向已删节点而多访问一条已删数据，且 `next === null` 会让剩余条目整体被跳过）。**行为变更（对外语义收紧）**：不要在回调里依赖「本次一定能看到刚 insert 的键」 |

---

## extras/snapshot（快照）

```ts
createSnapshot<T>(data: T, options?: SnapshotOptions): SnapshotResult<T>
createSnapshotAsync<T>(data: T, options?: AsyncSnapshotOptions): Promise<SnapshotResult<T>>
class SnapshotManager { createSnapshot / createSnapshotAsync / compareSnapshots }
export default SnapshotManager
```

| 选项                   | 默认    | 说明                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxDepth`             | —       | 超限节点返回占位符（**不是活引用**）。同步引擎是递归实现，故另有一条与选项无关的**栈安全硬上限 1000**：生效上限为 `min(maxDepth, 1000)`（`maxDepth` 传 `NaN` / `Infinity` 时也落到 1000），超出部分按 `maxDepth` 降级——落一条 `maxDepth` 错误 + 占位，**不影响 `success`**。异步引擎按队列逐节点处理、栈深度与数据深度无关，不叠加该硬上限，超深结构走异步路径 |
| `detectCircular`       | `true`  | 是否上报循环引用（防护始终生效）                                                                                                                                                                                                                                                                                                                               |
| `includeNonEnumerable` | `false` | 是否包含不可枚举属性。语义是「带进来并且读得到」：**打开后它们进克隆产物就是可枚举的**——同时进 `Object.keys`、`JSON.stringify` 与 `compareSnapshots` 的键集比对（diff 侧唯一的下游读者就是可枚举键集），状态上挂的不可枚举版本号 / 计数标记在两次快照之间的变化因此看得见；`writable` / `configurable` 按源还原，只有 `enumerable` 这一位是**故意改写**的      |
| `customCloner`         | —       | 自定义克隆；返回 `undefined` 表示交回默认流程                                                                                                                                                                                                                                                                                                                  |
| `batchSize`            | `100`   | 异步模式的单批节点数（批间让出控制权）；归一化对**构造期默认值与逐次调用合并后的值**生效（`0` / 负数 / `NaN` 回退默认，不再产出「success 却 data 为空」的半成品）                                                                                                                                                                                              |
| `batchInterval`        | `0`     | 批间隔（毫秒）；`Infinity` / `NaN` 按 `0`（无延迟）处理                                                                                                                                                                                                                                                                                                        |
| `timeout`              | —       | 超时后中断并置 `success: false`；非法值一律按「不设超时」→ 注 3                                                                                                                                                                                                                                                                                                |
| `onProgress`           | —       | `(progress: SnapshotProgress) => void`；**抛错被就地兜住**（落一条 `unknown` 账、不影响 `success` 与克隆结果），首次异常后不再调用。`total` / `percentage` 是近似值（估算深度上限 10），别当完成判据                                                                                                                                                           |
| `onError`              | 见下    | `(error, context) => boolean \| void`；按**真值**解释，falsy＝拒绝继续 → 注 4                                                                                                                                                                                                                                                                                  |

**注 4 · `onError` 的判定与分岔**：判定写法是 `if (!shouldContinue)`，所以 truthy＝忽略该错误并按种类降级、falsy（含不写 `return` 的 `void` 写法）＝拒绝继续。拒绝的后果分岔：`cloneError` → 抛 `SnapshotAbortError`、整次快照 `success: false`；`circular` → 该位置写 `'[Circular Reference]'` 占位并继续（快照仍可 `success: true`）。纯观测请显式 `return true`，或改用 `onProgress`；`maxDepth` / `timeout` 两类不经本回调。`context` 只有 `path` / `depth` / `value` 三个键，按错误种类分流请读 `error.type`。

**注 3 · `timeout` 的两个反直觉处**：① `0` / 负数 / `Infinity` / `NaN` 一律按**不设超时**处理——`Infinity` 经宿主 `setTimeout` 会被夹成约 1ms，若照用就变成一次莫名其妙的立即超时。② 判据是**「确实有货没交付」**：只有「队列里仍有未处理任务，或超时之后丢掉过入队任务」才让整次快照 `success: false`；收尾竞态下（克隆已完成、只是被超时定时器撞上）交付的完好克隆按成功处理，不会出现「`data` 完整却 `success: false`」的自相矛盾结果。不变量 `success: false ⇒ errors` 非空 始终成立。

**`SnapshotResult<T>`**

| 字段       | 说明                                                                                                                                                                                                                                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data`     | 类型是 `T \| undefined`（与「失败时为空」的实现对齐，不声明成 `T`）：隔离副本；**异常 / 中止 / 根节点被丢弃时为 `undefined`**（失败结果绝不回传活引用）。刻意不做成以 `success` 判别的联合——异步超时会交出半成品，且自造结果对象的调用方会转红                                                        |
| `success`  | 无 `cloneError` 且未超时（`circular` / `maxDepth` / `onProgress` 属已降级项，不参与判定，故 `success: true` 且 `errors` 非空是合法状态）。传入已 `revoke()` 的 Proxy 时交付 `success: false` 的失败结果，不再向外抛 `TypeError`                                                                       |
| `errors`   | 错误账本（`type` / `message` / `path` / `originalError`）；`circular` 条目**先落账再咨询 `onError`**，账本不再「stats / metadata 有、errors 无」                                                                                                                                                      |
| `metadata` | `id` / `timestamp` / `dataType` / `size` / `nodeCount` / `duration` / `hasCircular` …。`nodeCount` 为实际进入克隆的节点数（同步 / 异步同口径，不含在计数前就被 `maxDepth` 截断的节点）；`size` 为估算值。失败结果的规模项归零（`data` 不可信，按它算出的值同样不可信），`duration` 两条路径都如实计算 |
| `stats`    | `cloneOperations` / `circularReferences` / `maxDepthHits` 等。`cloneOperations` 计「产出独立克隆值的节点数」（容器 + Date/RegExp + 按 `onError` 丢弃的降级；原语与函数按引用直返不计），Date/RegExp 节点同样计入；**失败结果交出引擎实际累计到的值**，两条路径同口径                                  |

**克隆的三道准入门槛**：同步引擎（`clone.ts`）与异步引擎（`clone-async.ts`）共用 `core/utils/clone` 的同一份判据（`isExactly` / `isSlotBearingBuiltin`），与核心 `deepCloneState` 对同一份 state 给出同一套答案，两条路径同时生效。

| 输入                                                                                                                                                                                                                                                 | 当前表现                                                   | 判据                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `Map` / `Set` / `Date` / `RegExp` / `Array` 的**子类**实例（`class MyMap extends Map`）                                                                                                                                                              | **保留原引用**（快照与活状态共享同一个实例）               | 原型不是该内建类型自己的 `prototype`（判据 `Object.getPrototypeOf(v) === X.prototype`，子类 / 跨 realm 都判假） |
| 状态住在**内部槽位**里的内建值：`Promise`、装箱原始值（`new Number` / `new String` / `new Boolean` / `new Symbol` / `new BigInt`）、`ArrayBuffer` / `SharedArrayBuffer` / `DataView` / 全部 TypedArray、`WeakMap` / `WeakSet`、`Error`、函数与生成器 | **保留原引用**，不产出空壳                                 | 判据用 `Object.prototype.toString` 的 tag ∪ `ArrayBuffer.isView`，跨 realm 仍成立                               |
| 带**附加自有键**的数组（`arr.meta = 'v2'`）                                                                                                                                                                                                          | 除下标外**再补一趟附加自有键**，与 `deepCloneState` 同口径 | `isIndexKey` 过滤掉下标与 `length`，访问器按描述符还原，对象值走异步队列                                        |

这三类值**不参与隔离**：它们的内部状态（子类构造参数、内部槽位、附加键）要么无法安全重建、要么重建后语义就变了，所以引擎选择原样带过去。历史上它们各自被重建 / 丢弃过，后果与迁移写法见 [MIGRATION 的 0.7.0 一节](./MIGRATION.md#升级到-070)。

类实例（原型为普通类）按既有契约**重建为同类实例**（方法 / 继承链可用、不触发构造器与 getter），这是快照与 `deepCloneState` 的**唯一**分叉点。

> **残留边界**：状态不住在自有可枚举属性上、又没有内建 tag 的宿主对象（自定义 native 包装、部分 `wx` 宿主返回对象）识别不到，仍会被重建为空壳。**这类值请用 `customCloner` 提前接管**——它是宿主对象的兜底出口。
>
> **代价要说清**：以上两类值现在与活状态**共享同一引用**，「快照即隔离」对它们不成立（改 `snap.data.myMap` 会串回活状态）。要真隔离请自行 `slice(0)` / 结构化克隆 / 用 `customCloner` 造副本。函数同样按引用直返（无内部状态，共享无副作用）；命中循环引用的位置写 `'[Circular Reference]'` 占位，`onError` 判「拒绝继续」的节点仍按下面的丢弃语义处理。

**隔离契约（丢弃语义）**：无法安全克隆的节点一律丢弃，绝不把原值兜底进快照。

| 容器     | 丢弃时的表现                           |
| -------- | -------------------------------------- |
| 对象属性 | 不写入该属性                           |
| 数组     | 保留位置（留洞）                       |
| `Set`    | 不添加该元素                           |
| `Map`    | 跳过整条 entry（键或值被丢弃时都跳过） |
| 根节点   | `data` 为 `undefined`                  |

其他要点：类实例保留原型；访问器属性以**描述符里捕获的那个 getter** 求值（不二次触发，Proxy 上也不再重跑 `get` 陷阱，故陷阱返回值不会串成克隆值；setter-only 属性静默降级为 `undefined` 并还原成可写数据属性，setter 本身不进快照）；`Map` 的 **Symbol 键**按 `String(key)` 生成路径（不会再触 `ToString(Symbol)` 抛错），键与值的失败路径可区分（键失败写成 `path.key[A]`，值失败写成 `path[A]`，同一输入两条路径同口径）；节点的类型判定与外壳构造（`instanceof` / `getTime()` / `Object.getPrototypeOf`）也在错误处理范围内——被代理过的 Date/RegExp/Map/Set 触发陷阱抛错时按节点落 `cloneError` 并咨询 `onError`（异步路径），而不是冒成一条路径含糊的驱动层错误；`ownKeys` 抛错且 `onError` 允许继续时**该节点整体消失**（不再留下源数据里根本没有的 `{}` 空壳，且同时从 `visited` 除名，避免同一源对象的后续引用命中这副被丢弃的半成品）；`customCloner` 抛错语义在同步/异步路径**完全一致**（落账 → 咨询 `onError` → 继续丢子树 / 中止抛 `SnapshotAbortError`）。

`SnapshotManager.compareSnapshots(snapshot1, snapshot2): SnapshotDiff` —— 传入两个完整的 `SnapshotResult`，而非 `.data`；纯函数实现，不依赖实例状态。数组逐元素比较；`Set` 元素与 `Map` 键共用同一套无序配对（第 1 层引用级匹配、第 2 层结构匹配，判等一律以 `Infinity` 深度预算调 `deepEqual`，深过 1000 层的等价键 / 元素不再被报成「一删一增」）。结构匹配的预算护栏按**比较次数**计费（`>2000` 次后该集合退化为一条整体差异），判据与实际开销挂钩；「一侧全对象、一侧全原语」的形状预先过滤，零次深比较。递归按对象对识别循环，等价循环不会仅因重复进入而产生差异；自有 `undefined` 属性的新增 / 删除与键缺失不同，分别报告 `kind: 'added' | 'removed'`，继承属性不参与。**原型不同的对象在任意深度都判为有差异**（浅层的类实例与结构相同的普通对象判不等，不必深过护栏、退化成 `deepEqual` 才成立）。逐路径展开的深度护栏（100 层）保留，但**超出护栏不再无条件记为差异**：退化为迭代式 `deepEqual`（深度预算不限），只有内容确实不同才 `changed`——两侧逐字节相同的超深结构不再永远报差异而让上层缓存全量失效。同步克隆 `cloneDeep` 是**递归**实现（栈深＝数据深度），生效上限为 `maxDepth`（默认 `100`）与栈安全硬上限 `1000` 取小；超深结构请用异步路径。

**`SnapshotDiff.inputTrusted: boolean` 是必填字段**：

```ts
interface SnapshotDiff {
  changed: boolean
  changes: Array<{ path: string; oldValue: unknown; newValue: unknown; kind?: 'changed' | 'added' | 'removed' }>
  timestamp1: number
  timestamp2: number
  inputTrusted: boolean // 新增：两侧 success 全为 true 才为 true
}
```

- **它表达的是「输入不可信」，不是「内容确有差异」**。任一侧快照 `success: false` 时 `inputTrusted` 为 `false`，此时**不再逐路径比对**，而是交付一条 `path: 'root'` 的整体差异并把 `changed` 恒置为 `true`（宁多勿漏）。
- 为什么必须有这一步：失败快照的 `data` 按契约是 `undefined` 或超时半成品，同一入口会给出**方向相反**的两个假结论——两侧都失败时 `data` 同为 `undefined`、会被 `===` 短路成 `changed: false`（「两份都不可用」被报成「两次快照无差异」，据此做回滚判定 / 去重的调用方直接跳过回滚）；两侧都是半成品时，未填充的占位已被摘掉、真实差异恰好落在「两侧都不存在的键」上，同样是静默漏报的 `changed: false`。不可信输入因此不逐路径比对。
- **`changed: true` 现在有歧义**，判定顺序请先读 `inputTrusted` 再读 `changes`：`inputTrusted === false` 时那一条 root 差异不代表内容真的变了。做回滚 / 去重时，不可信输入应当按「保守认为有差异」处理，或干脆回到上游重取快照。
- 该字段**刻意保持必填**（不是可选默认 `true`）：`SnapshotDiff` 只由库产出，返回类型说「一定带这个字段」比可选更诚实。代价是自己构造 `SnapshotDiff` 对象字的调用方（mock / 回放日志）要补上它，属类型层破坏。
- **`Map` 条目路径按「键身份」而不是迭代下标**：值差异记 `root[<String(key)>]`、键增删记 `root.key[<String(key)>]`，与克隆引擎给 `errors[].path` 用的是同一套 scheme，因此 `result.errors` 与 `diff.changes` 对得上同一条目。一条路径只承载一种事实（下标写法会让 `root.key[1]` 既可能是「1 号条目的值变了」也可能是「1 号键被移除」、只能靠 `kind` 分流）；路径不随插入顺序漂移，**可以作为条目身份**用于按 path 聚合 / 去重 / 回放。**`Set` 的增删条目路径是报告序下标**（`[removed:i]` 一类），那不是条目身份。按路径串解析条目的消费方请以这套 scheme 为准，升级对照见 [MIGRATION.md 的 0.7.0 一节](./MIGRATION.md#升级到-070)。
- **内建值按内容比较**：装箱原始值在 tag 相同时按 `valueOf` / `toString` 兜一层，`compareSnapshots({ n: new Number(1) }, { n: new Number(2) })` 报 `changed: true`（这类值按引用进快照，值差异一路活到比对阶段），内容相同的两个实例不误报、同一引用短路。

---

## extras/selector（选择器）

```ts
createSelector<S, R>(selectorFn: Selector<S, R>, options?: SelectorOptions): Selector<S, R>
createMemoizedSelector<S, R>(selectorFn, equalityFn?): Selector<S, R>
createParametricSelector<S extends State, P, R>(
  selectorFn: (state: S, params: P) => R, options?: { ttl?: number; maxEntries?: number },
): (state: S) => (params: P) => R                       // 默认 ttl 5000 / maxEntries 1000（仅原始类型参数侧）
createStructuredSelector<S, R>(selectors: { [K in keyof R]?: Selector<S, R[K]> }): Selector<S, R>
class SelectorFactory<S, R> { execute(state) / withCacheResult() }
class SelectorComposer { createRetrySelector / createRetrySelectorAsync / … }
// 两个重试工厂同时也是子入口的值导出，不必先拿 SelectorComposer：
createRetrySelector<S extends State, R>(selector: Selector<S, R>, options?: RetrySelectorOptions): Selector<S, R>
createRetrySelectorAsync<S extends State, R>(selector: Selector<S, R>, options?: AsyncRetrySelectorOptions): (state: S) => Promise<R>
```

> 类型别名 `Selector` / `ParametricSelector` / `SelectorComposerInput` 的类型参数默认值：`ParametricSelector<S extends State = Record<string, unknown>, P = unknown, R = unknown>`（未标注场景直接写 `ParametricSelector`，不必写满 `ParametricSelector<Record<string, unknown>, unknown, unknown>`）；`SelectorComposerInput` 的第三参数 `R` 可选，`combiner` 的返回位由它给出（只给两个参数时 `R` 取默认 `unknown`，运行行为一致）。显式传参的写法逐字有效。
>
> `ParametricSelector` 描述的是 `createParametricSelector` 的**入参** `(state, params) => R`；工厂的**返回值**（先绑 state、再按参数求值的柯里化形态 `(state) => (params) => R`）由新导出的 `ParametricSelectorFactory<S, P, R>` 描述，可直接用于标注而无需手写。
>
> `SelectorComposer.combine` 的入参类型是 `SelectorComposerInput<S, T, R>`，实现里没有 `as R` / `as unknown as T` 那两处断言（它们本就无运行期效果）。后果：不给 `R` 时它由 `combiner` 的返回类型反推；**显式给出 `R`（`combine<S, R>(…)`）而 combiner 返回别的东西（拼错的属性名、多包一层）一律编译失败**——没有断言把它静默成 `R`。这一处类型判定会拒掉不合型的调用，升级对照见 [MIGRATION.md 的 0.7.0 一节](./MIGRATION.md#升级到-070)。
>
> `createMemoizedSelector(selectorFn, equalityFn?)` 只是 `createSelector(selectorFn, { cache: true, equalityFn })` 的包装，**没有 `snapshotState` 出口**。因此给它传引用相等比较器（`(a, b) => a === b`）得到的是一份「永不命中」的缓存——无版本号的普通对象状态下命中判定是 `equalityFn(内容快照, 当前状态)`，克隆体与活引用永不相等（不返回错值，但 memo 静默失效）。要「只比引用、免整树克隆」请改用 `createSelector(fn, { cache: true, equalityFn, snapshotState: false })`。它的 `equalityFn` 形参与 `SelectorOptions.equalityFn` 是同一条签名 `(a: any, b: any) => boolean`，因此 options 位能写的业务比较器在这个位置参数位同样能写；两条入口的方差口径由 `tests/types/selector-equalityfn-variance.typecheck.ts` 一起锁住。

| `SelectorOptions` | 默认        | 说明                                                                                                                                                                                    |
| ----------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cache`           | `true`      | 是否启用缓存                                                                                                                                                                            |
| `cacheSize`       | `10`        | 历史条目容量；归一化为 `Number.isFinite(v) ? Math.max(1, v) : 10`（`0` / 负数夹到 1，不会关掉历史命中）。与 `cacheTTL` / `equalityFn` / `snapshotState` 一样只在 `cache: true` 时被读取 |
| `cacheTTL`        | `5000`      | 缓存生存时间（毫秒）。非「有限正数」一律回落 5000；`Infinity` 有意放行 → 注 5                                                                                                           |
| `equalityFn`      | `deepEqual` | 无状态版本号时的回退比较器——**比较的是输入状态**（`S` 形状）而非选择器结果 → 注 6                                                                                                       |
| `snapshotState`   | `true`      | 状态**无版本标记**时用什么当失效凭证：`true`＝比内容（深拷贝一份状态），`false`＝比引用。默认 `true` → 注 7                                                                             |

**注 7 · 为什么默认是 `true`、`false` 什么时候才安全**：任何**深**比较器（`deepEqual`、lodash `isEqual`、`(a,b)=>deepEqual(a,b)` 包装）只有 `true` 这一种正确形态——缓存活引用会让两个实参是同一个对象、深比较恒等，就地变异完全看不见，TTL 内持续返回陈旧值。`false` 只在 `equalityFn` 本身就是引用相等（`(a, b) => a === b`）时可用，此时快照与活引用永不相等、缓存**永不命中**，换来的是省一次整树克隆；前提被违反的代价就是返回陈旧值。状态带版本号时本选项不参与判定。

**注 6 · `equalityFn` 为什么是 `(a: any, b: any) => boolean`**：本类型不随 `S` 实例化，若形参写 `unknown`，在 `strictFunctionTypes` 下会**拒掉调用方按具体状态标注的比较器**（`(x: OrderState, y: OrderState) => x.id === y.id` 报 `TS2322: Type 'unknown' is not assignable to type 'OrderState'`）。放宽只发生在逆变的形参位，返回值仍受 `boolean` 检查；实现侧传进来的本来就是缓存的 state 与调用方的 state。

**注 5 · `cacheTTL` 的归一化判据**：`typeof v === 'number' && v > 0 ? v : 5000`。回落而非照用的理由：`NaN` 会让 `timestamp + NaN <= now` 恒假 ⇒ 永不过期、就地变异后仍返回陈旧值；`0` / 负数等于关了缓存却仍每次付快照克隆与 push 的成本；未类型化调用方传的字符串会让 `timestamp + '60000'` 变成拼接。**`Infinity` 是有意放行**＝不按时间过期——版本化状态的失效凭证仍是版本号，这条出口有用，所以 `cacheTTL` 不与 `cacheSize` 共用同一个夹取函数（那里 `Infinity` 会让历史无界增长）。

- `createSelector` / `SelectorFactory` 的版本化缓存命中要求**状态对象身份与版本号同时相同**（O(1) 比较）；不同 Store 即使版本号相同，也不会串用结果。状态不带版本号（如传入普通对象）时回退 `equalityFn`（其失效凭证由 `snapshotState` 决定）；版本号存在但内容被就地改过时按版本判定，条目为版本化而输入是无版本号的普通对象时一律 miss。**版本化条目不再常驻一份无人读取的状态快照**：读快照的分支要求 `version === undefined`，版本化路径既不写也不读，因此不再把整棵活状态树钉在缓存值上（条目为版本化而状态标记随后消失时，按内容快照收敛）。写入缓存前会先剔除已过期条目，过期条目不再把仍有效的条目挤出 `cacheSize` 槽位（后果原本是「每次访问多算一次」＋过期条目的快照与结果值继续被强引用）。
- `createParametricSelector` 按参数分别缓存；`ttl: 0` 表示条目立即过期（等同禁用缓存，每次调用重新计算）。`ttl` **刻意不做取值守卫**（与 `SelectorOptions.cacheTTL` 不同口径）：本工厂的读侧判据是 `timestamp + ttl > now`，`0` / 负数 / `NaN` 都退化成「立即过期＝不缓存」，不存在 `cacheTTL` 那种「NaN ⇒ 永不过期 ⇒ 返回陈旧值」的静默劣化，且 `ttl: 0` 已是被用例锁住的公开语义。`maxEntries` 归一化为 `Number.isFinite(v) ? Math.max(1, Math.floor(v)) : 1000`（`0` 夹到 1、小数向下取整、`NaN` / `Infinity` 回默认），它控制**原始类型参数侧**的容量并在写入前清理过期项。**对象与函数参数侧都是 WeakMap**（`typeof === 'function'` 也算 WeakMap 键，函数因此不受 `maxEntries` 的插入序淘汰、闭包捕获的作用域也不会被整片钉住），只有读侧 TTL 判定、没有容量上限与清扫；以复用对象为参数时，原地改内容会拿到陈旧结果（要换引用）。Map / Set 参数的缓存标记用数组承载条目（`['__map', entries]`），用户参数无法伪造标记而串用结果。**状态侧只降级不崩**：`state` 传 `null` / 原始值时返回「每次重算、不缓存」的内层函数，不会把这类值当 WeakMap 键用（那会抛 `Invalid value used as weak map key`）。
- `createStructuredSelector` 以 DefineOwnProperty 语义写入结果（选择器映射含 `__proto__` 键时不会被静默丢弃；其余键走普通赋值）。映射的每个键在类型上可选：省略或放非函数值的键会被**静默跳过**，而返回值仍被断言成完整的 `R`——需要完整性请用 `Record<keyof R, Selector<…>>` 显式声明。
- `createStructuredSelector` 与 `SelectorComposer.combine` **需显式给出状态类型参数**：`S` 只出现在「对另一类型参数取索引」的嵌套位置（`Selector<S, R[K]>` / `Selector<S, unknown>[]`），TS 无法据此反推并会退回约束 `State`
- `SelectorComposer.createObjectSelector` 对状态的**每个键**应用选择器并返回同键名对象（`K` 须为 `keyof S` 中排除 `symbol` 的全部键，而非某一单个键）
- `SelectorComposer.createDebouncedSelector` 返回的 Promise **每次调用都必须被 `await` 或挂 `.catch`**：防抖窗口内的前几次调用共享最后那一个 Promise，选择器抛错时它以 rejection 收尾，无人处理就成 `unhandledRejection`（库不代为 `.catch(noop)` 吞掉——那会让真实失败彻底不可见）。`createDefaultSelector` 只在 selector **抛错**时落一条 `console.error` 后取默认值（返回 `undefined` 走默认值那条合法路径不记日志，否则稀疏字段会按每个 state 刷一次噪音）
- 重试选择器抛出的错误带**不可枚举**的 `attempts` 属性，记录真实执行次数；嵌套重试时内外层的 `attempts` **取较大值**（`0` 与非数值按未标注处理），报出的数字不再偏小。`shouldRetry` 收到的是**规范化后的 `Error`**（`throw 'boom'` / `throw { code: 500 }` 不再是 `message` / `name` 全 `undefined` 的原始值，与 action 家族 `withRetry` 同口径），而返回值与 rejection 原因仍是**原值**——包括 `throw null` / `0` / `''` / `false` 这些 falsy 抛出值，它们不会被丢弃也不会丢标注。`shouldRetry` 自身抛错被隔离为一条 `console.error` 并按「不再重试」处理（抛出的是原始错误 + 真实 `attempts`），异步变体的 `delay` 函数抛错按 0 等待继续。**没有取消入口**：已在执行的 selector 无法打断，提前停止只能由 `shouldRetry` 返回 `false` 表达

---

## extras/action（Action 增强）

```ts
class ActionLoader { constructor(options?: ActionLoaderOptions); wrap(fn, name, setState) }
withLoading(...)                      // loading 引用计数按 (宿主, loading 键) 集中
class ActionExecutor { … }            // 异步 action 执行器
class ActionUtils { … }               // 便捷工具（ActionUtilsOptions）

cancelDebouncedCalls(host, method?)   / flushDebouncedCalls(host, method?)   / disposeDebouncedState(host)
cancelThrottledCalls(host, method?)   / flushThrottledCalls(host, method?)   / disposeThrottledState(host)
                                      // 防抖 / 节流挂起调用的宿主级收尾入口，见下方同名小节
```

| `ActionLoaderOptions` | 默认          | 说明                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `perActionKeys`       | `false`       | loading / error 键是否按 action 名后缀区分                                                                                                                                                                                                                                                                                                                                                                                              |
| `loadingKey`          | `'loading'`   | loading 状态键名（`perActionKeys: true` 时为 `${loadingKey}_${actionName}`）                                                                                                                                                                                                                                                                                                                                                            |
| `errorKey`            | `'error'`     | 写入**错误对象本身**的键名（失败时为 `Error`，成功复位时为 `null`）                                                                                                                                                                                                                                                                                                                                                                     |
| `errorDataKey`        | `'errorData'` | 写入 `{ message, stack, timestamp }`（`errorKey` 的可序列化形态，成功复位时为 `null`）的键名；`getErrorData(name)` 的返回类型即 `ActionErrorData \| undefined`（不需要调用方自己 cast 才能读 `errorData.timestamp`）                                                                                                                                                                                                                    |
| `sharedLoadingCounts` | —             | 共享引用计数表，**仅构造期读取一次**（`setOptions()` 忽略它，原因与不变量归注入方见其 JSDoc）；由 `withLoading` 内部注入，供跨 loader 实例集中引用计数，外部清空时按兜底值 1 递减、不出现负计数。构造期对注入值做一次准入判定（非 `Map` 实例按未注入处理、自建新表），未类型化调用方传错形状不再拖到异步收尾的第一次 `get/set` 才炸。改 `loadingKey` / `errorKey` / `errorDataKey` / `perActionKeys` 会先给派生键补写复位值再丢弃旧记账 |
| `autoLoading`         | `true`        | 是否自动维护 loading                                                                                                                                                                                                                                                                                                                                                                                                                    |

> 上表的默认值是库内**单一来源**（`ACTION_LOADER_DEFAULTS` + `normalizeActionLoaderOptions`，未经 barrel 再导出、不是公开 API）：`ActionLoader` 构造器与 `withLoading` 的注册表分桶签名都从它派生。两侧曾各持一份字面量并漂移过，而签名桶决定「同一宿主上哪些被装饰方法共用一个 loader / 同一份 loading 引用计数」，漂移的后果是配置不同的装饰器落进同一桶（状态键互相覆盖）或该共享的被拆开（`loading` 被提前翻转）。

`wrap` 的 `setState` 为 **`(key, value)` 两参数**签名；包装函数把**自己的 receiver 原样转发**给被包装的 action（`loader.wrap(store.fetchUser, 'fetchUser', …)` 之后再 `wrapped.call(store, …)` 可用，不会 `TypeError`）。一次调用的 `autoLoading` 与三个状态键在调用开始时就按当时的配置快照定格，`setOptions()` 中途改 `autoLoading` 或换键都不影响本次调用的两端（计数不会「加了却减不回去」）；`clear()` 与换键后的 `resetDerivedState()` 会让在途调用整体跳过收尾写状态（代际凭证），不再往别人写过的键补 `false`，共享计数键缺失时只退计数不写状态、也不出现负计数。`ActionLoader.clear()` 会把 loading / error / errorData 派生键复位后再清内部记账（界面上不会残留 `loading: true`）。`ActionHistory.getHistory()` 返回的是**容器副本 + 共享条目**：数组本身可随意排序裁剪，条目按只读对待（改 `history[0].success` 会污染后续 `getStats()`）。`ActionUtils.execute()` 首参按形状判定并在缺 `actionName` 时早失败（抛 `TypeError`，**不经过执行器**，故 `getStats()` / `getHistory()` 不留记录）；目标不是函数同样就地抛错，不再把它写进执行器历史。

### 装饰器

```ts
withLog(name?: string, options?: LogDecoratorOptions)   // options: { sink?, redact?, summarizeInProduction? }
withDebounce(delay?: number)                  // 默认 300ms；非有限值 / 负数归一到 300
withThrottle(interval: number, options?)     // 间隔是第一个位置参数
withCache(options?)
withRetry(options?)
withTimeout(timeout: number, options?)
createDecorator(options?: DecoratorOptions)   // 自定义装饰器：{ before?, after?, onError? }
```

| 选项                                                      | 说明                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LogDecoratorOptions.sink`                                | 输出目标（类型 `LogSink` = `{ log(message, ...data), error(message, ...data) }`），缺省 `console`；生产构建接入统一日志通道或整体 no-op。**sink 自身抛错只告警（走 `console`，避免 sink 故障时递归）：既不中断被装饰的 action，也不把成功的调用改判成失败**                                                                                                                                                                     |
| `LogDecoratorOptions.redact`                              | `(value, phase) => unknown`，`phase` 为类型 `LogPhase` = `'args'` / `'result'` / `'error'`。非生产构建下返回值即最终输出；**生产构建下它后面还要再过一道摘要**（见 `summarizeInProduction`）                                                                                                                                                                                                                                    |
| `LogDecoratorOptions.summarizeInProduction`               | 默认 `true`：生产构建进 `sink` 的一律是不含内容的摘要（类型 / 长度 / 键数），自带 `redact` 也绕不过去——过于宽松或有 bug 的脱敏器不该能静默关掉这道防线。只有显式 `false` 才表示「我确认过，sink 侧自行脱敏」，此时 `redact` 单独决定形态。摘要里的 `Error` 只留 `name`（`message` 属内容且最常夹带凭证，拼进摘要等于在生产留一条外泄路径）；需要消息请在非生产构建看日志，或显式 `summarizeInProduction: false` 并自带 `redact` |
| `ThrottleDecoratorOptions.leading` / `trailing`           | 默认均为 `true`（窗口结束时以**最新参数**补发）                                                                                                                                                                                                                                                                                                                                                                                 |
| `ThrottleDecoratorOptions.assumeAsync`                    | 默认 `false`；为 `true` 时被抑制的调用也返回 Promise（用于「非 `async` 语法但返回 Promise」的方法）                                                                                                                                                                                                                                                                                                                             |
| `CacheDecoratorOptions.ttl` / `keyFn`                     | 默认 `5000`；并发同参调用会 in-flight 去重。`keyFn` 抛错时该次调用退化为「用一次性唯一键、直接执行原方法且不写缓存」，不再让整个业务方法失败（非生产期一条 `[Cache] keyFn threw` 调试日志）；`keyFn` **返回非 `string` / `number`**（箭头函数漏写 `return`、返回对象）时同样按不可缓存处理并降级直调（不会经 `String()` 折成 `"undefined"` / `"[object Object]"` 而让所有参数共用一个键、第二次起拿到别人的结果）               |
| `RetryDecoratorOptions.retries` / `delay` / `shouldRetry` | `retries` 是**首次执行之外**的最大重试次数（总尝试 = `retries + 1`）；`shouldRetry` 收到的是规范化后的 `Error`（`throw 'str'` 被包成带原文的 Error），它抛错按「不再重试」处理（该回调异常上会挂 `cause` 指向真实失败，已有 `cause` 不覆盖）；对外抛出的仍是原始值。`delay` 为正的 `Infinity` 时钳到宿主可表达的 `MAX_TIMER_DELAY`（「能等多久等多久」不该被折成 0 变成紧贴重试），`NaN` / 负数仍按 0                           |
| `DecoratorOptions.before` / `after` / `onError`           | 三个回调**自身的失败都先经 `onError`，再按该回调位置的既有语义传播**。`before` 返回 Promise 时整次调用降级为异步并等它 settle，其 rejection 走 `onError`；`after` 返回 Promise 时只有被装饰方法本身异步才被接回返回值（同步方法必须保持同步返回，此时该 Promise 的 rejection 就地记日志并按 `onError` 上报、不外抛）；`onError` 自身抛错只记日志、不顶替原始失败                                                                |

> 子入口 `@openlide/geomstore/extras/action`（以及聚合入口 `@openlide/geomstore/extras`）公开导出的类型与值：`LogDecoratorOptions`、`ActionStats`、`LogSink`、`LogPhase`、`ActionErrorData`、`RetryOptions`、`TimeoutError` 与值 `TIMEOUT_ERROR_CODE`——取这些名字请走子入口，不必深链到 `ActionLoader.js` / `async-core.js` / `decorators/log.js`。`RetryOptions` 是全库重试语义的唯一定义处（`RetryDecoratorOptions` 是它面向装饰器的**有意子集**：只暴露 `retries` / `delay` / `shouldRetry`，`onRetry` 只有执行器入口提供，两侧选项面并不等价）。

> `createDecorator` **保持被装饰方法的同步 / 异步形状**：同步方法原样同步返回（`const v = obj.method()` 这类按同步契约取值的调用方拿到的就是值本身，不是 `Promise`），返回 Promise 的方法才返回 Promise。装饰非函数描述符（`get` / `set`）在装饰阶段即抛 `TypeError`；包装函数保留原方法的 `name` 与 `length`。返回形状按此约定，升级对照见 [MIGRATION.md 的 0.7.0 一节](./MIGRATION.md#升级到-070)。
> `withTimeout(ms)` 在工厂阶段归一化：`0` / 负数 / `NaN` / `Infinity` 直接抛 `RangeError`（不等方法执行才炸），有限值截到 `2^31-1`。超时错误由全库唯一的构造点产出，带稳定属性 **`code === TIMEOUT_ERROR_CODE`（值 `'ACTION_TIMEOUT'`）**——判定超时请按 code，不要匹配文本；两个入口的消息文本不同（`withTimeout` 是 `Timeout after <n>ms`、`AsyncActionSupport.executeWithTimeout` 是 `Action timeout after <n>ms`）而 code 相同，文本仍属展示契约（改动即破坏性变更）。`executeWithTimeout` 同样**先校验 timeout 再启动 action**：非法值不再让 action 的副作用照发、把一次 `RangeError` 记成一次 action 失败而污染 `getStats()`。

> `withDebounce` / `withThrottle` / `withCache` 按**宿主与方法**隔离状态，支持实例方法与静态方法。复用同一装饰器时，不同 Symbol 方法（即使 description 相同）以及与其字符串表示同名的方法不会串数据。异步判定基于函数原型比较，压缩后依然可靠。

### 防抖 / 节流的宿主收尾入口

```ts
cancelDebouncedCalls(host: unknown, method?: string | symbol): void   // 丢弃挂起的防抖调用（不执行）
flushDebouncedCalls(host: unknown, method?: string | symbol): void    // 立即执行一次（至多一次）
disposeDebouncedState(host: unknown): void                            // 取消 + 释放该宿主的整张防抖状态表
cancelThrottledCalls(host: unknown, method?: string | symbol): void   // 丢弃尚未发出的尾随补发
flushThrottledCalls(host: unknown, method?: string | symbol): void    // 立即补发一次（至多一次）
disposeThrottledState(host: unknown): void                            // 取消 + 释放该宿主的整张节流状态表
```

六个入口都在 `@openlide/geomstore/extras/action`（聚合入口 `@openlide/geomstore/extras` 同样给出）。

| 入口       | 挂起的调用                                                                            | 留下的状态                                                                         | 什么时候用                              |
| ---------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------- |
| `cancel*`  | **丢弃**，原方法不再执行                                                              | 保留（节流仍按旧窗口计时判定后续调用）                                             | 宿主已销毁，收尾写入没有意义            |
| `flush*`   | **立即执行且只执行一次**；无挂起调用时**不凭空执行**（队列已空，再次 flush 是 no-op） | 保留                                                                               | 卸载前还想把最后一次输入 / 滚动位置落盘 |
| `dispose*` | 全部取消（等价于 `cancel*`）                                                          | **整张状态表删除**：节流连窗口计时与异步观测标记一起归零，防抖删掉该宿主的全部槽位 | 卸载点想「一切从简」，只调这一个        |

- 三者都**幂等**：重复调用、对没有挂起调用的宿主调用都是 no-op。`method` 省略时覆盖该宿主上所有被装饰方法；传入时按方法名精确筛选（`Symbol` 键按**身份**匹配，不会因描述串相同而误命中其他方法）。宿主为基本类型 / `null` 时六个入口一律 no-op——与装饰器自身在该场景下的降级口径一致（状态无处存放，装饰器本来就退化为直接放行）。
- **被取消的调用会收到什么**：防抖挂起的每个 Promise 以 `Error('[withDebounce] pending call was cancelled')` **拒绝**——不结算会让 `await` 方永久挂起；库在拒绝前先给每个挂起 promise 补一个 `catch` 处理器，那只消除全局未处理告警，真正 `await` / `.then` 的调用方**仍能看到**这条 rejection。节流**没有**挂起的 Promise：窗口内被抑制的那次调用在**调用时刻**就已返回 `undefined`（`async` 方法或 `assumeAsync: true` 时是 `Promise<undefined>`），`cancel` / `flush` 处理的只是尚未发出的尾随补发；补发是 fire-and-forget，失败就地 `console.error`（与窗口自然到期完全同口径），不会漏成 unhandledRejection，也拿不到返回值。
- **为什么入口以宿主为参数，而不是装饰期发句柄**：装饰器表达式在类定义期求值后即被丢弃，`@withDebounce(300)` 的产物在 Page / Component 实例上无从寻址，卸载点手里只有 `this`。状态表因此从工厂闭包上提到模块级 `WeakMap<宿主, Map<slotKey, 状态>>`——`slotKey` 是每个被装饰方法一个 `Symbol`，按宿主隔离；键是宿主本身，宿主被回收时整条状态连带消失，不是一张需要手动清理的进程级强引用表。
- **不调会怎样**：排程中的定时器回调持有宿主与状态直到窗口 / 延迟到期，期间宿主不可被回收，到点后它仍会调用被装饰方法——通常是往一个已销毁的 Store 里写，得到 `Cannot call … on a destroyed Store`。宿主生命周期短于窗口 / 延迟时，收尾调用不是可选项。
- **与 `withCache` / `withRetry` 的差异**：那两者**没有**对应入口。`withCache` 的缓存表随装饰器实例存活（无 `dispose` 口），`withRetry` 的退避等待定时器无取消口（宿主卸载后在途重试仍会跑到次数用尽），理由与后续议题见 [CHANGELOG](../CHANGELOG.md) 的「Wave E 未收口的四项」。

**页面（`onUnload`）**——`withPageStore` 的绑定清理与它不冲突：用户钩子先执行，绑定随后在 `finally` 中清理，所以收尾调用放在钩子**同步段**：

```ts
class SearchPage {
  @withDebounce(300)
  async search(keyword: string) {
    return fetchSearch(keyword) // 写 store：宿主销毁后不该再发生
  }

  onUnload() {
    // 等待中的搜索一律以「已取消」结算，不再打接口、不再写已销毁的 store
    cancelDebouncedCalls(this)
    // 想在离开前把最后一次输入提交出去，就改用 flushDebouncedCalls(this)
    // 不打算区分语义时，disposeDebouncedState(this) 一句搞定（取消 + 释放状态表）
  }
}
```

**组件（`lifetimes.detached`）**——同一宿主上的多个被装饰方法一次收尾：

```ts
class ScrollComponent {
  @withThrottle(100)
  onScroll(position: number) {
    this.store.dispatch('setScroll', position)
  }

  @withThrottle(200)
  persistPosition(position: number) {
    this.store.dispatch('save', position)
  }

  lifetimes = {
    detached() {
      disposeThrottledState(this) // 两个方法的挂起补发与窗口计时一起清掉
      // 只想丢一个方法的挂起调用：cancelThrottledCalls(this, 'onScroll')
    },
  }
}
```

入口定位的是**调用被装饰方法时的 `this`**（即宿主实例），不是装饰期那个类对象：因此卸载钩子里传 `this` 就能命中状态，手工套用装饰器（`withDebounce(300)(proto, 'search', Object.getOwnPropertyDescriptor(proto, 'search'))`）同样按实例分桶、无需额外句柄。

---

## extras/performance（性能监控）

```ts
class PerformanceMonitor { record(metrics) / getMetrics() / … }
class MetricsCollector { … }
class PerformanceAnalyzer { … }
createAnalyzerPlugin(options?) / analyzerPlugin
```

- `record(metrics)` 会顺手清理超时未结束的计时条目（调用方遗漏 `end()` 时的兜底，防 Map 无限增长）；`start()` 同样执行这条清扫且发生在写入之前，因此「反复 start、从不 end、也不再 record」的调用形状下超时条目照样会被回收
- `record()` **不留存入参引用**：缓冲区与 `logger` 拿到的都是它的副本，调用方复用 / 改写该对象不会篡改已记录的历史指标（副本是无条件的，只在启用内存采样时才复制会让其余场合继续持有调用方对象）
- `maxSize` 一律规范化为「有限、非负、整数」（负数会让 `while (length > maxSize) shift()` 在空数组上死循环，守卫正是为此）；`setOptions({ maxSize })` 与构造器同守卫。`sampleRate` 夹到 `[0,1]`、`threshold` 夹到 `>= 0`，非有限值回退各自默认（`>1` 全采样、负数与 `NaN` 一条都不留这类静默退化都不会发生）；采样判据是 `Math.random() < sampleRate`（`random()` 取值域为 `[0,1)`，`<= 0` 仍会在随机数恰好为 0 那一次留存，而 `0` 的契约是「一条都不留」）
- `getMetrics()` / `getMetricsByType()` / `getRecentMetrics()` 返回**元素副本**（不再交出内部数组或其成员引用）；`MetricsCollector.getAll()` 只复制数组容器、元素与内部共享，按只读对待
- 取「前 N 条」的两个入口口径统一：`getRecentMetrics(count)` 与 `MetricsCollector.getHotPaths(limit)` 对 `0` / 负数 / `NaN` / `Infinity` 一律返回空数组（这类取值与「top-N」的读法不相容，不按 `slice` 的尾部语义解释），小数向下取整
- `analyzeBottlenecks()` 返回的是**全部出现过的操作**按 `avgDuration` 降序分组（未超阈值的记 `severity: 'low'`），不是过滤后的瓶颈子集；分级门槛为均值的 2x / 3x
- **非有限耗时样本不进入耗时聚合**：`duration` 为 `NaN` / `±Infinity` 的样本只计次数（`totalCount` / `exceedThreshold` 照常计入），不参与 `avg` / `max` / `min`；一组样本**全部非有限**时这三项归 `0`（`NaN` / `±Infinity` 经 `JSON.stringify` 会变成 `null`，看板与上报侧无从分辨「没有数据」与「数据坏了」，所以它们不进聚合）。四个派生出口（`getStats()` 的 byOperation、`getHotPaths()`、`analyzeBottlenecks()`、`calculateAvgDurations()`）都走同一条投影，不会外泄 `-Infinity` 初值。被排除的样本数**目前没有对外字段**（`PerformanceStats` 里没有对应项），要区分请自己按 `totalCount` 与耗时项是否为 0 对照
- `analyzeBottlenecks(threshold)` / `detectRegression(threshold)` 的**非法阈值不静默失效**：非有限值（`NaN` / `Infinity`）回退各自默认（16 与 0.2）、负值夹到 0——`NaN` 会让判据整体恒假（瓶颈列表变空、回归检测「一条都没退化」，看起来像「没有性能问题」），负阈值会让每次比较都成立（`0ms` 的操作被判 `severity: 'high'`），这两类取值因此都有确定的归宿
- 阈值预警的 logger 收到的是记录副本（含 `memoryUsage`），`sampleRate` / `threshold` 在构造与 `setOptions` 两侧都归一化
- `exportJSON()` 的 `options` 段是配置的投影且**不含 `logger`**（函数不可序列化，`JSON.stringify` 会静默丢键，显式投影让人知道报告里少了什么），`metrics` 段与 `getMetrics()` / `getStats()` 同源
- `wx.getPerformance()` 的结果按**监控器实例**缓存并校验（不可用形状 / 工厂抛错 / 读数非有限值均降级 `Date.now`）：避免每次计时都新建对象，也避免不同原点的时间戳互减得到失真耗时。**基准降级时作废全部在途计时**并留一条 `console.debug`——wx 时钟（进程相对小值）写的 `startTime` 与 `Date.now()`（epoch ms）混算会得出 ~1.7e12 的 duration，每条都被记成超阈值样本并永久污染 `getStats()` / `exportJSON()`；宁可留监控缺口（`end()` 走既有「计时条目缺失」分支），也不写入跨基准的脏数据
- `analyzerPlugin` 自动接入 dispatch / setState / getter 计时；`onError` **只在来源显式点名配对键时才弹栈**（`'dispatch'` / `'setState'` / `'patch'` / `'replaceState'` 四类），不带来源或带无关来源（如 `persistence`、`subscribe`）一条不弹——误弹的真正后果不是少一条指标而是**配错 span**：`HookSystem.emit` 吞掉处理器异常后 `after*` 照常来，提前弹内层会让 `after*` 弹到外层。同步 dispatch 抛错（`afterDispatch` 永不再来的那条真中止）现在带第二参 `'dispatch'`，因此该次 dispatch 重新产出一条「到抛错为止」的耗时指标。配对栈有 `1000` 层上限，超限时淘汰栈底并 `console.debug` 说明缺口（淘汰栈底不破坏配对，弹栈取的是栈顶）；卸载时若 `store.getter` 已被后续插件重新包装则跳过恢复并告警（disposer 幂等，重复调用不再谎报「已被重新包装」），且还原按「原本有没有自有属性」决定 `delete` 还是原样还回——`Object.keys(store)` 不再留下一个可枚举的绑定函数。`MetricType` 联合里的 `'notify'` / `'subscribe'` / `'plugin'` / `'state-update'` 是**预留维度**、库内不产出（内置插件只写前五种），自定义标签照常可查（`getMetricsByType()` 按精确标签匹配）

---

## extras/plugins（插件实现）

```ts
persistencePlugin(options?: PersistenceOptions): Plugin
loggerPlugin / devtoolsPlugin / timeTravelPlugin: Plugin
builtinPlugins: Plugin[]
class WxStorageBackend implements StorageBackend
```

`timeTravelPlugin(options?)` 安装后通过 `store.__timeTravel__` 提供 `getSnapshots()`、`goTo(index)`、`undo()`、`redo()` 等调试接口。**插件的 `install` 无条件执行**（建快照数组、订阅 store），生产构建下缺席的只是**全局调试入口**：`store.__timeTravel__` 仍然存在，只是不参与类型检查、无对外契约，读取请用 `store.__timeTravel__?.getSnapshots()` 这类判空写法。`getSnapshots()` 对每条历史状态重新使用核心 `deepCloneState` 克隆：修改返回值中的普通对象、数组或 Date/RegExp/Map/Set，不会污染内部历史与后续 `goTo` 恢复值，循环引用也受支持。**这不是 extras/snapshot 的丢弃契约**：类实例、函数、Promise、WeakMap/WeakSet 等不可克隆节点仍保留原引用；不要修改这些共享节点。

| `PersistenceOptions` | 默认                                                 | 说明                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `key`                | Store 名                                             | 存储键                                                                                                                                                                                                                                                                                                                                                                                                |
| `storage`            | 内置 `WxStorageBackend`（wx 三方法齐备时），否则内存 | **必须同步且三方法齐备**：`{ getItem, setItem, removeItem }`。缺任一方法在 `store.use()` 安装期即抛 `TypeError`（不再静默回落到别的后端）；返回 Promise 的实现在恢复 / 落盘 / 清理三条路径上各自明确报错（内置 wx 后端同样受检，Taro / uni-app 类 Promise 版 polyfill 下不再变成未处理 rejection）。**不传时的默认后端就是 `new WxStorageBackend()`**——两条路径共用一份实现，不再各写一套归一化与守卫 |
| `filter`             | 全量                                                 | `(state) => Partial<state>`，指定落盘子集（未被持久化的键保留初始值）。**两条路径都会套上**：落盘前 `filter(state)`、恢复时 `filter(parsedState)` 再 `$patch`——单向理解的写法会让「只持久化子集」的配置在恢复时静默吃掉未过滤键                                                                                                                                                                       |
| `validate`           | —                                                    | 恢复前的数据校验                                                                                                                                                                                                                                                                                                                                                                                      |
| `restore`            | `true`                                               | 安装时是否从存储恢复                                                                                                                                                                                                                                                                                                                                                                                  |
| `debounce`           | `0`                                                  | 写入防抖（毫秒）；卸载时会**同步补写**窗口内最后一次变更。**卸载一律摘掉待触发的定时器**（`clearOnUninstall: true` 也不例外），只有「补写」本身受 `clearOnUninstall` 约束                                                                                                                                                                                                                             |
| `clearOnUninstall`   | `false`                                              | 为 `true` 时卸载改为清理存储（丢弃待写数据）；删除失败不再被吞掉，会记 `console.error` 并 `emit('onError', …, 'persistence')`                                                                                                                                                                                                                                                                         |

> **恢复失败也上报**：载荷不是普通对象、`validate` 拒绝、后端抛错 / JSON 语法错 / `$patch` 被拒这几条出口，除 `console.error` 外都补发 `emit('onError', err, 'persistence')`——只订阅 `onError` 做监控的调用方会看到这一类事件。恢复入口还有一条准入判定：自带 `__proto__` 自有键的载荷直接拒收（深层同名键由 clone / merge 的 `defineProperty` 兜底）。

`WxStorageBackend` 封装 `wx.getStorageSync` / `setStorageSync` / `removeStorageSync`：`getStorageSync` 对缺失键返回**空串**，故 `getItem` 只把**非空字符串**视为有数据（`''`、`undefined` 与非字符串载荷一律按「键无数据」处理）；三个方法的返回值都过异步守卫（返回 Promise 即报错），存储故障一律记录后**抛错**交给调用方（`getItem` 返回 `null` 只代表无数据，不代表读失败——混用会让下一次落盘覆盖真实数据）。**`wx` 全局缺席、或对应那个 `*StorageSync` 方法不存在 / 不是函数时同样抛错**（可选链会把这种缺席短路成 `undefined`、过掉异步守卫，让写入与删除「看起来成功」——`clearOnUninstall` 据此报告已清除而数据仍在——读取被归一化成「键无数据」，随后一次落盘覆盖真实数据）。

- **它是默认后端**：`persistencePlugin` 不传 `storage` 时用的就是这个类（与显式 `new WxStorageBackend()` 同一份实现，归一化与守卫只此一份，两条路径口径必然相同）。四条可观测口径：① `''` 归一为 `null`（`''` 不被当成有数据送去 `JSON.parse`，恢复路径因此不会报一条解析错误）；② 非字符串载荷按无数据处理；③ 报错额外带一条 `[WxStorage] <方法> error:` 日志（既记也抛）；④ 可用性判定要求 `getStorageSync` / `setStorageSync` / `removeStorageSync` **三方法齐备**。三个方法的返回值都过 Promise 守卫：`getItem` 不会把 Promise 洗成 `null`（那等于「有数据误判无数据」，下一次落盘即覆盖真实数据），`setItem` / `removeItem` 同样看返回值。
- **可用性判定**：只有读方法、没有写方法的残缺 `wx`（部分兼容层）不算可用后端，直接走内存降级并给出一次告警信号。
- 检测不到可用的 wx 同步 API 时降级为内存存储（重启即失）：开发模式 `console.warn`，**生产模式改经 `onError` 钩子上报**（`emit('onError', error, 'persistence')`），持久化静默失效从此可被监控发现。降级文案为 `[GeomStore][persistence] 未检测到可用的 storage 后端（非微信环境、wx 同步 API 不齐备，且未传入 storage），降级为内存存储，持久化不生效`——按文案匹配日志的调用方注意括号里新增了「wx 同步 API 不齐备」。
- **实现位置**：类住在 `src/plugins/WxStorageBackend.ts`，与唯一消费方 `persistencePlugin` 同层；`src/types/persistence.ts` 只留 `StorageBackend` / `PersistenceOptions` 两个契约。**公开子入口未变**：`@openlide/geomstore/extras/plugins` 与 `@openlide/geomstore/extras` 上的 `WxStorageBackend` 名字与形状都一致，无需改任何 import。

`timeTravelPlugin(options?)` 另注意：`importHistory()` 会跳过 `state` 为数组或自持 `__proto__` 自有键的畸形条目（这类条目一旦入栈，`goTo` / `undo` 会在核心抛错），**非法 JSON 同样按「畸形数据」静默跳过**，不把 `SyntaxError` 抛出 API（与「结构非法即跳过」同口径，devtools 的导入流程不会因一条坏载荷整体中断）；`undo` / `redo` 在回放成功后才推进索引。`maxSize` 经归一化为「`>= 1` 的整数」，`NaN` / `0` / 负数 / `Infinity` 一律回退默认 `50`（不加守卫的话：`NaN` 会让上限消失、`0` 与负数会让历史恒空并在 `importHistory` 里留下 `clear()` 从不产生的非法索引）。

---

## extras/error（错误处理）

### 错误类族

```ts
GeomStoreError( message, code, context?, name?, cause? )
ActionError / StateError / SelectorError / PluginError / ComposeError / ValidationError
createError(code, message, context?, cause?) / ErrorCode
isGeomStoreError / isActionError / isStateError / isSelectorError / isPluginError / isComposeError / isValidationError
```

- `GeomStoreError` 新增可选第 5 参 `cause`（6 个派生类是第 4 参、`createError` 是第 4 参），实例在提供时带 `cause` 属性；`toJSON()` 相应多一个 `cause` 键（`Error` 值显式投影为 `{ name, message }`，否则通用归一会把不可枚举的 `message` / `stack` 塌成 `{}`）。原有三 / 四位调用与不带 cause 的输出逐字不变
- `toJSON().context` 不再是入参的逐字拷贝，而是**可 JSON 化的等价结构**：循环引用 → `'[Circular]'`、`BigInt` → `'123n'`、取值即抛的访问器 → `'[Unreadable]'`、深过 6 层 → `'[Truncated]'`。目的是让 `JSON.stringify(error)` 不再因一次异常上报而整体抛错；序列化器自身抛错不在此兜底范围内

### ErrorBoundary

```ts
new ErrorBoundary<S, F>(options?: ErrorBoundaryOptions)
withErrorBoundary(boundary, fn?)
```

- **默认 fail-loud**：未配置 `fallback` 时错误重抛；提供 `fallback` 即声明恢复意图（显式 `recoverable` 配置优先）
- `fallback` 计算函数自身抛错时**重抛原始错误**（不丢失现场），且不重复触发 `onError`（`onError` 已就原始错误触发）
- 非 `Error` 的抛出值（`throw 'str'` / `throw 42`）在入口处归一化为 `Error` 后再写入 `errorHistory`、传给 `onError` 与 `fallback`；**重抛时仍是原始值**，捕获方语义不变
- **只对「被包裹方法的原始返回值」做 thenable 判定**：`@withErrorBoundary` 装饰的方法，其**回退值**不被 `await`（带 `then` 的回退值也原样返回，同步方法的返回形状不会凭空变一种）。回退值是边界自己产出的、不是被包裹方法的异步结果；方法本身返回 Promise / thenable 时仍照常等待（判据是 `then` 鸭子类型，跨 realm 与手写 thenable 不漏）
- 显式 `recoverable: true` 而未配 `fallback`（或 `setFallbackState(undefined)`）时 `execute` / `executeAsync` 返回 `undefined`，返回类型为 `T | F | undefined`
- 错误历史上限 100：取库内单一常量 `DEFAULT_MAX_LOG_SIZE`，与 `ErrorHandler.errorLog` 的上限（及其 `setMaxLogSize` 非有限值的回退值）同源同值，不再两处各写一份。`ErrorBoundary` 自身的上限**不对外开放**，`ErrorHandler.setMaxLogSize` 也只影响 `errorLog`；`getErrorHistory()` 可读

### ErrorRecovery

```ts
new ErrorRecovery()
configure(map: RecoveryStrategyMap): void
recover<T>(error: GeomStoreError, context?: RecoveryContext): Promise<T>
clearAllRetryCounts(): void                    // 清空全部重试计数与周期窗（按 code 定点清除不是公开口）
createDefaultErrorRecovery() / defaultErrorRecovery
RecoveryStrategy: { RETRY, FALLBACK, IGNORE, RECOVER, RESTART }
```

- 重试额度按**故障周期**计量：窗口 = `max(60s, 本周期全部退避总时长 × 2)`；超窗视为新周期重置
- `maxRetries` 取值范围是正整数，**写入时归一**：小数向下取整、负数夹到 `0`、**非有限值（`NaN` / `Infinity`）回落到默认 3**。末条是防重试风暴的前提——`currentAttempt >= NaN` 恒为假会让上限彻底失效，`Infinity` 则永远达不到，两者都会让重试跟着调用方的失败循环一路跑下去（配置常来自 `parseInt(untrustedConfig)` 一类输入）
- 达到 `maxRetries` 后**在同一故障周期内持续拦截**：只抛错、**保留**该键的计数与周期窗（清掉它们会让紧接的下一次 `recover` 落进「新周期」分支重新领满额度，「max-retries 防重试风暴」就只对触发超限的那一次调用生效）。要主动放行请显式 `clearAllRetryCounts()`
- 恢复成功只清除**当前键**（`code:storeName:operation`）的计数与周期窗，不级联清除同码其他键（同码不同 store / 操作各自持有进行中的额度）。两个来源都为空时键写作 `CODE:unattributed` 并随超限抛出物的 `context.retryKey` 回传；这一桶是有意的粗粒度兜底，要按 Store 隔离请按第二参传 `{ storeName, operation }`
- 键容量守卫 `MAX_RETRY_KEYS = 1000`：超限时先清自身周期窗已到期的键（每键到期时刻各自算，用一个全局 60s 判过期会连活跃键的计数一起删掉），再按插入顺序淘汰「最早进入当前周期」的键
- 策略执行**内部**失败抛 `GeomStoreError` 而不是裸 `Error`（`code: INTERNAL_ERROR`，带 `cause` 指向原始错误与 `strategy` / `originalCode` / `retryKey` / `attempts` 上下文，消息文本保持稳定），按 `error.code` / `isGeomStoreError` 分类的调用方因此不会把它当成外来错误绕过处理
- 策略表是 `Map`：以 `Object.prototype` 成员名（`constructor` / `toString` …）作错误码时 `getConfig` 返回 `undefined`、`recover` 报「No recovery strategy configured for error code: constructor」，不再命中原型链成员而给出误导性的 Unknown recovery strategy
- `recover(error, context)` 的 `error` / `config` / `attempt` 由库内后写，调用方传入的同名字段无法覆盖实际执行的策略与重试记账键；`attempt` 反映真实重试次数（仅诊断用途）
- 策略回退优先级：`fallbackFn` 在前、`config.fallback` 在后，两者皆缺则抛错；`fallback` 的值可以是 `undefined`（判据是「键是否存在」，别用展开 / 序列化搬运 config）
- `RESTART` 策略不接受配置（库内无引用，只上报意图）

### ErrorMonitoring

```ts
new ErrorMonitoring(config: MonitoringConfig)
report(context) / flushReports() / shutdown() / clear() / addReporter() / removeReporter()
generateReport() / getErrorGroups() / getAggregationStats() / getDroppedErrors()
```

> `reportBatch(errors)` 不在 `ErrorMonitoring` 上，它是 `ErrorReporter` 契约的一侧（监控层在每次 flush 里调 `reporter.report` 与 `reporter.reportBatch`）。

| `MonitoringConfig`  | 默认    | 说明                                                                                                                                                                                                                                                                                                                                          |
| ------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reporters`         | —       | `ErrorReporter[]`                                                                                                                                                                                                                                                                                                                             |
| `batchThreshold`    | `10`    | 达到条数立即 flush                                                                                                                                                                                                                                                                                                                            |
| `batchInterval`     | `5000`  | 定时 flush（毫秒）                                                                                                                                                                                                                                                                                                                            |
| `reportTimeout`     | `10000` | 单个 reporter 的超时（毫秒）                                                                                                                                                                                                                                                                                                                  |
| `enableAggregation` | `true`  | 是否聚合相同错误                                                                                                                                                                                                                                                                                                                              |
| `enableConsoleLog`  | `true`  | 是否输出控制台日志                                                                                                                                                                                                                                                                                                                            |
| `maxQueueSize`      | `1000`  | 队列容量；超容量按最旧优先淘汰。**下限 1**：非有限值回退默认，其余 `Math.max(1, floor(v))`（`0` 会让每条新错误先挤掉上一条、负值会让重入队的 `slice` 算出空数组，整条上报链近乎静默失效——下限因此钉在 1）                                                                                                                                     |
| `maxFlushRetries`   | `3`     | 「全部 reporter 连续失败」的重入队上限，超过则丢弃该批并告警。**下限 0**（负值会让首批立即被丢弃，故夹到 0）                                                                                                                                                                                                                                  |
| `maxGroups`         | `100`   | 聚合器同时存活的**错误组数**上限，达上限按「最近最少出现」驱逐旧组（首次驱逐出声一次，不在错误高发路径上刷屏）。归一化与 `maxQueueSize` 同一条 `normalizeCapacity`：非有限值（`NaN` / `Infinity`）回退缺省 100，有限值取 `Math.max(1, Math.floor(v))`（`0` / 负数 / 小数夹到 1——它不是「关掉聚合」，`maxGroups: 0` 只会让刚建的组立刻被踢掉） |

> `batchInterval` / `batchThreshold` / `reportTimeout` 用 `??` 兜底，**显式传入的 `0` 是合法语义**（立即 / 无延迟），不会被替换为默认值；`reportTimeout <= 0` 一律按「不超时」处理（不创建定时器，直接等 reporter 任务）。

- flush 对每个 reporter 做 `ok / fail / timeout` **三态判定**：仅真正 resolve 才算成功；超时告警后批次重入队（上报先落地时取消未到期的定时器，不留句柄）
- `flushReports()` 排空的是**入口时刻**在册的批次；`isFlushing` 期间的并发调用不会追加排空保证（关闭时的最终 flush 才保证排空）
- `clear()` 同时复位「连续全部失败」计数（否则新批次会被上一次的失败次数提前判定丢弃）、作废**在途 flush 的重入队**（按代际标记整批丢弃，否则上一代条目会回流进新队列），但**不停止调度器**、也**不断**那条已在网络上的请求本体
- 溢出丢弃量是可见的：入队淘汰与失败批次重入队时的超容量裁剪都计入 `getDroppedErrors()`，并随 `generateReport().summary.droppedErrors` 一起出去。`summary.totalErrors` 是「观测到的错误」口径（被丢弃者仍是真实发生过的错误，不回退聚合计数），`queuedErrors` 是「还在队列里」口径——**三个口径互不重叠、不能相加核对**：一条被丢弃的错误在它自己那次 `report()` 里已计入 `totalErrors`，而成功投递过的既不在 `queued` 也不在 `dropped`
- **聚合的两套口径**：`getAggregationStats()` / `ErrorAggregator.getStats()` 的 `totalErrors` / `byCode` / `byStore` **按条独立累计**，不是「把存活组的 count 求和 / 现算」（`sum(byCode) === sum(byStore) === totalErrors` 恒成立，三者自上次 `clear()` 起单调不减），因此 `maxGroups` 驱逐**不会让它们倒退**——「观测到的错误数」这条语义要求已发生过的错误不能被整笔抹掉。另一侧 `totalGroups` 与 `getGroups()` / `getGroupsByStore()` / `summary.topErrors` 只是**当前存活组**的视图，会随驱逐变小；**两者的差额看得见**：`getAggregationStats()` 的 `evictedGroups`（被驱逐的组数）与 `evictedErrors`（随组消失的组内条数）就是那笔留痕，`clear()` 把两套账与留痕一起归零。要看聚合有没有丢数据就读这两项，别拿 `totalGroups` 当「错误种类总数」。`ErrorGroup.sampleError` 是只含标量字段 + `error` 引用的浅拷贝（**不含 `payload`**，避免进程级缓存钉住 store / 页面节点），并随每次命中刷新为最近一次出现；同一指纹的组在邻居被驱逐后仍复用原组 ID（指纹 → 组 ID 是反向索引，不会分裂成两组而把 `count` 归零）
- `affectedStores` 与全局 `byStore` 都有**基数上限**（单组 50 个 Store、全局 200 个键），超出后并入保留字 `__others__` 溢出桶——它不是某个真实 Store，计数已经并进去了，**截断的只是「列得全不全」这份诊断视图，一条错误都不丢**。因此 `getGroupsByStore(name)` 对溢出组「没返回」不等于「该 Store 没在那组里报错」，要按 Store 拿准确条数请用 `getStats().byStore`
- 对外一律给**副本**：`ErrorAggregator.getGroups()` / `getGroupsByStore()` / `addError()` 的返回值、`ErrorMonitoring.getErrorGroups()` / `generateReport()` 里的 `topErrors` / `recentErrors` 都是拷贝（`affectedStores` 与 `sampleError` 各再拷一层），改它们不再污染内部账目；同一次 `generateReport()` 里 `topErrors` 与 `recentErrors` 是同一批副本的两个视图
- 定时器做 `unref` 探测（小程序 / 浏览器无该 API 时自动跳过，不阻止进程退出）

### 上报器

```ts
class ConsoleReporter implements ErrorReporter   // 基础库缺 console.group 时降级为平铺输出
class HttpReporter implements ErrorReporter      // 自动选择 wx.request（校验 statusCode）或 fetch（校验 ok）
defaultErrorHandler / createErrorContext / ErrorHandlerImpl
```

- `ConsoleReporter` 保证 `groupEnd` 恰好一次（`console.group` 存在但调用即抛的基础库下本次降级为平铺输出，并只试探一次）；组内输出自身抛错时**抛的是那条主错误**，不被 `groupEnd` 的异常顶替（`groupEnd` 仍无条件闭合一次，仅它抛错时算一次真实失败）。分组与平铺两条路径打印的字段与批量级别标签一致，残缺 context（缺 `level` / 非法时间戳）不会让上报自身抛错。`Payload:` 行按「是否 `undefined` / `null`」判定打印，因此 **falsy 的载荷（`0` / `''` / `false` / `NaN`）也会输出一行**——这些恰恰是最需要看的诊断值；批量行缺失 store 名时打 `in UNKNOWN:` 而不再是可读成「有个叫 undefined 的 store」的 `in undefined:`
- `HttpReporter` 对 `Headers` 形参数走鸭子类型归一化（真实 `Headers` 实例没有自有可枚举属性，直接展开会得到空对象而丢请求头），并把 `timeout` 透传给 `wx.request`；其余 `RequestInit` 字段在 `wx` 分支被忽略。请求体由 `JsonBody` 直接序列化为字符串，不再走 `stringify → parse → 再 stringify`。两条健壮性收口：`context.error` 不是 `Error`（手搓 / `throw 'boom'` / `null`）时该条被投影成可读字符串而**不再让整个 `report` / `reportBatch` 抛 `TypeError`**（否则同批其余上下文一起被拖成 rejection、监控层还会把它当网络失败反复重入队）；含 `BigInt` / 循环引用的 `payload` 在投影阶段降级为字符串标记（`[bigint 10]` / `[Unserializable payload: …]`），坏载荷只伤自己那一条、批次照常发送。使用默认请求实现时会自动补 `Content-Type: application/json`（自带同名头则原样保留、大小写不敏感判重），而**注入自定义 `HttpRequestImpl` 时不补**——发不发这个头属于「这条请求怎么发」的传输细节，注入实现可能把 body 转投别处
- `defaultErrorHandler` 按级别映射输出通道；`throw null` / `throw 'str'` 之类的抛出值在读取 `message` / `stack` 前统一兜底（非字符串按 `String(error)` 收口），处理器自身不再因取值崩掉而顶替原始失败
- `ErrorHandler` 交给用户 handler 的是**上下文副本**（改 `ctx.level` / `ctx.error` 不再回写 `errorLog`），`getErrorLog()` 返回的条目同样与内部记录解耦（入库即副本，否则调用方事后改自己那份 `ctx` 仍能改写历史）。handler 签名仍是 `(context) => void`，但**返回 Promise 的 handler 其 rejection 折成一条 `[ErrorHandler] Error in error handler:` 日志**（不留未处理拒绝——那在 Node 下可终止进程）；同步 handler 不为此多付微任务。自建调用点的消费方仍需自行处理 Promise——`ErrorHandler` 是公开类型，兜底只在库内入口那一处

---

## extras/enterprise（企业微信集成）

```ts
createUserStore(config)                // 账号态 Store 工厂：{ userId, syncUrl?, initialState?, persistUserInfoKeys? }
                                       // actions: setUserInfo / updatePreferences / syncWithServer / refreshData
class StoreManager { getUserStore / switchUser / logout / getCurrentStore / clearAll }
export const storeManager: StoreManager
initHotUpdate(config) / restoreFromHotUpdate()
class OfflineManager { execute / syncQueue / getQueueLength / getDeadLetters / dispose }
initBackgroundSync(config) / unregisterBackgroundSync()
createEnterpriseApp(config): Plugin
```

**`UserStoreConfig`**

| 字段                  | 默认                           | 说明                                                                                                           |
| --------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `userId`              | —（必填）                      | 非字符串 / 空串 / 纯空白直接抛错（畸形键会让不同账号撞同一存储键）                                             |
| `syncUrl`             | 无默认                         | `wx.request` 接受的绝对 URL；缺省即「本 Store 不具备服务端同步能力」，`syncWithServer` 在发起请求前直接 reject |
| `initialState`        | —                              | 额外的初始状态                                                                                                 |
| `persistUserInfoKeys` | 未设＝整个 `userInfo` 原样落盘 | `readonly string[]`，声明哪些 `userInfo` 字段允许写进本地存储，其余被投影掉 → 注 8                             |

**注 8 · 为什么需要它、缺省为什么不保守**：`syncWithServer` 的响应体 `userInfo` 会被**整体**写进明文的小程序 storage（键 `user-store-<userId>`），服务端顺带下发的 session / token / 手机号因此长期驻留设备。缺省**刻意不作保守白名单**——`UserInfo` 是 `[key: string]: unknown` 的开放形状，内置白名单会让未列出的业务字段在重启后凭空消失（那是破坏性变更），所以收窄必须显式声明。投影按自有键 `defineProperty` 落键。该选项只管 `userInfo`：`preferences` 由宿主自己的 `updatePreferences` 写入，本就不来自服务端响应。

- `getUserStore(userId)` 只「取 / 建」指定账号的 store，**不改变当前登录身份**（切换请显式 `switchUser`）；被 LRU 淘汰或 `logout()` 后的 store 已 `destroy()`，不可继续 dispatch。`clearAll()` 只清内存实例与**当前身份键 `current_user_id`**，不删任何 `user-store-*` 数据键（连带删账号数据会越权，注销请用 `logout()`）。移除 `current_user_id` 是因为它是身份 / 会话标记而非账号数据，与内存里的 `currentUserId = null` 属同一次清理；依赖「`clearAll()` 后冷启动仍恢复旧身份」的宿主需要在调用后自行把该身份键写回存储（键名是 `current_user_id`，库内常量 `CURRENT_USER_KEY`，不在公开导出面上）。
- **`logout()` 的清理范围（安全口径）**：账号 store 的持久化键 `user-store-<userId>` + 当前身份键 `current_user_id` + 该 store 的离线队列键 `offline_action_queue_<store name>` **及其死信键**（`..._dead_letter`）。后两类键必须一起删：队列载荷是明文 storage 里的操作参数（可能含用户数据），留着它们还会让**重新登录把登出前的操作重放一遍**（`login()` 的构造期 `loadQueue()` 会复活它们）。清理在 `OfflineManager.dispose()` **之前**执行（`clearQueue()` / `clearDeadLetters()` 对已释放实例一律拒绝，顺序是硬要求）；`StoreManager.logout()` 本身不越界删这两个键（它不持有 OfflineManager），归属在 `createEnterpriseApp` 那一侧。要清某账号的数据请走 `logout()`，或按该账号 store 的 `name` 自行删键（`user-store-` 前缀是对外契约，`userStoreKey()` 不在公开导出面上）
- `createEnterpriseApp` 的 `onShow`（离线队列补同步）判据是「**是否有一轮同步在途**」：在途时直接返回，因此不会出现第二次 loading 闪烁、也不会去收起别人那一轮的提示（切前台撞上网络恢复的自动同步时，两套 loading 不互相顶）。`globalData.offlineManager` / `getOfflineManager()` 的对外类型仍是 `OfflineManager`
- `createUserStore` 对 `userId` 严格入口校验：非字符串、空串或纯空白直接抛错（畸形键会让不同账号撞同一存储键）。`syncWithServer()` 先校验响应体再 resolve：`statusCode` 为 2xx 但没有 `userInfo` 对象时 **reject**。同步地址**只能由 `syncUrl` 提供，库内不提供默认端点**：未配置时 `dispatch('syncWithServer')` **不发出任何请求**，直接以 `[UserStore] 未配置 syncUrl…` reject 并记一条日志（内置一个端点去打注定失败的请求，会把配置缺口伪装成网络错误）。`syncUrl` 在类型上仍是可选——`StoreManager.getUserStore` 就以 `createUserStore({ userId })` 建 store，语义是「缺省即该 Store 不具备服务端同步能力」。并发同步按请求序号丢弃被取代的旧响应；`await` 期间 store 被销毁（`logout` / LRU 淘汰）时丢弃结果并告警，不再把 `$patch` 的销毁报错记成「同步用户信息失败」并诱导重试。`lastSyncTime` 是**会话级**字段，刻意不持久化（重启后由 `syncWithServer` 重新写入）。**action 面有四个公开成员**：`setUserInfo` / `updatePreferences` / `syncWithServer` / `refreshData`。`refreshData()` 返回 `Promise<void>`，实现是 `return this.dispatch('syncWithServer')`，它是上面那条后台同步隐式契约的落地，于是 `createEnterpriseApp` / `initBackgroundSync` 注册的自带 handler 切前台真的会刷新数据。按 `{ setUserInfo, updatePreferences, syncWithServer }` 三个 action 枚举过该 store 的宿主（自建 action 列表 / 快照断言）要把 `refreshData` 算进枚举面，见 [MIGRATION.md 的 0.7.0 一节](./MIGRATION.md#升级到-070)
- `StoreManager` 为真正 LRU（命中刷新顺序），且不会淘汰当前登录用户的 store；无可淘汰候选（只剩当前用户）时会告警而非静默超限；`switchUser` 会写回「当前用户」键（不只 `login` 写，任何入口换号后冷启动都恢复当前身份）。冷启动只在**持久化标识本身无效**（空 / 纯空白 / 非字符串）时才清键按未登录处理；标识有效但 `switchUser` 抛错时只记 error 并保留身份，下次冷启动可重试
- `initBackgroundSync` 包装全局 `App` 构造器注入 `onShow` / `onHide`（修改 `App.prototype` 在微信中不生效）；注册表在重装包装器时**保留**（清空会静默停用其他模块的前台回调），同一份 `App` 配置被重复包装是幂等的。`App(...)` 传入非对象实参（`null` / 字符串 / 数字）时原样透传给宿主基础库，不再因包装器自己写属性而把一次本会被忽略的调用升级成 App 启动失败；`options` 被冻结 / `onHide` 不可写时整段注入告警并回退为「把原配置交给 App」。`typeof App !== 'function'` 时只告警、**照常登记**回调，App 就位后由 `ensureAppLifecycleHooks()`（`createEnterpriseApp` 已调）或下一次 init 装上
- **`refreshData` 是后台同步的隐式契约，不是可选装饰**：`BackgroundSyncConfig.maxInactiveTime`（默认 5 分钟）判定时效成立后，实现按**名字** `dispatch('refreshData')`——全库没有任何地方定义这个 action，注册进来的 store 必须自带它（判据是自有键 `hasOwnProperty(store.actions, 'refreshData')`）。两条口径：① 日志**按实际结果打印**（派发一次才打一行，守卫之前不打「刷新状态」这类与事实相反的记录），缺 action 时**每个 handler 一次性 `logger.warn`**，点名缺失的 action 名与后果（`store "<name>" 未定义 action "refreshData"，切前台不会自动刷新数据`），既不静默也不每次切前台刷屏。② 库自带的 `createUserStore` 提供 `refreshData`（见上面那条），`createEnterpriseApp` 注册的两个 handler 因此走得到刷新分支。自研 store 接入后台同步有两条路：提供 `refreshData`（通常委托给自身的同步 action），或干脆不为它注册后台同步
- `OfflineManager`：`execute(type, action, payload)` 的契约是**失败不外抛**——在线执行抛错时记 `logger.error`、入队并返回 `null`（＝本次未执行、已交队列重放），重放唯一入口是 `syncQueue`，按 `(type, payload)` 组装（传入的 `action` 闭包不会被重放）。**但「入队即等待外部事件」这个读法不成立**：`execute()` 失败入队时（在线态）会**自动补跑一轮重放**，一轮收尾时队列里仍有存货也会补跑，让排队的操作不必等到下一次网络恢复才落地；**离线态不自驱**（那是 `onNetworkChange` / 显式 `syncQueue` 的职责）。补跑排的是 **0 延时的宏任务**（不是微任务），所以 `await execute()` 之后同帧读 `getQueueLength()` 仍能看到刚入的那条——它在下一轮事件循环被带走，`getQueueLength()` 归 0 属正常收敛而非丢单；已 `dispose()`、断网、或另一轮同步在途时该次补跑直接跳过。`getQueueLength()` 不含在途段；`getDeadLetters()` 与 `syncQueue` 同口径过滤损坏条目并告警丢弃条数；已 `dispose()` 的实例上 `execute` 会告警「不会重放」并返回 `null`。同步期间落盘完整联合队列视图；未知 action 走重试 → 死信路径。`showLoading` / `hideLoading` 抛错都不卡死互斥标记、也不跳过本次同步（记 error 后继续 `syncQueue()`）
- 企业级 `storage` 适配层的字符串往返：`storage.set` 对「回读会被读成另一种值」的字符串加**引号信封**，`storage.get` 的字符串往返自此类型无损（写 `'42'` 不会再读回数字 `42`、写 `'null'` 不会再读回 `null`）；`number` / `boolean` 仍读回原始字符串——标量不算往返安全的类型。热更新备份用带 `'#gs'` 标记的编解码，早前版本写的备份仍可读，支持集含 `Date` / `RegExp` / `Map` / `Set` / `undefined` / 非有限数字 / `BigInt`；类实例恢复后原型丢失、函数与 symbol 成员恢复为 `undefined`，这两种有损情况都会打一条 lossy 告警
- 热更新：备份在用户确认时执行；**备份写入失败只跳过「待更新标记」的写入（无恢复源必须防），用户确认的更新照常 `applyUpdate`**——更新不会因此整段被静默跳过（用户点了确认不能什么都不知道），损失范围收敛为「本次更新无状态恢复」。`onBeforeUpdate` 回调抛错按自己的名字记日志、同样不再阻断更新；`applyUpdate` 抛错时**成对**清掉标记与备份（否则下一次普通冷启动会被误判为「更新后首启」并回滚备份点之后的全部持久化变更）；备份时间戳非有限值按「已过期」处理（不再静默绕过过期清理）；`onLaunch` 与 `login` 共用同一份热更新配置（换号后 `onBeforeUpdate` 不再在本次会话余下时间里静默丢失）；`createEnterpriseApp` 的 `onLaunch` 四步各自兜异常，热更新失败不再让后台同步与离线队列永不初始化
- 后台同步的前台 / 后台两条循环都按注册表现状复核成员身份后才回调：本轮内被 `unregisterBackgroundSync` 注销的 handler 不再收到 `onForeground` / `onBackground`
- 集成层的调试入口（`exposeStoreAPI` / `devtoolsPlugin`）默认以**只读**订阅注册（回调收到只读保护 Proxy；需要就地改载荷请显式传 `{ readOnly: false }`），注入的成员按自有属性写入并在解绑时恢复宿主原值（`__proto__` / `constructor` 不再污染原型链）

---

## 易误用点

| 事项                                               | 说明                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bindMappings` 等底层绑定工具                      | **不在主入口**，从 `@openlide/geomstore/integrations` 引入。日常优先用 `withPageStore` / `withComponentStore` / `withAppStore`                                                                                                                                                                                                |
| `SnapshotManager.compareSnapshots`                 | **实例方法**（实现是无状态纯函数），需要实例或自备 `SnapshotManager`。返回值的 `changed` 有两种来源，**先读 `inputTrusted` 再读 `changes`**（任一侧快照 `success: false` ⇒ `inputTrusted: false` 且 `changed` 恒 `true`，见第二节）                                                                                           |
| 「读取状态」≠「读缓存」                            | `getState()` / `store.state` **不查缓存**，连续读多少次都不产生 `hits`；缓存的唯一读取入口是 `getCached(key)`。`setState` / `$patch` 是**写穿**而非失效——写完再 `getCached` 仍命中且拿到新值；要真失效请用 `invalidateCache()` 或 `$replaceState`                                                                             |
| 「getter 会缓存结果」                              | **没有这回事**：Store 层无 getter 结果缓存，每次 `getter(name)` 都重算。要记忆化请用 `extras/selector` 的 `createSelector`                                                                                                                                                                                                    |
| `ComposeOptions.lazy` / `tree` / `NamespaceConfig` | 名字还在公开类型面上，**运行时零消费方**（构造只读 `namespace` / `strict`，分隔符硬编码 `'/'`）：写了编译通过、静默无效，不要按它安排懒加载与前缀策略                                                                                                                                                                         |
| 后台同步的 `refreshData`                           | `initBackgroundSync` / `createEnterpriseApp` 在切前台时**按名字** `dispatch('refreshData')`；该 action 全库不定义，注册进来的 store 不提供就是「切前台不刷新」（现在会一次性告警，不再打假日志）。库自带的 `createUserStore` 已提供它                                                                                         |
| 快照对子类与宿主内建值**保留原引用**               | `Map` / `Set` / `Date` / `RegExp` / `Array` 的**子类**实例、`Promise` / 装箱原始值 / TypedArray·ArrayBuffer·DataView / WeakMap·WeakSet / Error / 函数一律不克隆——它们与活状态**同一个对象**，「快照即隔离」对这些值不成立（改 `snap.data.myMap` 会串回活状态）。要隔离请自行 `slice(0)` / 结构化克隆 / 用 `customCloner` 接管 |
| `extras` 聚合入口                                  | 会把所有可选能力拉进产物，只有调试或确实全都要用时才引入                                                                                                                                                                                                                                                                      |
| 防抖 / 节流的挂起调用                              | 窗口 / 延迟未到期就卸载宿主时，定时器到点仍会调用被装饰方法（并拖住宿主不被回收）。请在 `onUnload` / `detached` 调 `cancel*`（丢弃）/ `flush*`（立即执行一次）/ `dispose*`（取消并释放状态），见第四节「防抖 / 节流的宿主收尾入口」                                                                                           |
| `import type`                                      | 类型（`SelectorOptions`、`MonitoringConfig`、`SnapshotResult` 等）请用 `import type` 引入，避免无谓的运行时代码                                                                                                                                                                                                               |
| 深链内部源码路径                                   | 可选能力的**实现**已移到 `src/extras/**`（快照 / 选择器 / Action 增强）；仅入口在 `extras/*` 的还有 `cache` / `hooks` / `performance`（实现保留在 `core`）                                                                                                                                                                    |

---

## 版本与变更

破坏性变更与迁移代码见 [MIGRATION.md](./MIGRATION.md)，完整变更记录见 [CHANGELOG](../CHANGELOG.md)。
