# 分片 integrations-p1（24 条，企业集成）— 第五轮判定

清单：`.ocr-fix/groups5/integrations-p1.md`。 owned 文件：`src/integrations/enterprise/{background-sync,env,hot-update,offline,store-manager,user-store,wechat-enterprise}.ts`。
新增回归：`tests/unit/r5-integrations-p1-background-sync.test.ts`（5 例）、`tests/unit/r5-integrations-p1-enterprise.test.ts`（24 例）；同步改动的既有用例见 R5-270 / R5-273 条内。
未回退 R5-247（`wrappedApp` 非对象实参透传）与 `tests/unit/hot-round5.test.ts`（该锁 25 例全程通过）。

门禁自测（最后一次的真实输出）：
- `npx jest --ci --silent tests/unit/integrations tests/integration tests/unit/r5-integrations-p1-background-sync.test.ts tests/unit/r5-integrations-p1-enterprise.test.ts tests/unit/hot-round5.test.ts` → `Test Suites: 18 passed, 18 total / Tests: 348 passed, 348 total`
- `npx jest --ci --silent`（全量）→ `Test Suites: 4 failed, 134 passed, 138 total / Tests: 4 failed, 3316 passed`，4 条失败全在 `extras/action`、`extras/snapshot`（并行分片中间态），与 enterprise 无关
- `npx tsc -p tsconfig.json --noEmit` / `npx tsc -p tsconfig.tests.json --noEmit` → 我分片的 src 与测试文件 0 报错（其余报错属并行分片）
- `npx eslint src/integrations/enterprise/*.ts tests/unit/r5-integrations-p1-*.test.ts tests/integration/enterprise.test.ts tests/unit/integrations/ocr-medium-round4-p1.test.ts` → 无输出
- `npx jest --coverage --collectCoverageFrom='src/integrations/enterprise/**/*.ts' …`（同上门禁集）→ 7 个文件 `All files 99.44 stmts / 98.25 branch`；`background-sync/env/hot-update/store-manager/wechat-enterprise` 100% branch

### R5-248  verdict=FIXED  回调注入纳入同一 try/catch，不可写的 options 原样透传给宿主 App

`options.onShow = …` 在冻结对象/只读数据属性/无 setter 的访问器上于 ESM 严格模式直接抛 TypeError，而紧随其后的 `defineProperty` 却有兜底——守卫确实在错的 scope。现整段注入包 try/catch，失败时 `logger.warn` + `return originalApp.call(this, options)`。
与报告补丁的一处措辞差异：不承诺「配置完全未改写」——`onShow` 已写成功而 `onHide` 抛错是可能组合，已注入侧的检查照常生效，注释按实情写。
验证：`r5-integrations-p1-background-sync.test.ts` 三条（冻结对象、只读 getter、可写对照），`npx jest --ci tests/unit/r5-integrations-p1-background-sync.test.ts` → 5 passed；istanbul 显示该 catch 与 warn 分支均命中。

### R5-249  verdict=FIXED  App 未就位时处理器仍登记，只告警不丢弃

采纳报告的「理想解」：注册表与 App 包装本就相互独立，`initBackgroundSync` 不再在 `typeof App !== 'function'` 时 return，改为 warn 后照常登记；App 就位后由 `ensureAppLifecycleHooks()`（createEnterpriseApp 已调）或下一次 init 安装包装即生效。原行为是把注册静默丢掉，且 `runForegroundChecks` 的自清理逻辑无从补救。
验证：新增用例先 `delete globalThis.App` 再 init（断言 warn 含「App 构造器当前不可用」），随后装 App + `ensureAppLifecycleHooks()` + 触发 onShow → `onForeground` 被调用 1 次。既有 `ENTERPRISE-050`（无 App 安全返回）仍通过。

### R5-250  verdict=FIXED  前台/后台两条循环都按注册表现状复核，已注销者不再被回调

