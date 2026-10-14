/**
 * 调用开发者工具 CLI 执行「构建 npm」
 *
 * 必须走这一步的原因见 `scripts/sync-lib.mjs` 顶部：手动放进 `miniprogram_npm` 的包
 * 微信不认，只有构建 npm 登记过，`require('@openlide/geomstore')` 才会解析到。
 *
 * 这一步之前 demo 文档里写的是「菜单 工具 → 构建 npm」，那是**手工步骤**，
 * 与「automator 冒烟应该无人值守跑完」相矛盾：换台机器就得先点一遍菜单，
 * 忘了就得到一个 Module not found，且报错完全指不到这一层。
 *
 * 用法：node scripts/build-npm.mjs
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveCliPath, installBatchSpawnShim, spawnCli, cliNotFoundHelp } from '../e2e/cli.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const projectPath = path.resolve(here, '..')

const cli = resolveCliPath()
if (!cli) {
  console.error(`[build-npm] ${cliNotFoundHelp()}`)
  process.exit(2)
}
if (installBatchSpawnShim()) {
  console.log('[build-npm] 已启用 win32 批处理启动适配')
}

console.log(`[build-npm] CLI：${cli.cliPath}（${cli.source}）`)
console.log('[build-npm] 构建 npm…')

const child = spawnCli(cli.cliPath, ['build-npm', '--project', projectPath], {
  stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
child.stdout.on('data', (d) => {
  output += d.toString()
})
child.stderr.on('data', (d) => {
  output += d.toString()
})

const code = await new Promise((resolve) => {
  child.on('error', () => resolve('spawn-error'))
  child.on('exit', (c) => resolve(c))
  // 构建 npm 正常 1~3s；卡住通常是 IDE 在等登录
  setTimeout(() => {
    child.kill()
    resolve('timeout')
  }, 60_000)
})

const ok = code === 0 && output.includes('build-npm') && !output.includes('[error]')
if (ok) {
  console.log('[build-npm] 完成')
  process.exit(0)
}

console.error(`[build-npm] 失败（exit=${code}）`)
console.error(output.slice(0, 2000))
if (output.includes('__NO_NODE_MODULES__')) {
  console.error(
    '\n[build-npm] 没找到 npm 包：先跑 `npm run sync:lib` 生成 vendor/geomstore，\n' +
      '并确认 demo 的 package.json 里有 @openlide/geomstore 依赖（npm install 过）。',
  )
} else if (code === 'timeout') {
  console.error('\n[build-npm] 超时：开发者工具可能卡在登录页，先手动打开工具确认已登录。')
}
process.exit(2)
