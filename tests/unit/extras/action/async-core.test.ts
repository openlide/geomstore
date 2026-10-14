/**
 * Action 异步公共内核单元测试
 *
 * 覆盖 retryWithBackoff 的缺省参数、shouldRetry 提前拒绝、onRetry 回调、
 * 非有限/负数重试次数归零（首次尝试必执行）等分支，以及 raceWithTimeout 的成功与超时两条路径。
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

    it('retries 为负数时按 0 处理：首次尝试仍会执行', async () => {
      const fn = jest.fn().mockResolvedValue('ok')

      await expect(retryWithBackoff(fn, { retries: -1 })).resolves.toBe('ok')
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('retries 为 NaN 时按 0 处理：首次尝试仍会执行并抛出真实错误', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('real failure'))

      await expect(retryWithBackoff(fn, { retries: Number.NaN })).rejects.toThrow('real failure')
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('retries 为非有限值时回退 0（首次尝试必执行，不会挂起）', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('finite fallback'))

      await expect(retryWithBackoff(fn, { retries: Number.POSITIVE_INFINITY })).rejects.toThrow('finite fallback')
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('抛出的对象里的敏感字段被脱敏后再进回调（token/password 只留占位）', async () => {
      // toError 对非 Error 抛出值走 describeThrownObject：凭证类键名一律替换为占位符，
      // 顶层原始值字段保留。规范化后的 Error 交给 shouldRetry/onRetry（向外抛的仍是
      // 原始值），故经回调观察——这条 SENSITIVE_KEYS 分支没有用例触达过
      const raw = { token: 'secret-token-value', password: 'p@ssw0rd', code: 500, nested: { deep: 1 } }
      const seen: Error[] = []

      await expect(
        retryWithBackoff(() => Promise.reject(raw), {
          retries: 1,
          delay: 0,
          shouldRetry: (err) => {
            seen.push(err)
            return false
          },
        }),
      ).rejects.toBe(raw) // 对外抛出的仍是原始值（身份判断不被改写）

      expect(seen).toHaveLength(1)
      // 消息是投影结果的 JSON 串：敏感值不见、普通字段与占位符都在
      expect(seen[0].message).toMatch(/"token":"\[details omitted\]"/)
      expect(seen[0].message).toMatch(/"password":"\[details omitted\]"/)
      expect(seen[0].message).toContain('"code":500')
      expect(seen[0].message).not.toContain('secret-token-value')
      expect(seen[0].message).not.toContain('p@ssw0rd')
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
