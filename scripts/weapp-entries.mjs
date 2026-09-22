/**
 * 「微信专用产物」的入口清单：package.json exports 的唯一派生实现。
 *
 * build-weapp.mjs 与 verify-weapp-bundle.mjs 共用本模块——两处各抄一份映射
 * 正是上一轮 R5-025 在 postpack 清理面上修过的漂移源，不再重演。
 *
 * 映射规则：exports 的 `default` 必为 `./dist/<rel>.js`，
 * 源码入口是 `src/<rel>.ts`，微信产物是 `dist-weapp/<rel>.js`。
 * 三者同形，所以子路径名与产物路径天然一致
 * （`@openlide/geomstore/extras/snapshot` → `miniprogram_npm/@openlide/geomstore/extras/snapshot.js`）。
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
