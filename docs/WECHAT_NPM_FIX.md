# 微信「构建 npm」产物损坏：定位、修复与回归指南

> 影响版本：`@openlide/geomstore` 0.6.0（已发布）
> 目标版本：0.6.1
> 影响面：所有在微信小程序中通过 npm 引入本库的项目，**小程序启动即崩溃**
> 修复方向：为主包入口增加「微信专用单文件 CJS 产物」，通过 `miniprogram` 字段暴露给微信「构建 npm」

---

## 0. 问题定性（先看清要修什么）

微信开发者工具执行「工具 → 构建 npm」时，会把本库的 `dist` 依赖图打包进
`miniprogram_npm/@openlide/geomstore/index.js`。对本库产出的压缩多文件 ESM，该打包器稳定产出**坏产物**，存在两个独立缺陷：

| # | 缺陷 | 产物中的实际表现 |
| --- | --- | --- |
| A | **语句拼接丢失分隔符** | `exports.isBuiltinObject = isBuiltinObjectfunction i(e){...}` → `SyntaxError: Unexpected identifier 'i'` |
| B | **外部依赖被标记却不产出** | 文件尾出现<br>`//miniprogram-npm-outsideDeps=["./utils/helpers.js","../integrations/with-store.js","../integrations/with-app-store.js",...]`<br>而这些模块**没有**被写入任何文件 |

后果链条：`index.js` **无法解析** → 该模块无法注册 → 运行时抛

```
module 'stores/@openlide/geomstore.js' is not defined, require args is '@openlide/geomstore'
```

其中缺陷 B 直接打掉 `withPageStore` / `withComponentStore` / `withAppStore`——**正是小程序接入的主 API**。

**关键判据（重要）**：反复执行「构建 npm」不会变好，产物逐字节一致。
对照实验：同为 npm 包的 `miniprogram-api-promise` 产物**解析正常、零拼接缺陷**，
说明这不是打包器通病，而是**本库产物形态**触发的。

**修复原理**：让微信侧的入口变成「**单文件 + 无相对 require + 无需 ESM→CJS 转换**」的
自包含 CJS 产物 —— 缺陷 A 因无可拼接的多模块而消失，缺陷 B 因无外部依赖可被错标而消失。

---

## 1. 定位并获取源码目录

### 1.1 从发布包元数据定位（权威、跨机器可用）

```powershell
npm view @openlide/geomstore repository.url
# → git+https://github.com/openlide/geomstore.git
npm view @openlide/geomstore homepage engines version
# → https://github.com/openlide/geomstore#readme  |  {"node":">=22.0.0"}  |  0.6.0
```

**预期结果**：得到仓库地址 `https://github.com/openlide/geomstore.git`。
**验证方式**：`git ls-remote --heads https://github.com/openlide/geomstore.git` 能列出
`refs/heads/develop` 与 `refs/heads/main`。

### 1.2 本机检索已克隆的目录

```powershell
# 常见开发根目录下按名字检索
foreach ($root in @('D:\WorkSpace', 'D:\', "$env:USERPROFILE")) {
  if (Test-Path $root) {
    Get-ChildItem -Directory $root -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match 'geomstore|openlide' } |
      ForEach-Object { $_.FullName }
  }
}
```

**本机实测结果（已完成，可直接使用）**：

```
D:\WorkSpace\openlide\GeomStore          ← 工作目录（注意大小写：GeomStore）
D:\WorkSpace\openlide\GeomStore-backup-20260817   ← 备份，勿在此工作
D:\WorkSpace\openlide\GeomFramework、GeomIM       ← 同组织下的其他项目
```

进入后确认 remote 指向正确：

```powershell
cd D:\WorkSpace\openlide\GeomStore
git remote -v      # origin  https://github.com/openlide/geomstore.git (fetch/push)
git branch --show-current   # develop
```

### 1.3 尚未克隆时的获取方式

```powershell
cd D:\WorkSpace\openlide
git clone https://github.com/openlide/geomstore.git GeomStore
cd GeomStore
git checkout develop
```

