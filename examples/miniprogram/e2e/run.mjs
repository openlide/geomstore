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
 *   4. 已安装微信开发者工具，且**服务端口已开启**：设置 → 安全 → 服务端口（打开）
 *      不在自动模式下找不到工具时，用 MP_CLI_PATH 指定 cli 路径，例如
 *      Windows: set MP_CLI_PATH="C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat"
 *   5. `npm run e2e`
 *
 * 退出码：0 全通过；1 有用例失败；2 环境不可用（依赖缺失/启动失败）。
 * `--strict` 下「跳过」也按失败计。
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const projectPath = path.resolve(here, '..')
const strict = process.argv.includes('--strict')
const STORAGE_KEY = 'geomstore_demo_app'

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

/** 读取 AppService 侧的任意 JS 表达式（需要宿主支持 page.evaluate） */
async function evalInApp(page, fnSource) {
  if (typeof page.evaluate !== 'function') {
    skip('当前工具版本不支持 page.evaluate')
  }
  return page.evaluate(fnSource)
}

async function main() {
  console.log('[e2e] 启动小程序自动化环境…')
  let miniProgram
  try {
    miniProgram = await automator.launch({
      projectPath,
      ...(process.env.MP_CLI_PATH ? { cliPath: process.env.MP_CLI_PATH } : {}),
    })
  } catch (error) {
    console.error('[e2e] 启动失败（开发者工具已安装且开启服务端口了吗？）：', error && error.message)
    process.exit(2)
  }

  /**
   * 清掉 demo 的持久化键。
   *
   * 走页面侧的 ` wx.removeStorageSync` 而不是 automator 的 callWxMethod：后者在部分工具的
   * 版本上不可用，失败时只会让「磁盘应为空」这类断言间歇性变红，看起来像业务 bug
   */
  const clearStorage = async (page) => {
    await evalInApp(page, () => {
      wx.removeStorageSync('geomstore_demo_app')
      return true
    })
  }

  try {
    // ---------------------------------------------------------------- 冷启动
    await test('冷启动：清库后重启进首页，状态为初始值且磁盘无数据', async () => {
      let page
      try {
        await miniProgram.reLaunch('/pages/index/index')
        page = await miniProgram.currentPage()
        await page.waitFor(300)
        await clearStorage(page)
      } catch (error) {
        if (error && error.__skip) throw error
        // 工具启动后立即 reLaunch 偶发失败：再试一次
        page = await miniProgram.reLaunch('/pages/index/index')
        await page.waitFor(300)
        await clearStorage(page)
      }

      // 真正的冷启动：关掉小程序再拉起（OnLaunch 才会重新执行）
      await miniProgram.close()
      miniProgram = await automator.launch({ projectPath, ...(process.env.MP_CLI_PATH ? { cliPath: process.env.MP_CLI_PATH } : {}) })
      await miniProgram.reLaunch('/pages/index/index')
      page = await miniProgram.currentPage()
      await page.waitFor(400)

      const data = await page.data()
      assert(data.count === 0, `冷启动 count 应为初始 0，实际 ${data.count}`)
      assert(!data.persisted, `磁盘应为空，实际 ${String(data.persisted)}`)
    })

    // ------------------------------------------------------- 持久化（debounce）
    await test('持久化：连续 +1 三次，100ms 防抖后磁盘内容正确', async () => {
      let page = await miniProgram.currentPage()
      for (let i = 0; i < 3; i += 1) {
        const button = await page.$('.btn-inc')
        await button.tap()
        await page.waitFor(60)
      }
      // debounce=100ms + 页面自身 200ms 后才刷新展示
      await page.waitFor(500)
      page = await miniProgram.currentPage()
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
      const page = await miniProgram.currentPage()
      await page.waitFor(400)
      const data = await page.data()
      assert(data.count === 3, `恢复后 count 应为 3，实际 ${data.count}`)
    })

    // ------------------------------------------------------ 多级页面栈同步
    await test('多页面栈：连开两层二级页后再 +1，返回首页状态一致', async () => {
      let page = await miniProgram.currentPage()
      const before = (await page.data()).count

      await (await page.$('.btn-detail')).tap()
      await (await miniProgram.currentPage()).waitFor(300)
      const detail = await miniProgram.currentPage()
      const depth2 = (await detail.data()).depth
      assert(depth2 === 2, `二级页栈深度应为 2，实际 ${depth2}`)

      await (await detail.$('.btn-open')).tap()
      await (await miniProgram.currentPage()).waitFor(300)
      const detail2 = await miniProgram.currentPage()
      const depth3 = (await detail2.data()).depth
      assert(depth3 === 3, `再开一层应为 3，实际 ${depth3}`)

      // 在最深层 +1：各层页面都应同步（证明订阅未被驱逐）
      await (await detail2.$('.btn-inc')).tap()
      await detail2.waitFor(200)
      assert((await detail2.data()).count === before + 1, '最深层页面自身未更新')

      await miniProgram.navigateBack()
      await (await miniProgram.currentPage()).waitFor(300)
      const backOne = await miniProgram.currentPage()
      assert((await backOne.data()).count === before + 1, '返回后的二级页与 Store 不同步')

      await miniProgram.navigateBack()
      await (await miniProgram.currentPage()).waitFor(300)
      const home = await miniProgram.currentPage()
      const homeData = await home.data()
      assert(homeData.count === before + 1, `首页 count 应为 ${before + 1}，实际 ${homeData.count}`)
      // 页面栈回到 1 层：detached 已触发退订，没有残留页面
      assert(homeData.stackDepth === 1, `页面栈应回落到 1，实际 ${homeData.stackDepth}`)
    })

    // ------------------------------------------------------- 组件订阅容量
    await test('组件订阅：20 个组件共享 Store 时全部同步且零驱逐', async () => {
      let page = await miniProgram.currentPage()
      await (await page.$('.btn-list')).tap()
      await (await miniProgram.currentPage()).waitFor(500)
      const list = await miniProgram.currentPage()
      const beforeData = await list.data()
      assert(beforeData.itemCount === 20, `初始组件数应为 20，实际 ${beforeData.itemCount}`)
      assert(beforeData.evicted === 0, `未触Cap时不应有驱逐，实际 ${beforeData.evicted}`)

      await (await list.$('.btn-inc')).tap()
      await list.waitFor(300)
      const after = await (await miniProgram.currentPage()).data()
      assert(after.count === beforeData.count + 1, '列表页 count 未同步')

      const items = await list.$$('counter-item')
      assert(items.length === 20, `组件实例数应为 20，实际 ${items.length}`)
      if (typeof items[0].wxml === 'function') {
        const wxml = await items[0].wxml()
        assert(wxml.includes(`count = ${after.count}`), `首个组件未渲染到最新 count：${String(wxml).slice(0, 120)}`)
      } else {
        skip('当前工具版本不支持 element.wxml()，跳过组件渲染断言')
      }
    })

    await test('组件订阅：加到 60 个后应触发 evict-oldest 且经 onError 可见', async () => {
      const list = await miniProgram.currentPage()
      // 20 → 60：超过默认 50 的上限
      for (let i = 0; i < 2; i += 1) {
        await (await list.$('.btn-more')).tap()
        await list.waitFor(200)
      }
      await list.waitFor(400)
      const data = await (await miniProgram.currentPage()).data()
      assert(data.itemCount === 60, `组件数应加到 60，实际 ${data.itemCount}`)
      // 驱逐必须「可见」：生产控制台是静默的，唯一出口是 hooks 的 onError('subscribe')
      assert(data.evicted > 0, `超过 50 上限后应产生驱逐上报，实际 evicted=${data.evicted}`)
    })

    // ------------------------------------------------------------ 前后台切换
    await test('前后台切换：onHide / onShow 触发后 App 侧计数继续累加', async () => {
      await miniProgram.reLaunch('/pages/index/index')
      const page = await miniProgram.currentPage()
      await page.waitFor(300)
      const before = (await page.data()).visits
      await evalInApp(page, () => {
        const app = getApp()
        if (app.onHide) app.onHide()
        if (app.onShow) app.onShow({ scene: 1001 })
      })
      await page.waitFor(300)
      const after = (await (await miniProgram.currentPage()).data()).visits
      assert(after > before, `切换后台再回前台后 visits 应增加：${before} → ${after}`)
    })

    // -------------------------------------------------------- 环境信号（P0）
    await test('环境信号：宿主 envVersion 映射成 __DEV__，isProduction 判定不再恒为开发模式', async () => {
      const page = await miniProgram.currentPage()
      const data = await page.data()
      assert(data.env === 'develop' || data.env === 'trial' || data.env === 'release', `env 取值异常：${data.env}`)
      const bridged = await evalInApp(page, () => ({
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
      const page = await miniProgram.currentPage()
      const errors = await evalInApp(page, () => globalThis.__GEOM_ERRORS__ || [])
      const unexpected = errors.filter((e) => e.source === 'persistence')
      assert(unexpected.length === 0, `出现意外的持久化错误：${JSON.stringify(unexpected)}`)
      // subscribe 源只应来自上面那个「超过 50 上限」的用例
      const subscribeErrors = errors.filter((e) => e.source === 'subscribe')
      assert(subscribeErrors.length > 0, '样本位的订阅驱逐事件应当被记录（若被清理请先跑满 60 组件用例）')
    })
  } finally {
    await miniProgram.disconnect().catch(() => {})
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
