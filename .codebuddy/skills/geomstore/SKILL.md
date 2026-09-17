---
name: geomstore
description: 微信小程序状态管理库 GeomStore（@openlide/geomstore，v0.5.1，纯 ESM 瘦核心）的使用指南。当需要编写、修改或审查使用 GeomStore 的代码（创建 Store、定义 actions/getters、接入微信小程序 Page/Component/App、按子入口引入插件/选择器/Store 组合/错误处理/性能监控/快照/缓存/Action 装饰器）时使用此 skill。触发场景：开发微信小程序并涉及状态管理、要求"用 GeomStore 实现 XX"、代码中已出现 createStore/withPageStore/composeStore/createSelector 等调用、或需要排查 GeomStore 相关问题。
---

# GeomStore 使用指南

## Overview

GeomStore 是轻量级微信小程序状态管理库，提供类 Pinia 的 API、完整的 TypeScript 类型推断、企业级能力（Store 组合、插件、错误处理、性能监控、快照、Action 增强）与原生小程序集成（Skyline / Webview）。

当前版本 **v0.5.1**，两条硬性特征决定了绝大多数误用：

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

   微信「构建 npm」等不解析 `exports` 的场景，另有转发子目录（`store` / `hooks` / `plugins` / `integrations` / `compose` / `selectors` / `snapshot` / `performance` / `actions` / `cache` / `error`）可用，但 **Node 与打包器下请以上表为准**（如快照用 `extras/snapshot`，而非 `/snapshot`）。
3. **环境要求**：Node ≥ 22；TypeScript **≥ 5.4**（`Store.use` / `usePlugin` 的公开签名使用 `NoInfer`，低版本会报 `Cannot find name 'NoInfer'`，除非开启 `skipLibCheck`）；用装饰器需 `experimentalDecorators`。
4. **状态只能通过 action 修改**：禁止 `store.state.xxx = value`（开发模式直接抛错；生产模式由 `stateProtection.productionHandler` 决定：默认 `'warn'` 告警后放行、`'silent'` 静默放行、`'error'` 抛错；绕过 action 的写入不触发订阅通知）。合法写法：action 内 `this.state.xxx`、`this.setState(k, v)`、`this.$patch(partial)`、`this.$replaceState(next)`。
5. **订阅是引用计数**：同一函数注册 N 次就通知 N 次，每个退订句柄只抵消自己那一次注册，重复调用同一句柄无效；句柄按注册标识精确退订，被上限驱逐的旧句柄不会误删同一回调的重新注册。`subscribe` 的监听器只接收**一个参数** `(state) => void`（新状态），没有 `prevState`。
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

## 常见任务

### 订阅与批量

```ts
const unsubscribe = store.subscribe((state) => console.log(state))
unsubscribe()

store.batch(() => { /* 多次写入合并为一次通知 */ })   // 或 startBatch() / endBatch() 手动配对
```

action 体内调用 `batch()` 时通知统一延迟到 dispatch 收尾补发一次；批保护只覆盖同步段，异步回调 `await` 之后的变更逐条通知（开发模式有告警）。

action 内 `this.state` 的对象/数组与 Map/Set 写入在两种通知模式下都会标记顶层脏键（共享别名可能标记多键），归属按需求建一次索引、标量写入 O(1)，逐项更新长列表不再退化；在同步订阅回调内读取 `isStateKeyDirty(key)`，通知结束后脏键清空（回调内重入写入的脏键留给下一轮）。默认模式同样追踪；`onlyOnChange` 只是按变更计数抑制通知，并非内容深比较，其基线覆盖 `beforeDispatch` 钩子内的写入。类实例与类型化数组也被追踪：属性/元素写入正常标记，实例方法调用保守标记所属键（读取时方法绑定原始接收者，`#private` 与内部槽位可用）。`getState()` 裸引用与 Date/RegExp/WeakMap/WeakSet 的内部变异不受追踪，请显式替换值。

### 插件（`extras/plugins`）

```ts
import { loggerPlugin, persistencePlugin, devtoolsPlugin } from '@openlide/geomstore/extras/plugins'
import { analyzerPlugin } from '@openlide/geomstore/extras/performance'
import { timeTravelPlugin } from '@openlide/geomstore/extras/plugins'

store.use(loggerPlugin)                        // 生产环境自动静默
store.use(persistencePlugin({
  key: 'app-state',
  filter: (s) => ({ user: s.user }),            // 只落盘部分状态
  validate: (s) => s && typeof s.user === 'object',
  debounce: 200,
}))
store.use(devtoolsPlugin)                       // globalThis.__GEOMSTORE_STORES__ / __GEOMSTORE_DEVTOOLS__
store.use(analyzerPlugin)                       // globalThis.__GEOMSTORE_ANALYZER__
store.use(timeTravelPlugin({ maxSize: 100 }))   // store.__timeTravel__.undo()
```

