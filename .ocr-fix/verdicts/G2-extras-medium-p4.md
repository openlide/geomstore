# G2-extras medium p4 判定记账（逐条边做边记）

| #id | verdict | 依据 |
| --- | --- | --- |
| #304 | reject(取文档方案，文案按实际语义重写) | 报告提议的注释与实际语义**相反**：两个 onError 咨询点都写成 `if (!shouldContinue)`（clone.ts:115、clone.ts:247），故 `void`/undefined 是「拒绝继续」而非「继续」；且 false 的后果按错误种类分岔（cloneError → 抛 SnapshotAbortError 整体失败；circular → 落 `'[Circular Reference]'` 占位后继续，快照仍可 success:true），不是统一的「中止整个快照」。成立的部分是文档不足：types.ts 的 onError 与 `SnapshotErrorContext.recoverable`（两处咨询点恒 true，只作描述、不参与判定）已按实现写实；未新增 `OnErrorHandler` 别名（报告给的「or」选项，文档已覆盖同一诉求） |
| #305 | reject | 判别联合不采纳：`success: true` 且 `errors` 非空是**已文档化的设计**（只有 cloneError 参与判定，circular/maxDepth/onProgress 记的 unknown 属已降级项），报告把它当矛盾态即前提不成立；`success: false ⇒ errors 非空` 由三条失败来源先落账保证（无「失败无原因」态），而失败时的 `data` 是「可能有用的半成品」（异步超时）而非恒空，改成 `data?: T` 会让库内文档/示例与宿主侧 `result.data.x` 全部无运行期收益地转红。改为把三条不变量写进 SnapshotResult 注释，并用回归用例锁定 |
| #308 | fix | 哨兵问题成立：`lastCall === 0` 在 Date.now 被 fake timers/注入时钟定为 epoch 0 时永不推进，节流静默退化为每次重算（回归用例锁住）。报告的 TS 理由「无法证明 lastValue 已赋值」不成立——闭包内 TS 不做赋值流分析，改前后 `tsc -p tsconfig.tests.json` 均无输出。不采用报告给的 `-Infinity` 初值：那会让 `interval = NaN` 的首次调用从「算一次」变成「恒返回 undefined」（`Inf >= NaN` 为 false），改法换成显式 `computed` 标记，既消除时钟依赖又保住该输入的既有表现 |
| #314 | fix | 属实：护栏处无条件 push 使任何深过 100 层的结构永远 `changed`（两侧逐字节相同也一样），依赖该结果的缓存/去重失效。按报告建议退化为已导入的迭代式 `deepEqual`（equality.ts:41 用显式栈 + 「对象对」登记表，栈安全且能处理循环引用），仅内容不同才记账。**偏离报告处**：深度预算显式传 `Infinity`——默认 1000 层是从子树根重新起算的，超深结构会二次触发它的告警并按「不相等」返回，等于原地保留误报（回归用例含 1200 层链）。同时修正 tests/unit/extras/snapshot/SnapshotManager.test.ts:1472 那条固化旧误报的用例：其两侧数据经默认 maxDepth=100 克隆后本就被截成同一个 '[MaxDepth Exceeded]' 占位串，两份快照确实等价，故改为其真实意图所需的 maxDepth: 500（差异落在链内）而不是把断言放宽 |
| #318 | FP | 报告引用的行号对应改造前的形状：现异步 keys catch 已是 `handleCloneError(...)`（clone-async.ts:212-214），该函数首句 `if (error instanceof SnapshotAbortError) throw error`（clone.ts:103-105）在任何记账与咨询之前上抛，不存在二次咨询；此项由 p3 #286 落地。补决定性锁定用例（ownKeys 陷阱抛中止信号 → toThrow(SnapshotAbortError) + `expect(onError).not.toHaveBeenCalled()` + errors 为空），临时回退实验证明该用例在旧形状下同样成立（不误伤） |
| #319 | fix(取报告第一选项) | 占位清理此前只覆盖 SKIP 出口：驱动层兜底 catch（SnapshotManager.ts:372-389）确实 `continue` 而不移除占位 → 父容器留下源数据中不存在的 `key: undefined`。抽 `discardPropPlaceholder` 供两处共用，并补超时出口（未处理任务的占位）清理。**修正报告前提**：其案例 (1)「enqueue 在 hasTimedOut 后丢任务」不可达（超时定时器只能在批间 `await` 处触发，批内同步执行；该处 istanbul 注释已说明），真正的可达形态是退出时队列中的存量任务；另报告称「静默」不成立（超时/兜底 catch 都落账且 success 已为 false），成立的是半成品 data 里的值失真。不采纳「延迟提交占位」：占位是键序的载体（填充按队列顺序发生），去掉会改克隆结果的键序 |
| #320 | fix | 属实：`value instanceof Date`（走 getPrototypeOf 陷阱）、`value.getTime()` 等内建方法在 Proxy 接收者上抛 TypeError、`Object.create(Object.getPrototypeOf(value))` 均可在 try 外抛出，绕过 errors[] + onError 只留一条路径含糊的驱动层 cloneError，剥夺调用方的降级决定权。把「类型判定 + 外壳构造」整体纳入 try，catch 走 handleCloneError 并返回 SKIP_CLONE_NODE（丢子树，与 customCloner 失败同口径；中止信号仍由 handleCloneError 原样上抛）；keys catch 保持原样（继续时返回空壳 `cloned`，既有语义未动）。同步路径 clone.ts 的同一区间不改：其抛错由 createSnapshot 顶层 catch 收敛为整体失败，那是同步路径已文档化的口径，改成节点级丢子树是行为变更且不在本条范围内 |
| #310 | reject | 实测（临时探针 `tests/unit/extras/_inference-probe.ts`，已删，`tsc -p tsconfig.tests.json` 输出留证）：把键参数写成 `keyof S`、`keyof S & string`、`Extract<keyof S, string>`、`K \| Exclude<keyof S, K>` 四种形态后，`createObjectSelector((key) => (s: OrderState) => s[key])`（JSDoc 示例与既有 selector-interface-state.test.ts:89 的写法）全部因键参数类型反向依赖 S 的循环推断退化成 `key: never` + `S = object` 而编译报错（TS2345），签名收窄的代价是打红全部推断式调用点；另一选项（显式键表）是新增公开 API 面，且该 mismatch 不产生错误数据（只会多出 `Record<K,R>` 之外的键）。保留签名，把「K 须为 keyof S 的非 Symbol 全部键 + 为何不收窄」写进 JSDoc |

