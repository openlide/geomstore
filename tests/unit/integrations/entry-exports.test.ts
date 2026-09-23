/**
 * `@openlide/geomstore/integrations` 子入口的导出可达性与转发正确性
 *
 * 该入口全是 `export { x } from './y.js'` 形式的转发：编译后每个转发项是一个 getter，
 * 只有真正访问属性才会执行它。此前**没有任何测试 import 过这个桶**（各集成测试一律走叶子
 * 模块），于是两条问题都无人看守：转发项拼错 / 指错路径要等到消费者 import 才暴露；
 * 入口与叶子实现漂移（同名不同函数）也照样通过测试。
 *
 * 因此这里不用 `toBeDefined()`（恒真断言），而是：
 * 1. 按名逐项与**叶子模块的同一绑定**做引用相等比较——转发错到别的实现就红；
 * 2. 断言导出的键集合与文档承诺**逐字相同**——多一条静默死导出、少一条已承诺 API 都红。
 *    （`docs/API.md` 的集成入口小节与 `SKILL.md` 的引入路径表就是按这份清单写的。）
 */

import * as integrations from '@/integrations/index.js'
import { withAppStore } from '@/integrations/with-app-store.js'
import { withComponentStore, withPageStore } from '@/integrations/with-store.js'
import { bindActions, bindMappings, cleanupBindings, exposeStoreAPI, parseMapping, performAutoInject } from '@/integrations/utils.js'
import { OfflineManager } from '@/integrations/enterprise/offline.js'
import { StoreManager, storeManager } from '@/integrations/enterprise/store-manager.js'
import { createUserStore } from '@/integrations/enterprise/user-store.js'
import { initBackgroundSync, unregisterBackgroundSync } from '@/integrations/enterprise/background-sync.js'
import { initHotUpdate, restoreFromHotUpdate } from '@/integrations/enterprise/hot-update.js'
import { createEnterpriseApp } from '@/integrations/enterprise/wechat-enterprise.js'

/** 文档承诺的运行时导出清单（类型导出不计入键集） */
const PROMISED_EXPORTS = [
  'bindActions',
  'bindMappings',
  'cleanupBindings',
  'createEnterpriseApp',
  'createUserStore',
  'exposeStoreAPI',
  'initBackgroundSync',
  'initHotUpdate',
  'OfflineManager',
  'parseMapping',
  'performAutoInject',
  'restoreFromHotUpdate',
  'storeManager',
  'StoreManager',
  'unregisterBackgroundSync',
  'withAppStore',
  'withComponentStore',
  'withPageStore',
] as const

describe('integrations 子入口：转发正确、清单一致', () => {
  it('每个转发项与叶子模块是同一个绑定（不是同名重建）', () => {
    expect(integrations.withPageStore).toBe(withPageStore)
    expect(integrations.withComponentStore).toBe(withComponentStore)
    expect(integrations.withAppStore).toBe(withAppStore)

    expect(integrations.parseMapping).toBe(parseMapping)
    expect(integrations.bindMappings).toBe(bindMappings)
    expect(integrations.bindActions).toBe(bindActions)
    expect(integrations.performAutoInject).toBe(performAutoInject)
    expect(integrations.exposeStoreAPI).toBe(exposeStoreAPI)
    expect(integrations.cleanupBindings).toBe(cleanupBindings)

    expect(integrations.createUserStore).toBe(createUserStore)
    expect(integrations.StoreManager).toBe(StoreManager)
    expect(integrations.storeManager).toBe(storeManager)
    expect(integrations.OfflineManager).toBe(OfflineManager)
    expect(integrations.initHotUpdate).toBe(initHotUpdate)
    expect(integrations.restoreFromHotUpdate).toBe(restoreFromHotUpdate)
    expect(integrations.initBackgroundSync).toBe(initBackgroundSync)
    expect(integrations.unregisterBackgroundSync).toBe(unregisterBackgroundSync)
    expect(integrations.createEnterpriseApp).toBe(createEnterpriseApp)
  })

  it('导出键集与文档清单逐字相同（不多不少）', () => {
    expect(Object.keys(integrations).sort()).toEqual([...PROMISED_EXPORTS].sort())
  })

  it('纯工具函数经本入口调用与经叶子模块调用结果一致', () => {
    // `parseMapping` 是唯一的纯函数（无副作用、不碰 wx），拿它验「入口调用路径」真的通
    const arrayForm = integrations.parseMapping(['count', 'total'])
    const leafForm = parseMapping(['count', 'total'])

    expect(arrayForm).toEqual(leafForm)
    expect(arrayForm).toEqual({ count: 'count', total: 'total' })
  })
})
