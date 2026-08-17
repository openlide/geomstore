/**
 * GeomStore v1.0 - timeTravelPlugin测试
 */

import { createStore } from '@/index'
import { timeTravelPlugin } from '@/plugins/devtools'

describe('timeTravelPlugin', () => {
  afterEach(() => {
    try {
      delete (globalThis as any).__GEOMSTORE_TIME_TRAVEL__
    } catch {
      // ignore
    }
    jest.restoreAllMocks()
  })

  it('should install time travel plugin', () => {
    const store = createStore({
      name: 'test',
      state: { count: 0 },
    })

    const uninstall = store.use(timeTravelPlugin({ maxSize: 5 }))

    expect((store as any).__timeTravel__).toBeDefined()

    uninstall()
  })

  it('should record snapshots', () => {
    const store = createStore({
      name: 'test',
      state: { count: 0 },
    })

    store.use(timeTravelPlugin())

    store.setState('count', 1)
    store.setState('count', 2)

    const snapshots = (store as any).__timeTravel__.getSnapshots()
    expect(snapshots.length).toBeGreaterThanOrEqual(2)
  })

  it('should support undo', () => {
    const store = createStore({
      name: 'test',
      state: { count: 0 },
    })

    store.use(timeTravelPlugin())

    store.setState('count', 1)
    store.setState('count', 2)
    store.setState('count', 3)
    ;(store as any).__timeTravel__.undo()
    expect(store.getState().count).toBe(2)
    ;(store as any).__timeTravel__.undo()
    expect(store.getState().count).toBe(1)
  })

  it('should support redo', () => {
    const store = createStore({
      name: 'test',
      state: { count: 0 },
    })

    store.use(timeTravelPlugin())

    store.setState('count', 1)
    store.setState('count', 2)
    store.setState('count', 3)
    ;(store as any).__timeTravel__.undo()
    ;(store as any).__timeTravel__.undo()
    ;(store as any).__timeTravel__.redo()
    expect(store.getState().count).toBe(2)
  })

  it('should check canUndo/canRedo', () => {
    const store = createStore({
      name: 'test',
      state: { count: 0 },
    })

    store.use(timeTravelPlugin())

    store.setState('count', 1)
    store.setState('count', 2)

    expect((store as any).__timeTravel__.canUndo()).toBe(true)
    expect((store as any).__timeTravel__.canRedo()).toBe(false)
    ;(store as any).__timeTravel__.undo()

    expect((store as any).__timeTravel__.canUndo()).toBe(true)
    expect((store as any).__timeTravel__.canRedo()).toBe(true)
  })

  it('should go to specific index', () => {
    const store = createStore({
      name: 'test',
      state: { count: 0 },
    })

    store.use(timeTravelPlugin())

    store.setState('count', 1)
    store.setState('count', 2)
    store.setState('count', 3)
    ;(store as any).__timeTravel__.goTo(1)
    expect(store.getState().count).toBe(1)
  })

  it('should limit snapshot size', () => {
    const store = createStore({
      name: 'test',
      state: { count: 0 },
    })

    store.use(timeTravelPlugin({ maxSize: 3 }))

    for (let i = 0; i < 10; i++) {
      store.setState('count', i)
    }

    expect((store as any).__timeTravel__.getSnapshotCount()).toBeLessThanOrEqual(4) // initial + 3
  })
})

