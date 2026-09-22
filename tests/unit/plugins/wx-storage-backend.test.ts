/**
 * 内置微信存储后端 `WxStorageBackend`（`src/plugins/WxStorageBackend.ts`）
 *
 * 该类的用例原先散在 `tests/unit/types-interface-state.test.ts`（#390 错误语义）与
 * `tests/unit/plugins/builtin-persistence.test.ts`（getItem 缺失键口径）：前者是因为
 * 实现当时住在 `src/types/`（types 层没有独立测试目录），实现迁到 `src/plugins/` 后
 * 与 `persistencePlugin` 的测试同目录，故归并到本文件。
 *
 * 覆盖三块契约：
 * 1. #389 —— `getItem` 对「键无数据」的归一化（微信 `getStorageSync` 缺失键返回 `''`、
 *    写入非字符串载荷时原样返回该值）
 * 2. #390 —— 三个方法的错误语义一致：记录后一律重抛，读取失败不得退化成「键无数据」
 * 3. `wx` 整体缺失 / 单个方法缺席时的 `?.` 兜底（真机、开发者工具、Node 测试环境差异）
 */

import { WxStorageBackend } from '@/plugins/WxStorageBackend.js'

type WxHolder = { wx?: Record<string, unknown> }
const writableGlobal = globalThis as unknown as WxHolder

/** 装上最小 wx 替身；用例只声明自己关心的方法，其余保持缺席以命中 `?.` 兜底分支 */
const withWx = (api: Record<string, unknown>): void => {
  writableGlobal.wx = api
}

const throwing = (message: string) => () => {
  throw new Error(message)
}

beforeEach(() => {
  // tests/setup.ts 会装一个可用的 wx mock；本文件的每条用例自行决定 wx 的形状，
  // 故先摘掉，避免「用例以为在测缺失分支、实际打到 mock 上」
  delete writableGlobal.wx
})

afterEach(() => {
  delete writableGlobal.wx
})

// ==================== getItem 的「键无数据」归一化（#389） ====================

describe('WxStorageBackend.getItem 的缺失键口径', () => {
  it('微信对不存在的键返回空字符串时按 null 处理，且键名原样透传', () => {
    let seen: string | undefined
    withWx({
      getStorageSync: (key: string) => {
        seen = key
        return ''
      },
    })

    expect(new WxStorageBackend().getItem('k')).toBeNull()
    expect(seen).toBe('k')
  })

  it('返回 undefined（mock / 非微信实现）同样按 null 处理', () => {
    withWx({ getStorageSync: () => undefined })

    expect(new WxStorageBackend().getItem('k')).toBeNull()
  })

  it('非字符串载荷不泄漏进 string | null 返回契约', () => {
    withWx({ getStorageSync: () => ({ not: 'a string' }) })

    expect(new WxStorageBackend().getItem('k')).toBeNull()
  })

  it('正常字符串值原样返回', () => {
    withWx({ getStorageSync: () => '{"a":1}' })

    expect(new WxStorageBackend().getItem('k')).toBe('{"a":1}')
  })
})

// ==================== #390：三个方法的错误语义一致（记录后一律重抛） ====================

describe('WxStorageBackend 读写删失败一律重抛（#390）', () => {
  it('getItem 失败：记录日志并重抛，不退化成「键无数据」', () => {
    withWx({ getStorageSync: throwing('storage broken') })
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => new WxStorageBackend().getItem('k')).toThrow('storage broken')
    expect(errorSpy).toHaveBeenCalledWith('[WxStorage] getItem error:', expect.any(Error))

    errorSpy.mockRestore()
  })

  it('setItem 维持既有口径（日志 + 重抛）', () => {
    withWx({ setStorageSync: throwing('quota exceeded') })
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => new WxStorageBackend().setItem('k', 'v')).toThrow('quota exceeded')
    expect(errorSpy).toHaveBeenCalledWith('[WxStorage] setItem error:', expect.any(Error))

    errorSpy.mockRestore()
  })

  it('removeItem 失败：记录日志并重抛，clearOnUninstall 不会谎报已清除', () => {
    withWx({ removeStorageSync: throwing('remove denied') })
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => new WxStorageBackend().removeItem('k')).toThrow('remove denied')
    expect(errorSpy).toHaveBeenCalledWith('[WxStorage] removeItem error:', expect.any(Error))

    errorSpy.mockRestore()
  })

  it('成功路径：三个方法各调用对应的 wx 同步 API，不额外加工载荷', () => {
    const calls: Array<[string, unknown, unknown?]> = []
    withWx({
      getStorageSync: (key: string) => {
        calls.push(['get', key])
        return '{}'
      },
      setStorageSync: (key: string, value: string) => {
        calls.push(['set', key, value])
      },
      removeStorageSync: (key: string) => {
        calls.push(['remove', key])
      },
    })
    const backend = new WxStorageBackend()

    expect(backend.getItem('k')).toBe('{}')
    backend.setItem('k', 'v')
    backend.removeItem('k')

    expect(calls).toEqual([
      ['get', 'k'],
      ['set', 'k', 'v'],
      ['remove', 'k'],
    ])
  })
})

// ==================== 环境降级：wx 整体缺失 / 单个方法缺席 ====================

describe('WxStorageBackend 在 wx 不可用时的兜底（?. 短路）', () => {
  it('globalThis.wx 整体缺失：读取按「无数据」、写删为 no-op，且都不抛错', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const backend = new WxStorageBackend()

    expect(backend.getItem('k')).toBeNull()
    expect(() => backend.setItem('k', 'v')).not.toThrow()
    expect(() => backend.removeItem('k')).not.toThrow()
    expect(errorSpy).not.toHaveBeenCalled()

    errorSpy.mockRestore()
  })

  it('wx 存在但三个同步方法都不存在：同样短路，不抛 TypeError', () => {
    withWx({})
    const backend = new WxStorageBackend()

    expect(backend.getItem('k')).toBeNull()
    expect(() => backend.setItem('k', 'v')).not.toThrow()
    expect(() => backend.removeItem('k')).not.toThrow()
  })

  it('只缺读方法时写删照常工作，反之亦然（逐方法独立兜底）', () => {
    const written: Array<[string, string]> = []
    withWx({
      setStorageSync: (key: string, value: string) => void written.push([key, value]),
      removeStorageSync: () => undefined,
    })

    expect(new WxStorageBackend().getItem('k')).toBeNull()
    new WxStorageBackend().setItem('k', 'v')
    expect(new WxStorageBackend().getItem('k')).toBeNull()
    expect(written).toEqual([['k', 'v']])
  })
})
