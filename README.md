# GeomStore

面向**原生微信小程序优先**的状态管理库：类 Pinia 的 API、完备的 TypeScript 类型推断，核心极简、可选能力下沉 `extras`。

- **瘦核心 / extras 分层** —— 主入口只含运行必需 API；快照、选择器、Action 增强、性能监控、错误处理、企业集成等一律走 `extras/*` 子路径，按需引入
- **小程序原生友好** —— 内置 `withPageStore` / `withComponentStore` / `withAppStore`，页面卸载自动退订；`wx.request`、同步存储、基础库缺失的 `console.group` 等环境差异均已适配
- **类型完备** —— 全量 `.d.ts` 随包发布，state / actions / getters 与插件均泛型化推导，无需手写断言
- **行为可观测** —— 统一错误账本（`errors` + `onError` 降级策略）、性能指标采集、快照隔离与差异对比
- **工程可信** —— 覆盖率门禁、源码 / 测试 / 示例三路 typecheck 零错误、纯 ESM，产物与构建脚本可复现

## 安装

```bash
pnpm add @openlide/geomstore
# 或 npm i @openlide/geomstore / yarn add @openlide/geomstore
```

| 要求                 | 说明                                                                              |
| -------------------- | --------------------------------------------------------------------------------- |
| **Node.js ≥ 22**     | 包是**纯 ESM**：无 CJS 产物，`exports` 里也没有 `require` 条件，请一律写 `import` |
| **TypeScript ≥ 5.4** | 公开类型签名使用了 `NoInfer`                                                      |
| 装饰器（可选）       | 用 `extras/action` 的装饰器需在 tsconfig 开启 `experimentalDecorators`            |

