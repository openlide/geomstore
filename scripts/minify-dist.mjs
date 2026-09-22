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
 * 压缩器按优先级自动探测：terser → esbuild。
 * terser 优先是因为它是本仓库唯一**显式声明**的压缩器（package.json devDependencies），
 * 版本被锁文件固定 → 发布产物可复现。esbuild 只作为已装 terser 不可用时的兜底，
 * 它并非本仓库依赖：实测 `require.resolve('esbuild')` 命中 node_modules/esbuild，
 * 那是 ts-jest 的 peer 依赖被 `nodeLinker: hoisted` 提升上来的幽灵依赖，
 * 装不装、装哪个版本都随依赖树变化——若把它排在前面，压缩器选择就不可复现
 * （这正是旧版文件头与探测顺序互相矛盾的地方）。
 * （不再兜底 uglify-js：它不支持 ESM/ES2015+ 语法，也忽略 terser 专有的 `module` 选项，
 * 对 tsc 产出的 ESM 几乎必然抛错，兜底分支形同虚设。）
 *
 * 两个后端共用同一份语义基准（见下方 ESBUILD_OPTIONS / TERSER_OPTIONS 的 ECMASCRIPT_TARGET），
 * 否则「换了个压缩器」会同时改变产物语法下限与注释留存策略。
 *
 * 失败分级：
 * - 探测不到压缩器 → 由 `--strict` 决定：默认（宽松，供本地 `build:min`）告警并跳过，
 *   不阻塞开发链路；`--strict`（供发布 `build:release`）报错并以退出码 1 中止，
 *   避免发布链路静默产出未压缩包（策略①的核心承诺是「发布即压缩」）。
 * - dist 无可压缩内容（没有 .js，或 .js 全是空文件）→ 同样走上面这条分级：
 *   它属「上游没产出」而非真实故障，宽松模式只告警并以退出码 0 结束，
 *   只有 `--strict` 才中止。
 * - dist 是符号链接/junction、压缩器存在但加载失败 → 一律退出码 1 中止，不走宽松降级：
 *   前两者意味着「构建没产出真实产物」，第三者是真实故障而非「没装」，静默跳过会发布出
 *   体积与内容都不符的包。
 * - dist 内有链接藏着未压缩的 js（指向 js 的链接、藏着 js 的目录链接）→ `--strict` 中止，
 *   因为「全部 js 已压缩」不再成立；与 js 无关的链接（断链、指向非 js 文件）只告警，
 *   没有东西可压就不该拦下发布。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(projectRoot, 'dist')

const reasonOf = (error) => (error instanceof Error ? error.message : String(error))

