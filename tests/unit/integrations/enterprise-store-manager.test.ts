/**
 * 企业集成 - StoreManager 的淘汰边界
 */

import { StoreManager } from '@/integrations/enterprise/store-manager.js'

describe('StoreManager 的淘汰边界', () => {
  it('候选全部是当前用户时无可淘汰目标，不抛错', () => {
    const manager = new StoreManager(1)

    const first = manager.switchUser('only-user')
    const second = manager.switchUser('another-user')

    expect(first).toBeDefined()
    expect(second).toBeDefined()
    expect(manager.getCurrentStore()).toBe(second)
  })
})
