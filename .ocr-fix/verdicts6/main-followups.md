# 第六轮跨分片交接与主会话代做项

登记口径：每条写明「来源分片 / 需要动哪个文件 / 为什么不能由该分片做」。全部做完后本文件与 `verdicts6/*.md` 一起入库。

## A. 需要主会话拍板的行为分叉

1. **R6-046（f1-06）action 装饰器的宿主不可寻址**：`debounce`/`throttle` 的 `cancel/flush/dispose` 作用在 store action 上时，宿主是 `ActionManager` 内部的 actionContext Proxy（`src/core/store/ActionManager.ts:127-149`），拿得到 timer 但拿不到调用方持有的那个函数对象 → 入口方法静默 no-op。f1-06 只落地了「装饰 store action 时不可用」的注释。拍板：**A** 维持现状 + 同步 `docs/GUIDE.md:231`、`docs/FAQ.md:150`；**B** 让 actionContext 暴露宿主句柄（公开面扩大）。
2. **R6-114（f1-11）根 `tsconfig.json` 的 `types` 含 `jest`**：实测把基线改成 `["node"]` 后 typecheck / typecheck:src / :examples / build 全部 0 错、无管线变红，src+examples 对 jest 全局零依赖（唯一变红项是 f1-06 当时的在飞用例）。f1-11 因「零配置改动」约束挂起。→ 主会话裁定：该约束的原话是第五轮 root-config 实修了 18 条配置，所以它并不禁止本轮改 tsconfig；采纳一行改动 + 注释说明基线不该带测试全局。
3. **R6-061 / SKILL.md 与代码相反（f1-10）**：`src/types/compose.ts` 的 `lazy`/`tree`/`NamespaceConfig` 运行时零消费，f1-10 判 REJECT（只在类型上标注「未实现」，不静默删导出），但 `.codebuddy/skills/geomstore/SKILL.md` 现称这三个「已移除」。→ 以代码为准改 SKILL 措辞（改文档，不改导出），并把「0.7.0 是否删除」作为公开决策记进 CHANGELOG 的 Unreleased。
4. **R6-066（f1-01）`.prettierrc.json` 的 `endOfLine` auto→lf**：f1-01 已改并加了 CI `Format check` 步，但 `--gitattributes` 与 `format:check` 脚本挂它自己不许动。风险：仓库 `core.autocrlf` 会让工作树落成 CRLF，`endOfLine: lf` 下 `prettier --check` 在工作树侧可能整批红。→ 门禁阶段实测后决定「补 `.gitattributes`（`* text=auto eol=lf`）」或「回退 auto」。
5. **0.6.1 vs 0.7.0**：本轮有 5 条行为变更（R6-005 组合读路径、R6-006 冻结子树、R6-007 `setState` 敏感键、R6-008 快照保留原引用、R6-050 `SnapshotDiff.inputTrusted` 新增必填字段）。→ 提交前与用户确认版本号取舍（第五轮口径：含破坏性变更升 minor）。

## B. 需要主会话补的代码/配置（分片无权改的文件）

6. **`src/types/error.ts`（f1-07）**：补 `MonitoringConfig.maxGroups` 与 `ErrorReport.summary.evictedGroups/evictedErrors` 的公开类型（f1-07 已在 `ErrorAggregator`/`ErrorMonitoring` 落地实现，类型面缺对应）。
7. ~~**`src/integrations/enterprise/user-store.ts`（hot R6-009 另一半）**~~ **已完成**：`createUserStore` 现提供 `refreshData()`（`return this.dispatch('syncWithServer')`），后台同步的隐式契约在库自带工厂里闭环；回归锁 `tests/unit/hot-round6.test.ts › R6-009` 第 3 例（桩 `wx.request`，断言切前台真的发了一次请求且 `userInfo` 落进 state）。属新增公开 action，需 CHANGELOG + API 文档。
8. **`src/plugins/builtin.ts:427` 注释（hot R6-007 旁证）**：若 f1-09 未顺手改，则把「键的合法性由核心在运行时兜住」按加固后的事实核一遍。
9. **`examples/weapp/page-integration.ts` 宿主守卫（f1-02）**：barrel 与另两个 weapp 示例已加守卫，这个文件不在 f1-02 清单里。
10. **`packages/benchmark/src/runner.ts:419` 补传 `datasetSize`（f1-03）**：f1-03 把 datasetSize 改成显式传入，runner 侧那处调用点在 f2-12 手里；若 f2-12 没接住，主会话补。
11. **`scripts/weapp-entries.mjs` 与 benchmark 的 `tsconfig.json` exclude 同源（f1-03）**：`smoke.ts` 新增的 `executeWarmupAsync` 等导出需要同步入口清单。
12. **删除遗留探针 `src/core/performance/__r6old_probe.test.ts`（f1-03 点名）**：它在 `src/` 下同时挡死 `build:weapp` 与 `verify:weapp`；创建者是 f1-05，等它交回后再删。同时清 `findings6/_probe_b15.*`、`findings6/_b16_probe/`、`findings6/_rules_b11.json` 与任何 `tests/types/tmp-probe-*.typecheck.ts`（f1-11 点名 `tmp-probe-r6f110.typecheck.ts`）。
13. **R6-050 的 `inputTrusted` 是 `SnapshotDiff` 上的新增必填字段（f1-08）**：附加式但对「自己构造该对象」的调用方不友好 → 决定是否改可选（默认 true）或保留必填；无论如何 CHANGELOG 要写「任一侧快照 `success:false` 时 `changed` 恒为 true」。
14. **报告外缺陷（hot R6-008 尾巴）**：`src/extras/snapshot/diff.ts` 的叶子比较把「无自有可枚举键的内建值」判等 → `compareSnapshots({n:new Number(1)},{n:new Number(2)})` 仍 `changed:false`。根因在 diff.ts 自身比较口径（f1-08 已交回该文件），主会话补：叶子比较在内建 tag 相同时按 `valueOf`/`toString` 兜一层，并给 hot 锁补回那条被换掉的用例。

