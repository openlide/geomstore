/**
 * OCR low 第4轮 G3（src/integrations + src/plugins）回归
 *
 * 逐条锁定判定为 fix 的行为，用例名带 finding 编号。
 */

import { createStore } from '@/index.js'
import { bindMappings } from '@/integrations/utils.js'
import { registerGlobalEntry } from '@/plugins/globalRegistry.js'
import { timeTravelPlugin } from '@/plugins/devtools/timeTravelPlugin.js'

// ==================== integrations/utils ====================

describe('#344 初始映射值全空时不触发 setter', () => {
  it('全部映射值为 undefined：一次 setter 都不调', () => {
    const setter = jest.fn()
    const store = createStore({ name: 'bind-344', state: { a: undefined as unknown, b: undefined as unknown } })

    const unbinds = bindMappings(
      {},
      { localA: 'a', localB: 'b' },
      (key) => store.state[key as 'a' | 'b'],
      setter,
      (callback) => {
        callback()
        return () => {}
      },
    )

    expect(setter).not.toHaveBeenCalled()
    unbinds.forEach((fn) => fn())
  })

  it('存在有值键时仍按一次批量调用下发', () => {
    const setter = jest.fn()
    const store = createStore({ name: 'bind-344b', state: { a: 1 as unknown, b: undefined as unknown } })

    const unbinds = bindMappings(
      {},
      { localA: 'a', localB: 'b' },
      (key) => store.state[key as 'a' | 'b'],
      setter,
      (callback) => {
        callback()
        return () => {}
      },
    )

    expect(setter).toHaveBeenCalledTimes(1)
    expect(setter).toHaveBeenCalledWith({ localA: 1 })
    unbinds.forEach((fn) => fn())
  })
})

// ==================== plugins/globalRegistry ====================

describe('#365 全局表最后一个条目卸载后回收容器', () => {
  it('仍有其它条目时保留容器，清空后摘掉键', () => {
    const g = globalThis as unknown as Record<string, Record<string, unknown> | undefined>
    delete g.__OCR_LOW_365__

    const unA = registerGlobalEntry('__OCR_LOW_365__', 'store-a', { id: 'a' })
    const unB = registerGlobalEntry('__OCR_LOW_365__', 'store-b', { id: 'b' })
    const table = g.__OCR_LOW_365__ as unknown as Record<string, unknown>

    unA()
    expect(g.__OCR_LOW_365__).toBe(table)
    expect(Object.keys(table)).toEqual(['store-b'])

    unB()
    // 修复前后条目都不可见；差别是此处不再留下空表占住全局键位
    expect(g.__OCR_LOW_365__).toBeUndefined()
  })
})

describe('#366 registerGlobalEntry 内置生产守卫', () => {
  it('生产模式下不向 globalThis 写入任何条目（fail-safe）', async () => {
    const prevEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      await jest.isolateModulesAsync(async () => {
        const mod = await import('@/plugins/globalRegistry.js')
        const unregister = mod.registerGlobalEntry('__OCR_LOW_366__', 'store-x', { id: 'x' })
        expect((globalThis as Record<string, unknown>).__OCR_LOW_366__).toBeUndefined()
        expect(typeof unregister).toBe('function')
        expect(() => unregister()).not.toThrow()
      })
    } finally {
      process.env.NODE_ENV = prevEnv
    }
  })
})

// ==================== plugins/devtools/timeTravel ====================

interface TimeTravelApi {
  getSnapshots: () => Array<Record<string, unknown>>
  getSnapshotCount: () => number
  getCurrentIndex: () => number
  goTo: (index: number) => void
  undo: () => void
  redo: () => void
  record: () => void
  exportHistory: () => string
  importHistory: (json: string) => void
}

const installTimeTravel = (name: string): { api: TimeTravelApi } => {
  const store = createStore({ name, state: { v: 0 } })
  store.use(timeTravelPlugin({ maxSize: 50 }))
  const api = (store as unknown as { __timeTravel__: TimeTravelApi }).__timeTravel__
  return { api }
}

describe('#378 回放抛错时不推进 currentIndex', () => {
  it('$replaceState 抛错后索引仍指向真实状态所在快照', () => {
    const store = createStore({ name: 'tt-378', state: { v: 0 } })
    store.use(timeTravelPlugin({ maxSize: 50, autoRecord: false }))
    const api = (store as unknown as { __timeTravel__: TimeTravelApi }).__timeTravel__

    api.record()
    expect(api.getCurrentIndex()).toBe(1)

    // 用抛错的 $replaceState 模拟「store 已销毁 / 快照状态非法」：
    // destroy() 会先跑插件卸载（清空快照与索引），不能直接用来制造抛出
    const replaceSpy = jest.spyOn(store, '$replaceState').mockImplementation(() => {
      throw new TypeError('[GeomStore] $replaceState: newState must be a plain object')
    })
    try {
      expect(() => api.undo()).toThrow(/must be a plain object/)
      // 修复前索引已被改成 0：与仍是旧状态的活状态失步，
      // 之后 recordSnapshot 会以该索引为分支点截断 redo 历史
      expect(api.getCurrentIndex()).toBe(1)

      expect(() => api.goTo(0)).toThrow(/must be a plain object/)
      expect(api.getCurrentIndex()).toBe(1)
      // 抛出的那次回放没有将历史分支点挪走：canRedo 仍按索引 1 判定
      expect(api.getSnapshotCount()).toBe(2)
    } finally {
      replaceSpy.mockRestore()
    }
  })
})

describe('#379/#380 importHistory 的大输入与索引语义', () => {
  it('#380 先按完整输入钳制再按 overflow 偏移：导入 index=90 / 100 条 → 40', () => {
    const { api } = installTimeTravel('tt-380')
    const snapshots = Array.from({ length: 100 }, (_, i) => ({ state: { v: i }, timestamp: 1700000000000 + i }))
    api.importHistory(JSON.stringify({ snapshots, currentIndex: 90 }))

    expect(api.getSnapshotCount()).toBe(50)
    expect(api.getCurrentIndex()).toBe(40)
  })

  it('#379 超出 V8 实参上限的历史不再让导入崩溃', () => {
    jest.setTimeout(30000)
    const { api } = installTimeTravel('tt-379')
    const total = 200000
    const snapshots = Array.from({ length: total }, (_, i) => ({ state: { v: i }, timestamp: 1700000000000 + (i % 1000) }))
    const json = JSON.stringify({ snapshots, currentIndex: total - 1 })

    // 修复前 push(...valid) 以展开传参实参超限抛 RangeError:
    // Maximum call stack size exceeded
    expect(() => api.importHistory(json)).not.toThrow()
    expect(api.getSnapshotCount()).toBe(50)
    expect(api.getCurrentIndex()).toBe(49)
    jest.setTimeout(10000)
  })
})
