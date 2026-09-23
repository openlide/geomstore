# @openlide/geomstore-benchmark

GeomStore 基准测试工具包 - 提供全面的性能基准测试功能。

## 定位与用法

**仓库内部工具，不发布到 registry**（`package.json` 里 `private: true`，无发布元数据）。
本包只依赖自己 `src/types/store.ts` 声明的抽象 `BenchmarkStore` 适配契约，
不 import `@openlide/geomstore`，因此可以被用来跑任意实现了该契约的 store。

在本仓库内直接引用源码即可（`@openlide/geomstore` 也按包名从根包解析）：

```typescript
import { createStore } from '@openlide/geomstore'
import { BenchmarkRunner, createBenchmarkAdapter } from './packages/benchmark/src/index.js'
```

跑冒烟（覆盖 `runAll()` 与 markdown/html/json 三种报告格式，失败时退出码非 0）：

```bash
npx tsc -p packages/benchmark/tsconfig.json && node packages/benchmark/dist/smoke.js
# 等价写法：cd packages/benchmark && npm run bench
```

CI 的 `verify-static` job 里就是这个命令——本包**不在 pnpm 工作区内**，
它不被 `pnpm install` 链接，因此编译用的 `typescript` 借的是根包装的版本（见下）。

## 使用方式

### 基本用法

```typescript
import { createStore } from '@openlide/geomstore'
import { BenchmarkRunner, createBenchmarkAdapter } from '@openlide/geomstore-benchmark'

// 创建 Store 工厂函数
const createStoreForBenchmark = (config) => {
  const store = createStore({
    name: `benchmark-${Date.now()}`,
    ...config,
  })
  return createBenchmarkAdapter(store)
}

// 创建运行器
const runner = new BenchmarkRunner(createStoreForBenchmark)

// 运行基准测试
const report = await runner.runAll()

// 生成报告
console.log(benchmarkReporter.generate(report, 'markdown'))
```

### 自定义场景

```typescript
import { BenchmarkRunner, defaultBenchmarkConfig, mergeConfig } from '@openlide/geomstore-benchmark'

const customConfig = mergeConfig(defaultBenchmarkConfig, {
  scenarios: [
    {
      name: 'my-custom-test',
      description: '自定义测试场景',
      datasetSize: 'medium',
      iterations: 5000,
      warmup: true,
      warmupIterations: 500,
    },
  ],
})

const runner = new BenchmarkRunner(createStoreForBenchmark, customConfig)
```

### 使用工具函数

```typescript
import { benchmarkUtils, ResultBuilder } from '@openlide/geomstore-benchmark'

// 测量执行时间
const { result, duration } = benchmarkUtils.measureTime(() => {
  // 你的代码
})

// 计算时间统计
const stats = benchmarkUtils.calculateTimeStats([1.2, 1.5, 1.3, 1.8, 1.1])

// 构建结果
const benchmarkResult = ResultBuilder.createResult({
  scenario: 'my-test',
  iterations: 1000,
  timeStats: stats,
  passedCheck: () => stats.avg < 1,
})
```

## API

### 核心类

- `BenchmarkRunner` - 基准测试运行器
- `BenchmarkReporter` - 报告生成器

### 配置

- `defaultBenchmarkConfig` - 默认配置
- `relaxedBenchmarkConfig` - 宽松配置（适用于 CI）
- `mergeConfig()` - 合并配置

### 工具

- `benchmarkUtils` - 工具函数集合
- `ResultBuilder` - 结果构建器
- `executeWarmup()` - 执行预热

### 类型

- `BenchmarkStore` - Store 抽象接口
- `BenchmarkResult` - 测试结果
- `BenchmarkReport` - 测试报告
- `BenchmarkConfig` - 测试配置

## 报告格式

支持三种报告格式：

- `markdown` - Markdown 格式（默认）
- `json` - JSON 格式
- `html` - HTML 格式

```typescript
import { benchmarkReporter } from '@openlide/geomstore-benchmark'

const md = benchmarkReporter.generate(report, 'markdown')
const json = benchmarkReporter.generate(report, 'json')
const html = benchmarkReporter.generate(report, 'html')
```

## License

MIT
