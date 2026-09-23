/**
 * 第六轮 R6-080 / R6-081 回归锁：StoreRegistry 的日志门控与全局实例作用域
 *
 * - R6-080：幂等重注册（合法操作）此前无条件 `console.log`，生产小程序控制台每次重注册
 *   都被刷一条；覆盖告警两条同理。收口口径与同目录 composeStore/helpers 一致：
 *   配置/歧义级别只在非生产输出，销毁失败一类的 `console.error` 保持无条件。
 * - R6-081：`globalRegistry` 此前是裸的模块级实例，「全局」只在单副本部署下成立。
 *   分包各自打包 / 宿主库把本库一起打进去时每个副本各持一册，A 副本 register 的 store
 *   在 B 副本 get 不到且两侧都「成功」。改为挂 `globalThis` 的 `Symbol.for` 槽位。
 *
 * 本文件的 `globalThis` 污染说明：最后一个用例会以 `writable:false, configurable:false`
 * 占住注册表槽位（该操作不可还原），因此它必须留在文件末尾，且只影响本文件的沙箱；
 * 其余用例都在它之前运行。
 */

import { StoreRegistry, globalRegistry } from '@/core/compose/StoreRegistry.js'
import type { Store } from '@/types/store.js'

type RegistryModule = {
  StoreRegistry: typeof StoreRegistry
  globalRegistry: StoreRegistry
  isProductionFlag?: boolean
}

const SLOT = Symbol.for('@openlide/geomstore:store-registry')
const holder = globalThis as unknown as Record<symbol, unknown>

function makeStore(label: string): Store {
  return {
    name: label,
    getState: jest.fn(() => ({ v: label })),
    destroy: jest.fn(),
  } as unknown as Store
}

/** 以指定 NODE_ENV 全新加载一份 StoreRegistry（isProduction() 在模块实例内永久缓存） */
async function loadRegistryModule(nodeEnv: string): Promise<RegistryModule> {
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = nodeEnv
  try {
    jest.resetModules()
    const mod = { ...((await import('@/core/compose/StoreRegistry.js')) as RegistryModule) }
    // 先在新模块实例里压一次判定，让它的缓存落定，再还原环境变量
    const utils = (await import('@/core/store/utils.js')) as { isProduction: () => boolean }
    mod.isProductionFlag = utils.isProduction()
    return mod
  } finally {
    process.env.NODE_ENV = previous
  }
}

describe('R6-080 注册表日志的 isProduction 门控', () => {
  let debugSpy: jest.SpyInstance
  let logSpy: jest.SpyInstance
  let warnSpy: jest.SpyInstance
  let errorSpy: jest.SpyInstance

  beforeEach(() => {
    debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {})
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    debugSpy.mockRestore()
    logSpy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('开发构建：幂等重注册降级为 debug，不再占用 console.log', async () => {
    const mod = await loadRegistryModule('development')
    const registry = new mod.StoreRegistry()
    const store = makeStore('dev-idempotent')

    registry.register('a', store)
    registry.register('a', store)

    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('already registered with the same instance'))
    expect(logSpy).not.toHaveBeenCalled()
    expect(registry.get('a')).toBe(store)
    expect(store.destroy).not.toHaveBeenCalled()
  })

  it('开发构建：覆盖注册留一条 warn，销毁与替换照常', async () => {
    const mod = await loadRegistryModule('development')
    const registry = new mod.StoreRegistry()
    const oldStore = makeStore('dev-old')
    const newStore = makeStore('dev-new')

    registry.register('a', oldStore)
    registry.register('a', newStore)

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('already registered'))
    expect(oldStore.destroy).toHaveBeenCalledTimes(1)
    expect(registry.get('a')).toBe(newStore)
  })

  it('生产构建：幂等重注册与覆盖注册都不再打日志，注册结果照常生效', async () => {
    const mod = await loadRegistryModule('production')
    expect(mod.isProductionFlag).toBe(true)
    const registry = new mod.StoreRegistry()
    const first = makeStore('prod-first')
    const second = makeStore('prod-second')

    registry.register('a', first)
    registry.register('a', first)
    registry.register('a', second)

    expect(debugSpy).not.toHaveBeenCalled()
    expect(logSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
    expect(first.destroy).toHaveBeenCalledTimes(1)
    expect(registry.get('a')).toBe(second)
  })

  it('生产构建：实例销毁抛错仍无条件上报', async () => {
    const mod = await loadRegistryModule('production')
    const registry = new mod.StoreRegistry()
    const broken = {
      name: 'broken',
      getState: jest.fn(() => ({})),
      destroy: jest.fn(() => {
        throw new Error('destroy boom')
      }),
    } as unknown as Store

    registry.register('a', broken)
    registry.register('a', makeStore('prod-replacement'))

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Error destroying store'), expect.any(Error))
  })
})

