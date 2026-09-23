# 分片 core-store-p1 · B 组（11 条）— 第五轮收口

范围：`src/core/store/StateProxy.ts`（R5-114~119）、`src/core/store/dirtyTracking.ts`（R5-155~159）。
A 组（Store/ActionManager/BatchManager/stateVersion/factory/index）由并行 agent 记账，见本文件外的台账。

前任两个 agent 在 150 回合上限断掉、未留台账；本台账由 B 组逐条对账后重建。
回归锁：`tests/unit/r5-core-store-p1-dirty-tracking.test.ts`、`tests/unit/r5-core-store-p1-state-proxy.test.ts`（前任建，归本组）。
锁定契约基线：`tests/unit/store/dirty-tracking-incremental.test.ts`、`dirty-tracking-performance.test.ts`、
`tests/unit/property/ownership-index.property.test.ts`（动手前先跑，改完必须仍全绿且归因不减）。

### R5-156  verdict=FIXED  集合迭代器三元嵌套改 if/else，行为逐分支等价

`dirtyTracking.ts` `collectionMethod` 的 `Symbol.iterator|entries|keys|values` 分支已按报告改成
`let iterator` + `if/else if/else`；三分支求值顺序与原三元表达式一致（`entries` 先判，故 Map 的
`Symbol.iterator` 仍走 `entries()`，Set 的 `keys`/`values` 仍走 `values()`），纯可读性、无行为变更。
`obj instanceof Map` 判断同期换成 `isMapLike(obj)`（R5-119 的跨 realm 口径，见该条）。
验证：`npx jest --ci --silent tests/unit/store tests/unit/property` 中
`dirty-tracking-incremental` / `ownership-index.property` 的 Map/Set 迭代断言全绿。

### R5-155  verdict=FIXED  写入分类补查原型链描述符，继承 setter 不再被判 EDGE_ADDED/STABLE

`dirtyTracking.ts` 新增 `inheritedDescriptor(obj, key)`（沿 `Object.getPrototypeOf` 走到 null），
`classifyWrite` 的访问器判定改为 `const effective = previous ?? inherited`，命中访问器即 `EDGE_REMOVED`
（= 写完 Reflect.set 后全量重建，重建发生在写入之后，能看到 setter 改掉的边）。
set 陷阱只在 `previous === undefined`（自有属性缺席，才可能命中原型 setter）时多走一次链查找；
`defineProperty` 走 [[DefineOwnProperty]] 不调 setter，故不传 `inherited`——`classifyWrite` 的文档注释
按这两条口径重写（原文只提「自有访问器」，与代码事实不符）。
不降归因：EDGE_REMOVED 是「重建后重新解析归属」，比原报告的顾虑更保守。
热路径代价：一次 `getPrototypeOf` + 个位数次 `getOwnPropertyDescriptor`，且只在写新键时发生；
`npx jest tests/unit/store/dirty-tracking-performance.test.ts` 两条 ownKeys 计数门限（<4000 / <20000）不变。
回归锁：`tests/unit/r5-core-store-p1-dirty-tracking.test.ts` R5-155 两条
（类实例原型 setter 摘边 ⇒ 报全部顶层键；原型上只有数据属性时仍走增量、不牵连其他键）。

### R5-157  verdict=FIXED  类实例方法调用改按 EDGE_STABLE 归因，去掉调用前的无条件重建

`invoke` 内 `report(obj)` ⇒ `report(obj, undefined, EDGE_STABLE)`，注释同步为「重建发生在
Reflect.apply 之前，看不到方法体新增的边，等于把整图原样再推一遍，是纯开销」。
归因不减少的依据：方法体的写入以原始对象为接收者、本就不走陷阱，改前改后都看不见它写了哪些边；
调用这次仍按当前索引标记所属顶层键，方法体新建的节点解析不出归属时由 report 的
「标记全部顶层键」兜底。版本一致性仍由 `report` 内的版本号比较保证（漏推版本才重建）。
实测：`r5-core-store-p1-dirty-tracking` R5-157 用例断言 3 次绑定方法调用后全量重建计数仍为基线 1
（改前是 4），`tests/unit/store/dirty-tracking-performance.test.ts` 的「preserves opaque class receivers」
（#private 字段场景）仍绿。第四轮 #176 的 reject 口径（宁多报不漏报）未被推翻。

