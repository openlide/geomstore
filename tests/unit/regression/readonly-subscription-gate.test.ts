/**
 * 源码约定门禁 G20：内部订阅必须显式声明 `readOnly`
 *
 * 背景：一次 `store.subscribe(cb)` 的注册属性**默认是「可写」**（`SubscriptionManager.add` 的
 * `readOnly = options?.readOnly ?? false`）。可写注册的代价是全 Store 级别的——
 * `Store._notifyListeners` 一旦发现有可写注册就置 `needsClone`，于是每次通知：
 *   1 份给所有只读注册共享的深拷贝 + 每个可写注册各 1 份深拷贝
 * （`SubscriptionManager.notify` 的 payloads 构造）。也就是说业务代码里漏写一个 `readOnly`，
 * 会让本可以零拷贝走保护 Proxy 的整条通知路径退化成整棵状态树的深拷贝，且 TS 类型上完全看不出来。
 *
 * 为什么改成门禁而不是改默认值：`readOnly` 默认取 `true` 是破坏性变更——依赖「可在回调里
 * 就地改载荷」的既有代码会从「能改」变成「静默改不动」，比多一次深拷贝更难发现。故保持默认，
 * 改为让 `src/**` 内部的每一处订阅调用都必须显式传 `{ readOnly: … }`，把这类遗漏变成红灯。
 *
 * 判据：接收者不是 AsyncBatchNotifier 的 `.subscribe(` 调用
 *   - 必须有第二个实参；
 *   - 第二个实参若是对象字面量，必须含 `readOnly` 属性（写 `{}` 等于没写）。
 * 透传形参（`store.subscribe(cb, subscribeOptions)`）不是对象字面量，按合规处理——
 * 它的类型被 TS 钉死为 `{ readOnly?: boolean }`，不会再漏。
 */

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const repoRoot = path.resolve(__dirname, '../../..')

/** `src/**` 下的全部 TS 源文件 */
const srcTsFiles: string[] = (() => {
  const out: string[] = []
  const walk = (relDir: string): void => {
    for (const e of readdirSync(path.join(repoRoot, relDir), { withFileTypes: true })) {
      const rel = `${relDir}/${e.name}`
      if (e.isDirectory()) walk(rel)
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) out.push(rel)
    }
  }
  walk('src')
  return out.sort()
})()

/**
 * `AsyncBatchNotifier` 自己的 `subscribe(listener)` 与本门禁无关：
 * 它是内部批处理器的 API，没有 `readOnly` 概念，也不走 `SubscriptionManager` 的载荷分配
 */
const isInternalNotifier = (receiver: string): boolean => receiver === 'this._asyncNotifier' || /(^|\.)_?notifier$/.test(receiver)

interface Violation {
  file: string
  line: number
  reason: string
}

function collectViolations(files: string[]): Violation[] {
  const violations: Violation[] = []
  for (const rel of files) {
    const sourceFile = ts.createSourceFile(rel, readFileSync(path.join(repoRoot, rel), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'subscribe') {
        const receiver = node.expression.expression.getText(sourceFile)
        if (!isInternalNotifier(receiver)) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          const at = `${rel}:${line + 1}`
          if (node.arguments.length < 2) {
            violations.push({ file: rel, line: line + 1, reason: `${at} \`${receiver}.subscribe(...)\` 未传 options → 按可写注册，每次通知多做整树深拷贝` })
          } else {
            const second = node.arguments[1]
            if (ts.isObjectLiteralExpression(second)) {
              const hasReadOnly = second.properties.some((p) => p.name !== undefined && ts.isIdentifier(p.name) && p.name.text === 'readOnly')
              if (!hasReadOnly) {
                violations.push({ file: rel, line: line + 1, reason: `${at} options 对象字面量缺少 readOnly（写 \`{}\` 等价于没写）` })
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
  return violations
}

describe('源码约定门禁 G20：内部订阅显式声明 readOnly', () => {
  it('src/** 内不存在未声明 readOnly 的 Store 订阅调用', () => {
    const violations = collectViolations(srcTsFiles)
    expect(violations.map((v) => v.reason)).toEqual([])
  })

  it('门禁本身有效：单参订阅与空 options 都要被判红（变异自测）', () => {
    // 不写临时文件、不改真实源码：把源码文本喂给同一个收集器，只换掉文件名
    const good = `
      const s = createStore({ name: 'x', state: { a: 1 } })
      s.subscribe(() => {}, { readOnly: true })
      s.subscribe(() => {}, optionsForwarded)
    `
    const bad = `
      const s = createStore({ name: 'x', state: { a: 1 } })
      s.subscribe(() => {})
      s.subscribe(() => {}, {})
    `
    const violationsOf = (code: string): Violation[] => {
      const sourceFile = ts.createSourceFile('virtual.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
      const found: Violation[] = []
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'subscribe') {
          const receiver = node.expression.expression.getText(sourceFile)
          if (!isInternalNotifier(receiver)) {
            const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
            if (node.arguments.length < 2) {
              found.push({ file: 'virtual.ts', line: line + 1, reason: 'missing options' })
            } else if (ts.isObjectLiteralExpression(node.arguments[1])) {
              const hasReadOnly = node.arguments[1].properties.some((p) => p.name && ts.isIdentifier(p.name) && p.name.text === 'readOnly')
              if (!hasReadOnly) found.push({ file: 'virtual.ts', line: line + 1, reason: 'missing readOnly' })
            }
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(sourceFile)
      return found
    }

    expect(violationsOf(good)).toEqual([])
    // 两处违规（单参 + 空对象）都要被抓到，且内部批处理器不受影响
    expect(violationsOf(bad)).toHaveLength(2)
    expect(violationsOf(`this._asyncNotifier.subscribe(() => {})`)).toEqual([])
  })
})