**验证方式**：`git log --oneline -3` 应看到类似
`2a7af5b ci: 第三方 Action 钉到完整 commit SHA`、`5ffe8a0 chore(release): 版本号由 0.5.2 改发 0.6.0`。

### 1.4 关于小程序仓库里的历史副本（重要提示）

小程序仓库（`D:\WorkSpace\lide\lide-miniapp`）里曾有一份本库源码副本
`miniprogram/libs/geomstore`，现已移除；其未提交内容保全在分支 `wip/geomstore-lib`
（另有 `stash@{0}`）。

**已核对：该副本内容与外部仓库 `develop` 当前状态一致**（`src/core/index.ts` 的设计文档逐字相同）。
因此**无需从该快照合并**，但也不要把它当作工作基线——它只是冗余快照。

```powershell
# 仅作参考，恢复后不影响外部仓库
git -C D:\WorkSpace\lide\lide-miniapp worktree add ..\geomstore-snapshot wip/geomstore-lib
```

---

## 2. 修复前必须确认的环境依赖与配置项

在 `D:\WorkSpace\openlide\GeomStore` 下逐项确认：

### 2.1 工具链

| 项 | 要求 | 检查命令 | 预期 |
| --- | --- | --- | --- |
| Node.js | `>=22.0.0`（`engines` 硬约束） | `node -v` | v22 及以上 |
| pnpm | 仓库全部脚本使用 `pnpm` | `pnpm -v` | 正常输出版本 |
| TypeScript | `^6.0.3`（`NoInfer` 等签名依赖高版本） | `pnpm why typescript` | 6.x |
| terser | `^5.51.2`（`scripts/minify-dist.mjs` 使用） | `pnpm why terser` | 5.x |
| esbuild | **需新增为直接 devDependency** | `pnpm why esbuild` | 当前仅传递依赖，见 S3 |

### 2.2 仓库基线（必须干净且同步）

```powershell
git branch --show-current          # develop
git status --short                 # 应为空
git fetch origin; git rev-parse --short HEAD; git rev-parse --short origin/develop
```

**预期结果**：分支 `develop`、工作区干净、本地 HEAD 与 `origin/develop` 一致（实测均为 `2a7af5b`）。
**若不一致**：先 `git pull --ff-only` 或新建分支 `fix/weapp-npm-entry`（推荐，避免污染 `develop`）。

### 2.3 待改动的配置项（当前状态 → 目标状态）

| 文件 | 字段 | 当前 | 目标 |
| --- | --- | --- | --- |
| `package.json` | `miniprogram` | **不存在** | `"dist-weapp"`（**目录**，见 §6-C1） |
| `package.json` | `files` | `["dist","CHANGELOG.md","store","hooks",...]` | 增加 `"dist-weapp"` |
| `package.json` | `scripts.build:weapp` | 不存在 | 见 S3 |
| `package.json` | `scripts.prepublishOnly` | `pnpm test && pnpm run build:release` | 末尾追加 `&& pnpm run build:weapp` |
| `package.json` | `devDependencies.esbuild` | 未声明 | `pnpm add -D esbuild` |
| `.gitignore` | `dist-weapp` | 未忽略 | 忽略（构建产物，与 `dist` 一致） |
| `scripts/clean-dist.mjs` | 清理范围 | 仅 `dist` | **保持仅 `dist`**（见 §6-C3）；`build-weapp.mjs` 自己先清空 `dist-weapp` |

### 2.4 确认触发条件仍然成立（判断"该不该修"）

```powershell
# dist 是否仍是多文件 ESM（相对 export/import 链条）
Select-String -Path dist\core\index.js -Pattern 'from"\./' | Select-Object -First 3
```

**预期结果**：能看到 `export{...}from"./store/index.js"` 这类相对引用 → 触发条件成立。

### 2.5 消费端（小程序仓库）现状，供联调时对照

