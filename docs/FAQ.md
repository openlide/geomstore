# 常见问题

按症状归类。每条都指向对应的机制说明——排查时先看「为什么」，再改代码。

## 状态与通知

### 我改了状态，为什么监听器没被调用？

三种常见原因，按可能性排序：

1. **没有真正改变状态**：开启 `notify.onlyOnChange` 后，dispatch / batch 期间没有实际写入就不会通知。请确认写入是否真的发生（例如 patch 的键是否存在于状态中）。
2. **`notify.async` 合并了通知**：同一 tick 内的多次写入只发一次；如果你的断言在同一个 tick 里，看到的是「还没通知」。
3. **改的是克隆出来的副本**：`$patch` / `setState` 写入的是内部状态；如果你拿 `deepClone(state)` 的结果去改，不影响 Store。

### 监听器为什么收不到 `prevState`？

`StateListener<S>` 的签名是 **`(state: S) => void`**——只有一个参数。需要前后对比请在闭包里自行保存上一次的值：

```ts
let last = store.getState().count
store.subscribe((state) => {
  console.log(last, '→', state.count)
  last = state.count
})
```

### 同一轮通知里，两个监听器拿到的是同一个对象吗？

看**注册的可写性**。默认（`notify.clone` 未配置）下：

- 本轮**只有只读注册**（`subscribe(fn, { readOnly: true })`，页面 / 组件绑定本身就是）→ 零拷贝，收到的是同一个载荷（状态保护开启时是只读保护 Proxy，关闭时是原始引用）
- 本轮**存在可写注册** → 每个可写注册各拿一份独立深拷贝，只读注册共用一份。0.5.1 及之前是「整轮共用 Store 自备的那一份」，先执行的可写回调就地改载荷，后面的监听器就会读到半成品；现在这条不再可能
- 显式 `notify.clone: true` → 强制按上面的规则拷贝（全只读时也拷一份共用的）；显式 `false` 与「未配置」同义——存在可写注册时照样按注册分配

份数由 `maxSubscribers` 封顶，不会因重复订阅而等比放大。

### 直接写 `state.x = 1` 为什么会抛错？

状态保护（默认开启）拦截绕过 `setState` / `$patch` 的直接变异，包括 `Object.defineProperty` 与数组元素赋值。请改用受控写入：

```ts
store.setState('x', 1)
store.$patch({ x: 1 })
```

确实有性能或兼容需求时可用 `stateProtection: { deep: false }` 只保护顶层，但**不建议关闭保护**——就地变异是许多「数据不更新」问题的根源。

例外要认得：自有属性**既不可配置也不可写**时（`Object.freeze` 过的子树、`defineProperty` 成 `writable: false, configurable: false` 的键——最省事的来路就是把 `$snapshot()` 的深冻结结果 `setState` 回状态），代理必须原样返回目标值，否则连**读取**都违反 Proxy `[[Get]]` 不变量。0.7.0 起这条被明确豁免：读取拿到**裸引用**、不再抛 `TypeError`，代价是这类子树不受写保护、写入也不计变更与脏键。想让集成层看见它的变化，就换一个新引用再 `setState`。

### 异步 action 的通知次数和我想的不一样

统一规则（只有一条）：

- 异步 action 的**同步段在 `dispatch` 当场补发一次通知**（0.7.0 起），结算（fulfill 或 reject）时再发一次覆盖 `await` 之后的续段
- **嵌套 dispatch 仅最外层通知**；与 batch 交叉时由 batch 收尾统一通知（batch 内不提前补发）
- `notify.async` 会把同一 tick 内的这两次合成一次；`notify.onlyOnChange` 按写入计数去重——同步段没写入就不多刷

所以默认模式下「同步段改一次 + 续段改一次」现在看到 **2 次**（0.6.x 是 1 次）。这不是重复通知，而是把「Promise 永不 settle」这种悬挂场景下同步段的写入变得当场可见的代价：只想要一次就开 `notify.async` 或 `notify.onlyOnChange`，想显式合并请在 action 里用 `batch` 包住这两段。断言通知次数 / 依赖「一次 dispatch 一次回调」的测试需要按这条重算。

### `batch` 里 `await` 之后为什么不合并了？

批保护只在**同步段**有效——`await` 之后的变更会逐条通知（开发模式下有显式告警）。异步场景请让 action 承担合并职责，或在 `await` 之后重新 `startBatch` / `endBatch`。

### `isStateKeyDirty` 有什么用？

