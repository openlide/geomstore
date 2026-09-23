# 第六轮收口（main-cov）：cache.ts / ActionHistory.ts 覆盖率补测

口径：**只新增 `tests/**` 测试文件**，零 `src/**` 改动、零配置改动（`jest.config.js` / `tsconfig*` / `eslint.config.js` / `.prettierrc.json` 一律不动）、无 `it.skip`、无 `/* istanbul ignore */`、无 `any`、无 `@ts-*` 旁路。
两处缺口都是本轮修复新增的代码分支没被测到（测试缺口，不是代码缺陷），故只补测试、不为过覆盖率改实现。

门禁实跑（收工前）：

```
npx jest tests/unit/r6-main-cov-cache-key-order.test.ts \
         tests/unit/r6-main-cov-action-history-eviction.test.ts --ci
  → Test Suites: 2 passed, 2 total；Tests: 13 passed, 13 total

npx jest --ci --coverage            （182 suites / 3746 tests 全绿）
  → 原报错里的两条已消失：
     ✗ Jest: Coverage for functions (95.23%) ... src/extras/action/decorators/cache.ts threshold (98%)
     ✗ Jest: Coverage for lines (97.91%)      ... src/extras/action/ActionHistory.ts        threshold (98%)
  → 仍剩一条不属于本文件范围（主会话并行处理）：
     Jest: Coverage for functions (96.3%) does not meet "global" threshold (98%)

npx eslint --max-warnings 0 <两个新文件>     → 0 problem
npx prettier --check       <两个新文件>      → All matched files use Prettier code style!
npx tsc -p tsconfig.tests.json --noEmit      → 全仓 0 错（含这两个文件）
```

复测表（`npx jest --ci --coverage` 的 text 报告行，四列依次 % Stmts | % Branch | % Funcs | % Lines）：

| 文件 | 改前 | 改后 |
| --- | --- | --- |
| `src/extras/action/decorators/cache.ts` | 99.40 \| 93.91 \| **95.23** \| 99.37（未覆盖行 88） | 100 \| 96.52 \| **100** \| 100（未覆盖行归零） |
| `src/extras/action/ActionHistory.ts` | 98.04 \| 92.31 \| 100 \| **97.91**（未覆盖行 105） | 100 \| 96.15 \| 100 \| **100**（未覆盖行归零） |

---

## 1. `src/extras/action/decorators/cache.ts`

唯一未覆盖行 = **88**，唯一未覆盖函数 = **`byKeyMarker`（87-89 行）** → functions 20/21 = 95.23% < 98%。
根因：`byKeyMarker` 是 `keyValuePairs` 里 `pairs.sort(byKeyMarker)` 的比较器，**`Array.prototype.sort` 只在同一个参数的附加键 ≥2 个时才调用比较器**。R6-045 的六个用例（`tests/unit/r6-f1-06-cache-key.test.ts`）每个参数都只带 0 或 1 个附加键（单个 symbol 键 / 单个 `arr.meta`），比较器一次也没跑起来。

| 未覆盖点 | 补的用例（`tests/unit/r6-main-cov-cache-key-order.test.ts`） | 实跑 |
| --- | --- | --- |
| L88 `byKeyMarker`（函数 + `a[0] < b[0]` 与 `a[0] > b[0]` 两条 cond-expr） | ①「对象带 3 个 symbol 键：声明顺序不同的等价参数仍命中，交换两个键的值必须 miss」（3 键 → 比较器被调用多次，正反两个方向都走到；同时钉住「排序后等价参数命中、键值配对不同必 miss」） | 8 tests 全绿；cache.ts functions 20/21 → **21/21 = 100%**、lines 158/159 → **159/159 = 100%**、statements **100%** |
| 同上（字符串键与 symbol 键混排的第二个附加键） | ②「字符串键与 2 个 symbol 键混在一起」 | 同上 |
| 同上（数组分支的两个附加键） | ③「数组同时带 meta 附加键与 symbol 键：两类键都参与区分且与挂载顺序无关」——即简报点名的 `arr.meta` 参与区分，扩到「meta + symbol 两个键」才会调比较器 | 同上 |
| 同上（类实例的品牌键路径） | ④「只有 2 个可枚举品牌 symbol 键的类实例」——简报点名的「只有一个品牌 symbol 键的类实例不再串用同一缓存条目」由 `r6-f1-06-cache-key.test.ts:100` 已锁；此处补到 2 个品牌键，并额外钉住「值等价、身份互异的两个实例命中同一份缓存」（证明走的是值语义路径而非 `o:${identityId}` 身份标记） | 同上 |
| `ownEnumerableKeys`（76-84 行）的可枚举过滤——即简报所称「`includeNonEnumerable` 关闭时的键集形状」 | ⑤⑥⑦⑧ 四条：非枚举字符串键（普通对象）/ 非枚举 symbol 键 / 数组上非枚举的 `meta` / 品牌键改为不可枚举的类实例。缓存侧**没有** `includeNonEnumerable` 这个选项（它是快照克隆引擎 `src/extras/snapshot/clone.ts:643` 的开关），承担同一「只看自有可枚举键」判据的就是 `ownEnumerableKeys`，故把它的三种形状钉成断言：非枚举键不进键集（与 `JSON.stringify` 同口径，互异参数仍命中同一份缓存）；类实例的键集一旦为空就退回身份标记路径（互异实例各算一次新参数，宁可损失命中率也不串用） | 同上 |