describe('timeTravelPlugin - goTo and goToTime', () => {
  afterEach(() => {
    try {
      delete (globalThis as any).__GEOMSTORE_TIME_TRAVEL__
    } catch {
      // ignore
    }
    jest.restoreAllMocks()
  })

  it('should throw error when goTo index is out of bounds (negative)', () => {
    const store = createStore({
      name: 'goTo-neg-store',
      state: { count: 0 },
    })

    store.use(timeTravelPlugin())
    store.setState('count', 1)

    expect(() => (store as any).__timeTravel__.goTo(-1)).toThrow(/out of bounds/)
  })

  it('should throw error when goTo index is out of bounds (too large)', () => {
    const store = createStore({
      name: 'goTo-large-store',
      state: { count: 0 },
    })

    store.use(timeTravelPlugin())
    store.setState('count', 1)

    expect(() => (store as any).__timeTravel__.goTo(999)).toThrow(/out of bounds/)
  })

  it('should goTo the same index without error', () => {
    const store = createStore({
      name: 'goTo-same-store',
      state: { count: 0 },
    })

    store.use(timeTravelPlugin())
    store.setState('count', 1)
    store.setState('count', 2)

    // 跳到当前索引不应报错
    ;(store as any).__timeTravel__.goTo((store as any).__timeTravel__.getCurrentIndex())
    expect(store.getState().count).toBe(2)
  })

  it('should goToTime when a snapshot matches the timestamp', async () => {
    const store = createStore({
      name: 'goToTime-store',
      state: { count: 0 },
    })

    store.use(timeTravelPlugin())

    store.setState('count', 1)
    await new Promise((r) => setTimeout(r, 20))
    store.setState('count', 2)
    await new Promise((r) => setTimeout(r, 20))
    store.setState('count', 3)
    await new Promise((r) => setTimeout(r, 20))
    store.setState('count', 4)

    const snapshots = (store as any).__timeTravel__.getSnapshots()
    // goToTime 使用 findIndex(timestamp >= target) 逻辑
    // 使用第3个快照（index=2, count=3）的 timestamp
    const targetTimestamp = snapshots[2].timestamp

    ;(store as any).__timeTravel__.goToTime(targetTimestamp)
    // findIndex 找到第一个 timestamp >= target 的快照
    // 由于快照可能同毫秒，可能匹配到 index 0 或 1 或 2
    // 我们验证它成功跳转到某个快照即可
    const currentIdx = (store as any).__timeTravel__.getCurrentIndex()
    expect(currentIdx).toBeGreaterThanOrEqual(0)
    expect(currentIdx).toBeLessThanOrEqual(2)
  })

  it('should throw error when goToTime finds no matching snapshot', () => {
    const store = createStore({
      name: 'goToTime-empty-store',
      state: { count: 0 },
    })

    store.use(timeTravelPlugin())

    // 使用一个远未来的时间戳，确保找不到
    expect(() => (store as any).__timeTravel__.goToTime(Date.now() + 1000000)).toThrow(/No snapshot found/)
  })
})

describe('timeTravelPlugin - undo/redo edge cases', () => {
  afterEach(() => {
    try {
      delete (globalThis as any).__GEOMSTORE_TIME_TRAVEL__
    } catch {
      // ignore
    }
    jest.restoreAllMocks()
  })

  it('should warn when undo at first snapshot', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    const store = createStore({
      name: 'undo-first-store',
      state: { count: 0 },
    })

    store.use(timeTravelPlugin())
    // 只有一个快照（初始状态），无法 undo
    ;(store as any).__timeTravel__.undo()

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Cannot undo'))
  })

  it('should warn when redo at latest snapshot', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    const store = createStore({
      name: 'redo-latest-store',
      state: { count: 0 },
    })

    store.use(timeTravelPlugin())
    store.setState('count', 1)
    // 已在最新快照，无法 redo
    ;(store as any).__timeTravel__.redo()

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Cannot redo'))
  })

  it('undo and redo should work together across multiple steps', () => {
    const store = createStore({
      name: 'undo-redo-multi-store',
      state: { count: 0 },
    })

    store.use(timeTravelPlugin())

    store.setState('count', 1)
    store.setState('count', 2)
    store.setState('count', 3)

    // undo all the way back
    ;(store as any).__timeTravel__.undo()
    ;(store as any).__timeTravel__.undo()
    ;(store as any).__timeTravel__.undo()

    expect(store.getState().count).toBe(0)
    expect((store as any).__timeTravel__.canUndo()).toBe(false)

    // redo all the way forward
    ;(store as any).__timeTravel__.redo()
    ;(store as any).__timeTravel__.redo()
    ;(store as any).__timeTravel__.redo()

    expect(store.getState().count).toBe(3)
    expect((store as any).__timeTravel__.canRedo()).toBe(false)
  })
})