## 验证

- `npx tsc --noEmit -p tsconfig.typecheck.json`、`npx tsc --noEmit -p tsconfig.tests.json`：均无输出
- `npx jest --ci --silent tests/unit/extras`：37 suites / 720 tests 全绿（新增 19 例在
  `tests/unit/extras/ocr-medium-round4-p4.test.ts`，用例名带 #编号）
- `npx eslint <本轮 5 个 src 文件 + 2 个测试文件>`：零输出
- 回归有效性实验：把 #308/#314/#319/#320 四处改动临时回退后跑 extras，**恰好** 8 条新用例失败、
  既有用例无一误伤；随后逐处恢复并复验（`tests/unit/extras/snapshot/SnapshotManager.test.ts`
  的深度用例改动同时被验证在旧实现下也通过，即它不是靠放宽断言过关）

## 需主控拍板 / 交接

1. **文档同步（Wave D）**：`docs/API.md:242`、`docs/BEST_PRACTICES.md:97`、`docs/CONCEPTS.md:56`
   仍写「true 继续 / false 中止」，未说明 void/undefined 同于拒绝、也未说明 circular 的 falsy
   只落 `'[Circular Reference]'` 占位而快照仍 success（本轮把该口径写实的是 src 注释，文档口径需跟上）。
2. **同步路径的同类缺口**：`clone.ts` 的类型判定/外壳构造（`instanceof` 与 `Object.getPrototypeOf`）
   同样在 try 外，Proxy 包装的内建对象会让整次同步快照以 `unknown` 失败而非按节点降级。
   本条不在 #320 范围内且属行为变更，未动，建议单列一条 finding。
3. `createObjectSelector` 的签名维持 3 个类型参数：`.codebuddy/skills/.../extras-selector.md:236`
   与 `docs/API.md` 的参考签名无需改（本轮判为 reject，只补 JSDoc 约束）。
