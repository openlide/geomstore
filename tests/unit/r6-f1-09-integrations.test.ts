/**
 * 第六轮 f1-09 回归锁（接入层与插件侧）
 *
 * - R6-106：withAppStore 的 globalData 覆盖告警要覆盖到 `injectMapping` 的目标键
 * - R6-060：withComponentStore 的 mapActions 遮蔽组件自身同名方法时告警，detached 恢复原值
 * - R6-107：persistencePlugin 显式收到 null 不再抛裸 TypeError
 * - R6-108：timeTravel 的 goTo 把 NaN / 小数索引送进同一条 out-of-bounds 错误路径
 */

import { createStore } from '@/core/store/index.js'
import { withAppStore } from '@/integrations/with-app-store.js'
import { withComponentStore } from '@/integrations/with-store.js'
import { persistencePlugin } from '@/plugins/builtin.js'
import { timeTravelPlugin } from '@/plugins/devtools/index.js'
import type { Plugin } from '@/types/plugin.js'
import type { PersistenceOptions } from '@/types/persistence.js'
import type { Store, State } from '@/types/store.js'

/** 与 withAppStore / withComponentStore 注入后的实例形状对齐的最小声明 */
interface FakeAppInstance {
  globalData: Record<string, unknown>
  onLaunch?: (this: FakeAppInstance, ...args: unknown[]) => void
}

interface FakeComponentInstance {
  data: Record<string, unknown>
  setData: (patch: Record<string, unknown>) => void
  methods: Record<string, unknown>
  __geomUnbinds?: Array<() => void>
}

interface EnhancedComponentConfig {
  data: Record<string, unknown>
  methods: Record<string, unknown>
  lifetimes: {
    attached?: (this: FakeComponentInstance) => void
    detached?: (this: FakeComponentInstance) => void
  }
}

interface TimeTravelApi {
  goTo: (index: number) => void
  getSnapshotCount: () => number
  getCurrentIndex: () => number
}

/** 按微信框架的口径造一个组件实例：methods 取自增强后的配置（框架按配置生成实例方法） */
function mountComponent(config: EnhancedComponentConfig): FakeComponentInstance {
  return {
    data: { ...config.data },
    setData: () => {},
    methods: { ...config.methods },
  }
}