供集成层判断「自上次通知以来某键是否变化」，据此跳过无意义的 `setData`（小程序视图层更新是主要开销）。键型是 `string | symbol`——脏键集合按 `Reflect.ownKeys` 收集，symbol 顶层键同样有脏位可查（只收 `string` 会让它对集成层静默失效）。默认与 `onlyOnChange` 模式都跟踪 Action 内对象 / 数组 / Map / Set 的直接变异，标记所有受影响的顶层键（含别名）。0.7.0 起异步 action 的**同步段当场补发一次通知**，那一段的脏键也随之提前投递、不再一路攒到结算；`notify.async` 的合并窗口下因此可能多出一个脏键为空的通知批次（内容已在上一批投完，集成层据此跳过 `setData`）。Date 等其他内建对象的内部变异不被跟踪，请显式替换值。`$replaceState` 会把**被这次替换删掉的旧键**也标脏（消失型变更），否则视图会一直留着已删键的值。通知回调内的重入写入归下一轮。组合 Store 的命名空间模式下它会精确判断**子 store** 是否变化。

### `setState('__proto__', …)` 之后为什么凭空多出一些键？

0.6.x 及之前会：那次写入触发 `Object.prototype` 上的 `__proto__` setter，把**状态对象的原型整个换掉**（此后 `state.isAdmin` 这类缺失键会经被替换的链读到注入值，`deepEqual` 从此与克隆体恒不等 → 选择器持续失配）；传非对象值时更是什么都没写成、却照样推进变更计数与通知。0.7.0 起 `setState` 对 `__proto__` / `constructor` / `prototype` 改走 DefineOwnProperty 语义，与 `$patch` / `$replaceState` 同一份判据：值承载为状态对象上的**自有数据属性**，原型不动。要读回它请用 `Object.getOwnPropertyDescriptor(state, '__proto__')`——`state.__proto__` 这个表达式仍然命中原型访问器、返回的是原型。持久化侧对「载荷自带 `__proto__` 自有键」的拒收口径不变（见下文持久化一节）。

## 缓存与选择器

### `store.getState()` 和 `store.getCached(key)` 有什么区别？

只有第二条查缓存。内置缓存（`enableCache` / `cacheConfig`）的**唯一读取入口**是 `getCached(key)`（小程序集成层绑定映射键时走的也是它）：

- `getState()` 直接返回内部状态的活引用，**完全不经过缓存**——用它读多少遍都不会产生命中，`getCacheStats()` 的 `hits` / `misses` 也因此恒为 0。用 `getState()` 读两遍然后指望 `hits: 2` 是排查方向错了
- `setState(key, v)` 与 `$patch` 是**写穿**：把合并后的最终值同步回写进对应条目，条目不删除、不记未命中，下一次 `getCached` 直接拿到新值。指望「写入即失效」的读法要改
- 真正清条目的是 `invalidateCache(key?)`（不传即整表清空）与 `$replaceState`（清空后按新状态回填）

### 缓存命中率很低 / 选择器返回了陈旧值

- **命中率低**：先确认读的是 `getCached()`（见上一条，`getState()` 不查缓存）；只缓存热点键（`enableCache(['visibleRows'])`）；状态频繁整体替换（`$replaceState`）会让缓存整表清空。`setState` / `$patch` 不是原因——它们写穿，不制造未命中
- **陈旧值**：选择器命中判定同时校验**状态对象身份与版本号**（O(1)，不同 Store 的同版本状态不会串值）；当状态不带版本号（例如你把普通对象直接传给选择器）时才回退 `equalityFn`（默认 `deepEqual`）比**输入状态**。此时失效凭证是写缓存时的一份**内容快照**（`snapshotState` 默认 `true`），所以就地变异能被看见；如果你自定义的 `equalityFn` 过于宽松（只比自有属性、或压根恒真），就会误命中——检查它是否真的能区分前后两版状态
- **升级到 0.5.x 后突然「永不命中」**（每次重算、但结果没错）：你传的是引用相等的比较器 `equalityFn: (a, b) => a === b` 却没关快照。旧实现靠「`equalityFn` 是否恰好等于内置 `deepEqual`」推断要不要克隆，该判据对自定义深比较器是错的，已改为显式选项：这种写法要补 `snapshotState: false`（缓存活引用、只比身份）。带版本号的 Store 状态不走这条回退路径，也不克隆

### `store.getter(name)` 会缓存结果吗？

**不会**，一次都没有过。Store 侧不存在 getter 结果缓存：没有 memo 表、不比较依赖、`getter(name)` 每次调用都按当前状态重算函数体（内部版本号只服务于选择器与缓存失效判定，不作用于 getter）。文档或注释里写过「依赖未变时复用缓存」的地方都是假话，0.7.0 已按实现改正。要记忆化只有两条路：`extras/selector` 的 `createSelector`（按状态版本号做 O(1) 失效判定，这才是本库的记忆化入口），或把派生值算成一个真实状态键、由 action 显式写入。

