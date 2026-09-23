/**
 * GeomStore - 组合类型定义
 */

import type { Actions, State, Store } from './store.js'

/**
 * 组合选项
 *
 * ⚠️ 本接口有三个成员，但运行时只消费两个：`namespace` 与 `strict`
 * （`core/compose/composeStore.ts` 的构造函数仅读这两项，`createStoreTree` 只读 `namespace`）。
 * `lazy` / `tree` 是**已声明未实现**的历史遗留项，见各自注释（#R6-061）。
 * 未实现项刻意保留在公开类型面上：`ComposeOptions` 已随 0.x 发布，删成员属破坏性变更，
 * 需走主版本窗口，故本轮只把「写了也不生效」写在明面上，不做静默删除。
 */
export interface ComposeOptions {
  /** 命名空间模式：true 启用（默认分隔符 /），或指定前缀字符串 */
  namespace?: string | boolean
  /**
   * 延迟初始化
   *
   * **未实现**（#R6-061）：全库没有任何读取方（`grep lazy src/` 只命中本文件），
   * `composeStore(stores, { lazy: true })` 编译通过、静默无效，且 `docs/API.md` 无对应条目。
   * 需要「按访问才建组合 Store」请另提实现，勿依赖本项。
   */
  lazy?: boolean
  /** 严格模式（访问不存在的Store报错） */
  strict?: boolean
  /**
   * Store树结构
   *
   * **未实现**（#R6-061）：与 `lazy` 同判据——`ComposedStore` 从不读它，
   * 树结构由独立入口 `createStoreTree`（同样只读 `namespace`）提供，本项不构成开关。
   */
  tree?: boolean
}

/**
 * Store树节点
 *
 * `store` 为 `Store | null`（根节点不绑定具体 Store）：树节点持有的就是本库的 Store 实例，
 * 原先写作 `any` 会让 `node.store.xxx` 的拼写错误与误用全部静默通过。
 */
export interface StoreTreeNode {
  name: string
  store: Store | null
  children?: Record<string, StoreTreeNode>
}

/**
 * 命名空间配置
 *
 * **未接线**（#R6-061）：本库没有任何 API 接受该配置对象——命名空间分隔符在
 * `core/compose/helpers.ts`（`key.indexOf('/')`）里是**硬编码**的 `/`，
 * `ComposeOptions.namespace` 只接受「布尔 / 前缀字符串」两档，`autoPrefix` 亦无读取方。
 * 它经 `core/index.ts:80`、`core/compose/index.ts:7`、`core/compose/composeStore.ts:958`
 * 三处再导出对外发布，但按本类型书写配置只会得到无声的空操作。
 * 删除导出属破坏性变更（需主版本窗口 + 上述三处再导出同步收口，均不在本分片），故本轮只做标注。
 */
export interface NamespaceConfig {
  /** 命名空间分隔符 */
  separator?: string
  /** 是否自动添加命名空间 */
  autoPrefix?: boolean
}

/**
 * Store 组合类型
 *
 * 描述运行时 `core/compose` 的 `ComposedStore` 类的形状：该类 `implements Store<S>`，
 * 除 `stores` 外没有别的公开成员，所以这里直接交叉出同一份契约，而不是另抄一遍
 * name/state/stores 三件套——手抄的副本与类之间没有任何编译期关联，类增删成员、
 * 改 `state` 只读性时这里不会报错，按本别名书写类型的消费者会静默拿不到那些 API。
 *
 * 默认泛型取 `State`（即 `object`）而非 `Record<string, unknown>`：后者只接受带索引签名的
 * 类型，会把未声明索引签名的业务 interface 拒之门外，与本文件 `StoreLike` 的口径矛盾。
 */
export type ComposedStore<S extends State = State> = Store<S> & {
  /** 按 name 索引的子 Store */
  stores: Record<string, Store>
}

// ==================== 类型推断工具 ====================

/**
 * Store 类型约束
 */
