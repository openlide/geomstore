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
- **`ActionLoader` 的 `setState` 是 `(key, value)` 两参数**签名，不是 patch 对象——这是最常见的接入错误。

## 4. Getter 与选择器

- **getter 必须纯**：只读 `state`，不写状态、不做网络请求、不读外部可变变量。getter 结果会被缓存，副作用会在缓存命中时被静默跳过。
- **派生数据放 getter / 选择器**，不要在 state 里冗余存储（容易出现两份数据不一致）。
- **重计算用选择器**：`createSelector` 的版本化缓存同时校验状态对象身份与版本号（O(1)），避免跨 Store 同版本误命中，也无需逐次全树 `deepEqual`。
- **参数化选择器要设上限**：`{ ttl, maxEntries }` 两个都要给。只给参数不给容量，长会话下会持续增长。
- **不要在选择器里返回新对象再去做 `===` 判断**：选择器缓存的是**计算结果**，若要「内容相同就不触发更新」，请显式传 `equalityFn`（默认 `deepEqual`）。

## 5. 订阅与通知

- **订阅回调要轻**：回调里只做「决定是否需要更新视图」，重活交给渲染层。回调抛错会被隔离（不影响其他监听器），开发模式打印、生产模式经 `onError` 钩子上报——静默不等于无从监控，请给 `onError` 挂一个上报处理器。
- **不写状态就声明 `readOnly`**：

  ```ts
  store.subscribe(listener, { readOnly: true })
  ```

  载荷形态按「有没有可写订阅者」决定：全部只读时免深拷贝（开启状态保护拿到的是只读保护 Proxy，关闭时是**原始引用**——只读声明此时只是约定，没有运行时拦截）；只要有可写订阅者，本轮所有回调都拿到独立深拷贝。所以「给一个会写载荷的回调声明 readOnly」在保护开启时是写入抛错、在保护关闭时是静默改活状态，务必如实标注。页面 / 组件绑定本身就是只读注册。
- **退订要落实**：`subscribe` 返回退订函数；页面 / 组件场景交给集成层（`onUnload` / `detached` 自动清理），自行订阅的场景务必在销毁前退订。本轮派发的是进入通知时在册的注册，回调内退订自己仍会收到最后一次，依赖「立即生效」请在回调里自判存活标记。
- **`onlyOnChange` 用于跳过无写入的通知**：默认模式也使用 Action 脏跟踪代理；该选项额外依据变更计数决定 dispatch / batch 是否通知，不做内容深比较（同值赋值也可能计数）。嵌套写入的归属关系按需求构建一次索引、标量写入为 O(1) 查表，仅在增删键或写入对象值等结构变更时重建，逐项更新长列表不再退化。
- **不要用 `subscribe` 做数据转换**：转换放 getter / 选择器；订阅回调里转换会让同一份数据被反复计算。

## 6. 缓存

- **只缓存热点键**：`enableCache(['visibleRows'])`。全量开启在状态频繁变化的场景只会反复失效。
- **统计按需开启**：`cacheConfig.enableStats` 有额外开销，测量期间打开、定位完关闭。
- **避免整体替换造成全量失效**：`$replaceState` 会让相关缓存全部失效；能 `$patch` 就不要替换。
- **独立场景用 `LRUCache`**：需要自有策略（如按接口缓存、按用户隔离）时直接用它，不必强行套在 Store 上；注意设置容量与 TTL，并保证 `getOrSet` 的计算函数幂等。

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
- **超深结构走异步路径**：同步克隆是递归实现（栈深＝数据深度），默认 `maxDepth: 100` 会先把它截成占位符；靠抬 `maxDepth` 硬扛深树有爆栈风险。
- **不要把快照当状态同步机制**：它是一次性隔离副本；跨实例 / 跨端同步请走持久化插件或企业集成。

## 8. 错误处理

- **错误分层**：action / getter 只负责「抛」，是否恢复交给边界决定。`ErrorBoundary` 默认 **fail-loud**（未配 `fallback` 时重抛）——这避免了「静默吞错 + 返回 undefined」这类最难排查的故障。提供 `fallback` 即等于声明恢复意图；未配 `fallback` 而显式 `recoverable: true` 时返回 `undefined`，返回类型是 `T | F | undefined`，按 `T | F` 消费会在远端二次炸。
- **抛出的值请保持 `Error`**：`throw 'str'` 会被边界归一化成 `new Error(String(v))` 记账（堆栈是边界处的，不是抛出点的），重抛时仍是原始值——排查体验远不如带堆栈的 `Error`。
- **`ErrorRecovery` 的 operation 命名要稳定**：额度按 `code:storeName:operation` 计量。动态 id（`fetchUser:${id}`）会不断产生新键——虽有容量守卫兜底（`MAX_RETRY_KEYS = 1000`），但会让「同一操作的退避策略」失去意义。推荐按「操作类型」而非「操作对象」命名。`recover()` 的 `error` / `config` / `attempt` 由库内写入，别指望用第二参数换策略。
- **`ErrorMonitoring` 的 reporter 要幂等且有超时**：批量 flush 做 `ok / fail / timeout` 三态判定，仅真正 resolve 才算成功；超时会被当作失败并重入队。确保上报端可重试、不产生重复脏数据。
- **显式传入 `0` 是合法的**：`batchInterval` / `batchThreshold` / `reportTimeout` 用 `??` 兜底，不会被替换为默认值（`batchInterval: 0` 即「无延迟」）。`reportTimeout <= 0`（含 `0`）统一按**不超时**处理——想「等到上报真结束」就传 0，别传一个很大的数。
- **在 reporter 里不要再写 Store**：上报失败会触发错误处理，可能形成回路。reporter 只做网络/日志。
- **配置上限防长期运行泄漏**：`maxQueueSize`（默认 1000）与 `maxFlushRetries`（默认 3）；持续失败的批次会被丢弃并告警，而不是无限空转。

