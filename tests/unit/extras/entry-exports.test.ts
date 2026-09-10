/**
 * extras 各子入口的导出可达性
 *
 * 子入口采用 `export { ... } from` 转发，编译后每个转发项都是一个 getter 函数；
 * 只有真正访问该属性才会执行 getter。本测试逐项访问，确保没有任何转发项
 * 因拼写/路径错误而不可达（同时避免「未被任何测试触及的死导出」）。
 */
import * as extrasIndex from '@/extras/index.js'
import * as extrasPlugins from '@/extras/plugins.js'
import * as extrasPerformance from '@/extras/performance.js'
import * as extrasEnterprise from '@/extras/enterprise.js'
import * as extrasError from '@/extras/error/index.js'

describe('extras 子入口导出可达性', () => {
  it('extras/plugins：内置插件与存储后端', () => {
    expect(extrasPlugins.loggerPlugin).toBeDefined()
    expect(extrasPlugins.persistencePlugin).toBeDefined()
    expect(extrasPlugins.devtoolsPlugin).toBeDefined()
    expect(extrasPlugins.builtinPlugins).toBeDefined()
    expect(extrasPlugins.WxStorageBackend).toBeDefined()
    expect(extrasPlugins.timeTravelPlugin).toBeDefined()
  })

  it('extras/performance：监控与性能插件', () => {
    expect(extrasPerformance.PerformanceMonitor).toBeDefined()
    expect(extrasPerformance.MetricsCollector).toBeDefined()
    expect(extrasPerformance.PerformanceAnalyzer).toBeDefined()
    expect(extrasPerformance.analyzerPlugin).toBeDefined()
    expect(extrasPerformance.createAnalyzerPlugin).toBeDefined()
  })

  it('extras/enterprise：企业级集成门面', () => {
    expect(extrasEnterprise.createEnterpriseApp).toBeDefined()
    expect(extrasEnterprise.createUserStore).toBeDefined()
    expect(extrasEnterprise.StoreManager).toBeDefined()
    expect(extrasEnterprise.storeManager).toBeDefined()
    expect(extrasEnterprise.OfflineManager).toBeDefined()
    expect(extrasEnterprise.initHotUpdate).toBeDefined()
    expect(extrasEnterprise.restoreFromHotUpdate).toBeDefined()
    expect(extrasEnterprise.initBackgroundSync).toBeDefined()
    expect(extrasEnterprise.unregisterBackgroundSync).toBeDefined()
  })

  it('extras/error：错误处理聚合入口', () => {
    expect(extrasError.GeomStoreError).toBeDefined()
    expect(extrasError.ErrorBoundary).toBeDefined()
    expect(extrasError.withErrorBoundary).toBeDefined()
    expect(extrasError.ErrorRecovery).toBeDefined()
    expect(extrasError.ErrorMonitoring).toBeDefined()
    expect(extrasError.createDefaultMonitoring).toBeDefined()
  })

  it('extras 总入口：聚合全部可选能力', () => {
    expect(extrasIndex.loggerPlugin).toBeDefined()
    expect(extrasIndex.persistencePlugin).toBeDefined()
    expect(extrasIndex.analyzerPlugin).toBeDefined()
    expect(extrasIndex.timeTravelPlugin).toBeDefined()
    expect(extrasIndex.PerformanceMonitor).toBeDefined()
    expect(extrasIndex.SnapshotManager).toBeDefined()
    expect(extrasIndex.ActionLoader).toBeDefined()
    expect(extrasIndex.withLog).toBeDefined()
    expect(extrasIndex.createEnterpriseApp).toBeDefined()
  })
})
