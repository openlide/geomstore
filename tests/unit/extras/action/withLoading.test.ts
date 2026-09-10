/**
 * withLoading 装饰器单元测试
 *
 * 除常规 Store 宿主外，重点覆盖「宿主非对象」这一罕见防御分支：
 * 此时不查共享注册表，退化为一次性 ActionLoader 实例。
 */
import { withLoading } from '@/extras/action/withLoading.js'

/** 手动对类方法应用装饰器，返回包装后的可调用函数与描述符 */
function decorate<T extends object>(target: T, key: string): { descriptor: PropertyDescriptor; invoke: (thisArg: unknown) => unknown } {
  const descriptor = Object.getOwnPropertyDescriptor(target, key) as PropertyDescriptor
  const result = withLoading()(target, key, descriptor) ?? descriptor
  return {
    descriptor: result,
    invoke: (thisArg: unknown) => (result.value as (...args: unknown[]) => unknown).call(thisArg),
  }
}

describe('extras/action/withLoading', () => {
  it('对象宿主（Store 实例）按 setState 驱动 loading', async () => {
    class Demo {
      calls: unknown[] = []
      setState(patch: unknown): void {
        this.calls.push(patch)
      }
      async load(this: Demo): Promise<string> {
        return 'done'
      }
    }

    const { invoke } = decorate(Demo.prototype, 'load')
    const host = new Demo()

    await expect(invoke(host)).resolves.toBe('done')
    expect(host.calls.length).toBeGreaterThan(0)
  })

  it('宿主非对象（typeof 为 function）时不查注册表，退化为一次性 ActionLoader', async () => {
    class Demo {
      async load(this: unknown): Promise<string> {
        return 'done'
      }
    }

    const { invoke } = decorate(Demo.prototype, 'load')
    const calls: unknown[] = []
    // 函数宿主：typeof 为 'function'，走 else 分支
    const host = function hostFn() {} as unknown as { setState: (patch: unknown) => void }
    host.setState = (patch: unknown) => {
      calls.push(patch)
    }

    await expect(invoke(host)).resolves.toBe('done')
    expect(calls.length).toBeGreaterThan(0)
  })

  it('宿主缺少 setState 时抛出明确错误', async () => {
    class Demo {
      async load(this: unknown): Promise<string> {
        return 'done'
      }
    }

    const { invoke } = decorate(Demo.prototype, 'load')

    await expect(invoke({})).rejects.toThrow('[withLoading] Method must be used in a Store instance')
  })
})