### R5-158  verdict=FIXED  锁定数据属性的追踪空洞写成显式契约并加用例

`wrap` 的 get 陷阱在 `!configurable && !writable` 的自有数据属性分支上补注释：Proxy [[Get]] 不变量
要求原样返回该值 ⇒ 调用方拿到裸对象 ⇒ 之后对它的写入不标脏、不推版本、不通知，
并给出替代写法（放在可配置/可写属性上，或经 setState / $patch）。代码不改：包装会直接抛 TypeError。
回归锁：`r5-core-store-p1-dirty-tracking` R5-158 用例断言 `proxy.locked === locked`、
改其 `v` 后 `reports` 为空数组（把「不追踪」钉成可断言的行为，不只是文案）。

### R5-159  verdict=FIXED  版本背书改为按「回调推进的格数」结算，多推一格即作废

报告字面修法（取索引解析时的版本号、回调后赋回）经实测**不可采纳**：Store 的 onMutate
（`Store.ts:990-995`）固定为本次写入 `_mutationCount++` 一次，照字面改则版本号恒落后一格，
`getStateVersion(root) !== indexedVersion` 每次成立 ⇒ 每次写入全量重建。
按字面补丁跑出的实数：`r5-core-store-p1-dirty-tracking` R5-159 用例重建计数 1→11、
R5-157 用例 1→4、`dirty-tracking-performance` 两条 `Reflect.ownKeys` 由门限内涨到 721200 / 542400。
落地的是同一目标的正确形态：`report` 在 onMutate 前后各读一次版本号，
`bumpsDuringCallback > 1`（多出来的格只能来自回调里重入的 Store 侧改图）时不背书、
把 `indexedVersion` 留在解析点 ⇒ 下一次全量重建；单格记账仍背书，增量路径不受影响。
`createDirtyTrackingProxy` 的头注释同时把 onMutate 契约写死（每次上报至多推一格；改图须走本代理
或按 Store 口径再推一格；只改图不推版本属已声明的契约外裸写）。
归因方向仍是「宁可多一次重建，不可漏归因」。
回归锁：R5-159 两条——单格记账时连续写入不新增重建；回调多推一格（模拟监听器内 setState
新增别名边）后写该节点必须报 `['a','b']` 而非 `['a']`（把 delta 判据关掉后该用例失败，已实测）。

### R5-114  verdict=FIXED  「warn/silent 放行」的契约文字改准：保护层不抛 ≠ 底层写得进

前任取的是报告给的第二个选项（修文字），代码不动。`_makeWriteTraps` 的头注释与
`_handleIllegalMutation` 的注释现在明说：目标被 `Object.freeze`、属性不可写或不可配置时
`Reflect.set` 返回 false，严格模式下引擎就那次赋值抛 TypeError，且不可配置又不可写的自有数据属性上
陷阱连谎报成功都不被 Proxy 不变量允许 ⇒ 保护层无法代为吞掉；要判不可写请显式 `Object.isFrozen`。
写陷阱本身仍是 `Reflect.set` 如实返回（不是 `obj[key]=value` 的裸赋值），与文字一致。
回归锁：`r5-core-store-p1-state-proxy` R5-114 两条（`productionHandler=warn|silent` 各一条），
用 `jest.resetModules()` + `NODE_ENV=production` 真实走生产分支，正反半句都断言：
放行时写得进（`state.ok===5`），冻结目标上 `proxy.nested.x=2` 抛 TypeError、
`Reflect.set(...)` 返回 false 且 `frozen.x` 仍为 1，warn 计数 2 行 / silent 0 行。

