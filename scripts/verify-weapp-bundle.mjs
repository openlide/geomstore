/**
 * dist-weapp 产物门禁：把「微信侧能不能用」变成一条会失败的命令，而不是发布后的人工验证。
 *
 * 0.6.0 的事故里，坏产物是**能发布成功**的——`pnpm test` / `build` / `pack` 全绿，
 * 因为没有任何一步真正加载过「要被微信拷走的那份文件」。本脚本补的就是这一环，
 * 逐项对应 docs/WECHAT_NPM_FIX.md 里事后手工排查出来的缺陷特征：
 *
 * 1. 结构：每个公开子路径都要有对应产物文件，非零字节；
 * 2. 缺陷 A：语法必须可解析（真实 `require` 加载，等价于 `node --check` 但更强）；
 * 3. 缺陷 B：文件里既不得出现 `outsideDeps` 标记，也不得出现任何 `require(...)`
 *    ——自包含单文件没有可被错标的外部依赖，出现即说明 bundle 没生效；
 * 4. 不得残留 ESM 语法（微信运行时按 CJS 处理，`export` 关键字会直接炸）；
 * 5. 与 dist 的导出面逐项一致（少一个导出＝少一个 API）；
 * 6. 主入口跑一次真实用例（createStore / dispatch / subscribe / $snapshot / composeStore）。
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
const require_ = createRequire(pathToFileURL(path.join(projectRoot, 'package.json')))
const OUT_DIR = 'dist-weapp'

/**
 * 加载区：把产物复制到临时目录并改名为 `.cjs` 再 require。
 *
 * 本包根 `package.json` 是 `"type": "module"`，Node 会把仓库内任何 `.js` 当 ESM，
 * 直接 require dist-weapp/*.js 会以「module is not defined in ES module scope」失败——
 * 那是 **Node 的扩展名规则**，不是产物缺陷。而微信侧的运行时无此规则（它按 CJS 包装
 * miniprogram_npm 里的文件），所以这里换 `.cjs` 后缀加载，验的仍是同一份字节。
 */
const loadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geomstore-weapp-verify-'))
/** 子路径名 → 临时 `.cjs` 文件（把分隔符折进文件名，避免同名 index.js 互相覆盖） */
const cjsMirror = (outFile) => path.join(loadDir, `${outFile.replace(`${OUT_DIR}${path.sep}`, '').replace(/[\\/]/g, '_')}.cjs`)

const failures = []
const notes = []

/** 断言式记账：不抛错、不提前退出，一次跑完给出全部问题，避免「修一个看一眼」的循环 */
function check(label, ok, detail) {
  if (ok) notes.push(`  ok   ${label}${detail ? ` — ${detail}` : ''}`)
  else failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
}

let entries
try {
  entries = collectWeappEntries(projectRoot, OUT_DIR)
} catch (error) {
  console.error(`[verify-weapp] 入口清单无法确定：${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

check('dist-weapp 目录存在', fs.existsSync(path.join(projectRoot, OUT_DIR)), `缺失时先跑 pnpm run build:weapp`)
if (failures.length > 0) {
  console.error(`[verify-weapp] 已中止：${failures[0]}`)
  fs.rmSync(loadDir, { recursive: true, force: true })
  process.exit(1)
}

/** 主入口必须存在的公开 API（0.6.0 事故中被缺陷 B 整块吃掉的那几个） */
const REQUIRED_FUNCTION_EXPORTS = ['createStore', 'isGeomStore', 'composeStore', 'withPageStore', 'withComponentStore', 'withAppStore']

for (const entry of entries) {
  const abs = path.join(projectRoot, entry.outFile)
  if (!fs.existsSync(abs)) {
    check(`${entry.sub} 产物存在`, false, `缺 ${entry.outFile}`)
    continue
  }
  const text = fs.readFileSync(abs, 'utf8')
  const size = fs.statSync(abs).size
  check(`${entry.sub} 非空产物`, size > 0, `${(size / 1024).toFixed(1)} KB`)

  const outside = text.indexOf('outsideDeps')
  check(`${entry.sub} 无 outsideDeps 标记`, outside === -1, outside === -1 ? undefined : `命中于第 ${text.slice(0, outside).split('\n').length} 行`)

  const requires = text.match(/\brequire\(\s*['"][^'"]+['"]\s*\)/g) || []
  check(`${entry.sub} 零 require（自包含）`, requires.length === 0, requires.length === 0 ? undefined : `发现 ${requires.length} 处：${requires.slice(0, 3).join(' ')}`)

  const esmLeft = /^\s*(?:export|import)[\s{*(]/m.test(text)
  check(`${entry.sub} 无残留 ESM 语法`, !esmLeft, esmLeft ? '仍含顶层 export/import' : undefined)

  // 真实加载：语法坏（缺陷 A 的 `Unexpected identifier`）会在这里抛出
  let mod = null
  const mirror = cjsMirror(abs)
  try {
    fs.copyFileSync(abs, mirror)
    mod = require_(mirror)
  } catch (error) {
    check(`${entry.sub} 可被 CJS 加载`, false, error instanceof Error ? error.message : String(error))
  } finally {
    fs.rmSync(mirror, { force: true })
  }
  if (!mod) continue

  // 与 ESM 产物的导出面逐项对齐
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

  if (entry.sub === '.') {
    const notFn = REQUIRED_FUNCTION_EXPORTS.filter((k) => typeof mod[k] !== 'function')
    check('主入口关键 API 均为函数', notFn.length === 0, notFn.length ? `不是函数：${notFn.join(', ')}` : REQUIRED_FUNCTION_EXPORTS.join(', '))

    try {
      const store = mod.createStore({
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
      let threw = false
      try {
        frozen.count = 99
      } catch {
        threw = true
      }
      off()
      check(
        '主入口真实用例通过',
        store.getState().count === 2 && seen === 2 && store.getter('doubled') === 4 && threw,
        `count=${store.getState().count} 通知=${seen} getter=${store.getter('doubled')} 快照只读=${threw}`,
      )
    } catch (error) {
      check('主入口真实用例通过', false, error instanceof Error ? error.message : String(error))
    }
  }
}

console.log(notes.join('\n'))
fs.rmSync(loadDir, { recursive: true, force: true })
if (failures.length > 0) {
  console.error(`\n[verify-weapp] 失败 ${failures.length} 项：`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  console.error('[verify-weapp] 产物不可发布：修复后重跑 pnpm run build:weapp && pnpm run verify:weapp')
  process.exit(1)
}
console.log(`[verify-weapp] ${entries.length} 个入口全部通过（结构 / 可加载 / 零 require / 无 outsideDeps / 导出面对齐 / 真实用例）`)
