/**
 * 性能分析插件：onError 触发的计时栈清理
 *
 * 插件为每次操作压入一个结束函数，onError 时只弹出各配对栈的栈顶一条：
 * 内层出错终止内层计时、外层计时保留，栈空则移除该键。
 */

import { createAnalyzerPlugin } from '@/plugins/performance/index.js'
import { createStore } from '@/core/store/index.js'

describe('analyzer 插件 onError 清理计时栈', () => {
  it('单条进行中计时：弹出后栈空则移除该键', () => {
    const store = createStore({ name: 'analyzer-discard', state: { x: 1 } })
    store.use(createAnalyzerPlugin())
    const hooks = (store as any).hooks

    // 单条进行中计时：start 后未 end（模拟 action 出错）
    hooks.emit('beforeDispatch', 'probeAction', [])
    expect(() => hooks.emit('onError', new Error('dispatch boom'), 'dispatch')).not.toThrow()
  })

  it('嵌套计时：栈内仍有配对项时只弹出栈顶、不移除该键', () => {
    const store = createStore({ name: 'analyzer-stack', state: { x: 1 } })
    store.use(createAnalyzerPlugin())
    const hooks = (store as any).hooks

    // 同一类型压入两项（嵌套操作）：onError 只弹一项，栈未空
    hooks.emit('beforeSetState', 'outer')
    hooks.emit('beforeSetState', 'inner')
    expect(() => hooks.emit('onError', new Error('nested boom'), 'setState')).not.toThrow()

    // 再弹一次才清空该键
    expect(() => hooks.emit('onError', new Error('nested boom again'), 'setState')).not.toThrow()
  })
})
