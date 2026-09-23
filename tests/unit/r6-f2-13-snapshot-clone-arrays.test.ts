/**
 * f2-13 回归锁（分片：src/extras/snapshot/clone.ts 同步克隆引擎）
 *
 * - R6-099：`includeNonEnumerable: true` 带进来的不可枚举属性必须在下游读得到
 *   （`Object.keys` / `JSON.stringify` / `compareSnapshots` 键集），否则该选项只是
 *   「写进了对象但没人能读到」。
 * - R6-100：数组上的非下标自有键（`arr.meta = 'v2'`）不得整体丢失，判据与
 *   `core/utils/clone.ts` 的 `deepCloneState` 一致。
 *
 * 异步引擎 `clone-async.ts` 的数组分支不在本分片范围内（见台账 NEEDS-MAIN），
 * 故此处只锁同步路径；R6-099 的改动落在两条路径共用的 `normalizeDescriptorFlags` 上，
 * 其异步侧一并生效。
 */

import { deepEqual } from '@/core/utils/equality.js'
import { createSnapshot } from '@/extras/snapshot/SnapshotManager.js'
import { compareSnapshots } from '@/extras/snapshot/diff.js'

/** 自有数据属性的三个标志；键缺失直接抛，避免断言在 undefined 上假过 */
function flagsOf(target: object, key: string): { writable?: boolean; enumerable?: boolean; configurable?: boolean } {
  const descriptor = Object.getOwnPropertyDescriptor(target, key)
  if (!descriptor) {
    throw new Error(`missing own key: ${key}`)
  }
  return { writable: descriptor.writable, enumerable: descriptor.enumerable, configurable: descriptor.configurable }
}

/** 挂一个不可枚举自有键（本库自己的做法：状态上的版本号/计数标记即属此类） */
function defineHidden(target: object, key: string, value: unknown, flags: { writable?: boolean; configurable?: boolean } = {}): void {
  Object.defineProperty(target, key, {
    value,
    writable: flags.writable ?? true,
    enumerable: false,
    configurable: flags.configurable ?? true,
  })
}

/** 往数组上挂非下标的自有可枚举键 */
function attachExtra(list: unknown[], key: string, value: unknown): void {
  const target = list as unknown as Record<string, unknown>
  target[key] = value
}

describe('R6-099 includeNonEnumerable 带进来的属性必须对下游可见（同步引擎）', () => {
  it('不可枚举自有键落为可枚举，writable/configurable 仍按源还原', () => {
    const source: Record<string, unknown> = { visible: 1 }
    defineHidden(source, '_rev', 7, { writable: false, configurable: false })

    const data = createSnapshot(source, { includeNonEnumerable: true }).data as Record<string, unknown>

    expect(Object.keys(data)).toEqual(['visible', '_rev'])
    expect(JSON.parse(JSON.stringify(data))).toEqual({ visible: 1, _rev: 7 })
    expect(flagsOf(data, '_rev')).toEqual({ writable: false, enumerable: true, configurable: false })
  })

  it('两次快照之间只有不可枚举标记变化时 compareSnapshots 报得出差异', () => {
    const make = (rev: number): Record<string, unknown> => {
      const source: Record<string, unknown> = { visible: 1 }
      defineHidden(source, '_rev', rev)
      return source
    }

    const first = createSnapshot(make(1), { includeNonEnumerable: true })
    const second = createSnapshot(make(2), { includeNonEnumerable: true })

    expect(compareSnapshots(first, second).changed).toBe(true)
  })

  it('访问器属性被该选项拉进来时同样落为可枚举数据属性', () => {
    const source: Record<string, unknown> = { visible: 1 }
    Object.defineProperty(source, 'computed', {
      get: () => 42,
      enumerable: false,
      configurable: true,
    })

    const data = createSnapshot(source, { includeNonEnumerable: true }).data as Record<string, unknown>

    expect(Object.keys(data)).toEqual(['visible', 'computed'])
    expect(data.computed).toBe(42)
    expect(flagsOf(data, 'computed')).toEqual({ writable: true, enumerable: true, configurable: true })
  })

  it('默认关闭该选项时不可枚举键不进快照（不扩大默认行为面）', () => {
    const source: Record<string, unknown> = { visible: 1 }
    defineHidden(source, '_rev', 7)

    const data = createSnapshot(source).data as Record<string, unknown>

    expect(Object.keys(data)).toEqual(['visible'])
    expect(Object.prototype.hasOwnProperty.call(data, '_rev')).toBe(false)
    expect(deepEqual(data, source)).toBe(true)
  })

  it('自有可枚举键的标志位不受影响（只提升不可枚举那一路）', () => {
    const source: Record<string, unknown> = { visible: 1 }
    Object.defineProperty(source, 'locked', { value: 2, writable: false, enumerable: true, configurable: false })

    const data = createSnapshot(source, { includeNonEnumerable: true }).data as Record<string, unknown>

    expect(flagsOf(data, 'locked')).toEqual({ writable: false, enumerable: true, configurable: false })
  })
})

