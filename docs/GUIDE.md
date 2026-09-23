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

### 1.2 页面中使用

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

Page 的 `onUnload` 与 Component 的 `lifetimes.detached` 会先执行用户钩子，再在 `finally` 中清理绑定；同步段仍可调用映射 actions，同步抛错也不会漏清理。包装器不等待异步钩子返回的 Promise，不要在 `await` 后依赖绑定仍可用。

### 1.4 App 级

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

> 生命周期内的 `this` 已由集成层注入：映射状态出现在 `this.globalData` 上，映射的 action 与调试 API 直接可用，**无需手写 `this` 标注**——三个集成的差异详见 FAQ。

## 2. 状态

### 读写

| 操作                                   | API                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------- |
| 读取（活动引用）                       | `store.getState()`                                                        |
| 读取（内置缓存）                       | `store.getCached(key)`——**这是缓存的唯一读取入口**，`getState()` 不查缓存 |
| 不可变副本（深克隆 + 冻结纯对象/数组） | `store.$snapshot()`                                                       |
| 单键 / 多键合并写入                    | `store.setState(key, value)` / `store.$patch({ ... })`                    |
| 整体替换（支持工厂）                   | `store.$replaceState({ ... })` 或 `store.$replaceState(() => ({ ... }))`  |
| 从快照恢复                             | `store.$restore(snapshot)`（经 `$replaceState`，不重复深拷贝）            |
| 失效缓存条目                           | `store.invalidateCache(key?)`（不传即整表清空）                           |

```ts
const snap = store.$snapshot() // Readonly<S>；纯对象与数组链被冻结，Date/Map/Set 内部仍可变
store.$patch({ count: 1 })
store.$restore(snap) // 回到快照时刻
```

**缓存的读写口径**（`enableCache` / `cacheConfig`）：命中与未命中只在 `getCached()` 上发生，所以 `getCacheStats()` 的 `hits/misses` 也只统计这条入口——用 `getState()` 读多少遍都不会产生一次命中。`setState` / `$patch` 是**写穿**（把最终值同步回写进缓存条目，条目不删除、也不算未命中，下次 `getCached` 直接拿到新值）；真正让条目消失的是 `invalidateCache()` 与 `$replaceState`（后者整表清空后按新状态回填）。集成层（`withPageStore` / `withComponentStore`）绑定映射键时走的就是 `getCached()`。

**原型链敏感键**：`setState('__proto__', …)`（以及 `'constructor'` / `'prototype'`）自 0.7.0 起走 DefineOwnProperty 语义，与 `$patch` / `$replaceState` 共用同一份判据——值被承载为状态对象上的**自有数据属性**，原型保持不变。旧行为是触发 `Object.prototype` 的 `__proto__` setter：传对象时整个状态对象的原型被换掉（此后任何缺失键都能经这条链读到注入值），传非对象时什么都没写成功却照样推进变更计数、脏键与通知。要读回自己写进去的那个值请用 `Object.getOwnPropertyDescriptor(state, '__proto__')`——`state.__proto__` 这个表达式仍然命中 `Object.prototype` 上的访问器、返回的是原型。

### 就地变异与隔离

`getState()` 返回的是内部状态的引用，写入是**就地变异**——因此不能靠 `===` 判断内容是否变化（这也是缓存/通知判定依赖内部版本号与脏计数的原因）。需要与内部隔离的副本时用 `$snapshot()`（深克隆 + 冻结纯对象 / 数组链；类实例、函数、弱集合等仍共享引用，且 Date/RegExp/Map/Set 的 mutator 拦不住）；需要错误账本、进度与丢弃语义的一次性深拷贝用 `createSnapshot()`（见 §7）。两条克隆引擎对「子类与带内部槽位的内建值」的口径自 0.7.0 起一致：**保留原引用**而不是重建，所以别指望快照把 `MyMap extends Map` 或 `ArrayBuffer` 变成可写的独立副本。

### 状态保护

开启 `stateProtection` 后，绕过 `setState` / `$patch` 的直接变异（含 `Object.defineProperty`、数组元素赋值）会**抛错**并在开发模式给出可读路径；`deep: false` 表示只保护顶层（性能优先，嵌套对象不再包装）。嵌套数组走数组专用代理，错误路径形如 `matrix[0][0]`。`setStateProtection()` 与其他写接口一样在 Store 销毁后抛错（只读的 `isStateProtectionEnabled` / `getStateProtectionConfig` 仍可用）。

> **冻结 / 不可写属性是明确豁免**：状态树里被 `Object.freeze`（或 `defineProperty` 成 `writable: false` + `configurable: false`）的属性拿到的是**裸引用**，不被包进保护代理，对它赋值也不产生抛错。这不是漏护，而是 Proxy `[[Get]]` 不变量的硬要求——不可配置且不可写的自有数据属性，代理必须原样返回目标的值，否则读取本身就抛 `TypeError`（修复前的行为：`store.setState('user', otherStore.$snapshot().user)` 之后连读 `store.state.user.address` 都会崩）。代价是这类子树**不受写保护、也不计入变更计数与脏键**：`$snapshot()` 的深冻结子树写回状态、或任何你自己 freeze 进来的对象都属于这一档，想观察它们的变化请显式 `setState` 换引用。读取不再抛错，写入由 JS 自身规则处理（严格模式下赋给冻结属性仍抛 `TypeError`，但那不是本库的守卫）。

### 批量更新

