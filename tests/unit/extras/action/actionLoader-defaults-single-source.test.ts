/**
 * ActionLoader 缺省值的单一来源（ocr #243 跨文件收口）
 *
 * 曾经的形态是「`ActionLoader` 构造器与 `withLoading` 各写一份字面量」，并且真的漂移过
 * （一处用大写级别、一处用小写）。本文件从三个方向钉住「只剩一处」：
 * 1. `ACTION_LOADER_DEFAULTS` 是唯一的字面量持有者，`normalizeActionLoaderOptions` 是唯一的归一化
 * 2. `ActionLoader` 构造器实际写入的键 == 该常量（行为验证，不是读常量本身）
 * 3. `withLoading` 装饰出的键、以及「无选项」与「显式默认值」两种写法是否落进同一个桶
 *    （桶按归一化签名分，默认值一旦再次漂移，两侧签名就会错开、引用计数各自独立）
 *
 * 另附公开面守卫：内部共享常量不得经 `@/extras/action.js` 外泄。
 */
import { ActionLoader, withLoading } from '@/extras/action.js'
import { ACTION_LOADER_DEFAULTS, normalizeActionLoaderOptions } from '@/extras/action/ActionLoader.js'

/** 记录 loader 往宿主写了哪些键 */
const recordState = (): { writes: Array<[string, unknown]>; setState: (key: string, value: unknown) => void } => {
  const writes: Array<[string, unknown]> = []

  return {
    writes,
    setState: (key: string, value: unknown) => {
      writes.push([key, value])
    },
  }
}

/** 手动应用装饰器，返回绑定宿主后的调用入口 */
function decorate(host: unknown, key: string, options?: Parameters<typeof withLoading>[0]): () => Promise<unknown> {
  const target = host as Record<string, unknown>
  const descriptor = Object.getOwnPropertyDescriptor(target, key) as PropertyDescriptor
  const result = withLoading(options)(target, key, descriptor) ?? descriptor

  return () => (result.value as () => Promise<unknown>).call(host)
}

describe('ActionLoader 缺省值单一来源', () => {
  it('常量持有全部 5 个选项，且归一化函数对空选项即取该常量', () => {
    expect(ACTION_LOADER_DEFAULTS).toEqual({
      autoLoading: true,
      loadingKey: 'loading',
      errorKey: 'error',
      errorDataKey: 'errorData',
      perActionKeys: false,
    })
    expect(normalizeActionLoaderOptions({})).toEqual(ACTION_LOADER_DEFAULTS)
    // 显式传满默认值必须归一化出同一结果（签名桶同源的前提）
    expect(normalizeActionLoaderOptions({ ...ACTION_LOADER_DEFAULTS })).toEqual(ACTION_LOADER_DEFAULTS)
    // 用户显式覆盖不被改写
    expect(normalizeActionLoaderOptions({ loadingKey: 'busy', perActionKeys: true })).toEqual({
      ...ACTION_LOADER_DEFAULTS,
      loadingKey: 'busy',
      perActionKeys: true,
    })
  })

  it('ActionLoader 构造器写入宿主的键就是常量里的三个键名（含成功路径的复位写）', async () => {
    const { writes, setState } = recordState()
    const loader = new ActionLoader()
    const wrapped = loader.wrap(async () => 'ok', 'fetchUser', setState)

    await expect(wrapped()).resolves.toBe('ok')

    // 计数 +1 写 true、归零写 false，再复位 error / errorData
    expect(writes).toEqual([
      ['loading', true],
      ['loading', false],
      ['error', null],
      ['errorData', null],
    ])
  })

  it('ActionLoader 失败路径的键名同样来自常量', async () => {
    const { writes, setState } = recordState()
    const loader = new ActionLoader()
    const wrapped = loader.wrap(
      async () => {
        throw new Error('boom')
      },
      'fetchUser',
      setState,
    )

    await expect(wrapped()).rejects.toThrow('boom')

    expect(writes.map(([key]) => key)).toEqual(['loading', 'loading', 'error', 'errorData'])
    expect(writes[2]?.[1]).toBeInstanceOf(Error)
    expect((writes[3]?.[1] as { message: string }).message).toBe('boom')
  })

  it('withLoading 无选项时写的键与常量一致', async () => {
    const host = {
      writes: [] as Array<[string, unknown]>,
      setState(key: string, value: unknown) {
        this.writes.push([key, value])
      },
      async load(): Promise<string> {
        return 'done'
      },
    }
    const call = decorate(host, 'load')

    await expect(call()).resolves.toBe('done')
    expect(host.writes.map(([key]) => key)).toEqual(['loading', 'loading', 'error', 'errorData'])
    expect([...new Set(host.writes.map(([key]) => key))].sort()).toEqual(['error', 'errorData', 'loading'])
  })

  it('「无选项」与「显式写满默认值」的装饰器落进同一个桶：并发只有一对 true/false', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const loadings: unknown[] = []
    const host = {
      setState(key: string, value: unknown) {
        if (key === ACTION_LOADER_DEFAULTS.loadingKey) loadings.push(value)
      },
      async first(): Promise<string> {
        await gate
        return 'first'
      },
      async second(): Promise<string> {
        await gate
        return 'second'
      },
    }
    const callFirst = decorate(host, 'first')
    const callSecond = decorate(host, 'second', { ...ACTION_LOADER_DEFAULTS })

    const p1 = callFirst()
    const p2 = callSecond()
    release()
    await Promise.all([p1, p2])

    // 两侧归一化同源 → 同一 loading 签名 → 共享引用计数；默认值再次漂移会是 true,true,false,false
    expect(loadings).toEqual([true, false])
  })

  it('extras/action 子入口的转发项全部可达，且不外泄内部共享常量', async () => {
    const entry = (await import('@/extras/action.js')) as Record<string, unknown>

    // 逐项访问：`export { ... } from` 编译后每个转发项都是 getter，
    // 不访问就既是死导出、又会在覆盖率里算成未覆盖函数
    for (const key of Object.keys(entry)) {
      expect(entry[key]).toBeDefined()
    }

    // 单一来源的常量与归一化函数只供 src 内部复用，不属于公开面
    expect(entry.ACTION_LOADER_DEFAULTS).toBeUndefined()
    expect(entry.normalizeActionLoaderOptions).toBeUndefined()
    expect(entry.ActionLoader).toBe(ActionLoader)
    expect(entry.withLoading).toBe(withLoading)
  })
})
