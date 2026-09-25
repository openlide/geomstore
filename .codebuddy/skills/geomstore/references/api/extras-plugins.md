# `./extras/plugins` API 参考（自动生成）

> **本文件由 `scripts/generate-skill-api-reference.mjs` 从 `dist/**/*.d.ts` 生成，请勿手工编辑。**
>
> - 来源版本：`@openlide/geomstore@0.8.1`
> - 内容来源：构建产物类型声明（随 npm 包发布，与安装版本必然一致）
> - 重新生成：`pnpm build && pnpm skill:api`
> - 引入路径：`./extras/plugins`
> - 类型声明：`./dist/extras/plugins.d.ts`
> - 返回索引：[`index.md`](./index.md)

### `PersistenceOptions`

```ts
/**
 * 持久化选项
 */
export interface PersistenceOptions<S extends State = State> {
    /**
     * 存储key（字符串或函数）
     *
     * 缺省为 `geomstore_${store.name}`：键必须在跨会话、跨进程重启后保持稳定，否则
     * restore 永远读不回上次的数据，故默认键**刻意**不含随机后缀。代价是两个 store
     * 落到同一键时互相覆盖——未命名 store 的名字来自模块级计数器（`store-0`…），
     * 而多份 bundle 各有一份计数器（微信构建里重复打包本包是常态）。
     * 稳定与唯一不可兼得：需要隔离时请显式传 key
     */
    key?: string | ((storeName: string) => string);
    /** 存储后端 */
    storage?: StorageBackend;
    /**
     * 状态过滤器：决定哪些键落盘。
     *
     * **保存与恢复两条路径都会套用**（`src/plugins/builtin.ts`：落盘前 `filter(state)`，
     * 恢复时对读出的状态再 `filter(parsedState)` 才 `$patch`），所以它同时是「写出的子集」
     * 和「允许被恢复回来的子集」——只在前一条路径生效的直觉是错的。
     */
    filter?: (state: S) => Partial<S>;
    /** 状态验证器（恢复前校验，返回 false 则拒绝恢复） */
    validate?: (state: unknown) => state is S;
    /** 是否在插件安装时恢复已持久化的状态（默认 `true`；置为 `false` 则只落盘、不回填状态） */
    restore?: boolean;
    /**
     * 防抖延迟（毫秒），默认 0（每次变更立即落盘）。
     *
     * 默认立即写入可保证「变更即持久化」的可靠性，但每次通知都会执行一次
     * `JSON.stringify(整棵状态树)` + 同步 `wx.setStorageSync`（小程序内为阻塞 I/O）。
     * 高频更新场景（输入联想、拖拽、轮询）建议设为 300~500，或配合 `filter`
     * 只持久化必要子集；插件卸载时会自动补写防抖窗口内未落盘的最后一次变更。
     */
    debounce?: number;
    /** 卸载插件时是否清除存储数据（默认 false，仅停止监听，保留已持久化的数据） */
    clearOnUninstall?: boolean;
}
```

### `StorageBackend`

```ts
/**
 * 存储后端接口
 *
 * 仅支持同步后端：persistencePlugin 的恢复与保存均为同步语义，
 * 异步后端（返回 Promise）会在运行时被检测并报错。
 * 如需异步持久化，请在外部自行订阅 store 并处理异步写入。
 *
 * 错误语义（三个方法一致，见 #390）：**存储失败一律抛错**，由调用方决定是否降级——
 * `getItem` 返回 `null` 只代表「键无数据」，不代表「读取失败」，两者不得混用，
 * 否则损坏的存储会被误判为空状态并随后被覆盖。
 * persistencePlugin 已按此契约为三条路径（恢复 / 落盘 / clearOnUninstall）各自 try/catch
 * 并记录日志（落盘失败还会 emit `onError`），自定义后端只要照此抛错即可。
 *
 * 内置实现见 `src/plugins/WxStorageBackend.ts`（`wx.*StorageSync` 适配器）：
 * 本文件只声明契约，带 I/O 的运行时实现与 `persistencePlugin` 同层。
 * `persistencePlugin` **不传** `storage` 时的默认后端同样是这个类（判定与归一化口径
 * 因此只有一处实现），仅在检测不到可用的 wx 同步 API 时降级为内存存储。
 */
export interface StorageBackend {
    /** 获取值（必须同步返回；键不存在返回 null，读取失败抛错） */
    getItem(key: string): string | null;
    /** 设置值（必须同步返回；失败抛错） */
    setItem(key: string, value: string): void;
    /** 删除值（必须同步返回；失败抛错） */
    removeItem(key: string): void;
}
```

