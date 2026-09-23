/**
 * 性能分析插件：onError 触发的计时栈清理
 *
 * 插件为每次操作压入一个结束函数，onError 只结束「确已中止」那次操作的计时：
 * 弹栈的前提是对应的 after* 钩子再也不会来，而钩子处理器抛错后 after* 照常触发、
 * 无源的 onError 发射点（ActionManager 的 `_reportSettledFailure` 与 Store 的
 * `onListenerError`）里只有同步 dispatch 的 catch 代表操作中止，同一发射点无法区分
 * （判据见 analyzerPlugin.ts 的 discardPendingEnd 注释）。栈空则移除该键。
 */

import { createAnalyzerPlugin } from '@/plugins/performance/index.js'
import { createStore } from '@/core/store/index.js'

describe('analyzer 插件 onError 清理计时栈', () => {
  it('单条进行中计时：source 显式为 dispatch 时弹出后栈空即移除该键', () => {
    const store = createStore({ name: 'analyzer-discard', state: { x: 1 } })
    store.use(createAnalyzerPlugin())
    const hooks = (store as any).hooks

    // 单条进行中计时：start 后未 end（模拟 action 出错）
    hooks.emit('beforeDispatch', 'probeAction', [])
    expect(() => hooks.emit('onError', new Error('dispatch boom'), 'dispatch')).not.toThrow()

    const monitor = (store as any).__performanceMonitor__
    expect(monitor.getMetrics().map((m: { operation: string }) => m.operation)).toEqual(['dispatch:probeAction'])
    expect(monitor.currentOperations.size).toBe(0)
  })

  it('嵌套计时：同类型只弹栈顶一条，第二条仍保留', () => {
    const store = createStore({ name: 'analyzer-stack', state: { x: 1 } })
    store.use(createAnalyzerPlugin())
    const hooks = (store as any).hooks

    // 同一类型压入两项（嵌套操作）：onError 只弹一项，栈未空
    hooks.emit('beforeSetState', 'outer')
    hooks.emit('beforeSetState', 'inner')
    expect(() => hooks.emit('onError', new Error('nested boom'), 'setState')).not.toThrow()

    const monitor = (store as any).__performanceMonitor__
    expect(monitor.getMetrics().map((m: { operation: string }) => m.operation)).toEqual(['setState:inner'])
    expect(monitor.currentOperations.size).toBe(1)

    // 再弹一次才清空该键
    expect(() => hooks.emit('onError', new Error('nested boom again'), 'setState')).not.toThrow()
    expect(monitor.currentOperations.size).toBe(0)
    expect(monitor.getMetrics()).toHaveLength(2)
  })

  it('R5-319 回归: 无 source 的 onError 不得弹掉任何进行中的计时', () => {
    const store = createStore({ name: 'analyzer-sourceless', state: { count: 0 } })
    store.use(createAnalyzerPlugin())
    const hooks = (store as any).hooks

    // 制造两类进行中计时：dispatch 与 patch
    hooks.emit('beforeDispatch', 'outerAction', [])
    hooks.emit('beforePatch', {})

    // core 的两处无源 emit（ActionManager._reportSettledFailure 与 Store 的 onListenerError）
    // 里，前者被 5 条失败路径共用、只有同步 dispatch 的 catch 真的中止了操作：
    // 一律按 dispatch 弹栈会提前结束外层计时并让后续 after* 配错 span，故一条都不弹
    expect(() => hooks.emit('onError', new Error('sourceless boom'))).not.toThrow()

    const monitor = (store as any).__performanceMonitor__
    expect(monitor.getMetrics()).toHaveLength(0)
    expect(monitor.currentOperations.size).toBe(2)

    // 两条计时仍能与各自的 after* 正确配对
    hooks.emit('afterDispatch', 'outerAction', [], undefined)
    hooks.emit('afterPatch', {})
    expect(monitor.getMetrics().map((m: { operation: string }) => m.operation)).toEqual(['dispatch:outerAction', 'patch'])
    expect(monitor.currentOperations.size).toBe(0)
  })

  it('R5-319 回归: source 为出错的钩子名时不弹栈（after* 稍后照常触发）', () => {
    const store = createStore({ name: 'analyzer-hookname', state: { count: 0 } })
    store.use(createAnalyzerPlugin())
    const hooks = (store as any).hooks

    // $patch 内部的 setState 触发了某个钩子处理器的异常：HookSystem 捕获后继续迭代，
    // 以出错的 hookName 作第二参转发 onError（见 types/plugin.ts 的 emit 语义）
    hooks.emit('beforePatch', {})
    hooks.emit('beforeSetState', 'count', 1)
    const monitor = (store as any).__performanceMonitor__

    expect(() => hooks.emit('onError', new Error('handler boom'), 'beforeSetState')).not.toThrow()

    // 内层 setState 的计时必须保持在途：它由 afterSetState 结束，提前弹栈会让
    // afterSetState 弹到外层 patch 的配对项上
    expect(monitor.getMetrics()).toHaveLength(0)
    expect(monitor.currentOperations.size).toBe(2)

    hooks.emit('afterSetState', 'count', 1)
    hooks.emit('afterPatch', {})
    expect(monitor.getMetrics().map((m: { operation: string }) => m.operation)).toEqual(['setState:count', 'patch'])
    expect(monitor.currentOperations.size).toBe(0)
  })

  it('R5-319 连带项: 永不 pop 的中止栈项按上限淘汰，不影响后续配对', () => {
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {})
    const store = createStore({ name: 'analyzer-stack-cap', state: { count: 0 } })
    store.use(createAnalyzerPlugin())
    const hooks = (store as any).hooks
    const monitor = (store as any).__performanceMonitor__

    // onError 不再据无源信号弹栈后，每次「中止」都留下一条永不 pop 的计时：
    // 1000 条以内全部保留，第 1001 条把最旧的一条挤掉并出声解释缺口
    for (let i = 0; i < 1000; i++) {
      hooks.emit('beforeDispatch', `aborted-${i}`, [])
    }
    expect(debugSpy).not.toHaveBeenCalled()
    hooks.emit('beforeDispatch', 'aborted-1000', [])
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('dispatch 的未完成配对计时已达上限 1000'))
    debugSpy.mockClear()

    // 淘汰取栈底，栈顶仍是最近一次开帧：afterDispatch 与之配对，指标不缺位
    hooks.emit('afterDispatch', 'aborted-1000', [], undefined)
    expect(monitor.getMetrics().map((m: { operation: string }) => m.operation)).toEqual(['dispatch:aborted-1000'])
    expect(debugSpy).not.toHaveBeenCalled()

    debugSpy.mockRestore()
  })
})
