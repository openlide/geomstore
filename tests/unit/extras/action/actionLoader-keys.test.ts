/**
 * ActionLoader：perActionKeys 键名形态与共享计数兜底
 */

import { ActionLoader } from '@/extras/action/index.js'

describe('ActionLoader 的键名形态', () => {
  /** wrap 的 setState 为 (key, value) 两参数签名，这里收集写入的键名 */
  async function collectKeys(options: Record<string, unknown>): Promise<string[]> {
    const keys: string[] = []
    const loader = new ActionLoader(options as any)
    const wrapped = loader.wrap(async () => 'ok', 'doIt', (key: string) => {
      keys.push(key)
    })

    await wrapped()

    return keys
  }

  it('perActionKeys=true 时 loading/error 键按 action 名后缀区分', async () => {
    const keys = await collectKeys({ perActionKeys: true })

    expect(keys.some((key) => key.includes('doIt'))).toBe(true)
  })

  it('perActionKeys=false 时键为固定键（无 action 后缀）', async () => {
    const keys = await collectKeys({ perActionKeys: false })

    expect(keys.length).toBeGreaterThan(0)
    expect(keys.every((key) => !key.includes('doIt'))).toBe(true)
  })

  it('共享引用计数被外部清空时按兜底值 1 递减（不出现负计数）', async () => {
    const shared = new Map<string, number>()
    const patches: Array<[string, unknown]> = []
    const loader = new ActionLoader({ sharedLoadingCounts: shared } as any)
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const wrapped = loader.wrap(
      async () => {
        await gate
        return 'ok'
      },
      'slow',
      (key: string, value: unknown) => {
        patches.push([key, value])
      },
    )

    const running = wrapped()
    // 模拟计数在 action 执行期间被外部清空
    shared.clear()
    release()
    await running

    // 递减以 1 为兜底 → 计数归零 → 置 loading=false
    expect(patches.some(([, value]) => value === false)).toBe(true)
    expect(shared.get('loading')).toBe(0)
  })
})
