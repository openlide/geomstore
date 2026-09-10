/**
 * Action 异步公共内核单元测试
 *
 * 覆盖 retryWithBackoff 的缺省参数、shouldRetry 提前拒绝、onRetry 回调、
 * 无重试次数（含负数）等分支，以及 raceWithTimeout 的成功与超时两条路径。
 */
import { raceWithTimeout, retryWithBackoff } from '@/extras/action/async-core.js'

describe('extras/action/async-core', () => {
  describe('retryWithBackoff', () => {
    it('首次成功即返回（不传 options，走全部缺省值）', async () => {
      const fn = jest.fn().mockResolvedValue('ok')
      await expect(retryWithBackoff(fn)).resolves.toBe('ok')
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('失败后按次数重试，最终成功', async () => {
      const fn = jest.fn().mockRejectedValueOnce(new Error('1')).mockRejectedValueOnce(new Error('2')).mockResolvedValue('ok')

      await expect(retryWithBackoff(fn, { retries: 3, delay: 0 })).resolves.toBe('ok')
      expect(fn).toHaveBeenCalledTimes(3)
    })

    it('重试耗尽后抛出最后一次错误', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('always fails'))

      await expect(retryWithBackoff(fn, { retries: 2, delay: 0 })).rejects.toThrow('always fails')
      expect(fn).toHaveBeenCalledTimes(3)
    })

    it('shouldRetry 返回 false 时立即抛出，不再重试', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('fatal'))
      const shouldRetry = jest.fn().mockReturnValue(false)

      await expect(retryWithBackoff(fn, { retries: 5, delay: 0, shouldRetry })).rejects.toThrow('fatal')
      expect(fn).toHaveBeenCalledTimes(1)
      expect(shouldRetry).toHaveBeenCalledWith(expect.any(Error))
    })

    it('onRetry 在每次实际重试前回调（attempt 从 1 开始）', async () => {
      const fn = jest.fn().mockRejectedValueOnce(new Error('1')).mockResolvedValue('ok')
      const onRetry = jest.fn()

      await expect(retryWithBackoff(fn, { retries: 3, delay: 0, onRetry })).resolves.toBe('ok')
      expect(onRetry).toHaveBeenCalledTimes(1)
      expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1)
    })

    it('retries 为 0 时只尝试一次', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('boom'))

      await expect(retryWithBackoff(fn, { retries: 0, delay: 0 })).rejects.toThrow('boom')
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('retries 为负数时循环体不执行，抛出兜底错误', async () => {
      const fn = jest.fn().mockResolvedValue('never called')

      await expect(retryWithBackoff(fn, { retries: -1 })).rejects.toThrow('Retry failed without error')
      expect(fn).not.toHaveBeenCalled()
    })
  })

  describe('raceWithTimeout', () => {
    it('Promise 先完成时返回其结果', async () => {
      await expect(raceWithTimeout(Promise.resolve('fast'), 1000, 'timeout')).resolves.toBe('fast')
    })

    it('超时先落地时以 timeoutMessage 拒绝', async () => {
      await expect(raceWithTimeout(new Promise<string>(() => {}), 5, 'too slow')).rejects.toThrow('too slow')
    })
  })
})
