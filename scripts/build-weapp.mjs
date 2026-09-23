/**
 * 微信「构建 npm」专用产物：把 `src` 下全部 `.ts` 模块**一比一转译成 CJS**，落到 dist-weapp/，
 * 文件树与 `dist/` 逐一对应，模块之间保留相对 `require`。
 *
 * 为什么需要它（0.6.0 事故；结论与判据同步在 CHANGELOG 的 [0.6.1] 一节）：
 * 开发者工具的「构建 npm」对**没有** `miniprogram` 字段的包，会从 `main` 起做一遍
 * 依赖分析并把整张图拼成一个文件。对本库 dist 那种「terser 压缩后的多文件 ESM」，
 * 该拼接稳定产出两种坏形态：
 *   A 语句之间丢分隔符 —— `exports.isBuiltinObject = isBuiltinObjectfunction i(e){...}`
 *     → `SyntaxError: Unexpected identifier 'i'`；
 *   B 相对模块被记进文件尾的 `//miniprogram-npm-outsideDeps=[...]` 却不产出任何文件
 *     → `withPageStore` / `withComponentStore` / `withAppStore` 整块丢失。
 * 加 `miniprogram` 字段后走的是另一条官方路径：「小程序 npm 包会直接拷贝构建文件生成目录
 * 下的所有文件到 miniprogram_npm 中」——实测 11/11 逐字节相同，**不做拼接也不做依赖分析**，
 * 于是 A、B 两条成因一起消失，与产物是不是 bundle 无关。
 *
 * 那为什么不干脆 bundle 成单文件？做过，实测数据把它否掉了：
 * 1. bundle 形态下 esbuild 的 `--splitting` 只支持 esm，CJS 多入口必然把 core 重复内联进
 *    每个 bundle —— 11 个入口 457.1 KB，而一比一转译只要 228.3 KB（整目录会被全部计入
 *    小程序包体积，这一倍差值是实打实的）；
 * 2. 更关键的是语义：自包含 bundle 让 `.` 与 `./core` 各持一份 `globalRegistry`、
 *    `./extras` 与 `./extras/enterprise` 各持一份 `storeManager`（实测两个 false），
 *    即「同一个库在一次运行里有两套注册表」。一比一转译保留相对 require，运行时按文件
 *    路径去重，跨入口天然共享同一份实例，与 ESM 侧行为一致；
 * 3. 运行时也更细：宿主只 require 得到它真正用到的那些文件。
 *
 * 代价与前提：这条路依赖「工具整目录拷贝」这一实测行为。若未来某个版本的开发者工具改成
 * 对拷贝目录再做依赖分析，缺陷 B 会回来——防线在 verify-weapp-bundle.mjs 的
 * 「每条相对 require 的目标都必须存在」这条闭环断言上，改回 bundle 只需换回一个 flag。
 *
 * esbuild 缺失/不可用一律硬失败（与 build:release 对 terser 的口径一致）：静默跳过会让
 * dist-weapp 停留在上一次构建的尸体上，而 `miniprogram` 字段正指着它。
 *
 * 用法：`pnpm run build:weapp`（发布链里由 prepublishOnly 串联，随后 verify:weapp 把关）
 */

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { collectWeappEntries, collectSourceModules } from './weapp-entries.mjs'

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

let publicEntries
let modules
try {
  publicEntries = collectWeappEntries(projectRoot, OUT_DIR)
  modules = collectSourceModules(projectRoot)
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
if (modules.length === 0) fail('src 下没找到任何 .ts 模块')

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
// 少清一次就把「源里已删除的模块」一起发布出去
fs.rmSync(path.join(projectRoot, OUT_DIR), { recursive: true, force: true })

try {
  await esbuild.build({
    entryPoints: modules,
    outdir: OUT_DIR,
    outbase: 'src',
    bundle: false,
    format: 'cjs',
    platform: 'neutral',
    target: TARGET,
    charset: 'utf8',
    legalComments: 'none',
    minify: true,
    absWorkingDir: projectRoot,
  })
} catch (error) {
  fail(`esbuild 转译失败：${reasonOf(error)}`)
}

// 产物必须与源模块一一对应：漏一个模块，运行时就是一条解析失败的 require
const missingModules = modules.filter((m) => !fs.existsSync(path.join(projectRoot, OUT_DIR, m.slice('src/'.length).replace(/\.ts$/, '.js'))))
if (missingModules.length > 0) fail(`以下模块没有产出对应产物：${missingModules.join(', ')}`)
for (const e of publicEntries) {
  if (!fs.existsSync(path.join(projectRoot, e.outFile))) fail(`esbuild 报成功但未产出公开子路径 ${e.sub} 的入口 ${e.outFile}`)
}

const files = []
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (entry.name.endsWith('.js')) files.push(full)
  }
}
walk(path.join(projectRoot, OUT_DIR))
const total = files.reduce((sum, f) => sum + fs.statSync(f).size, 0)
console.log(`[build-weapp] ${modules.length} 个模块 → ${files.length} 个 js（合计 ${(total / 1024).toFixed(1)} KB，target=${TARGET}，minify，保留相对 require）`)
console.log(`[build-weapp] 公开子路径 ${publicEntries.length} 个入口全部就位，最大 3 个：`)
for (const f of files.map((f) => [f, fs.statSync(f).size]).sort((a, b) => b[1] - a[1]).slice(0, 3)) {
  console.log(`[build-weapp]   ${path.relative(projectRoot, f[0]).padEnd(40)} ${(f[1] / 1024).toFixed(1).padStart(7)} KB`)
}
