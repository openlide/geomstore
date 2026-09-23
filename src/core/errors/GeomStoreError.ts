/**
 * GeomStore - 自定义错误类体系
 *
 * 提供完整的错误类型定义，包括：
 * - 基础错误类
 * - 特定领域的错误类型
 * - 错误上下文信息
 */

/** 上下文序列化的递归深度上限：超限的分支以标记收尾，避免深树把日志通道自身拖垮 */
const MAX_CONTEXT_DEPTH = 6
const CIRCULAR_MARKER = '[Circular]'
const DEPTH_MARKER = '[Truncated]'
const UNREADABLE_MARKER = '[Unreadable]'

/**
 * 错误品牌标识：供本文件的类型守卫在「同一包多副本」下识别本库错误。
 *
 * 与 `store/stateVersion.ts` 的 STATE_VERSION、`store/pluginSupport.ts` 的
 * GEOMSTORE_BRAND 同一取舍：小程序构建产物里同一包常有重复副本（分包各自打包、
 * 宿主库把本库一起打进去），此时副本 A 抛出的错误在副本 B 里 `instanceof` 恒为 false，
 * `isGeomStoreError(e)` 一律漏判，用户按 README 推荐写法就会静默走兜底分支，
 * 错误码分级/上报策略整块失效。`Symbol.for` 的符号注册表按进程共享，故键名带包名
 * 命名空间但**不带版本号**（加版本就重新制造了副本分裂）。
 *
 * 可伪造性：全局符号注册表公开，任何人 `Symbol.for('@openlide/geomstore:error-brand')`
 * 都能贴出同样的键。本标识**不是安全边界**，只服务下面这七个类型守卫；
 * 伪造它换不到任何内部访问通道（真正的写入保护在 StateProxy 陷阱与代际令牌里）。
 */
const GEOMSTORE_ERROR_BRAND: unique symbol = Symbol.for('@openlide/geomstore:error-brand')

/**
 * 把 context 里的任意值归一成「JSON.stringify 不会抛」的结构
 *
 * 错误上报是故障发生后才走的通道，`JSON.stringify(error)` 一旦二次抛错，
 * 原始故障连同这条错误一起丢失。context 收的是状态快照/实参/store 对象等
 * `unknown`，其中会让 stringify 抛错的三类来源在此收敛：
 * - 循环引用（state 里互相指向的对象）→ `'[Circular]'`
 * - BigInt（JSON 无此类型）→ `'123n'` 形式
 * - 取值即抛的访问器（包装了已销毁 Store 的 getter）→ `'[Unreadable]'`
 *
 * 带 `toJSON` 的对象分两类处理（见函数体内的分支注释）：序列化器给出**原始值**时
 * （Date 等）原样交回 JSON 引擎按其自身的序列化器处理；给出**对象/数组**时，
 * 其返回值仍要过一遍带深度与祖先链的归一，否则本函数的两道保护在这条分支上整体作废。
 * 其余对象/数组按自有可枚举键展开成普通结构（与 stringify 的取值口径一致）。
 */
