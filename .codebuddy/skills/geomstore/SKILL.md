---
name: geomstore
description: 微信小程序状态管理库 GeomStore（@openlide/geomstore，v0.7.0，纯 ESM 瘦核心）的使用指南。当需要编写、修改或审查使用 GeomStore 的代码（创建 Store、定义 actions/getters、接入微信小程序 Page/Component/App、按子入口引入插件/选择器/Store 组合/错误处理/性能监控/快照/缓存/Action 装饰器）时使用此 skill。触发场景：开发微信小程序并涉及状态管理、要求"用 GeomStore 实现 XX"、代码中已出现 createStore/withPageStore/composeStore/createSelector 等调用、或需要排查 GeomStore 相关问题。
---

# GeomStore 使用指南

## Overview

GeomStore 是轻量级微信小程序状态管理库，提供类 Pinia 的 API、完整的 TypeScript 类型推断、企业级能力（Store 组合、插件、错误处理、性能监控、快照、Action 增强）与原生小程序集成（Skyline / Webview）。

当前版本 **v0.7.0**，两条硬性特征决定了绝大多数误用：

- **纯 ESM**：产物为 ESM，没有 CJS 入口，`require('@openlide/geomstore')` 不可用。
- **瘦核心 + 按需子入口**：主入口只含运行必需 API；快照 / 选择器 / 性能 / Action 增强 / 插件 / 企业微信等**不在主入口**，必须从 `extras/*` 引入。

> 版本以仓库 `package.json` 的 `version` 与 `docs/` 为准；本文件若与源码不符，以源码与 `docs/API.md` 为准。

## 使用规则

1. **写代码前先确认签名，不要凭记忆**。查本 skill 自带的 `references/api/index.md`（从构建产物的类型声明自动生成、与当前版本一致，已按入口拆分，只打开所需入口的文件或用检索，方式见文末 Resources）。需要设计意图、选项默认值与语义契约时：在 GeomStore **仓库内**再看 `docs/API.md`，在**其他小程序项目**看已安装包的 `node_modules/@openlide/geomstore/dist/**/*.d.ts`（`docs/` 不随包发布，外部项目不存在）。
2. **导入路径**（`exports` 仅声明下列子路径）：

   | 引入路径                                                                                     | 内容                                                                                                                                                    |
   | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `@openlide/geomstore`（或 `/core`）                                                          | `createStore` / `Store` / 工具函数 / `HookSystem` / `usePlugin` / `withPageStore` / `withComponentStore` / `withAppStore` / `composeStore` / `LRUCache` |
   | `@openlide/geomstore/integrations`                                                           | 上述 `with*` + 底层绑定工具 `bindMappings` / `parseMapping` / `bindActions` / `performAutoInject` / `exposeStoreAPI` / `cleanupBindings`                |
   | `@openlide/geomstore/extras/{snapshot,selector,action,performance,plugins,error,enterprise}` | 各可选能力（推荐按子入口精确引入）                                                                                                                      |
   | `@openlide/geomstore/extras`                                                                 | 全部可选能力聚合，会整体拉入产物，仅调试或确实全都要用时引入                                                                                            |

   微信「构建 npm」走 `package.json` 的 `miniprogram` 字段 → 包内 `dist-weapp/`（**按模块一比一转译的 CJS：105 个模块与 `dist` 一一对应，11 个公开子路径的入口齐备**，导出面逐项一致）；工具会整目录拷进 `miniprogram_npm`，不拼接、不做依赖分析。另有转发子目录（`store` / `hooks` / `plugins` / `integrations` / `compose` / `selectors` / `snapshot` / `performance` / `actions` / `cache` / `error`）供**其他**不解析 `exports` 的老式场景按目录裸导入，但 **Node 与打包器下请以上表为准**（如快照用 `extras/snapshot`，而非 `/snapshot`）。