```ts
store.batch(() => {
  // 期间合并通知，结束时统一发一次
  store.setState('a', 1)
  store.setState('b', 2)
})
```

也可手动 `startBatch()` / `endBatch()`（支持嵌套，仅最外层收尾时通知）。

> ⚠️ `batch(fn)` 传入**异步回调**时，`await` 之后的变更会逐条通知——批保护只在同步段有效（开发模式会显式告警）。异步场景请让 action 承担合并职责。

## 3. Action

```ts
store.dispatch('login', user) // 同步 action：原样返回其返回值
await store.dispatch('load') // 异步 action：返回 Promise，失败原样抛出
```

Action 内的 `this.state` 是可写脏跟踪代理：默认与 `onlyOnChange` 模式均跟踪对象 / 数组 / Map / Set 的直接变异，并标记所有受影响的顶层键（含别名，异步段的脏键累积到通知时）。Date 等其他内建对象的内部变异不被跟踪，请用 `setState` / `$patch` 替换值。`onlyOnChange` 依据写入计数而非前后内容深比较，不能用于过滤所有同值写入。

**通知语义**（只有一个统一规则，避免重复/遗漏）：

- 异步 action 的**同步段在 `dispatch` 当场就补发一次通知**（0.7.0 起；此前同步段完全静默、等结算那一轮覆盖），结算（fulfill 或 reject）时再发一次覆盖 `await` 之后的续段变更
- 因此默认模式下「同步段有写入且最终 settle」的一次异步 action 你会看到 **2 次**通知（旧版是 1 次）；`notify.async` 的同一 tick 合并与 `onlyOnChange` 都会把它吸收回 1 次——`onlyOnChange` 依据写入计数去重，同步段没有实际写入时也不多刷
- 这条兜底换来的是：Promise **永不 settle**（悬挂的请求、被吞掉的回调）时同步段的写入当场可见，不再依赖「下一个不相干通知」才浮出来
- **嵌套 dispatch 仅最外层通知**；与 batch 交叉时由 batch 收尾统一通知（batch 内不提前补发）
- reject 是 action 最常见的失败形态，**也会先补发 `onError` 钩子**（监控/上报插件对异步失败不失明）

**Action 增强**（`extras/action`）：

```ts
import { ActionLoader, withLoading } from '@openlide/geomstore/extras/action'

const loader = new ActionLoader({ perActionKeys: true }) // loading/error 键按 action 名区分
const wrapped = loader.wrap(doIt, 'doIt', setState) // setState 为 (key, value) 两参数
```

- `withLoading` 的引用计数按 (宿主, loading 键) 集中：多个装饰器并发不会提前翻转 `loading`（其默认键名 `loading` / `error` / `errorData` 在库内是单一来源，与 `ActionLoader` 构造器同源）
- `withThrottle(interval, { leading, trailing, assumeAsync })`：间隔是**第一个位置参数**；`assumeAsync` 用于「非 `async` 语法但返回 Promise」的方法被抑制时仍返回 Promise
- **装饰同步方法的 `withRetry` 会改变返回类型**：`T → Promise<T>`、原本同步抛出的错误转成 rejection，调用方必须 `await`（重试间隔靠 `await setTimeout`，改成同步就得阻塞事件循环或放弃退避）。不想改调用方就别给同步方法加它
- 超时错误按 **`code === 'ACTION_TIMEOUT'`** 判定（`withTimeout` 装饰器与 `executeWithTimeout` 两个入口的**文案不同**、`code` 相同，文本只作展示）；`withTimeout` 的 `timeout` 在工厂阶段就校验，`0` / 负数 / `NaN` / `Infinity` 直接抛 `RangeError`，不会先把 action 启动起来再炸

**宿主卸载点的收尾**（`withThrottle` / `withDebounce`）：窗口 / 延迟还没到期就销毁页面或组件时，挂起的调用到点仍会执行（并拖住宿主不被回收）。六个入口都以**宿主**为参数——装饰器表达式在类定义期就被丢弃，卸载点手里只有 `this`。**适用范围只有一个前提：被装饰的方法要能被调用方拿到那个 `this`**，也就是装饰 Page / Component / 自己 new 出来的类上的方法；装饰 **store action** 时六个入口一律静默 no-op（见本节末尾）。

```ts
import {
  withDebounce,
  withThrottle,
  cancelDebouncedCalls,
  flushDebouncedCalls,
  disposeDebouncedState,
  cancelThrottledCalls,
  flushThrottledCalls,
  disposeThrottledState,
} from '@openlide/geomstore/extras/action'

class CartPage {
  @withDebounce(300)
  async submitDraft(draft: string) {
    return this.store.dispatch('saveDraft', draft)
  }

  @withThrottle(100, { leading: true, trailing: true })
  onScroll(position: number) {
    this.store.dispatch('setScroll', position)
  }

  onUnload() {
    flushDebouncedCalls(this, 'submitDraft') // 离开前把最后一次草稿提交掉：立即执行且只执行一次
    cancelThrottledCalls(this) // 挂起的滚动补发直接丢弃
  }
}
```

Component 侧同理，写在 `lifetimes.detached` 里（集成层只清订阅与映射，不会替你清这些定时器）：

```ts
class Panel {
  @withDebounce(200)
  persistHeight(height: number) {
    this.store.dispatch('resize', height)
  }

  lifetimes = {
    detached() {
      disposeDebouncedState(this) // 取消挂起调用 + 释放该宿主的整张防抖状态表
    },
  }
}
```

