# 分片 extras-selector（17 条）— 第五轮 ocrreview.md

清单：`.ocr-fix/groups5/extras-selector.md`。
涉及源码：`src/extras/selector/{index,retrySelector,createSelector,parametricSelector,selectorComposer}.ts`。
新增回归：`tests/unit/r5-extras-selector-{cache,retry,parametric,composer}.test.ts`（39 例，全绿）。
未改动既有断言：`tests/unit/extras/selector/**` 的 148 例逐字保持并通过（含 `retrySelector.test.ts:74`
「已标注时不覆盖既有值」——该用例的既有值是 99 量级的真数，与 `Math.max` 合并口径天然一致，无需改）。
自验：`tsc -p tsconfig.json --noEmit`、`tsc -p tsconfig.tests.json --noEmit`（selector 相关零错）、
`eslint src/extras/selector tests/unit/r5-extras-selector-*`（零告警）、
覆盖率 `src/extras/selector/**`：statements/lines/functions 100%，branches 99.4%
（`retrySelector.ts` 95.5%，唯一残项是 `/* istanbul ignore next */` 标注的合成错误分支），门槛 85/98/98/98 全过。

## R5-219  verdict=FIXED  入口补出重试工厂，公开面与选项类型同源

`index.ts` 此前只再导出 `RetrySelectorOptions` / `AsyncRetrySelectorOptions` 两个类型，
工厂本体留在 `retrySelector.ts` 里，消费方要按深层路径 import 才能直接调用；现补
`export { createRetrySelector, createRetrySelectorAsync } from './retrySelector.js'`，
并在文件头写明「静态方法与工厂同源同实现」。`src/index.ts` 与 `src/extras/index.ts` 都不聚合
selector 子入口（已核对），无重名冲突；`index.ts` 在 jest 覆盖率里被排除（`!src/extras/**/index.ts`）。
API-CHANGE: `@openlide/geomstore/extras/selector` 子入口新增值导出 `createRetrySelector`、
`createRetrySelectorAsync`（纯增量，`SelectorComposer` 静态方法两条路径等价且都保留）。
回归：`r5-extras-selector-composer.test.ts` 断言入口导出与 `retrySelector.ts` 本体是同一函数引用。
NEEDS-MAIN: src/extras/selector.ts 头部清单只列了六个值导出，补上这两个工厂（该文件不在本分片可改范围）。

## R5-221  verdict=FIXED  shouldRetry 收到规范化 Error，重抛仍是原值

`error as Error` 只是编译期断言：`throw 'boom'` / `throw { code: 500 }` / `throw null` 时回调里的
`error.message`/`error.name` 全是 undefined，用户按 message 判定的实现会在没做错任何事的情况下
放弃整个重试额度。新增私有 `toRetryError`（与 `extras/action/async-core.ts` 的 `toError` 同语义：
Error 原样、字符串成 Error、对象走 JSON、序列化失败回退 `String()`），只在喂给 `shouldRetry` 前过一次；
`throwRetryExhausted` 仍抛原值（`attempts` 也标在原值上），文档「向外抛出的仍是原值」不变。
没有改 `shouldRetry` 的形参类型为 `unknown`：那会让存量 `(e: Error) => …` 实现在
strictFunctionTypes 下逆变报错，属破坏性收紧，而规范化能同时保住类型与语义。
API-CHANGE: `shouldRetry` 的入参在抛出值不是 Error 时改为规范化后的 Error（此前是原始抛出值）；
返回值与 rejection 原因仍是原值。与 action 家族 `withRetry` 的既有口径对齐（docs/API.md:356）。
NEEDS-MAIN: src/core/utils/helpers.ts（或 src/core/utils 新文件）把 `toError` 提成共享叶子工具、
src/extras/action/async-core.ts 改为再导出/复用 —— `retrySelector.ts` 里的 `toRetryError` 是第二份实现，
跨能力包 import action 会把 `extras/selector` 与 `extras/action` 绑成一条依赖链，故先就地实现并注明需同步。

