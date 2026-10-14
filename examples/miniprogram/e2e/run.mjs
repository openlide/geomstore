/**
 * 小程序端冒烟（miniprogram-automator）
 *
 * 覆盖 GeomStore 上线清单里**只能在真机/开发者工具上验证**的四件事：
 *   1. 冷启动：无历史数据时初始化正确（持久化没把脏数据喂进来）
 *   2. 持久化：debounce 窗口后确实落盘；重进小程序能恢复
 *   3. 多页面栈：连开两层页面后各方仍在刷新（订阅没被驱逐、没泄漏）
 *   4. 组件订阅容量：默认 20 个组件共享 store 时零驱逐；再加到 60 时应能看到 evict 上报
 *
 * 与 C inequality jest 体系的分工：jest 跑的是 Node 语义正确性，这里跑的是**宿主行为**——
 * Proxy / setData / 生命周期 / 同步存储这几样 Node 上一概观察不到。
 *
 * 前置条件：
 *   1. 仓库根 `pnpm build:weapp && pnpm verify:weapp`
 *   2. 本目录 `npm install`（只装 miniprogram-automator）
 *   3. `npm run sync:lib` 把 dist-weapp 塞进 miniprogram_npm
 *   4. 已安装微信开发者工具且**已登录**；服务端口建议打开（设置 → 安全 → 服务端口）
 *   5. `npm run e2e`
 *
 * 可选环境变量 / 参数（CLI 定位与启动适配见 `e2e/cli.mjs`）：
 *   MP_CLI_PATH=<路径>          直接指定 cli（win 为 cli.bat，mac 为 cli）
 *   MP_DEVTOOLS_DIR=<目录>      只指定安装目录
 *   --cli <路径>                同上，命令行形式
 *   MP_AUTO_PORT=<端口>         自动化端口（默认 9420，被占用时换一个）
 *   MP_LAUNCH_TIMEOUT=<毫秒>    启动超时（默认 90s，首次冷启动可能更久）
 *
 * 退出码：0 全通过；1 有用例失败；2 环境不可用（依赖缺失/启动失败）。
 * `--strict` 下「跳过」也按失败计。
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { resolveCliPath, installBatchSpawnShim, runCli, cliNotFoundHelp, launchFailureHelp } from './cli.mjs'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const projectPath = path.resolve(here, '..')
const strict = process.argv.includes('--strict')
const STORAGE_KEY = 'geomstore_demo_app'

/** `--cli <路径>`：与 MP_CLI_PATH 等价，只是不用先设环境变量（CI 里更顺手） */
const cliArgIndex = process.argv.indexOf('--cli')
const cliArg = cliArgIndex >= 0 ? process.argv[cliArgIndex + 1] : undefined
const autoPort = process.env.MP_AUTO_PORT ? Number(process.env.MP_AUTO_PORT) : undefined
const launchTimeout = process.env.MP_LAUNCH_TIMEOUT ? Number(process.env.MP_LAUNCH_TIMEOUT) : 90_000

