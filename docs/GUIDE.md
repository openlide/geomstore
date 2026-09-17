# 使用指南

面向首次接入的开发者，从「跑起来」到「用对」。所有代码片段与 [`examples/`](../examples) 保持同源——那批示例由 `pnpm typecheck:examples` 全量类型校验，可直接复制运行。

> 概念与设计取舍见 [CONCEPTS.md](./CONCEPTS.md)；逐个 API 的参数说明见 [API.md](./API.md)。

## 0. 安装与要求

```bash
pnpm add @openlide/geomstore
```

- **Node.js ≥ 22**，包为 **ESM**（仅支持 `import`）
- 主入口只含运行必需 API；可选能力（快照 / 选择器 / Action 增强 / 性能 / 错误处理 / 企业集成 / 插件实现）从 `extras/*` 引入，避免主包体积膨胀——见 [README 的引入方式表](../README.md)

## 1. 五分钟接入

### 1.1 定义 Store

```ts
import { createStore } from '@openlide/geomstore'

// 先定义状态类型：state / getters / actions 共用一份，避免同一形状在各处重复书写
interface SessionState {
  userInfo: string          // 未登录为空串
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

### 1.2 页面中使用

```ts
import { withPageStore } from '@openlide/geomstore'

Page(
  withPageStore(sessionStore, {
    mapState: ['isLoggedIn'],            // 数组简写：注入 this.data.isLoggedIn
    mapGetters: ['greet'],
    mapActions: ['login'],               // 注入 this.login(...)
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

### 1.3 组件中使用

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
      attached() { /* 挂载 */ },
      detached() { /* detached 自动退订 */ },
    },
  }),
)
```

> 组件生命周期必须写在 `lifetimes` 字段内（基础库 3.15.0+）；写在配置顶层的 `attached` / `detached` 不会被调用。支持的生命周期：`created` / `attached` / `ready` / `moved` / `detached` / `error`，页面级为 `show` / `hide` / `resize`（均与微信官方一致，写错会在编译期报错）；这些生命周期内的 `this` 已注入，可直接访问 `this.data` 与注入的方法。

Page 的 `onUnload` 与 Component 的 `lifetimes.detached` 会先执行用户钩子，再在 `finally` 中清理绑定；同步段仍可调用映射 actions，同步抛错也不会漏清理。包装器不等待异步钩子返回的 Promise，不要在 `await` 后依赖绑定仍可用。

### 1.4 App 级

```ts
import { withAppStore } from '@openlide/geomstore'

App(
  withAppStore(appStore)({
    onLaunch() { appStore.dispatch('markLaunched', '') },
    onShow() { /* 进入前台 */ },
  }),
)
```

> 生命周期内的 `this` 已由集成层注入：映射状态出现在 `this.globalData` 上，映射的 action 与调试 API 直接可用，**无需手写 `this` 标注**——三个集成的差异详见 FAQ。

## 2. 状态

### 读写

| 操作 | API |
| --- | --- |
| 读取（活动引用） | `store.getState()` |
| 不可变副本（深克隆 + 递归冻结） | `store.$snapshot()` |
| 单键 / 多键合并写入 | `store.setState(key, value)` / `store.$patch({ ... })` |
| 整体替换（支持工厂） | `store.$replaceState({ ... })` 或 `store.$replaceState(() => ({ ... }))` |
| 从快照恢复 | `store.$restore(snapshot)`（经 `$replaceState`，不重复深拷贝） |

```ts
const snap = store.$snapshot()   // Readonly<S>，嵌套纯对象/数组也被冻结
store.$patch({ count: 1 })
store.$restore(snap)             // 回到快照时刻
```

### 就地变异与隔离

`getState()` 返回的是内部状态的引用，写入是**就地变异**——因此不能靠 `===` 判断内容是否变化（这也是缓存/通知判定依赖内部版本号与脏计数的原因）。需要与内部彻底隔离的副本时用 `$snapshot()`；需要完全隔离的一次性深拷贝用 `createSnapshot()`（见 §7）。

### 状态保护

开启 `stateProtection` 后，绕过 `setState` / `$patch` 的直接变异（含 `Object.defineProperty`、数组元素赋值）会**抛错**并在开发模式给出可读路径；`deep: false` 表示只保护顶层（性能优先，嵌套对象不再包装）。

### 批量更新

```ts
store.batch(() => {          // 期间合并通知，结束时统一发一次
  store.setState('a', 1)
  store.setState('b', 2)
})
```

也可手动 `startBatch()` / `endBatch()`（支持嵌套，仅最外层收尾时通知）。

> ⚠️ `batch(fn)` 传入**异步回调**时，`await` 之后的变更会逐条通知——批保护只在同步段有效（开发模式会显式告警）。异步场景请让 action 承担合并职责。

## 3. Action

```ts
store.dispatch('login', user)        // 同步 action：原样返回其返回值
await store.dispatch('load')         // 异步 action：返回 Promise，失败原样抛出
```

Action 内的 `this.state` 是可写脏跟踪代理：默认与 `onlyOnChange` 模式均跟踪对象 / 数组 / Map / Set 的直接变异，并标记所有受影响的顶层键（含别名，异步段的脏键累积到通知时）。Date 等其他内建对象的内部变异不被跟踪，请用 `setState` / `$patch` 替换值。`onlyOnChange` 依据写入计数而非前后内容深比较，不能用于过滤所有同值写入。

**通知语义**（只有一个统一规则，避免重复/遗漏）：

- 异步 action 的**同步段不单独通知**，其变更由完成时（fulfill 或 reject）的补发覆盖一次
- `await` 之后的变更同样在结算时补发
- **嵌套 dispatch 仅最外层通知**；与 batch 交叉时由 batch 收尾统一通知
- reject 是 action 最常见的失败形态，**也会先补发 `onError` 钩子**（监控/上报插件对异步失败不失明）

**Action 增强**（`extras/action`）：

```ts
import { ActionLoader, withLoading } from '@openlide/geomstore/extras/action'

