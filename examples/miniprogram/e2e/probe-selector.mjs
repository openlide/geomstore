/**
 * 一次性探针：确认 automator 在列表页上到底能查到哪些节点
 *
 * 用途：e2e 里「组件订阅」那条用例曾被记为跳过，理由是 `list.$$('counter-item')` 查不到
 * 自定义组件节点。本探针用来确认**查不到的范围**，从而选出修法。
 *
 * 实测结论（开发者工具 1.06.x / 基础库 3.x / automator 0.12.1）：
 *   - 标签选择器**不认**自定义组件：`counter-item` 恒 0；
 *   - class 选择器认：`.counter-item` 查到 20 个 → 修法就是给组件加个 class；
 *   - `element.wxml()` 可用，且返回展开后的 `<#shadow-root>`（能看到组件内部渲染的文本）；
 *   - `page.callMethod` 不可用（连页面自带的 `renderItems` 都报错）→ 宿主侧路线作废。
 *
 * 换机器、换工具版本后先跑它，能一眼看出哪些能力还在。
 *
 * 跑法：node e2e/probe-selector.mjs
 */

import { resolveCliPath, installBatchSpawnShim, runCli } from './cli.mjs'
import automator from 'miniprogram-automator'
import { resolve } from 'node:path'

installBatchSpawnShim()
const cli = resolveCliPath()
const projectPath = resolve(process.cwd())
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const SELS = [
  'view',
  '.container',
  '.hint',
  '.btn-inc',
  'counter-item',
  '.counter-item',
  '#nothing',
]

const wsOpen = (i) => i?.connection?.transport?.ws?.readyState === 1

async function main() {
  // 与 run.mjs 同口径：launch 可能拿到「ws OPEN 但页面元数据缺失」的坏会话，
  // 必须 reLaunch 判活 + 重试，否则第一条页面操作就抛 getPageMetaByWebviewId
  let miniProgram
  for (let i = 1; i <= 3; i += 1) {
    await runCli(cli.cliPath, ['close', '--project', projectPath])
    await sleep(4000)
    const candidate = await automator.launch({ projectPath, cliPath: cli.cliPath, timeout: 90000 })
    if (!candidate || !wsOpen(candidate)) {
      try {
        candidate?.disconnect()
      } catch {
        /* ignore */
      }
      continue
    }
    try {
      await candidate.reLaunch('/pages/index/index')
      miniProgram = candidate
      if (i > 1) console.log(`[probe] 第 ${i} 次启动才拿到可用会话`)
      break
    } catch {
      try {
        candidate.disconnect()
      } catch {
        /* ignore */
      }
      await sleep(2000)
    }
  }
  if (!miniProgram) throw new Error('三次启动都没拿到可用会话')

  await miniProgram.reLaunch('/pages/list/list')
  await sleep(1500)
  const page = await miniProgram.currentPage()
  await page.waitFor(800)

  console.log('页面路径：', page.path)

  for (const sel of SELS) {
    let n = -1
    let err = ''
    try {
      const els = await page.$$(sel)
      n = Array.isArray(els) ? els.length : -2
      // 顺带看第一个元素有没有 wxml()：决定了能不能断言「渲染到最新值」
      if (n > 0) {
        const probe = typeof els[0]?.wxml === 'function' ? 'wxml()=可用' : 'wxml()=不可用'
        console.log(`  ${sel.padEnd(16)} → ${n} 个   ${probe}`)
        continue
      }
    } catch (e) {
      err = `（抛错：${String(e.message ?? e).slice(0, 90)}）`
    }
    console.log(`  ${sel.padEnd(16)} → ${n} 个 ${err}`)
  }

  // 宿主侧取组件实例那条路是否可走：拿页面自带方法做对照。
  // 实测 automator 0.12.1 上 page.callMethod 连 renderItems 都调不动，该路线作废。
  try {
    const r = await page.callMethod('renderItems')
    console.log('  callMethod(renderItems) → ok:', JSON.stringify(r)?.slice(0, 160))
  } catch (e) {
    console.log('  callMethod(renderItems) → 失败:', String(e.message ?? e).slice(0, 100))
  }

  // 关键：组件宿主节点查到之后，wxml() 能不能看到组件**内部**渲染出来的文本？
  const items = await page.$$('.counter-item')
  console.log(`\n  .counter-item 共 ${items.length} 个`)
  if (items.length > 0) {
    const wxml = await items[0].wxml()
    console.log('  首个组件 wxml()：')
    console.log(
      String(wxml)
        .split('\n')
        .map((l) => `    ${l.trim()}`)
        .filter((l) => l.trim())
        .join('\n'),
    )
  }

  await miniProgram.disconnect()
}

main().catch((e) => {
  console.error('[probe] 失败：', e)
  process.exit(1)
})