### `enableCache` 的 stats 会影响性能吗？

会带来少量开销（每次查缓存都要计数），但**它是默认开启的**：`cacheConfig.enableStats` 缺省即 `true`（`enableCache()` 里显式传 `true` 不打开任何东西）。真要省这点开销是反过来传 `false`——代价是 `getStats()` / `getCacheStats()` 的 `hits` / `misses` 恒为 0，命中率与 `missRate` 无从观测。测量完记得打开回来。

## 快照

### 快照里为什么少了字段 / 出现了 `undefined`？

这是**隔离契约**的预期行为：无法安全克隆的节点一律**丢弃**，绝不把原始活引用兜底进结果（注意「保留原引用」的那两类节点是另一码事，见下文「快照能克隆类实例 / Date / Map 吗？」——它们不是被丢弃，而是压根没被克隆）。具体表现：

| 容器     | 丢弃时的表现                           |
| -------- | -------------------------------------- |
| 对象属性 | 该属性不写入                           |
| 数组     | 保留位置（留洞，`1 in arr === false`） |
| `Set`    | 不添加该元素                           |
| `Map`    | 跳过整条 entry                         |
| 根节点   | `data` 为 `undefined`                  |

排查方式：读 `result.errors`（每项含 `path` / `type` / `message`），并按需用 `customCloner` 接管该节点。`errors` 是**完整账本**：循环引用也入账（`type: 'circular'`）、`maxDepth` 超限同样落一条，但只有 `cloneError` 参与 `success` 判定，故 `success: true` 且 `errors` 非空是合法状态。存在 `cloneError` 时 `success` 为 `false`——**先看成功标志，再信任数据**（类型面上 `SnapshotResult<T>.data` 就是 `T | undefined`，不判空取属性直接编译报错）。整次快照异常或被告警中止时 `data` 是 `undefined`（失败结果不会回传活引用），别直接 `result.data.x`；失败结果里的 `stats` 是引擎累计到中止点的真实值，而 `metadata` 的规模项按零处理。

`onError` 按**真值**解释：不写 `return` 的箭头函数返回 `undefined`，等价于「拒绝继续」，会把整次快照做成失败。只想观测请显式 `return true`，或改用 `onProgress`（它抛错会被就地兜住、不影响结果）。

### `$snapshot()` 和 `createSnapshot()` 有什么区别？

|          | `store.$snapshot()`                                                                          | `createSnapshot(data)`                       |
| -------- | -------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 归属     | 核心                                                                                         | `extras/snapshot`                            |
| 结果     | 深克隆 + **部分冻结**（纯对象 / 数组链只读；Date/RegExp/Map/Set 与非纯对象触达的节点仍可变） | `{ data, success, errors, metadata, stats }` |
| 错误处理 | 无账本（失败即抛）                                                                           | 逐节点落账 + `onError` 降级策略              |
| 适用     | 需要只读副本 / 回滚点                                                                        | 需要错误可见性、进度、大对象分片             |

### 什么时候该用异步快照？

数据量导致单次克隆会阻塞主线程时。`createSnapshotAsync` 按 `batchSize`（默认 100）分片并在批间让出控制权，可配 `onProgress` 显示进度、`timeout` 限制总耗时。非法值不会再制造惊喜：`timeout` 的 `0` / 负数 / `Infinity` / `NaN` 一律按**不设超时**处理（`Infinity` 走 `setTimeout` 会被宿主夹成约 1ms、变成莫名的立即超时），`batchInterval` 同理按「无延迟」处理；`batchSize` 的 `0` / 负数夹到 1、非有限值回默认 100，不会再产出「`success: true` 但 `data` 是空壳」的半成品。异步路径走任务队列、不占调用栈，超过 1000 层的结构只能靠它。

### 快照能克隆类实例 / Date / Map 吗？

- 类实例：重建为**同类实例**（保留原型与方法，不触发构造器）
- 访问器属性：以 getter 求值结果克隆（**不会二次触发** getter）
- `Date` / `RegExp` / `Map` / `Set`：按类型正确克隆；循环引用检测始终生效（`detectCircular` 只控制是否**上报**）
- **两类节点保留原引用、不克隆**（0.7.0 起，核心 `$snapshot()` 与 `extras/snapshot` 同口径、同步与异步两条路径一致）：`Date`/`RegExp`/`Map`/`Set`/`Array` 的**子类实例**，以及值靠内部槽位承载的对象（`Promise`、`new Number(1)` 这类装箱原始值、`ArrayBuffer` / TypedArray / DataView、`WeakMap` / `WeakSet`、`Error`、生成器）。旧行为会重建或产出「`instanceof` 仍真但槽位是空的壳」——`await snap.data.p`、`Number(snap.data.n)` 当场抛 `TypeError`，`MyMap` 的自定义方法直接消失。现在它们原样穿过克隆，**所以快照不再是这些节点的隔离副本**：需要隔离请用 `customCloner` 自己接管该节点（这是本库留的出口）
- 数组上的**附加自有键**（非下标、非 `length`）两条路径都跟着克隆，`length` 因不可配置而被排除