describe('R6-081 globalRegistry 的作用域是进程内而非模块内', () => {
  afterEach(() => {
    globalRegistry.clear()
  })

  it('两个模块副本取到的是同一个注册表实例（跨副本 instanceof 恒 false 也不影响）', () => {
    const copyA = jest.requireActual('@/core/compose/StoreRegistry.js') as RegistryModule
    jest.resetModules()
    const copyB = jest.requireActual('@/core/compose/StoreRegistry.js') as RegistryModule

    // 前提自检：两份副本的类对象不同一，故「复用前先 instanceof」的写法会把副本 A
    // 已建好的实例当成非注册表而覆盖掉——那正是本条要修的静默丢引用
    expect(copyA.StoreRegistry).not.toBe(copyB.StoreRegistry)
    expect(copyA.globalRegistry instanceof copyB.StoreRegistry).toBe(false)

    expect(copyA.globalRegistry).toBe(copyB.globalRegistry)
    expect(copyA.globalRegistry).toBe(globalRegistry)

    const store = makeStore('cross-copy')
    copyA.globalRegistry.register('shared', store)
    expect(copyB.globalRegistry.get('shared')).toBe(store)

    copyB.globalRegistry.setDefault('shared')
    expect(copyA.globalRegistry.getDefault()).toBe(store)
  })

  it('实例挂在 globalThis 的 Symbol.for 槽位上且不可枚举', () => {
    expect(holder[SLOT]).toBe(globalRegistry)
    expect(Object.keys(globalThis)).not.toContain(SLOT.toString())
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, SLOT)
    expect(descriptor?.enumerable).toBe(false)
    expect(descriptor?.configurable).toBe(true)
  })

  it('槽位被形状不符的值占用时不复用、不抛错', async () => {
    const original = holder[SLOT]
    holder[SLOT] = { register: 'not-a-function' }
    let mod: RegistryModule | undefined
    try {
      mod = await loadRegistryModule('development')
    } finally {
      holder[SLOT] = original
    }

    expect(mod).toBeDefined()
    expect(typeof mod!.globalRegistry.register).toBe('function')
    expect(mod!.globalRegistry).not.toBe(original)
    expect(holder[SLOT]).toBe(original)
  })
})

// 必须留在文件末尾：该用例会把注册表槽位写成不可写、不可配置，之后无法还原
describe('R6-081 降级支路：globalThis 槽位不可写', () => {
  it('写入失败时退回本副本私有的实例并出声', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    Object.defineProperty(globalThis, SLOT, {
      value: { register: 'not-a-function' },
      writable: false,
      enumerable: false,
      configurable: false,
    })

    let mod: RegistryModule | undefined
    let warnCalls: unknown[][] = []
    try {
      mod = await loadRegistryModule('development')
    } finally {
      // mockRestore 会连带清空调用记录，故先取快照再还原
      warnCalls = warnSpy.mock.calls.map((call) => [...call])
      warnSpy.mockRestore()
    }

    const instance = mod!.globalRegistry
    expect(typeof instance.register).toBe('function')
    expect(instance).not.toBe(globalRegistry)
    expect(warnCalls.some((call) => typeof call[0] === 'string' && call[0].includes('本模块副本各自持有一份注册表') && call[1] instanceof Error)).toBe(true)

    // 降级实例本身可用：注册/读取都正常，只是不再与其他副本共享
    const store = makeStore('degraded')
    instance.register('degraded', store)
    expect(instance.get('degraded')).toBe(store)
  })
})