const loader = new ActionLoader({ perActionKeys: true })  // loading/error 键按 action 名区分
const wrapped = loader.wrap(doIt, 'doIt', setState)       // setState 为 (key, value) 两参数
```

- `withLoading` 的引用计数按 (宿主, loading 键) 集中：多个装饰器并发不会提前翻转 `loading`
- `withThrottle(interval, { leading, trailing, assumeAsync })`：间隔是**第一个位置参数**；`assumeAsync` 用于「非 `async` 语法但返回 Promise」的方法被抑制时仍返回 Promise

## 4. Getter

```ts
const total = store.getter('total')   // 泛型签名会推导出返回类型
```

- getter **只接收 state**（需要组合时在函数体内自行计算），保持纯函数便于缓存与调试
- 依赖未变时复用结果，判定基于内部状态版本号（O(1) 整数比较）

## 5. 订阅与通知

```ts
const unsubscribe = store.subscribe((state) => { /* 只接收新状态 */ })
unsubscribe()

store.subscribe(listener, { readOnly: true })   // 声明不写状态：通知路径可零拷贝
```

| 配置 | 作用 | 默认 |
| --- | --- | --- |
| `notify.clone` | 通知时是否克隆状态；关闭且状态保护关闭时，**仅当无可读写订阅者**才返回原始引用 | `true` |
| `notify.async` | 微任务合并：同一 tick 内多次写入只通知一次 | `false` |
| `notify.onlyOnChange` | dispatch / batch 期间未检测到写入则不通知（依据变更计数，非内容深比较） | `false` |

- 监听器签名是 **`(state: S) => void`**（没有 `prevState` 参数），需要前后对比请在闭包里自行保存
- 订阅数达上限时按 `subscription.onLimit` 策略处理（`evict-oldest` / `throw`）；同一监听器重复订阅按引用计数计次，每个退订句柄幂等，重复调用不会移除其他注册
- `store.isStateKeyDirty(key)` 供集成层跳过未变化的映射键（避免无意义的 `setData`）

## 6. 钩子与插件

```ts
store.hooks.on('afterPatch', (patch) => console.log('patched', patch))
```

可用钩子：`beforeDispatch` / `afterDispatch` / `beforeSetState` / `afterSetState` / `beforePatch` / `afterPatch` / `beforeReplaceState` / `afterReplaceState` / `beforeGet` / `afterGet` / `onError` 等。

**插件契约**：`{ name, install(store) }`，`install` 返回卸载函数；`store.use(plugin)` 返回同一个卸载函数。

```ts
import { loggerPlugin, persistencePlugin, WxStorageBackend } from '@openlide/geomstore/extras/plugins'

