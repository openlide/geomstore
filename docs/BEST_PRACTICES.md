# 最佳实践

本文是「怎么做对」的清单。每条都对应一个具体机制——不理解机制时的「经验之谈」容易在边界场景失效，因此每条都写了**为什么**。

## 1. 状态设计

- **先定义状态类型，再标注工厂返回类型**：

  ```ts
  interface SessionState {
    userInfo: string        // 未登录为空串
    isLoggedIn: boolean
  }

  const sessionStore = createStore({
    name: 'session',
    state: (): SessionState => ({ userInfo: '', isLoggedIn: false }),
  })
  ```

  这样状态形状只有一个来源：getters / actions / 选择器不必重复书写同一份字面量类型（避免「改了一处漏一处」的漂移），状态形状变化时只需改 `interface` 一处。反过来，若不标注返回类型而依赖推断，像空数组这样的字段会被推断成 `never[]`，于是各使用点都要写 `as Todo[]` 之类的断言补救；标注之后这些断言全部消失。
- **用工厂函数声明状态**：`state: () => ({ ... })`。工厂在创建时执行一次，天然避免数组 / Map / Set 等引用类型被多个实例共享。
- **状态保持可序列化与可扁平化**：`setData` 需要跨线程传输，类实例、函数、循环引用都会带来额外开销或克隆失败。派生数据放 getter / 选择器，不要塞进状态。
- **不要向外暴露内部状态引用**：`getState()` 返回的是活动引用，外部持有后容易绕过受控写入。需要只读副本用 `$snapshot()`。
- **不要在 action 之外持有状态引用做写入**：就地变异语义下，这类写入绕过保护、脏计数与缓存失效，表现为「改了但界面不更新」。
- **别把「克隆」当万能隔离**：核心克隆路径（`$snapshot`、通知载荷、`$patch` 底层的 `deepMerge`）对**不可安全克隆的值按引用返回**——类实例、`Error` / `URL` / 装箱原始值等原型非 `Object.prototype`/`null` 的对象、`ArrayBuffer` / `TypedArray` / `DataView`，以及 `Date` / `RegExp` / `Map` / `Set` / `Array` 的**子类实例**（子类不再被降级成丢方法的基类副本，而是共享同一实例）。改这些副本会串回活状态；要真隔离请自行 `slice(0)` / 结构化克隆，或把它们换成新值再经 `setState` / `$patch` 写入。
- **嵌套层级控制在 2–3 层**：状态保护的代理包装与快照的遍历成本随深度上升；扁平结构也让 `mapState` 更直接。

## 2. 写入

- **优先 `setState` / `$patch`**：`$replaceState` 会整体替换，未列出的键直接丢失。确实需要替换语义时（如「重置为初始态」），显式列出全部键或传工厂函数。
- **同 tick 多次写入用 `batch`**：

  ```ts
  store.batch(() => {
    store.setState('a', 1)
    store.setState('b', 2)
  })                        // 只通知一次
  ```

  **异步场景例外**：`await` 之后的变更不受批保护（会逐条通知），请让 action 承担合并职责。
- **`notify.async` 与 `batch` 不要重复叠加**：前者按 tick 合并、后者按作用域合并；同时开启会让「何时通知」变得难以推理。视图更新频率敏感的场景优先用 `batch`。
- **不要关闭状态保护**：它是「改了不更新」这类问题的第一道拦截。确有性能证据（profile 显示代理开销占比高）时，先用 `stateProtection: { deep: false }` 只保护顶层。
- **写入失败要可见**：`setState` 的值类型错误、`$patch` 传入非对象都会抛错——不要把写操作包在空的 `try {} catch {}` 里吞掉。

## 3. Action

