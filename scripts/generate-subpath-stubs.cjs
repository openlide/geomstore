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
 * 用法：
 *   node scripts/generate-subpath-stubs.cjs          生成（pnpm stubs）
 *   node scripts/generate-subpath-stubs.cjs --clean  清理（pnpm stubs:clean）
 */

const fs = require('fs')
const path = require('path')

const pkgRoot = path.join(__dirname, '..')
const distDir = path.join(pkgRoot, 'dist')

/** 子路径 -> dist 内相对目录（与 package.json exports 字段一一对应） */
const subpathEntries = {
  store: 'core/store',
  hooks: 'core/hooks',
  plugins: 'plugins',
  'plugins/devtools': 'plugins/devtools',
  'plugins/performance': 'plugins/performance',
  integrations: 'integrations',
  'integrations/enterprise': 'integrations/enterprise',
  error: 'core/error',
  compose: 'core/compose',
  selectors: 'core/selector',
  snapshot: 'core/snapshot',
  performance: 'core/performance',
  actions: 'core/action',
  cache: 'core/cache',
}

/** 由深到浅排序，清理时先删子目录再删父目录（plugins/devtools 先于 plugins） */
const subpathsSorted = () =>
  Object.keys(subpathEntries).sort((a, b) => b.split('/').length - a.split('/').length)

function generate() {
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
