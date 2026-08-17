# @geomstore/benchmark

GeomStore 基准测试工具包 - 提供全面的性能基准测试功能。

## 安装

```bash
npm install @geomstore/benchmark geomstore
```

## 使用方式

### 基本用法

```typescript
import { createStore } from 'geomstore'
import { BenchmarkRunner, createBenchmarkAdapter } from '@geomstore/benchmark'

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
import { BenchmarkRunner, defaultBenchmarkConfig, mergeConfig } from '@geomstore/benchmark'

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
import { benchmarkUtils, ResultBuilder } from '@geomstore/benchmark'

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
import { benchmarkReporter } from '@geomstore/benchmark'

const md = benchmarkReporter.generate(report, 'markdown')
const json = benchmarkReporter.generate(report, 'json')
const html = benchmarkReporter.generate(report, 'html')
```

## License

MIT
