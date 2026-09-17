import { withCache } from '@/extras/action/decorators/cache.js'
import { withDebounce } from '@/extras/action/decorators/debounce.js'
import { withThrottle } from '@/extras/action/decorators/throttle.js'

function decorate(host: object, key: string | symbol, decorator: MethodDecorator): void {
  const descriptor = Object.getOwnPropertyDescriptor(host, key)!
  Object.defineProperty(host, key, decorator(host, key, descriptor) ?? descriptor)
}

describe('decorator host and method identity', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  it.each([
    ['cache', () => withCache()],
    ['throttle', () => withThrottle(100)],
  ] as const)('%s retains state for static methods', (_name, factory) => {
    class Host {
      static calls = 0
      static run() {
        return ++this.calls
      }
    }
    decorate(Host, 'run', factory())
    expect(Host.run()).toBe(1)
    Host.run()
    expect(Host.calls).toBe(1)
  })

  it('debounces static methods using the final arguments', async () => {
    class Host {
      static calls = 0
      static run(value: string) {
        this.calls++
        return value
      }
    }
    decorate(Host, 'run', withDebounce(100))
    const first = Host.run('first')
    const second = Host.run('second')
    await jest.advanceTimersByTimeAsync(100)
    await expect(Promise.all([first, second])).resolves.toEqual(['second', 'second'])
    expect(Host.calls).toBe(1)
  })

  it.each([
    ['cache', () => withCache()],
    ['debounce', () => withDebounce(100)],
    ['throttle', () => withThrottle(100)],
  ] as const)('%s isolates distinct symbols and their string representation', async (_name, factory) => {
    const first = Symbol('run')
    const second = Symbol('run')
    const third = String(first)
    const host = {
      [first]: jest.fn(() => 'A'),
      [second]: jest.fn(() => 'B'),
      [third]: jest.fn(() => 'C'),
    }
    const originals = [host[first], host[second], host[third]]
    const decorator = factory()
    for (const key of [first, second, third]) decorate(host, key, decorator)
    const results = [host[first](), host[second](), host[third]()]
    await jest.advanceTimersByTimeAsync(100)
    await expect(Promise.all(results)).resolves.toEqual(['A', 'B', 'C'])
    for (const original of originals) expect(original).toHaveBeenCalledTimes(1)
  })
})
