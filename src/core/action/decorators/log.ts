/**
 * GeomStore v1.0 - 日志装饰器
 *
 * 在Action执行前后记录日志，便于调试
 *
 * @since 1.0.0
 */

import { createDecorator } from './common'

/**
 * 创建日志装饰器
 *
 * 在Action执行前后记录日志，便于调试
 *
 * @param {string} [name] - Action名称（用于日志标识）
 * @returns {MethodDecorator} 方法装饰器
 *
 * @example
 * ```typescript
 * class MyComponent {
 *   @withLog('fetchUserData')
 *   async fetchUser(id: string) {
 *     return await fetch(`/api/users/${id}`).then(r => r.json())
 *   }
 * }
 *
 * // 控制台输出：
 * // [Action] fetchUserData started with args: ['user-123']
 * // [Action] fetchUserData completed with result: { id: 'user-123', name: 'John' }
 * ```
 */
export function withLog(name?: string): MethodDecorator {
  return createDecorator({
    before: (...args) => {
      console.log(`[Action] ${name || 'action'} started with args:`, args)
    },
    after: (result) => {
      console.log(`[Action] ${name || 'action'} completed with result:`, result)
    },
    onError: (error) => {
      console.error(`[Action] ${name || 'action'} failed:`, error)
    },
  })
}
