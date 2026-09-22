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
 * 失败分级：产物缺失、type 标记无法安全合并、dist 存在却读不动（权限 / IO / dist 实为文件）
 * → 退出码 1 中止（宁可不发布，也不发布一个语义不明的半成品）；单个 map 删不掉、
 * 某个子目录扫不到、dist 内有链接条目未被扫描 → 只告警并在汇总里点名，产物仍可用。
 *
 * dist 内部的链接一律不跟随：本脚本原地删除文件，跟随进 junction/符号链接的目标
 * 等于把删除落到 dist 之外（不可回滚，与 clean-dist.mjs 面对同一类风险），
 * 代价是「链接目录里的 map 删不到」——这必须上报，不能让汇总行装作清理干净。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(projectRoot, 'dist')

const reasonOf = (error) => (error instanceof Error ? error.message : String(error))

// 不再 mkdirSync(recursive)：上游 tsc 没产出时静默建一个空 dist，
// 等于把「构建成功」的假象连同 dist/package.json 一起发布出去
if (!fs.existsSync(distDir)) {
  console.error('[postbuild] 中止：dist 不存在，上游构建未产出任何文件')
  process.exit(1)
}
// 存在但读不动（EACCES / EIO / dist 实为文件 → ENOTDIR）同样是「上游没产出可用产物」，
// 必须落到带原因的中止文案 + 退出码 1，而不是抛一条内部栈让 CI 猜。
// 这一次读取同时用作「非空」判定，避免同一目录被扫两遍。
let distEntries
try {
  distEntries = fs.readdirSync(distDir)
} catch (error) {
  console.error(`[postbuild] 中止：无法读取 dist 目录（${reasonOf(error)}）`)
  process.exit(1)
}
if (distEntries.length === 0) {
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
    console.error(`[postbuild] 中止：dist/package.json 解析失败，无法安全合并 type 标记（${reasonOf(error)}）`)
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

/** 路径等价判定：Windows 大小写不敏感，盘符 D: / d: 都可能出现（与 clean-dist.mjs 同规则） */
function samePath(a, b) {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/** 条目的三个类别，语义与 clean-dist.mjs 的 classifyEntry 一致 */
function classifyEntry(full) {
  const stat = fs.lstatSync(full)
  if (stat.isSymbolicLink()) return 'link'
  if (!stat.isDirectory()) return 'file'
  // realpathSync 一定解析重解析点；解析失败时按 link 处理：本脚本的删除不可回滚，
  // 判不准时宁可留下残留（走告警），也不能冒删掉链接目标里真实文件的风险
  let real
  try {
    real = fs.realpathSync(full)
  } catch {
    return 'link'
  }
  return samePath(real, path.resolve(full)) ? 'dir' : 'link'
}

/** 扫描结果：maps=可安全删除的 map，links=未跟随的链接条目，blocked=名字撞了 map 后缀的真实目录 */
function newScanResult() {
  return { maps: [], links: [], blocked: [], unreadable: [] }
}

/**
 * 收集 dist 下的 map。链接不跟随（见文件头），但必须单独记账：
 * 「dist 下已无 map」这句话只有在扫描完整时才成立，漏扫的链接目录与读不动的子目录
 * 都要在汇总里点名，否则就是静默失真。
 */
function scanMaps(dir, acc = newScanResult()) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    acc.unreadable.push(`${path.relative(distDir, dir) || '.'}（目录）: ${reasonOf(error)}`)
    return acc
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    let kind
    try {
      kind = classifyEntry(full)
    } catch (error) {
      // 条目在 readdir 之后消失或读不动：既不能当文件（可能整目录删）也不能当目录（可能跟随链接），只记账
      acc.unreadable.push(`${path.relative(distDir, full)}: ${reasonOf(error)}`)
      continue
    }
    if (kind === 'link') {
      // 删链接本身是安全的（unlink 不动目标），进入目标不是
      if (MAP_PATTERN.test(entry.name)) acc.maps.push(full)
      else acc.links.push(full)
    } else if (kind === 'dir') {
      // 名字叫 x.js.map 的真实目录：里面可能是别人的数据，只上报不整目录删
      if (MAP_PATTERN.test(entry.name)) acc.blocked.push(full)
      else scanMaps(full, acc)
    } else if (MAP_PATTERN.test(entry.name)) {
      acc.maps.push(full)
    }
  }
  return acc
}

