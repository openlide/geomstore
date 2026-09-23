# 最佳实践

本文是「怎么做对」的清单。每条都对应一个具体机制——不理解机制时的「经验之谈」容易在边界场景失效，因此每条都写了**为什么**。

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

  这样状态形状只有一个来源：getters / actions / 选择器不必重复书写同一份字面量类型（避免「改了一处漏一处」的漂移），状态形状变化时只需改 `interface` 一处。反过来，若不标注返回类型而依赖推断，像空数组这样的字段会被推断成 `never[]`，于是各使用点都要写 `as Todo[]` 之类的断言补救；标注之后这些断言全部消失。

- **用工厂函数声明状态**：`state: () => ({ ... })`。工厂在创建时执行一次，天然避免数组 / Map / Set 等引用类型被多个实例共享。
- **状态保持可序列化与可扁平化**：`setData` 需要跨线程传输，类实例、函数、循环引用都会带来额外开销或克隆失败。派生数据放 getter / 选择器，不要塞进状态。
- **不要向外暴露内部状态引用**：`getState()` 返回的是活动引用，外部持有后容易绕过受控写入。需要只读副本用 `$snapshot()`。
- **不要在 action 之外持有状态引用做写入**：就地变异语义下，这类写入绕过保护、脏计数与缓存失效，表现为「改了但界面不更新」。
- **别把「克隆」当万能隔离**：核心克隆路径（`$snapshot`、通知载荷、`$patch` 底层的 `deepMerge`）对**不可安全克隆的值按引用返回**——类实例、`Error` / `URL` / 装箱原始值等原型非 `Object.prototype`/`null` 的对象、`ArrayBuffer` / `TypedArray` / `DataView`，以及 `Date` / `RegExp` / `Map` / `Set` / `Array` 的**子类实例**（子类不再被降级成丢方法的基类副本，而是共享同一实例）。改这些副本会串回活状态；要真隔离请自行 `slice(0)` / 结构化克隆，或把它们换成新值再经 `setState` / `$patch` 写入。**`extras/snapshot` 的克隆引擎在 0.7.0 与这条合流**（同一份判据、同步与异步两条路径同时生效），所以「快照一定隔离」这句话现在对同一批值也不成立了，见第 7 节。
- **别把「被锁死的属性」当受保护的状态**：既不可配置也不可写变的自有数据属性（`Object.freeze` 过的子树、`defineProperty(writable:false, configurable:false)` 的节点）在 0.7.0 之后**读取不再抛 Proxy 不变量的 `TypeError`**，而是原样返回**裸引用**——代价是它同时不受写保护拦截、不标脏、不推版本、不通知。此前深保护代理（默认开启）会在这类属性上读一次就崩，常见来路是 `setState('user', otherStore.$snapshot().user)`（快照是深冻结的）；现在能读了，但「改了它没人知道」。**要保护与追踪生效，就得把状态放在可配置 / 可写的属性上**，或整体经 `setState` / `$patch` 替换；判可写请显式 `Object.isFrozen`。
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

  **异步场景例外**：`await` 之后的变更不受批保护（会逐条通知），请让 action 承担合并职责。

