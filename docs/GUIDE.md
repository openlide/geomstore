# 使用指南

面向首次接入的开发者，从「跑起来」到「用对」：照着代码把库接进小程序，每个 API 先给最小可用写法。可运行示例见 [`examples/`](../examples)。

> 机制语义（为什么、边界在哪）的正本是 [CONCEPTS.md](./CONCEPTS.md)；逐 API 的参数与默认值见 [API.md](./API.md)；按症状排查见 [FAQ.md](./FAQ.md)；该做 / 别做的结论清单见 [BEST_PRACTICES.md](./BEST_PRACTICES.md)；升级影响见 [MIGRATION.md](./MIGRATION.md)。本文只写当前行为与接入写法。

## 目录

- [前置与示例索引](#前置与示例索引)
- [1. 五分钟接入](#1-五分钟接入)
- [2. 状态](#2-状态)
- [3. Action](#3-action)
- [4. Getter](#4-getter)
- [5. 订阅与通知](#5-订阅与通知)
- [6. 钩子与插件](#6-钩子与插件)
- [7. 快照（extras/snapshot）](#7-快照extrassnapshot)
- [8. 选择器（extras/selector）](#8-选择器extrasselector)
- [9. 组合 Store](#9-组合-store)
- [10. 错误处理（extras/error）](#10-错误处理extraserror)
- [11. 性能与体积](#11-性能与体积)
- [12. 排错](#12-排错)

## 前置与示例索引

```bash
pnpm add @openlide/geomstore
```

运行要求（Node ≥ 22、纯 ESM、TypeScript ≥ 5.4、用装饰器需开 `experimentalDecorators`）见 [README 安装一节的要求表](../README.md#安装)。主入口只含运行必需 API；可选能力（快照 / 选择器 / Action 增强 / 性能 / 错误处理 / 企业集成 / 插件实现）从 `extras/*` 子路径按需引入，引入方式与体积规则见 [README · 引入方式与体积分层](../README.md#引入方式与体积分层)。

可运行示例：

| 想做的事               | 参考                                                                        |
| ---------------------- | --------------------------------------------------------------------------- |
| 最小可运行示例         | [`examples/basic/01-simple-store.ts`](../examples/basic/01-simple-store.ts) |
| 页面/组件/App 集成     | [`examples/weapp/`](../examples/weapp)                                      |
| 缓存策略               | [`examples/cache/`](../examples/cache)                                      |
| 组合与插件             | [`examples/advanced/`](../examples/advanced)                                |
| 快照 / 选择器 / 装饰器 | [`examples/extras/`](../examples/extras)                                    |

## 1. 五分钟接入

### 定义 Store

```ts
import { createStore } from '@openlide/geomstore'

// 先定义状态类型：state / getters / actions 共用一份，避免同一形状在各处重复书写
interface SessionState {
  userInfo: string // 未登录为空串
  isLoggedIn: boolean
}

const sessionStore = createStore({
  name: 'session',
  // 工厂函数：避免引用类型被多实例共享
  // 标注返回类型：状态形状有单一来源，也使下面的字段无需任何断言
  state: (): SessionState => ({
    userInfo: '',
    isLoggedIn: false,
  }),
  getters: {
    greet: (state: SessionState) => (state.userInfo ? `Hi, ${state.userInfo}` : '未登录'),
  },
  actions: {
    // action 的 this 由 Store 自动注入（state / setState / $patch / dispatch 等），无需手写标注
    login(userInfo: string): void {
      this.$patch({ userInfo, isLoggedIn: true })
    },
  },
})
```

> 关键在 `state: (): SessionState => ({ … })` 这个**返回类型标注**：它让 `S` 有唯一来源。对比「不标注 + 内联字面量」的写法，好处有三——`state` 里不必写 `as` 断言（字段类型由上下文决定）、getters / actions 不必重复写同一份字面量类型、状态形状变化时只需改 `interface` 一处。

### 页面中使用

```ts
import { withPageStore } from '@openlide/geomstore'

Page(
  withPageStore(sessionStore, {
    mapState: ['isLoggedIn'], // 数组简写：注入 this.data.isLoggedIn
    mapGetters: ['greet'],
    mapActions: ['login'], // 注入 this.login(...)
  })({
    // 页面方法的 this 由集成层注入（入参类型带 ThisType<PageThis<…>>），无需手写标注
    onLoad() {
      this.login('Ada')
    },
    // onUnload 自动退订，无需手动清理
  }),
)
```

需要避免与页面本地字段重名时用对象别名：

```ts
withPageStore(sessionStore, {
  mapState: { loggedIn: 'isLoggedIn' },
  mapActions: { doLogin: 'login' },
})
```

### 组件中使用

```ts
import { withComponentStore } from '@openlide/geomstore'

Component(
  withComponentStore(counterStore, {
    mapState: ['count'],
    mapGetters: ['doubled'],
    mapActions: ['add'],
  })({
    methods: {
      // this 由集成层注入（注入方法与 data 均可用），无需手写标注
      onTapPlus() {
        this.add(1)
      },
    },
    lifetimes: {
      attached() {
        /* 挂载 */
      },
      detached() {
        /* detached 自动退订 */
      },
    },
  }),
)
```

> 组件生命周期必须写在 `lifetimes` 字段内（基础库 3.15.0+）；写在配置顶层的 `attached` / `detached` 不会被调用。支持的生命周期：`created` / `attached` / `ready` / `moved` / `detached` / `error`，页面级为 `show` / `hide` / `resize`（均与微信官方一致，写错会在编译期报错）；这些生命周期内的 `this` 已注入，可直接访问 `this.data` 与注入的方法。

Page 的 `onUnload` 与 Component 的 `lifetimes.detached` 会先同步执行用户钩子、再在 `finally` 中清理绑定，包装器不等待异步钩子返回的 Promise——语义细节见 [CONCEPTS §13 订阅生命周期](./CONCEPTS.md#订阅生命周期)。

### App 级

```ts
import { withAppStore } from '@openlide/geomstore'

App(
  withAppStore(appStore)({
    onLaunch() {
      appStore.dispatch('markLaunched', '')
    },
    onShow() {
      /* 进入前台 */
    },
  }),
)
```

> 生命周期内的 `this` 已由集成层注入：映射状态出现在 `this.globalData` 上，映射的 action 与调试 API 直接可用，**无需手写 `this` 标注**。映射规则见 [CONCEPTS §13 映射](./CONCEPTS.md#映射)，三个集成的差异与相关症状见 [FAQ · 集成与工程](./FAQ.md#集成与工程)。

## 2. 状态

### 读写

| 操作                             | API                                                                      |
| -------------------------------- | ------------------------------------------------------------------------ |
| 读取（活动引用，写入是就地变异） | `store.getState()`                                                       |
| 读取（内置缓存）                 | `store.getCached(key)`                                                   |
| 不可变副本（深克隆 + 部分冻结）  | `store.$snapshot()`                                                      |
| 单键 / 多键合并写入              | `store.setState(key, value)` / `store.$patch({ ... })`                   |
| 整体替换（支持工厂）             | `store.$replaceState({ ... })` 或 `store.$replaceState(() => ({ ... }))` |
| 从快照恢复                       | `store.$restore(snapshot)`                                               |
| 失效缓存条目                     | `store.invalidateCache(key?)`（不传即整表清空）                          |

```ts
const snap = store.$snapshot() // Readonly<S>；纯对象与数组链被冻结，Date/Map/Set 内部仍可变
store.$patch({ count: 1 })
store.$restore(snap) // 回到快照时刻
```

- 缓存的读写口径——唯一读取入口是 `getCached()`、`setState` / `$patch` 是**写穿**而非失效、失效入口只有 `invalidateCache()` 与 `$replaceState`——见 [CONCEPTS §6](./CONCEPTS.md#6-缓存cache)；`$snapshot()` 的冻结范围见 [CONCEPTS §1](./CONCEPTS.md#1-状态state)
- `setState('__proto__', …)` 等原型链敏感键承载为状态上的**自有数据属性**、原型保持不变，读回用 `Object.getOwnPropertyDescriptor(state, '__proto__')`——见 [CONCEPTS §1](./CONCEPTS.md#1-状态state)

### 就地变异与隔离

`getState()` 返回内部状态的活动引用，写入是**就地变异**，不能靠 `===` 判断内容是否变化。需要与内部隔离的副本时用 `$snapshot()`；需要错误账本、进度与丢弃语义的一次性深拷贝用 `createSnapshot()`（见 [§7](#7-快照extrassnapshot)）。两条克隆引擎的覆盖面、以及哪些值**保留原引用**而不是重建，见 [CONCEPTS §1](./CONCEPTS.md#1-状态state) 与 [CONCEPTS §8 保留原引用的两类值](./CONCEPTS.md#保留原引用的两类值)。

### 状态保护

```ts
const store = createStore({
  name: 'app',
  state: () => ({ user: { name: '' } }),
  stateProtection: { deep: true, productionHandler: 'warn' }, // deep: false 只保护顶层
})
```

开启后，绕过 `setState` / `$patch` 的直接变异会**抛错**（开发模式给出可读路径）。保护覆盖面，以及冻结 / 不可写属性的**明确豁免**（这类子树拿到裸引用、不受写保护也不计脏键，想观察其变化请显式 `setState` 换引用），见 [CONCEPTS §3](./CONCEPTS.md#3-状态保护state-protection) 与 [冻结与不可写属性：明确豁免](./CONCEPTS.md#冻结与不可写属性明确豁免)。

### 批量更新

```ts
store.batch(() => {
  // 期间合并通知，结束时统一发一次
  store.setState('a', 1)
  store.setState('b', 2)
})
```

也可手动 `startBatch()` / `endBatch()`（支持嵌套，仅最外层收尾时通知）。批保护只在**同步段**有效：`batch(fn)` 传异步回调时 `await` 之后的变更逐条通知（开发模式告警），异步场景请让 action 承担合并职责——见 [CONCEPTS §14](./CONCEPTS.md#14-批处理batch)。

## 3. Action

### 调用 action

```ts
store.dispatch('login', user) // 同步 action：原样返回其返回值
await store.dispatch('load') // 异步 action：返回 Promise，失败原样抛出
```

- action 内的 `this.state` 是可写脏跟踪代理：对象 / 数组 / Map / Set 的直接变异会被跟踪并标脏；Date 等其他内建对象的内部变异不被跟踪，请用 `setState` / `$patch` 替换值——覆盖面见 [CONCEPTS §2 脏跟踪的覆盖面](./CONCEPTS.md#脏跟踪的覆盖面)
- 异步 action 的同步段有写入时，默认会收到 **2 次**通知（同步段结束补发一次、settle 再发一次），`notify.async` / `notify.onlyOnChange` 可收敛回 1 次——时点规则与理由见 [CONCEPTS §2 dispatch 的通知时点](./CONCEPTS.md#dispatch-的通知时点)
- action 失败（reject）时也会先补发 `onError` 钩子，监控 / 上报插件对异步失败不失明

### Action 增强（extras/action）

```ts
import { ActionLoader, withLoading } from '@openlide/geomstore/extras/action'

const loader = new ActionLoader({ perActionKeys: true }) // loading/error 键按 action 名区分
const wrapped = loader.wrap(doIt, 'doIt', setState) // setState 为 (key, value) 两参数
```

- `withLoading` 的引用计数按 (宿主, loading 键) 集中，多个装饰器并发不会提前翻转 `loading`——契约见 [API.md](./API.md)
- `withThrottle(interval, { leading, trailing, assumeAsync })`：间隔是**第一个位置参数**；方法非 `async` 语法但返回 Promise 时，用 `assumeAsync: true` 让被抑制的调用也返回 Promise
- **装饰同步方法的 `withRetry` 会改变返回类型**：`T → Promise<T>`、原本同步抛出的错误转成 rejection，调用方必须 `await`。不想改调用方就别给同步方法加它
- 超时错误按 **`code === 'ACTION_TIMEOUT'`** 判定（`withTimeout` 与 `executeWithTimeout` 两个入口的文案不同、只作展示）；`withTimeout` 在工厂阶段就校验超时值，非法值直接抛 `RangeError`——细节见 [API.md](./API.md)

### 卸载点的收尾调用

`withDebounce` / `withThrottle` 装饰的方法在窗口 / 延迟到期前销毁宿主时，挂起的调用到点仍会执行（并拖住宿主不被回收）。请在卸载钩子里调用收尾入口，参数是**宿主 `this`**：

```ts
import { withDebounce, withThrottle, flushDebouncedCalls, cancelThrottledCalls, disposeDebouncedState } from '@openlide/geomstore/extras/action'

class CartPage {
  @withDebounce(300)
  submitDraft(draft: string) {
    return this.store.dispatch('saveDraft', draft)
  }

  @withThrottle(100)
  onScroll(position: number) {
    this.store.dispatch('setScroll', position)
  }

  onUnload() {
    flushDebouncedCalls(this, 'submitDraft') // 离开前把最后一次草稿提交掉：立即执行且只执行一次
    cancelThrottledCalls(this) // 挂起的滚动补发直接丢弃
    // 一句话版本：disposeDebouncedState(this) —— 取消挂起调用 + 释放该宿主的整张状态表
  }
}
```

Component 侧写在 `lifetimes.detached` 里，配置对象写法同样成立（入口认的是**调用被装饰方法时的 `this`**，钩子里的 `this` 就是宿主实例）；集成层只清订阅与映射，不会替你清这些定时器。收尾调用放在钩子**同步段**。六个入口（`cancel*` / `flush*` / `dispose*`）的完整语义、被取消的 Promise 收到什么、以及装饰 **store action** 时为何静默 no-op（附两种可收尾的替代写法），见 [API.md](./API.md) 的「防抖 / 节流的宿主收尾入口」；症状判别见 [FAQ · 装饰器](./FAQ.md#装饰器)。

## 4. Getter

```ts
const total = store.getter('total') // 泛型签名会推导出返回类型
```

- getter **只接收 state**（需要组合时在函数体内自行计算），保持纯函数便于调试
- **没有结果缓存**：每次读取都按当前状态重算，见 [CONCEPTS §4](./CONCEPTS.md#4-getter无记忆化)；要记忆化请用 `extras/selector` 的 `createSelector`（见 [§8](#8-选择器extrasselector)），热路径上的 getter 改写成选择器
- Store 销毁后 `getter(name)` 抛错（读取入口有销毁守卫）——销毁守卫的总规则见 [API.md](./API.md)，症状见 [FAQ · 集成与工程](./FAQ.md#集成与工程)

## 5. 订阅与通知

```ts
const unsubscribe = store.subscribe((state) => {
  /* 只接收新状态 */
})
unsubscribe()

store.subscribe(listener, { readOnly: true }) // 声明不写状态：全部订阅者都只读时通知载荷免深拷贝
```

通知三配置（`notify.clone` / `notify.async` / `notify.onlyOnChange`）的语义与默认值见 [CONCEPTS §2](./CONCEPTS.md#2-通知notify)；监听器签名（无 `prevState`）、订阅额度与驱逐、回调抛错隔离见 [CONCEPTS §2 监听器与只读订阅](./CONCEPTS.md#监听器与只读订阅) 与 [订阅额度](./CONCEPTS.md#订阅额度)；退订的生效时机见 [迭代中退订](./CONCEPTS.md#迭代中退订)；供集成层跳过未变化 `setData` 的 `isStateKeyDirty(key)` 见 [CONCEPTS §7](./CONCEPTS.md#7-脏键isstatekeydirty)。

## 6. 钩子与插件

### 钩子

```ts
store.hooks.on('afterPatch', (patch) => console.log('patched', patch))
```

钩子名清单、一次性退订句柄与 `emit` 的失败语义见 [CONCEPTS §11 钩子](./CONCEPTS.md#钩子) 与 [API.md](./API.md)。注意：处理器形参的精确签名只在**插件侧**（`install(store)` 拿到的 `store.hooks`）成立，直连 `createStore(...).hooks` 时形参是擦除版 `unknown`、需自行标注——见 [CONCEPTS §11 钩子](./CONCEPTS.md#钩子)。

### 插件与持久化

插件契约：`{ name, install(store) }`，`install` 返回卸载函数；`store.use(plugin)` 返回同一个卸载函数（安装抛错会回滚入列，不留半安装插件）。

```ts
import { loggerPlugin, persistencePlugin, WxStorageBackend } from '@openlide/geomstore/extras/plugins'

store.use(loggerPlugin)
store.use(
  persistencePlugin({
    key: 'session',
    storage: new WxStorageBackend(), // 或自封装 { getItem, setItem, removeItem }
    filter: (state: { token: string }) => ({ token: state.token }),
    debounce: 300,
  }),
)
```

- 持久化后端必须**同步实现且三方法齐备**（`getItem` / `setItem` / `removeItem`）；不传 `storage` 时默认后端就是 `WxStorageBackend`；检测不到可用的 wx 同步 API 时降级为内存存储。降级、恢复失败与卸载清理失败都经 `onError` 钩子上报（生产模式控制台静默）——机制见 [CONCEPTS §11 调试表与持久化](./CONCEPTS.md#调试表与持久化)，选项（`filter` / `validate` / `restore` / `debounce` / `clearOnUninstall`）与卸载补写行为见 [API.md](./API.md)
- 独立函数 `usePlugin(plugin, store)` 与 `store.use` 等价且**无需断言**（泛型从 `store` 反推；状态无关的插件写作 `Plugin<State>`，如 `loggerPlugin`），见 [CONCEPTS §11](./CONCEPTS.md#11-插件plugin) 与 [API.md](./API.md)

### 日志脱敏（withLog）

`withLog`（`extras/action`）在生产构建只输出摘要（类型 / 长度 / 键数，`Error` **只留 `name`、不含 `message`**），开发构建默认原样打印。需要自定义脱敏或改出口时传 `{ sink, redact }`；注意生产构建下 `redact` 之后**仍会**过一层摘要，要由你全权决定输出内容须显式传 `{ summarizeInProduction: false }`。`sink` / `redact` 自身抛错只记一条告警，不会顶掉或改判被装饰的 action。选项的逐项契约见 [API.md](./API.md)。

## 7. 快照（extras/snapshot）

```ts
import { createSnapshot, createSnapshotAsync, compareSnapshots } from '@openlide/geomstore/extras/snapshot'

const snap = createSnapshot(store.getState())
snap.success // 先判它：存在 cloneError 或超时即为 false
snap.data // success 为 true 才可用；失败 / 中止时为 undefined，绝不回传原始对象
snap.errors // 错误账本（path / type / message），定位哪些节点被丢弃
snap.metadata // nodeCount / size / duration 等

const big = await createSnapshotAsync(bigObject, {
  batchSize: 100, // 大对象分片：批间让出控制权，超深结构走这条路径
  onProgress: (p) => console.log(p.percentage),
  onError: (err) => true, // 返回 true＝忽略该错误继续；不写 return＝拒绝继续（cloneError 会中止整次快照）
})
```

实践守则只有一条：**先判 `success` 再用 `data`**；消费 `compareSnapshots(a, b)` 时同理，先读 `inputTrusted` 再读 `changes`。隔离契约（哪些节点被丢弃、哪些值保留原引用、深度上限与栈安全硬上限、差异路径的方言）见 [CONCEPTS §8](./CONCEPTS.md#8-快照snapshotextrassnapshot)；选项与返回字段的逐项说明见 [API.md](./API.md)。

## 8. 选择器（extras/selector）

本库的**记忆化入口只有选择器**——Store 侧的 getter 每次读取都重算（见 [§4](#4-getter) 与 [CONCEPTS §4](./CONCEPTS.md#4-getter无记忆化)）。想让「依赖未变时不重算」成立，就把那段计算写成 `createSelector`。

```ts
import { createParametricSelector, createSelector } from '@openlide/geomstore/extras/selector'

// 单个选择器函数 + 选项（多步计算请在函数体内完成）
const selectPaidTotal = createSelector((state: State) => state.orders.filter((o) => o.status === 'paid').reduce((sum, o) => sum + o.amount, 0))

// 参数化：按参数分别缓存，注意 ttl 与容量上限（ttl: 0 表示立即过期，等同禁用缓存）
const byOrder = createParametricSelector((state: State, id: number) => state.orders[id].amount, {
  ttl: 5000,
  maxEntries: 50,
})(store.getState())
```

缓存命中判定同时校验**状态对象身份与版本号**，不同 Store 不会串值；状态不带版本号时回退 `equalityFn` 的内容比较——此时引用相等的比较器必须配 `snapshotState: false`，否则缓存**永不命中**。口径见 [CONCEPTS §5](./CONCEPTS.md#5-版本号stateversion) 与 [CONCEPTS §9](./CONCEPTS.md#9-选择器selectorextrasselector)；异步与重试形态用 `SelectorComposer`，同见 [CONCEPTS §9](./CONCEPTS.md#9-选择器selectorextrasselector)。

## 9. 组合 Store

```ts
import { composeStore } from '@openlide/geomstore'

const root = composeStore([userStore, cartStore], { namespace: true, strict: true })
root.dispatch('user/updateName', 'Bob') // 命名空间下的斜杠路径
root.subscribe((state) => {
  /* 任一子 store 变化都会收到 */
})
```

非命名空间外层包含命名空间内层时，内层子 store 的键写作 `'子store名/键'`：

```ts
flat.setState('leaf/count', 1)
flat.$patch({ 'leaf/count': 2 })
```

- 命名空间模式下状态按 `name` 嵌套、`isStateKeyDirty('child/key')` 精确到子 store（集成层据此跳过未变化的 `setData`）、组合层 N 个监听器只占每个子 store 一份只读订阅、`composed.state` 顶层冻结——见 [CONCEPTS §12 读写路径](./CONCEPTS.md#读写路径)；构造期校验（`name` 是路由键）与 `actions` 注册表合并规则见 [CONCEPTS §12 构造期校验](./CONCEPTS.md#构造期校验)
- 子 store 在组合之外被独立 `destroy()` 时，组合层把它按**空视图**并入、去重告警一次而不抛错；要判存活请显式读 `store.destroyed`，别靠 `getState().child` 的有无（那会是一个空对象）——见 [CONCEPTS §12 子 store 生命周期](./CONCEPTS.md#子-store-生命周期)
- 需要按名字管理多个 store 时用 `StoreRegistry` / `globalRegistry`——见 [CONCEPTS §12 注册表](./CONCEPTS.md#注册表storeregistry)

## 10. 错误处理（extras/error）

```ts
import { ErrorBoundary, ErrorMonitoring, ConsoleReporter, HttpReporter } from '@openlide/geomstore/extras/error'

const boundary = new ErrorBoundary({ fallback: (error) => ({ failed: true }) })
const state = boundary.execute(() => risky(), store)

const monitoring = new ErrorMonitoring({
  reporters: [new ConsoleReporter(), new HttpReporter({ endpoint })],
  batchThreshold: 10,
  maxQueueSize: 1000, // 队列容量
  maxFlushRetries: 3, // 全部报告器连续失败的重入队上限
})
```

选型两句话：给单次危险调用兜底用 `ErrorBoundary`（默认 fail-loud，未配 `fallback` 即重抛）；全进程收集、聚合并上报错误用 `ErrorMonitoring` + 报告器（`ConsoleReporter` 打控制台，`HttpReporter` 自动在 `wx.request` / `fetch` 间选择，均可注入自定义实现）。

机制语义（错误模型、边界、恢复额度按故障周期计量、监控的计数口径）见 [CONCEPTS §10](./CONCEPTS.md#10-错误处理extraserror)；参数级细节（`MonitoringConfig` 各项默认值、`ErrorRecovery` 窗口公式、报告器的请求头归一化与坏 payload 降级）见 [API.md](./API.md)。

## 11. 性能与体积

- **只缓存热点键**：`enableCache(['visibleRows'])`；缓存只对 `getCached()` 生效，想主动清用 `invalidateCache()`——口径见 [CONCEPTS §6](./CONCEPTS.md#6-缓存cache)
- **`cacheConfig.enableStats` 默认开启**，方向是按需**关闭**：性能敏感场景传 `false` 省掉计数，代价是 `getCacheStats()` 的 `hits` / `misses` 恒为 0——见 [CONCEPTS §6](./CONCEPTS.md#6-缓存cache)
- **按需引入 extras**：没 import 的能力不要进模块图；体积收益取决于宿主有没有打包器（微信「构建 npm」把本包当「小程序 npm 包」整目录拷贝 `miniprogram` 目录，子路径分层换来的只是运行时按需加载，上传体积不变；此时能做的只有把构建输出挪进分包）——见 [README · 小程序环境适配](../README.md#小程序环境适配) 与 [把构建结果放进分包](../README.md#把构建结果放进分包)
- **大对象用异步快照**：`batchSize`（默认 100）控制单批工作量，批间让出控制权避免长任务卡顿；非法值的归一化与超时口径见 [API.md](./API.md)
- **独立缓存**：需要自有策略时直接用 `LRUCache`（容量淘汰 + TTL）——见 [CONCEPTS §6](./CONCEPTS.md#6-缓存cache)
- **列表写入倾向「追加 / 换引用」**：删边类写入（原地替换对象值、`delete`、`Map` / `Set` 删除）会触发脏键归属索引的一次全量重建——见 [CONCEPTS §2 脏跟踪的覆盖面](./CONCEPTS.md#脏跟踪的覆盖面)
- 内部定时器均做 `unref` 探测、不阻止进程退出；**防抖 / 节流的挂起定时器不在其列**，它会活到窗口 / 延迟到期，宿主卸载点请收尾——见 [§3 卸载点的收尾调用](#卸载点的收尾调用)

## 12. 排错

按症状分类查 FAQ：

| 症状分类                                                           | 跳转                                                                                 |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| 状态写入抛错、监听器没被调用、通知次数、批处理、脏键               | [FAQ · 状态与通知](./FAQ.md#状态与通知)                                              |
| 缓存命中 / 统计、getter 每次重算、选择器永不命中或返回陈旧值       | [FAQ · 缓存与选择器](./FAQ.md#缓存与选择器)                                          |
| 快照少字段、`data` 为 `undefined`、`compareSnapshots` 与路径怎么读 | [FAQ · 快照](./FAQ.md#快照)                                                          |
| 装饰器返回值不对、防抖 / 节流收尾入口「调了没效果」                | [FAQ · 装饰器](./FAQ.md#装饰器)                                                      |
| 持久化没生效、生命周期 / 销毁报错、体积与构建                      | [FAQ · 插件与持久化](./FAQ.md#插件与持久化)、[FAQ · 集成与工程](./FAQ.md#集成与工程) |

症状背后的机制（为什么这样设计）见 [CONCEPTS.md](./CONCEPTS.md)。
