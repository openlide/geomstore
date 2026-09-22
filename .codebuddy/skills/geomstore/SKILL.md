---
name: geomstore
description: 微信小程序状态管理库 GeomStore（@openlide/geomstore，v0.6.1，纯 ESM 瘦核心）的使用指南。当需要编写、修改或审查使用 GeomStore 的代码（创建 Store、定义 actions/getters、接入微信小程序 Page/Component/App、按子入口引入插件/选择器/Store 组合/错误处理/性能监控/快照/缓存/Action 装饰器）时使用此 skill。触发场景：开发微信小程序并涉及状态管理、要求"用 GeomStore 实现 XX"、代码中已出现 createStore/withPageStore/composeStore/createSelector 等调用、或需要排查 GeomStore 相关问题。
---

# GeomStore 使用指南

## Overview

GeomStore 是轻量级微信小程序状态管理库，提供类 Pinia 的 API、完整的 TypeScript 类型推断、企业级能力（Store 组合、插件、错误处理、性能监控、快照、Action 增强）与原生小程序集成（Skyline / Webview）。

当前版本 **v0.6.1**，两条硬性特征决定了绝大多数误用：

- **纯 ESM**：产物为 ESM，没有 CJS 入口，`require('@openlide/geomstore')` 不可用。
- **瘦核心 + 按需子入口**：主入口只含运行必需 API；快照 / 选择器 / 性能 / Action 增强 / 插件 / 企业微信等**不在主入口**，必须从 `extras/*` 引入。

> 版本以仓库 `package.json` 的 `version` 与 `docs/` 为准；本文件若与源码不符，以源码与 `docs/API.md` 为准。

## 使用规则

1. **写代码前先确认签名，不要凭记忆**。查本 skill 自带的 `references/api/index.md`（从构建产物的类型声明自动生成、与当前版本一致，已按入口拆分，只打开所需入口的文件或用检索，方式见文末 Resources）。需要设计意图、选项默认值与语义契约时：在 GeomStore **仓库内**再看 `docs/API.md`，在**其他小程序项目**看已安装包的 `node_modules/@openlide/geomstore/dist/**/*.d.ts`（`docs/` 不随包发布，外部项目不存在）。
2. **导入路径**（`exports` 仅声明下列子路径）：

   | 引入路径 | 内容 |
   | --- | --- |
   | `@openlide/geomstore`（或 `/core`） | `createStore` / `Store` / 工具函数 / `HookSystem` / `usePlugin` / `withPageStore` / `withComponentStore` / `withAppStore` / `composeStore` / `LRUCache` |
   | `@openlide/geomstore/integrations` | 上述 `with*` + 底层绑定工具 `bindMappings` / `parseMapping` / `bindActions` / `performAutoInject` / `exposeStoreAPI` / `cleanupBindings` |
   | `@openlide/geomstore/extras/{snapshot,selector,action,performance,plugins,error,enterprise}` | 各可选能力（推荐按子入口精确引入） |
   | `@openlide/geomstore/extras` | 全部可选能力聚合，会整体拉入产物，仅调试或确实全都要用时引入 |

   微信「构建 npm」走 `package.json` 的 `miniprogram` 字段 → 包内 `dist-weapp/`（**自包含单文件 CJS，覆盖全部 11 个子路径**，导出面与 `dist` 逐项一致）；工具会整目录拷进 `miniprogram_npm`，不拼接、不做依赖分析。另有转发子目录（`store` / `hooks` / `plugins` / `integrations` / `compose` / `selectors` / `snapshot` / `performance` / `actions` / `cache` / `error`）供**其他**不解析 `exports` 的老式场景按目录裸导入，但 **Node 与打包器下请以上表为准**（如快照用 `extras/snapshot`，而非 `/snapshot`）。