`storage` 必须**同步**（`{ getItem, setItem, removeItem }`），传异步实现会被拒绝；不传则自动探测 `wx` 同步存储，否则降级内存存储。

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

`createSelector` / `SelectorFactory` 的版本化缓存同时比较**状态对象身份与版本号**（O(1)）；跨 Store 的相同版本不会串值。无版本号时回退 `equalityFn`。`createStructuredSelector` 与 `SelectorComposer.combine` **需显式给出状态类型参数**（TS 无法反推）。

### Store 组合（主入口）

```ts
import { composeStore } from '@openlide/geomstore'

const root = composeStore([userStore, cartStore], { namespace: true, strict: true })
root.dispatch('userStore/login', payload)      // 命名空间模式下用斜杠路径
root.$patch({ 'userStore/name': 'Alice' })
```

组合 Store 的 `getState()` / `state` 在批内与异步通知等待期间也校验子 store 版本；无版本号的子 store（含嵌套组合）每次读取保守失效。`actions` 汇总子 action 名称，嵌套非命名空间组合可按裸名 dispatch；同名取第一个，命名空间模式仍使用斜杠路径。

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

签名：`withLog(options?)` / `withDebounce(delay = 300)` / `withThrottle(interval, options?)` / `withCache(options?)` / `withRetry(options?)` / `withTimeout(timeout, options?)` / `createDecorator(impl)`。节流的 `leading` / `trailing` 默认均为 `true`；方法"非 `async` 语法但返回 Promise"时置 `assumeAsync: true`，使被抑制的调用同样返回 Promise。函数式场景用 `ActionExecutor` / `ActionLoader` / `withLoading`。

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

### 快照与性能

```ts
import { SnapshotManager, createSnapshot } from '@openlide/geomstore/extras/snapshot'
import { PerformanceMonitor } from '@openlide/geomstore/extras/performance'

// Store 自身的快照对（深克隆 + 递归深冻结 ↔ 恢复）
const snap = store.$snapshot()
store.$restore(snap)

// 快照引擎：返回 { data, metadata, success, errors, stats }；克隆失败不抛错（有 cloneError 时 success:false）
const manager = new SnapshotManager()
const result = createSnapshot(store.getState())
const diff = manager.compareSnapshots(result, createSnapshot(next))   // 传完整 SnapshotResult，不是 .data
```

比较按对象对识别循环，等价循环不因重复进入被误判（深度 100 保护仍保留）。对象的自有 `undefined` 属性与缺失键不同，新增/删除会产生对应 `kind`，继承属性不参与。

## 性能与最佳实践

- **计算密集型派生用选择器**，不要用 getter（getter 每次读取都重新执行）。
- **多字段一起更新用 `$patch` 或 `batch()`**，避免多次通知；未检测到写入时可用 `notify.onlyOnChange` 抑制通知，同值写入也可能推进计数。
- **热点 state 键可开缓存**：`createStore({ enableCache: true, cacheKeys: ['count'] })`，读取用 `store.getCached('count')`。action 完成刷新时会移除已 `delete` 的键；`$replaceState` 清空缓存后回填，不依赖旧状态仍保留该键。
- **`notify: { clone: false }`** 进入零拷贝通知模式（监听器收到只读代理，调用方需自行保证不修改）。
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
| 持久化恢复失败 | 恢复值须为纯对象；`validate` 不通过会跳过恢复；自定义 `storage` 必须同步 |
| `Plugin` 与 Store 状态类型不匹配的编译错误 | 插件泛型已收紧，把插件声明为匹配的 `Plugin<S>`，或对状态无关插件写作 `Plugin<State>` |
| 时间旅行 / analyzer API 不存在 | 需先 `store.use(...)` 安装对应插件，且非生产环境 |

## Resources

**1）本 skill 自带，任何环境可用**

- `references/api/index.md` —— 由 `scripts/generate-skill-api-reference.mjs` 从 `dist/**/*.d.ts` **自动生成的 API 参考**（含精确签名与 JSDoc，重载会完整列出，当前对应 v0.5.1）。参考已**按入口拆分为 `references/api/*.md`**：先看索引的入口一览，再只打开所需入口的文件（渐进加载，不必读整个目录）。

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