### `compareSnapshots` 报 `changed: true`，但 `changes` 里只有一条根路径差异？

看返回值的 `inputTrusted`（0.7.0 新增的**必填**字段）。只要有一侧快照 `success: false`（克隆出错、超时、被 `onError` 中止），比对就不再逐路径展开，而是交付一条 root 级整体差异并把 `changed` 置为 `true`——含义是「输入不可信，我不敢说没变」，不是「内容确有差异」。这是刻意反过来的口径：旧实现把两份失败快照报成 `changed: false`，把「快照没做成」伪装成「状态没变化」。所以顺序永远是：先判 `success`、再判 `inputTrusted`、最后才读 `changes`。

### 差异路径 `changes[].path` 怎么读？

与克隆账本 `errors[].path` 同一份方言：对象属性 `parent.child`、数组下标 `parent[3]`、`Map` 的**值差异** `parent.<String(key)>`、`Map` 的**键新增 / 删除** `parent.key.<String(key)>`（0.7.0 起按**键身份**生成，不再用两侧各自的迭代下标，所以同一条差异不随插入顺序漂移、双向比对给出同一条路径；`Symbol` 键走 `String()`，`toString` 抛错的键退回 `<unstringifiable key>`）。`Set` 的 `[removed:i]` / `[added:i]` 里的 `i` 是**报告序下标、不是条目身份**（集合元素没有可当身份的键，对象元素 `String()` 恒为 `[object Object]`）——跨快照配对 `Set` 变化请读 `oldValue` / `newValue`。还在按 `root[0]` 这类下标聚合 `Map` 条目的消费方需要改成按键身份，见 [MIGRATION](./MIGRATION.md)。

### 时间旅行的 `getSnapshots()` 返回值可以修改吗？

支持的普通对象 / 数组 / Date / RegExp / Map / Set 会通过核心 `deepCloneState` 重新克隆，修改这些副本不会污染内部历史或后续恢复值，循环引用也受支持。但类实例、函数、Promise、WeakMap 等仍保留原引用，不要修改这些共享节点；它不是 `extras/snapshot` 的丢弃契约。

## 装饰器

### `withThrottle` / `withCache` 为什么返回了 `undefined`？

当方法**不是 `async` 语法但返回 Promise**（包装函数、手写 thenable）时，装饰器无从观测返回值。若首次调用即被抑制（`leading: false`）或命中缓存，它会按同步方法返回 `undefined`，而后续调用却真的返回 Promise——调用方 `await` 就可能崩。

处理：显式声明异步语义。

```ts
withThrottle(200, { assumeAsync: true })
withCache({ ttl: 30_000, assumeAsync: true })
```

### 同一个装饰器实例用在多个方法上会串数据吗？

不会。`withCache` / `withDebounce` / `withThrottle` 按**宿主与方法**隔离，支持类静态方法（函数宿主）；不同 Symbol 即使描述相同也互不干扰。防抖 / 节流保留原始方法键身份，缓存按每次装饰独立编号；`withLoading` 的引用计数按 (宿主, loading 键) 集中，多装饰器并发不会提前翻转 `loading`。

### `withThrottle` 的间隔参数写在哪里？

```ts
withThrottle(100, { leading: true, trailing: true }) // 间隔是第一个位置参数
```

默认 `leading` 与 `trailing` 均为 `true`：窗口结束时以**最新参数**补发被抑制的调用。

### 自定义装饰器（`createDecorator`）把同步方法变成返回 Promise 了？

0.6.0 起不会。`createDecorator` 只在被装饰方法返回 Promise（或 `before` 回调返回 Promise）时才让调用返回 Promise，同步方法保持同步返回；`before` / `after` 的异步返回被接续而非并发执行，rejection 不再变成 unhandled rejection。`onError` 收到的是规范化后的 `Error`，它自身抛错只记一条日志、不会顶替原始失败。装饰访问器（`get` / `set`）在装饰阶段就抛 `TypeError`。

### 宿主（页面 / 组件）卸载了，挂起的防抖 / 节流调用怎么办？