- **`notify.async` 与 `batch` 不要重复叠加**：前者按 tick 合并、后者按作用域合并；同时开启会让「何时通知」变得难以推理。视图更新频率敏感的场景优先用 `batch`。
- **不要关闭状态保护**：它是「改了不更新」这类问题的第一道拦截。确有性能证据（profile 显示代理开销占比高）时，先用 `stateProtection: { deep: false }` 只保护顶层。
- **写入失败要可见**：`setState` 的值类型错误、`$patch` 传入非对象都会抛错——不要把写操作包在空的 `try {} catch {}` 里吞掉。
- **`$patch` 的「等值顶层键短路」与 `setState` 同一条判据**（0.7.0）：`Object.is` 命中的键整键跳过——不推进变更计数、不标脏、不写缓存、不通知，`$patch({})` 什么都不做。这意味着「打了补丁就算改过」的推断不再成立（此前 `$patch` 无条件计数并把补丁触及的每个键标脏 + 写一遍缓存，于是 `notify.onlyOnChange` 在最常用的补丁路径上省不掉 `setData`，两个公开写入 API 对同一次写入给出相反答案）。要靠「有没有改」驱动副作用请读 `isStateKeyDirty` / 变更计数，不要按调用了几次 `$patch` 计。
- **键名可以写 `__proto__` / `constructor` / `prototype`，但承载方式是自有数据属性**（0.7.0 安全修复）：`setState('__proto__', { inj: 1 })` 此前会把**整个状态对象的原型**换成入参，注入的键从此经任何缺失键都读得到（`state.isAdmin`、`state.token` 凭空出现）、`isPlainObject` 判定失效、深比较与克隆体从此恒不等（选择器持续失配）；现在它与 `$patch` / `$replaceState` / `deepMerge` 同口径走 DefineOwnProperty，原型不动、注入键也不再经原型链可见。**实践结论不变**：状态键来自外部（服务端下发、用户输入、`JSON.parse` 的载荷）时仍要在入口做白名单收敛——这一层挡的是「键名合法但你不想要」的那一半。

## 3. Action

- **一个 action 一个意图**，命名用动词（`login` / `loadOrders`）。组合 Store 下命名会成为路由（`'user/login'`），保持稳定。
- **返回值用于传递结果**：`dispatch` 原样透传 action 的返回值，无需再写「结果塞进状态」的绕路。
- **异步 action 的写入按「两个时点」交付，别指望恰好一次**：通知现在在**同步段结束时当场补发一次**、settle 时再补发一次（0.7.0 变更，此前只有 settle 那一轮）。这带来两件事：① 返回**永不 settle** 的 promise（等用户交互才 resolve、`wx.request` 无回调也不 reject）时，同步段那一格状态当场就可见——旧行为下它要等「下一个不相干的通知」才顺带补发，`dialogVisible = true` 得等对话框关掉之后才显示；② 默认模式下「同步段有写入且最终 settle」的 action 通知数是 **2 次**，把 `await` 之后的写入也放进同一个 action 得到的是「两次都覆盖」而不是「恰好一次」。要恰好一次交给 `notify.onlyOnChange`（它按变更计数去重，自动压成一次），别在订阅里做「第一次即当作最终态」的假设。`batch` 期间不提前通知；同步段没写入不多刷。
- **失败就抛**：`dispatch` 会把错误抛给调用方，同时触发 `onError` 钩子（监控插件据此上报）。吞掉错误会让上层无法区分「成功但无数据」与「失败」。
- **Action 内可直接变异 `this.state`**：对象 / 数组 / Map / Set 的写入在两种通知模式下都标记顶层脏键；Date 等其他内建对象的内部变异不被跟踪，改用 `setState` / `$patch` 替换值。不要把 Action 状态代理带出执行范围继续写入。
- **长列表优先「改叶子值 / 追加」，别逐个原地换对象**：脏键归属索引对新增边只做增量登记、对 `list[i].field = x` 这类标量写入是 O(1) 查表，而 `list[i] = { ...新对象 }`（覆盖一个值已是对象的位置）属于「删边」，无法廉价判定旧对象是否仍可达，每次都会触发一次全量重建。批量刷新列表时按字段写回或整体换掉该键（`setState('list', nextList)`），比逐项原地替换更省。
- **`ActionLoader` 的 `setState` 是 `(key, value)` 两参数**签名，不是 patch 对象——这是最常见的接入错误。

## 4. Getter 与选择器

- **getter 必须纯，而且要知道它每次读取都重算**：只读 `state`，不写状态、不做网络请求、不读外部可变变量。**Store 层没有 getter 结果缓存**（无版本号比较、无记忆表），所以副作用不是「命中缓存时被静默跳过」，而是**每次读取都真的执行一遍**——连续读同一个 getter 就是连续重算 N 次，网络请求会被打成 N 次。要「依赖未变则复用」请改用 `extras/selector` 的 `createSelector`（失效凭证是状态对象身份 + 版本号，O(1) 判定）。把「纯」这条当硬要求有两个理由：不纯的 getter 在集成层（`mapGetters`）与插件反射（`store.getters` / devtools 枚举）里会被调用方按「随便读几次」的形状使用；而一旦哪天加上缓存，今天看不见的差异就变成今天看不见的 bug。
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

