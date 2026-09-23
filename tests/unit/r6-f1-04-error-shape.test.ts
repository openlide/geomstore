/**
 * 第六轮 R6-036 / R6-082 / R6-083 回归锁：错误体系的副本无关守卫与序列化保护
 *
 * - R6-036：七个类型守卫此前只用 `instanceof`，在库自己认定为真实部署形态的「同一包多副本」
 *   下系统性漏判（本文件用 `jest.resetModules()` 造出两个真实副本，两侧类对象不同一）。
 * - R6-082：`toSerializableValue` 的 toJSON 早退分支旁路了深度上限与祖先环路检测，
 *   「每次 toJSON() 都构造新身份」的图节点会让 `JSON.stringify(error)` 无限递归到 RangeError；
 *   且 `toJSON` 的属性读取在 try 之外，取值即抛的访问器会直接掀掉打印通道。
 * - R6-083：`cause` 的形状化对 GeomStoreError 只取 name/message，丢掉上报侧唯一的
 *   分类依据 `code`、`context` 与内层 cause 链。
 */

import {
  ActionError,
  GeomStoreError,
  StateError,
  ErrorCode,
  createError,
  isActionError,
  isComposeError,
  isGeomStoreError,
  isPluginError,
  isSelectorError,
  isStateError,
  isValidationError,
} from '@/core/errors/GeomStoreError.js'

type ErrorModule = {
  GeomStoreError: typeof GeomStoreError
  ActionError: typeof ActionError
  isGeomStoreError: typeof isGeomStoreError
  isActionError: typeof isActionError
  isStateError: typeof isStateError
}

/** 取一份全新的模块副本（Symbol.for 的品牌键跨副本共享，类对象则各一份） */
function loadFreshCopy(): ErrorModule {
  jest.resetModules()
  return jest.requireActual('@/core/errors/GeomStoreError.js') as unknown as ErrorModule
}

