# 第五轮复审（ocrreview.md，376 条）判定汇总

原始报告 `ocrreview.md` 与 `.ocr-fix/` 下的生成脚本、台账中间物（`ledger5.*` / `groups5/` / `shards5.json` / `*.mjs`）都由 `.gitignore` 挡在库外——**入库的只有判定结论**（本文件与被白名单放开的 `verdicts5/**`）。想复算分片必须同时留着手上的原始报告，仓库本身不提供重放链。
**逐条判定与证据在各分片台账 `.ocr-fix/verdicts5/<分片>.md`**，跨分片交接、主会话代做项与改判记录在 `.ocr-fix/verdicts5/main-followups.md`。本文件只做汇总与索引。

- 已判定：376/376，无遗漏
- critical + high 共 14 条由主会话完成（分片文件 `groups5/hot-p0.md`，台账 `verdicts5/hot-p0.md`）

| verdict | 条数 | 含义 |
| --- | --- | --- |
| FIXED | 366 | 报告成立且已落地 |
| FP | 7 | 误报，附命令级证据后跳过 |
| REJECT | 3 | 事实成立但不按报告方向改，附理由 |
| NEEDS-MAIN | 0 | 需跨分片/跨权限，交主会话裁决（结果见 main-followups.md） |

## 按严重度

| 严重度 | 总数 | FIXED | FP | REJECT | NEEDS-MAIN |
| --- | --- | --- | --- | --- | --- |
| critical | 2 | 2 | 0 | 0 | 0 |
| high | 12 | 12 | 0 | 0 | 0 |
| medium | 167 | 163 | 3 | 1 | 0 |
| low | 195 | 189 | 4 | 2 | 0 |

## 分片索引

| 分片 | 条数 | 台账 |
| --- | --- | --- |
| bench-p1 | 25 | `.ocr-fix/verdicts5/bench-p1.md` |
| bench-p2 | 9 | `.ocr-fix/verdicts5/bench-p2.md` |
| core-misc-p1 | 25 | `.ocr-fix/verdicts5/core-misc-p1.md` |
| core-misc-p2 | 19 | `.ocr-fix/verdicts5/core-misc-p2.md` |
| core-store-p1 | 25 | `.ocr-fix/verdicts5/core-store-p1.md` |
| core-store-p2 | 10 | `.ocr-fix/verdicts5/core-store-p2.md` |
| extras-action-p1 | 25 | `.ocr-fix/verdicts5/extras-action-p1.md` |
| extras-action-p2 | 15 | `.ocr-fix/verdicts5/extras-action-p2.md` |
| extras-error | 25 | `.ocr-fix/verdicts5/extras-error.md` |
| extras-selector | 17 | `.ocr-fix/verdicts5/extras-selector.md` |
| extras-snapshot | 19 | `.ocr-fix/verdicts5/extras-snapshot.md` |
| hot-p0 | 14 | `.ocr-fix/verdicts5/hot-p0.md` |
| integrations-p1 | 24 | `.ocr-fix/verdicts5/integrations-p1.md` |
| integrations-p2 | 10 | `.ocr-fix/verdicts5/integrations-p2.md` |
| plugins-types-p1 | 23 | `.ocr-fix/verdicts5/plugins-types-p1.md` |
| plugins-types-p2 | 13 | `.ocr-fix/verdicts5/plugins-types-p2.md` |
| root-config | 22 | `.ocr-fix/verdicts5/root-config.md` |
| scripts | 22 | `.ocr-fix/verdicts5/scripts.md` |
| tests-p1 | 24 | `.ocr-fix/verdicts5/tests-p1.md` |
| tests-p2 | 10 | `.ocr-fix/verdicts5/tests-p2.md` |

## 判为误报（FP）的条目

- **R5-36**（scripts）：仓库里没有「禁止嵌套三元」的项目规则（第四轮 #41 判例维持）
- **R5-182**（extras-action-p2）：基本类型宿主分支不是死代码，且被既有用例稳定覆盖
- **R5-240**（extras-snapshot）：`boolean | void` 是第四轮 #304 已裁定的刻意契约，本轮无新证据
- **R5-241**（extras-snapshot）：报告建议的类型手段在 TS 里是空操作，唯一有牙齿的改法是破坏公开契约
- **R5-370**（root-config）：依赖锚定并未被移除：真正使用的 pnpm-lock.yaml 一直入库且未被忽略
- **R5-372**（root-config）：该条在本轮开始前已由主会话按建议改完，现规则实测就是「整目录忽略 + 判定台账白名单」
- **R5-375**（root-config）：兜底路径下 !CHANGELOG.md 实测生效；报告给出的 diff 自身是 no-op

## 判为不修（REJECT）的条目

- **R5-296**（integrations-p1）：不给离线队列加容量上限或防抖落盘
- **R5-317**（plugins-types-p1）：注入通道搬不出公开选项形状：唯一读写方都在 src/extras，本分片禁改
- **R5-346**（tests-p1）：报告建议的反例今天不可能成立：两个入口都不拒绝非对象 state 工厂。

