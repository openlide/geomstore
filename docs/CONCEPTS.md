# 核心概念

本文解释 GeomStore 的模型与设计取舍。接口细节见 [API.md](./API.md)，落地写法见 [GUIDE.md](./GUIDE.md)。

## 1. 状态（State）

- **状态是就地变异的活动引用**：`getState()` 返回的是内部状态的引用（或保护代理），`setState` / `$patch` / action 内的直接写入都作用在同一对象上。
- **推荐用工厂函数声明**：`state: () => ({ ... })`。工厂在创建 Store 时执行，避免数组 / Map / Set 等引用类型被多个实例共享。
- **需要不可变副本时用快照**：`$snapshot()` 返回深克隆后**部分冻结**的结构（纯对象与数组链上深度只读；经 Date / RegExp / Map / Set 或非纯对象触达的节点仍可变）；`$restore()` 从快照恢复。冻结范围只覆盖自有**可枚举字符串键**（数组按下标）——symbol 键（含状态版本号那个）、非可枚举自有属性、数组非下标自有属性指向的子对象都不在其中，这是与「冻结范围 ⊆ `deepCloneState` 隔离范围」配套的口径（那些键根本进不了快照），要 `Reflect.ownKeys` 口径请自行实现。
- **就地变异带来的推论**：引用相等不等于内容相等。缓存与通知判定都不能依赖 `===`，这也是下文「版本号」与「脏计数」存在的原因。
- **`setState` 的值按引用保存**：与初始化 / `$replaceState` 的深拷贝不同，Store 不接管调用方传入对象的归属——这是别名脏键与归属索引成立的前提（两者都按对象身份做可达性判定，写入时换一份克隆等于把「同一对象被多个顶层键引用」从状态图里抹掉）。代价是：调用方在 `setState` 之后再改它传进来的那个对象，Store 不察觉（无计数、无脏键、无钩子、缓存里就是同一引用）。要「写入即定格」请改用 `$patch`（补丁里的纯对象只在目标位置同为纯对象时逐层就地合并，其余分支一律换成克隆副本——但克隆本身按「不可安全克隆的值保留原引用」的口径工作，类实例 / Error / 字节缓冲等仍会与补丁共享引用，见 [BEST_PRACTICES](./BEST_PRACTICES.md) 的 `deepMerge` 说明），要可安全持有的副本请读 `$snapshot()`。
- **原型链敏感键按「自有数据属性」承载**（0.7.0 变更）：`__proto__` / `constructor` / `prototype` 这三个键名在 `setState` 上走 DefineOwnProperty，与 `deepMerge` / `$patch` / `$replaceState` 同一份判据。变化是方向性的：`setState('__proto__', { inj: 1 })` 此前触发 `Object.prototype` 上那个 `__proto__` setter，**把整个状态对象的原型换成入参**——注入的键此后经任何缺失键都读得到（`state.isAdmin` / `state.token` 凭空出现）、状态对象的 `isPlainObject` 判定从此为假、深比较与它自己的克隆体恒不等（选择器持续失配）；现在它只是状态上的一个自有数据属性，原型不动、注入键不再经原型链可见。另一半同样在这一条里收口：值不是对象时那个 setter 按规范静默丢弃，此前仍会推进变更计数、标脏、发通知（一个什么都没改的写入被记成一次成功变更）——敏感键的相等性判定现在按**自有描述符**取值，因为 `state.__proto__` 的 `[[Get]]` 返回的是原型而不是你写进去的值。状态键可以合法地叫 `__proto__`（本库多处专门为此写了 defineProperty 守卫），这一条不把它判成非法输入。

## 2. 通知（Notify）

一次写入到监听器收到回调，中间有三层可配置语义：

| 配置                  | 作用                                                                                                                                                                                                                                                              | 默认           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `notify.clone`        | 通知时是否深拷贝载荷。**未配置与显式 `false` 同义（自动）**：仅当存在可写注册时拷贝——每个可写注册各一份、只读注册共用一份；全部注册只读时零拷贝（状态保护开启给只读保护 Proxy、关闭给原始引用）。显式 `true` 强制拷贝，即使本轮只有只读注册（那时是共用的那一份） | 未配置（自动） |
| `notify.async`        | 微任务合并：同一 tick 内多次写入只通知一次                                                                                                                                                                                                                        | `false`        |
| `notify.onlyOnChange` | dispatch / batch 期间未检测到写入则不通知（依据变更计数，非内容深比较）                                                                                                                                                                                           | `false`        |

