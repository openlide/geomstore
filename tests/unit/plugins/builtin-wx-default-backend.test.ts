/**
 * persistencePlugin 的默认存储后端 = `WxStorageBackend`（#390 / #391 判定口径单点化）
 *
 * 未传 `storage` 时，插件此前走一段内联 wx 适配器：缺失键的 `''` 归一化、「返回值是不是
 * Promise」的判定都与同目录那个类各写一份，口径随时会漂移（类里归一为 `null`、内联只判
 * `undefined`/`null`）。现在默认路径直接实例化该类，本文件钉住由此确定的行为：
 * 1. 真机对缺失键返回 `''` → 一律按「无数据」处理，绝不进 `JSON.parse`
 * 2. 非字符串载荷（wx 允许原样存对象）→ 同样按「无数据」，不再泄漏进 `string | null` 契约
 * 3. 只有 `getStorageSync` 的残缺 wx 环境不再被当作可用后端（否则落盘是静默 no-op）
 * 4. 默认路径与显式 `storage: new WxStorageBackend()` 在同一场景下给出同样的结论
 */

import { createStore } from '@/core/store/index.js'
import { persistencePlugin } from '@/plugins/builtin.js'
import { WxStorageBackend } from '@/plugins/WxStorageBackend.js'

type WxHolder = { wx?: Record<string, unknown> }
const writableGlobal = globalThis as unknown as WxHolder

/** 齐备的 wx 替身：内存 Map 承载，缺失键按真机语义返回 `''`（而不是 undefined） */
function makeWx(seed: Record<string, unknown> = {}) {
  const map = new Map<string, unknown>(Object.entries(seed))

  return {
    map,
    api: {
      getStorageSync: jest.fn((key: string) => (map.has(key) ? map.get(key) : '')),
      setStorageSync: jest.fn((key: string, value: unknown) => {
        map.set(key, value)
      }),
      removeStorageSync: jest.fn((key: string) => {
        map.delete(key)
      }),
    },
  }
}

/** Promise 版同步存储 API（Taro / uni-app 一类兼容层的形状） */
function makeAsyncWx() {
  return {
    getStorageSync: jest.fn(() => Promise.resolve('{}')),
    setStorageSync: jest.fn(() => Promise.resolve(undefined)),
    removeStorageSync: jest.fn(() => Promise.resolve(undefined)),
  }
}

const originalWx = writableGlobal.wx

afterEach(() => {
  writableGlobal.wx = originalWx
})

describe('公开面：新增的共享实现不经入口外泄', () => {
  it('WxStorageBackend 仍是唯一给用户的东西，判定/归一化工具只供内部复用', async () => {
    const pluginsEntry = (await import('@/extras/plugins.js')) as Record<string, unknown>
    const extrasEntry = (await import('@/extras/index.js')) as Record<string, unknown>

    expect(pluginsEntry.WxStorageBackend).toBe(WxStorageBackend)
    expect(extrasEntry.WxStorageBackend).toBe(WxStorageBackend)

    for (const entry of [pluginsEntry, extrasEntry]) {
      expect(entry.isWxStorageSyncAvailable).toBeUndefined()
      expect(entry.assertSyncStorageResult).toBeUndefined()
      expect(entry.normalizeWxStoredValue).toBeUndefined()
      expect(entry.readWxStorageSyncApi).toBeUndefined()
      expect(entry.ACTION_LOADER_DEFAULTS).toBeUndefined()
      expect(entry.DEFAULT_MAX_LOG_SIZE).toBeUndefined()
    }
  })
})

describe('persistencePlugin 默认后端与 WxStorageBackend 同源', () => {
  it('缺失键返回空串：按无数据恢复，且 JSON.parse 收不到空串', () => {
    const wx = makeWx()
    writableGlobal.wx = wx.api
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const parseSpy = jest.spyOn(JSON, 'parse')

    try {
      const store = createStore({ name: 'default-wx-empty-string', state: { count: 0 } })
      store.use(persistencePlugin())

      expect(wx.api.getStorageSync).toHaveBeenCalledWith('geomstore_default-wx-empty-string')
      expect(store.getState().count).toBe(0)
      expect(parseSpy.mock.calls.every(([raw]) => raw !== '')).toBe(true)
      expect(errorSpy).not.toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
      parseSpy.mockRestore()
    }
  })

  it('写入的 JSON 串能被同一条路径读回并恢复', () => {
    const wx = makeWx()
    writableGlobal.wx = wx.api
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})

    try {
      const first = createStore({ name: 'default-wx-roundtrip', state: { count: 0 } })
      first.use(persistencePlugin())
      first.setState('count', 7)
      first.destroy()

      const second = createStore({ name: 'default-wx-roundtrip', state: { count: 0 } })
      second.use(persistencePlugin())

      expect(typeof wx.map.get('geomstore_default-wx-roundtrip')).toBe('string')
      expect(second.getState().count).toBe(7)
    } finally {
      logSpy.mockRestore()
    }
  })

  it('非字符串载荷按无数据处理：既不报错也不泄漏进 string | null 契约', () => {
    // wx 允许把对象原样存进 storage，别处写入的同名键会以对象形态被读回
    const wx = makeWx({ 'geomstore_default-wx-object-payload': { count: 99 } })
    writableGlobal.wx = wx.api
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const store = createStore({ name: 'default-wx-object-payload', state: { count: 0 } })
      store.use(persistencePlugin())

      expect(store.getState().count).toBe(0)
      expect(errorSpy).not.toHaveBeenCalledWith('[GeomStore] Failed to restore state:', expect.anything())
      expect(errorSpy).not.toHaveBeenCalledWith('[GeomStore] Restored state is not a plain object, skipping restore')
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('残缺 wx（只有 getStorageSync）不再被判定为可用后端：降级内存并告警', () => {
    const getStorageSync = jest.fn(() => '')
    writableGlobal.wx = { getStorageSync }
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const store = createStore({ name: 'default-wx-partial', state: { count: 0 } })
      store.use(persistencePlugin())
      store.setState('count', 3)

      // 判据是「三方法齐备」，与用户传入后端的形状校验同口径：
      // 有读无写的环境若仍被选中，落盘会被 `?.` 短路成静默 no-op（假成功）
      expect(getStorageSync).not.toHaveBeenCalled()
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('降级为内存存储'))
      expect(store.getState().count).toBe(3)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('Promise 版同步 API：默认路径与显式传后端都按「异步后端」明确报错', () => {
    const asyncWx = makeAsyncWx()
    writableGlobal.wx = asyncWx
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const byDefault = createStore({ name: 'default-wx-async-1', state: { count: 0 } })
      byDefault.use(persistencePlugin())

      // 守卫必须先于归一化：Promise 不是字符串，先归一化就会被洗成「键无数据」，
      // 下一次落盘就覆盖真实数据
      expect(errorSpy).toHaveBeenCalledWith(
        '[GeomStore] Failed to restore state:',
        expect.objectContaining({ message: expect.stringContaining('wx.getStorageSync() 返回了 Promise') }),
      )

      errorSpy.mockClear()
      const explicit = createStore({ name: 'default-wx-async-2', state: { count: 0 } })
      explicit.use(persistencePlugin({ storage: new WxStorageBackend() }))

      expect(errorSpy).toHaveBeenCalledWith(
        '[GeomStore] Failed to restore state:',
        expect.objectContaining({ message: expect.stringContaining('wx.getStorageSync() 返回了 Promise') }),
      )
    } finally {
      errorSpy.mockRestore()
    }
  })
})
