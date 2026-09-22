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
 * 前置校验（generate 侧，任一不过都以退出码 1 中止、且不留任何落盘）：
 * 1. dist 及其中的目标产物必须存在：`npm pack` / `pnpm pack` / `npm publish
 *    --ignore-scripts` 都不会跑 prepublishOnly，缺 dist 时若照样落盘 stub，产出的
 *    tarball 里每个 stub 的 main/types 都指向不存在的文件（比没有 stub 更糟：
 *    老式解析器会命中它、然后报「模块找不到」而不是「子路径不支持」）。
 *    「dist 与源码一致」仍由 prepublishOnly 的 build:release 负责，本脚本只保证「存在」。
 * 2. 每个 stub 目录必须出现在 package.json 的 files 白名单里（自身或某个祖先目录被
 *    列出即算，npm 的 files 语义如此）。发布面与这里的 subpathEntries 是同一份清单的
 *    两处表述，靠人肉对齐必然漂移，故改为打包时机器校验。package.json 没有 files
 *    字段时整条校验跳过：那时 npm 会打进整个包目录，无所谓白名单漏没漏。
 * 3. 同名目标目录要么不存在，要么已经是本脚本自己的 stub。mkdirSync(recursive) 对
 *    已存在的目录是 no-op，紧接着的 writeFileSync 就会把一个同名真实目录的
 *    package.json（真包的 manifest）覆盖掉。
 *
 * 落盘失败：逐目录记账后回滚（本次新建的整目录删掉、原本就是 stub 的写回原 manifest），
 * 再以退出码 1 + 可读原因结束。半途留下的转发目录同样在 files 白名单里，
 * 会被提交或被打包成指向不存在产物的 stub。
 *
 * 清理（--clean）除 mapping 里登记的名字外，还会按形状判据扫一遍仓库根的一级目录，
 * 收掉 mapping 里已删除的旧别名留下的孤儿 stub（按名字遍历永远访问不到它们）。
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

const reasonOf = (error) => (error instanceof Error ? error.message : String(error))

