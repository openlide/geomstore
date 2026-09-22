/**
 * 性能分析插件：onError 触发的计时栈清理
 *
 * 插件为每次操作压入一个结束函数，onError 只清理与错误来源相关的那一条栈顶：
 * 内层出错终止内层计时、同类型的外层计时与无关类型的计时保留，栈空则移除该键。
 * （清理范围按 source 收敛的完整口径见 analyzerPlugin.test.ts 的 #425 回归用例）
 */

import { createAnalyzerPlugin } from '@/plugins/performance/index.js'
import { createStore } from '@/core/store/index.js'

describe('analyzer 插件 onError 清理计时栈', () => {
  it('单条进行中计时：source 为 dispatch 时弹出后栈空即移除该键', () => {
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

  it('#425: source 为空时按 dispatch 处理（ActionManager 的失败路径不带 source）', () => {
    const store = createStore({ name: 'analyzer-sourceless', state: { x: 1 } })
    store.use(createAnalyzerPlugin())
    const hooks = (store as any).hooks

    // 制造两类残留计时：dispatch 与无关的 patch
    hooks.emit('beforeDispatch', 'failAction', [])
    hooks.emit('beforePatch', {})

    // core/store/ActionManager.ts 的三处 emit('onError', error) 都不带第二参
    expect(() => hooks.emit('onError', new Error('dispatch boom'))).not.toThrow()

    const monitor = (store as any).__performanceMonitor__
    // 只结束 dispatch 的计时，无关的 patch 计时保持进行中原状
    expect(monitor.getMetrics().map((m: { operation: string }) => m.operation)).toEqual(['dispatch:failAction'])
    expect(monitor.currentOperations.size).toBe(1)
  })
})
