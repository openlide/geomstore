/**
 * Action 装饰器的参数边界：-0 缓存键、同步/异步返回类型一致
 */

import { withCache } from '@/extras/action/decorators/cache.js'
import { withThrottle } from '@/extras/action/decorators/throttle.js'

describe('装饰器边界键', () => {
  it('withCache 对 -0 参数生成独立缓存键（不误判为 0）', async () => {
    class Demo {
      calls = 0
      async compute(this: Demo, value: number): Promise<number> {
        this.calls += 1
        return value
      }
    }
    const descriptor = Object.getOwnPropertyDescriptor(Demo.prototype, 'compute') as PropertyDescriptor
    withCache()(Demo.prototype, 'compute', descriptor)
    const host = new Demo()

    await expect((descriptor.value as any).call(host, -0)).resolves.toBe(-0)
    await expect((descriptor.value as any).call(host, 0)).resolves.toBe(0)
    // -0 与 0 是不同的缓存键，两次都应真实执行
    expect(host.calls).toBe(2)
  })

  it('withThrottle 对同步方法与异步方法返回类型一致', async () => {
    class Demo {
      sync(this: Demo): number {
        return 1
      }
      async asyncMethod(this: Demo): Promise<number> {
        return 2
      }
    }
    const syncDescriptor = Object.getOwnPropertyDescriptor(Demo.prototype, 'sync') as PropertyDescriptor
    const asyncDescriptor = Object.getOwnPropertyDescriptor(Demo.prototype, 'asyncMethod') as PropertyDescriptor
    withThrottle()(Demo.prototype, 'sync', syncDescriptor)
    withThrottle()(Demo.prototype, 'asyncMethod', asyncDescriptor)
    const host = new Demo()

    expect((syncDescriptor.value as any).call(host)).toBeDefined()
    await expect((asyncDescriptor.value as any).call(host)).toBeDefined()
  })
})
