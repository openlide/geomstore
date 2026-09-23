/**
 * 第六轮分片 f1-06 回归锁 —— ActionLoader 复位能力的生命周期（R6-044）
 *
 * 断言的是**修复后**的语义：`lastSetState` 在每次调用时登记，因此 `clear()` 之后继续
 * 复用同一个 wrapper 仍能复位 loading/error。修复前该字段只在 `wrap()` 当时赋值，
 * `clear()` 又把它清成 undefined，「wrap → clear → 复用 → clear」这条路径上一个复位值
 * 都写不出去（store 的 loading 永久卡在 true）。
 */

import { ActionLoader } from '@/extras/action/ActionLoader.js'

/** 可控结算的 action：调用方决定它何时完成，用于制造「在途调用被 clear 打断」 */
function createGate() {
  let release: (value: unknown) => void = () => undefined
  let reject: (error: unknown) => void = () => undefined
  const promise = new Promise<unknown>((resolve, rj) => {
    release = resolve
    reject = rj
  })
  return { promise, release, reject }
}

function createHarness() {
  const state: Record<string, unknown> = {}
  const setState = (key: string, value: unknown): void => {
    state[key] = value
  }
  return { state, setState }
}

describe('R6-044 clear() 之后复用同一个 wrapper 仍有复位能力', () => {
  it('第二次 clear() 仍把 store 的 loading 翻回 false', async () => {
    const { state, setState } = createHarness()
    const gate = createGate()
    const loader = new ActionLoader()
    const wrapped = loader.wrap(async () => await gate.promise, 'fetch', setState)

    const first = wrapped()
    expect(state.loading).toBe(true)
    loader.clear()
    expect(state.loading).toBe(false)

    // 复用 wrap 时拿到的同一个 wrapper：increment 重新写满计数并把 loading 置 true
    const second = wrapped()
    expect(state.loading).toBe(true)
    loader.clear()
    // 修复前：lastSetState 已在上面被清空，这里写不出复位值，loading 永久为 true
    expect(state.loading).toBe(false)

    gate.release('done')
    await Promise.all([first, second])
    expect(state.loading).toBe(false)
  })

  it('clear() 之后新写入的 error/errorData 也能被下一次 clear() 复位', async () => {
    const { state, setState } = createHarness()
    const loader = new ActionLoader()
    const ok = loader.wrap(async () => 'ok', 'ok', setState)
    const boom = loader.wrap(
      async () => {
        throw new Error('boom')
      },
      'boom',
      setState,
    )

    await ok()
    loader.clear()

    await expect(boom()).rejects.toThrow('boom')
    expect(state.error).toBeInstanceOf(Error)
    expect(state.errorData).toMatchObject({ message: 'boom' })

    loader.clear()
    expect(state.error).toBeNull()
    expect(state.errorData).toBeNull()
  })

  it('clear() 之后换键的 setOptions() 仍给旧键补写复位值', async () => {
    const { state, setState } = createHarness()
    const gate = createGate()
    const loader = new ActionLoader()
    const wrapped = loader.wrap(async () => await gate.promise, 'fetch', setState)

    const first = wrapped()
    loader.clear()
    const second = wrapped()
    expect(state.loading).toBe(true)

    loader.setOptions({ loadingKey: 'busy' })
    expect(state.loading).toBe(false)

    gate.release('done')
    await Promise.all([first, second])
  })
})
