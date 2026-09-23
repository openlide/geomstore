/**
 * 分片 core-store-p1 · A 组的回归锁（第五轮 `ocrreview.md` 的跨分片交接项）
 *
 * 钉住三条此前只有台账、没有用例的接线：
 * - R5-124 收尾：`Store` 构造 `SubscriptionManager` 时把 `onSubscriberEvicted` 接到
 *   `hooks.onError`。改前订阅者被按策略挤掉只有开发期 console.warn，生产彻底静默
 * - R5-122 收尾：`_notifyListeners` 在需要隔离时把原始状态 + `cloneOnNotify=true` 交给
 *   管理器，载荷按注册可写性分配；改前 Store 自备一份克隆再传 `false`，
 *   「同一轮里先执行的可写回调改入参、后面的监听器读到半成品」在公开 `subscribe` 路径上未闭环
 * - R5-124/R5-122 副产物：Store 主路径不再每轮触发「cloneOnNotify=false 与可写订阅者共存」告警
 * - plugins-types 分片交接：`ActionManager._reportSettledFailure` 只为「afterDispatch 永不再来」
 *   的同步中止路径点名 `'dispatch'`，其余失败路径保持单参发射（不弹无关计时）
 *
 * `SubscriberEvictionInfo` 的 barrel 可见性是编译期锁：删掉 `core/store/index.ts` 的再导出，
 * 本文件的 type import 即报错。
 */

import { createStore } from '@/index.js'
import type { SubscriberEvictionInfo } from '@/core/store/index.js'

describe('A 组交接项：订阅者驱逐的生产可观测性', () => {
  it('evict-oldest 挤掉注册时，onError 钩子收到带上下文的 Error', () => {
    const store = createStore({
      name: 'evict-hooks',
      state: { n: 0 },
      subscription: { maxSubscribers: 1 },
    })
    const onError = jest.fn()
    store.hooks.on('onError', onError)

    function firstListener() {
      /* 具名函数：.name 要出现在上报文案里，匿名函数无法定位谁丢了更新 */
    }
    store.subscribe(firstListener)
    expect(onError).not.toHaveBeenCalled()
    store.subscribe(() => {
      /* 第二个注册把上面那份挤掉 */
    })

    expect(onError).toHaveBeenCalledTimes(1)
    const [error] = onError.mock.calls[0] as [Error]
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain('evict-oldest')
    expect(error.message).toContain('上限(1)')
    expect(error.message).toContain('firstListener')
    expect(error.message).toContain('驱逐后在册注册数：0')
  })

  it('驱逐上报走钩子而非 console：生产模式下依旧可观测（开发期告警被门控）', async () => {
    const originalEnv = process.env.NODE_ENV
    const warn = jest.spyOn(console, 'warn').mockImplementation()
    try {
      // isProduction 在模块实例内缓存判定，需重载模块图取生产语义
      jest.resetModules()
      process.env.NODE_ENV = 'production'
      const mod: typeof import('@/index.js') = await import('@/index.js')
      const store = mod.createStore({ name: 'evict-prod', state: { n: 0 }, subscription: { maxSubscribers: 1 } })
      const onError = jest.fn()
      store.hooks.on('onError', onError)
      store.subscribe(function namedVictim() {
        /* noop */
      })
      store.subscribe(() => {
        /* noop */
      })

      expect(onError).toHaveBeenCalledTimes(1)
      expect((onError.mock.calls[0] as [Error])[0].message).toContain('namedVictim')
      // 生产期不再打印驱逐告警：说明这条通道是唯一的观测点，不是 console.warn 的复制品
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
      process.env.NODE_ENV = originalEnv
      jest.resetModules()
    }
  })

  it('上报通道（onError 处理器）自身抛错不得反噬 subscribe 注册流程', () => {
    const store = createStore({ name: 'evict-throw', state: { n: 0 }, subscription: { maxSubscribers: 1 } })
    store.hooks.on('onError', () => {
      throw new Error('handler boom')
    })
    store.subscribe(() => {})
    expect(() => store.subscribe(() => {})).not.toThrow()
  })
})