- **监听器只接收新状态**：`StateListener<S> = (state: S) => void`；需要前后对比请在闭包里自行保存。
- **只读订阅**：`subscribe(listener, { readOnly: true })` 声明不写入状态。载荷形态据此**按注册**决定：全部订阅者只读时免深拷贝（开启状态保护则收到只读保护 Proxy，关闭时是原始引用，回调需自行保证不写）；一旦存在可写注册，每个可写注册各拿一份独立深拷贝、只读注册共用一份——先执行的可写回调就地改载荷，不会再让同一轮里后面的监听器读到半成品。份数由 `maxSubscribers` 封顶，不随重复注册无界扩张。页面 / 组件 / App 的映射订阅本身就是只读注册。
- **dispatch 的通知去重**：异步 action 的通知在**两个时点**各补发一次（0.7.0 变更，此前只有 settle 那一轮）——**同步段结束时当场补发一次**，`await` 之后的续段在 settle 时再补发一次。为什么必须有第一处：Store 侧的写入抑制是硬开关（`setState` / `$patch` / `$replaceState` 都看「是否在 dispatch 中」），而 action 返回的 promise 可能**永不 settle**（等用户交互才 resolve、请求无回调也不 reject、超时未 reject），只挂 settle 时同步段那一格变更要等到「下一个不相干的通知」才顺带补发——`dialogVisible = true` 得等对话框关掉之后才可见（而它根本没显示出来）。可见后果：默认模式下「同步段有写入且最终 settle」的 action 通知数由 **1 变 2**（按通知打点的宿主要把期望改过来），`notify.onlyOnChange` 按变更计数自动去重、仍是一次；同步段没写入不多刷、`batch` 期间不提前通知。嵌套 dispatch 仅最外层通知；dispatch 与 batch 交叉时由 batch 收尾统一通知。通知收尾链路自身抛错（补刷缓存、emit 钩子）不再变成 `unhandledRejection`，而是转投 `onError`；订阅回调抛错同样在生产经 `onError` 上报（控制台仍静默），单个坏订阅者不影响其余监听器。
- **订阅有上限**：`maxSubscribers` 是**硬上界**，门禁对每一次注册生效（含同一监听器的重复注册）。达上限时按策略处理：`throw` 抛错；`evict-oldest` 驱逐一份最早注册（本次是重复注册就让位该监听器自己最早的一份，否则驱逐全局最旧的一份），并**向 `onError` 钩子发一次 `Error`**（第二参 `'subscribe'`；此前生产完全静默、被挤掉的订阅者无从定位）。每个退订句柄幂等，重复调用同一句柄不会退订其他注册。
- **两条通知通道对「迭代中退订」的口径不同**：同步通道（`SubscriptionManager`）按**进入本轮时在册的快照**派发，回调内退订自己、或本轮驱逐掉的最旧注册仍会收到这一次；`notify.async: true` 走的微任务合并通道（`AsyncBatchNotifier`）在 flush 时逐个复核在册状态，**已退订或被 `clear()` 摘除的监听器不再收本次回调**（它的下游是「状态变化 → 渲染 / 清理」，退订即表示处理方已失效）。依赖「退订立即生效」请在回调里自判存活标记。
- **Action 脏跟踪始终启用**：默认模式与 `onlyOnChange` 模式都通过可写代理记录对象 / 数组 / Map / Set 的直接变异，标记所有受影响的顶层键；异步 action 的脏键累积到通知时。`onlyOnChange` 额外依据变更计数跳过无写入的通知，并非前后内容深比较。
- **别名与边界**：同一对象复用同一代理；归属关系索引（对象 → 可达它的顶层键）增量维护——新增边只把容器归属键并入新子树（可剪枝），标量写入 O(1) 查表，删边类写入（覆盖已有对象值、`delete`、`Map` / `Set` 删除）与外部版本推进退化为全量重建，可识别未读取的别名、循环与重新挂接，构建与查找都不求值访问器。类实例与类型化数组同样被代理：实例属性写入与数组元素写入正常标记；实例方法调用保守标记所属键（方法内部的写入无法精细归因），读取时方法绑定到原始接收者，`#private` 字段与内部槽位可用。Date/RegExp/WeakMap/WeakSet 仍保留原引用、内部变异不跟踪；`$patch` 就地改写被其他顶层键引用的对象时，这些键一并标记。**集合代理的成员白名单**：只有确定会改集合结构的成员（`add` / `delete` / `clear` / `set` 一类）走拦截；白名单之外的（ES2025 的 Set 集合方法 `union` / `intersection` / `difference` / `symmetricDifference` / `isSubsetOf` / `isSupersetOf` / `isDisjointFrom`、`class Bucket extends Set` 的自定义方法）以**原始集合为接收者**返回（绑到代理会 `Method Set.prototype.union called on incompatible receiver`），因此**不计入脏跟踪**——给纯读方法一律补一次上报会让 `union` 每调一次就把所属顶层键标脏、白刷一轮 `setData`。子类自定义方法若真的改集合结构，属本文件已声明的契约外写入，由「解析不出归属即标记全部顶层键」兜底（多报不漏报）。需要精确脏信号请走受控写入 API。

## 3. 状态保护（State Protection）

`stateProtection` 开启后，状态访问经代理拦截写入、删除与 `Object.defineProperty`：

