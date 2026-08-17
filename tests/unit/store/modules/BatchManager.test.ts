/**
 * BatchManager 模块测试
 * 目标覆盖率: 95%+
 */

import { BatchManager, createBatchFunction } from '@/core/store/BatchManager'

describe('BatchManager', () => {
  describe('基本功能', () => {
    it('应该正确初始化', () => {
      const onEnd = jest.fn()
      const manager = new BatchManager(onEnd)

      expect(manager.isInBatch).toBe(false)
      expect(manager.depth).toBe(0)
    })

    it('应该正确追踪批量更新深度', () => {
      const onEnd = jest.fn()
      const manager = new BatchManager(onEnd)

      manager.start()
      expect(manager.depth).toBe(1)
      expect(manager.isInBatch).toBe(true)

      manager.start()
      expect(manager.depth).toBe(2)

      manager.end()
      expect(manager.depth).toBe(1)
      expect(manager.isInBatch).toBe(true)

      manager.end()
      expect(manager.depth).toBe(0)
      expect(manager.isInBatch).toBe(false)
    })

    it('应该在深度归零时调用 onEnd', () => {
      const onEnd = jest.fn()
      const manager = new BatchManager(onEnd)

      manager.start()
      expect(onEnd).not.toHaveBeenCalled()

      manager.end()
      expect(onEnd).toHaveBeenCalledTimes(1)
    })

    it('应该在嵌套批量更新结束时只调用一次 onEnd', () => {
      const onEnd = jest.fn()
      const manager = new BatchManager(onEnd)

      manager.start()
      manager.start()
      manager.start()

      manager.end()
      expect(onEnd).not.toHaveBeenCalled()

      manager.end()
      expect(onEnd).not.toHaveBeenCalled()

      manager.end()
      expect(onEnd).toHaveBeenCalledTimes(1)
    })

    it('end 不应该在深度为 0 时调用 onEnd', () => {
      const onEnd = jest.fn()
      const manager = new BatchManager(onEnd)

      manager.end()
      expect(onEnd).not.toHaveBeenCalled()
    })
  })

  describe('reset', () => {
    it('应该重置批量更新状态', () => {
      const onEnd = jest.fn()
      const manager = new BatchManager(onEnd)

      manager.start()
      manager.start()
      expect(manager.depth).toBe(2)

      manager.reset()
      expect(manager.depth).toBe(0)
      expect(manager.isInBatch).toBe(false)
    })
  })
})

describe('createBatchFunction', () => {
  it('应该自动管理批量更新', () => {
    const onEnd = jest.fn()
    const manager = new BatchManager(onEnd)
    const batch = createBatchFunction(manager)

    const result = batch(() => {
      expect(manager.isInBatch).toBe(true)
      return 'test-result'
    })

    expect(result).toBe('test-result')
    expect(manager.isInBatch).toBe(false)
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('应该在出错时正确结束批量更新', () => {
    const onEnd = jest.fn()
    const manager = new BatchManager(onEnd)
    const batch = createBatchFunction(manager)

    expect(() => {
      batch(() => {
        throw new Error('test error')
      })
    }).toThrow('test error')

    expect(manager.isInBatch).toBe(false)
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('应该正确处理嵌套批量更新', () => {
    const onEnd = jest.fn()
    const manager = new BatchManager(onEnd)
    const batch = createBatchFunction(manager)

    batch(() => {
      expect(manager.depth).toBe(1)

      batch(() => {
        expect(manager.depth).toBe(2)
      })

      expect(manager.depth).toBe(1)
    })

    expect(manager.depth).toBe(0)
    // 嵌套批量更新：只有最外层结束时才调用 onEnd
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('应该正确处理手动嵌套批量更新', () => {
    const onEnd = jest.fn()
    const manager = new BatchManager(onEnd)

    manager.start()
    manager.start()
    manager.start()

    manager.end()
    expect(onEnd).not.toHaveBeenCalled()

    manager.end()
    expect(onEnd).not.toHaveBeenCalled()

    manager.end()
    expect(onEnd).toHaveBeenCalledTimes(1)
  })
})

describe('BatchManager 生产环境静默行为', () => {
  const originalEnv = process.env.NODE_ENV

  afterEach(() => {
    process.env.NODE_ENV = originalEnv
  })

  it('NODE_ENV=production 时 end() 无匹配 start() 应静默返回', () => {
    // 重置模块并模拟生产环境，使 isProduction 缓存为 true
    jest.resetModules()
    process.env.NODE_ENV = 'production'
    const { BatchManager: ProductionBatchManager } = require('@/core/store/BatchManager')
    const manager = new ProductionBatchManager(jest.fn())

    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()
    manager.end()
    expect(consoleSpy).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})
