/**
 * Extras 示例：按需引入的可选能力
 *
 * 这些能力不属于运行必需的核心 API，不会进入小程序主包——请按需引入：
 * `@openlide/geomstore/extras/snapshot`、`/selector`、`/action`、`/performance`、`/plugins`、`/error`
 *
 * 本 barrel 只 re-export 三个示例子模块（snapshot / selector / action-decorators）；
 * `performance` / `plugins` / `error` 的示例分别位于 `examples/advanced/plugins.ts` 与
 * 其他目录，未在此聚集。消费者若要用这些子路径请从 `@openlide/geomstore/extras/*` 直接引入
 */

export * as snapshot from './snapshot.js'
export * as selector from './selector.js'
export * as actionDecorators from './action-decorators.js'