let automator
try {
  automator = require('miniprogram-automator')
} catch (e) {
  console.error('[e2e] 未安装 miniprogram-automator，请先在本目录执行 npm install')
  process.exit(2)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 断言失败即抛，测试体据此判定用例失败 */
function assert(condition, message) {
  if (!condition) throw new Error(message)
}

/** 主动跳过：宿主能力不足（如旧版工具没有 page.evaluate）不该让整轮变红 */
function skip(reason) {
  const err = new Error(reason)
  err.__skip = true
  throw err
}

const results = []
async function test(name, fn) {
  const started = Date.now()
  try {
    await fn()
    results.push({ name, status: 'passed', ms: Date.now() - started })
    console.log(`  ✔ ${name} (${Date.now() - started}ms)`)
  } catch (error) {
    if (error && error.__skip) {
      results.push({ name, status: 'skipped', reason: error.message })
      console.log(`  ○ ${name} — 跳过：${error.message}`)
      return
    }
    results.push({ name, status: 'failed', error })
    console.error(`  ✘ ${name}\n      ${error && error.stack ? error.stack.split('\n').slice(0, 3).join('\n      ') : error}`)
  }
}

/**
 * 在 AppService 侧求值
 *
 * 必须走 `miniProgram.evaluate`（App.callFunction），**不能**写 `page.evaluate`——
 * automator 0.12.1 的 `Page` 上根本没有这个方法，写了会命中下面这行「宿主不支持」的跳过分支，
 * 于是所有依赖它的断言都被记成跳过：用例看着是绿的，其实一条都没验。
 */
async function evalInApp(miniProgram, fn) {
  if (typeof miniProgram.evaluate !== 'function') {
    skip('当前工具版本不支持 miniProgram.evaluate')
  }
  return miniProgram.evaluate(fn)
}

/** 解析 CLI 路径并完成 win32 的批处理启动适配——必须在第一次 launch 之前做完 */
const cli = resolveCliPath(cliArg)
if (!cli) {
  console.error(`[e2e] ${cliNotFoundHelp()}`)
  process.exit(2)
}

/** 连接是否真的活着：launch 返回实例 ≠ websocket 还开着 */
const wsOpen = (instance) => instance?.connection?.transport?.ws?.readyState === 1

/**
 * 健康探针：ws 是 OPEN 也不代表能用
 *
 * 撞过一次的典型：连接显示 OPEN，但工具侧的页面 webview 元数据已经错乱，
 * 之后每个页面操作都抛 `Cannot destructure property 'rawPath' of
 * getPageMetaByWebviewId(...)`——错在 automator 内部，指向不了真实原因。
 *
 * 判活动作选 `reLaunch` 而不是 `currentPage`：窗口刚拉起时首页还没渲染，
 * currentPage 在此刻拿不到页面会误判成不健康（实测连试三次全被判死）。
 * reLaunch 是「本轮一定会做的第一个动作」，它能过就说明会话可用。
 */
const healthy = async (instance) => {
  try {
    await instance.reLaunch('/pages/index/index')
    return true
  } catch {
    return false
  }
}

/**
 * 关掉项目窗口并等它退出
 *
 * 每次启动前先做这一步，是这轮调试里唯一能把「间歇性启动失败」变成稳定成功的手段：
 * 上一轮（尤其是用过 `miniProgram.close()` 的那一轮）会在工具侧留下半死的自动化会话，
 * 新连接挂上去就拿到一个页面元数据查不到的实例。`cli close --project` 之后等 4s，
 * 再拉起即是干净的窗口。代价是每个会话多 ~5s，换稳定值。
 */
const resetProject = async () => {
  const output = await runCli(cli.cliPath, ['close', '--project', projectPath])
  await sleep(4000)
  return output
}

/**
 * 拉起（或接上）一个自动化实例
 *
 * 抽成函数是因为「冷启动」用例要真的关掉小程序再重新拉起一次，那次同样得走这套适配。
 *
 * automator 自身不给兜的三处，这里补上：
 * - 超时且未 spawn 失败时 `launch` 会返回 **null**（它内部的错误分支有漏），
 *   直接拿去用只会报出莫名其妙的 TypeError；
 * - 返回了实例但 websocket 已经 CLOSED（readyState 3）——CLI 拉起工具后自己就退出了，
 *   工具侧还没准备好；
 * - 更隐蔽的是 ws OPEN 但实例不可用，只能靠 `healthy()` 试出来。
 */
const launch = async (attempts = 3) => {
  let lastError
  for (let i = 1; i <= attempts; i += 1) {
    await resetProject()
    const instance = await automator.launch({
      projectPath,
      cliPath: cli.cliPath,
      timeout: launchTimeout,
      ...(autoPort ? { port: autoPort } : {}),
    })
    if (instance && wsOpen(instance) && (await healthy(instance))) {
      if (i > 1) console.log(`[e2e] 第 ${i} 次启动才拿到可用会话（前 ${i - 1} 次连接不可用）`)
      return instance
    }
    lastError = new Error('开发者工具启动后会话不可用（连接被关闭或页面元数据缺失）')
    try {
      instance?.disconnect()
    } catch {
      // 已经断开了，忽略
    }
    await sleep(2000)
  }
  throw lastError ?? new Error('启动超时且未给出原因（多为开发者工具未登录或自动化端口未开）')
}

/** 轮询等待条件成立（返回最后一次观测值，超时抛出带观测值的错误） */
async function waitFor(fn, timeoutMs = 5000, intervalMs = 200) {
  const deadline = Date.now() + timeoutMs
  let last
  for (;;) {
    last = await fn()
    if (last) return last
    if (Date.now() > deadline) {
      throw new Error(`等待超时：最后一次观测 ${JSON.stringify(last)}`)
    }
    await sleep(intervalMs)
  }
}

/**
 * 点某个选择器，元素还没渲染出来时重试几次
 *
 * 直接 `(await page.$(sel)).tap()` 有两个坑：`$` 找不到时返回 **null**，
 * 报错是 "Cannot read properties of null (reading 'tap')"——看不出是哪个选择器、
 * 也分不清「选择器写错」和「页面还没渲染完」；页面切换动画期间后者很常见。
 */
async function tapSelector(page, selector, label = selector) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const el = await page.$(selector)
    if (el) {
      await el.tap()
      return
    }
    if (attempt === 4) {
      throw new Error(`选择器 ${label}（${selector}）在当前页面未找到`)
    }
    await page.waitFor(400)
  }
}