自己会到点执行——排程中的定时器回调持有宿主与状态直到窗口 / 延迟到期，期间宿主不可被回收，到点后它照常调用被装饰方法（通常是往已销毁的 Store 里写，抛 `Cannot call … on a destroyed Store`）。0.6.0 起有六个收尾入口，从 `@openlide/geomstore/extras/action` 引入：

```ts
import {
  withDebounce,
  withThrottle, // 装饰器本身
  cancelDebouncedCalls,
  flushDebouncedCalls,
  disposeDebouncedState,
  cancelThrottledCalls,
  flushThrottledCalls,
  disposeThrottledState,
} from '@openlide/geomstore/extras/action'

class SearchPage {
  @withDebounce(300)
  async search(keyword: string) {
    return fetchSearch(keyword)
  }

  @withThrottle(100)
  onScroll(position: number) {
    this.store.dispatch('setScroll', position)
  }

  onUnload() {
    disposeDebouncedState(this) // 挂起的搜索：取消并释放该宿主的防抖状态
    cancelThrottledCalls(this) // 挂起的尾随补发：丢弃（不执行原方法）
  }
}
```

- `cancel*` **丢弃**挂起调用，`flush*` **立即执行且只执行一次**（还想把最后一次输入落盘就用它；没有挂起调用时它不凭空执行），`dispose*` = 取消 **+** 释放该宿主的整张状态表（节流连窗口计时一起归零）。三者都幂等，卸载点「一切从简」可以只调 `dispose*`
- **被取消的 Promise 收到什么**：防抖挂起的每个 Promise 以 `Error('[withDebounce] pending call was cancelled')` 拒绝（`await` 方看得到；库只是先给它们补了个 `catch` 来消除全局未处理告警，没有替你吞掉）。节流的被抑制调用在**调用时刻**就已返回 `undefined`（异步方法或 `assumeAsync: true` 时是 `Promise<undefined>`），没有可取消的 Promise；尾随补发失败按既有口径就地 `console.error`
- 入口参数是**宿主**（`this`），不是装饰期发的句柄：`@withDebounce(300)` 这个表达式在类定义完就被丢弃了，卸载点手里只有实例。`method` 可选，省略即覆盖该宿主上所有被装饰方法
- **前提是那个 `this` 你拿得到**：装饰 **store action** 时六个入口一律静默 no-op，见下一条
- `withCache` 与 `withRetry` **没有**对应入口：缓存表随装饰器实例存活、退避等待定时器无法取消（理由见 CHANGELOG 的「Wave E 未收口的四项」）。对这两者，请在业务侧自判存活标记

### 我把 `withDebounce` 装饰在 store action 上，为什么 `cancel*` / `flush*` / `dispose*` 都不生效？

因为它们按「被装饰方法**被调用时**的 `this`」定位状态槽位，而 store action 的 `this` 是 `ActionManager` 为一次 dispatch 现造的 action 上下文代理：它只被那批绑定闭包捕获，不挂在 `store.actions` / `store` 的任何一个公开成员上，调用方没有任何对象可以传进去（`cancelDebouncedCalls(store.actions)` 与 `cancelDebouncedCalls(this)` 都命中空槽位，**不抛错、也不清定时器**——挂起的调用照旧到点执行）。这是 0.7.0 定稿的口径而不是待修缺陷：把那个上下文暴露出来，等于把「装饰器内部槽位键」升成跨 core 与 extras 的公开契约，换来的只是这组收尾入口在 store action 上可用。改写法即可拿到可寻址的宿主：

```ts
// ① 装饰页面 / 组件上的方法，让它去 dispatch（推荐：卸载点手里就有 this）
class CartPage {
  @withDebounce(300)
  submitDraft(draft: string) {
    return this.store.dispatch('saveDraft', draft)
  }
  onUnload() {
    disposeDebouncedState(this)
  }
}

// ② 想在 store 侧复用同一段防抖：自己包一层，让那一层的实例当宿主
class CartApi {
  @withDebounce(300)
  saveDraft(draft: string) {
    return cartStore.dispatch('saveDraft', draft)
  }
}
const cartApi = new CartApi()
cancelDebouncedCalls(cartApi) // 宿主是 cartApi 本身，槽位找得到
```

判别口诀：被装饰的方法由 `store.dispatch(...)` 触发 → 收尾入口不可用；由 `this.someMethod(...)`（页面 / 组件实例）触发 → 可用。`GUIDE` 第 3 节末是同一条口径的完整版。

## 插件与持久化

### 持久化没有生效 / 恢复后字段丢了？