- **只缓存热点键**：`enableCache(['visibleRows'])`。全量开启在状态频繁变化的场景只会让条目被反复**写穿覆盖**（`setState` / `$patch` 每次都把新值写回条目），换来的是每次受控写入多付一次缓存写入，而不是「反复失效反复重算」。
- **别拿 `getState()` 验证缓存有没有生效**：缓存的唯一读取入口是 `getCached(key)`，`getState()` / `store.state` 完全不查缓存。用 `getState()` 读上一万次，`getCacheStats()` 的 `hits` / `misses` 也恒为 0——这不是缓存坏了，是没走它。页面 / 组件绑定（`autoInject` / `autoUpdateOnShow`）走的就是 `getCached`，那条路径无需手写读取。
- **写路径是写穿，不是失效**：`setState` / `$patch` 把新值写进条目，写完立刻 `getCached` 仍命中且拿到新值。所以「写入后靠一次未命中去重算」的写法不成立；要真的丢掉条目请用 `invalidateCache(key?)`，要整表重来用 `$replaceState`（它先清空再按新状态回填）。
- **统计按需开启**：`cacheConfig.enableStats` **默认就是 `true`**（显式传 `true` 不打开任何东西）；采集 hits/misses 有额外开销，性能敏感场景传 `false`——关掉之后 `getStats()` 的 `hits` / `misses` 恒为 0，别把它当成「一次都没命中」。
- **避免整体替换**：`$replaceState` 会清空整表再回填（未列出的键同时丢失）；能 `$patch` 就不要替换。
- **独立场景用 `LRUCache`**：需要自有策略（如按接口缓存、按用户隔离）时直接用它，不必强行套在 Store 上；注意设置容量与 TTL，并保证 `getOrSet` 的计算函数幂等。容量写错不再是静默故障：非有限值回退默认 100、小于 1 夹到 1、小数不取整（等效上限是 `floor(capacity)` 条），构造与 `resize()` 同一口径，容量只存一份真相。`onEvict` 回调里**不要写入新条目**——回填会抵消淘汰减量，淘汰预算耗尽仍超限时库只打一条一次性告警（每实例一次）而不再继续追淘汰，避免单帧变成无界循环。
- **别把 `getStats().evictions` 当「因容量被挤出的条数」**：它的契约是 **`onEvict` 触发次数**，`clear()` 这类配置性清空同样逐条回调并计入；要单看容量淘汰，请在清空前后各读一次求差。
- **Store 侧 `cacheConfig.ttl` 的非法值不会静默生效**：`NaN` / `Infinity` / 负数会被归一为 `0`（＝不过期）并在开发模式打一条告警——别把「算错的过期时长」当成「永不过期」来依赖，它现在是一次可见的配置错误。

## 7. 快照