### R5-115  verdict=FIXED  越界 productionHandler 在构造期抛配置错误

`StateProxyManager` 构造函数就地校验 `options.protection.productionHandler`，非三值即
`throw new TypeError("[GeomStore] StateProxyManager: productionHandler must be 'error' | 'warn' | 'silent', got X")`，
`_handleIllegalMutation` 的 switch 因此不需要兜底分支（注释已写明取值在构造期校验）。
不选「按 warn 处理」：把配置错误咽下去等于让未类型化调用方静默拿到另一种保护语义。
Store 侧默认注入 `'warn'`（Store.ts:190-194），`_rebuildStateProxyManager` 在构造期调用，
故 `createStore({stateProtection:{productionHandler:'throw'}})` 现在建店即失败。
API-CHANGE: 越界的 `stateProtection.productionHandler` 由「首次非法写入时表现为生产抛错」
改为「构造 StateProxyManager / createStore 时抛 TypeError」；三个合法取值行为不变。
回归锁：R5-115 两条（管理器层 'loud'/undefined；公共入口 createStore 传 'throw' 抛、
三个合法值各建一店并读回 state）。

### R5-116  verdict=FIXED  子值包装收敛为唯一入口 _wrapChild，重复分流与 currentPath 已删

深代理 get 陷阱里那份「缓存 + 数组分流 + 嵌套代理」与 `_wrapArrayChild` 同构的实现合并为
`_wrapChild(value, path, key, bracket)` 一处；`_wrapArrayChild` 整体删除（`grep -rn "_wrapArrayChild\|_joinPath" src/ tests/`
无残留），路径拼接收敛为 `_joinChildPath(path, key, bracket)` 单点（数组口径 `path[key]`、对象口径 `path.key`）。
数组索引路径改为直接用键原样（上游正则已保证规范十进制串），与 `_joinChildPath` 的口径一致。
回归锁：R5-116 两条——同一嵌套数组经索引路径与数组自定义属性路径拿到**同一个**代理、
`push` 报同一条 `rows[0]` 路径且数组未被改；Date 经两条访问路径同样原样返回（内建豁免口径一致）。

### R5-117  verdict=FIXED  绑定方法按 (owner,key) 缓存，并额外记 raw 防止替换后返回旧绑定