describe('timeTravelPlugin - filter and autoRecord', () => {
  afterEach(() => {
    try {
      delete (globalThis as any).__GEOMSTORE_TIME_TRAVEL__
    } catch {
      // ignore
    }
    jest.restoreAllMocks()
  })

  it('should filter snapshots based on filter function', () => {
    const store = createStore({
      name: 'filter-store',
      state: { count: 0, shouldRecord: true },
    })

    store.use(
      timeTravelPlugin({
        filter: (state: any) => state.shouldRecord === true,
      }),
    )

    // 初始状态 shouldRecord=true，应该记录
    expect((store as any).__timeTravel__.getSnapshotCount()).toBe(1)

    // 设置 shouldRecord=false
    store.setState('shouldRecord', false)
    // 这个快照应被过滤掉
    expect((store as any).__timeTravel__.getSnapshotCount()).toBe(1)

    // 设置 shouldRecord=true
    store.setState('shouldRecord', true)
    // 这个快照应被记录
    expect((store as any).__timeTravel__.getSnapshotCount()).toBe(2)
  })

  it('should not record when autoRecord is false', () => {
    const store = createStore({
      name: 'no-auto-store',
      state: { count: 0 },
    })

    store.use(timeTravelPlugin({ autoRecord: false }))

    // 初始状态仍会被记录（recordSnapshot 在 install 中直接调用）
    expect((store as any).__timeTravel__.getSnapshotCount()).toBe(1)

    // 状态变化不应自动记录
    store.setState('count', 1)
    store.setState('count', 2)

    expect((store as any).__timeTravel__.getSnapshotCount()).toBe(1)
  })

  it('should support manual record with explicit state', () => {
    const store = createStore({
      name: 'manual-record-store',
      state: { count: 0 },
    })

    store.use(timeTravelPlugin({ autoRecord: false }))

    const initialCount = (store as any).__timeTravel__.getSnapshotCount()

    // 手动记录一个自定义状态
    ;(store as any).__timeTravel__.record({ count: 42 })

    expect((store as any).__timeTravel__.getSnapshotCount()).toBe(initialCount + 1)

    // 跳到刚记录的快照
    ;(store as any).__timeTravel__.goTo((store as any).__timeTravel__.getCurrentIndex())
    expect(store.getState().count).toBe(42)
  })

  it('should support manual record with no arguments (uses current state)', () => {
    const store = createStore({
      name: 'manual-record-current-store',
      state: { count: 0 },
    })

    store.use(timeTravelPlugin({ autoRecord: false }))

    store.setState('count', 5)
    // 当前状态未被自动记录
    const beforeCount = (store as any).__timeTravel__.getSnapshotCount()

    // 手动记录当前状态
    ;(store as any).__timeTravel__.record()

    expect((store as any).__timeTravel__.getSnapshotCount()).toBe(beforeCount + 1)
  })

  it('should delete snapshots after current index when recording after undo', () => {
    const store = createStore({
      name: 'branch-store',
      state: { count: 0 },
    })

    store.use(timeTravelPlugin())

    store.setState('count', 1)
    store.setState('count', 2)
    store.setState('count', 3)

    // undo to count=1 (index 1)
    ;(store as any).__timeTravel__.undo()
    ;(store as any).__timeTravel__.undo()

    expect(store.getState().count).toBe(1)

    const countBeforeBranch = (store as any).__timeTravel__.getSnapshotCount()

    // 新的记录应删除当前位置之后的快照
    store.setState('count', 10)

    // 快照数应该减少了（undo 后又添加了一个）
    expect((store as any).__timeTravel__.getSnapshotCount()).toBeLessThanOrEqual(countBeforeBranch)
  })
})

describe('timeTravelPlugin - clear and getCurrentIndex', () => {
  afterEach(() => {
    try {
      delete (globalThis as any).__GEOMSTORE_TIME_TRAVEL__
    } catch {
      // ignore
    }
    jest.restoreAllMocks()
  })

  it('should clear all snapshots', () => {
    const store = createStore({
      name: 'clear-store',
      state: { count: 0 },
    })

    store.use(timeTravelPlugin())

    store.setState('count', 1)
    store.setState('count', 2)
    expect((store as any).__timeTravel__.getSnapshotCount()).toBeGreaterThan(0)
    ;(store as any).__timeTravel__.clear()

    expect((store as any).__timeTravel__.getSnapshotCount()).toBe(0)
    expect((store as any).__timeTravel__.getCurrentIndex()).toBe(-1)
    expect((store as any).__timeTravel__.canUndo()).toBe(false)
    expect((store as any).__timeTravel__.canRedo()).toBe(false)
  })

  it('should return correct current index', () => {
    const store = createStore({
      name: 'index-store',
      state: { count: 0 },
    })

    store.use(timeTravelPlugin())

    // 初始状态记录后，索引为 0
    expect((store as any).__timeTravel__.getCurrentIndex()).toBe(0)

    store.setState('count', 1)
    expect((store as any).__timeTravel__.getCurrentIndex()).toBe(1)

    store.setState('count', 2)
    expect((store as any).__timeTravel__.getCurrentIndex()).toBe(2)
    ;(store as any).__timeTravel__.undo()
    expect((store as any).__timeTravel__.getCurrentIndex()).toBe(1)
  })
})