### `TimeTravelOptions`

```ts
/**
 * 时间旅行选项
 *
 * @interface TimeTravelOptions
 * @template S - 状态类型
 * @property {number} [maxSize=50] - 最大快照数量（非正整数/非有限值回退到默认值，见 normalizeMaxSize）
 * @property {(state: S) => boolean} [filter] - 过滤函数，决定是否记录快照
 * @property {boolean} [autoRecord=true] - 是否自动记录快照
 *
 * @example
 * ```typescript
 * import type { TimeTravelOptions } from '@openlide/geomstore/extras/plugins'
 *
 * interface MyState {
 *   isDirty: boolean
 *   hasChanges: boolean
 * }
 *
 * const options: TimeTravelOptions<MyState> = {
 *   maxSize: 100,                      // 最多保留100个快照
 *   filter: (state) => {               // 只记录特定状态的快照
 *     return state.isDirty || state.hasChanges
 *   },
 *   autoRecord: true                   // 自动记录所有状态变化
 * }
 * ```
 */
export interface TimeTravelOptions<S extends State = State> {
    /**
     * 最大快照数量（默认 50）
     *
     * 只接受 ≥ 1 的数值，小数向下取整；`NaN`/`Infinity`/`0`/负数等无法作为上限的取值
     * 一律回退到默认值（判据与理由见 `normalizeMaxSize`）
     */
    maxSize?: number;
    /** 过滤函数 */
    filter?: (state: S) => boolean;
    /** 是否自动记录 */
    autoRecord?: boolean;
}
```

### `WxStorageBackend`

```ts
/**
 * 微信存储后端
 *
 * 三个方法都要求 `wx` 与对应 API 真实存在：缺失时**抛错**，绝不 `?.` 短路成 no-op。
 * no-op 的代价是静默的数据损失——`setStorageSync`/`removeStorageSync` 缺失会让写入与删除
 * 「看起来成功」（卸载时 `clearOnUninstall` 因此误报已清除），`getStorageSync` 缺失会被
 * {@link normalizeWxStoredValue} 洗成「键无数据」，随后一次落盘即覆盖真实数据。
 *
 * 环境整体不具备可用 wx 同步存储时应走 `persistencePlugin` 的降级分支（判定见
 * {@link isWxStorageSyncAvailable}），而不是把本类当内存存储用。
 */
export declare class WxStorageBackend implements StorageBackend {
    /** 经 globalThis 读取 wx，避免直接引用未声明的小程序全局标识符 */
    private get wxApi();
    /**
     * 取出 `wx.<name>` 方法本体及其宿主，缺失或不 callable 时抛错。
     *
     * 返回 `{ api, fn }` 而不是只返回函数：`fn.call(api, …)` 保留 wx 的接收者，
     * 部分基础库实现依赖它。
     */
    private resolve;
    /**
     * 统一「记录 + 重抛」口径：三个方法的失败都必须让调用方看见。
     *
     * 读失败不得退化成「键无数据」（随后一次落盘即覆盖真实数据），写/删失败不得静默成功
     * （`clearOnUninstall` 会据此报告「已清除」而数据仍在）。抽成一个方法是为了新增操作时
     * 不会只补上一半行为（只 log 不抛、或只抛不 log），错误文案也只需改一处
     */
    private run;
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}
```

### `builtinPlugins`

```ts
builtinPlugins: Plugin<object>[]
```

### `devtoolsPlugin`

```ts
devtoolsPlugin: Plugin
```

### `loggerPlugin`

```ts
loggerPlugin: Plugin
```

### `persistencePlugin`

```ts
persistencePlugin: Plugin & {
    <S extends State = State>(options?: PersistenceOptions<S>): Plugin<S>;
}
```

### `timeTravelPlugin`

```ts
timeTravelPlugin: <S extends State = State>(options?: TimeTravelOptions<S>) => Plugin
```