## R5-222  verdict=FIXED  attempts 取两者之大，falsy 既有值同样参与合并

旧判据 `if (annotatable && !error.attempts)` 有两处不一致：嵌套重试时内层标注的 `attempts = 2`
是**内层自己**的次数，外层跑满 5 次后因真值停手 → 报出的数字只会偏小；而 `attempts: 0` 因 falsy
被覆盖。改为读既有值 → 只有有限数值参与比较 → `previous < attempts` 才写入，即「只增不减」，
`0` / 非数值（`'lots'`）一律按未标注处理。`defineProperty` 保留在 try/catch 内
（不可配置的同名属性不能让标注失败顶替真实失败）。
回归：`r5-extras-selector-retry.test.ts` 四条（嵌套 5>2 / `attempts: 0` 被覆盖 / 99 更大保留 / `'lots'` 被覆盖）。

## R5-223  verdict=FIXED  共用决策件而非共用循环骨架，两条路径改为同构

未按报告原样抽「取 `(attempt) => R | Promise<R>` 的共享 driver」：driver 要 `await` 就得是 async，
同步变体（契约 `Selector<S, R>`，必须同步返回）就无法复用，要么把同步 API 变异步、要么在 driver 里
再写同步/异步两条路径（重复照旧）。改为抽出三个决策件并把两条循环改成逐字同构：
`shouldRetryMore`（额度判定 + `shouldRetry` 调用与异常隔离，此前一处写作
`if (isRetryAttempt && invokeShouldRetry(...)) continue`、另一处写作 `const canRetry = attempt < retries && …`）、
`resolveDelayMs`（退避函数抛错按 0）、`throwRetryExhausted`（收尾，已有）。
循环骨架统一成 `for (let attempt = 0; ; attempt++)` + `catch` 里 `if (!shouldRetryMore(...)) break`，
差异只剩异步侧的 `await` 与一次等待；`error as Error` 断言随之消失。
回归：`r5-extras-selector-retry.test.ts` 的「行为对齐」段（同失败序列下尝试次数一致、额度耗尽时
两侧 `attempts` 同为 4、`shouldRetry` 抛错两侧都停止并带真实标注、`delay` 抛错按 0 继续）。

## R5-225  verdict=FIXED  cacheTTL 加取值守卫，Infinity 显式放行

按报告建议补守卫，但**不照抄 `Number.isFinite`**：`Infinity` 对版本化状态是有用且安全的配置
（失效凭证是版本号，不过期也不会返回陈旧值），把它判成「未提供」会拿走这条出口。落地为
`typeof options.cacheTTL === 'number' && options.cacheTTL > 0 ? options.cacheTTL : 5000`，
拒绝的正是报告点名的两类静默劣化：`NaN`（`timestamp + NaN <= now` 恒假 → 永不过期，就地变异后
仍返回陈旧值）、`0`/负数（写入即过期 → 静默关缓存却仍每次付克隆快照与 push 成本）；
顺带挡住未类型化调用方传的字符串（`timestamp + '60000'` 会变成字符串拼接，判定退化成恒假）。
API-CHANGE: 非法 `cacheTTL`（`NaN` / `<= 0` / 非数值）不再被接受，一律回落默认 5000；`Infinity` 明确允许。
回归：`r5-extras-selector-cache.test.ts` 五条（NaN / 0 / 负数 / 字符串 / Infinity 仍可被版本失效推翻）。
NEEDS-MAIN: src/types/selector.ts 的 `cacheTTL` 注释仍写「只做了 ?? 5000 的缺省兜底，**不校验取值**…
需要这两类输入被拒绝请在选项归一化处补校验（属 src/extras，见本轮待办）」，待办已落地，
该段需改成新守卫口径（含 Infinity 放行）；docs/API.md:299 的「**不校验取值**」同改。

## R5-226  verdict=FIXED  把版本单调不变量写进注释并补「版本回退」用例