- **保护与脏跟踪分工**：深层对象、浅层对象与数组代理负责外部写入保护；Action 使用独立的可写脏跟踪代理。深层保护下数组的索引 / symbol / 自定义属性上的对象值经缓存包装
- **非法变更抛错**：越过 `setState` / `$patch` 直接变异会抛错（开发模式给出可读路径），错误消息对 BigInt / 循环引用值安全
- **`deep: false` 只保护顶层**：嵌套对象不再被包装（性能优先）
- **配置在构造期就要合法**：`stateProtection.productionHandler` 只接受 `'error' | 'warn' | 'silent'`，越界取值让 `createStore` 当场抛 `TypeError`，而不是留到很远的一次状态写入才以别的面目失败
- **保护层不抛 ≠ 底层写得进**：目标被 `Object.freeze`、属性不可写或不可配置时，`Reflect.set` 返回 false、严格模式下那次赋值照样抛 `TypeError`（不可配置又不可写的自有数据属性上，Proxy 不变量不允许谎报成功）。要判可写请显式 `Object.isFrozen`
- **自有不可写 / 不可配置的数据属性：拿到裸引用、不受保护也不再抛错（0.7.0 行为变更）**：Proxy 的 `[[Get]]` 不变量要求这类属性原样返回该值，所以调用方拿到的是**裸对象**（不是保护代理），之后对它的写入不标脏、不推版本、不通知、也不被写保护拦截——把该状态放在可配置 / 可写的属性上，或经 `setState` / `$patch` 整体替换。**变化在前半段**：深保护代理与数组代理此前无条件把对象子值包成 Proxy，于是**读取本身**就会抛 `TypeError: 'get' on proxy: property 'x' is a read-only and non-configurable data property on the proxy target but the proxy did not return its actual value`；触发来路很常见——`setState('user', otherStore.$snapshot().user)`（`$snapshot` 是深冻结的）、`setState('cfg', Object.freeze({ inner: {...} }))`、往状态里放任何 `defineProperty(writable:false, configurable:false)` 的节点，而 `stateProtection` 默认就是 `deep: true`，开发与生产同样抛、报错文本还不指向「冻结」这个根因。现在深代理与数组代理（symbol 键 / 数字索引 / 附加自有键三处）在包装前先兑现这条不变量、原样返回裸引用，判据与 `dirtyTracking` 早就写着的那条形同豁免一致。**代价要说清**：这类属性此后不受写保护——它不再是「读不到」而是「读得到但没人管写」。
- **读方法是缓存的**：保护代理上同一 (宿主, 键) 多次读取返回**同一**函数引用（此前每读一次 bind 一个新的，按引用相等做记忆化 / 依赖比较的调用方每次读都以为实现换了）；方法被整体替换后返回新实现的绑定。有一处**有意的保护豁免**：方法绑定到**原始接收者**，所以方法体内部的写入不经保护、也不进脏追踪
- **根状态是数组时走数组代理**：与嵌套数组同一套行为，错误路径形如 `[0].v`（浅保护不改道，其契约就是只保护顶层）

## 4. 版本号（stateVersion）

每次状态写入都会推进一个内部版本号，`getStateVersion(state)` 可读取。

- **用途**：选择器缓存同时校验**状态对象身份与版本号**（O(1)），不做全树比较。不同 Store 独立计数，版本号相同也不能跨状态对象误命中。
- **回退路径**：状态不带版本号（例如直接传入的普通对象）时，选择器改比**内容**——写缓存时先深克隆一份状态，命中判定用 `equalityFn(快照, 当前状态)`（默认 `deepEqual`），因此就地变异能被感知。这条凭证是显式选项 `snapshotState`（默认 `true`）：只有引用相等的比较器（`(a, b) => a === b`）才需要 `snapshotState: false` 换掉那趟克隆，否则克隆体与活引用永不相等 → 缓存永不命中。`createParametricSelector` 没有可注入的比较器（state 侧写死 `deepEqual`），也就没有这个选项。

## 5. 缓存（Cache）

`enableCache(keys?)` 打开 Store 内置缓存（`keys` 省略表示全部顶层键），`getCached` / `invalidateCache` / `getCacheStats` 分别用于读取、失效与观测。

