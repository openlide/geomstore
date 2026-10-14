/**
 * Store 内部工具函数测试
 * 目标覆盖率: 99%+
 */

import { isProduction, createMutationErrorMessage, deepCloneState } from '@/core/store/utils.js'

// 重新导入以清除模块缓存
let _isProduction: typeof isProduction

describe('store/utils', () => {
  beforeEach(async () => {
    // 清除缓存 - 重新导入模块（isProduction 在模块内缓存判定结果）
    jest.resetModules()
    ;({ isProduction: _isProduction } = await import('@/core/store/utils.js'))
  })

  describe('isProduction', () => {
    const originalEnv = process.env.NODE_ENV

    afterEach(() => {
      process.env.NODE_ENV = originalEnv
    })

    it('应该在 NODE_ENV=production 时返回 true', () => {
      process.env.NODE_ENV = 'production'
      expect(_isProduction()).toBe(true)
    })

    it('应该在 NODE_ENV=development 时返回 false', () => {
      process.env.NODE_ENV = 'development'
      expect(_isProduction()).toBe(false)
    })

    it('应该在 NODE_ENV=test 时返回 false', () => {
      process.env.NODE_ENV = 'test'
      expect(_isProduction()).toBe(false)
    })

    it('应该在没有 process.env 时返回 false', () => {
      // 暂存原始 process 并移除
      const originalProcess = (global as any).process
      delete (global as any).process
      try {
        expect(_isProduction()).toBe(false)
      } finally {
        // 恢复原始 process（如果还存在）
        if (originalProcess !== undefined) {
          const g = global as any
          g.process = originalProcess
        }
      }
    })

    it('应该使用缓存返回之前的结果（缓存命中分支）', () => {
      process.env.NODE_ENV = 'production'
      // 第一次调用设置缓存
      expect(_isProduction()).toBe(true)
      // 修改环境变量，第二次调用应该返回缓存的 true
      process.env.NODE_ENV = 'development'
      expect(_isProduction()).toBe(true) // 缓存命中，仍返回 true
    })

    it('应该在 process.env.NODE_ENV 为 undefined 时回退到 __DEV__ 分支', () => {
      // 设置 __DEV__ = false 意味着生产环境
      const g = global as any
      g.__DEV__ = false
      try {
        // 删除 NODE_ENV 以触发 __DEV__ 分支
        const originalNodeEnv = process.env.NODE_ENV
        delete process.env.NODE_ENV
        try {
          // __DEV__ = false => isProduction = !false = true
          expect(_isProduction()).toBe(true)
        } finally {
          process.env.NODE_ENV = originalNodeEnv
        }
      } finally {
        delete (global as any).__DEV__
      }
    })

    it('应该在 __DEV__ = true 时返回 false', () => {
      const g = global as any
      g.__DEV__ = true
      try {
        const originalNodeEnv = process.env.NODE_ENV
        delete process.env.NODE_ENV
        try {
          expect(_isProduction()).toBe(false)
        } finally {
          process.env.NODE_ENV = originalNodeEnv
        }
      } finally {
        delete (global as any).__DEV__
      }
    })

    it('应该在 process.env 访问抛出异常时静默处理并回退', () => {
      // 模拟 process 存在但 env 访问抛出异常
      const originalProcess = (global as any).process
      const fakeProcess = {
        get env() {
          throw new Error('access denied')
        },
      }
      ;(global as any).process = fakeProcess
      try {
        // 不应该抛出，应返回 false（兜底）
        expect(_isProduction()).toBe(false)
      } finally {
        const g = global as any
        g.process = originalProcess
      }
    })

    it('NODE_ENV 必须优先于 __DEV__（打包器内联后的判定方向）', () => {
      // 小程序/web 产物里 __DEV__ 常被判为 true，而 process.env.NODE_ENV 会被打包器
      // 内联成 "production" 字面量：内联结果必须赢，否则生产被识别成开发模式
      const g = global as any
      g.__DEV__ = true
      process.env.NODE_ENV = 'production'
      try {
        expect(_isProduction()).toBe(true)
      } finally {
        delete (global as any).__DEV__
      }
    })

    it('不得用 typeof process 门控 NODE_ENV（门控会短路内联结果）', () => {
      // 打包器只内联 process.env.NODE_ENV 这个成员表达式，不会内联 process 全局本身：
      // 一旦写成 `typeof process !== 'undefined' && ...`，浏览器产物里 && 左侧恒为 false，
      // 已内联好的 "production" 被丢弃 → 生产构建退回开发兜底 → 直写状态由 warn 变抛错。
      // 运行期在 Node 下两种写法等价，故只能锁定编译后的函数体不含该门控
      expect(isProduction.toString()).not.toContain('typeof process')
      expect(isProduction.toString()).toContain('process.env.NODE_ENV')
    })

    // ---- 第 3 档判据：小程序宿主宣告的运行环境 ----
    // 共同前提：清掉 NODE_ENV 与 __DEV__。原生小程序既无 process 全局、官方构建也不替换
    // __DEV__，这正是新增该档要修的场景；不先把前两档让位就测不到它

    /** 让 process.env.NODE_ENV 缺失地执行一段断言 */
    const withoutNodeEnv = (run: () => void): void => {
      const originalNodeEnv = process.env.NODE_ENV
      delete process.env.NODE_ENV
      try {
        run()
      } finally {
        process.env.NODE_ENV = originalNodeEnv
      }
    }

    /** 在 globalThis.wx 上挂一个返回指定 envVersion 的 getAccountInfoSync，返回清理函数 */
    const withWxAccountInfo = (make: (() => unknown) | Record<string, unknown> | undefined): (() => void) => {
      const g = global as any
      const hadWx = g.wx !== undefined
      if (!hadWx) {
        g.wx = {}
      }
      const original = g.wx.getAccountInfoSync
      if (make === undefined) {
        delete g.wx.getAccountInfoSync
      } else {
        g.wx.getAccountInfoSync = typeof make === 'function' ? make : () => make
      }
      return () => {
        if (original === undefined) {
          delete g.wx.getAccountInfoSync
        } else {
          g.wx.getAccountInfoSync = original
        }
        if (!hadWx) {
          delete g.wx
        }
      }
    }

    it('应该在 wx envVersion=release 时返回 true（原生小程序正式版自动判为生产）', () => {
      const restore = withWxAccountInfo({ miniProgram: { envVersion: 'release' } })
      try {
        withoutNodeEnv(() => {
          expect(_isProduction()).toBe(true)
        })
      } finally {
        restore()
      }
    })

    it('应该在 wx envVersion=trial 时返回 true（体验版跑的是待发布产物，同样不该崩）', () => {
      const restore = withWxAccountInfo({ miniProgram: { envVersion: 'trial' } })
      try {
        withoutNodeEnv(() => {
          expect(_isProduction()).toBe(true)
        })
      } finally {
        restore()
      }
    })

    it('应该在 wx envVersion=develop 时返回 false（IDE 预览与真机调试保留严格保护）', () => {
      const restore = withWxAccountInfo({ miniProgram: { envVersion: 'develop' } })
      try {
        withoutNodeEnv(() => {
          expect(_isProduction()).toBe(false)
        })
      } finally {
        restore()
      }
    })

    it('应该在 wx 没有 getAccountInfoSync 时回退兜底 false（低版本基础库 / 非微信宿主）', () => {
      const restore = withWxAccountInfo(undefined)
      try {
        withoutNodeEnv(() => {
          expect(_isProduction()).toBe(false)
        })
      } finally {
        restore()
      }
    })

    it('应该在 getAccountInfoSync 抛错时静默降级为「无信号」', () => {
      const restore = withWxAccountInfo(() => {
        throw new Error('getAccountInfoSync:fail')
      })
      try {
        withoutNodeEnv(() => {
          expect(_isProduction()).toBe(false)
        })
      } finally {
        restore()
      }
    })

    it('应该在 envVersion 取到未知值时按无信号处理（不臆判为生产或开发）', () => {
      const restore = withWxAccountInfo({ miniProgram: { envVersion: 'preview-v2' } })
      try {
        withoutNodeEnv(() => {
          expect(_isProduction()).toBe(false)
        })
      } finally {
        restore()
      }
    })

    it('应该在 getAccountInfoSync 返回空对象时不炸并回退兜底', () => {
      const restore = withWxAccountInfo({})
      try {
        withoutNodeEnv(() => {
          expect(_isProduction()).toBe(false)
        })
      } finally {
        restore()
      }
    })

    it('NODE_ENV 与 __DEV__ 都优先于 wx 信号（显式配置不被宿主信号覆盖）', () => {
      const restore = withWxAccountInfo({ miniProgram: { envVersion: 'release' } })
      const g = global as any
      try {
        // NODE_ENV=development（构建期常量）赢过宿主的 release
        withoutNodeEnv(() => {
          process.env.NODE_ENV = 'development'
          expect(_isProduction()).toBe(false)
        })
        // __DEV__=true（显式运行时开关）同样赢过宿主的 release
        g.__DEV__ = true
        try {
          withoutNodeEnv(() => {
            expect(_isProduction()).toBe(false)
          })
        } finally {
          delete g.__DEV__
        }
      } finally {
        restore()
      }
    })
  })

  describe('createMutationErrorMessage', () => {
    it('应该创建正确的错误消息', () => {
      const message = createMutationErrorMessage('count', 42, 'set')

      expect(message).toContain('Direct mutation of state')
      expect(message).toContain('count')
      expect(message).toContain('set')
      expect(message).toContain('42')
    })

    it('应该处理复杂值', () => {
      const message = createMutationErrorMessage('nested', { a: 1, b: 2 }, 'defineProperty')

      expect(message).toContain('nested')
      expect(message).toContain('defineProperty')
      expect(message).toContain('{"a":1,"b":2}')
    })

    it('应该处理 undefined 值', () => {
      const message = createMutationErrorMessage('prop', undefined, 'delete')

      expect(message).toContain('prop')
      expect(message).toContain('delete')
      expect(message).toContain('Attempted value: undefined')
    })

    it('JSON.stringify 返回 undefined 的类型要回退到 String()，与真 undefined 区分开', () => {
      // JSON.stringify(fn / Symbol / undefined) 不抛错而返回 undefined，
      // 不回退的话三者都渲染成 "Attempted value: undefined"，排查时分不清写入了什么
      const fn = function attemptedSetter() {
        return 1
      }
      expect(createMutationErrorMessage('cb', fn, 'set')).toContain('Attempted value: function attemptedSetter')
      expect(createMutationErrorMessage('cb', Symbol('mySymbol'), 'set')).toContain('Attempted value: Symbol(mySymbol)')
      expect(createMutationErrorMessage('cb', undefined, 'set')).toContain('Attempted value: undefined')
    })
  })

  describe('deepCloneState', () => {
    it('应该深拷贝对象', () => {
      const original = { count: 1, nested: { value: 2 } }
      const cloned = deepCloneState(original)

      expect(cloned).toEqual(original)
      expect(cloned).not.toBe(original)
      expect(cloned.nested).not.toBe(original.nested)
    })

    it('应该处理数组', () => {
      const original = { items: [1, 2, 3] }
      const cloned = deepCloneState(original)

      expect(cloned.items).toEqual([1, 2, 3])
      expect(cloned.items).not.toBe(original.items)
    })

    it('应该处理 null', () => {
      const cloned = deepCloneState(null)
      expect(cloned).toBe(null)
    })

    it('应该处理基本类型', () => {
      expect(deepCloneState('string')).toBe('string')
      expect(deepCloneState(123)).toBe(123)
      expect(deepCloneState(true)).toBe(true)
    })

    it('当 structuredClone 不可用时应回退到 JSON 深拷贝', () => {
      // 保存原始 structuredClone
      const originalStructuredClone = (global as any).structuredClone
      // 删除 structuredClone 使其不可用
      delete (global as any).structuredClone
      try {
        const original = { count: 1, nested: { value: 2 } }
        const cloned = deepCloneState(original)

        expect(cloned).toEqual(original)
        expect(cloned).not.toBe(original)
        expect(cloned.nested).not.toBe(original.nested)
      } finally {
        // 恢复原始 structuredClone
        if (originalStructuredClone !== undefined) {
          const g = global as any
          g.structuredClone = originalStructuredClone
        }
      }
    })

    it('含函数字段时不应该抛错（structuredClone 的 DataCloneError 降级）', () => {
      const original: any = { fn: () => 42, data: { x: 1 } }

      expect(() => deepCloneState(original)).not.toThrow()

      const cloned = deepCloneState(original)
      expect(cloned.fn).toBe(original.fn)
      expect(cloned.data).toEqual({ x: 1 })
      expect(cloned.data).not.toBe(original.data)
    })

    it('应该保留 undefined 字段（行为不依赖 structuredClone）', () => {
      const original: any = { maybe: undefined, count: 1 }

      const cloned = deepCloneState(original)

      expect('maybe' in cloned).toBe(true)
      expect(cloned.maybe).toBeUndefined()
    })

    it('应该克隆 RegExp/Map/Set', () => {
      const original: any = {
        regex: /abc/gi,
        map: new Map([['a', 1]]),
        set: new Set([1, 2]),
      }

      const cloned = deepCloneState(original)

      expect(cloned.regex).toEqual(/abc/gi)
      expect(cloned.regex).not.toBe(original.regex)
      expect(cloned.map).not.toBe(original.map)
      expect(cloned.map.get('a')).toBe(1)
      expect(cloned.set).not.toBe(original.set)
      expect(cloned.set.has(1)).toBe(true)
    })

    it('不可克隆对象（class 实例）应保留原引用不抛错', () => {
      class Config {
        mode = 'dark'
      }
      const instance = new Config()
      const original: any = { config: instance }

      expect(() => deepCloneState(original)).not.toThrow()
      expect(deepCloneState(original).config).toBe(instance)
    })
  })
})
