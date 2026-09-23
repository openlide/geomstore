/**
 * 主会话代做项 B15 的回归锁：异步克隆引擎的「数组附加自有键」补趟
 * （`src/extras/snapshot/clone-async.ts` 的数组分支，与同步引擎 `clone.ts` 的
 * R6-100 同一趟；f2-13 只锁了同步侧并把这一侧记成 NEEDS-MAIN）
 *
 * 整趟丢弃的后果不是「少个键」那么轻：`deepEqual` 比的是 `Object.keys` 键集，
 * 于是同一份数据「同步快照看得见、异步快照看不见」，`compareSnapshots` 还会把
 * 丢键报成一条删除。这里逐条锁住两路径同形。
 */

import { deepEqual } from '@/core/utils/equality.js'
import { createSnapshot, createSnapshotAsync } from '@/extras/snapshot/SnapshotManager.js'

/** 自有数据属性的三个标志；键缺失直接抛，避免断言在 undefined 上假过 */
function flagsOf(target: object, key: string): { writable?: boolean; enumerable?: boolean; configurable?: boolean } {
  const descriptor = Object.getOwnPropertyDescriptor(target, key)
  if (!descriptor) {
    throw new Error(`missing own key: ${key}`)
  }
  return { writable: descriptor.writable, enumerable: descriptor.enumerable, configurable: descriptor.configurable }
}

/** 往数组上挂非下标的自有可枚举键 */
function attachExtra(list: unknown[], key: string, value: unknown): void {
  // 先取名再赋值：写成 `;(list as ...)[key] = value` 需要前置分号防 ASI，
  // 而 no-extra-semi 会把它判成多余分号（本轮已两次踩在同一处）
  const target = list as unknown as Record<string, unknown>
  target[key] = value
}

function defineOn(target: object, key: string, descriptor: PropertyDescriptor): void {
  Object.defineProperty(target, key, descriptor)
}