- **后端必须同步且三方法齐备**：`getItem` / `setItem` / `removeItem` 缺任一方法都会在 `store.use()` 安装期抛 `TypeError`；返回 Promise 的实现会在恢复 / 落盘 / 清理时被明确拒绝并记日志（避免写入静默丢失）。小程序用 `new WxStorageBackend()` 或自封装同步实现；浏览器的 `localStorage` 恰好实现了这三个同步方法，可直接传
- **`new WxStorageBackend()` 自己是「缺 wx 就抛错」的**：`wx` 或对应的 `getStorageSync` / `setStorageSync` / `removeStorageSync` 缺失、非函数时三个方法都抛错，不会把 `?.` 短路成静默 no-op（旧行为下写删「看起来成功」、`clearOnUninstall` 误报已清除，读被洗成「键无数据」后一次落盘就覆盖真实数据）。插件路径不受影响——它先用 `isWxStorageSyncAvailable()` 探测，探测不过才降级内存；在非微信环境里直接 new 这个类才会炸，请改传自建后端
- **恢复被跳过**也编程可感知：后端抛错、JSON 语法错、解析结果不是可信纯对象（含自带 `__proto__` 自有键）、被 `validate` 拒收、`$patch` 被拒 —— 除 `console.error` 外统一 `emit('onError', error, 'persistence')`（改前只写控制台，只订阅 `onError` 的监控会漏掉这一类）
- 用 `filter` 指定落盘子集；用 `debounce` 控制写入频率（卸载时会同步补写窗口内最后一次变更）
- **不传 `storage` 时的默认后端就是 `WxStorageBackend`**（0.6.0 起两条路径同一份实现，此前是 `builtin.ts` 里的内联适配器）：`wx.getStorageSync` 对缺失键返回的 `''` 归一为 `null`（＝无数据），写入过非字符串载荷时也按无数据处理，不再被送去 `JSON.parse`。可用性判定要求 `getStorageSync` / `setStorageSync` / `removeStorageSync` **三方法齐备**——只有读方法的残缺 `wx`（部分兼容层）从「每次落盘抛 `TypeError`」改为走内存降级并给一次降级信号
- **恢复是合并语义**（走 `$patch`）：未被持久化的键保留初始值，不会被覆盖
- 用 `filter` 指定落盘子集；用 `debounce` 控制写入频率（卸载时会同步补写窗口内最后一次变更）
- 需要卸载即清理时用 `clearOnUninstall: true`（此时待写数据会被丢弃；删除失败会记日志并 `emit('onError', …, 'persistence')`，不再静默谎报已清除）
- 检测不到可用 wx 同步 API 时降级为内存存储，降级文案里的括号新增了「wx 同步 API 不齐备」一项（`未检测到可用的 storage 后端（非微信环境、wx 同步 API 不齐备，且未传入 storage）…`）；按文案匹配日志的调用方需同步

### 生产环境为什么看不到插件日志？

`NODE_ENV=production` 下插件安装 / 卸载、子 store 竞态等路径**静默**（仅开发模式打日志）。这是刻意设计，排查时临时切到开发模式即可。

但**静默不等于没有信号**：需要被监控发现的问题都改走 `onError` 钩子——持久化降级为内存后端、**恢复被跳过**、订阅回调抛错、落盘 / `clearOnUninstall` 失败、action 收尾链路自身抛错，都会 `store.hooks.emit('onError', error, source)`。**订阅者被驱逐也在这一列**：达到 `maxSubscribers` 触发 `evict-oldest` 时会发一次 `Error`（第二参 `'subscribe'`，消息带被驱逐监听器的名字与上限），此前生产完全静默、被挤掉的订阅者收不到更新却无从定位。生产环境请给 `onError` 挂上报处理器。

### 插件安装失败会留下半成品吗？

不会。`store.use(plugin)` 在 `install` 抛错时会回滚入列，重试不会累积重复条目。`usePlugin(plugin, store)` 是等价的独立函数，泛型从 `store` 反推、**无需断言**（插件需与其状态类型匹配；状态无关的插件写作 `Plugin<State>`）。

## 集成与工程

### 小程序里 `require` 报错？

包已切换为**纯 ESM**：请使用 `import`。若你的构建链路仍产出 CJS，请在打包器侧做转换。

### 组件里收不到 `attached` / `detached`？

组件生命周期必须写在 `lifetimes` 字段内（基础库 3.15.0+）；写在配置顶层的 `attached` / `detached` 不会被调用。

```ts
withComponentStore(store, { mapState: ['count'] })({
  lifetimes: { attached() {}, detached() {} },
})
```

### 卸载钩子里还能调用映射的 action 吗？

