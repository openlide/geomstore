/**
 * GeomStore 基础示例 2：Action
 *
 * 覆盖：同步/异步 action、action 上下文（this.state / this.setState / this.$patch）、
 * dispatch 的返回值与失败传播。
 */

import { createStore } from '../../src/index.js'

interface Todo {
  id: number
  text: string
  done: boolean
}

// 先定义状态类型：空数组 / 空串不再需要 `as` 断言，action 的 this 形状也由它推导
interface TodoState {
  items: Todo[]
  loading: boolean
  error: string
}

// Date.now() 毫秒精度，同 tick 内 add 会撞 id（toggle 按 id 查找会误伤多条）；
// 用递增计数器代替时间戳保证 id 唯一
let nextTodoId = 1

const todoStore = createStore({
  name: 'todos',
  state: (): TodoState => ({
    items: [],
    loading: false,
    error: '',
  }),
  actions: {
    // 同步 action：this 为 action 上下文（类型由 state 自动推导，无需手写）
    add(text: string): Todo {
      const todo: Todo = { id: nextTodoId++, text, done: false }
      this.$patch({ items: [...this.state.items, todo] })
      return todo
    },

    toggle(id: number): void {
      this.$patch({
        items: this.state.items.map((item) => (item.id === id ? { ...item, done: !item.done } : item)),
      })
    },

    // 异步 action：返回值是 Promise，dispatch 会原样透传
    async load(): Promise<number> {
      this.$patch({ loading: true })
      try {
        const items = await Promise.resolve([{ id: 1, text: '示例待办', done: false }])
        // 成功路径要清 error：初始 `error: ''` 只兜住第一次；一次失败一次成功后
        // 陈旧错误会一直挂在 store 上被消费侧读到
        this.$patch({ items, loading: false, error: '' })
        return items.length
      } catch (error) {
        // String(error) 会把 [object Error] 或整个 stack 塞给消费侧；
        // 优先取 .message 保证是可读的用户级信息
        this.$patch({ loading: false, error: error instanceof Error ? error.message : String(error) })
        throw error
      }
    },
  },
})

// dispatch 透传 action 的返回值（同步 action 返回其返回值）
const created = todoStore.dispatch('add', '写文档')
console.log('新增:', created)

todoStore.dispatch('toggle', created.id)
// 按 id 查找而非按下标取，避免数组为空/顺序变化时 TypeError
console.log('切换完成状态:', todoStore.getState().items.find((item) => item.id === created.id)?.done)

// 异步 action：dispatch 返回 Promise。用 async/await + try/catch 与
// `load` action 自身的 async/await 风格保持一致
async function runAsyncLoad(): Promise<void> {
  try {
    const count = await todoStore.dispatch('load')
    console.log('异步加载条数:', count)
  } catch (error) {
    console.error('加载失败:', error)
  }
}

void runAsyncLoad().then(() => {
  console.log('\n✅ 基础示例 2 完成')
})
