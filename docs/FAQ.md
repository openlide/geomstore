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

### 异步 action 的通知次数和我想的不一样

统一规则（只有一条）：

- 异步 action 的**同步段不单独通知**，其变更由完成时（fulfill 或 reject）的补发覆盖一次
- `await` 之后的变更同样在结算时补发
- **嵌套 dispatch 仅最外层通知**
- 与 batch 交叉时由 batch 收尾统一通知

因此「同步段改一次 + 续段改一次」只会看到一次通知，这是刻意去重的结果。若你希望中间态可见，请在 action 内显式 `startBatch` / `endBatch` 之外单独写入，或拆成两个 action。

### `batch` 里 `await` 之后为什么不合并了？

批保护只在**同步段**有效——`await` 之后的变更会逐条通知（开发模式下有显式告警）。异步场景请让 action 承担合并职责，或在 `await` 之后重新 `startBatch` / `endBatch`。

### `isStateKeyDirty` 有什么用？

供集成层判断「自上次通知以来某键是否变化」，据此跳过无意义的 `setData`（小程序视图层更新是主要开销）。键型是 `string | symbol`——脏键集合按 `Reflect.ownKeys` 收集，symbol 顶层键同样有脏位可查（只收 `string` 会让它对集成层静默失效）。默认与 `onlyOnChange` 模式都跟踪 Action 内对象 / 数组 / Map / Set 的直接变异，标记所有受影响的顶层键（含别名，异步段累积到通知时）。Date 等其他内建对象的内部变异不被跟踪，请显式替换值。`$replaceState` 会把**被这次替换删掉的旧键**也标脏（消失型变更），否则视图会一直留着已删键的值。通知回调内的重入写入归下一轮。组合 Store 的命名空间模式下它会精确判断**子 store** 是否变化。

## 缓存与选择器

### 缓存命中率很低 / 选择器返回了陈旧值

- **命中率低**：只缓存热点键（`enableCache(['visibleRows'])`）；状态频繁整体替换（`$replaceState`）会让缓存反复失效
- **陈旧值**：选择器命中判定同时校验**状态对象身份与版本号**（O(1)，不同 Store 的同版本状态不会串值）；当状态不带版本号（例如你把普通对象直接传给选择器）时才回退 `equalityFn`（默认 `deepEqual`）比**输入状态**。此时失效凭证是写缓存时的一份**内容快照**（`snapshotState` 默认 `true`），所以就地变异能被看见；如果你自定义的 `equalityFn` 过于宽松（只比自有属性、或压根恒真），就会误命中——检查它是否真的能区分前后两版状态
- **升级到 0.5.x 后突然「永不命中」**（每次重算、但结果没错）：你传的是引用相等的比较器 `equalityFn: (a, b) => a === b` 却没关快照。旧实现靠「`equalityFn` 是否恰好等于内置 `deepEqual`」推断要不要克隆，该判据对自定义深比较器是错的，已改为显式选项：这种写法要补 `snapshotState: false`（缓存活引用、只比身份）。带版本号的 Store 状态不走这条回退路径，也不克隆

### `enableCache` 的 stats 会影响性能吗？

会带来少量开销（每次读写都要计数）。`cacheConfig.enableStats` 默认关闭，只在测量时开启。

## 快照

### 快照里为什么少了字段 / 出现了 `undefined`？

这是**隔离契约**的预期行为：无法安全克隆的节点一律**丢弃**，绝不把原始活引用兜底进结果。具体表现：

| 容器 | 丢弃时的表现 |
| --- | --- |
| 对象属性 | 该属性不写入 |
| 数组 | 保留位置（留洞，`1 in arr === false`） |
| `Set` | 不添加该元素 |
| `Map` | 跳过整条 entry |
| 根节点 | `data` 为 `undefined` |

排查方式：读 `result.errors`（每项含 `path` / `type` / `message`），并按需用 `customCloner` 接管该节点。`errors` 是**完整账本**：循环引用也入账（`type: 'circular'`）、`maxDepth` 超限同样落一条，但只有 `cloneError` 参与 `success` 判定，故 `success: true` 且 `errors` 非空是合法状态。存在 `cloneError` 时 `success` 为 `false`——**先看成功标志，再信任数据**（类型面上 `SnapshotResult<T>.data` 就是 `T | undefined`，不判空取属性直接编译报错）。整次快照异常或被告警中止时 `data` 是 `undefined`（失败结果不会回传活引用），别直接 `result.data.x`；失败结果里的 `stats` 是引擎累计到中止点的真实值，而 `metadata` 的规模项按零处理。

