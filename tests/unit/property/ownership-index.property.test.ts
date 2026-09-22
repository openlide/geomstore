/**
 * #178 增量归属索引与「每次结构性写入都全量重建」的基线口径逐条对齐
 *
 * 判据：任意增删/移动/共享引用序列之后，一次**不改变图**的标量探测写入所上报的顶层键，
 * 必须等于测试内独立实现的暴力可达性结果（那正是全量重建给出的闭包）；
 * 解析不出归属时两边同样退化为「全部顶层键」。多报与漏报都会被这条断言抓到。
 *
 * 随机源按固定种子生成（mulberry32），失败时给出可复现的种子与操作序列。
 */
import { createDirtyTrackingCache, createDirtyTrackingProxy } from '@/core/store/dirtyTracking.js'

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type AnyObj = Record<string | symbol, unknown>

/** 被索引的边：数据属性值 / 数组元素 / Map 键值 / Set 成员；访问器不求值，内建对象不进内部槽位 */
const isPlainNode = (value: unknown): value is AnyObj => {
  if (value === null || typeof value !== 'object') return false
  return !(
    value instanceof Map ||
    value instanceof Set ||
    value instanceof Date ||
    value instanceof RegExp ||
    value instanceof WeakMap ||
    value instanceof WeakSet
  )
}

/** 暴力口径：能沿被索引的边走到 target 的顶层键 */
function reachableRootKeys(root: AnyObj, target: object): string[] {
  const found = new Set<string>()
  for (const rootKey of Object.keys(root)) {
    const pending: unknown[] = [(root as AnyObj)[rootKey]]
    const seen = new Set<object>()
    while (pending.length > 0) {
      const value = pending.pop()
      if (value === null || typeof value !== 'object' || seen.has(value as object)) continue
      seen.add(value as object)
      if (value === target) {
        found.add(rootKey)
        break
      }
      if (value instanceof Map) {
        for (const [entryKey, entryValue] of value) pending.push(entryKey, entryValue)
      } else if (value instanceof Set) {
        for (const member of value) pending.push(member)
      }
      for (const childKey of Reflect.ownKeys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, childKey)
        if (descriptor && 'value' in descriptor) pending.push(descriptor.value)
      }
    }
  }
  return [...found].sort()
}

/** 收集当前图里可用属性路径抵达的节点（不含集合内部，便于两侧同口径导航） */
function collectPaths(root: AnyObj): Array<{ path: string[]; raw: AnyObj }> {
  const out: Array<{ path: string[]; raw: AnyObj }> = []
  const seen = new Set<object>()
  const walk = (node: AnyObj, path: string[]): void => {
    if (seen.has(node)) return
    seen.add(node)
    out.push({ path, raw: node })
    for (const key of Object.keys(node)) {
      const child = node[key]
      if (isPlainNode(child)) walk(child, [...path, key])
    }
  }
  for (const rootKey of Object.keys(root)) {
    const child = root[rootKey]
    if (isPlainNode(child)) walk(child, [rootKey])
  }
  return out
}

const SLOTS = ['p', 'q', 'r'] as const
const ROOT_KEYS = ['a', 'b', 'c'] as const

function initialState(): AnyObj {
  return {
    a: { p: { v: 0 }, q: 1, map: new Map<string, unknown>(), set: new Set<unknown>() },
    b: { list: [{ v: 0 }, { v: 1 }], p: { deep: { v: 0 } } },
    c: { v: 0 },
  }
}