function toSerializableValue(value: unknown, ancestors: WeakSet<object>, depth: number): unknown {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'bigint' ? `${value}n` : value
  }

  // 探测与调用序列化器都圈在 try 内：`toJSON` 可以是「取值即抛的访问器」，
  // 而把属性读取留在 try 之外等于让下方 52-56 行为子键建立的那道保护在此失效
  let serializerResult: unknown
  let hasSerializer = false
  try {
    const serializer = (value as { toJSON?: unknown }).toJSON
    if (typeof serializer === 'function') {
      hasSerializer = true
      serializerResult = (serializer as () => unknown).call(value)
    }
  } catch {
    return UNREADABLE_MARKER
  }

  if (hasSerializer) {
    // 序列化器给出原始值（Date/Number/String 等）：stringify 按其结果收尾、不会再回到
    // 本函数，既无深度也无环路风险，故原样交回 value（`toJSON()` 的返回值里 Date 仍是
    // Date，序列化后的字面量仍是它的 ISO 串——与 R5-079 锁定的形状一致）
    if (serializerResult === null || typeof serializerResult !== 'object') {
      return value
    }
    // 序列化器给出对象/数组：交回 value 就是「把本函数仅有的两道保护整体旁路」——
    // 递归交回 JSON 引擎自由进行，而每次 toJSON() 都构造新身份的图/树节点
    // （`{ parent: this }` 这类写法）会让 stringify 的环路检测认不出引用，
    // 结局是 RangeError: Maximum call stack size exceeded，即「二次抛错把原始故障一起丢掉」。
    // 这里改为把返回结果续走同一套归一：value 自身入祖先链（拦住「toJSON 返回自己」），
    // 深度照常下调，超限时以 [Truncated] 收尾。
    if (depth >= MAX_CONTEXT_DEPTH) {
      return DEPTH_MARKER
    }
    if (ancestors.has(value)) {
      return CIRCULAR_MARKER
    }
    ancestors.add(value)
    try {
      return toSerializableValue(serializerResult, ancestors, depth + 1)
    } finally {
      ancestors.delete(value)
    }
  }

  if (depth >= MAX_CONTEXT_DEPTH) {
    return DEPTH_MARKER
  }
  // 只把「当前分支上的祖先」当作环：兄弟节点共享同一对象不是循环，
  // 用全局 seen 会把正常的复用引用误报成 [Circular]
  if (ancestors.has(value)) {
    return CIRCULAR_MARKER
  }
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      return value.map((item) => toSerializableValue(item, ancestors, depth + 1))
    }
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value)) {
      let child: unknown
      try {
        child = (value as Record<string, unknown>)[key]
      } catch {
        child = UNREADABLE_MARKER
      }
      const serialized = toSerializableValue(child, ancestors, depth + 1)
      if (key === '__proto__') {
        // 自有 '__proto__' 键走 [[Set]] 会触发 Object.prototype 的 setter：
        // 该键被丢弃且 out 的原型被换掉（与 clone/merge 处的 defineProperty 守卫同口径）
        Object.defineProperty(out, key, { value: serialized, writable: true, enumerable: true, configurable: true })
      } else {
        out[key] = serialized
      }
    }
    return out
  } finally {
    ancestors.delete(value)
  }
}

/**
 * `cause` 的日志形状
 *
 * 通用归一会把原生 Error 摊成 `{}`（`message`/`stack` 都是不可枚举自有属性），
 * 而 cause 的全部价值就是「被包装掉的原始故障是什么」，故：
 * - 带 `toJSON` 的抛出值（GeomStoreError 系即在此）取其 `toJSON()` 的结果再过同一套归一：
 *   本库错误的 `code` 是上报侧唯一的分类依据，`cause` 链是两层以上包装的根因，
 *   只取 name/message 等于把这两样最需要的信息削掉；
 * - 其余原生 Error 显式取 name/message；
 * - 再其余的值（字符串、状态片段、自定义抛出值）走与 context 同一套环路/BigInt 安全通道。
 *
 * 序列化器自身抛错不向上冒（与「打印错误不得变成第二次故障」的口径一致），
 * 退回该 Error 的 name/message；非 Error 的抛出值退回 `[Unreadable]` 标记。
 */
function toSerializableCause(value: unknown): unknown {
  if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
    let serializer: unknown
    try {
      serializer = (value as { toJSON?: unknown }).toJSON
    } catch {
      serializer = undefined
    }
    if (typeof serializer === 'function') {
      try {
        return toSerializableValue((serializer as () => unknown).call(value), new WeakSet<object>(), 0)
      } catch {
        // 序列化器抛错：不中断打印，落到下面的兜底形状
      }
    }
  }

  if (value instanceof Error) {
    return { name: value.name, message: value.message }
  }

  return toSerializableValue(value, new WeakSet<object>(), 0)
}

/**
 * GeomStore基础错误类
 *
 * @class GeomStoreError
 * @description
 * 所有GeomStore错误的基础类，提供统一的错误格式和上下文信息。
 * 包含错误代码、上下文数据和完整的堆栈跟踪。
 *
 * `context` 在构造期做浅拷贝、在 `toJSON()` 里做环路/BigInt 归一，
 * 二者共同保证：错误对象既不会被调用方事后改写的入参污染，也不会把
 * 「打印错误」变成第二次抛错。
 *
 * 包装底层异常时把原始抛出值作为第 5 个实参（派生类第 4 个）传入，它会保存在
 * `error.cause` 上并随 `toJSON()` 输出，不再像此前那样被丢弃。
 *
 * @example
 * ```typescript
 * const error = new GeomStoreError(
 *   'State update failed',
 *   'STATE_UPDATE_ERROR',
 *   {
 *     storeName: 'user-store',
 *     key: 'user',
 *     value: { name: 'Alice' }
 *   }
 * )
 *
 * console.log(error.message)    // 'State update failed'
 * console.log(error.code)        // 'STATE_UPDATE_ERROR'
 * console.log(error.context)     // { storeName: 'user-store', ... }
 * console.log(error.toJSON())   // 序列化的错误信息
 * ```
 */
