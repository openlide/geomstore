# GeomStore

面向**微信小程序优先**的 TypeScript 状态管理库：核心极简、可选能力下沉 extras，按需引入即可让主包只带真正用到的代码。

- **核心 / extras 分层**：主入口与 `core` 只含运行必需 API；快照、选择器、Action 增强、性能监控、错误处理、企业集成等全部通过 `extras/*` 子路径按需引入
- **小程序原生友好**：内置 `withPageStore` / `withComponentStore` / `withAppStore` 集成，页面卸载自动退订；环境差异（`wx.request`、同步存储、基础库缺失的 `console.group`）均已适配
- **类型完备**：全量 `.d.ts` 随包发布，泛型化的 state / actions / getters 推导
- **行为可观测**：统一的错误账本（`errors` + `onError` 降级策略）、性能指标采集、快照隔离与差异对比
- **工程可信**：语句 / 分支 / 函数 / 行 **四项覆盖率 100%**；全部 tsconfig（源码 / Jest / 测试 / 构建 / 类型检查 / 示例）零错误

## 安装

```bash
pnpm add @openlide/geomstore
# 或 npm i @openlide/geomstore / yarn add @openlide/geomstore
```

要求 **Node.js ≥ 22**（本包为 ESM，`"type": "module"`），**TypeScript ≥ 5.4**（公开类型签名使用了 `NoInfer`，更低版本编译 `.d.ts` 会报 `Cannot find name 'NoInfer'`）。

## 快速开始

```ts
import { createStore } from '@openlide/geomstore'

// 先定义状态类型：状态形状的唯一来源，getter / action 直接复用
interface CounterState {
  count: number
}

const counterStore = createStore({
  name: 'counter',
  // 推荐工厂函数：避免引用类型被多个实例共享；标注返回类型后字段无需断言
  state: (): CounterState => ({ count: 0 }),
  getters: {
    doubled: (state: CounterState) => state.count * 2,
  },
  actions: {
    // action 的 this 自动注入，无需手写标注
    increment() {
      this.$patch({ count: this.state.count + 1 })
    },
  },
})

counterStore.dispatch('increment')
console.log(counterStore.getter('doubled')) // 2
counterStore.subscribe((state) => console.log('changed:', state.count))
```

小程序页面中使用：

```ts
import { withPageStore } from '@openlide/geomstore'

Page(
  withPageStore(counterStore, {
    mapState: ['count'],
    mapGetters: ['doubled'],
    mapActions: ['increment'],
  })({
    // 页面方法的 this 由集成层注入：this.data 与 mapActions 注入的方法均有类型
    onLoad() {
      this.increment()
    },
    // 订阅在 onUnload 自动清理，无需手动退订
  }),
)
```

更多可运行示例见 [`examples/`](./examples)（基础 / 缓存 / 小程序集成 / 高级 / extras 五类；`pnpm typecheck:examples` 会校验全部示例）。

## 核心能力

| 能力 | 引入位置 | 说明 |
| --- | --- | --- |
| 状态读写 | 核心 | `getState` / `setState` / `$patch` / `$replaceState` |
| 快照与还原 | 核心 | `$snapshot` / `$restore`（隔离副本） |
| Action | 核心 | `dispatch`、同步/异步、action 上下文、失败传播 |
| Getter | 核心 | `store.getter(name)`、依赖未变时复用 |
| 订阅 | 核心 | `subscribe` 返回退订函数；支持上限策略 |
| 钩子系统 | 核心 | `store.hooks.on/emit`，供插件与监控接入 |
| 批量更新 | 核心 | `batch` / `startBatch` / `endBatch`，合并通知 |
| 内置缓存 | 核心 | `enableCache(keys?)` / `disableCache` / `invalidateCache` / `getCached` / `getCacheStats` |
| 插件系统 | 核心 | `use(plugin)` / `usePlugin(plugin, store)` |
| 小程序集成 | 核心 | `withPageStore` / `withComponentStore` / `withAppStore` |
| Store 组合 | 核心 | `composeStore`（命名空间 + 斜杠路径）/ `StoreRegistry` |
| LRU 缓存 | 核心 | `LRUCache`（容量淘汰 + TTL） |