- **`compareSnapshots` 先读 `inputTrusted`，再读 `changed`**（0.7.0）：`SnapshotDiff` 新增必填字段 `inputTrusted`，任一侧快照 `success: false` 时为 `false`，此时**不逐路径比对**，而是交付一条 `path: 'root'` 的整体差异并把 `changed` 恒置为 `true`。所以 `changed: true` 有两种来源：**输入不可信**（半成品 / 失败结果，真实差异恰好落在「两侧都没填上的键」上，逐路径比对只会静默漏报）与**内容确有差异**。做回滚判定 / 去重时按「保守认为有差异」处理，或直接回上游重取快照；别把这条 root 差异当成一次真实变更写进埋点。旧行为是反方向的错：两侧都失败时 `data` 同为 `undefined`、被 `===` 短路成 `changed: false`——「两份都不可用」被报成「两次快照无差异」，据此跳过回滚。
- **`Map` 条目路径可以当条目身份用了**（0.7.0）：值差异记 `root[<String(key)>]`、键增删记 `root.key[<String(key)>]`，与克隆引擎的 `errors[].path` 同一套 scheme，此前是「两侧各自的插入下标」——同一个逻辑键在两次快照里路径不同（前面插一个键就全体后移），且同一串承载两种事实（只有 `kind` 能分流），按 path 聚合 / 去重 / 回放的消费方会把两者并成一格。`Set` 的增删条目路径**仍是报告序下标**，那不是身份，要按元素判定请自己比 `oldValue` / `newValue`。
- **`compareSnapshots` 的循环与 `undefined` 语义**：循环按活动对象对识别，等价循环不会误报差异，共享子对象仍在各路径比较；自有 `undefined` 属性的新增 / 删除会以 `kind: 'added' | 'removed'` 报告，与键缺失区分。逐路径展开有 100 层护栏，超出后退化为整体 `deepEqual` 判定——**深并不等于有差异**，别再拿它当「必然 changed」的信号做缓存失效。Date / RegExp / Map / Set / 装箱原始值按**内容**比较（`new Number(1)` vs `new Number(2)` 现在报 `changed: true`，同一引用仍短路）。
- **`includeNonEnumerable: true` 带进来的是「读得到」的属性**（0.7.0）：这些属性在克隆产物里一律 `enumerable: true`（`writable` / `configurable` 仍按源还原）。此前它们被还原成 `enumerable: false`，于是这个选项没有任何下游读者——不进 `Object.keys`、不进 `JSON.stringify`、也不进 `compareSnapshots` 的键集比对，两次快照之间只有那个不可枚举的版本号变了照样报 `changed: false`。现在可以放心用它把状态上的版本号 / 计数标记带进快照参与比对；代价是快照产物与源在描述符上不再逐位相同（做 `Object.getOwnPropertyDescriptors` 对比时要预期这一点），以及 `JSON.stringify(snap.data)` 会多出这些键。
- **数组上的附加自有键会进快照**（0.7.0，与 `deepCloneState` 对齐）：`arr.meta = 'v2'` 这类非下标自有可枚举键此前整体丢失（只按 `0..length-1` 逐项克隆），后果是快照少字段（回滚 / 回放场景）加上 `deepEqual(snap.data, state)` 由命中变失配 → 喂给选择器就持续失配。现在同步与异步两条路径都补了这一趟。**仍成立的取舍**：数组**空洞**落成真实的 `undefined` 元素、元素描述符不还原，这是声明过的跨路径统一口径。
- **不要把时间旅行快照当完全隔离副本**：`getSnapshots()` 对普通对象 / 数组 / Date / RegExp / Map / Set 重新深克隆，可安全检查；类实例、函数、Promise、WeakMap 等仍是原引用，不要修改。
- **先看 `success` 再看 `data`**：失败或中止时 `data` 是 `undefined`（不回传活引用），别直接 `result.data.x`：

  ```ts
  const snap = createSnapshot(state)
  if (!snap.success) console.warn(snap.errors) // 逐条含 path，可精确定位
  ```