## 9. 小程序实践

- **主包体积**：只用到的能力才引入 `extras/*`；**不要**为了省一行而引入聚合入口 `@openlide/geomstore/extras`（它会把全部可选能力拉进产物）。
- **分包**：企业集成（`extras/enterprise`）、调试插件（`extras/plugins` 的 devtools/timeTravel）建议放进分包。
- **`setData` 优化**：集成层已按 `isStateKeyDirty` 跳过未变化的映射键，前提是**映射粒度合理**——映射整个大对象（`mapState: { whole: 'list' }`）会让任何内部变化都触发全量传输。映射到具体字段。
- **`undefined` 不是合法值**：`setData` 不接受 `undefined`，集成层会过滤掉该字段。要「清空」用 `null`。
- **持久化**：后端必须同步且 **`getItem` / `setItem` / `removeItem` 三项齐备**（缺项在 `store.use()` 安装期即抛 `TypeError`，不再悄悄换后端）；用 `filter` 收敛落盘字段；`debounce` 降低写入频率（卸载时会同步补写最后一次变更）；需要卸载即清理才开 `clearOnUninstall`。
- **生产模式静默 ≠ 无信号**：插件安装/卸载、订阅驱逐等日志在 `NODE_ENV=production` 下关闭；但持久化降级为内存后端、监听器抛错、落盘与卸载清理失败都会 `emit('onError', …, source)`。上线前给 `onError` 挂一个上报处理器，比排查时临时切开发模式更可靠。
- **生命周期**：组件端只认 `lifetimes` 写法；`onUnload` / `detached` 先执行用户钩子，再在 `finally` 清理绑定。需要映射 actions 的收尾放在钩子同步段，包装器不等待异步 Promise；清理绑定不等于销毁 Store，已销毁 Store 上的写操作仍会抛错（`setStateProtection()` 现在也在这条守卫之内）。

## 10. 测试与调试

- **测试 Store 用 `createTestStore`**：为未命名的 Store 补充确定性唯一名称，避免并行测试互相干扰。
- **断言走公开 API**：优先用 `getState` / `getter` / `getCacheStats` / `getErrorHistory` 等；确需触碰内部状态时（如构造越界场景），用 `as unknown as { … }` 并写明成因。
- **覆盖率是契约**：四项 100%。确实不可达的防御分支用 `/* istanbul ignore … */` 标注，并在注释里写「为什么不可达」——不接受无理由标注。
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
| 传异步 storage 或**残缺后端**给持久化插件 | 异步写入存在竞态与静默丢失；缺 `setItem` / `removeItem` 的后端会在首次落盘才炸并被吞成日志 | `WxStorageBackend` 或自封装、三方法齐备的同步实现（现在安装期即校验并抛错） |
| 用不写 `return` 的箭头函数当快照 `onError` | 判定按真值走，`undefined` ＝「拒绝继续」，纯观测会把整次快照做成失败 | 显式 `return true`，或改用 `onProgress` 做观测 |
| 给装饰器方法期待同步返回（`createDecorator`） | 0.5.2 起同步方法不再被包成 `async`——反过来说，之前依赖它返回 Promise 的调用方现在拿到的是同步值 | 同步方法按同步取值；异步方法照常 `await` |
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
- [ ] `onError` 钩子已接上报（持久化降级、监听器抛错、落盘 / 清理失败在生产只走这里）
- [ ] 带敏感数据的 action 已按需给 `withLog` 传 `redact` / `sink`（生产构建默认只输出摘要）
- [ ] `ErrorMonitoring` 的 reporter 幂等、有超时；`maxQueueSize` / `maxFlushRetries` 按流量设定
- [ ] `ErrorRecovery` 的 operation 命名稳定（不含动态 id）
- [ ] 页面 / 组件卸载后不再触发写入；订阅由集成层自动清理
- [ ] `stateProtection` 保持开启
- [ ] 大对象的快照走异步并调过 `batchSize`；`success` 与 `errors` 已接入监控
