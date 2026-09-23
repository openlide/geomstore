/**
 * Extras 示例：按需引入的可选能力
 *
 * 这些能力不属于运行必需的核心 API，不会进入小程序主包——请按需引入：
 * `@openlide/geomstore/extras/snapshot`、`/selector`、`/action`、`/performance`、`/plugins`、`/error`
 */

export * as snapshot from './snapshot.js'
export * as selector from './selector.js'
export * as actionDecorators from './action-decorators.js'
