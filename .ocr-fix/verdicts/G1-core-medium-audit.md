# G1-core-medium（52 条）判定记录

来源：src/core 的 medium 批次由首个 agent 批量落盘（提交 5616cbb），随后由审计 agent 逐条核对
（该轮尚未启用「边做边记账」，本表按审计回报补录）。判定含义：`fix` 报告成立且已修好；
`补做` 报告成立但首批 agent 未落地或只做了一半，本轮补完；`reject` 报告成立但修法方向错，保留现状。

| #id | verdict | 依据（要点） |
|---|---|---|
| 82 | fix | `LRUCacheStats.keys` 文档声明字符串化并指向 `keys()` 取原始键；用例断言两条口径 |
| 87 | fix | `clear()` 先快照+摘链再销毁并跳过 `destroyed`，与 `register` 同口径；含重入用例 |
| 88 | fix | `registerAll` 改整体预校验，校验失败时注册表零改动（用例断言 `size()===0`） |
| 89 | fix | 快照恢复用 `defineProperty` 写入；被吞的下半由 #90 的「未覆盖 store」告警兜住 |
| 90 | fix | 形状校验下沉到 `$replaceState`（实测它拒绝 null/非对象/数组），并显式告警部分恢复 |
| 98 | fix | `pluginName` 改可选读取；「卸载句柄返回 no-op」是既有契约 PLUGIN-002，不改 |
| 101 | fix | 用 `typeof === 'string'` 收窄，非字符串一律视为缺失 |
| 102 | reject | `code: string` 是有意开放域：ErrorRecovery 按任意自定义码配策略（ErrorRecovery.test.ts:165/178 用 `'UNKNOWN_CODE'`/`'TEST_CODE'`），全仓 85 处字面量码 + `src/types/error.ts:127` 同为 `string`；收窄成 enum 属破坏性且越界 |
| 109 | fix | 注释改为真实的「告警+取首个」语义（报告给的选项之一） |
| 112 | fix | 冲突与否都推进 `keyOwners`，A/B/C 用例断言不再出现 (A,C) |
| 113 | fix | `assignMerged` + clone + metrics 累加器全改 Map/`defineProperty`；报告点名的 ActionHistory 属 src/extras |
| 115 | 补做 | 首批完全未动 LRUCache：回调回填被逐键时嵌套淘汰递归到 RangeError，且被 evictLRU 的 try 吞成 console.error。已加 `evicting` 重入标志 + 有界淘汰预算（原「净尺寸未减则 break」会让回填后永久超限，破坏 LRUCache-reentrant-capacity.test.ts） |
| 118 | fix | `clear()` 复位 `pending`，用例验证 clear 后 notify 仍送达 |
| 119 | fix | `Array.from(listeners)` 快照遍历，迟订阅不进本批次 |
| 123 | fix | 三处 Record 累加改 Map + `Object.fromEntries`（自有属性）；用例查 `Object.prototype.count` |
| 124 | fix | `MetricsCollector` 改环形缓冲，写入 O(1)，读路径统一 `_ordered()`；构造器规范化 maxSize |
| 125 | fix | 拆平嵌套三元 + `@returns` 记录 Infinity 哨兵 + 排序器先判等避免 NaN |
| 131 | fix | 先 `Math.floor` 再判 `<= 0` |
| 132 | fix | 阈值预警与采样解耦（logger 收 record 副本）；`sampleRate`/`threshold` 构造器与 setOptions 双向规范化 |
| 134 | fix | `getMetrics`/ByType/ByOperation/getRecentMetrics 全部返回元素副本 |
| 135 | 补做 | 首批只做了重命名，「条目被 prune/clear 摘除后端点无声丢弃」未处理；已补 `console.debug` 降级日志 + 用例 |
| 137 | fix | `beforeDispatch` 移入 try，钩子抛错不再泄漏 `_dispatchDepth` |
| 138 | fix | try 收窄到 action 调用，收尾步骤移出 try，消除二次 `_exitDispatch` 与误包装（用例查 `[true,false]` 序列） |
| 140 | fix | thenable 改鸭子类型判定（跨 realm Promise/子类/自定义 thenable 全覆盖），用例走通补发路径 |
| 143 | fix | `_getters ?? {}`，与 `ActionManager.actions` 对齐 |
| 145 | fix | `subscribe(fn, {readOnly})` 落地：可写计数 + 仅在有可写订阅者时深拷贝载荷，两条用例分别验证隔离与零拷贝快路径 |
| 146 | fix | 取报告「文档化」口径：docstring 明示重复注册免检、size 可超上限 |
| 147 | 补做 | 首批未动；已加开发期告警（`!cloneOnNotify && _writableCount > 0 && !isProduction()`）+ 用例（只读场景不告警） |
| 151 | fix | `timestamp === undefined` 按已过期处理 |
| 152 | fix | get miss 分支/`set`/`refreshFromState`/过期分支统一走 `_writeEntry`（已核对 TTL 语义等价） |
| 153 | fix | 取「记录无效配置」口径：空 `cacheKeys` 开发期告警并保持不缓存语义，不反向解释成全量缓存 |
| 155 | fix | 路径错标为有意取舍并写进注释；「deep 变更后旧 Proxy 生效」为 FP：`deep` 无运行时 setter，唯一可变的 `enabled` 走 `_rebuildStateProxyManager()`（Store.ts:752-757） |
| 156 | fix | 按报告「至少注释声明」落地，写明改绑代理接收者会让品牌校验抛错 |
| 157 | fix | 三个陷阱改 `Reflect.*` 并如实返回；用例验证 frozen 目标返回 false |
| 160 | fix | 令牌必须非空且匹配；已核对 Store 两条句柄路径不会退化为「永不动作」 |
| 164 | fix | 删除死类型参数 `_S` |
| 168 | fix | null/undefined/非对象统一 `TypeError` 快速失败 |
| 169 | fix | 取「文档化 TS 语义」口径，JSDoc 说明显式泛型下 A/G 不参与其中 |
| 170 | fix | 空原型克隆改 `Object.create(proto)`；跨 realm 子项在小程序运行时不可达（无 iframe/vm），不为假想场景加 tag 判定 |
| 174 | 补做 | 首批未动 stateVersion；已补 try/catch + `Number.isFinite`（NaN 也满足 `typeof === 'number'`，会让版本短路判定恒为「已变」）+ 用例 |
| 177 | reject | 转发 receiver 会让类实例访问器的 `#private`/类型化数组内部槽位直接抛错；保留原始 target 接收者并注释说明，代价由 #179 兜底 |
| 178 | 补做（未完成） | `rebuildOwners` 仍是每次结构性写入全图重建（push 触发 index+length 两次）。属索引增量化重设计，需与 benchmark 配套，**列为待办**：见本文件末「遗留」 |
| 179 | fix | 归属解析不出时保守标记全部顶层键（宁多报不漏报），用例覆盖访问器场景标脏 a/b/lazy |
| 183 | fix | destroy 改走 `_rebuildStateProxyManager()`，用例查管理器与缓存同替 |
| 185 | fix | `targetSet` 上提到 `_markAliasedKeys`，`_reachesAny` 收 `ReadonlySet` |
| 186 | fix | 替换前取 `previousKeys`，脏键取新旧并集；用例在订阅者内观测 `isStateKeyDirty('removed')`（脏键口径是「自上次通知以来」） |
| 189 | fix | 数组分支显式比 `length`；稀疏数组用例覆盖（用 `delete` 造真实空洞） |
| 190 | fix | 加 `getPrototypeOf` 比较，并在 `@returns` 声明 symbol/不可枚举不参与；比 `Reflect.ownKeys` 更稳（状态版本号正是不可枚举 symbol） |
| 209 | fix | 数组 vs 纯对象按类别判不等 + 长度比较 |
| 210 | fix | 结构判别取代白名单（同为纯对象或同为数组才按键比），Error/URL/Promise 只认引用 |
| 211 | fix | `mode === 'json'` 前置于 Date/RegExp 特判，顶层与嵌套口径一致 |
| 212 | fix | `fallbackClone` 对 `__proto__` 走 `defineProperty`；deepMerge 链路用例验证注入不逃逸 |

## 遗留（交 Wave D 之后的独立议题）

- #178：脏键归属索引增量化（避免每次结构性写入全图 `rebuildOwners`），需与 `packages/benchmark`
  的写入吞吐基线一起评估，不能顺手改。
- #115 的淘汰预算上限、#124 环形缓冲的容量默认值，若将来调参需同步 `jest.config.js` 的覆盖率门槛预期。