3. **环境要求**：Node ≥ 22；TypeScript **≥ 5.4**（`Store.use` / `usePlugin` 的公开签名使用 `NoInfer`，低版本会报 `Cannot find name 'NoInfer'`，除非开启 `skipLibCheck`）；用装饰器需 `experimentalDecorators`。
4. **状态只能通过 action 修改**：禁止 `store.state.xxx = value`（开发模式直接抛错；生产模式由 `stateProtection.productionHandler` 决定：默认 `'warn'` 告警后放行、`'silent'` 静默放行、`'error'` 抛错；绕过 action 的写入不触发订阅通知）。合法写法：action 内 `this.state.xxx`、`this.setState(k, v)`、`this.$patch(partial)`、`this.$replaceState(next)`。
5. **状态保护不管两类东西**：① 越过 action 的直接变异会被拦截（见上一条），但**既不可配置也不可写变的自有数据属性**（`Object.freeze` 过的子树、`defineProperty(writable:false, configurable:false)` 的节点）拿到的是**裸引用**——Proxy 的 `[[Get]]` 不变量要求原样返回该值。行为变更：此前深保护代理（默认开启）在这类属性上**读一次就抛** `TypeError: 'get' on proxy: property 'x' is a read-only and non-configurable data property …`（常见来路 `setState('user', otherStore.$snapshot().user)`，快照是深冻结的），现在读得到、不再抛，代价是这类属性**不受写保护、不标脏、不推版本、不通知**。需要保护与追踪生效就把状态放可配置 / 可写的属性上，或整体 `setState` / `$patch` 替换；判可写请显式 `Object.isFrozen`。② 非普通实例的方法（类实例、类型化数组的成员）读取时绑定**原始接收者**，方法体内的写入不经过陷阱。
6. **`setState` 对 `__proto__` / `constructor` / `prototype` 走 DefineOwnProperty**（行为变更）：`setState('__proto__', { inj: 1 })` 此前会把**整个状态对象的原型**换成入参，注入的键从此经任何缺失键都读得到（`state.isAdmin` / `state.token` 凭空出现）、`isPlainObject` 判定失效、深比较与克隆体从此恒不等（选择器持续失配）；现在与 `$patch` / `$replaceState` / `deepMerge` 同口径，只承载一个**自有数据属性**，原型不动、注入键也不再经原型链可见。相等性判定对这类键也按自有描述符取值（`state.__proto__` 的 `[[Get]]` 返回的是原型而不是写入值），因此「值非对象、setter 静默丢弃、什么都没改」的那次写入不再推进计数 / 脏键 / 通知。状态键可以合法叫 `__proto__`（本库多处专门为它写了 defineProperty 守卫），但**键名来自外部（服务端下发 / 用户输入 / `JSON.parse` 载荷）时仍要在入口做白名单收敛**。
7. **订阅是引用计数**：同一函数注册 N 次就通知 N 次，每个退订句柄只抵消自己那一次注册，重复调用同一句柄无效；句柄按注册标识精确退订，被上限驱逐的旧句柄不会误删同一回调的重新注册。`subscribe` 的监听器只接收**一个参数** `(state) => void`（新状态），没有 `prevState`。回调抛错被逐个隔离，开发模式打印、生产模式经 `onError` 钩子上报；`maxSubscribers`（默认 50）是**每一次注册**都过的硬上界，重复注册同样占额度，达限时按 `subscription.onLimit`（默认 `'evict-oldest'`）处置（`evict-oldest`：驱逐一份最早注册——本次是重复注册时让位的是该监听器自己最早的那一份——并向 `onError` 发一条事件；`throw`：直接抛错），所以 `size() <= maxSubscribers` 是常态（唯一例外：`maxSubscribers <= 0` 配 `evict-oldest`，在册为零、无可驱逐对象，首个订阅仍会成功）。
8. **action 的 `this`**：指向 action 上下文，含 `state` / `setState` / `$patch` / `$replaceState` / `getState` / `dispatch`，以及同 store 的其他 action；其余参数调用方传入。
9. **插件已泛型化**：`Plugin<S extends State = State>`。写 `install(store)` 时可标注具体状态类型；`store.use(plugin)` 与 `usePlugin(plugin, store)` 传具体 Store **无需断言**，状态无关的插件写作 `Plugin<State>`（如 `loggerPlugin`）。
10. **getter 是纯函数，且没有任何结果缓存**：`(state) => value`，每次 `store.getter(name)` / 每次读 `store.getters.x` 都重新执行一遍——Store 层没有版本号比较、没有记忆表、没有缓存键。所以「依赖未变时会跳过」是不存在的：不纯的 getter（发请求、写状态）副作用**每次读取都真的发生**，而连续读同一个 getter 就是连续重算 N 次。要「依赖未变则复用」请用 `extras/selector` 的 `createSelector`（失效凭证＝状态对象身份 + 版本号，O(1)）。
11. **小程序包体**：`extras` 聚合入口会拉入全部可选能力，按需能力一律走具体子路径。但「按子路径引」是否省包体积要看宿主：自带打包器（webpack / vite / esbuild）才摇得掉；只用 npm + 开发者工具「构建 npm」时，体积按包内 `miniprogram` 目录（`dist-weapp/`，全部子入口都在）整目录计，子路径分层只换来运行时按需加载。

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
  state: (): CounterState => ({ count: 0, label: 'test' }), // 工厂函数：避免引用类型被多实例共享
  actions: {
    increment() {
      this.state.count++
    },
    add(n: number) {
      this.state.count += n
    },
    async fetchData() {
      const res = await request('/api/data')
      this.setState('count', res.data)
    },
  },
  getters: {
    double: (state: CounterState) => state.count * 2,
  },
})

