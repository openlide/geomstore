#!/usr/bin/env node
/**
 * 生成 skill 的 API 参考（按入口拆分）：dist/**\/*.d.ts → .codebuddy/skills/geomstore/references/api/
 *
 * 背景：GeomStore 会被独立安装到其他小程序项目使用，那边只有 node_modules/@openlide/geomstore：
 * 仓库的 docs/ 与 src/ 均不存在（docs/ 不在 package.json 的 files 中，不随包发布）。因此跨项目
 * 唯一"随版本发布且必然一致"的 API 依据是包内 dist/**\/*.d.ts。手写一份 API 参考必然随时间漂移
 * （本脚本替换掉的旧版就停留在 v0.2.0），故改为脚本生成：内容全部取自类型声明，不含手写描述。
 *
 * 为什么按入口拆分：整体导出展开后约 230 KB / 8000 行，一次读入代价过高且难以定位。拆分后
 * 索引（index.md）给出入口一览，使用时只加载所需入口的文件，实现渐进加载。
 *
 * 不能直接打印入口 .d.ts 的内容：dist/index.d.ts 只有一行 `export * from './core/index.js'`。
 * 这里用 TypeScript 编译 API 解析每个入口的导出符号（含 `export *` 链），取回真实声明的原文
 * （getFullText 会带上该声明前导的 JSDoc 注释）。重载函数会列出全部重载签名，不会只输出第一个。
 *
 * 用法（先构建，确保 dist 与当前源码一致）：
 *   pnpm build && pnpm skill:api
 *
 * 产出目录由脚本独占：每次生成会先清空其中的 .md，并删除历史单文件版本 references/api.md。
 *
 * 失败即中止、不动输出：入口 .d.ts 解析不通、某个入口一个符号都没解析出来、或
 * 清单与 exports 不一致（NAME_ONLY 引用了已不存在的入口、两个入口映射到同一个输出
 * 文件名）时，以退出码 1 结束并在清空输出目录**之前**返回——宁可留着上一版正确的参考，
 * 也不产出一份「看起来成功、实则缺项」的 API 文档（跨项目唯一 API 依据就是它）。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const OUT_DIR = path.join(root, '.codebuddy/skills/geomstore/references/api')
const LEGACY_FILE = path.join(root, '.codebuddy/skills/geomstore/references/api.md')

/**
 * 这些入口的符号已在别处展开，只列符号名，避免产出重复膨胀。
 * 聚合入口无法从 exports 机械推导（哪些算「已在别处展开」是文档决策），所以这里保持
 * 手工清单，但由 validateEntries() 在每次运行时对着 exports 校验：入口被改名/删除后
 * 本清单不会静默失效，新增聚合入口被漏配时也只需在此加一项。
 */
const NAME_ONLY = new Set(['./core', './extras'])

/** 子路径 → 文件名：'.' 为 main，其余去掉 './' 并把 '/' 换成 '-' */
function toFileName(sub) {
  if (sub === '.') return 'main.md'
  return `${sub.replace(/^\.\//, '').replace(/\//g, '-')}.md`
}

/** 收集 exports 中声明了 types 的子路径（跳过 ./package.json） */
function collectEntries() {
  const entries = []
  for (const [sub, value] of Object.entries(pkg.exports ?? {})) {
    if (sub === './package.json') continue
    if (!value || typeof value !== 'object' || !value.types) continue
    entries.push({ sub, types: value.types, file: toFileName(sub) })
  }
  // '.' 置顶，其余按子路径（与区域设置无关的比较，保证跨机器产出可复现）
  entries.sort((a, b) => (a.sub === '.' ? -1 : b.sub === '.' ? 1 : a.sub < b.sub ? -1 : a.sub > b.sub ? 1 : 0))
  return entries
}

/** 清单一致性校验：NAME_ONLY 与文件名映射都依赖 exports 的当前形状，漂移必须在产出前失败 */
function validateEntries(entries) {
  const problems = []

  const subs = new Set(entries.map((entry) => entry.sub))
  for (const sub of NAME_ONLY) {
    if (!subs.has(sub)) {
      problems.push(`NAME_ONLY 中的入口 \`${sub}\` 已不在 package.json 的 exports 里（入口改名/删除后此清单会静默失效）`)
    }
  }

  // toFileName 不是单射：'./a/b' 与 './a-b' 同名，必须显式失败而不是让后写的覆盖前写的
  const byFile = new Map()
  for (const entry of entries) {
    byFile.set(entry.file, [...(byFile.get(entry.file) ?? []), entry.sub])
  }
  for (const [file, subsWithSameFile] of byFile) {
    if (subsWithSameFile.length > 1) {
      problems.push(
        `入口 ${subsWithSameFile.map((sub) => `\`${sub}\``).join(' 与 ')} 的输出文件名同为 \`${file}\`，会互相覆盖`,
      )
    }
  }

  return problems
}

