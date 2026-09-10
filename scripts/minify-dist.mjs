/**
 * dist 产物压缩（可选，`pnpm build:min`）。
 *
 * 背景：本库构建链是纯 `tsc`，产物保留了全部注释、空行与长标识符。
 * 对「直接拷贝 dist 使用」的原生小程序项目，未压缩产物会实打实占用 2MB 主包额度。
 *
 * 策略（默认）：原地压缩 dist 下的全部 .js，不额外产出 .min.js 副本。
 * 理由：微信「构建 npm」若为整包拷贝，双份产物会让 miniprogram_npm 体积翻倍；
 * 原地压缩在「按需拷贝」与「整包拷贝」两种机制下都是最优。
 * 代价是牺牲产物可读性——本地开发请用未压缩的 `pnpm build`（本脚本只在 build:min 中执行）。
 *
 * `.d.ts` 一律不动（小程序运行时不解析类型文件，压缩无收益且会破坏类型）。
 *
 * 压缩器按优先级自动探测：esbuild → terser → uglify-js。
 *
 * 探测不到压缩器时的行为由 `--strict` 决定：
 * - 默认（宽松，供本地 `build:min`）：告警并跳过，不阻塞开发链路；
 * - `--strict`（供发布 `build:release`）：报错并以退出码 1 中止，
 *   避免发布链路静默产出未压缩包（策略①的核心承诺是「发布即压缩」）。
 *
 * 当前声明的是 terser（纯 JS，无原生 postinstall，不受 pnpm
 * `ERR_PNPM_IGNORED_BUILDS` 构建脚本授权限制；esbuild 需要该授权故未采用）。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')

function collectJs(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectJs(full, files)
    } else if (entry.name.endsWith('.js')) {
      files.push(full)
    }
  }
  return files
}

function tryRequire(name) {
  try {
    return require(name)
  } catch {
    return null
  }
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`

async function minifyWithEsbuild(esbuild, files) {
  await Promise.all(
    files.map(async (file) => {
      const source = fs.readFileSync(file, 'utf8')
      const result = await esbuild.transform(source, { loader: 'js', minify: true, target: 'es2020' })
      fs.writeFileSync(file, result.code)
    }),
  )
}

async function minifyWithTerser(terser, files) {
  for (const file of files) {
    const result = await terser.minify(fs.readFileSync(file, 'utf8'), { module: true })
    if (result.code) fs.writeFileSync(file, result.code)
  }
}

function minifyWithUglify(uglify, files) {
  for (const file of files) {
    const result = uglify.minify(fs.readFileSync(file, 'utf8'), { module: true })
    if (result.code) fs.writeFileSync(file, result.code)
  }
}

async function main() {
  const strict = process.argv.includes('--strict')

  if (!fs.existsSync(distDir)) {
    console.error('[minify-dist] dist not found; run `pnpm build` first')
    process.exitCode = 1
    return
  }

  const files = collectJs(distDir)
  const before = files.reduce((sum, f) => sum + fs.statSync(f).size, 0)

  const esbuild = tryRequire('esbuild')
  const terser = tryRequire('terser')
  const uglify = tryRequire('uglify-js')

  if (esbuild) {
    await minifyWithEsbuild(esbuild, files)
    console.log('[minify-dist] minifier: esbuild')
  } else if (terser) {
    await minifyWithTerser(terser, files)
    console.log('[minify-dist] minifier: terser')
  } else if (uglify) {
    minifyWithUglify(uglify, files)
    console.log('[minify-dist] minifier: uglify-js')
  } else {
    const hint = '[minify-dist] no minifier found. Install one first, e.g. `pnpm add -D terser`.'
    if (strict) {
      console.error(`${hint}\n              --strict：发布链路要求必须压缩，已中止。`)
      process.exitCode = 1
    } else {
      console.warn(`${hint}\n              SKIPPED：未压缩产物仍可正常发布；正式发布请用 build:release。`)
    }
    return
  }

  const after = files.reduce((sum, f) => sum + fs.statSync(f).size, 0)
  const saved = before - after
  console.log(
    `[minify-dist] ${files.length} js files: ${kb(before)} -> ${kb(after)} ` +
      `(saved ${kb(saved)}, -${((saved / before) * 100).toFixed(1)}%)`,
  )
}

main().catch((error) => {
  console.error('[minify-dist] failed:', error)
  process.exitCode = 1
})