export class GeomStoreError extends Error {
  /**
   * 错误代码，用于错误分类和识别
   * @type {string}
   */
  readonly code: string

  /**
   * 错误上下文信息，包含相关的状态和元数据
   * @type {Record<string, unknown> | undefined}
   */
  readonly context?: Record<string, unknown>

  /**
   * 被本错误包装掉的原始抛出值（如果调用方提供了）
   *
   * target/lib 为 ES2020，`Error` 构造器没有 `cause` 选项签名，故按属性赋值补齐
   * （与 extras 的 attachCause 同口径）。缺省时不写入该属性。
   * @type {unknown}
   */
  readonly cause?: unknown

  /**
   * 创建GeomStore错误实例
   *
   * `name` 由派生类显式传入而非取 `this.constructor.name`：产物经 esbuild/terser 压缩，
   * 类名会被改写，取构造器名会让生产构建里的 `error.name` 变成不可读的短标识。
   *
   * @param {string} message - 错误消息
   * @param {string} code - 错误代码
   * @param {Record<string, unknown>} [context] - 错误上下文
   * @param {string} [name] - 错误名称（派生类传入自身类名字面量，默认 'GeomStoreError'）
   * @param {unknown} [cause] - 触发本错误的原始抛出值；不传则不挂 cause
   *
   * @example
   * ```typescript
   * throw new GeomStoreError(
   *   'Action not found',
   *   'ACTION_NOT_FOUND',
   *   { actionName: 'missingAction', storeName: 'test-store' }
   * )
   * ```
   *
   * @example
   * ```typescript
   * // 包装底层异常：原始错误与其堆栈随 cause 一并保留
   * try {
   *   fs.writeFileSync(file, data)
   * } catch (original) {
   *   throw new StateError('Persist state failed', 'STATE_UPDATE_ERROR', { file }, original)
   * }
   * ```
   */
  constructor(message: string, code: string, context?: Record<string, unknown>, name: string = 'GeomStoreError', cause?: unknown) {
    super(message)
    this.name = name
    this.code = code
    // 浅拷贝调用方传入的 context：`readonly` 只是编译期约束，按引用存下来会让
    // 调用方之后对同一对象的写入追溯性地改掉已捕获的错误现场
    // （toJSON()/getFriendlyMessage() 的输出随之变化）。嵌套值仍共享——
    // 深拷贝会把状态快照整树复制进错误对象，代价与诊断价值不成比例
    this.context = context ? { ...context } : undefined
    // ES2020 的 Error 无 cause 选项签名，按属性赋值；未提供时保持「无该自有属性」，
    // 与原生 Error 的形态一致（`'cause' in error` 可用来区分「未包装」与「包装了 undefined」）
    if (cause !== undefined) {
      const withCause = this as { cause?: unknown }
      withCause.cause = cause
    }

    // 把实例原型对齐到 new.target.prototype：直接构造本类时是 GeomStoreError.prototype，
    // 派生类经 super() 走到这里时 new.target 就是那个派生构造器，对齐结果是派生原型。
    // （new.target 只在「不经 new 调用类」时才是 undefined，而 class 语法做不到这一点，
    // 故此处不需要任何分支：ES2020 下原生 class extends Error 本已挂对原型，
    // 这句只为兜住把构造器当函数转译/手工 call 的构建产物，无条件执行才是正确写法）
    Object.setPrototypeOf(this, new.target.prototype)

    // 品牌键以**非可枚举自有属性**挂载：`Object.keys` / `JSON.stringify` / 深比较都看不到它，
    // 故 toJSON() 的输出形状与实例的可枚举形状保持不变；副本无关的识别靠它，
    // 因为跨副本时 `instanceof` 一定为 false（见 GEOMSTORE_ERROR_BRAND）
    Object.defineProperty(this, GEOMSTORE_ERROR_BRAND, {
      value: true,
      enumerable: false,
      writable: false,
      configurable: false,
    })
  }