/** 去掉公共缩进与首尾空白，保留 JSDoc 与声明原文 */
function dedent(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const indents = lines.filter((line) => line.trim()).map((line) => line.match(/^[ \t]*/)[0].length)
  const min = indents.length > 0 ? Math.min(...indents) : 0
  return lines.map((line) => line.slice(min)).join('\n').trim()
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`
}

function main() {
  const entries = collectEntries()
  if (entries.length === 0) {
    console.error('[skill-api] package.json 的 exports 中没有带 types 的子路径')
    process.exit(1)
  }
  const listProblems = validateEntries(entries)
  if (listProblems.length > 0) {
    console.error(`[skill-api] 中止（清单与 exports 不一致，未改动已有产出）：\n  ${listProblems.join('\n  ')}`)
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
    // 必须保持 true：dist/types/global.d.ts 里有 `declare global`，关掉会连带检查
    // 全部被引用的 .d.ts（含 @types/node 缺席导致的噪音）而误报。
    // 代价是 .d.ts 内部的类型错误不会被诊断出来——那一层由「零导出即中止」兜住。
    skipLibCheck: true,
    noEmit: true,
    types: [],
  })
  const checker = program.getTypeChecker()

  /** 诊断必须被消费：此前一次都没读过 diagnostics，破损输入也会「成功」产出 */
  function collectProblems() {
    const problems = []
    const describe = (kind, d) =>
      `${kind} TS${d.code} @ ${d.file ? path.relative(root, d.file.fileName) : '(全局)'}：${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`
    for (const file of entryFiles) {
      const sourceFile = program.getSourceFile(file)
      if (!sourceFile) {
        problems.push(`入口源文件未被程序接收：${path.relative(root, file)}`)
        continue
      }
      for (const d of program.getSyntacticDiagnostics(sourceFile)) problems.push(describe('[语法]', d))
      for (const d of program.getSemanticDiagnostics(sourceFile)) problems.push(describe('[语义]', d))
    }
    return problems
  }

  /** 沿别名解析到真实声明，返回该符号的**全部**声明（重载函数有多个签名） */
  function getDeclarations(symbol) {
    let target = symbol
    if (target.flags & ts.SymbolFlags.Alias) {
      try {
        target = checker.getAliasedSymbol(target)
      } catch (error) {
        // 不静默退回别名自身：那会让 `export * from` 链断掉的入口产出一份
        // 「只有再导出语句、没有真实声明」的参考，看起来完全正常却缺内容
        console.error(`[skill-api] getAliasedSymbol 失败，符号：${symbol.getName()}：`, error)
        throw error
      }
    }
    const declared = target.declarations ?? []
    const all = declared.length > 0 ? declared : target.valueDeclaration ? [target.valueDeclaration] : []
    return [...new Set(all)]
  }

  /** 展开每个入口的导出符号 */
  const resolvedEntries = entries.map((entry) => {
    const sourceFile = program.getSourceFile(path.join(root, entry.types))
    const moduleSymbol = sourceFile ? checker.getSymbolAtLocation(sourceFile) : undefined
    const symbols = moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : []
    const items = symbols
      .map((symbol) => ({ name: symbol.getName(), declarations: getDeclarations(symbol) }))
      .filter((item) => item.declarations.length > 0)
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    return { ...entry, items, undeclared: symbols.length - items.length }
  })

  // 校验前置于清空：此时输出目录还是上一版的正确产物
  const problems = collectProblems()
  const warnings = []
  for (const entry of resolvedEntries) {
    if (entry.items.length === 0) {
      problems.push(`入口 \`${entry.sub}\`（${entry.types}）未解析出任何可导出的符号`)
    } else if (entry.undeclared > 0) {
      // 单个符号没有声明可以输出（例如仅由外部模块再导出）不足以判定整份输入不可信
      warnings.push(`入口 \`${entry.sub}\` 有 ${entry.undeclared} 个符号没有可输出的声明，已跳过`)
    }
  }
  if (problems.length > 0) {
    console.error(`[skill-api] 中止（输入不可信，未改动已有产出）：\n  ${problems.join('\n  ')}`)
    process.exit(1)
  }
  for (const warning of warnings) console.warn(`[skill-api] WARN: ${warning}`)

  // 目录由脚本独占：清掉历史 .md 与单文件版本，避免改名/删除入口后留下孤儿文件
  mkdirSync(OUT_DIR, { recursive: true })
  for (const name of readdirSync(OUT_DIR)) {
    if (name.endsWith('.md')) rmSync(path.join(OUT_DIR, name))
  }
  if (existsSync(LEGACY_FILE)) rmSync(LEGACY_FILE)

  const totalSymbols = resolvedEntries.reduce((sum, entry) => sum + entry.items.length, 0)
  const header = (title, extra) =>
    [
      `# ${title}`,
      '',
      '> **本文件由 `scripts/generate-skill-api-reference.mjs` 从 `dist/**/*.d.ts` 生成，请勿手工编辑。**',
      '>',
      `> - 来源版本：\`${pkg.name}@${pkg.version}\``,
      '> - 内容来源：构建产物类型声明（随 npm 包发布，与安装版本必然一致）',
      '> - 重新生成：`pnpm build && pnpm skill:api`',
      ...extra,
      '',
    ].join('\n')

  // 索引
  const indexRows = resolvedEntries.map(
    (entry) =>
      `| \`${entry.sub}\` | ${NAME_ONLY.has(entry.sub) ? '仅符号名' : '完整声明'} | ${entry.items.length} | [\`${entry.file}\`](./${entry.file}) |`,
  )
  const index = [
    header('# GeomStore API 参考（按入口拆分，自动生成）', [
      '> - 使用规则与快速上手见 [`../../SKILL.md`](../../SKILL.md)',
      '> - 默认值、语义契约与易误用点见仓库 `docs/API.md`（不随包发布，仅仓库内可见）',
    ]),
    '## 入口一览',
    '',
    '按需打开所需入口的文件即可（渐进加载，不必读整个目录）：',
    '',
    '| 引入路径 | 展开方式 | 符号数 | 文件 |',
    '| --- | --- | --- | --- |',
    ...indexRows,
    '',
    '### 检索方式',
    '',
    '不确定某个符号属于哪个入口时，直接搜目录：',
    '',
    '```bash',
    "rg -n 'createSelector' references/api/          # 找出定义位置与所在入口",
    "rg -n '^### `createSnapshot`' references/api/   # 精确定位某个符号的完整声明",
    '```',
    '',
    '`./core` 与 `./extras` 是 `.` 及其子入口的聚合/别名，为避免重复只列符号名；完整声明请看对应入口文件。',
    '',
  ].join('\n')
  writeFileSync(path.join(OUT_DIR, 'index.md'), index, 'utf8')

  // 每个入口一个文件
  const summary = [`${resolvedEntries.length} 个入口 / ${totalSymbols} 个符号 → ${path.relative(root, OUT_DIR).split(path.sep).join('/')}/`]
  for (const entry of resolvedEntries) {
    const lines = [
      header(`\`${entry.sub}\` API 参考（自动生成）`, [
        `> - 引入路径：\`${entry.sub}\``,
        `> - 类型声明：\`${entry.types}\``,
        '> - 返回索引：[`index.md`](./index.md)',
      ]),
    ]

    // 此处不再需要「（无导出）」分支：零导出的入口在上面就已经中止，
    // 保留那个占位文案等于给破损输入留一条「看起来正常」的出路
    if (NAME_ONLY.has(entry.sub)) {
      lines.push('符号清单（详细声明见对应子入口文件）：', '')
      for (const item of entry.items) lines.push(`- \`${item.name}\``)
      lines.push('')
    } else {
      for (const item of entry.items) {
        const body = item.declarations.map((declaration) => dedent(declaration.getFullText())).join('\n\n')
        lines.push(`### \`${item.name}\``, '', '```ts', body, '```', '')
      }
    }

    const target = path.join(OUT_DIR, entry.file)
    writeFileSync(target, lines.join('\n'), 'utf8')
    summary.push(`  ${entry.file.padEnd(24)} ${String(entry.items.length).padStart(3)} 符号  ${kb(statSync(target).size)}`)
  }

  console.log(`[skill-api] ${pkg.name}@${pkg.version}`)
  for (const line of summary) console.log(`[skill-api] ${line}`)
}

main()
