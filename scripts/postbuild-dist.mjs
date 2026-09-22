/**
 * 构建后处理脚本（build 阶段，作用于 dist 本身）：
 * 1. 校验 dist 已由上游产出（存在且非空）——本脚本只负责「补丁」，不负责「制造产物」
 * 2. 为 dist 写入模块类型标记（合并进已有 package.json 的 {"type":"module"}）
 * 3. 删除 dist 下的 sourcemap（仅 .js.map / .d.ts.map）：
 *    包仅发布 dist（类型由 .d.ts 提供），map 文件指向未随包发布的
 *    src 目录会成为死链，仅徒增发布体积，故发布产物中剔除。
 *
 * 根 package.json 已声明 "type": "module"，产物为纯 ESM；dist 目录内仍显式
 * 写入 {"type":"module"} 标记，便于产物被单独拷贝使用（如复制安装）时保持语义。
 *
 * 子路径转发 stub 不在此生成：见 scripts/generate-subpath-stubs.mjs，
 * 由 prepack / postpack 钩子在打包发布时生成与清理，避免污染仓库根目录。
 *
 * 失败分级：产物缺失、type 标记无法安全合并 → 退出码 1 中止（宁可不发布，
 * 也不发布一个语义不明的半成品）；单个 map 删不掉 → 只告警，产物仍可用。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(projectRoot, 'dist')

// 不再 mkdirSync(recursive)：上游 tsc 没产出时静默建一个空 dist，
// 等于把「构建成功」的假象连同 dist/package.json 一起发布出去
if (!fs.existsSync(distDir)) {
  console.error('[postbuild] 中止：dist 不存在，上游构建未产出任何文件')
  process.exit(1)
}
if (fs.readdirSync(distDir).length === 0) {
  console.error('[postbuild] 中止：dist 是空目录，上游构建未产出任何文件')
  process.exit(1)
}

// ==================== 写入模块类型标记 ====================

const markerPath = path.join(distDir, 'package.json')
// 合并而非整体覆写：dist/package.json 可能已由 tsc 之外的步骤（copy / bundle）写入
// name / exports / main / sideEffects 等字段，覆写会把它们静默销毁
let marker = {}
if (fs.existsSync(markerPath)) {
  try {
    const existing = JSON.parse(fs.readFileSync(markerPath, 'utf8'))
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      throw new Error('现有内容不是 JSON 对象')
    }
    marker = existing
  } catch (error) {
    // 解析失败时既不能覆写（会销毁别人的内容）也不能跳过（会缺 type 标记），只能中止
    const reason = error instanceof Error ? error.message : String(error)
    console.error(`[postbuild] 中止：dist/package.json 解析失败，无法安全合并 type 标记（${reason}）`)
    process.exit(1)
  }
}
fs.writeFileSync(markerPath, JSON.stringify({ ...marker, type: 'module' }, null, 2) + '\n')

// ==================== 剔除 sourcemap ====================

/**
 * 只剔除本构建链产出的 map：sourceMap → .js.map，declarationMap → .d.ts.map。
 * 不能用裸 endsWith('.map')：那会连 .css.map 等第三方 map 资源一起删掉。
 */
const MAP_PATTERN = /\.(?:js|d\.ts)\.map$/

function collectMapFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectMapFiles(full, files)
    } else if (MAP_PATTERN.test(entry.name)) {
      files.push(full)
    }
  }
  return files
}

let removedMaps = 0
const mapFailures = []
const foundMaps = collectMapFiles(distDir)
for (const mapFile of foundMaps) {
  // 逐个兜错：Windows 上文件被编辑器/杀毒进程占用时 rmSync 抛错，
  // 未捕获会让 postbuild 中断，把一次成功的 tsc 构建整体判为失败
  try {
    fs.rmSync(mapFile)
    removedMaps++
  } catch (error) {
    mapFailures.push(`${path.relative(distDir, mapFile)}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// 后置校验：removedMaps 计的是「尝试删除的次数」，为 0 既可能是「本就没有 map」（当前
// tsconfig.build.json 关掉了 sourceMap/declarationMap，这是常态），也可能是「全都没删掉」。
// 重新扫一遍 dist，以「实际还剩多少 map」为准出日志。
const leftoverMaps = collectMapFiles(distDir)

if (mapFailures.length > 0) {
  console.warn(`[postbuild] WARN: ${mapFailures.length} 个 sourcemap 未能删除（构建产物仍可用）：\n  ${mapFailures.join('\n  ')}`)
}
if (leftoverMaps.length > 0 && mapFailures.length === 0) {
  // 删除一个没抛错却仍留有 map：只可能是外部进程并发写入或链接目标，属于必须人看的情况
  console.warn(
    `[postbuild] WARN: 删除未抛错但 dist 下仍有 ${leftoverMaps.length} 个 sourcemap：\n  ` +
      leftoverMaps.map((f) => path.relative(distDir, f)).join('\n  '),
  )
}

console.log(
  `[postbuild] dist module-type marker merged into dist/package.json; ` +
    `sourcemap check: found ${foundMaps.length}, removed ${removedMaps}, remaining ${leftoverMaps.length}`,
)
