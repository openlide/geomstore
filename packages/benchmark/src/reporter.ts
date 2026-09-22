/**
 * @geomstore/benchmark - 报告生成器
 */

import type { BenchmarkReport, BenchmarkResult } from './types/index.js'
import { benchmarkUtils } from './utils.js'

/**
 * 报告格式
 */
export type ReportFormat = 'markdown' | 'json' | 'html'

/**
 * HTML 文本转义
 *
 * 场景名、建议文案与 metadata 来自配置或运行时环境，未转义直接拼进模板即为
 * HTML 注入点（`<script>` 或破坏结构）。数值字段无需转义。
 */
function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 报告渲染行：取值与格式化在此完成，两种格式只负责各自的标记语法 */
interface ReportRow {
  label: string
  value: string
}

/**
 * 概览指标
 *
 * markdown 与 HTML 共用同一份行数据，否则两边各自拼一遍就会开始漂移。
 */
function toSummaryRows(report: BenchmarkReport): ReportRow[] {
  return [
    { label: '总场景数', value: String(report.summary.totalScenarios) },
    { label: '通过场景', value: String(report.summary.passedScenarios) },
    { label: '失败场景', value: String(report.summary.failedScenarios) },
    { label: '总耗时', value: `${report.summary.totalDuration.toFixed(2)}s` },
    { label: '总内存增量', value: benchmarkUtils.formatBytes(report.summary.totalMemoryUsage) },
  ]
}

/**
 * 单场景指标（含只在缓存启用时出现的命中率行）
 */
function toMetricRows(result: BenchmarkResult): ReportRow[] {
  const rows: ReportRow[] = [
    { label: '迭代次数', value: String(result.iterations) },
    { label: '数据集规模', value: result.datasetSize },
    { label: '平均耗时', value: benchmarkUtils.formatTime(result.results.executionTime.avg) },
    { label: 'P99 耗时', value: benchmarkUtils.formatTime(result.results.executionTime.p99) },
    { label: '吞吐量', value: `${benchmarkUtils.formatNumber(result.results.throughput.opsPerSecond)} ops/s` },
    { label: '内存增量', value: benchmarkUtils.formatBytes(result.results.memory.delta) },
  ]

  if (result.results.cache.enabled) {
    rows.push({ label: '缓存命中率', value: `${result.results.cache.hitRate.toFixed(2)}%` })
  }

  return rows
}

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
      case 'markdown':
        return this.generateMarkdown(report)
      default:
        // 静默降级成 markdown 会让 'Markdown' / 'csv' 这类拼写错误伪装成一份正常报告；
        // 格式常来自未类型化的配置，编译器拦不住，只能在此显式失败
        throw new TypeError(`不支持的报告格式: ${String(format)}（可选值：markdown / json / html）`)
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
    for (const row of toSummaryRows(report)) {
      lines.push(`| ${row.label} | ${row.value} |`)
    }
    lines.push('')

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
    for (const row of toMetricRows(result)) {
      lines.push(`- **${row.label}**: ${row.value}`)
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
        const metricsHtml = toMetricRows(r)
          .map((row) => `            <div class="metric">
              <span class="label">${row.label}</span>
              <span class="value">${escapeHtml(row.value)}</span>
            </div>`)
          .join('\n')

        return `
        <div class="result ${statusClass}">
          <h3>${statusIcon} ${escapeHtml(r.scenario)}</h3>
          <div class="metrics">
${metricsHtml}
          </div>
        </div>`
      })
      .join('\n')

    const summaryHtml = toSummaryRows(report)
      .map((row) => `      <tr><td>${row.label}</td><td>${escapeHtml(row.value)}</td></tr>`)
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
  <p>生成时间: ${escapeHtml(report.metadata.timestamp)} | Node.js: ${escapeHtml(report.metadata.nodeVersion)} | 平台: ${escapeHtml(report.metadata.platform)}</p>
  
  <div class="summary">
    <h2>概览</h2>
    <table>
${summaryHtml}
    </table>
  </div>

  <h2>详细结果</h2>
  ${resultsHtml}

  <div class="recommendations">
    <h2>建议</h2>
    <ul>
      ${report.recommendations.map((r) => `<li>${escapeHtml(r)}</li>`).join('\n')}
    </ul>
  </div>
</body>
</html>`
  }
}

export const benchmarkReporter = new BenchmarkReporter()
