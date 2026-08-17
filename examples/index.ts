/**
 * GeomStore 示例目录
 *
 * 提供各种使用场景的示例代码
 *
 * @module examples
 */

// ==================== 基础示例 ====================

/**
 * 基础示例
 * - 创建简单 Store
 * - 使用 Actions
 * - 使用 Getters
 */
export * as basic from './basic'

// ==================== 缓存示例 ====================

/**
 * 缓存示例
 * - 基础缓存
 * - 选择性缓存
 * - 动态控制缓存
 */
export * as cache from './cache'

// ==================== 微信小程序集成示例 ====================

/**
 * 微信小程序集成示例
 * - Page 集成
 * - Component 集成
 * - App 集成
 */
export * as weapp from './weapp'

// ==================== 高级示例 ====================

/**
 * 高级示例
 * - Store 组合
 * - 插件使用
 */
export * as advanced from './advanced'

// ==================== 示例列表 ====================

export const exampleCategories = {
  basic: [
    { name: 'simple-store', path: './basic/01-simple-store.ts', description: '创建简单 Store' },
    { name: 'actions', path: './basic/02-actions.ts', description: '使用 Actions' },
    { name: 'getters', path: './basic/03-getters.ts', description: '使用 Getters' },
  ],
  cache: [
    { name: 'basic-cache', path: './cache/01-basic-cache.ts', description: '基础缓存' },
    { name: 'selective-cache', path: './cache/02-selective-cache.ts', description: '选择性缓存' },
    { name: 'dynamic-cache', path: './cache/03-dynamic-cache.ts', description: '动态控制缓存' },
  ],
  weapp: [
    { name: 'page-integration', path: './weapp/page-integration.ts', description: 'Page 集成' },
    { name: 'component-integration', path: './weapp/component-integration.ts', description: 'Component 集成' },
    { name: 'app-integration', path: './weapp/app-integration.ts', description: 'App 集成' },
  ],
  advanced: [
    { name: 'compose-stores', path: './advanced/compose-stores.ts', description: 'Store 组合' },
    { name: 'plugins', path: './advanced/plugins.ts', description: '插件使用' },
  ],
}

// ==================== 运行示例帮助函数 ====================

/**
 * 打印示例列表
 */
export function listExamples(): void {
  console.log('\n📚 GeomStore 示例列表\n')

  Object.entries(exampleCategories).forEach(([category, examples]) => {
    console.log(`\n${category.toUpperCase()}:`)
    examples.forEach((example, index) => {
      console.log(`  ${index + 1}. ${example.name}`)
      console.log(`     路径: ${example.path}`)
      console.log(`     描述: ${example.description}`)
    })
  })
}
