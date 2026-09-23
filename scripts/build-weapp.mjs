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
 * dist-weapp 停留在上一次构建的尸体上，而 `miniprogram` 字段正指着它。同一口径下，清空旧产物
 * 这一步也做了两件事：①删之前以 realpath 全等确认 `dist-weapp` 是仓库内那个真实目录（它是这条链
 * 里最容易被外部换成 junction/软链的目录，跟进链接删文件不可回滚），②删除走自底向上的
 * unlink/rmdir、链接只删自身，与姊妹脚本 clean-dist.mjs 对 dist 的口径一致。
 *
 * 产物校验是双向的：模块 → 产物一个不能少，产物 → 模块也不能多（多出来的文件会随 `files`
 * 白名单整目录进小程序包），并以 `dist/` 为镜像基准 —— 所以本脚本要求 `dist` 已存在。
 *
 * 用法：`pnpm run build:weapp`（发布链里由 prepublishOnly 串在 build:release 之后，随后 verify:weapp 把关）
 */

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { collectWeappEntries, collectSourceModules } from './weapp-entries.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require_ = createRequire(import.meta.url)
const OUT_DIR = 'dist-weapp'
const outAbs = path.join(projectRoot, OUT_DIR)
/** tsc 的产物目录：判定「dist-weapp 有没有多出文件」的唯一参照（见文件末尾的镜像校验） */
const distAbs = path.join(projectRoot, 'dist')
/** 与 tsconfig 的 target 一致（`target/lib: ES2020`），不额外降版本以免与 dist 的语义分叉 */
const TARGET = 'es2020'

const reasonOf = (error) => (error instanceof Error ? error.message : String(error))

function fail(message) {
  console.error(`[build-weapp] 已中止：${message}`)
  process.exit(1)
}

