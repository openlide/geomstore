/**
 * createDecorator 的返回类型契约回归（第四轮复审 #199）
 *
 * 修复前 descriptor.value 被无条件替换成 async function：同步方法的返回值变成 Promise，
 * 且丢失原方法的 name/length，非函数描述符只在运行时抛 `apply is not a function`。
 */

import { createDecorator } from '@/extras/action/decorators/common.js'

describe('createDecorator 返回值类型契约', () => {
  it('同步方法装饰后仍同步返回原值', () => {
    const after = jest.fn()

    class Sync {
      @createDecorator({ after })
      add(a: number, b: number) {
        return a + b
      }
    }

    const result = new Sync().add(1, 2)

    expect(result).toBe(3)
    const notPromise: unknown = result
    expect(notPromise instanceof Promise).toBe(false)
    expect(after).toHaveBeenCalledWith(3)
  })

  it('同步方法抛错时 onError 触发并原样重抛', () => {
    const onError = jest.fn()

    class SyncThrow {
      @createDecorator({ onError })
      boom(): number {
        throw new Error('sync boom')
      }
    }

    expect(() => new SyncThrow().boom()).toThrow('sync boom')
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'sync boom' }))
  })

  it('异步方法保持 Promise 返回，after 拿到结算值', async () => {
    const calls: string[] = []

    class Async {
      @createDecorator({
        before: () => calls.push('before'),
        after: (r) => calls.push(`after:${r}`),
      })
      async load(): Promise<number> {
        calls.push('method')
        return 7
      }
    }

    const pending = new Async().load()
    expect(pending instanceof Promise).toBe(true)
    await expect(pending).resolves.toBe(7)
    expect(calls).toEqual(['before', 'method', 'after:7'])
  })

  it('异步方法 reject 时 onError 触发且 Promise 仍为 rejected', async () => {
    const onError = jest.fn()
    const after = jest.fn()

    class AsyncFail {
      @createDecorator({ after, onError })
      async load(): Promise<number> {
        throw new Error('async boom')
      }
    }

    await expect(new AsyncFail().load()).rejects.toThrow('async boom')
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'async boom' }))
    expect(after).not.toHaveBeenCalled()
  })

  it('非 async 语法但返回 Promise 的方法同样按异步处理', async () => {
    const after = jest.fn()

    class Thenable {
      @createDecorator({ after })
      load(): Promise<string> {
        return Promise.resolve('late')
      }
    }

    await expect(new Thenable().load()).resolves.toBe('late')
    expect(after).toHaveBeenCalledWith('late')
  })

  it('保留原方法的 name 与 length', () => {
    class Named {
      @createDecorator()
      twoArgs(_a: number, _b: number): number {
        return 0
      }
    }

    const method = new Named().twoArgs
    expect(method.name).toBe('twoArgs')
    expect(method.length).toBe(2)
  })

  it('装饰非函数描述符时早失败', () => {
    const descriptor: PropertyDescriptor = { get: () => 1, configurable: true, enumerable: true }

    expect(() => createDecorator()({}, 'accessor', descriptor)).toThrow(TypeError)
  })

  it('before 是 async 回调时先等它 settle，其 rejection 走 onError', async () => {
    const order: string[] = []
    const onError = jest.fn()

    class Guarded {
      @createDecorator({
        before: async () => {
          await Promise.resolve()
          order.push('before')
        },
        onError,
      })
      run(): string {
        order.push('run')
        return 'ok'
      }
    }

    await expect(new Guarded().run()).resolves.toBe('ok')
    expect(order).toEqual(['before', 'run'])

    const failing: Array<() => string> = []
    class GuardedFails {
      @createDecorator({
        before: async () => {
          throw new Error('guard rejected')
        },
        onError,
      })
      run(): string {
        failing.push(() => 'should not run')
        return 'never'
      }
    }

    await expect(new GuardedFails().run()).rejects.toThrow('guard rejected')
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'guard rejected' }))
    expect(failing).toHaveLength(0)
  })

  it('before 同步抛错时不调用被装饰方法', () => {
    const onError = jest.fn()
    const runBody = jest.fn(() => 'ok')

    class SyncGuard {
      @createDecorator({
        before: () => {
          throw new Error('guard threw')
        },
        onError,
      })
      run(): string {
        return runBody()
      }
    }

    expect(() => new SyncGuard().run()).toThrow('guard threw')
    expect(runBody).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'guard threw' }))
  })

  it('after 返回 Promise：异步方法时被等待，同步方法时只兜住 rejection', async () => {
    const seen: string[] = []
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    class AsyncTail {
      @createDecorator({
        after: async () => {
          await Promise.resolve()
          seen.push('after')
        },
      })
      async run(): Promise<string> {
        return 'async'
      }
    }

    await new AsyncTail().run()
    expect(seen).toEqual(['after'])

    class SyncTail {
      @createDecorator({
        after: () =>
          Promise.reject(new Error('after rejected')),
      })
      run(): string {
        return 'sync'
      }
    }

    // 同步契约优先：返回值仍是同步的原值，rejection 就地记日志而非外抛
    expect(new SyncTail().run()).toBe('sync')
    // 兜底 catch 落在 rejection 之后，需要让出一次宏任务才会执行
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(errSpy).toHaveBeenCalledWith('[Action] async after callback rejected:', expect.any(Error))
    errSpy.mockRestore()
  })

  it('onError 自身抛错不顶替原始失败', () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    class Noisy {
      @createDecorator({
        onError: () => {
          throw new Error('onError boom')
        },
      })
      run(): number {
        throw new Error('original')
      }
    }

    expect(() => new Noisy().run()).toThrow('original')
    expect(errSpy).toHaveBeenCalledWith('[Action] onError callback threw:', expect.any(Error))
    errSpy.mockRestore()
  })
})
