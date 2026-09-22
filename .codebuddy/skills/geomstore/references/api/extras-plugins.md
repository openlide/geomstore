# `./extras/plugins` API 参考（自动生成）

> **本文件由 `scripts/generate-skill-api-reference.mjs` 从 `dist/**/*.d.ts` 生成，请勿手工编辑。**
>
> - 来源版本：`@openlide/geomstore@0.5.1`
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
    /** 存储key（字符串或函数） */
    key?: string | ((storeName: string) => string);
    /** 存储后端 */
    storage?: StorageBackend;
    /** 状态过滤器 */
    filter?: (state: S) => Partial<S>;
    /** 状态验证器（恢复前校验，返回 false 则拒绝恢复） */
    validate?: (state: unknown) => state is S;
    /** 是否恢复状态 */
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
 * @property {number} [maxSize=50] - 最大快照数量
 * @property {(state: S) => boolean} [filter] - 过滤函数，决定是否记录快照
 * @property {boolean} [autoRecord=true] - 是否自动记录快照
 *
 * @example
 * ```typescript
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
    /** 最大快照数量 */
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
 */
export declare class WxStorageBackend implements StorageBackend {
    /** 经 globalThis 读取 wx，避免直接引用未声明的小程序全局标识符 */
    private get wxApi();
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