- **它是「写穿」而不是「失效」**（这一条最容易读反）：`setState(key, value)` 与 `$patch` 在写状态的同一步里把新值**写进**缓存条目，既不清条目也不算未命中——所以「写完再读会重新计算」不成立，下次 `getCached(key)` 仍命中且拿到新值。真正的失效入口只有 `invalidateCache(key?)` 与 `$replaceState`（整表清空后按新状态回填）。
- **`getState()` / `store.state` 不查缓存**：它们直接返回活动引用 / 保护代理，不产生任何 `hits` / `misses`。这条路径连续读一百次，`getCacheStats()` 仍是 `hits: 0 / misses: 0`；缓存的**唯一**读取入口是 `getCached(key)`（`enableCache()` 本身只做开关 + 清旧条目 + 预填，同样不计命中）。小程序集成层的 `autoInject` / `autoUpdateOnShow` 走的就是 `getCached`，所以页面绑定路径下缓存是真在生效的，不必自己手写读取。
- **刷新时机**：受控写入更新对应缓存；dispatch 收尾及异步结算时按状态源强制回写（这一步同时兜住 action 内绕过 API 的直接变异），并移除已被 `delete this.state.key` 删除的条目；`$replaceState` 清空整表后按新状态回填
- **按需开启**：`cacheConfig.enableStats` 采集命中统计有额外开销；只缓存高频键（如长列表）收益最大
- **配置归一**：`cacheConfig.ttl` 只接受**有限非负**数值——`NaN` / `Infinity` / `-Infinity` / 负数一律归一为 `0`（＝不过期）并打一条开发期告警，合法的 `0` 与正数原样保留、不告警。此前这些非法值靠「`> Infinity` / `> NaN` 恒 false」意外得到永不过期，算错的配置无声吞掉
- **LRU 工具**：核心另导出 `LRUCache`（容量淘汰 + TTL），供需要独立缓存策略的场景使用。容量默认 100、非有限值回退默认、小于 1 夹到 1，小数不取整（淘汰判据是 `size > capacity`，故 `2.5` 的等效上限是 2 条）；`getStats().evictions` 的契约是 **`onEvict` 触发次数**（`clear()` 这类配置性清空同样计入），不是「因容量上限被挤出的条目数」，需要后者请在清空前后各读一次求差

## 6. 快照（Snapshot，`extras/snapshot`）

**隔离契约（0.7.0 收窄为「只丢克隆不出来的东西」）**：克隆失败的节点会被丢弃，绝不把原值兜底进失败结果。但「克隆不出来」在两处**改为保留原引用**（不再重建、也不再丢弃），判据与核心 `deepCloneState` 合流为同一份实现：

- **内建容器的子类实例**：`Map` / `Set` / `Date` / `RegExp` / `Array` 的**子类**（`class MyMap extends Map`）。此前快照用 `new Map()` 重建，丢掉子类的构造参数、自有字段与子类方法（`snap.data.m instanceof MyMap` 为 false，调 `m.first()` 直接 `TypeError`）；现在保留原引用。门槛是「原型恰好等于该内建类型自己的 `prototype`」，跨 realm 的实例同样走保留。
- **状态住在内部槽位里的内建值**：`Promise`、装箱原始值（`new Number` / `new String` / `new Boolean` / `new Symbol` / `new BigInt`）、`ArrayBuffer` / `SharedArrayBuffer` / `DataView` / 全部 TypedArray、`WeakMap` / `WeakSet`、`Error`、函数与生成器。此前落进通用分支被重建成 `Object.create(原原型)` + 自有可枚举键的**空壳**——`instanceof` 仍为真却没有内部槽位，消费方第一次用就抛（`await snap.data.p` 没有 `then`、`Number(snap.data.n)` 要 `[[NumberData]]`、把空壳字节缓冲交给宿主 API）；`Error.message` 本身不可枚举，空壳连消息都丢。现在一律保留原引用（判据用 `Object.prototype.toString` 的 tag ∪ `ArrayBuffer.isView`，跨分包 / 多运行时下的 Promise 也认得）。
- 附带消掉一个隐案：两副空壳原型相同、`Object.keys` 同为空，`compareSnapshots` 对 `new Number(1)` vs `new Number(2)` 恒报 `changed: false`（值差异在克隆阶段就没了）——现在两侧都是同一个实例，比较口径见下。
- **代价**：这两类值与活状态**共享同一引用**，「快照即隔离」对它们不成立（改 `snap.data.myMap` 会串回活状态）。**`customCloner` 是宿主对象的兜底出口**；没有内建 tag、状态也不在自有可枚举属性上的宿主对象（自定义 native 包装、部分 `wx` 返回值）仍识别不到，会被重建为空壳，请提前接管。类实例（原型是普通类）仍是既有契约：**重建为同类实例**，方法 / 继承链可用、不触发构造器与 getter。
- 数组上的**附加自有键**（`arr.meta = 'v2'`）现在会被克隆（此前只按下标逐项克隆、这类键整体丢失，后果是快照少字段 + `deepEqual(snap.data, state)` 由命中变失配 → 选择器缓存持续失配）。数组**空洞**落成 `undefined` 元素仍是声明过的跨路径统一取舍。
- `includeNonEnumerable: true` 带进来的属性在克隆产物里**一律是可枚举的**（`writable` / `configurable` 仍按源还原，只有这一位故意改写）：此前它们被按源还原成 `enumerable: false`，于是「包含」二字没有任何下游读者——不进 `Object.keys`、不进 `JSON.stringify`、也不进 `compareSnapshots` 的键集比对（它两侧都按 `Object.keys` 取键），状态上挂的不可枚举版本号 / 计数标记变了也报 `changed: false`。现在该选项的语义是「带进来并且读得到」。

