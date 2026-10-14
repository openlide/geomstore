/**
 * 把小程序 demo 工程里的换行符统一成 LF
 *
 * 为什么需要它：仓库根 `.gitattributes` 是 `* text=auto eol=lf`，CI 的文档门禁 G14
 * 会断言「tracked 文件里一个 CR 字节都没有」。而微信开发者工具保存文件时写的是 CRLF，
 * 每改一次 `project.config.json` / 页面 js 就会把 CR 带回来，门禁随之变红——
 * 这不是「格式偏好」，是本地与 CI 判据必须一致（否则 `git diff` 还会膨胀成整文件重写）。
 *
 * 用法：
 *   node scripts/normalize-eol.mjs          # 只报告，不落盘（CI / 自查）
 *   node scripts/normalize-eol.mjs --write  # 归一到 LF
 *
 * 刻意不做的事：
 * - 不碰 `node_modules/` 与 `miniprogram_npm/`（前者不入库，后者是「构建 npm」产物）；
 * - 不处理 lone CR（老 Mac 口径）：本仓库从未出现过，真出现时应当人工看一眼而不是静默改写；
 * - 不猜二进制：只处理白名单里的文本扩展名，避免把将来的图片/字体写坏。
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(here, '..')

const SKIP_DIRS = new Set(['node_modules', 'miniprogram_npm', '.git', 'coverage'])
const TEXT_EXT = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.json',
  '.md',
  '.wxss',
  '.wxml',
  '.wxs',
  '.yml',
  '.yaml',
  '.npmrc',
  '.gitignore',
  '.gitattributes',
])

/** 收集需要检查的文本文件（含无扩展名的点文件，如 .npmrc） */
function collect(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const abs = join(dir, name)
    const st = statSync(abs)
    if (st.isDirectory()) {
      collect(abs, out)
      continue
    }
    if (!st.isFile()) continue
    const dot = name.lastIndexOf('.')
    const ext = dot > 0 ? name.slice(dot) : name // 无扩展名时用整个文件名匹配（.npmrc）
    if (TEXT_EXT.has(ext)) out.push(abs)
  }
  return out
}

const write = process.argv.includes('--write')
const files = collect(ROOT)
const offenders = []

for (const abs of files) {
  const buf = readFileSync(abs)
  if (!buf.includes(0x0d)) continue
  offenders.push(relative(ROOT, abs).replace(/\\/g, '/'))
  if (write) {
    writeFileSync(abs, buf.toString('utf8').replace(/\r\n/g, '\n'))
  }
}

if (offenders.length === 0) {
  console.log(`[eol] 全部 ${files.length} 个文本文件均为 LF`)
  process.exit(0)
}

console.log(`[eol] 检出 ${offenders.length} 个含 CR 的文件：`)
for (const f of offenders) console.log(`  - ${f}`)
if (write) {
  console.log('[eol] 已归一为 LF')
  process.exit(0)
}
console.log('[eol] 仅报告模式。执行 `node scripts/normalize-eol.mjs --write`（或 npm run eol:fix）落盘')
process.exit(1)
