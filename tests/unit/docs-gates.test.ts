/**
 * 文档门禁：把此前全靠人工同步的文档声明反查到事实来源。
 *
 * 背景（本轮文档重构的产出）：仓库有 11 篇手写 md，同一条行为契约曾在 4–9 处各写一份，
 * 且已出现真实漂移（`docs/CONCEPTS.md` 写 `cacheConfig.enableStats`「按需开启」，而
 * `src/core/store/Store.ts` 是 `?? true`，`docs/GUIDE.md` 还专门反驳过这句）。版本号四处
 * 同步已有 `r6-f1-02` 钉住，但模块数、子路径清单、覆盖率阈值、链接可达性、标题层级、
 * 重复行这些全靠人工，漏改不会让任何一条既有门禁变红。
 *
 * 本用例把其中**机械可判**的部分固化下来。设计取舍：
 * - 判据一律反查事实来源（package.json / jest.config.js / 实际产物 / 实际目录），
 *   不设白名单、不做基线冻结——新增文档或新增子路径时不需要改本文件。
 * - `references/api/**` 是 `pnpm skill:api` 的生成物，其正确性由「与 `.d.ts` 一致」这条
 *   更强的性质保证，故排除在「文件内无重复行」之外（同一句 JSDoc 在多个重载里合法重复）。
 * - 只严格匹配真正的 `import` / `require` 指令来判子路径合法性，因此散文里提到的
 *   `node_modules/@openlide/geomstore/dist/` 下类型声明（包内路径）与错误示范的标题占位
 *   都不会误报，不需要为它们开例外。
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const repoRoot = path.resolve(__dirname, '../..')
const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), 'utf8')

/** 收集全部手写与生成的 md（相对仓库根，正斜杠） */
function collectMarkdown(): string[] {
  const files: string[] = ['README.md', 'CONTRIBUTING.md']
  for (const f of readdirSync(path.join(repoRoot, 'docs'))) if (f.endsWith('.md')) files.push(`docs/${f}`)
  const walk = (dir: string): void => {
    for (const e of readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
      const p = `${dir}/${e.name}`
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.md')) files.push(p)
    }
  }
  walk('.codebuddy/skills/geomstore')
  return [...new Set(files)]
}

const mdFiles = collectMarkdown()
/** 工作树是 CRLF；`split('\n')` 后必须先剥 `\r`，否则标题正则与行尾比较全部失真 */
const linesOf = (rel: string): string[] =>
  read(rel)
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
const GENERATED_API = /^\.codebuddy\/skills\/geomstore\/references\/api\//

/** GitHub 风格的锚点：小写、去反引号、删除非「字母/数字/空格/-/_」的字符、空格转 `-` */
function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-')
}

/** 取一个 md 文件里全部标题生成的锚点集合（跳过代码围栏内的伪标题） */
function anchorsOf(rel: string): Set<string> {
  const set = new Set<string>()
  let inFence = false
  for (const line of linesOf(rel)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const m = /^#{1,6}\s+(.*)$/.exec(line)
    if (m) set.add(slug(m[1]))
  }
  return set
}

