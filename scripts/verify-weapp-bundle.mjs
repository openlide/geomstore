/**
 * dist-weapp 产物门禁：把「微信侧能不能用」变成一条会失败的命令，而不是发布后的人工验证。
 *
 * 0.6.0 的事故里，坏产物是**能发布成功**的——`pnpm test` / `build` / `pack` 全绿，
 * 因为没有任何一步真正加载过「要被微信拷走的那份文件」。本脚本补的就是这一环，
 * 逐项对应 0.6.0 事故事后排查出来的缺陷特征：
 *
 * 1. 镜像完整：`dist/` 里每个运行时模块都要在 `dist-weapp/` 有对应 CJS 文件，少一个
 *    就是运行期一条解析失败的 require；
 * 2. 缺陷 B 的正面防线：逐文件收集相对 `require("...")`，**每个目标都必须真实存在**
 *    （被引用却没产出，正是 0.6.0 里 withPageStore 整块消失的形态）；
 * 3. 缺陷 A：文件必须能按 CJS 解析——不靠 `node --check` 的「只看单文件」，而是整张图
 *    真实 `require` 加载，等价于把微信运行时要走一遍的解析路径先走一遍；
 * 4. 无 `outsideDeps` 残留、无顶层 ESM 语法残留；
 * 5. 导出面与 `dist` 的 ESM 逐项一致（少一个导出＝少一个 API）；
 * 6. 跨入口单例同一性：`.` 与 `./core` 的 `globalRegistry`、`./extras` 与
 *    `./extras/enterprise` 的 `storeManager` 必须是**同一个对象**。这条就是
 *    「bundle 成单文件」方案会当场失败的地方（实测两个 false）；
 * 7. 主入口跑一次真实用例（createStore / dispatch / subscribe / getter / `$snapshot`）。
 *
 * 任一项不过 → 退出码 1，发布链（prepublishOnly）当场断。
 *
 * 用法：`pnpm run verify:weapp`（需先 `pnpm run build:weapp`）
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { collectWeappEntries } from './weapp-entries.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = 'dist-weapp'

const failures = []
const notes = []

/** 断言式记账：不抛错、不提前退出，一次跑完给出全部问题，避免「修一个看一眼」的循环 */
function check(label, ok, detail) {
  if (ok) notes.push(`  ok   ${label}${detail ? ` — ${detail}` : ''}`)
  else failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
}

function bail(message) {
  console.error(`[verify-weapp] 已中止：${message}`)
  process.exit(1)
}

let publicEntries
try {
  publicEntries = collectWeappEntries(projectRoot, OUT_DIR)
} catch (error) {
  bail(error instanceof Error ? error.message : String(error))
}

const outAbs = path.join(projectRoot, OUT_DIR)
if (!fs.existsSync(outAbs)) bail(`找不到 ${OUT_DIR}/，先跑 pnpm run build:weapp`)

/**
 * 加载区：把整棵产物目录复制进临时目录，并放一个 `{"type":"commonjs"}` 的 package.json。
 *
 * 根 package.json 是 `"type": "module"`，仓库内的 `.js` 会被 Node 当 ESM——那是扩展名规则，
 * 不是产物缺陷。改扩展名为 `.cjs` 的土办法在这里不成立：产物靠**相对 `require("./x.js")`**
 * 互联，Node 按字面扩展名解析，改名等于把依赖图剪断。所以整目录复制 + 就地声明 CJS，
 * 这样加载路径与微信运行时同构（一个目录、按文件路径解析、模块只实例化一次）。
 */
const loadRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'geomstore-weapp-verify-'))
fs.cpSync(outAbs, loadRoot, { recursive: true })
fs.writeFileSync(path.join(loadRoot, 'package.json'), '{"type":"commonjs"}\n')
const require_ = createRequire(pathToFileURL(path.join(loadRoot, 'package.json')).href)

/** 收集产物里全部 .js（相对 loadRoot 的路径） */
function listJs(root) {
  const out = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.js')) out.push(path.relative(root, full).split(path.sep).join('/'))
    }
  }
  walk(root)
  return out.sort()
}

const weappFiles = listJs(outAbs)
const distFiles = listJs(path.join(projectRoot, 'dist'))
const missingInWeapp = distFiles.filter((f) => !weappFiles.includes(f))
check(`产物镜像 dist 完整（dist ${distFiles.length} / dist-weapp ${weappFiles.length}）`, missingInWeapp.length === 0, missingInWeapp.length ? `缺 ${missingInWeapp.slice(0, 5).join(', ')}${missingInWeapp.length > 5 ? ` …共 ${missingInWeapp.length} 个` : ''}` : undefined)

/** 缺陷 B 的正面防线：相对 require 的目标必须存在 */
const relRequire = /require\("(\.{1,2}\/[^"]+)"\)/g
const unresolved = []
let requireCount = 0
for (const rel of weappFiles) {
  const text = fs.readFileSync(path.join(outAbs, rel), 'utf8')
  for (const m of text.matchAll(relRequire)) {
    requireCount += 1
    const spec = m[1]
    const baseDir = path.dirname(path.join(outAbs, rel))
    const target = path.resolve(baseDir, spec)
    if (!fs.existsSync(target)) unresolved.push(`${rel} → ${spec}`)
  }
}
check(`相对 require 闭环（共 ${requireCount} 处）`, unresolved.length === 0, unresolved.length ? `缺目标：${unresolved.slice(0, 5).join(' | ')}` : '每条都能在产物内解析')

/** 逐文件静态体检 */
const withOutside = weappFiles.filter((f) => fs.readFileSync(path.join(outAbs, f), 'utf8').includes('outsideDeps'))
check(`${weappFiles.length} 个文件无 outsideDeps 残留`, withOutside.length === 0, withOutside.slice(0, 5).join(', '))

