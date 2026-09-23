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

  // 反向：新增 exports 却忘了写文档，同样要变红
  it('exports 声明的每个子路径都在文档里被提到过', () => {
    const corpus = mdFiles.map(read).join('\n')
    const missing = exportKeys.filter((k) => {
      const sub = subOf(k)
      return sub !== '' && !corpus.includes(`@openlide/geomstore/${sub}`)
    })
    expect(missing).toEqual([])
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
})