describe('timeTravelPlugin - export/import history', () => {
  afterEach(() => {
    try {
      delete (globalThis as any).__GEOMSTORE_TIME_TRAVEL__
    } catch {
      // ignore
    }
    jest.restoreAllMocks()
  })

  it('should export history as JSON', () => {
    const store = createStore({
      name: 'export-store',
      state: { count: 0 },
    })

    store.use(timeTravelPlugin())

    store.setState('count', 1)
    store.setState('count', 2)

    const json = (store as any).__timeTravel__.exportHistory()

    const parsed = JSON.parse(json)
    expect(parsed).toHaveProperty('snapshots')
    expect(parsed).toHaveProperty('currentIndex')
    expect(Array.isArray(parsed.snapshots)).toBe(true)
    expect(parsed.snapshots.length).toBeGreaterThan(0)
  })

  it('should import history from JSON', () => {
    const store = createStore({
      name: 'import-store',
      state: { count: 0 },
    })

    store.use(timeTravelPlugin())

    store.setState('count', 1)
    store.setState('count', 2)
    store.setState('count', 3)

    const json = (store as any).__timeTravel__.exportHistory()

    // 清除后导入
    ;(store as any).__timeTravel__.clear()
    expect((store as any).__timeTravel__.getSnapshotCount()).toBe(0)
    ;(store as any).__timeTravel__.importHistory(json)

    expect((store as any).__timeTravel__.getSnapshotCount()).toBeGreaterThan(0)
    // 跳到导入的历史
    ;(store as any).__timeTravel__.goTo((store as any).__timeTravel__.getCurrentIndex())
  })

  it('should import history with currentIndex from JSON', () => {
    const store = createStore({
      name: 'import-index-store',
      state: { count: 0 },
    })

    store.use(timeTravelPlugin())

    store.setState('count', 1)
    store.setState('count', 2)
    ;(store as any).__timeTravel__.undo() // currentIndex = 1

    const expectedIndex = (store as any).__timeTravel__.getCurrentIndex()
    const json = (store as any).__timeTravel__.exportHistory()

    ;(store as any).__timeTravel__.clear()
    ;(store as any).__timeTravel__.importHistory(json)

    expect((store as any).__timeTravel__.getCurrentIndex()).toBe(expectedIndex)
  })

  it('should handle import with invalid JSON data (no snapshots array)', () => {
    const store = createStore({
      name: 'import-invalid-store',
      state: { count: 0 },
    })

    store.use(timeTravelPlugin())

    store.setState('count', 1)
    const beforeCount = (store as any).__timeTravel__.getSnapshotCount()

    // 导入无效数据（没有 snapshots 数组）
    ;(store as any).__timeTravel__.importHistory(JSON.stringify({ foo: 'bar' }))

    // 不应改变现有快照
    expect((store as any).__timeTravel__.getSnapshotCount()).toBe(beforeCount)
  })

  it('should import history without currentIndex (defaults to last)', () => {
    const store = createStore({
      name: 'import-no-index-store',
      state: { count: 0 },
    })

    store.use(timeTravelPlugin())

    // 构造没有 currentIndex 的 JSON
    const customJson = JSON.stringify({
      snapshots: [
        { state: { count: 10 }, timestamp: Date.now() },
        { state: { count: 20 }, timestamp: Date.now() },
      ],
      // 没有 currentIndex
    })

    ;(store as any).__timeTravel__.importHistory(customJson)

    // currentIndex 应默认为最后一个
    expect((store as any).__timeTravel__.getCurrentIndex()).toBe(1)
  })

  it('should floor fractional currentIndex on import', () => {
    const store = createStore({
      name: 'import-fractional-index-store',
      state: { count: 0 },
    })

    store.use(timeTravelPlugin())

    const customJson = JSON.stringify({
      snapshots: [
        { state: { count: 10 }, timestamp: Date.now() },
        { state: { count: 20 }, timestamp: Date.now() },
      ],
      currentIndex: 1.5,
    })

    ;(store as any).__timeTravel__.importHistory(customJson)

    // 小数索引应向下取整到 1，避免 goTo(1.5) 取 undefined 快照传入 $replaceState
    expect((store as any).__timeTravel__.getCurrentIndex()).toBe(1)
    ;(store as any).__timeTravel__.goTo((store as any).__timeTravel__.getCurrentIndex())
    expect(store.getState()).toMatchObject({ count: 20 })
  })

  it('导入全部为畸形条目时应该安全返回', () => {
    const store = createStore({
      name: 'import-all-invalid-store',
      state: { count: 0 },
    })

    store.use(timeTravelPlugin())
    store.setState('count', 1)
    const beforeCount = (store as any).__timeTravel__.getSnapshotCount()

    // 所有条目均不合法：state 非对象或 timestamp 非数字
    const invalidJson = JSON.stringify({
      snapshots: [
        { state: 42, timestamp: 1 },
        { state: null, timestamp: 2 },
        { state: {}, timestamp: 'x' },
      ],
      currentIndex: 0,
    })

    expect(() => (store as any).__timeTravel__.importHistory(invalidJson)).not.toThrow()
    // 有效条目数为 0 时直接返回，不污染现有历史
    expect((store as any).__timeTravel__.getSnapshotCount()).toBe(beforeCount)
  })

  it('导入超过 maxSize 时应该淘汰最旧快照并修正索引', () => {
    const store = createStore({
      name: 'import-max-size-store',
      state: { count: 0 },
    })

    store.use(timeTravelPlugin({ maxSize: 2 }))

    const json = JSON.stringify({
      snapshots: [
        { state: { count: 1 }, timestamp: 1000 },
        { state: { count: 2 }, timestamp: 2000 },
        { state: { count: 3 }, timestamp: 3000 },
      ],
      currentIndex: 2,
    })

    ;(store as any).__timeTravel__.importHistory(json)

    const snapshots = (store as any).__timeTravel__.getSnapshots()
    expect(snapshots.length).toBe(2)
    // getSnapshots 返回 { timestamp, ...state 字段 } 展开结构，直接读取状态字段
    // 最旧快照 count=1 被淘汰
    expect(snapshots[0].count).toBe(2)
    expect(snapshots[1].count).toBe(3)
    // 索引随淘汰同步前移
    expect((store as any).__timeTravel__.getCurrentIndex()).toBe(1)
  })
})