const withEsmSyntax = weappFiles.filter((f) => /^\s*(?:export|import)[\s{*(]/m.test(fs.readFileSync(path.join(outAbs, f), 'utf8')))
check('无顶层 ESM 语法残留', withEsmSyntax.length === 0, withEsmSyntax.slice(0, 5).join(', '))

const emptyFiles = weappFiles.filter((f) => fs.statSync(path.join(outAbs, f)).size === 0)
check('无零字节产物', emptyFiles.length === 0, emptyFiles.slice(0, 5).join(', '))

/** 主入口必须存在的公开 API（0.6.0 事故中被缺陷 B 整块吃掉的那几个） */
const REQUIRED_FUNCTION_EXPORTS = ['createStore', 'isGeomStore', 'composeStore', 'withPageStore', 'withComponentStore', 'withAppStore']

/** 跨入口必须共享同一实例的单例（bundle 形态会在这一条当场失败） */
const SHARED_SINGLETON_PAIRS = [
  { a: '.', b: './core', key: 'globalRegistry', why: 'Store 名字注册表' },
  { a: './extras', b: './extras/enterprise', key: 'storeManager', why: '企业端账号/StoreManager 单例' },
]

const loaded = new Map()
for (const entry of publicEntries) {
  const relFromOut = entry.outFile.slice(`${OUT_DIR}/`.length).split('/').join(path.sep)
  if (!fs.existsSync(path.join(outAbs, relFromOut))) {
    check(`${entry.sub} 入口产物存在`, false, `缺 ${entry.outFile}`)
    continue
  }
  const size = fs.statSync(path.join(outAbs, relFromOut)).size
  check(`${entry.sub} 入口非空`, size > 0, `${(size / 1024).toFixed(1)} KB`)

  // 真实加载整张图：语法坏或依赖缺失都会在这里抛出
  try {
    loaded.set(entry.sub, require_(path.join(loadRoot, relFromOut)))
    check(`${entry.sub} 可按 CJS 加载（含其依赖图）`, true)
  } catch (error) {
    check(`${entry.sub} 可按 CJS 加载（含其依赖图）`, false, error instanceof Error ? error.message : String(error))
    continue
  }

  const mod = loaded.get(entry.sub)
  let esm = null
  try {
    esm = await import(pathToFileURL(path.join(projectRoot, entry.esmFile)).href)
  } catch (error) {
    check(`${entry.sub} 对照的 ESM 产物可加载`, false, `${entry.esmFile}：${error instanceof Error ? error.message : String(error)}`)
    continue
  }
  const cjsKeys = Object.keys(mod).sort()
  const esmKeys = Object.keys(esm).sort()
  const missing = esmKeys.filter((k) => !cjsKeys.includes(k))
  const extra = cjsKeys.filter((k) => !esmKeys.includes(k))
  check(`${entry.sub} 导出面与 dist 一致`, missing.length === 0 && extra.length === 0, `CJS ${cjsKeys.length} 项 / ESM ${esmKeys.length} 项${missing.length ? `；缺 ${missing.join(', ')}` : ''}${extra.length ? `；多 ${extra.join(', ')}` : ''}`)
}

for (const pair of SHARED_SINGLETON_PAIRS) {
  const a = loaded.get(pair.a)
  const b = loaded.get(pair.b)
  if (!a || !b) {
    check(`跨入口单例 ${pair.key} 同一（${pair.a} vs ${pair.b}）`, false, '有入口没加载成功，无从比对')
    continue
  }
  check(`跨入口单例 ${pair.key} 同一对象（${pair.a} vs ${pair.b}）`, a[pair.key] != null && a[pair.key] === b[pair.key], `${pair.why}；bundle 化的产物这里是 false`)
}

const main = loaded.get('.')
if (main) {
  const notFn = REQUIRED_FUNCTION_EXPORTS.filter((k) => typeof main[k] !== 'function')
  check('主入口关键 API 均为函数', notFn.length === 0, notFn.length ? `不是函数：${notFn.join(', ')}` : REQUIRED_FUNCTION_EXPORTS.join(', '))
  try {
    const store = main.createStore({
      name: 'weapp-verify',
      state: () => ({ count: 1 }),
      actions: {
        inc() {
          this.setState('count', this.state.count + 1)
        },
      },
      getters: { doubled: (s) => s.count * 2 },
    })
    let seen = null
    const off = store.subscribe((s) => {
      seen = s.count
    })
    store.dispatch('inc')
    const frozen = store.$snapshot()
    off()
    check(
      '主入口真实用例通过',
      store.getState().count === 2 && seen === 2 && store.getter('doubled') === 4 && Object.isFrozen(frozen),
      `count=${store.getState().count} 通知=${seen} getter=${store.getter('doubled')} 快照 isFrozen=${Object.isFrozen(frozen)}`,
    )
  } catch (error) {
    check('主入口真实用例通过', false, error instanceof Error ? error.message : String(error))
  }
}

fs.rmSync(loadRoot, { recursive: true, force: true })
console.log(notes.join('\n'))
if (failures.length > 0) {
  console.error(`\n[verify-weapp] 失败 ${failures.length} 项：`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  console.error('[verify-weapp] 产物不可发布：修复后重跑 pnpm run build:weapp && pnpm run verify:weapp')
  process.exit(1)
}
console.log(`[verify-weapp] ${weappFiles.length} 个模块 / ${publicEntries.length} 个公开入口全部通过（镜像完整 / require 闭环 / 可加载 / 无 outsideDeps / 导出面对齐 / 单例同一 / 真实用例）`)
