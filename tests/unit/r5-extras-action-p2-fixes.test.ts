/**
 * 第五轮 extras-action-p2 修复的回归锁
 *
 * 覆盖 R5-174（超时消息用生效值）、R5-180（描述符缺失时的友好报错）、
 * R5-183（选项签名不得因分隔符撞桶）。
 */
import { withRetry } from '@/extras/action/decorators/retry.js'
import { withTimeout } from '@/extras/action/decorators/timeout.js'
import { withLoading } from '@/extras/action/withLoading.js'

/** setTimeout 可表达的最大延迟（async-core 的 MAX_TIMER_DELAY），超出即被截断 */
const MAX_TIMER_DELAY = 2 ** 31 - 1

describe('r5-extras-action-p2: withTimeout 超时消息（R5-174）', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it('超出宿主可表达区间的配置：消息写实际生效的毫秒数，而不是配置值', async () => {
    class Host {
      @withTimeout(5_000_000_000)
      async slow(): Promise<string> {
        return await new Promise((resolve) => setTimeout(() => resolve('never'), 10_000_000))
      }
    }

    const promise = new Host().slow()
    // 生效值是截断后的 2^31-1：按配置值断言会让这条用例永远等不到 rejection
    jest.advanceTimersByTime(MAX_TIMER_DELAY)

    await expect(promise).rejects.toThrow(`Timeout after ${MAX_TIMER_DELAY}ms`)
  })

  it('区间内的配置：消息数字与配置一致（既有 `Timeout after <n>ms` 契约不变）', async () => {
    class Host {
      @withTimeout(120)
      async slow(): Promise<string> {
        return await new Promise((resolve) => setTimeout(() => resolve('never'), 5000))
      }
    }

    const promise = new Host().slow()
    jest.advanceTimersByTime(120)

    await expect(promise).rejects.toThrow('Timeout after 120ms')
  })
})

describe('r5-extras-action-p2: withRetry 装饰目标（R5-180）', () => {
  it('按 PropertyDecorator 误用（类字段，运行时只收到两个实参）时抛友好 TypeError', () => {
    // 误用的形态无法用 @ 语法写出（编译期即报错），只能按运行时形状直接调用
    const applyAsPropertyDecorator = withRetry() as unknown as (target: object, propertyKey: string) => unknown
    const host = { field: 1 }

    // 旧实现在此裸读 descriptor.value，抛的是
    // `Cannot read properties of undefined (reading 'value')`，真实原因（用错地方）被盖掉
    expect(() => applyAsPropertyDecorator(host, 'field')).toThrow('[withRetry] can only decorate a method')
  })

  it('访问器描述符（value 为 undefined）仍在装饰阶段拒绝', () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      {
        get getter(): number {
          return 1
        },
      },
      'getter',
    ) as PropertyDescriptor

    expect(() => withRetry()(class {}, 'getter', descriptor)).toThrow('[withRetry] can only decorate a method')
  })

  it('正常方法仍被包装：同步失败以 rejection 暴露（返回类型变更，见 R5-181 文档）', async () => {
    let calls = 0
    class Host {
      @withRetry({ retries: 1, delay: 0 })
      sync(): string {
        calls += 1
        throw new Error('boom')
      }
    }

    const host = new Host()
    await expect(host.sync()).rejects.toThrow('boom')
    expect(calls).toBe(2)
  })
})

describe('r5-extras-action-p2: withLoading 选项签名（R5-183）', () => {
  /** 记录 setState 写入的宿主 */
  function createHost() {
    const writes: Array<[string, unknown]> = []

    return {
      writes,
      setState(key: string, value: unknown) {
        writes.push([key, value])
      },
    }
  }

  /** 手工把装饰器应用到方法上，返回以任意宿主调用的入口 */
  function decorate(target: object, key: string, decorator: MethodDecorator) {
    const descriptor = Object.getOwnPropertyDescriptor(target, key) as PropertyDescriptor
    const applied = (decorator(target, key, descriptor) ?? descriptor) as PropertyDescriptor

    return (host: unknown) => (applied.value as (...args: unknown[]) => Promise<unknown>).call(host)
  }

  it('含 `|` 的键名不再与另一套配置撞桶：两个 loader 各写各的键', async () => {
    class Host {
      async first(): Promise<string> {
        return 'first'
      }
      async second(): Promise<string> {
        return 'second'
      }
    }
    const host = createHost()

    const runFirst = decorate(Host.prototype, 'first', withLoading({ loadingKey: 'x|y', errorKey: 'z' }))
    const runSecond = decorate(Host.prototype, 'second', withLoading({ loadingKey: 'x', errorKey: 'y|z' }))

    // 旧实现的签名是 `true|x|y|z|false` 一类的分隔符拼接，两套配置拼出同一串 →
    // 第二次装饰复用第一个 loader，second 的 loading/error 会写到 'x|y'/'z' 键上
    await expect(runFirst(host)).resolves.toBe('first')
    await expect(runSecond(host)).resolves.toBe('second')

    const countOf = (key: string): number => host.writes.filter(([written]) => written === key).length
    // 每次成功调用各写一对 loading true/false + 一次 error/errorData 复位
    expect(countOf('x|y')).toBe(2)
    expect(countOf('z')).toBe(1)
    expect(countOf('x')).toBe(2)
    expect(countOf('y|z')).toBe(1)
  })
})
