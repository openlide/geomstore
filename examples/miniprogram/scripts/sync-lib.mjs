/**
 * 把仓库根构建好的小程序产物（`dist-weapp/**`）同步到 demo 的 npm 引用位置
 * `examples/miniprogram/miniprogram_npm/@openlide/geomstore/`，并补一个最小 package.json。
 *
 * 为什么需要这一步：
 * - 小程序 require npm 包时读的是 `miniprogram_npm/<包名>` 下的文件；
 * - 本仓库的 `dist-weapp` 是发布给小程序的那一份字节（minify + 保留相对 require），
 *   demo 直接吃它，才能验证「真正会被微信构建 npm 拷走的那份产物」是否正确；
 * - 刻意不做「清空目录再复制」，两个理由：
 *   ① 某些执行环境对整目录删除有保护，清空会在中途失败、留下半残包；
 *   ② 覆盖式复制足够安全——文件集是构建产物，改名由 build:weapp 负责。
 *
 * 用法：node examples/miniprogram/scripts/sync-lib.mjs
 */

import { cp, mkdir, writeFile, access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const demoRoot = path.resolve(here, '..')
const repoRoot = path.resolve(demoRoot, '../..')
const source = path.join(repoRoot, 'dist-weapp')
const target = path.join(demoRoot, 'miniprogram_npm', '@openlide', 'geomstore')

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

await mkdir(path.dirname(target), { recursive: true })
await cp(source, target, { recursive: true, force: true })

const version = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(repoRoot, 'package.json'), 'utf8')).version
await writeFile(
  path.join(target, 'package.json'),
  `${JSON.stringify(
    {
      // 必须与 geomstore 的发布包名一致：`require('@openlide/geomstore')` 才会解析到这里
      name: '@openlide/geomstore',
      version,
      description: '本地构建产物（由 scripts/sync-lib.mjs 从 dist-weapp 复制，勿手改）',
      main: 'index.js',
    },
    null,
    2,
  )}\n`,
  'utf8',
)

const count = await (await import('node:fs/promises')).readdir(target, { recursive: true })
console.log(`[sync-lib] dist-weapp → miniprogram_npm/@openlide/geomstore（${count.length} 项，version=${version}）`)
console.log('[sync-lib] 下一步：用微信开发者工具打开 examples/miniprogram，菜单「工具 → 构建 npm」')