- **一个 action 一个意图**，命名用动词（`login` / `loadOrders`）。组合 Store 下命名会成为路由（`'user/login'`），保持稳定。
- **返回值用于传递结果**：`dispatch` 原样透传 action 的返回值，无需再写「结果塞进状态」的绕路。
- **异步 action 的收尾放在 action 内**：通知语义规定「同步段不单独通知、结算时补发一次」，把 `await` 之后的写入也放进同一个 action，就能得到恰好一次通知。
- **失败就抛**：`dispatch` 会把错误抛给调用方，同时触发 `onError` 钩子（监控插件据此上报）。吞掉错误会让上层无法区分「成功但无数据」与「失败」。
- **Action 内可直接变异 `this.state`**：对象 / 数组 / Map / Set 的写入在两种通知模式下都标记顶层脏键；Date 等其他内建对象的内部变异不被跟踪，改用 `setState` / `$patch` 替换值。不要把 Action 状态代理带出执行范围继续写入。
- **长列表优先「改叶子值 / 追加」，别逐个原地换对象**：脏键归属索引对新增边只做增量登记、对 `list[i].field = x` 这类标量写入是 O(1) 查表，而 `list[i] = { ...新对象 }`（覆盖一个值已是对象的位置）属于「删边」，无法廉价判定旧对象是否仍可达，每次都会触发一次全量重建。批量刷新列表时按字段写回或整体换掉该键（`setState('list', nextList)`），比逐项原地替换更省。
- **`ActionLoader` 的 `setState` 是 `(key, value)` 两参数**签名，不是 patch 对象——这是最常见的接入错误。

## 4. Getter 与选择器

- **getter 必须纯**：只读 `state`，不写状态、不做网络请求、不读外部可变变量。getter 结果会被缓存，副作用会在缓存命中时被静默跳过。
- **派生数据放 getter / 选择器**，不要在 state 里冗余存储（容易出现两份数据不一致）。
- **重计算用选择器**：`createSelector` 的版本化缓存同时校验状态对象身份与版本号（O(1)），避免跨 Store 同版本误命中，也无需逐次全树 `deepEqual`。
- **参数化选择器要设上限**：`{ ttl, maxEntries }` 两个都要给。只给参数不给容量，长会话下会持续增长。`maxEntries` 的非法值不会「悄悄关掉缓存」或「让上限形同虚设」——它按 `Number.isFinite(v) ? max(1, floor(v)) : 1000` 归一；`ttl` 则刻意保留 `0`＝立即过期＝不缓存的语义。
- **比较器与快照是一套配置，不能只写一半**：`equalityFn` 比较的是**输入状态**（不是选择器结果），默认 `deepEqual`。状态无版本号时，失效凭证默认是写缓存那份**内容快照**（`snapshotState: true`）；只有引用相等的比较器才需要 `snapshotState: false`——只写 `equalityFn: (a, b) => a === b` 而不关快照，克隆体与活引用永不相等，缓存**永不命中**（不会返回错值，但每次重算）。反过来，自定义深比较器（lodash `isEqual`、`(a, b) => deepEqual(a, b)`）配 `snapshotState: false` 会拿到「同一对象自比、恒相等」的假命中 → TTL 内持续陈旧，这一档必须留默认值。
- **不要在只读派生里返回新对象再去做 `===` 判断**：结果缓存不消除「每次调用都造一个新对象」的下游开销；要「内容相同就不触发更新」，交给状态侧的失效凭证（版本号，或上一节的 `equalityFn` + 快照），而不是在订阅回调里对结果做引用比较。

## 5. 订阅与通知

- **订阅回调要轻**：回调里只做「决定是否需要更新视图」，重活交给渲染层。回调抛错会被隔离（不影响其他监听器），开发模式打印、生产模式经 `onError` 钩子上报——静默不等于无从监控，请给 `onError` 挂一个上报处理器。
- **不写状态就声明 `readOnly`**：

  ```ts
  store.subscribe(listener, { readOnly: true })
  ```

  载荷**按注册的可写性分配**：全部只读时免深拷贝（开启状态保护拿到的是只读保护 Proxy，关闭时是**原始引用**——只读声明此时只是约定，没有运行时拦截）；只要本轮存在可写注册，每个可写注册各拿一份独立深拷贝、只读注册共用一份，先执行的可写回调改不动后面监听器的载荷。所以「给一个会写载荷的回调声明 readOnly」在保护开启时是写入抛错、在保护关闭时是静默改活状态，务必如实标注。页面 / 组件绑定本身就是只读注册。
