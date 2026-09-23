/**
 * withLoading 装饰器单元测试
 *
 * 除常规 Store 宿主外，重点覆盖「函数宿主」（静态方法里 `this` 是类构造器）：
 * 函数是合法的 WeakMap 键，必须与对象宿主走同一条共享路径（#242）。
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

  it('函数宿主（typeof 为 function）与对象宿主同样共享 loader 与引用计数（#242）', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    class Demo {
      static async first(): Promise<string> {
        await gate
        return 'first'
      }
      static async second(): Promise<string> {
        await gate
        return 'second'
      }
    }

    const patches: unknown[] = []
    // 函数宿主：静态方法里的 `this`（类构造器），typeof 为 'function'
    const host = function hostFn() {} as unknown as { setState: (key: string, value: unknown) => void }
    host.setState = (key: string, value: unknown) => {
      // 只记 loading 键：成功路径还会各写一次 error/errorData 复位
      if (key === 'loading') patches.push(value)
    }

    const a = decorate(Demo, 'first')
    const b = decorate(Demo, 'second')
    const p1 = a.invoke(host)
    const p2 = b.invoke(host)

    // 两个 action 同时在途：共享计数下 loading 仍为 true，先完成的一方不得提前复位
    await Promise.resolve()
    expect(patches).toEqual([true])

    release()
    await expect(p1).resolves.toBe('first')
    await expect(p2).resolves.toBe('second')

    // 引用计数集中后只有一对 true/false；各自独立计数会是 true,true,false,false
    expect(patches).toEqual([true, false])
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

  it('基本类型宿主每次调用各自计数，不跨调用串扰（#242 分支兜底）', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const patches: unknown[] = []
    const proto = Number.prototype as unknown as { setState?: (key: string, value: unknown) => void }
    proto.setState = (key: string, value: unknown) => {
      if (key === 'loading') patches.push(value)
    }

    class Demo {
      async load(this: unknown): Promise<string> {
        await gate
        return 'done'
      }
    }

    try {
      const { invoke } = decorate(Demo.prototype, 'load')
      // this 为基本类型：WeakMap 无从按宿主存状态，走独立 loader 分支
      const first = invoke(1)
      const second = invoke(2)
      release()
      await Promise.all([first, second])

      // 两次调用各自 true→false，而非共享引用计数的「一对 true 一次 false」
      expect(patches).toEqual([true, true, false, false])
    } finally {
      delete proto.setState
    }
  })
})
