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
 * - dist 无可压缩内容、dist 是符号链接/junction、压缩器存在但加载失败
 *   → 一律退出码 1 中止，不走宽松降级：前两者意味着「构建没产出真实产物」，
 *   第三者是真实故障而非「没装」，静默跳过会发布出体积与内容都不符的包。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(projectRoot, 'dist')

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
 * 与 clean-dist 面对的同一类不可回滚风险），但必须收集出来上报：
 * 否则「已压缩 dist 下全部 js」这句承诺会静默失真。
 */
function collectJs(dir, acc = { files: [], links: [] }) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectJs(full, acc)
    } else if (entry.isSymbolicLink()) {
      acc.links.push(full)
    } else if (entry.name.endsWith('.js')) {
      acc.files.push(full)
    }
  }
  return acc
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
  // Windows 下路径大小写不敏感（盘符 D:/d: 都可能），直接 === 会误判
  const same =
    process.platform === 'win32' ? realDist.toLowerCase() === expected.toLowerCase() : realDist === expected
  if (!same || !fs.statSync(realDist).isDirectory()) {
    throw new Error(
      `dist 不是仓库内的真实目录（realpath=${realDist}，期望=${expected}）：` +
        '符号链接/junction 会让原地压缩写穿链接目标，已中止',
    )
  }
}

/**
 * 只把「确实没装」当作探测失败（MODULE_NOT_FOUND）。
 * 包存在但加载失败（缺本机 binding、包体损坏）是真实故障，
 * 静默降级成「未找到压缩器」会让发布链路产出不符预期的包，故记录后抛出，
 * 由 main 的 catch 以退出码 1 中止。
 */
function tryRequire(name) {
  try {
    return require(name)
  } catch (error) {
    if (error?.code === 'MODULE_NOT_FOUND') return null
    console.error(`[minify-dist] ${name} 存在但加载失败（非「未安装」）：`, error)
    throw error
  }
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`

/** 统一写盘：所有压缩结果先在内存中备齐，再一次性落盘 */
function writeAll(outputs) {
  for (const { file, code } of outputs) {
    fs.writeFileSync(file, code)
  }
}

async function minifyWithEsbuild(esbuild, files) {
  // 先全部转换、后统一写盘：中途抛错（语法异常、ENOSPC、EACCES）时 dist 保持原样，
  // 不会留下「一半已压缩、一半未压缩」且仍被报告为成功的半成品
  const outputs = await Promise.all(
    files.map(async (file) => {
      const source = fs.readFileSync(file, 'utf8')
      const result = await esbuild.transform(source, ESBUILD_OPTIONS)
      return { file, code: result.code }
    }),
  )
  writeAll(outputs)
}

async function minifyWithTerser(terser, files) {
  // 同 esbuild 分支：备齐再落盘，避免中途失败留下半成品
  const outputs = []
  for (const file of files) {
    const result = await terser.minify(fs.readFileSync(file, 'utf8'), TERSER_OPTIONS)
    if (result.code) outputs.push({ file, code: result.code })
  }
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

  const { files, links } = collectJs(distDir)

  if (links.length > 0) {
    const detail = links.map((f) => `  ${path.relative(projectRoot, f)}`).join('\n')
    const reason = `[minify-dist] dist 内有 ${links.length} 个符号链接未被压缩：\n${detail}`
    // 本地：如实上报后继续压缩其余真实文件（链接不跟随是有意策略，不算故障）
    // 发布：只要有 js 没被压缩，「全部 js 已压缩」就不成立，直接中止
    if (strict) {
      console.error(`${reason}\n              --strict：发布链路要求全部 js 均已压缩，已中止。`)
      process.exitCode = 1
      return
    }
    console.warn(`${reason}\n              WARN: 这些文件（及其内容）不在压缩范围内，请确认 dist 布局。`)
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