/** 扫描不完整的两类原因（读不动的条目 / 未跟随的链接）都要出声，否则汇总行会装作清理干净 */
function reportScanIssues(phase, acc) {
  for (const issue of acc.unreadable) {
    console.warn(`[postbuild] WARN: ${phase} dist 时有条目读不动（${issue}），其中的 sourcemap 未被清理`)
  }
  if (acc.links.length > 0) {
    console.warn(
      `[postbuild] WARN: ${phase} dist 时跳过 ${acc.links.length} 个链接条目（不跟随链接删除，目标可能在 dist 之外），` +
        `其内的 sourcemap 未被清理：\n  ${acc.links.map((link) => path.relative(distDir, link)).join('\n  ')}`,
    )
  }
}

const mapFailures = []
const found = scanMaps(distDir)
reportScanIssues('首次扫描', found)
let removedMaps = 0
for (const mapFile of found.maps) {
  // 逐个兜错：Windows 上文件被编辑器/杀毒进程占用时 rmSync 抛错，
  // 未捕获会让 postbuild 中断，把一次成功的 tsc 构建整体判为失败
  try {
    fs.rmSync(mapFile)
    removedMaps++ // 只计成功删除数：抛错的进下面的失败清单
  } catch (error) {
    mapFailures.push({ file: mapFile, reason: reasonOf(error) })
  }
}

// 后置校验：removedMaps 是「成功删除数」，为 0 既可能是「本就没有 map」（当前
// tsconfig.build.json 关掉了 sourceMap/declarationMap，这是常态），也可能是「全都没删掉」，
// 所以重新扫一遍 dist，以「实际还剩多少 map」为准。失败清单已点名的路径不再重复上报；
// 「没抛错却仍在」的残留（被外部进程写回的文件）必须逐条列出——
// 那正是这条校验要暴露的并发写入场景，不能因为失败清单非空就被整段吞掉。
const remaining = scanMaps(distDir)
reportScanIssues('复查', remaining)
const reportedFailures = new Set(mapFailures.map((failure) => failure.file))
const unexplainedLeftovers = remaining.maps.filter((file) => !reportedFailures.has(file))

if (mapFailures.length > 0) {
  console.warn(
    `[postbuild] WARN: ${mapFailures.length} 个 sourcemap 未能删除（构建产物仍可用）：\n  ` +
      mapFailures.map((failure) => `${path.relative(distDir, failure.file)}: ${failure.reason}`).join('\n  '),
  )
}
if (unexplainedLeftovers.length > 0) {
  console.warn(
    `[postbuild] WARN: 删除未抛错但 dist 下仍有 ${unexplainedLeftovers.length} 个 sourcemap：\n  ` +
      unexplainedLeftovers.map((file) => path.relative(distDir, file)).join('\n  '),
  )
}
if (remaining.blocked.length > 0) {
  console.warn(
    `[postbuild] WARN: dist 下有 ${remaining.blocked.length} 个目录的名字撞了 sourcemap 后缀，` +
      `整目录删除会连别人的数据一起毁掉，已保留并请人工确认：\n  ` +
      remaining.blocked.map((dir) => path.relative(distDir, dir)).join('\n  '),
  )
}

console.log(
  `[postbuild] dist module-type marker merged into dist/package.json; ` +
    `sourcemap check: found ${found.maps.length}, removed ${removedMaps}, remaining ${remaining.maps.length}, ` +
    `links skipped ${remaining.links.length}, map-named dirs kept ${remaining.blocked.length}`,
)
