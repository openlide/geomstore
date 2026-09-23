# 第六轮收尾·文档波次 B 台账

范围：`docs/GUIDE.md`、`docs/FAQ.md`、`docs/MIGRATION.md`、`docs/ARCHITECTURE.md`、`README.md`、`CONTRIBUTING.md`。
**未触碰**：A 波次的 `docs/API.md` / `docs/CONCEPTS.md` / `docs/BEST_PRACTICES.md` / `CHANGELOG.md` / `.codebuddy/**`；以及 `src/**`、`tests/**`、`examples/**`、`package.json`。
**版本号四处（`package.json` / `hot-update.ts` 的 `LIBRARY_VERSION` / `SKILL.md` 三处手写行 / `skill:api` 生成物「来源版本」行）一处都没改**，按裁定留给主会话统一 bump 到 0.7.0 + 重跑 `pnpm skill:api`。

依据文件：`ocrreview6.md` 的 9 条 high、`.ocr-fix/verdicts6/hot-p0.md`（R6-002/003/005/006/007/008/009）、`f1-05.md`（R6-037）、`f1-06.md`（R6-046）、`f1-08.md`（R6-050/101）、`f2-13.md`（R6-099/100）、`f1-01.md`（R6-066）、`f1-04.md`（R6-033 LRUCache.forEach）、`f1-02.md`（R6-018 版本同步门禁）、`main-followups.md` 的 A1/A4/A5、B14/B15 与 C 节第 17 条。

---

## docs/GUIDE.md

| 小节                 | 改了什么                                                                                                                                                                                                                                                                                                                                                                                             | 依据                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| §2 读写表 + 新增两段 | 表格补 `getCached(key)`（缓存唯一读取入口）与 `invalidateCache()` 两行；新增「缓存的读写口径」段：`getState()` 不查缓存、`setState`/`$patch` 写穿、显式失效只有 `invalidateCache()`/`$replaceState`、集成层绑定走 `getCached()`；新增「原型链敏感键」段：`setState('__proto__'\|'constructor'\|'prototype')` 改 DefineOwnProperty（值成自有数据属性、原型不变、读回要用 `getOwnPropertyDescriptor`） | R6-003、R6-007                   |
| §2 就地变异与隔离    | 补一句两条克隆引擎对「子类与内部槽位值」都保留原引用                                                                                                                                                                                                                                                                                                                                                 | R6-008                           |
| §2 状态保护          | 新增豁免段：冻结/不可写属性拿到裸引用、读取不再抛 Proxy invariant `TypeError`、代价是不受写保护也不计脏；点名 `$snapshot()` 深冻结子树写回这条来路                                                                                                                                                                                                                                                   | R6-006                           |
| §3 通知语义          | 四条重写：同步段当场补发 + settle 覆盖续段、默认模式 1→2、`notify.async`/`onlyOnChange` 吸收、batch 内不提前补发、动机是 Promise 永不 settle                                                                                                                                                                                                                                                         | R6-037                           |
| §3 宿主收尾          | 加「适用范围」前提；新增「装饰 store action 时这六个入口不可用」段：actionContext Proxy 不可寻址 → 静默 no-op、主会话裁定不暴露宿主、给 ①装饰 Page/Component 方法 ②store 外包一层（`class CartApi` + `cancelDebouncedCalls(cartApi)`）两条替代写法与判别口诀（**GUIDE:231 那段假话已改**）                                                                                                           | R6-046 / A1                      |
| §4 Getter            | 删「依赖未变时复用结果，判定基于内部状态版本号」这句假话（**GUIDE:244 点名点到的位置**），改为「无结果缓存、每次重算」+ 指向 `createSelector` + 销毁后 `getter()` 抛错                                                                                                                                                                                                                               | R6-002                           |
| §7 快照              | 代码注释「绝不会出现活引用」改口；新增两条要点：保留原引用的两类节点（内建容器子类 / 槽位承载值，含旧的空壳后果与 `customCloner` 出口）、数组附加自有键与 `includeNonEnumerable` 落可枚举；`compareSnapshots` 补 `inputTrusted` 必填 + 失败输入 `changed` 恒 true；新增「差异路径方言」条（Map 按键身份、Set 下标非身份）                                                                            | R6-008/050/099/100/101 + B14/B15 |
| §8 选择器            | 开头点明「记忆化入口只有选择器」                                                                                                                                                                                                                                                                                                                                                                     | R6-002                           |
| §9 组合 Store        | 新增子 store 独立销毁的读路径口径（空视图并入 + 一次性告警、`getState().child` 变空对象而非缺键、销毁整体仍 `composed.destroy()`）                                                                                                                                                                                                                                                                   | R6-005                           |
| §11 性能             | 「只缓存热点键」补读取入口与写穿口径；`enableStats` 默认 `true`（原「按需开启」把方向说反）；挂起定时器条加「store action 上无从收尾」                                                                                                                                                                                                                                                               | R6-003/069、R6-046               |
| §12 排错表           | 新增/改写 6 行：Proxy invariant 读取抛、通知次数偏多（1→2）、getter 每次重算、hits/misses 恒 0、写穿不是失效、收尾入口调了没效果、组合层子店销毁                                                                                                                                                                                                                                                     | R6-006/037/002/003/046/005       |

