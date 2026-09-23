/**
 * 第六轮分片 f1-06 回归锁 —— 缓存键生成的 symbol 键与数组附加键（R6-045）
 *
 * `sortKeysDeep` 此前用 `Object.keys` 取键，symbol 键被整体丢弃（后续 JSON.stringify 同样
 * 忽略 symbol 键），于是「只差在 symbol 键上」的互异参数生成同一个缓存键并直接返回别人的结果。
 * 修复前这些断言全部会失败（第二次调用命中第一次的结果，calls 恒为 1）。
 */

import { withCache } from '@/extras/action/decorators/cache.js'

const TOKEN = Symbol('token')
const TOKEN_SIBLING = Symbol('token')
const BRAND = Symbol('brand')

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

describe('R6-045 互异参数必须生成互异缓存键', () => {
  it('对象参数：只差在 symbol 键的值上也算互异参数，且同键值仍命中', () => {
    const h = createCountingService()
    const { service } = h

    const first = service.run({ id: 1, [TOKEN]: 'a' })
    const second = service.run({ id: 1, [TOKEN]: 'b' })

    expect(second).not.toBe(first)
    expect(h.calls).toBe(2)
    // 不是「把缓存整体作废」：真正相同的参数（含同一 symbol 键与值）仍复用结果
    expect(service.run({ id: 1, [TOKEN]: 'a' })).toBe(first)
    expect(h.calls).toBe(2)
  })

  it('只有 symbol 键的对象不再与普通空对象撞键', () => {
    const h = createCountingService()
    const { service } = h

    const withSymbol = service.run({ [TOKEN]: 1 })
    const empty = service.run({})

    expect(withSymbol).not.toBe(empty)
    expect(h.calls).toBe(2)
  })

  it('同 description 的不同 symbol 作键也互相独立', () => {
    const h = createCountingService()
    const { service } = h

    const a = service.run({ id: 1, [TOKEN]: 'x' })
    const b = service.run({ id: 1, [TOKEN_SIBLING]: 'x' })

    expect(a).not.toBe(b)
    expect(h.calls).toBe(2)
  })

  it('symbol 键的顺序无关：声明顺序不同的等价参数仍生成同一份键', () => {
    const h = createCountingService()
    const { service } = h

    const first = service.run({ [TOKEN]: 'a', id: 1 })
    const second = service.run({ id: 1, [TOKEN]: 'a' })

    expect(second).toBe(first)
    expect(h.calls).toBe(1)
  })

  it('数组的非下标自有键（字符串与 symbol）参与缓存键', () => {
    const h = createCountingService()
    const { service } = h

    const plain = [1, 2]
    const withMeta = [1, 2]
    Object.defineProperty(withMeta, 'meta', { value: 1, enumerable: true })
    const withBrand = [1, 2]
    Object.defineProperty(withBrand, BRAND, { value: 'x', enumerable: true })

    expect(service.run(withMeta)).not.toBe(service.run(plain))
    expect(service.run(withBrand)).not.toBe(service.run(plain))
    expect(h.calls).toBe(3)
    // 同内容数组本身仍然命中
    expect(service.run([1, 2])).toBe(service.run([1, 2]))
    expect(h.calls).toBe(3)
  })

  it('只有 symbol 品牌键的类实例不再被误判成「无可枚举键」按身份标记', () => {
    let calls = 0
    class Branded {
      constructor(readonly token: string) {
        Object.defineProperty(this, TOKEN, { value: token, enumerable: true })
      }

      @withCache({ ttl: 5000 })
      fetch(_self: unknown): string {
        calls += 1
        return `result-${calls}`
      }
    }
    const host = new Branded('a')

    const first = host.fetch(new Branded('a'))
    const second = host.fetch(new Branded('b'))

    expect(second).not.toBe(first)
    expect(calls).toBe(2)
  })
})