## E. 主会话裁定与已完成代做（2026-09-23 续）

| 项 | 结论 |
| --- | --- |
| A1 R6-046 | **取 A**：不暴露 actionContext 宿主。暴露会把「装饰器内部槽位键」变成跨 core/extras 的公开契约，收益只有 cancel/flush 在 store action 上可用；该场景的替代路径（装饰 Page/Component 方法，或在 store 外再包一层）已写在 `debounce.ts`/`throttle.ts` 的模块头与调用点注释里。待办只剩文档同步（GUIDE:231、FAQ:150）。 |
| A2 R6-114 | **采纳**：`tsconfig.json` 的基线 `types` 去掉 `jest`。f1-11 实测四条 typecheck + build 全不红；「第五轮零配置改动」的原话是 root-config 实修 18 条配置，不构成禁止理由。 |
| A3 SKILL 与代码相反 | **以代码为准**：`lazy`/`tree`/`NamespaceConfig` 仍导出、运行时零消费（f1-10 已在类型上标注「未实现」并判 REJECT 不静默删），改 SKILL 措辞；删除决策留给 0.7.0 的 CHANGELOG 条目。 |
| A4 `inputTrusted` | **保留必填**：该对象只由库产出，`compareSnapshots` 的返回类型说「一定带这个字段」比可选更诚实；对「自己构造 SnapshotDiff」的调用方是类型层破坏，需在 CHANGELOG 写明。 |
| A5 版本号 | 待用户拍板：本轮 6 条行为变更（R6-005/006/007/008/050 + `MonitoringConfig.maxGroups`）。 |
| B6 types/error.ts | **已完成**：`MonitoringConfig.maxGroups` 打通到 `new ErrorAggregator(normalizeCapacity(config.maxGroups, DEFAULT_MAX_GROUPS, 1))`，`DEFAULT_MAX_GROUPS` 改为导出；锁 `tests/unit/r6-main-monitoring-config.test.ts`（驱逐留痕 + 非法值归回缺省），`tests/unit/core/error` 305 例全绿。`getAggregationStats()` 无显式返回类型注解，`evictedGroups/evictedErrors` 靠结构推断已对外可见，不需要新类型名。 |
| B7 user-store | **已完成**（见上文第 7 项）。 |
| B8 builtin.ts 注释 | **f1-09 已按实现事实改写**（第 431-441 行三条口径），无需再动。 |
| B9 page-integration | **已完成**：两种写法各导出 `simplePageOptions` / `aliasedPageOptions`，`Page` 调用包进 `typeof Page === 'function'` 守卫（与 app/component 两示例同口径），barrel 的「本文件 import 会抛」那句假话随之改掉。 |
| B10 runner datasetSize | 交回给 f2-12（其文件清单内），若未接住由本文件复查时对账补做。 |
| B11 weapp-entries 与 tsc 同源 | **已满足，无需改动**：`build-weapp.mjs` 现在有 `missingModules` 断言 + 「dist-weapp ⊆ dist」镜像校验，`verify-weapp-bundle.mjs` 反向查「dist 里每个运行时模块都要在 dist-weapp 有对应文件」，两侧都是 `collectSourceModules` 与 tsc 产物的实际比对，不需要第二份 include/exclude。 |
| B12 minify-dist 移植 | **已完成**：`scripts/minify-dist.mjs` 的 `classifyEntry` 改用与 `clean-dist.mjs` 同源的参照系（父目录 realpath 后拼 basename），注释指明正本在 clean-dist。 |
| B13 遗留探针 | **已清**：`src/core/performance/__r6old_probe.test.ts` 已删（它同时挡 `build:weapp` 与 `verify:weapp`）。 |
| B14 报告外缺陷 | **已完成**：`diff.ts` 的对象配对分支在 Date/RegExp/Map/Set 之后新增 `isSlotBearingBuiltin` 兜底，交 `deepEqual` 判内容——`new Number(1)` vs `new Number(2)` 现在报 `changed:true`，内容相同的两个实例不误报，同一引用仍短路。锁补回 `tests/unit/hot-round6.test.ts › R6-008` 最后一条。快照与 core 相关 12 套件 421 例全绿。 |
| B15 f2-13 尾巴① | **已完成**：`clone-async.ts` 的数组分支补上附加自有键那一趟（下标与 `length` 排除、访问器按 `normalizeDescriptorFlags` 还原、对象值经 `kind:'prop'` 入队），与同步路径 R6-100 同口径。 |
| B16 f2-13 尾巴③ | **已完成**：`isIndexKey` 收敛到 `core/utils/clone.ts` 导出，`snapshot/clone.ts` 与 `clone-async.ts` 共用；`extras/action/decorators/cache.ts` 那份属参数序列化域、与克隆键集无关，维持现状（注释已写明）。 |
| B17 f1-04 的「归属冲突」 | **对账结论：无缺口**。`R6-075`（benchmark `utils.ts` 的 `formatNumber`）与 `R6-076`（`build-weapp.mjs`）按 `fixshards6.json` 归 f1-03，两边都已 FIXED；f1-04 看到的「f1-07 说它在 clean-dist/postbuild/stubs 落地 R6-075/076」是转述错了编号——f1-07 的台账里没有任何 `scripts/` 路径。 |
| A4′ 换行符口径（用户先选 auto，随后我补了实测） | **维持 `endOfLine: auto`**，但理由与 f1-01 的设计相反要说清：f1-01 的 lf 方案实测「index 400 个文件全是 i/lf、Linux CI 判绿」是对的，可本机 `core.autocrlf=true` 下有 **198 个 w/crlf** 工作树文件，本地 `prettier --check` 整批假红；要把它变成双向都绿需要 `.gitattributes`(`* text=auto eol=lf`) + `git add --renormalize`，而本轮工作树有 400+ 未提交改动，不适合做全库换行归一（难回退）。已把 `ci.yml` 那段注释改成现状 + 待办；CI `Format check` 保留（只判格式，不再宣称判 EOL）。`src`/`tests` 范围内的 `prettier --check` 实测全绿（另 102 个 warn 里 61 个是 `.ocr-fix` 中间物、10 个是 HEAD 起就没格式化过的 `packages/**`）。 |
| A5′ 版本号 | **用户拍板升 0.7.0**（含破坏性/行为变更）。四处版本号由主会话统一改：`package.json`、`src/integrations/enterprise/hot-update.ts` 的 `LIBRARY_VERSION`、`SKILL.md` 三处手写行、`skill:api` 生成物；改完重跑 `pnpm skill:api` 并跑漂移用例。 |



## C. CI / 文档同步（门禁阶段统一做）

15. `.gitignore` 白名单已由 f1-01 改成模式（`!.ocr-fix/decisions*.md` / `!.ocr-fix/verdicts*/`），提交前实测 `git check-ignore -v .ocr-fix/verdicts6/hot-p0.md` 必须为「未忽略」。
16. CI 新增 `Pack dry-run` 与 `Format check` 两步（f1-01），`Build` 改跑 `build:release`（R6-010）→ 与本地门禁命令对齐后实测。
17. `docs/**` 需同步清单：GUIDE 的 getter 缓存假话（R6-002）、API 的缓存写穿与 `invalidateCache`（R6-003）、API:629 与 `maxInactiveTime` 的 `refreshData` 契约（R6-009）、API:297/CONCEPTS:68/BEST_PRACTICES:91 的 `compareSnapshots`（R6-050）、组合层子店销毁语义（R6-005）、stateProtection 的冻结属性豁免（R6-006）、快照对子类/槽位对象保留原引用（R6-008）。
18. `skill:api` 重跑并检查 `SKILL.md` 三处手写版本行与 12 个生成物的「来源版本」行（f1-02 的 R6-018 已加用例把四处钉到 `package.json`）。