/** Windows 路径大小写不敏感（盘符 D:/d: 都可能出现），其余平台逐字符比较 */
function samePath(a, b) {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/**
 * 压缩器并发上限。两个后端共用它：一次性把整棵 dist 交给后端会让峰值内存随
 * 产物规模线性增长（esbuild 还会为这一批拉起 worker 池），而 terser 分支原本是
 * 严格串行的——换后端不该顺带换内存压力。备齐再落盘那条不变式（见 writeAll）
 * 决定了结果总量必然留在内存里，这里限的只是「同时在转换中的文件数」。
 */
const CONVERT_LIMIT = 8

/** 压缩目标的语法基准：必须与 tsconfig.json 的 `target`（ES2020）一致。
 *  两个后端共用它，才不会因换了压缩器而顺带改变产物的语法下限 */
const ECMASCRIPT_TARGET = 2020

/** terser 固定选项。`module:true` 保证导出名不被改；`mangle.toplevel` 与 esbuild
 *  的标识符压缩力度对齐（esbuild 会压顶层局部名，terser 默认不压）；
 *  `format.comments:false` 对应 esbuild 的 `legalComments:'none'`
 *  （terser 默认仍保留 `/*!` 形式的 legal 注释）。
 *  注意 `ecma` 只能给 compress/format：terser 的 mangle 选项集里没有它
 *  （那是 uglify-js 的键），传进去会以 DefaultsError: `ecma` is not a supported option 直接失败 */
const TERSER_OPTIONS = {
  module: true,
  compress: { ecma: ECMASCRIPT_TARGET },
  mangle: { toplevel: true },
  format: { ecma: ECMASCRIPT_TARGET, comments: false },
}

/** esbuild 等价选项。`format` 必须显式给 `esm`：隐式默认并非 esm，
 *  对 tsc 产出的 ESM 依赖默认值等于赌后端行为 */
const ESBUILD_OPTIONS = {
  loader: 'js',
  format: 'esm',
  target: `es${ECMASCRIPT_TARGET}`,
  minify: true,
  legalComments: 'none',
}

/**
 * 收集 dist 下的全部 JS。
 *
 * 只匹配 `.js`：本构建链是纯 tsc 且 src 无 .mts/.cts，产物实测只有 .js / .d.ts / .json；
 * 收 .mjs/.cjs 属于匹配永不存在的文件，留着只会误导后来的维护者。
 *
 * 符号链接**有意不跟随**（本脚本原地写回，跟随等于把压缩结果写到 dist 之外的真实目标，
 * 与 clean-dist 面对的同一类不可回滚风险），但必须按「它是否藏着一个没被压缩的 js」分类上报：
 * 否则「已压缩 dist 下全部 js」这句承诺会静默失真；反过来，一个指向 json 的链接、
 * 一个断链并没有漏掉任何东西，拿它去中止发布会是假阳性。
 */
function collectJs(dir, acc = { files: [], jsLinks: [], dirLinks: [], otherLinks: [] }) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    const kind = classifyEntry(full)
    if (kind === 'file') {
      if (entry.name.endsWith('.js')) acc.files.push(full)
      continue
    }
    if (kind === 'dir') {
      collectJs(full, acc)
      continue
    }
    // 'link'：指向目录时内部可能藏着 js，指向 js 文件本身就是个没压缩的模块，
    // 两者都破坏「全部 js 已压缩」；statSync 失败即断链，跟着走也没有可压内容。
    let targetIsDir = false
    try {
      targetIsDir = fs.statSync(full).isDirectory()
    } catch {
      targetIsDir = false
    }
    if (targetIsDir) acc.dirLinks.push(full)
    else if (entry.name.endsWith('.js')) acc.jsLinks.push(full)
    else acc.otherLinks.push(full)
  }
  return acc
}

/**
 * 条目分类：'link'（重解析点，绝不进入）| 'dir'（可递归的真实目录）| 'file'。
 *
 * lstat + realpath 双判据，理由同 clean-dist 的 classifyEntry：readdir 的 Dirent 与
 * lstat 在部分 Windows/Node 组合下会把 junction 报成普通目录，此时递归进去就会把
 * 压缩结果原地写到 dist 之外的真实落点。
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
 * dist 必须是「仓库内那个真实目录」。
 *
 * realpath 全等比较比「仍在项目根之内」更严：指向仓库内别处（例如被误改成指向 src）
 * 的链接/junction 同样拒绝。Windows junction 的 isSymbolicLink() 行为不稳定，
 * 而 realpathSync 一定会把重解析点解析掉，故以它为准。
 */
function assertRealDistDir() {
  const realDist = fs.realpathSync(distDir)
  const expected = path.join(fs.realpathSync(projectRoot), 'dist')
  if (!samePath(realDist, expected) || !fs.statSync(realDist).isDirectory()) {
    throw new Error(
      `dist 不是仓库内的真实目录（realpath=${realDist}，期望=${expected}）：` +
        '符号链接/junction 会让原地压缩写穿链接目标，已中止',
    )
  }
}

/**
 * 只把「确实没装这个包」当作探测失败。
 *
 * 光看 `code === 'MODULE_NOT_FOUND'` 太宽：包装着、但它自己的传递依赖解析不出来
 * （装坏了 / 半路删过 node_modules）也是同一个 code，而这条注释下面那句
 * 「真实故障必须中止」针对的正是它。Node 的 MODULE_NOT_FOUND 消息里点名了
 * 找不到的那个模块，所以按名字核对：不是它自己，就记录后抛出，
 * 由 main 的 catch 以退出码 1 中止，避免静默降级成「未找到压缩器」。
 */
function isMissingItself(error, name) {
  return (
    error?.code === 'MODULE_NOT_FOUND' &&
    typeof error.message === 'string' &&
    error.message.includes(`Cannot find module '${name}'`)
  )
}

