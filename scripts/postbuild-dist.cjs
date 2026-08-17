/**
 * 构建后处理脚本：
 * 1. 为 dist/cjs 写入模块类型标记（{"type":"commonjs"}）
 * 2. 删除 dist 下的全部 sourcemap（.js.map / .d.ts.map）：
 *    包仅发布 dist（类型由 .d.ts 提供），map 文件指向未随包发布的
 *    src 目录会成为死链，仅徒增发布体积，故发布产物中剔除。
 * 3. 在包根生成子路径转发 stub 目录（store/、plugins/devtools/ 等）：
 *    微信小程序「构建 npm」等不支持 package.json exports 字段的解析器
 *    无法解析 @openlide/geomstore/xxx 子路径；stub 目录内 package.json
 *    的 main/types 指向 dist 内真实产物，使老式目录解析同样可达。
 *
 * 根 package.json 未声明 "type"（默认 commonjs）。CJS 产物目录显式写入
 * {"type":"commonjs"} 标记。
 */

const fs = require('fs')
const path = require('path')

const distDir = path.join(__dirname, '..', 'dist')

fs.mkdirSync(path.join(distDir, 'cjs'), { recursive: true })
fs.writeFileSync(path.join(distDir, 'cjs', 'package.json'), JSON.stringify({ type: 'commonjs' }, null, 2) + '\n')

// ==================== 剔除 sourcemap ====================

function collectFiles(dir, ext, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectFiles(full, ext, files)
    } else if (entry.name.endsWith(ext)) {
      files.push(full)
    }
  }
  return files
}

let removedMaps = 0
for (const mapFile of collectFiles(distDir, '.map')) {
  fs.rmSync(mapFile)
  removedMaps++
}

console.log(`[postbuild] dist module-type markers written; removed ${removedMaps} sourcemap files`)

// ==================== 子路径转发 stub ====================

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

const pkgRoot = path.join(__dirname, '..')
let stubDirs = 0
for (const [sub, rel] of Object.entries(subpathEntries)) {
  const dir = path.join(pkgRoot, sub)
  fs.mkdirSync(dir, { recursive: true })
  const relFrom = (root, file) => path.relative(dir, path.join(root, rel, file)).replace(/\\/g, '/')
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify(
      {
        main: relFrom(path.join(distDir, 'cjs'), 'index.js'),
        types: relFrom(path.join(distDir, 'cjs'), 'index.d.ts'),
      },
      null,
      2,
    ) + '\n',
  )
  stubDirs++
}

console.log(`[postbuild] ...; generated ${stubDirs} subpath stub dirs`)