## docs/FAQ.md

| 小节         | 改了什么                                                                                                                                                                                                                                                                          | 依据                   |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 状态与通知   | 「直接写 state.x」加冻结豁免段；「异步 action 的通知次数」整条重写（同步段补发、1→2、两种吸收方式、断言要重算）；`isStateKeyDirty` 一条改成「同步段脏键提前投递 + `notify.async` 下可能多一个空脏键批次」；新增「`setState('__proto__')` 之后为什么凭空多出一些键」               | R6-006/037/007         |
| 缓存与选择器 | 新增「`getState()` 与 `getCached(key)` 有什么区别」（写穿 / 显式失效 / 集成层走 getCached）；命中率条改口径；新增「`store.getter(name)` 会缓存结果吗」（答：从未有过）；`enableStats` 一条按默认 `true` 改正（**FAQ:77 原写「默认关闭」是假话**）                                 | R6-003/002/069         |
| 快照         | 隔离契约一句加「保留原引用 ≠ 丢弃」的区分；「快照能克隆类实例/Date/Map 吗」补两类保留原引用的节点与旧的空壳后果、数组附加键；新增「`compareSnapshots` 只报一条根路径差异？」（`inputTrusted` 判读顺序）与「差异路径怎么读？」（Map 键身份、Set 下标非身份、`root[0]` 聚合方要改） | R6-008/050/099/100/101 |
| 装饰器       | 收尾一节加「前提：那个 `this` 你拿得到」；**FAQ:150 点名位置**改为新增独立问答「我把 `withDebounce` 装饰在 store action 上，为什么 `cancel*`/`flush*`/`dispose*` 都不生效？」（根因、不暴露宿主的理由、①②两条替代代码、判别口诀）；内存一节那条挂起定时器补同一前提               | R6-046 / A1            |
| 集成与工程   | `Cannot call … on a destroyed Store` 一条加「组合 Store 是这条规则的唯一豁免」段（读空视图 + 一次性告警、旧口径是读崩、检查三处写法）                                                                                                                                             | R6-005                 |

## docs/MIGRATION.md

新增 `## 升级到 0.7.0` 一节（倒序置顶），三小节：

- **需要改代码** 5 条：`setState('__proto__')`（R6-007）、组合层抛错→空视图（R6-005）、手工构造 `SnapshotDiff` 补 `inputTrusted`（R6-050）、`Map` 条目路径按键身份（`root[0]`/`root.key[0]` 聚合方要改，R6-101）、快照不再克隆子类与槽位值（R6-008/099/100 + B14/B15）
- **行为变更（复核断言/监控）** 5 条：异步 action 通知 1→2（R6-037）、stateProtection 冻结豁免（R6-006）、收尾入口对 store action 不可用（R6-046，明写「文档纠正」）、getter 无缓存 + 缓存只认 `getCached` + `enableStats` 默认 true（R6-002/003/069，标为库行为未变）、异步快照超时判定收紧（f1-08）
- **版本号与文档同步**：四处版本号由主会话 bump 到 0.7.0 并重跑 `skill:api`；开头说明 0.6.1 只动产物链、`^0.6.1` 不跨 minor

## docs/ARCHITECTURE.md