`findCacheHit` 跳过历史回溯的判据此前只写「版本号单调递增」一句，未说清依赖什么、失真会怎样。
注释补齐两条不变量（版本读自 Store 的 `_mutationCount` 只增不减；`defineStateVersion` 的 getter
只随状态对象的诞生装上，`createStore`/`$replaceState` 换的是新对象、不会重置到复用对象上），
并写明后果：不变量被破坏时只是跳过历史里仍新鲜、身份相同的条目 → 多算一次，**不会返回错值**。
用 `defineStateVersion(state, () => counter)` 手工把计数从 5 打回 0，断言重算一次后结果正确、
新条目按重置后的版本命中。不改判定逻辑：现在没有任何路径重置计数，改成「历史全扫」会把 O(1)
快捷路径的收益换掉，换来的只是防一个不存在的写入方。
回归：`r5-extras-selector-cache.test.ts`「版本号被重置到更小值时只多算一次，不返回错值」。

## R5-227  verdict=FIXED  updateCache 写入前剔除过期条目

过期条目在读取侧已按 `timestamp + cacheTTL <= now` 判 miss，留在 `cacheHistory` 里只会白占
`cacheSize` 槽位：多状态交替 + LRU 提升后插入序与过期序不一致时，仍有效的条目会被过期条目挤出
（实测用例里 `b` 被挤掉、之后每次访问多算一次），且过期条目的状态快照与结果值继续被强引用。
在 push 前倒序 `splice` 掉过期条目（倒序保证 splice 不影响未检查的下标），成本是每次写入
O(cacheSize)（默认 10）。剔除后再 push + 溢出 shift，`cacheHistory.length <= cacheSize` 不变式仍成立
（原先每轮最多超一条，一次 shift 足够）。
回归：`r5-extras-selector-cache.test.ts`「过期条目不再把仍有效的条目挤出 cacheSize」
（t=110 写入 c 后 `getCacheStatus().cacheSize === 2` 且 t=120 访问 b 命中不再重算）。

## R5-228  verdict=FIXED  函数参数与对象参数同走 WeakMap，键类型不再靠断言

`typeof params === 'object' && params !== null` 把函数判给「原始侧」，函数因此被写进强引用的
`primitiveParamsCache`：既受 `maxEntries` 插入序淘汰（与文档承诺相反），又把闭包捕获的作用域整片钉住。
改为模块级类型谓词 `isWeakMapKey(value): value is object`（`typeof === 'function'` 或
非 null 的 object），对象侧两处 `params as object` 断言随之删除（谓词负责收窄）。
顺带把原始侧的键类型收成 `PrimitiveParamKey` 并补 `bigint`：它同样不是 WeakMap 的合法键，
却不在早先那份手写联合里，是同一处「断言骗过编译器」的另一个洞。
回归：`r5-extras-selector-parametric.test.ts` 两条（函数参数不被 `maxEntries: 1` 淘汰 / 函数参数按 TTL 过期且各键独立）。

## R5-229  verdict=FIXED  maxEntries 归一化，与 cacheSize 同口径

`const { maxEntries = 1000 } = options` 只挡 `undefined`：0 / 负数让 `cacheMap.size < maxEntries` 恒假
→ 淘汰循环一路删到空表，随后的 `set` 仍写入一条（「上限为 0 却仍有缓存值可取」）；
`NaN` 同样恒假（等价于悄悄关掉缓存）；`Infinity` 恒真 → 提前 return，条目只增不减（上限形同虚设、
表无界增长）；非整数让「上限」与实存条目数不一致。改为
`Number.isFinite(options.maxEntries) ? Math.max(1, Math.floor(options.maxEntries as number)) : 1000`。
`ttl` **不**跟着归一化（有意与 `cacheTTL` 不同口径）：本工厂读侧判据是 `timestamp + ttl > now`，
`0`/负数/`NaN` 都退化成「条目立即过期 = 不缓存」，不存在 `cacheTTL` 那种「NaN → 永不过期 → 返回陈旧值」
的静默劣化，且 `ttl: 0` 已被既有文档与用例（`selector-cache-boundaries.test.ts`、BUG-10）当公开语义。
差异已写进 `options.ttl` 的 JSDoc。
回归：`r5-extras-selector-parametric.test.ts` 四条（NaN 回默认 / Infinity 有界（1001 次写入后首条被淘汰）/
0 夹到 1 / 2.7 取整成 2）。

