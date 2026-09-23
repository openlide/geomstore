/**
 * 第六轮收口（main-cov）—— `withCache` 默认键生成里「多个附加键」与「非枚举键」两条分支
 *
 * 对应 src/extras/action/decorators/cache.ts 的两处残余缺口：
 * - `byKeyMarker`（第 87-89 行）：`keyValuePairs` 的排序比较器。**只有当同一个参数上出现
 *   ≥2 个「进不了 JSON.stringify 键位」的附加键时，`Array.prototype.sort` 才会调用它**，
 *   故 R6-045 的六个用例（各自只有 0 或 1 个附加键）一条也碰不到 —— 表现为全量跑时
 *   cache.ts 的 functions 停在 95.23%（20/21）、第 88 行是唯一未覆盖行。
 *   本文件用「两个及以上 symbol 键」的参数把它跑到，并钉住它承诺的行为：附加键**按键标记
 *   排序**，声明顺序无关而键值语义仍互异。
 * - `ownEnumerableKeys`（第 76-84 行）的口径：键集只取**自有可枚举**键，非枚举键与 R6-045
 *   新纳入的 symbol 键同属「与 JSON.stringify 一致的可见性口径」。缓存侧没有
 *   `includeNonEnumerable` 这个选项（那是快照克隆引擎的开关），承担同一判据的就是这里，
 *   故把「非枚举键不参与键集」的三种形状（对象 / 数组 / 类实例）钉成断言。
 *
 * 只补测试，不改实现。
 */

import { withCache } from '@/extras/action/decorators/cache.js'

const TOKEN = Symbol('token')
const BRAND = Symbol('brand')
const REGION = Symbol('region')