| 项 | 值 |
| --- | --- |
| 仓库 | `D:\WorkSpace\lide\lide-miniapp` |
| 依赖声明 | `dependencies["@openlide/geomstore"] = ^0.6.0` |
| 微信工具版本 | `2.02.2609222`，基础库 `3.17.3` |
| npm 构建方式 | `project.config.json` → `packNpmManually: true` + `packNpmRelationList` 指向 `./miniprogram/` |
| 当前症状 | 启动即 `module 'stores/@openlide/geomstore.js' is not defined` |
| 注意 | `pnpm-workspace.yaml` 有 `minimumReleaseAgeExclude`，新版本需登记（见 S8） |

---

## 3. 修复步骤

### S1 建立工作分支

```powershell
cd D:\WorkSpace\openlide\GeomStore
git checkout develop
git pull --ff-only
git checkout -b fix/weapp-npm-entry
```

- **预期结果**：新分支创建成功，工作区干净。
- **验证方式**：`git branch --show-current` → `fix/weapp-npm-entry`。

---

### S2 固化"坏产物"证据（便于事后对比与回归）

在**消费端**保留一份当前坏产物样本：

```powershell
cd D:\WorkSpace\lide\lide-miniapp
Copy-Item miniprogram\miniprogram_npm\@openlide\geomstore\index.js "$env:TEMP\geomstore-broken-0.6.0.js" -Force
```

- **预期结果**：样本落盘，供修复后逐项对比。
- **验证方式**：`Test-Path "$env:TEMP\geomstore-broken-0.6.0.js"` → `True`。

---

### S3 新增微信专用构建产物（核心步骤）

```powershell
cd D:\WorkSpace\openlide\GeomStore
pnpm add -D esbuild
```

在 `package.json` 的 `scripts` 中新增：

```jsonc
"build:weapp": "node scripts/build-weapp.mjs",
    "verify:weapp": "node scripts/verify-weapp-bundle.mjs"
```

`prepublishOnly` 追加该步骤：

```jsonc
"prepublishOnly": "pnpm test && pnpm run build:release && pnpm run build:weapp && pnpm run verify:weapp"
```

- **预期结果**：`esbuild` 出现在 `devDependencies`；脚本写入正确（JSON 无尾逗号）。
- **验证方式**：`node -e "const s=require('./package.json').scripts; console.log(s['build:weapp'])"` 能打印出该命令。

> **flag 说明**：`--platform=neutral` 不注入浏览器/Node shim，保持库内
> `typeof xxx !== 'undefined'` 的降级探测语义；`--target` 与 `dist` 现有编译目标保持一致即可。

---

### S4 产出单文件产物

```powershell
pnpm run build:weapp
```

- **预期结果**：生成 `dist-weapp/index.js`，为**单文件自包含 CJS**（外部无 `require('./...')`）。
- **验证方式**：

```powershell
(Get-Item dist-weapp\index.js).Length                    # 应明显大于 dist\index.js（0.6KB 左右）
Select-String -Path dist-weapp\index.js -Pattern "require\(['`"]\./"   # 期望：无输出
```

**若出现相对 require**：说明未真正 bundle，检查 `--bundle` 是否生效、入口路径是否为 `src/index.ts`。

---

### S5 本地验证产物（★最关键，务必执行）

`package.json` 是 `"type": "module"`，Node 会把 `.js` 当 ESM，因此**必须先复制成 `.cjs`** 再验证：

```powershell
cd D:\WorkSpace\openlide\GeomStore
Copy-Item dist-weapp\index.js "$env:TEMP\gw.cjs" -Force

# ① 语法必须通过（防缺陷 A）
node --check "$env:TEMP\gw.cjs"; echo "check exit=$LASTEXITCODE"

# ② 真实加载 + 逐个核对导出（防缺陷 B：会真实执行整张模块图）
node -e "const m=require(process.env.TEMP+'/gw.cjs'); ['createStore','isGeomStore','composeStore','withPageStore','withComponentStore','withAppStore'].forEach(k=>console.log(k, typeof m[k]))"
```

- **预期结果**：
  - ① `check exit=0`
  - ② 六行输出**全部为 `function`**，尤其 `withPageStore` / `withComponentStore` / `withAppStore`
- **验证方式**：任何一项不是 `function`，或 ① 非 0 —— **停止，不要发版**，按第 4 节排查。

> 这一步是本次事故缺失的验证：单文件 CJS 能被 Node 直接加载，**等价于证明整个模块图可解析**。

---

### S6 接入发布白名单与清理脚本

```jsonc
// package.json
"files": ["dist", "dist-weapp", "CHANGELOG.md", "store", "hooks", "plugins",
          "integrations", "compose", "selectors", "snapshot", "performance",
          "actions", "cache", "error"],
