/**
 * 构建后处理脚本（build 阶段，作用于 dist 本身）：
 * 1. 为 dist 写入模块类型标记（{"type":"module"}）
 * 2. 删除 dist 下的全部 sourcemap（.js.map / .d.ts.map）：
 *    包仅发布 dist（类型由 .d.ts 提供），map 文件指向未随包发布的
 *    src 目录会成为死链，仅徒增发布体积，故发布产物中剔除。
 *
 * 根 package.json 已声明 "type": "module"，产物为纯 ESM；dist 目录内仍显式
 * 写入 {"type":"module"} 标记，便于产物被单独拷贝使用（如复制安装）时保持语义。
 *
 * 子路径转发 stub 不在此生成：见 scripts/generate-subpath-stubs.mjs，
 * 由 prepack / postpack 钩子在打包发布时生成与清理，避免污染仓库根目录。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')

fs.mkdirSync(distDir, { recursive: true })
fs.writeFileSync(path.join(distDir, 'package.json'), JSON.stringify({ type: 'module' }, null, 2) + '\n')

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
