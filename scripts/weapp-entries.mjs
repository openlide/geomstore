/**
 * 「微信专用产物」的清单：公开子路径映射 + 模块文件集合，两个脚本共用的唯一实现。
 *
 * build-weapp.mjs 与 verify-weapp-bundle.mjs 共用本模块——两处各抄一份映射
 * 正是上一轮 R5-025 在 postpack 清理面上修过的漂移源。
 *
 * 产物形态是「按模块一比一转译的 CJS」（不是 bundle）：`dist-weapp/` 的文件树与
 * `dist/` 逐一对应，模块间保留相对 `require`。这样微信「构建 npm」整目录拷贝之后，
 * 运行时只加载真正被 require 到的文件，且跨入口共享同一份模块实例
 * （`globalRegistry` / `storeManager` 等单例不会分裂）。
 */

import fs from 'node:fs'
import path from 'node:path'

/** `./package.json` 不是运行时入口，不参与产物 */
const SKIPPED_SUBPATHS = new Set(['./package.json'])

/**
 * @param {string} projectRoot 仓库根绝对路径
 * @param {string} outDir 产物目录名（dist-weapp）
 * @returns {Array<{sub: string, srcFile: string, outFile: string, esmFile: string}>}
 * @throws {Error} exports 形状不符合本规则，或源文件缺失
 */
export function collectWeappEntries(projectRoot, outDir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))
  const entries = []
  for (const [sub, cond] of Object.entries(pkg.exports || {})) {
    if (SKIPPED_SUBPATHS.has(sub)) continue
    const target = typeof cond === 'string' ? cond : cond?.default
    if (typeof target !== 'string' || !target.startsWith('./dist/') || !target.endsWith('.js')) {
      throw new Error(`子路径 ${sub} 的 default 不是 ./dist/ 下的 .js（实际 ${JSON.stringify(target)}），映射规则需要更新`)
    }
    const rel = target.slice('./dist/'.length, -'.js'.length)
    const srcFile = `src/${rel}.ts`
    if (!fs.existsSync(path.join(projectRoot, srcFile))) {
      throw new Error(`子路径 ${sub} 的入口源文件不存在：${srcFile}（exports 指向 ${target}）`)
    }
    entries.push({ sub, srcFile, outFile: `${outDir}/${rel}.js`, esmFile: target.slice(1) })
  }
  if (entries.length === 0) throw new Error('package.json 的 exports 里没找到任何子路径')
  return entries
}

/**
 * 需要转译的全部源模块：`src` 下所有 `.ts`，排除 `.d.ts`（那是类型声明，不是模块）。
 *
 * 与 tsc 在 `dist` 下产出的运行时模块一一对应：本仓库没有非 .ts 的运行时源文件，
 * 所以「文件数是否镜像完整」可以直接当校验用，不必再维护第二份清单。
 */
export function collectSourceModules(projectRoot) {
  const found = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) found.push(full)
    }
  }
  walk(path.join(projectRoot, 'src'))
  return found.sort().map((full) => path.relative(projectRoot, full).split(path.sep).join('/'))
}
