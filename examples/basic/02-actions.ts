/**
 * GeomStore Actions 示例
 *
 * 演示如何定义和使用 Actions
 */

import { createStore } from '../../src'

// 创建带有 Actions 的 Store
const todoStore = createStore({
  name: 'todos',
  state: {
    items: [] as Array<{ id: number; text: string; done: boolean }>,
    filter: 'all' as 'all' | 'active' | 'completed',
  },
  actions: {
    addTodo(text: string) {
      // @ts-ignore
      const newItem = {
        // @ts-ignore
        id: this.state.items.length + 1,
        text,
        done: false,
      }
      // @ts-ignore
      this.setState('items', [...this.state.items, newItem])
    },
    toggleTodo(id: number) {
      // @ts-ignore
      const items = this.state.items.map((item) =>
        item.id === id ? { ...item, done: !item.done } : item
      )
      // @ts-ignore
      this.setState('items', items)
    },
    setFilter(filter: 'all' | 'active' | 'completed') {
      // @ts-ignore
      this.setState('filter', filter)
    },
    clearCompleted() {
      // @ts-ignore
      const activeItems = this.state.items.filter((item) => !item.done)
      // @ts-ignore
      this.setState('items', activeItems)
    },
  },
})

// 使用 Actions
console.log('Initial todos:', todoStore.getState().items)

todoStore.dispatch('addTodo', 'Learn GeomStore')
todoStore.dispatch('addTodo', 'Build an app')
todoStore.dispatch('addTodo', 'Deploy to production')

console.log('After adding todos:', todoStore.getState().items)

todoStore.dispatch('toggleTodo', 1)
console.log('After toggling todo 1:', todoStore.getState().items)

todoStore.dispatch('setFilter', 'active')
console.log('Current filter:', todoStore.getState().filter)

todoStore.dispatch('clearCompleted')
console.log('After clearing completed:', todoStore.getState().items)

console.log('\n✅ Actions example completed')
