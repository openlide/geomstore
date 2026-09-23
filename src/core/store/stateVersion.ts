/**
 * GeomStore - 状态版本号
 *
 * 为选择器等需要判断「状态是否变化」的消费者提供 O(1) 的变更判定，
 * 替代此前每次执行都做全树 deepEqual 的做法。
 */

/**
 * 状态版本号标记键。
 *
 * 用 `Symbol.for` 而非模块级 `Symbol()`：小程序构建产物里同一包常有重复副本
 * （分包各自打包、宿主库把本库一起打进去）。模块级键会让副本 A 装的版本号在副本 B 的
 * `getStateVersion` 下读不到——读不到的后果是退化成 deepEqual（只慢不错），
 * 但「同一份状态、两套键」的分裂比慢更难排查。与 GEOMSTORE_BRAND 同一取舍
 * （见 core/store/pluginSupport.ts）。跨模块共用的是 `getStateVersion` 这个函数，
 * 不是这个键本身：键之所以仍是全局的，只为副本之间也能读到同一个值。
 *
 * 可伪造性：全局符号表公开，任何代码都能取到同一个键并给对象塞一个版本号，
 * 让消费者判为「未变化」而返回陈旧值。本键**不是安全边界**——缓存/索引的正确性
 * 不依赖它不可伪造：读不到版本号时的兜底路径（deepEqual、归属解析不出即标全部顶层键）
 * 就是按「不可信」设计的，且 getStateVersion 只认自有属性，往原型上挂版本号无效。
 *
 * 从本模块导出：测试与消费者要反查这个键时统一引用它，别再各写一份
 * `Symbol.for('geomstore.stateVersion')` 字面量——键名一改，散落的字面量静默发散。
 *
 * 该属性定义为不可枚举，因此 Object.keys / JSON.stringify / deepCloneState
 * 都不会感知它——不会污染状态快照、序列化结果与 setData 下发数据。
 */
export const STATE_VERSION: unique symbol = Symbol.for('geomstore.stateVersion')

/**
 * 在状态对象上定义版本号 getter。
 *
 * 用 getter 而非普通值：Store 的变更计数在 setState / $patch / $replaceState
 * 以及 action 上下文的可写视图（this.state 脏跟踪 Proxy）写入陷阱中递增，
 * 用 getter 动态读取可免去在每条写入路径上同步更新。
 *
 * 注意：对外只读视图 `store.state` 的保护 Proxy 仅拦截外部写入，其「放行」分支
 * （生产 warn/silent）不递增计数——此类直写属被保护机制明确劝退的反模式，
 * 版本号不反映它；请始终通过 setState/$patch/$replaceState 修改状态。
 *
 * 定义失败时静默忽略（**任何**异常都不外溢，理由见函数体内注释）：
 * 消费者会自动回退到 deepEqual 比较，仅损失优化而不影响正确性。
 *
 * @param state - 状态对象
 * @param getVersion - 返回当前变更计数的取值函数
 */
export function defineStateVersion(state: object, getVersion: () => number): void {
  try {
    Object.defineProperty(state, STATE_VERSION, {
      get: getVersion,
      enumerable: false,
      configurable: true,
    })
  } catch {
    // 刻意不区分异常种类（`if (!(e instanceof TypeError)) throw` 这种收窄经实测否证：
    // 报告点名的三类「调用方缺陷」——getVersion 非函数（"Getter must be a function"）、
    // 描述符非法（accessor + writable）、覆盖不可配置属性——Node 里抛的全是 TypeError，
    // 与预期吞掉的「目标非可扩展/被冻结」同为 TypeError，按构造器判别分不开。
    // 能被判出来的只剩 Proxy 陷阱抛的非 TypeError 异常，而那恰恰最不该外溢：
    // 本函数是纯优化装载（拿不到版本消费者就回退 deepEqual），在 setState/$patch 的
    // 写入热路径上抛错等于把降级入口变成崩溃入口。
    // 代价是调用方缺陷（传错 getVersion 等）会静默退化为「无版本 + 每次 deepEqual」，
    // 只慢不错；调用侧参数已由 Store 内部固定，实际不构成可踩到的坑
  }
}

/**
 * 读取状态版本号。
 *
 * 状态保护 Proxy 的 get 陷阱对非对象值直接透传，故经 `store.state` 读取
 * 同样能拿到版本号。
 *
 * @param state - 状态对象（或状态保护 Proxy）
 * @returns 版本号；状态无**自有**版本标记（非 Store 状态，如测试中直接传入的普通对象）时返回 undefined
 */
export function getStateVersion(state: unknown): number | undefined {
  if (state === null || typeof state !== 'object') {
    return undefined
  }
  try {
    // 只认自有属性：版本号是 defineStateVersion 挂在具体对象上的 getter，计数的是
    // **那个对象**的变更。走 [[Get]] 会顺原型链读到一个外来版本号——
    // 由有版本的对象派生（`Object.create(旧状态)`，deepCloneState 就是按同原型克隆，
    // 见 core/utils/clone.ts）或原型上恰好有同名 symbol 属性时，两个不同对象会报出
    // 同一个版本，`getStateVersion(root) !== indexedVersion` 恒为 false：
    // 脏追踪索引不再重算、选择器缓存在 TTL 内持续命中，静默返回陈旧结果。
    // hasOwnProperty 走 [[GetOwnProperty]]，保护 Proxy 未拦该陷阱、照常转发到原始状态，
    // 因此不会误伤 `store.state` 这条主读取路径
    const version = Object.prototype.hasOwnProperty.call(state, STATE_VERSION) ? (state as Record<symbol, unknown>)[STATE_VERSION] : undefined
    // 只接受有限数值：NaN/Infinity 也满足 typeof === 'number'，
    // 而 NaN !== NaN 会让每次比较都判为「版本已变」，等于把快捷路径变成强制回退
    return typeof version === 'number' && Number.isFinite(version) ? version : undefined
  } catch {
    // 读取本身抛错（状态保护 Proxy 的 get 陷阱或 defineProperty 装的 getter 闭包抛出）：
    // 本函数是「拿不到版本就回退 deepEqual」的降级入口，在 createSelector 缓存命中判定、
    // 脏追踪 report 等热线上被调用，异常外溢会把降级路径变成崩溃路径
    return undefined
  }
}