`_boundMethods: WeakMap<object, Map<key, {raw, bound}>>`，`_bindMethod(owner, key, value)` 命中缓存
仍要求 `cached.raw === value`。前任只做了按 (owner,key) 缓存，留了个半截：内部访问可以把方法整个换掉
（`this.state.svc.bump = fn` 走放行分支），无条件复用旧条目会让保护代理继续返回**旧实现的绑定**。
实测反证：把判据退回前任的 `if (cached !== undefined)` 形态后，新用例失败在
`expect(rebound).not.toBe(original)` → `Received: [Function bound read]`；加回判据 12 例全绿。
注释同步补齐「条目记下被绑函数」这一层，与代码一致。
对外语义：`state.method === state.method` 现在成立（此前每次读取都 bind 新函数，
按引用相等做记忆化/依赖比较的调用方每次读都判为换了实现）。
API-CHANGE: 保护代理上非普通实例的方法属性多次读取返回**同一**函数引用（先前每读一次新 bind 一个）；
方法被整体替换后返回新实现的绑定，不会退回旧实现。
热路径代价：命中缓存多一次引用比较，miss 多一个小记录对象；`StateProxy.test.ts` 无耗时门限，
`npx jest tests/unit/store` 全套仍 5s 量级。
第 4 条豁免（绑到裸对象后方法内部写入不经陷阱）已在 `_bindMethod` 注释里写明为有意的保护豁免；
对外文档同步属 docs/**（本组禁改），见条末 NEEDS-MAIN。
NEEDS-MAIN: docs/API.md 把「非普通实例的方法绑定到原始接收者 ⇒ 方法内部写入不经状态保护与脏追踪」
这条有意豁免写进 stateProtection 小节（本轮只在源码注释里，用户看不到）。

### R5-118  verdict=FIXED  状态根为数组时改道数组代理，同一棵树只有一种数组行为

`createStateProxy` 现为 `Array.isArray(target) && this._protection.deep ? _createArrayProxy : _createDeepProxy`，
与 `_wrapChild` 的「数组只有一种代理」同口径；浅保护不改道（其契约是只保护顶层），注释写明。
修掉的实际后果：根数组原先交深代理时 `push` 被当普通方法绑定到裸数组（既无拦截也无提示），
报错路径拼成 `push` / `0` 而非 `[push]` / `[0]`。
回归锁：R5-118 两条（深模式：`proxy.push(...)` 抛 `Direct mutation of state ""`、`proxy[0].v=9`
抛 `"[0].v"` 且数组未被改；浅模式：顶层写仍报 `v`、嵌套层按既有语义不拦）。

### R5-119  verdict=FIXED(本文件半) + NEEDS-MAIN(equality.ts 半)  内建/集合判定加跨 realm 标签并集

`StateProxy.ts` 落地：`builtinTagOf` + `BUILTIN_TAGS` 与 `instanceof` 取并集构成 `isBuiltinObject`，
新增 `collectionKindOf` / `isMapLike` / `isSetLike`（模块内唯一口径来源）；
`dirtyTracking.ts` 的索引遍历、`wrap` 的 collection 判定、`collectionMethod` 的 set/add/get/迭代器
共 7 处 `instanceof Map|Set` 全部改用 `isMapLike/isSetLike`。
为什么是并集而不是只看标签：子类覆写 `[Symbol.toStringTag]` 的合法 Map 只看标签会判非内建，
改成代理后 `Map.prototype.set` 以代理为 this 直接抛 incompatible receiver。
不代理的跨 realm 集合此前被当普通对象代理 ⇒ 内部写入绕过 set 陷阱；索引侧则是
Map/Set 自有属性恒空、挂在集合里的子树整棵不进索引 ⇒ 别名键漏标脏（漏报），方向不可接受。
回归锁：R5-119 两条，用 `node:vm` 的 `runInNewContext` 造新 realm，并把
「`foreignMap instanceof Map === false`」本身写成前提断言（防将来 vm 行为变化让用例静默失效）。
另一半（报告点名的 `deepEqual`）不在本组可改文件内：`src/core/utils/equality.ts:143-174`
四个内建分支仍是 realm 绑定的 `instanceof`，跨 realm Map 与 `{}` 会双双走「非 Map」路径、
按自有属性比（Map 自有属性恒空）判相等。
NEEDS-MAIN: src/core/utils/equality.ts Date/RegExp/Map/Set 四分支改用与 `isBuiltinObject`
同款的标签并集判定（`StateProxy.ts` 已导出 `isMapLike` / `isSetLike` 可直接引，或把标签判据下沉到
core/utils 供两处共用）。该文件按 `.ocr-fix/groups5/core-misc-p2.md:7` 归 core-misc-p2 分片。

---

## 门禁必清项（分派时点名的两条 `no-extra-semi`）

`tests/unit/r5-core-store-p1-dirty-tracking.test.ts` 与 `tests/unit/r5-core-store-p1-state-proxy.test.ts`
现已 0 问题：`npx eslint <两文件>` → 无输出、退出 0（分派时给的第 143 / 187 行是前任落地过程中的位置，
行号已漂移；文件内保留的 `;(x as T).y = z` 形态是 ASI 防护，规则不报）。
本组新增用例一度在回调里以 `;(root.b as Nested).child = shared` 重新引入一条
（`167:9 error Unnecessary semicolon`），已改为先取 `const b = root.b as Nested` 再赋值，不靠 ASI 分号。

## 归因不减 / 性能口径（两条源文件都在写热路径上）

- 本组唯一进入「每次写入」的新逻辑是 `report` 结算版本号的第二次 `getStateVersion(root)`
  （dirtyTracking.ts:192、194）：一次 `hasOwnProperty` + 一次 getter，不含任何图遍历，
  也不新增 `Reflect.ownKeys` 调用 ⇒ `dirty-tracking-performance.test.ts` 以 `Reflect.ownKeys`
  计数为口径的两条门限（<4000、<20000）与改前逐字相同。
- 单格记账（Store 真实接线）下不背书判据不触发，由 R5-159 第一条用例钉住（连续写入全量重建计数停在基线）；
  判据触发时只多一次重建，方向是「多报/多重建」，与第四轮定下的口径一致。
- R5-155 的 `inheritedDescriptor` 只在自有属性缺席时走一次原型链（个位数跳），写已有键为 0 成本。
- 三套锁定基线 + 本组回归锁复跑：`npx jest --ci --silent tests/unit/store/dirty-tracking-incremental.test.ts
  tests/unit/store/dirty-tracking-performance.test.ts tests/unit/property/ownership-index.property.test.ts
  tests/unit/r5-core-store-p1-dirty-tracking.test.ts` → 4 suites / 33 tests 全绿，1.175s。

## 自测结果

- `npx tsc -p tsconfig.json --noEmit` 退出 0；`npx tsc -p tsconfig.tests.json --noEmit` 退出 0。
- `npx eslint src/core/store/{StateProxy,dirtyTracking}.ts tests/unit/r5-core-store-p1-{dirty-tracking,state-proxy}.test.ts` 退出 0。
- `npx jest --ci --silent tests/unit` → 138 suites / 3194 tests：**2 failed / 3192 passed**。
  两条红均不在本组文件、且属并行分片的中间态：
  1. `tests/unit/store/notify-optimizations.test.ts` NOTIFY-002（零拷贝通知的载荷引用身份）——
     成因在 `src/core/store/SubscriptionManager.ts`（`readOnly ?? false` + 按注册逐个产出载荷）
     与 `Store._notifyListeners` 的 `needsClone` 判定，属 core-store-p2 / A 组面；
  2. `tests/unit/plugins/performance/analyzerPlugin.test.ts` R5-319（dispatch 抛错后配对栈）——plugins 分片。
  本组改动的排除证据：`npx jest --runInBand tests/unit/r5-core-store-p1-state-proxy.test.ts
  tests/unit/r5-core-store-p1-dirty-tracking.test.ts tests/unit/regression/ocr-low-round4-p1.test.ts`
  → 47 tests 全绿（无跨文件 NODE_ENV / resetModules 污染）；`tests/unit/store/modules/StateProxy.test.ts` 单跑亦绿。
- 覆盖率（`--coverageThreshold='{}'`，只收本组两文件）：`StateProxy.ts` 99.17 stmts / 98.95 branch / 100 funcs / 99.17 lines；
  `dirtyTracking.ts` 100 / 99.47 / 100 / 100。均高于 `src/core/**` 单文件门槛（85 / 98 / 98 / 98）。

## 本组改到的文件

- `src/core/store/dirtyTracking.ts`：`report` 版本号结算改为差值判据 + onMutate 契约写进头注释（R5-159）。
- `src/core/store/StateProxy.ts`：`_boundMethods` 条目改存 `{raw, bound}` 并加 `raw` 一致性判据、
  注释同步（R5-117 的收尾）。
- `tests/unit/r5-core-store-p1-dirty-tracking.test.ts`：R5-159 新增「回调多推一格作废背书」用例；
  文件头计数口径注释改准（兜底也读一次 root ownKeys）。
- `tests/unit/r5-core-store-p1-state-proxy.test.ts`：R5-117 新增「方法被整体替换后重新绑定」用例。
- 其余 9 条（R5-114/115/116/118/119、R5-155/156/157/158）为前任已落地、本组逐条对账确认，
  未改代码。