counterStore.dispatch('add', 10) // 参数类型自动推断
counterStore.getter('double') // 返回类型自动推断
counterStore.subscribe((state) => {
  /* 新状态 */
})
```

### 接入微信小程序

三端集成函数**都从主入口引入**：

```ts
import { withPageStore, withComponentStore, withAppStore } from '@openlide/geomstore'

// Page：onUnload 自动退订
Page(
  withPageStore(counterStore, {
    mapState: ['count'], // 数组简写：注入 this.data.count
    mapGetters: ['double'],
    mapActions: ['increment'], // 注入 this.increment()
    // 对象形式可重命名：{ total: 'count' } / { addOne: 'increment' }
  })({
    onLoad() {
      console.log(this.data.count) // 映射自 store
      this.increment() // 注入的方法
    },
  }),
)

// Component：映射的 action 自动并入 methods；生命周期必须写在 lifetimes / pageLifetimes 内
Component(
  withComponentStore(counterStore, { mapState: ['count'] })({
    lifetimes: {
      attached() {
        /* this.data.count 可用 */
      },
    },
  }),
)

// App：状态同步到 globalData，订阅贯穿运行期（不随 onHide 清理）
App(
  withAppStore(appStore, { mapState: ['userInfo'], mapActions: ['initApp'] })({
    onLaunch() {
      this.initApp()
    },
  }),
)
```

Page 的 `onUnload` 与 Component 的 `lifetimes.detached` 先同步执行用户钩子，再在 `finally` 清理绑定；钩子内可以调用映射 actions，抛错仍会清理。包装器不等待 Promise，`await` 后不要再依赖映射方法。

三处集成的配置方法内 `this` 类型**已自动注入**（`PageThis` / `ComponentThis` / `AppThis`），不要手写 `this` 标注——手写反而会覆盖集成层注入的类型。

`autoInject: true` 时用 `store.getCached(key)` 在挂载钩子里注入一次（值为 `undefined` 的键跳过并告警）；再开 `autoUpdateOnShow: true` 才追加 `onShow` 包装器（App 用 `onShow`、Page 用 `onShow`、Component 用 `pageLifetimes.show`）**每次回前台重新注入**——异步 action 之后才进缓存的键靠这条补齐。两个开关缺一不可：只写 `autoUpdateOnShow` 或 `injectMapping` 为空时不装包装器。映射与注入的键都按**自有属性**写入宿主（`defineProperty`），`'__proto__'` 这类键不再被 `Object.assign` 的原型 setter 静默丢弃。

## 常见任务

### 订阅与批量

```ts
const unsubscribe = store.subscribe((state) => console.log(state))
unsubscribe()

store.batch(() => {
  /* 多次写入合并为一次通知 */
}) // 或 startBatch() / endBatch() 手动配对
```

钩子处理器在**插件侧**（`install(store)` 拿到的 `Store` 接口）按钩子名拿到精确形参（`HookArgsMap`）：`on('beforeDispatch', (name, args) => …)` 无需再写 `unknown`，`emit` 的实参个数 / 顺序也在编译期受检。`emit` 的失败语义：逐个处理器 `try/catch`，不影响其余处理器、也不传播给 `emit` 调用方，先 `console.error` 再转投 `onError`（`onError` 自身抛错只落日志）。要数某个钩子挂了几个处理器请用 `hooks.listenerCount(name)`（`size(name)` 与无参 `size()` 量纲不同）。

action 体内调用 `batch()` 时通知统一延迟到 dispatch 收尾补发一次；批保护只覆盖同步段，异步回调 `await` 之后的变更逐条通知（开发模式有告警）。

**异步 action 的通知在两个时点各补发一次**（行为变更）：返回 thenable 时，**同步段结束时当场补发一次**（覆盖第一个 `await` 之前的写入），settle 时再补发一次（覆盖续段变更）。旧行为只有 settle 那一轮，而 Store 侧的写入抑制是硬开关（`setState` / `$patch` / `$replaceState` 都看「是否在 dispatch 中」），于是返回**永不 settle** 的 promise（等用户交互才 resolve、`wx.request` 无回调也不 reject）时，同步段那一格状态要等「下一个不相干的通知」才顺带补发——`dialogVisible = true` 得等对话框关掉之后才可见（而它根本没显示出来）。写代码时的两条后果：**默认模式下「同步段有写入且最终 settle」的 action 通知数是 2 次**（`notify.onlyOnChange` 按变更计数自动去重成 1 次），别在订阅里假设「一次 dispatch 恰好一次通知」；按通知次数写断言的测试要把期望改成 2。同步段没写入不多刷、`batch` 期间不提前通知。

action 内 `this.state` 的对象/数组与 Map/Set 写入在两种通知模式下都会标记顶层脏键（共享别名可能标记多键），归属按需求建一次索引、标量写入 O(1)，逐项更新长列表不再退化；在同步订阅回调内读取 `isStateKeyDirty(key)`，通知结束后脏键清空（回调内重入写入的脏键留给下一轮）。默认模式同样追踪；`onlyOnChange` 只是按变更计数抑制通知，并非内容深比较，其基线覆盖 `beforeDispatch` 钩子内的写入。类实例与类型化数组也被追踪：属性/元素写入正常标记，实例方法调用保守标记所属键（读取时方法绑定原始接收者，`#private` 与内部槽位可用）。`getState()` 裸引用与 Date/RegExp/WeakMap/WeakSet 的内部变异不受追踪，请显式替换值。