export interface StoreLike {
  name: string
  /**
   * 状态约束用 `State`（即 `object`）而非 `Record<string, unknown>`：后者只接受带索引签名的类型，
   * 会把未声明索引签名的业务 interface（`interface UserState { … }`）拒之门外，
   * 与 Store 自身 `State = object` 的口径不一致（见 types/store.ts 的说明）。
   * 状态的具体类型仍由 ExtractStates 从传入的 Store 元组精确提取，此处放宽不损失精度。
   */
  state: State
  /** 复用 ./store.js 的 `Actions`（其定义即 `Record<string, (...args: any[]) => any>`），消除副本与重复的 eslint-disable */
  actions: Actions
  /**
   * getters 不能用 `Getters` 代替：`Getters<S = State>` 的 `state` 参数处于逆变位置，
   * 换用具体状态会让 `Store<UserState>` 不再满足本约束。
   * 此处的 `any` 是必要写法：它只作为 ExtractGetters 的提取位点，不参与调用点的形参检查。
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getters?: Record<string, (state: any) => any>
}

/**
 * `T` 是否为 `any`（`0 extends 1 & T` 是标准的 any 检测）
 */
type IsAny<T> = 0 extends 1 & T ? true : false

/**
 * 可选/未声明成员（`undefined`）归一为空对象
 *
 * `undefined` 与 `ExtractField` 的基例求交会塌成 `never`，而 `never & X = never`
 * ⇒ 整个结果退化为 `never`（`keyof G` 变成 `string | number | symbol`，任意 getter 名
 * 都编译通过，类型安全静默失效）。非可选成员不会命中该分支（#393）。
 *
 * 单独命名是为了让 `ExtractMember` 只留一层条件：两道守卫的**先后顺序**直接决定正确性
 * （`IsAny` 必须先判），嵌成两层条件 ternary 后这个约束既难察觉也难维护。
 */
type MemberOrEmpty<T> = undefined extends T ? Record<never, never> : T

/**
 * 取出元组首成员的 `K` 字段，并把它规整为「可安全参与交叉」的形状
 *
 * 两道守卫缺一不可，且顺序固定：
 * - `IsAny`：`undefined extends any` 为 **true**，若让 `any` 成员（如测试里的 `let store: any`）
 *   直接走 `MemberOrEmpty`，会把整个交叉塌成 `Record<never, never>`，state / actions 的精度全丢。
 *   `any` 只能原样穿过（`any & X = any`）。
 * - `MemberOrEmpty`：见其定义（#393）。
 */
type ExtractMember<First extends StoreLike, K extends 'state' | 'actions' | 'getters'> = IsAny<First[K]> extends true ? First[K] : MemberOrEmpty<First[K]>

/**
 * 元组字段提取的公共实现（#395）
 *
 * `ExtractStates` / `ExtractActions` / `ExtractGetters` 三者只差被访问的成员，
 * 此前各自维护一份同构的递归条件类型，任何修复（如 #393 的可选 `getters` 守卫）都要改三遍且容易分叉。
 *
 * 基例用 `Record<never, never>`（无索引签名的空对象类型）而非 `Record<string, never>`：
 * 后者会向交叉类型注入 `[x: string]: never` 索引签名，污染组合 Store 的状态属性类型；
 * 同时不用 `unknown`，因其不满足 Store 泛型的 `object` 约束。
 */
type ExtractField<Stores extends readonly StoreLike[], K extends 'state' | 'actions' | 'getters'> = Stores extends readonly [
  infer First extends StoreLike,
  ...infer Rest extends StoreLike[],
]
  ? ExtractMember<First, K> & ExtractField<Rest, K>
  : Record<never, never>

/**
 * 从 Store 元组提取交叉（合并）状态类型
 *
 * 求的是各成员状态的**交叉**而非联合：组合 Store 同时拥有全部成员的键；
 * 联合只会把结果放宽成「未知是哪一个成员」。基例与守卫见 `ExtractField`。
 */
export type ExtractStates<Stores extends readonly StoreLike[]> = ExtractField<Stores, 'state'>

/**
 * 从 Store 元组提取交叉（合并）Actions 类型
 */
export type ExtractActions<Stores extends readonly StoreLike[]> = ExtractField<Stores, 'actions'>

/**
 * 从 Store 元组提取交叉（合并）Getters 类型
 *
 * 可选的 `StoreLike.getters` 由 `ExtractField` 的 `undefined` 守卫处理（#393）。
 */
export type ExtractGetters<Stores extends readonly StoreLike[]> = ExtractField<Stores, 'getters'>
