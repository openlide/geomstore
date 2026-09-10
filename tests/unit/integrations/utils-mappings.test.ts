/**
 * bindMappings：取值边界与 undefined 退化
 */

import { bindMappings } from '@/integrations/utils.js'

describe('bindMappings 的取值边界', () => {
  function setup(values: Record<string, unknown>) {
    const updates: Array<Record<string, unknown>> = []
    let notify: () => void = () => {}
    bindMappings(
      {},
      { present: 'present', missing: 'missing', nan: 'nan' },
      (key) => values[key],
      (patch) => updates.push(patch),
      (callback) => {
        notify = callback
        return () => {}
      },
    )
    return { updates, notify: () => notify() }
  }

  it('undefined 值被过滤不入 updates', () => {
    const { updates } = setup({ present: 1, missing: undefined, nan: NaN })

    expect(updates[0]).toEqual({ present: 1, nan: NaN })
    expect(Object.prototype.hasOwnProperty.call(updates[0], 'missing')).toBe(false)
  })

  it('NaN 与自身视为相等，无变化时不触发 setter', () => {
    const { updates, notify } = setup({ present: 1, missing: undefined, nan: NaN })
    updates.length = 0

    notify()

    expect(updates).toHaveLength(0)
  })

  it('后续由 undefined 变为有值时该键被下发', () => {
    const values: Record<string, unknown> = { present: 1, missing: undefined, nan: NaN }
    const { updates, notify } = setup(values)
    updates.length = 0

    values.missing = 'now'
    notify()

    expect(updates[0]).toEqual({ missing: 'now' })
  })
})

describe('bindMappings 的 undefined 退化', () => {
  it('键值由有值变为 undefined 时该键不下发（过滤 undefined）', () => {
    const values: Record<string, unknown> = { present: 1 }
    const updates: Array<Record<string, unknown>> = []
    let notify: () => void = () => {}
    bindMappings(
      {},
      { present: 'present' },
      (key) => values[key],
      (patch) => updates.push(patch),
      (callback) => {
        notify = callback
        return () => {}
      },
    )
    updates.length = 0

    values.present = undefined
    notify()

    expect(updates).toHaveLength(0)
  })
})
