/**
 * 构建后处理脚本（build 阶段，作用于 dist 本身）：
 * 1. 为 dist 写入模块类型标记（{"type":"commonjs"}）
 * 2. 删除 dist 下的全部 sourcemap（.js.map / .d.ts.map）：
 *    包仅发布 dist（类型由 .d.ts 提供），map 文件指向未随包发布的
 *    src 目录会成为死链，仅徒增发布体积，故发布产物中剔除。
 *
 * 根 package.json 未声明 "type"（默认 commonjs）。CJS 产物目录显式写入
 * {"type":"commonjs"} 标记。
 *
 * 子路径转发 stub 不在此生成：见 scripts/generate-subpath-stubs.cjs，
 * 由 prepack / postpack 钩子在打包发布时生成与清理，避免污染仓库根目录。
 */

const fs = require('fs')
const path = require('path')

const distDir = path.join(__dirname, '..', 'dist')

fs.mkdirSync(distDir, { recursive: true })
fs.writeFileSync(path.join(distDir, 'package.json'), JSON.stringify({ type: 'commonjs' }, null, 2) + '\n')

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

console.log(`[postbuild] dist module-type marker written; removed ${removedMaps} sourcemap files`)