/** 对某节点施加一条随机操作；全部经代理进行，否则等于绕过脏跟踪（既有契约） */
function applyOp(proxyRoot: AnyObj, rawRoot: AnyObj, rnd: () => number, step: number): string {
  const paths = collectPaths(rawRoot)
  if (paths.length === 0) return 'noop@空状态'
  const target = paths[Math.floor(rnd() * paths.length)]
  const proxyTarget = target.path.reduce<AnyObj>((node, key) => (node as AnyObj)[key] as AnyObj, proxyRoot)
  const slot = SLOTS[Math.floor(rnd() * SLOTS.length)]
  const kinds = [
    'add',
    'overwrite',
    'scalar',
    'delete',
    'alias',
    'rootAssign',
    'rootDelete',
    'push',
    'truncate',
    'pop',
    'mapSet',
    'mapDelete',
    'setAdd',
    'setDelete',
  ] as const
  const kind = kinds[Math.floor(rnd() * kinds.length)]

  switch (kind) {
    case 'add':
      proxyTarget[slot] = { v: step }
      break
    case 'overwrite':
      proxyTarget[slot] = isPlainNode(proxyTarget[slot]) ? { overwritten: step } : { fresh: step }
      break
    case 'scalar':
      proxyTarget[slot] = step
      break
    case 'delete':
      delete proxyTarget[slot]
      break
    case 'alias': {
      // 共享引用：把另一个节点挂到本节点下（可能是祖先，故意造出环）
      const other = paths[Math.floor(rnd() * paths.length)]
      const proxyOther = other.path.reduce<AnyObj>((node, key) => (node as AnyObj)[key] as AnyObj, proxyRoot)
      proxyTarget[slot] = proxyOther
      break
    }
    case 'rootAssign': {
      const from = ROOT_KEYS[Math.floor(rnd() * ROOT_KEYS.length)]
      const to = ROOT_KEYS[Math.floor(rnd() * ROOT_KEYS.length)]
      proxyRoot[to] = proxyRoot[from]
      break
    }
    case 'rootDelete': {
      const key = ROOT_KEYS[Math.floor(rnd() * ROOT_KEYS.length)]
      delete proxyRoot[key]
      break
    }
    case 'push': {
      const list = proxyTarget.list as unknown[] | undefined
      if (Array.isArray(list)) list.push({ v: step })
      break
    }
    case 'truncate': {
      const list = proxyTarget.list as unknown[] | undefined
      if (Array.isArray(list)) list.length = Math.floor(rnd() * (list.length + 1))
      break
    }
    case 'pop': {
      const list = proxyTarget.list as unknown[] | undefined
      if (Array.isArray(list)) list.pop()
      break
    }
    case 'mapSet': {
      const map = proxyTarget.map as Map<unknown, unknown> | undefined
      if (map instanceof Map) map.set(rnd() > 0.5 ? 'k' : { key: step }, { v: step })
      break
    }
    case 'mapDelete': {
      const map = proxyTarget.map as Map<unknown, unknown> | undefined
      if (map instanceof Map) map.delete('k')
      break
    }
    case 'setAdd': {
      const set = proxyTarget.set as Set<unknown> | undefined
      if (set instanceof Set) set.add(rnd() > 0.5 ? (rawRoot.c ?? 'x') : { v: step })
      break
    }
    case 'setDelete': {
      const set = proxyTarget.set as Set<unknown> | undefined
      if (set instanceof Set) set.delete('x')
      break
    }
  }
  return `${kind}@${target.path.join('.')}[${slot}]`
}

describe('#178 增量索引与全量重建等价', () => {
  it.each([1, 7, 42, 20260922, 987654321])('种子 %i：随机增删/移动/共享引用后逐次探测归属', (seed) => {
    const rnd = mulberry32(seed)
    const rawRoot = initialState()
    const reports: string[][] = []
    const proxyRoot = createDirtyTrackingProxy(rawRoot, createDirtyTrackingCache(), (keys) => {
      reports.push([...keys].map(String).sort())
    }) as AnyObj
    const log: string[] = []

    for (let step = 0; step < 40; step++) {
      log.push(applyOp(proxyRoot, rawRoot, rnd, step))

      // 探测：走一条可达路径做标量写入，比较上报键与暴力可达性
      const paths = collectPaths(rawRoot)
      if (paths.length === 0) continue
      const probe = paths[Math.floor(rnd() * paths.length)]
      const probeProxy = probe.path.reduce<AnyObj>((node, key) => (node as AnyObj)[key] as AnyObj, proxyRoot)
      reports.length = 0
      probeProxy.probe = step

      const expected = reachableRootKeys(rawRoot, probe.raw)
      const expectedKeys = expected.length > 0 ? expected : Object.keys(rawRoot).sort()
      const op = log[log.length - 1]
      try {
        expect(reports).toHaveLength(1)
        expect(reports[0]).toEqual(expectedKeys)
      } catch {
        throw new Error(
          `#178 种子 ${seed} 第 ${step} 步（${op}）归属不符：上报 ${JSON.stringify(reports[0])} ≠ 全量重建 ${JSON.stringify(expectedKeys)}\n序列：${log.join(' → ')}`,
        )
      }
    }
  })
})