3. **环境要求**：Node ≥ 22；TypeScript **≥ 5.4**（`Store.use` / `usePlugin` 的公开签名使用 `NoInfer`，低版本会报 `Cannot find name 'NoInfer'`，除非开启 `skipLibCheck`）；用装饰器需 `experimentalDecorators`。
4. **状态只能通过 action 修改**：禁止 `store.state.xxx = value`（开发模式直接抛错；生产模式由 `stateProtection.productionHandler` 决定：默认 `'warn'` 告警后放行、`'silent'` 静默放行、`'error'` 抛错；绕过 action 的写入不触发订阅通知）。合法写法：action 内 `this.state.xxx`、`this.setState(k, v)`、`this.$patch(partial)`、`this.$replaceState(next)`。
5. **订阅是引用计数**：同一函数注册 N 次就通知 N 次，每个退订句柄只抵消自己那一次注册，重复调用同一句柄无效；句柄按注册标识精确退订，被上限驱逐的旧句柄不会误删同一回调的重新注册。`subscribe` 的监听器只接收**一个参数** `(state) => void`（新状态），没有 `prevState`。回调抛错被逐个隔离，开发模式打印、生产模式经 `onError` 钩子上报；`maxSubscribers`（默认 50）是**每一次注册**都过的硬上界，重复注册同样占额度，达限时按 `subscription.onLimit`（默认 `'evict-oldest'`）处置（`evict-oldest`：驱逐一份最早注册——本次是重复注册时让位的是该监听器自己最早的那一份——并向 `onError` 发一条事件；`throw`：直接抛错），所以 `size() <= maxSubscribers` 是常态（唯一例外：`maxSubscribers <= 0` 配 `evict-oldest`，在册为零、无可驱逐对象，首个订阅仍会成功）。
6. **action 的 `this`**：指向 action 上下文，含 `state` / `setState` / `$patch` / `$replaceState` / `getState` / `dispatch`，以及同 store 的其他 action；其余参数调用方传入。
7. **插件已泛型化**：`Plugin<S extends State = State>`。写 `install(store)` 时可标注具体状态类型；`store.use(plugin)` 与 `usePlugin(plugin, store)` 传具体 Store **无需断言**，状态无关的插件写作 `Plugin<State>`（如 `loggerPlugin`）。
8. **getter 是纯函数且不缓存**：`(state) => value`，每次读取重新执行；计算密集型派生用选择器。
9. **小程序包体**：`extras` 聚合入口会拉入全部可选能力，按需能力一律走具体子路径。

## 快速上手

### 安装

```bash
npm install @openlide/geomstore
# 微信开发者工具中：工具 → 构建 npm
```

### 创建 Store

先定义状态类型，再用工厂函数标注其返回类型——`S` 由此唯一确定，getter / action 无需重复书写字面量类型，也不必写 `as` 断言：

```ts
import { createStore } from '@openlide/geomstore'

interface CounterState {
  count: number
  label: string
}

export const counterStore = createStore({
  name: 'counter',
  state: (): CounterState => ({ count: 0, label: 'test' }),  // 工厂函数：避免引用类型被多实例共享
  actions: {
    increment() { this.state.count++ },
    add(n: number) { this.state.count += n },
    async fetchData() {
      const res = await request('/api/data')
      this.setState('count', res.data)
    },
  },
  getters: {
    double: (state: CounterState) => state.count * 2,
  },
})

counterStore.dispatch('add', 10)          // 参数类型自动推断
counterStore.getter('double')             // 返回类型自动推断
counterStore.subscribe((state) => { /* 新状态 */ })
```

### 接入微信小程序

三端集成函数**都从主入口引入**：

```ts
import { withPageStore, withComponentStore, withAppStore } from '@openlide/geomstore'

// Page：onUnload 自动退订
Page(
  withPageStore(counterStore, {
    mapState: ['count'],                 // 数组简写：注入 this.data.count
    mapGetters: ['double'],
    mapActions: ['increment'],           // 注入 this.increment()
    // 对象形式可重命名：{ total: 'count' } / { addOne: 'increment' }
  })({
    onLoad() {
      console.log(this.data.count)       // 映射自 store
      this.increment()                   // 注入的方法
    },
  }),
)

// Component：映射的 action 自动并入 methods；生命周期必须写在 lifetimes / pageLifetimes 内
Component(
  withComponentStore(counterStore, { mapState: ['count'] })({
    lifetimes: { attached() { /* this.data.count 可用 */ } },
  }),
)

// App：状态同步到 globalData，订阅贯穿运行期（不随 onHide 清理）
App(withAppStore(appStore, { mapState: ['userInfo'], mapActions: ['initApp'] })({
  onLaunch() { this.initApp() },
}))
```

Page 的 `onUnload` 与 Component 的 `lifetimes.detached` 先同步执行用户钩子，再在 `finally` 清理绑定；钩子内可以调用映射 actions，抛错仍会清理。包装器不等待 Promise，`await` 后不要再依赖映射方法。