const pkg = JSON.parse(read('package.json')) as {
  // version 是 G16 的事实来源之一（CHANGELOG 的最新发布节要与它一致）
  version: string
  exports: Record<string, unknown>
  files: string[]
}
/** 公开子路径：除 `./package.json` 之外的全部 exports 键 */
const exportKeys = Object.keys(pkg.exports).filter((k) => k !== './package.json')
const subOf = (key: string): string => (key === '.' ? '' : key.replace(/^\.\//, ''))
/** 老式解析器用的转发目录（`pnpm stubs` 生成，随包发布） */
const stubDirs = pkg.files.filter((x) => !x.includes('.') && x !== 'dist' && x !== 'dist-weapp')

/** 统计某个仓库根相对目录下的文件数；walk 一律收「仓库根相对路径」，避免二次拼接 */
function countIn(relDir: string, accept: (name: string) => boolean, recursive = true): number {
  const abs = path.join(repoRoot, relDir)
  if (!existsSync(abs)) return -1
  let n = 0
  const walk = (rel: string): void => {
    for (const e of readdirSync(path.join(repoRoot, rel), { withFileTypes: true })) {
      const child = path.join(rel, e.name)
      if (e.isDirectory()) {
        if (recursive) walk(child)
      } else if (accept(e.name)) n += 1
    }
  }
  walk(relDir)
  return n
}

const countJs = (relDir: string): number => countIn(relDir, (name) => name.endsWith('.js'))
const countSrcModules = (): number => countIn('src', (name) => name.endsWith('.ts') && !name.endsWith('.d.ts'))

/**
 * `src/**` 下的实现模块（仓库根相对路径、正斜杠），不含 `.d.ts`。
 *
 * 排除 `.d.ts` 是防御性的：当前仓库一个都没有，真出现也只会是手写声明、
 * 描述的是类型面而非可执行模块图。
 *
 * G18 与 G19 都要遍历它：前者在源码的 JSDoc `@example` 里找被教给用户的 import 路径，
 * 后者拿它建引用图。注意 `src/types/**` 是普通 `.ts`、**在**图里——G19 刻意放行
 * core → types（公共契约集中一处是设计意图，见该门禁的注释），挡的是 core → extras
 * 与 core → plugins。
 */
const srcTsFiles: string[] = (() => {
  const out: string[] = []
  const walk = (relDir: string): void => {
    for (const e of readdirSync(path.join(repoRoot, relDir), { withFileTypes: true })) {
      const rel = `${relDir}/${e.name}`
      if (e.isDirectory()) walk(rel)
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) out.push(rel)
    }
  }
  walk('src')
  return out.sort()
})()

/**
 * `src/**` 的模块引用图：`相对路径 → 它 import 的仓库内相对路径集合`。
 *
 * 解析用 TypeScript 的 AST（`ts.createSourceFile`，只要语法不要类型），不用正则：
 * 正则分不清 `import x from './a'`、动态 `import('./a')` 与 `export … from './a'`，
 * 也会被字符串字面量与注释里的同形文本骗到——而"core 不得依赖 extras"这条不变量
 * 一旦被绕过，门禁必须是真的红，不能是靠正则碰运气。
 *
 * 相对说明符按 NodeNext 的写法还原：源码写的是 `./x.js`，磁盘上是 `x.ts`；
 * 目录说明符落到该目录的 `index.ts`。解析不到就**不记边**（跨包的 specifier、
 * 以及写错的路径都不构成本仓库内部的依赖），但入口完整性由 G7 另行兜住。
 */
const srcImportGraph = (): Map<string, Set<string>> => {
  const graph = new Map<string, Set<string>>()
  for (const rel of srcTsFiles) {
    const sf = ts.createSourceFile(path.join(repoRoot, rel), read(rel), ts.ScriptTarget.ESNext, /* setParentNodes */ false)
    const specs: string[] = []
    const visit = (node: ts.Node): void => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        specs.push(node.moduleSpecifier.text)
      } else if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length === 1 &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        specs.push(node.arguments[0].text)
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)

    const deps = new Set<string>()
    const addResolved = (dir: string, base: string): void => {
      for (const cand of [`${dir}/${base}.ts`, `${dir}/${base}/index.ts`]) {
        if (existsSync(path.join(repoRoot, cand))) {
          // 必须 posix 归一：`../../extras/snapshot.js` 从 src/core/store 拼出来是
          // `src/core/store/../../extras/snapshot.ts`，existsSync 会替我们解析掉 `..`，
          // 但存进图里的若是不归一的原串，G19 的 `startsWith('src/extras/')` 就永远判不中
          // —— 门禁会在真有人违反分层时静默放行。变异测试实测过这条。
          deps.add(path.posix.normalize(cand))
          break
        }
      }
    }
    for (const spec of specs) {
      // tsconfig 的 `@/*` 别名映射到 `src/*`（jest 的 moduleNameMapper 同一口径），
      // tsc 会放行这种写法。不解析它，core 里写 `from '@/extras/…'` 就能绕过分层判据
      // —— 本门禁存在的意义正是抓主动违规，所以别名必须与相对路径同权解析。
      if (spec.startsWith('@/')) {
        addResolved('src', spec.slice(2).replace(/\.js$/, ''))
        continue
      }
      if (!spec.startsWith('.')) continue
      addResolved(path.posix.dirname(rel), spec.replace(/^\.\//, '').replace(/\.js$/, ''))
    }
    graph.set(rel, deps)
  }
  return graph
}

describe('文档门禁 G1 / G2：标题结构', () => {
  it.each(mdFiles)('%s 只有一个 h1', (rel) => {
    let inFence = false
    const h1: number[] = []
    linesOf(rel).forEach((line, i) => {
      if (/^\s*```/.test(line)) inFence = !inFence
      else if (!inFence && /^#\s+\S/.test(line)) h1.push(i + 1)
    })
    expect(h1).toHaveLength(1)
  })

  it('任何 md 的首行标题都不会渲染成「# # …」（生成器拼标题的笔误形态）', () => {
    const offenders = mdFiles.filter((rel) => /^#\s+#/.test(read(rel)))
    expect(offenders).toEqual([])
  })
})

describe('文档门禁 G3 / G4：内容卫生', () => {
  // 表格行不限长度（一行即一条记录，重复必是缺陷）；bullet 取 ≥40 字，放过纯导航短指针。
  it.each(mdFiles.filter((rel) => !GENERATED_API.test(rel)))('%s 内没有逐字节重复的表格行 / bullet', (rel) => {
    const seen = new Map<string, number>()
    const dupes: string[] = []
    linesOf(rel).forEach((line, i) => {
      const t = line.trim()
      const isRow = /^\|/.test(t)
      const isBullet = /^[-*]\s/.test(t)
      if (!isRow && !isBullet) return
      if (isRow && /^\|[\s:-]+\|?$/.test(t)) return
      if (!isRow && t.length < 40) return
      const first = seen.get(t)
      if (first === undefined) seen.set(t, i + 1)
      else dupes.push(`第 ${first} 行与第 ${i + 1} 行`)
    })
    expect(dupes).toEqual([])
  })

  it('已发布文档里不留「等收口时填」的空占位', () => {
    const offenders: string[] = []
    for (const rel of mdFiles) {
      linesOf(rel).forEach((line, i) => {
        if (/<待填>|<TBD>|TODO:|FIXME:/.test(line)) offenders.push(`${rel}:${i + 1}`)
      })
    }
    expect(offenders).toEqual([])
  })
})

describe('文档门禁 G5：链接与锚点可达', () => {
  it('全库 md 的相对链接，文件都存在、锚点都能解析', () => {
    const cache = new Map<string, Set<string>>()
    const broken: string[] = []
    let checked = 0
    for (const rel of mdFiles) {
      const src = read(rel)
      const re = /\]\(([^)]+)\)/g
      let m: RegExpExecArray | null
      while ((m = re.exec(src)) !== null) {
        const raw = m[1].trim()
        if (/^(https?:|mailto:)/.test(raw)) continue
        const [filePart, frag] = raw.split('#')
        checked += 1
        const abs = filePart ? path.resolve(repoRoot, path.dirname(rel), filePart) : path.resolve(repoRoot, rel)
        if (filePart && !existsSync(abs)) {
          broken.push(`${rel} -> ${raw}（文件不存在）`)
          continue
        }
        if (!frag) continue
        if (!existsSync(abs) || statSync(abs).isDirectory()) continue
        const target = path.relative(repoRoot, abs).split(path.sep).join('/')
        if (!cache.has(target)) cache.set(target, anchorsOf(target))
        if (!cache.get(target)!.has(slug(decodeURIComponent(frag)))) broken.push(`${rel} -> ${raw}（锚点解析不到）`)
      }
    }
    // 先确认确实扫到了链接，否则「0 坏链」可能只是因为正则没匹配到任何东西
    expect(checked).toBeGreaterThan(100)
    expect(broken).toEqual([])
  })
})

describe('文档门禁 G6：子路径与 package.json 双向一致', () => {
  // 正向：文档教人 import 的每个子路径都必须存在
  it('文档里每个 import 的子路径都在 exports 或转发目录里', () => {
    const legal = new Set([...exportKeys.map(subOf), ...stubDirs])
    const re = /(?:from|require\()\s*['"]@openlide\/geomstore(?:\/([^'"]*))?['"]\)?/g
    const bad = new Set<string>()
    for (const rel of mdFiles) {
      const src = read(rel)
      let m: RegExpExecArray | null
      while ((m = re.exec(src)) !== null) {
        const sub = (m[1] ?? '').replace(/[.,;]+$/, '')
        if (sub.includes('*') || sub.includes('{')) continue // 聚合写法由反向半边覆盖
        if (!legal.has(sub)) bad.add(`@openlide/geomstore${sub ? `/${sub}` : ''}（${rel}）`)
      }
    }
    expect([...bad]).toEqual([])
  })

  // 反向：新增 exports 却忘了写文档，同样要变红。
  //
  // 判据从「字符串出现过」收紧到「**被教过**」：原来只查 corpus 里含不含
  // `@openlide/geomstore/<sub>`，于是一句「本版移除了 X」也能让计数 +1 而门禁放行——
  // 「被提及」与「被教过」之间那一维正是 compareSnapshots 那个缺陷的同形位置
  // （那里是「子路径存在」不等于「子路径里有那个名字」，这里是「提到子路径」不等于
  // 「教了怎么用它」）。收紧到两个可判的**教学信号**：
  //   ① 有 `from '@openlide/geomstore/<sub>'` 的 import 示范；
  //   ② 有以该子路径命名的专节（`##`~`####` 标题行里出现它）。
  // 主入口（`.`）不在此列：它是默认导入路径，满地都是，不构成「有没有文档」的证据。
  it('exports 声明的每个子路径都被教过（有 import 示范或自己的专节），而非仅被提及', () => {
    const corpus = mdFiles.map(read).join('\n')
    const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const notTaught = exportKeys.filter((k) => {
      const sub = subOf(k)
      if (sub === '') return false
      const spec = `@openlide/geomstore/${sub}`
      const hasImportExample = new RegExp(`from\\s+['"\`]${esc(spec)}['"\`]`).test(corpus)
      const hasOwnSection = new RegExp(`^#{2,4} .*${esc(sub)}`, 'm').test(corpus)
      return !hasImportExample && !hasOwnSection
    })
    expect(notTaught).toEqual([])
  })
})

/**
 * 文档门禁 G15：文档教的具名导入必须真的在出口面上
 *
 * 起因是一个已经发出去的真实缺陷：`docs/GUIDE.md` 教
 * `import { compareSnapshots } from '@openlide/geomstore/extras/snapshot'`，
 * 而这个名字从未出现在任何子路径的出口面（0.7.0 / 0.8.0 的实际导出都是
 * `SnapshotManager / createSnapshot / createSnapshotAsync / [default]`）——
 * 照文档写的代码拿不到它。G6 抓不到，因为那个子路径**确实存在**；缺的正是
 * 「子路径存在」与「子路径里有这个名字」之间的那一维。
 *
 * 判据一律反查事实来源，且取的是**真实出口面**而非某份快照：
 * - 子路径 → 源入口的映射走 package.json 的 `exports`（`./dist/a/b.js` → `src/a/b.ts`），
 *   与构建实际使用的映射同一条，不另立一张表；
 * - 导出名用 TypeScript checker 的 `getExportsOfModule` 取，能穿过 `export *`、
 *   也能取到**纯类型导出**（`export type { X }` 在运行时不存在，正则或动态 import 都取不到，
 *   而文档同样可能教 `import type { X }`）。为此付出约 0.8s 的建 program 成本，换两类都判得住；
 * - 不用 `pnpm skill:api` 的生成物当事实来源：它由 dist 派生，拿它校验文档等于
 *   「生成器若漏了某个名字，这道门禁也跟着一起漏」，形成自证。
 *
 * 覆盖 md 集合沿用 collectMarkdown（README / CONTRIBUTING / docs/** / skill 参考），
 * 因为同一类漂移在 README 的 6 条 import 上同样成立。
 */
describe('文档门禁 G15：文档里的具名导入对真实出口面', () => {
  /** 子路径（'' 表示主入口）→ 源入口文件的绝对路径 */
  const sourceEntryOf = (sub: string): string => {
    const key = sub === '' ? '.' : `./${sub}`
    const cond = pkg.exports[key]
    const target = typeof cond === 'string' ? cond : (cond as { default?: string } | undefined)?.default
    if (typeof target !== 'string') {
      // G6 已经钉住「文档里的子路径必须在 exports 里」，走到这里说明 exports 自身有洞
      throw new Error(`exports["${key}"] 的 default 不是字符串（实际 ${JSON.stringify(cond)}），无法定位源入口`)
    }
    const rel = target
      .replace(/^\.\//, '')
      .replace(/^dist\//, 'src/')
      .replace(/\.js$/, '.ts')
    const abs = path.join(repoRoot, rel)
    if (!existsSync(abs)) throw new Error(`exports["${key}"] 指向 ${target}，但推得的源入口 ${rel} 不存在`)
    return abs
  }

  /** 懒建一次 program：枚举 14 个入口也只建一次，模块级缓存给同文件的其它用例复用 */
  let checker: ts.TypeChecker | null = null
  let program: ts.Program | null = null
  const exportsOf = (sub: string): Set<string> => {
    if (!program || !checker) {
      const cfg = ts.readConfigFile(path.join(repoRoot, 'tsconfig.build.json'), ts.sys.readFile)
      if (cfg.error) throw new Error(`tsconfig.build.json 解析失败：${ts.flattenDiagnosticMessageText(cfg.error.messageText, ' ')}`)
      const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, repoRoot)
      const entries = exportKeys.map((k) => sourceEntryOf(subOf(k)))
      program = ts.createProgram(entries, { ...parsed.options, noEmit: true, skipLibCheck: true })
      checker = program.getTypeChecker()
    }
    const sf = program.getSourceFile(sourceEntryOf(sub))
    if (!sf) throw new Error(`源入口没进 program：${sourceEntryOf(sub)}`)
    const symbol = checker.getSymbolAtLocation(sf)
    if (!symbol) throw new Error(`源入口不是模块（拿不到 module symbol）：${sourceEntryOf(sub)}`)
    return new Set(checker.getExportsOfModule(symbol).map((s) => s.getName()))
  }

  /**
   * 出口面上每个名字的「值 / 纯类型」分类。
   *
   * 存在的理由：G15 判的是「这个名字在不在」，而 `export type { X }` 的 X **在运行时并不存在**。
   * 文档若用值语法（`import { X }`）去导一个纯类型，在 `verbatimModuleSyntax` /
   * `isolatedModules` 下消费方直接编译失败，在部分打包器下则变成运行期 undefined——
   * 两种都不会被「名字存在」这一维拦住。分类看的是符号解析后的 flags 里有没有值位。
   */
  const VALUE_FLAGS =
    ts.SymbolFlags.Function |
    ts.SymbolFlags.Class |
    ts.SymbolFlags.Enum |
    ts.SymbolFlags.EnumMember |
    ts.SymbolFlags.Variable |
    ts.SymbolFlags.BlockScopedVariable |
    ts.SymbolFlags.ValueModule |
    ts.SymbolFlags.Method |
    ts.SymbolFlags.GetAccessor |
    ts.SymbolFlags.SetAccessor |
    ts.SymbolFlags.Property

  const kindCache = new Map<string, Map<string, boolean>>()
  const isValueExport = (sub: string, name: string): boolean | undefined => {
    let kinds = kindCache.get(sub)
    if (!kinds) {
      if (!program || !checker) exportsOf(sub) // 触发懒建 program
      const sf = program!.getSourceFile(sourceEntryOf(sub))
      const symbol = sf ? checker!.getSymbolAtLocation(sf) : undefined
      if (!symbol) throw new Error(`源入口不是模块：${sourceEntryOf(sub)}`)
      kinds = new Map(
        checker!.getExportsOfModule(symbol).map((s) => {
          const target = s.flags & ts.SymbolFlags.Alias ? checker!.getAliasedSymbol(s) : s
          return [s.getName(), (target.flags & VALUE_FLAGS) !== 0] as const
        }),
      )
      kindCache.set(sub, kinds)
    }
    return kinds.get(name)
  }

  /**
   * 抓出「形如 import { … } from '@openlide/geomstore[/sub]'」的具名导入。
   * `[\s\S]*?` 而非 `[^}]*`：多行 import 声明在文档里是常态（prettier 会折行）。
   * 具名清单按逗号切、取 `as` 之前的原始名，并剥掉内联的 `type` 修饰——
   * 文档写 `import { type Foo }` 与 `import type { Foo }` 指的是同一个导出。
   *
   * 跳过 ```diff 围栏里以 `-` 开头的**删除侧**：那两处是「此前怎么写」的历史对照
   * （FAQ 的包体积一节、MIGRATION 的 0.4.0 下沉一节），按定义就不该在今天的出口面上。
   * `+` 侧是当前推荐写法，仍然要判——只豁免删除侧，不豁免整块围栏。
   */
  const collectDocImports = (): Array<{ file: string; sub: string; name: string; typeOnlySyntax: boolean }> => {
    const re = /import\s+(type\s+)?\{([\s\S]*?)\}\s*from\s*['"]@openlide\/geomstore((?:\/[^'"]*)?)['"]/g
    const found: Array<{ file: string; sub: string; name: string; typeOnlySyntax: boolean }> = []
    for (const file of mdFiles) {
      const src = read(file)
      let m: RegExpExecArray | null
      while ((m = re.exec(src)) !== null) {
        const lineStart = src.lastIndexOf('\n', m.index) + 1
        if (/^\s*-/.test(src.slice(lineStart))) continue
        const sub = m[3].replace(/^\//, '').replace(/[.,;)\]]+$/, '')
        for (const raw of m[2].split(',')) {
          const name = raw
            .trim()
            .replace(/^type\s+/, '')
            .split(/\s+as\s+/)[0]
            .trim()
          // 注释掉的行、占位符与聚合写法不是具名导入的断言对象
          if (name && /^[A-Za-z_$][\w$]*$/.test(name)) {
            // 「声明处写了 type」与「花括号内联写了 type」都算 type-only 语法
            found.push({ file, sub, name, typeOnlySyntax: Boolean(m[1]) || /^\s*type\s+/.test(raw) })
          }
        }
      }
    }
    return found
  }

  it('文档教的每个具名导入都在对应子路径的出口面上（值与类型都算）', () => {
    const imports = collectDocImports()
    // 没有抓到任何导入 = 正则失效了，那本身就是要变红的（否则本用例恒真通过）
    expect(imports.length).toBeGreaterThan(0)

    const surfaceCache = new Map<string, Set<string>>()
    const bad: string[] = []
    for (const item of imports) {
      let surface = surfaceCache.get(item.sub)
      if (!surface) {
        surface = exportsOf(item.sub)
        surfaceCache.set(item.sub, surface)
      }
      if (!surface.has(item.name)) bad.push(`${item.file}：\`${item.name}\` 不在 @openlide/geomstore${item.sub ? `/${item.sub}` : ''} 的出口面上`)
    }

    expect([...new Set(bad)]).toEqual([])
  })

  it('纯类型导出必须用 type-only 语法导入（值语法在 verbatimModuleSyntax 下编译失败）', () => {
    const bad: string[] = []
    for (const item of collectDocImports()) {
      if (item.typeOnlySyntax) continue
      if (isValueExport(item.sub, item.name) === false) {
        bad.push(`${item.file}：\`${item.name}\` 是纯类型导出，应写成 \`import type { ${item.name} }\`（或内联 \`type ${item.name}\`）`)
      }
    }
    expect([...new Set(bad)]).toEqual([])
  })

  it('分类口径本身有效：主入口的 Store（类）与 StoreConfig（纯类型）被判成不同种类', () => {
    // 两道分类断言若整体退化成「都 true」或「都 false」，上面的用例会恒真通过
    expect(isValueExport('', 'Store')).toBe(true)
    expect(isValueExport('', 'StoreConfig')).toBe(false)
  })

  it('抓取口径本身有效：GUIDE 那条具名 import 确实被解析到了（防止正则悄悄失效）', () => {
    const imports = collectDocImports()
    const guide = imports.filter((i) => i.file === 'docs/GUIDE.md' && i.sub === 'extras/snapshot')

    // 这条正是 G15 的起因：文档教它、它此前不在出口面上，修好后必须仍然被抓到（证明在判、不豁免）
    expect(guide.map((i) => i.name)).toEqual(expect.arrayContaining(['createSnapshot', 'compareSnapshots']))
  })

  it('每个 exports 子路径都能推得源入口（映射一旦断掉，上面两道会集体空转）', () => {
    const mapped = exportKeys.map((k) => sourceEntryOf(subOf(k)))

    expect(new Set(mapped).size).toBe(exportKeys.length)
  })
})

describe('文档门禁 G7 / G8 / G9 / G11：数字反查事实来源', () => {
  it('src 的非 .d.ts 模块数 = dist 的 js 数 = dist-weapp 的 js 数', () => {
    const srcN = countSrcModules()
    const distN = countJs('dist')
    const weappN = countJs('dist-weapp')
    expect({ srcN, distN, weappN, same: srcN === distN && distN === weappN && distN > 0 }).toEqual({
      srcN: expect.any(Number),
      distN: expect.any(Number),
      weappN: expect.any(Number),
      same: true,
    })
  })

  it('skill 的生成 API 参考不少于 12 篇（与 r6-f1-02 同口径）', () => {
    const dir = path.join(repoRoot, '.codebuddy/skills/geomstore/references/api')
    expect(readdirSync(dir).filter((f) => f.endsWith('.md')).length).toBeGreaterThanOrEqual(12)
  })

  it('文档里写「N 个子路径」的数量词都等于 exports 实际键数', () => {
    const offenders: string[] = []
    for (const rel of mdFiles) {
      if (GENERATED_API.test(rel)) continue
      const re = /(\d+)\s*个(?:公开)?子路径/g
      let m: RegExpExecArray | null
      while ((m = re.exec(read(rel))) !== null) {
        if (Number(m[1]) !== exportKeys.length) offenders.push(`${rel}: 写 ${m[1]}，实际 ${exportKeys.length}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('文档里写「N 个模块」的数量词都等于实际产物模块数', () => {
    const actual = new Set([countJs('dist'), countJs('dist-weapp'), countSrcModules()])
    const offenders: string[] = []
    for (const rel of mdFiles) {
      if (GENERATED_API.test(rel)) continue
      const re = /(\d+)\s*个(?:js|文件|模块)?模块/g
      let m: RegExpExecArray | null
      while ((m = re.exec(read(rel))) !== null) {
        if (!actual.has(Number(m[1]))) offenders.push(`${rel}: 写 ${m[1]} 个模块，实际 ${[...actual].join(' / ')}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('文档门禁 G10：覆盖率阈值只有一处事实来源', () => {
  const cfg = read('jest.config.js')

  it('jest.config.js 里能解析出 global 与单文件阈值', () => {
    const g = /coverageThreshold:\s*\{\s*global:\s*\{([^}]*)\}/.exec(cfg)
    expect(g).not.toBeNull()
    const pick = (k: string): number => Number(new RegExp(`${k}:\\s*(\\d+)`).exec(g![1])?.[1])
    const perFile = [...cfg.matchAll(/'\.\/src\/([^']+)':\s*\{([^}]*)\}/g)].map(([, glob, body]) => ({
      glob,
      branches: Number(/branches:\s*(\d+)/.exec(body)?.[1]),
    }))
    expect(pick('statements')).toBeGreaterThan(0)
    // 门禁值被写进 CONTRIBUTING 的那句依赖「单文件分支门槛只有一个值」这个前提
    expect([...new Set(perFile.map((x) => x.branches))]).toHaveLength(1)
  })

  it('CONTRIBUTING 面向人复述的阈值与 jest.config.js 一致', () => {
    const g = /coverageThreshold:\s*\{\s*global:\s*\{([^}]*)\}/.exec(cfg)!
    const pick = (k: string): number => Number(new RegExp(`${k}:\\s*(\\d+)`).exec(g[1])?.[1])
    const contrib = read('CONTRIBUTING.md')
    const m = /global 语句 \/ 函数 \/ 行 (\d+)、分支 (\d+)/.exec(contrib)
    expect(m).not.toBeNull()
    expect([Number(m![1]), Number(m![2])]).toEqual([pick('statements'), pick('branches')])
    // statements / functions / lines 三者同值，这句才允许被压成「语句 / 函数 / 行 N」
    expect(pick('functions')).toBe(pick('statements'))
    expect(pick('lines')).toBe(pick('statements'))
    const m2 = /单文件分支 (\d+) 下限/.exec(contrib)
    // 配置里 './src/core/**' 那一档的 branches 与注释同行隔开，必须用允许注释的体匹配
    const coreBody = /'\.\/src\/core\/\*\*':\s*\{([\s\S]*?)\}/.exec(cfg)
    const cfgBranchFloor = Number(/branches:\s*(\d+)/.exec(coreBody?.[1] ?? '')?.[1])
    expect(Number(m2?.[1])).toBe(cfgBranchFloor)
  })

  it('除 CONTRIBUTING 外的文档都不抄覆盖率百分比（抄了就必然漂移）', () => {
    const noCopy = mdFiles.filter((rel) => rel !== 'CONTRIBUTING.md' && !GENERATED_API.test(rel) && !rel.startsWith('CHANGELOG'))
    const offenders: string[] = []
    const re = /(?:语句|函数|行|分支|statements?|functions?|lines?|branches?)\D{0,6}(?:9[0-9]|8[0-9])\s*%/g
    for (const rel of noCopy) {
      const hits = read(rel).match(re)
      if (hits) offenders.push(`${rel}: ${hits.join(' / ')}`)
    }
    expect(offenders).toEqual([])
  })
})

describe('文档门禁 G13：表格必须可扫读', () => {
  // 表格是扫读用的；一个单元格里放 300+ 字，读者就得在表格里读散文，
  // 而那段论证本该是表下的一个注（本轮 C05 清出来的 12 处就是这么处理的）。
  const CELL_MAX = 300
  // 生成物不算：它逐字取自 .d.ts，长度不是排版选择
  const handwritten = mdFiles.filter((rel) => !GENERATED_API.test(rel))

  it.each(handwritten)('%s 没有承载长论证的单元格', (rel) => {
    const offenders: string[] = []
    linesOf(rel).forEach((line, i) => {
      const t = line.trim()
      if (!t.startsWith('|')) return
      t.split('|')
        .map((s) => s.trim())
        .slice(1, -1)
        .forEach((cell, ci) => {
          if (/^[\s:-]+$/.test(cell)) return // 表格分隔行的 ---
          if (cell.length > CELL_MAX) offenders.push(`第 ${i + 1} 行第 ${ci + 1} 列 ${cell.length} 字`)
        })
    })
    expect(offenders).toEqual([])
  })

  it('阈值 300 字确实卡在真实分布之上（防止把门禁调松）', () => {
    // 本轮清理后全库最长单元格应远低于阈值；若某天接近 300，说明又开始往表格里塞东西了
    let max = 0
    for (const rel of handwritten) {
      linesOf(rel).forEach((line) => {
        const t = line.trim()
        if (!t.startsWith('|')) return
        t.split('|')
          .map((s) => s.trim())
          .slice(1, -1)
          .forEach((cell) => {
            if (/^[\s:-]+$/.test(cell)) return
            if (cell.length > max) max = cell.length
          })
      })
    }
    expect(max).toBeLessThan(CELL_MAX)
    expect(max).toBeGreaterThan(0)
  })
})

describe('文档门禁 G14：换行符归一不回退', () => {
  // 仓库根 .gitattributes 用 `* text=auto eol=lf` 把仓库内与检出侧统一钉成 LF，
  // .prettierrc.json 因此可以直接判 endOfLine: lf。本用例守住这个前提：
  // 一旦有跟踪文件带回 CRLF，`pnpm format:check` 会在本地整批失败、且 `git diff`
  // 容易被批量脚本撑成「整个文件重写」。
  it('tracked 文件清单里不含任何 CR 字节', () => {
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' }).split('\0').filter(Boolean)
    expect(tracked.length).toBeGreaterThan(100)
    const offenders: string[] = []
    for (const f of tracked) {
      const abs = path.join(repoRoot, f)
      if (!existsSync(abs) || statSync(abs).isDirectory()) continue
      if (readFileSync(abs).includes(0x0d)) offenders.push(f)
    }
    expect(offenders).toEqual([])
  })

  it('.gitattributes 仍把检出侧钉成 LF，且 .prettierrc 与之呼应', () => {
    const attrs = read('.gitattributes')
    expect(attrs).toMatch(/^\*\s+text=auto\s+eol=lf\s*$/m)
    // 归一已落地，endOfLine 不该再退回 auto（退回就等于宣布本地判据与 CI 不一致）
    expect(read('.prettierrc.json')).toMatch(/"endOfLine":\s*"lf"/)
  })
})

describe('文档门禁 G12：ARCHITECTURE 的目录树与现实一致', () => {
  it('树里点名的每个 src/ 子目录都真实存在', () => {
    const src = read('docs/ARCHITECTURE.md')
    const block = /## 3\. 目录结构与职责[\s\S]*?```([^`]*)```/.exec(src)
    expect(block).not.toBeNull()
    const named = new Set<string>()
    for (const line of block![1].split('\n')) {
      const m = /^\s+([A-Za-z][\w-]*)\/(\s|$)/.exec(line.trimEnd())
      if (m) named.add(m[1])
    }
    expect(named.size).toBeGreaterThan(10)
    const real = new Set<string>()
    const walk = (rel: string): void => {
      for (const e of readdirSync(path.join(repoRoot, rel), { withFileTypes: true })) {
        if (!e.isDirectory()) continue
        real.add(e.name)
        walk(path.join(rel, e.name))
      }
    }
    walk('src')
    expect([...named].filter((d) => !real.has(d))).toEqual([])
  })

  it('目录树不写各目录的文件数与行数（这类计数保证会随拆分失真）', () => {
    const src = read('docs/ARCHITECTURE.md')
    const block = /## 3\. 目录结构与职责[\s\S]*?```([^`]*)```/.exec(src)![1]
    expect(block).not.toMatch(/\d+\s*(文件|行)/)
  })

  /**
   * 「Store 门面的职责分工」表点名的每个协作者文件都必须真实存在。
   *
   * 与上面「目录树点名的子目录」同一类判据、同一份理由：那张树是导航入口，
   * 这张表是「改某个语义该动哪个文件」的导航入口，两者都会随拆分失真，而失真后的
   * 代价是**照着一条不存在的路径去找实现**。协作者改名或挪目录时这张表必须跟着改，
   * 判据就取「表里写的路径在磁盘上有没有」。
   *
   * 只取表内第一列的反引号路径（`` `core/store/ActionManager.ts` `` 形状）：
   * 第二、三列写的是方法名与语义描述，不是路径，混进来会全是噪声。
   */
  it('Store 职责分工表点名的每个协作者文件都真实存在', () => {
    const section = /### Store 门面的职责分工[\s\S]*?(?=\n#{2,3} |\n```|$)/.exec(read('docs/ARCHITECTURE.md'))
    expect(section).not.toBeNull()
    const paths = new Set([...section![0].matchAll(/`(core\/[A-Za-z][\w/.-]*\.ts)`/g)].map((m) => `src/${m[1]}`))
    // 表本身退化成一个字面量都没有时，这条判据会恒真通过——先确认它真抓到了东西
    expect(paths.size).toBeGreaterThanOrEqual(8)
    expect([...paths].filter((p) => !existsSync(path.join(repoRoot, p)))).toEqual([])
  })
})

/**
 * 文档门禁 G16：CHANGELOG 的发布节与链接区
 *
 * 起因是一个**实测过的**漏检：版本号在 CONTRIBUTING 的发版清单里被列为「散在四处」，
 * 而 r6-f1-02 只钉了其中三处（package.json ↔ hot-update ↔ SKILL.md ×3 ↔ 生成物），
 * **CHANGELOG 完全不在任何测试的阅读范围内**。实测把四处版本 + 12 份生成物全部改成
 * 0.9.0、CHANGELOG 故意停在 0.8.1，版本门禁 4 条与文档门禁 68 条全绿——发版说明就这么
 * 漏出去，没有任何东西会红。链接区同理：`[Unreleased]` 的 compare 基准与新版本的
 * release 链接都是手工维护，漏一条也不变红。
 *
 * 唯一的放行形态：`[Unreleased]` 里有**实质内容**（不是「暂无…」占位）时，
 * 允许 package.json 领先于最新已发布节——那是「下一版正在写」的正常开发态。
 * 按本仓库现行流程（版本在发版提交里 bump，如 ae83b4d / 5ffe8a0）这个分支平时不会命中，
 * 留着是为了不给「提前 bump、先写 notes」的合理做法判死。
 */
describe('文档门禁 G16：CHANGELOG 与 package.json 同源', () => {
  // 工作树 CRLF/LF 都有过，matchAll 用的 ^ $ 必须按 \n 断行，否则整节都匹配不上
  const changelog = read('CHANGELOG.md').replace(/\r\n/g, '\n')
  const released = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/gm)].map((m) => m[1])
  const linkEntries = new Set([...changelog.matchAll(/^\[(\d+\.\d+\.\d+)\]: \S+$/gm)].map((m) => m[1]))
  /**
   * git tag 是「这个版本真的存在过 tag」的事实来源。
   *
   * 为什么不用「每个已发布节都要有链接」这条更直白的判据：CHANGELOG 里的 0.3.0 / 0.4.0
   * 两节**在仓库里没有对应 tag**（tag 序列从 v0.2.1 直接跳到 v0.5.0）。给它们补链接等于
   * 编一个可能 404 的地址，而事后补打历史 tag 属于改写仓库历史、不在本门禁射程内。
   * 故判据取「**有 tag 的**发布节要有链接」，外加反向的「每个 tag 都要有链接」——
   * 后者能抓住新版本打了 tag 却忘了写链接区这种真遗漏。
   */
  const gitTags = new Set(
    execFileSync('git', ['tag'], { cwd: repoRoot, encoding: 'utf8' })
      .split('\n')
      .map((t) => t.trim().replace(/^v/, ''))
      .filter(Boolean),
  )
  /** `[Unreleased]` 到下一个 `## ` 之间的正文；空 / 只有「暂无…」占位视为无实质内容 */
  const unreleasedBody = (() => {
    const m = /## \[Unreleased\]\n([\s\S]*?)\n## /.exec(changelog)
    const body = (m?.[1] ?? '').trim()
    return /^暂无[^\n]*$/.test(body) ? '' : body
  })()

  it('CHANGELOG 至少有一个已发布节（否则整套判据都在空集上跑）', () => {
    expect(released.length).toBeGreaterThan(0)
  })

  it('有 tag 的已发布节都有链接条目，且每个 tag 都有链接条目', () => {
    const expected = new Set([...released.filter((v) => gitTags.has(v)), ...gitTags])
    expect([...expected].filter((v) => !linkEntries.has(v))).toEqual([])
  })

  it('最新已发布节 = package.json 版本（除非 [Unreleased] 已有实质内容，即下一版正在写）', () => {
    if (unreleasedBody) return // 开发态：notes 已写、版本已提前 bump
    expect(released[0]).toBe(pkg.version)
  })

  it('[Unreleased] 的 compare 基准 = 最新已发布版本', () => {
    const base = /^\[Unreleased\]: \S*\/compare\/v?(\d+\.\d+\.\d+)\.\.\.HEAD$/m.exec(changelog)
    if (!base) throw new Error('CHANGELOG 的 [Unreleased] 链接区缺失或形状变了（应为 compare/vX.Y.Z...HEAD），请同步本用例')
    expect(base[1]).toBe(released[0])
  })

  it('已发布节按版本倒序（新节置顶，CONTRIBUTING 的发版清单要求倒序置顶）', () => {
    const sorted = [...released].sort((a, b) => {
      const pa = a.split('.').map(Number)
      const pb = b.split('.').map(Number)
      return pb[0] - pa[0] || pb[1] - pa[1] || pb[2] - pa[2]
    })
    expect(released).toEqual(sorted)
  })

  it('[Unreleased] 节不带发布日期（带日期即表示它已发布，语义与发布节重复）', () => {
    expect(changelog).not.toMatch(/^## \[Unreleased\] - /m)
  })
})

/**
 * 文档门禁 G17：错误码与钩子名对源码
 *
 * 与 G15 同一类盲区的另外两个实例：**封闭的字符串清单**（`ErrorCode` 的 21 个成员、
 * `HookName` 的 9 个字面量）此前没有任何门禁与文档对齐。两边都极易漂：
 * 源码里改个枚举名或加个钩子，文档照旧，读者照着敲 `ErrorCode.XXX` 得到 undefined。
 *
 * 判据两侧都做，方向不同、误报率也不同：
 * - **正向**（文档 → 源码）：文档里出现的 `ErrorCode.XXX` 必须是真成员。
 *   形态唯一（探针确认全库只此一种引用写法），零误报。
 * - **反向**（源码 → 文档）：每个钩子名都必须出现在文档里。小集合、全字面量匹配，
 *   「加了钩子忘了写文档」当场变红；反向不做错误码是因为 21 个错误码里有一部分是
 *   内部实现细节、文档不必逐个列，强行要求会把门禁逼成清单复制。
 * 两个方向都直接从 AST 取（enum 成员 / 字面量联合的类型成员），不靠正则猜源码。
 */
describe('文档门禁 G17：错误码与钩子名对源码', () => {
  const srcFiles = execFileSync('git', ['ls-files', 'src'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .filter((f) => f.endsWith('.ts'))
  const corpus = mdFiles.map(read).join('\n')

  /** 从 AST 取 `enum X { A = ..., B = ... }` 的成员名 */
  const enumMembers = (source: string, enumName: string): string[] => {
    const out: string[] = []
    // 闭合行带缩进（源码里是 ` }`），不能要求顶格。
    // 反斜杠必须双写：模板字符串在**字符串层**就把 `\s` 吃成 `s`（JS 里它不是合法转义），
    // 单写得到的正则是 `exports+enums+…`，永远匹配不上——正则字面量没这问题，模板字符串有
    const re = new RegExp(`export\\s+enum\\s+${enumName}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`, 'm')
    const body = re.exec(source)?.[1]
    if (!body) throw new RegExp(`找不到 enum ${enumName}，锚点变了请同步本用例`)
    for (const line of body.split('\n')) {
      const m = /^\s*([A-Z][A-Z0-9_]*)\s*=/.exec(line)
      if (m) out.push(m[1])
    }
    return out
  }

  /** 从 AST 取 `type X = 'a' | 'b'` 的字面量成员 */
  const unionLiterals = (source: string, aliasName: string): string[] => {
    const re = new RegExp(`export\\s+type\\s+${aliasName}\\s*=([\\s\\S]*?)(?:\\n\\n|\\n/\\*\\*|\\nexport)`, 'm')
    const body = re.exec(source)?.[1]
    if (!body) throw new RegExp(`找不到 type ${aliasName}，锚点变了请同步本用例`)
    return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1])
  }

  const errorSrc = srcFiles.map((f) => read(f)).find((s) => /export enum ErrorCode/.test(s)) ?? ''
  const pluginSrc = srcFiles.map((f) => read(f)).find((s) => /export type HookName/.test(s)) ?? ''
  const errorCodes = enumMembers(errorSrc, 'ErrorCode')
  const hookNames = unionLiterals(pluginSrc, 'HookName')

  it('枚举 / 联合都取到了非空成员（取空会让下面两道恒真通过）', () => {
    expect({ errorCodes: errorCodes.length, hookNames: hookNames.length }).toEqual({
      errorCodes: expect.any(Number),
      hookNames: expect.any(Number),
    })
    expect(errorCodes.length).toBeGreaterThan(10)
    expect(hookNames.length).toBeGreaterThan(5)
  })

  it('文档里引用的每个 ErrorCode.XXX 都是真成员', () => {
    const known = new Set(errorCodes)
    const bad = new Set<string>()
    for (const file of mdFiles) {
      for (const line of read(file).split('\n')) {
        if (/^\s*-/.test(line)) continue // diff 删除侧是历史写法
        for (const m of line.matchAll(/ErrorCode\.([A-Z][A-Z0-9_]+)/g)) {
          if (!known.has(m[1])) bad.add(`${file}：ErrorCode.${m[1]}`)
        }
      }
    }
    expect([...bad]).toEqual([])
  })

  it('每个钩子名都在文档里出现过（加了钩子忘了写文档会变红）', () => {
    const missing = hookNames.filter((h) => !corpus.includes(h))
    expect(missing).toEqual([])
  })
})

/**
 * 文档门禁 G18：源码 JSDoc 里教给用户的 import 路径
 *
 * 起因是一个**已经躺在源码里**的缺陷。`src/plugins/devtools/timeTravelPlugin.ts`、
 * `src/plugins/performance/analyzerPlugin.ts` 与 `src/plugins/performance/index.ts`
 * 的 `@example` 教的是 `@geomstore/core` / `@geomstore/plugins` / `@geomstore/plugins/performance`——
 * **包名 scope 还是改名前的 `@geomstore`，子路径也不在 `exports` 里**。照抄直接
 * `ERR_MODULE_NOT_FOUND`。
 *
 * 真正的盲区不是这三行，而是**它们能活下来这件事**：G6 与 G15 都只遍历 `mdFiles`
 * （`collectMarkdown` 收集 README / CONTRIBUTING / docs/** / skill 参考），
 * 而 `src/**` 的 JSDoc `@example` 从来不在任何判据的阅读范围内。实测 `src/**` 里有
 * 22 处以包名书写的 import 示例，此前一处都没被校验过——漏出三处失效路径是必然结果，
 * 不是偶然。
 *
 * 判据与 G6 同源同口径：合法子路径 = `exports` 的键 ∪ 转发目录（`stubDirs`）。
 * 另加 G6 没有的一维——**包名 scope 本身**。`@geomstore/*` 不是"子路径不存在"，
 * 它是"包名都写错了"，两种错法要给出两种可读的诊断，否则后来人只会照着改子路径、
 * 留下一个仍然装不上的 scope。
 *
 * `@module` 只校验**带包名 scope** 的那几条：仓库里绝大多数 `@module` 是内部标识符
 * （`@module cache/types`、`@module plugins/WxStorageBackend`），拿 exports 去判它们
 * 会把 30 条正确的内部标注全判成错。只盯 `@` 开头的，是把判据对准"会被用户照抄"的那一类。
 */
describe('文档门禁 G18：源码 JSDoc 里的 import 路径', () => {
  const legal = new Set([...exportKeys.map(subOf), ...stubDirs])

  it('src JSDoc 教给用户的 import 示例都指向真实子路径，且用的是当前包名', () => {
    const bad = new Set<string>()
    let seen = 0
    for (const rel of srcTsFiles) {
      const src = read(rel)
      // 与 G6 同一条正则形态，只是把语料从 md 换成 src；旧 scope 单独一组。
      // 动词锚必须含 `import(`：extras 的文档把动态 `await import('…')` 当作"按需加载、
      // 不进主包"的推荐写法在教（src/extras/index.ts / enterprise.ts 就各有一处），
      // 只认 from/require 会让这种形态的失效子路径静默放行（变异测试实测过）。
      for (const m of src.matchAll(/(?:from|require\(|import\()\s*['"]@(openlide\/)?geomstore(?:\/([^'"]*))?['"]\)?/g)) {
        seen += 1
        const where = `${rel}:${src.slice(0, m.index).split('\n').length}`
        if (!m[1]) {
          bad.add(`${where} 用了改名前的包名 scope @geomstore（应为 @openlide/geomstore）`)
          continue
        }
        const sub = (m[2] ?? '').replace(/[.,;)\]]+$/, '')
        if (sub.includes('*') || sub.includes('{')) continue // 聚合写法不是子路径断言
        if (!legal.has(sub)) bad.add(`${where} 教了 @openlide/geomstore${sub ? `/${sub}` : ''}，该子路径不存在`)
      }
      // @module 只看带包名 scope 的；裸内部标识符（@module cache/types）不参与判定
      for (const m of src.matchAll(/@module\s+@(openlide\/)?geomstore(?:\/(\S*))?/g)) {
        seen += 1
        const where = `${rel}:${src.slice(0, m.index).split('\n').length}`
        if (!m[1]) {
          bad.add(`${where} 的 @module 用了改名前的包名 scope @geomstore`)
          continue
        }
        const sub = (m[2] ?? '').replace(/[.,;:!?)\]。、：；（）]+$/, '')
        if (!legal.has(sub)) bad.add(`${where} 的 @module 指向 @openlide/geomstore${sub ? `/${sub}` : ''}，该子路径不存在`)
      }
    }
    // 一处都没抓到 = 正则失效了，否则本用例恒真通过（与 G15 的抓取自检同一动机）
    expect({ seen, offenders: [...bad] }).toEqual({ seen: expect.any(Number), offenders: [] })
    expect(seen).toBeGreaterThan(5)
  })
})

/**
 * 文档门禁 G19：ARCHITECTURE 的分层不变量对真实引用图
 *
 * `docs/ARCHITECTURE.md` 与 `CONTRIBUTING.md` 都把「`extras/*` 的实现不得被核心反向依赖」
 * 写成硬约束，`docs/ARCHITECTURE.md` 的「体积模型」整节又建立在它之上（主入口闭包
 * 不含 extras，是分层换来体积分层的前提）。但这条约束此前**只存在于文字里**：
 * 谁在 `core/store` 里 `import` 一个 `extras/*`，没有任何东西会变红。
 *
 * 这与 G12 同一类：ARCHITECTURE 声明的树状结构由门禁反查现实，声明的依赖方向也该如此。
 * 判据走 `srcImportGraph()`（TypeScript AST，不用正则），方向取 `core/**` 的**出边**——
 * 「不得依赖」是出边性质，反向遍历只会把同一件事判反。
 *
 * 只判 `core → 可选能力实现`。可选能力的实现面是**两个目录**：`src/extras/**` 之外，
 * `src/plugins/**` 也是——`plugins/performance` 与 `plugins/devtools` 正是
 * `extras/performance`、`extras/plugins` 的实现（`src/plugins/index.ts` 自述其对外
 * 发布路径就是后者），core 依赖它们同样会让主入口闭包含进可选能力。
 * `core → types` 是设计意图（公共契约集中一处）故放行；`extras/*` 之间「尽量不互相
 * 依赖」是取舍建议而非规则；`index.ts → integrations` 也是（主入口本就导出小程序集成）。
 * 把这些也判死只会逼出例外名单，而例外名单是漂移的温床。
 */
describe('文档门禁 G19：core 不得依赖可选能力实现（extras 与 plugins）', () => {
  /** core 不得依赖的实现目录；`src/plugins/**` 与 `src/extras/**` 同属可选能力实现面 */
  const FORBIDDEN = ['src/extras/', 'src/plugins/']

  it('core/** 的出边里没有 extras/** 与 plugins/**', () => {
    const graph = srcImportGraph()
    const violations: string[] = []
    for (const [from, deps] of graph) {
      if (!from.startsWith('src/core/')) continue
      for (const to of deps) {
        for (const dir of FORBIDDEN) {
          if (to.startsWith(dir)) violations.push(`${from} → ${to}`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('引用图本身建起来了（core 与 extras 都有模块，且 core 的出边非空）', () => {
    const graph = srcImportGraph()
    const core = [...graph.keys()].filter((f) => f.startsWith('src/core/'))
    const extras = [...graph.keys()].filter((f) => f.startsWith('src/extras/'))
    // 这道自检防的是"图建空了，上面那道恒真通过"——与 G15 抓取自检同一动机
    expect(core.length).toBeGreaterThan(20)
    expect(extras.length).toBeGreaterThan(20)
    expect([...graph.values()].filter((d) => d.size > 0).length).toBeGreaterThan(20)
  })
})

/**
 * 文档门禁 G20：SKILL.md「只装了 npm 包」一节与真实发布面一致
 *
 * 起因是一个已经发出去、且**没有任何门禁会红**的错误：那一节原写
 * 「同目录的 `CHANGELOG.md` 与包根 `README.md`（两者都在 `files` 白名单 /
 * npm 无条件补发的清单里）」。本包随后把 `CHANGELOG.md` 移出了 `files`，
 * 那句话变假——而 SKILL.md 恰恰是在 `collectMarkdown()` 的范围内
 * （G5 链接锚点、G6 子路径、G10 覆盖率、G3/G4 占位符全都管它），
 * **唯独没有一条问「你说使用者能拿到的这个东西，真的在包里吗」**。
 *
 * 判据取真实发布面：跑 `npm pack --dry-run` 拿文件清单，逐行核对该节里的
 * 路径声明。极性按行判定——行内出现「不存在 / 不在 / 没有 / 查不到 / 不随 /
 * 不带」之一，该行的路径都必须是**缺席**的；否则都是**在场**的。
 * 同一行的路径共享极性是一条成文契约：要在一行里同时说"有"和"没有"，
 * 拆成两行（这也是本仓库其它文档的既有写法）。
 *
 * 两条设计取舍：
 * - **用 `--ignore-scripts`**：prepack 会生成 14 个转发 stub 目录并在 postpack
 *   清掉，跑带脚本的 pack 会在测试期间短暂改动工作树（与并行 worker 读仓库打架），
 *   且 npm 在 `--dry-run` 下确实会跑 postpack、事后干净但过程不干净。
 *   代价是**stub 目录量不到**（清单 319 而非 333）。本节不声称任何 stub 目录，
 *   故不受影响；真要在这里提 stub，那是另一类声明（`files` 白名单而非打包结果），
 *   由 `generate-subpath-stubs.mjs` 的白名单校验负责。
 * - **只认行首反引号里的路径 token**，且必须带 `/` 或已知扩展名（md/json/ts/js/mjs/cjs），
 *   于是 `exports` / `files` 这类 package.json 字段名不会被误当成路径。白名单外的
 *   扩展名会被跳过——这是一处已知的假阴性面：未来若该节声明了 `.wxs` 之类的新类型
 *   且名字写错，本门禁不会红。
 */
describe('文档门禁 G20：SKILL.md 的 npm-only 一节与真实发布面一致', () => {
  const PACKAGE_NAME = '@openlide/geomstore'
  const SECTION = '### 3）在其他小程序项目内'
  const SKILL_REL = '.codebuddy/skills/geomstore/SKILL.md'

  const packFiles = (): string[] => {
    const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
    const json = JSON.parse(out.slice(out.indexOf('{'))) as Record<string, { files: Array<{ path: string }> }>
    const first = Object.values(json)[0]
    if (!first || !Array.isArray(first.files)) {
      throw new Error(`npm pack --dry-run --json 的输出解析不出文件清单（原始输出前 200 字：${out.slice(0, 200)}）`)
    }
    return first.files.map((f) => f.path)
  }

  /** 反引号 token → 包内相对路径；不是路径（字段名之类）返回 null */
  const toPackPath = (token: string): string | null => {
    let t = token.trim()
    if (t.startsWith(`${PACKAGE_NAME}/`)) t = t.slice(PACKAGE_NAME.length + 1)
    if (t.startsWith('node_modules/')) {
      const scoped = /^node_modules\/@[^/]+\/[^/]+\/(.*)$/.exec(t)
      if (!scoped) return null
      t = scoped[1]
    }
    if (!t || !/[/]|\.(?:md|json|ts|js|mjs|cjs)$/.test(t)) return null
    return t
  }

  /**
   * glob → RegExp，支持段内通配（`*.d.ts`）与 `**`。
   *
   * 两个容易写错的点，都是实测踩出来的：
   * - **段内星号不是字面量**。只把「整段恰好一个星号」当通配的话，`*.d.ts` 会落进
   *   字面量转义分支、星号变成字面星号，于是「dist 下任意深度的 .d.ts」一条都匹配
   *   不上（门禁首次运行就报了这条假阴性）。
   * - **双星段要连同其后的斜杠整体可选**。glob 语义下「dist 下任意深度（含零级）
   *   的 .d.ts」必须匹配 `dist/index.d.ts`，朴素的任意匹配会要求 dist 之后至少
   *   还有一级。
   */
  const globRe = (p: string): RegExp => {
    const segs = p.split('/')
    let src = ''
    for (let i = 0; i < segs.length; i += 1) {
      const seg = segs[i]
      if (seg === '**') {
        src += i === segs.length - 1 ? '.*' : '(?:.*/)?'
        continue
      }
      if (i > 0 && segs[i - 1] !== '**') src += '/'
      src += seg
        .split('*')
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]*')
    }
    return new RegExp(`^${src}$`)
  }

  const isInPack = (files: string[], p: string): boolean => {
    if (p.includes('*')) {
      const re = globRe(p)
      return files.some((f) => re.test(f))
    }
    if (p.endsWith('/')) return files.some((f) => f.startsWith(p))
    return files.includes(p)
  }

  const ABSENT_WORDS = /不存在|不在|没有|查不到|不随|不带/

  it('该节声称在包内的路径都在发布面里，声称不在的都不在', () => {
    const src = read(SKILL_REL)
    const start = src.indexOf(SECTION)
    if (start < 0) throw new Error(`SKILL.md 找不到小节标题：${SECTION}（小节改名/删除会让本用例失去判据，请同步本文件）`)
    const rest = src.slice(start + SECTION.length)
    const end = rest.search(/\n#{2,3} /)
    const lines = (end < 0 ? rest : rest.slice(0, end)).split('\n')

    const files = packFiles()
    const claims: Array<{ line: number; path: string; wantPresent: boolean }> = []
    lines.forEach((text, i) => {
      const wantPresent = !ABSENT_WORDS.test(text)
      for (const m of text.matchAll(/`([^`]+)`/g)) {
        const p = toPackPath(m[1])
        if (p) claims.push({ line: i + 1, path: p, wantPresent })
      }
    })
    // 抓取自检：一条都没解析出来 = 判据整体空转，否则上面那轮是恒真通过
    expect(claims.length).toBeGreaterThanOrEqual(4)

    const bad = claims
      .filter((c) => isInPack(files, c.path) !== c.wantPresent)
      .map((c) => {
        const actual = isInPack(files, c.path) ? '在' : '不在'
        return `SKILL.md「${SECTION}」第 ${c.line} 行：${c.path} —— 文档称其${c.wantPresent ? '在' : '不在'}包内，实际${actual}`
      })
    expect(bad).toEqual([])
  })
})