- **把 `maxSubscribers` 当真上界用**：额度对每一次注册生效（含同一函数重复订阅），达上限时 `evict-oldest` 会让**本次重复注册自己的最早一份**让位、否则驱逐全局最旧的一份注册。生产里驱逐不再完全静默——会发一次 `onError`（第二参 `'subscribe'`），给 `onError` 挂上报处理器就能采到「谁被挤掉了」；`onLimit: 'throw'` 则直接抛错。反复 `subscribe` 同一函数不再能耗尽内存
- **退订要落实**：`subscribe` 返回退订函数；页面 / 组件场景交给集成层（`onUnload` / `detached` 自动清理），自行订阅的场景务必在销毁前退订。本轮派发的是进入通知时在册的注册，回调内退订自己仍会收到最后一次，依赖「立即生效」请在回调里自判存活标记。
- **`onlyOnChange` 用于跳过无写入的通知**：默认模式也使用 Action 脏跟踪代理；该选项额外依据变更计数决定 dispatch / batch 是否通知，不做内容深比较（同值赋值也可能计数）。嵌套写入的归属索引按增量维护：新增边只登记新子树、标量写入 O(1) 查表，逐项更新长列表不再退化；覆盖已有对象值、`delete`、`Map` / `Set` 删除这类「删边」写入仍会走一次全量重建（判错就是漏报，宁可多重建一次）。
- **不要用 `subscribe` 做数据转换**：转换放 getter / 选择器；订阅回调里转换会让同一份数据被反复计算。

## 6. 缓存

- **只缓存热点键**：`enableCache(['visibleRows'])`。全量开启在状态频繁变化的场景只会反复失效。
- **统计按需开启**：`cacheConfig.enableStats` 有额外开销，测量期间打开、定位完关闭。
- **避免整体替换造成全量失效**：`$replaceState` 会让相关缓存全部失效；能 `$patch` 就不要替换。
- **独立场景用 `LRUCache`**：需要自有策略（如按接口缓存、按用户隔离）时直接用它，不必强行套在 Store 上；注意设置容量与 TTL，并保证 `getOrSet` 的计算函数幂等。容量写错不再是静默故障：非有限值回退默认 100、小于 1 夹到 1、小数不取整（等效上限是 `floor(capacity)` 条），构造与 `resize()` 同一口径，容量只存一份真相。`onEvict` 回调里**不要写入新条目**——回填会抵消淘汰减量，淘汰预算耗尽仍超限时库只打一条一次性告警（每实例一次）而不再继续追淘汰，避免单帧变成无界循环。
- **别把 `getStats().evictions` 当「因容量被挤出的条数」**：它的契约是 **`onEvict` 触发次数**，`clear()` 这类配置性清空同样逐条回调并计入；要单看容量淘汰，请在清空前后各读一次求差。
- **Store 侧 `cacheConfig.ttl` 的非法值不会静默生效**：`NaN` / `Infinity` / 负数会被归一为 `0`（＝不过期）并在开发模式打一条告警——别把「算错的过期时长」当成「永不过期」来依赖，它现在是一次可见的配置错误。

## 7. 快照

- **`compareSnapshots` 的循环与 `undefined` 语义**：循环按活动对象对识别，等价循环不会误报差异，共享子对象仍在各路径比较；自有 `undefined` 属性的新增 / 删除会以 `kind: 'added' | 'removed'` 报告，与键缺失区分。逐路径展开有 100 层护栏，超出后退化为整体 `deepEqual` 判定——**深并不等于有差异**，别再拿它当「必然 changed」的信号做缓存失效。
- **不要把时间旅行快照当完全隔离副本**：`getSnapshots()` 对普通对象 / 数组 / Date / RegExp / Map / Set 重新深克隆，可安全检查；类实例、函数、Promise、WeakMap 等仍是原引用，不要修改。
- **先看 `success` 再看 `data`**：失败或中止时 `data` 是 `undefined`（不回传活引用），别直接 `result.data.x`：

  ```ts
  const snap = createSnapshot(state)
  if (!snap.success) console.warn(snap.errors)   // 逐条含 path，可精确定位
  ```