function readTextOrNull(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

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

/** 本脚本产出的 stub 目录最多嵌套几层（subpathEntries 目前最深 2 段，留 1 层余量） */
const MAX_STUB_DEPTH = 3

/** target 是否落在 parent 之内；path.relative 在 win32 下本就按大小写不敏感求公共前缀 */
function isInsideDir(parent, target) {
  const rel = path.relative(parent, target)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/** stub 目录内 main/types 应当指向的那两条相对路径（与 generate 写出的完全一致） */
function expectedManifest(dir, rel) {
  const relFrom = (file) => path.relative(dir, path.join(distDir, rel, file)).replace(/\\/g, '/')
  return { main: relFrom('index.js'), types: relFrom('index.d.ts') }
}

function readManifest(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

/**
 * dir 是否恰好是为登记在 subpathEntries 里的 sub 生成的转发 stub：
 * package.json 的 main 与将要写出的那一条相对路径**全等**。
 */
function isOwnStubDir(dir, sub) {
  const manifest = readManifest(dir)
  if (!manifest || typeof manifest !== 'object') return false
  return manifest.main === expectedManifest(dir, subpathEntries[sub]).main
}

/**
 * 一个**没有登记在 subpathEntries 里**的目录是否整体由本脚本产出（孤儿 stub 清扫用）。
 *
 * 没有登记的别名就没有「应当等于哪条 main」这把标尺，只能退到形状判据：
 * package.json 的键恰为 main + types、两者都指向 dist 之内，且目录下其余条目
 * 递归满足同一条件。清理是 rmSync(recursive)，判错的代价不可回滚，
 * 所以宁可漏删（残留下次还看得见）也不能多删。
 */
function isGeneratedStubTree(dir, depth = 0) {
  if (depth > MAX_STUB_DEPTH) return false
  const manifest = readManifest(dir)
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return false
  if (Object.keys(manifest).sort().join(',') !== 'main,types') return false
  const forwards = [manifest.main, manifest.types].every(
    (value) => typeof value === 'string' && value !== '' && isInsideDir(distDir, path.resolve(dir, value)),
  )
  if (!forwards) return false
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return false
  }
  return entries.every((entry) =>
    entry.name === 'package.json'
      ? entry.isFile()
      : entry.isDirectory() && isGeneratedStubTree(path.join(dir, entry.name), depth + 1),
  )
}

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

/** 生成前的前置校验；返回人可读的失败原因列表，空数组表示可以安全生成 */
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

  // 写入前先确认每个目标目录要么不存在、要么已经是本脚本的 stub：
  // mkdirSync(recursive) 对已存在的目录是 no-op，紧接着的 writeFileSync 就会覆盖一个同名
  // 真实目录的 package.json（真包的 manifest），既不报错也不可回滚。
  for (const sub of Object.keys(subpathEntries)) {
    const dir = path.join(pkgRoot, sub)
    if (fs.existsSync(dir) && !isOwnStubDir(dir, sub)) {
      problems.push(`目录 \`${sub}\` 已存在且不是本脚本生成的转发 stub，拒绝覆写它的 package.json`)
    }
  }

  // 没有 files 字段 = npm 会把整个包目录都打进包里，不存在「白名单漏了 stub」这回事，
  // 所以这里给 null（跳过覆盖校验）而不是空 Set：空 Set 会把每个登记项都报成未发布，
  // 白白用退出码 1 拦下一次本来正确的打包。
  let filesList = null
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'))
    filesList = Array.isArray(pkg.files) ? new Set(pkg.files.map((f) => f.replace(/\/+$/, ''))) : null
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
        '            处置：缺 dist 就先 pnpm build；缺白名单就把新增 stub 目录补进 package.json 的 files；' +
        '若是同名真实目录挡了路，请改名或删掉它（本脚本不会覆写别人的 package.json）。',
    )
    process.exit(1)
  }

  // 落盘阶段的半途失败要能退回原样：checkPreconditions 已保证每个目标目录要么不存在、
  // 要么已经是本脚本自己的 stub，于是「本次新建的」可以整目录删掉，
  // 「原本就有的 stub」只需把原来那份 package.json 写回去。
  // 不回滚的代价很具体：半途留下的转发目录都在 files 白名单里，
  // 会被提交或被打包成「main/types 指向不存在产物」的 stub，而 postpack 的 clean
  // 只按 mapping 里的名字访问得到它们。
  const touched = []
  let stubDirs = 0
  try {
    for (const [sub, rel] of Object.entries(subpathEntries)) {
      const dir = path.join(pkgRoot, sub)
      const manifestPath = path.join(dir, 'package.json')
      const created = !fs.existsSync(dir)
      const previous = created ? null : readTextOrNull(manifestPath)
      fs.mkdirSync(dir, { recursive: true })
      touched.push({ dir, created, previous })
      fs.writeFileSync(manifestPath, JSON.stringify(expectedManifest(dir, rel), null, 2) + '\n')
      stubDirs++
    }
  } catch (error) {
    const { deleted, restored, failed } = rollbackStubs(touched)
    console.error(
      `[stubs] 已中止：生成第 ${stubDirs + 1} 个 stub 时写盘失败（${reasonOf(error)}）。\n` +
        `            已回滚：删除本次新建的 ${deleted} 个目录、还原 ${restored} 个原有 stub` +
        (failed > 0 ? `；另有 ${failed} 个目录回滚失败，请手工清理后再打包` : '') +
        '。',
    )
    process.exit(1)
  }
  console.log(`[stubs] generated ${stubDirs} subpath stub dirs`)
}

/** 把 generate 半途写出的东西退回原状；单个退回失败不掩盖原始错误，只计数上报 */
function rollbackStubs(touched) {
  let deleted = 0
  let restored = 0
  let failed = 0
  for (const { dir, created, previous } of touched) {
    try {
      if (created) {
        fs.rmSync(dir, { recursive: true, force: true })
        deleted++
      } else if (previous !== null) {
        fs.writeFileSync(path.join(dir, 'package.json'), previous)
        restored++
      }
    } catch {
      failed++
    }
  }
  return { deleted, restored, failed }
}

function clean() {
  let removed = 0
  for (const sub of subpathsSorted()) {
    const dir = path.join(pkgRoot, sub)
    if (!fs.existsSync(dir)) continue
    if (!isOwnStubDir(dir, sub)) continue
    fs.rmSync(dir, { recursive: true, force: true })
    removed++
  }

  // 孤儿 stub：mapping 里已被删掉的旧别名留下的转发目录，上面按名字遍历根本访问不到，
  // 于是它会永久留在仓库根、随 files 白名单一起发布，指向一份不再有人维护的产物。
  // 未登记的名字没有「应当等于哪条 main」这把标尺，故只对**一级目录**用形状判据补扫。
  let orphans = 0
  for (const entry of fs.readdirSync(pkgRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || Object.hasOwn(subpathEntries, entry.name)) continue
    const dir = path.join(pkgRoot, entry.name)
    if (!isGeneratedStubTree(dir)) continue
    fs.rmSync(dir, { recursive: true, force: true })
    orphans++
  }

  const orphanNote = orphans > 0 ? `（含 ${orphans} 个 mapping 里已不存在的孤儿 stub）` : ''
  console.log(`[stubs] removed ${removed + orphans} subpath stub dirs${orphanNote}`)
}

if (process.argv.includes('--clean')) {
  clean()
} else {
  generate()
}