describe('R6-036 类型守卫在同一包多副本下的判定', () => {
  it('前置自检：两次加载的确实是不同的类对象（否则本文件的判定无从谈起）', () => {
    const copyA = loadFreshCopy()
    const copyB = loadFreshCopy()

    expect(copyA.ActionError).not.toBe(copyB.ActionError)
    const local = new copyA.ActionError('boom', ErrorCode.ACTION_EXECUTION_ERROR)
    expect(local instanceof copyB.ActionError).toBe(false)
  })

  it('副本 A 抛出的 ActionError 在副本 B 里仍被判为 GeomStoreError / ActionError', () => {
    const copyA = loadFreshCopy()
    const copyB = loadFreshCopy()
    const crossCopy = new copyA.ActionError('cross copy', ErrorCode.ACTION_EXECUTION_ERROR, { actionName: 'fetch' })

    expect(copyB.isGeomStoreError(crossCopy)).toBe(true)
    expect(copyB.isActionError(crossCopy)).toBe(true)
    expect(copyB.isStateError(crossCopy)).toBe(false)
    expect(copyB.isGeomStoreError(crossCopy)).toBe(isGeomStoreError(crossCopy))
    expect(copyB.isActionError(crossCopy)).toBe(isActionError(crossCopy))
    // 跨副本实例的 code / context 仍是上报侧的分类依据，守卫为真后调用方可直接读
    if (copyB.isGeomStoreError(crossCopy)) {
      expect(crossCopy.code).toBe(ErrorCode.ACTION_EXECUTION_ERROR)
      expect(crossCopy.context).toEqual({ actionName: 'fetch' })
    }
  })

  it('本副本实例：七个守卫按 name 分流，不误判为其他派生类', () => {
    const action = new ActionError('a', ErrorCode.ACTION_NOT_FOUND)
    const state = new StateError('s', ErrorCode.STATE_UPDATE_ERROR)
    const composed = createError(ErrorCode.STORE_COMPOSE_ERROR, 'c')
    const validated = createError(ErrorCode.PARAMETER_ERROR, 'p')
    const plugin = createError(ErrorCode.PLUGIN_INSTALLATION_ERROR, 'pl')
    const selector = createError(ErrorCode.SELECTOR_NOT_FOUND, 'sel')
    const base = new GeomStoreError('b', ErrorCode.UNKNOWN_ERROR)

    expect([isActionError(action), isStateError(state), isComposeError(composed), isValidationError(validated)]).toEqual([true, true, true, true])
    expect([isSelectorError(selector), isPluginError(plugin), isGeomStoreError(base)]).toEqual([true, true, true])
    expect(isStateError(action)).toBe(false)
    expect(isActionError(state)).toBe(false)
    expect(isActionError(base)).toBe(false)
    expect(isGeomStoreError(action)).toBe(true)
  })

  it('伪冒值不被放行：缺品牌键、或品牌键不在 Error 实例上、或 code 不是字符串', () => {
    const brand = Symbol.for('@openlide/geomstore:error-brand')
    const forgedPlain = { name: 'ActionError', code: 'ACTION_EXECUTION_ERROR', [brand]: true }
    const forgedNonError = Object.assign(Object.create(null), { name: 'ActionError', code: 'X', [brand]: true })
    const brandWithoutCode = Object.assign(Object.defineProperty(new Error('x'), brand, { value: true }), { code: 42 })

    expect(isGeomStoreError(forgedPlain)).toBe(false)
    expect(isActionError(forgedPlain)).toBe(false)
    expect(isGeomStoreError(forgedNonError)).toBe(false)
    expect(isGeomStoreError(brandWithoutCode)).toBe(false)
    expect(isGeomStoreError(undefined)).toBe(false)
    expect(isGeomStoreError('boom')).toBe(false)
    expect(isGeomStoreError(new Error('native'))).toBe(false)
  })

  it('品牌键非可枚举：不改变实例枚举面与 toJSON() 的输出形状', () => {
    const error = new GeomStoreError('boom', 'CODE', { k: 1 })
    const brand = Symbol.for('@openlide/geomstore:error-brand')

    expect(Object.keys(error).sort()).toEqual(['code', 'context', 'name'])
    expect(Object.getOwnPropertyNames(error)).toEqual(expect.arrayContaining(['name', 'message', 'code', 'context']))
    expect(Object.getOwnPropertySymbols(error)).toContain(brand)
    expect(JSON.parse(JSON.stringify(error))).toEqual({
      name: 'GeomStoreError',
      message: 'boom',
      code: 'CODE',
      context: { k: 1 },
      stack: expect.any(String),
    })
  })
})

