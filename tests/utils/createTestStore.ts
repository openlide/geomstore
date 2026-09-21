import { createStore as _createStore, type StoreOptions } from '@/index.js'

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
  // 不改写调用方传入的 options：把生成的 name 写回入参，会让复用同一 fixture 的
  // 后续调用跳过计数器、全部落到同一个 name（正是本工厂要防的冲突），
  // 入参被 Object.freeze 时更直接抛错
  const resolved: StoreOptions<S> = options.name ? options : { ...options, name: `test-store-${++_seq}` }
  // createStore 的重载入参（FactoryStoreConfig/LiteralStoreConfig）未对外导出，其 getters
  // 索引签名与 StoreOptions<S> 不兼容；但运行时为纯透传。这里用 @ts-expect-error 抑制该重载
  // 不匹配（而非转换入参），以保留 S 的推断，避免调用方丢失状态键的类型信息。
  // @ts-expect-error createStore 重载入参类型未导出，与 StoreOptions<S> 不兼容
  return _createStore(resolved)
}
