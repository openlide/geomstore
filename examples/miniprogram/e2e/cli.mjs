/**
 * 开发者工具 CLI 的「定位」与「启动」适配层
 *
 * `miniprogram-automator@0.12.1`（目前最新版）在当下的环境里有两道坎，本文件专门填它俩：
 *
 * **1. 定位：只认一个硬编码路径。**
 * `Launcher.resolveCliPath()` 只试 win32 的 `C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat`
 * 和 darwin 的 `/Applications/wechatwebdevtools.app/Contents/MacOS/cli`，装到别的盘 / 目录就返回空串，
 * 上层随即抛 `Wechat web devTools not found, please specify cliPath option`——不给任何排查线索。
 *
 * **2. 启动：拿到 `cli.bat` 后直接 `child_process.spawn(cli.bat, args)`。**
 * Node 18.20 / 20 / 22 的 libuv 加固后**拒绝直接 spawn `.bat` / `.cmd`**（实测 `EINVAL`，
 * `errno: -4071`），必须经 `cmd.exe`。automator 把 spawn 的 error 事件统一翻译成
 * `Failed to launch wechat web devTools, please make sure cliPath is correctly specified`——
 * 于是症状看起来像「路径不对」，实际路径是对的，锅在调用方式。这是本文件存在的主因。
 *
 * 两者的修法都在本文件内，调用方（`run.mjs`）不需要感知细节。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/** Windows 上开发工具有过两个安装目录名，两个都试 */
const WIN_DIR_NAMES = ['微信web开发者工具', '微信开发者工具']

/**
 * 候选搜索根：ProgramFiles 环境变量 + C/D/E 盘 + 用户级 Programs。
 * 不做全盘扫描——那要遍历几十万文件；装到更偏的位置请直接用 `MP_CLI_PATH` 或 `--cli` 指路。
 */
function windowsRoots() {
  const roots = []
  const push = (p) => {
    if (p && !roots.includes(p)) roots.push(p)
  }
  push(process.env.ProgramFiles)
  push(process.env['ProgramFiles(x86)'])
  push(process.env.LocalAppData ? path.join(process.env.LocalAppData, 'Programs') : '')
  for (const drive of ['C', 'D', 'E']) {
    push(`${drive}:\\`)
    push(`${drive}:\\Program Files`)
    push(`${drive}:\\Program Files (x86)`)
    push(`${drive}:\\Tencent`)
  }
  push(path.join(os.homedir(), 'AppData', 'Local', 'Programs'))
  return roots
}

function windowsCandidates() {
  const out = []
  for (const root of windowsRoots()) {
    for (const dir of WIN_DIR_NAMES) {
      out.push(path.join(root, dir, 'cli.bat'))
      out.push(path.join(root, 'Tencent', dir, 'cli.bat'))
    }
    // 有人把整个 Tencent 目录装在盘根，也有人直接解压到盘根
    out.push(path.join(root, 'cli.bat'))
  }
  return out
}

function macCandidates() {
  const apps = ['/Applications', path.join(os.homedir(), 'Applications')]
  const bundles = ['wechatwebdevtools.app', '微信web开发者工具.app', '微信webdevtools.app']
  const out = []
  for (const app of apps) {
    for (const bundle of bundles) {
      out.push(path.join(app, bundle, 'Contents', 'MacOS', 'cli'))
    }
  }
  return out
}

/**
 * 定位开发者工具 CLI
 *
 * 优先级：`--cli` / `MP_CLI_PATH` → `MP_DEVTOOLS_DIR` → 平台常见安装位置。
 *
 * @param {string} [explicit] 命令行或环境变量显式指定的路径
 * @returns {{ cliPath: string, source: string } | null} 找不到返回 null，由调用方打印排查指引
 */
export function resolveCliPath(explicit) {
  if (explicit) {
    return { cliPath: explicit, source: '显式指定（--cli / MP_CLI_PATH）' }
  }
  const envCli = process.env.MP_CLI_PATH
  if (envCli) {
    return { cliPath: envCli, source: '环境变量 MP_CLI_PATH' }
  }

  const dirEnv = process.env.MP_DEVTOOLS_DIR
  if (dirEnv) {
    const file = process.platform === 'win32' ? 'cli.bat' : 'cli'
    return { cliPath: path.join(dirEnv, file), source: '环境变量 MP_DEVTOOLS_DIR' }
  }

  const candidates =
    process.platform === 'win32' ? windowsCandidates() : process.platform === 'darwin' ? macCandidates() : []

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return { cliPath: candidate, source: '自动探测' }
      }
    } catch {
      // 权限 / 无效盘符：跳过，继续下一个候选
    }
  }
  return null
}

/** 找不到 CLI 时的排查指引（打印给用户，而不是让他去猜 automator 那句含糊的报错） */
export function cliNotFoundHelp() {
  const isWin = process.platform === 'win32'
  return [
    '找不到微信开发者工具的 CLI。三选一指定它：',
    '',
    '  1) 命令行：node e2e/run.mjs --cli "<完整路径>"',
    '  2) 环境变量：MP_CLI_PATH="<完整路径>" npm run e2e',
    '  3) 只改目录：MP_DEVTOOLS_DIR="<开发者工具安装目录>" npm run e2e',
    '',
    isWin
      ? '  Windows 上通常是 <安装目录>\\cli.bat（注意是 .bat 不是 .exe）。\n  在桌面快捷方式上右键「打开文件所在的位置」即可找到安装目录。'
      : '  macOS 上通常是 /Applications/wechatwebdevtools.app/Contents/MacOS/cli',
    '',
    `  已自动探测过：${isWin ? 'ProgramFiles / C:\\D:\\E:\\ 常见安装位' : '/Applications 与 ~/Applications'}。`,
    '  装在别处的（自定义盘符 / 便携版）请显式指路。',
  ].join('\n')
}