/**
 * 取栈顶页面
 *
 * 先 sleep 再取：页面切换（包括 reLaunch 把旧栈清掉）不是同步完成的，
 * 立刻 currentPage() 可能拿到正在退出的那一页，后续操作报
 * "page is not on top of page stack"——错在 automator 内部，看不出是哪条用例的哪一步。
 */
async function topPage(miniProgram, waitMs = 700) {
  await sleep(waitMs)
  const page = await miniProgram.currentPage()
  await page.waitFor(200)
  return page
}

/** 从首页重新起跳：每条用例自己定位，不依赖上一条结束时停在哪 */
async function openHome(miniProgram) {
  await miniProgram.reLaunch('/pages/index/index')
  return topPage(miniProgram, 800)
}

async function main() {
  console.log(`[e2e] 开发者工具 CLI：${cli.cliPath}（${cli.source}）`)
  if (installBatchSpawnShim()) {
    // Node 18.20+/20+/22 不允许直接 spawn .bat，automator 0.12.1 没跟上
    console.log('[e2e] 已启用 win32 批处理启动适配（cli.bat 经 cmd.exe 执行）')
  }
  console.log('[e2e] 启动小程序自动化环境…')
  let miniProgram
  try {
    miniProgram = await launch()
  } catch (error) {
    console.error(`\n[e2e] ${launchFailureHelp(cli, error)}\n`)
    process.exit(2)
  }

  /**
   * 清掉 demo 的持久化键。
   *
   * 走页面侧的 ` wx.removeStorageSync` 而不是 automator 的 callWxMethod：后者在部分工具的
   * 版本上不可用，失败时只会让「磁盘应为空」这类断言间歇性变红，看起来像业务 bug
   */
  const clearStorage = async () => {
    await evalInApp(miniProgram, () => {
      wx.removeStorageSync('geomstore_demo_app')
      return true
    })
  }

  try {
    // ------------------------------------------------------------ 基线准备
    // 清掉上一轮遗留的磁盘数据并把 count 归零：下面几条断言的是「相对基线的增量」，
    // 基线不确定就会变成间歇性红——看起来像业务 bug，实际是上一轮跑完留下的状态。
    await miniProgram.reLaunch('/pages/index/index')
    const basePage = await topPage(miniProgram)
    await basePage.waitFor(600)
    await clearStorage()
    // count 与 theme 都落盘（filter 只排除 visits），两个都要归零；
    // 只归零 count 的话上一轮切到 dark 的主题会留到这一轮，
    // 「磁盘 theme 应为 light」就成了间歇性失败——像业务 bug，其实是上一轮的状态
    await evalInApp(miniProgram, () => {
      const store = getApp().globalData.store
      store.setState('count', 0)
      store.setState('theme', 'light')
      return true
    })
    await sleep(300)

    // ------------------------------------------------------- 持久化（debounce）
    await test('持久化：连续 +1 三次，100ms 防抖后磁盘内容正确', async () => {
      let page = await topPage(miniProgram)
      for (let i = 0; i < 3; i += 1) {
        const button = await page.$('.btn-inc')
        await button.tap()
        await page.waitFor(60)
      }
      // debounce=100ms + 页面自身 200ms 后才刷新展示
      await page.waitFor(500)
      page = await topPage(miniProgram)
      const raw = await miniProgram.callWxMethod('getStorageSync', STORAGE_KEY)
      assert(raw, '磁盘应写入持久化数据')
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
      assert(parsed.count === 3, `磁盘 count 应为 3，实际 ${parsed.count}`)
      assert(parsed.theme === 'light', `磁盘 theme 应为 'light'，实际 ${parsed.theme}`)
      // filter 生效：只落盘 count / theme，不含 visits
      assert(parsed.visits === undefined, `filter 应排除 visits，实际包含 ${parsed.visits}`)
    })

    // ------------------------------------------------------------ 热启动恢复
    await test('热启动：reLaunch 后状态从磁盘恢复（count 回到 3）', async () => {
      await miniProgram.reLaunch('/pages/index/index')
      const page = await topPage(miniProgram)
      await page.waitFor(400)
      const data = await page.data()
      assert(data.count === 3, `恢复后 count 应为 3，实际 ${data.count}`)
    })

    // ---------------------------------------------------------------- 冷启动
    await test('冷启动：关掉再拉起后 App.onLaunch 重新执行，状态与磁盘一致', async () => {
      // 先把 visits 顶高，冷启动后才有区分度：
      // visits 由 onLaunch(+1) 与 onShow(+1) 累加，静止状态下前后都是 2，
      // 「重启过」和「没重启」在数据上长得一样。手动触发两次 onShow 造出差值。
      await evalInApp(miniProgram, () => {
        const app = getApp()
        if (typeof app.onShow === 'function') {
          app.onShow({ scene: 1001 })
          app.onShow({ scene: 1001 })
        }
        return true
      })
      await sleep(400)
      // 注意：page.data 是**方法**不是属性（automator 的 Page 暴露的是 data()）
      const beforeVisits = (await (await topPage(miniProgram)).data()).visits

      // 判据不写「磁盘为空 / count 回到 0」，因为在开发者工具里这两条都不可靠：
      // ① 关闭会走持久化插件的卸载路径**同步补写一次**，无论之前怎么清库都会被写回；
      // ② 实测写盘后再 close 重启，偶尔会读回上一轮落盘的值——工具自己的 storage
      //    在「关项目窗口再打开」这条路径上的持久性不保证，与库无关。
      // 所以只断言两件真正由冷启动保证的事：进程真的重启过、状态与磁盘一致。
      await evalInApp(miniProgram, () => {
        const store = getApp().globalData.store
        store.setState('count', store.state.count + 1)
        return getApp().globalData.store.state.count
      })
      await sleep(600)

      await miniProgram.close()
      // 等工具窗口真正退出再拉起：不等的话新连接挂在正在销毁的旧窗口上
      await sleep(6000)
      miniProgram = await launch()
      await miniProgram.reLaunch('/pages/index/index')
      const page = await topPage(miniProgram, 1000)
      const data = await page.data()

      // ① 进程重启过：visits 不落盘（filter 排除），冷启动由 onLaunch 从 0 重新计数
      assert(
        data.visits < beforeVisits,
        `冷启动后 visits 应重新计数并小于重启前的 ${beforeVisits}，实际 ${data.visits}`,
      )
      assert(data.stackDepth === 1, `冷启动后页面栈应为 1，实际 ${data.stackDepth}`)

      // ② 状态与磁盘一致：恢复逻辑的正确性不依赖磁盘里具体是什么值
      const raw = await miniProgram.callWxMethod('getStorageSync', STORAGE_KEY)
      const disk = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null
      const expected = disk ? disk.count : 0
      assert(
        data.count === expected,
        `冷启动后 count 应与磁盘一致：磁盘=${JSON.stringify(disk)}，页面=${data.count}`,
      )
    })

    // ------------------------------------------------------ 多级页面栈同步
    await test('多页面栈：连开两层二级页后再 +1，返回首页状态一致', async () => {
      // 自己 reLaunch 到首页：不依赖上一条用例结束时停在哪一页
      const page = await openHome(miniProgram)
      const before = (await page.data()).count

      await tapSelector(page, '.btn-detail', '进入二级页')
      const detail = await topPage(miniProgram)
      await detail.waitFor(600)
      const depth2 = (await detail.data()).depth
      assert(depth2 === 2, `二级页栈深度应为 2，实际 ${depth2}`)

      await tapSelector(detail, '.btn-open', '再开一层二级页')
      const detail2 = await topPage(miniProgram)
      await detail2.waitFor(600)
      const depth3 = (await detail2.data()).depth
      assert(depth3 === 3, `再开一层应为 3，实际 ${depth3}`)

      // 在最深层 +1：各层页面都应同步（证明订阅未被驱逐）
      await tapSelector(detail2, '.btn-inc', '最深层 +1')
      await detail2.waitFor(400)
      assert((await detail2.data()).count === before + 1, '最深层页面自身未更新')

      await miniProgram.navigateBack()
      const backOne = await topPage(miniProgram)
      await backOne.waitFor(600)
      assert((await backOne.data()).count === before + 1, '返回后的二级页与 Store 不同步')

      await miniProgram.navigateBack()
      const home = await topPage(miniProgram)
      await home.waitFor(600)
      const homeData = await home.data()
      assert(homeData.count === before + 1, `首页 count 应为 ${before + 1}，实际 ${homeData.count}`)
      // 页面栈回到 1 层：detached 已触发退订，没有残留页面
      assert(homeData.stackDepth === 1, `页面栈应回落到 1，实际 ${homeData.stackDepth}`)
    })

    // ------------------------------------------------------- 组件订阅容量
    await test('组件订阅：20 个组件共享 Store 时全部同步且零驱逐', async () => {
      const page = await openHome(miniProgram)
      await tapSelector(page, '.btn-list', '进入列表页')
      const list = await topPage(miniProgram)
      await list.waitFor(800)
      const beforeData = await list.data()
      assert(beforeData.itemCount === 20, `初始组件数应为 20，实际 ${beforeData.itemCount}`)
      assert(beforeData.evicted === 0, `未触顶时不应有驱逐，实际 ${beforeData.evicted}`)

      await tapSelector(list, '.btn-inc', '列表页 +1')
      await list.waitFor(400)
      const listTop = await topPage(miniProgram)
      const after = await listTop.data()
      assert(after.count === beforeData.count + 1, '列表页 count 未同步')

      // 查自定义组件必须用 **class 选择器**：automator 的标签选择器不认自定义组件标签，
      // 实测同一页面上 `counter-item` 恒为 0 而 `.counter-item` 查到 20 个
      //（所以 list.wxml 里那个 class 不是装饰，删了这条用例就会退化成跳过）。
      //
      // 另外两条实测结论，决定了这里为什么这样写：
      // - `element.wxml()` 在本工具上**可用**，且返回的是展开后的 `<#shadow-root>` 内容
      //   （含组件内部渲染的 `count = N`），所以能真的断言「组件渲染到最新值」；
      // - 宿主侧的 `page.callMethod` 在 automator 0.12.1 上**不可用**（连页面自带的
      //   `renderItems` 都报 not a function），故不走「取组件实例读 data」那条路。
      const items = await listTop.$$('.counter-item').catch(() => [])
      if (items.length === 0) {
        skip('当前工具查不到自定义组件节点（.counter-item），本条改由页面 data 断言')
      }
      assert(items.length === 20, `组件实例数应为 20，实际 ${items.length}`)
      if (typeof items[0].wxml !== 'function') {
        skip('当前工具版本不支持 element.wxml()，跳过组件渲染断言')
      }
      // 逐个断言而非只看第一个：20 个组件共享一份 Store，任何一个漏订阅都会在这里露出来。
      // 用 waitFor 容错 setData 的渲染时序，避免偶发的假红
      let last = []
      const synced = await waitFor(
        async () => {
          last = await Promise.all(items.map((i) => i.wxml().catch(() => '')))
          return last.every((w) => String(w).includes(`count = ${after.count}`))
        },
        3000,
        300,
      ).catch(() => false)
      assert(
        synced,
        `20 个组件应全部渲染到 count = ${after.count}，未同步的有 ` +
          `${last.filter((w) => !String(w).includes(`count = ${after.count}`)).length} 个；首个实际：${String(last[0] ?? '').slice(0, 120)}`,
      )
    })

    await test('组件订阅：加到 60 个后应触发 evict-oldest 且经 onError 可见', async () => {
      const list = await topPage(miniProgram)
      // 20 → 60：超过默认 50 的上限
      for (let i = 0; i < 2; i += 1) {
        await tapSelector(list, '.btn-more', '再加 20 个组件')
        await list.waitFor(400)
      }
      await list.waitFor(600)
      const data = await (await topPage(miniProgram)).data()
      assert(data.itemCount === 60, `组件数应加到 60，实际 ${data.itemCount}`)
      // 驱逐必须「可见」：生产控制台是静默的，唯一出口是 hooks 的 onError('subscribe')
      assert(data.evicted > 0, `超过 50 上限后应产生驱逐上报，实际 evicted=${data.evicted}`)

      // 连带影响观测：被驱逐的不只是页面/组件，库自己在 App 启动时建的订阅同样会被牺牲
      // ——持久化插件就是其中之一。症状是「状态还在变，磁盘不再更新」，
      // 且生产里没有任何报错（onError('subscribe') 只报被驱逐的那一次）。
      // 这里不写成断言（行为随上限配置而变），只把实测结果打出来供人工核对。
      const before = await miniProgram.callWxMethod('getStorageSync', STORAGE_KEY)
      await evalInApp(miniProgram, () => {
        const store = getApp().globalData.store
        store.setState('count', store.state.count + 1)
        return true
      })
      await sleep(1200)
      const after = await miniProgram.callWxMethod('getStorageSync', STORAGE_KEY)
      console.log(
        `      [观测] 驱逐后写盘是否仍生效：${after !== before ? '仍在写' : '已停止'}（上限=${data.itemCount > 50 ? '默认 50 已触顶' : '未触顶'}）`,
      )
    })

    // ------------------------------------------------------------ 前后台切换
    await test('前后台切换：onHide / onShow 触发后 App 侧计数继续累加', async () => {
      await miniProgram.reLaunch('/pages/index/index')
      const page = await topPage(miniProgram)
      await page.waitFor(300)
      const before = (await page.data()).visits
      await evalInApp(miniProgram, () => {
        const app = getApp()
        if (app.onHide) app.onHide()
        if (app.onShow) app.onShow({ scene: 1001 })
      })
      await page.waitFor(300)
      const after = (await (await topPage(miniProgram)).data()).visits
      assert(after > before, `切换后台再回前台后 visits 应增加：${before} → ${after}`)
    })

    // -------------------------------------------------------- 环境信号（P0）
    await test('环境信号：宿主 envVersion 映射成 __DEV__，isProduction 判定不再恒为开发模式', async () => {
      const page = await topPage(miniProgram)
      const data = await page.data()
      assert(data.env === 'develop' || data.env === 'trial' || data.env === 'release', `env 取值异常：${data.env}`)
      const bridged = await evalInApp(miniProgram, () => ({
        devFlag: typeof __DEV__ === 'undefined' ? null : __DEV__,
        env: globalThis.__GEOM_ENV__,
      }))
      // 开发者工具里必然是 develop → __DEV__ 必须为 false → 库保持开发模式（严格保护）
      if (bridged.env === 'develop') {
        assert(bridged.devFlag === false, `develop 环境下 __DEV__ 应为 false，实际 ${bridged.devFlag}`)
      } else {
        assert(bridged.devFlag === true, `非 develop 环境下 __DEV__ 应为 true，实际 ${bridged.devFlag}`)
      }
    })

    // -------------------------------------------------------- onError 可见性
    await test('onError 上报：整轮下来没有未被预期的持久化/订阅错误', async () => {
      const page = await topPage(miniProgram)
      const errors = await evalInApp(miniProgram, () => globalThis.__GEOM_ERRORS__ || [])
      const unexpected = errors.filter((e) => e.source === 'persistence')
      assert(unexpected.length === 0, `出现意外的持久化错误：${JSON.stringify(unexpected)}`)
      // subscribe 源只应来自上面那个「超过 50 上限」的用例
      const subscribeErrors = errors.filter((e) => e.source === 'subscribe')
      assert(subscribeErrors.length > 0, '样本位的订阅驱逐事件应当被记录（若被清理请先跑满 60 组件用例）')
    })
  } finally {
    try {
      miniProgram.disconnect()
    } catch {
      // disconnect 在 0.12.1 上返回 undefined，且连接可能已被工具侧关闭
    }
  }
}

main()
  .then(() => {
    const passed = results.filter((r) => r.status === 'passed').length
    const skipped = results.filter((r) => r.status === 'skipped').length
    const failed = results.filter((r) => r.status === 'failed')
    console.log(`\n[e2e] 汇总：${passed} 通过 / ${failed.length} 失败 / ${skipped} 跳过`)
    if (failed.length > 0) process.exit(1)
    if (strict && skipped > 0) {
      console.error('[e2e] --strict 模式下跳过的用例按失败计')
      process.exit(1)
    }
    process.exit(0)
  })
  .catch((error) => {
    console.error('[e2e] 运行器异常：', error)
    process.exit(2)
  })