"miniprogram": "dist-weapp"
```

`.gitignore` 增加 `dist-weapp`；`scripts/clean-dist.mjs` 的清理目标一并包含 `dist-weapp`。

- **预期结果**：`miniprogram` 指向存在的文件；发布白名单包含 `dist-weapp`。
- **验证方式**（模拟发布内容，不会真的发包）：

```powershell
pnpm run build:release; pnpm run build:weapp
npm pack --dry-run 2>&1 | Select-String "dist-weapp"
```

**期望**：`npm pack --dry-run` 输出中能看到 `dist-weapp/index.js`。

---

### S7 全量本地检查并发布

```powershell
pnpm typecheck
pnpm test
pnpm lint
node -e "const p=require('./package.json');console.log(p.version)"   # 0.6.0
```

按仓库既有发布约定（历史提交为 `chore(release): 版本号由 0.5.2 改发 0.6.0`）：

```powershell
# 1) 改版本号
npm version 0.6.1 --no-git-tag-version
# 2) 更新 CHANGELOG.md
# 3) 提交（走仓库既有提交规范）
git add -A
git commit -m "fix(build): 增加微信专用单文件 CJS 入口，修复「构建 npm」产物损坏"
git push -u origin fix/weapp-npm-entry      # 按需提 PR 合并到 develop/main
# 4) 发布（prepublishOnly 会自动串联 test + build:release + build:weapp）
pnpm publish --access public
```

- **预期结果**：`pnpm publish` 成功，`prepublishOnly` 三个步骤全部通过。
- **验证方式**：
  ```powershell
  npm view @openlide/geomstore@0.6.1 version
  npm view @openlide/geomstore@0.6.1 miniprogram      # → dist-weapp/index.js
  ```

---

### S8 消费端升级依赖

```powershell
cd D:\WorkSpace\lide\lide-miniapp
pnpm up @openlide/geomstore@0.6.1
```

**同时**在 `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 中登记新版本，否则可能被最小发布年龄策略拦下：

```yaml
minimumReleaseAgeExclude:
  - '@openlide/geomstore@0.6.1'
```

- **预期结果**：`node_modules/@openlide/geomstore/package.json` 的 `version` 为 `0.6.1`，且含 `miniprogram` 字段。
- **验证方式**：
  ```powershell
  node -e "const p=require('./node_modules/@openlide/geomstore/package.json');console.log(p.version, p.miniprogram)"
  # → 0.6.1 dist-weapp/index.js
  ```

---

### S9 微信开发者工具重新构建 npm 并验证

1. 开发者工具 → **工具 → 构建 npm**（会覆盖旧产物）
2. 对**实际产物**执行同一套检查：