同步引擎与异步引擎是同一段判据的两份实现，**两条路径同时生效、不存在第二套答案**。

其余仍成立：函数按引用直返（无内部状态，共享无副作用）；循环引用按位置写 `'[Circular Reference]'` 占位；任何无法安全克隆的节点（`onError` 判「拒绝继续」）一律丢弃，绝不把原值兜底进快照——对象属性不写、数组留洞、`Set` 不加元素、`Map` 跳过整条 entry、根节点被丢弃时 `data` 为 `undefined`。异常或中止时交付的 `data` 是 `undefined`，不是调用方的原始对象。

- **错误账本 + 降级策略**：每个节点失败都会落账 `cloneError`。`onError` 按**真值**解释（判定写法是 `if (!shouldContinue)`）：truthy 忽略该错误并按种类降级，falsy（含不写 `return` 的 `void` 写法）拒绝继续——`cloneError` 下抛 `SnapshotAbortError`、整次 `success: false`；`circular` 下只在该位置写 `'[Circular Reference]'` 占位并继续（快照仍可 `success: true`）。纯观测请显式 `return true`。`errors` 是**完整账本**：`circular` 先入账、再用同一条记录去咨询 `onError`，`maxDepth` 超限也落一条 `maxDepth` 错误，不再只体现在 `stats` / `metadata` 里。只有 `cloneError` 参与 `success` 判定，故 `success: true` 且 `errors` 非空是合法状态；失败必然带原因。
- **同步 / 异步**：同步实现是**递归**深克隆（栈深＝数据深度），深度上限是 `maxDepth`（默认 100）与一个与选项无关的栈安全硬上限 `HARD_MAX_CLONE_DEPTH = 1000` 的较小值——把 `maxDepth` 抬高不再等于放任调用栈溢出（此前是 `RangeError` 伪装成某个属性的 `cloneError` 且整次失败），`maxDepth` 传 `NaN` / `Infinity` 也落到硬上限；异步实现按 `batchSize` 分片、走任务队列不占调用栈、批间让出控制权，适合大对象并支持 `onProgress`。`onProgress` 抛错被就地兜住（落一条 `unknown`、不影响 `success` 与克隆结果），`onError` 作为决策回调仍会让整次快照失败。
- **其他维度**：`maxDepth` 超限返回占位符（不返回活引用）、循环引用检测始终生效（`detectCircular` 只控制是否上报）、访问器属性以 getter 求值结果克隆、类实例保留原型、函数按引用共享（无内部状态，共享无副作用）、`metadata.nodeCount` 两条路径同口径（实际进入克隆的节点数）。被 Proxy 包装过的 Date/RegExp/Map/Set 在类型判定处抛错时同样按节点落账并咨询 `onError`（异步路径）。
- **自定义克隆器**：两条路径共用同一套抛错语义（落账 → 咨询 `onError` → 继续则丢弃 / 中止则抛 `SnapshotAbortError`）。
- **差异比较**：`SnapshotManager.compareSnapshots` 按活动对象对识别循环，共享子对象仍在各路径比较；自有 `undefined` 属性的新增 / 删除与键缺失不同，分别报告 `kind: 'added' | 'removed'`。`Map` 键与 `Set` 元素的无序配对共用同一实现与同一套护栏：预算按**结构比较次数**计（不是按项数），超预算才退化为整体差异；结构配对一律以无限深度预算调 `deepEqual`，故超深的等价键不会成对误报「一删一增」；原型不同的对象在任意深度都判为有差异。Date / RegExp / Map / Set / 装箱原始值按**内容**比较（`compareSnapshots({n:new Number(1)},{n:new Number(2)})` 现在报 `changed: true`，此前恒 `false`；同一引用仍短路）。
- **`SnapshotDiff.inputTrusted`：把「输入不可信」与「确有差异」分成两件事**（0.7.0 新增的必填字段）：`compareSnapshots` 此前是全库唯一不要求调用方先判 `success` 的 `SnapshotResult` 消费方，而失败快照的 `data` 按契约是 `undefined` 或超时半成品，于是同一入口给出方向相反的两个假结论——两侧都失败时 `data` 同为 `undefined`、被 `===` 短路成 `changed: false`（「两份都不可用」被报成「两次快照无差异」，据此做回滚判定 / 去重的调用方直接跳过回滚）；两侧都是半成品时真实差异恰好落在「两侧都不存在的键」上，同样静默漏报。现在任一侧 `success: false` 就不逐路径比对，交付一条 `path: 'root'` 的整体差异、`changed` 恒 `true`、`inputTrusted` 为 `false`。**读法：先看 `inputTrusted`，为 false 时那条 changed 不代表内容真的变了**（做回滚 / 去重时应按「保守认为有差异」处理或回上游重取）。该字段刻意保持必填：`SnapshotDiff` 只由库产出，声明「一定带这个字段」比可选更诚实，代价是自己构造该对象字的调用方要补一项。
- **`Map` 条目路径按「键身份」而不是迭代下标**（0.7.0）：值差异 `root[<String(key)>]`、键增删 `root.key[<String(key)>]`，与克隆引擎给 `errors[].path` 用的同一套 scheme。此前同一个路径串承载两种事实（`root.key[1]` 既可能是「1 号条目的值变了」也可能是「1 号键被移除」，只有 `kind` 能分流），且下标随插入顺序漂移、同一个逻辑键在两次快照里路径不同，path 无法当条目身份用、`result.errors` 与 `diff.changes` 也对不上同一条目。`Set` 的增删条目路径**仍是报告序下标**，那不是身份。
- **不要混淆时间旅行契约**：`timeTravelPlugin.getSnapshots()` 使用核心 `deepCloneState` 克隆支持的普通对象 / 数组 / Date / RegExp / Map / Set（支持循环引用）；类实例、函数、Promise、WeakMap 等保留原引用，不能宣称与 extras 快照一样完全隔离。