按报告的 membership 复核落地，但前台循环改用 `indexOf` 取位而非 `includes`：`handler.store.destroyed` 分支的自清理本就要 `indexOf + if (index !== -1)`，加了复核之后那条 `-1` 分支变成不可达死代码，故两处共用同一次查找（`currentIndex === -1` 即跳过）。后台循环只需判定成员，保留 `includes`。
重入新增（nested init）不处理：本轮内新注册的 handler 其 `lastActiveTime = Date.now()`，即时判定为「非活跃 0ms」不会触发 refresh，只可能多跑一次 onForeground，语义上属于「注册即回调」，留给下一次生命周期事件才是可解释的行为。
验证：新增用例用 A/B、C/D 两对 store 分别在前台与后台回调里注销对方，`expect(onForegroundB/onBackgroundB/onBackgroundD).not.toHaveBeenCalled()` 且 D 的前台回调正常触发；该文件 `background-sync.ts` 覆盖率 100% branch。

### R5-263  verdict=FIXED  显式放宽 serialized 类型为 string | undefined（但报告的 TS2367 前提不成立）

报告称 `serialized === undefined` 会被 `strict: true` 判为 TS2367。实测反驳：仓库现状（该守卫自第四轮 #332 起就在）编译零报错——`npx tsc -p tsconfig.json --noEmit | grep enterprise` 无输出；另用等价最小片段验证 `npx tsc --noEmit --strict --target es2020 --ignoreConfig .cache/probe2367.ts` → 退出 0、无 TS2367，而同一段里加 `const bad: number = s` 立刻报 `error TS2322: Type 'string' is not assignable to type 'number'`（证明文件确被检查、`s` 确实推断为 string）。TS 只对「有声明类型互不重叠」的相等比较报 2367，`=== undefined` 属豁免。
判定仍为 FIXED：契约不可见这条成立（`JSON.stringify` 对 undefined/函数/symbol 返回 undefined 是运行时事实，`node -e 'JSON.stringify(undefined)'` → `undefined`），故按报告建议显式标注 `const serialized: string | undefined = …` 并把「声明与运行时不一致」写进注释，同时删掉探针文件。

### R5-264  verdict=FIXED  纠正 storage.remove 的文档：它只表示「平台未拒绝这次删除」

不采用「读回核验」：`get` 对缺失键与存了空串一律返回 null（#330 的既定归一），读回 null 同样证明不了删除生效——加一次读只会给出虚假的确证。改为把文档边界写死：true 涵盖「删掉了」与「本来就没有」，false 只对应抛错类故障，其用途是让清理路径留痕而非证明数据不可读。
行为未变（`ocr-low-round4.test.ts` 的 #333「删除成功返回 true / 抛错返回 false」仍通过），R5-267 的 logout 正是按这个口径消费返回值。

### R5-265  verdict=FIXED  收窄 get 对 number/boolean 原始值的承诺为「存在性 + 字符串形式」

按报告的第一种出路（收窄文档）处理，不改解析启发式——与第四轮 #329 的 reject 结论一致（全库无受影响调用点，彻底修法需类型信封/legacy 垫片），此处只修被写过头的承诺：明确 falsy 原始值会读回 `"false"`/`"0"` 这类非空字符串、真值判定会走错分支，并指出与宿主直返原始值的非字符串分支不对称，要表达「关/否」应删键而非写 falsy；同时说明库内热更新标记按「写 true、缺席即 null」使用故不受影响。纯文档，无行为变化。

### R5-266  verdict=FIXED  构造期把 maxStores 归一为合法正整数并告警

`Number.isInteger(maxStores) && maxStores >= 1 ? maxStores : 1`，非法值 warn 留痕。不选构造期抛错：宿主配置写错不该让管理器整体不可用（`ENTERPRISE-058` 断言 `new StoreManager(0)` 不抛错也继续成立）。`cleanupOldestStore` 里「maxStores=0」的过期注释一并改为归一后仍会发生的场景。
验证：`r5-integrations-p1-enterprise.test.ts` 两条——`new StoreManager(0)` 断言 warn「maxStores 非法（0）」+ 无「超出上限」误报 + 第二次插入按容量 1 淘汰最旧；NaN/-2/2.5 各自 warn，`new StoreManager(3)` 不 warn。

### R5-267  verdict=FIXED  logout 的 destroy 兜底 + 核验两个键的删除结果