  /**
   * 将错误对象转换为JSON格式
   *
   * @remarks 返回值含完整 `stack`：本方法的契约是**开发者诊断/日志**用途（ERROR-008
   * 亦锁定了该形状），堆栈是排障必需信息，故不裁剪、也不按 NODE_ENV 分支（生产构建
   * 里堆栈同样重要）。**不要把结果直接回传客户端或写入持久化存储**——小程序包路径与
   * 内部实现细节会随之外泄；对外上报请只取 `name`/`message`/`code`/`context`。
   *
   * @remarks `context` 在此处过一遍 `toSerializableValue`：环路/BigInt/取值即抛的访问器
   * 会被换成字符串标记，因此 `JSON.stringify(error)`（它会调用本方法）不会因这些值抛错，
   * 错误上报通道不会变成第二次故障。带 `toJSON` 的对象：序列化器给出原始值（Date 等）时
   * 按其自身序列化器处理（本方法返回值里仍是那个 Date 对象）；给出对象/数组时其结果继续
   * 走同一套深度/环路归一，序列化器自身抛错则换成 `'[Unreadable]'`——即本方法对 context
   * 的兜底**覆盖**自定义序列化器，深树与抛错的序列化器都不会再把故障升级成 RangeError/TypeError。
   *
   * @remarks `cause` 仅在构造期提供时才带上（未包装底层错误时输出形状不变，ERROR-008
   * 锁定的仍是 name/message/code/context/stack 五个键），并过同一套归一，
   * 使「是谁被包装掉了」在日志里可见。cause 带 `toJSON`（本库错误系即在此）时取其
   * `toJSON()` 的结果，故被包装者的 `code`/`context`/内层 cause 不丢。
   *
   * @returns {Record<string, unknown>} 序列化的错误信息
   *
   * @example
   * ```typescript
   * const error = new GeomStoreError('Error', 'CODE', { key: 'value' })
   * const json = error.toJSON()
   * // {
   * //   name: 'GeomStoreError',
   * //   message: 'Error',
   * //   code: 'CODE',
   * //   context: { key: 'value' },
   * //   stack: '...'
   * // }
   * ```
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context === undefined ? undefined : toSerializableValue(this.context, new WeakSet<object>(), 0),
      stack: this.stack,
      cause: this.cause === undefined ? undefined : toSerializableCause(this.cause),
    }
  }

  /**
   * 获取用户友好的错误消息
   *
   * @returns {string} 格式化的错误消息
   *
   * @example
   * ```typescript
   * const error = new GeomStoreError(
   *   'Action failed',
   *   'ACTION_ERROR',
   *   { actionName: 'save', storeName: 'user-store' }
   * )
   * console.log(error.getFriendlyMessage())
   * // "Action failed in store 'user-store': save"
   * ```
   */
  getFriendlyMessage(): string {
    // context 是 Record<string, unknown>：storeName/operation 可能不是字符串。
    // 此前的 `as string` 断言会让 { storeName: { name: 'x' } } 输出 "[object Object]"、
    // 让数字 0 被后续真值判断吞掉，故按类型收窄，非字符串一律视为缺失
    const storeName = typeof this.context?.storeName === 'string' ? this.context.storeName : undefined
    const operation = typeof this.context?.operation === 'string' ? this.context.operation : undefined

    if (storeName && operation) {
      return `${this.message} in store '${storeName}': ${operation}`
    }

    if (storeName) {
      return `${this.message} in store '${storeName}'`
    }

    if (operation) {
      return `${this.message}: ${operation}`
    }

    return this.message
  }
}

/**
 * Action相关错误
 *
 * @class ActionError
 * @extends GeomStoreError
 * @description
 * 表示Action执行过程中发生的错误，包括：
 * - Action不存在
 * - Action执行失败
 * - Action参数错误
 *
 * @example
 * ```typescript
 * throw new ActionError(
 *   'Action "fetchData" failed: Network timeout',
 *   'ACTION_EXECUTION_ERROR',
 *   {
 *     actionName: 'fetchData',
 *     storeName: 'user-store',
 *     args: ['userId']
 *   }
 * )
 * ```
 */
export class ActionError extends GeomStoreError {
  constructor(message: string, code: string, context?: Record<string, unknown>, cause?: unknown) {
    // 名称按字面量交给基类：字段赋值与原型复位统一在 GeomStoreError 构造器内完成
    super(message, code, context, 'ActionError', cause)
  }
}

