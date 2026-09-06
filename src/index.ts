/**
 * GeomStore - 轻量级微信小程序状态管理库
 *
 * 核心入口（瘦核心）：仅 re-export `./core/index` 中的必需 API，确保主包不被高级功能拖大。
 * 快照 / 选择器 / 性能监控 / Action 增强 / 企业微信集成 / 插件 等可选能力请按需从
 * `./extras`（或子入口 `./extras/snapshot`、`./extras/selector` 等）动态引入。
 *
 * 注意：必须使用显式 `./core/index`，不能用 `./core`。微信小程序运行时
 * `require('./core')` 不会回退到目录索引 `core/index.js`，会导致
 * "module 'libs/geomstore/src/core.js' is not defined" 编译报错。
 */
export * from './core/index'