## 7. 选择器（Selector，`extras/selector`）

- **创建形式**：`createSelector(单个选择器函数, 选项?)`；`createMemoizedSelector` 是携带自定义相等函数的便捷包装；多步计算请在函数体内完成
- **参数化选择器**：`createParametricSelector(fn, { ttl, maxEntries })` 按参数分别缓存，注意 TTL 与容量上限（`ttl: 0` 表示立即过期，等同禁用缓存）。`maxEntries` 走归一化（`0` / 负数夹到 1、`NaN` / `Infinity` 回退 1000、小数向下取整），`ttl` **刻意不归一**——读侧判据是 `timestamp + ttl > now`，`0` / 负数 / `NaN` 都只是「立即过期＝不缓存」，没有 `cacheTTL` 那种「永不过期 → 返回陈旧值」的劣化。函数参数与对象参数同样走 WeakMap（不受强引用侧的容量淘汰，也不额外钉住闭包作用域）；状态侧传 `null` / 原始值时降级为「每次重算、不缓存」而不是抛错
- **组合与重试**：`SelectorComposer` 提供异步与重试形态；重试错误带不可枚举的 `attempts`（真实执行次数，嵌套重试时取两者之大、只增不减），喂给 `shouldRetry` 的是规范化后的 `Error`（`throw 'str'` 被包成 Error），而**抛给调用方的仍是原始值**；异步组合每次调用返回的 Promise 都必须 `await` 或挂 `.catch`，库不代为吞掉 rejection

## 8. 错误处理（`extras/error`）

