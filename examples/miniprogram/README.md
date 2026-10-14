# GeomStore 小程序 demo

把 [生产可行性评估](../../.ocr-fix/PRODUCTION-READINESS-2026-10-14.md) 里"上线前必做"的几件事
固化成一个能跑的工程，并配好 `miniprogram-automator` 冒烟用例。**它不是示例代码集，是验收样品。**

## 这个 demo 在验证什么

| 目录/文件 | 对应的评估项 | 验证手段 |
|---|---|---|
| `app.js` 第 1 段 | P0 环境信号：宿主 `envVersion` → `__DEV__` 桥接 | e2e「环境信号」用例 |
| `app.js` 第 3 段 | P1 持久化 `debounce` 显式配置（默认 0 是同步阻塞写） | e2e「持久化 / 热启动」用例 |
| `app.js` 第 4 段 | P1 挂 `onError` 上报（生产控制台静默，唯一出口） | e2e「onError 可见性」用例 |
| `pages/index` | 页面集成、`mapState/Getters/Actions` 合并一次 setData | e2e「冷启动 / 持久化」 |
| `pages/detail` | 多级页面栈下的订阅存活与 `detached` 退订 | e2e「多页面栈」 |
| `pages/list` + `components/counter-item` | 订阅默认上限 50 的容量边界与驱逐可见性 | e2e「组件订阅容量」两条 |
| 前后台 | App `onShow/onHide` 触发后状态仍正确 | e2e「前后台切换」 |

## 跑起来

前置：Node ≥ 22、已安装**微信开发者工具**并**已登录**（自动化要求登录态），
建议打开 `设置 → 安全 → 服务端口`。

```bash
# 1) 仓库根：构建要发布给小程序的那一份产物（dist-weapp）
pnpm build:weapp && pnpm verify:weapp

# 2) 本目录：先产出 vendor/geomstore（package.json 的 file: 依赖指向它），再装 automator
cd examples/miniprogram
npm run sync:lib
npm install

# 3) 冒烟（= sync:lib → build:npm → e2e/run.mjs，「工具 → 构建 npm」不用手工点）
npm run e2e
# 想把「跳过」也按失败计（发布前的口径）：
npm run e2e:ci
```

### 指定开发者工具的位置

默认会按平台常见安装位自动探测（Windows 扫 `ProgramFiles` 与 `C:\D:\E:\` 下的
`微信web开发者工具` / `微信开发者工具`；macOS 扫 `/Applications` 与 `~/Applications`）。
装到别处时三选一指路：

```bash
node e2e/run.mjs --cli "C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat"   # 命令行
MP_CLI_PATH="/Applications/wechatwebdevtools.app/Contents/MacOS/cli" npm run e2e     # 环境变量
MP_DEVTOOLS_DIR="D:\微信web开发者工具" npm run e2e                                    # 只给目录
```

> Windows 上是 **`cli.bat`**（不是 `.exe`）。不确定位置的话：桌面快捷方式右键
> 「打开文件所在的位置」，那个目录里的 `cli.bat` 就是。

## 启动失败怎么排查

先看跑失败时打印的那段清单。两个高频坑：

**① `Failed to launch wechat web devTools, please make sure cliPath is correctly specified`**
路径其实多半是对的。`miniprogram-automator@0.12.1` 内部是 `child_process.spawn(cli.bat, …)`，
而 Node 18.20 / 20 / 22 的 libuv 加固后**拒绝直接 spawn `.bat`/`.cmd`**（实测 `EINVAL`、
`errno: -4071`），必须经 `cmd.exe`；automator 把 spawn 失败和路径不对报成同一句话。
`e2e/cli.mjs` 已打补丁自动改走 `cmd.exe`（启动时会打印「已启用 win32 批处理启动适配」），
升级 Node 或换 automator 版本后如果又出现，检查这行日志是否还在。

**② 一直等到超时**
按可能性：开发者工具未登录 / 登录态过期 → 自动化端口 9420 被占用 → 服务端口没开或工具版本太旧
（不支持 `--auto-port`，升到 1.06+）→ CLI 路径不对 → 首次冷启动要 30s 以上。
对应手段：`MP_AUTO_PORT=9421 npm run e2e`、`MP_LAUNCH_TIMEOUT=120000 npm run e2e`。

**③ 报 `spawn EINVAL` / `不是内部或外部命令`**
见上面 ① 与「指定开发者工具的位置」：前者是 `.bat` 直 spawn 被拒，后者是路径含空格被切碎，
都已由 `e2e/cli.mjs` 处理；若仍出现，先用 `--cli` 显式指路确认路径本身没问题。

## 提交前：换行符要归一

仓库根 `.gitattributes` 是 `* text=auto eol=lf`，文档门禁 G14 会断言 tracked 文件里**一个 CR 都没有**。
而**开发者工具每次保存文件都会写回 CRLF**（`project.config.json` 尤其频繁），改完不处理会让门禁变红。

```bash
npm run eol:check   # 只报告
npm run eol:fix     # 归一到 LF（提交前跑一次）
```

## 退出码

| 码 | 含义 |
|---|---|
| 0 | 全部通过（非 strict 下允许跳过） |
| 1 | 有用例失败（strict 下含跳过） |
| 2 | 环境不可用：依赖没装 / 开发者工具起不来 |

## 为什么没进 CI

`miniprogram-automator` 需要**有 GUI 的微信开发者工具实例**，GitHub Actions 的 ubuntu runner 不具备，
也无法在 CI 里安装开发者工具。所以这份用例的定位是**发布门禁的人工最后一道**：
Node 侧的语义正确性由 `pnpm test:ci` 拦，宿主行为由本目录拦，跑完把输出贴进发版 checklist。

## 目录结构

```
examples/miniprogram
├── app.js                     # ★ P0 环境桥接 / P1 持久化配置 / P1 onError 上报
├── app.json / app.wxss / sitemap.json
├── pages/
│   ├── index/                 # 计数器 + 磁盘内容展示 + 页面跳转
│   ├── detail/                # 可自开多层，验证页面栈与订阅存活
│   └── list/                  # 组件订阅容量验证（默认 20 个，可加到 60 触驱逐）
├── components/counter-item/   # withComponentStore + lifetimes 写法
├── scripts/
│   ├── sync-lib.mjs           # dist-weapp → vendor/ 与 node_modules（逐文件比对，只写变更）
│   ├── build-npm.mjs          # 调 cli build-npm，把手工菜单步骤变成无人值守
│   └── normalize-eol.mjs      # 换行符归一（开发者工具保存时会写回 CRLF）
├── e2e/
│   ├── run.mjs                # automator 冒烟
│   └── cli.mjs                # CLI 定位 / .bat 启动适配 / 失败排查
└── vendor/geomstore/          # 由 sync-lib 生成：带 miniprogram 字段的完整 npm 包（不入库）
```

> `vendor/` 与 `miniprogram_npm/` 都是构建产物、已在 `.gitignore` 里，
> 首次克隆后按上面第 2 步跑 `npm run sync:lib` 即可。

## 已知取舍

- `page.evaluate` / `element.wxml()` 在旧版工具上没有，这类断言会**跳过**而不是误报失败；
  `--strict` 可把跳过按失败处理，用于发版前的人工核对。
- 「前后台切换」是用 App 的 `onHide/onShow` 回调模拟的，不是系统级前后台事件——
  真机上的应用级验证请在体验版里手动过一遍。
- demo 用 `.js` 而非 `.ts`：最小化 `(examples/**)` 与小程序构建的差异，方便直接跑。
