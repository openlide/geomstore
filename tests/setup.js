/**
 * 测试环境全局设置
 * @file tests/setup.ts
 */

// Mock 微信小程序 API
wx = {
  request: jest.fn(),
  setStorageSync: jest.fn(),
  getStorageSync: jest.fn(),
  removeStorageSync: jest.fn(),
  showToast: jest.fn(),
  hideToast: jest.fn(),
  showLoading: jest.fn(),
  hideLoading: jest.fn(),
  createSelectorQuery: jest.fn(() => ({
    select: jest.fn().mockReturnThis(),
    selectAll: jest.fn().mockReturnThis(),
    selectViewport: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([])
  })),
  nextTick: jest.fn((callback) => setTimeout(callback, 0)),
  // 高精度计时（模拟小程序 wx.getPerformance，底层复用 Node 的 performance.now）
  getPerformance: jest.fn(() => ({ now: () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) })),
}

// Mock 微信小程序环境
const mockPage = jest.fn()
const mockComponent = jest.fn()

// Mock getApp函数
const mockGetApp = jest.fn(() => ({
  globalData: {}
}))

Page = mockPage
Component = mockComponent
getApp = mockGetApp

// 设置测试超时
jest.setTimeout(10000)

// 全局 afterEach：确保每个测试结束后恢复真实定时器并清理未决的定时器，
// 避免 Jest worker 因泄漏的定时器而无法优雅退出。
afterEach(() => {
  // 恢复真实定时器（部分测试会使用 jest.useFakeTimers）
  try {
    jest.useRealTimers()
  } catch {
    // 忽略：测试套件可能在非 jest 环境中（理论上不会发生）
  }
})

// 错误处理
process.on('unhandledRejection', (error) => {
  console.error('[Test Setup] Unhandled Promise Rejection:', error)
})

process.on('uncaughtException', (error) => {
  console.error('[Test Setup] Uncaught Exception:', error)
})

console.log('[Test Setup] Environment initialized')
console.log('[Test Setup] Node version:', process.version)
console.log('[Test Setup] Platform:', process.platform)

// 定义 __DEV__ 全局常量（用于 isProduction 检测）
globalThis.__DEV__ = process.env.NODE_ENV !== 'production'