```powershell
cd D:\WorkSpace\lide\lide-miniapp
$f = 'miniprogram\miniprogram_npm\@openlide\geomstore\index.js'

# ① 语法
Copy-Item $f "$env:TEMP\gb.cjs" -Force
node --check "$env:TEMP\gb.cjs"; echo "check exit=$LASTEXITCODE"

# ② 拼接缺陷（期望无输出）
Select-String -Path $f -Pattern "[A-Za-z_`$]function [A-Za-z_`$]" -AllMatches |
  ForEach-Object { $_.Matches } | Where-Object { $_.Value -notmatch '^function ' } |
  ForEach-Object { '  缺陷: ' + $_.Value }

# ③ outsideDeps 标记（期望无输出）
Select-String -Path $f -Pattern 'outsideDeps'

# ④ 真实加载（期望六个 function）
node -e "const m=require(process.env.TEMP+'/gb.cjs'); ['createStore','isGeomStore','composeStore','withPageStore','withComponentStore','withAppStore'].forEach(k=>console.log(k, typeof m[k]))"
```

- **预期结果**：① `check exit=0`；②③ 均无输出；④ 六个全为 `function`。
- **验证方式**：四项全过 → 进入 S10 回归。

---

### S10 回归同一提交的工程检查

```powershell
cd D:\WorkSpace\lide\lide-miniapp
npx tsc --noEmit
npx eslint miniprogram tests
npx jest --passWithNoTests
```

- **预期结果**：三者通过（`tsc` 退出码 0、eslint 无 error、jest 全绿）。
- **验证方式**：见第 5 节完整清单。

---

## 4. 常见问题排查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 构建 npm 后产物仍是坏的，`outsideDeps` 依旧出现 | 开发者工具**未识别 `miniprogram` 字段**，仍按 `main` 打包 | ① 确认 `miniprogram` 已随包发布：`npm view @openlide/geomstore@x.y.z miniprogram`；② 工具内彻底清理缓存后重建；③ 仍不行则改走 `pnpm patch`（见下） |
| `npm pack --dry-run` 里没有 `dist-weapp` | 忘记把 `dist-weapp` 加入 `files` | 补 `files` 后重新 `npm pack --dry-run` 校验 |
| 装到项目后 `node_modules/@openlide/geomstore/dist-weapp` 不存在 | 同上，发布白名单缺失 | 重新发一个 patch 版本 |
| `node --check` 报 `Unexpected identifier` | bundle 未生效或产物被二次处理 | 检查 `--bundle`；确认 `minify-dist.mjs` 未覆盖 `dist-weapp` |
| 加载时报 `process is not defined` / `require is not defined` | 库内引用了 Node 全局，或选错 `--format` | 保持 `--format=cjs`；确需注入时加 `--define:process.env.NODE_ENV='"production"'`，不要改 `--platform` 为 `node` |
| 加载时报 `wx is not defined` | bundle 尝试静态解析 `wx` | 库内应保持 `typeof wx !== 'undefined'` 探测；必要时加 `--external:wx` |
| `pnpm up` 被拒（minimum release age） | 新版本未登记豁免 | 在 `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 加 `'@openlide/geomstore@0.6.1'` |
| 小程序里仍报 `module ... is not defined` | 只安装了新版本但**没重新构建 npm** | 工具 → 构建 npm，再按 S9 四项检查 |
| 需要绕过发包的临时验证 | 想先在本仓验证再发版 | 用 `pnpm patch @openlide/geomstore`：在补丁里加入 `dist-weapp/index.js` 与 `miniprogram` 字段，`pnpm patch-commit` 后会产出 repo 内补丁文件，可提交复用 |

---

## 5. 修复完成后的回归验证清单

### 5.1 包侧（`D:\WorkSpace\openlide\GeomStore`）

- [ ] `pnpm typecheck` 通过（含 `typecheck:tests` / `typecheck:examples`）
- [ ] `pnpm test` 全部通过
- [ ] `pnpm lint` 无错误
- [ ] `pnpm run build:release` 产出 `dist`（**原有产物形态不变，ESM 消费者不受影响**）
- [ ] `pnpm run build:weapp` 产出 `dist-weapp/index.js`，且其中**无相对 `require('./...')`**
- [ ] 单文件产物通过：`node --check`（经 `.cjs` 中转）+ 六个导出均为 `function`
- [ ] `files` 含 `dist-weapp`；`miniprogram` 字段指向正确
- [ ] `.gitignore` 忽略 `dist-weapp`；`clean-dist.mjs` 覆盖它
- [ ] `npm pack --dry-run` 输出含 `dist-weapp/index.js`
- [ ] `npm view @openlide/geomstore@0.6.1 miniprogram` → `dist-weapp/index.js`
- [ ] `CHANGELOG.md` 已记录本次修复

### 5.2 消费端（`D:\WorkSpace\lide\lide-miniapp`）

- [ ] `node_modules/@openlide/geomstore/package.json` 版本 = `0.6.1` 且含 `miniprogram`
- [ ] `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 已登记 0.6.1
- [ ] 开发者工具「构建 npm」已重新执行
- [ ] 实际产物四项检查全过：语法 / 无拼接缺陷 / 无 `outsideDeps` / 六导出为 `function`
- [ ] `npx tsc --noEmit` 退出码 0
- [ ] `npx eslint miniprogram tests` 无 error
- [ ] `npx jest` 通过
- [ ] **小程序冷启动无 `module ... is not defined` 报错**
- [ ] 使用 `withPageStore` 的页面：数据正确渲染，且 action 触发后 `setData` 正常刷新
- [ ] 使用 `withComponentStore` 的组件（如 `components/liui/float-bar`）行为正常
- [ ] App 级状态（`withAppStore`）在页面间正确同步
- [ ] 分包页面（`packages/*`）加载无异常
- [ ] 与坏产物样本对比：三项缺陷特征全部消失（`$env:TEMP\geomstore-broken-0.6.0.js`）

### 5.3 若不通过时的回退顺序

1. 先确认是**产物问题**还是**参数问题**：对实际产物跑 5.2 的四项检查
2. 产物仍坏 → 走第 4 节的 `pnpm patch` 路线（不阻塞发包验证）
3. 需要立刻恢复可用 → 消费端回到本地源码快照（`D:\WorkSpace\lide\lide-miniapp` 的
   `wip/geomstore-lib` 分支），或回退移除副本的那次提交 `4449af4`

---

## 附：本次事故的完整证据链（便于复盘）

| 环节 | 证据 |
| --- | --- |
| 缺陷 A | 产物第 20 行：`exports.isBuiltinObject = isBuiltinObjectfunction i(e){` |
| 缺陷 A 复现 | 经 `.cjs` 中转后 `node --check` → `SyntaxError: Unexpected identifier 'i'` |
| 缺陷 B | 文件尾 `//miniprogram-npm-outsideDeps=["./utils/helpers.js","../integrations/with-store.js","../integrations/with-app-store.js",...]` |
| 缺陷 B 佐证 | sourcemap `sources` 仅 10 项且全在 `core/**`；`bindMappings`/`parseMapping`/`__geomUnbinds`/`performAutoInject` 计数均为 0 |
| 非打包器通病 | 同仓 `miniprogram-api-promise` 产物：解析正常、拼接缺陷数 0 |
| 重建无效 | 删除产物后重新「构建 npm」，上述各项逐项一致 |

---

## 6. 主会话复核（2026-09-23，实施时）：与本文的差异与实测数据

本文的定位、缺陷特征、后果链条与修复原理**全部复核成立**（下表最后一行是本会话独立复现的结果）。实施时有四处按项目实际与官方规定做了调整，均已落到代码里。

### C1 `miniprogram` 指向的是**目录**，且必须覆盖全部公开子路径

官方《npm 支持》：「小程序 npm 包要求根目录下必须有构建文件生成目录（默认为 `miniprogram_dist` 目录），此目录可以通过在 package.json 文件中新增一个 `miniprogram` 字段来指定」；又「小程序 npm 包会直接拷贝构建文件生成目录下的所有文件到 `miniprogram_npm` 中」「只有构建文件生成目录会被算入小程序包的占用空间」。

所以 §2.3 / §S6 原写的 `"miniprogram": "dist-weapp/index.js"`（指向文件）不成立，已改为 `"dist-weapp"`。相应地产物是**镜像子路径布局的 11 个单文件**，不是只有主入口一个：本包 `exports` 有 11 个子路径，只发主入口会让其余 10 个在微信侧无路可走——那是缺陷 B 的另一种形态（API 存在但取不到），不能被「启动不崩」掩盖过去。

### C2 入口清单从 `exports` 派生，构建改成一个脚本

`scripts/weapp-entries.mjs` 是唯一映射实现（`./dist/<rel>.js` → `src/<rel>.ts` → `dist-weapp/<rel>.js`），`build-weapp.mjs` 与 `verify-weapp-bundle.mjs` 共用。理由：把 11 条入口再抄一份清单，正是上一轮 R5-025 在 postpack 清理面上修掉的「两处清单必漂移」。对不上（exports 形状变了 / 源文件缺失 / esbuild 不可用）一律退出码 1，绝不产出缺入口的目录。

`--target` 取 **`es2020`** 而非本文的 `es2017`：本文自己的口径是「与 `dist` 现有编译目标保持一致」，而 `tsconfig.json` 是 `target/lib: ES2020`。多出的 `--charset=utf8 --legal-comments=none` 按本文保留。

### C3 `clean-dist.mjs` 不扩到 `dist-weapp`

`build-weapp.mjs` 自己先整目录清空再写，不会留已删除子路径的尸体；反过来若让 `prebuild`（`pnpm build`）去删 `dist-weapp`，就开出一条新事故路径：`miniprogram` 指向空目录 + npm 对 `files` 里缺失的项**静默跳过** + 微信按 `main` 打包 → 回到 0.6.0 的坏产物，而且这次连「目录不存在」的显式信号都没有。

### C4 §S5 的手工校验固化成门禁

`pnpm run verify:weapp`（`scripts/verify-weapp-bundle.mjs`）逐入口检查：非空、可被 CJS 真实加载、零 `require`、无 `outsideDeps`、无残留 ESM 语法、**导出面与 `dist` 的 ESM 逐项比对**，再跑一次真实用例（createStore / dispatch / subscribe / getter / `$snapshot` 只读）。已串进 `prepublishOnly` 与 CI 的 `verify` job。加载时复制成临时 `.cjs` 的做法沿用本文 S5——根 `package.json` 是 `"type": "module"`，仓库内 `.js` 会被 Node 当 ESM，直接 require 会报 `module is not defined in ES module scope`，那是 Node 的扩展名规则而非产物缺陷。

### C5 实施后复盘：产物形态由「bundle 单文件」改成「按模块一比一转译」（§0 修复方向、§S3、§S4、§S6 里「单文件 / 外部无 `require`」的表述以本条为准）

- 触发点：C1 落地后在开发者工具里实测——`miniprogram_npm/@openlide/geomstore/` 里 11 个 `.js` 与构建出的 `dist-weapp/` **逐字节相同（11/11）**，既不拼接也不做依赖分析。也就是说 bundle 所防的那件事（工具自己打包整张图）在 `miniprogram` 路径下根本不会发生；缺陷 A/B 的成因是「无该字段时按 `main` 打包 ESM」，加字段已经绕开了它。
- 于是 bundle 只剩下代价，两条都实测过：**体积** 457.1 KB vs 228.3 KB（esbuild 的 `--splitting` 只支持 `esm`，CJS 多入口必然重复内联 core）；**语义** 自包含 bundle 让 `.` 与 `./core` 各持一份 `globalRegistry`、`./extras` 与 `./extras/enterprise` 各持一份 `storeManager`（实测两条均为「不是同一对象」，ESM 侧两条都是同一对象）——等于一次运行里有两套 Store 注册表，这比体积更不能接受。
- 现方案：`dist-weapp/` 是 `src` 全部模块一比一转译成的 CJS（105 个文件，文件树与 `dist` 一致），**保留相对 `require`**；运行时只加载真正被 require 到的文件，跨入口天然共享同一实例。`verify:weapp` 的断言相应换成「`dist` 镜像完整 + 每条相对 `require` 的目标必须存在 + 整张图按 CJS 真实加载 + 导出面逐项比对 + **跨入口单例同一性** + 真实用例」。反向验证：删掉 `dist-weapp/extras/snapshot/clone.js` 后门禁报 5 项，其中闭环那条直接点名两条断链的引用方。
- 加载方式也换掉了 §S5 的「复制成 `.cjs`」：产物靠相对 `require("./x.js")` 互联，Node 按字面扩展名解析，改后缀等于把依赖图剪断。现在整目录复制到临时目录并就地放一个 `{"type":"commonjs"}` 的 manifest，加载路径与微信运行时同构。
- 若未来某版工具改成对拷贝目录再做一次依赖分析：`outsideDeps` 复现、`Cannot find module` 会被门禁与 §S9 四项当场抓住；换回 bundle 只需在 `build-weapp.mjs` 里加回 `bundle: true` 与 11 个 `entryPoints`，但要同时接受体积翻倍，并把「跨入口单例同一性」降级为告警——那是形态决定的，不是回归。

### 实测数据（0.6.1，`esbuild 0.28.2`，`--minify`）

| 子路径 | 产物 | 大小 |
| --- | --- | --- |
| `.` | `dist-weapp/index.js` | 66.8 KB |
| `./core` | `dist-weapp/core/index.js` | 66.8 KB |
| `./integrations` | `dist-weapp/integrations/index.js` | 65.9 KB |
| `./extras` | `dist-weapp/extras/index.js` | 107.5 KB |
| `./extras/snapshot` | `dist-weapp/extras/snapshot.js` | 16.6 KB |
| `./extras/selector` | `dist-weapp/extras/selector.js` | 10.8 KB |
| `./extras/performance` | `dist-weapp/extras/performance.js` | 10.3 KB |
| `./extras/action` | `dist-weapp/extras/action.js` | 18.8 KB |
| `./extras/enterprise` | `dist-weapp/extras/enterprise.js` | 59.5 KB |
| `./extras/plugins` | `dist-weapp/extras/plugins.js` | 11.5 KB |
| `./extras/error` | `dist-weapp/extras/error/index.js` | 22.7 KB |
| **合计** | 11 个入口 | **457.1 KB** |

- 导出面对齐：`.` 为 28/28、`./extras/action` 18/18、`./extras/error` 31/31，其余同样逐项相等。
- 体积代价：esbuild 的代码切分**只支持 `esm`**（实测 `--bundle --splitting --format=cjs` 报 `Splitting currently only works with the "esm" format`），所以 CJS 多入口下 `core` 必然在若干 bundle 里各有一份。这是换取「零相对 require」的代价；只要核心的宿主可自行裁 `exports` 后重跑 `build:weapp`。
- 对照方案（未采用）：把 `src` 一比一转成 CJS、**不 bundle**，实测只有 **228.3 KB / 105 文件**，比现方案小约一半。但它每个文件都带相对 `require("./store/index.js")`——只要工具对拷贝目录还做一次依赖分析，就正好落回缺陷 B。单文件形态在「只拷贝」与「拷贝后再分析」两种实现下都不会坏，多付的 ~229 KB 买的是这个确定性。
- 本文附录里那句「反复执行构建 npm 不会变好、产物逐字节一致」也解释了为什么门禁必须放在**发布前**：微信侧无法自救。

### 本会话独立复现的坏产物证据（消费端现存 0.6.0 产物）

`miniprogram/miniprogram_npm/@openlide/geomstore/index.js`，22,033 字节：

- `node --check`（经 `.cjs` 中转）→ `SyntaxError: Unexpected identifier 'i'`，位置正是 `exports.isBuiltinObject = isBuiltinObjectfunction i(e){`。
- 文件尾 `outsideDeps=["./utils/helpers.js","../integrations/with-store.js","../integrations/with-app-store.js","./Store.js","./SubscriptionMan…"]` 命中。
- `bindMappings` / `performAutoInject` 在文件中出现 **0 次** → 被标记为外部依赖的那批模块确实一个字都没产出。
- 同目录只有 `index.js` + `index.js.map`，无任何子路径文件。

### 仍需人工完成的两步（本会话做不到）

1. **§S9 必须在微信开发者工具里跑**：本会话能读到 `lide-miniapp` 的文件，但无法启动开发者工具执行「构建 npm」。发布 0.6.1 后按 §S9 的四项检查对**实际产物**验一遍，再跑 §S10。
2. **§S8 的 `minimumReleaseAgeExclude`** 在消费端仓库里，属那边的改动。

另：本文 §5.1 的「`npm view @openlide/geomstore@0.6.1 miniprogram` → `dist-weapp/index.js`」按 C1 应为 `dist-weapp`。
