/**
 * Store 内部工具函数测试
 * 目标覆盖率: 99%+
 */

import { isProduction, createMutationErrorMessage, deepCloneState } from '@/core/store/utils'

// 重新导入以清除模块缓存
let _isProduction: typeof isProduction

describe('store/utils', () => {
  beforeEach(() => {
    // 清除缓存 - 重新 require 模块
    jest.resetModules()
    ;({ isProduction: _isProduction } = require('@/core/store/utils'))
  })

  describe('isProduction', () => {
    const originalEnv = process.env.NODE_ENV

    afterEach(() => {
      process.env.NODE_ENV = originalEnv
    })

    it('应该在 NODE_ENV=production 时返回 true', () => {
      process.env.NODE_ENV = 'production'
      expect(_isProduction()).toBe(true)
    })

    it('应该在 NODE_ENV=development 时返回 false', () => {
      process.env.NODE_ENV = 'development'
      expect(_isProduction()).toBe(false)
    })

    it('应该在 NODE_ENV=test 时返回 false', () => {
      process.env.NODE_ENV = 'test'
      expect(_isProduction()).toBe(false)
    })

    it('应该在没有 process.env 时返回 false', () => {
      // 暂存原始 process 并移除
      const originalProcess = (global as any).process
      delete (global as any).process
      try {
        expect(_isProduction()).toBe(false)
      } finally {
        // 恢复原始 process（如果还存在）
        if (originalProcess !== undefined) {
          (global as any).process = originalProcess
        }
      }
    })

    it('应该使用缓存返回之前的结果（缓存命中分支）', () => {
      process.env.NODE_ENV = 'production'
      // 第一次调用设置缓存
      expect(_isProduction()).toBe(true)
      // 修改环境变量，第二次调用应该返回缓存的 true
      process.env.NODE_ENV = 'development'
      expect(_isProduction()).toBe(true) // 缓存命中，仍返回 true
    })

    it('应该在 process.env.NODE_ENV 为 undefined 时回退到 __DEV__ 分支', () => {
      // 设置 __DEV__ = false 意味着生产环境
      (global as any).__DEV__ = false
      try {
        // 删除 NODE_ENV 以触发 __DEV__ 分支
        const originalNodeEnv = process.env.NODE_ENV
        delete process.env.NODE_ENV
        try {
          // __DEV__ = false => isProduction = !false = true
          expect(_isProduction()).toBe(true)
        } finally {
          process.env.NODE_ENV = originalNodeEnv
        }
      } finally {
        delete (global as any).__DEV__
      }
    })

    it('应该在 __DEV__ = true 时返回 false', () => {
      (global as any).__DEV__ = true
      try {
        const originalNodeEnv = process.env.NODE_ENV
        delete process.env.NODE_ENV
        try {
          expect(_isProduction()).toBe(false)
        } finally {
          process.env.NODE_ENV = originalNodeEnv
        }
      } finally {
        delete (global as any).__DEV__
      }
    })

    it('应该在 process.env 访问抛出异常时静默处理并回退', () => {
      // 模拟 process 存在但 env 访问抛出异常
      const originalProcess = (global as any).process
      const fakeProcess = {
        get env() {
          throw new Error('access denied')
        },
      }
      ;(global as any).process = fakeProcess
      try {
        // 不应该抛出，应返回 false（兜底）
        expect(_isProduction()).toBe(false)
      } finally {
        (global as any).process = originalProcess
      }
    })
  })

  describe('createMutationErrorMessage', () => {
    it('应该创建正确的错误消息', () => {
      const message = createMutationErrorMessage('count', 42, 'set')

      expect(message).toContain('Direct mutation of state')
      expect(message).toContain('count')
      expect(message).toContain('set')
      expect(message).toContain('42')
    })

    it('应该处理复杂值', () => {
      const message = createMutationErrorMessage('nested', { a: 1, b: 2 }, 'defineProperty')

      expect(message).toContain('nested')
      expect(message).toContain('defineProperty')
      expect(message).toContain('{"a":1,"b":2}')
    })

    it('应该处理 undefined 值', () => {
      const message = createMutationErrorMessage('prop', undefined, 'delete')

      expect(message).toContain('prop')
      expect(message).toContain('delete')
    })
  })

  describe('deepCloneState', () => {
    it('应该深拷贝对象', () => {
      const original = { count: 1, nested: { value: 2 } }
      const cloned = deepCloneState(original)

      expect(cloned).toEqual(original)
      expect(cloned).not.toBe(original)
      expect(cloned.nested).not.toBe(original.nested)
    })

    it('应该处理数组', () => {
      const original = { items: [1, 2, 3] }
      const cloned = deepCloneState(original)

      expect(cloned.items).toEqual([1, 2, 3])
      expect(cloned.items).not.toBe(original.items)
    })

    it('应该处理 null', () => {
      const cloned = deepCloneState(null)
      expect(cloned).toBe(null)
    })

    it('应该处理基本类型', () => {
      expect(deepCloneState('string')).toBe('string')
      expect(deepCloneState(123)).toBe(123)
      expect(deepCloneState(true)).toBe(true)
    })

    it('当 structuredClone 不可用时应回退到 JSON 深拷贝', () => {
      // 保存原始 structuredClone
      const originalStructuredClone = (global as any).structuredClone
      // 删除 structuredClone 使其不可用
      delete (global as any).structuredClone
      try {
        const original = { count: 1, nested: { value: 2 } }
        const cloned = deepCloneState(original)

        expect(cloned).toEqual(original)
        expect(cloned).not.toBe(original)
        expect(cloned.nested).not.toBe(original.nested)
      } finally {
        // 恢复原始 structuredClone
        if (originalStructuredClone !== undefined) {
          (global as any).structuredClone = originalStructuredClone
        }
      }
    })

    it('含函数字段时不应该抛错（structuredClone 的 DataCloneError 降级）', () => {
      const original: any = { fn: () => 42, data: { x: 1 } }

      expect(() => deepCloneState(original)).not.toThrow()

      const cloned = deepCloneState(original)
      expect(cloned.fn).toBe(original.fn)
      expect(cloned.data).toEqual({ x: 1 })
      expect(cloned.data).not.toBe(original.data)
    })

    it('应该保留 undefined 字段（行为不依赖 structuredClone）', () => {
      const original: any = { maybe: undefined, count: 1 }

      const cloned = deepCloneState(original)

      expect('maybe' in cloned).toBe(true)
      expect(cloned.maybe).toBeUndefined()
    })

    it('应该克隆 RegExp/Map/Set', () => {
      const original: any = {
        regex: /abc/gi,
        map: new Map([['a', 1]]),
        set: new Set([1, 2]),
      }

      const cloned = deepCloneState(original)

      expect(cloned.regex).toEqual(/abc/gi)
      expect(cloned.regex).not.toBe(original.regex)
      expect(cloned.map).not.toBe(original.map)
      expect(cloned.map.get('a')).toBe(1)
      expect(cloned.set).not.toBe(original.set)
      expect(cloned.set.has(1)).toBe(true)
    })

    it('不可克隆对象（class 实例）应保留原引用不抛错', () => {
      class Config {
        mode = 'dark'
      }
      const instance = new Config()
      const original: any = { config: instance }

      expect(() => deepCloneState(original)).not.toThrow()
      expect(deepCloneState(original).config).toBe(instance)
    })
  })
})