describe('A 组交接项：通知载荷按注册可写性分配', () => {
  it('同一轮的两个可写订阅者拿到互不相同的载荷，改入参不串味', () => {
    const store = createStore({ state: { count: 0, nested: { v: 1 } } })
    const seen: Array<{ nested: { v: number } }> = []
    store.subscribe((s) => {
      const p = s as unknown as { nested: { v: number } }
      seen.push(p)
      if (seen.length === 1) {
        // 先执行的可写回调就地改自己的载荷（可写订阅的正当用法）
        p.nested.v = 99
      }
    })
    store.subscribe((s) => seen.push(s as unknown as { nested: { v: number } }))

    store.setState('count', 1)

    expect(seen).toHaveLength(2)
    expect(seen[0]).not.toBe(seen[1])
    // Store 未克隆那份裸状态：两条都不得是活状态本身
    expect(seen[0]).not.toBe(store.getState())
    expect(seen[1].nested.v).toBe(1)
    // 可写回调的写入不外溢到活状态
    expect(store.getState().nested.v).toBe(1)
  })

  it('仅只读订阅时保持零拷贝：载荷就是缓存的保护 Proxy，且不触发共存告警', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
    const store = createStore({ state: { count: 0 } })
    const seen: unknown[] = []
    store.subscribe((s) => seen.push(s), { readOnly: true })
    store.subscribe((s) => seen.push(s), { readOnly: true })

    store.setState('count', 1)

    expect(seen).toHaveLength(2)
    // 只读注册共用一份，且直接就是 `store.state` 那条缓存 Proxy（引用稳定，无深拷贝）
    expect(seen[0]).toBe(seen[1])
    expect(seen[0]).toBe(store.state)
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('cloneOnNotify=false 与可写订阅者共存'))
    warnSpy.mockRestore()
  })

  it('显式 notify.clone=true 时即使全为只读订阅也交付独立副本（不是活状态）', () => {
    const store = createStore({ state: { count: 0, nested: { v: 1 } }, notify: { clone: true } })
    const seen: unknown[] = []
    store.subscribe((s) => seen.push(s), { readOnly: true })
    store.subscribe((s) => seen.push(s), { readOnly: true })

    store.setState('count', 1)

    expect(seen).toHaveLength(2)
    expect(seen[0]).toBe(seen[1]) // 只读注册共用一份
    expect(seen[0]).not.toBe(store.state) // 但不是保护 Proxy，也不是活状态
    expect((seen[0] as { nested: { v: number } }).nested).not.toBe(store.getState().nested)
  })

  it(' SubscriberEvictionInfo 经 barrel 可见（编译期锁）', () => {
    const info: SubscriberEvictionInfo<{ n: number }> = { listener: () => {}, maxSubscribers: 50, size: 49 }
    expect(info.size).toBe(49)
  })
})

describe('A 组交接项：dispatch 中止路径显式点名 onError 来源', () => {
  it('同步 action 抛错：onError 收到 (error, dispatch) 两参', () => {
    const store = createStore({
      state: { n: 0 },
      actions: {
        boom(this: { dispatch: (n: string, ...a: unknown[]) => unknown }) {
          void this
          throw new Error('sync boom')
        },
      },
    })
    const onError = jest.fn()
    store.hooks.on('onError', onError)

    expect(() => store.dispatch('boom')).toThrow()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'sync boom' }), 'dispatch')
  })

  it('异步 reject 不算中止（afterDispatch 已发射）：onError 仍只带错误一个实参', async () => {
    const store = createStore({
      state: { n: 0 },
      actions: {
        async boom() {
          throw new Error('async boom')
        },
      },
    })
    const onError = jest.fn()
    store.hooks.on('onError', onError)

    await expect(store.dispatch('boom')).rejects.toThrow('async boom')
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0]).toHaveLength(1)
  })
})

describe('别名可达性扫描的 (补丁节点, 目标节点) 去重守卫', () => {
  it('同一补丁对象命中同一状态对象两次时就地收敛，且不漏收该子树里的嵌套别名', () => {
    const inner = { d: { v: 0 } }
    const store = createStore({
      name: 'alias-diamond',
      // deepCloneState 保留共享引用：state.a 与 state.b 是同一个对象
      state: { a: inner, b: inner, other: 1 },
    })
    try {
      const state = store.getState()
      expect(state.a).toBe(state.b)
      store.setState('other', state.a.d as never)

      const dirty: boolean[] = []
      store.subscribe(() => dirty.push(store.isStateKeyDirty('other')), { readOnly: true })

      const sharedPatch = { d: { v: 5 } }
      store.$patch({ a: sharedPatch, b: sharedPatch } as never)

      // 第二遍 (sharedPatch, state.a) 命中守卫直接返回：不守卫则两处子树各展开一次，
      // 状态与补丁同时成环的输入会直接栈溢出
      expect(dirty[dirty.length - 1]).toBe(true)
      expect(store.getState().other).toEqual({ v: 5 })
    } finally {
      store.destroy()
    }
  })
})