### 插件（`extras/plugins`）

```ts
import { loggerPlugin, persistencePlugin, devtoolsPlugin, WxStorageBackend } from '@openlide/geomstore/extras/plugins'
import { analyzerPlugin } from '@openlide/geomstore/extras/performance'
import { timeTravelPlugin } from '@openlide/geomstore/extras/plugins'

store.use(loggerPlugin) // 生产环境自动静默
store.use(
  persistencePlugin({
    key: 'app-state',
    storage: new WxStorageBackend(), // 微信环境：内置同步后端（缺失即抛错，见下）
    filter: (s) => ({ user: s.user }), // 只落盘部分状态
    validate: (s) => s && typeof s.user === 'object',
    debounce: 200,
  }),
)
store.use(devtoolsPlugin) // globalThis.__GEOMSTORE_STORES__ / __GEOMSTORE_DEVTOOLS__
store.use(analyzerPlugin) // globalThis.__GEOMSTORE_ANALYZER__
store.use(timeTravelPlugin({ maxSize: 100 })) // 调试入口是全局表：globalThis.__GEOMSTORE_TIME_TRAVEL__['<store.name>']
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
root.dispatch('userStore/login', payload) // 命名空间模式下用斜杠路径
root.$patch({ 'userStore/name': 'Alice' })
```

组合 Store 的 `getState()` / `state` 在批内与异步通知等待期间也校验子 store 版本；无版本号的子 store（含嵌套组合）每次读取保守失效。组合层的 `isStateKeyDirty(key)` 收 `string | symbol`：只有命名空间模式的字符串键（即子 store 名）能精确判定，非命名空间模式、任何符号键、以及子 store 订阅失效的降级态都**保守返回 `true`**（方向性宁多勿漏：多写一次 setData 远比漏更新好），别拿它当「未变化」的否定证据。`actions` 汇总子 action 名称，嵌套非命名空间组合可按裸名 dispatch；同名取第一个，命名空间模式仍使用斜杠路径。

非命名空间外层包含**命名空间内层**时，内层子 store 的键为「子 store 名/键」：写操作用完整斜杠路径（`flat.setState('leaf/count', 1)`、`flat.$patch({ 'leaf/count': 2 })`），构造期开发模式会提示；`$replaceState` 不支持该路径。

`ComposeOptions` 只有两项真在生效：`namespace` 与 `strict`。**`lazy` / `tree` 与类型 `NamespaceConfig` 是「已声明、未实现」项**（以源码为准，不要按文档字面使用）：三个名字都还在公开类型面上（`lazy?` / `tree?` 在 `ComposeOptions` 上，`NamespaceConfig` 经 `core` / `compose` / `plugins` 三个入口再导出），但**运行时零消费方**——`composeStore` 与 `createStoreTree` 的构造函数只读 `namespace` 与 `strict`，命名空间分隔符在实现里硬编码 `'/'`（`separator` / `autoPrefix` 没有任何 API 接受）。写了编译通过、静默无效：不要按它安排懒加载或前缀策略，也不要在评审里把「传了 `lazy: true`」当成延迟初始化的证据。是否在 0.7.0 一并删除这三个名字是一个**尚未拍板的公开决策**（删成员与删导出都是破坏性变更），当前落地口径是「类型上标注未实现、不静默删导出」。

**命名空间模式下 `store.name` 同时是路由键**，构造期一次性校验：名字为空串或含 `'/'` 直接**抛错**（此前是静默不可路由——`createStore({ name: 'user/info' })` 读得到写不进，`'user/info/count'` 被按首段解析成 store `user` + 键 `info/count`）。平铺模式不用 `name` 路由，只开发模式告警。名字为 `'__proto__'` 合法（映射按自有属性承载）。

**子 store 在组合之外被独立销毁后的读取**（行为变更）：`composed.getState()` / `state` / `$snapshot()` 此前会抛 `Cannot call getState on a destroyed Store`——一个死店让整棵组合读不出来（渲染热线直接崩），而同一时刻 `composed.$patch(...)` 却按「已销毁即跳过」正常写入其余子店，读写口径相反。现在三条读路径与写路径同判据：**该子 store 按空视图并入**（其余照常可读）并按 store 去重**告警一次**。所以「整棵组合还读得动」不再等于「所有子店都活着」——要判存活请显式读 `store.destroyed`，并把手上那条 `[composeStore] 子 store "x" 已销毁，读取按空视图处理` 的告警当错误处理而不是噪音。