三处集成的配置方法内 `this` 类型**已自动注入**（`PageThis` / `ComponentThis` / `AppThis`），不要手写 `this` 标注——手写反而会覆盖集成层注入的类型。

`autoInject: true` 时用 `store.getCached(key)` 在挂载钩子里注入一次（值为 `undefined` 的键跳过并告警）；再开 `autoUpdateOnShow: true` 才追加 `onShow` 包装器（App 用 `onShow`、Page 用 `onShow`、Component 用 `pageLifetimes.show`）**每次回前台重新注入**——异步 action 之后才进缓存的键靠这条补齐。两个开关缺一不可：只写 `autoUpdateOnShow` 或 `injectMapping` 为空时不装包装器。映射与注入的键都按**自有属性**写入宿主（`defineProperty`），`'__proto__'` 这类键不再被 `Object.assign` 的原型 setter 静默丢弃。

## 常见任务

### 订阅与批量

```ts
const unsubscribe = store.subscribe((state) => console.log(state))
unsubscribe()

store.batch(() => { /* 多次写入合并为一次通知 */ })   // 或 startBatch() / endBatch() 手动配对
```

钩子处理器在**插件侧**（`install(store)` 拿到的 `Store` 接口）按钩子名拿到精确形参（`HookArgsMap`）：`on('beforeDispatch', (name, args) => …)` 无需再写 `unknown`，`emit` 的实参个数 / 顺序也在编译期受检。`emit` 的失败语义：逐个处理器 `try/catch`，不影响其余处理器、也不传播给 `emit` 调用方，先 `console.error` 再转投 `onError`（`onError` 自身抛错只落日志）。要数某个钩子挂了几个处理器请用 `hooks.listenerCount(name)`（`size(name)` 与无参 `size()` 量纲不同）。

action 体内调用 `batch()` 时通知统一延迟到 dispatch 收尾补发一次；批保护只覆盖同步段，异步回调 `await` 之后的变更逐条通知（开发模式有告警）。

action 内 `this.state` 的对象/数组与 Map/Set 写入在两种通知模式下都会标记顶层脏键（共享别名可能标记多键），归属按需求建一次索引、标量写入 O(1)，逐项更新长列表不再退化；在同步订阅回调内读取 `isStateKeyDirty(key)`，通知结束后脏键清空（回调内重入写入的脏键留给下一轮）。默认模式同样追踪；`onlyOnChange` 只是按变更计数抑制通知，并非内容深比较，其基线覆盖 `beforeDispatch` 钩子内的写入。类实例与类型化数组也被追踪：属性/元素写入正常标记，实例方法调用保守标记所属键（读取时方法绑定原始接收者，`#private` 与内部槽位可用）。`getState()` 裸引用与 Date/RegExp/WeakMap/WeakSet 的内部变异不受追踪，请显式替换值。

### 插件（`extras/plugins`）

```ts
import { loggerPlugin, persistencePlugin, devtoolsPlugin, WxStorageBackend } from '@openlide/geomstore/extras/plugins'
import { analyzerPlugin } from '@openlide/geomstore/extras/performance'
import { timeTravelPlugin } from '@openlide/geomstore/extras/plugins'

store.use(loggerPlugin)                        // 生产环境自动静默
store.use(persistencePlugin({
  key: 'app-state',
  storage: new WxStorageBackend(),                       // 微信环境：内置同步后端（缺失即抛错，见下）
  filter: (s) => ({ user: s.user }),            // 只落盘部分状态
  validate: (s) => s && typeof s.user === 'object',
  debounce: 200,
}))
store.use(devtoolsPlugin)                       // globalThis.__GEOMSTORE_STORES__ / __GEOMSTORE_DEVTOOLS__
store.use(analyzerPlugin)                       // globalThis.__GEOMSTORE_ANALYZER__
store.use(timeTravelPlugin({ maxSize: 100 }))   // 调试入口是全局表：globalThis.__GEOMSTORE_TIME_TRAVEL__['<store.name>']
```