/**
 * State相关错误
 *
 * @class StateError
 * @extends GeomStoreError
 * @description
 * 表示状态操作过程中发生的错误，包括：
 * - 状态键不存在
 * - 状态值类型错误
 * - 状态更新失败
 *
 * @example
 * ```typescript
 * throw new StateError(
 *   'State key "user" does not exist',
 *   'STATE_KEY_NOT_FOUND',
 *   {
 *     storeName: 'user-store',
 *     key: 'user',
 *     availableKeys: ['name', 'email']
 *   }
 * )
 * ```
 */
export class StateError extends GeomStoreError {
  constructor(message: string, code: string, context?: Record<string, unknown>, cause?: unknown) {
    // 名称按字面量交给基类：字段赋值与原型复位统一在 GeomStoreError 构造器内完成
    super(message, code, context, 'StateError', cause)
  }
}

/**
 * Selector相关错误
 *
 * @class SelectorError
 * @extends GeomStoreError
 * @description
 * 表示Selector执行过程中发生的错误，包括：
 * - Selector不存在
 * - Selector执行失败
 * - Selector参数错误
 *
 * @example
 * ```typescript
 * throw new SelectorError(
 *   'Selector "getUser" execution failed',
 *   'SELECTOR_EXECUTION_ERROR',
 *   {
 *     selectorName: 'getUser',
 *     state: { user: null }
 *   }
 * )
 * ```
 */
export class SelectorError extends GeomStoreError {
  constructor(message: string, code: string, context?: Record<string, unknown>, cause?: unknown) {
    // 名称按字面量交给基类：字段赋值与原型复位统一在 GeomStoreError 构造器内完成
    super(message, code, context, 'SelectorError', cause)
  }
}

/**
 * Plugin相关错误
 *
 * @class PluginError
 * @extends GeomStoreError
 * @description
 * 表示插件操作过程中发生的错误，包括：
 * - 插件安装失败
 * - 插件执行失败
 * - 插件卸载失败
 *
 * @example
 * ```typescript
 * throw new PluginError(
 *   'Plugin "persistence" installation failed: Storage not available',
 *   'PLUGIN_INSTALLATION_ERROR',
 *   {
 *     pluginName: 'persistence',
 *     storeName: 'user-store'
 *   }
 * )
 * ```
 */
export class PluginError extends GeomStoreError {
  constructor(message: string, code: string, context?: Record<string, unknown>, cause?: unknown) {
    // 名称按字面量交给基类：字段赋值与原型复位统一在 GeomStoreError 构造器内完成
    super(message, code, context, 'PluginError', cause)
  }
}

/**
 * Compose相关错误
 *
 * @class ComposeError
 * @extends GeomStoreError
 * @description
 * 表示Store组合操作过程中发生的错误，包括：
 * - Store名称冲突
 * - Store依赖解析失败
 * - Store组合失败
 *
 * @example
 * ```typescript
 * throw new ComposeError(
 *   'Store name conflict: "user" already exists',
 *   'STORE_NAME_CONFLICT',
 *   {
 *     namespace: 'root',
 *     storeName: 'user',
 *     existingStore: 'root.user'
 *   }
 * )
 * ```
 */
export class ComposeError extends GeomStoreError {
  constructor(message: string, code: string, context?: Record<string, unknown>, cause?: unknown) {
    // 名称按字面量交给基类：字段赋值与原型复位统一在 GeomStoreError 构造器内完成
    super(message, code, context, 'ComposeError', cause)
  }
}

/**
 * 验证错误
 *
 * @class ValidationError
 * @extends GeomStoreError
 * @description
 * 表示数据验证过程中发生的错误，包括：
 * - 参数验证失败
 * - 状态验证失败
 * - 类型验证失败
 *
 * @example
 * ```typescript
 * throw new ValidationError(
 *   'Invalid state value: expected number, got string',
 *   'VALIDATION_ERROR',
 *   {
 *     storeName: 'user-store',
 *     key: 'count',
 *     expectedType: 'number',
 *     receivedType: 'string',
 *     value: '10'
 *   }
 * )
 * ```
 */
