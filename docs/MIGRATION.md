# 迁移指南

本文按版本倒序列出**会影响调用方**的变更。完整变更记录见 [CHANGELOG](../CHANGELOG.md)。

> 版本约定：`0.x` 阶段的行为契约变更会显式标注「Breaking」并给出迁移代码；仅「新增可选项」之类的纯增量不在此列。

**直接跳到你那一档**（多数升级只需看目标版本那一节；跨多个 minor 的请把中间各档的「需要改代码」都读一遍）：

[0.7.0](#升级到-070) · [0.6.0](#升级到-060) · [0.5.1](#升级到-051) · [0.5.0](#升级到-050) · [0.4.0](#升级到-040) · [0.3.0](#升级到-030) · [0.2.x](#升级到-02x) · [0.1.3](#升级到-013) · [0.1.1 / 0.1.2](#升级到-011--012)

## 升级到 0.7.0

0.6.x → 0.7.0 是一轮全库复审的产出，对外语义变化以 [CHANGELOG](../CHANGELOG.md) 的 0.7.0 一节为准，本节只展开**需要改代码的 5 条**与**无需改代码但断言 / 监控要复核的 5 条**，其余属于「原本就该如此」的缺陷修正。0.6.1 那一档只动微信产物链（`dist-weapp/` 的编译与 `verify:weapp` 门禁），对调用方无影响，所以本节从 0.6.0 的行为差异整体算起。下面各条括号里的编号是 CHANGELOG 同批条目的追溯号。

> **同样不会自动发生**：本版含破坏性变更，按 0.x 的语义升的是 **minor**（0.6.1 → 0.7.0）。`^0.6.1` 展开为 `>=0.6.1 <0.7.0`，要拿到这一轮修复请把依赖显式改成 `^0.7.0`。

### 需要改代码

- **`setState('__proto__', …)` 不再换原型**（R6-007）：`__proto__` / `constructor` / `prototype` 这三个键现在与 `$patch` / `$replaceState` 同口径，走 DefineOwnProperty 语义——值成为状态对象上的**自有数据属性**，`Object.getPrototypeOf(state)` 不变。仍然依赖旧行为（用 `setState('__proto__', obj)` 给状态树挂原型、或指望 `state.someMissingKey` 经那条链取到值）的代码要改成显式建模；反过来，指望「非对象值时那次写入什么也没发生」的分支也没了：现在它会真的落下一个自有键并照常推进变更计数。读回自己写进去的值请用 `Object.getOwnPropertyDescriptor(state, '__proto__')`，`state.__proto__` 这个表达式返回的仍是原型。
- **不要再靠组合层的抛错发现子 store 被销毁**（R6-005）：子 store 在组合之外被 `destroy()` 后，`composed.getState()` / `composed.state` / `composed.$snapshot()` 与平铺模式的归属判定都不再抛 `Cannot call getState on a destroyed Store`——该子店按**空视图**并入、按 store 去重告警一次，其余子店照常读写。三处要检查：① `try { composed.getState() } catch {}` 这类「抛错＝子店没了」的探测逻辑，改成看告警或自己持有引用；② 把 `composed.getState().child === undefined` 当「子店不在」的判断——现在它是一个**空对象**而不是缺失键；③ 依赖「合并状态里键数不变」的深比较断言。销毁整个组合仍是 `composed.destroy()`，语义未变。
- **手工构造 `SnapshotDiff` 的代码要补 `inputTrusted`**（R6-050）：该字段是**新增必填**（`SnapshotDiff.inputTrusted: boolean`，库产出的对象一定带它）。写测试夹具 / 自造 diff 对象的地方直接补 `inputTrusted: true`，否则编译报错。同时注意判读顺序：任一侧快照 `success: false` 时 `compareSnapshots` 不再逐路径比对，而是交付一条 root 级整体差异并把 `changed` 置为 `true`——那表示「输入不可信」，不表示「确有差异」，先判 `success`、再判 `inputTrusted`、最后才读 `changes`。旧实现会把两份失败快照报成 `changed: false`（把「快照没做成」伪装成「状态没变」）。
- **按 `root[0]` 这类下标聚合 `Map` 条目路径的消费方要改成按键身份**（R6-101）：`compareSnapshots` 的 `changes[].path` 现在与克隆账本 `errors[].path` 同一份方言——`Map` **值差异**记 `parent.<String(key)>`、**键新增 / 删除**记 `parent.key.<String(key)>`（旧写法是 `root.key[0]` 这种「两侧各自的迭代下标」，会随插入顺序漂移、双向比对给出不同路径）。正则按 `\.key\[\d+\]` 解析的请改按 `\.key\.<键串>`；`Symbol` 键串是 `String(key)`、`toString` 抛错的键退回 `<unstringifiable key>`。`Set` 的 `[removed:i]` / `[added:i]` 里的 `i` 仍是**报告序下标、不是条目身份**（集合元素没有可当身份的键），跨快照配对 `Set` 变化请读 `oldValue` / `newValue` 而不是按下标配。
- **别指望快照把子类与「内部槽位承载值」克隆成独立副本**（R6-008 / R6-099 / R6-100）：`Date` / `RegExp` / `Map` / `Set` / `Array` 的**子类实例**，以及 `Promise`、装箱原始值（`new Number(1)` / `new String('x')`）、`ArrayBuffer` / TypedArray / DataView、`WeakMap` / `WeakSet`、`Error`、生成器，现在一律**保留原引用**（与核心 `deepCloneState` 同口径，同步与异步两条路径一致）。此前它们分别被 `new X()` 重建（子类字段与方法丢失）或被拷成「`instanceof` 仍真、内部槽位为空」的壳（`await snap.data.p`、`Number(snap.data.n)` 当场抛 `TypeError`；`compareSnapshots` 对 `new Number(1)` vs `new Number(2)` 恒判无差异）。如果你的代码依赖「快照之后改原对象不影响快照」，对这两类节点请改用 `customCloner` 自己接管；类实例仍按既有契约重建为同类实例。另两条同批口径：数组上的**附加自有键**（非下标、非 `length`）现在同步与异步两条路径都跟着克隆；`includeNonEnumerable: true` 拷进来的键一律落为可枚举（`Object.keys` / `JSON.stringify` / diff 键集比对从此看得见它们，若你的断言按「不可枚举」写需要复核）。

### 行为变更（无需改代码，但断言 / 监控需复核）

- **异步 action 的同步段现在会当场补发一次通知**（R6-037）：默认模式下「同步段有写入且最终 settle」的一次异步 action，通知数由 **1 变 2**（结算那一轮保留，覆盖 `await` 之后的续段）。`notify.async`（同 tick 微任务合并）与 `notify.onlyOnChange`（按写入计数去重，同步段无写入就不多刷）都会把它吸收回 1 次；`batch` 内不提前补发。动机是 Promise 永不 settle 时同步段的写入此前要等「下一个不相干通知」才浮出来。按「一次 dispatch 一次回调」写断言的测试、以及靠通知次数做上报去重的插件需要重算；`notify.async` 合并窗口下可能多出一个**脏键为空**的投递批次（内容已在上一批投完，集成层据此跳过 `setData`）。
- **状态保护不再对冻结 / 不可写属性抛错，读取拿到裸引用**（R6-006）：自有属性「既不可配置也不可写」时（`Object.freeze` 过的子树、`defineProperty` 成 `writable:false + configurable:false` 的键；最省事的来路就是把 `$snapshot()` 的深冻结结果 `setState` 回状态），深代理与数组代理都原样返回目标值——这是 Proxy `[[Get]]` 不变量的硬要求，修复前连**读取**都会抛 `TypeError: 'get' on proxy: property 'x' is a read-only and non-configurable data property…`。代价写在文档里：这类子树不受写保护、不计变更与脏键，`state.frozen.x = 1` 在严格模式下仍按 JS 自身规则抛 `TypeError`（那不是本库的守卫，报错文本与可捕获性都变了口径）。要复核的用例形状是「读冻结子树会抛 Proxy invariant 错」——那种读取现在不再抛。
- **`withDebounce` / `withThrottle` 的 `cancel*` / `flush*` / `dispose*` 在 store action 上不可用**（R6-046，文档纠正而非新增限制）：这六个入口按「被装饰方法被调用时的 `this`」定位状态槽位，而 store action 的 `this` 是 `ActionManager` 每次 dispatch 现造的 action 上下文代理、不挂在任何公开成员上，于是 `cancelDebouncedCalls(this)` 之类调用命中空槽位、**静默 no-op**（不抛错、也不清定时器）。本库刻意不暴露那个宿主（否则「装饰器内部槽位键」升为跨 core 与 extras 的公开契约）。改写法即可：① 装饰 Page / Component 上的方法、让它去 `dispatch`；② 在 store 外面自己包一层并把那一层当宿主传进去。此前文档（`docs/GUIDE.md` §3、`docs/FAQ.md` 装饰器一节）按「对 store action 同样成立」写过，已改正——照旧抄写的代码不会崩，但以为「已收尾」的挂起定时器会照旧到点执行。
- **异步快照的超时判定**：只有「仍有未处理任务、或超时后丢掉过入队任务」才让 `success: false`；收尾竞态下交付的完好克隆不再被判为失败（此前会出现 `success: false` 但 `data` 是完整副本的自相矛盾结果）。

### 版本号与文档同步

版本号散在四处（`package.json`、`hot-update.ts` 的 `LIBRARY_VERSION`、`SKILL.md` 三处手写行、`skill:api` 生成物的「来源版本」行），由发版方按 [CONTRIBUTING 的发版清单](../CONTRIBUTING.md#构建与发布) 一次改齐，升级方无需处理。

## 升级到 0.6.0

0.5.1 → 0.6.0 是两轮全库复审合并发布的产出。多数为「原本就该如此」的缺陷修复，本节只列**需要动调用方**或**会改变可观测行为**的点；完整清单见 [CHANGELOG](../CHANGELOG.md)，后半批条目见本节末尾的「同批发布的其余可观测变更」。

> **这次升级不会自动发生**：本库还在 0.x，而本版含破坏性变更（下面「需要改代码」一节的类型收紧与判据反转），所以升的是 **minor**（0.5.1 → 0.6.0）。`^0.5.1` 展开为 `>=0.5.1 <0.6.0`，包管理器不会把 0.6.0 塞给你——想拿到这两轮复审的修复，要把依赖显式改成 `^0.6.0`，并按本节逐条改代码。

### Breaking

- **快照 `onError` 的签名与真值语义**：返回类型改为 `boolean | void`，判定是 `if (!shouldContinue)`——不写 `return` 的箭头函数（`void`）等价于**拒绝继续**。只观测不表态的写法必须改成显式 `return true`：

  ```ts
  // 改前（会把整次快照做成失败）
  createSnapshot(state, { onError: (e) => console.warn(e) })
  // 改后
  createSnapshot(state, { onError: (e) => (console.warn(e), true) })
  ```

- **`persistencePlugin({ storage })` 在 `store.use()` 安装期即校验三方法**：只实现了部分方法的自定义后端会抛 `TypeError`（此前静默回落到 `wx` / 内存）。补齐 `getItem` / `setItem` / `removeItem`，或直接传 `new WxStorageBackend()`。`Store.use` 会原样上抛，`usePlugin` 仍吞掉并 `console.error`。
- **`OfflineManager.execute` 失败不再 reject**：契约改为「失败返回 `null` ＝ 已入队待重放」。原先靠 `catch` 它做重试的代码要改成读返回值 / 队列，否则非幂等操作可能被「自己重试 + 队列重放」执行两次。
- **类型面**：`HookHandler<TArgs, TResult>` → `HookHandler<TArgs>`（`TResult` 删除，`emit` 从不读返回值）；`IHookSystem` 新增必需成员 `listenerCount(hookName)`，自行实现该接口的代码需补方法；`ActionDecorator` 改为 `MethodDecorator` 别名；`ActionResult` 为判别联合（`success: true` 不再带 `error`）；`ActionContext` 默认泛型收紧为 `Actions`（以 `interface` 声明的 action 集合需改 `type` 别名）；`withAppStore` 的映射类型改按实参推断。
- **Store 品牌 Symbol 键更名**为 `Symbol.for('@openlide/geomstore:brand')`。`isGeomStore()` 用法不变；直接读旧键 `Symbol.for('__geomstore_brand__')` 的代码需同步。
- **`createUserStore({ userId })` 拒绝空 / 纯空白 userId**（抛错）；**`syncWithServer()` 在响应体缺 `userInfo` 时 reject**。依赖「失败也 resolve」的调用方需加 `catch`。
- **`setStateProtection()` 在 Store 销毁后抛错**：与 `setState` / `$patch` / `subscribe` / `use` / `cache` / `batch` 同口径；只读的 `isStateProtectionEnabled` / `getStateProtectionConfig` 仍可用。

### 行为变更（无需改代码，但断言 / 监控需复核）

- **装饰器不再把同步方法包成 `async`**（`createDecorator` 及其派生装饰器）：同步方法按同步取值；`before` 返回 Promise 时整次调用才降级为异步。
- **`withLog` 在生产构建默认输出摘要**（类型 / 长度 / 键数），不再原样打印 `args` / `result`；需要内容请传 `redact`（同时可用 `sink` 换出口）。
- **快照失败 / 中止时 `data` 为 `undefined`**（不再回传活引用）；`metadata.nodeCount` 两条路径同口径；`onProgress` 抛错不再让整次快照失败。
- **`subscribe(fn, { readOnly })` 决定载荷形态**：仅有只读订阅者时免深拷贝（保护开启给只读 Proxy、关闭给原始引用）。`notify.clone` 未显式配置即自动模式——集成层绑定本身是只读注册，默认场景下通知开销显著下降；若有测试断言「回调拿到的是副本」，请改为显式 `notify: { clone: true }`。
- **脏键与通知**：`$replaceState` 会把被删掉的旧键一并标脏；通知回调内的重入写入归下一轮（组合 Store 同口径）；监听器抛错与 action 收尾链路异常改由 `onError` 承接（生产控制台仍静默）。
- **持久化生产降级改走 `onError`**（`emit('onError', error, 'persistence')`）；`clearOnUninstall` 删除失败不再被吞。`StorageBackend` 三方法一律「失败抛错」，`getItem` 返回 `null` 只代表键无数据。
- **不传 `storage` 时的默认后端统一为 `WxStorageBackend`**（`builtin.ts` 的内联适配器已删除）：微信缺失键返回的 `''` 与非字符串载荷改按「无数据」处理（此前 `''` 会被送去 `JSON.parse` 并在恢复路径报一条解析错误）；可用性判定由「有 `getStorageSync`」收紧为「三方法齐备」，只有读方法的残缺 `wx` 不再每次落盘抛 `TypeError`，而是走内存降级；降级文案括号里新增「wx 同步 API 不齐备」，按文案匹配日志 / `onError` 的调用方需同步。显式传 `storage` 的路径不受影响。
- **`WxStorageBackend` 的实现文件换位置**（`src/types/persistence.ts` → `src/plugins/WxStorageBackend.ts`）：**非破坏性**，`@openlide/geomstore/extras/plugins` 与 `@openlide/geomstore/extras` 的导出名与形状不变，import 无需改动；类体逐字节相同。
- **`compareSnapshots` 不再把「深过 100 层」当成差异**（退化为整体 `deepEqual`）；`deepEqual` 的深度预算跨 Set 累加，超深结构按保守语义判不等且一次顶层调用只告警一次。
- **错误子系统统计与上报**：`ErrorAggregator` 的样例不再携带 `payload` 且随命中刷新、`byStore` 随组驱逐保持一致；`ErrorMonitoring` 的 `reportTimeout <= 0` 表示不超时、`clear()` 复位连续失败计数；`ErrorRecovery` 的受控字段（`error` / `config` / `attempt`）不再被调用方上下文覆盖；`ErrorBoundary` 会把非 `Error` 抛出值归一化后记账（重抛仍用原始值）。
- **时间旅行 `importHistory` 会跳过畸形条目**（`state` 为数组或自持 `__proto__` 键），`undo` / `redo` 在回放成功后才推进索引。

### 同批发布的其余可观测变更（同一版）

这批修复与上面 0.6.0 的条目一起发布。这里只列**升级时需要动手**或**要复核断言 / 监控**的点，括号内是与 [CHANGELOG](../CHANGELOG.md) 同批条目的追溯号。

#### 需要改代码

- **引用相等的比较器必须补 `snapshotState: false`**（R5-224）：新增 `SelectorOptions.snapshotState`（默认 `true` = 写缓存时克隆一份状态内容），取代旧判据「`equalityFn` 的函数引用是否恰好等于内置 `deepEqual`」。只传 `equalityFn: (a, b) => a === b` 而不传 `snapshotState: false` 的调用方，在状态无版本号时从「命中」变成**永不命中**（不返回错值，memo 失效）。旧判据对自定义深比较器（lodash `isEqual`、`(a, b) => deepEqual(a, b)`、ESM/CJS 双副本）是错的——那类调用方现在行为变对（能看见就地变异），无需改动。`createParametricSelector` **没有**这个选项（state 侧判据写死 `deepEqual`，关掉快照等于删掉唯一的失效信号）。
- **`StoreCacheManager.clearOldState(stateKeys)` 已从类面移除**（R5-113）：`src` 内无调用方，`$replaceState` 走的是 `invalidate()` 整表清空（按键遍历会漏掉已从状态删除的键）。该类只经 `core/store` 的 barrel 出口、而该子路径不在 `package.json` 的 `exports` 映射里；深链过它的代码请改走 `invalidate()` / `invalidate(key)`。
- **`syncUrl` 不再有内置默认端点**（R5-273）：`DEFAULT_SYNC_URL = '/api/user/sync'` 已删除，未配置 `syncUrl` 时 `dispatch('syncWithServer')` **不发请求**、直接 reject 并记日志（此前是发一次注定失败的请求、把配置缺口伪装成网络错误）。`syncUrl` 仍是可选类型，语义变为「缺省即该 Store 不具备服务端同步能力」；要同步请显式给地址。
- **`new WxStorageBackend()` 在缺 `wx` 时抛错**（R5-279）：`wx` 或对应的 `getStorageSync` / `setStorageSync` / `removeStorageSync` 缺失、非函数即抛错，不再把 `?.` 短路成静默 no-op（旧行为：写删「看起来成功」、`clearOnUninstall` 误报已清除、读被洗成「键无数据」后一次落盘覆盖真实数据）。`persistencePlugin` 未传 `storage` 的路径不受影响——它先用 `isWxStorageSyncAvailable()` 探测，探测不过才降级内存；直接自建实例复用它的代码需要自己保证环境或改传后端。
- **`StoreRegistry` 的别名与覆盖注册**（R5-073 / R5-072 / R5-074）：`unregister(name)` 与同名覆盖现在摘除同一实例的**全部**名字并只 `destroy()` 一次（此前其余名字继续返回已销毁实例，`getDefault()` 也可能悬空）；`destroy` 回调里重入登记同名的那个实例会被摘链销毁，返回后 `get(name)` 一定是本次注册的实例；旧实例不可销毁时 `already registered` 告警不再声称 "destroying old store"；`register()` 无效 store 的文案变为 `[StoreRegistry] Invalid store object for name "<name>"`（旧串仍是前缀）。
- **`HookSystem.on()` 的退订句柄改为一次性**（R5-087）：第二次调用是 no-op，`on → off → on → off(旧句柄)` 不再摘掉新那次注册。`AsyncBatchNotifier.subscribe()` 同口径（R5-100）。
- **`PerformanceMonitor.record(metric)` 不再持有入参引用**（R5-090）：入参先被浅拷一份再入缓冲区。此前「复用同一个对象连续 `record`」的写法会让历史条目全变成最后一次的值——那种调用方现在自动修好，但别再去读缓冲区里的元素当自己传进来的那个对象。
- **`@withErrorBoundary` 的回退值不再被 await**（R5-206）：只对**被包裹方法的原始返回值**做 thenable 判定。带可调用 `then` 的 `fallback` 现在原样返回（此前返回 `Promise<fallback>`，把同步方法的返回形状改掉）。
- **`ErrorRecovery` 的上限语义**（R5-201 / R5-203 / R5-205）：抛 `Max retries (n) exceeded` 时**保留**计数与周期窗，同一故障周期内的后续 `recover()` 持续被拦截（旧行为是清键 → 紧接着下一次又领到一整个新额度，防重试风暴只对触发超限那一次生效）；抛出物由裸 `Error` 变为 `GeomStoreError`（`code: INTERNAL_ERROR`、带 `cause`，`context.retryKey` 指明被用满的是哪一份额度，两个来源都缺时键名为 `<code>:unattributed`）。按 `message` 前缀匹配的调用方不受影响，要按类型分支处理超限的请改读 `code`。
- **越界的 `stateProtection.productionHandler` 改为建店即失败**（R5-115）：非 `'error' | 'warn' | 'silent'` 的取值让 `createStore` 当场抛 `TypeError`（此前留到很远的一次非法写入才以别的面目炸）。
- **以 `Object.prototype` 成员名当错误码时**（R5-204）：`ErrorRecovery.getConfig('constructor')` 由「返回原型链成员」变为 `undefined`，`recover()` 改报「No recovery strategy configured for error code: constructor」。策略表已换成 `Map`。
- **`deepEqual` 改为「原型一致」先于一切内建内容判定，并新增装箱原始值一档**：空的 `class MyMap extends Map` 实例此前与空 `new Map()` 判等（`Set` / `Date` / `RegExp` 同理），`new Number(1)` 与 `new Number(2)` 判等（`String` / `Boolean` / `BigInt` / `Symbol` 同理），现在都判不等。两类状态若混在一条选择器链上，此前是「命中并返回陈旧值」，现在会正确地重算——**性能敏感路径请复核**：把子类实例与基类实例当同一状态来源的写法（例如自己 `new` 一个 `Map` 子类再和反序列化出来的基类 `Map` 比），现在要显式统一成同一个类。装箱原始值不建议放进状态：`clone` 对它们保留原引用，比较又只看 `valueOf`，既拿不到子类语义也拿不到不可变性。

#### 断言 / 监控需要复核（无需改代码）

- **同一轮通知里两个可写订阅者的载荷不再是同一引用**（R5-122）：拷贝改由 `SubscriptionManager` **按注册分配**——可写注册各一份独立深拷贝、只读注册共用一份。只有全只读时仍是零拷贝；`false` 档（调用方自备载荷）零变化。
- **`maxSubscribers` 变成硬上界**（R5-123）：门禁覆盖每一次注册（含同一函数的重复注册），达限时 `evict-oldest` 让**本次重复注册自己最早的一份**让位、`throw` 抛错；`size()` 不再可能高于上限（唯一例外是 `maxSubscribers <= 0` 配 `evict-oldest`）。
- **驱逐订阅者会发一次 `onError`**：`evict-oldest` 触发时 `emit('onError', Error, 'subscribe')`——生产环境从完全静默变为可观测，只订阅 `onError` 做监控的调用方会多看到一类事件。
- **`withLog` 的生产摘要不再输出 `Error` 的 message**（R5-178），且生产构建下 `redact` 之后仍会再过一层摘要，除非显式 `summarizeInProduction: false`（R5-177 新增该选项）。依赖摘要文本的日志解析需同步。
- **非法构造参数改为归一或拒绝**：`cacheConfig.ttl` 非有限 / 负值归一为 `0`（＝不过期）并打一条开发期告警（R5-111）；`cacheTTL` 的 `NaN` / `<= 0` / 非数值回落 `5000`，`Infinity` 有意放行（R5-225）；`maxEntries` 归一为 `Number.isFinite(v) ? max(1, floor(v)) : 1000`（R5-229）；`ErrorMonitoring` 的 `maxQueueSize` 最小 1、`maxFlushRetries` 最小 0（R5-212）；`SnapshotManager` 的 `batchSize` 在构造期与逐次调用共用一个归一化函数（R5-258），`timeout` / `batchInterval` 的非有限值与非正值统一按「不设超时 / 无延迟」（R5-260）；`timeTravelPlugin({ maxSize })` 的非法值按默认 50 生效（R5-298）；`withDebounce` 的 `delay` 与 `withThrottle` 同口径归一到默认值（R5-173）；`withRetry` 的 `delay` 为正 `Infinity` 时钳到定时器上限而不是折成 0（R5-148）。
- **快照账本与计数变化**：`result.errors` 现在含 `circular` 条目（先入账再用同一条记录咨询 `onError`，R5-254）；`stats.cloneOperations` 对含 Date / RegExp 的数据变大（R5-255）；失败结果的 `stats` 交出中止点的实际累计值（R5-261）；Proxy `ownKeys` 抛错且允许继续时该节点消失而不再留 `{}` 空壳（R5-251 / R5-252）。
- **性能指标的两处口径**：`getHotPaths(limit)` 的负数与 `Infinity` 改为返回空数组（R5-096）；在途计时超过 10 分钟未 `end()` 时，此后任意一次 `start()` 就会摘除它（此前还需一次 `record()`，R5-093）。
- **`isProduction()` 在内联产物里的判定**（R5-140）：构建工具只内联 `process.env.NODE_ENV` 成员表达式、而产物里没有 `process` 全局时，判定结果由 `false` 变 `true`（生产分支才真正生效，直写状态由崩溃变回 warn）。
- **变异报错文案**：写入函数 / Symbol 时的 `Attempted value:` 不再是 `undefined`（R5-142）；非法写入落在嵌套数组时路径形如 `[0].v`（R5-116 / R5-118）。
- **`usePlugin(plugin, store)` 在已销毁 Store 上原样抛出 `use` 的异常**（R5-088），不再只 `console.error` + 返回空卸载函数。
- **被同步中止的 dispatch，其 `onError` 带第二参 `'dispatch'`**：`analyzerPlugin` 据此作废该次进行中计时并产出一条「到抛错为止」的耗时指标（R5-319 落地的「`onError` 一律不弹栈」由这条接线补全）。

#### 类型面（会编译报错，都是把原本写错的一侧显形）

- `SnapshotResult<T>.data`：`T` → `T | undefined`（R5-238，运行期取值不变；不判空取属性直接报错）
- `SnapshotErrorContext.recoverable`：字段删除（R5-239，恒真、不参与走向判定，分流请读 `SnapshotError.type`）
- `SelectorOptions.equalityFn` 形参：`(a: unknown, b: unknown)` → `(a: any, b: any)`（与 R5-316 给 `AsyncActions` 的同一处方；只放宽逆变的形参位，返回位仍受检查，业务侧按具体状态标注的比较器现在可赋）
- `Store.isStateKeyDirty` / 组合层同名方法形参：`string` → `string | symbol`（R5-135，向后兼容的放宽）
- `SelectorComposer.combine` 入参：`SelectorComposerInput<S, T>` → `SelectorComposerInput<S, T, R>`（R5-232，两处 `as` 断言随之删除）
- `ActionLoader.getErrorData()` 返回类型：`unknown` → `ActionErrorData | undefined`（R5-163，纯收窄）
- `ComposedStore` 别名形状扩为整个 `Store<S>` 面、`HostStoreApi` 新增 `__store__` 与 `subscribe` 的可选形参、`ExtractPageData` 撞名键由 `never` 改为 getter 返回类型、`AppThis.globalData` 不再可调用、`StoreConfig` 的 `S` 默认值 `unknown` → `Record<string, unknown>`（R5-312 / R5-327 / R5-328 / R5-330 / R5-326）

## 升级到 0.5.1

公开签名基本不变（含两处类型放宽）；升级时请确认依赖旧行为的断言与收尾逻辑。以下两节按修复批次列出会改变可观测行为的点，完整清单见 [CHANGELOG](../CHANGELOG.md)。

### 脏追踪与运行时语义修复

- **脏追踪范围扩大**：类实例与类型化数组不再原样返回——实例属性写入、数组元素写入会被标记；实例方法调用会保守标记所属键（宁可多报），读取时方法绑定原始接收者，`#private` 与内部槽位可用。`$patch` 就地改写被其他顶层键引用的对象时，这些键一并标记。Date/RegExp/WeakMap/WeakSet 维持原引用与不跟踪契约。
- **保护代理读取**：`store.state.<实例>.method()` 与类型化数组的展开 / 切片不再抛错（此前 `this` 是代理导致 `#private` 与内部槽位失效），非法写入仍被拒绝。
- **时间旅行**：回放吞并判断只作用于订阅通知路径——`undo()` 后手动 `record()` 现在会真正记录（此前静默无效，异步模式下回放还会二次截断 redo）。
- **订阅与插件语义**：`readOnly` 按每次注册判定（同一函数先只读后只写时，可写注册仍走深拷贝隔离）；`destroy()` 期间插件清理重入不再重复执行；`usePlugin()` 委托 `store.use()`，因此 `destroy()` 会执行其清理、与 `store.use` 混用不再双重安装。
- **比较与队列**：`deepEqual` 对等价循环 / 别名图两个方向都判等（配对按对象对记录）；离线管理器 `dispose()` 后不再落盘、也不再继续在途同步；队列中的畸形条目会被丢弃而不是让同步永久失败；持久化恢复不再回写磁盘。
- **类型放宽（编译期）**：`store.use` / `usePlugin` / `ComposedStore.use` 的插件参数接受 `Plugin<State>` 联合类型，状态无关插件（logger/analyzer 等）可直接传入；针对其他状态类型的插件仍被拒绝。`persistencePlugin<S>(options)` 保留状态类型参数。
- **选择器与 Action 历史**：`createParametricSelector` 的 `ttl: 0` 统一为「立即过期（等同禁用缓存）」；`ActionHistoryTracker.setMaxHistory` 立即裁剪已有桶并在非有限输入下回退 1；重试内核在 `retries` 为 NaN / 负数时按 0 处理（首次尝试必执行，抛出真实错误而非兜底错误）。

### 其余行为修复

公开签名不变；升级时请确认依赖旧行为的断言与收尾逻辑：

- **Action 状态代理**：默认与 `onlyOnChange` 模式均跟踪对象 / 数组 / Map / Set 的直接变异，标记所有受影响的顶层键（含别名与异步累积）。归属关系按需求构建一次索引、标量写入 O(1) 查表，逐项更新长列表不再呈平方级开销。类实例与类型化数组也被代理：属性写入与元素写入会被标记，实例方法调用保守标记所属键（方法内部的写入无法精细归因），方法读取时绑定原始接收者；Date/RegExp/WeakMap/WeakSet 仍保留原引用、内部变异不跟踪，需显式替换值。`onlyOnChange` 是变更计数判定，不是内容深比较。
- **通知与脏键**：通知回调内的重入写入归下一轮通知（脏键不会被本轮清空）；`onlyOnChange` 的变更基线覆盖 `beforeDispatch` 钩子内的写入。退订句柄按注册标识精确退订：被驱逐的旧句柄不会误删同一回调的重新注册，插件卸载句柄也不影响同一插件的重新安装。
- **缓存新鲜度**：dispatch 刷新时会移除已删除的状态键，`$replaceState` 清空整表后回填；组合缓存读取前校验子 Store 版本，无版本号的子 Store（含嵌套组合）每次读取保守失效，不要依赖合并结果引用永远稳定。合并的 `actions` 注册表支持外层裸名 dispatch 路由嵌套组合，非命名空间模式同名取第一个 Store。
- **选择器与退订**：版本化选择器缓存同时校验状态对象身份与版本号；每个退订句柄幂等，重复调用不会消耗同回调的其他注册。
- **卸载顺序**：Page `onUnload` / Component `lifetimes.detached` 先执行用户钩子，再在 `finally` 清理绑定，同步抛错也会清理。依赖映射 actions 的收尾放在同步段；包装器不等待异步钩子的 Promise。
- **装饰器隔离**：`withDebounce` / `withThrottle` / `withCache` 支持静态方法（函数宿主），不同的同描述 Symbol 方法互不串扰。
- **快照 diff 与循环 Set**：按活动对象对识别循环，共享子对象仍按各路径比较；自有 `undefined` 属性新增 / 删除会报告 `kind: 'added' | 'removed'`。Set 元素配对共享循环防护并在候选失败时回滚，自引用 Set 判等为真、快照差异不再误报。
- **持久化与离线队列**：持久化卸载时直接读取当前状态补写（`notify.async` 下通知未送达即销毁也不再丢最后一次变更），与上次写入内容相同则不重复写；离线队列同步失败项只落盘一份（不再重启后重复执行），死信落盘失败时操作保留在队列中而非丢弃。
- **错误与性能子系统**：`ErrorRecovery.recover` 第二参数参与重试键（按 Store/操作隔离额度）；`ErrorMonitoring` 上报成功后回收超时定时器；`ErrorAggregator.getStats().byStore` 按实际次数统计（各项之和等于 `totalErrors`）；`PerformanceMonitor.setOptions({ maxSize })` 立即裁剪超额记录；`LRUCache` 缩容期间 `onEvict` 重入写入后仍维持容量上限。

## 升级到 0.5.0

### 1. 产物格式由 CJS 切换为 ESM

```diff
- const { createStore } = require('@openlide/geomstore')
+ import { createStore } from '@openlide/geomstore'
```

- 包根与 `dist/` 均为 ESM（`"type": "module"`）；入口仍为 `dist/index.js`
- **ESM 不做目录索引回退**：直接引用内部路径时请写全 `dist/xxx/index.js`（不要依赖目录解析）
- 复制安装场景：把 `@openlide/geomstore` 换成你的本地目录即可，但只支持 `import`

### 2. 可选能力的实现移入 `extras/*`

公开子路径与各入口的导出集合**均未变化**；仅当代码**深链了内部源码路径**时才需要调整：

| 能力        | 源码路径              | 对外引入方式（不变）                  |
| ----------- | --------------------- | ------------------------------------- |
| 快照        | `src/extras/snapshot` | `@openlide/geomstore/extras/snapshot` |
| 选择器      | `src/extras/selector` | `@openlide/geomstore/extras/selector` |
| Action 增强 | `src/extras/action`   | `@openlide/geomstore/extras/action`   |

`cache` / `hooks` / `performance` 的实现仍在 `src/core`（被 `core/store` 直接依赖），仅入口在 `extras/*`。

### 3. 组件生命周期收严（Breaking）

- 组件生命周期必须写在 `lifetimes`（`created` / `attached` / `ready` / `moved` / `detached` / `error`），页面级写在 `pageLifetimes`（`show` / `hide` / `resize`）
- 两者都**不再放开索引签名**，键与微信官方一致：拼错生命周期名、或传入自定义键，现在会在编译期报错

```diff
- lifetimes: { attache() {} }              // 拼错 → 现在报错
+ lifetimes: { attached() {} }
```

### 4. 集成方法内的 `this` 已注入（请删除手写标注）

三处集成都会把注入后的 `this`（`PageThis` / `ComponentThis` / `AppThis`）交给配置方法，手写标注会**覆盖**它，反而使类型变弱：

```diff
- onLaunch(this: { globalData: { appName: string } }) { … }   // globalData 退回字面量类型，丢掉映射状态
+ onLaunch() { … }                                            // 映射状态已在 this.globalData 上
```

- Page：`this.data`（含 `mapState` / `mapGetters`）+ `mapActions` 注入的方法
- Component：`methods` 内注入的方法与 `data`（微信会把 `methods` 条目提升到实例，`this.add` 与 `this.methods.add` 都可用），`lifetimes` / `pageLifetimes` 内同样是注入后的 `this`
- App：`this.globalData`（含映射状态）+ `mapActions` 注入的方法与调试 API

### 5. 状态类型约束放宽（仅类型，无需迁移）

`Selector` / `ParametricSelector` / `SelectorComposerInput`、选择器各创建函数与 `composeStore` 的 `StoreLike` 由 `Record<string, unknown>` 放宽为 `State`：**未声明索引签名的业务 `interface`** 现在可直接作为状态类型。

```ts
interface OrderState {
  rate: number
} // 此前会被拒之门外
createSelector((state: OrderState) => state.rate)
composeStore([userStore, cartStore])
```

`Plugin` / `PluginHook` 亦已泛型化：省略类型参数（`Plugin`）与既有写法一致，新增的编译错误只出现在「插件与 Store 状态类型不匹配」这类本就错误的组合上。

## 升级到 0.4.0

**错误子系统从核心入口下沉到 `extras/error`**（Breaking）：主入口不再导出 `GeomStoreError`、`createError`、`ErrorCode`、`isGeomStoreError` 及其子类、`ErrorRecovery`、`ErrorMonitoring`、`ErrorBoundary`、`ErrorHandler` 等。

```diff
- import { createError, ErrorCode, ErrorRecovery } from '@openlide/geomstore'
+ import { createError, ErrorCode, ErrorRecovery } from '@openlide/geomstore/extras/error'
```

同时移除 `TypeValidator` 模块与 `core/index` 中已废弃的零碎 barrel / 工厂函数（死代码收口）。

## 升级到 0.3.0

| 变更                                                                                                               | 迁移方式                                                                                   |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| 可选能力改由 `extras/*` 子路径引入（瘦核心拆分）                                                                   | `import { createSnapshot } from '@openlide/geomstore/extras/snapshot'`                     |
| 构建产物目录扁平化：`dist/cjs/**` → `dist/**`                                                                      | 复制安装时引用 `dist/cjs/...` 的改为 `dist/...`（NPM 安装不受影响）                        |
| 转发 stub 目录改由 `prepack` 生成 / `postpack` 清理                                                                | 需要时用 `pnpm stubs` / `pnpm stubs:clean`                                                 |
| `withPageStore` / `withComponentStore` **只识别 `lifetimes` 写法**                                                 | 组件顶层 `attached` / `detached` 改为写在 `lifetimes: { attached, detached }` 内           |
| `SubscriptionManager` 内部 API 重命名（`subscribe`→`add`、`unsubscribe`→`delete`、`size` 改为 getter、移除 `has`） | 使用 `store.subscribe` 公共 API 的代码不受影响                                             |
| `persistencePlugin` 直接安装不再透传第二参数                                                                       | 需要 `storage` / `key` / `filter` / `validate` 时改用工厂形式 `persistencePlugin(options)` |
| 热更新备份新增 `version` 字段                                                                                      | 备份版本与库版本不一致时仅告警，仍按 `$patch` 合并语义恢复（不因版本不符丢弃用户数据）     |
| 零拷贝通知语义收紧（`notify.clone: false`）                                                                        | 存在可读写订阅者时仍会克隆以保证内部状态安全                                               |
| `withCache` 命中日志 `console.log` → `console.debug`                                                               | 依赖日志做断言的测试需同步                                                                 |
| 组合 Store 订阅复用单路合并订阅                                                                                    | 外部直连子 Store 的订阅不再被组合层订阅静默驱逐                                            |

## 升级到 0.2.x

- **`$patch` 底层 `deepMerge` 仅对纯对象递归合并**：Date/RegExp/Map/Set/数组/类实例整体替换为深拷贝
- **`createSelector` 默认比较器 `shallowEqual` → `deepEqual`**，且缓存比较基于写入时快照（避免 `$patch` 后误命中陈旧值）
- **`bindMappings`**：对象值始终纳入 `setData`（不做引用脏检查）；`undefined` 字段被过滤（微信 `setData` 不接受 `undefined`，清除字段请用 `null`）
- **`HttpReporter.report/reportBatch` 失败向上抛出**：直接调用方需自行 `catch`（内部批量管线已兜底）；默认实现校验 `ok` / `statusCode`
- **`ErrorBoundary` 的 `fallback` 计算函数抛错时重抛原始错误**
- **`ErrorRecovery` 重试额度按故障周期计量**（时间窗 = `max(60s, 本周期退避总时长 × 2)`），达到上限仅清除当前键
- **类型层**：`ActionExecutor` / `ActionUtils` 泛型放宽为 `Actions`，返回 `Promise<Awaited<...>>`（消除 `Promise<Promise<T>>`）；`ExtractStates` 等基例改用 `Record<never, never>`（不污染组合 Store 属性类型）；`withPageStore` 入参改为同态映射，自定义方法保留精确类型

## 升级到 0.1.3

- **`StorageBackend` 收窄为纯同步接口**：`getItem/setItem/removeItem` 不接受 Promise；传异步后端会在恢复/保存路径显式报错。异步持久化请在外部自行订阅 store 实现
- **`ErrorFallback` 泛型参数反转**：`ErrorFallback<S>` → `ErrorFallback<F, S>`
- **`ErrorBoundary` / `withErrorBoundary` 默认 fail-loud**：未配置 `fallback` 时错误重抛；提供 `fallback` 即视为声明恢复意图
- **`withThrottle` 默认 `{ leading: true, trailing: true }`**：窗口内被抑制的调用在窗口结束时以**最新参数**补发；`trailing: false` 回到纯 leading
- **`clone` 选项重构**：`{ deep, safe }` → `{ mode: 'deep' | 'shallow' | 'safe' | 'json' }`；`safe` 语义为「尽力深拷贝且绝不抛错」，JSON 有损语义移至 `json`
- **`compareSnapshots` 集合语义**：Set 按内容无序匹配；Map 键引用匹配失败后做结构匹配；`changes` 条目新增可选 `kind: 'added' | 'removed'`
- **`createRetrySelector` 选项化**：第二参数 `maxRetries: number` → `{ retries?, shouldRetry? }`；负数创建期抛 `TypeError`；新增 `createRetrySelectorAsync`

## 升级到 0.1.1 / 0.1.2

以修复与文档对齐为主，无破坏性变更；以下行为修正值得同步确认：

- `persistencePlugin` 启动恢复改用 `$patch` 合并语义（未被持久化的键保留初始值）；无 `wx` 同步存储时降级为内存存储并告警
- `initBackgroundSync` 改为包装全局 `App` 构造器注入 `onShow` / `onHide`（修改 `App.prototype` 在微信中不生效）
- `Store.$snapshot` 返回递归深冻结结构（**该口径已在 0.6.0 更正为「部分冻结」**：只有纯对象与数组链被冻结，经 Date/RegExp/Map/Set 或非纯对象触达的节点仍可变）
- 文档与示例统一使用 `state` 工厂函数形式 `state: () => ({ ... })`
