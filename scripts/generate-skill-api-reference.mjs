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
 * 产出目录由脚本独占：每次生成会先清空其中的 .md 文件（同名**目录**只报不删），
 * 并删除历史单文件版本 references/api.md。`index.md` 是脚本保留名，入口映射到它会被
 * validateEntries 直接拒绝。
 *
 * 失败即中止、不动输出：入口 .d.ts 解析不通或诊断报错（程序按 skipLibCheck:false 建，
 * 否则 .d.ts 的语义诊断恒为空）、某个入口一个符号都没解析出来、或清单与 exports 不一致
 * （NAME_ONLY 引用了已不存在的入口、types 不是字符串路径、两个入口映射到同一个输出文件名、
 * 有入口撞上脚本保留名）时，以退出码 1 结束并在清空输出目录**之前**返回——宁可留着上一版
 * 正确的参考，也不产出一份「看起来成功、实则缺项」的 API 文档（跨项目唯一 API 依据就是它）。
 * 全部文件内容都在清空之前备齐，清空之后只剩「把内存里的字符串写出去」这一步；
 * 那一步再失败（磁盘满一类）就只能重跑一次，脚本不做临时目录换名。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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

/**
 * 脚本自己占用的输出文件名。入口一旦被映射到这些名字上，就会把索引（以及索引里
 * 每一条指向各入口文件的链接）整份覆盖掉，而且不报错，所以 validateEntries 必须拒绝。
 */
const RESERVED_FILES = new Set(['index.md'])

/** 子路径 → 文件名：'.' 为 main，其余去掉 './' 并把 '/' 换成 '-' */
function toFileName(sub) {
  if (sub === '.') return 'main.md'
  return `${sub.replace(/^\.\//, '').replace(/\//g, '-')}.md`
}

/**
 * 收集 exports 中声明了 types 的子路径（跳过 ./package.json）。
 *
 * types 必须是**一条字符串路径**。条件式 exports（`"types": {"import": …, "require": …}`）
 * 同样过得了 `!value.types` 这道真值判断，然后一个对象被交给 path.join 只会得到
 * 「Path must be a string」这条内部错误，或者一条拼出来的假路径；而整个缺 types 的入口
 * 会被静默跳过，等于对外少一份 API 依据还不吭声。两种都在产出前点名失败。
 */
function collectEntries() {
  const entries = []
  const problems = []
  for (const [sub, value] of Object.entries(pkg.exports ?? {})) {
    if (sub === './package.json') continue
    if (!value || typeof value !== 'object') {
      problems.push(`入口 \`${sub}\` 不是导出对象，读不到 types 字段`)
      continue
    }
    if (typeof value.types !== 'string' || value.types === '') {
      const actual = value.types && typeof value.types === 'object' ? '条件式 types 对象' : String(value.types)
      problems.push(
        `入口 \`${sub}\` 没有字符串形式的 types（实际是 ${actual}）：本脚本按「一个入口一份 .d.ts」建模，` +
          '不支持条件式 types，请先在 exports 里给出唯一的 types 路径',
      )
      continue
    }
    entries.push({ sub, types: value.types, file: toFileName(sub) })
  }
  // '.' 置顶，其余按子路径（与区域设置无关的比较，保证跨机器产出可复现）
  entries.sort((a, b) => (a.sub === '.' ? -1 : b.sub === '.' ? 1 : a.sub < b.sub ? -1 : a.sub > b.sub ? 1 : 0))
  return { entries, problems }
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

  // 索引由脚本独占写入，且写在各入口文件**之前**：入口映射到 index.md 就会把索引
  // 连同所有指向它的链接一起静默销毁，正是这条校验要拦的那类失败
  for (const entry of entries) {
    if (RESERVED_FILES.has(entry.file)) {
      problems.push(`入口 \`${entry.sub}\` 的输出文件名 \`${entry.file}\` 是脚本保留名（会被索引/其它脚本产物覆盖）`)
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
  const { entries, problems: shapeProblems } = collectEntries()
  const listProblems = [...shapeProblems, ...validateEntries(entries)]
  if (entries.length === 0 && listProblems.length === 0) {
    console.error('[skill-api] package.json 的 exports 中没有带 types 的子路径')
    process.exit(1)
  }
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
    // 必须关掉：skipLibCheck:true 会让 getSemanticDiagnostics 对**任何** .d.ts 直接返回空表，
    // 而这里每个入口都是 .d.ts，那条 [语义] 收集就永远是死代码（一份「还能导出点东西、
    // 但类型已经对不上」的声明文件会顺利生成参考）。代价是被引用的第三方 .d.ts 也一并受检，
    // 但诊断只按入口文件取（见 collectProblems），别人家的噪音不会算到这里头上。
    // 实测：真 dist 的 11 个入口在 skipLibCheck:false 下诊断为空，产出与改前逐字节一致。
    skipLibCheck: false,
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
    header('GeomStore API 参考（按入口拆分，自动生成）', [
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
    '`./core` 与 `./extras` 是 `.` 及其子入口的聚合/别名，为避免重复只列符号名；完整声明请看对应入口文件。',
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
  ].join('\n')

  // 先把**全部**内容备在内存里，才允许动输出目录：清空是破坏性动作，而它后面还跟着
  // 一长串 writeFileSync，任何一次抛错（ENOSPC / 权限变化）都会留下「上一版已删、
  // 这一版没写出来」的输出目录。声明文本的取用（getFullText）与体积（直接量内存里
  // 那份字符串的字节数，不再 writeFileSync + statSync）同样前置，不开第二扇窗口。
  const documents = [{ name: 'index.md', text: index }]
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

    const text = lines.join('\n')
    documents.push({ name: entry.file, text })
    summary.push(`  ${entry.file.padEnd(24)} ${String(entry.items.length).padStart(3)} 符号  ${kb(Buffer.byteLength(text))}`)
  }

  // 目录由脚本独占：清掉历史 .md 与单文件版本，避免改名/删除入口后留下孤儿文件。
  // withFileTypes + force:true 都是必要的：默认的 rmSync 会在「条目刚被外部删掉」时抛错，
  // 也会把名字撞 .md 的目录当文件 unlink 而抛错，两种都会把清空动作打断在半路，
  // 留下一个既不是上一版也不是这一版的输出目录。目录只报不删（本脚本只写文件，
  // 撞名目录里装的一定是别人的东西）。
  mkdirSync(OUT_DIR, { recursive: true })
  const strayDirs = []
  for (const dirent of readdirSync(OUT_DIR, { withFileTypes: true })) {
    if (!dirent.name.endsWith('.md')) continue
    if (!dirent.isFile()) {
      strayDirs.push(dirent.name)
      continue
    }
    rmSync(path.join(OUT_DIR, dirent.name), { force: true })
  }
  if (existsSync(LEGACY_FILE)) rmSync(LEGACY_FILE, { force: true })

  for (const { name, text } of documents) writeFileSync(path.join(OUT_DIR, name), text, 'utf8')

  for (const name of strayDirs) {
    console.warn(`[skill-api] WARN: 输出目录下有个叫 \`${name}\` 的**目录**，本脚本只写文件、不会递归删它，请人工确认`)
  }
  console.log(`[skill-api] ${pkg.name}@${pkg.version}`)
  for (const line of summary) console.log(`[skill-api] ${line}`)
}

main()