/** 路径等价判定：Windows 大小写不敏感，盘符 D: / d: 都可能出现 */
function samePath(a, b) {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/** lstat 版存在性判定：不存在返回 null，其余错误照抛（调用方按「状态不可确认」处理） */
function lstatOrNull(target) {
  try {
    return fs.lstatSync(target)
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null
    throw error
  }
}

/**
 * 条目分类：'link'（重解析点，只删链接本身）| 'dir'（真实目录，可递归）| 'file'。
 *
 * lstat + realpath 双重判定：只信其一都不够——readdir 的 Dirent 与 lstat 在部分
 * Windows/Node 组合下会把 junction 报告成普通目录，此时递归就会删掉链接目标（可能在仓库
 * 之外）里的真实文件。realpath 失败时按 'link' 处理：判不准时宁可留下残留（下面一律
 * 硬失败），也不能冒删错目录的风险。
 */
function classifyEntry(full) {
  const stat = fs.lstatSync(full)
  if (stat.isSymbolicLink()) return 'link'
  if (!stat.isDirectory()) return 'file'
  let real
  try {
    real = fs.realpathSync(full)
  } catch {
    return 'link'
  }
  return samePath(real, path.resolve(full)) ? 'dir' : 'link'
}

/**
 * 删除重解析点本身（符号链接 / junction），绝不进入其目标。
 * Windows 上目录型链接用 unlink 会 EPERM、rmdir 才是删链接；POSIX 上反过来，
 * 故先 unlink、失败再 rmdir，两者都失败时抛出 unlink 的错误（更接近真实原因）。
 */
function removeLink(full) {
  try {
    fs.unlinkSync(full)
  } catch (unlinkError) {
    try {
      fs.rmdirSync(full)
    } catch {
      throw unlinkError
    }
  }
}

/**
 * 自底向上删除目录树：逐个 `unlinkSync` + 目录 `rmdirSync`。
 *
 * `checkRoot` 只由顶层调用传 true：在动第一个文件之前重做一遍可信校验，让「判定」与
 * 「不可回滚的删除」不可分离——校验与删除之间隔着 esbuild 之前那几步读取，这段时间足够
 * 另一个进程把目录换成链接（TOCTOU）。
 */
function removeDirTree(dir, checkRoot = false) {
  if (checkRoot) {
    const untrusted = rejectUntrustedTarget()
    if (untrusted) abortUntrusted(untrusted)
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    // 顶层守卫只覆盖产物目录本身：内部的链接同样指向别处，必须逐条按 classifyEntry 处理
    const kind = classifyEntry(full)
    if (kind === 'link') {
      removeLink(full)
    } else if (kind === 'dir') {
      removeDirTree(full)
      fs.rmdirSync(full)
    } else {
      fs.unlinkSync(full)
    }
  }
}

/**
 * 确认 `dist-weapp` 就是「仓库内那个真实目录」，返回 null 或人可读的拒绝理由。
 *
 * 删除不可回滚，所以判定取 realpath 全等而不是「仍在项目根之内」：被换成指向仓库内别处
 * （例如 src）的重解析点同样必须拒绝。junction 的 `lstat().isSymbolicLink()` 行为不稳定，
 * realpathSync 则一定解析重解析点，故以 realpath 为准。
 * 这一串解析调用全都兜住：本函数的契约是「返回理由或 null」，realpath/lstat 在竞态、
 * EACCES、断链下会抛错，未捕获就等于用一条内部栈取代「目标不可信 → 退出码 1 + 可执行建议」。
 */
function rejectUntrustedTarget() {
  try {
    const realOut = fs.realpathSync(outAbs)
    const expected = path.join(fs.realpathSync(projectRoot), OUT_DIR)
    if (!samePath(realOut, expected)) {
      const via = fs.lstatSync(outAbs).isSymbolicLink() ? '符号链接' : '链接或 junction'
      return `${OUT_DIR} 是${via}，真实落点为 ${realOut}（期望 ${expected}）`
    }
    if (!fs.statSync(realOut).isDirectory()) {
      return `${OUT_DIR} 不是目录，而是文件：${realOut}`
    }
    return null
  } catch (error) {
    return `${OUT_DIR} 的真实路径无法确认（${reasonOf(error)}），可能是断链或已被并发删除`
  }
}

/** 不可信目标的统一出口：无论哪一道校验失败，文案与退出码都必须一致 */
function abortUntrusted(reason) {
  console.error(
    `[build-weapp] 已中止：${reason}。\n` +
      `            这一层删除不可回滚，且后果随 Node 版本而异：递归删除要么跟进链接目标、逐个删掉里面的\n` +
      `            真实文件（可能在仓库之外），要么把链接本身换成本地新建的真实目录（开发者工具的产物\n` +
      `            映射就此静默失效）。两种都不该由一次构建替你决定。\n` +
      `            请让 ${OUT_DIR} 恢复为仓库内的真实目录后再构建（微信开发者工具 / demo 工程若要用同一份\n` +
      `            产物，请改成拷贝，或在工具侧配置输出目录，不要把 ${OUT_DIR} 换成软链 / junction）。`,
  )
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
// 少清一次就把「源里已删除的模块」一起发布出去。
//
// 删除不走 `fs.rmSync(dir, { recursive: true, force: true })`：Node 的递归删除按 lstat 判目录，
// 而 Windows 上的目录型 reparse point（junction）在 lstat 下会被报成普通目录，rm -r 于是跟进
// 目标目录逐个删文件。`dist-weapp` 恰是这条链里最容易被外部换成链接的目录（微信开发者工具的
// 「构建 npm」产物目录、demo 工程软链复用同一份产物都是常规做法）。口径对齐姊妹脚本
// clean-dist.mjs 对 dist 的处理：realpath 全等确认目标是仓库内那个真实目录（判定与删除不可
// 分离），再用自底向上的 unlink/rmdir，链接只删自身、绝不跟随进目标。
//
// 与 clean-dist 唯一的差别是失败分级：那里「没清干净」只告警（残留属未清理干净，不是构建错误），
// 这里 `miniprogram` 字段正指着本目录，混着尸体的产物会被直接发布，所以一律退出码 1
// ——与本脚本对 esbuild 缺失的口径一致。
let outExists = false
try {
  // 用 lstat 而不是 existsSync 判存在：existsSync 跟随链接，断链的产物目录会被当成
  // 「不存在」而跳过可信校验，把那个链接留给 esbuild 去跟随（写穿到链接目标）
  outExists = lstatOrNull(outAbs) !== null
} catch (error) {
  abortUntrusted(`${OUT_DIR} 的状态无法确认（${reasonOf(error)}）`)
}
if (outExists) {
  const untrusted = rejectUntrustedTarget()
  if (untrusted) abortUntrusted(untrusted)
  try {
    removeDirTree(outAbs, true)
    fs.rmdirSync(outAbs)
  } catch (error) {
    fail(`未能清空 ${OUT_DIR}（${reasonOf(error)}）——残留会与本次产物一起被整目录拷进小程序包`)
  }
  // 后置校验：结论不能只由「有没有抛错」推断，以目录是否真的消失为准
  let cleared = true
  try {
    cleared = lstatOrNull(outAbs) === null
  } catch {
    cleared = false // 连 lstat 都读不动，同样按「还在」处理
  }
  if (!cleared) fail(`${OUT_DIR} 未被清空，目录仍然存在，本次产物会与上一次构建的尸体混在一起`)
}

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

/** 源模块 → 产物相对路径（`src/x/y.ts` → `x/y.js`）：一一对应关系在此单点定义 */
function outRelOf(moduleRel) {
  return moduleRel.slice('src/'.length).replace(/\.ts$/, '.js')
}

/**
 * 相对路径统一按 POSIX 风格比对。
 *
 * `collectSourceModules` 交回的是 `src/x/y.ts`（它自己做过 `split(path.sep).join('/')`），
 * 而 `path.relative` 在 Windows 上给 `x\y.js`——不同源的两侧直接比会把每个产物都误报成
 * 「对不上」（实测：本函数补上之前那次跑法把 105 个文件全报成多出）。
 */
function posixRel(from, to) {
  return path.relative(from, to).split(path.sep).join('/')
}

/** 递归收集目录下全部 .js（绝对路径）；目录不可读时抛错，由调用方决定后果 */
function listJsFiles(dir) {
  const out = []
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.js')) out.push(full)
    }
  }
  walk(dir)
  return out
}

