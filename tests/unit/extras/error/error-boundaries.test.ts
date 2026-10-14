/**
 * 错误处理域的边界分支
 *
 * 覆盖：ErrorBoundary 的历史裁剪与函数型 fallback。
 */

import { ErrorBoundary } from '@/extras/error/index.js'

const MAX_ERROR_HISTORY = 100

describe('错误处理域边界分支', () => {
  describe('ErrorBoundary', () => {
    let warnSpy: jest.SpyInstance

    beforeEach(() => {
      warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
      warnSpy.mockRestore()
    })

    it('错误历史超过上限时裁剪最旧记录', () => {
      const boundary = new ErrorBoundary({ fallback: { count: 0 }, recoverable: true })

      for (let i = 0; i < MAX_ERROR_HISTORY + 1; i++) {
        expect(
          boundary.execute(() => {
            throw new Error(`e${i}`)
          }),
        ).toEqual({ count: 0 })
      }

      expect(boundary.getErrorHistory()).toHaveLength(MAX_ERROR_HISTORY)
    })

    it('函数型 fallback 下 getFallbackState 返回 undefined（需结合错误上下文求值）', () => {
      const boundary = new ErrorBoundary({ fallback: () => ({ count: 9 }), recoverable: true })

      expect(boundary.getFallbackState()).toBeUndefined()
      expect(
        boundary.execute(() => {
          throw new Error('boom')
        }),
      ).toEqual({ count: 9 })
    })

    it('onError 为 async 且 rejection 时被就地吸收，不外溢成 unhandled rejection（#149）', async () => {
      // 同步 try/catch 只能兜住同步抛出：async 回调的 rejection 会逃逸成
      // unhandled rejection（Node 严格模式下可终止进程）。实现检测 thenable 后
      // 用 Promise.resolve 包装并挂 .catch——本用例锁的就是那条吸收分支
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
      const unhandled: unknown[] = []
      const onUnhandled = (reason: unknown): void => {
        unhandled.push(reason)
      }
      process.on('unhandledRejection', onUnhandled)

      try {
        const boundary = new ErrorBoundary({
          onError: async () => {
            throw new Error('reporter down')
          },
          fallback: { ok: false },
          recoverable: true,
        })

        expect(
          boundary.execute(() => {
            throw new Error('boom')
          }),
        ).toEqual({ ok: false })

        // 吸收回调挂在微任务上：冲刷到宏任务一轮，让 .catch 与 unhandledRejection
        // 判定都跑完再断言
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(errorSpy).toHaveBeenCalledWith('[ErrorBoundary] Error in async onError callback:', expect.any(Error))
        expect(unhandled).toEqual([])
      } finally {
        process.off('unhandledRejection', onUnhandled)
        errorSpy.mockRestore()
      }
    })
  })
})