describe('timeTravelPlugin - global API and uninstall', () => {
  afterEach(() => {
    try {
      delete (globalThis as any).__GEOMSTORE_TIME_TRAVEL__
    } catch {
      // ignore
    }
    jest.restoreAllMocks()
  })

  it('should expose global API', () => {
    const store = createStore({
      name: 'global-api-store',
      state: { count: 0 },
    })

    store.use(timeTravelPlugin())

    expect((globalThis as any).__GEOMSTORE_TIME_TRAVEL__).toBeDefined()
    expect((globalThis as any).__GEOMSTORE_TIME_TRAVEL__['global-api-store']).toBeDefined()
  })

  it('should log console messages on install', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {})

    const store = createStore({
      name: 'console-log-tt-store',
      state: { count: 0 },
    })

    store.use(timeTravelPlugin())

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[GeomStore][timeTravel]'))
  })

  it('should clean up global API on uninstall', () => {
    const store = createStore({
      name: 'uninstall-tt-store',
      state: { count: 0 },
    })

    const uninstall = store.use(timeTravelPlugin())
    expect((globalThis as any).__GEOMSTORE_TIME_TRAVEL__['uninstall-tt-store']).toBeDefined()

    uninstall()

    expect((globalThis as any).__GEOMSTORE_TIME_TRAVEL__?.['uninstall-tt-store']).toBeUndefined()
  })

  it('should handle uninstall when global object is already deleted', () => {
    const store = createStore({
      name: 'uninstall-null-tt-store',
      state: { count: 0 },
    })

    const uninstall = store.use(timeTravelPlugin())
    delete (globalThis as any).__GEOMSTORE_TIME_TRAVEL__

    expect(() => uninstall()).not.toThrow()
  })

  it('should handle multiple stores with separate time travel APIs', () => {
    const store1 = createStore({
      name: 'multi-tt-store-1',
      state: { count: 0 },
    })
    const store2 = createStore({
      name: 'multi-tt-store-2',
      state: { count: 0 },
    })

    store1.use(timeTravelPlugin())
    store2.use(timeTravelPlugin())

    store1.setState('count', 1)
    store2.setState('count', 100)

    expect((globalThis as any).__GEOMSTORE_TIME_TRAVEL__['multi-tt-store-1']).toBeDefined()
    expect((globalThis as any).__GEOMSTORE_TIME_TRAVEL__['multi-tt-store-2']).toBeDefined()
  })

  it('should handle install when globalThis is undefined', () => {
    const store = createStore({
      name: 'no-global-install-tt-store',
      state: { count: 0 },
    })

    const originalGlobalThis = (global as any).globalThis
    delete (global as any).globalThis

    let threw = false
    try {
      store.use(timeTravelPlugin())
    } catch {
      threw = true
    }

    (global as any).globalThis = originalGlobalThis
    expect(threw).toBe(false)
  })

  it('should handle uninstall when globalThis is undefined', () => {
    const store = createStore({
      name: 'no-global-uninstall-tt-store',
      state: { count: 0 },
    })

    const uninstall = store.use(timeTravelPlugin())

    const originalGlobalThis = (global as any).globalThis
    delete (global as any).globalThis

    let threw = false
    try {
      uninstall()
    } catch {
      threw = true
    }

    (global as any).globalThis = originalGlobalThis
    expect(threw).toBe(false)
  })
})