describe('R6-082 context 序列化的深度与环路守卫不被 toJSON 分支旁路', () => {
  it('每次 toJSON() 都构造新身份的图节点：以 [Truncated] 收尾而不是 RangeError', () => {
    const node: { toJSON(): unknown } = {
      toJSON() {
        // 树/图节点里 `{ parent: this }` 的常见写法：parent 是新建对象，
        // JSON.stringify 自己的环路检测认不出引用，只能无限递归
        return { id: 'node', parent: { toJSON: () => node.toJSON() } }
      },
    }
    const error = new GeomStoreError('persist failed', ErrorCode.STATE_UPDATE_ERROR, { graph: node })

    let serialized = ''
    expect(() => {
      serialized = JSON.stringify(error)
    }).not.toThrow()
    expect(serialized).toContain('[Truncated]')

    // 递归被 MAX_CONTEXT_DEPTH 夹住：沿 parent 走到底必须是字符串标记，
    // 层数远小于「不加保护时的无限递归」
    const context = error.toJSON().context as { graph: Record<string, unknown> }
    let cursor: unknown = context.graph
    let levels = 0
    while (cursor !== null && typeof cursor === 'object') {
      levels += 1
      cursor = (cursor as Record<string, unknown>).parent
    }
    expect(levels).toBeLessThanOrEqual(6)
    expect(cursor).toBe('[Truncated]')
  })

  it('toJSON 是取值即抛的访问器：换成 [Unreadable] 而不是让 toJSON() 抛出', () => {
    const hostile = {
      get toJSON(): unknown {
        throw new Error('accessor boom')
      },
    }
    const error = new GeomStoreError('boom', ErrorCode.UNKNOWN_ERROR, { hostile })

    expect(() => error.toJSON()).not.toThrow()
    expect(error.toJSON().context).toEqual({ hostile: '[Unreadable]' })
  })

  it('Date 一类「序列化器给出原始值」的对象仍按其自身序列化器处理', () => {
    const error = new GeomStoreError('boom', ErrorCode.UNKNOWN_ERROR, { when: new Date(0) })
    const json = error.toJSON()

    expect((json.context as { when: unknown }).when).toBeInstanceOf(Date)
    expect(JSON.parse(JSON.stringify(error)).context.when).toBe('1970-01-01T00:00:00.000Z')
  })

  it('序列化器给出的对象结果继续走同一套归一（内层 BigInt 不再让 stringify 抛错、自引用按环路收尾）', () => {
    const wrapper: { toJSON(): Record<string, unknown> } = {
      toJSON() {
        return { total: 1234n, self: wrapper }
      },
    }
    const error = new GeomStoreError('boom', ErrorCode.UNKNOWN_ERROR, { wrapper })

    const serialized = JSON.parse(JSON.stringify(error)) as { context: { wrapper: Record<string, unknown> } }
    expect(serialized.context.wrapper.total).toBe('1234n')
    expect(serialized.context.wrapper.self).toBe('[Circular]')
  })
})

describe('R6-083 cause 的日志形状不再丢 code 与嵌套链', () => {
  it('cause 是本库错误时取其 toJSON()，code / context / 内层 cause 链全部保留', () => {
    const root = createError(ErrorCode.STATE_KEY_NOT_FOUND, 'key missing')
    const mid = createError(ErrorCode.PLUGIN_INSTALLATION_ERROR, 'plugin failed', { plugin: 'persist' }, root)
    const outer = new StateError('Persist state failed', ErrorCode.STATE_UPDATE_ERROR, { file: 'x.json' }, mid)

    const json = outer.toJSON()
    expect(json.cause).toMatchObject({
      name: 'PluginError',
      message: 'plugin failed',
      code: ErrorCode.PLUGIN_INSTALLATION_ERROR,
      context: { plugin: 'persist' },
    })
    // 两层以上包装看得到根因：此前 cause 只留 name/message，code 蒸发
    expect((json.cause as { cause?: Record<string, unknown> }).cause).toMatchObject({ code: ErrorCode.STATE_KEY_NOT_FOUND })
    expect(JSON.stringify(outer)).toContain(ErrorCode.STATE_KEY_NOT_FOUND)
  })

  it('cause 是原生 Error 时保持既有的 name/message 形状', () => {
    const original = new TypeError('JSON 解析失败')
    const error = new StateError('Persist state failed', ErrorCode.STATE_UPDATE_ERROR, { key: 'user' }, original)

    expect(error.toJSON().cause).toEqual({ name: 'TypeError', message: 'JSON 解析失败' })
  })

  it('cause 的序列化器抛错时退回 name/message，不让打印通道二次抛错', () => {
    const hostile = new Error('hostile')
    ;(hostile as unknown as { toJSON: () => unknown }).toJSON = () => {
      throw new Error('serializer boom')
    }
    const error = new GeomStoreError('outer', ErrorCode.UNKNOWN_ERROR, undefined, 'GeomStoreError', hostile)

    expect(() => error.toJSON()).not.toThrow()
    expect(error.toJSON().cause).toEqual({ name: 'Error', message: 'hostile' })
  })
})