/** 命中与未命中的判定一律看 calls；开发期的 `[Cache] Hit` 日志在此静默 */
beforeEach(() => {
  jest.spyOn(console, 'debug').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

/** 每次调用产出一个新结果，便于用返回值判断「命中」还是「重新执行」 */
function createCountingService() {
  let calls = 0
  class Service {
    @withCache({ ttl: 5000 })
    run(_arg: unknown): string {
      calls += 1
      return `result-${calls}`
    }
  }
  const service = new Service()
  return {
    service,
    get calls(): number {
      return calls
    },
  }
}

/** 状态全部挂在 symbol 键上的类实例（`enumerable` 决定这些品牌键进不进键集） */
function createBrandedPair(keys: symbol[], enumerable: boolean) {
  let calls = 0
  class Branded {
    constructor(...values: string[]) {
      values.forEach((value, i) => {
        Object.defineProperty(this, keys[i], { value, enumerable })
      })
    }

    @withCache({ ttl: 5000 })
    fetch(_self: unknown): string {
      calls += 1
      return `result-${calls}`
    }
  }
  const host = new Branded('host-a')
  return {
    host,
    Branded,
    get calls(): number {
      return calls
    },
  }
}

describe('R6-045 收口：多个附加键参与排序（byKeyMarker 才会被调用）', () => {
  it('对象带 3 个 symbol 键：声明顺序不同的等价参数仍命中，交换两个键的值必须 miss', () => {
    const h = createCountingService()
    const { service } = h

    const first = service.run({ [TOKEN]: 'a', [BRAND]: 'b', [REGION]: 'c' })
    // 只有比较器真的跑起来，这里才会命中；否则按插入序产出的是两份不同的键
    expect(service.run({ [REGION]: 'c', [BRAND]: 'b', [TOKEN]: 'a' })).toBe(first)
    expect(h.calls).toBe(1)

    // 键集相同、键与值的配对关系不同 —— 必须算互异参数，否则就是串用缓存
    const swapped = service.run({ [TOKEN]: 'b', [BRAND]: 'a', [REGION]: 'c' })
    expect(swapped).not.toBe(first)
    expect(h.calls).toBe(2)
    expect(service.run({ [BRAND]: 'a', [REGION]: 'c', [TOKEN]: 'b' })).toBe(swapped)
    expect(h.calls).toBe(2)
  })

  it('字符串键与 2 个 symbol 键混在一起：两类键都参与，且互不干扰', () => {
    const h = createCountingService()
    const { service } = h

    const first = service.run({ zzz: 1, [TOKEN]: 'a', aaa: 2, [BRAND]: 'b' })
    expect(service.run({ aaa: 2, [BRAND]: 'b', zzz: 1, [TOKEN]: 'a' })).toBe(first)
    expect(h.calls).toBe(1)

    expect(service.run({ aaa: 2, [BRAND]: 'changed', zzz: 1, [TOKEN]: 'a' })).not.toBe(first)
    expect(h.calls).toBe(2)
  })

  it('数组同时带 meta 附加键与 symbol 键：两类键都参与区分且与挂载顺序无关', () => {
    const h = createCountingService()
    const { service } = h

    const make = (meta: number, token: string, metaFirst: boolean): unknown[] => {
      const list = [1, 2]
      const defineMeta = () => Object.defineProperty(list, 'meta', { value: meta, enumerable: true })
      const defineToken = () => Object.defineProperty(list, TOKEN, { value: token, enumerable: true })
      if (metaFirst) {
        defineMeta()
        defineToken()
      } else {
        defineToken()
        defineMeta()
      }
      return list
    }

    const first = service.run(make(1, 'a', true))
    expect(service.run(make(1, 'a', false))).toBe(first)
    expect(h.calls).toBe(1)

    // `arr.meta` 这类非下标自有键单独参与区分
    expect(service.run(make(2, 'a', true))).not.toBe(first)
    expect(service.run(make(1, 'b', true))).not.toBe(first)
    expect(h.calls).toBe(3)
  })

  it('只有 2 个可枚举品牌 symbol 键的类实例：按值语义区分，同值实例命中而差一个键值必 miss', () => {
    const h = createBrandedPair([TOKEN, BRAND], true)
    const { host, Branded } = h

    const first = host.fetch(new Branded('a', 'x'))
    // 值等价、身份互异的两个实例命中同一份缓存：说明它们走的是值语义路径而非身份标记
    expect(host.fetch(new Branded('a', 'x'))).toBe(first)
    expect(h.calls).toBe(1)

    expect(host.fetch(new Branded('a', 'y'))).not.toBe(first)
    expect(host.fetch(new Branded('b', 'x'))).not.toBe(first)
    expect(h.calls).toBe(3)
  })
})

describe('R6-045 收口：键集只取自有可枚举键（非枚举键的键集形状）', () => {
  it('普通对象：只差一个不可枚举字符串键仍算等价参数', () => {
    const h = createCountingService()
    const { service } = h

    const withHidden = { a: 1 }
    Object.defineProperty(withHidden, 'hidden', { value: 'v1', enumerable: false })
    const otherHidden = { a: 1 }
    Object.defineProperty(otherHidden, 'hidden', { value: 'v2', enumerable: false })

    const first = service.run(withHidden)
    // 与 JSON.stringify 同一口径：非枚举键不进键集，故与「压根没有该键」命中同一份缓存
    expect(service.run(otherHidden)).toBe(first)
    expect(service.run({ a: 1 })).toBe(first)
    expect(h.calls).toBe(1)
  })

  it('普通对象：不可枚举的 symbol 键同样被排除在键集之外', () => {
    const h = createCountingService()
    const { service } = h

    const source = { a: 1 }
    Object.defineProperty(source, TOKEN, { value: 'invisible', enumerable: false })

    expect(service.run(source)).toBe(service.run({ a: 1 }))
    expect(h.calls).toBe(1)
  })

  it('数组：不可枚举的附加键不参与区分，可枚举的才参与', () => {
    const h = createCountingService()
    const { service } = h

    const hiddenMeta = [1, 2]
    Object.defineProperty(hiddenMeta, 'meta', { value: 'invisible', enumerable: false })
    const visibleMeta = [1, 2]
    Object.defineProperty(visibleMeta, 'meta', { value: 'visible', enumerable: true })

    const first = service.run([1, 2])
    expect(service.run(hiddenMeta)).toBe(first)
    expect(h.calls).toBe(1)
    expect(service.run(visibleMeta)).not.toBe(first)
    expect(h.calls).toBe(2)
  })

  it('类实例：品牌键改为不可枚举后回到「无可枚举键」的身份标记路径，同实例命中、互异实例不串用', () => {
    const h = createBrandedPair([TOKEN, BRAND], false)
    const { host, Branded } = h

    const a = new Branded('a', 'x')
    const first = host.fetch(a)
    expect(host.fetch(a)).toBe(first)
    expect(h.calls).toBe(1)

    // 身份标记路径：键集为空 → 按身份编号，互异实例各算一次新参数（值相同也一样）
    expect(host.fetch(new Branded('a', 'x'))).not.toBe(first)
    expect(h.calls).toBe(2)
  })
})