`onError` 按**真值**解释：不写 `return` 的箭头函数返回 `undefined`，等价于「拒绝继续」，会把整次快照做成失败。只想观测请显式 `return true`，或改用 `onProgress`（它抛错会被就地兜住、不影响结果）。

### `$snapshot()` 和 `createSnapshot()` 有什么区别？

| | `store.$snapshot()` | `createSnapshot(data)` |
| --- | --- | --- |
| 归属 | 核心 | `extras/snapshot` |
| 结果 | 深克隆 + **部分冻结**（纯对象 / 数组链只读；Date/RegExp/Map/Set 与非纯对象触达的节点仍可变） | `{ data, success, errors, metadata, stats }` |
| 错误处理 | 无账本（失败即抛） | 逐节点落账 + `onError` 降级策略 |
| 适用 | 需要只读副本 / 回滚点 | 需要错误可见性、进度、大对象分片 |

### 什么时候该用异步快照？

数据量导致单次克隆会阻塞主线程时。`createSnapshotAsync` 按 `batchSize`（默认 100）分片并在批间让出控制权，可配 `onProgress` 显示进度、`timeout` 限制总耗时。非法值不会再制造惊喜：`timeout` 的 `0` / 负数 / `Infinity` / `NaN` 一律按**不设超时**处理（`Infinity` 走 `setTimeout` 会被宿主夹成约 1ms、变成莫名的立即超时），`batchInterval` 同理按「无延迟」处理；`batchSize` 的 `0` / 负数夹到 1、非有限值回默认 100，不会再产出「`success: true` 但 `data` 是空壳」的半成品。异步路径走任务队列、不占调用栈，超过 1000 层的结构只能靠它。

### 快照能克隆类实例 / Date / Map 吗？

- 类实例：保留原型（快照后仍可调用原型方法）
- 访问器属性：以 getter 求值结果克隆（**不会二次触发** getter）
- `Date` / `Map` / `Set`：按类型正确克隆；循环引用检测始终生效（`detectCircular` 只控制是否**上报**）

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
withThrottle(100, { leading: true, trailing: true })   // 间隔是第一个位置参数
```

默认 `leading` 与 `trailing` 均为 `true`：窗口结束时以**最新参数**补发被抑制的调用。

### 自定义装饰器（`createDecorator`）把同步方法变成返回 Promise 了？

0.6.0 起不会。`createDecorator` 只在被装饰方法返回 Promise（或 `before` 回调返回 Promise）时才让调用返回 Promise，同步方法保持同步返回；`before` / `after` 的异步返回被接续而非并发执行，rejection 不再变成 unhandled rejection。`onError` 收到的是规范化后的 `Error`，它自身抛错只记一条日志、不会顶替原始失败。装饰访问器（`get` / `set`）在装饰阶段就抛 `TypeError`。

### 宿主（页面 / 组件）卸载了，挂起的防抖 / 节流调用怎么办？

自己会到点执行——排程中的定时器回调持有宿主与状态直到窗口 / 延迟到期，期间宿主不可被回收，到点后它照常调用被装饰方法（通常是往已销毁的 Store 里写，抛 `Cannot call … on a destroyed Store`）。0.6.0 起有六个收尾入口，从 `@openlide/geomstore/extras/action` 引入：

```ts
import {
  withDebounce, withThrottle,                              // 装饰器本身
  cancelDebouncedCalls, flushDebouncedCalls, disposeDebouncedState,
  cancelThrottledCalls, flushThrottledCalls, disposeThrottledState,
} from '@openlide/geomstore/extras/action'

class SearchPage {
  @withDebounce(300)
  async search(keyword: string) { return fetchSearch(keyword) }

  @withThrottle(100)
  onScroll(position: number) { this.store.dispatch('setScroll', position) }