### Action 装饰器（`extras/action`）

装饰器是 **MethodDecorator 工厂**（不是函数包装器），只能用于类方法，需 `experimentalDecorators`：

```ts
import { withRetry, withTimeout, withThrottle, withDebounce, withCache } from '@openlide/geomstore/extras/action'

class UserService {
  @withRetry({ retries: 3, delay: 1000 })
  @withTimeout(3000)
  async fetchUser(id: string) {
    /* ... */
  }

  @withThrottle(100) // 间隔是第一个位置参数
  @withDebounce(300) // 同上
  @withCache({ ttl: 5000 })
  async search(keyword: string) {
    /* ... */
  }
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
import { ErrorBoundary, ErrorRecovery, RecoveryStrategy, ErrorCode, createError } from '@openlide/geomstore/extras/error'

const boundary = new ErrorBoundary({ fallback: [], onError: (e) => console.error(e) })
boundary.execute(() => riskyOperation()) // 未给 fallback 时默认 fail-loud（重抛）

const recovery = new ErrorRecovery()
recovery.configure({
  [ErrorCode.ACTION_EXECUTION_ERROR]: {
    // 键必须是真实 ErrorCode 值（无 E_ 前缀）
    strategy: RecoveryStrategy.RETRY,
    maxRetries: 3,
    retryDelay: 500,
  },
})
await recovery.recover(createError(ErrorCode.ACTION_EXECUTION_ERROR, 'msg'))
```

`ErrorRecovery` 的 `RETRY` **不在库内重跑原操作**（它不持有原操作引用）：按退避延迟后重抛原错误，由调用方自己重试。重试额度按「`(store, operation)` 键 + 时间窗」累计（两处都缺时全部未归因调用共用一份额度），达到 `maxRetries` 时抛 `INTERNAL_ERROR`（context 带 `retryKey` / `attempts`）并**保留**计数与周期键——同一失败循环里继续调用**不会**每轮领到全新额度，新周期只由周期窗过期开启，或在该键恢复成功 / `RESTART` 策略 / `clearAllRetryCounts()` 时清零。`recover` 只接受 `GeomStoreError`，非 GeomStoreError 与未配置策略的错误都抛 `GeomStoreError`（`PARAMETER_ERROR` / `INTERNAL_ERROR`）并把原始值挂 `cause`，按 `error.code` 分支即可，不要按 `instanceof Error` 猜。

`ErrorMonitoring.generateReport().summary` 的 `totalErrors`（观测到的错误数）/ `queuedErrors`（仍在上报队列里）/ `droppedErrors`（队列溢出被挤出去、从未投递给任何 reporter）是**三个互不重叠的口径，不能相加核对**：被丢弃的那条在它自己那次 `report()` 里已经计入 `totalErrors`，成功投递过的既不在 `queuedErrors` 也不在 `droppedErrors` 里。

