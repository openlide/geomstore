/**
 * @geomstore/benchmark - 报告生成器
 */

import type { BenchmarkReport, BenchmarkResult } from './types'
import { benchmarkUtils } from './utils'

/**
 * 报告格式
 */
export type ReportFormat = 'markdown' | 'json' | 'html'

/**
 * 基准测试报告生成器
 */
export class BenchmarkReporter {
  /**
   * 生成报告
   */
  generate(report: BenchmarkReport, format: ReportFormat = 'markdown'): string {
    switch (format) {
      case 'json':
        return this.generateJson(report)
      case 'html':
        return this.generateHtml(report)
      default:
        return this.generateMarkdown(report)
    }
  }

  /**
   * 生成 Markdown 报告
   */
  generateMarkdown(report: BenchmarkReport): string {
    const lines: string[] = []

    lines.push('# GeomStore 基准测试报告\n')
    lines.push(`**生成时间**: ${report.metadata.timestamp}`)
    lines.push(`**版本**: ${report.metadata.version}`)
    lines.push(`**Node.js**: ${report.metadata.nodeVersion}`)
    lines.push(`**平台**: ${report.metadata.platform}\n`)

    lines.push('## 概览\n')
    lines.push(`| 指标 | 值 |`)
    lines.push(`|------|-----|`)
    lines.push(`| 总场景数 | ${report.summary.totalScenarios} |`)
    lines.push(`| 通过场景 | ${report.summary.passedScenarios} |`)
    lines.push(`| 失败场景 | ${report.summary.failedScenarios} |`)
    lines.push(`| 总耗时 | ${report.summary.totalDuration.toFixed(2)}s |`)
    lines.push(`| 总内存增量 | ${benchmarkUtils.formatBytes(report.summary.totalMemoryUsage)} |\n`)

    lines.push('## 详细结果\n')
    for (const result of report.results) {
      lines.push(this.formatResultMarkdown(result))
    }

    lines.push('## 建议\n')
    for (const rec of report.recommendations) {
      lines.push(`- ${rec}`)
    }

    return lines.join('\n')
  }

  private formatResultMarkdown(result: BenchmarkResult): string {
    const lines: string[] = []
    const status = result.passed ? '✅' : '❌'

    lines.push(`### ${status} ${result.scenario}\n`)
    lines.push(`- **迭代次数**: ${result.iterations}`)
    lines.push(`- **数据集规模**: ${result.datasetSize}`)
    lines.push(`- **平均耗时**: ${benchmarkUtils.formatTime(result.results.executionTime.avg)}`)
    lines.push(`- **P99 耗时**: ${benchmarkUtils.formatTime(result.results.executionTime.p99)}`)
    lines.push(`- **吞吐量**: ${benchmarkUtils.formatNumber(result.results.throughput.opsPerSecond)} ops/s`)
    lines.push(`- **内存增量**: ${benchmarkUtils.formatBytes(result.results.memory.delta)}`)

    if (result.results.cache.enabled) {
      lines.push(`- **缓存命中率**: ${result.results.cache.hitRate.toFixed(2)}%`)
    }

    if (result.warnings?.length) {
      lines.push(`\n**警告**:`)
      for (const w of result.warnings) {
        lines.push(`  - ${w}`)
      }
    }

    if (result.errors?.length) {
      lines.push(`\n**错误**:`)
      for (const e of result.errors) {
        lines.push(`  - ${e}`)
      }
    }

    lines.push('')
    return lines.join('\n')
  }

  /**
   * 生成 JSON 报告
   */
  generateJson(report: BenchmarkReport): string {
    return JSON.stringify(report, null, 2)
  }

  /**
   * 生成 HTML 报告
   */
  generateHtml(report: BenchmarkReport): string {
    const resultsHtml = report.results
      .map((r) => {
        const statusClass = r.passed ? 'passed' : 'failed'
        const statusIcon = r.passed ? '✅' : '❌'

        return `
        <div class="result ${statusClass}">
          <h3>${statusIcon} ${r.scenario}</h3>
          <div class="metrics">
            <div class="metric">
              <span class="label">迭代次数</span>
              <span class="value">${r.iterations}</span>
            </div>
            <div class="metric">
              <span class="label">平均耗时</span>
              <span class="value">${benchmarkUtils.formatTime(r.results.executionTime.avg)}</span>
            </div>
            <div class="metric">
              <span class="label">吞吐量</span>
              <span class="value">${benchmarkUtils.formatNumber(r.results.throughput.opsPerSecond)} ops/s</span>
            </div>
            <div class="metric">
              <span class="label">内存增量</span>
              <span class="value">${benchmarkUtils.formatBytes(r.results.memory.delta)}</span>
            </div>
          </div>
        </div>`
      })
      .join('\n')

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GeomStore 基准测试报告</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; }
    h1 { color: #333; }
    .summary { background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .summary table { width: 100%; border-collapse: collapse; }
    .summary td, .summary th { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
    .result { background: #fff; border: 1px solid #eee; border-radius: 8px; padding: 20px; margin: 15px 0; }
    .result.passed { border-left: 4px solid #4caf50; }
    .result.failed { border-left: 4px solid #f44336; }
    .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin-top: 15px; }
    .metric { background: #f9f9f9; padding: 10px; border-radius: 4px; }
    .metric .label { display: block; color: #666; font-size: 12px; }
    .metric .value { display: block; font-size: 18px; font-weight: bold; color: #333; }
    .recommendations { background: #e3f2fd; padding: 20px; border-radius: 8px; margin-top: 20px; }
    .recommendations li { margin: 10px 0; }
  </style>
</head>
<body>
  <h1>GeomStore 基准测试报告</h1>
  <p>生成时间: ${report.metadata.timestamp} | Node.js: ${report.metadata.nodeVersion} | 平台: ${report.metadata.platform}</p>
  
  <div class="summary">
    <h2>概览</h2>
    <table>
      <tr><td>总场景数</td><td>${report.summary.totalScenarios}</td></tr>
      <tr><td>通过场景</td><td>${report.summary.passedScenarios}</td></tr>
      <tr><td>失败场景</td><td>${report.summary.failedScenarios}</td></tr>
      <tr><td>总耗时</td><td>${report.summary.totalDuration.toFixed(2)}s</td></tr>
      <tr><td>总内存增量</td><td>${benchmarkUtils.formatBytes(report.summary.totalMemoryUsage)}</td></tr>
    </table>
  </div>

  <h2>详细结果</h2>
  ${resultsHtml}

  <div class="recommendations">
    <h2>建议</h2>
    <ul>
      ${report.recommendations.map((r) => `<li>${r}</li>`).join('\n')}
    </ul>
  </div>
</body>
</html>`
  }
}

export const benchmarkReporter = new BenchmarkReporter()