function tryRequire(name) {
  try {
    return require(name)
  } catch (error) {
    if (isMissingItself(error, name)) return null
    console.error(`[minify-dist] ${name} 的加载失败不是「未安装 ${name}」（缺的是别的模块，或另有原因）：`, error)
    throw error
  }
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`

/**
 * 统一写盘：所有压缩结果先在内存中备齐，再一次性落盘。
 *
 * 「一次性」不等于原子：这仍是一串逐个执行的 writeFileSync，ENOSPC / EACCES /
 * 磁盘半路故障可能发生在中间某个文件上。所以每写成功一个就记下它的原文，
 * 一旦抛错就把**已经动过的**文件逐个还原回去，绝不让 dist 停在「一半已压缩」
 * 的状态（那正是文件头承诺不会出现的半成品）。只还原写成功的那些：写失败的那个
 * 内容根本没变，把它算进「必须手工恢复」会把一条干净的错误说成数据已损坏。
 * 还原本身再失败时必须点名到文件：那时 dist 确实是混合状态，只能由人重跑构建。
 */
function writeAll(outputs) {
  const written = []
  try {
    for (const { file, code, original } of outputs) {
      fs.writeFileSync(file, code)
      written.push({ file, original })
    }
  } catch (error) {
    const unrestored = []
    for (const { file, original } of written) {
      try {
        fs.writeFileSync(file, original)
      } catch (rollbackError) {
        unrestored.push(`${path.relative(projectRoot, file)}: ${reasonOf(rollbackError)}`)
      }
    }
    if (unrestored.length > 0) {
      console.error(
        `[minify-dist] 写盘失败后的还原同样失败，dist 已处于「一半压缩」的混合状态，` +
          `以下文件必须手工恢复（或直接重跑构建）：\n  ${unrestored.join('\n  ')}`,
      )
    }
    throw new Error(
      `压缩结果写盘失败（${reasonOf(error)}）；` +
        (unrestored.length > 0
          ? `${unrestored.length} 个文件未能还原`
          : `${written.length} 个已写入的文件已还原为压缩前内容`),
    )
  }
}

/**
 * 后端返回值的形状校验。
 *
 * 静默丢掉一个 code 为假值的文件，等于对外面那句「dist 下全部 js 已压缩」撒谎：
 * 非字符串（后端返回形状变了）一律抛错；压成空串只在「源文件本来就没有语句」
 * （空文件 / 只有注释与空白）时算合法结果，否则同样是异常。
 */
function requireCode(code, file, source, backend) {
  const where = path.relative(projectRoot, file)
  if (typeof code !== 'string') {
    throw new TypeError(`${backend} 对 ${where} 未返回字符串结果（实际为 ${String(code)}），已中止`)
  }
  if (code === '' && !isBlankOrComments(source)) {
    throw new Error(`${backend} 把非空文件 ${where} 压成了空内容，已中止`)
  }
  return code
}

/** 去掉块注释、行注释与空白后是否什么都不剩：只有这种文件压成空才算正常 */
function isBlankOrComments(source) {
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, '$1')
  return stripped.trim() === ''
}

/** 有界并发：最多 limit 个条目同时在转换中，结果按入参顺序返回 */
async function mapLimit(items, limit, convert) {
  const results = new Array(items.length)
  let cursor = 0
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await convert(items[index])
    }
  })
  await Promise.all(lanes)
  return results
}

async function minifyWithEsbuild(esbuild, files) {
  // 先全部转换、后统一写盘：中途抛错（语法异常、ENOSPC、EACCES）时 dist 保持原样，
  // 不会留下「一半已压缩、一半未压缩」的半成品（writeAll 还会把已落盘的还原回去）
  const outputs = await mapLimit(files, CONVERT_LIMIT, async (file) => {
    const source = fs.readFileSync(file, 'utf8')
    const result = await esbuild.transform(source, ESBUILD_OPTIONS)
    return { file, original: source, code: requireCode(result?.code, file, source, 'esbuild') }
  })
  writeAll(outputs)
}

async function minifyWithTerser(terser, files) {
  // 同 esbuild 分支：备齐再落盘，避免中途失败留下半成品
  const outputs = await mapLimit(files, CONVERT_LIMIT, async (file) => {
    const source = fs.readFileSync(file, 'utf8')
    const result = await terser.minify(source, TERSER_OPTIONS)
    return { file, original: source, code: requireCode(result?.code, file, source, 'terser') }
  })
  writeAll(outputs)
}

/**
 * 「没有可压缩内容」的中性出口：既不是压缩器缺失、也不是压缩失败，
 * 而是上游没产出 JS。宽松模式告警跳过，--strict 按发布失败中止。
 */
function bailNothingToDo(strict, reason) {
  if (strict) {
    console.error(`${reason}\n              --strict：发布链路要求必须有压缩产物，已中止。`)
    process.exitCode = 1
  } else {
    console.warn(`${reason}；跳过压缩。\n              SKIPPED：未压缩产物仍可正常发布；正式发布请用 build:release。`)
  }
}

async function main() {
  const strict = process.argv.includes('--strict')

  if (!fs.existsSync(distDir)) {
    console.error('[minify-dist] dist not found; run `pnpm build` first')
    process.exitCode = 1
    return
  }
  assertRealDistDir()

  const { files, jsLinks, dirLinks, otherLinks } = collectJs(distDir)

  // 「藏着没压缩的 js」与「跟 js 无关」必须分开判：一个指向 json 的链接、一个断链，
  // 没有任何可压缩内容被漏掉，用它们去中止发布是假阳性；而 js 链接与目录链接
  // 确实让「全部 js 已压缩」这句话不成立。
  const hidingUnminifiedJs = [...jsLinks, ...dirLinks]
  if (hidingUnminifiedJs.length > 0) {
    const detail = hidingUnminifiedJs.map((f) => `  ${path.relative(projectRoot, f)}`).join('\n')
    const reason =
      `[minify-dist] dist 内有 ${hidingUnminifiedJs.length} 个链接藏着未被压缩的 js` +
      `（指向 js 的 ${jsLinks.length} 个、指向目录的 ${dirLinks.length} 个）：\n${detail}`
    // 本地：如实上报后继续压缩其余真实文件（链接不跟随是有意策略，不算故障）
    // 发布：只要有 js 没被压缩，「全部 js 已压缩」就不成立，直接中止
    if (strict) {
      console.error(`${reason}\n              --strict：发布链路要求全部 js 均已压缩，已中止。`)
      process.exitCode = 1
      return
    }
    console.warn(`${reason}\n              WARN: 这些文件（及其内容）不在压缩范围内，请确认 dist 布局。`)
  }
  if (otherLinks.length > 0) {
    console.warn(
      `[minify-dist] dist 内有 ${otherLinks.length} 个链接与 js 无关（断链或指向非 js 文件），` +
        `按既定策略不跟随，不计入未压缩产物：\n  ${otherLinks.map((f) => path.relative(projectRoot, f)).join('\n  ')}`,
    )
  }

  // 先于压缩器探测判定：否则下面的 before/after 汇总会算出 0/0 → NaN%
  if (files.length === 0) {
    bailNothingToDo(strict, '[minify-dist] dist 下没有任何 .js 文件，上游构建似乎未产出')
    return
  }
  const before = files.reduce((sum, f) => sum + fs.statSync(f).size, 0)
  if (before === 0) {
    bailNothingToDo(strict, `[minify-dist] dist 下 ${files.length} 个 .js 文件全是空文件，无可压缩内容`)
    return
  }

  // 顺序即优先级：先声明依赖（terser），再幽灵依赖（esbuild）
  const terser = tryRequire('terser')
  const esbuild = terser ? null : tryRequire('esbuild')

  if (terser) {
    await minifyWithTerser(terser, files)
    console.log('[minify-dist] minifier: terser')
  } else if (esbuild) {
    await minifyWithEsbuild(esbuild, files)
    console.log('[minify-dist] minifier: esbuild')
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
  // before 已在上面保证 > 0，这里不再可能出现 NaN
  console.log(
    `[minify-dist] ${files.length} js files: ${kb(before)} -> ${kb(after)} ` +
      `(saved ${kb(saved)}, -${((saved / before) * 100).toFixed(1)}%)`,
  )
}

main().catch((error) => {
  console.error('[minify-dist] failed:', error)
  process.exitCode = 1
})