// 产物必须与源模块一一对应：漏一个模块，运行时就是一条解析失败的 require；多一个文件，
// 它会随 `files` 白名单整目录进小程序包（体积 + 早已废弃的实现仍可达）。原先只做「少了没」
// 这一半，而文件数统计只写进 console.log、没有任何一处断言二者相等。
const emitted = modules.map((m) => outRelOf(m))
const missingModules = emitted.filter((rel) => !fs.existsSync(path.join(outAbs, rel)))
if (missingModules.length > 0) fail(`以下模块没有产出对应产物：${missingModules.join(', ')}`)
for (const e of publicEntries) {
  if (!fs.existsSync(path.join(projectRoot, e.outFile))) fail(`esbuild 报成功但未产出公开子路径 ${e.sub} 的入口 ${e.outFile}`)
}

const files = listJsFiles(outAbs)
const emittedSet = new Set(emitted)
const strayFiles = files.map((f) => posixRel(outAbs, f)).filter((rel) => !emittedSet.has(rel))
if (strayFiles.length > 0) {
  fail(`${OUT_DIR} 里多出 ${strayFiles.length} 个在 src 下没有对应模块的 js：${strayFiles.join(', ')}。清理步骤没跑干净，或模块收集与本脚本的产物映射不一致`)
}

// 与 tsc 产物对镜像（dist-weapp ⊆ dist）：`collectSourceModules` 收的是 src 下**全部** .ts
// （只排 .d.ts），而 tsc 的 include/exclude 还会排掉 `**/*.example.ts` 这一类——有人按基线
// 加一个 `src/xxx.example.ts`，它就会一比一转译进 dist-weapp、随 `files` 白名单发布并计入
// 小程序包体积，而 dist 里没有对应文件（那句「本仓库没有非 .ts 的运行时源文件，文件数可以
// 当校验用」的前提也随之失效）。反方向（dist ⊆ dist-weapp）由 verify-weapp-bundle.mjs 的
// 「产物镜像 dist 完整」把关。
// dist 读不到 ⟹ 本项无从校验，硬失败而不是静默跳过：发布链里 build:release 就跑在前面，
// 跳过的话这条防线在最需要它的「手工补跑」场景里恰好不存在
let distJs
try {
  distJs = new Set(listJsFiles(distAbs).map((f) => posixRel(distAbs, f)))
} catch (error) {
  fail(`无法读取 dist/ 作为镜像基准（${reasonOf(error)}）。请先 pnpm run build 产出 dist，再跑 build:weapp`)
}
const beyondDist = files.map((f) => posixRel(outAbs, f)).filter((rel) => !distJs.has(rel))
if (beyondDist.length > 0) {
  fail(
    `${OUT_DIR} 里有 ${beyondDist.length} 个 js 在 dist 下没有对应产物：${beyondDist.join(', ')}。` +
      '多半是模块收集与 tsc 的 include/exclude 不同源（例如 tsconfig 排除的 *.example.ts 仍被当运行模块转译）'
  )
}

const total = files.reduce((sum, f) => sum + fs.statSync(f).size, 0)
console.log(`[build-weapp] ${modules.length} 个模块 → ${files.length} 个 js（合计 ${(total / 1024).toFixed(1)} KB，target=${TARGET}，minify，保留相对 require）`)
console.log(`[build-weapp] 公开子路径 ${publicEntries.length} 个入口全部就位，最大 3 个：`)
for (const f of files.map((f) => [f, fs.statSync(f).size]).sort((a, b) => b[1] - a[1]).slice(0, 3)) {
  console.log(`[build-weapp]   ${path.relative(projectRoot, f[0]).padEnd(40)} ${(f[1] / 1024).toFixed(1).padStart(7)} KB`)
}
