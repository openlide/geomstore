/**
 * GeomStore v1.0 - 组合类型定义
 */

/**
 * 组合选项
 */
export interface ComposeOptions {
  /** 命名空间模式：true 启用（默认分隔符 /），或指定前缀字符串 */
  namespace?: string | boolean
  /** 延迟初始化 */
  lazy?: boolean
  /** 严格模式（访问不存在的Store报错） */
  strict?: boolean
  /** Store树结构 */
  tree?: boolean
}

/**
 * Store树节点
 */
export interface StoreTreeNode {
  name: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  store: any
  children?: Record<string, StoreTreeNode>
}

/**
 * 命名空间配置
 */
export interface NamespaceConfig {
  /** 命名空间分隔符 */
  separator?: string
  /** 是否自动添加命名空间 */
  autoPrefix?: boolean
}

/**
 * Store组合类型
 */
export type ComposedStore<S = Record<string, unknown>> = {
  name: string
  state: S
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stores: Record<string, any>
}

// ==================== 类型推断工具 ====================

/**
 * Store 类型约束
 */
export interface StoreLike {
  name: string
  state: Record<string, unknown>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  actions: Record<string, (...args: any[]) => any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getters?: Record<string, (state: any) => any>
}

/**
 * 从 Store 元组提取联合状态类型
 *
 * 基例使用 Record<never, never>（无索引签名的空对象类型）而非 Record<string, never>：
 * 后者会向交叉类型注入 [x: string]: never 索引签名，污染组合 Store 的状态属性类型；
 * 同时不用 unknown，因其不满足 Store 泛型的 object 约束
 */
export type ExtractStates<Stores extends readonly StoreLike[]> = Stores extends readonly [infer First extends StoreLike, ...infer Rest extends StoreLike[]]
  ? First['state'] & ExtractStates<Rest>
  : Record<never, never>

/**
 * 从 Store 元组提取联合 Actions 类型
 */
export type ExtractActions<Stores extends readonly StoreLike[]> = Stores extends readonly [infer First extends StoreLike, ...infer Rest extends StoreLike[]]
  ? First['actions'] & ExtractActions<Rest>
  : Record<never, never>

/**
 * 从 Store 元组提取联合 Getters 类型
 */
export type ExtractGetters<Stores extends readonly StoreLike[]> = Stores extends readonly [infer First extends StoreLike, ...infer Rest extends StoreLike[]]
  ? First['getters'] & ExtractGetters<Rest>
  : Record<never, never>