describe('R6-100 数组的非下标自有键不得整体丢失（同步引擎）', () => {
  it('附加可枚举键随快照保留，副本与源在 deepEqual 下等价', () => {
    const list: unknown[] = [1, 2]
    attachExtra(list, 'meta', 'v2')
    attachExtra(list, 'version', 3)

    const data = createSnapshot({ list }).data as { list: unknown[] }

    expect(Object.keys(data.list)).toEqual(['0', '1', 'meta', 'version'])
    expect((data.list as unknown as Record<string, unknown>).meta).toBe('v2')
    expect(deepEqual(data.list, list)).toBe(true)
  })

  it('附加键的对象值走深克隆（不与活状态共享引用）', () => {
    const list: unknown[] = []
    attachExtra(list, 'cfg', { a: 1 })

    const data = createSnapshot({ list }).data as { list: unknown[] }
    const clonedCfg = (data.list as unknown as Record<string, unknown>).cfg as Record<string, unknown>

    expect(clonedCfg).toEqual({ a: 1 })
    expect(clonedCfg).not.toBe((list as unknown as Record<string, unknown>).cfg)
  })

  it('附加键的循环引用按 visited 登记收敛回克隆品自身', () => {
    const list: unknown[] = [1]
    const source: Record<string, unknown> = { list }
    attachExtra(list, 'self', source)

    const data = createSnapshot(source).data as { list: unknown[] }

    expect((data.list as unknown as Record<string, unknown>).self).toBe(data)
  })

  it('非规范数字键作为附加键保留，length 不被复制成自有数据属性', () => {
    const list: unknown[] = ['a']
    attachExtra(list, '01', 'x')

    const data = createSnapshot({ list }).data as { list: unknown[] }

    expect(Object.keys(data.list)).toEqual(['0', '01'])
    expect((data.list as unknown as Record<string, unknown>)['01']).toBe('x')
    expect(data.list.length).toBe(1)
    expect(flagsOf(data.list, 'length')).toEqual({ writable: true, enumerable: false, configurable: false })
  })

  it('__proto__ 作为附加键时承载为克隆品自己的数据属性，副本原型不变', () => {
    const list: unknown[] = [1]
    Object.defineProperty(list, '__proto__', { value: { polluted: true }, writable: true, enumerable: true, configurable: true })

    const data = createSnapshot({ list }).data as { list: unknown[] }

    expect(Object.getPrototypeOf(data.list)).toBe(Array.prototype)
    expect(Object.prototype.hasOwnProperty.call(data.list, '__proto__')).toBe(true)
    expect((data.list as unknown as Record<string, unknown>).__proto__).toEqual({ polluted: true })
  })

  it('includeNonEnumerable 打开时数组上的不可枚举附加键同样带进来', () => {
    const list: unknown[] = [1]
    defineHidden(list, '_stamp', 9)

    const data = createSnapshot({ list }, { includeNonEnumerable: true }).data as { list: unknown[] }

    expect(Object.keys(data.list)).toEqual(['0', '_stamp'])
    expect((data.list as unknown as Record<string, unknown>)._stamp).toBe(9)
  })

  it('稀疏数组的既有取舍不变：洞落成真实 undefined 元素', () => {
    const list: unknown[] = new Array(3)
    list[0] = 1
    list[2] = 3

    const data = createSnapshot({ list }).data as { list: unknown[] }

    expect(data.list.length).toBe(3)
    expect(Object.keys(data.list)).toEqual(['0', '1', '2'])
  })

  it('Array 子类仍保留原引用（不因附加键补趟而推翻 R6-008 的门槛）', () => {
    class MyList extends Array {}
    const list = MyList.of(1, 2) as unknown[]
    attachExtra(list, 'meta', 'keep')

    const data = createSnapshot({ list }).data as { list: unknown[] }

    expect(data.list).toBe(list)
  })
})