- **理解丢弃语义，不要期待「兜底原值」**：不可安全克隆的节点会被丢弃（对象属性不写、数组留洞、`Set` 不加、`Map` 跳 entry）。宁可少字段，也不让活引用穿透隔离契约。
- **不可克隆的类型用 `customCloner` 接管**：返回 `undefined` 表示交回默认流程，返回任意值即为该节点的克隆结果。
- **大对象用异步快照并调 `batchSize`**：默认 100；调小可降低单帧卡顿，代价是总耗时略增。给用户反馈请用 `onProgress`——它是上报口，抛错会被就地兜住（落一条 `unknown`、不影响 `success` 与结果），首次异常后不再被调用。
- **`onError` 是决策口，不是日志口**：按**真值**解释——truthy 忽略该错误并按种类降级（`cloneError` 丢该子树），falsy（**含不写 `return` 的 `void` 箭头函数**）拒绝继续：`cloneError` 下整次快照 `success: false`，`circular` 下只落 `'[Circular Reference]'` 占位并继续。只想记一行日志请显式 `return true`，或改用 `onProgress`；它自身抛错仍会让整次快照失败。
- **超深结构走异步路径**：同步克隆是递归实现（栈深＝数据深度）。默认 `maxDepth: 100` 会先把超深部分截成占位符；把 `maxDepth` 抬到很高也**撑不爆调用栈**了——还有一个与选项无关的栈安全硬上限 `HARD_MAX_CLONE_DEPTH = 1000`，生效上限是两者的小值，超出部分按 `maxDepth` 落一条错误 + 占位（不影响 `success`）。真要克隆超过 1000 层的结构，请用异步路径（任务队列，不占调用栈），别指望抬选项值。
- **失败结果也要能读**：`SnapshotResult.data` 的类型是 `T | undefined`（失败 / 中止 / 超时都可能交不出东西），不判空取属性会当场编译报错；失败时 `stats` 交出的是引擎**实际累计到中止点**的值（不再是全零），而 `metadata` 的规模项按零处理——`data` 不可信时按它算出的 size / nodeCount 同样不可信。
- **不要把快照当状态同步机制**：它是一次性隔离副本；跨实例 / 跨端同步请走持久化插件或企业集成。

## 8. 错误处理

- **错误分层**：action / getter 只负责「抛」，是否恢复交给边界决定。`ErrorBoundary` 默认 **fail-loud**（未配 `fallback` 时重抛）——这避免了「静默吞错 + 返回 undefined」这类最难排查的故障。提供 `fallback` 即等于声明恢复意图；未配 `fallback` 而显式 `recoverable: true` 时返回 `undefined`，返回类型是 `T | F | undefined`，按 `T | F` 消费会在远端二次炸。
- **抛出的值请保持 `Error`**：`throw 'str'` 会被边界归一化成 `new Error(String(v))` 记账（堆栈是边界处的，不是抛出点的），重抛时仍是原始值——排查体验远不如带堆栈的 `Error`。
- **错误子系统交出来的对象都是副本**：`getGroups()` / `getErrorGroups()` / `generateReport()` 的组、`sampleError`、交给 `ErrorHandler` handler 的上下文、入库的 `errorLog` 条目都已各拷一层，改它们不再回写内部账目（此前会污染 `sum(byStore) === totalErrors` 的自洽性）。要改语义请走 API，不要就地改诊断对象。
- **`@withErrorBoundary` 装饰的方法返回形状不变**：只有**被包裹方法自己的** Promise / thenable 会被等待，回退值即使自带 callable `then` 也不会被 await——别指望给回退值挂个 `then` 就能延迟交付。
- **`ErrorRecovery` 的 operation 命名要稳定**：额度按 `code:storeName:operation` 计量。动态 id（`fetchUser:${id}`）会不断产生新键——虽有容量守卫兜底（`MAX_RETRY_KEYS = 1000`，先清自身周期窗已到期的键、再按插入顺序淘汰最旧），但会让「同一操作的退避策略」失去意义。推荐按「操作类型」而非「操作对象」命名。`recover()` 的 `error` / `config` / `attempt` 由库内写入，别指望用第二参数换策略。
- **别指望「再调一次就重新领一份额度」**：`maxRetries` 用尽后计数与周期窗**都保留**，同一故障周期内的后续 `recover()` 持续抛 `Max retries (n) exceeded`；只有时间窗过期才开新周期。想区分「额度被谁用满」就读抛出物 `context.retryKey`（两个来源都缺时是 `<code>:unattributed`）。策略内部失败抛的是 `GeomStoreError`（`code: INTERNAL_ERROR`、`cause` 是原始错误），按 `instanceof` / `code` 分支处理比匹配文案可靠。
- **`ErrorMonitoring` 的 reporter 要幂等且有超时**：批量 flush 做 `ok / fail / timeout` 三态判定，仅真正 resolve 才算成功；超时会被当作失败并重入队。确保上报端可重试、不产生重复脏数据。队列溢出丢弃是**可消费指标**：`getDroppedErrors()` / `summary.droppedErrors`，看投递缺口就读它，别拿 `summary.totalErrors`（观测到的错误总数）当「都送出去了」。
- **显式传入 `0` 是合法的**：`batchInterval` / `batchThreshold` / `reportTimeout` 用 `??` 兜底，不会被替换为默认值（`batchInterval: 0` 即「无延迟」）。`reportTimeout <= 0`（含 `0`）统一按**不超时**处理——想「等到上报真结束」就传 0，别传一个很大的数。
- **在 reporter 里不要再写 Store**：上报失败会触发错误处理，可能形成回路。reporter 只做网络/日志。
- **配置上限防长期运行泄漏**：`maxQueueSize`（默认 1000）与 `maxFlushRetries`（默认 3）；持续失败的批次会被丢弃并告警，而不是无限空转。这两个数**再小也有下限**（`maxQueueSize` 最小 1、`maxFlushRetries` 最小 0，非有限值回默认）：传 `0` / 负数不会再把上报链做成近乎静默失效（每条新错误先挤掉上一条、重入队 `slice` 算出空数组、首批立刻被丢弃），而是一次可见的配置裁剪。