`storage` 必须**同步且三方法齐备**（`{ getItem, setItem, removeItem }`）：残缺或返回 Promise 的后端会在安装期 / 读写时明确抛错，绝不静默换后端；不传则先用 `isWxStorageSyncAvailable()` 探测 `wx` 同步存储，探测不过才降级内存存储（非生产 `console.warn`，**生产经 `onError` 钩子上报**）。接入微信请传 `new WxStorageBackend()`——`wx` 全局对象本身没有 `getItem`，不能直接当后端用；注意**直接 new 出来的 `WxStorageBackend` 在 `wx` 或对应 `*StorageSync` 方法缺失 / 非函数时抛错**，不再把 `?.` 短路成静默 no-op（那会让写删「看起来成功」、读被洗成「键无数据」）。降级只发生在 `persistencePlugin` 的探测路径上。

调试入口一律是 `globalThis` 上的表（`__GEOMSTORE_STORES__` / `__GEOMSTORE_DEVTOOLS__` / `__GEOMSTORE_TIME_TRAVEL__` / `__GEOMSTORE_ANALYZER__`），**表键是 `store.name`**，且**只在非生产环境挂载**：`isProduction()` 为真时注册直接返回 no-op，绝不往 `globalThis` 写内部引用，而插件本体照常安装（time travel 仍在记快照、analyzer 仍在计时）。`store.__timeTravel__` / `store.__performanceMonitor__` 是插件挂上去的**内部字段**，不在 `Store` 类型上、也没有对外契约，别按它写业务代码。既有同名全局表若不是可扩展的对象（被 `seal` / `freeze`、被宿主占成函数或原始值），本次注册就地跳过并 `console.warn`——不抛错、不中断 `store.use()`。

时间旅行 `getSnapshots()` 返回核心 `deepCloneState` 的副本，修改普通对象、数组、Date/RegExp/Map/Set 不会污染历史或 `goTo` 恢复值。但类实例、函数、Promise、弱集合仍共享引用，不要把它等同于 extras/snapshot 的完全隔离/丢弃契约。

### 选择器（`extras/selector`）

```ts
import {
  createSelector, createMemoizedSelector, createParametricSelector, createStructuredSelector,
} from '@openlide/geomstore/extras/selector'

const selectCount = createSelector((s: CounterState) => s.count)
const memoDouble = createMemoizedSelector((s: CounterState) => s.count * 2)
const selectById = createParametricSelector((s: CounterState, id: string) => /* ... */)
```

`createSelector` / `SelectorFactory` 的版本化缓存同时比较**状态对象身份与版本号**（O(1)）；跨 Store 的相同版本不会串值。状态**无版本号**（直接传普通对象）时改用 `equalityFn` 判等，此时缓存里放什么由选项 `snapshotState` 决定：**默认 `true`＝缓存内容深拷贝快照**，`equalityFn(快照, 当前状态)` 比内容，就地变异能被感知、任何深比较器都成立；只有确认 `equalityFn` 是引用相等（`(a, b) => a === b`）时才显式传 `snapshotState: false` 改缓存活引用、省掉整棵状态树的克隆——默认值下配引用相等比较器会因「克隆体永不与活引用相等」而永远 miss（`createMemoizedSelector(fn, equalityFn)` 的第二参只给比较器、**不会**顺手关掉快照，要走引用相等请改用 `createSelector(fn, { equalityFn, snapshotState: false })`）。`cacheTTL`（默认 5000ms）只认正数：`NaN` / `0` / 负数 / 非 number 一律回落默认，`Infinity` 则**有意放行**＝不按时间过期。它与 `cacheSize` 的归一化**不是同一套**（`cacheSize` 的 `Infinity` / `NaN` 回落 10、`0` 与负数夹到 1）。默认比较器 `deepEqual` **先判原型一致再判内容**：`class MyMap extends Map` 的实例与 `Map` 实例判不等（哪怕都为空）、装箱原始值按 `valueOf` 判（`new Number(1)` ≠ `new Number(2)`），所以别把 `Map` 子类实例与基类 `Map` 当同一份状态来源来回切换（只会让缓存永不命中，而不是误报相等）。`equalityFn` 的形参声明为 `(a: any, b: any) => boolean`，收窄参数的自定义比较器可直接传入。`createStructuredSelector` 与 `SelectorComposer.combine` **需显式给出状态类型参数**（TS 无法反推）。`combine` 的结果类型 `R` 由 `combiner` 的返回类型反推，且已透传到 combiner 的返回位：显式写 `combine<S, R>(…)` 而 combiner 返回别的东西（拼错的属性名、多包一层）**现在编译失败**，此前被实现里的断言静默吞成 `R`；两参数写法 `SelectorComposerInput<S, T>` 的 `R` 仍取默认 `unknown`，行为不变。