「有没有 CJS 入口」和「`require()` 能不能加载」是两件事：答案分别是**没有**、以及 **Node ≥ 22.12 能**（借 require(ESM) 同步加载，22.0–22.11 需 `--experimental-require-module`）——后者是运行时兜底，别据此写 CJS 代码。边界见 [FAQ 的集成与工程一节](./docs/FAQ.md#集成与工程)。

## 快速开始

先定义状态类型，再用工厂函数标注其返回类型——状态形状只有一份来源，getter / action 无需重复书写字面量类型，也不必写 `as` 断言：

```ts
import { createStore } from '@openlide/geomstore'

interface CounterState {
  count: number
}

const counterStore = createStore({
  name: 'counter',
  // 工厂函数：避免引用类型被多个实例共享
  state: (): CounterState => ({ count: 0 }),
  getters: {
    doubled: (state: CounterState) => state.count * 2,
  },
  actions: {
    // action 的 this 由 Store 自动注入，无需手写标注
    increment() {
      this.$patch({ count: this.state.count + 1 })
    },
  },
})

counterStore.dispatch('increment')
counterStore.getter('doubled') // 2
const unsubscribe = counterStore.subscribe((state) => console.log(state.count))
unsubscribe()
```

在微信小程序页面中使用（三端集成函数**都从主入口引入**）：

```ts
import { withPageStore } from '@openlide/geomstore'

Page(
  withPageStore(counterStore, {
    mapState: ['count'], // 数组简写：注入 this.data.count
    mapGetters: ['doubled'],
    mapActions: ['increment'], // 注入 this.increment()
    // 对象形式可重命名：{ total: 'count' } / { addOne: 'increment' }
  })({
    // 页面方法的 this 由集成层注入（this.data 与映射方法均有类型），不要手写 this 标注
    onLoad() {
      this.increment()
    },
    // 订阅在 onUnload 自动清理，无需手动退订
  }),
)
```

> 完整接入流程（组件 / App 级、缓存、组合、extras）见 [`docs/GUIDE.md`](./docs/GUIDE.md)；可运行示例见 [`examples/`](./examples)，分基础 / 缓存 / 小程序集成 / 高级 / extras 五类，由 `pnpm typecheck:examples` 全量校验。

## 核心能力

这张表只是**索引**。每条背后的边界语义（为什么这样、例外在哪）只写在 [docs/CONCEPTS.md](./docs/CONCEPTS.md) 一处，此处不重复。

| 能力          | 关键 API                                                                        | 一句话                                              |
| ------------- | ------------------------------------------------------------------------------- | --------------------------------------------------- |
| 状态读写      | `getState` / `setState` / `$patch` / `$replaceState` / `$snapshot` / `$restore` | `getState()` 是活动引用；要隔离副本用 `$snapshot()` |
| Action        | `dispatch`                                                                      | 同步 / 异步统一入口                                 |
| Getter        | `getter(name)`                                                                  | 无结果缓存；要记忆化用 `createSelector`             |
| 订阅与批量    | `subscribe` / `batch` / `startBatch` / `endBatch` / `isStateKeyDirty`           | 不写状态的订阅请标 `readOnly: true`                 |
| 内置缓存      | `enableCache` / `getCached` / `invalidateCache` / `getCacheStats`               | 读取只认 `getCached()`                              |
| 状态保护      | `stateProtection`                                                               | 拦截绕过 action 的直接变异                          |
| 钩子与插件    | `hooks.on` / `hooks.emit` / `use` / `usePlugin`                                 | 契约 `{ name, install(store) }`                     |
| Store 组合    | `composeStore` / `createStoreTree` / `StoreRegistry`                            | 命名空间 + 斜杠路径                                 |
| 小程序集成    | `withPageStore` / `withComponentStore` / `withAppStore`                         | 都从主入口引入；卸载自动退订                        |
| 独立 LRU 缓存 | `LRUCache`                                                                      | 容量淘汰 + TTL，可脱离 Store 使用                   |

**不在**主入口、需按需引入的能力：快照引擎、选择器、Action 装饰器与增强、性能监控、内置插件实现、错误处理、企业（WeCom）集成。

## 引入方式与体积分层

```ts
// 核心：状态 / Action / Getter / 订阅 / 钩子 / 批量 / 缓存 / 插件运行时 / 小程序集成 / 组合
import { createStore, withPageStore, composeStore } from '@openlide/geomstore'

// 可选能力：只在用到时才进入产物
import { createSnapshot } from '@openlide/geomstore/extras/snapshot'
import { createSelector } from '@openlide/geomstore/extras/selector'
import { persistencePlugin } from '@openlide/geomstore/extras/plugins'
```

合法子路径的完整清单与各自用途见 [docs/API.md 的「入口一览」](./docs/API.md#入口一览)——`package.json` 的 `exports` 是最终事实来源，文档门禁会反查两边是否一致。其中 `./extras` 是**聚合入口**，会把全部可选能力整体拉进产物，只在调试或确实全都要用时引入。

微信「构建 npm」不走 `exports`，而是整目录拷贝包根 `miniprogram` 字段指向的 `dist-weapp/`（与 `dist` 一比一对应的 CJS 镜像）。为什么必须是这个形状、以及它为什么不能用 Node 去验证，见 [CONTRIBUTING 的「构建与发布」](./CONTRIBUTING.md#构建与发布)。

## 小程序环境适配

- **体积收益取决于宿主有没有打包器**：走 webpack / vite / esbuild 的宿主会把没 import 的子入口摇掉；只靠 npm + 开发者工具「构建 npm」的宿主按包内 `miniprogram` 目录整目录计体积，此时子路径分层换来的是**运行时按需加载**，不是上传体积变小。主包额度紧张时可只引主入口并自行裁剪该目录，或改走自带打包器的方案。产物体积请以 `pnpm build:weapp` 的输出为准，本文不抄实测数字
- 环境差异（`wx.request` / `fetch` 上报、同步存储后端、基础库缺失的 `console.group`、定时器 `unref`）与生产模式的信号出口（需要被监控发现的问题统一走 `onError`）都已适配，具体契约见 [docs/CONCEPTS.md §11](./docs/CONCEPTS.md#调试表与持久化)，按症状排查见 [docs/FAQ.md](./docs/FAQ.md)

## 开发

装完依赖后日常三条：`pnpm test`、`pnpm typecheck`、`pnpm build`。

全部脚本、与 CI 同口径的门禁清单、微信产物链（`build:weapp` / `verify:weapp`）、发版流程与覆盖率阈值（唯一事实来源是 `jest.config.js` 的 `coverageThreshold`，此处不抄数值）都在 [CONTRIBUTING.md](./CONTRIBUTING.md#门禁与-ci-一致必须全绿)。

## 文档

| 文档                                                                           | 内容                                                 |
| ------------------------------------------------------------------------------ | ---------------------------------------------------- |
| [docs/GUIDE.md](./docs/GUIDE.md)                                               | 使用指南：从零接入到进阶用法                         |
| [docs/API.md](./docs/API.md)                                                   | API 参考：入口一览、选项默认值、语义契约             |
| [docs/CONCEPTS.md](./docs/CONCEPTS.md)                                         | 机制语义的唯一正本：状态、通知、缓存、快照…          |
| [docs/FAQ.md](./docs/FAQ.md)                                                   | 按症状排查                                           |
| [docs/BEST_PRACTICES.md](./docs/BEST_PRACTICES.md)                             | 该做 / 别做的结论清单与上线检查                      |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)                                 | 分层架构、目录职责与设计取舍                         |
| [docs/MIGRATION.md](./docs/MIGRATION.md)                                       | 版本迁移与行为变更对照（历史只写在这里）             |
| [examples/](./examples)                                                        | 可运行示例五类                                       |
| [CHANGELOG.md](./CHANGELOG.md)                                                 | 完整变更记录（随包发布）                             |
| [CONTRIBUTING.md](./CONTRIBUTING.md)                                           | 脚本、门禁清单、构建与发版流程                       |
| [.codebuddy/skills/geomstore/SKILL.md](./.codebuddy/skills/geomstore/SKILL.md) | 供 AI 编码助手读取的库使用规程（仓库内，不随包发布） |

## 许可

[MIT](./LICENSE)