- **错误模型**：`GeomStoreError` 携带错误码与上下文，派生出 `ActionError` / `StateError` / `SelectorError` / `PluginError` / `ComposeError` / `ValidationError`，并有对应的 `is*Error` 守卫。构造器接受可选的 `cause`（第 5 参，派生类第 4 参），`toJSON()` 只在提供时多一个 `cause` 键；`toJSON().context` 是**可 JSON 化的等价结构**而非入参逐字拷贝（循环引用 → `'[Circular]'`、BigInt → `'123n'`、取值即抛的访问器 → `'[Unreadable]'`、超 `6` 层 → `'[Truncated]'`），构造期也早已把 `context` 浅拷贝一份，调用方事后改入参不影响已捕获现场
- **边界（ErrorBoundary）**：默认 fail-loud——未配置 `fallback` 时错误重抛；提供 `fallback` 即视为声明恢复意图，`fallback` 函数自身抛错会重抛**原始错误**（不丢失现场）。非 `Error` 的抛出值在入口归一化后再记账与传给回调，重抛时仍是原始值；显式 `recoverable: true` 而无 `fallback` 时返回 `undefined`。`@withErrorBoundary` 只对**被包裹方法的原始返回值**做 thenable 判定：回退值即使自带可调用的 `then` 也不会被 await，返回形状不会从 `X` 悄悄变成 `Promise<X>`。`ErrorHandler` 的异步 handler 返回的 Promise 也有一条兜底出口（rejection 折成一条 `[ErrorHandler] Error in error handler:` 日志，不再是无人接的拒绝），交给用户 handler 的上下文是**副本**
- **恢复（ErrorRecovery）**：策略含 `RETRY` / `FALLBACK` / `IGNORE` / `RECOVER` / `RESTART`；重试额度按**故障周期**计量（时间窗 = `max(60s, 本周期退避总时长 × 2)`），并有键容量守卫防动态 operation id 导致的无界增长。**额度用尽后不会重置**——抛 `Max retries exceeded` 时保留计数与周期窗，同一故障周期内的后续 `recover()` 持续被拦截，只有时间窗过期才开新周期。策略内部失败（含额度耗尽、无回退可返回、无 `recoverFn`、未知策略）统一抛 `GeomStoreError`（`code: INTERNAL_ERROR`、带 `cause` 与 `context`，`context.retryKey` 指明是哪一份额度；`storeName` 与 `operation` 都缺时键名为 `<code>:unattributed`，只缺一个维度时按已报出的维度隔离）。`recover()` 的受控字段（`error` / `config` / `attempt`）由库内写入，调用方上下文无法覆盖实际执行的策略与重试记账键。
- **监控（ErrorMonitoring）**：批量 flush 对每个 reporter 做 `ok / fail / timeout` 三态判定；仅真正 resolve 才算成功（`reportTimeout <= 0` 表示不超时）；全部失败则按序重入队重试，连续失败超过 `maxFlushRetries` 丢弃该批并告警（避免永久失败批次空转）。容量类入参走下限裁剪（`maxQueueSize` 最小 1、`maxFlushRetries` 最小 0，非有限值回默认），`clear()` 除复位连续失败计数外还给在途 flush 打**代际标记**——旧批次不再回流队列、也不会把失败计数从无拨成 1。溢出被丢弃的条数是可消费指标：`getDroppedErrors()` 与 `generateReport().summary.droppedErrors`；它与 `summary.totalErrors`（观测到的错误数）、`summary.queuedErrors` 是三个互不重叠的口径，**不能相加核对**。聚合组对外一律给副本（`getGroups()` / `addError()` / `getErrorGroups()` / `generateReport()`），改它们不再污染内部账目。聚合统计与错误组是**两套口径**（0.7.0 分家）：`totalErrors` / `byCode` / `byStore` 按条独立累计、自上次 `clear()` 起单调不减，恒有 `sum(byCode) === sum(byStore) === totalErrors`，`maxGroups` 驱逐**不让它们倒退**（此前它们由「存活组求和」现算，于是两次报告之间的错误总数会随驱逐**变小**，与「观测到的错误数」这个声明正好相反）；`totalGroups` / `getGroups()` / `summary.topErrors` 仍只是**当前存活组**的视图，会随驱逐变小。两者的差额看得见：`getAggregationStats()` 新增 `evictedGroups` / `evictedErrors`，`clear()` 把两套账与留痕一起归零。`MonitoringConfig.maxGroups`（0.7.0 新增，缺省 100）是同时存活组数的上限，达上限按「最近最少出现」驱逐旧组（首次出声一次），非有限值回退缺省、有限值 `Math.max(1, floor(v))`。组内样例是不含 `payload` 的浅拷贝并随命中刷新，避免进程级缓存钉住 store / 页面节点。指纹 → 组 ID 由反向索引维持，哈希碰撞的邻居组被驱逐后同一指纹仍并入原组、计数不重置。`affectedStores`（单组 50）与 `byStore`（全局 200 键）都有基数上限，超出并入保留字 `__others__` 溢出桶——截断的是「列得全不全」，条数一条不丢。

## 9. 插件（Plugin）

- **契约**：`{ name, install(store) }`，`install` 返回卸载函数（`store.use(plugin)` 返回同一函数）
- **钩子**：插件通过 `store.hooks.on/emit` 接入 `beforeDispatch` / `afterDispatch` / `beforeSetState` / `afterSetState` / `beforePatch` / `afterPatch` / `beforeReplaceState` / `afterReplaceState` / `onError` 等生命周期。处理器的形参与 `emit` 的实参在类型层按**钩子名**关联（写错个数 / 顺序即编译错误）。`on()` 返回的退订句柄是**一次性**的：第二次调用是 no-op，`on → off → on → off(旧句柄)` 不会把新那次注册摘掉。`emit` 逐个 `try/catch`：单个处理器抛错不影响其余处理器、也不传播给 `emit` 调用方，先 `console.error` 再转投 `onError`（`onError` 自身抛错只落日志、不递归）；需要让异常冒泡到业务方请走 action 的错误边界。`emit('onError', error, source)` 的第三参在**同步 dispatch 中止**那条路径上是 `'dispatch'`（性能插件据此作废本次进行中的计时），其余失败发射不带来源。
- **安装安全**：`install` 抛错时回滚入列，不会残留半安装条目；生产模式下安装/卸载日志静默。在**已销毁**的 Store 上调用 `usePlugin(plugin, store)` 现在把 `store.use` 抛出的异常原样冒泡（该降级只罩住「插件自身安装失败」这一类）

## 10. 组合（Compose）

