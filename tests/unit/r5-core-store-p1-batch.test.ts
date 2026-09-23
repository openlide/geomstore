/**
 * 第五轮 core-store-p1 分片：BatchManager.reset() 的运行时诊断
 *
 * R5-101：`reset()` 是公开方法，「仅限 teardown」原先只靠注释约束；批进行中调用它会
 * 静默丢掉 `_onEnd`（批内被抑制的变更永不补发通知），误用后只能从「页面不更新」倒查。
 * 补一条与 `end()` 未配对告警同口径的开发期诊断。
 */
import { BatchManager } from '@/core/store/BatchManager.js'

describe('R5-101 批进行中调用 reset() 留下诊断', () => {
  let warn: jest.SpyInstance

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
  })

  it('深度 > 0 时告警说明通知被丢弃，且不补发 onEnd', () => {
    const onEnd = jest.fn()
    const manager = new BatchManager(onEnd)
    manager.start()
    manager.start()

    manager.reset()

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('reset() called during an active batch'))
    expect(onEnd).not.toHaveBeenCalled()
    expect(manager.isInBatch).toBe(false)
  })

  it('配平地 start/end 之后调用 reset() 仍然静默（teardown 正常路径）', () => {
    const onEnd = jest.fn()
    const manager = new BatchManager(onEnd)
    manager.start()
    manager.end()

    manager.reset()
    new BatchManager(onEnd).reset()

    expect(warn).not.toHaveBeenCalled()
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('reset() 之后配对的 end() 仍按未匹配告警，两条诊断不互相吞掉', () => {
    const manager = new BatchManager(() => {})
    manager.start()
    manager.reset()
    manager.end()

    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenNthCalledWith(1, expect.stringContaining('reset() called during an active batch'))
    expect(warn).toHaveBeenNthCalledWith(2, expect.stringContaining('end() called without matching start()'))
  })

  it('生产模式下静默（与 end() 的 !isProduction() 口径一致）', async () => {
    const originalEnv = process.env.NODE_ENV
    try {
      // isProduction 在模块实例内缓存，需重载模块取生产判定的新实例
      jest.resetModules()
      process.env.NODE_ENV = 'production'
      const mod: typeof import('@/core/store/BatchManager.js') = await import('@/core/store/BatchManager.js')
      const manager = new mod.BatchManager(() => {})
      manager.start()
      manager.reset()
      manager.end()
      expect(warn).not.toHaveBeenCalled()
    } finally {
      process.env.NODE_ENV = originalEnv
      jest.resetModules()
    }
  })
})