### Store 组合（主入口）

```ts
import { composeStore } from '@openlide/geomstore'

const root = composeStore([userStore, cartStore], { namespace: true, strict: true })
root.dispatch('userStore/login', payload)      // 命名空间模式下用斜杠路径
root.$patch({ 'userStore/name': 'Alice' })
```

组合 Store 的 `getState()` / `state` 在批内与异步通知等待期间也校验子 store 版本；无版本号的子 store（含嵌套组合）每次读取保守失效。组合层的 `isStateKeyDirty(key)` 收 `string | symbol`：只有命名空间模式的字符串键（即子 store 名）能精确判定，非命名空间模式、任何符号键、以及子 store 订阅失效的降级态都**保守返回 `true`**（方向性宁多勿漏：多写一次 setData 远比漏更新好），别拿它当「未变化」的否定证据。`actions` 汇总子 action 名称，嵌套非命名空间组合可按裸名 dispatch；同名取第一个，命名空间模式仍使用斜杠路径。

非命名空间外层包含**命名空间内层**时，内层子 store 的键为「子 store 名/键」：写操作用完整斜杠路径（`flat.setState('leaf/count', 1)`、`flat.$patch({ 'leaf/count': 2 })`），构造期开发模式会提示；`$replaceState` 不支持该路径。

### Action 装饰器（`extras/action`）

装饰器是 **MethodDecorator 工厂**（不是函数包装器），只能用于类方法，需 `experimentalDecorators`：

```ts
import { withRetry, withTimeout, withThrottle, withDebounce, withCache } from '@openlide/geomstore/extras/action'

class UserService {
  @withRetry({ retries: 3, delay: 1000 })
  @withTimeout(3000)
  async fetchUser(id: string) { /* ... */ }

  @withThrottle(100)            // 间隔是第一个位置参数
  @withDebounce(300)            // 同上
  @withCache({ ttl: 5000 })
  async search(keyword: string) { /* ... */ }
}
```

`withDebounce` / `withThrottle` / `withCache` 支持实例方法与静态方法，按宿主和方法隔离状态；复用装饰器时，同描述 Symbol 方法与同名字符串方法互不干扰。

签名：`withLog(name?, options?)`（`options`: `{ sink?, redact?, summarizeInProduction? }`）/ `withDebounce(delay = 300)` / `withThrottle(interval, options?)` / `withCache(options?)` / `withRetry(options?)` / `withTimeout(timeout, options?)` / `createDecorator(options?)`（`{ before?, after?, onError? }`）。节流的 `leading` / `trailing` 默认均为 `true`；方法"非 `async` 语法但返回 Promise"时置 `assumeAsync: true`，使被抑制的调用同样返回 Promise。函数式场景用 `ActionExecutor` / `ActionLoader` / `withLoading`；`ActionLoader` 默认让多个异步 action **共用** `loadingKey` / `errorKey` / `errorDataKey`（并发时互相覆盖），传 `perActionKeys: true` 后状态键派生成 `${baseKey}_${actionName}`（如 `loading_fetchUser`）。

本入口的符号面不止装饰器：另有防抖 / 节流各自的 `cancel*Calls` / `flush*Calls` / `dispose*State`（共 6 个，供 Page `onUnload` / Component `detached` 收尾挂起调用），以及 `LogSink` / `LogPhase` / `ActionErrorData` / `RetryOptions` / `TimeoutError` / `TIMEOUT_ERROR_CODE` 这几个类型与超时错误件——给自定义 sink、脱敏钩子、统计结果标注类型时**从这里引**，不要深链 `decorators/log` 之类叶子路径（`exports` 也没声明它们）。

装饰器语义（写代码时按此预期，不要凭记忆）：