`store?.destroy()` 单独 try/catch（防抖落盘 flush 抛错时不得跳过后续清理），`this.stores.delete(userId)` 移到 catch 之后照常执行；两个 `storage.remove` 的布尔结果合并判定，失败记 `登出的持久化清理未被平台接受`。这与 R5-264 的口径一致：布尔值能覆盖的就是平台拒绝这一类失败，而它正是「内存已登出、磁盘仍留着身份」的成因。
验证：两条新用例（spy destroy 抛错 → 断言键被删 + `getCurrentStore()` 为 null；`removeStorageSync` 抛错 → 断言 error 文案），既有 `REGR-ENT-006`、`ENTERPRISE-048`、round4 `#340` 全绿。

### R5-268  verdict=FIXED  clearAll 一并移除 CURRENT_USER_KEY（账号数据键仍保留）

报告给的两条出路里选了「彻底的那条」：`CURRENT_USER_KEY` 是身份/会话标记而非账号数据，与 `currentUserId = null` 属同一次清理；只留文档（第四轮 #342 的做法）会长期保持「内存说没用户、冷启动把身份指回上一个账号」的不一致。删除 `user-store-*` 仍刻意不做（越权删数据风险高于收益），并在 JSDoc 给出跨 clearAll 保留身份的具体手段。移除失败同样按 R5-267 口径记 error。
API-CHANGE: `StoreManager.clearAll()` 现在会删除持久化的当前身份键 `current_user_id`（此前只清内存实例）；依赖「clearAll 后冷启动仍恢复旧身份」的宿主需改为显式 `storage.set(CURRENT_USER_KEY, userId)` 写回。
验证：新用例断言 `current_user_id` 被删而 `user-store-*` 保留；`tests/integration/enterprise.test.ts` 多处 `storeManager.clearAll()` 均在 `beforeEach` 清存储之后调用，行为不受影响（18 套件 348 例通过）。

### R5-269  verdict=FIXED  initHotUpdate 的 JSDoc 归位

原「初始化热更新处理」块被后插入的 `let hotUpdateRegistration` / `const installedUpdateManagers` 隔开、实际挂到了 `let` 上。已把该块移到 `export function initHotUpdate` 正前并补齐监听幂等安装与切换保护目标的说明，`hotUpdateRegistration` 保留自己那条短注释。纯文档。

### R5-270  verdict=FIXED  onBeforeUpdate 与备份分开兜底；备份失败不再阻断用户确认的更新

`backupState` 与 `registration.onBeforeUpdate?.()` 拆成两个 try：回调抛错按自己的名字记 `onBeforeUpdate 回调执行失败`，不再被误记成备份失败，也不再 `return` 掉更新。备份失败改为 `backedUp` 标记：只跳过标记写入（无源恢复必须防），更新照常 `applyUpdate`——这与该处注释「备份失败不阻断更新」以及小程序存储跨更新存活的事实一致，此前代码与注释互相矛盾且用户点了确认什么都不知道。`backupState` 上方「据此跳过标记写入与 applyUpdate」的注释同步改写。
API-CHANGE: `onBeforeUpdate` 抛错或备份写入失败时，`updateManager.applyUpdate()` 现在都会被调用（此前整段更新被跳过）；备份失败的损失范围收敛为「本次更新无状态恢复」。
验证：`tests/integration/enterprise.test.ts` 的 `REGR-ENT-042b` 按新契约反转（原名「不写标记、不 applyUpdate」→「不写标记，但不静默阻断用户确认的更新」，改断言 `applyUpdate` 调用 1 次 + 宿主回调仍执行 + 标记键不存在）；新增两条用例分别锁「回调抛错不误记为备份失败」与「备份写失败仍 applyUpdate」。

### R5-271  verdict=FIXED  applyUpdate 抛错时成对清理标记与备份

`updateManager.applyUpdate()` 包 try/catch，失败按 `onUpdateFailed` 同口径 `clearBackup(registration.backupKey)` + error 留痕；否则确认→抛错→未更新的组合会把标记留在盘上，下一次普通冷启动被误判为更新后首启并回滚备份点之后的全部持久化变更。未加 toast：报告的诉求是关闭残留出口，弹提示属新增 UX 且会给 catch 自身再添一个抛错点（`onUpdateFailed` 那条是平台回调路径，不在此范围）。
验证：新用例 `applyUpdate.mockImplementationOnce(() => { throw … })` → 断言备份键与标记键都不存在、error 含「applyUpdate 失败」。

### R5-272  verdict=FIXED  抽出 clearBackup，成对不变量由代码而非复制粘贴维持

