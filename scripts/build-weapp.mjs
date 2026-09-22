/**
 * 微信「构建 npm」专用产物：把每个公开子路径打成**自包含单文件 CJS**，落到 dist-weapp/。
 *
 * 为什么需要它（0.6.0 事故，证据见 docs/WECHAT_NPM_FIX.md）：
 * 开发者工具的「构建 npm」会把 npm 包入口的依赖图拼成单文件写进
 * `miniprogram_npm/<包名>/index.js`。对本库 dist 那种「terser 压缩后的多文件 ESM」，
 * 该拼接稳定产出两种坏形态：
 *   A 语句之间丢分隔符 —— `exports.isBuiltinObject = isBuiltinObjectfunction i(e){...}`
 *     → `SyntaxError: Unexpected identifier 'i'`；
 *   B 相对模块被记进文件尾的 `//miniprogram-npm-outsideDeps=[...]` 却不产出任何文件
 *     → `withPageStore` / `withComponentStore` / `withAppStore` 整块丢失，
 *       小程序启动即 `module '...' is not defined`。
 * 入口改成「单文件 + 零相对 require + 本就是 CJS」后，A 没有可拼接的多模块、
 * B 没有可被错标的外部依赖，两条成因同时消失。
 *
 * 产物是**目录**且覆盖全部公开子路径：`package.json` 的 `miniprogram` 字段按官方规定
 * 指向「构建文件生成目录」，且「小程序 npm 包会直接拷贝构建文件生成目录下的所有文件到
 * miniprogram_npm 中」——只做主入口单文件会让其余 10 个子路径在微信侧无路可走。
 *
 * esbuild 缺失/不可用一律硬失败（与 build:release 对 terser 的口径一致）：
 * 静默跳过会让 dist-weapp 停留在上一次构建的尸体上，而 `miniprogram` 字段正指着它。
 *
 * 用法：`pnpm run build:weapp`（发布链里由 prepublishOnly 串联，随后 verify:weapp 把关）
 */

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { collectWeappEntries } from './weapp-entries.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require_ = createRequire(import.meta.url)
const OUT_DIR = 'dist-weapp'
/** 与 tsconfig 的 target 一致（`target/lib: ES2020`），不额外降版本以免与 dist 的语义分叉 */
const TARGET = 'es2020'

const reasonOf = (error) => (error instanceof Error ? error.message : String(error))

function fail(message) {
  console.error(`[build-weapp] 已中止：${message}`)
  process.exit(1)
}

let entries
try {
  entries = collectWeappEntries(projectRoot, OUT_DIR)
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}

let esbuild
try {
  // 按包名解析（createRequire 从本脚本向上走到仓库根的 node_modules）：
  // 既不走 npx 临时目录也不直连 lib/main.js——esbuild 是 CJS，ESM 下命名导出不可靠，
  // 而版本不同的 esbuild 会产出不同字节的产物却同样报成功
  esbuild = require_('esbuild')
  if (typeof esbuild?.build !== 'function') throw new Error('解析到的模块没有 build() 方法')
} catch (error) {
  fail(`esbuild 不可用（${reasonOf(error)}）。它是 devDependencies 的显式项，请 \`pnpm install\` 后重试；不允许跳过这一步发布`)
}

// 先清掉上一次产物：esbuild 只覆盖同名输出、不删多余文件，而该目录会被整份拷进小程序包，
// 少清一次就把「源里已删除的 API」一起发布出去
fs.rmSync(path.join(projectRoot, OUT_DIR), { recursive: true, force: true })

try {
  await esbuild.build({
    entryPoints: entries.map((e) => ({ in: e.srcFile, out: e.outFile.slice(OUT_DIR.length + 1).replace(/\.js$/, '') })),
    outdir: OUT_DIR,
    bundle: true,
    format: 'cjs',
    platform: 'neutral',
    target: TARGET,
    charset: 'utf8',
    legalComments: 'none',
    minify: true,
    absWorkingDir: projectRoot,
  })
} catch (error) {
  fail(`esbuild 构建失败：${reasonOf(error)}`)
}

let total = 0
for (const e of entries) {
  if (!fs.existsSync(path.join(projectRoot, e.outFile))) fail(`esbuild 报成功但未产出 ${e.outFile}（子路径 ${e.sub}）`)
  total += fs.statSync(path.join(projectRoot, e.outFile)).size
}
console.log(`[build-weapp] ${entries.length} 个入口 → ${OUT_DIR}/（合计 ${(total / 1024).toFixed(1)} KB，target=${TARGET}，minify）`)
for (const e of entries) {
  const size = fs.statSync(path.join(projectRoot, e.outFile)).size
  console.log(`[build-weapp]   ${e.sub.padEnd(20)} ${e.outFile.padEnd(34)} ${(size / 1024).toFixed(1).padStart(8)} KB`)
}
