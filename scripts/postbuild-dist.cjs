/**
 * 构建后处理脚本：
 * 1. 为 dist/cjs 与 dist/esm 写入模块类型标记
 * 2. 修复 ESM 产物中的相对导入说明符（补全 .js / index.js），
 *    同时修复 ESM 声明文件（.d.ts）中的相对导入说明符，
 *    使 node16 消费者能正确解析类型。
 * 3. 删除 dist 下的全部 sourcemap（.js.map / .d.ts.map）：
 *    包仅发布 dist（类型由 .d.ts 提供），map 文件指向未随包发布的
 *    src 目录会成为死链，仅徒增发布体积，故发布产物中剔除。
 * 4. 在包根生成子路径转发 stub 目录（store/、plugins/devtools/ 等）：
 *    微信小程序「构建 npm」等不支持 package.json exports 字段的解析器
 *    无法解析 @openlide/geomstore/xxx 子路径；stub 目录内 package.json
 *    的 main/module/types 指向 dist 内真实产物，使老式目录解析同样可达。
 *
 * 根 package.json 未声明 "type"（默认 commonjs）。ESM 产物目录需要
 * {"type":"module"} 标记，CJS 产物目录显式写入 {"type":"commonjs"}。
 * 源码使用无扩展名相对导入（对打包器友好），但 Node 原生 ESM
 * 要求完整文件路径，此处对 dist/esm 产物做说明符补全，
 * 使 ESM 产物同时兼容打包器与 Node 原生加载。
 */

const fs = require('fs')
const path = require('path')

const distDir = path.join(__dirname, '..', 'dist')

fs.mkdirSync(path.join(distDir, 'cjs'), { recursive: true })
fs.mkdirSync(path.join(distDir, 'esm'), { recursive: true })

fs.writeFileSync(path.join(distDir, 'cjs', 'package.json'), JSON.stringify({ type: 'commonjs' }, null, 2) + '\n')
fs.writeFileSync(path.join(distDir, 'esm', 'package.json'), JSON.stringify({ type: 'module' }, null, 2) + '\n')

// ==================== ESM 说明符修复 ====================

const esmDir = path.join(distDir, 'esm')

function collectFiles(dir, ext, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectFiles(full, ext, files)
    } else if (entry.name.endsWith(ext)) {
      files.push(full)
    }
  }
  return files
}

/** 将相对说明符解析为完整的 ESM 路径（补 .js 或 /index.js） */
function resolveSpecifier(fileDir, spec) {
  if (!spec.startsWith('./') && !spec.startsWith('../')) {
    return spec
  }
  const base = path.resolve(fileDir, spec)
  if (fs.existsSync(base + '.js')) {
    return spec + '.js'
  }
  if (fs.existsSync(path.join(base, 'index.js'))) {
    return spec.endsWith('/') ? spec + 'index.js' : spec + '/index.js'
  }
  return spec
}

// 匹配 import/export ... from '<相对路径>' 及副作用导入 import '<相对路径>'
const specifierPattern = /(\bfrom\s*|\bimport\s*)(['"])(\.{1,2}\/[^'"]*)\2/g

/** 修复指定目录下所有匹配文件（.js 与 .d.ts）的相对导入说明符 */
function fixSpecifiers(dir, ext) {
  let rewritten = 0
  for (const file of collectFiles(dir, ext)) {
    const content = fs.readFileSync(file, 'utf8')
    const fileDir = path.dirname(file)
    const fixed = content.replace(specifierPattern, (match, prefix, quote, spec) => {
      return prefix + quote + resolveSpecifier(fileDir, spec) + quote
    })
    if (fixed !== content) {
      fs.writeFileSync(file, fixed)
      rewritten++
    }
  }
  return rewritten
}

const rewrittenJs = fixSpecifiers(esmDir, '.js')
const rewrittenDts = fixSpecifiers(esmDir, '.d.ts')

// ==================== 剔除 sourcemap ====================

let removedMaps = 0
for (const mapFile of collectFiles(distDir, '.map')) {
  fs.rmSync(mapFile)
  removedMaps++
}

console.log(
  `[postbuild] dist module-type markers written; ESM specifiers fixed in ${rewrittenJs} js files and ${rewrittenDts} d.ts files; removed ${removedMaps} sourcemap files`,
)

// ==================== 子路径转发 stub ====================

/** 子路径 -> dist 内相对目录（与 package.json exports 字段一一对应） */
const subpathEntries = {
  store: 'core/store',
  hooks: 'core/hooks',
  plugins: 'plugins',
  'plugins/devtools': 'plugins/devtools',
  'plugins/performance': 'plugins/performance',
  integrations: 'integrations',
  'integrations/enterprise': 'integrations/enterprise',
  error: 'core/error',
  compose: 'core/compose',
  selectors: 'core/selector',
  snapshot: 'core/snapshot',
  performance: 'core/performance',
  actions: 'core/action',
  cache: 'core/cache',
}

const pkgRoot = path.join(__dirname, '..')
let stubDirs = 0
for (const [sub, rel] of Object.entries(subpathEntries)) {
  const dir = path.join(pkgRoot, sub)
  fs.mkdirSync(dir, { recursive: true })
  const relFrom = (root, file) => path.relative(dir, path.join(root, rel, file)).replace(/\\/g, '/')
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify(
      {
        main: relFrom(path.join(distDir, 'cjs'), 'index.js'),
        module: relFrom(path.join(distDir, 'esm'), 'index.js'),
        types: relFrom(path.join(distDir, 'cjs'), 'index.d.ts'),
      },
      null,
      2,
    ) + '\n',
  )
  stubDirs++
}

console.log(`[postbuild] ...; generated ${stubDirs} subpath stub dirs`)