## 9. 小程序实践

- **主包体积**：只用到的能力才引入 `extras/*`；**不要**为了省一行而引入聚合入口 `@openlide/geomstore/extras`（它会把全部可选能力拉进产物）。
- **分包**：企业集成（`extras/enterprise`）、调试插件（`extras/plugins` 的 devtools/timeTravel）建议放进分包。
- **`setData` 优化**：集成层已按 `isStateKeyDirty` 跳过未变化的映射键，前提是**映射粒度合理**——映射整个大对象（`mapState: { whole: 'list' }`）会让任何内部变化都触发全量传输。映射到具体字段。
- **`undefined` 不是合法值**：`setData` 不接受 `undefined`，集成层会过滤掉该字段。要「清空」用 `null`。
- **持久化**：后端必须同步且 **`getItem` / `setItem` / `removeItem` 三项齐备**（缺项在 `store.use()` 安装期即抛 `TypeError`，不再悄悄换后端）；不传 `storage` 时用的就是内置 `WxStorageBackend`（要求 `wx` 的三个同步方法齐备，残缺环境下走内存降级并给一次降级信号），显式传 `new WxStorageBackend()` 与不传已是同一份实现，缺失键（微信返回的 `''`）与非字符串载荷都按无数据处理；用 `filter` 收敛落盘字段；`debounce` 降低写入频率（卸载时会同步补写最后一次变更）；需要卸载即清理才开 `clearOnUninstall`。**自建实例直接调用时，`wx` 或对应 `*StorageSync` 缺失就抛错**而不是静默 no-op（那是「写删报成功、读被洗成无数据」的来源），在非微信环境里复用它会炸——需要内存兜底请交给 `persistencePlugin` 的探测分支。恢复阶段被跳过（后端抛错 / JSON 语法错 / 载荷不是可信纯对象 / `validate` 拒收）除 `console.error` 外也发一条 `onError`，别只盯控制台。
- **生产模式静默 ≠ 无信号**：插件安装/卸载等日志在 `NODE_ENV=production` 下关闭；但持久化降级为内存后端、**恢复被跳过**、监听器抛错、**订阅者被驱逐**、落盘与卸载清理失败都会 `emit('onError', …, source)`。上线前给 `onError` 挂一个上报处理器，比排查时临时切开发模式更可靠。
- **生命周期**：组件端只认 `lifetimes` 写法；`onUnload` / `detached` 先执行用户钩子，再在 `finally` 清理绑定。需要映射 actions 的收尾放在钩子同步段，包装器不等待异步 Promise；清理绑定不等于销毁 Store，已销毁 Store 上的写操作仍会抛错（`setStateProtection()` 现在也在这条守卫之内）。
- **集成层不清装饰器的挂起调用**：被 `withDebounce` / `withThrottle` 装饰的方法若还有窗口 / 延迟内的调用，退订不会替你把定时器摘掉——到点后它照常执行（并在此期间拖住宿主）。在同一个卸载钩子里收尾，`dispose*` 是「取消 + 释放该宿主整张状态表」的一句话方案：

  ```ts
  // 页面：withPageStore(...)({ ... }) 的 onUnload
  onUnload() {
    disposeDebouncedState(this)   // 挂起的搜索不再发请求，宿主状态表释放
    disposeThrottledState(this)   // 挂起的滚动 / 输入补发丢弃，窗口计时一并归零
  }

  // 组件：lifetimes.detached（写在这一层的钩子才会被调用）
  lifetimes: {
    detached() {
      disposeDebouncedState(this)
    },
  }
  ```

  离开前还想把最后一次输入落盘就改用 `flush*`（立即执行且只执行一次）；只丢某一只方法用 `cancel*(this, 'search')`。`withCache` / `withRetry` 没有对应入口（缓存表与退避定时器无法收尾），需要停止请在业务侧自判存活标记。