describe('R6-100 异步侧：数组附加自有键随快照保留', () => {
  it('基本类型附加键保留，副本与源在 deepEqual 下等价', async () => {
    const list: unknown[] = [1, 2, 3]
    attachExtra(list, 'meta', 'v2')
    attachExtra(list, 'version', 7)

    const snap = await createSnapshotAsync({ list })
    const data = snap.data as { list: unknown[] }

    expect(snap.success).toBe(true)
    expect(Object.keys(data.list)).toEqual(['0', '1', '2', 'meta', 'version'])
    expect((data.list as unknown as Record<string, unknown>).meta).toBe('v2')
    expect(deepEqual(data.list, list)).toBe(true)
  })

  it('对象值附加键走异步填充且与活状态隔离', async () => {
    const list: unknown[] = [1]
    const meta = { nested: { v: 1 } }
    attachExtra(list, 'meta', meta)

    const data = (await createSnapshotAsync({ list })).data as { list: unknown[] }
    const clonedMeta = (data.list as unknown as Record<string, { nested: { v: number } }>).meta

    expect(clonedMeta).not.toBe(meta)
    expect(clonedMeta.nested.v).toBe(1)
    meta.nested.v = 99
    expect(clonedMeta.nested.v).toBe(1)
  })

  it('非规范数字键按附加键保留，length 不被复制成可枚举键', async () => {
    const list: unknown[] = [1]
    attachExtra(list, '01', 'not-an-index')

    const snap = await createSnapshotAsync({ list })
    const data = snap.data!.list as unknown

    expect(snap.success).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(data, '01')).toBe(true)
    // `length` 对任何数组都是自有属性，契约是「不被复制成可枚举键」
    expect(Object.keys(data as object)).not.toContain('length')
    expect((data as Record<string, unknown>)['01']).toBe('not-an-index')
  })

  it('__proto__ 作为附加键时承载为克隆品自己的数据属性，副本原型不变', async () => {
    const list: unknown[] = [1]
    const proto = Object.freeze({ inj: 1 })
    // 必须走 defineProperty：`list.__proto__ = proto` 命中的是 Object.prototype 上的
    // setter，改的是源数组自己的原型——那样 R6-008 的 isExactly 门槛会先把整条原引用返回
    defineOn(list, '__proto__', { value: proto, enumerable: true, writable: true, configurable: true })

    const snap = await createSnapshotAsync({ list })
    const data = snap.data!.list as unknown[]

    expect(snap.success).toBe(true)
    expect(Object.getPrototypeOf(data)).toBe(Array.prototype)
    expect(Object.prototype.hasOwnProperty.call(data, '__proto__')).toBe(true)
    expect((data as unknown as Record<string, unknown>).inj).toBeUndefined()
    // 值本身按克隆语义处理（与同步路径 copyOwnKey 一致），故比内容而不是比引用
    expect((data as unknown as Record<string, unknown>)['__proto__']).toEqual(proto)
  })

  it('includeNonEnumerable 拉进来的不可枚举附加键：键一律可枚举、writable/configurable 按源还原', async () => {
    const list: unknown[] = [1]
    defineOn(list, '_rev', { value: 7, writable: false, enumerable: false, configurable: false })

    const snap = await createSnapshotAsync({ list }, { includeNonEnumerable: true })
    const data = snap.data!.list as unknown[]

    expect(snap.success).toBe(true)
    expect(Object.keys(data)).toContain('_rev')
    expect(flagsOf(data, '_rev')).toEqual({ writable: false, enumerable: true, configurable: false })

    // 默认关闭时该键不进快照（不扩大默认行为面）
    const plain = (await createSnapshotAsync({ list })).data!.list as unknown[]
    expect(Object.prototype.hasOwnProperty.call(plain, '_rev')).toBe(false)
  })

  it('访问器附加键以 getter 求值落成数据属性，getter 抛错只丢该键并落 cloneError', async () => {
    const list: unknown[] = [1]
    defineOn(list, 'computed', {
      get: () => 42,
      enumerable: true,
      configurable: true,
    })
    defineOn(list, 'hostile', {
      get() {
        throw new Error('getter boom')
      },
      enumerable: true,
      configurable: true,
    })

    const errors: unknown[] = []
    const snap = await createSnapshotAsync(
      { list },
      {
        onError: (error) => {
          errors.push(error)
          return true
        },
      },
    )
    const data = snap.data!.list as unknown

    // 记过 cloneError 的快照不是 success（`success:false ⇒ errors 非空` 的不变量），
    // 但除该键以外整体照常交付
    expect(snap.success).toBe(false)
    expect((data as Record<string, unknown>).computed).toBe(42)
    expect(Object.prototype.hasOwnProperty.call(data, 'hostile')).toBe(false)
    expect(errors.filter((e) => (e as { type?: string }).type === 'cloneError')).toHaveLength(1)
    expect((errors[0] as { path?: string }).path).toBe('root.list.hostile')
  })

  it('附加键在枚举之后消失时跳过该键，不让整趟失败', async () => {
    const base: unknown[] = ['real']
    let ghostLookups = 0
    const proxy = new Proxy(base, {
      // 必须报上 `length`：它是目标的非自有可配置性属性（configurable: false），
      // Proxy 的 ownKeys 不变量要求结果含全部非可配置自有键，否则直接 TypeError
      ownKeys: () => ['0', 'length', 'ghost'],
      getOwnPropertyDescriptor(target, key) {
        if (key === 'ghost') {
          ghostLookups++
          // 第一次是 `Object.keys` 的可枚举性检查 → 给合法描述符，让它进键集；
          // 第二次是本实现补趟时取描述符 → 声明它已不存在（并发 delete 的等价形状）
          return ghostLookups === 1 ? { value: 'x', enumerable: true, writable: true, configurable: true } : undefined
        }
        return Reflect.getOwnPropertyDescriptor(target, key)
      },
    })

    const snap = await createSnapshotAsync({ list: proxy })
    const data = snap.data!.list as unknown[]

    expect(snap.success).toBe(true)
    expect(ghostLookups).toBeGreaterThanOrEqual(2)
    expect(Object.prototype.hasOwnProperty.call(data, 'ghost')).toBe(false)
    expect(data[0]).toBe('real')
  })

  it('Array 子类仍保留原引用（附加键补趟不推翻 R6-008 的门槛）', async () => {
    class Bucket extends Array<number> {}
    const bucket = Bucket.from([1, 2]) as unknown as number[]
    attachExtra(bucket, 'meta', 'keep')

    const data = (await createSnapshotAsync({ bucket })).data as { bucket: unknown[] }

    expect(data.bucket).toBe(bucket)
  })

  it('两路径同形：同一份带附加键的数组，同步与异步快照的键集一致', async () => {
    const list: unknown[] = [1, 2]
    attachExtra(list, 'meta', { a: 1 })
    attachExtra(list, 'flag', true)
    defineOn(list, '_hidden', { value: 3, enumerable: false, configurable: true, writable: true })

    const syncKeys = Object.keys((createSnapshot({ list }, { includeNonEnumerable: true }).data as { list: unknown[] }).list)
    const asyncKeys = Object.keys((await createSnapshotAsync({ list }, { includeNonEnumerable: true })).data!.list as unknown[])

    expect(asyncKeys).toEqual(syncKeys)
  })

  it('内建 Date / RegExp / Set 在异步引擎里被重建为同类新对象', async () => {
    const date = new Date(1_700_000_000_000)
    const re = /geomstore/gi
    const set = new Set(['a', 'b'])

    const snap = await createSnapshotAsync({ date, re, set })
    const data = snap.data!

    expect(snap.success).toBe(true)
    expect(data.date).not.toBe(date)
    expect(data.date.getTime()).toBe(date.getTime())
    expect(data.re).not.toBe(re)
    expect([data.re.source, data.re.flags]).toEqual(['geomstore', 'gi'])
    expect(data.set).not.toBe(set)
    expect([...data.set]).toEqual(['a', 'b'])
  })

  it('内建 Date / RegExp / Set 的子类在异步引擎里同样保留原引用（R6-008 门槛两路径同口径）', async () => {
    class MyDate extends Date {}
    class MyRegExp extends RegExp {}
    class MySet<T> extends Set<T> {
      first(): T | undefined {
        return this.values().next().value
      }
    }

    const date = new MyDate(1_700_000_000_000)
    const re = new MyRegExp('geom', 'g')
    const set = new MySet(['a'])

    const data = (await createSnapshotAsync({ date, re, set })).data!

    expect(data.date).toBe(date)
    expect(data.re).toBe(re)
    expect(data.set).toBe(set)
    // 保留原引用 ⇒ 子类方法仍在（重建为基类副本时这里会 TypeError）
    expect(data.set.first()).toBe('a')
  })
})
