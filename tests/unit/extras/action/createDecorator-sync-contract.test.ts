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
})
