# 分片 hot-p0（critical + high，14 条）— 主会话执行

报告来源：`ocrreview.md`。清单：`.ocr-fix/groups5/hot-p0.md`。
回归锁：`tests/unit/hot-round5.test.ts`（25 例）+ 改动的既有用例（见各条）。

### R5-018  verdict=FIXED  dist 内部的链接改为按 lstat+realpath 判定，只删链接本身

原实现只在**顶层**对 `dist` 做 realpath 守卫，`removeDirTree`/`countFiles` 用 `readdir` 的
`Dirent.isDirectory()` 分类，等于允许「守卫之外的第二入口」。新增 `classifyEntry`（lstat +
realpath 双判据）+ `removeLink`（unlink 失败回落 rmdir，Windows 目录型链接的 EPERM 出口），
并把 `samePath` 大小写规则并入顶层守卫共用。

报告描述的数据损失在本机 Node 22.22.2 上**不可复现**：实测 junction 的 `Dirent` 已经是
`isLink=true / isDir=false`（`node -e` 探针），旧代码走 unlink 分支恰好没进去——所以这条的价值
是把不变量写成代码而非依赖某个 Node 版本的分类行为。
冒烟（`.cache/r5cd`，仓库内 fixture，dist 内挂 junction 指向 `outside/`）：
`node scripts/clean-dist.mjs` → `removed dist (3 files)`，`outside/precious.txt` 内容不变。

### R5-022  verdict=FIXED  stub 清理判据由子串匹配改为与生成值全等

`pkg.main.includes('dist')` 会让任何 main 含 `dist` 字样的真实目录被 `rmSync(recursive)` 整目录删掉。
改为用 `subpathEntries[sub]` 反推 `path.relative(dir, distDir/rel/index.js)` 并全等比较。
冒烟（`.cache/r5stub`）：`store/package.json` main=`../dist/core/store/index.js` 被删；
`plugins/package.json` main=`../distributed/index.js`（含 `dist` 字样）连同 `plugins/keep-me.ts` 存活，
输出 `removed 1 subpath stub dirs`。

### R5-089  verdict=FIXED  时钟基准降级时作废在途计时

`_getTimestamp` 因读数非有限而降级到 `Date.now()` 时，`currentOperations` 里以 wx 时钟写入的
startTime 会与之混算出 ~1.7e12 的 duration 并被记成超阈值样本。降级同时 `clear()` 在途条目并
`console.debug` 留痕（disposer 走既有的「计时条目缺失」分支解释缺口）。回归：hot-round5 两条。

### R5-102  verdict=FIXED  构造期订阅失败降级改为留痕

`catch {}` 吞掉子 store 订阅异常后 `_mergedCacheEnabled=false` 终身不可恢复且无任何诊断。
补 `isProduction()` 门控的 `console.warn`（与同文件其它降级告警同风格）。
不采纳「收窄 catch 到预期错误」：`SubscriptionManager` 的抛错类型不止一种，收窄会把
`destroy` 后的 TypeError 变成未捕获异常，代价大于收益。回归：hot-round5 一条。

### R5-176  verdict=FIXED  withLog 的 sink/redact 抛错与业务调用隔离

`createDecorator` 只保护 `onError`：`before` 抛错会顶掉 action 本体，`after` 抛错会把成功的
调用改判为失败。新增 `safeLog`（告警走 console 而非 sink，避免 sink 自身故障时递归），
`before`/`after`/`onError` 三处都经它，并把承诺写进 `sink` 选项文档。回归：hot-round5 两条。

### R5-193  verdict=FIXED  节流返回值判定改用共享 isThenable

两处 `result instanceof Promise`（尾随补发、leading 分支）都漏手写 thenable 与跨 realm Promise：
前者让 rejection 无人接变成 unhandledRejection，后者让 `sawPromise` 永不置位、被抑制的调用
返回 undefined。把 `common.ts` 的 `isThenable` 导出并复用，尾随路径改 `Promise.resolve(x).catch(...)`。
回归：hot-round5 两条（leading 返回 Promise；尾随 rejection 被就地报告）。
连带项：`cache.ts:335` 同一形态留给 extras-action 分片处理。

### R5-192  verdict=FIXED  非 Error 抛出值不得留下孤儿计数

`context.error as GeomStoreError` 后裸读 `.name/.message`：`throw null` 时抛 TypeError，
而 `_countStoreHit` 已在前一行写进 `storeHits`，`groups/fingerprints` 里没有该组，
清理只遍历已有组 → `sum(byStore)` 永久大于 `totalErrors`。改为保护式取值（与 `buildFingerprint`
同口径）+ 建组成功之后才计数；`GeomStoreError` 值导入随之删除（仅剩注释引用）。
回归：hot-round5 一条（type='Error' / message='null' / 账目自洽）。

