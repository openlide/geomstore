# 核心语义与易误用点

> [`../SKILL.md`](../SKILL.md) 的长尾参考（核心：主入口 / `core`），只写「会影响你怎么写代码」的结论，变更背景见仓库 `CHANGELOG.md`；精确签名先看 [`api/index.md`](./api/index.md) 的入口一览再按需打开（主入口 `.` 的完整声明在 [`api/main.md`](./api/main.md)），默认值与设计意图查仓库 `docs/API.md`。

## 目录

- [1. 写入路径与状态保护](#1-写入路径与状态保护)
- [2. 订阅与通知](#2-订阅与通知)
- [3. Getter](#3-getter)
- [4. 内置缓存](#4-内置缓存)
- [5. Store 组合](#5-store-组合)
  - [构造期校验](#构造期校验)
  - [读写路径](#读写路径)
  - [子店生命周期](#子店生命周期)
  - [缓存与脏键](#缓存与脏键)
  - [订阅与冻结](#订阅与冻结)
- [6. 插件、调试表与持久化](#6-插件调试表与持久化)
- [7. 小程序集成细节](#7-小程序集成细节)

---

## 1. 写入路径与状态保护

**状态只能经 action 修改**。合法写法：action 内 `this.state.xxx`、`this.setState(k, v)`、`this.$patch(partial)`、`this.$replaceState(next)`，或 store 侧 `store.setState` / `store.$patch` / `store.$replaceState` / `store.$restore`。

禁止 `store.state.xxx = value`：开发模式直接抛错；生产模式由 `stateProtection.productionHandler` 决定——`'warn'`（默认，告警后放行）、`'silent'`（静默放行）、`'error'`（抛错）。**绕过 action 的写入不触发订阅通知。**

**冻结 / 不可写属性是明确豁免**：状态树里「既不可配置也不可写变」的自有数据属性（`Object.freeze` 子树、`defineProperty(writable:false, configurable:false)` 的节点）拿到的是**裸引用**——Proxy 的 `[[Get]]` 不变量要求原样返回该值。这类属性**读得到，但不受写保护、不标脏、不推版本、不通知**，且**不会**因写入而抛错。

- 常见来路：`setState('user', otherStore.$snapshot().user)`（快照是深冻结的）、`setState('cfg', Object.freeze({ inner: { a: 1 } }))`
- 要保护与追踪生效：把状态放**可配置 / 可写**的属性上，或整体 `setState` / `$patch` 替换
- 判可写请显式 `Object.isFrozen`

**非普通实例的方法绑定原始接收者**：类实例、类型化数组的成员方法在读取时绑定的是原始对象，方法体内的写入**不经过**代理陷阱（属已声明的契约外写入）。类实例与 TypedArray 的属性 / 元素写入仍正常标脏，实例方法调用按保守策略标记所属顶层键；`#private` 与内部槽位可用。

**原型链敏感键**：`setState('__proto__', v)` 以及 `'constructor'` / `'prototype'` 走 **DefineOwnProperty**，与 `$patch` / `$replaceState` / `deepMerge` 同口径——只承载一个**自有数据属性**，原型不动。

- 读回自己写进去的值用 `Object.getOwnPropertyDescriptor(state, '__proto__')`；`state.__proto__` 这个表达式仍命中 `Object.prototype` 上的访问器、返回的是原型
- 值非对象时该次写入「什么都没改」，不推进变更计数 / 脏键 / 通知
- 状态键**可以**合法叫 `__proto__`（库内多处专门写了 defineProperty 守卫），但键名来自外部（服务端下发 / 用户输入 / `JSON.parse` 载荷）时**仍要在入口做白名单收敛**

**`$patch` 的等值短路**：`$patch({})` 与「补丁值与当前状态逐字相同」不计数、不标脏、不写缓存、不调度通知——与 `setState` 同一条 `Object.is` 判据。这直接影响 `notify.onlyOnChange`（其唯一判据就是变更计数）。

## 2. 订阅与通知

**引用计数**：同一函数注册 N 次就通知 N 次；每个退订句柄只抵消自己那一次注册，重复调用同一句柄无效；句柄按注册标识精确退订。

**监听器签名**：`(state) => void`，**只有一个参数**（新状态），没有 `prevState`。需要前后对比请在闭包里自行保存。

**额度与驱逐**：`maxSubscribers`（默认 50）是**每一次注册**都过的硬上界，重复注册同样占额度。达限时按 `subscription.onLimit` 处置：

- `'evict-oldest'`（默认）：驱逐一份最早注册——本次是重复注册时让位该监听器自己最早的那一份——并向 `onError` 发一条事件
- `'throw'`：直接抛错

额度语义三条：

- 常态是 `size() <= maxSubscribers`
- 唯一例外：`maxSubscribers <= 0` 配 `'evict-oldest'` 时在册为零、无可驱逐对象，首个订阅仍会成功
- `maxSubscribers` 构造期归一化：非有限值回落默认 50 并出开发期告警；有限值 `Math.floor`；`0` 与负数按既有语义保留

**回调抛错被逐个隔离**：不影响其余监听器；开发模式打印，生产模式经 `onError` 钩子上报。本轮派发的是**进入通知时在册**的注册，回调内退订自己仍会收到最后一次。

**通知载荷按订阅者构成决定**（`notify.clone`）：

| `notify.clone`           | 行为                                                       |
| ------------------------ | ---------------------------------------------------------- |
| 未配置（默认） / `false` | **自动**：全部订阅者只读时零拷贝，存在可写订阅者时本轮拷贝 |
| `true`                   | 强制拷贝，即使本轮只有只读注册                             |

- 零拷贝给的是什么：状态保护开启给只读 Proxy、关闭给**原始引用**（回调需自行保证不写）；`true` 且全只读时是共用的那一份
- **拷贝份数按注册的可写性分配**：可写注册各拿一份独立深拷贝、只读注册共用一份——一次 dispatch 可产生 N 份克隆（N = 可写注册数，由 `maxSubscribers` 封顶）
- **拷贝载荷覆盖符号键**：`deepCloneState` 枚举自有可枚举键时含符号键，所以 `setState` / `$patch` 写进去的符号值在可写订阅者的载荷里读得到（早前只认字符串键，会出现「`getState()` 有、通知载荷里没有」的不对称）
- **「不写状态的订阅」要老实标 `readOnly: true`，这是大状态下最主要的通知开销开关**

**异步 action 在两个时点各补发一次**：返回 thenable 时，**同步段结束时当场补发一次**（覆盖第一个 `await` 之前的写入），settle 时再补发一次（覆盖续段变更）。

- **默认模式下「同步段有写入且最终 settle」的 action 通知数是 2 次**；`notify.onlyOnChange` 会按变更计数自动去重成 1 次
- 别在订阅里假设「一次 dispatch 恰好一次通知」；按通知次数写断言的测试要把期望改成 2
- 同步段没写入不多刷；`batch` 期间不提前通知
- 这条兜底换来的是：Promise **永不 settle**（悬挂的请求、被吞掉的回调）时同步段的写入当场可见
- **嵌套 dispatch 仅最外层通知**；reject 失败形态也会先补发 `onError` 钩子

**批量**：`batch(fn)` / `startBatch()` / `endBatch()`（支持嵌套，仅最外层收尾时通知）。批保护**只覆盖同步段**——异步回调 `await` 之后的变更逐条通知（开发模式有告警）。action 体内调用 `batch()` 时通知统一延迟到 dispatch 收尾补发一次。

**脏键追踪**：action 内 `this.state` 的对象 / 数组与 Map / Set 写入在两种通知模式下都会标记顶层脏键（共享别名可能标记多键）。在同步订阅回调内读 `isStateKeyDirty(key)`（`key: string | symbol`），通知结束后脏键清空（回调内重入写入的脏键留给下一轮）。`$replaceState` 会把**被这次替换删掉的旧键**一并标脏。

- `getState()` 裸引用与 Date / RegExp / WeakMap / WeakSet 的内部变异**不受追踪**，请显式替换值
- 归属索引按需求建一次：标量写入 O(1)，删边类写入走一次全量重建
- **删边类**写入的清单：覆盖已有的对象值、`delete` 对象值键、`Map#set` 覆盖值已是对象的键、`Map` / `Set` 的 `delete` / `clear`。高频循环里倾向「追加 / 换引用」，别反复原地替换同一批对象

## 3. Getter

- getter 是**纯函数**：`(state) => value`，**只接收 state**，需要组合时在函数体内自行计算
- **没有任何结果缓存**：每次 `store.getter(name)` / 每次读 `store.getters.x` 都重新执行一遍——Store 层没有版本号比较、没有记忆表、没有缓存键
- 所以「依赖未变时会跳过」**不存在**：不纯的 getter（发请求、写状态）副作用**每次读取都真的发生**，连续读同一个 getter 就是连续重算 N 次
- 要「依赖未变则复用」请用 `extras/selector` 的 `createSelector`（失效凭证 = 状态对象身份 + 版本号，O(1)）
- Store 销毁后 `getter(name)` 抛错（`getters` 注册表本身不注销，读取入口有销毁守卫）

## 4. 内置缓存

```ts
const store = createStore({ name: 'app', state: () => ({ profile: {} }), enableCache: true, cacheKeys: ['profile'] })
```

- **唯一读取入口是 `getCached(key)`**——`getState()` / `store.state` **完全不查缓存**。用它们验证缓存是否生效时，`getCacheStats()` 的 `hits` / `misses` 会恒为 0（不是缓存坏了，是没走它）。集成层的 `autoInject` 走的就是 `getCached()`
- **写路径是写穿而不是失效**：`setState` / `$patch` 把新值直接写进条目，写完再 `getCached` 仍命中且拿到新值；`$replaceState` 先整表清空再按新状态回填
- 要真失效用 `invalidateCache(key?)`（不传即整表清空）
- `cacheConfig.enableStats` **默认就是 `true`**：显式传 `true` 不打开任何东西；性能敏感场景传 `false` 关掉计数（代价是命中率无从观测）
- action 完成刷新时会移除已 `delete` 的键
- 需要自有策略时直接用 `LRUCache`（容量淘汰 + TTL）；`LRUCache.forEach` 的回调内删除 / 重排都不会漏访问未删条目、也不会回调已删条目；遍历期间**新写入**的键本次不访问；值取回调时刻的当前值

## 5. Store 组合

```ts
const root = composeStore([userStore, cartStore], { namespace: true, strict: true })
root.dispatch('userStore/login', payload) // 命名空间模式用斜杠路径
root.$patch({ 'userStore/name': 'Alice' })
```

### 构造期校验

- **`ComposeOptions` 只有 `namespace` 与 `strict` 两项真在生效**。`lazy` / `tree` 与类型 `NamespaceConfig` 是**「已声明、未实现」项**：三名都在公开类型面上，但**运行时零消费方**，写了编译通过、**静默无效**——不要按它安排懒加载或前缀策略。命名空间分隔符在实现里硬编码 `'/'`（无 `separator` / `autoPrefix` 参数）
- **命名空间模式下 `store.name` 同时是路由键**，构造期一次性校验：名字为空串或含 `'/'` 直接**抛错**。平铺模式不用 `name` 路由，只开发模式告警。名字为 `'__proto__'` 合法

### 读写路径

- 组合层 `getState()` / `state` 在批内与异步通知等待期间也校验子 store 版本；无版本号的子 store（含嵌套组合）每次读取保守失效
- `actions` 汇总子 action 名称，嵌套非命名空间组合可按裸名 dispatch；同名取第一个，命名空间模式仍用斜杠路径
- **非命名空间外层包含命名空间内层**时，内层键为「子 store 名/键」：写操作用完整斜杠路径（`flat.setState('leaf/count', 1)`、`flat.$patch({ 'leaf/count': 2 })`），构造期开发模式会提示；`$replaceState` 不支持该路径

### 子店生命周期

- **子 store 在组合之外被独立销毁后**：三条读路径（`getState()` / `state` / `$snapshot()`）与写路径同判据——该子 store 按**空视图**并入（其余照常可读）并按 store 去重**告警一次**。所以「整棵组合还读得动」**不等于**「所有子店都活着」：要判存活请显式读 `store.destroyed`，并把 `[composeStore] 子 store "x" 已销毁，读取按空视图处理` 当错误处理而不是噪音

### 缓存与脏键

- **组合层 `isStateKeyDirty(key)` 收 `string | symbol`**：只有命名空间模式的字符串键（即子 store 名）能精确判定；非命名空间模式、任何符号键、以及子 store 订阅失效的降级态都**保守返回 `true`**（方向性宁多勿漏）。别拿它当「未变化」的否定证据
- `composed.enableCache(keys)` 在命名空间模式下**按前缀解析归属**后只投递给被点名的那个店；`getCacheStats().keys` 回填 `'storeName/key'` 形式（平铺模式去重）

### 订阅与冻结

- 组合层 N 个监听器只占每个子 store 一份订阅（且是只读注册的）；组合层存在可写监听器时由组合层自己深拷贝一次载荷
- `composed.state` 顶层冻结、嵌套经子 store 保护代理，写入不会穿透

## 6. 插件、调试表与持久化

**插件契约**：`{ name, install(store) }`，`install` 返回卸载函数；`store.use(plugin)` 返回同一个卸载函数。插件已泛型化（`Plugin<S extends State = State>`）：

- `store.use(plugin)` 与 `usePlugin(plugin, store)` 传具体 Store **无需断言**；状态无关的插件写作 `Plugin<State>`（如 `loggerPlugin`）
- `store.use` 安装抛错会回滚入列，不留半安装插件；生产模式下安装 / 卸载日志静默

**钩子**：`store.hooks.on/emit` 供插件与监控接入（`beforeDispatch` / `afterDispatch` / `beforeSetState` / `afterPatch` / `onError` 等）。**精确的形参类型（`HookArgsMap`）在插件侧生效**——`install(store)` 拿到的 `Store` 接口上 `on('beforeDispatch', (name, args) => …)` 无需写 `unknown`；`createStore(...).hooks` 直连时字段声明为实现类 `HookSystem`，形参是擦除版。`emit` 的失败语义：逐个处理器 `try/catch`，不影响其余处理器、也不传播给 `emit` 调用方，先 `console.error` 再转投 `onError`（`onError` 自身抛错只落日志）。数处理器用 `hooks.listenerCount(name)`。

**持久化后端契约**：`storage` 必须**同步且三方法齐备**（`{ getItem, setItem, removeItem }`）——残缺或返回 Promise 的后端会在安装期 / 读写时**明确抛错**，绝不静默换后端。不传则先用 `isWxStorageSyncAvailable()` 探测 `wx` 同步存储，探测不过才降级内存存储（非生产 `console.warn`，**生产经 `onError` 上报**）。

- **接入微信请传 `new WxStorageBackend()`**——`wx` 全局对象本身没有 `getItem`，不能直接当后端用
- **直接 `new` 出来的 `WxStorageBackend` 在 `wx` 或对应 `*StorageSync` 方法缺失 / 非函数时抛错**（若静默短路，写删会「看起来成功」、读会被洗成「键无数据」）。降级**只发生在** `persistencePlugin` 的探测路径上
- 卸载时会**同步补写**防抖窗口内的最后一次变更；`clearOnUninstall: true` 则改为清理存储（删除失败记日志并 `emit('onError', …)`）
- **恢复失败**（后端抛错、JSON 语法错、解析结果不是可信纯对象、被 `validate` 拒收、`$patch` 被拒）除 `console.error` 外同样 `emit('onError', …, 'persistence')`：恢复值须为纯对象

**调试入口一律是 `globalThis` 上的表**，且**只在非生产环境挂载**：`isProduction()` 为真时注册直接返回 no-op，绝不往 `globalThis` 写内部引用，而插件本体照常安装。

| 插件               | 全局表                                                                 |
| ------------------ | ---------------------------------------------------------------------- |
| `devtoolsPlugin`   | `globalThis.__GEOMSTORE_STORES__`、`globalThis.__GEOMSTORE_DEVTOOLS__` |
| `timeTravelPlugin` | `globalThis.__GEOMSTORE_TIME_TRAVEL__`                                 |
| `analyzerPlugin`   | `globalThis.__GEOMSTORE_ANALYZER__`                                    |

- **读取前提**：表键是 `store.name`；没 `store.use()` 安装或表键拼错同样读不到
- **注册失败**：既有同名全局表若不是可扩展的对象（被 `seal` / `freeze`、被宿主占成函数或原始值），本次注册就地跳过并 `console.warn`——不抛错、不中断 `store.use()`
- **内部字段**：`store.__timeTravel__` / `store.__performanceMonitor__` 是插件挂上去的**内部字段**，不在 `Store` 类型上、也没有对外契约，别按它写业务代码
- **时间旅行隔离**：`getSnapshots()` 返回核心 `deepCloneState` 的副本，修改普通对象 / 数组 / Date / RegExp / Map / Set 不会污染历史或 `goTo` 恢复值；但类实例、函数、Promise、弱集合仍共享引用，**不要等同 extras/snapshot 的完全隔离 / 丢弃契约**

## 7. 小程序集成细节

三端集成函数**都从主入口引入**（`withPageStore` / `withComponentStore` / `withAppStore`）。配置方法内 `this` 类型**已自动注入**（`PageThis` / `ComponentThis` / `AppThis`），**不要手写 `this` 标注**——手写反而会覆盖集成层注入的类型。

**生命周期与清理**：

- Page 的 `onUnload` 与 Component 的 `lifetimes.detached` **先同步执行用户钩子，再在 `finally` 清理绑定**；钩子内可以调用映射 actions，抛错仍会清理
- 包装器**不等待 Promise**，`await` 后不要再依赖映射方法
- 组件生命周期必须写在 `lifetimes` / `pageLifetimes` 内；写在配置顶层的 `attached` / `detached` 不会被调用
- 映射的 action 自动并入 Component 的 `methods`
- App 级状态同步到 `globalData`，订阅**贯穿运行期**（不随 `onHide` 清理）
- 同页面多实例（同名页、列表项组件）的订阅清理由集成层挂在实例上（`__geomUnbinds`），无需手动管理
- `mapActions` 遮蔽组件自身同名方法时给一条告警、绑定期 action 优先、`detached` 后**恢复用户原方法**；App 侧 `globalData` 的覆盖告警覆盖面包含 `autoInject` 的注入目标键

**`autoInject` 与 `autoUpdateOnShow`**：

- `autoInject: true` 时用 `store.getCached(key)` 在挂载钩子里注入一次（值为 `undefined` 的键跳过并告警）
- 再开 `autoUpdateOnShow: true` 才追加 `onShow` 包装器（App 用 `onShow`、Page 用 `onShow`、Component 用 `pageLifetimes.show`）**每次回前台重新注入**——异步 action 之后才进缓存的键靠这条补齐
- **两个开关缺一不可**：只写 `autoUpdateOnShow` 或 `injectMapping` 为空时不装包装器
- 映射与注入的键都按**自有属性**写入宿主（`defineProperty`），`'__proto__'` 这类键不会被原型 setter 静默丢弃

**`./integrations` 子入口**额外导出底层绑定工具：`bindMappings` / `parseMapping` / `bindActions` / `performAutoInject` / `exposeStoreAPI` / `cleanupBindings`。日常用 `with*` 即可。