- **理解丢弃语义，但不要把它套到「保留原引用」那一类值上**：只有**克隆过程失败**的节点会被丢弃（对象属性不写、数组留洞、`Set` 不加、`Map` 跳 entry），宁可少字段也不让活引用穿透隔离契约。而 `Map` / `Set` / `Date` / `RegExp` / `Array` 的**子类**实例与「状态住在内部槽位里」的内建值（`Promise`、装箱原始值、TypedArray / ArrayBuffer / DataView、`WeakMap` / `WeakSet`、`Error`、函数）在 0.7.0 起**一律保留原引用**——它们与活状态是同一个对象，**别改它们**（改 `snap.data.myMap` 会串回活状态）。变化前后的对照：此前引擎把它们重建成 `instanceof` 仍真的**空壳**（`await` 没有 `then`、`Number(new Number(1))` 抛 `TypeError`、字节缓冲交给宿主就炸、`Error` 连 `message` 都丢），并且两份空壳之间 `compareSnapshots` 恒报「无差异」。这不是「快照不支持它们」，而是同库两套答案（`deepCloneState` 一直是保留原引用）现在合流了。
- **不可克隆 / 宿主类型的值用 `customCloner` 接管——它是这类值的唯一兜底出口**：返回 `undefined` 表示交回默认流程，返回任意值即为该节点的克隆结果。需要「既保留身份又有独立副本」（比如状态里那个 `MyMap` 要能安全改）只能靠它；没有内建 tag、状态也不在自有可枚举属性上的宿主对象（自定义 native 包装、部分 `wx` 返回值）引擎识别不到、仍会被重建为空壳，**必须**在这里提前接管。
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
- **配置上限防长期运行泄漏**：`maxQueueSize`（默认 1000）、`maxFlushRetries`（默认 3）、**`maxGroups`（默认 100，0.7.0 新增可配）**；持续失败的批次会被丢弃并告警，而不是无限空转。前两个数**再小也有下限**（`maxQueueSize` 最小 1、`maxFlushRetries` 最小 0，非有限值回默认）：传 `0` / 负数不会再把上报链做成近乎静默失效（每条新错误先挤掉上一条、重入队 `slice` 算出空数组、首批立刻被丢弃），而是一次可见的配置裁剪。`maxGroups` 管的是**同时存活多少组**（达上限按「最近最少出现」驱逐旧组，首次驱逐出声一次），走同一条归一化（非有限值回默认 100、有限值 `Math.max(1, floor(v))`）——注意 `maxGroups: 0` 不是「关掉聚合」而是「刚建的组立刻被踢掉」，要关聚合请传 `enableAggregation: false`。**驱逐不会让错误总数倒退**：`totalErrors` / `byCode` / `byStore` 按条累计、单调不减，`totalGroups` / `getGroups()` 才是存活组视图；两者差额读 `getAggregationStats()` 的 `evictedGroups` / `evictedErrors`，那里是「聚合有没有丢数据」的唯一可见出口。

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

  | 目的               | 手段                                         |
  | ------------------ | -------------------------------------------- |
  | 看缓存命中情况     | `store.getCacheStats()`                      |
  | 看快照失败原因     | `result.errors`（含 `path` / `type`）        |
  | 看异步快照进度     | `onProgress`                                 |
  | 看 action 耗时     | `loggerPlugin` 或 `analyzerPlugin`           |
  | 看通知是否真的发生 | 订阅里打点，注意 `notify.async` 的 tick 合并 |

## 11. 反模式清单