store.use(loggerPlugin)
store.use(persistencePlugin({
  key: 'session',
  storage: new WxStorageBackend(),                   // 或自封装 { getItem, setItem, removeItem }
  filter: (state: { token: string }) => ({ token: state.token }),
  debounce: 300,
}))
```

- **持久化后端必须是同步实现**（`getItem/setItem/removeItem`）——传异步后端会被显式拒绝，避免写入静默丢失
- 卸载时会**同步补写**防抖窗口内的最后一次变更；`clearOnUninstall: true` 则改为清理存储
- `store.use` 安装抛错会回滚入列，不留半安装插件；生产模式下安装/卸载日志静默
- 独立函数 `usePlugin(plugin, store)` 等价且**无需断言**：泛型从 `store` 反推，`plugin` 需与其状态类型匹配（状态无关的插件写作 `Plugin<State>`，如 `loggerPlugin`）。日常也可直接用 `store.use`

## 7. 快照（`extras/snapshot`）

```ts
import { createSnapshot, createSnapshotAsync } from '@openlide/geomstore/extras/snapshot'

const snap = createSnapshot(store.getState())
snap.data        // 隔离副本；快照内绝不会出现活引用
snap.success     // 存在 cloneError 或超时即为 false
snap.errors      // 错误账本（path / type / message）
snap.metadata    // nodeCount / size / duration 等

const async = await createSnapshotAsync(bigObject, {
  batchSize: 100,                                  // 批间让出控制权
  onProgress: (p) => console.log(p.percentage),
  onError: (err) => true,                          // true=继续（丢弃该节点）/ false=中止
})
```

要点：

- **隔离契约**：无法安全克隆的节点一律**丢弃**，绝不把原值兜底进快照；丢弃时对象属性不写入、数组留洞、`Set` 不添加、`Map` 跳过整条 entry
- `maxDepth` 超限返回占位符（不是活引用）；类实例保留原型；访问器属性以 getter 求值结果克隆
- `customCloner` 抛错的语义在同步/异步路径**完全一致**（落账 → 咨询 `onError` → 继续则丢子树 / 中止则抛 `SnapshotAbortError`）

## 8. 选择器（`extras/selector`）

```ts
import { createParametricSelector, createSelector } from '@openlide/geomstore/extras/selector'

// 单个选择器函数 + 选项（多步计算请在函数体内完成）
const selectPaidTotal = createSelector((state: State) =>
  state.orders.filter((o) => o.status === 'paid').reduce((sum, o) => sum + o.amount, 0))

// 参数化：按参数分别缓存，注意 ttl 与容量上限（ttl: 0 表示立即过期，等同禁用缓存）
const byOrder = createParametricSelector((state: State, id: number) => state.orders[id].amount, {
  ttl: 5000,
  maxEntries: 50,
})(store.getState())
```

缓存命中判定同时校验**状态对象身份与版本号**，不同 Store 即使版本相同也不会串值；状态不带版本号（如直接传入的普通对象）时回退 `equalityFn`（默认 `deepEqual`）。`SelectorComposer` 提供异步与重试形态，重试错误带不可枚举的 `attempts` 记录真实执行次数。

## 9. 组合 Store

```ts
import { composeStore } from '@openlide/geomstore'

const root = composeStore([userStore, cartStore], { namespace: true, strict: true })
root.dispatch('user/updateName', 'Bob')     // 命名空间下的斜杠路径
root.subscribe((state) => { /* 任一子 store 变化都会收到 */ })
```

- 命名空间模式下状态按 `name` 嵌套；`isStateKeyDirty` 精确判断子 store 是否变化，集成层据此跳过未变化的 `setData`
- 组合层 N 个监听器只占每个子 store 一份订阅；无只读订阅者时通知走零拷贝
- `composed.state` 顶层冻结、嵌套经子 store 保护代理，写入不会穿透
- 合并缓存在读取前校验子 Store 版本，批内及异步通知前也能读到最新状态；无版本号的子 Store（含嵌套组合）每次读取保守失效
- 子 Store 的 `actions` 注册表会合并，外层组合可按裸名路由嵌套组合的 action；非命名空间模式同名取第一个 Store
- 非命名空间外层包含命名空间内层时，内层子 store 的键写作 `'子store名/键'`：`flat.setState('leaf/count', 1)`、`flat.$patch({ 'leaf/count': 2 })`（构造期开发模式会提示书写形式）
- 需要按名字管理多个 store 时用 `StoreRegistry`

## 10. 错误处理（`extras/error`）

```ts
import { ErrorBoundary, ErrorMonitoring, ConsoleReporter, HttpReporter } from '@openlide/geomstore/extras/error'

