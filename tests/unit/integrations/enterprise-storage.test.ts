/**
 * 企业集成 - storage 的失败兜底
 */

import { storage } from '@/integrations/enterprise/env.js'

describe('storage.remove 的失败兜底', () => {
  const originalWx = (globalThis as any).wx

  afterEach(() => {
    (globalThis as any).wx = originalWx
  })

  it('底层 removeStorageSync 抛错时只记日志不外抛', () => {
    (globalThis as any).wx = {
      removeStorageSync: () => {
        throw new Error('remove boom')
      },
    }
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    try {
      expect(() => storage.remove('any-key')).not.toThrow()
      expect(errorSpy).toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }
  })
})
