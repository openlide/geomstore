/**
 * GeomStore - 状态版本号
 *
 * 为选择器等需要判断「状态是否变化」的消费者提供 O(1) 的变更判定，
 * 替代此前每次执行都做全树 deepEqual 的做法。
 */

/**
 * 状态版本号标记键。
 *
 * 使用 Symbol.for 全局注册：core/store 与 extras/selector 分处不同模块，
 * 需保证取到同一个键。
 *
 * 该属性定义为不可枚举，因此 Object.keys / JSON.stringify / deepCloneState
 * 都不会感知它——不会污染状态快照、序列化结果与 setData 下发数据。
 */
const STATE_VERSION = Symbol.for('geomstore.stateVersion')

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
 * @returns 版本号；状态无版本标记（非 Store 状态，如测试中直接传入的普通对象）时返回 undefined
 */
export function getStateVersion(state: unknown): number | undefined {
  if (state === null || typeof state !== 'object') {
    return undefined
  }
  try {
    const version = (state as Record<symbol, unknown>)[STATE_VERSION]
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