- **命名空间**：`composeStore([a, b], { namespace: true })` 下子 store 按 `name` 嵌套，dispatch 使用 `'storeName/actionName'`；合并的 `actions` 注册表也支持外层组合路由嵌套组合的裸名 action（非命名空间模式同名取第一个 Store）。**`name` 在这里同时是路由键**，因此构造期一次性校验：命名空间模式下名字为空串或含 `'/'` 直接抛错（此前 `createStore({ name: 'user/info' })` 是「读得到写不进」——路径 `'user/info/count'` 被按首段解析成 store `user` + 键 `info/count`，该子店在 `setState` / `getCached` / `dispatch` / `getter` 上永远路由不到）。平铺模式不用 `name` 路由，同样只开发模式告警。名字为 `'__proto__'` 是合法的（映射按 DefineOwnProperty 承载）。**`ComposeOptions.lazy` / `tree` 与 `NamespaceConfig` 是「已声明、未实现」项**：仍在公开类型面上，但运行时零消费方（构造只读 `namespace` / `strict`，分隔符硬编码 `'/'`），写了编译通过、静默无效，别按它安排懒加载与前缀策略
- **子 store 在组合之外被独立销毁 = 读空视图，不再读崩**（0.7.0 行为变更）：这一层容错此前只做在写路径（`$patch` / `$replaceState` / `startBatch` / `endBatch` 都是「已销毁即跳过 + 一次性告警」），读路径整体裸奔——`composed.getState()` 与 `composed.$snapshot()` 每次调用都抛 `Cannot call getState on a destroyed Store`，于是**一个子店销毁就让整棵组合读不出来**（集成层渲染 / computed 热线直接崩），而 `composed.state` 因 `Store.state` 无守卫反而返回死店视图、同一时刻 `$patch` 还能「正常」跳过该店写入，三条读路径口径互斥。现在三条读路径的取值统一过同一个容错包装：该子 store 按**空视图**并入、按 store 去重**告警一次**，其余子 store 照常可读；平铺模式的键归属判定不再对死店调 `getState()`，合并缓存的版本校验把「已销毁」编成哨兵值，免得死店此前并入的键被当作新鲜数据继续读。**读写从此同一口径**。要判存活请显式读 `store.destroyed`——「读得到」不再等于「还活着」
- **合并缓存**：`getState()` / `state` 读取前校验子 Store 版本，批内或异步通知尚未发出时也保持新鲜；无版本号的子 Store（含嵌套组合）每次读取保守失效
- **嵌套内层**：非命名空间外层包含命名空间内层时，其子 store 的键为「子 store 名/键」，写操作需用完整斜杠路径（构造期开发模式提示）。该归属判定只看数据形状，与 `$replaceState` 的丢键告警开关无关——同一份写入在开发与生产走同一分支
- **脏追踪**：命名空间模式下 `isStateKeyDirty` 精确判断子 store 是否变化，集成层据此跳过未变化的 `setData`；通知回调内的重入写入留给下一轮（本轮收尾只作废本轮脏键）
- **订阅复用**：组合层 N 个监听器只占用每个子 store 一份订阅；子 store 的订阅按只读注册，因此通知路径免深拷贝
- **只读化**：`composed.state` 顶层冻结，嵌套经子 store 保护代理，写入不会穿透
- **批量写入的原子性**：命名空间 + `strict` 的 `dispatch` 先完成全部查找与校验再统一写入——要么全写、要么一个都不写，不再留下「前一半已落库」的中间态；已销毁子 store 抛出的**非销毁类**异常（不是「Cannot call … on a destroyed Store」那一类）也不再被吞掉，向调用方冒泡
- **注册表（`StoreRegistry`）**：同一实例可用多个名字登记。`unregister(name)` 与同名覆盖会摘掉该实例的**全部**别名并只 `destroy()` 一次（此前其余名字继续返回已销毁实例）；`destroy` 回调里重入登记同名时，重入的那个实例照常退场，返回后 `get(name)` 一定是本次注册的实例；缺 `destroy` 的鸭子类型实例不再以 TypeError 收场。`clear()` 的契约是「进入本方法时在册的条目全部注销」，清理过程中重入 `register()` 新增的条目会保留（`size()` 因此可以不为 0）

## 11. 批处理（Batch）

`batch(fn)` / `startBatch` / `endBatch` 期间合并通知，结束时统一发一次；batch 会记录变更计数基线，`onlyOnChange` 下期间无变更则不通知。

> 注意：`batch(fn)` 传入**异步回调**时，`await` 之后的变更会逐条通知（批保护边界只在同步段有效），开发模式下会显式告警。

## 12. 一条写入的完整链路

以 `store.setState('count', 1)` 为例：

1. **保护代理**判定为合法写入（经 setState 而非直接变异）
2. 写入状态并**推进版本号**，脏计数 +1
3. **缓存写穿**：`count` 的缓存条目被**更新**为新值（不是失效），下一次 `getCached('count')` 仍命中并读到新值；`getState()` 全程不查缓存
4. 触发 `beforeSetState` / `afterSetState` 钩子（插件与监控在此接入）
5. 依据 `notify.async` 决定立即通知或合并到微任务；`notify.clone` 与「本轮有没有可写注册」共同决定载荷形态（可写注册各一份克隆、只读注册共用一份，全只读时零拷贝）
6. 监听器收到新状态；`isStateKeyDirty('count')` 为 true，集成层据此更新 `setData`