入口认的是**调用被装饰方法时的 `this`**（宿主实例），不是装饰期那个类对象：`onUnload` / `detached` 里的 `this` 就是它，所以配置对象写法（`withComponentStore(store, {…})({ lifetimes: { detached() { disposeDebouncedState(this) } } })`）与类写法同样成立。这两个钩子由集成层先执行、再清订阅，收尾调用放在钩子**同步段**。

- `cancel*` **丢弃**挂起调用；`flush*` **立即执行且只执行一次**（无挂起调用时不凭空执行，重复 flush 是 no-op）；`dispose*` = 取消 **+** 释放该宿主的整张状态表（节流连窗口计时一起归零），卸载点想一句话收尾就只调它
- 被取消的防抖调用：其 Promise 以 `Error('[withDebounce] pending call was cancelled')` 拒绝，`await` 方看得到（库先补 `catch` 只为消除全局未处理告警）。节流的被抑制调用当时就已返回 `undefined`（或 `Promise<undefined>`），没有可取消的 Promise
- `method` 参数可省略（覆盖该宿主上所有被装饰方法）；宿主为基本类型 / `null` 时六个入口都是 no-op；`withCache` / `withRetry` 目前**没有**对应入口

**装饰 store action 时这六个入口不可用（0.7.0 定稿的口径，不是待修缺陷）**：`withDebounce` / `withThrottle` 的状态以**调用时的 `this`** 为键，而 store action 的 `this` 是 `ActionManager` 内部为一次 dispatch 现造的 action 上下文代理——它只被那批绑定闭包捕获，不挂在 `store.actions` / `store` 的任何公开成员上。于是 `cancelDebouncedCalls(store.actions)`、`disposeThrottledState(this /* 页面实例 */)` 这类调用找不到槽位，**静默 no-op**（不抛错、也不清定时器）。本库刻意不把那个上下文暴露出来：一旦公开，「装饰器内部槽位键」就变成跨 core 与 extras 的公开契约，换来的只是这组收尾入口在 store action 上可用。替代路径两条，任选其一：

```ts
// ① 装饰页面 / 组件上的方法，让它去 dispatch —— 卸载点手里有 this，收尾入口正常生效
class CartPage {
  @withDebounce(300)
  submitDraft(draft: string) {
    return this.store.dispatch('saveDraft', draft)
  }
  onUnload() {
    disposeDebouncedState(this)
  }
}

// ② 想在 store 那边复用同一段防抖逻辑：自己包一层，让那一层的实例当宿主
class CartApi {
  store = cartStore
  @withDebounce(300)
  saveDraft(draft: string) {
    return this.store.dispatch('saveDraft', draft)
  }
}
const cartApi = new CartApi()
cartApi.saveDraft('draft') // 与直接 dispatch 同样经过去抖
cancelDebouncedCalls(cartApi) // 宿主就是 cartApi，槽位找得到
```

判断自己有没有踩到：看被装饰方法**实际被调用时**的 `this`。`store.dispatch('foo')` 走的是 Store 注入的那个 action 上下文（每次 dispatch 现造的代理），不是你手上的任何对象——此时收尾入口拿不到槽位。页面 / 组件方法里的 `this.foo()` 才是可寻址宿主（`onUnload` / `detached` 的 `this` 与它同一个实例）。

## 4. Getter

```ts
const total = store.getter('total') // 泛型签名会推导出返回类型
```

- getter **只接收 state**（需要组合时在函数体内自行计算），保持纯函数便于调试
- **没有结果缓存**：每次 `store.getter(name)` 都按当前状态重算一遍。库里不存在 getter 级的 memo 表、也没有「依赖未变就复用上次结果」这回事——内部版本号只用于**选择器**与**缓存失效**，不作用于 getter
- 需要「依赖未变时不重算」请用 `extras/selector` 的 `createSelector`（见 §8）：它按状态版本号做 O(1) 失效判定，才是本库的记忆化入口。重算的代价随计算量线性增长，热路径上的 getter 请改写成选择器
- Store 销毁后 `getter(name)` 抛错（`getters` 注册表本身不注销，但读取入口有销毁守卫，见 §12 与 FAQ）

## 5. 订阅与通知

```ts
const unsubscribe = store.subscribe((state) => {
  /* 只接收新状态 */
})
unsubscribe()

store.subscribe(listener, { readOnly: true }) // 声明不写状态：全部订阅者都只读时通知载荷免深拷贝
```

| 配置                  | 作用                                                                                                                                                                                                                                                              | 默认           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `notify.clone`        | 通知时是否深拷贝载荷。**未配置与显式 `false` 同义（自动）**：仅当存在可写注册时拷贝——每个可写注册各一份、只读注册共用一份；全部注册只读时零拷贝（状态保护开启给只读保护 Proxy、关闭给原始引用）。显式 `true` 强制拷贝，即使本轮只有只读注册（那时是共用的那一份） | 未配置（自动） |
| `notify.async`        | 微任务合并：同一 tick 内多次写入只通知一次                                                                                                                                                                                                                        | `false`        |
| `notify.onlyOnChange` | dispatch / batch 期间未检测到写入则不通知（依据变更计数，非内容深比较）                                                                                                                                                                                           | `false`        |

