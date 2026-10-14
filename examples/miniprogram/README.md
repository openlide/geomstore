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

前置：Node ≥ 22、已安装**微信开发者工具**、工具里已在
`设置 → 安全` 打开**服务端口**。

```bash
# 1) 仓库根：构建要发布给小程序的那一份产物（dist-weapp）
pnpm build:weapp && pnpm verify:weapp

# 2) 本目录：装 automator，并把 dist-weapp 同步到 miniprogram_npm
cd examples/miniprogram
npm install
npm run sync:lib

# 3) 用开发者工具打开本目录，菜单执行「工具 → 构建 npm」
#    （sync:lib 已放好文件，构建 npm 是为了让它生成正式的 miniprogram_npm 索引）

# 4) 冒烟
npm run e2e
# 想把「跳过」也按失败计（发布前的口径）：
npm run e2e:ci
```

找不到开发者工具的 cli 时指定路径：

```bash
MP_CLI_PATH="/Applications/wechatwebdevtools.app/Contents/MacOS/cli" npm run e2e        # macOS
set MP_CLI_PATH="C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" && npm run e2e  # Windows
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
├── scripts/sync-lib.mjs       # dist-weapp → miniprogram_npm
└── e2e/run.mjs                # automator 冒烟
```

## 已知取舍

- `page.evaluate` / `element.wxml()` 在旧版工具上没有，这类断言会**跳过**而不是误报失败；
  `--strict` 可把跳过按失败处理，用于发版前的人工核对。
- 「前后台切换」是用 App 的 `onHide/onShow` 回调模拟的，不是系统级前后台事件——
  真机上的应用级验证请在体验版里手动过一遍。
- demo 用 `.js` 而非 `.ts`：最小化 `(examples/**)` 与小程序构建的差异，方便直接跑。