| 小节            | 改了什么                                                                                                                                                                                                                                                                                                                                                                                                  | 依据                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| §4.1 表         | `Store.ts` 行点明 getter 无结果缓存（`GetterManager` 只持三字段）、`StateProxy.ts` 行写 Proxy invariant 豁免及代价、`ActionManager.ts` 行写同步段补发、`StoreCache.ts` 行写「读侧只有 `getCached`」+ 写穿、`stateVersion.ts` 行注明不为 getter 服务                                                                                                                                                       | R6-002/003/006/037                 |
| §4.1 写入追踪   | 开头改为「推进版本并**写穿**缓存条目」+ 三入口共用 `PROTO_SENSITIVE_KEYS`/`defineOwnProperty` 一份判据（含相等性按自有描述符取值）                                                                                                                                                                                                                                                                        | R6-003/007                         |
| §4.2 LRUCache   | `forEach` 口径改为「进入时取键快照」（旧「先取后继再回调」失真）；补 `enableStats` 默认 true                                                                                                                                                                                                                                                                                                              | R6-033（f1-04）、R6-069            |
| §4.3 compose    | 新增「子 store 独立销毁」条：三条读路径 + `findTargetStoreWithKey` 统一「已销毁即跳过」+ 空视图并入 + `warnDestroyedChildOnce` + `_childVersion` 的 `-1` 哨兵                                                                                                                                                                                                                                             | R6-005                             |
| §7 插件表       | `loggerPlugin` 行删「耗时」假话（不计时，要耗时用 `analyzerPlugin`）+ 生产静默                                                                                                                                                                                                                                                                                                                            | R6-012（f1-01）                    |
| §8.1/8.2 数据流 | setState 流补敏感键与写穿；dispatch 流补 actionContext 不可寻址（装饰器收尾入口定位不到）与同步段补发、onlyOnChange 判据                                                                                                                                                                                                                                                                                  | R6-003/007/037/046                 |
| §8.3 快照       | 补三道准入门槛与核心合流、数组附加键、异步超时只在「未完成」时 `success:false`、两类保留原引用节点、`compareSnapshots` 可信性闸门与路径方言                                                                                                                                                                                                                                                               | R6-008/050/099/100/101 + B14/B15   |
| §10 质量门禁    | **删掉未实测数字**：不再写「144 套件、3408 用例」「当前实测四项 99.86/99.08/99.82/99.91」，改为引用 `jest.config.js` 的 `coverageThreshold`（global 语句/函数/行 98、分支 95；单文件分支 85）+ `（第六轮收口实测：<待填>）` 占位；静态检查条补 Prettier `Format check` 只判格式不判 EOL；CI 条对齐现状（`build:release`、`build:weapp`+`verify:weapp`、`npm pack --dry-run`、压缩产物冒烟、Format check） | R6-066 + 主会话裁定 + f1-01 代做项 |
| §11 取舍表      | 新增 5 行：getter 不做缓存、冻结属性豁免、组合读空视图、不暴露 actionContext 宿主、`inputTrusted` 必填；覆盖率行补「文档只引用阈值、实跑数字由收口填」                                                                                                                                                                                                                                                    | R6-002/006/005/046/050             |

## README.md

- 「工程可信」条：删「并全绿」这种未经本轮实跑的说法，只陈述 `coverageThreshold` 定义的门槛（数字与 `jest.config.js` 逐项核对：global 98/95/98/98 + 单文件分支 85）
- 核心能力表：Getter 行删「依赖未变时复用」（假话）→「每次重算、无结果缓存、记忆化用 `createSelector`」；内置缓存行补「读取只认 `getCached()`」与写穿/`invalidateCache()`；快照与还原行补「子类与内部槽位值保留原引用」
- 未写任何未经实测的覆盖率/套件数/用例数

## CONTRIBUTING.md

