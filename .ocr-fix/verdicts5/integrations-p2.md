# 分片 integrations-p2 — 微信小程序 Page/Component/App 接入层（10 条）

清单：`.ocr-fix/groups5/integrations-p2.md`。可改源码：`src/integrations/utils.ts`、
`src/integrations/with-store.ts`、`src/integrations/with-app-store.ts`。
回归锁：`tests/unit/r5-integrations-p2.test.ts`（29 例）。

验证顺序：先只提交回归用例、不改源码，跑一次修复前基线 ——
`npx jest --ci tests/unit/r5-integrations-p2.test.ts` → `Tests: 21 failed, 8 passed, 29 total`，
十条 finding 每条至少一例红（失败断言里带修复前的实际值，下文「修复前实测」即指这些输出）；
随后落源码修复，`tests/unit/integrations tests/integration tests/unit/r5-integrations-p2.test.ts` →
`323 passed`（既有 294 例断言无需同步），三处被改文件在该套件下语句/分支/函数/行覆盖率均 100%。

### R5-276  verdict=FIXED  bindMappings 的三个累积器按自有属性写入，`__proto__` 映射不再被静默丢弃

修复前实测：`bindMappings({}, {count:'count', ['__proto__']:'user'}, ...)` 的 setter 一次都没被调用
（回归断言 `expect(patches).toHaveLength(1)` 收到长度 0）——
`prevValues['__proto__']=对象值` 命中 `Object.prototype` 的 setter 改了原型，
`initialValues` 因此零键、`Object.keys().length > 0` 不成立，整条映射被静默丢弃；
后续通知里该键也永远比不出变化。
改为把 `setOwnEntry` 泛化成 `setOwnEntry<T>`，`prevValues` / `updates` / `initialValues` 三处统一走它。
同口径外扩两处同文件同类写入：`performAutoInject` 的 `updates`（目标键由用户配置）、
`with-store.ts` 里 Component 的 `boundMethods[localName] = fn`（`__proto__` 作本地方法名时该 action 静默消失）。
API-CHANGE: 本地键为 `'__proto__'` 的映射此前被静默丢弃，现在会进入 setData / globalData 载荷；
App 侧写 globalData 因此从 `Object.assign` 改为 `copyOwnEntries`（新增的 utils 内部助手），
避免 `[[Set]]` 把该键变成宿主对象的原型。唯一的非 `__proto__` 差异：宿主在 globalData 上放的
「只有 getter 的同名访问器」此前会让 `Object.assign` 抛 TypeError，现在按 defineProperty 覆写为数据属性
（与 #346 之后 bindActions 对宿主成员的口径一致）；冻结的 globalData 仍然抛错并原样抛给框架，
`autoUpdateOnShow` 的 onShow 包装器用 try/finally 保证用户 onShow 不被注入失败吞掉（见 R5-290）。

### R5-277  verdict=FIXED  bindActions / exposeStoreAPI 以描述符为单位覆盖与还原，不可重定义成员改为跳过

两条实测：宿主有 `get getState()` 时 `unexpose()` 后描述符只剩 `value`（访问器被降级成数据属性，
回归断言 `expect(typeof restored?.get).toBe('function')` 修复前收到 `'undefined'`）；
宿主 `Object.defineProperty(target,'store',{value:…, writable:false, configurable:false})` 时
`exposeStoreAPI` 在第一行写入就抛 `TypeError: Cannot assign to read only property 'store'`
（回归断言 `.not.toThrow()` 修复前失败）——六个调试 API 一个都没挂上、也没有 unbind 可拿，
`withAppStore` 的 onLaunch 直接中断在 exposeStoreAPI 上。
新增 `canOwnKey`（无自有属性看 `isExtensible`；有自有属性看 configurable，非 configurable 数据属性只看 writable）
与 `defineOwnValue`（不可配置原成员沿用其 configurable/enumerable，只改值），
`exposeStoreAPI` 改为「单一 members 表 + 逐键判定 + originals 存 PropertyDescriptor + added 单独记账」，
跳过的键汇总一条告警且不参与还原；`bindActions` 同口径（快照改存原描述符，还原时整体回放）。
API-CHANGE: 两个函数不再对不可重写的宿主成员抛错中断整批注入，而是跳过该键并告警；
`exposeStoreAPI` 的写入由 `Object.assign`/属性赋值改为 defineProperty，
宿主仅有继承来的同名访问器时不再触发其 setter，而是落下自有成员。