`clearBackup(backupKey)` 现被 5 处使用：过期、非纯对象、恢复成功、`onUpdateFailed`、R5-271 的 applyUpdate catch。`restoreFromHotUpdate` 的「备份缺席」分支刻意仍只删标记，并在注释写明理由：`storage.get` 对读取抛错也归一为 null，此时备份可能仍在，连它一起删会把一次瞬态读失败变成确定丢数据；`$patch` 的 catch 同样按注释说明保留两键（瞬态失败要留给下次重试）。
验证：同 R5-271 用例即锁住成对性；istanbul 上 `hot-update.ts` 100% branch。

### R5-273  verdict=FIXED  删除内置业务端点，未配置 syncUrl 时在发起请求前 reject

`DEFAULT_SYNC_URL = '/api/user/sync'` 整体删除（第四轮 #336 只把它从调用点挪到模块常量，仍是一个注定失败的业务端点）。`syncWithServer` 在 try 内首先判定 `!syncUrl` 即抛 `[UserStore] 未配置 syncUrl…`，由既有 catch 记日志并原样 rethrow——`wx.request` 不再被调用，配置缺失不再伪装成网络错误。
不采用「改成必填」：`StoreManager.getUserStore` 正是以 `createUserStore({ userId })` 建 store，必填会直接破坏该调用点并把配置缺口一路推给 `StoreManager` 构造签名；也不采用「换成绝对 URL 占位符」：那是往库里写一个假域名。`syncUrl` 仍是可选类型，语义改为「缺省即该 Store 不具备服务端同步能力」，写进 `UserStoreConfig` 注释。
API-CHANGE: 未配置 `syncUrl` 时 `dispatch('syncWithServer')` 由「向 `/api/user/sync` 发一次注定失败的请求」改为「不发请求、直接 reject 并记日志」。
验证：`tests/unit/integrations/ocr-medium-round4-p1.test.ts` 的 `#336` 按新契约重写（断言 `request` 未被调用 + reject），`#335` 与 `tests/integration/enterprise.test.ts` 的 `ENTERPRISE-035/036/065/066` 补 `syncUrl: 'https://api.example.com/user/sync'`（这四条锁的是响应校验与失败传播，必须有地址才能走到请求）；另有 `r5-integrations-p1-enterprise.test.ts` 一条专测两种分支。

### R5-274  verdict=FIXED  initialState 逐字段回落默认值，不再靠展开顺序

`state` 改为 `userInfo: initialState.userInfo ?? null` / `preferences: … ?? {}` / `lastSyncTime: … ?? null`，取消 `...initialState` 尾随展开：`Partial<UserState>` 在 `exactOptionalPropertyTypes` 关闭时允许显式 `undefined`，展开会把三个契约字段覆盖成 undefined（`updatePreferences` 在 undefined 上展开抛错、持久化 filter 序列化出缺键载荷）。
验证：新用例传全 `undefined` 后断言默认值与 `updatePreferences` 正常写入，另一条断言给了值仍按值初始化（无行为回退）。

### R5-275  verdict=FIXED  syncWithServer 增加销毁判定 + 请求序号守卫（不采用在途去重）

两处都补：await 之后先判 `store.destroyed`（`ActionContext` 基座无 `destroyed`，故用闭包里的 store 引用）——丢弃结果并 warn，不再让 `$patch` 的「Cannot call $patch on a destroyed Store」被记成「同步用户信息失败」后 rethrow；再用 `syncSequence` 序号丢弃被更晚请求取代的旧响应。
刻意不采纳报告建议的 in-flight flag：布尔标记会让并发第二次调用直接空转返回（谎报成功），共享 promise 则要再造一个 deferred（否则 leader 的 rejection 无人接），两种都会改变「每次调用都拿到本次同步结果」的既有公开契约；序号守卫在保留该契约的前提下关掉了实际缺陷（旧覆盖新）。这条理由写进了代码注释。
验证：新用例两条——两次 dispatch、让后发请求先返回再让旧响应到达，断言 `userInfo` 仍是新值；另一条在 await 期间 `store.destroy()`，断言 promise resolve、warn「Store 已销毁」且没有「同步用户信息失败」的 error。

### R5-282  verdict=FIXED  showLoading / hideLoading 抛错都不卡死互斥标记，也不跳过同步

