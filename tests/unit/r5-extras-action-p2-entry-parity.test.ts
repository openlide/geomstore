/**
 * extras 总入口的导出面一致性（第五轮 extras-action-p2）
 *
 * - R5-242：总入口的每一段都改为从同能力的**已发布子入口**按名再导出。两处手写清单
 *   描述同一公开面时必然漂移（此前 `ActionStats` / `LogDecoratorOptions` 只在总入口可得，
 *   `@openlide/geomstore/extras/action` 拿不到），本用例逐入口比对值导出集合，
 *   漂移会直接失败而不是等到调用方运行时报 undefined。
 * - R5-185：`LogSink` / `LogPhase` 经 `@openlide/geomstore/extras/action` 可达，
 *   自定义 sink 与 `redact` 无须深链 `decorators/log.js` 即可标注类型。
 */
import * as extrasEntry from '@/extras/index.js'
import * as actionEntry from '@/extras/action.js'
import * as pluginsEntry from '@/extras/plugins.js'
import * as performanceEntry from '@/extras/performance.js'
import * as snapshotEntry from '@/extras/snapshot.js'
import * as enterpriseEntry from '@/extras/enterprise.js'
// LogSink / LogPhase 只经 `extras/action` barrel 给出：一旦漏项，本文件的 tsc 检查即报错
import { withLog, type LogPhase, type LogSink } from '@/extras/action/index.js'
// 此前只在总入口可得、子入口缺失的两个类型：两侧同时导入并要求可互相赋值
import type { ActionStats as ActionStatsFromExtras, LogDecoratorOptions as LogOptionsFromExtras } from '@/extras/index.js'
import type { ActionStats as ActionStatsFromAction, LogDecoratorOptions as LogOptionsFromAction } from '@/extras/action.js'

/**
 * `export *` 不转发 default，`./snapshot.js` 为此显式补了一条 default 再导出。
 * 总入口是策展清单、本就不含 default，比对时排除这一项。
 */
/** 子入口 -> 该入口有、总入口刻意不含的值导出名 */
const EXCLUDED_FROM_EXTRAS = new Map<string, string[]>([['./snapshot.js', ['default']]])

function valueKeys(ns: object): string[] {
  return Object.keys(ns).sort()
}

describe('r5-extras-action-p2: extras 总入口与子入口的导出面一致（R5-242）', () => {
  const cases: Array<[string, object]> = [
    ['./plugins.js', pluginsEntry],
    ['./performance.js', performanceEntry],
    ['./snapshot.js', snapshotEntry],
    ['./action.js', actionEntry],
    ['./enterprise.js', enterpriseEntry],
  ]

  it.each(cases)('%s 的值导出全部可达总入口', (_name, entry) => {
    const exclusions = EXCLUDED_FROM_EXTRAS.get(_name) ?? []
    const fromEntry = valueKeys(entry).filter((key) => !exclusions.includes(key))
    const fromExtras = valueKeys(extrasEntry)

    // 子入口有、总入口没有 = 同一个 API 两个入口给不全（就是本次修掉的漂移）
    expect(fromEntry.filter((key) => !fromExtras.includes(key))).toEqual([])
  })

  it('总入口的值导出不超出五个子入口之和（不夹带第四处来源）', () => {
    const fromEntries = new Set(cases.flatMap(([name, entry]) => valueKeys(entry).filter((key) => !(EXCLUDED_FROM_EXTRAS.get(name) ?? []).includes(key))))

    expect(valueKeys(extrasEntry).filter((key) => !fromEntries.has(key))).toEqual([])
  })

  it('ActionStats / LogDecoratorOptions 在两个入口上都是同一类型', () => {
    const stats: ActionStatsFromExtras = {} as ActionStatsFromAction
    const fromEntry: ActionStatsFromAction = stats
    const logOptions: LogOptionsFromExtras = {} as LogOptionsFromAction
    const logOptionsBack: LogOptionsFromAction = logOptions

    expect([fromEntry, logOptionsBack]).toHaveLength(2)
  })
})

describe('r5-extras-action-p2: LogSink / LogPhase 经公开 barrel 可用（R5-185）', () => {
  it('自定义 sink 与 redact 只需从 `extras/action` 导入即可类型化', async () => {
    const lines: string[] = []
    const sink: LogSink = {
      log: (message: string) => {
        lines.push(message)
      },
      error: (message: string) => {
        lines.push(message)
      },
    }
    // redact 的 phase 形参按 LogPhase 标注：缺该类型时调用方只能深链 decorators/log.js
    const redact = (value: unknown, phase: LogPhase): unknown => (phase === 'args' ? '[redacted]' : value)

    class Host {
      @withLog('ping', { sink, redact })
      async ping(input: number): Promise<number> {
        return input
      }
    }

    expect(await new Host().ping(1)).toBe(1)
    expect(lines).toEqual(['[Action] ping started with args:', '[Action] ping completed with result:'])
  })
})
