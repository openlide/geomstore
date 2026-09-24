---
name: geomstore
description: 微信小程序状态管理库 GeomStore（@openlide/geomstore，v0.8.1，纯 ESM 瘦核心）的使用指南。当需要编写、修改或审查使用 GeomStore 的代码——创建 Store、定义 actions/getters、接入小程序 Page/Component/App、从 extras/* 子入口引入可选能力——时使用。触发条件：代码里已出现 createStore/withPageStore/composeStore/createSelector 等调用，或用户点名要用 GeomStore。
---

# GeomStore 使用指南

## Overview

GeomStore 是轻量级微信小程序状态管理库，提供类 Pinia 的 API、完整的 TypeScript 类型推断、企业级能力（Store 组合、插件、错误处理、性能监控、快照、Action 增强）与原生小程序集成（Skyline / Webview）。

当前版本 **v0.8.1**。两条硬性特征决定了绝大多数误用：

- **纯 ESM**：只有 ESM 产物，**无 CJS 入口**（`exports` 里也没有 `require` 条件）。一律写 `import`。
- **瘦核心 + 按需子入口**：主入口只含运行必需 API；快照 / 选择器 / 性能 / Action 增强 / 插件实现 / 企业集成等**不在主入口**，必须从 `extras/*` 引入。

本文件是**速查层**：下面「使用规则」每条只给结论与最容易踩的坑，完整边界语义一律指向 `references/`。两者都不与源码争权威——签名以 `references/api/`（脚本从 `.d.ts` 生成）为准，仓库内另可读 `docs/`。

## 目录

- [Overview](#overview)
- [使用规则](#使用规则)——10 条，写代码前先看
- [快速上手](#快速上手)——创建 Store、接入 Page / Component / App
- [常见任务](#常见任务)——订阅与批量、插件、选择器、装饰器、错误、快照
- [常见错误排查](#常见错误排查)——按报错与症状定位
- [Resources](#resources)——该打开哪个文件

## 使用规则

1. **写代码前先查签名，不要凭记忆**：先看 [`references/api/index.md`](./references/api/index.md) 的入口一览，再只打开所需入口的文件（生成物，勿手改）。默认值与语义契约看 `references/*-semantics.md`；在 GeomStore 仓库内另可读 `docs/`——两条分流见文末 [Resources](#resources)。
2. **导入路径**：`exports` 仅声明下表子路径，不要深链叶子模块。日常用第一行即可，可选能力按需从 `extras/*` 引入。

   | 引入路径                                                                                     | 内容                                                                                                                                                                                                |
   | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `@openlide/geomstore`（或 `/core`）                                                          | `createStore` / `Store` / 工具函数 / `HookSystem` / `usePlugin` / `withPageStore` / `withComponentStore` / `withAppStore` / `composeStore` / `LRUCache`                                             |
   | `@openlide/geomstore/integrations`                                                           | 上述 `with*` 三件套 + 底层绑定工具 + 企业级（user store / StoreManager / 离线队列 / 后台同步 / 热更新 / createEnterpriseApp）；符号全名见 [`api/integrations.md`](./references/api/integrations.md) |
   | `@openlide/geomstore/extras/{snapshot,selector,action,performance,plugins,error,enterprise}` | 各可选能力（推荐按子入口精确引入）                                                                                                                                                                  |
   | `@openlide/geomstore/extras`                                                                 | 全部可选能力聚合，会整体拉入产物，仅调试或确实全都要用时引入                                                                                                                                        |
   - **微信「构建 npm」不走 `exports`**：它读包根 `miniprogram` 字段 → 包内 `dist-weapp/`，把**整目录**拷进 `miniprogram_npm`，不拼接、不做依赖分析。该目录是与 `dist` 按模块一比一转译的 CJS 镜像，11 个公开子路径入口齐备、导出面逐项一致。
   - ⚠️ **别拿 Node 去验证 `dist-weapp/`**：目录内不带 `package.json`，Node 会按根包的 `"type": "module"` 把它的 `.js` 判成 ESM，直接加载报 `require is not defined in ES module scope`。那是 Node 的解析规则、不是产物缺陷——它的 CJS 语义只对微信工具自己的加载器成立。
   - **包内还有 11 个转发子目录**（`store` / `hooks` / `plugins` / `integrations` / `compose` / `selectors` / `snapshot` / `performance` / `actions` / `cache` / `error`），只给不解析 `exports` 的老式场景按目录裸导入。**Node 与打包器下一律以上表为准**：快照用 `extras/snapshot`，不要用 `/snapshot`。

3. **环境要求**：Node ≥ 22；TypeScript ≥ 5.4（公开签名用了 `NoInfer`，低版本编译 `.d.ts` 会报 `Cannot find name 'NoInfer'`）；用装饰器需 `experimentalDecorators`。
4. **状态只能经 action / 公开写入口修改**：`store.state.xxx = value` 在开发模式直接抛错，且绕过 action 的写入不触发订阅通知。合法写法：action 内 `this.state.xxx` / `setState` / `$patch` / `$replaceState`。**冻结 / 不可写属性是明确豁免**——拿到裸引用，读得到但不受保护、不标脏、不通知。生产三档策略与完整豁免清单 → [`core-semantics.md` §1](./references/core-semantics.md#1-写入路径与状态保护)
5. **一次异步 dispatch 默认通知 2 次**：同步段结束当场补发一次，settle 再补发一次覆盖 `await` 之后的变更。别在订阅里假设「恰好一次」，按通知次数写的断言要按 2 次；要一次就开 `notify.onlyOnChange` → [`§2`](./references/core-semantics.md#2-订阅与通知)
6. **getter 没有任何结果缓存**：每次 `store.getter(name)`、每次读 `store.getters.x` 都按当前状态重算一遍。要「依赖未变则复用」请用 `extras/selector` 的 `createSelector` → [`§3`](./references/core-semantics.md#3-getter)
7. **`getCached(key)` 是缓存的唯一读取入口**：`getState()` / `store.state` 完全不查缓存，拿它验证缓存会让 `hits` / `misses` 恒为 0；`setState` / `$patch` 是**写穿**（更新条目）而不是失效 → [`§4`](./references/core-semantics.md#4-内置缓存)
8. **订阅是引用计数，`maxSubscribers` 是硬上界**：同一函数注册 N 次就通知 N 次、每个退订句柄只抵消自己那次；额度对每一次注册都过（重复注册同样占额度）。监听器签名只有 `(state) => void`，没有 `prevState` → [`§2`](./references/core-semantics.md#2-订阅与通知)
9. **可选能力按需引入，但包体积收益看宿主**：有打包器（webpack / vite / esbuild）才摇得掉未 import 的子入口；只用 npm + 开发者工具「构建 npm」时，体积按包内 `miniprogram` 目录（**全部子入口都在**）整目录计，子路径分层只换来运行时按需加载。
10. **组合 Store**：`ComposeOptions` 只有 `namespace` / `strict` 真在生效，`lazy` / `tree` / `NamespaceConfig` 是「已声明、未实现」（写了编译通过、静默无效）；命名空间模式下 `store.name` 同时是路由键，空串或含 `/` 在构造期抛错 → [`§5`](./references/core-semantics.md#5-store-组合)

> 各条背后的完整边界语义（状态保护豁免清单、通知载荷分配、脏键追踪、持久化后端契约、全局调试表、集成细节、extras 逐项语义）见 [`references/core-semantics.md`](./references/core-semantics.md) 与 [`references/extras-semantics.md`](./references/extras-semantics.md)。

## 快速上手

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
    doubled: (state: CounterState) => state.count * 2,
  },
})

counterStore.dispatch('add', 10) // 参数类型自动推断
counterStore.getter('doubled') // 返回类型自动推断
counterStore.subscribe((state) => {
  /* 新状态 */
})
```

### 接入微信小程序

三端集成函数**都从主入口引入**，配置方法内 `this` 类型已自动注入（`PageThis` / `ComponentThis` / `AppThis`），**不要手写 `this` 标注**——手写反而会覆盖集成层注入的类型。

```ts
import { withPageStore, withComponentStore, withAppStore } from '@openlide/geomstore'