- 监听器签名是 **`(state: S) => void`**（没有 `prevState` 参数），需要前后对比请在闭包里自行保存
- 订阅额度对**每一次注册**生效（含同一监听器的重复注册），`maxSubscribers` 是硬上界：达上限时按 `subscription.onLimit` 策略处理——`throw` 直接抛错；`evict-oldest` 驱逐一份最早注册，**本次若是重复注册就让位该监听器自己最早的那一份**，否则驱逐全局最旧的一份（都以「一份注册」为单位，不会整条删除某个监听器）。重复调用同一退订句柄是幂等的，不会移除其他注册
- 驱逐在生产不再是完全静默：`evict-oldest` 触发时会向 `onError` 钩子发一次 `Error`（第二参 `'subscribe'`，消息含被驱逐监听器的名字与上限值），只订阅 `onError` 做监控的调用方会多看到这一类事件
- 回调抛错被逐个隔离（不影响其余监听器）：开发模式打印，生产模式经 `onError` 钩子上报——坏订阅者不再无声漏掉全部更新。本轮派发的是进入通知时在册的注册，回调内退订自己仍会收到最后一次
- `store.isStateKeyDirty(key)` 供集成层跳过未变化的映射键（避免无意义的 `setData`），`key` 取 `string | symbol`（symbol 顶层键同样有脏位可查）；`$replaceState` 会把**被这次替换删掉的旧键**一并标脏

## 6. 钩子与插件

```ts
store.hooks.on('afterPatch', (patch) => console.log('patched', patch))
```

可用钩子：`beforeDispatch` / `afterDispatch` / `beforeSetState` / `afterSetState` / `beforePatch` / `afterPatch` / `beforeReplaceState` / `afterReplaceState` / `beforeGet` / `afterGet` / `onError` 等。

**插件契约**：`{ name, install(store) }`，`install` 返回卸载函数；`store.use(plugin)` 返回同一个卸载函数。

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

- **持久化后端必须是同步实现且三方法齐备**（`getItem` / `setItem` / `removeItem`）：缺任一方法在 `store.use()` 安装期即抛 `TypeError`，返回 Promise 的实现会在恢复 / 落盘 / 清理时明确报错并记日志——不再静默回落到别的后端（那会把数据写到另一个地方）
- **不传 `storage` 时的默认后端就是 `WxStorageBackend`**（与显式 `new WxStorageBackend()` 同一份实现，0.6.0 起收口）：微信对缺失键返回的 `''` 按「无数据」处理，非字符串载荷同样按无数据；`wx` 需 `getStorageSync` / `setStorageSync` / `removeStorageSync` **三方法齐备**才算可用后端
- **直接用 `new WxStorageBackend()`（不经插件）时，`wx` 或对应方法缺失 / 非函数就抛错**，不会把读写删短路成静默 no-op——插件路径靠 `isWxStorageSyncAvailable()` 先探测，探测不通过才走降级；自建实例没有这道探测，请自行确认环境
- 检测不到可用的 wx 同步 API（非微信环境、或 `wx` 残缺）时降级为内存存储：开发模式 `console.warn`，**生产模式经 `onError` 钩子上报**（`emit('onError', error, 'persistence')`），别再指望控制台
- 卸载时会**同步补写**防抖窗口内的最后一次变更；`clearOnUninstall: true` 则改为清理存储，删除失败会记日志并 `emit('onError', …)`（不再谎报已清除）
- **恢复失败**（后端抛错、JSON 语法错、解析结果不是可信纯对象、被 `validate` 拒收、`$patch` 被拒）除 `console.error` 外同样 `emit('onError', error, 'persistence')`：只订阅 `onError` 的监控现在会多看到这一类事件
- `store.use` 安装抛错会回滚入列，不留半安装插件；生产模式下安装/卸载日志静默
- 独立函数 `usePlugin(plugin, store)` 等价且**无需断言**：泛型从 `store` 反推，`plugin` 需与其状态类型匹配（状态无关的插件写作 `Plugin<State>`，如 `loggerPlugin`）。日常也可直接用 `store.use`

## 7. 快照（`extras/snapshot`）

```ts
import { createSnapshot, createSnapshotAsync, compareSnapshots } from '@openlide/geomstore/extras/snapshot'

const snap = createSnapshot(store.getState())
snap.data // 隔离副本；无法安全克隆的节点被丢弃而非兜底（异常/中止时为 undefined）
snap.success // 存在 cloneError 或超时即为 false
snap.errors // 错误账本（path / type / message）；循环引用也入账（type 为 'circular'）
snap.metadata // nodeCount / size / duration 等（nodeCount 两条路径同口径）

const async = await createSnapshotAsync(bigObject, {
  batchSize: 100, // 批间让出控制权
  onProgress: (p) => console.log(p.percentage), // 回调抛错被就地兜住，不影响本次快照
  onError: (err) => true, // truthy=忽略该错误并按种类降级；falsy（含不写 return）=拒绝继续
})
```

要点：