  onUnload() {
    disposeDebouncedState(this)   // 挂起的搜索：取消并释放该宿主的防抖状态
    cancelThrottledCalls(this)    // 挂起的尾随补发：丢弃（不执行原方法）
  }
}
```

- `cancel*` **丢弃**挂起调用，`flush*` **立即执行且只执行一次**（还想把最后一次输入落盘就用它；没有挂起调用时它不凭空执行），`dispose*` = 取消 **+** 释放该宿主的整张状态表（节流连窗口计时一起归零）。三者都幂等，卸载点「一切从简」可以只调 `dispose*`
- **被取消的 Promise 收到什么**：防抖挂起的每个 Promise 以 `Error('[withDebounce] pending call was cancelled')` 拒绝（`await` 方看得到；库只是先给它们补了个 `catch` 来消除全局未处理告警，没有替你吞掉）。节流的被抑制调用在**调用时刻**就已返回 `undefined`（异步方法或 `assumeAsync: true` 时是 `Promise<undefined>`），没有可取消的 Promise；尾随补发失败按既有口径就地 `console.error`
- 入口参数是**宿主**（`this`），不是装饰期发的句柄：`@withDebounce(300)` 这个表达式在类定义完就被丢弃了，卸载点手里只有实例。`method` 可选，省略即覆盖该宿主上所有被装饰方法
- `withCache` 与 `withRetry` **没有**对应入口：缓存表随装饰器实例存活、退避等待定时器无法取消（理由见 CHANGELOG 的「Wave E 未收口的四项」）。对这两者，请在业务侧自判存活标记

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
- `@openlide/geomstore/{store,hooks,plugins,integrations}` 这类**转发子目录**是为微信「构建 npm」（不支持 `exports` 子路径）准备的，由 `pnpm stubs` 生成；Node / 打包器请优先用 `extras/*`
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

### 长期运行的进程内存持续增长 / 定时器不退出？

- `ErrorMonitoring` 的队列有容量上限（`maxQueueSize`，默认 1000、最小 1，超容量按最旧优先淘汰），「全部 reporter 连续失败」的重入队也有上限（`maxFlushRetries`，默认 3、最小 0）——避免永久失败批次无限空转。**被丢弃的条数是有指标的**：`getDroppedErrors()` / `summary.droppedErrors`，别把它当「总数对得上」的报表看。入参写 `0` / 负数 / `NaN` 会被下限裁剪，不再把上报链做成近乎静默失效
- `ErrorRecovery` 的重试键有容量守卫（`MAX_RETRY_KEYS = 1000`，先清自身周期窗已到期的键、再按插入顺序淘汰最旧），动态 operation id（如 `fetchUser:${id}`）不会导致无界增长
- 内部定时器做 `unref` 探测：小程序 / 浏览器无该 API 时自动跳过，不会阻止进程退出
- `PerformanceMonitor` 清理超时未结束的在途计时条目（调用方遗漏 `end()` 时的兜底）：`record()` 与 `start()` 都会顺手清扫，「反复 start、从不 end、也不再 record」的调用形状下在途条目同样不会永久堆积
- `PerformanceMonitor.record(metric)` **不持有你传入的那个对象**：入参先被拷一份再入缓冲区，之后你改它（或复用同一个对象连续 record）都不会改写已记录的历史指标；`getMetrics()` / `exportJSON()` 交出的也是副本
- 防抖 / 节流的**挂起定时器会拖住宿主**：排程中的回调持有宿主引用直到窗口 / 延迟到期。宿主状态表本身是 `WeakMap`（宿主回收即消失），但没人清定时器时宿主就回收不了——请在卸载点调 `cancel*` / `dispose*`（见「装饰器」一节）

### 为什么同一个功能在同步和异步路径行为不同？

**不应该**——除了少数写在契约上的差别。若你发现差异，请提 issue 并附复现；本项目把「两条路径同语义」当作契约，例如快照的 `customCloner` 抛错语义已收敛为同一实现（落账 → 咨询 `onError` → 继续丢子树 / 中止抛错）、失败结果的 `stats` 两条路径都交实际累计值。刻意保留的一处是**深度**：同步 `cloneDeep` 是递归实现，生效上限是 `min(maxDepth, HARD_MAX_CLONE_DEPTH = 1000)`（栈深＝数据深度，必须有个与选项无关的硬上限）；异步 `clone-async` 走任务队列、栈深与数据深度无关，因此只按你给的 `maxDepth` 判定、不叠加那个硬上限。同样 1500 层的数据，异步能克隆完、同步会在 1000 层处落 `maxDepth` 错误 + 占位，这是设计而非缺陷。

## 参与开发

提交前的门禁、测试与文档约定见 [CONTRIBUTING](../CONTRIBUTING.md)；版本迁移见 [MIGRATION](./MIGRATION.md)。
