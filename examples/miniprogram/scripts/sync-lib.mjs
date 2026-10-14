/**
 * 把仓库根构建好的小程序产物（`dist-weapp/**`）变成 demo 能 `require('@openlide/geomstore')` 的形态
 *
 * 为什么不是「直接拷进 miniprogram_npm」就完事：
 * 小程序的 npm 包必须由开发者工具「构建 npm」登记过才能按包名解析。手动往
 * `miniprogram_npm/<包名>/` 里放文件，工具并不认——实测 app 里 `require('@openlide/geomstore')`
 * 报 `module '@openlide/geomstore.js' is not defined`，而文件明明就在那儿。
 *
 * 所以本脚本产出的是**一个完整 npm 包**（而不是散装文件），再交给 `scripts/build-npm.mjs`
 * 走正式的构建 npm 流程：
 *
 *   vendor/geomstore/
 *   ├── package.json          ← 含 `miniprogram: "dist-weapp"`，与发布包同构
 *   └── dist-weapp/**         ← 会被构建 npm 原样拷进 miniprogram_npm 的那份字节
 *
 * `miniprogram` 字段是这里的关键：缺了它，构建 npm 会把包当成待编译源码重新打包，
 * 实测 89 个文件被压成单个 `index.js`，子路径入口（`/extras/plugins`、`/integrations`）全丢。
 * 因此这个 demo 顺带验证了「发布包的 miniprogram 字段确实被微信正确消费」——
 * 这正是发版前最容易出问题、而 Node 侧完全测不到的一环。
 *
 * 同时向 `node_modules/@openlide/geomstore` 放一份同样的文件，让 `npm run e2e`
 * 不必先跑 `npm install` 也能工作（跑过 install 则由 `.npmrc` 的 install-links 保证
 * 复制而非软链，结果一致）。
 *
 * 用法：node scripts/sync-lib.mjs
 */

import { mkdir, readFile, readdir, rm, writeFile, access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const demoRoot = path.resolve(here, '..')
const repoRoot = path.resolve(demoRoot, '../..')
const source = path.join(repoRoot, 'dist-weapp')

const vendorPkg = path.join(demoRoot, 'vendor', 'geomstore')
const vendorDist = path.join(vendorPkg, 'dist-weapp')
const nodeModulesPkg = path.join(demoRoot, 'node_modules', '@openlide', 'geomstore')

const exists = async (p) => {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

if (!(await exists(source))) {
  console.error(`[sync-lib] 找不到 ${path.relative(repoRoot, source)}，先在仓库根执行：`)
  console.error('  pnpm build:weapp && pnpm verify:weapp')
  process.exit(1)
}

const version = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8')).version
const manifest = `${JSON.stringify(
  {
    name: '@openlide/geomstore',
    version,
    description: '本地构建产物（由 scripts/sync-lib.mjs 从 dist-weapp 组装，勿手改）',
    // 必须与发布包一致：main 指向 Node 侧入口，miniprogram 指向小程序侧产物目录
    main: 'dist/index.js',
    miniprogram: 'dist-weapp',
  },
  null,
  2,
)}\n`

/** 相对路径清单，用于比对出「源里已不存在」的孤儿文件 */
const listFiles = async (root, prefix = '') => {
  const entries = await readdir(path.join(root, prefix), { withFileTypes: true })
  const out = []
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      out.push(...(await listFiles(root, rel)))
    } else {
      out.push(rel)
    }
  }
  return out
}

/** 目标文件与源一致则跳过，返回「写入 / 未变 / 孤儿」三类的数量 */
const syncTree = async (srcRoot, destRoot) => {
  const sourceFiles = await listFiles(srcRoot)
  let written = 0
  for (const rel of sourceFiles) {
    const srcPath = path.join(srcRoot, rel)
    const destPath = path.join(destRoot, rel)
    await mkdir(path.dirname(destPath), { recursive: true })
    let identical = false
    try {
      const [a, b] = await Promise.all([readFile(srcPath), readFile(destPath)])
      identical = a.equals(b)
    } catch {
      identical = false
    }
    if (identical) continue
    await writeFile(destPath, await readFile(srcPath), 'utf8')
    written += 1
  }

  // 孤儿：源里已不存在的文件。产物文件名稳定，通常是 0 个，真有也只是个别改名残留
  const stale = (await listFiles(destRoot)).filter((rel) => !sourceFiles.includes(rel))
  for (const rel of stale) {
    await rm(path.join(destRoot, rel), { force: true })
  }
  return { total: sourceFiles.length, written, stale: stale.length }
}

/**
 * 同步到一处目标目录
 *
 * 刻意**不做整目录删除、也不无脑覆盖**：
 * ① 部分执行环境对批量删除有保护，清空目录会在中途失败并留下半残包；
 * ② `cp --force` 的覆盖在实现上是「先删再写」，同样会撞上同一类保护，
 *    且会让 IDE 把所有文件都当成变更重新编译。
 * 所以改成逐文件比对内容，只写真正变了的那些。
 */
const refresh = async (target) => {
  await mkdir(target, { recursive: true })
  const result = await syncTree(source, path.join(target, 'dist-weapp'))
  await writeFile(path.join(target, 'package.json'), manifest, 'utf8')
  return result
}

const v = await refresh(vendorPkg)
const n = await refresh(nodeModulesPkg)
console.log(`[sync-lib] version=${version} → vendor/geomstore（${v.written}/${v.total} 变更）`)
console.log(`[sync-lib] version=${version} → node_modules/@openlide/geomstore（${n.written}/${n.total} 变更）`)
if (v.stale || n.stale) {
  console.log(`[sync-lib] 清理上一轮残留：vendor ${v.stale} 个 / node_modules ${n.stale} 个`)
}
console.log('[sync-lib] 下一步：npm run build:npm（或直接 npm run e2e，它会自动带上这两步）')