## 10. 测试与调试

- **测试 Store 用 `createTestStore`**：为未命名的 Store 补充确定性唯一名称，避免并行测试互相干扰。
- **断言走公开 API**：优先用 `getState` / `getter` / `getCacheStats` / `getErrorHistory` 等；确需触碰内部状态时（如构造越界场景），用 `as unknown as { … }` 并写明成因。
- **覆盖率是契约**：门禁即 `jest.config.js` 的 `coverageThreshold`（global 语句 / 分支 / 函数 / 行 98 / 95 / 98 / 98，`core` 与 snapshot / selector / action 按单文件另设分支 85 下限）。确实不可达的防御分支用 `/* istanbul ignore … */` 标注，并在注释里写「为什么不可达」——不接受无理由标注。
- **常用调试手段**：

  | 目的 | 手段 |
  | --- | --- |
  | 看缓存命中情况 | `store.getCacheStats()` |
  | 看快照失败原因 | `result.errors`（含 `path` / `type`） |
  | 看异步快照进度 | `onProgress` |
  | 看 action 耗时 | `loggerPlugin` 或 `analyzerPlugin` |
  | 看通知是否真的发生 | 订阅里打点，注意 `notify.async` 的 tick 合并 |

## 11. 反模式清单

| 不要这样做 | 为什么 | 改用 |
| --- | --- | --- |
| 直接改 `getState()` 返回的嵌套字段 | 绕过保护、脏计数与缓存失效 → 「改了不更新」 | `setState` / `$patch`（或临时开 `stateProtection.deep: false`） |
| 在 getter / 选择器里写状态或发请求 | 结果被缓存，副作用会被静默跳过 | 写入放 action；请求结果写入 state 后由 getter 派生 |
| `batch(async () => { await …; store.setState(…) })` | `await` 之后不受批保护，通知会逐条发出 | 写入放 action 内，或用同步 `batch` 包住同步段 |
| 订阅回调里做数据转换 | 同一份数据被反复计算 | 转换放 getter / 选择器 |
| 用 `$replaceState` 做局部更新 | 未列出的键会丢失；缓存全量失效 | `$patch` |
| 把 `undefined` 写进要在 `setData` 里传输的字段 | `setData` 不接受 `undefined` | 用 `null` 表达「空」 |
| 传异步 storage 或**残缺后端**给持久化插件 | 异步写入存在竞态与静默丢失；缺 `setItem` / `removeItem` 的后端会在安装期就被拦下（`TypeError`）。内置默认后端同样要求 `wx` 三方法齐备，残缺环境不再被当成可用后端（旧行为是每次落盘抛 `TypeError`），而是降级为内存存储 | `WxStorageBackend`（不传 `storage` 时即是它）或自封装、三方法齐备的同步实现 |
| 宿主卸载后仍留着挂起的防抖 / 节流调用 | 定时器到点照样调用被装饰方法（常见后果：往已销毁的 Store 里写），期间宿主无法回收 | 在 `onUnload` / `lifetimes.detached` 调 `cancel*`（丢弃）/ `flush*`（立即执行一次）/ `dispose*`（取消并释放状态） |
| 用不写 `return` 的箭头函数当快照 `onError` | 判定按真值走，`undefined` ＝「拒绝继续」，纯观测会把整次快照做成失败 | 显式 `return true`，或改用 `onProgress` 做观测 |
| 只传 `equalityFn: (a, b) => a === b`、不关快照 | 状态无版本号时缓存的是**内容克隆**，与活引用永不相等 → 每次重算（memo 形同失效） | 一并传 `snapshotState: false`，或改传带版本号的 Store 状态 / `cache: false` |
| 给自定义深比较器配 `snapshotState: false` | 缓存活引用后两个实参是同一对象，深比较恒等 → 就地变异看不见，TTL 内返回陈旧值 | 保持默认 `snapshotState: true`（深比较器必须配内容快照） |
| 给装饰器方法期待同步返回（`createDecorator`） | 0.6.0 起同步方法不再被包成 `async`——反过来说，之前依赖它返回 Promise 的调用方现在拿到的是同步值 | 同步方法按同步取值；异步方法照常 `await` |
| 为省一行引入 `@openlide/geomstore/extras` | 全部可选能力进入产物，主包变大 | 按需 `extras/<能力>` |
| reporter 里再写 Store / 再抛错 | 形成错误处理回路 | reporter 只做网络/日志，失败交给 flush 的重入队 |
| 用动态 operation id 做重试计量 | 退避策略失去意义，键数持续增长 | 按「操作类型」命名 |
| 断言里读私有字段（`errorQueue` 等） | 改名后测试静默通过，问题被掩盖 | 用公开 API 或测试缝；必读内部时写明成因 |
| 为了覆盖率删除防御分支 | 降低了真实环境的健壮性 | 保留分支 + 带原因的 `istanbul ignore` 标注 |

