/**
 * compose 模块级辅助函数单元测试
 *
 * 覆盖 dispatchByNamespace / findTargetStoreWithKey / parseActionName 的分支：
 * 命名空间与平铺两种模式、strict 抛错、已销毁子 store 跳过、以及
 * 「判断之后才被销毁」的写入竞态处理。
 */
import { ALL_HOOK_NAMES, dispatchByNamespace, findTargetStoreWithKey, parseActionName } from '@/core/compose/helpers.js'
import type { Store } from '@/types/store.js'

interface FakeStore {
  name: string
  destroyed: boolean
  getState: () => Record<string, unknown>
}

function fakeStore(name: string, state: Record<string, unknown> = {}): FakeStore {
  return { name, destroyed: false, getState: () => state }
}

const asStores = (stores: FakeStore[]): Store[] => stores as unknown as Store[]

describe('compose/helpers', () => {
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  describe('ALL_HOOK_NAMES', () => {
    it('包含全部生命周期钩子名', () => {
      expect(ALL_HOOK_NAMES).toEqual([
        'beforeSetState',
        'afterSetState',
        'beforePatch',
        'afterPatch',
        'beforeDispatch',
        'afterDispatch',
        'beforeReplaceState',
        'afterReplaceState',
        'onError',
      ])
    })
  })

  describe('dispatchByNamespace', () => {
    it('命名空间模式：按顶层键分发到同名 store', () => {
      const a = fakeStore('a')
      const b = fakeStore('b')
      const handler = jest.fn()

      dispatchByNamespace(asStores([a, b]), true, { a: 1, b: 2 }, false, handler)

      expect(handler).toHaveBeenCalledTimes(2)
      expect(handler).toHaveBeenCalledWith(a, 1)
      expect(handler).toHaveBeenCalledWith(b, 2)
    })

    it('命名空间模式 + strict：找不到 store 时抛错', () => {
      const handler = jest.fn()
      expect(() => dispatchByNamespace(asStores([fakeStore('a')]), true, { missing: 1 }, true, handler)).toThrow(
        '[composeStore] Cannot find store for key: missing',
      )
      expect(handler).not.toHaveBeenCalled()
    })

    it('命名空间模式 + 非 strict：找不到 store 时静默忽略', () => {
      const handler = jest.fn()
      expect(() => dispatchByNamespace(asStores([fakeStore('a')]), true, { missing: 1 }, false, handler)).not.toThrow()
      expect(handler).not.toHaveBeenCalled()
    })

    it('平铺模式：按键归属分组，每个 store 只调用一次', () => {
      const a = fakeStore('a', { x: 1, y: 2 })
      const b = fakeStore('b', { z: 3 })
      const handler = jest.fn()

      dispatchByNamespace(asStores([a, b]), undefined, { x: 10, y: 20, z: 30 }, false, handler)

      expect(handler).toHaveBeenCalledTimes(2)
      expect(handler).toHaveBeenCalledWith(a, { x: 10, y: 20 })
      expect(handler).toHaveBeenCalledWith(b, { z: 30 })
    })

    it('平铺模式 + strict：找不到归属 store 时抛错', () => {
      const handler = jest.fn()
      expect(() => dispatchByNamespace(asStores([fakeStore('a', { x: 1 })]), undefined, { nope: 1 }, true, handler)).toThrow(
        '[composeStore] Cannot find store for key: nope',
      )
      expect(handler).not.toHaveBeenCalled()
    })

    it('平铺模式 + 非 strict：找不到归属 store 时静默忽略', () => {
      const handler = jest.fn()
      expect(() => dispatchByNamespace(asStores([fakeStore('a', { x: 1 })]), undefined, { nope: 1 }, false, handler)).not.toThrow()
      expect(handler).not.toHaveBeenCalled()
    })

    it('已销毁的子 store 在入口处直接跳过并告警', () => {
      const alive = fakeStore('alive', { x: 1 })
      const dead = fakeStore('dead', { y: 2 })
      dead.destroyed = true
      const handler = jest.fn()

      dispatchByNamespace(asStores([alive, dead]), undefined, { x: 1, y: 2 }, false, handler)

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(alive, { x: 1 })
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('已销毁'))
    })

    it('写入期间才被销毁（竞态）：吞掉异常并告警，不中断其余 store', () => {
      const racing = fakeStore('racing', { x: 1 })
      const other = fakeStore('other', { y: 2 })
      const handler = jest.fn((store: unknown) => {
        const target = store as FakeStore
        if (target === racing) {
          target.destroyed = true
          throw new Error('Cannot call $patch on a destroyed Store')
        }
      })

      expect(() => dispatchByNamespace(asStores([racing, other]), undefined, { x: 1, y: 2 }, false, handler)).not.toThrow()
      expect(handler).toHaveBeenCalledTimes(2)
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('在写入期间被销毁'))
    })

    it('非竞态异常照常冒泡，不掩盖真实故障', () => {
      const store = fakeStore('a', { x: 1 })
      const handler = jest.fn(() => {
        throw new Error('boom')
      })

      expect(() => dispatchByNamespace(asStores([store]), undefined, { x: 1 }, false, handler)).toThrow('boom')
    })

    it('warnMissingKeys：$replaceState 缺失既有键时告警', () => {
      const store = fakeStore('a', { x: 1, y: 2 })
      const handler = jest.fn()

      dispatchByNamespace(asStores([store]), undefined, { x: 10 }, false, handler, { warnMissingKeys: true })

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('这些键将丢失'))
    })

    it('warnMissingKeys：无缺失键时不告警', () => {
      const store = fakeStore('a', { x: 1 })
      const handler = jest.fn()

      dispatchByNamespace(asStores([store]), undefined, { x: 10 }, false, handler, { warnMissingKeys: true })

      expect(warnSpy).not.toHaveBeenCalled()
    })

    it('warnMissingKeys：已销毁的子 store 不产生误导性告警', () => {
      const dead = fakeStore('dead', { x: 1, y: 2 })
      dead.destroyed = true
      const handler = jest.fn()

      dispatchByNamespace(asStores([dead]), undefined, { x: 10 }, false, handler, { warnMissingKeys: true })

      expect(handler).not.toHaveBeenCalled()
      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('这些键将丢失'))
    })
  })

  describe('findTargetStoreWithKey', () => {
    it('命名空间模式：拆出 store 名与实际键', () => {
      const a = fakeStore('a')
      expect(findTargetStoreWithKey('a/count', asStores([a]), true)).toEqual([a, 'count'])
    })

    it('命名空间模式：支持多级路径', () => {
      const a = fakeStore('a')
      expect(findTargetStoreWithKey('a/nested/deep', asStores([a]), true)).toEqual([a, 'nested/deep'])
    })

    it('命名空间模式：键不含 "/" 时视为未找到，避免写入空字符串键', () => {
      const a = fakeStore('a')
      expect(findTargetStoreWithKey('count', asStores([a]), true)).toEqual([undefined, 'count'])
    })

    it('命名空间模式：store 名不存在时返回 undefined 目标', () => {
      const a = fakeStore('a')
      expect(findTargetStoreWithKey('b/count', asStores([a]), true)).toEqual([undefined, 'count'])
    })

    it('平铺模式：按 own property 归属', () => {
      const a = fakeStore('a', { x: 1 })
      const b = fakeStore('b', { y: 2 })
      expect(findTargetStoreWithKey('y', asStores([a, b]))).toEqual([b, 'y'])
    })

    it('平铺模式：多个 store 含同名键时告警并取第一个', () => {
      const a = fakeStore('a', { k: 1 })
      const b = fakeStore('b', { k: 2 })
      expect(findTargetStoreWithKey('k', asStores([a, b]))).toEqual([a, 'k'])
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Ambiguous key'))
    })

    it('平铺模式：原型链属性名（toString）不应被当作命中', () => {
      const a = fakeStore('a', { x: 1 })
      expect(findTargetStoreWithKey('toString', asStores([a]))).toEqual([undefined, 'toString'])
    })
  })

  describe('parseActionName', () => {
    it('命名空间模式：首段为 store 名', () => {
      expect(parseActionName('a/increment', true)).toEqual(['a', 'increment'])
    })

    it('命名空间模式：多级成员名合并，避免静默落入裸名查找', () => {
      expect(parseActionName('a/nested/deep', true)).toEqual(['a', 'nested/deep'])
    })

    it('命名空间模式但名称不含 "/"：回落为裸名', () => {
      expect(parseActionName('increment', true)).toEqual(['', 'increment'])
    })

    it('平铺模式：始终回落为裸名', () => {
      expect(parseActionName('a/increment', undefined)).toEqual(['', 'a/increment'])
      expect(parseActionName('increment', false)).toEqual(['', 'increment'])
    })
  })
})
