/**
 * GeomStore 基础示例 1：创建并使用 Store
 *
 * 覆盖：状态工厂、读取、三种写入方式、订阅与退订。
 *
 * 注：本仓库内示例统一从 `src/` 相对导入以便类型检查；
 * 发布包中的等价写法为 `import { createStore } from '@openlide/geomstore'`。
 */

import { createStore } from '../../src/index.js'

// 先定义状态类型：它是状态形状的唯一来源（订阅回调、$patch 的参数类型都由它推导）
interface CounterState {
  count: number
  message: string
}

// state 推荐使用工厂函数：每次创建 Store 时执行，避免引用类型被多个实例共享
// 标注返回类型后，字段无需断言，S 也不会退化为宽松推断
const counterStore = createStore({
  name: 'counter',
  state: (): CounterState => ({
    count: 0,
    message: 'Hello GeomStore!',
  }),
})

// 读取状态（返回活动引用；如需不可变副本请用 $snapshot）
console.log('初始状态:', counterStore.getState())

// 写入：单键
counterStore.setState('count', 10)

// 写入：多键合并（一次通知）
counterStore.$patch({ count: 20, message: 'Updated!' })

// 写入：整体替换（注意会丢弃未列出的键）
counterStore.$replaceState({ count: 30, message: 'Replaced!' })
console.log('替换后:', counterStore.getState())

// 订阅：监听器只接收新状态（StateListener<S> = (state: S) => void），返回值即退订函数
// S 已是精确的 CounterState，回调参数无需再标注
const unsubscribe = counterStore.subscribe((state) => {
  console.log('状态变更: count =', state.count)
})

// 第二个参数可声明只读订阅：只读订阅者存在时通知路径可做零拷贝优化
const unsubscribeReadOnly = counterStore.subscribe((state) => console.log('只读订阅:', state.message), {
  readOnly: true,
})

counterStore.setState('count', 40)
unsubscribe() // 退订后不再收到通知

counterStore.setState('count', 50)
console.log('退订后仍可写入:', counterStore.getState().count)

unsubscribeReadOnly() // 只读订阅同样需要退订，避免后续无效回调

console.log('\n✅ 基础示例 1 完成')