- 门禁命令块补 `pnpm exec prettier --check "src/**/*.ts" "tests/**/*.ts"`（与 CI `Format check` 逐字同一条；注明仓库**暂无** `format:check` 脚本，只 `format`）
- 新增「换行符与格式门禁的现状（第六轮定稿）」段：`.prettierrc.json` 保持 `endOfLine: auto`、`Format check` **只判格式不判 EOL**、理由（本机 `core.autocrlf=true`、工作树 231 个 CRLF / index 侧 400 个 LF）、`.gitattributes` + `git add --renormalize` 归**另开一次单独提交**、并明确「不要提前把 lf 口径写进文档」
- CI 段对齐现状（Format check / `build:release` / `build:weapp`+`verify:weapp` / `pack --dry-run`）
- 发版清单：第 4 步补「漏改 SKILL.md 三处或漏跑 `skill:api` 现在会让 `pnpm test` 变红」（R6-018）；第 5 步补 `Format check`；新增「第六轮的口径」条——**本轮 0.7.0、含 5 组行为变更（R6-005/006/007/008/050）、按 0.x 语义必须升 minor**，四处版本号由主会话收口时统一 bump + 重跑生成器，**改文档的分片不许自己动那四处**
- 文档一节新增「文档不写未经实跑的数字」条（覆盖率一律引用 `coverageThreshold`；套件/用例/实测百分比要么删要么写 `<待填>` 由收口填）
- 易错点清单新增 8 条：装饰器收尾入口对 store action 无效（不得写成「同样成立」）、getter 无缓存、`getCached` 唯一读入口 + 写穿 + `enableStats` 默认 true、冻结属性豁免、组合层子店销毁读空视图、快照两类保留原引用 + Map 路径按 `String(key)`、`SnapshotDiff.inputTrusted` 必填、异步 action 同步段补发通知（不再写「同步段不单独通知」）

---

## 实跑结果

1. `npx prettier --check README.md CONTRIBUTING.md docs/GUIDE.md docs/FAQ.md docs/ARCHITECTURE.md docs/MIGRATION.md`
   → `All matched files use Prettier code style!`（6/6 通过）
2. 事实核对：`jest.config.js` 的 `coverageThreshold`（global branches 95 / functions 98 / lines 98 / statements 98；`./src/core/**` 与 `./src/extras/{snapshot,selector,action}/**` branches 85）已逐字读取后引用；`.prettierrc.json` 实读为 `"endOfLine": "auto"`；`.github/workflows/ci.yml` 实读第 64-72 行确认 `Format check` 的 glob 与「只判格式不判 EOL」注释；`package.json` 实读确认只有 `format`、无 `format:check`；`ls .gitattributes` 确认不存在
3. 改前基线（用 `git show HEAD:<file> | prettier --stdin-filepath <file> --check` 逐文件验）：README / GUIDE / FAQ / ARCHITECTURE / MIGRATION **在 HEAD 就全部不 conform**（CONTRIBUTING 干净），所以为让 md 过格式，本波次对 README/GUIDE/FAQ/ARCHITECTURE/MIGRATION 跑了一次 `prettier --write`。已用「剥空白 + 剔除表格分隔行」的字符级比对确认**没有正文/代码内容改动**：差异只有表格列宽补齐、```ts 块内的注释对齐被展平、单行方法体被拆成多行、一处补 `,`（`store.use(persistencePlugin({...}))`的尾逗号）。**这是 formatting-only churn，评审时可按`git diff -w`看**；副作用是文档里原有的「行尾注释列对齐」风格在这 5 个文件内被统一成 prettier 风格，若 A 波次的 API/CONCEPTS/BEST_PRACTICES 要保持同一观感，需要主会话一并`prettier --write docs/\*.md`（那 3 个文件本波次未动，仍可能不 conform）
4. 未跑全量门禁（`test:ci` / `lint:ci` / `typecheck` / `build`）——本轮收口实跑归主会话；`<待填>` 占位共 2 处，都在 `docs/ARCHITECTURE.md` §10（测试行、覆盖率行），另有 CONTRIBUTING 文档一节把该口径写成通用规则
5. 未提交（按指令）；`git status` 本波次只涉及上述 6 个文件

## 留给主会话的尾巴

- 填 `docs/ARCHITECTURE.md` §10 的 2 处 `（第六轮收口实测：<待填>）`
- 是否把 `docs/API.md`、`docs/CONCEPTS.md`、`docs/BEST_PRACTICES.md`、`CHANGELOG.md`（A 波次文件）一并 `prettier --write`，以免 md 风格在仓库里分两截
- `.gitattributes` + `git add --renormalize .` 单独一次提交（R6-066 未落地的那一半）；`package.json` 若要加 `format:check` 脚本再同步 CONTRIBUTING 那行命令
- README 与本波次文档都不再宣称「全绿/100%」；CHANGELOG 的 0.7.0 条目（A 波次）需与本 MIGRATION 一节同一口径