可以在 `onUnload` / `lifetimes.detached` 的同步段调用。用户钩子先执行，绑定随后在 `finally` 中清理，即使钩子同步抛错也不会漏清理；包装器不等待异步钩子的 Promise，不要在 `await` 后依赖映射方法仍可用。**集成层只清订阅与映射**：宿主上被 `withDebounce` / `withThrottle` 装饰的方法若还有挂起调用，请在同一个钩子里显式收尾（`cancel*` / `flush*` / `dispose*`，见上文「宿主卸载了，挂起的防抖 / 节流调用怎么办？」）。

### 组件 / App 里要不要手写 `this` 类型？

**不需要**。三处集成都已注入 `this` 类型，方法内直接写即可：

```ts
// Store action：this 由 createStore 注入（state / setState / $patch / dispatch 等）
actions: { login(userInfo: string) { this.$patch({ userInfo, isLoggedIn: true }) } }

// Page：this.data（含 mapState / mapGetters）与 mapActions 注入的方法
onLoad() { if (!this.data.isLoggedIn) this.login('Ada') }

// Component：注入方法与 data（运行时 methods 会被提升到实例，this.add 与 this.methods.add 都可用）
methods: { onTapPlus() { this.add(1) } }

// App：this.globalData（含映射状态）与注入的 action
onLaunch(options) { console.log(this.globalData.appName); this.markLaunched(String(options?.scene ?? '')) }
```

三者的差别只在注入形态：`withPageStore` 的方法在顶层、`withComponentStore` 写在 `methods` 里（但实例上可平级调用）、`withAppStore` 的状态落在 `globalData` 上。

**别手写 `this` 标注**：它会覆盖集成层注入的类型。例如写成 `onLaunch(this: { globalData: { appName: string } })` 会把 `globalData` 收窄回字面量类型、丢掉映射进来的状态键；而 `this: AppOptions` 之类会让 `globalData` 退回可选。

### `@openlide/geomstore/xxx` 解析不到？

- 先确认该子路径在 `exports` 映射中（`core`、`extras`、`extras/*`）
- 微信「构建 npm」解析的是包内 `miniprogram` 字段指向的 **`dist-weapp/`**（按模块一比一转译的 CJS，105 个模块与 `dist` 一一对应，11 个公开子路径的入口文件齐备、导出面逐项一致），不是 `exports`、也不是 `dist`；构建 npm 后仍取不到某个子路径，先在 `miniprogram_npm/@openlide/geomstore/` 下数文件——应当是 **105 个 `.js`**、与 `dist` 同树；四条自检：① 该目录文件数 = `node_modules/@openlide/geomstore/dist-weapp` 的文件数；② 全目录搜 `outsideDeps` 必须无命中；③ 入口文件里每条相对 `require("./x.js")` 的目标都该在该目录内存在；④ 把 `index.js` 复制进一个只含 `{"type":"commonjs"}` 的 `package.json` 的目录后能被 `require` 且 `withPageStore` 等导出为函数。①③ 不满足就是产物缺文件，② ④ 不满足就是产物形态问题——两者都在发布方（本库）的 `pnpm run verify:weapp` 门禁覆盖范围内，出现即带信息来报 issue
- `@openlide/geomstore/{store,hooks,plugins,integrations}` 这类**转发子目录**由 `pnpm stubs` 生成，服务的是**其他**不解析 `exports` 的老式场景（它们指向 `dist` 里的 ESM，微信侧不走这条）；Node / 打包器请优先用 `extras/*`
- 注意 `bindMappings` 等底层绑定工具**不在主入口**，需从 `@openlide/geomstore/integrations` 引入（已在 `exports` 声明）；日常优先用 `withPageStore` / `withComponentStore` / `withAppStore`

### 主包体积变大了

最常见原因是引入了聚合入口 `@openlide/geomstore/extras`（它会把全部可选能力拉进产物）。改为按需子路径：

```diff
- import { createSnapshot, createSelector, withThrottle } from '@openlide/geomstore/extras'
+ import { createSnapshot } from '@openlide/geomstore/extras/snapshot'
+ import { createSelector } from '@openlide/geomstore/extras/selector'
+ import { withThrottle } from '@openlide/geomstore/extras/action'
```

### 报错 `Cannot call … on a destroyed Store`

