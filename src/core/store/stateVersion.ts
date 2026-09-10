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
 * 定义失败（状态对象被冻结或不可扩展）时静默忽略：
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
    // 状态对象不可扩展/被冻结：放弃版本化，消费者回退到 deepEqual
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
  const version = (state as Record<symbol, unknown>)[STATE_VERSION]
  return typeof version === 'number' ? version : undefined
}