describe('第六轮 f1-09 接入层与插件侧回归', () => {
  let warnSpy: jest.SpyInstance
  let logSpy: jest.SpyInstance

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
    logSpy.mockRestore()
  })

  describe('R6-106：globalData 覆盖告警的覆盖面', () => {
    const makeAppStore = () => createStore({ name: 'app-collide', state: { theme: 'light', config: { v: 1 } } })

    it('autoInject + injectMapping 的目标键与宿主 globalData 同名 → 告警点名该键', () => {
      const store = makeAppStore()
      const enhanced = withAppStore(store, { autoInject: true, injectMapping: { config: 'theme' } })({
        globalData: { theme: 'dark' },
      })
      const app = enhanced as unknown as FakeAppInstance
      app.onLaunch?.call(app)

      // injectMapping 是「源键 → 目标键」，落进 globalData 的是值 theme：
      // 修复前只查 state/getters 的本地键，这条覆盖一次告警都没有
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"theme"'))
    })

    it('未开 autoInject 时注入不会发生，不因注入条目误报覆盖', () => {
      const store = makeAppStore()
      const enhanced = withAppStore(store, { injectMapping: { config: 'theme' } })({ globalData: { theme: 'dark' } })
      const app = enhanced as unknown as FakeAppInstance
      app.onLaunch?.call(app)

      expect(warnSpy).not.toHaveBeenCalled()
    })

    it('state 映射键的原有告警口径不回退', () => {
      const store = makeAppStore()
      const enhanced = withAppStore(store, { mapState: ['theme'] })({ globalData: { theme: 'dark' } })
      const app = enhanced as unknown as FakeAppInstance
      app.onLaunch?.call(app)

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"theme"'))
    })
  })

  describe('R6-060：mapActions 遮蔽组件自身同名方法', () => {
    const makeCounter = () =>
      createStore({
        name: 'c-shadow',
        state: { count: 0 },
        actions: {
          increment() {
            this.state.count += 1
          },
        },
      })

    it('同名时一条告警点名冲突方法，detached 把用户方法放回实例', () => {
      const store = makeCounter()
      const userMethod = jest.fn()
      const enhanced = withComponentStore(store, { mapActions: ['increment'] })({
        methods: {
          increment: userMethod,
          handleTap() {},
        },
      }) as unknown as EnhancedComponentConfig

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"increment"'))

      const instance = mountComponent(enhanced)
      enhanced.lifetimes.attached?.call(instance)
      ;(instance.methods.increment as () => void)()
      // 绑定期间 action 优先（与 Page/App 侧 bindActions 一致）
      expect(userMethod).not.toHaveBeenCalled()
      expect(store.state.count).toBe(1)

      enhanced.lifetimes.detached?.call(instance)
      expect(instance.methods.increment).toBe(userMethod)
      expect(typeof instance.methods.handleTap).toBe('function')
    })

    it('无同名冲突时解绑仍只移除绑定的 action', () => {
      const store = makeCounter()
      const other = jest.fn()
      const enhanced = withComponentStore(store, { mapActions: ['increment'] })({
        methods: { other },
      }) as unknown as EnhancedComponentConfig

      expect(warnSpy).not.toHaveBeenCalled()

      const instance = mountComponent(enhanced)
      enhanced.lifetimes.attached?.call(instance)
      expect(typeof instance.methods.increment).toBe('function')

      enhanced.lifetimes.detached?.call(instance)
      expect(instance.methods).not.toHaveProperty('increment')
      expect(instance.methods.other).toBe(other)
    })
  })

  describe('R6-107：installPersistence 对 null options 的口径', () => {
    /**
     * 公开签名刻意不接受 null（`PersistenceOptions` 是可选项），这里按「未标注类型的 JS
     * 调用方直接传 null」的形状窄化一次函数类型，用于复现那条运行期路径
     */
    const installWithNull = <S extends State>(store: Store<S>) => {
      const install = persistencePlugin.install as unknown as (s: Store<S>, options?: PersistenceOptions<S> | null) => () => void
      return install(store, null)
    }

    it('persistencePlugin.install(store, null) 按默认选项安装，不抛裸 TypeError', () => {
      const store = createStore({ name: 'p-null', state: { a: 1 } })

      const uninstall = installWithNull(store)
      expect(typeof uninstall).toBe('function')
      uninstall()
    })

    it('persistencePlugin(null) 工厂路径同样按默认选项安装', () => {
      const store = createStore({ name: 'p-null-factory', state: { a: 1 } })
      const factory = persistencePlugin as unknown as (options?: PersistenceOptions | null) => Plugin

      expect(() => store.use(factory(null))).not.toThrow()
    })
  })

  describe('R6-108：timeTravel goTo 的索引准入', () => {
    const makeTravelStore = (): [Store<State & { count: number }>, TimeTravelApi] => {
      const store = createStore({
        name: 'tt-goTo',
        state: { count: 0 },
        actions: {
          increment() {
            this.state.count += 1
          },
        },
      })
      store.use(timeTravelPlugin())
      const api = (store as unknown as { __timeTravel__: TimeTravelApi }).__timeTravel__
      store.dispatch('increment')
      store.dispatch('increment')
      return [store, api]
    }

    it('NaN 与小数索引报 out-of-bounds，而不是 snapshot.state 的裸 TypeError', () => {
      const [, api] = makeTravelStore()
      expect(api.getSnapshotCount()).toBeGreaterThanOrEqual(3)

      expect(() => api.goTo(Number('abc'))).toThrow(/out of bounds/)
      // 1.5 数值上落在 [0, length) 内，修复前放行后 snapshots[1.5] 得 undefined
      expect(() => api.goTo(1.5)).toThrow(/out of bounds/)
    })

    it('非法索引不推进当前指针，合法索引照常跳转', () => {
      const [store, api] = makeTravelStore()
      const before = api.getCurrentIndex()

      expect(() => api.goTo(Number.NaN)).toThrow(/out of bounds/)
      expect(api.getCurrentIndex()).toBe(before)
      expect(store.state.count).toBe(2)

      api.goTo(0)
      expect(api.getCurrentIndex()).toBe(0)
      expect(store.state.count).toBe(0)
    })
  })
})