/**
 * cmd.exe 参数转义
 *
 * 不转义会被当成命令分隔符：`C:\Program Files (x86)\...` 里的空格会把命令行切成两半，
 * cmd 报 `'C:\Program' 不是内部或外部命令`——这也是「路径明明对却启动不了」最常被误判的一处。
 * 另外结尾的反斜杠会吃掉后面的闭合引号（`D:\dir\` → 引号失效），必须先翻倍。
 */
function quoteWindowsArg(arg) {
  if (arg === '') return '""'
  if (!/[\s"&<>()^|!%,;=]/.test(arg)) return arg
  const body = arg
    .replace(/(\\*)"/g, (_m, backslashes) => backslashes + backslashes + '\\"')
    .replace(/(\\+)$/, (_m, backslashes) => backslashes + backslashes)
  return `"${body}"`
}

/**
 * 给 `child_process.spawn` 打补丁：win32 上遇到 `.bat` / `.cmd` 自动改走 `cmd.exe`
 *
 * 为什么是补丁而不是自己重新实现 launch：`automator.launch()` 还负责挑端口、把 projectConfig
 * 合并进工程、连上后校验工具版本、启动后再等 5s 让小程序跑起来——这些重实现一遍既没必要也更容易漂。
 * 补丁的作用域仅限本进程，且只在「win32 + 目标是 .bat/.cmd + 调用方没开 shell」时改写。
 *
 * 为什么不用 `shell: true` 了事：Node 在 shell 模式下**不转义命令本身**，只把拼好的整串再套一层引号，
 * 于是含空格的 `cli.bat` 路径照样被切碎（实测报 `'C:\Program' 不是内部或外部命令`）。
 * 所以这里自己拼 `cmd.exe /d /s /c "<命令串>"`，并逐段做 Windows 转义——这也是 cmd 官方推荐的
 * 安全调用形式（外层一对引号 + `/s`，cmd 只剥最外层引号，内部的引号照原样保留）。
 *
 * @returns {boolean} 是否真的打了补丁（非 win32 / 已打过则 false）
 */
export function installBatchSpawnShim() {
  const cp = require('child_process')
  if (process.platform !== 'win32') return false
  if (cp.spawn.__geomBatchShim === true) return false

  const comspec = process.env.ComSpec || process.env.comspec || 'cmd.exe'
  const original = cp.spawn
  const shim = (file, args, options) => {
    const isBatch = typeof file === 'string' && /\.(bat|cmd)$/i.test(file)
    if (isBatch && !(options && options.shell)) {
      const commandLine = [file, ...(args ?? [])].map((a) => quoteWindowsArg(String(a))).join(' ')
      return original(comspec, ['/d', '/s', '/c', `"${commandLine}"`], {
        ...(options ?? {}),
        windowsVerbatimArguments: true,
      })
    }
    return original(file, args, options)
  }
  shim.__geomBatchShim = true
  cp.spawn = shim
  return true
}

/**
 * 启动开发者工具 CLI
 *
 * 必须经本函数而不是自己 `import { spawn } from 'node:child_process'`：ESM 具名导入在模块
 * 求值时就把函数引用绑定走了，之后 `installBatchSpawnShim()` 替换的是模块对象上的属性，
 * 手里那个引用还是原始的 spawn——于是 .bat 照样 EINVAL。这里走属性访问，拿到的永远是当前版本。
 */
export function spawnCli(cliPath, args, options) {
  const cp = require('node:child_process')
  return cp.spawn(cliPath, args, options)
}

/**
 * 执行一条不带 websocket 的 CLI 命令（`close` / `quit` 之类），返回合并后的输出
 *
 * @param {string} cliPath CLI 路径
 * @param {string[]} args 命令参数
 * @param {{ timeout?: number }} [options]
 * @returns {Promise<string>} 输出文本（超时返回 'timeout'）
 */
export function runCli(cliPath, args, options = {}) {
  const { timeout = 30_000 } = options
  return new Promise((resolve) => {
    const child = spawnCli(cliPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (d) => {
      output += d.toString()
    })
    child.stderr.on('data', (d) => {
      output += d.toString()
    })
    child.on('error', (error) => resolve(`spawn-error: ${error.message}`))
    child.on('exit', (code) => resolve(`exit=${code} ${output}`))
    setTimeout(() => {
      child.kill()
      resolve('timeout')
    }, timeout)
  })
}

/** 启动失败时的排查清单：automator 的报错只说「cliPath 不对」，而真实原因往往不是它 */
export function launchFailureHelp(cli, error) {
  const message = error && error.message ? error.message : String(error)
  return [
    `启动失败：${message}`,
    '',
    `已使用的 CLI：${cli ? cli.cliPath : '(未解析到)'}${cli ? `（来源：${cli.source}）` : ''}`,
    '',
    '按可能性排序：',
    '  1) 开发者工具未登录 / 登录态过期 —— 自动化要求已登录，先手动打开工具确认',
    '  2) 自动化端口被占用（默认 9420）—— MP_AUTO_PORT=9421 npm run e2e',
    '  3) 「设置 → 安全」里的服务端口未打开，或工具版本太旧不支持 --auto-port —— 升级到 1.06+',
    '  4) CLI 路径确实不对 —— node e2e/run.mjs --cli "<路径>"',
    '  5) 首次冷启动工具要 30s 以上 —— MP_LAUNCH_TIMEOUT=120000 npm run e2e',
    '',
    '注意：automator 把「spawn 失败」和「路径不对」报成同一句话，',
    '所以这句话出现时先别急着改路径，按上面 1)~3) 排查。',
  ].join('\n')
}
