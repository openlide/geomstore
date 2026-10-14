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
  })
})
