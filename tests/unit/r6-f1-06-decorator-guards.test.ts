/**
 * 第六轮分片 f1-06 回归锁 —— 装饰器族的装饰期入参校验（R6-091）
 *
 * `withThrottle` / `withCache` 此前直接把 `descriptor.value` 断言成函数用下去，两种误用
 * 只剩与真实原因无关的报错；`withDebounce` 有 value 判据但裸读了 `descriptor.value`。
 * 修复前这些断言失败（抛 `Cannot read properties of undefined (reading 'value')`，
 * 访问器场景抛不带装饰器名字的 `Invalid property descriptor`）。
 */

import { withCache } from '@/extras/action/decorators/cache.js'
import { withDebounce } from '@/extras/action/decorators/debounce.js'
import { withThrottle } from '@/extras/action/decorators/throttle.js'

/** 误用形态无法用 `@` 语法写出（编译期即报错），只能按运行时形状直接调用 */
function applyAsPropertyDecorator(decorator: MethodDecorator): (target: object, propertyKey: string) => unknown {
  return decorator as unknown as (target: object, propertyKey: string) => unknown
}

function accessorDescriptor(): PropertyDescriptor {
  return Object.getOwnPropertyDescriptor(
    {
      get getter(): number {
        return 1
      },
    },
    'getter',
  ) as PropertyDescriptor
}

const family: Array<{ name: string; decorator: MethodDecorator }> = [
  { name: 'withThrottle', decorator: withThrottle(100) },
  { name: 'withCache', decorator: withCache() },
  { name: 'withDebounce', decorator: withDebounce(100) },
]

describe('R6-091 装饰器族在装饰期拒绝非方法目标', () => {
  for (const { name, decorator } of family) {
    it(`${name}：按 PropertyDecorator 误用（类字段，运行时只收到两个实参）时抛带装饰器名字的 TypeError`, () => {
      const apply = applyAsPropertyDecorator(decorator)

      expect(() => apply({}, 'field')).toThrow(`[${name}] can only decorate a method`)
      // 旧实现的报错只说明「某个东西是 undefined」，真实原因（用错了地方）被盖掉
      expect(() => apply({}, 'field')).not.toThrow(/Cannot read properties of undefined/)
    })

    it(`${name}：访问器描述符（get/set）在装饰阶段就被拒绝，而不是 defineProperty 报错`, () => {
      expect(() => decorator(class {}, 'getter', accessorDescriptor())).toThrow(`[${name}] can only decorate a method`)
    })
  }

  it('正常方法不受判据影响：三者仍按各自语义包装', async () => {
    let cacheCalls = 0
    let throttleCalls = 0
    let debounceCalls = 0

    class Host {
      @withCache()
      value(): string {
        cacheCalls += 1
        return 'cached'
      }

      @withThrottle(0)
      hit(): string {
        throttleCalls += 1
        return 'hit'
      }

      @withDebounce(0)
      async delayed(): Promise<string> {
        debounceCalls += 1
        return 'later'
      }
    }

    const host = new Host()
    expect(host.value()).toBe('cached')
    expect(host.value()).toBe('cached')
    expect(cacheCalls).toBe(1)
    expect(host.hit()).toBe('hit')
    expect(throttleCalls).toBe(1)
    await expect(host.delayed()).resolves.toBe('later')
    expect(debounceCalls).toBe(1)
  })
})
