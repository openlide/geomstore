/**
 * 测试环境全局设置
 * @file tests/setup.ts
 *
 * 与源码一致使用 ESM 语法；由 ts-jest 按 tsconfig.jest.json 转译为 CommonJS
 * 后在 Jest 运行时中执行（Jest 的 .ts 文件默认按 CJS 加载）。
 */

/**
 * 测试环境注入的小程序侧全局对象形状。
 *
 * 取代此前的 `globalThis as any`：`any` 让这里写错的键名（`Component` 拼错、多写一个 `wx.` 前缀）
 * 静默通过，而所有依赖这些全局的集成测试只会表现为「拿不到 mock」。
 * 值一律为 `unknown`：mock 的具体形状由下面的字面量决定，读取方（测试用例）自行按用途收窄。
 */
interface WxTestGlobals {
  wx?: Record<string, unknown>
  Page?: unknown
  Component?: unknown
  getApp?: unknown
  __DEV__?: boolean
}

const g = globalThis as unknown as WxTestGlobals

/**
 * 测试环境注入的 wx 存储后端：与真机一致的内存读写（键值存在本 Map 里，见 `defaultStorageImpl`）。
 *
 * 此前是裸 `jest.fn()`（恒返回 undefined），于是任何「setStorageSync → getStorageSync」的往返
 * 只能读到 undefined：断言写入内容的用例因错误原因失败，只断言「调用过」的用例则空过。
 * 单个用例仍可 `mockImplementation` 覆盖本默认行为（企业集成用例就是这么模拟读失败的），
 * 覆盖只在该用例内有效 —— 文件末尾的全局 `afterEach` 会把默认实现挂回、并清空本 Map。
 */
const storage = new Map<string, unknown>()

/**
 * 存储四件套的默认实现。
 *
 * 单独命名的原因：全局 `afterEach` 每个用例后要把默认实现**原样挂回**（见文件末尾），
 * 而 `jest.clearAllMocks()` 只清调用历史、不清 `mockImplementation`，
 * 用例内为模拟读失败做的覆盖否则会泄漏到同文件的后续用例。
 */
const defaultStorageImpl = {
  setStorageSync: (key: string, value: unknown) => {
    storage.set(key, value)
  },
  // 真机对不存在的键返回空串；库侧（plugins/builtin.ts 的 wx 适配器）把 undefined/null/'' 一律视为无数据，
  // 故这里保持「无数据即 undefined」，与读不到键的真机语义等价
  getStorageSync: (key: string) => storage.get(key),
  removeStorageSync: (key: string) => {
    storage.delete(key)
  },
  clearStorageSync: () => {
    storage.clear()
  },
}

const mockSetStorageSync = jest.fn(defaultStorageImpl.setStorageSync)
const mockGetStorageSync = jest.fn(defaultStorageImpl.getStorageSync)
const mockRemoveStorageSync = jest.fn(defaultStorageImpl.removeStorageSync)
const mockClearStorageSync = jest.fn(defaultStorageImpl.clearStorageSync)

// Mock 微信小程序 API
g.wx = {
  // 与真机一致：默认立即回调 success（statusCode 200 / 空 data），用例可自行覆盖 fail 分支
  request: jest.fn((options: { success?: (res: { statusCode: number; data: unknown; errMsg: string }) => void } = {}) => {
    options?.success?.({ statusCode: 200, data: {}, errMsg: 'request:ok' })
  }),
  setStorageSync: mockSetStorageSync,
  getStorageSync: mockGetStorageSync,
  removeStorageSync: mockRemoveStorageSync,
  clearStorageSync: mockClearStorageSync,
  showToast: jest.fn(),
  hideToast: jest.fn(),
  showLoading: jest.fn(),
  hideLoading: jest.fn(),
  createSelectorQuery: jest.fn(() => ({
    select: jest.fn().mockReturnThis(),
    selectAll: jest.fn().mockReturnThis(),
    selectViewport: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([]),
  })),
  // 形参显式标注：真机 `wx.nextTick(callback)` 的回调无入参，隐式 any 会让
  // 「传了参数的调用点」在这里静默通过。
  // 排期仍用真实 setTimeout（此处不预装 fake timers），用例自行 useFakeTimers 后
  // 需要手动推进时钟；未推进的残留回调由文件末尾的全局 afterEach clearAllTimers 丢弃
  nextTick: jest.fn((callback: () => void) => setTimeout(callback, 0)),
  // 高精度计时（模拟小程序 wx.getPerformance，底层复用 Node 的 performance.now）
  getPerformance: jest.fn(() => ({ now: () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) })),
}

