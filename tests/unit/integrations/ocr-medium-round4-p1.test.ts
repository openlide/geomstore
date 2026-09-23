/**
 * OCR medium 第4轮 分片1（G3 integrations）回归
 *
 * 逐条锁定 .ocr-fix/groups/G3-integrations-plugins-medium-p1.md 中判定为 fix 的行为：
 * #324（FP 佐证：无 version 的旧备份不误报）、#325、#326、#331、#332、#335、#336、#337、#339、#340
 */

import { createStore } from '@/index.js'
import { storage } from '@/integrations/enterprise/env.js'
import { initHotUpdate, restoreFromHotUpdate } from '@/integrations/enterprise/hot-update.js'
import { createUserStore } from '@/integrations/enterprise/user-store.js'
import { StoreManager } from '@/integrations/enterprise/store-manager.js'

// ==================== 可控 wx mock（Map 后端） ====================

const mockMap: Record<string, unknown> = {}
const setStorageSync = jest.fn((key: string, value: unknown) => {
  mockMap[key] = value
})
const getStorageSync = jest.fn((key: string) => mockMap[key])
const removeStorageSync = jest.fn((key: string) => {
  delete mockMap[key]
})
const request = jest.fn()
const applyUpdate = jest.fn()
let updateReadyCb: (() => void) | undefined
const getUpdateManager = jest.fn(() => ({
  onUpdateReady: (cb: () => void) => {
    updateReadyCb = cb
  },
  onUpdateFailed: () => {},
  applyUpdate,
}))
// 弹窗直接确认：驱动「确认时备份 → 写标记 → applyUpdate」全链路
const showModal = jest.fn((options: { success?: (res: { confirm: boolean }) => void }) => {
  options.success?.({ confirm: true })
})

;(globalThis as { wx?: unknown }).wx = {
  setStorageSync,
  getStorageSync,
  removeStorageSync,
  request,
  getUpdateManager,
  showModal,
  showToast: jest.fn(),
  showLoading: jest.fn(),
  hideLoading: jest.fn(),
}

beforeEach(() => {
  Object.keys(mockMap).forEach((key) => delete mockMap[key])
  updateReadyCb = undefined
  jest.clearAllMocks()
})

