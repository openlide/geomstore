/**
 * Extras 示例：Action 装饰器
 *
 * 覆盖：withLog / withRetry / withCache / withThrottle（含 assumeAsync）等装饰器的组合使用。
 *
 * 发布包等价导入：`@openlide/geomstore/extras/action`
 *
 * 注：装饰器依赖 `experimentalDecorators`（本仓库编译配置已开启）。
 */

import { withCache, withLog, withRetry, withThrottle, withTimeout } from '../../src/extras/action.js'

class UserService {
  private requestCount = 0

  /** 调用日志：记录参数、耗时与异常 */
  @withLog()
  async fetchProfile(userId: string): Promise<{ id: string; name: string }> {
    this.requestCount += 1
    // 真实场景替换为 wx.request / fetch
    return Promise.resolve({ id: userId, name: `user-${userId}` })
  }

  /** 结果缓存：TTL 内同参调用直接返回缓存，避免重复请求 */
  @withCache({ ttl: 30_000 })
  async fetchSettings(): Promise<Record<string, unknown>> {
    return Promise.resolve({ theme: 'light' })
  }

  /** 失败重试 + 单次超时：网络抖动场景 */
  @withRetry({ retries: 2, delay: 200 })
  @withTimeout(3000)
  async syncRemote(): Promise<string> {
    return Promise.resolve('synced')
  }

  /**
   * 节流：滚动/拖拽等高频调用
   *
   * `assumeAsync: true` 用于「非 async 语法但返回 Promise」的方法被抑制的场景，
   * 保证被抑制的调用同样返回 Promise，调用方 await 不会拿到 undefined。
   */
  @withThrottle(200, { leading: true, trailing: true })
  reportScroll(offset: number): void {
    console.log('上报滚动位置:', offset)
  }

  getRequestCount(): number {
    return this.requestCount
  }
}

const service = new UserService()

void service.fetchProfile('42').then((profile) => console.log('用户:', profile.name))
void service.fetchSettings().then((settings) => console.log('设置:', settings))
void service.syncRemote().then((result) => console.log('同步结果:', result))
service.reportScroll(120)
service.reportScroll(240) // 窗口内被抑制，窗口结束时以最新参数补发

console.log('\n✅ 装饰器样例完成')