- `createDecorator` **不把同步方法包成 `async`**：同步方法仍同步返回值，只有被装饰方法（或 `before`）返回 Promise 时调用才返回 Promise。`before` 返回 Promise 会被等待（其 rejection 走 `onError`）；`onError` 收到规范化 `Error`，它自身抛错只记日志、不顶替原始失败。
- `withLog` 在**生产构建默认强制摘要**（类型 / 长度 / 键数，`Error` 只留 `name`、**不含 `message`**），不打印参数与返回值内容。`redact: (value, phase) => …`（`phase` 为 `'args' | 'result' | 'error'`）在**非生产**下就是最终输出，但生产下它的返回值**还要再过一道摘要**——要让 `redact` 全权决定形态，必须显式传 `summarizeInProduction: false`（意即「sink 侧自行脱敏」）；一个写坏或过于宽松的 `redact` 不该能静默关掉这道防线。要换出口传 `sink`（`{ log, error }`）。`sink` / `redact` 抛错都与业务调用隔离：只 `console.warn` 一句，既不中断被装饰的 action，也不把成功的调用改判成失败。
- `withCache` 的用户 `keyFn` 抛错时该次调用退化为「不缓存、直接执行」，不会让整个业务方法失败；`withRetry` 的 `shouldRetry` 收到的也是规范化 `Error`，`retries` 是首次执行**之外**的次数（总尝试 = `retries + 1`）。
- `withRetry` 的包装函数是 `async`：**装饰同步方法会让返回类型变成 `Promise<T>`**，原本的同步抛出也变成 rejection（退避要 `await` 定时器，同步路径做不到不阻塞事件循环地等待）。靠同步返回值或 `try/catch` 接结果的调用点必须随之改写；不想改调用方就别给同步方法加它。
- 超时错误的身份判据是 `error.code === TIMEOUT_ERROR_CODE`（值 `'ACTION_TIMEOUT'`，与 `ErrorCode.ACTION_TIMEOUT` 同串）：`@withTimeout` 的文案是 `Timeout after <n>ms`、`ActionExecutor.executeWithTimeout` 是 `Action timeout after <n>ms`，两入口文本不同且**只作展示**，按 message 匹配判超时既会漏判也会被底层 action 恰好含该字样的错误骗过。超时不可取消：它只让本调用提前 reject，底层 Promise 仍在后台跑完。

### 错误处理（`extras/error`）

```ts
import {
  ErrorBoundary, ErrorRecovery, RecoveryStrategy, ErrorCode, createError,
} from '@openlide/geomstore/extras/error'

const boundary = new ErrorBoundary({ fallback: [], onError: (e) => console.error(e) })
boundary.execute(() => riskyOperation())         // 未给 fallback 时默认 fail-loud（重抛）

const recovery = new ErrorRecovery()
recovery.configure({
  [ErrorCode.ACTION_EXECUTION_ERROR]: {          // 键必须是真实 ErrorCode 值（无 E_ 前缀）
    strategy: RecoveryStrategy.RETRY,
    maxRetries: 3,
    retryDelay: 500,
  },
})
await recovery.recover(createError(ErrorCode.ACTION_EXECUTION_ERROR, 'msg'))
```

`ErrorRecovery` 的 `RETRY` **不在库内重跑原操作**（它不持有原操作引用）：按退避延迟后重抛原错误，由调用方自己重试。重试额度按「`(store, operation)` 键 + 时间窗」累计（两处都缺时全部未归因调用共用一份额度），达到 `maxRetries` 时抛 `INTERNAL_ERROR`（context 带 `retryKey` / `attempts`）并**保留**计数与周期键——同一失败循环里继续调用**不会**每轮领到全新额度，新周期只由周期窗过期开启，或在该键恢复成功 / `RESTART` 策略 / `clearAllRetryCounts()` 时清零。`recover` 只接受 `GeomStoreError`，非 GeomStoreError 与未配置策略的错误都抛 `GeomStoreError`（`PARAMETER_ERROR` / `INTERNAL_ERROR`）并把原始值挂 `cause`，按 `error.code` 分支即可，不要按 `instanceof Error` 猜。

`ErrorMonitoring.generateReport().summary` 的 `totalErrors`（观测到的错误数）/ `queuedErrors`（仍在上报队列里）/ `droppedErrors`（队列溢出被挤出去、从未投递给任何 reporter）是**三个互不重叠的口径，不能相加核对**：被丢弃的那条在它自己那次 `report()` 里已经计入 `totalErrors`，成功投递过的既不在 `queuedErrors` 也不在 `droppedErrors` 里。

### 快照与性能