| 不要这样做                                                           | 为什么                                                                                                                                                                                                                  | 改用                                                                                                              |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 直接改 `getState()` 返回的嵌套字段                                   | 绕过保护、脏计数与缓存失效 → 「改了不更新」                                                                                                                                                                             | `setState` / `$patch`（或临时开 `stateProtection.deep: false`）                                                   |
| 在 getter / 选择器里写状态或发请求                                   | getter **没有任何结果缓存**，每次读取都重新执行一遍——副作用不是「被缓存吞掉」而是**每次读取都真的发生**（`mapGetters` 一轮渲染就是多次调用）；选择器一侧有缓存，把请求塞进去会让结果与请求次数脱钩                      | 写入放 action；请求结果写入 state 后由 getter 派生                                                                |
| `batch(async () => { await …; store.setState(…) })`                  | `await` 之后不受批保护，通知会逐条发出                                                                                                                                                                                  | 写入放 action 内，或用同步 `batch` 包住同步段                                                                     |
| 订阅回调里做数据转换                                                 | 同一份数据被反复计算                                                                                                                                                                                                    | 转换放 getter / 选择器                                                                                            |
| 用 `$replaceState` 做局部更新                                        | 未列出的键会丢失；缓存全量失效                                                                                                                                                                                          | `$patch`                                                                                                          |
| 把 `undefined` 写进要在 `setData` 里传输的字段                       | `setData` 不接受 `undefined`                                                                                                                                                                                            | 用 `null` 表达「空」                                                                                              |
| 传异步 storage 或**残缺后端**给持久化插件                            | 异步写入存在竞态与静默丢失；缺 `setItem` / `removeItem` 的后端会在安装期就被拦下（`TypeError`）。内置默认后端同样要求 `wx` 三方法齐备，残缺环境不再被当成可用后端（旧行为是每次落盘抛 `TypeError`），而是降级为内存存储 | `WxStorageBackend`（不传 `storage` 时即是它）或自封装、三方法齐备的同步实现                                       |
| 宿主卸载后仍留着挂起的防抖 / 节流调用                                | 定时器到点照样调用被装饰方法（常见后果：往已销毁的 Store 里写），期间宿主无法回收                                                                                                                                       | 在 `onUnload` / `lifetimes.detached` 调 `cancel*`（丢弃）/ `flush*`（立即执行一次）/ `dispose*`（取消并释放状态） |
| 用不写 `return` 的箭头函数当快照 `onError`                           | 判定按真值走，`undefined` ＝「拒绝继续」，纯观测会把整次快照做成失败                                                                                                                                                    | 显式 `return true`，或改用 `onProgress` 做观测                                                                    |
| 只传 `equalityFn: (a, b) => a === b`、不关快照                       | 状态无版本号时缓存的是**内容克隆**，与活引用永不相等 → 每次重算（memo 形同失效）                                                                                                                                        | 一并传 `snapshotState: false`，或改传带版本号的 Store 状态 / `cache: false`                                       |
| 给自定义深比较器配 `snapshotState: false`                            | 缓存活引用后两个实参是同一对象，深比较恒等 → 就地变异看不见，TTL 内返回陈旧值                                                                                                                                           | 保持默认 `snapshotState: true`（深比较器必须配内容快照）                                                          |
| 给装饰器方法期待同步返回（`createDecorator`）                        | 0.6.0 起同步方法不再被包成 `async`——反过来说，之前依赖它返回 Promise 的调用方现在拿到的是同步值                                                                                                                         | 同步方法按同步取值；异步方法照常 `await`                                                                          |
| 为省一行引入 `@openlide/geomstore/extras`                            | 全部可选能力进入模块图，走打包器的宿主主包变大；走微信「构建 npm」的宿主本就越过摇树，等于白花                                                                                                                          | 按需 `extras/<能力>`                                                                                              |
| reporter 里再写 Store / 再抛错                                       | 形成错误处理回路                                                                                                                                                                                                        | reporter 只做网络/日志，失败交给 flush 的重入队                                                                   |
| 用动态 operation id 做重试计量                                       | 退避策略失去意义，键数持续增长                                                                                                                                                                                          | 按「操作类型」命名                                                                                                |
| 断言里读私有字段（`errorQueue` 等）                                  | 改名后测试静默通过，问题被掩盖                                                                                                                                                                                          | 用公开 API 或测试缝；必读内部时写明成因                                                                           |
| 用 `getState()` 观察缓存命中率                                       | `getState()` / `store.state` 根本不查缓存，`hits` / `misses` 恒为 0，看着像「缓存完全没生效」                                                                                                                           | 读 `getCached(key)`，观测读 `getCacheStats()`；要失效用 `invalidateCache()`                                       |
| 把 `compareSnapshots` 的 `changed: true` 直接当成「内容确实变了」    | 失败 / 超时的快照也能产出这一条（`path: 'root'` 的整体差异），它的含义是**输入不可信**                                                                                                                                  | 先判 `inputTrusted`，为 false 时回上游重取快照或按「保守认为有差异」处理                                          |
| 拿 `snap.data` 里的 Map / Set 子类、TypedArray、`Error` 当隔离副本改 | 这些值 0.7.0 起**保留原引用**（此前重建出的是 `instanceof` 仍真却缺内部槽位的空壳），改它就串回活状态                                                                                                                   | 自行 `slice(0)` / 结构化克隆，或用 `customCloner` 给它们造真副本                                                  |
| 组合里某个子 store 被单独 `destroy()` 后继续按原样读整棵组合         | 该子店现在只贡献**空视图**（0.7.0 之前是 `getState()` / `$snapshot()` 直接抛、`state` 返回死店视图），合并结果里它的键会凭空消失而没有任何异常信号                                                                      | 显式判 `store.destroyed` / 从组合里摘除该店，并把那条一次性告警当错误处理而不是忽略                               |
| 给 `initBackgroundSync` 注册一个没有 `refreshData` action 的 store   | `refreshData` 是**按名字** dispatch 的隐式契约，缺失就是「切前台不刷新」（0.7.0 起会一次性告警、不再打「刷新状态」的假日志）                                                                                            | 提供 `refreshData`（通常委托自身的同步 action，`createUserStore` 已自带），或不要为该店注册后台同步               |
| 在冻结 / 不可写的属性上依赖状态保护与脏追踪                          | 这类属性现在拿到的是**裸引用**：读不抛了，但写不拦截、不标脏、不通知                                                                                                                                                    | 放可配置 / 可写的属性上，或整体 `setState` / `$patch` 替换                                                        |
| 为了覆盖率删除防御分支                                               | 降低了真实环境的健壮性                                                                                                                                                                                                  | 保留分支 + 带原因的 `istanbul ignore` 标注                                                                        |

