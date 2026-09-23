/**
 * 不变量性质化测试（种子化随机，失败可复现）
 *
 * 逐行复审只能防一次；这里把几处反复出问题的契约写成「任意序列下都必须成立」的性质：
 * 1. 脏键超集：任何经 action 代理的写入只要改变了某个顶层键的内容，
 *    该键就必须被标记为脏（多报可以，漏报不行）
 * 2. 通知送达：一轮通知结束后，监听器看到的状态必须等于最终状态（不丢更新）
 * 3. 判等对称：deepEqual(a, b) 与 deepEqual(b, a) 必须一致（等价结构不得单向判不等）
 * 4. 订阅计数：通知次数等于存活注册数；退订句柄只影响自己那一次注册
 * 5. LRU 容量：任何操作序列后 size <= capacity（含 onEvict 重入写入）
 *
 * 随机源按固定种子生成（mulberry32），失败时给出可复现的种子与操作序列。
 */
import { createStore } from '@/core/store/index.js'
import { LRUCache } from '@/core/cache/LRUCache.js'
import { SubscriptionManager } from '@/core/store/SubscriptionManager.js'
import { clone, deepEqual } from '@/index.js'
import type { State } from '@/types/store.js'

/** 确定性伪随机（同一 seed 必然产生同一序列） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 稳定序列化：把 Map/Set 也纳入内容比较，用于判断某顶层键是否真的变了 */
function stable(value: unknown, seen = new Set<unknown>()): string {
  if (value === null) return 'null'
  const type = typeof value
  if (type === 'number' || type === 'boolean' || type === 'undefined') return String(value)
  if (type === 'string') return JSON.stringify(value)
  if (type !== 'object') return `#${type}`
  if (seen.has(value)) return '#cycle'
  seen.add(value)
  let out: string
  if (Array.isArray(value)) {
    out = `[${value.map((item) => stable(item, seen)).join(',')}]`
  } else if (value instanceof Map) {
    out = `{M${[...value.entries()].map(([k, v]) => `${stable(k, seen)}=>${stable(v, seen)}`).join(',')}}`
  } else if (value instanceof Set) {
    out = `{S${[...value.values()].map((v) => stable(v, seen)).join(',')}}`
  } else if (value instanceof Date) {
    out = `{D${value.getTime()}}`
  } else {
    out = `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${key}:${stable((value as Record<string, unknown>)[key], seen)}`)
      .join(',')}}`
  }
  seen.delete(value)
  return out
}

/** 每个顶层键的内容指纹 */
function fingerprint(state: Record<string, unknown>, keys: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const key of keys) {
    result[key] = stable(state[key])
  }
  return result
}

const TOP_KEYS = ['objA', 'objB', 'list', 'map', 'set', 'alias', 'nested'] as const

interface Op {
  readonly kind: string
  readonly detail: number
}

/** 随机生成一个「经代理的写入」操作 */
function randomOp(random: () => number): Op {
  const kinds = [
    'objA.scalar',
    'objB.scalar',
    'objA.child',
    'listPush',
    'listPop',
    'listSplice',
    'mapSet',
    'mapDelete',
    'setAdd',
    'setDelete',
    'aliasAssign',
    'aliasNestedWrite',
    'nestedAdd',
    'nestedDelete',
  ]
  return { kind: kinds[Math.floor(random() * kinds.length)], detail: Math.floor(random() * 5) }
}

/** 把操作序列作用到 action 上下文的 this.state 上（全部走可写代理） */
function applyOps(ctxState: Record<string, any>, ops: Op[]): void {
  for (const op of ops) {
    switch (op.kind) {
      case 'objA.scalar':
        ctxState.objA.count += 1
        break
      case 'objB.scalar':
        ctxState.objB.count += op.detail
        break
      case 'objA.child':
        ctxState.objA.child = { v: op.detail }
        break
      case 'listPush':
        ctxState.list.push({ v: op.detail })
        break
      case 'listPop':
        if (ctxState.list.length > 1) ctxState.list.pop()
        break
      case 'listSplice':
        if (ctxState.list.length > 1) ctxState.list.splice(0, 1)
        break
      case 'mapSet':
        ctxState.map.set(`k${op.detail}`, { v: op.detail })
        break
      case 'mapDelete':
        ctxState.map.delete(`k${op.detail}`)
        break
      case 'setAdd':
        ctxState.set.add(`s${op.detail}`)
        break
      case 'setDelete':
        ctxState.set.delete(`s${op.detail}`)
        break
      case 'aliasAssign':
        ctxState.alias = ctxState.objA
        break
      case 'aliasNestedWrite':
        if (ctxState.alias !== null && typeof ctxState.alias === 'object') ctxState.alias.count += 1
        break
      case 'nestedAdd':
        ctxState.nested.key = { v: op.detail }
        break
      case 'nestedDelete':
        delete ctxState.nested.key
        break
    }
  }
}

function createInvariantStore() {
  const rounds: Array<{ dirty: string[]; payload: Record<string, unknown> }> = []
  const store = createStore({
    name: 'property-store',
    state: {
      objA: { count: 0, child: { v: 0 } as { v: number } },
      objB: { count: 0, child: { v: 0 } as { v: number } },
      list: [{ v: 0 }] as Array<{ v: number }>,
      map: new Map<string, { v: number }>(),
      set: new Set<string>(),
      alias: null as { count: number } | null,
      nested: {} as Record<string, { v: number }>,
    },
    actions: {
      run(ops: Op[]) {
        applyOps(this.state as unknown as Record<string, any>, ops)
      },
    },
  })
  store.subscribe(
    (state) => {
      rounds.push({
        dirty: TOP_KEYS.filter((key) => store.isStateKeyDirty(key)),
        payload: { ...(state as Record<string, unknown>) },
      })
    },
    { readOnly: true },
  )
  return { store, rounds }
}

describe('不变量：脏键是「实际变化键」的超集', () => {
  it.each([1, 7, 42, 20260917, 987654321])('种子 %i 下的随机写入序列', (seed) => {
    const random = mulberry32(seed)
    const { store, rounds } = createInvariantStore()
    try {
      const before = fingerprint(store.getState() as unknown as Record<string, unknown>, [...TOP_KEYS])
      const ops = Array.from({ length: 12 }, () => randomOp(random))
      store.dispatch('run', ops)

      const after = fingerprint(store.getState() as unknown as Record<string, unknown>, [...TOP_KEYS])
      const changed = TOP_KEYS.filter((key) => before[key] !== after[key])
      const reported = new Set(rounds.flatMap((round) => round.dirty))

      // 多报可接受（例如实例方法调用、别名下的保守标记）；漏报会让视图永久陈旧
      const missed = changed.filter((key) => !reported.has(key))
      // 断言失败时打印可复现的种子与操作序列
      expect({ seed, ops, changed, missed }).toEqual({ seed, ops, changed, missed: [] })
    } finally {
      store.destroy()
    }
  })

  it.each([2, 11, 4242])('种子 %i：$patch 的别名改写同样不漏报', (seed) => {
    const random = mulberry32(seed)
    const { store, rounds } = createInvariantStore()
    try {
      // 先建立别名（objA 同时被 alias 引用）
      store.dispatch('run', [{ kind: 'aliasAssign', detail: 0 }])
      rounds.length = 0

      const before = fingerprint(store.getState() as unknown as Record<string, unknown>, [...TOP_KEYS])
      const patchKeys = random() > 0.5 ? ['objA'] : ['nested']
      if (patchKeys[0] === 'objA') {
        store.$patch({ objA: { count: 3 } } as never)
      } else {
        store.$patch({ nested: { added: { v: 1 } } } as never)
      }
      const after = fingerprint(store.getState() as unknown as Record<string, unknown>, [...TOP_KEYS])
      const changed = TOP_KEYS.filter((key) => before[key] !== after[key])
      const reported = new Set(rounds.flatMap((round) => round.dirty))

      expect(changed.length).toBeGreaterThan(0)
      const missed = changed.filter((key) => !reported.has(key))
      expect({ seed, patchKeys, changed, missed }).toEqual({ seed, patchKeys, changed, missed: [] })
    } finally {
      store.destroy()
    }
  })
})

describe('不变量：通知送达（不丢更新）', () => {
  it.each([3, 21, 3141, 606])('种子 %i 下的多轮写入最终都被送达', async (seed) => {
    const random = mulberry32(seed)
    const modes = [false, true] as const
    for (const async of modes) {
      const rounds: Array<Record<string, unknown>> = []
      const store = createStore({
        name: `deliver-${seed}-${String(async)}`,
        state: { a: 0, nested: { v: 0 }, list: [] as number[] },
        notify: { async },
        actions: {
          bump() {
            this.state.a += 1
          },
        },
      })
      const off = store.subscribe((state) => rounds.push({ ...(state as Record<string, unknown>) }), { readOnly: true })
      try {
        const ops = Array.from({ length: 6 }, () => random())
        let expected = 0
        for (const roll of ops) {
          if (roll < 0.4) {
            expected += 1
            store.dispatch('bump')
          } else if (roll < 0.7) {
            store.setState('nested', { v: (store.getState() as { nested: { v: number } }).nested.v + 1 })
          } else {
            store.$patch({ list: [...(store.getState() as { list: number[] }).list, 1] } as never)
          }
          // 异步通知：让待发通知落地，模拟真实的事件循环推进
          await Promise.resolve()
          await Promise.resolve()
        }
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(rounds.length).toBeGreaterThan(0)
        const last = rounds[rounds.length - 1]
        expect(last).toEqual({ ...(store.getState() as Record<string, unknown>) })
        expect((store.getState() as { a: number }).a).toBe(expected)
      } finally {
        off()
        store.destroy()
      }
    }
  })

  it('同步通知下回调内的重入写入产生下一轮通知且脏键可见', () => {
    const store = createStore({ name: 'reentrant-prop', state: { a: 0, b: 0 }, actions: {} })
    const observed: Array<{ dirtyA: boolean; dirtyB: boolean; a: number; b: number }> = []
    let patched = false
    const off = store.subscribe(() => {
      observed.push({
        dirtyA: store.isStateKeyDirty('a'),
        dirtyB: store.isStateKeyDirty('b'),
        a: store.getState().a,
        b: store.getState().b,
      })
      if (!patched) {
        patched = true
        store.setState('b', 1)
      }
    })
    try {
      store.setState('a', 1)
      // 第一轮：a 脏；重入写入 b 归下一轮
      expect(observed[0]).toEqual({ dirtyA: true, dirtyB: false, a: 1, b: 0 })
      // 第二轮（重入触发）：b 必须可见为脏并携带新值。
      // a 同时仍为脏属可接受的「多报」（外层轮次尚未收尾，集成层据此多读一次即可）
      expect(observed[1]).toMatchObject({ dirtyB: true, a: 1, b: 1 })
    } finally {
      off()
      store.destroy()
    }
  })
})

describe('不变量：deepEqual 的对称性', () => {
  /** 随机结构：普通对象/数组/Map/Set + 偶尔的共享引用与循环 */
  function randomValue(random: () => number, depth = 0): unknown {
    const roll = random()
    if (depth > 2 || roll < 0.25) {
      return Math.floor(random() * 3)
    }
    if (roll < 0.45) {
      return Array.from({ length: 1 + Math.floor(random() * 4) }, () => randomValue(random, depth + 1))
    }
    if (roll < 0.6) {
      const map = new Map<unknown, unknown>()
      for (let i = 0; i < Math.floor(random() * 3); i++) {
        map.set(`k${i}`, randomValue(random, depth + 1))
      }
      return map
    }
    if (roll < 0.75) {
      const set = new Set<unknown>()
      for (let i = 0; i < Math.floor(random() * 3); i++) {
        set.add(randomValue(random, depth + 1))
      }
      return set
    }
    const obj: Record<string, unknown> = {}
    for (let i = 0; i < Math.floor(random() * 4); i++) {
      obj[`f${i}`] = randomValue(random, depth + 1)
    }
    return obj
  }

  it.each([5, 55, 5555])('种子 %i：任意两结构的判等结果对称且自反', (seed) => {
    const random = mulberry32(seed)
    for (let i = 0; i < 200; i++) {
      const a = randomValue(random)
      const b = randomValue(random)

      // 自反：自身与自身判等（引用快速路径）
      expect(deepEqual(a, a)).toBe(true)
      // 对称：交换顺序结论必须一致（等价循环/别名图曾被单向误判）
      expect(deepEqual(a, b)).toBe(deepEqual(b, a))
      // 深拷贝后与自身判等（克隆保内容）
      if (a !== null && typeof a === 'object') {
        expect(deepEqual(a, clone(a, { mode: 'deep' }) as State)).toBe(true)
      }
    }
  })
})

describe('不变量：订阅计数', () => {
  it.each([9, 99, 909])('种子 %i：随机注册/退订/驱逐后通知次数等于存活注册数', (seed) => {
    const random = mulberry32(seed)
    // 上限放宽：本用例验证「通知次数 == 存活注册数」的计数语义，
    // 驱逐路径由 SubscriptionManager 专项用例覆盖（此处避免两套模型互相干扰）
    const manager = new SubscriptionManager<State>({ storeName: 'prop', maxSubscribers: 50 })
    const listeners = [jest.fn(), jest.fn(), jest.fn()]
    const handles: Array<{ listener: number; token: object }> = []
    const live = new Map<number, Set<object>>()

    for (let i = 0; i < 60; i++) {
      const roll = random()
      if (roll < 0.5) {
        const index = Math.floor(random() * listeners.length)
        const token = manager.add(listeners[index], { readOnly: random() > 0.5 })
        handles.push({ listener: index, token })
        let tracked = live.get(index)
        if (tracked === undefined) {
          tracked = new Set<object>()
          live.set(index, tracked)
        }
        tracked.add(token)
      } else if (roll < 0.85 && handles.length > 0) {
        const pick = Math.floor(random() * handles.length)
        const handle = handles[pick]
        const removed = manager.delete(listeners[handle.listener], handle.token)
        if (removed) {
          live.get(handle.listener)?.delete(handle.token)
        }
        // 重复调用必须幂等，且不得影响其他注册
        expect(manager.delete(listeners[handle.listener], handle.token)).toBe(false)
      } else {
        const index = Math.floor(random() * listeners.length)
        listeners[index].mockClear()
        manager.notify({} as State)
        const expected = live.get(index)?.size ?? 0
        // 注意：notify 会通知所有监听器，这里只比较本次清空后的调用次数
        expect(listeners[index].mock.calls.length).toBe(expected)
      }
    }

    // 收尾：完整通知一次，每个监听器的调用次数必须等于其存活注册数
    listeners.forEach((listener) => listener.mockClear())
    manager.notify({} as State)
    listeners.forEach((listener, index) => {
      expect(listener.mock.calls.length).toBe(live.get(index)?.size ?? 0)
    })
  })
})

describe('不变量：LRU 容量与一致性', () => {
  it.each([13, 1313, 31313])('种子 %i：随机操作后 size 始终不超过 capacity', (seed) => {
    const random = mulberry32(seed)
    let capacity = 3
    const cache: LRUCache<string, number> = new LRUCache<string, number>({
      capacity,
      onEvict: () => {
        // 回调内重入写入：容量不变量必须仍然成立
        if (random() < 0.3 && cache.size() < capacity) {
          cache.set(`re-${Math.floor(random() * 10)}`, 1)
        }
      },
    })

    for (let i = 0; i < 200; i++) {
      const roll = random()
      if (roll < 0.5) {
        cache.set(`k${Math.floor(random() * 8)}`, i)
      } else if (roll < 0.7) {
        cache.get(`k${Math.floor(random() * 8)}`)
      } else if (roll < 0.85) {
        cache.delete(`k${Math.floor(random() * 8)}`)
      } else {
        capacity = 1 + Math.floor(random() * 5)
        cache.resize(capacity)
      }
      expect(cache.size()).toBeLessThanOrEqual(capacity)
    }
  })
})