- **隔离契约**：无法安全克隆的节点一律**丢弃**，绝不把原值兜底进快照；丢弃时对象属性不写入、数组留洞、`Set` 不添加、`Map` 跳过整条 entry；异常或中止交付的 `data` 是 `undefined`
- **`onError` 按真值解释**（判定写法是 `if (!shouldContinue)`）：只观测请显式 `return true`，否则一个不写 `return` 的箭头函数会中止整次快照。「拒绝继续」的后果分岔——`cloneError` 抛 `SnapshotAbortError`（`success: false`），`circular` 只写 `'[Circular Reference]'` 占位并继续（快照仍可 `success: true`）；`maxDepth` / `timeout` 不经该回调
- `maxDepth` 超限返回占位符（不是活引用）；类实例重建为**同类实例**（原型与方法可用，不触发构造器）；访问器属性以 getter 求值结果克隆；函数按引用共享（无内部状态）
- **两类节点保留原引用、不克隆**（0.7.0 起与核心 `deepCloneState` 同口径，同步与异步两条路径一致）：① `Date` / `RegExp` / `Map` / `Set` / `Array` 的**子类实例**（旧行为是 `new Map()` 重建 → 子类字段与方法全丢、`instanceof` 判false）；② 值靠**内部槽位**承载的对象——`Promise`、装箱原始值 `new Number(1)` / `new String('x')`、`ArrayBuffer` / TypedArray / DataView、`WeakMap` / `WeakSet`、`Error`、生成器（旧行为是 `Object.create(原原型)` + 拷自有键的**空壳**：`instanceof` 仍真但槽位缺失，`await snap.data.p`、`Number(snap.data.n)` 都会抛）。想给这两类做真正的隔离副本，请用 `customCloner` 自己接管该节点——那是本库留的兜底出口
- 数组上的**附加自有键**（非下标、非 `length` 的那批）两条路径都跟着克隆，访问器按描述符还原；`includeNonEnumerable: true` 时被拷进来的键一律落为可枚举（否则 `Object.keys` / `JSON.stringify` / diff 的键集比对都看不见它们）
- `customCloner` 抛错的语义在同步/异步路径**完全一致**（落账 → 咨询 `onError` → 继续则丢子树 / 中止则抛 `SnapshotAbortError`）
- **同步实现是递归的**（栈深＝数据深度）：深度上限取 `maxDepth`（默认 100）与一个与选项无关的**栈安全硬上限 `HARD_MAX_CLONE_DEPTH = 1000`** 的较小值——把 `maxDepth` 抬到 1000 以上不再能撑爆调用栈，超出部分按 `maxDepth` 落一条错误 + 占位符（不影响 `success`）。`maxDepth` 传 `NaN` / `Infinity` 也落到硬上限，超深结构请用异步路径（任务队列，不占调用栈）
- **先判 `success` 再用结果**：`compareSnapshots(a, b)` 的返回类型新增必填字段 `inputTrusted`——任一侧快照 `success: false` 时它即为 `false`，比对**不再逐路径展开**、交付一条 root 级整体差异，于是 `changed` **恒为 true**。看到 `changed: true` 但 `changes[0].path` 是根路径时，真实含义是「输入不可信」而不是「内容有差异」
- `compareSnapshots` 的 100 层逐路径护栏只终止展开、不再无条件记为差异：超出后退化为迭代式 `deepEqual`，两侧内容相同就不报 `changed`
- **差异路径的方言**（`changes[].path`，与克隆账本 `errors[].path` 逐字一致）：`Map` 的值差异记 `root.<String(key)>`、键的新增 / 删除记 `root.key.<String(key)>`（0.7.0 起按**键身份**生成，不再用「两侧各自的迭代下标」，所以同一条路径不随插入顺序漂移、双向比对也给出同一路径）；`Symbol` 键走 `String()`，`toString` 抛错的键退回 `<unstringifiable key>`。`Set` 的 `[removed:i]` / `[added:i]` 里的 `i` 是**报告序下标、不是条目身份**——按 `root[0]` 这类下标聚合 Map 条目的消费方需要换成按键身份，跨快照配对 `Set` 变化请读 `oldValue` / `newValue`

## 8. 选择器（`extras/selector`）

本库的**记忆化入口只有选择器**：Store 侧的 getter 每次读取都重算（见 §4），没有结果缓存这回事。想让「依赖未变时不重算」成立，就把那段计算写成 `createSelector`。

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

缓存命中判定同时校验**状态对象身份与版本号**，不同 Store 即使版本相同也不会串值；状态不带版本号（如直接传入的普通对象）时回退 `equalityFn`（默认 `deepEqual`）比较**输入状态**。此时失效凭证是写缓存时的那份**内容快照**（`snapshotState` 默认 `true`），就地变异因此能被看见；只有比较器本身是引用相等（`(a, b) => a === b`）时才显式传 `snapshotState: false` 换掉这趟克隆——只传引用比较器而不关快照会**永不命中**（克隆体与活引用永不相等，不返回错值但 memo 失效）。`SelectorComposer` 提供异步与重试形态，重试错误带不可枚举的 `attempts` 记录真实执行次数。

## 9. 组合 Store

```ts
import { composeStore } from '@openlide/geomstore'

const root = composeStore([userStore, cartStore], { namespace: true, strict: true })
root.dispatch('user/updateName', 'Bob') // 命名空间下的斜杠路径
root.subscribe((state) => {
  /* 任一子 store 变化都会收到 */
})
```