### R5-201  verdict=FIXED  达到重试上限时保留计数与周期窗

原实现删 `retryCount` + `retryWindowStart`，紧接的下一次 `recover` 落进 `windowStart===undefined`
分支重新计满额度，「max-retries 防重试风暴」只对触发超限那一次生效。改为只抛错不清键，
新周期仅由时间窗过期判定开启。同步修正 `ErrorRecovery.test.ts` 的 BUG-13（该用例此前把
「上限后立即重新发满额度」当作期望行为）并加可控时钟跨过周期窗。

### R5-220  verdict=FIXED  重试选择器不得丢弃 falsy 抛出值

`if (lastError)` 用真值性代表「捕获到错误」，而 `throw null/0/''/false/undefined` 都是合法抛出值，
真值判定会丢掉原始值与 attempts 标注，且证明该分支并非死代码（与 `istanbul ignore else` 的断言矛盾）。
改 `NO_ERROR` 哨兵 + `lastError: unknown`，`annotateAttempts` 形参放宽到 `unknown`；
`istanbul ignore else` 删除、`ignore next` 只留在真正不可达的合成错误上。
回归：hot-round5 覆盖 5 个 falsy 值 × 同步 + 异步。

### R5-224  verdict=FIXED  缓存失效凭证改为显式选项 snapshotState

原判据是「`equalityFn === deepEqual` 的函数引用身份」，自定义深比较器（lodash isEqual、
`(a,b)=>deepEqual(a,b)`、ESM/CJS 双副本的 deepEqual）会被判成身份比较 → 缓存活引用 →
`equalityFn(item.state, state)` 两个实参同一对象、深比较恒等 → 就地变异看不见、TTL 内持续陈旧。
新增 `SelectorOptions.snapshotState`（默认 true=内容快照），`false` 才缓存活引用；
同步改 `src/types/selector.ts` 契约、`createSelector` 的性能口径与示例。
**行为变更**：只传 `equalityFn: (a,b)=>a===b` 而不传 `snapshotState: false` 的调用方会从「命中」
变成「不命中」（不会返回错值）。两处第四轮用例按新契约补齐选项；hot-round5 三种组合各一条。

### R5-247  verdict=FIXED  App 的非对象实参原样透传

默认参数只挡 `undefined`，`App(null)` 在下一次属性读取即 TypeError，`App('x')/App(123)` 在严格模式下
`options.onShow = ...` / `defineProperty` 同样抛错——包装器把一次本会被基础库忽略的调用变成 App 启动失败。
`typeof rawOptions !== 'object' || null` 时直接 `originalApp.call(this, rawOptions)`。
回归：hot-round5 三条 falsy/原始值 + 一条正常配置仍被包装。

### R5-258  verdict=FIXED  batchSize 守卫对合并后的值生效

守卫只校验 `options.batchSize`，回落值 `this.defaultOptions.batchSize` 本身来自构造期 `...options`，
于是 `new SnapshotManager({ batchSize: 0 })` 仍能产出「success 且 data 为空」的半成品。
抽 `DEFAULT_BATCH_SIZE` + `normalizeBatchSize`，构造期默认值与逐次调用共用同一函数。
回归：hot-round5 两条（构造期 0 / 构造期 NaN + 逐次 -5）。既有 REGR-SNAP-011 只覆盖逐次形态。

### R5-279  verdict=FIXED  wx 存储方法缺失时抛错而非静默 no-op

`this.wxApi?.setStorageSync?.()` 短路成 `undefined`，过得了 `assertSyncStorageResult`：
写/删「看起来成功」（`clearOnUninstall` 误报已清除），读被归一化成「键无数据」→ 随后一次落盘覆盖真实数据。
新增私有 `resolve(name)`：wx 或对应方法缺失/非 callable 即抛错，三个方法各自套用；
类文档与 `WxStorageApi` 的注释同口径改写。`wx-storage-backend.test.ts` 的三条「不抛错」期望
按新契约改为抛错（该用例固化的正是被驳回的旧行为）。

### R5-305  verdict=FIXED  全局调试表可用性判定改 isExtensible 并兜住两处抛错

`!Object.isFrozen` 放行了「只 seal 未 freeze」的表（自有属性仍可写但新增键抛错），
且可扩展的表也可能已有同名不可配置属性；兜底建表 `g[globalKey] = {}` 在只读访问器上同样抛。
改为 `Object.isExtensible` + 建表与 defineProperty 各自 try/catch，失败时告警并返回 no-op 卸载，
兑现文件头承诺的 fail-safe。回归：hot-round5 两条（seal 表换新表、不可配置键降级 no-op）。