以下能力**不在**主入口，需按需引入（见下节）：快照引擎、选择器、Action 装饰器、性能监控、内置插件实现、错误处理、企业集成。

## 引入方式与体积分层

```ts
// 核心：主入口（含状态、Action、Getter、订阅、钩子、批量、缓存、插件运行时、小程序集成、组合）
import { createStore, withPageStore, composeStore } from '@openlide/geomstore'

// 显式核心子入口（与主入口同源，便于按目录组织导入）
import { createStore } from '@openlide/geomstore/core'

// 可选能力：只在用到时才进入产物
import { createSnapshot } from '@openlide/geomstore/extras/snapshot'
import { createSelector } from '@openlide/geomstore/extras/selector'
import { withThrottle } from '@openlide/geomstore/extras/action'
import { analyzerPlugin } from '@openlide/geomstore/extras/performance'
import { persistencePlugin } from '@openlide/geomstore/extras/plugins'
import { ErrorBoundary } from '@openlide/geomstore/extras/error'
import { createEnterpriseApp } from '@openlide/geomstore/extras/enterprise'
```

> 包内另有若干**转发子目录**（`store/`、`hooks/`、`plugins/`、`integrations/`），由 `pnpm stubs` 生成，供不支持 `exports` 子路径的解析器（如微信「构建 npm」）按目录裸导入。也可一次性引入全部可选能力（`@openlide/geomstore/extras`），但只在调试或确实全都要用时才建议这样做。

## 环境适配要点

- **定时器**：内部对 `setInterval`/`setTimeout` 做 `unref` 探测，浏览器 / 小程序无该 API 时自动跳过，不会阻止进程退出
- **网络**：错误上报自动选择 `wx.request`（校验 `statusCode`）或 `fetch`（校验 `ok`），均可注入自定义实现
- **控制台**：基础库缺少 `console.group` 时错误报告自动降级为平铺输出
- **存储**：持久化插件要求**同步**后端（如 `wx.getStorageSync`）；传入异步实现会被显式拒绝，避免写入静默丢失
- **生产模式**：插件安装、订阅驱逐、子 store 竞态等路径在 `NODE_ENV=production` 下静默（仅开发模式打日志）

## 工程脚本

| 脚本 | 用途 |
| --- | --- |
| `pnpm test` / `test:unit` / `test:integration` | 运行测试 |
| `pnpm test:coverage` | 覆盖率报告（阈值即当前四项 100%） |
| `pnpm typecheck` / `typecheck:tests` / `typecheck:examples` | 源码 / 测试 / 示例类型检查 |
| `pnpm lint` / `lint:fix` | ESLint（`lint:ci` 带警告上限，用于门禁） |
| `pnpm build` | `clean-dist` → `tsc -p tsconfig.build.json` → 生成 module-type 标记并移除 sourcemap |
| `pnpm build:release` | 构建并**强制压缩**（无压缩器时以退出码 1 中止，杜绝静默发出未压缩包） |
| `pnpm stubs` / `stubs:clean` | 生成 / 清理转发子目录（`prepack`/`postpack` 自动执行） |

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/GUIDE.md](./docs/GUIDE.md) | 使用指南：从零接入到进阶用法 |
| [docs/API.md](./docs/API.md) | API 参考（核心 / extras 标注） |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | 分层架构、目录结构、模块职责与设计取舍 |
| [docs/CONCEPTS.md](./docs/CONCEPTS.md) | 概念模型：状态、通知、快照隔离、缓存与版本号 |
| [docs/BEST_PRACTICES.md](./docs/BEST_PRACTICES.md) | 最佳实践与常见坑 |
| [docs/FAQ.md](./docs/FAQ.md) | 常见问题 |
| [docs/MIGRATION.md](./docs/MIGRATION.md) | 版本迁移与行为变更对照 |

## 许可

[MIT](./LICENSE)