// Mock 微信小程序环境
const mockPage = jest.fn()
const mockComponent = jest.fn()

// Mock getApp函数
const mockGetApp = jest.fn(() => ({
  globalData: {},
}))

g.Page = mockPage
g.Component = mockComponent
g.getApp = mockGetApp

// 设置测试超时
jest.setTimeout(10000)

// 全局 afterEach：每个用例都回到干净状态 —— 定时器、mock 存储内容、jest.fn 调用历史。
//
// - 先 `clearAllTimers()` 再 `useRealTimers()`：显式丢弃 fake 时钟里尚未执行的回调
//   （如 `wx.nextTick` 的 `setTimeout(callback, 0)`），不依赖「换回真实实现后旧时钟不再被推进」这一隐式后果。
// - 两处都不套 try/catch：本文件由 jest.config.js 的 `setupFilesAfterEnv` 载入，`jest` 必然已定义，
//   原先「可能在非 jest 环境中」的分支是永不命中的死防御代码；实测（jest 30）
//   `jest.clearAllTimers()` 在未启用 fake timers 时同样不抛错，故报告建议的兜底 try/catch 也不采用。
// - `storage.clear()`：此前只有定时器被复位，模块级 `storage` 里的写入会活到同文件的每个后续用例，
//   断言「读回自己写的内容」的用例可以靠上一个用例的残留数据空过（顺序相关的假绿）。
// - `jest.clearAllMocks()`：同理清掉跨用例累积的调用历史（jest.config.js 未开 clearMocks/resetMocks，
//   此前只能靠个别用例自行 `mockClear()`）。它只清 calls/instances/results，不动实现，
//   因此下面再显式把存储 API 的默认实现挂回，覆盖型用例（模拟读失败等）不会泄漏到后续用例。
afterEach(() => {
  jest.clearAllTimers()
  jest.useRealTimers()
  storage.clear()
  jest.clearAllMocks()
  mockSetStorageSync.mockImplementation(defaultStorageImpl.setStorageSync)
  mockGetStorageSync.mockImplementation(defaultStorageImpl.getStorageSync)
  mockRemoveStorageSync.mockImplementation(defaultStorageImpl.removeStorageSync)
  mockClearStorageSync.mockImplementation(defaultStorageImpl.clearStorageSync)
})

// 错误处理：交给 Jest 自带的 unhandledRejection / uncaughtException 处理。
//
// 此前这里注册了两个只 `console.error` 的处理器：真实异步缺陷（未捕获的 Promise 拒绝、
// 未捕获异常）被打一行日志后吞掉，套件照样通过甚至挂住；而本文件每个测试文件都会执行一次，
// 同一个 worker 内共享 `process`，于是每个文件再叠加 2 个监听器 —— 几个文件后就是
// `MaxListenersExceededWarning` 与永久泄漏的 handler。自行抛错只是把同一份职责抄一遍，
// 故直接删除：Node 默认 `--unhandled-rejections=throw`，Jest 会把这类错误报成用例失败。

console.log('[Test Setup] Environment initialized')
console.log('[Test Setup] Node version:', process.version)
console.log('[Test Setup] Platform:', process.platform)

// 定义 __DEV__ 全局常量（用于 isProduction 检测）
g.__DEV__ = process.env.NODE_ENV !== 'production'