```ts
import { SnapshotManager, createSnapshot } from '@openlide/geomstore/extras/snapshot'
import { PerformanceMonitor } from '@openlide/geomstore/extras/performance'

// Store 自身的快照对（深克隆 + 冻结纯对象/数组链 ↔ 恢复；Date/RegExp/Map/Set 触达的节点仍可变）
const snap = store.$snapshot()
store.$restore(snap)

// 快照引擎：返回 { data, metadata, success, errors, stats }；克隆失败不抛错（有 cloneError 时 success:false）
// data 的类型是 T | undefined：异常 / 中止 / 根节点被丢弃时就是 undefined（失败结果不回传活引用），
// 异步超时下甚至是半成品——用前必须判 success，别按 T 直接解引用
const manager = new SnapshotManager()
const result = createSnapshot(store.getState())
const diff = manager.compareSnapshots(result, createSnapshot(next))   // 传完整 SnapshotResult，不是 .data
```

`errors` 是**完整账本**：`circular`（写占位符继续）、`maxDepth`（降级）、`onProgress` 抛错记的 `unknown` 都入账，而它们都不影响 `success`——只有 `cloneError`、超时、顶层异常三类会让 `success` 变 false。故 `success: true` 时 `errors` **可以非空**（别拿它当失败信号），`success: false` 时 `errors` 必非空。同步克隆另有一个与选项无关的栈安全硬上限 `min(maxDepth, 1000)`（`HARD_MAX_CLONE_DEPTH`，微信基础库栈更小故留了一倍余量）：超出部分按 `maxDepth` 的降级口径入账，不会以 `RangeError` 伪装成某条属性的 `cloneError`；要处理更深的结构走 `createSnapshotAsync`（任务队列代替调用栈，**不**叠加该硬上限）。

比较按对象对识别循环，等价循环不因重复进入被误判；100 层逐路径护栏只终止展开、不再无条件记为差异（超出后退化为整体 `deepEqual`）。对象的自有 `undefined` 属性与缺失键不同，新增/删除会产生对应 `kind`，继承属性不参与。`onError` 按**真值**解释：不写 `return` 的箭头函数等价「拒绝继续」，纯观测请显式 `return true` 或改用 `onProgress`（后者抛错被就地兜住，不影响快照）。

## 性能与最佳实践

- **计算密集型派生用选择器**，不要用 getter（getter 每次读取都重新执行）。
- **多字段一起更新用 `$patch` 或 `batch()`**，避免多次通知；未检测到写入时可用 `notify.onlyOnChange` 抑制通知，同值写入也可能推进计数。
- **热点 state 键可开缓存**：`createStore({ enableCache: true, cacheKeys: ['count'] })`，读取用 `store.getCached('count')`。action 完成刷新时会移除已 `delete` 的键；`$replaceState` 清空缓存后回填，不依赖旧状态仍保留该键。
- **通知载荷按订阅者构成决定**：`notify.clone` 未显式配置＝自动——全部订阅者只读（页面 / 组件绑定即是）时免深拷贝（状态保护开启给只读 Proxy、关闭给**原始引用**，回调需自行保证不写），存在可写订阅者时本轮需要拷贝，拷贝份数**按注册的可写性分配**：可写注册各拿一份独立深拷贝、只读注册共用一份（既隔离载荷 ↔ 活状态，也隔离监听器彼此——先执行的可写回调改入参，不会让同一轮里后面的监听器读到半成品）。所以既不是「默认总是深拷贝」也不是「本轮共用一份克隆」：一次 dispatch 可以产生 N 份克隆（N＝可写注册数），份数由 `maxSubscribers` 封顶。显式 `clone: true` 强制拷贝、`clone: false` 仍在有可写订阅者时拷贝。所以「不写状态的订阅」要老实标 `readOnly: true`，这是大状态下最主要的通知开销开关。
- **可选能力按需引入**，尤其在小程序主包中；`extras` 聚合入口只在调试时用。
- **App 级订阅不随 `onHide` 清理**（`withAppStore` 只在 `onLaunch` 建立，贯穿运行期）。
- **同页面多实例**（同名页、列表项组件）的订阅清理由集成层挂在实例上（`__geomUnbinds`），无需手动管理。

## 常见错误排查

