/**
 * 微信小程序集成示例：Page / Component / App
 *
 * 这里刻意不做 `export * as x from './x.js'` 式的静态再导出：三个示例都要在模块里调用宿主
 * 注册函数（`Page` / `Component` / `App`），而它们只存在于微信小程序运行时——
 * `examples/global.d.ts` 里那几条 `declare function` 是纯编译期声明，不产出任何运行时代码。
 * 静态再导出等于让「在 Node 里 import 一下本 barrel」（文档生成器、jest、脚本）在模块求值
 * 阶段就抛 `ReferenceError: Page is not defined`，而不是像各文件末尾那句「需在微信小程序
 * 环境中运行」所暗示的那样只是不执行。
 *
 * 所以本 barrel 只做清单/文档索引。三个示例都把宿主注册包在守卫里（`typeof App === 'function'`
 * / `typeof Component === 'function'` / `typeof Page === 'function'`）并导出自己的 Store 与配置，
 * 要复用请直接 import 对应文件；page-integration.ts 另把两种映射写法各导出一份配置
 * （`simplePageOptions` / `aliasedPageOptions`），守卫内只注册前者。
 */

/** 小程序集成示例清单：path 相对本目录，requiresHost 是该文件需要的宿主全局函数 */
export const weappExamples = [
  {
    name: 'page-integration',
    path: './page-integration.ts',
    requiresHost: ['Page'],
    description: 'Page 集成：数组简写与对象别名映射、onUnload 自动清理订阅',
  },
  {
    name: 'component-integration',
    path: './component-integration.ts',
    requiresHost: ['Component'],
    description: 'Component 集成：状态/getter/action 注入、detached 自动退订',
  },
  {
    name: 'app-integration',
    path: './app-integration.ts',
    requiresHost: ['App'],
    description: 'App 集成：映射状态挂到 globalData、映射 action 绑到实例、生命周期与错误回调',
  },
] as const