### R5-278  verdict=FIXED  resolveMappings 的 injectMapping 也走 parseMapping，返回副本

修复前实测 `resolved.injectMapping === options.injectMapping` 为 true（另三项是新对象），
调用方改解析结果会回灌用户 options。改为 `options.injectMapping ? parseMapping(...) : {}`，
键值原样保留（该字段本就是 `Record<string,string>`，parseMapping 的 key→value 语义一致）。
行为影响仅一处：`options.injectMapping` 为 `{}` 时从「同一个空对象」变成「新的空对象」，无观察差异。

### R5-285  verdict=FIXED  App 接入 autoUpdateOnShow：onShow 重新注入 globalData

修复前实测：`autoUpdateOnShow: true` 时 App 的 `onShow` 仍是用户原函数（未被包装），
`store.setState('config', {v:7})` 后调 `app.onShow()`，`globalData.appConfig` 依旧停在 `{v:1}`
（回归断言收到 `{v:1}`）—— `performAutoInject` 只在 onLaunch 跑一次，
onLaunch 时尚无缓存的键（异步 action 写入的 config）在 globalData 里永久缺失、无重试路径。
按报告的第一条出路接线：`autoUpdateOnShow && autoInject && 有注入条目` 时包装 App `onShow`，
`globalData` 未建立（未经 onLaunch 直接调用）时跳过注入但仍转发用户 onShow；抛错保护见 R5-290。
API-CHANGE: `autoUpdateOnShow` 对 `withAppStore` 生效（此前只对 Page/Component 生效）。

### R5-286  verdict=FIXED  App 的 bindActions 退订凭证登记进 unbindFunctions

修复前实测：宿主本没有 `increment` 成员，两次 onLaunch 仍产生 1 条 `宿主已有成员 "increment"` 告警
（回归断言 `expect(warnSpy).not.toHaveBeenCalled()` 修复前收到 1 次调用）——
第二次 launch 把自家上一轮绑定的 action 当成宿主成员，快照也被覆盖成绑定函数、用户原方法再也回不去。
改为 `unbindFunctions.push(...bindActions(...))`，
既有的重复绑定守卫（`if (unbindFunctions.length > 0) cleanupBindings(...)`）顺带覆盖 actions。
真宿主成员的场景不变：每次 launch 各一条告警（清理时还原用户原值，第二次仍是合法的覆盖告警）。

### R5-287  verdict=FIXED  globalData 被映射覆盖时告警（只查首次 onLaunch）

修复前实测 `globalData:{theme:'light'}` + `mapState:['theme']` 得到 `theme=dark`、告警 0 条。
新增模块内 `warnOnGlobalDataCollision`，在确保 globalData 存在后、绑定前对 state+getters 的本地键
做 `hasOwnProperty` 检查，命中则一条汇总告警点名键并写明「store 为唯一事实来源」。
用 `collisionWarned` 只判一次：之后 globalData 里的映射键是自家写入的，重复 onLaunch 不该刷告警
（否则会与 R5-286 的「重复启动不产生噪声」相互打架）。
API-CHANGE: 新增一条 `[withAppStore] globalData 已有成员 ... 将被 store 映射值覆盖` 告警。

### R5-288  verdict=FIXED  Page onLoad / Component attached 重入时先清理旧订阅

修复前实测同一实例两次 `onLoad` 后，一次 `setState` 触发 2 次 setData（两条订阅都活着），
列表还会累积到 onUnload。改为与 withAppStore 同款守卫：`if (this.__geomUnbinds) cleanupBindings(...) else this.__geomUnbinds = []`
—— `cleanupBindings` 清空同一数组，故 `unbindFunctions` 引用不变，onUnload/detached 仍能拿到它。
Component 的 `attached`（同一缺陷形态，报告只点了 Page 一处）一并按同一口径改。
既有 `onLoad → onUnload → onLoad` 路径不受影响（清理后列表已空）。

### R5-289  verdict=FIXED  注入守卫改判「有无条目」，无内容时不安装包装器

`resolveMappings` 恒返回对象，故 `options.autoInject && injectMapping` / `autoUpdateOnShow && autoInject && injectMapping`
的真值判定等于没判定：修复前 `injectMapping: {}` 时 Page 的 `onShow` / Component 的
`pageLifetimes.show` 仍被替换成包装器（回归断言 `expect(config.onShow).toBe(originalOnShow)` 修复前收到包装函数）。
三个入口各加 `const hasInjectMapping = Object.keys(injectMapping).length > 0` 并纳入全部四处判定
（Page onLoad/onShow、Component attached/show、App onLaunch/onShow）。
观察差异只有一处：无注入条目时 `enhancedConfig.onShow` / `pageLifetimes.show` 保持用户原函数身份（不再被包装）。

