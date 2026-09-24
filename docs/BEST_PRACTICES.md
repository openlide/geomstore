# 最佳实践

本文只给结论与最小理由：每条一行「该怎么做 / 别怎么做」。机制解释一律链接 [CONCEPTS.md](./CONCEPTS.md)，本文不复述。

- 机制语义（为什么、边界在哪、完整枚举）→ [CONCEPTS.md](./CONCEPTS.md)
- 症状 → 诊断步骤 → [FAQ.md](./FAQ.md)
- 接入代码与上手路径 → [GUIDE.md](./GUIDE.md)（可运行正本在 `examples/`）
- 签名、选项默认值、逐 API 契约 → [API.md](./API.md)
- 历史对照（此前 → 现在 → 怎么改）→ [MIGRATION.md](./MIGRATION.md)

## 目录

1. [状态设计](#1-状态设计)
2. [写入](#2-写入)
3. [Action](#3-action)
4. [Getter 与选择器](#4-getter-与选择器)
5. [订阅与通知](#5-订阅与通知)
6. [缓存](#6-缓存)
7. [快照](#7-快照)
8. [错误处理](#8-错误处理)
9. [小程序实践](#9-小程序实践)
10. [测试与调试](#10-测试与调试)
11. [反模式与上线清单](#11-反模式与上线清单)

## 1. 状态设计

- **先定义状态类型，再标注工厂返回类型**：

  ```ts
  interface SessionState {
    userInfo: string // 未登录为空串
    isLoggedIn: boolean
  }

  const sessionStore = createStore({
    name: 'session',
    state: (): SessionState => ({ userInfo: '', isLoggedIn: false }),
  })
  ```

  状态形状只有一个来源：getters / actions / 选择器不必重复书写同一份字面量类型，改一处即可。不标注而依赖推断时，空数组会被推断成 `never[]`，各使用点都要补 `as Todo[]` 断言。

- **用工厂函数声明状态**：`state: () => ({ ... })`，避免数组 / Map / Set 等引用类型被多个实例共享。见 [CONCEPTS §1](./CONCEPTS.md#1-状态state)。
- **状态保持可序列化与可扁平化**：`setData` 需要跨线程传输，类实例、函数、循环引用都会带来额外开销或克隆失败；派生数据放 getter / 选择器，不要塞进状态。
- **只读副本用 `$snapshot()`**：`getState()` 返回的是活动引用，外部持有后容易绕过受控写入。见 [CONCEPTS §1](./CONCEPTS.md#1-状态state)。
- **不要在 action 之外持有状态引用做写入**：这类写入绕过保护、脏计数与缓存失效，表现为「改了但界面不更新」。见 [CONCEPTS §3](./CONCEPTS.md#3-状态保护state-protection)。
- **别把「克隆」当万能隔离**：核心克隆路径（`$snapshot`、通知载荷、`$patch` 底层的 `deepMerge`）对不可安全克隆的值按引用返回。
  - 这一类值含内建容器（`Map` / `Set` / `Date` / `RegExp` / `Array`）的子类实例，以及 `Error` / `Promise` / 装箱原始值 / `WeakMap` / 函数 / TypedArray / `ArrayBuffer`。
  - 改这些副本会串回活状态；要真隔离请自行 `slice(0)` / 结构化克隆，或换成新值再经 `setState` / `$patch` 写入，或用 `customCloner` 造副本（见 §7）。
  - 完整判据见 [CONCEPTS §8](./CONCEPTS.md#保留原引用的两类值)。
- **不要把状态放在冻结 / 不可写的属性上**：既不可配置也不可写的自有数据属性（`Object.freeze` 过的子树、`defineProperty(writable:false, configurable:false)` 的节点）读到的是裸引用——写不被拦截、不标脏、不推版本、不通知。
  - 要保护与追踪生效，状态得放在可配置 / 可写的属性上，或整体经 `setState` / `$patch` 替换；判可写请显式 `Object.isFrozen`。
  - 常见来路与豁免判据见 [CONCEPTS §3](./CONCEPTS.md#冻结与不可写属性明确豁免)。
- **嵌套层级控制在 2–3 层**：状态保护的代理包装与快照的遍历成本随深度上升；扁平结构也让 `mapState` 更直接。

## 2. 写入

- **优先 `setState` / `$patch`**：`$replaceState` 会整体替换，未列出的键直接丢失。确实需要替换语义时（如「重置为初始态」），显式列出全部键或传工厂函数。
- **同 tick 多次写入用 `batch`**：

  ```ts
  store.batch(() => {
    store.setState('a', 1)
    store.setState('b', 2)
  }) // 只通知一次
  ```

  **异步场景例外**：`await` 之后的变更不受批保护（会逐条通知），请让 action 承担合并职责。见 [CONCEPTS §14](./CONCEPTS.md#14-批处理batch)。

- **`notify.async` 与 `batch` 不要重复叠加**：前者按 tick 合并、后者按作用域合并；同时开启会让「何时通知」变得难以推理。视图更新频率敏感的场景优先用 `batch`。见 [CONCEPTS §2](./CONCEPTS.md#2-通知notify)。
- **不要关闭状态保护**：它是「改了不更新」这类问题的第一道拦截。确有性能证据（profile 显示代理开销占比高）时，先用 `stateProtection: { deep: false }` 只保护顶层。见 [CONCEPTS §3](./CONCEPTS.md#3-状态保护state-protection)。
- **写入失败要可见**：`setState` 的值类型错误、`$patch` 传入非对象都会抛错——不要把写操作包在空的 `try {} catch {}` 里吞掉。
- **判「有没有改」读脏键 / 变更计数，不要按调用了几次 `$patch` 计**：`Object.is` 命中的顶层键整键跳过（不推进变更计数、不标脏、不写缓存、不通知），`$patch({})` 什么都不做。见 [CONCEPTS §7](./CONCEPTS.md#7-脏键isstatekeydirty)。
- **外部来源的键名要在入口做白名单收敛**：`__proto__` / `constructor` / `prototype` 是合法键名，按自有数据属性承载、原型不动，注入的键也不经原型链可见；白名单挡的是「键名合法但你不想要」的那一半。见 [CONCEPTS §1](./CONCEPTS.md#1-状态state)。

## 3. Action

- **一个 action 一个意图**，命名用动词（`login` / `loadOrders`）。组合 Store 下命名会成为路由（`'user/login'`），保持稳定。见 [CONCEPTS §12](./CONCEPTS.md#构造期校验)。
- **返回值用于传递结果**：`dispatch` 原样透传 action 的返回值，无需再写「结果塞进状态」的绕路。
- **要恰好一次通知就开 `notify.onlyOnChange`**：异步 action 的写入按「同步段结束」与「settle」两个时点交付，默认模式下是 2 次；`onlyOnChange` 按变更计数去重、自动压成一次，不要在订阅里做「第一次即当作最终态」的假设。见 [CONCEPTS §2](./CONCEPTS.md#dispatch-的通知时点)。
- **失败就抛**：`dispatch` 会把错误抛给调用方，同时触发 `onError` 钩子（监控插件据此上报）。吞掉错误会让上层无法区分「成功但无数据」与「失败」。见 [CONCEPTS §10](./CONCEPTS.md#错误模型)。
- **Action 内可直接变异 `this.state`**，但不要把 action 状态代理带出执行范围继续写入。
  - 对象 / 数组 / Map / Set 的写入在两种通知模式下都会标记顶层脏键。
  - Date 等其他内建对象的内部变异不被跟踪，改用 `setState` / `$patch` 替换值。
  - 覆盖面见 [CONCEPTS §2](./CONCEPTS.md#脏跟踪的覆盖面)。
- **长列表优先「改叶子值 / 追加」，别逐项原地换对象**：`list[i].field = x` 是 O(1) 查表，`list[i] = { ...新对象 }` 属删边写入、每次触发一次全量重建。批量刷新时按字段写回，或整体换掉该键（`setState('list', nextList)`）。见 [CONCEPTS §2](./CONCEPTS.md#脏跟踪的覆盖面)。
- **`ActionLoader` 的 `setState` 是 `(key, value)` 两参数**签名，不是 patch 对象——这是最常见的接入错误。见 [API.md](./API.md#extrasactionaction-增强)。

## 4. Getter 与选择器

- **getter 必须纯；要记忆化用 `createSelector`**：只读 `state`，不写状态、不做网络请求、不读外部可变变量。Store 层没有 getter 结果缓存，连续读 N 次就是重算 N 次（请求会被打成 N 次），「依赖未变则复用」只有选择器给得了。见 [CONCEPTS §4](./CONCEPTS.md#4-getter无记忆化)。
- **派生数据放 getter / 选择器**，不要在 state 里冗余存储（容易出现两份数据不一致）。
- **重计算用选择器**：`createSelector` 的失效凭证是状态对象身份 + 版本号（O(1) 判定），避免跨 Store 同版本误命中，也无需逐次全树 `deepEqual`。见 [CONCEPTS §9](./CONCEPTS.md#9-选择器selectorextrasselector)。
- **参数化选择器要设上限**：`{ ttl, maxEntries }` 两个都要给，只给参数不给容量会在长会话下持续增长。两者的归一化口径见 [CONCEPTS §9](./CONCEPTS.md#9-选择器selectorextrasselector)。
- **比较器与快照是一套配置，不能只写一半**：`equalityFn` 比较的是输入状态（不是选择器结果）；引用相等的比较器必须一并传 `snapshotState: false`，自定义深比较器必须留默认 `true`。两种写反的后果见 [CONCEPTS §5](./CONCEPTS.md#5-版本号stateversion)。
- **不要在只读派生里返回新对象再去做 `===` 判断**：结果缓存不消除「每次调用都造一个新对象」的下游开销；要「内容相同就不触发更新」，交给状态侧的失效凭证（版本号，或上一条的 `equalityFn` + 快照）。

## 5. 订阅与通知

- **订阅回调要轻**：回调里只做「决定是否需要更新视图」，重活交给渲染层。回调抛错会被隔离（不影响其他监听器），生产经 `onError` 钩子上报——静默不等于无从监控，请给 `onError` 挂一个上报处理器。见 [CONCEPTS §2](./CONCEPTS.md#dispatch-的通知时点)。
- **不写状态就声明 `readOnly`**：

  ```ts
  store.subscribe(listener, { readOnly: true })
  ```

  载荷份数按本轮注册的可写性分配，如实标注是大状态下最主要的通知开销开关。会写载荷的回调误标 `readOnly`：保护开启时是写入抛错，保护关闭时是静默改活状态。页面 / 组件绑定本身就是只读注册。见 [CONCEPTS §2](./CONCEPTS.md#监听器与只读订阅)。

- **把 `maxSubscribers` 当真上界用**：额度对每一次注册生效（含同一函数重复订阅），达上限按 `onLimit` 驱逐一份最早注册或直接抛错，驱逐会发一条 `onError`（第二参 `'subscribe'`）。见 [CONCEPTS §2](./CONCEPTS.md#订阅额度)。
- **退订要落实**：`subscribe` 返回退订函数；页面 / 组件场景交给集成层（`onUnload` / `detached` 自动清理），自行订阅的场景务必在销毁前退订。见 [CONCEPTS §2](./CONCEPTS.md#迭代中退订)。
- **`onlyOnChange` 用于跳过无写入的通知**：它按变更计数判定，不做内容深比较（同值赋值也可能计数）。见 [CONCEPTS §2](./CONCEPTS.md#脏跟踪的覆盖面)。
- **不要用 `subscribe` 做数据转换**：转换放 getter / 选择器；订阅回调里转换会让同一份数据被反复计算。

## 6. 缓存

- **缓存的唯一读入口是 `getCached(key)`，写路径是「写穿」不是「失效」**，见 [CONCEPTS §6](./CONCEPTS.md#6-缓存cache)：
  - **只缓存热点键**：`enableCache(['visibleRows'])`；全量开启只是让每次受控写入多付一次缓存写入。
  - **验证缓存有没有生效别用 `getState()`**：它完全不查缓存，读一万次 `hits` / `misses` 也恒为 0；页面 / 组件绑定（`autoInject` / `autoUpdateOnShow`）走的就是 `getCached`，无需手写读取。
  - **要真的丢掉条目用 `invalidateCache(key?)`**；整表重来得显式 `$replaceState`（它先清空再按新状态回填，未列出的键同时丢失）。
- **统计默认开启，方向是按需关闭**：`cacheConfig.enableStats` 默认就是 `true`，性能敏感场景传 `false` 省掉计数开销——关掉之后 `hits` / `misses` 恒为 0，那是「没在计数」而不是「一次都没命中」。见 [CONCEPTS §6](./CONCEPTS.md#6-缓存cache)。
- **`cacheConfig.ttl` 要传有限非负值**：`NaN` / `Infinity` / 负数会被归一为 `0`（＝不过期）并在开发模式打一条告警——算错的过期时长是一次可见的配置错误，`0` 才是「不过期」的表达方式。见 [CONCEPTS §6](./CONCEPTS.md#6-缓存cache)。
- **独立场景用 `LRUCache`**（自有策略如按接口缓存、按用户隔离，不必强行套在 Store 上），见 [CONCEPTS §6](./CONCEPTS.md#6-缓存cache)：
  - 设好容量与 TTL，并保证 `getOrSet` 的计算函数幂等。
  - `onEvict` 回调里不要写入新条目：回填会抵消淘汰减量。
  - `getStats().evictions` 的契约是 `onEvict` 触发次数（`clear()` 这类配置性清空同样计入）；要单看容量淘汰，清空前后各读一次求差。

## 7. 快照

- **`compareSnapshots` 先读 `inputTrusted`，再读 `changed`**：任一侧快照失败时不逐路径比对，只交付一条 `path: 'root'` 的整体差异且 `changed` 恒为 `true`。
  - 做回滚判定 / 去重时按「保守认为有差异」处理，或回上游重取快照。
  - 这条 root 差异不是一次真实变更，不要写进埋点。见 [CONCEPTS §8](./CONCEPTS.md#差异比较comparesnapshots)。
- **「深」不等于「有差异」**：逐路径展开有 100 层护栏，超出退化为整体 `deepEqual` 判定，不要拿它当缓存失效的信号；等价循环也不误报差异。
  - 自有 `undefined` 属性的增删按 `kind: 'added' | 'removed'` 报告（与键缺失区分）。见 [CONCEPTS §8](./CONCEPTS.md#差异比较comparesnapshots)。
- **`includeNonEnumerable: true` 与数组上的附加自有键都会进快照**，见 [CONCEPTS §8](./CONCEPTS.md#克隆覆盖面)：
  - 带进来的属性在克隆产物里一律 `enumerable: true`（`writable` / `configurable` 仍按源还原），做描述符逐位对比或 `JSON.stringify` 时要预期这一点。
  - 数组的非下标自有可枚举键两条路径都克隆；数组空洞落成真实的 `undefined` 元素。
- **不要把时间旅行快照当完全隔离副本**：`getSnapshots()` 对普通对象 / 数组 / Date / RegExp / Map / Set 重新深克隆，可安全检查；类实例、函数、Promise、WeakMap 等仍是原引用，不要修改。见 [CONCEPTS §8](./CONCEPTS.md#不要混淆时间旅行契约)。
- **先看 `success` 再看 `data`**：失败或中止时 `data` 是 `undefined`（不回传活引用）。只有克隆过程失败的节点会被丢弃（对象属性不写、数组留洞、`Set` 不加、`Map` 跳 entry），宁可少字段也不让活引用穿透隔离契约。见 [CONCEPTS §8](./CONCEPTS.md#失败与丢弃的表现)。

  ```ts
  const snap = createSnapshot(state)
  if (!snap.success) console.warn(snap.errors) // 逐条含 path，可精确定位
  ```

- **不可克隆 / 宿主类型的值用 `customCloner` 接管**：返回 `undefined` 表示交回默认流程，返回任意值即为该节点的克隆结果。
  - 需要「既保留身份又有独立副本」（比如状态里那个 `MyMap` 要能安全改）只能靠它。
  - 没有内建 tag、状态也不在自有可枚举属性上的宿主对象（自定义 native 包装、部分 `wx` 返回值）引擎识别不到，必须在这里提前接管。见 [CONCEPTS §8](./CONCEPTS.md#保留原引用的两类值)。
- **大对象用异步快照并调 `batchSize`**：默认 100，调小可降低单帧卡顿、代价是总耗时略增。给用户反馈请用 `onProgress`——它是纯上报口，抛错会被就地兜住且首次异常后不再被调用。见 [CONCEPTS §8](./CONCEPTS.md#同步与异步)。
- **快照 `onError` 是决策口，不是日志口**：按真值解释，truthy 忽略该错误并按种类降级，falsy（含不写 `return` 的 `void` 箭头函数）拒绝继续。只想记一行日志请显式 `return true`，或改用 `onProgress`。见 [CONCEPTS §8](./CONCEPTS.md#错误账本与降级策略)。
- **超深结构走异步路径**：同步克隆是递归实现（栈深＝数据深度），生效上限取 `maxDepth`（默认 100）与栈安全硬上限（1000）的较小值，抬高 `maxDepth` 也到不了 1000 层以上；超过请用异步路径（任务队列，不占调用栈）。见 [CONCEPTS §8](./CONCEPTS.md#同步与异步)。
- **失败结果也要能读**：`SnapshotResult.data` 的类型是 `T | undefined`，不判空取属性会当场编译报错。
  - 失败时 `stats` 交出的是引擎实际累计到中止点的值，`metadata` 的规模项按零处理——`data` 不可信时按它算出的 size / nodeCount 同样不可信。见 [CONCEPTS §8](./CONCEPTS.md#失败与丢弃的表现)。
- **不要把快照当状态同步机制**：它是一次性隔离副本；跨实例 / 跨端同步请走持久化插件或企业集成。

## 8. 错误处理

- **错误分层**：action / getter 只负责「抛」，是否恢复交给边界决定。见 [CONCEPTS §10](./CONCEPTS.md#边界errorboundary)。
  - `ErrorBoundary` 默认 fail-loud：未配 `fallback` 时重抛，这避免了「静默吞错 + 返回 undefined」这类最难排查的故障。
  - 提供 `fallback` 即等于声明恢复意图；未配 `fallback` 而显式 `recoverable: true` 时返回 `undefined`，返回类型按 `T | F | undefined` 消费。
- **抛出的值请保持 `Error`**：`throw 'str'` 会被边界归一化成 `new Error(String(v))` 记账（堆栈是边界处的，不是抛出点的），重抛时仍是原始值——排查体验远不如带堆栈的 `Error`。见 [CONCEPTS §10](./CONCEPTS.md#边界errorboundary)。
- **`@withErrorBoundary` 装饰的方法返回形状不变**：只有被包裹方法自己的 Promise / thenable 会被等待，回退值即使自带 callable `then` 也不会被 await——给回退值挂 `then` 换不到延迟交付。见 [CONCEPTS §10](./CONCEPTS.md#边界errorboundary)。
- **错误子系统交出来的诊断对象都是副本**：`getGroups()` / `getErrorGroups()` / `generateReport()` 的组、`sampleError`、handler 上下文、入库的 `errorLog` 条目都各拷一层。
  - 改它们不回写内部账目；要改语义请走 API，不要就地改诊断对象。见 [CONCEPTS §10](./CONCEPTS.md#监控errormonitoring)。
- **`ErrorRecovery` 的 operation 命名要稳定**：额度按 `code:storeName:operation` 计量。见 [CONCEPTS §10](./CONCEPTS.md#恢复errorrecovery)。
  - 动态 id（`fetchUser:${id}`）会不断产生新键、让「同一操作的退避策略」失去意义；按「操作类型」而非「操作对象」命名。
  - `recover()` 的 `error` / `config` / `attempt` 由库内写入，第二参数换不到策略。
- **额度用尽不会重新领一份**：`maxRetries` 用尽后计数与周期窗都保留，同一故障周期内的后续 `recover()` 持续抛 `Max retries (n) exceeded`，只有时间窗过期才开新周期。别把未经校验的外部输入直接塞进 `maxRetries`：`NaN` / `Infinity` 会让上限彻底失效（库在写入时已归一到默认 3、小数向下取整、负数夹到 0，但依赖归一不如别传）。
  - 要区分「额度被谁用满」读抛出物 `context.retryKey`（两个来源都缺时是 `<code>:unattributed`）。
  - 策略内部失败抛的是 `GeomStoreError`（`code: INTERNAL_ERROR`、`cause` 是原始错误），按 `instanceof` / `code` 分支处理比匹配文案可靠。
  - 见 [CONCEPTS §10](./CONCEPTS.md#恢复errorrecovery)。
- **`ErrorMonitoring` 的 reporter 要幂等且有超时**：批量 flush 做 `ok / fail / timeout` 三态判定，仅真正 resolve 才算成功，超时按失败重入队；上报端要可重试且不产生重复脏数据。
  - 队列溢出丢弃是可消费指标：`getDroppedErrors()` / `summary.droppedErrors`；看投递缺口读它，不要拿 `summary.totalErrors`（观测到的错误总数）当「都送出去了」。
  - 见 [CONCEPTS §10](./CONCEPTS.md#监控errormonitoring)。
- **显式传入 `0` 是合法的**：`batchInterval` / `batchThreshold` / `reportTimeout` 用 `??` 兜底，不会被替换为默认值（`batchInterval: 0` 即「无延迟」）。
  - `reportTimeout <= 0`（含 `0`）统一按不超时处理——「等到上报真结束」就传 0，不要传一个很大的数。见 [CONCEPTS §10](./CONCEPTS.md#监控errormonitoring)。
- **在 reporter 里不要再写 Store**：上报失败会触发错误处理，可能形成回路。reporter 只做网络 / 日志。
- **给监控配上限**：`maxQueueSize` / `maxFlushRetries` / `maxGroups` 按流量设定，持续失败的批次会被丢弃并告警，而不是无限空转；越界值走一次可见的下限裁剪。见 [CONCEPTS §10](./CONCEPTS.md#监控errormonitoring)。
- **看板读 `getAggregationStats()` 的 `evictedGroups` / `evictedErrors`**：「聚合有没有丢数据」只在这里可见。见 [CONCEPTS §10](./CONCEPTS.md#监控errormonitoring)。
  - `totalErrors` / `byCode` / `byStore` 按条累计、单调不减；`totalGroups` / `getGroups()` 才是存活组视图。
  - `maxGroups: 0` 不是关掉聚合（要关传 `enableAggregation: false`），而是刚建的组立刻被踢掉。

## 9. 小程序实践

- **主包体积**：只用到的能力才引入 `extras/*`；不要为了省一行而引入聚合入口 `@openlide/geomstore/extras`（它会把全部可选能力拉进产物）。分层的体积收益取决于宿主有没有打包器，见 [README 的引入方式与体积分层](../README.md#引入方式与体积分层)。
- **分包**：企业集成（`extras/enterprise`）、调试插件（`extras/plugins` 的 devtools / timeTravel）建议放进分包；体积口径同见 [README](../README.md#引入方式与体积分层)。
- **`setData` 优化**：集成层已按 `isStateKeyDirty` 跳过未变化的映射键，前提是映射粒度合理——映射整个大对象（`mapState: { whole: 'list' }`）会让任何内部变化都触发全量传输。映射到具体字段。见 [CONCEPTS §13](./CONCEPTS.md#映射)。
- **`undefined` 不是合法值**：`setData` 不接受 `undefined`，集成层会过滤掉该字段。要「清空」用 `null`。
- **持久化后端必须同步且三方法齐备**：`getItem` / `setItem` / `removeItem` 缺项在 `store.use()` 安装期即抛 `TypeError`；不传 `storage` 时用的就是内置 `WxStorageBackend`，残缺环境下走内存降级并给一次降级信号。见 [CONCEPTS §11](./CONCEPTS.md#调试表与持久化)。
- **用 `filter` 收敛落盘字段、`debounce` 降低写入频率**（卸载时会同步补写最后一次变更）；需要卸载即清理才开 `clearOnUninstall`。缺失键（微信返回的 `''`）与非字符串载荷都按无数据处理。
- **自建后端实例直接调用时，`wx` 或对应 `*StorageSync` 缺失就抛错**，不静默 no-op（那是「写删报成功、读被洗成无数据」的来源）。
  - 需要内存兜底请交给 `persistencePlugin` 的探测分支。
  - 恢复阶段被跳过（后端抛错 / JSON 语法错 / 载荷不是可信纯对象 / `validate` 拒收）除 `console.error` 外也发一条 `onError`。见 [CONCEPTS §11](./CONCEPTS.md#调试表与持久化)。
- **生产模式静默 ≠ 无信号**：持久化降级、恢复被跳过、监听器抛错、订阅者被驱逐、落盘与卸载清理失败在生产只走 `onError`，上线前挂一个上报处理器比排查时临时切开发模式可靠。见 [FAQ](./FAQ.md#生产环境为什么看不到插件日志)。
- **生命周期**：组件端只认 `lifetimes` 写法；需要映射 actions 的收尾放在钩子同步段——包装器不等待异步 Promise。见 [CONCEPTS §13](./CONCEPTS.md#订阅生命周期)。
- **`withDebounce` / `withThrottle` 的挂起调用要在卸载钩子里收尾**：集成层不清这些定时器，到点它照常调用被装饰方法（并在此期间拖住宿主）。
  - `cancel*`（丢弃）/ `flush*`（立即执行且只执行一次）/ `dispose*`（取消 + 释放该宿主整张状态表）三选一，写在页面 `onUnload` 或组件 `lifetimes.detached` 里。
  - `withCache` / `withRetry` 没有对应收尾入口（缓存表与退避定时器无法收尾），需要停止请在业务侧自判存活标记。
  - 逐 API 契约与示例见 [API.md](./API.md#防抖--节流的宿主收尾入口)。

## 10. 测试与调试

- **测试 Store 用 `createTestStore`**：为未命名的 Store 补充确定性唯一名称，避免并行测试互相干扰。
- **断言走公开 API**：优先用 `getState` / `getter` / `getCacheStats` / `getErrorHistory` 等；确需触碰内部状态时（如构造越界场景），用 `as unknown as { … }` 并写明成因。见 [CONTRIBUTING 的测试约定](../CONTRIBUTING.md#测试约定)。
- **覆盖率是契约**：确实不可达的防御分支用 `/* istanbul ignore … */` 标注，并在注释里写「为什么不可达」——不接受无理由标注，也不要为了凑数字删掉防御分支。阈值与门禁见 [CONTRIBUTING](../CONTRIBUTING.md#门禁与-ci-一致必须全绿)。
- **常用调试手段**：

  | 目的               | 手段                                         |
  | ------------------ | -------------------------------------------- |
  | 看缓存命中情况     | `store.getCacheStats()`                      |
  | 看快照失败原因     | `result.errors`（含 `path` / `type`）        |
  | 看异步快照进度     | `onProgress`                                 |
  | 看 action 耗时     | `loggerPlugin` 或 `analyzerPlugin`           |
  | 看通知是否真的发生 | 订阅里打点，注意 `notify.async` 的 tick 合并 |

## 11. 反模式与上线清单

反模式表只给结论，「为什么」列不超过 10 字；完整理由见对应 §N 与 [CONCEPTS.md](./CONCEPTS.md)。

| 不要这样做                                                           | 为什么             | 改用 / 详见                                                                                                                 |
| -------------------------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| 直接改 `getState()` 返回的嵌套字段                                   | 绕过保护与脏计数   | `setState` / `$patch`，详见 §1                                                                                              |
| 在 getter / 选择器里写状态或发请求                                   | 每次读取都重算     | 写入放 action，详见 §4                                                                                                      |
| `batch(async () => { await …; store.setState(…) })`                  | `await` 后不合并   | 写入放 action 内，详见 §2                                                                                                   |
| 订阅回调里做数据转换                                                 | 同份数据反复算     | 转换放 getter / 选择器，详见 §5                                                                                             |
| 用 `$replaceState` 做局部更新                                        | 未列出的键丢失     | `$patch`，详见 §2                                                                                                           |
| 把 `undefined` 写进要在 `setData` 里传输的字段                       | 该字段会被过滤     | 用 `null` 表达「空」，详见 §9                                                                                               |
| 传异步 storage 或残缺后端给持久化插件                                | 安装期即抛错       | 三方法齐备的同步后端（默认 `WxStorageBackend`），详见 §9                                                                    |
| 宿主卸载后仍留着挂起的防抖 / 节流调用                                | 到点照样执行       | `cancel*` / `flush*` / `dispose*`，详见 §9                                                                                  |
| 用不写 `return` 的箭头函数当快照 `onError`                           | falsy＝拒绝继续    | 显式 `return true`，或改用 `onProgress`，详见 §7                                                                            |
| 只传 `equalityFn: (a, b) => a === b`、不关快照                       | 缓存永不命中       | 一并传 `snapshotState: false`，详见 §4                                                                                      |
| 给自定义深比较器配 `snapshotState: false`                            | TTL 内持续陈旧     | 保持默认 `snapshotState: true`，详见 §4                                                                                     |
| 把 `createDecorator` 装饰的同步方法当 Promise 用                     | 同步方法返回同步值 | 同步取值，异步方法照常 `await`，见 [API.md](./API.md#装饰器)                                                                |
| 为省一行引入 `@openlide/geomstore/extras`                            | 全部能力进模块图   | 按需 `extras/<能力>`，详见 §9 与 [README](../README.md#引入方式与体积分层)                                                  |
| reporter 里再写 Store / 再抛错                                       | 形成错误处理回路   | reporter 只做网络 / 日志，失败交给 flush 的重入队，详见 §8                                                                  |
| 用动态 operation id 做重试计量                                       | 退避策略失去意义   | 按「操作类型」命名，详见 §8                                                                                                 |
| 断言里读私有字段（`errorQueue` 等）                                  | 改名后静默通过     | 用公开 API 或测试缝，详见 §10                                                                                               |
| 用 `getState()` 观察缓存命中率                                       | 它根本不查缓存     | 读 `getCached(key)`、观测读 `getCacheStats()`，详见 §6                                                                      |
| 把 `compareSnapshots` 的 `changed: true` 直接当成「内容确实变了」    | 输入不可信也 true  | 先判 `inputTrusted`，详见 §7                                                                                                |
| 拿 `snap.data` 里的 Map / Set 子类、TypedArray、`Error` 当隔离副本改 | 会串回活状态       | 自行 `slice(0)` / 结构化克隆，或 `customCloner`，详见 §1                                                                    |
| 组合里某个子 store 被单独 `destroy()` 后继续按原样读整棵组合         | 只贡献空视图       | 显式判 `store.destroyed`，并把那条一次性告警当错误处理，见 [CONCEPTS §12](./CONCEPTS.md#子-store-生命周期)                  |
| 给 `initBackgroundSync` 注册一个没有 `refreshData` action 的 store   | 切前台不刷新       | 提供 `refreshData`（通常委托自身的同步 action），或不为该店注册后台同步，见 [API.md](./API.md#extrasenterprise企业微信集成) |
| 在冻结 / 不可写的属性上依赖状态保护与脏追踪                          | 拿到的是裸引用     | 放可写属性上，或整体 `setState` / `$patch` 替换，详见 §1                                                                    |
| 为了覆盖率删除防御分支                                               | 降低真实环境健壮性 | 保留分支 + 带原因的 `istanbul ignore`，详见 §10                                                                             |

### 上线检查清单

- [ ] `NODE_ENV=production` 下无多余日志（插件安装 / 卸载已静默）（§9）
- [ ] 只用到的 `extras/*` 被引入；无聚合入口引入；分包划分完成（§9）
- [ ] 映射粒度到具体字段，未整树映射（§9）
- [ ] 持久化后端为同步实现且三方法齐备（安装期校验会替你拦住残缺后端），`filter` 已收敛字段（§9）
- [ ] `onError` 钩子已接上报（持久化降级与恢复被跳过、监听器抛错、订阅者被驱逐、落盘 / 清理失败在生产只走这里）（§5 / §8 / §9）
- [ ] 高频 `subscribe` 路径核对过 `maxSubscribers`：它是硬上界，达限会挤掉最早的一份注册并发一条 `onError`（§5）
- [ ] 带敏感数据的 action 已按需给 `withLog` 传 `redact` / `sink`（生产构建默认只输出摘要，`Error` 不含 `message`），见 [API.md](./API.md#装饰器)
- [ ] `ErrorMonitoring` 的 reporter 幂等、有超时；`maxQueueSize` / `maxFlushRetries` / `maxGroups` 按流量设定；看板读 `getAggregationStats()`（§8）
- [ ] 消费快照的代码先判 `inputTrusted` 再读 `changed`；没有就地修改快照里「保留原引用」的那类值；需要副本的走 `customCloner` 或自行克隆（§1 / §7）
- [ ] 注册了后台同步（`initBackgroundSync` / `createEnterpriseApp`）的每个 store 都自带 `refreshData` action（见上表）
- [ ] 状态树里没有「靠状态保护拦住写入」的冻结子树 / 不可写属性（§1）
- [ ] 验证缓存是否生效用的是 `getCached()` / `getCacheStats()`，不是 `getState()`（§6）
- [ ] 组合层销毁子 store 后有显式存活判定（`store.destroyed`），没把「整棵组合还读得动」当成「所有子店都活着」（[CONCEPTS §12](./CONCEPTS.md#子-store-生命周期)）
- [ ] `ErrorRecovery` 的 operation 命名稳定（不含动态 id）（§8）
- [ ] 页面 / 组件卸载后不再触发写入；订阅由集成层自动清理（清理绑定不等于销毁 Store）（§9）
- [ ] 被 `withDebounce` / `withThrottle` 装饰的方法已在 `onUnload` / `detached` 里收尾（§9）
- [ ] `stateProtection` 保持开启（§2）
- [ ] 大对象的快照走异步并调过 `batchSize`；`success` 与 `errors` 已接入监控（§7）
