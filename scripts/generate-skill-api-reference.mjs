#!/usr/bin/env node
/**
 * 生成 skill 的 API 参考：dist/**\/*.d.ts → .codebuddy/skills/geomstore/references/api.md
 *
 * 背景：GeomStore 会被独立安装到其他小程序项目使用，那边只有 node_modules/@openlide/geomstore：
 * 仓库的 docs/ 与 src/ 均不存在（docs/ 不在 package.json 的 files 中，不随包发布）。因此跨项目
 * 唯一"随版本发布且必然一致"的 API 依据是包内 dist/**\/*.d.ts。手写一份 API 参考必然随时间漂移
 * （本脚本替换掉的旧版就停留在 v0.2.0），故改为脚本生成：内容全部取自类型声明，不含手写描述。
 *
 * 不能直接打印入口 .d.ts 的内容：dist/index.d.ts 只有一行 `export * from './core/index.js'`。
 * 这里用 TypeScript 编译 API 解析每个入口的导出符号（含 `export *` 链），取回真实声明的原文
 * （getFullText 会带上该声明前导的 JSDoc 注释）。
 *
 * 用法（先构建，确保 dist 与当前源码一致）：
 *   pnpm build && pnpm skill:api
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const OUT_FILE = path.join(root, '.codebuddy/skills/geomstore/references/api.md')

/** 这些入口的符号已在别处展开，只列符号名，避免产出重复膨胀 */
const NAME_ONLY = new Set(['./core', './extras'])

/** 收集 exports 中声明了 types 的子路径（跳过 ./package.json） */
function collectEntries() {
  const entries = []
  for (const [sub, value] of Object.entries(pkg.exports ?? {})) {
    if (sub === './package.json') continue
    if (!value || typeof value !== 'object' || !value.types) continue
    entries.push({ sub, types: value.types })
  }
  // '.' 置顶，其余按子路径字典序（extras/* 自然聚在一起）
  entries.sort((a, b) => (a.sub === '.' ? -1 : b.sub === '.' ? 1 : a.sub.localeCompare(b.sub)))
  return entries
}

/** 去掉公共缩进与首尾空白，保留 JSDoc 与声明原文 */
function dedent(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const indents = lines.filter((line) => line.trim()).map((line) => line.match(/^[ \t]*/)[0].length)
  const min = indents.length > 0 ? Math.min(...indents) : 0
  return lines.map((line) => line.slice(min)).join('\n').trim()
}

function main() {
  const entries = collectEntries()
  if (entries.length === 0) {
    console.error('[skill-api] package.json 的 exports 中没有带 types 的子路径')
    process.exit(1)
  }

  const entryFiles = entries.map((entry) => path.join(root, entry.types))
  const missing = entries.filter((entry, index) => !existsSync(entryFiles[index]))
  if (missing.length > 0) {
    console.error(`[skill-api] 缺少类型声明文件，请先执行 pnpm build：${missing.map((m) => m.types).join(', ')}`)
    process.exit(1)
  }

  const program = ts.createProgram(entryFiles, {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
    noEmit: true,
    types: [],
  })
  const checker = program.getTypeChecker()

  /** 沿别名解析到真实声明 */
  function getDeclaration(symbol) {
    let target = symbol
    if (target.flags & ts.SymbolFlags.Alias) {
      try {
        target = checker.getAliasedSymbol(target)
      } catch {
        /* 解析失败则退回别名自身 */
      }
    }
    return target.declarations?.[0] ?? target.valueDeclaration
  }

  const sections = []
  let totalSymbols = 0

  for (const entry of entries) {
    const sourceFile = program.getSourceFile(path.join(root, entry.types))
    const moduleSymbol = sourceFile ? checker.getSymbolAtLocation(sourceFile) : undefined
    const symbols = moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : []

    const resolved = symbols
      .map((symbol) => ({ name: symbol.getName(), declaration: getDeclaration(symbol) }))
      .filter((item) => item.declaration)
      .sort((a, b) => a.name.localeCompare(b.name))
    totalSymbols += resolved.length

    const lines = [`## \`${entry.sub}\``, '', `> 类型声明：\`${entry.types}\``, '']

    if (resolved.length === 0) {
      lines.push('（无导出）', '')
    } else if (NAME_ONLY.has(entry.sub)) {
      lines.push('符号清单（详细声明见对应子入口）：', '')
      for (const item of resolved) lines.push(`- \`${item.name}\``)
      lines.push('')
    } else {
      for (const item of resolved) {
        lines.push(`### \`${item.name}\``, '', '```ts', dedent(item.declaration.getFullText()), '```', '')
      }
    }

    sections.push(lines.join('\n'))
  }

  const header = [
    '# GeomStore API 参考（自动生成）',
    '',
    '> **本文件由 `scripts/generate-skill-api-reference.mjs` 从 `dist/**/*.d.ts` 生成，请勿手工编辑。**',
    '>',
    `> - 来源版本：\`${pkg.name}@${pkg.version}\``,
    '> - 内容来源：构建产物类型声明（`dist/**/*.d.ts`，随 npm 包发布，与安装版本必然一致）',
    '> - 重新生成：`pnpm build && pnpm skill:api`',
    '>',
    '> 使用规则与快速上手见同目录 [`../SKILL.md`](../SKILL.md)；默认值、语义契约与易误用点见仓库 `docs/API.md`（不随包发布，仅仓库内可见）。',
    '>',
    '> **文件较大，请按符号名检索（例：`rg -n \'^### `createSelector`\' references/api.md`），不要整篇读取。**',
    '',
    '## 入口一览',
    '',
    '| 引入路径 | 类型声明 | 展开方式 |',
    '| --- | --- | --- |',
    ...entries.map(
      (entry) => `| \`${entry.sub}\` | \`${entry.types}\` | ${NAME_ONLY.has(entry.sub) ? '仅符号名' : '完整声明'} |`,
    ),
    '',
    '---',
    '',
    '',
  ].join('\n')

  const output = `${header}${sections.join('\n---\n\n')}`
  writeFileSync(OUT_FILE, output, 'utf8')

  const relative = path.relative(root, OUT_FILE).split(path.sep).join('/')
  console.log(
    `[skill-api] ${pkg.name}@${pkg.version} → ${relative}（${entries.length} 个入口 / ${totalSymbols} 个符号 / ${output.length} 字符）`,
  )
}

main()