### R5-290  verdict=FIXED  注入包装器统一 try/finally，用户生命周期不再被吞

修复前实测：`setData` 抛错时 Component 的原始 `show` 从未执行（回归用例
`expect(originalShow).toHaveBeenCalledTimes(1)` 修复前即失败），
而 onUnload/detached 早就写明「即使用户生命周期抛错也必须……」的同一条承诺。
Page `onShow`、Component `pageLifetimes.show` 以及 R5-285 新增的 App `onShow` 三处
一律 `try { performAutoInject } finally { 转发原生命周期 }`；错误仍原样抛给框架，不静默吞。

### R5-291  verdict=FIXED  绑定阶段抛错：回滚已登记订阅 + 告警 + 抛回框架，不转发用户生命周期

修复前实测：`mapState` 已订阅成功后 getters/注入抛错，`__geomUnbinds` 剩 1 条、
此后每次 `setState` 仍在向半初始化实例推数据（回归用例的
`expect(instance.__geomUnbinds).toHaveLength(0)` 与 `expect(setData).not.toHaveBeenCalled()` 修复前均失败），直到 unload。
Page onLoad、Component attached、App onLaunch 三处的绑定段整体包 try/catch：
失败即 `cleanupBindings(本次列表)` + `[with*Store] 绑定映射失败，已回滚本次登记的订阅` 告警 + `throw error`。
取报告的第二条出路（回滚后抛错），**不**转发用户生命周期：映射未就绪的实例上跑 onLoad/onLaunch
只会产出第二个更难归因的错误，而原错误本来也就会抛给框架 —— 与修复前的可观察差异只有「回滚 + 留痕」。
App 侧此前 `exposeStoreAPI`/`onLaunch` 在异常路径完全不可控，现同样落在 try 内（失败即不暴露调试 API）。
API-CHANGE: 绑定阶段抛错时新增一条 `[withPageStore]/[withComponentStore]/[withAppStore]` 告警并回滚订阅；
Component 的 methods 合并并入同一 try 段（失败时不再留下「方法已合并但无订阅」的中间态）。

## 主控需知

- 三处被改文件在 `tests/unit/integrations + tests/integration + 本分片回归` 下四项覆盖率均 100%，
  无需给门禁放行；`npx tsc -p tsconfig.json --noEmit` 对 `src/integrations/**` 无报错。
- 既有测试**没有一条需要改**（294 例全绿），故本分片未触碰 `tests/unit/hot-round5.test.ts` 等禁改文件。
- 未采纳「只给 Page/Component 加守卫、App 保持原样」的最小改法：R5-285/286/287/289/290/291 的
  理由都是「与 withPageStore 同口径」，App 半边不补齐会留下第二套生命周期约定。

### NEEDS-MAIN: src/types/integration.ts（plugins-types-p2）`ConnectOptions.autoUpdateOnShow` 注释已过期

现文案「是否在页面onShow/组件attached时更新注入（默认仅在OnLoad时）」两处不准：
组件侧实际挂的是 `pageLifetimes.show`（不是 attached），且 R5-285 后 App `onShow` 也生效。
建议改为「页面 onShow / 组件 pageLifetimes.show / App onShow 时按 getCached 重新注入（需同时开 autoInject）」。

### NEEDS-MAIN: src/types/integration.ts（plugins-types-p2）`AppThis` 文档块对 exposeStoreAPI 的描述已过期

该块写着「exposeStoreAPI 是无条件 `Object.assign` 覆写（utils.ts:369-371，只在卸载时还原原值）」，
R5-277 后是「按自有属性 defineProperty 写入、不可重定义成员跳过并告警、还原按原描述符回放」。
六个键的 `Omit` 避让策略不变，只需要同步措辞与行号。

### NEEDS-MAIN: docs/API.md、CHANGELOG、skill references（文档越界，Wave D 统一同步）

需记录三项对外行为：① `autoUpdateOnShow` 对 `withAppStore` 生效；② 新增三类告警
（globalData 覆盖、绑定失败回滚、宿主成员不可重定义跳过）；③ `exposeStoreAPI` / `bindActions`
对不可重写成员改为跳过而非中途抛错。