// Page：onUnload 自动退订
Page(
  withPageStore(counterStore, {
    mapState: ['count'], // 数组简写：注入 this.data.count
    mapGetters: ['doubled'],
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

Page 的 `onUnload` 与 Component 的 `lifetimes.detached` **先同步执行用户钩子，再在 `finally` 清理绑定**；钩子内可调用映射 actions，抛错仍会清理。包装器不等待 Promise，`await` 后不要再依赖映射方法。

`autoInject: true` 时用 `store.getCached(key)` 在挂载钩子里注入一次；再开 `autoUpdateOnShow: true` 才追加 `onShow` 包装器**每次回前台重新注入**——两个开关缺一不可。详见 [`core-semantics.md` §7](./references/core-semantics.md#7-小程序集成细节)。

## 常见任务

### 订阅与批量

```ts
const unsubscribe = store.subscribe((state) => console.log(state))
unsubscribe()

store.subscribe(listener, { readOnly: true }) // 声明不写状态：全部订阅者只读时通知载荷免深拷贝

store.batch(() => {
  /* 多次写入合并为一次通知 */
}) // 或 startBatch() / endBatch() 手动配对
```

- **「不写状态的订阅」要老实标 `readOnly: true`**，这是大状态下最主要的通知开销开关——通知载荷的拷贝份数按注册的可写性分配。
- `batch` 只覆盖同步段，`await` 之后的变更逐条通知；嵌套 dispatch 仅最外层通知。
- 脏键用 `store.isStateKeyDirty(key)` 查（同步订阅回调内读取有效，通知结束后清空）。

### 插件（`extras/plugins`）

```ts
import { loggerPlugin, persistencePlugin, devtoolsPlugin, timeTravelPlugin, WxStorageBackend } from '@openlide/geomstore/extras/plugins'
import { analyzerPlugin } from '@openlide/geomstore/extras/performance'

store.use(loggerPlugin) // 生产环境自动静默
store.use(
  persistencePlugin({
    key: 'app-state',
    storage: new WxStorageBackend(), // 微信环境：内置同步后端
    filter: (s) => ({ user: s.user }), // 只落盘部分状态
    validate: (s) => s && typeof s.user === 'object',
    debounce: 200,
  }),
)
store.use(devtoolsPlugin) // 调试入口：globalThis.__GEOMSTORE_STORES__ / __GEOMSTORE_DEVTOOLS__
store.use(analyzerPlugin) // globalThis.__GEOMSTORE_ANALYZER__
store.use(timeTravelPlugin({ maxSize: 100 })) // globalThis.__GEOMSTORE_TIME_TRAVEL__['<store.name>']
```

- `storage` 必须**同步且三方法齐备**（`{ getItem, setItem, removeItem }`）：残缺或返回 Promise 的后端在安装期 / 读写时**明确抛错**，绝不静默换后端。接微信请传 `new WxStorageBackend()`——**`wx` 全局对象本身没有 `getItem`**，不能直接当后端用。
- 调试入口一律是 `globalThis` 上的表，**表键是 `store.name`**，且**只在非生产环境挂载**。
  详见 [`core-semantics.md` §6](./references/core-semantics.md#6-插件调试表与持久化)。

### 选择器（`extras/selector`）

```ts
import { createSelector, createMemoizedSelector, createParametricSelector, createStructuredSelector } from '@openlide/geomstore/extras/selector'

const selectCount = createSelector((s: CounterState) => s.count)
const memoDouble = createMemoizedSelector((s: CounterState) => s.count * 2)
const selectById = createParametricSelector((s: CounterState, id: string) => /* ... */)(store.getState())
```

- 缓存命中同时比较**状态对象身份与版本号**（O(1)），跨 Store 相同版本不会串值。
- 状态**无版本号**时改用 `equalityFn` 判等，缓存内容是**深拷贝快照**（`snapshotState` 默认 `true`）；只有引用相等比较器才显式传 `snapshotState: false`，默认值下配 `(a, b) => a === b` 会**永不命中**。
- `createStructuredSelector` 与 `SelectorComposer.combine` **需显式给出状态类型参数**。
  详见 [`extras-semantics.md` §2](./references/extras-semantics.md#2-选择器extrasselector)。

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

- **装饰同步方法的 `withRetry` 会改变返回类型**（`T → Promise<T>`，同步抛出变 rejection），调用方必须改；不想改就别给同步方法加它。
- 超时按 **`error.code === TIMEOUT_ERROR_CODE`**（`'ACTION_TIMEOUT'`）判定，**不要按 message 匹配**（两个入口文案不同且只作展示）。
- `withLog` 在**生产构建默认强制摘要**（`Error` 只留 `name`、不含 `message`）；要让 `redact` 全权决定形态须显式 `summarizeInProduction: false`。
- 卸载点收尾入口（`cancel*Calls` / `flush*Calls` / `dispose*State`）**装饰 store action 时一律静默 no-op**——请装饰 Page / Component 方法。
  详见 [`extras-semantics.md` §3](./references/extras-semantics.md#3-action-装饰器与增强extrasaction)。

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

- `ErrorRecovery` 的 `RETRY` **不在库内重跑原操作**：按退避延迟后**重抛原错误**，由调用方自己重试。额度按「键 + 时间窗」累计，用尽后同一周期内持续拦截。
- `recover` 只接受 `GeomStoreError`，按 `error.code` 分支，不要按 `instanceof Error` 猜。
- `totalErrors` / `queuedErrors` / `droppedErrors` 是**三个互不重叠的口径，不能相加核对**。
  详见 [`extras-semantics.md` §4](./references/extras-semantics.md#4-错误处理extraserror)。

### 快照与性能（`extras/snapshot` / `extras/performance`）

```ts
import { SnapshotManager, createSnapshot } from '@openlide/geomstore/extras/snapshot'

// Store 自身的快照对（深克隆 + 冻结纯对象/数组链 ↔ 恢复）
const snap = store.$snapshot()
store.$restore(snap)

// 快照引擎：{ data, metadata, success, errors, stats }
const result = createSnapshot(store.getState())
if (result.success) use(result.data) // data 类型是 T | undefined，用前必须判 success
const diff = new SnapshotManager().compareSnapshots(result, createSnapshot(next)) // 传完整 SnapshotResult，不是 .data
```

- **先判 `success` 再用 `data`**：异常 / 中止 / 根节点被丢弃时是 `undefined`，异步超时下甚至是半成品。
- `success: true` 时 `errors` **可以非空**（`circular` / `maxDepth` / `onProgress` 抛错都入账但不影响 `success`），别拿它当失败信号。
- 读 `compareSnapshots` 的结果**先看 `inputTrusted`**：任一侧 `success: false` 时为 `false`，此时只交付一条 `path: 'root'` 的整体差异且 `changed` 恒为 `true`——那是「输入不可信」，不是「内容有差异」。
  详见 [`extras-semantics.md` §1](./references/extras-semantics.md#1-快照extrassnapshot)。

## 性能与最佳实践

本文件不重复性能建议——它们按主题分散在上面的「使用规则」与「常见任务」里，完整清单的正本是仓库 [`docs/BEST_PRACTICES.md`](../../../docs/BEST_PRACTICES.md)（含上线检查清单）。

只有一条值得在这里再写一遍，因为它决定通知次数：**多字段一起更新用 `$patch` 或 `batch()`**，不要连着写多次 `setState`。

## 常见错误排查

| 现象                                                                                    | 原因与修复                                                                                                                                                        |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Cannot find module '@openlide/geomstore'`                                              | 未安装依赖、未执行「构建 npm」，或用了不存在的子路径；合法子路径只有 `.`（根路径本身）、`/core`、`/integrations`、`/extras`、`/extras/*`                          |
| `require is not defined` / `ERR_REQUIRE_ESM`                                            | 产物是纯 ESM，改用 `import`；配置侧确保按 ESM 解析                                                                                                                |
| `Cannot find name 'NoInfer'`                                                            | TypeScript < 5.4，升级 TS 或开启 `skipLibCheck`                                                                                                                   |
| 从主入口引 `createSelector` / `SnapshotManager` / `withRetry` 报错                      | 这些是可选能力，改从 `extras/selector` / `extras/snapshot` / `extras/action` 引入                                                                                 |
| 直接改 state 不生效或被警告                                                             | 必须经 action：`dispatch` / `this.$patch` / `store.$patch`                                                                                                        |
| 订阅回调不触发                                                                          | 检查是否只读未写；`notify.onlyOnChange` 为 `true` 时未检测到写入不通知                                                                                            |
| 订阅触发次数不符 / 退订后仍触发                                                         | 同一函数重复订阅按引用计数通知 N 次、退订只减一份，确认没有重复注册                                                                                               |
| 一次异步 dispatch 收到 **2 次**通知                                                     | 属 0.7.0 预期：同步段结束当场补发一次、settle 再补发一次。要恰好一次开 `notify.onlyOnChange`                                                                      |
| `getCacheStats()` 的 `hits` / `misses` 恒为 0                                           | 读取走的是 `getState()`（不查缓存）。缓存唯一读取入口是 `getCached(key)`；`setState` / `$patch` 是**写穿**不是失效                                                |
| 快照后的 `Map` / `Set` 子类、TypedArray、`Error` 一改就串回活状态                       | 这批值与内建槽位值（`Promise` / 装箱原始值 / WeakMap·WeakSet / 函数）**保留原引用**而不是重建；需要真副本请用 `customCloner` 接管，或自己 `slice(0)` / 结构化克隆 |
| `compareSnapshots` 报 `changed: true` 但看不出改了啥                                    | 先看 `inputTrusted`：任一侧快照 `success: false` 时它是 `false`，那条 `path: 'root'` 差异只代表**输入不可信**，不代表内容真变了                                   |
| 组合 store 读起来少了某个子店的键、且日志里一条 `子 store "x" 已销毁，读取按空视图处理` | 该子店在组合之外被 `destroy()` 了。三条读路径都按**空视图**并入并只告警一次；显式判 `store.destroyed`、把该店从组合里摘掉，别把告警当噪音                         |
| `store.state.frozenNode.child = 1` 在生产里悄悄改成功了                                 | 冻结 / 不可写属性拿到的是**裸引用**，不受写保护、不标脏、不通知；把需要保护的状态放可配置可写的属性上，或整体 `setState` / `$patch` 替换                          |
| 切前台不自动刷新数据                                                                    | `initBackgroundSync` / `createEnterpriseApp` **按名字** `dispatch('refreshData')`；给该 store 提供 `refreshData`（`createUserStore` 已提供）                      |
| 组件生命周期不执行                                                                      | 微信要求写在 `lifetimes` / `pageLifetimes` 内，配置顶层的 `attached` 等不会被执行                                                                                 |
| `withRetry(fn, opts)` 报错                                                              | 装饰器只能用于类方法且需 `experimentalDecorators`；函数式场景用 `ActionExecutor`                                                                                  |
| 持久化恢复失败                                                                          | 恢复值须为纯对象；`validate` 不通过会跳过恢复；自定义 `storage` 必须同步且三方法齐备（否则 `store.use()` 安装期就抛 `TypeError`）                                 |
| 生产环境完全没有日志                                                                    | 属预期（库口径静默），但降级 / 监听器抛错 / 落盘失败等会 `emit('onError', …, source)`；给 `onError` 挂上报处理器，而不是指望控制台                                |

## Resources

### 1）本 skill 自带，任何环境可用

- [`references/api/index.md`](./references/api/index.md) —— **自动生成的 API 参考**（从 `dist/**/*.d.ts`，含精确签名、JSDoc 与完整重载，当前对应 v0.8.1）。按入口拆分，先看索引的入口一览再只打开所需那一个；重新生成 `pnpm build && pnpm skill:api`。**不要手工编辑**，检索方式见该文件自身。
- [`references/core-semantics.md`](./references/core-semantics.md) —— 核心的逐条边界语义：写入路径与状态保护、订阅与通知、getter、内置缓存、组合、插件与调试表、小程序集成。
- [`references/extras-semantics.md`](./references/extras-semantics.md) —— 可选能力的逐条边界语义：快照、选择器、Action 装饰器、错误处理、性能监控、企业集成。

### 2）在 GeomStore 仓库内开发（`docs/` 与 `src/` 可见）

这里能读到生成物里没有的东西——默认值、设计意图、契约的完整表述：

- [`docs/CONCEPTS.md`](../../../docs/CONCEPTS.md) —— **机制语义的唯一正本**（本文件「使用规则」指向的完整边界大多在这里）
- [`docs/API.md`](../../../docs/API.md) —— 入口一览、选项默认值、逐 API 契约与易误用点
- [`docs/GUIDE.md`](../../../docs/GUIDE.md) / [`docs/FAQ.md`](../../../docs/FAQ.md) / [`docs/BEST_PRACTICES.md`](../../../docs/BEST_PRACTICES.md) / [`docs/MIGRATION.md`](../../../docs/MIGRATION.md) —— 接入教程 / 症状排查 / 结论清单 / 变更史
- `examples/` —— 可运行示例（basic / cache / weapp / advanced / extras），纳入 `pnpm typecheck:examples`
- `src/types/*.ts` —— 完整类型定义

### 3）在其他小程序项目内（只装了 npm 包）

`docs/` 与 `src/` 都不存在——**`docs/` 不在包的 `files` 白名单里**。可用的只有：

- `node_modules/@openlide/geomstore/dist/**/*.d.ts` —— 与你装的版本必然一致的原始声明
- 同目录的 `CHANGELOG.md` 与包根 `README.md`（两者都在 `files` 白名单 / npm 无条件补发的清单里）
- 包内 `package.json` 的 `exports` —— 合法子路径的最终事实来源