仍不覆盖（记录原因，非取巧绕过的选项）：

- L88 第三条 cond-expr `a[0] > b[0] ? 1 : 0` 的 **`0`（相等）分支**：两个互异自有键的标记串分别形如 `s:"meta"` 与 `symbol:Symbol(x)#id`，`Reflect.ownKeys` 不含重复键，故同一参数上不可能出现两个相同标记 → 该路径按构造不可达。cache.ts 的单文件门槛是 branches 85%，实测 96.52%，不受影响。
- L363 / L372 / L503 三条：本轮之前就存在的 `isProduction()` 真分支（生产模式静默）与乱序完成保护的 false 分支，`tests/unit/store/production-mode-silence.test.ts` 等已有覆盖口径，未动。

## 2. `src/extras/action/ActionHistory.ts`

唯一未覆盖行 = **105**（`evictLeastRecentlyRecorded` 里 `if (oldest.done === true) return` 的 return）→ lines 47/48 = 97.91% < 98%。
简报点名的两处在基线里**已经覆盖**：整桶淘汰路径（L82-84 调用点 + L113 delete）与那条 `console.debug`（L107-112，由 `tests/unit/r6-f1-06-action-history-cap.test.ts` 的三个用例走到，改前 counts=[2,0]）。所以缺口只剩「表已空却被判成桶数越限」这条防御分支——实现注释自己写明「调用方不会走到这里；保留为对未来改动的防御」。

`MAX_TRACKED_ACTIONS` 是不可注入的模块私有常量，且公开路径上 `record` 只在 `actionResults.size >= 1000` 时才调淘汰入口（此时表必然非空），因此「size 读数越限 + 表为空」两条件无法同时由公开 API 凑出。做法：注入一只**只改 `size` 读数、get/set/delete/迭代全部沿用原生 Map** 的 `InflatedSizeMap`（`Object.defineProperty(tracker, 'actionResults', …)`，不碰实现、不用 `any`），把 `record` 推进这个退化状态，并把断言写成可观察结果而不是实现细节。

| 未覆盖点 | 补的用例（`tests/unit/r6-main-cov-action-history-eviction.test.ts`） | 实跑 |
| --- | --- | --- |
| L103-105 空表防御分支 | ①「record 在退化状态下仍写入新桶，且不点名（无桶可点名）」：断言 `console.debug` **未**被调用（return 早于 debug）、`getHistory/getStats/getAllStats` 三个公开读口对新桶正常 | 5 tests 全绿；ActionHistory.ts lines 47/48 → **48/48 = 100%**、statements **100%**、functions **100%** |
| 同上（分支在多次调用下稳定） | ②「退化状态连续记录：每次都走同一分支，历史按正常语义累积」（5 条记录仍在一个桶里、无点名） | 同上 |
| 淘汰路径的**持续**不变量（简报要求「被淘汰的桶不再出现在统计里、存活桶数不增」） | ③「越界后继续新增：存活桶数不再增长，被淘汰的桶从统计里消失」：灌满 1000 桶后再造 50 个新名字，断言 `Object.keys(getAllStats())` 恒为 1000、被挤掉的 50 个桶 `getStats().total === 0` 且 `getHistory() === []`、新桶与未被波及的旧桶仍在 | 同上 |
| 整桶丢弃语义 + 按最近记录序 | ④「整桶淘汰是『丢弃』而非『置空』：同名重新记录会重开一个只含新记录的桶」（含 `action_3` 被触碰两次后不被牵连、重开的桶只含 `startTime: 10` 那一条） | 同上 |
| `console.debug` 点名内容与次数 | ⑤「淘汰会点名：每条越界记录各打一条 console.debug，且写出被淘汰的 Action 名」（上限内 0 条、两次越界各点名 `action_0` / `action_1`、越界后 `mockClear` 再记录同名不新增） | 同上 |

仍不覆盖（记录原因）：L107 `if (!isProduction())` 的 **false 分支**（生产模式下不点名）——`isProduction()` 在模块实例内永久缓存判定结果，测试环境取不到 true；改前也是 `[2,0]` 未覆盖，本轮没有新增这一路径。ActionHistory.ts 门槛 branches 85%，实测 96.15%，不受影响。

---

## 附：给「global functions 96.3%」的一条定位线索（不由本文件处理）

读了 `node_modules/@jest/reporters/build/index.js` 的 `_checkThreshold`：每个文件只会被分进**第一个**命中的 path/glob 门槛组，`global` 只收「四个 glob 组都没接住」的文件。因此 `src/extras/action/**`（含 cache.ts / ActionHistory.ts）**不参与** global 统计，本轮两条报错消失与它无关，主会话补 action 目录也不会动它。按同一算法对 `coverage/coverage-final.json` 复算，global 组是 28 个文件、functions 450/468 = 96.15%，未覆盖函数集中在：

- `src/integrations/index.ts` —— functions 2/18（16 个未覆盖，占整个缺口的绝大部分）
- `src/plugins/globalRegistry.ts` —— 7/8
- `src/integrations/enterprise/hot-update.ts` —— 13/14

（数字为收工前一次全量跑的快照，主会话并行改动后会漂移；仅用于定位。）