按报告的判定点（标记必须可复位）实现，但不采纳「catch 里 return」：那会让加载提示不可用的宿主永远同步不了离线队列，与「同步本体优先」的意图相反。现改为 catch 后记 error 并继续执行 `syncQueue()`；`finally` 里的 `hideLoading` 同样兜住——它抛错会沿 finally 变成这条 promise 上没人接的 rejection（`catch` 在 `finally` 之前）。
验证：新用例把 `showLoading`/`hideLoading` 都设为抛错，两轮「入队 → onShow → flush」后断言重放计数 1→2（标记未卡死）且两条 error 文案各命中一次；`#359`（重复 onShow 不重复弹 loading）仍通过。

### R5-283  verdict=FIXED  onLaunch 与 login 共用同一份热更新配置

`hotUpdateOptions` 提到 `createEnterpriseApp` 闭包里，两条注册路径都 `initHotUpdate({ store, ...hotUpdateOptions })`；`initHotUpdate` 整体覆盖注册，此前换号后 `onBeforeUpdate` 在本次会话余下时间静默丢失。备份键仍按 store 名派生（换号后目标切换不变）。
验证：新用例 `onLaunch()` + `login('r5-283-b')` 后触发 `onUpdateReady` → 确认弹窗，断言 console.log 命中「准备更新，状态已备份」且 `store_backup_before_update_user-store-r5-283-b` 已落盘、`applyUpdate` 调用 1 次。

### R5-284  verdict=FIXED  只有「持久化标识本身无效」才清 CURRENT_USER_KEY

判定前移到读键处：新增与 `createUserStore` 入口校验同源的 `isValidUserId`（user-store.ts 导出、不在 `enterprise/index.ts` 的对外清单里，公开面不变），冷启动据此分岔——无效（空/纯空白/非字符串）才清键按未登录处理；有效但 `switchUser` 抛错（store 创建、插件安装、LRU 淘汰既有账号时的 destroy/订阅者异常）只记 error 并保留身份，下次冷启动可重试。第四轮 #337/#340 的连带 try/catch 结论未被推翻，只是收窄了它的作用范围。
验证：两条新用例——`jest.spyOn(storeManager, 'switchUser')` 抛错后断言 `current_user_id` 仍为原值且 `getStore()` 为 null；`'   '` 与 `{"id":1}` 两种脏形态（循环内）断言键被清、error 含「持久化的用户标识无效」。

### R5-292  verdict=FIXED  clearQueue / clearDeadLetters 同受 disposed 所有权守卫约束

两者都加 `if (this.disposed) { logger.warn(…); return }`（报告只写了 clearQueue，但同一开头句已点名 clearDeadLetters，且死信键同样由 queueKey 派生、由新实例继续追加）。选择 warn 而非静默 return，与 R5-249 同口径：被拒绝的调用必须可诊断。
验证：两条新用例——dispose 后清空两个键都不动、warn 各命中；未 dispose 时 `clearQueue` 仍删键（对照组）。既有「同步途中 clearQueue 不复活」的 R5 回归仍通过。

### R5-293  verdict=FIXED  重放失败逐条 warn（带 action 类型与错误）

`catch {}` 改为 `catch (error)` 并 `logger.warn('OfflineManager', \`同步执行失败: ${action.type}\`, error)` 后返回 false。此前 `execute()` 只记首次失败，之后每次重放的失败原因（未知 action、业务拒绝、永久 4xx）在日志里完全消失，只剩一条计数 toast 和重试耗尽后的死信日志。
验证：新用例（队列为不存在的 action）断言 warn 文案含「同步执行失败: notAnAction」；`r5-integrations-p1-enterprise.test.ts` 另两条 syncQueue 用例也覆盖此路径。

### R5-294  verdict=FIXED  toast 计数改读 this.syncFailed（与 finally 的保留口径同源）

入队目标仍是局部 `failedActions`：`clearQueue` 在同步途中会把字段重绑为新数组，若改往 `this.syncFailed` push，被用户清掉的操作会在 finally 里复活落盘——那正是上方注释与既有 R5 回归要防的。因此只把「读」的一侧改成字段，与 finally 的拼接口径统一。
验证：两条新用例——同步途中 clearQueue 后断言 `showToast` 未被调用且队列为 0；对照组（未清空）断言 `{ title: '1个操作同步失败', icon: 'none' }`。

