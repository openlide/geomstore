# G2-extras medium p3 判定记账

| #id | verdict | 依据 |
| --- | --- | --- |
| #274 | fix | 实测确认：真实 Headers 实例在 `Headers` 全局被隐藏时落到 `{ ...headers }` 分支（Headers 无自有可枚举属性）→ 头被丢空；自定义 Headers 形对象更被展开成 `{ forEach: fn }`。改鸭子类型判定（数组分支必须前置，否则数组的 forEach 误命中）；归一化后已无「不可归一」形态（!headers / 数组 / Headers 形 / Record 四分支穷尽 HeadersInit），故不加日志 |
| #277 | fix | extras/index.ts:56 确为唯一 wildcard；上游 integrations/enterprise/index.ts 已是 9 值 + 9 类型的清单，改为同名显式再导出（含类型清单），带 9 个导出的可达性回归用例。src/index.ts、src/extras/{enterprise,snapshot,selector}.ts 的 `export *` 在本分组清单外，留主控 |
| #285 | fix | 注释与实现不符属实：cloneDeep 是递归实现（模块头 + 函数注释同误）。实测（临时用例，已删）：3000/6000 层嵌套 + maxDepth=100000 时 RangeError 恰好落在某个属性的 try 内，仅记 1 条 cloneError、快照在约 2000 层处被截断（与报告「只有恰好落在上层 per-key try 内才会被当作 cloneError 记录」一致）；默认 maxDepth=100 不可达。按报告第一选项修正注释（模块头 + 函数注释），写明栈深=数据深度、上限来源与超深结构应走异步路径，不改写为显式栈（重写风险远大于收益） |
| #286 | fix | 三处（invokeCustomCloner / keys catch / 描述符 catch）逻辑同构属实，异步侧另有两处，抽为 `handleCloneError` 统一；顺带收敛两处真实漂移：customCloner 抛 SnapshotAbortError 不再被二次咨询降级、异步 keys catch 现在也识别中止信号（原 tests/unit/extras/snapshot/snapshot-resilience.test.ts:126 把该漂移锁为「异步不识别中止信号」，按同步侧既有注释理由改测试） |
| #287 | fix | 函数确按引用入快照，与全库既定约定一致（src/core/utils/clone.ts:30 明示「函数等不可克隆值保留原引用（函数无内部状态，共享无副作用）」、选择器侧「不可克隆对象保留原引用」的公开限制），故不改行为；按报告第一选项把该例外在判定处写明并加回归用例锁定两侧（sync/async）口径 |
| #290 | fix | 可达且实测复现：`getStateVersion` 对 NaN/Infinity 与非对象一律返回 undefined，store.state 的版本 getter 亦可被移除，此时 `deepEqual(cache.snapshot=活引用, state)` 恒真 → TTL 内一直吐陈旧值（回归用例：降级后改 base 仍返回 2 而非 198）。按报告补 `cache.version !== undefined` 视为 miss 并同步重置 version，避免降级后每次强制重算 |
| #291 | fix | 工厂签名 `(state) => (params) => R`，示例把 `getState` 函数当 state 传入，`getState.users['user1']` 必然 undefined/抛错；改为先绑定真实 state |
| #293 | fix | 实测复现两种坏态：cacheSize 0 → push 后立即 shift，`hasCache:true` 与 `cacheSize:0` 并存、this.cache 脱离 history；cacheSize NaN → `length > NaN` 恒 false → 50 条不淘汰（无界）。构造函数按 LRUCache:123 同口径归一化 `Number.isFinite ? Math.max(1,x) : 10`；无用例固化旧行为 |
| #294 | fix | 事实成立但已有出口：仅「无版本标记 + equalityFn === deepEqual」才克隆（createSelector.ts:214 已守卫），传引用比较的 equalityFn 或 cache:false 即完全绕开；类型在 src/types 不可改，故按报告第一选项在公开 API 注释中量化该回退路径代价并指明两条免克隆出口，不新增 opt-out 选项 |
| #299 | fix | 口径分叉属实：maxDepth 截断节点在 clonePrelude 自增 nodeCount 之前返回，同步不计、异步 processedCount 计入（实测同一输入 2 vs 3）；异步 metadata 改用 counters.nodeCount，processedCount 只服务进度，并在 SnapshotMetadata.nodeCount 上写清口径 |
| #300 | fix | 实测复现：onProgress 抛错穿过 processQueue 的 finally 落到外层 catch，一份好克隆被降级为 success:false + data undefined；改为回调内 try/catch，记一条 unknown（不改写 success）并在首次异常后停止调用，防同一回调刷爆账本。既有测试 snapshot-async-error-paths.test.ts:35「不向外抛出」把旧的整体失败锁成了预期，按上述理由改为断言结果不受影响；onError 自身抛错仍整体失败（另一既有用例已锁定，且 onError 是决策回调而非上报回调，不做静默化） |
| #303 | fix | `unknown \| undefined` 塌缩为 unknown 属实；简化为 `=> unknown` 并把真实契约写进 JSDoc（返回 undefined = 未命中、按类型继续克隆；抛错才走 cloneError + onError），与 clone.ts 的 CustomCloneOutcome 注释对齐 |