## 12. 上线检查清单

- [ ] `NODE_ENV=production` 下无多余日志（插件安装等已静默）
- [ ] 只用到的 `extras/*` 被引入；无聚合入口引入；分包划分完成
- [ ] 映射粒度到具体字段，未整树映射
- [ ] 持久化后端为同步实现且三方法齐备（安装期校验会替你拦住残缺后端），`filter` 已收敛字段
- [ ] `onError` 钩子已接上报（持久化降级与恢复被跳过、监听器抛错、**订阅者被驱逐**、落盘 / 清理失败在生产只走这里）
- [ ] 高频 `subscribe` 路径核对过 `maxSubscribers`：它是硬上界，达限会挤掉最早的一份注册（重复订阅挤掉自己的那一份）并发一条 `onError`
- [ ] 带敏感数据的 action 已按需给 `withLog` 传 `redact` / `sink`（生产构建默认只输出摘要，`Error` 连 `message` 都不带；`redact` 之后仍会再过一层摘要，除非显式 `summarizeInProduction: false`）
- [ ] `ErrorMonitoring` 的 reporter 幂等、有超时；`maxQueueSize` / `maxFlushRetries` / `maxGroups` 按流量设定，看板读的是 `getAggregationStats()` 的 `evictedGroups` / `evictedErrors`（聚合有没有丢数据只在这里可见）
- [ ] 消费快照的代码已按 0.7.0 口径写过：`compareSnapshots` 先判 `inputTrusted` 再读 `changed`；没有就地修改快照里「保留原引用」的那类值（内建容器子类 / TypedArray / `Error` / `Promise` / 装箱对象 / 函数）；需要副本的走 `customCloner` 或自行克隆
- [ ] 注册了后台同步（`initBackgroundSync` / `createEnterpriseApp`）的每个 store 都自带 `refreshData` action——缺它就是「切前台不刷新」，而它只告警一次
- [ ] 状态树里没有「靠状态保护拦住写入」的冻结子树 / 不可写属性（这类属性拿到的是裸引用，不受拦截也不进脏追踪）
- [ ] 验证缓存是否生效用的是 `getCached()` / `getCacheStats()`，不是 `getState()`
- [ ] 组合层销毁子 store 后有显式存活判定（`store.destroyed`），没把「整棵组合还读得动」当成「所有子店都活着」
- [ ] `ErrorRecovery` 的 operation 命名稳定（不含动态 id）
- [ ] 页面 / 组件卸载后不再触发写入；订阅由集成层自动清理
- [ ] 被 `withDebounce` / `withThrottle` 装饰的方法已在 `onUnload` / `detached` 里收尾（`cancel*` / `flush*` / `dispose*`）——集成层不会替你清这些定时器
- [ ] `stateProtection` 保持开启
- [ ] 大对象的快照走异步并调过 `batchSize`；`success` 与 `errors` 已接入监控
