/**
 * 第六轮 f1-03 分片的回归锁（二）：报告器 HTML 侧的警告 / 错误段
 *
 * 覆盖 R6-023：HTML 分支原先只渲染六行指标 + 一个 ❌/✅ 图标，把 warnings / errors 整块丢了，
 * 于是本包最常见的失败路径（场景在测量前抛错 → createErrorResult）在 HTML 里是一张红边卡片、
 * 指标全 0、完全看不到失败原因，而 HTML 恰恰是给非工程同事看的那一份。
 */

import { BenchmarkReporter } from '../../packages/benchmark/src/reporter.js'
import { ResultBuilder } from '../../packages/benchmark/src/helpers.js'
import { defaultBenchmarkConfig } from '../../packages/benchmark/src/config.js'
import type { BenchmarkReport, BenchmarkResult } from '../../packages/benchmark/src/types/index.js'

function makeReport(results: BenchmarkResult[]): BenchmarkReport {
  return {
    metadata: {
      id: 'r6-f1-03',
      timestamp: '2026-09-23T00:00:00.000Z',
      version: '1.0.0',
      nodeVersion: process.version,
      platform: process.platform,
      cpu: { model: 'probe-cpu', cores: 1, speed: 0 },
      totalMemory: 1,
    },
    config: defaultBenchmarkConfig,
    results,
    summary: {
      totalScenarios: results.length,
      passedScenarios: results.filter((r) => r.passed).length,
      failedScenarios: results.filter((r) => !r.passed).length,
      totalDuration: 1,
      totalMemoryUsage: 0,
    },
    recommendations: [],
  }
}

const reporter = new BenchmarkReporter()

describe('R6-023 失败原因在两种报告格式里对等', () => {
  const failing = ResultBuilder.createErrorResult('large-workload', 1000, new Error('数据集配置无效：stateKeys 须为正整数'), 'large')
  const withWarnings = ResultBuilder.createResult({
    scenario: 'basic-write',
    iterations: 100,
    timeStats: ResultBuilder.emptyTimeStats(),
    warnings: ['堆峰值来自首轮分配'],
  })
  const report = makeReport([failing, withWarnings])
  const html = reporter.generate(report, 'html')
  const markdown = reporter.generate(report, 'markdown')

  it('HTML 卡片里带「错误」段与原文', () => {
    expect(html).toContain('class="notes errors"')
    expect(html).toContain('数据集配置无效：stateKeys 须为正整数')
  })

  it('HTML 卡片里带「警告」段与原文', () => {
    expect(html).toContain('class="notes warnings"')
    expect(html).toContain('堆峰值来自首轮分配')
  })

  it('markdown 侧同样带两段（两种格式共用同一份附加段数据）', () => {
    expect(markdown).toContain('**错误**:')
    expect(markdown).toContain('**警告**:')
    expect(markdown).toContain('数据集配置无效：stateKeys 须为正整数')
    expect(markdown).toContain('堆峰值来自首轮分配')
  })

  it('HTML 里的附加段条数与 markdown 一致', () => {
    const htmlItems = (html.match(/<li>数据集配置无效|<li>堆峰值来自首轮分配/g) ?? []).length
    const mdItems = (markdown.match(/- 数据集配置无效|- 堆峰值来自首轮分配/g) ?? []).length
    expect(htmlItems).toBe(2)
    expect(mdItems).toBe(htmlItems)
  })

  it('附加段文本走 HTML 转义，不成为注入点', () => {
    const injected = ResultBuilder.createErrorResult('inject', 10, new Error('<script>alert("x")</script> 与 "引号" & 与 <标签>'), 'small')
    const injectedHtml = reporter.generate(makeReport([injected]), 'html')
    expect(injectedHtml).not.toContain('<script>alert')
    expect(injectedHtml).toContain('&lt;script&gt;')
    expect(injectedHtml).toContain('&quot;')
    expect(injectedHtml).toContain('&amp;')
  })

  it('没有附加段时不产出空的 notes 容器', () => {
    const clean = ResultBuilder.createResult({ scenario: 'clean', iterations: 10, timeStats: ResultBuilder.emptyTimeStats() })
    expect(reporter.generate(makeReport([clean]), 'html')).not.toContain('class="notes')
  })
})