export class ValidationError extends GeomStoreError {
  constructor(message: string, code: string, context?: Record<string, unknown>, cause?: unknown) {
    // 名称按字面量交给基类：字段赋值与原型复位统一在 GeomStoreError 构造器内完成
    super(message, code, context, 'ValidationError', cause)
  }
}

/**
 * 错误代码枚举
 *
 * @description
 * 定义所有可能的错误代码，便于错误分类和处理。
 */
export enum ErrorCode {
  // Action错误
  ACTION_NOT_FOUND = 'ACTION_NOT_FOUND',
  ACTION_EXECUTION_ERROR = 'ACTION_EXECUTION_ERROR',
  ACTION_TIMEOUT = 'ACTION_TIMEOUT',
  ACTION_CANCELLED = 'ACTION_CANCELLED',

  // State错误
  STATE_KEY_NOT_FOUND = 'STATE_KEY_NOT_FOUND',
  STATE_UPDATE_ERROR = 'STATE_UPDATE_ERROR',
  STATE_TYPE_ERROR = 'STATE_TYPE_ERROR',

  // Selector错误
  SELECTOR_NOT_FOUND = 'SELECTOR_NOT_FOUND',
  SELECTOR_EXECUTION_ERROR = 'SELECTOR_EXECUTION_ERROR',
  SELECTOR_CACHE_ERROR = 'SELECTOR_CACHE_ERROR',

  // Plugin错误
  PLUGIN_NOT_FOUND = 'PLUGIN_NOT_FOUND',
  PLUGIN_INSTALLATION_ERROR = 'PLUGIN_INSTALLATION_ERROR',
  PLUGIN_EXECUTION_ERROR = 'PLUGIN_EXECUTION_ERROR',

  // Compose错误
  STORE_NAME_CONFLICT = 'STORE_NAME_CONFLICT',
  STORE_DEPENDENCY_ERROR = 'STORE_DEPENDENCY_ERROR',
  STORE_COMPOSE_ERROR = 'STORE_COMPOSE_ERROR',

  // 验证错误
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  TYPE_ERROR = 'TYPE_ERROR',
  PARAMETER_ERROR = 'PARAMETER_ERROR',