## 12. 上线检查清单

- [ ] `NODE_ENV=production` 下无多余日志（插件安装等已静默）
- [ ] 只用到的 `extras/*` 被引入；无聚合入口引入；分包划分完成
- [ ] 映射粒度到具体字段，未整树映射
- [ ] 持久化后端为同步实现且三方法齐备（安装期校验会替你拦住残缺后端），`filter` 已收敛字段
- [ ] `onError` 钩子已接上报（持久化降级与恢复被跳过、监听器抛错、**订阅者被驱逐**、落盘 / 清理失败在生产只走这里）
- [ ] 高频 `subscribe` 路径核对过 `maxSubscribers`：它是硬上界，达限会挤掉最早的一份注册（重复订阅挤掉自己的那一份）并发一条 `onError`
- [ ] 带敏感数据的 action 已按需给 `withLog` 传 `redact` / `sink`（生产构建默认只输出摘要，`Error` 连 `message` 都不带；`redact` 之后仍会再过一层摘要，除非显式 `summarizeInProduction: false`）
- [ ] `ErrorMonitoring` 的 reporter 幂等、有超时；`maxQueueSize` / `maxFlushRetries` 按流量设定
- [ ] `ErrorRecovery` 的 operation 命名稳定（不含动态 id）
- [ ] 页面 / 组件卸载后不再触发写入；订阅由集成层自动清理
- [ ] 被 `withDebounce` / `withThrottle` 装饰的方法已在 `onUnload` / `detached` 里收尾（`cancel*` / `flush*` / `dispose*`）——集成层不会替你清这些定时器
- [ ] `stateProtection` 保持开启
- [ ] 大对象的快照走异步并调过 `batchSize`；`success` 与 `errors` 已接入监控
