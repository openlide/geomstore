/**
 * 子路径转发 stub 生成 / 清理脚本（与 build 解耦，仅随 npm 包发布）。
 *
 * 背景：微信小程序「构建 npm」等不支持 package.json exports 字段的解析器无法解析
 * `@openlide/geomstore/xxx` 子路径；stub 目录内 package.json 的 main/types 指向
 * dist 内真实产物，使老式目录解析同样可达。stub 必须位于包根目录才能被老式解析器
 * 命中，因此不能在 dist 内生成。
 *
 * 时机：由 package.json 的 prepack 钩子在 `npm pack` / `npm publish` 前生成，
 * postpack 钩子在打包完成后清理，故本地 `pnpm build` 不再在仓库根目录留下 stub。
 *
 * 前置校验（generate 侧，两者都以退出码 1 中止）：
 * 1. dist 及其中的目标产物必须存在——`npm pack` / `pnpm pack` / `npm publish
 *    --ignore-scripts` 都不会跑 prepublishOnly，缺 dist 时若照样落盘 stub，产出的
 *    tarball 里每个 stub 的 main/types 都指向不存在的文件（比没有 stub 更糟：
 *    老式解析器会命中它、然后报「模块找不到」而不是「子路径不支持」）。
 *    「dist 与源码一致」仍由 prepublishOnly 的 build:release 负责，本脚本只保证「存在」。
 * 2. 每个 stub 目录必须出现在 package.json 的 files 白名单里（自身或某个祖先目录被
 *    列出即算，npm 的 files 语义如此）。发布面与这里的 subpathEntries 是同一份清单的
 *    两处表述，靠人肉对齐必然漂移，故改为打包时机器校验。
 *
 * 用法：
 *   node scripts/generate-subpath-stubs.mjs          生成（pnpm stubs）
 *   node scripts/generate-subpath-stubs.mjs --clean  清理（pnpm stubs:clean）
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(pkgRoot, 'dist')

/**
 * 子路径 -> dist 内相对目录。
 *
 * 这是**老式解析器的兼容别名集合**，不要求与 package.json exports 完全一致：
 * 其中部分是历次版本保留的旧路径别名（如 selectors / actions / snapshot / performance），
 * 新代码请优先使用 exports 已声明的 `extras/*` 子路径。
 */
const subpathEntries = {
  store: 'core/store',
  hooks: 'core/hooks',
  plugins: 'plugins',
  'plugins/devtools': 'plugins/devtools',
  'plugins/performance': 'plugins/performance',
  integrations: 'integrations',
  'integrations/enterprise': 'integrations/enterprise',
  error: 'extras/error',
  compose: 'core/compose',
  selectors: 'extras/selector',
  snapshot: 'extras/snapshot',
  performance: 'core/performance',
  actions: 'extras/action',
  cache: 'core/cache',
}

/** 由深到浅排序，清理时先删子目录再删父目录（plugins/devtools 先于 plugins） */
const subpathsSorted = () =>
  Object.keys(subpathEntries).sort((a, b) => b.split('/').length - a.split('/').length)

/**
 * stub 目录是否落在 package.json files 白名单内：npm 的 files 语义是「列出的目录整体
 * 随包发布」，故 'plugins/devtools' 由白名单里的 'plugins' 覆盖即可。
 */
function coveredByFiles(sub, filesList) {
  const segments = sub.split('/')
  for (let i = segments.length; i > 0; i--) {
    if (filesList.has(segments.slice(0, i).join('/'))) return true
  }
  return false
}

/** 生成前的两道前置校验；返回人可读的失败原因列表，空数组表示可以安全生成 */
function checkPreconditions() {
  const problems = []

  if (!fs.existsSync(distDir)) {
    problems.push(`dist 不存在：stub 的 main/types 全部指向 dist 内产物，此时生成的 stub 必然是死链`)
  } else {
    for (const [sub, rel] of Object.entries(subpathEntries)) {
      const missing = ['index.js', 'index.d.ts'].filter((f) => !fs.existsSync(path.join(distDir, rel, f)))
      if (missing.length > 0) {
        problems.push(`stub \`${sub}\` 的目标 dist/${rel}/{${missing.join(', ')}} 缺失`)
      }
    }
  }

  let filesList = null
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'))
    filesList = Array.isArray(pkg.files) ? new Set(pkg.files.map((f) => f.replace(/\/+$/, ''))) : new Set()
  } catch (error) {
    problems.push(`无法读取 package.json 校验 files 白名单：${error instanceof Error ? error.message : String(error)}`)
  }
  if (filesList) {
    const unshipped = Object.keys(subpathEntries).filter((sub) => !coveredByFiles(sub, filesList))
    if (unshipped.length > 0) {
      problems.push(
        `以下 stub 目录未列入 package.json 的 files 白名单，打包时不会随包发布：${unshipped.join(', ')}`,
      )
    }
  }

  return problems
}

function generate() {
  const problems = checkPreconditions()
  if (problems.length > 0) {
    console.error(
      `[stubs] 已中止（未生成任何 stub）：\n  ${problems.join('\n  ')}\n` +
        '            请先执行 pnpm build 产出 dist，并把新增 stub 目录补进 package.json 的 files。',
    )
    process.exit(1)
  }

  let stubDirs = 0
  for (const [sub, rel] of Object.entries(subpathEntries)) {
    const dir = path.join(pkgRoot, sub)
    fs.mkdirSync(dir, { recursive: true })
    const relFrom = (root, file) => path.relative(dir, path.join(root, rel, file)).replace(/\\/g, '/')
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify(
        {
          main: relFrom(distDir, 'index.js'),
          types: relFrom(distDir, 'index.d.ts'),
        },
        null,
        2,
      ) + '\n',
    )
    stubDirs++
  }
  console.log(`[stubs] generated ${stubDirs} subpath stub dirs`)
}

function clean() {
  let removed = 0
  for (const sub of subpathsSorted()) {
    const dir = path.join(pkgRoot, sub)
    if (!fs.existsSync(dir)) continue
    // 仅清理本脚本生成的转发目录：判定依据为目录下 package.json 的 main 指向 dist
    const marker = path.join(dir, 'package.json')
    let isStub = false
    if (fs.existsSync(marker)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(marker, 'utf8'))
        isStub = typeof pkg.main === 'string' && pkg.main.includes('dist')
      } catch {
        isStub = false
      }
    }
    if (!isStub) continue
    fs.rmSync(dir, { recursive: true, force: true })
    removed++
  }
  console.log(`[stubs] removed ${removed} subpath stub dirs`)
}

if (process.argv.includes('--clean')) {
  clean()
} else {
  generate()
}