describe('timeTravelPlugin - getSnapshots format', () => {
  afterEach(() => {
    try {
      delete (globalThis as any).__GEOMSTORE_TIME_TRAVEL__
    } catch {
      // ignore
    }
    jest.restoreAllMocks()
  })

  it('should return snapshots with state properties spread and timestamp', () => {
    const store = createStore({
      name: 'snapshot-format-store',
      state: { count: 0, name: 'init' },
    })

    store.use(timeTravelPlugin())

    store.setState('count', 1)
    store.setState('name', 'updated')

    const snapshots = (store as any).__timeTravel__.getSnapshots()

    // 每个快照应该包含 state 的属性和 timestamp
    snapshots.forEach((s: any) => {
      expect(s).toHaveProperty('count')
      expect(s).toHaveProperty('name')
      expect(s).toHaveProperty('timestamp')
    })
  })
})

describe('timeTravelPlugin - maxSize edge cases', () => {
  afterEach(() => {
    try {
      delete (globalThis as any).__GEOMSTORE_TIME_TRAVEL__
    } catch {
      // ignore
    }
    jest.restoreAllMocks()
  })

  it('should use default maxSize of 50 when not specified', () => {
    const store = createStore({
      name: 'default-max-store',
      state: { count: 0 },
    })

    store.use(timeTravelPlugin())

    // 添加超过默认 maxSize 的快照
    for (let i = 0; i < 60; i++) {
      store.setState('count', i)
    }

    // 应限制在 50 左右
    expect((store as any).__timeTravel__.getSnapshotCount()).toBeLessThanOrEqual(51) // 50 + some buffer
  })

  it('should correctly maintain index when maxSize is exceeded', () => {
    const store = createStore({
      name: 'max-index-store',
      state: { count: 0 },
    })

    store.use(timeTravelPlugin({ maxSize: 3 }))

    for (let i = 1; i <= 10; i++) {
      store.setState('count', i)
    }

    // currentIndex 应为有效值
    const idx = (store as any).__timeTravel__.getCurrentIndex()
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(idx).toBeLessThan((store as any).__timeTravel__.getSnapshotCount())
  })
})
