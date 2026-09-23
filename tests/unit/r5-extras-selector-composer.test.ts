/**
 * 第五轮 extras-selector 分片：SelectorComposer 与公开入口
 *
 * - R5-219：`extras/selector` 入口同时导出重试工厂，与 `SelectorComposer` 静态方法同源
 * - R5-232：`combine` 不再用双重断言把 selectors/combiner 的类型契约抹平
 * - R5-233：定时器句柄为 0 时防抖窗口仍能撤销上一轮待发定时器
 * - R5-234：非 Error 抛出值原样成为 rejection 原因
 * - R5-236：`createDefaultSelector` 兜底时留痕，把真故障与合法空值区分开
 * - R5-237：`createObjectSelector` 普通键走赋值、仅 `__proto__` 走 DefineOwnProperty
 */
import { SelectorComposer, createRetrySelector, createRetrySelectorAsync } from '@/extras/selector/index.js'
import { createRetrySelector as factorySync, createRetrySelectorAsync as factoryAsync } from '@/extras/selector/retrySelector.js'

type S = { value: number }

const state: S = { value: 21 }
const readValue = (s: S): number => s.value
const readLabel = (_s: S): string => 'v'

describe('公开入口导出重试工厂（R5-219）', () => {
  it('入口导出的工厂与 selectorComposer 静态方法转调的是同一实现', () => {
    expect(typeof createRetrySelector).toBe('function')
    expect(typeof createRetrySelectorAsync).toBe('function')
    expect(createRetrySelector).toBe(factorySync)
    expect(createRetrySelectorAsync).toBe(factoryAsync)
  })

  it('经入口创建的同步重试选择器行为与静态方法一致', () => {
    let calls = 0
    const flaky = (s: S): number => {
      calls += 1
      if (calls < 3) throw new Error('not yet')
      return s.value
    }

    expect(createRetrySelector(flaky, { retries: 3 })(state)).toBe(21)
    expect(SelectorComposer.createRetrySelector(flaky, { retries: 3 })(state)).toBe(21)
  })
})

describe('combine 不再靠断言抹平类型契约（R5-232）', () => {
  it('按顺序把各选择器结果透传给组合器', () => {
    const select = SelectorComposer.combine<S, string, [typeof readValue, typeof readLabel]>({
      selectors: [readValue, readLabel],
      combiner: (value, label) => `${label}:${String(value)}`,
    })

    expect(select(state)).toBe('v:21')
  })

  it('combiner 的返回类型与声明的 R 不符时编译期即失败（此前被 as R 静默）', () => {
    const select = SelectorComposer.combine<S, number, [typeof readValue]>({
      selectors: [readValue],
      // @ts-expect-error combiner 返回 string，与 R = number 不符：R 现已一路透传到 combiner 的返回位
      combiner: (value) => `nope:${String(value)}`,
    })

    // 运行期本就没有兜底：组合结果原样交给调用方
    expect(select(state)).toBe('nope:21')
  })
})

describe('防抖选择器的定时器句柄与 rejection 原因（R5-233 / R5-234）', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  it('句柄为 0 时照样 clearTimeout：防抖窗口不会被同一轮里的多次调用打穿', async () => {
    // 自己排程：让第一个定时器句柄恰好是 0（假时钟/宿主都可能给出该值），
    // 旧写法 `if (timeoutId)` 在此处判假 → 上一轮的待发回调永远清不掉
    const queue = new Map<number, () => void>()
    let nextId = 0
    jest.spyOn(globalThis, 'setTimeout').mockImplementation(((handler: () => void) => {
      const id = nextId++
      queue.set(id, handler)
      return id
    }) as unknown as typeof setTimeout)
    jest.spyOn(globalThis, 'clearTimeout').mockImplementation(((id: number) => {
      queue.delete(id)
    }) as unknown as typeof clearTimeout)

    let calls = 0
    const select = SelectorComposer.createDebouncedSelector((s: S) => {
      calls += 1
      return s.value * 2
    })

    const first = select(state)
    const second = select(state)
    for (const handler of [...queue.values()]) handler()

    await expect(Promise.all([first, second])).resolves.toEqual([42, 42])
    expect(calls).toBe(1)
  })

  it('非 Error 抛出值原样成为 rejection 原因，不被断言成 Error', async () => {
    jest.useFakeTimers()
    const select = SelectorComposer.createDebouncedSelector<S, number>(() => {
      throw 'boom'
    })

    const pending = select(state)
    jest.advanceTimersByTime(300)
    await expect(pending).rejects.toBe('boom')
  })

  it('抛出对象值同样原样落地（identity 保持）', async () => {
    jest.useFakeTimers()
    const thrown = { code: 500 }
    const select = SelectorComposer.createDebouncedSelector<S, number>(() => {
      throw thrown
    })

    const pending = select(state)
    jest.advanceTimersByTime(300)
    await expect(pending).rejects.toBe(thrown)
  })
})

describe('createDefaultSelector 的兜底留痕（R5-236）', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('选择器抛错时记一条 console.error，并把原始抛出值带进去', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const thrown = new TypeError('bad property')
    const select = SelectorComposer.createDefaultSelector<S, number>(() => {
      throw thrown
    }, 0)

    expect(select(state)).toBe(0)
    expect(spy).toHaveBeenCalledTimes(1)
    // 日志形状为 (前缀, 原始抛出值)：兜底值不该混进日志，但真故障必须留痕
    expect(spy.mock.calls[0][1]).toBe(thrown)
  })

  it('合法返回 undefined 时不记日志：两条兜底路径仍可区分', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const select = SelectorComposer.createDefaultSelector<S, number | undefined>(() => undefined, 7)

    expect(select(state)).toBe(7)
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('createObjectSelector 的按键写入（R5-237）', () => {
  it('普通键与自有 __proto__ 键同批写入时结果同形', () => {
    const source = Object.defineProperty({ a: 1 }, '__proto__', {
      value: 2,
      enumerable: true,
      writable: true,
      configurable: true,
    }) as Record<string, number>

    const select = SelectorComposer.createObjectSelector<Record<string, number>, string, string>((key) => (s) => `${key}=${String(s[key])}`)
    const result = select(source) as Record<string, string>

    expect(result.a).toBe('a=1')
    // 只有 __proto__ 需要 DefineOwnProperty：走 [[Set]] 会触发原型 setter，
    // 该键的派生结果被静默丢弃且 result 的原型被换掉
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
    expect(Object.getOwnPropertyDescriptor(result, '__proto__')?.value).toBe('__proto__=2')
    expect(Object.keys(result)).toEqual(['a', '__proto__'])
  })
})