- 命名空间模式下状态按 `name` 嵌套；`isStateKeyDirty` 精确判断子 store 是否变化，集成层据此跳过未变化的 `setData`。通知回调内的重入写入归**下一轮**（本轮收尾只作废本轮脏键）
- 组合层 N 个监听器只占每个子 store 一份订阅，且该订阅是只读注册的（子 store 免深拷贝）；组合层存在可写监听器时由组合层自己深拷贝一次载荷
- `composed.state` 顶层冻结、嵌套经子 store 保护代理，写入不会穿透
- 合并缓存在读取前校验子 Store 版本，批内及异步通知前也能读到最新状态；无版本号的子 Store（含嵌套组合）每次读取保守失效
- 子 Store 的 `actions` 注册表会合并，外层组合可按裸名路由嵌套组合的 action；非命名空间模式同名取第一个 Store
- 非命名空间外层包含命名空间内层时，内层子 store 的键写作 `'子store名/键'`：`flat.setState('leaf/count', 1)`、`flat.$patch({ 'leaf/count': 2 })`（构造期开发模式会提示书写形式）
- 需要按名字管理多个 store 时用 `StoreRegistry`
- **子 store 在组合之外被独立 `destroy()` 时，组合层不再抛错**（0.7.0 起）：三条读路径（`getState()` / `state` / `$snapshot()`）与写路径同口径，把已销毁的那个子 store 按**空视图**并入、按 store 去重**告警一次**，其余存活的子 store 照常可读可写。此前是「一个子店销毁 → 整个组合每次读取都抛 `Cannot call getState on a destroyed Store`」，而同一时刻 `$patch` 却正常跳过它——读写两侧口径不一致。注意后果：合并状态里那个命名空间会变成**空对象**而不是缺失键，靠 `composed.getState().child` 是否存在来判断子店存活的写法要改成看告警 / 自己持有引用；组合本身仍可用，销毁组合请走 `composed.destroy()`

## 10. 错误处理（`extras/error`）

```ts
import { ErrorBoundary, ErrorMonitoring, ConsoleReporter, HttpReporter } from '@openlide/geomstore/extras/error'

const boundary = new ErrorBoundary({ fallback: (error) => ({ failed: true }) })
const state = boundary.execute(() => risky(), store)

const monitoring = new ErrorMonitoring({
  reporters: [new ConsoleReporter(), new HttpReporter({ endpoint })],
  batchThreshold: 10,
  maxQueueSize: 1000, // 队列容量（默认 1000）
  maxFlushRetries: 3, // 全部报告器连续失败的重入队上限（默认 3）
})
```

- **`ErrorBoundary` 默认 fail-loud**：未配置 `fallback` 时错误重抛；提供 `fallback` 即声明恢复意图。`fallback` 函数自身抛错时会**重抛原始错误**（不丢失现场）。非 `Error` 的抛出值（`throw 'str'`）先归一化为 `Error` 再记账与传给回调，重抛时仍是原始值；显式 `recoverable: true` 而未配 `fallback` 时返回 `undefined`
- **`ErrorRecovery`** 策略含 `RETRY` / `FALLBACK` / `IGNORE` / `RECOVER` / `RESTART`；重试额度按**故障周期**计量（窗口 = `max(60s, 本周期退避总时长 × 2)`），并有键容量守卫防动态 operation id 导致的无界增长。**额度用尽后同一故障周期内持续拦截**：抛 `Max retries (n) exceeded` 时保留计数与周期窗，只有时间窗过期才开新周期，故在同一失败循环里反复 `recover()` 不会再领到一整个新额度。抛出的失败是 `GeomStoreError`（`code: INTERNAL_ERROR`、带 `cause` 与 `context`，`context.retryKey` 指明被用满的是哪一份额度；两个来源都缺时键名为 `<code>:unattributed`）。`recover(error, context)` 的 `error` / `config` / `attempt` 由库内写入，调用方无法覆盖实际执行的策略
- **`ErrorMonitoring`** 批量 flush 对每个 reporter 做 `ok / fail / timeout` 三态判定——仅真正 resolve 才算成功（`reportTimeout <= 0` 表示不超时）；全部失败时按序重入队重试，连续失败超过 `maxFlushRetries` 丢弃该批并告警；`clear()` 复位连续失败计数（不停调度器），并**作废在途 flush 的重入队**（旧批次不再回流、也不再把 `consecutiveFlushFailures` 从无拨成 1）。溢出被丢弃的条数由 `getDroppedErrors()` 读，并随 `generateReport()` 的 `summary.droppedErrors` 一起出去——它与 `summary.totalErrors`（观测到的错误总数）、`queuedErrors` 是三个互不重叠的口径，不能相加核对。容量类入参会被下限裁剪：`maxQueueSize` 最小 1（默认 1000）、`maxFlushRetries` 最小 0（默认 3），`0` / 负数 / 非有限值不再让上报链近乎静默失效
- **聚合统计可信**：`getStats().byStore` 之和恒等于 `totalErrors`（错误组被驱逐时其计数一并删除）；`ErrorGroup.sampleError` 不含 `payload`（避免钉住 store / 页面节点）且随命中刷新。`getGroups()` / `addError()` / `getErrorGroups()` / `generateReport()` 交出的都是**副本**，改它们不再污染内部账目（`handleError` 交给用户 handler 的上下文、`logError` 入库的条目同样是副本）
- `HttpReporter` 自动选择 `wx.request`（校验 `statusCode`、透传 `timeout`）或 `fetch`（校验 `ok`），可注入自定义实现；`Headers` 形参数按鸭子类型归一化（真实 `Headers` 实例不再被展开成空对象而丢头），`Content-Type: application/json` 只在**默认请求实现**里兜底（注入实现收到的是归一化后的调用方请求头，自带任意大小写的 `content-type` 时不被覆盖）。一条坏数据只伤它自己：非 `Error` 的 `context.error` 被投影成可读字符串而不是让整批 reject，含 BigInt / 循环引用的 `payload` 降级为 `[Unserializable payload: …]` 字符串标记，批次照常发送
- 基础库缺少 `console.group`（或它调用即抛）时 `ConsoleReporter` 自动降级为平铺输出并保证 `groupEnd` 恰好一次（`groupEnd` 自身抛错不会顶掉组内业务输出的异常）；`payload` 为 `0` / `''` / `false` / `NaN` 时也会打印（只有 `undefined` 与显式 `null` 视为没带 payload），批量行里缺失的 store 名以 `UNKNOWN` 占位