describe('hot-update 备份载荷校验', () => {
  it('#325 timestamp 缺失的损坏备份按过期处理：返回 false 并清理两个键', () => {
    const store = createStore({ name: 'ru-no-ts', state: { score: 0 } })
    const backupKey = 'backup_no_ts'
    mockMap[backupKey] = JSON.stringify({ state: { score: 99 }, version: '1.0.0' })
    mockMap[`${backupKey}__pending_update_launch`] = JSON.stringify(true)
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      // 修复前：Date.now() - undefined = NaN，NaN > BACKUP_EXPIRY_MS 为 false，
      // 过期门禁被静默绕过、任意陈旧的损坏备份照常被恢复
      expect(restoreFromHotUpdate(store, backupKey)).toBe(false)
      expect(store.state.score).toBe(0)
      expect(mockMap[backupKey]).toBeUndefined()
      expect(mockMap[`${backupKey}__pending_update_launch`]).toBeUndefined()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('#325 timestamp 为非有限数字（NaN/Infinity）同样按过期处理', () => {
    const store = createStore({ name: 'ru-nan-ts', state: { score: 0 } })
    const backupKey = 'backup_nan_ts'
    mockMap[backupKey] = { state: { score: 99 }, version: '1.0.0', timestamp: Number.NaN }
    mockMap[`${backupKey}__pending_update_launch`] = 'true'
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      expect(restoreFromHotUpdate(store, backupKey)).toBe(false)
      expect(store.state.score).toBe(0)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('#324 旧版无 version 字段的备份：不误报版本不一致，仍正常恢复', () => {
    const store = createStore({ name: 'ru-no-ver', state: { score: 0 } })
    const backupKey = 'backup_no_ver'
    mockMap[backupKey] = JSON.stringify({ state: { score: 42 }, timestamp: Date.now() })
    mockMap[`${backupKey}__pending_update_launch`] = JSON.stringify(true)
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      // 佐证 `backup.version !== undefined` 守卫在运行时有效（非死代码）：
      // 缺字段按「版本未知」静默放行，而非误报 "(undefined) 不一致"
      expect(restoreFromHotUpdate(store, backupKey)).toBe(true)
      expect(store.state.score).toBe(42)
      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('不一致'))
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('#326 initHotUpdate 默认派生键与 restoreFromHotUpdate 同源：备份可被恢复', () => {
    const store = createStore({ name: 'key-demo', state: { counter: 1 } })

    initHotUpdate({ store })
    updateReadyCb!()
    expect(mockMap['store_backup_before_update_key-demo']).toBeDefined()

    store.$patch({ counter: 999 })
    const result = restoreFromHotUpdate(store)

    expect(result).toBe(true)
    expect(store.state.counter).toBe(1)
  })
})

describe('storage 工具兜底', () => {
  it('#331 getStorageSync 抛错时记日志并降级返回 null（不再静默）', () => {
    getStorageSync.mockImplementationOnce(() => {
      throw new Error('storage boom')
    })
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    try {
      expect(storage.get('broken-key')).toBeNull()
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('读取 storage 失败'), expect.anything())
    } finally {
      errorSpy.mockRestore()
      getStorageSync.mockReset()
      getStorageSync.mockImplementation((key: string) => mockMap[key])
    }
  })

  it('#332 undefined/函数值不可序列化：拒绝写入、返回 false 且不触碰 setStorageSync', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    try {
      expect(storage.set('bad-undef', undefined)).toBe(false)
      expect(storage.set('bad-fn', () => 1)).toBe(false)
      expect(storage.set('bad-symbol', Symbol('s'))).toBe(false)
      expect(setStorageSync).not.toHaveBeenCalled()
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('不可序列化'))
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('#332 数字/布尔/对象等合法值写入不受守卫误伤', () => {
    expect(storage.set('num', 0)).toBe(true)
    expect(mockMap['num']).toBe('0')
    expect(storage.set('obj', { a: 1 })).toBe(true)
    expect(mockMap['obj']).toBe('{"a":1}')
  })
})

describe('user-store 同步与校验', () => {
  it('#336 同步地址由 syncUrl 注入；未配置时直接 reject 且不发起请求', async () => {
    request.mockImplementation((options: { success: (res: unknown) => void }) => {
      options.success({ statusCode: 200, data: { userInfo: { name: 'S' } } })
    })

    // R5-273：库内不再内置 `/api/user/sync` 这类业务端点默认值——wx.request 只接受
    // 绝对 URL（且域名要在小程序后台白名单内），相对路径默认值注定失败且无从归因
    const noUrlStore = createUserStore({ userId: 'u336-none' })
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(noUrlStore.dispatch('syncWithServer')).rejects.toThrow(/未配置 syncUrl/)
      expect(request).not.toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }

    const customStore = createUserStore({ userId: 'u336-cus', syncUrl: 'https://api.example.com/user/sync' })
    await customStore.dispatch('syncWithServer')
    expect((request.mock.calls[0][0] as { url: string }).url).toBe('https://api.example.com/user/sync')
  })

  it('#335 同步失败记日志后原样 rethrow，且不污染状态', async () => {
    request.mockImplementation((options: { fail?: (err: unknown) => void }) => {
      options.fail?.(new Error('net down'))
    })
    const store = createUserStore({ userId: 'u335', syncUrl: 'https://api.example.com/user/sync' })
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    try {
      await expect(store.dispatch('syncWithServer')).rejects.toThrow('net down')
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('同步用户信息失败'), expect.anything())
      expect(store.state.userInfo).toBeNull()
      expect(store.state.lastSyncTime).toBeNull()
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('#337 空/纯空白 userId 在入口抛错，不再生成 user-store- 畸形键', () => {
    expect(() => createUserStore({ userId: '' })).toThrow(/userId 不能为空/)
    expect(() => createUserStore({ userId: '   ' })).toThrow(/userId 不能为空/)
    expect(() => new StoreManager().getUserStore('')).toThrow(/userId 不能为空/)
    setStorageSync.mock.calls.forEach(([key]) => expect(key).not.toBe('user-store-'))
  })
})

describe('StoreManager 容量与身份持久化', () => {
  it('#339 仅剩当前用户时不可淘汰：告警而非静默超限，后续插入仍回收最旧非当前账号', () => {
    const manager = new StoreManager(1)
    const storeA = manager.switchUser('cap-a')
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const storeB = manager.switchUser('cap-b')
      // 修复前：无可淘汰候选时 stores 静默达到 maxStores+1，容量契约无声破裂
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('超出上限'))
      expect(storeA.destroyed).toBe(false)
      expect(manager.getCurrentStore()).toBe(storeB)

      // 后续未命中：迭代序中非当前的最旧项（A）被正常回收
      manager.getUserStore('cap-c')
      expect(storeA.destroyed).toBe(true)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('#340 switchUser 持久化 CURRENT_USER_KEY；只读预览不写；logout 清除两键', () => {
    const manager = new StoreManager()
    manager.switchUser('id-persist')
    // 修复前 switchUser 只改内存身份，非 login 路径换号后冷启动恢复上一个账号
    expect(mockMap['current_user_id']).toBe('id-persist')

    manager.getUserStore('preview-only')
    expect(mockMap['current_user_id']).toBe('id-persist')

    mockMap['user-store-id-persist'] = JSON.stringify({ userInfo: { name: 'X' } })
    manager.logout()
    expect(mockMap['current_user_id']).toBeUndefined()
    // #326：logout 删除的持久化键与 userStoreKey 派生（store name）同源
    expect(mockMap['user-store-id-persist']).toBeUndefined()
  })
})
