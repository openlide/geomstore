/**
 * GeomStore 示例目录
 *
 * 分类：基础（Store/Action/Getter）、缓存、小程序集成、高级（组合/插件）、
 * extras（按需引入的可选能力：快照/选择器/装饰器）。
 *
 * 所有示例均可直接 `ts-node`/`tsx` 运行；含 `Page`/`Component`/`App` 的示例
 * 需在微信小程序环境执行。类型检查：`pnpm typecheck:examples`。
 *
 * @module examples
 */

export * as basic from './basic/index.js'
export * as cache from './cache/index.js'
export * as weapp from './weapp/index.js'
export * as advanced from './advanced/index.js'
export * as extras from './extras/index.js'

/**
 * 示例清单：供文档与其他工具枚举
 *
 * ⚠️ 与上面的 `export * as …` 是两份**独立维护**的表：新增/重命名/删除示例
 * 文件时必须同步这里，否则文档工具按本清单枚举会指到不存在的路径、且**不会**
 * 有编译期报错（`path` 只是纯字符串）。另外本清单里的路径以 `.ts` 结尾（源码
 * 视角），`export * as …` 走的是编译后的 `.js`；两处扩展名有意不同，若把
 * 本清单交给 NodeNext 动态 import 需先做扩展名转换
 */
export const exampleCategories = {
  basic: [
    { name: 'simple-store', path: './basic/01-simple-store.ts', description: '创建与使用 Store' },
    { name: 'actions', path: './basic/02-actions.ts', description: '同步/异步 Action' },
    { name: 'getters', path: './basic/03-getters.ts', description: 'Getter 派生状态' },
  ],
  cache: [
    { name: 'basic-cache', path: './cache/01-basic-cache.ts', description: '开启内置缓存' },
    { name: 'selective-cache', path: './cache/02-selective-cache.ts', description: '只缓存热点状态' },
    { name: 'dynamic-cache', path: './cache/03-dynamic-cache.ts', description: '运行时开关缓存' },
  ],
  weapp: [
    { name: 'page-integration', path: './weapp/page-integration.ts', description: 'Page 集成' },
    { name: 'component-integration', path: './weapp/component-integration.ts', description: 'Component 集成' },
    { name: 'app-integration', path: './weapp/app-integration.ts', description: 'App 集成' },
  ],
  advanced: [
    { name: 'compose-stores', path: './advanced/compose-stores.ts', description: 'Store 组合' },
    { name: 'plugins', path: './advanced/plugins.ts', description: '插件使用与自定义' },
  ],
  extras: [
    { name: 'snapshot', path: './extras/snapshot.ts', description: '快照（同步/异步）' },
    { name: 'selector', path: './extras/selector.ts', description: '选择器缓存' },
    { name: 'action-decorators', path: './extras/action-decorators.ts', description: 'Action 装饰器' },
  ],
}

/** 打印示例清单 */
export function listExamples(): void {
  console.log('\n📚 GeomStore 示例清单\n')
  Object.entries(exampleCategories).forEach(([category, examples]) => {
    console.log(`\n${category.toUpperCase()}:`)
    examples.forEach((example, index) => {
      console.log(`  ${index + 1}. ${example.name} — ${example.description}`)
      console.log(`     ${example.path}`)
    })
  })
}