## 11. 性能与体积

- **只缓存热点键**：`enableCache(['visibleRows'])`；缓存**只对 `getCached()` 生效**（`getState()` 不查缓存，用它读多少遍都测不出命中），`setState` / `$patch` 是写穿、不是失效，想主动清就用 `invalidateCache()`
- **`cacheConfig.enableStats` 默认就是 `true`**：显式传 `true` 不打开任何东西，「按需开启」的方向其实是反的——性能敏感场景传 `false` 关掉计数（代价是 `getCacheStats()` 的 `hits` / `misses` 恒为 0，命中率无从观测）
- **按需引入 extras**：没 import 的能力不要进模块图。**体积上的收益取决于宿主有没有打包器**：走 webpack / vite / esbuild 时摇掉的代码直接不进包；只用 npm + 开发者工具「构建 npm」时，包体积按包内 `miniprogram` 目录（`dist-weapp/`，含全部子入口）整目录计，此时子路径分层换来的是「运行时只加载被 `require` 的文件」，不是上传体积变小
- **大对象用异步快照**：`batchSize` 控制单批工作量（默认 100），批间让出控制权避免长任务卡顿。非法值不会交付半成品——构造期默认值与逐次调用共用一个归一化函数（`0` / 负数夹到 1，`NaN` / `Infinity` 回落 100），`timeout` / `batchInterval` 则统一按「非有限值与非正值 = 不设超时 / 无延迟」处理，`timeout: Infinity` 不会再被宿主夹成一次莫名的立即超时
- **独立缓存**：需要自有策略时直接用 `LRUCache`（容量淘汰 + TTL）
- **列表逐项写入不再是平方级**：脏键归属索引改增量维护，`push` / 新增键这类「只加边」的写入按新子树增量登记，标量写入 O(1) 查表。仍会走一次全量重建的是**删边类**写入：覆盖已有的对象值、`delete` 掉对象值键、`Map#set` 覆盖值已是对象的键、`Map` / `Set` 的 `delete` / `clear`。高频循环里倾向「追加 / 换引用」，别反复原地替换同一批对象
- 内部定时器均做 `unref` 探测，浏览器/小程序无该 API 时自动跳过，不会阻止进程退出；**防抖 / 节流的挂起定时器不在其列**——它会一直活到窗口 / 延迟到期，宿主卸载点请用 `cancel*` / `dispose*` 收尾（见第 3 节）。这条只对**可寻址宿主**上的方法成立：被 `dispatch` 出去的 store action 上，那六个入口按设计定位不到槽位，所以装饰器请挂在页面 / 组件方法上（§3 末给了两种可收尾的写法）

## 12. 排错手册