### R5-295  verdict=FIXED  死信淘汰条数落日志

按报告实现 warn（含淘汰条数与死信键），不补 `onDrop` 回调：其契约是「操作刚被移入死信」，对 500 条之外被容量淘汰的旧死信再回调会让业务层重复补发/重复上报。注释写明被淘汰的是未人工处理的失败操作、必须可采集。
验证：新用例预置 500 条合法死信 + 一条 `maxRetryCount=1` 的失败操作，断言 warn 含「淘汰最旧 1 条未处理操作」且 `getDeadLetters()` 仍为 500 条。

### R5-296  verdict=REJECT  不给离线队列加容量上限或防抖落盘

报告的三个前提在本轮代码里都不成立或不划算：
1. 「only in memory 不可观察」已由第四轮实现——`enqueue` 与 `syncQueue` finally 都检查 `saveQueue()` 返回值并 warn（`#351` 回归锁的就是这条文案），报告要求的 bounded **observable** 已满足。
2. 加硬上限等于丢弃尚未同步的用户操作，正是本模块（at-least-once + 死信）要防的静默丢失；溢出的条目若转存死信，仍落在同一个 10MB 配额里，解决不了报告自己提出的配额问题。
3. 防抖/批量落盘会把「已确认入队」与「已落盘」脱钩：离线场景进程被杀是常态而非小概率窗口，第四轮为守住这点专门实现了 `syncPending/syncFailed` 联合视图落盘（`#354`、`#352` 两条 reject/fix 结论同一口径）。
成本侧也不支撑改动：单次 `enqueue` 序列化 O(n)，小程序端队列规模受 `maxRetryCount` 与死信上限约束，报告的 O(n²) 需要数千条未同步操作才可见，而那种规模下先失效的是配额而非 CPU。
保留为已知设计取舍，不改代码；若后续要可观测性升级，正确切口是配额失败后的告警上报（属宿主层），不是给队列加丢弃策略。

---

## 连带项：`enterprise/env.ts` 未接 `normalizeWxStoredValue`（第四轮遗留同口径问题，报告未逐条列出）

判定：**无需改动，现状已是单点口径**。证据：`grep -rn "getStorageSync|setStorageSync|removeStorageSync" src/integrations/` 只命中 `enterprise/env.ts` 的 `storage` 工具（其余全是注释），即企业模块的读/写/删没有第二个入口；`storage.get` 第 113 行 `if (value === '' || value === undefined || value === null) return null` 已把微信「缺失键返回 `''`」归一为 null，与 `WxStorageBackend.normalizeWxStoredValue` 的语义等价（后者只需覆盖 `''`，因为它要先经 `assertSyncStorageResult` 处理非字符串载荷，返回契约是 `string | null`）。
不改成跨层调用 `plugins/WxStorageBackend.js` 的那个导出：两者的返回契约不同（env 要保留宿主直返的非字符串原始值），硬接只会在 env 里再造一层「先归一再展开」的间接表达，且把 integrations 与插件内部工具绑死。本轮只在 `get`/`remove` 的文档里把「缺失键 vs 空串不可区分」这条平台事实与它对 R5-264 结论的影响写清（见上文 R5-264/R5-265）。

## NEEDS-MAIN（分片外文件，需主会话或文档分片同步）

- NEEDS-MAIN: `docs/API.md`（第 565、576 行附近）`createUserStore` 条目仍写「同步地址由 `syncUrl` 配置（有模块默认值）」——R5-273 已删除模块默认值，需改为「未配置 `syncUrl` 时 `syncWithServer` 直接 reject」；同一小节还应补 `clearAll` 现会清 `current_user_id`（R5-268）与备份失败仍 applyUpdate（R5-270）的行为变更。
- NEEDS-MAIN: `.codebuddy/skills/geomstore/references/api/integrations.md`（369-370 行）与 `.../api/extras-enterprise.md`（342-343 行）内联了 `UserStoreConfig` 的注释原文「缺省用模块默认 `DEFAULT_SYNC_URL`」，该常量已不存在，需随源码注释重新生成。
- NEEDS-MAIN: `CHANGELOG.md` 第 22 行仍描述「配置项新增 `syncUrl`（缺省沿用内置默认端点）」，本轮改为无默认端点 + 未配置即 reject，发版说明需覆盖这一破坏性口径。