## R5-230  verdict=FIXED  非对象状态只降级不崩

`stateCache.get(state as object)` 对非对象键恒返回 undefined，但随后的
`stateCache.set(state as object, cache)` 直接抛 `TypeError: Invalid value used as weak map key`：
未类型化的 JS 调用方传 `null` / 原始值时，「没有缓存可用」的降级路径变成崩溃路径。
补与 `getStateVersion` 同口径的守卫，放在外层函数（每个 `selector(state)` 只判一次，
不必每次参数调用重复）：非对象状态直接返回「每次重算、不缓存」的内层函数，
两处 `as object` 断言一并去掉（`stateKey` 收窄后已是 `object`）。文档补「状态侧的降级」段。
回归：`r5-extras-selector-parametric.test.ts` 两条（六种坏值 × 两次调用都不抛错、每次重算 /
坏状态不污染随后正常对象状态的缓存）。

## R5-231  verdict=FIXED  版本化条目不再常驻一份无人读取的活引用快照

采纳「drop」而非「加注释」：`cache.snapshot = state` 只在 `cache.version !== undefined` 时被写，
而该分支与后续版本化快路径都不读它（读快照的唯一分支要求 `cache.version === undefined`），
所以它既死又多留一份对活状态的强引用（把整棵状态树钉在 WeakMap 值上，与「随 state 一起被 GC」相反）。
条目形状改为 `snapshot?: S`，创建时 `version === undefined ? clone(state) : undefined`，
版本化失效分支只换 `version`、不写 `snapshot`；注释同步改写（原注释称「版本化条目的 snapshot
存的是活引用，deepEqual(自身,自身) 恒相等」，现按「不留快照」重述 miss 的理由）。
与 `createSelector` 的 `snapshotState` 同口径判定见文末「同口径待办」段。
回归：`r5-extras-selector-parametric.test.ts`「版本化条目不建快照；版本标记消失后按快照收敛」
（delete `Symbol.for('geomstore.stateVersion')` 后必须 miss 一次、降级后按内容快照命中、
就地改 `state.value` 仍可见 → 证明驻留的是内容拷贝而非活引用）。

## R5-232  verdict=FIXED  combine 去掉两处断言，并把 R 一路透传

报告建议的两处删除（`as unknown as T`、`as R`）单独落地编译不过：`combine` 的入参写作
`SelectorComposerInput<S, T>` 时第三参数取**默认** `unknown`，`combiner` 的返回位是 `unknown`，
去掉 `as R` 直接报 `Type 'unknown' is not assignable to type 'R'`（已实测：改回两参数写法后
本分片的 `@ts-expect-error` 断言变成 "Unused directive"）。按 `types/selector.ts` 已写下的计划
（「`combine` 侧不再需要 `as R` 断言」+ `tests/types/selector-combiner-result.typecheck.ts:11-12`
的「extras 侧把 R 透传后 `as R` 断言才可删除」）把签名改为 `SelectorComposerInput<S, T, R>`，
两处断言同时删除：结果数组按 `unknown[]` 交给 combiner（形参刻意是 `any[]`，由调用点写死的
combiner 形参保证元素类型），组合结果不再被断言成 `R`。
API-CHANGE: `combine` 的入参类型改为 `SelectorComposerInput<S, T, R>`（此前等价于 `R = unknown`）——
未显式给 `R` 时它由 `combiner` 的返回类型反推，显式给出 `R` 而 combiner 返回别的东西现在编译失败。
运行期行为不变（断言本就无运行期效果）。
衔接项：NEEDS-MAIN: tests/unit/r5-plugins-types-p2-probe.test.ts 第 65-71 行的 R5-323 探针
（`Equal<ReturnType<typeof combined>, unknown>`，注释「实现归 extras」）需按新口径改写；
该探针当前报的 `Selector<St, number>` 不可赋给 `Selector<object, unknown>[]` 与本改动无关
（A/B 实测：改回 `SelectorComposerInput<S, T>` 同一处同样报错，S 无法从该调用形状反推、退回约束）。
回归：`r5-extras-selector-composer.test.ts` 两条（值按序透传 / combiner 返回 string 而 R=number 时
`@ts-expect-error` 成立，由 `tsc -p tsconfig.tests.json` 把关）。