| 症状                                                                                    | 常见原因                                                                                                                                                                                  | 处理                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 直接改 `state.x` 报错                                                                   | 状态保护拦截非法变更                                                                                                                                                                      | 改用 `setState` / `$patch`；或确认是否需要 `stateProtection`                                                                                                                                                                      |
| 读到某个嵌套属性时抛 `TypeError: 'get' on proxy…`                                       | 该属性是冻结 / 不可写且不可配置的（例如把 `$snapshot()` 的深冻结子树写回了状态）                                                                                                          | 0.7.0 起这类属性返回裸引用、读取不再抛错，代价是不受写保护也不计脏——见 §2「状态保护」；要观察其变化请换引用后 `setState`                                                                                                          |
| 监听器没被调用                                                                          | `onlyOnChange` 下确实没改动状态；或 `notify.async` 下还在同一 tick                                                                                                                        | 检查是否真的写入了状态；必要时去掉 `notify.async`                                                                                                                                                                                 |
| 通知次数「偏多」（一次异步 action 收到 2 次）                                           | 0.7.0 起异步 action 的同步段当场补发一次、settle 再发一次（刻意如此：Promise 悬挂时同步段的写入不再看不见）                                                                               | 需要一轮一次就开 `notify.async`（同 tick 合并）或 `notify.onlyOnChange`（按写入计数去重）；中间态本来就该由两次通知分别观察                                                                                                       |
| `getter()` 好像每次都重算                                                               | Store 侧**没有** getter 结果缓存，这是设计而非失效                                                                                                                                        | 需要记忆化就改用 `createSelector`（§8）；或把重算结果自己 `setState` 成一个派生键                                                                                                                                                 |
| `getCacheStats()` 的 hits / misses 恒为 0                                               | 读取走的是 `getState()`——它不查缓存；或 `enableStats: false` 关了计数                                                                                                                     | 读缓存请用 `getCached(key)`（集成层绑定即走这条）；需要观测就别关 `enableStats`                                                                                                                                                   |
| 「写了缓存条目却没失效」                                                                | `setState` / `$patch` 是**写穿**（更新条目、不删除），本就不产生失效                                                                                                                      | 显式失效用 `invalidateCache(key?)`；`$replaceState` 才是整表清空                                                                                                                                                                  |
| 页面 / 组件已销毁却还在写 Store（`Cannot call … on a destroyed Store`），或宿主回收不掉 | 被 `withDebounce` / `withThrottle` 装饰的方法还有挂起调用，定时器到点照常执行                                                                                                             | 在 `onUnload` / `lifetimes.detached` 调 `cancel*`（丢弃）/ `flush*`（立即执行一次）/ `dispose*`（取消并释放状态），见第 3 节                                                                                                      |
| 上面那组收尾入口「调了没效果」、定时器照旧到点执行                                      | 被装饰的是 **store action**：它的 `this` 是 Store 每次 dispatch 现造的 action 上下文代理，调用方无从当参数传入，六个入口按设计静默 no-op                                                  | 改成人能用的那两种形状：装饰 Page / Component 的方法让它去 `dispatch`，或在 store 外自己包一层并拿住那个宿主（§3 末）                                                                                                             |
| 子 store 被独立销毁后整个组合读不出东西（0.6.x 及之前是每次读取都抛错）                 | 组合层现在把死店按**空视图**并入、只告警一次                                                                                                                                              | 想判断子店是否还在别靠 `getState().child` 的有无（它会变成空对象），自己持有引用或看告警；见 §9                                                                                                                                   |
| `await dispatch(...)` 拿到 `undefined`                                                  | 方法不是 `async` 语法但返回 Promise，且首次调用被节流抑制                                                                                                                                 | `withThrottle(…, { assumeAsync: true })`                                                                                                                                                                                          |
| 页面 / 组件已销毁却还在写 Store（`Cannot call … on a destroyed Store`），或宿主回收不掉 | 被 `withDebounce` / `withThrottle` 装饰的方法还有挂起调用，定时器到点照常执行                                                                                                             | 在 `onUnload` / `lifetimes.detached` 调 `cancel*`（丢弃）/ `flush*`（立即执行一次）/ `dispose*`（取消并释放状态），见第 3 节                                                                                                      |
| 持久化没有生效                                                                          | 传了异步 storage 后端（被显式拒绝并记日志）；或 `wx` 三方法不齐备 / 非微信环境，被降级为内存存储；也可能恢复阶段就被跳过（后端抛错 / JSON 语法错 / 载荷不是可信纯对象 / `validate` 拒收） | 传同步且三方法齐备的后端（`new WxStorageBackend()` 或自封装实现），不传即用微信内置后端；生产环境的降级信号只在 `onError`（控制台静默），恢复失败除 `console.error` 外也发一条 `onError`                                          |
| `store.use(persistencePlugin({ storage }))` 安装即抛 `TypeError`                        | 后端缺 `getItem` / `setItem` / `removeItem` 之一（只读适配器、键名拼错）                                                                                                                  | 补全三个同步方法；接入微信请传 `new WxStorageBackend()`                                                                                                                                                                           |
| 快照结果 `data` 是 `undefined`                                                          | 该次快照异常或被 `onError` 拒绝继续——失败结果按契约**不回传活引用**                                                                                                                       | 读 `errors` 的 `path` 定位；需要保留半成品请自行在 `onError` 里返回 truthy                                                                                                                                                        |
| 日志里出现了 token / 用户数据                                                           | `withLog` 在生产构建只输出摘要（类型 / 长度 / 键数，`Error` **只留 `name`、不含 `message`**），开发构建默认原样打印                                                                       | 需要自定义脱敏或改出口时传 `{ sink, redact }`；注意生产构建下 `redact` 之后**仍会**过一层摘要，要由你全权决定内容须显式 `{ summarizeInProduction: false }`。`sink` / `redact` 自身抛错只记一条告警，不会顶掉或改判被装饰的 action |
| 选择器缓存永不命中（每次重算，但不返回错值）                                            | 状态是**无版本号的普通对象**，且传了引用相等的 `equalityFn: (a, b) => a === b` 却没关快照——缓存里放的是内容克隆，与活引用永不相等                                                         | 同时传 `{ equalityFn, snapshotState: false }`；或改传带版本号的 Store 状态（走 O(1) 版本比较）；或干脆 `cache: false`                                                                                                             |
| 钩子处理器形参仍是 `unknown`                                                            | 精确签名（按 `HookArgsMap` 关联）目前在**插件侧**（`install(store)` 拿到的 `Store` 接口）生效；`createStore(...).hooks` 直连时字段声明为实现类 `HookSystem`，签名是擦除版                 | 在插件里注册即可获得精确形参；直连场景先自行标注参数类型（源码里把该字段换成 `IHookSystem` 后统一）                                                                                                                               |
| 快照里少了字段                                                                          | 该节点克隆失败被丢弃（隔离契约）                                                                                                                                                          | 查看 `snapshot.errors` 的 `path` 定位；按需用 `customCloner` 接管                                                                                                                                                                 |
| 缓存命中率低                                                                            | 缓存键过多或状态频繁整体替换                                                                                                                                                              | 只缓存热点键；避免 `$replaceState` 整体替换                                                                                                                                                                                       |
| 生产环境看不到插件日志                                                                  | `NODE_ENV=production` 下静默                                                                                                                                                              | 属预期行为；排查时临时切换开发模式                                                                                                                                                                                                |

## 13. 从哪里开始

| 想做的事               | 参考                                                                        |
| ---------------------- | --------------------------------------------------------------------------- |
| 最小可运行示例         | [`examples/basic/01-simple-store.ts`](../examples/basic/01-simple-store.ts) |
| 页面/组件/App 集成     | [`examples/weapp/`](../examples/weapp)                                      |
| 缓存策略               | [`examples/cache/`](../examples/cache)                                      |
| 组合与插件             | [`examples/advanced/`](../examples/advanced)                                |
| 快照 / 选择器 / 装饰器 | [`examples/extras/`](../examples/extras)                                    |
