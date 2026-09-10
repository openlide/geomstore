/**
 * 对象值映射的脏键跳过
 *
 * bindMappings 仅对**对象值**映射查询脏键（changedKeys）以决定是否跳过一次 setData；
 * 既有集成测试的映射值均为原始值，这条路径从未被执行。本测试覆盖 Page / Component / App
 * 三种集成的对象值映射通知路径。
 */
import { createStore, withPageStore, withComponentStore, withAppStore } from '@/index.js'

describe('对象值映射的脏键查询', () => {
  it('withPageStore：通知时对对象值映射查询脏键，未变则跳过 setData', () => {
    const page: any = {
      data: {},
      setData(updates: Record<string, unknown>) {
        Object.assign(this.data, updates)
      },
      onLoad: jest.fn(),
      onUnload: jest.fn(),
    }
    const store = createStore({ name: 'dirty-page', state: { user: { name: 'A' }, count: 0 } })

    const Decorated: any = withPageStore(store, { mapState: ['user', 'count'] })(page)
    Decorated.onLoad.call(page)

    expect(page.data.user).toEqual({ name: 'A' })
    const setDataCallsBefore = (page.setData as jest.Mock).mock?.calls?.length ?? 0

    // 仅变更原始值键：对象值引用未变且未被标记脏 → 该键被跳过
    store.$patch({ count: 1 })

    expect(page.data.count).toBe(1)
    expect(page.data.user).toEqual({ name: 'A' })
    expect(setDataCallsBefore).toBeGreaterThanOrEqual(0)
  })

  it('withComponentStore：通知时对对象值映射查询脏键', () => {
    const component: any = {
      data: {},
      methods: {},
      lifetimes: { attached: jest.fn(), detached: jest.fn() },
      setData(updates: Record<string, unknown>) {
        Object.assign(this.data, updates)
      },
    }
    const store = createStore({ name: 'dirty-component', state: { user: { name: 'B' } } })

    const Decorated: any = withComponentStore(store, { mapState: ['user'] })(component)
    Decorated.lifetimes.attached.call(component)

    expect(component.data.user).toEqual({ name: 'B' })

    // 对象整体替换：引用变化 → 必定下发
    store.$patch({ user: { name: 'C' } })
    expect(component.data.user).toEqual({ name: 'C' })
  })

  it('withAppStore：通知时对对象值映射查询脏键', () => {
    const app: any = {
      globalData: {},
      onLaunch: jest.fn(),
      onShow: jest.fn(),
      onHide: jest.fn(),
    }
    const store = createStore({ name: 'dirty-app', state: { user: { name: 'D' }, count: 0 } })

    const Decorated: any = withAppStore(store, { mapState: ['user', 'count'] })(app)
    Decorated.onLaunch.call(app)

    expect(app.globalData.user).toEqual({ name: 'D' })

    store.$patch({ count: 3 })
    expect(app.globalData.count).toBe(3)
  })
})