## R5-233  verdict=FIXED  防抖定时器句柄与 null 比较

`if (timeoutId)` 用真值代表「有待发定时器」，句柄为 `0` 时（注入式/fake 时钟下可出现，
本模块用例本就跑在 fake timers 上）那条 `clearTimeout` 永不执行 → 上一轮回调照旧触发，
防抖窗口静默失效、同一轮里多次执行选择器。改为 `if (timeoutId !== null)`。
`finally` 里的 `timeoutId === firedTimer` 比对不受影响（此前也是等值比较）。
回归：`r5-extras-selector-composer.test.ts` 自带调度器的用例（首个句柄恰为 0：两次调用只执行一次，
旧实现会执行两次）。

## R5-234  verdict=FIXED  rejection 原因去掉 `as Error` 断言；吞掉/重复报告都否证

`currentReject: (error: Error) => void` + `currentReject?.(error as Error)` 是双重不成立：
`throw 'boom'` / `throw 42` 合法，Promise 也确实以非 Error 原因落地。槽位类型放宽到
`(error: unknown) => void`，断言删除，调用方 catch 到的就是原值（与 R5-220/R5-221 同口径）。
「先记录/吞掉再 reject」两条建议都不采纳：给 `currentPromise` 挂 `.catch(noop)` 属把真实失败
彻底变不可见的垫片；在 catch 里额外 `console.error` 则对**已正确 await/catch 的**调用方双报告。
报告指出的真问题在文档示例——三条裸 `selector(state)` 正是「无人处理 rejection」的形状，
JSDoc 补 `@remarks`（每次调用的返回 Promise 都必须 await 或挂 `.catch`，本库不代为吞掉）
并把示例改成 `Promise.all([...])` / `.catch(onError)` 形状。
回归：`r5-extras-selector-composer.test.ts` 两条（`throw 'boom'` → `rejects.toBe('boom')`；
抛出对象 → `rejects.toBe(thrown)` 保持同一引用）。

## R5-235  verdict=FIXED  pipe/createDerived 的 @returns 与缺失的第四棒声明

`pipe` 的 `@returns {Selector<S, T4 | T3 | T2 | T1>}` 与四条重载都不符：返回类型是**最后一棒**的输出，
随重载为 T2/T3/T4（单棒时 T1），永远不会是四者联合；`@template`/`@param` 也漏了它正在文档化的
第四棒。补 `@template T4` 与 `selector4` 的 `@param`，`@returns` 改为 `{Selector<S, T4>}` 并写明随重载取值。
`createDerived` 的 `{Selector<S, R3 | R2 | R1>}` 是同一处笔误，一并改为 `{Selector<S, R3>}`。
纯 JSDoc，无运行期与类型影响（重载签名未动）。

## R5-236  verdict=FIXED  createDefaultSelector 的兜底留一条日志

`catch { return defaultValue }` 把「selector 抛了 TypeError（属性名拼错）」伪装成
「合法返回 undefined 走了默认值」，两者结果同形且无任何痕迹；同家族的 `retrySelector`
对 `shouldRetry`/`delay` 异常都留 `console.error`，这里补齐同一口径。
只记真故障：`value === undefined` 那条路径不记日志（否则合法的稀疏字段会按每个 state 刷一次噪音），
JSDoc `@remarks` 写明这条区分，也写明 `R` 的声明对 undefined 给不出信号、判定只能靠运行期。
既有断言无需改：`selectorComposer.test.ts:290` 只断言返回 `'fallback'`，多出的日志不影响判定。
回归：`r5-extras-selector-composer.test.ts` 两条（抛错时恰好一条 `console.error` 且带原始抛出值 /
返回 undefined 时不记日志）。