| 现象 | 原因与修复 |
| --- | --- |
| `Cannot find module '@openlide/geomstore'` | 未安装依赖、未执行「构建 npm」，或用了不存在的子路径；合法子路径只有 `/core`、`/integrations`、`/extras`、`/extras/*` |
| `require is not defined` / `ERR_REQUIRE_ESM` | 产物是纯 ESM，改用 `import`；配置侧确保按 ESM 解析（bundler 输出 ESM 或 Node 侧 `"type": "module"`） |
| `Cannot find name 'NoInfer'` | TypeScript < 5.4，升级 TS 或开启 `skipLibCheck` |
| 从主入口引 `createSelector` / `SnapshotManager` / `withRetry` 报错 | 这些是可选能力，改从 `extras/selector` / `extras/snapshot` / `extras/action` 引入 |
| 直接改 state 不生效或被警告 | 必须经 action：`dispatch` / `this.$patch` / `store.$patch` |
| 订阅回调不触发 | 检查是否只读未写；`notify.onlyOnChange` 为 `true` 时未检测到写入不通知 |
| 订阅触发次数不符 / 退订后仍触发 | 同一函数重复订阅按引用计数通知 N 次、退订只减一份，确认没有重复注册 |
| 组件生命周期不执行 | 微信要求写在 `lifetimes` / `pageLifetimes` 内，配置顶层的 `attached` 等不会被执行 |
| `withRetry(fn, opts)` 报错 | 装饰器只能用于类方法且需 `experimentalDecorators`；函数式场景用 `ActionExecutor` |
| 持久化恢复失败 | 恢复值须为纯对象；`validate` 不通过会跳过恢复；自定义 `storage` 必须同步且三方法齐备（否则 `store.use()` 安装期就抛 `TypeError`） |
| 快照结果 `data` 是 `undefined` | 该次快照异常、被 `onError` 判「拒绝继续」而中止（`cloneError`），或根节点被丢弃——失败结果按契约不回传活引用；读 `errors` 的 `path` 定位，纯观测请显式 `return true` 或改用 `onProgress`。`data` 类型是 `T \| undefined`，用前必须判 `success`（异步超时下它甚至是半成品） |
| 生产环境完全没有日志 | 属预期（库口径静默），但降级 / 监听器抛错 / 落盘失败会 `emit('onError', …, source)`；给 `onError` 挂上报处理器，而不是指望控制台 |
| `Plugin` 与 Store 状态类型不匹配的编译错误 | 插件泛型已收紧，把插件声明为匹配的 `Plugin<S>`，或对状态无关插件写作 `Plugin<State>` |
| 时间旅行 / analyzer 调试 API 读到 `undefined` | 公开入口只有全局表 `globalThis.__GEOMSTORE_TIME_TRAVEL__` / `__GEOMSTORE_ANALYZER__`（表键＝`store.name`），**生产环境不挂表**（插件本体仍在采集）；没 `store.use()` 安装、表键拼错同样读不到；全局表被外部占用成不可扩展 / 不可写的容器时本次注册就地跳过并 `console.warn`。`store.__timeTravel__` 是内部字段，不作契约 |

## Resources

**1）本 skill 自带，任何环境可用**

- `references/api/index.md` —— 由 `scripts/generate-skill-api-reference.mjs` 从 `dist/**/*.d.ts` **自动生成的 API 参考**（含精确签名与 JSDoc，重载会完整列出，当前对应 v0.6.1）。参考已**按入口拆分为 `references/api/*.md`**：先看索引的入口一览，再只打开所需入口的文件（渐进加载，不必读整个目录）。

  ```bash
  rg -n 'createSelector' references/api/          # 不确定符号属于哪个入口时
  rg -n '^### `createSnapshot`' references/api/   # 精确定位某个符号的完整声明
  ```

  它是构建产物的机械映射，重新生成：`pnpm build && pnpm skill:api`（请勿手工编辑）。

**2）在 GeomStore 仓库内开发**（`docs/`、`src/` 可见，能读到设计意图、默认值与契约）

- `docs/API.md` —— 按引入路径组织的 API 参考（签名、选项默认值、语义契约）
- `docs/GUIDE.md` / `docs/BEST_PRACTICES.md` / `docs/FAQ.md` / `docs/MIGRATION.md` —— 指南 / 优化 / 常见问题 / 迁移
- `examples/` —— 可运行示例（basic / cache / weapp / advanced / extras），全部纳入 `pnpm typecheck:examples`
- `src/types/*.ts` —— 完整类型定义

**3）在其他小程序项目内**（只装了 npm 包，`docs/` 与 `src/` 均不存在）

- `node_modules/@openlide/geomstore/dist/**/*.d.ts` —— 与安装版本必然一致的原始声明
- 同目录 `CHANGELOG.md` 与包根 `README.md`（npm 会强制随包发布，`docs/` 不会）
- 包内 `package.json` 的 `exports` —— 确认合法子路径