**聚合有两套口径，别把它们混成一件事**（0.7.0）：`totalErrors` / `byCode` / `byStore` 是**按条独立累计**的账目（自上次 `clear()` 起单调不减，恒有 `sum(byCode) === sum(byStore) === totalErrors`），**不随组驱逐倒退**——此前它们由「存活组的 count 现算」，于是两次 `generateReport()` 之间的 `totalErrors` 会因驱逐而**变小**，与「观测到的错误数」这个声明正好相反。`totalGroups` / `getErrorGroups()` / `summary.topErrors` 则只是**当前存活组**的视图，会随驱逐变小。两者的差额读 `getAggregationStats()` 的两个字段：`evictedGroups`（被驱逐的组数）与 `evictedErrors`（随组消失的条数）——**「聚合有没有丢数据」只在这里可见**，别拿 `totalGroups` 当错误种类总数。组数上限由 `MonitoringConfig.maxGroups` 配置（0.7.0 新增，缺省 100；非有限值回默认、有限值 `Math.max(1, floor(v))`，`maxGroups: 0` 不是「关掉聚合」而是「刚建的组立刻被踢掉」，要关请传 `enableAggregation: false`）。`affectedStores`（单组 50 个 Store）与 `byStore`（全局 200 个键）都有基数上限，超出并入保留字 `__others__` 溢出桶——**计数一条不丢，截断的只是「列得全不全」**，所以 `getGroupsByStore(name)` 对溢出组「没返回」不等于「没在那组里报错」，要准确条数请用 `getStats().byStore`。

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
const diff = manager.compareSnapshots(result, createSnapshot(next)) // 传完整 SnapshotResult，不是 .data
```

`errors` 是**完整账本**：`circular`（写占位符继续）、`maxDepth`（降级）、`onProgress` 抛错记的 `unknown` 都入账，而它们都不影响 `success`——只有 `cloneError`、超时、顶层异常三类会让 `success` 变 false。故 `success: true` 时 `errors` **可以非空**（别拿它当失败信号），`success: false` 时 `errors` 必非空。同步克隆另有一个与选项无关的栈安全硬上限 `min(maxDepth, 1000)`（`HARD_MAX_CLONE_DEPTH`，微信基础库栈更小故留了一倍余量）：超出部分按 `maxDepth` 的降级口径入账，不会以 `RangeError` 伪装成某条属性的 `cloneError`；要处理更深的结构走 `createSnapshotAsync`（任务队列代替调用栈，**不**叠加该硬上限）。

比较按对象对识别循环，等价循环不因重复进入被误判；100 层逐路径护栏只终止展开、不再无条件记为差异（超出后退化为整体 `deepEqual`）。对象的自有 `undefined` 属性与缺失键不同，新增/删除会产生对应 `kind`，继承属性不参与。`onError` 按**真值**解释：不写 `return` 的箭头函数等价「拒绝继续」，纯观测请显式 `return true` 或改用 `onProgress`（后者抛错被就地兜住，不影响快照）。

**读 `compareSnapshots` 的结果要先看 `inputTrusted`**：`SnapshotDiff` 有一个必填字段 `inputTrusted: boolean`，任一侧快照 `success: false` 时为 `false`，此时引擎**不逐路径比对**，而是交付一条 `path: 'root'` 的整体差异并把 `changed` **恒置为 true**。也就是说 `changed: true` 有两种来源——「输入不可信」与「内容确有差异」，做回滚判定 / 去重时先判 `inputTrusted`，为 `false` 就回上游重取快照（别把这条 root 差异当成一次真实变更）。`Map` 条目路径按**键身份**给（值差异 `root[<String(key)>]`、键增删 `root.key[<String(key)>]`，与 `errors[].path` 同一套 scheme，可以当条目身份用）；`Set` 的增删条目路径仍是报告序下标、不是身份。Date / RegExp / Map / Set / 装箱原始值按**内容**比较（`new Number(1)` vs `new Number(2)` 报 `changed: true`，同一引用仍短路）。

**快照对两类值「保留原引用」而不是重建**（与核心 `deepCloneState` 同一份判据，同步 / 异步两条路径同时生效）：① `Map` / `Set` / `Date` / `RegExp` / `Array` 的**子类**实例；② 状态住在内部槽位里的内建值——`Promise`、装箱原始值（`new Number` / `new String` / …）、`ArrayBuffer` / TypedArray / `DataView`、`WeakMap` / `WeakSet`、`Error`、函数与生成器。它们与活状态是**同一个对象**：改 `snap.data.myMap` 会串回活状态，「快照即隔离」对这批值不成立。要真副本请自行 `slice(0)` / 结构化克隆，或用 `customCloner`（这是宿主对象的唯一兜底出口：没有内建 tag、状态又不在自有可枚举属性上的宿主对象引擎识别不到，会被重建成 `instanceof` 仍真却缺内部槽位的空壳）。类实例仍按既有契约重建为**同类实例**（方法 / 继承链可用）。附带两条同口径修正：数组上的**附加自有键**（`arr.meta = 'v2'`）现在会被克隆；`includeNonEnumerable: true` 带进来的属性在产物里一律 `enumerable: true`（否则它不进 `Object.keys` / `JSON.stringify` / diff 键集，等于没有这个选项）。

## 性能与最佳实践

- **计算密集型派生用选择器**，不要用 getter（getter 每次读取都重新执行）。
- **多字段一起更新用 `$patch` 或 `batch()`**，避免多次通知；未检测到写入时可用 `notify.onlyOnChange` 抑制通知，同值写入也可能推进计数。
- **热点 state 键可开缓存**：`createStore({ enableCache: true, cacheKeys: ['count'] })`，读取用 `store.getCached('count')`。**`getState()` / `store.state` 完全不查缓存**——用它们验证缓存是否生效，`getCacheStats()` 的 `hits` / `misses` 会恒为 0（这不是缓存坏了，是没走它）；缓存的唯一读取入口是 `getCached(key)`（页面 / 组件的 `autoInject` 走的就是它）。**写路径是写穿而不是失效**：`setState` / `$patch` 把新值直接写进条目，写完再 `getCached` 仍命中且拿到新值；要真失效用 `invalidateCache(key?)`，`$replaceState` 先整表清空再按新状态回填。action 完成刷新时会移除已 `delete` 的键。
- **通知载荷按订阅者构成决定**：`notify.clone` 未显式配置＝自动——全部订阅者只读（页面 / 组件绑定即是）时免深拷贝（状态保护开启给只读 Proxy、关闭给**原始引用**，回调需自行保证不写），存在可写订阅者时本轮需要拷贝，拷贝份数**按注册的可写性分配**：可写注册各拿一份独立深拷贝、只读注册共用一份（既隔离载荷 ↔ 活状态，也隔离监听器彼此——先执行的可写回调改入参，不会让同一轮里后面的监听器读到半成品）。所以既不是「默认总是深拷贝」也不是「本轮共用一份克隆」：一次 dispatch 可以产生 N 份克隆（N＝可写注册数），份数由 `maxSubscribers` 封顶。显式 `clone: true` 强制拷贝、`clone: false` 仍在有可写订阅者时拷贝。所以「不写状态的订阅」要老实标 `readOnly: true`，这是大状态下最主要的通知开销开关。
- **可选能力按需引入**，尤其在小程序主包中；`extras` 聚合入口只在调试时用。
- **App 级订阅不随 `onHide` 清理**（`withAppStore` 只在 `onLaunch` 建立，贯穿运行期）。
- **同页面多实例**（同名页、列表项组件）的订阅清理由集成层挂在实例上（`__geomUnbinds`），无需手动管理。

## 常见错误排查

| 现象                                                                                                   | 原因与修复                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Cannot find module '@openlide/geomstore'`                                                             | 未安装依赖、未执行「构建 npm」，或用了不存在的子路径；合法子路径只有 `/core`、`/integrations`、`/extras`、`/extras/*`                                                                                                                                                                                                                                                    |
| `require is not defined` / `ERR_REQUIRE_ESM`                                                           | 产物是纯 ESM，改用 `import`；配置侧确保按 ESM 解析（bundler 输出 ESM 或 Node 侧 `"type": "module"`）                                                                                                                                                                                                                                                                     |
| `Cannot find name 'NoInfer'`                                                                           | TypeScript < 5.4，升级 TS 或开启 `skipLibCheck`                                                                                                                                                                                                                                                                                                                          |
| 从主入口引 `createSelector` / `SnapshotManager` / `withRetry` 报错                                     | 这些是可选能力，改从 `extras/selector` / `extras/snapshot` / `extras/action` 引入                                                                                                                                                                                                                                                                                        |
| 直接改 state 不生效或被警告                                                                            | 必须经 action：`dispatch` / `this.$patch` / `store.$patch`                                                                                                                                                                                                                                                                                                               |
| 订阅回调不触发                                                                                         | 检查是否只读未写；`notify.onlyOnChange` 为 `true` 时未检测到写入不通知                                                                                                                                                                                                                                                                                                   |
| 订阅触发次数不符 / 退订后仍触发                                                                        | 同一函数重复订阅按引用计数通知 N 次、退订只减一份，确认没有重复注册                                                                                                                                                                                                                                                                                                      |
| 一次异步 dispatch 收到 **2 次**通知                                                                    | 属 0.7.0 预期：异步 action 的**同步段结束当场补发一次**、settle 再补发一次（保住「promise 永不 settle 时同步段也可见」这条兜底）。要恰好一次开 `notify.onlyOnChange`（按变更计数去重）；别在订阅里假设「一次 dispatch 恰好一次通知」                                                                                                                                     |
| `getCacheStats()` 的 `hits` / `misses` 恒为 0                                                          | 读取走的是 `getState()`（不查缓存），或 `cacheConfig.enableStats` 被显式关了。缓存唯一读取入口是 `getCached(key)`；`setState` / `$patch` 是**写穿**不是失效，写完再读仍命中并拿到新值，要丢条目用 `invalidateCache()` / `$replaceState()`                                                                                                                                |
| 「写入之后缓存没刷新」的判断不成立                                                                     | 同上——`setState` / `$patch` 会把新值写进条目，所以「靠一次未命中重算」的老读法不对；`$patch` 现在还与 `setState` 同一条 `Object.is` 等值短路（`$patch({})` 什么都不做）                                                                                                                                                                                                  |
| 快照后的 `Map` / `Set` 子类、TypedArray、`Error` 一改就串回活状态                                      | 这批值与内建槽位值（`Promise` / 装箱原始值 / WeakMap·WeakSet / 函数）在 0.7.0 起**保留原引用**而不是重建（此前重建出的是 `instanceof` 仍真却缺内部槽位的空壳）；**修复**：需要真副本请用 `customCloner` 接管，或自己 `slice(0)` / 结构化克隆                                                                                                                             |
| `compareSnapshots` 报 `changed: true` 但看不出改了啥                                                   | 先看新增的 `inputTrusted`：任一侧快照 `success: false` 时它是 `false`，那条 `path: 'root'` 的差异只代表**输入不可信**（`changed` 恒 true），不代表内容真变了；**修复**：判 `inputTrusted` 后回上游重取快照；做回滚判定按「保守认为有差异」                                                                                                                               |
| 组合 store 读起来少了某个子店的键、且日志里一条 `[composeStore] 子 store "x" 已销毁，读取按空视图处理` | 该子店在组合之外被 `destroy()` 了。0.7.0 起三条读路径都按**空视图**并入并只告警一次（此前是 `getState()` / `$snapshot()` 直接抛）；**修复**：显式判 `store.destroyed`、把该店从组合里摘掉；别把这条告警当噪音                                                                                                                                                            |
| `store.state.frozenNode.child = 1` 在生产里悄悄改成功了                                                | 既不可配置也不可写变的自有数据属性（`Object.freeze` 子树等）拿到的是**裸引用**，Proxy 不变量不允许包装它——这类属性不受写保护、不标脏、不通知（0.7.0 起读取也不再抛 `TypeError`）；**修复**：把需要保护 / 追踪的状态放可配置可写的属性上，或整体 `setState` / `$patch` 替换；判可写用 `Object.isFrozen`                                                                   |
| 切前台不自动刷新数据（或日志说「刷新状态」却什么都没发生）                                             | `initBackgroundSync` / `createEnterpriseApp` 是**按名字** `dispatch('refreshData')` 的，这是后台同步的隐式契约；注册的 store 没有这个 action 就不会刷新（0.7.0 起：不再打那条假日志，改为**每个 handler 一次性告警**点名缺失的 action）；**修复**：给该 store 提供 `refreshData`（通常委托自身的同步 action——库自带的 `createUserStore` 已提供），或不要为它注册后台同步 |
| 命名空间组合构造时抛 `子 store 名称必须是「非空且不含 '/'」的路由键段`                                 | 0.7.0 新增的构造期校验：`name` 在命名空间模式下同时是 `'store/action'` 路径的首段，含 `'/'` 会「读得到写不进」；**修复**：改店名（`'__proto__'` 这类键名是合法的，不必改）                                                                                                                                                                                               |
| 组件生命周期不执行                                                                                     | 微信要求写在 `lifetimes` / `pageLifetimes` 内，配置顶层的 `attached` 等不会被执行                                                                                                                                                                                                                                                                                        |
| `withRetry(fn, opts)` 报错                                                                             | 装饰器只能用于类方法且需 `experimentalDecorators`；函数式场景用 `ActionExecutor`                                                                                                                                                                                                                                                                                         |
| 持久化恢复失败                                                                                         | 恢复值须为纯对象；`validate` 不通过会跳过恢复；自定义 `storage` 必须同步且三方法齐备（否则 `store.use()` 安装期就抛 `TypeError`）                                                                                                                                                                                                                                        |
| 快照结果 `data` 是 `undefined`                                                                         | 该次快照异常、被 `onError` 判「拒绝继续」而中止（`cloneError`），或根节点被丢弃——失败结果按契约不回传活引用；读 `errors` 的 `path` 定位，纯观测请显式 `return true` 或改用 `onProgress`。`data` 类型是 `T \；**修复**：undefined`，用前必须判 `success`（异步超时下它甚至是半成品）                                                                                      |
| 生产环境完全没有日志                                                                                   | 属预期（库口径静默），但降级 / 监听器抛错 / 落盘失败会 `emit('onError', …, source)`；给 `onError` 挂上报处理器，而不是指望控制台                                                                                                                                                                                                                                         |
| `Plugin` 与 Store 状态类型不匹配的编译错误                                                             | 插件泛型已收紧，把插件声明为匹配的 `Plugin<S>`，或对状态无关插件写作 `Plugin<State>`                                                                                                                                                                                                                                                                                     |
| 时间旅行 / analyzer 调试 API 读到 `undefined`                                                          | 公开入口只有全局表 `globalThis.__GEOMSTORE_TIME_TRAVEL__` / `__GEOMSTORE_ANALYZER__`（表键＝`store.name`），**生产环境不挂表**（插件本体仍在采集）；没 `store.use()` 安装、表键拼错同样读不到；全局表被外部占用成不可扩展 / 不可写的容器时本次注册就地跳过并 `console.warn`。`store.__timeTravel__` 是内部字段，不作契约                                                 |

## Resources

**1）本 skill 自带，任何环境可用**

- `references/api/index.md` —— 由 `scripts/generate-skill-api-reference.mjs` 从 `dist/**/*.d.ts` **自动生成的 API 参考**（含精确签名与 JSDoc，重载会完整列出，当前对应 v0.7.0）。参考已**按入口拆分为 `references/api/*.md`**：先看索引的入口一览，再只打开所需入口的文件（渐进加载，不必读整个目录）。

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