## R5-237  verdict=FIXED  按键写入改为「仅 __proto__ 走 DefineOwnProperty」

`createObjectSelector` 对状态的每个自有键都用完整描述符建属性，而 DefineOwnProperty 要走
属性创建慢路径，明显贵于 `result[key] = value`；真正需要特殊语义的只有 `__proto__`
（`[[Set]]` 会命中 `Object.prototype` 的原型 setter，丢键且换掉 `result` 原型）。
改为 `key === '__proto__'` 分支保留描述符写入，其余键普通赋值。
同口径把 `createSelector.ts` 的 `createStructuredSelector` 一并改掉（报告只点名 composer 那处，
但它是同一份模式、同样按映射键逐个遍历的热路径；留一份就会漂移）。
行为不变（两条路径产出的都是可写、可枚举、可配置的自有键），既有 `REGR-COMPOSER-001` /
`REGR-STRUCT-001` 两条 `__proto__` 用例继续守住特殊分支。
回归：`r5-extras-selector-composer.test.ts`「普通键与自有 `__proto__` 键同批写入时结果同形」
（`Object.keys(result)` 顺序、原型仍是 `Object.prototype`、`__proto__` 是自有数据属性）。

## 同口径待办（parametricSelector 的快照 vs SelectorOptions.snapshotState）

判定：**两处语义本就不该同一条选项，但必须同一套成本原则**，本轮按后者统一。
`createSelector` 的快照是为**用户传入的 equalityFn** 准备失效凭证，用户可以给引用相等的比较器
（`(a, b) => a === b`），那时快照与活引用永不相等 → 永不命中，所以必须允许 `snapshotState: false`。
`createParametricSelector` 没有可注入的比较器：state 侧判据写死是 `deepEqual`，
关掉快照就得到 `deepEqual(state, state)` ≡ 恒真，等于删掉无版本路径上唯一的失效信号
（只剩 TTL 兜陈旧值），没有任何收益，因此**不加**该选项，并把这段理由写进工厂注释。
统一的是成本原则：版本化状态下快照无人读取 → 两处都不克隆、不驻留（`createSelector` 靠
`version === undefined && snapshotState`，`parametricSelector` 靠 R5-231 改为 `snapshot?: S`）。

## 其它 NEEDS-MAIN 汇总

- NEEDS-MAIN: src/types/selector.ts `cacheTTL` 注释段（现写「不校验取值 / 待办在 src/extras」）按 R5-225 新守卫改写，并去掉指向本轮待办的尾巴。
- NEEDS-MAIN: src/extras/selector.ts 头部公开面清单补 `createRetrySelector` / `createRetrySelectorAsync`（R5-219）。
- NEEDS-MAIN: src/core/utils/helpers.ts + src/extras/action/async-core.ts 把 `toError` 提成共享叶子工具供 selector 侧复用，替换 `retrySelector.ts` 的 `toRetryError`（R5-221，两处语义需同步）。
- NEEDS-MAIN: docs/API.md 第 299 行（cacheTTL「不校验取值」）、第 303 行（`maxEntries` 归一化口径、函数参数改走 WeakMap、非对象状态降级）、第 286-290 行（`combine` 的 R 透传、子入口新增两个重试工厂导出、`shouldRetry` 收到规范化 Error、`attempts` 取两者之大、防抖返回值必须 await/catch）；CHANGELOG.md 同步。
- NEEDS-MAIN: .codebuddy/skills/geomstore/references/api/extras-selector.md 同一批口径（技能文档里 `createRetrySelector` 仍只挂在 SelectorComposer 上）。
