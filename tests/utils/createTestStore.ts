import { createStore as _createStore, type StoreOptions } from '@/index'

let _seq = 0

/**
 * 测试专用 Store 工厂。
 *
 * 在 `createStore` 之上为未显式命名的 store 补充确定性唯一 name，避免测试中未命名
 * 引入的随机/冲突，使测试更稳定、可复现；其余参数完全透传，不改变任何既有语义。
 *
 * 用法：`const store = createTestStore({ state: { count: 0 } })`
 */
export function createTestStore<S extends Record<string, unknown> = Record<string, unknown>>(
  options: StoreOptions<S>,
) {
  if (!options.name) {
    options.name = `test-store-${++_seq}`
  }
  return _createStore(options)
}