  // 通用错误
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

/**
 * 错误类型守卫
 *
 * @description
 * 提供类型安全的错误检查函数，用于错误处理逻辑。
 *
 * 判定口径（两条一起用）：
 * 1. `instanceof` —— 单副本部署下的精确判定；
 * 2. 品牌键 + `name` —— 副本无关的兜底判定：同一包的多个副本各有一份类对象，
 *    跨副本 `instanceof` 恒为 false，只看它会让主包抛出的错误在分包里被判成
 *    「不是 GeomStore 错误」，用户的 `switch (e.code)` 分级静默失效。
 *
 * 派生守卫在基类判定上比 `name`：`name` 由构造器按字面量显式赋值（产物经
 * esbuild/terser 压缩后 `constructor.name` 不可信，故它才是设计上的类型判别字段），
 * 与品牌键组合同样副本无关。
 */

/**
 * 基类判定：instanceof ∥（Error 实例 + 本库品牌键 + string code）
 *
 * 要求 `error instanceof Error`：品牌键只可能由本库构造器写在 Error 实例上，加上这条
 * 让「只贴了品牌键的普通对象」不会被当成可分级的错误。
 * 要求 `typeof code === 'string'`：守卫的输出会被调用方直接用于 `switch (error.code)`，
 * 形状不完整比漏判更难排查。
 */
function matchesGeomStoreErrorShape(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  const candidate = error as { [GEOMSTORE_ERROR_BRAND]?: unknown; code?: unknown }
  return candidate[GEOMSTORE_ERROR_BRAND] === true && typeof candidate.code === 'string'
}

/**
 * 派生类判定：先过基类判定，再比构造器写入的 name 字面量
 */
function matchesDerivedErrorShape(error: unknown, name: string): boolean {
  return isGeomStoreError(error) && error.name === name
}

/**
 * 检查是否为GeomStoreError
 *
 * @param {unknown} error - 要检查的错误对象
 * @returns {error is GeomStoreError} 是否为GeomStoreError
 *
 * @example
 * ```typescript
 * try {
 *   store.dispatch('action')
 * } catch (error) {
 *   if (isGeomStoreError(error)) {
 *     console.log(error.code, error.context)
 *   } else {
 *     // 处理其他类型的错误
 *   }
 * }
 * ```
 */
export function isGeomStoreError(error: unknown): error is GeomStoreError {
  return error instanceof GeomStoreError || matchesGeomStoreErrorShape(error)
}

/**
 * 检查是否为ActionError
 *
 * @param {unknown} error - 要检查的错误对象
 * @returns {error is ActionError} 是否为ActionError
 */
export function isActionError(error: unknown): error is ActionError {
  return matchesDerivedErrorShape(error, 'ActionError')
}

/**
 * 检查是否为StateError
 *
 * @param {unknown} error - 要检查的错误对象
 * @returns {error is StateError} 是否为StateError
 */
export function isStateError(error: unknown): error is StateError {
  return matchesDerivedErrorShape(error, 'StateError')
}

/**
 * 检查是否为SelectorError
 *
 * @param {unknown} error - 要检查的错误对象
 * @returns {error is SelectorError} 是否为SelectorError
 */
export function isSelectorError(error: unknown): error is SelectorError {
  return matchesDerivedErrorShape(error, 'SelectorError')
}

/**
 * 检查是否为PluginError
 *
 * @param {unknown} error - 要检查的错误对象
 * @returns {error is PluginError} 是否为PluginError
 */
export function isPluginError(error: unknown): error is PluginError {
  return matchesDerivedErrorShape(error, 'PluginError')
}

/**
 * 检查是否为ComposeError
 *
 * @param {unknown} error - 要检查的错误对象
 * @returns {error is ComposeError} 是否为ComposeError
 */
export function isComposeError(error: unknown): error is ComposeError {
  return matchesDerivedErrorShape(error, 'ComposeError')
}

/**
 * 检查是否为ValidationError
 *
 * @param {unknown} error - 要检查的错误对象
 * @returns {error is ValidationError} 是否为ValidationError
 */
export function isValidationError(error: unknown): error is ValidationError {
  return matchesDerivedErrorShape(error, 'ValidationError')
}

/**
 * 根据错误代码创建错误实例
 *
 * @param {ErrorCode} code - 错误代码
 * @param {string} message - 错误消息
 * @param {Record<string, unknown>} [context] - 错误上下文
 * @param {unknown} [cause] - 触发本次失败的原始抛出值，随实例的 cause 保留
 * @returns {GeomStoreError} 对应的错误实例
 *
 * @example
 * ```typescript
 * const error = createError(
 *   ErrorCode.ACTION_NOT_FOUND,
 *   'Action not found',
 *   { actionName: 'missing' }
 * )
 * // 返回 ActionError 实例
 * ```
 */
export function createError(code: ErrorCode, message: string, context?: Record<string, unknown>, cause?: unknown): GeomStoreError {
  switch (code) {
    case ErrorCode.ACTION_NOT_FOUND:
    case ErrorCode.ACTION_EXECUTION_ERROR:
    case ErrorCode.ACTION_TIMEOUT:
    case ErrorCode.ACTION_CANCELLED:
      return new ActionError(message, code, context, cause)

    case ErrorCode.STATE_KEY_NOT_FOUND:
    case ErrorCode.STATE_UPDATE_ERROR:
    case ErrorCode.STATE_TYPE_ERROR:
      return new StateError(message, code, context, cause)

    case ErrorCode.SELECTOR_NOT_FOUND:
    case ErrorCode.SELECTOR_EXECUTION_ERROR:
    case ErrorCode.SELECTOR_CACHE_ERROR:
      return new SelectorError(message, code, context, cause)

    case ErrorCode.PLUGIN_NOT_FOUND:
    case ErrorCode.PLUGIN_INSTALLATION_ERROR:
    case ErrorCode.PLUGIN_EXECUTION_ERROR:
      return new PluginError(message, code, context, cause)

    case ErrorCode.STORE_NAME_CONFLICT:
    case ErrorCode.STORE_DEPENDENCY_ERROR:
    case ErrorCode.STORE_COMPOSE_ERROR:
      return new ComposeError(message, code, context, cause)

    case ErrorCode.VALIDATION_ERROR:
    case ErrorCode.TYPE_ERROR:
    case ErrorCode.PARAMETER_ERROR:
      return new ValidationError(message, code, context, cause)

    default:
      // name 留空取基类默认；cause 是第 5 位形参，故显式占位
      return new GeomStoreError(message, code, context, undefined, cause)
  }
}