const boundary = new ErrorBoundary({ fallback: (error) => ({ failed: true }) })
const state = boundary.execute(() => risky(), store)

const monitoring = new ErrorMonitoring({
  reporters: [new ConsoleReporter(), new HttpReporter({ endpoint })],
  batchThreshold: 10,
  maxQueueSize: 1000,        // 队列容量（默认 1000）
  maxFlushRetries: 3,        // 全部报告器连续失败的重入队上限（默认 3）
})
```

- **`ErrorBoundary` 默认 fail-loud**：未配置 `fallback` 时错误重抛；提供 `fallback` 即声明恢复意图。`fallback` 函数自身抛错时会**重抛原始错误**（不丢失现场）
- **`ErrorRecovery`** 策略含 `RETRY` / `FALLBACK` / `IGNORE` / `RECOVER` / `RESTART`；重试额度按**故障周期**计量（窗口 = `max(60s, 本周期退避总时长 × 2)`），并有键容量守卫防动态 operation id 导致的无界增长
- **`ErrorMonitoring`** 批量 flush 对每个 reporter 做 `ok / fail / timeout` 三态判定——仅真正 resolve 才算成功；全部失败时按序重入队重试，连续失败超过 `maxFlushRetries` 丢弃该批并告警
- `HttpReporter` 自动选择 `wx.request`（校验 `statusCode`）或 `fetch`（校验 `ok`），可注入自定义实现；基础库缺少 `console.group` 时 `ConsoleReporter` 自动降级为平铺输出

## 11. 性能与体积

- **只缓存热点键**：`enableCache(['visibleRows'])`；`cacheConfig.enableStats` 的统计采集有开销，按需开启
- **按需引入 extras**：不用到的能力不要 import，小程序主包只带真正用到的代码
- **大对象用异步快照**：`batchSize` 控制单批工作量（默认 100），批间让出控制权避免长任务卡顿
- **独立缓存**：需要自有策略时直接用 `LRUCache`（容量淘汰 + TTL）
- 内部定时器均做 `unref` 探测，浏览器/小程序无该 API 时自动跳过，不会阻止进程退出

## 12. 排错手册

| 症状 | 常见原因 | 处理 |
| --- | --- | --- |
| 直接改 `state.x` 报错 | 状态保护拦截非法变更 | 改用 `setState` / `$patch`；或确认是否需要 `stateProtection` |
| 监听器没被调用 | `onlyOnChange` 下确实没改动状态；或 `notify.async` 下还在同一 tick | 检查是否真的写入了状态；必要时去掉 `notify.async` |
| 通知次数「偏多」 | 异步 action 同步段与续段各改一次，或与 batch 交叉 | 由 action 统一合并写入，或用 `batch` 收尾 |
| `await dispatch(...)` 拿到 `undefined` | 方法不是 `async` 语法但返回 Promise，且首次调用被节流抑制 | `withThrottle(…, { assumeAsync: true })` |
| 持久化没有生效 | 传了异步 storage 后端（被显式拒绝） | 改用同步后端（`WxStorageBackend` 或自封装同步实现） |
| 快照里少了字段 | 该节点克隆失败被丢弃（隔离契约） | 查看 `snapshot.errors` 的 `path` 定位；按需用 `customCloner` 接管 |
| 缓存命中率低 | 缓存键过多或状态频繁整体替换 | 只缓存热点键；避免 `$replaceState` 整体替换 |
| 生产环境看不到插件日志 | `NODE_ENV=production` 下静默 | 属预期行为；排查时临时切换开发模式 |

## 13. 从哪里开始

| 想做的事 | 参考 |
| --- | --- |
| 最小可运行示例 | [`examples/basic/01-simple-store.ts`](../examples/basic/01-simple-store.ts) |
| 页面/组件/App 集成 | [`examples/weapp/`](../examples/weapp) |
| 缓存策略 | [`examples/cache/`](../examples/cache) |
| 组合与插件 | [`examples/advanced/`](../examples/advanced) |
| 快照 / 选择器 / 装饰器 | [`examples/extras/`](../examples/extras) |