Store 已 `destroy()`。销毁后除只读统计（如 `getCacheStats`、`isStateProtectionEnabled`）外的所有**写接口**都会抛错（`setState` / `$patch` / `$replaceState` / `subscribe` / `use` / `cache` / `batch` / `setStateProtection`）；请在销毁前完成收尾，或在使用前判断生命周期。独立函数 `usePlugin(plugin, store)` 走的是同一条 `store.use`，在已销毁 Store 上**同样抛出该异常**（它的降级只罩住「插件自身 install 失败」那一类，不再把误用咽成一条 `console.error` + 空卸载函数）。注意销毁不会注销 getter 定义：`store.getters` 返回的仍是初始化时登记的那份（`getter(name)` 则抛错、`getGetterNames()` 返回 `[]`）。

**组合 Store 是这条规则的唯一豁免，而且是 0.7.0 才有的**：组合之外的某个子 store 被单独 `destroy()` 后，`composed.getState()` / `composed.state` / `composed.$snapshot()` 不再抛 `Cannot call getState on a destroyed Store`——已销毁的那个被按**空视图**并入（它的命名空间变成空对象，不是缺失键），并按 store 去重**告警一次**，其余存活子店照常读写；0.6.x 的行为是「一个子店销毁 → 整个组合每次读取都抛错」，而同一时刻写路径（`$patch` / `$replaceState` / `startBatch` / `endBatch`）却早已在跳过死店，读写两侧口径不一致。0.7.0 把读侧并入写侧口径，因此：① 靠 try/catch 这个报错来发现子店被销毁的代码要改成看告警；② 别再把 `getState().child` 的存在性当存活判据（它在，只是空的）；③ 销毁整个组合仍然请走 `composed.destroy()`。

### 长期运行的进程内存持续增长 / 定时器不退出？

- `ErrorMonitoring` 的队列有容量上限（`maxQueueSize`，默认 1000、最小 1，超容量按最旧优先淘汰），「全部 reporter 连续失败」的重入队也有上限（`maxFlushRetries`，默认 3、最小 0）——避免永久失败批次无限空转。**被丢弃的条数是有指标的**：`getDroppedErrors()` / `summary.droppedErrors`，别把它当「总数对得上」的报表看。入参写 `0` / 负数 / `NaN` 会被下限裁剪，不再把上报链做成近乎静默失效
- `ErrorRecovery` 的重试键有容量守卫（`MAX_RETRY_KEYS = 1000`，先清自身周期窗已到期的键、再按插入顺序淘汰最旧），动态 operation id（如 `fetchUser:${id}`）不会导致无界增长
- 内部定时器做 `unref` 探测：小程序 / 浏览器无该 API 时自动跳过，不会阻止进程退出
- `PerformanceMonitor` 清理超时未结束的在途计时条目（调用方遗漏 `end()` 时的兜底）：`record()` 与 `start()` 都会顺手清扫，「反复 start、从不 end、也不再 record」的调用形状下在途条目同样不会永久堆积
- `PerformanceMonitor.record(metric)` **不持有你传入的那个对象**：入参先被拷一份再入缓冲区，之后你改它（或复用同一个对象连续 record）都不会改写已记录的历史指标；`getMetrics()` / `exportJSON()` 交出的也是副本
- 防抖 / 节流的**挂起定时器会拖住宿主**：排程中的回调持有宿主引用直到窗口 / 延迟到期。宿主状态表本身是 `WeakMap`（宿主回收即消失），但没人清定时器时宿主就回收不了——请在卸载点调 `cancel*` / `dispose*`（见「装饰器」一节）。前提是被装饰的方法有可寻址宿主：装饰 **store action** 时这六个入口定位不到槽位、静默 no-op（同节「为什么 `cancel*` / `flush*` / `dispose*` 都不生效？」给了替代写法），那种挂起定时器只能等窗口 / 延迟自然到期

### 为什么同一个功能在同步和异步路径行为不同？

**不应该**——除了少数写在契约上的差别。若你发现差异，请提 issue 并附复现；本项目把「两条路径同语义」当作契约，例如快照的 `customCloner` 抛错语义已收敛为同一实现（落账 → 咨询 `onError` → 继续丢子树 / 中止抛错）、失败结果的 `stats` 两条路径都交实际累计值。刻意保留的一处是**深度**：同步 `cloneDeep` 是递归实现，生效上限是 `min(maxDepth, HARD_MAX_CLONE_DEPTH = 1000)`（栈深＝数据深度，必须有个与选项无关的硬上限）；异步 `clone-async` 走任务队列、栈深与数据深度无关，因此只按你给的 `maxDepth` 判定、不叠加那个硬上限。同样 1500 层的数据，异步能克隆完、同步会在 1000 层处落 `maxDepth` 错误 + 占位，这是设计而非缺陷。

## 参与开发

提交前的门禁、测试与文档约定见 [CONTRIBUTING](../CONTRIBUTING.md)；版本迁移见 [MIGRATION](./MIGRATION.md)。
