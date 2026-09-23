/**
 * 第六轮 f1-02 回归锁：库版本号四处同步（R6-018）
 *
 * 版本号散在四处：`package.json`、`src/integrations/enterprise/hot-update.ts` 的
 * `LIBRARY_VERSION`、`.codebuddy/skills/geomstore/SKILL.md`（frontmatter description、
 * 正文「当前版本」、文末「当前对应 vX.Y.Z」三处），以及 `references/api/*.md` 的
 * 「来源版本」行（由 `scripts/generate-skill-api-reference.mjs` 生成）。
 * CONTRIBUTING 的发版第 4 步是纯手工的（重跑生成器 + 手改 SKILL.md 三处），此前门禁只钉住了
 * package.json ↔ hot-update 这一对（`tests/integration/enterprise.test.ts` 反查 version），
 * 漏跑生成器或漏改 SKILL.md 都不会让 lint / typecheck / test / CI 任何一条变红。
 * 本用例把其余两处也钉到 package.json 这一个事实来源上。
 */

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(__dirname, '../..')

const { name: pkgName, version: pkgVersion } = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
  name: string
  version: string
}

const skillDir = path.join(repoRoot, '.codebuddy/skills/geomstore')

/** 取正则的第一个捕获组；锚点找不到就抛错，不让版本漂移伪装成「无此条目」 */
function firstMatch(source: string, pattern: RegExp, label: string): string {
  const matched = pattern.exec(source)
  if (!matched || matched[1] === undefined) {
    throw new Error(`${label} 里没匹配到 ${pattern.source}——锚点被改动，请同步本用例`)
  }
  return matched[1]
}

describe('R6-018: 库版本号四处一致的门禁', () => {
  it('package.json 的 version 是事实来源（可解析的 x.y.z）', () => {
    expect(pkgVersion).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('hot-update 的 LIBRARY_VERSION 与 package.json 同步', () => {
    const source = readFileSync(path.join(repoRoot, 'src/integrations/enterprise/hot-update.ts'), 'utf8')
    expect(firstMatch(source, /const LIBRARY_VERSION = '([^']+)'/, 'src/integrations/enterprise/hot-update.ts')).toBe(pkgVersion)
  })

  it('SKILL.md 的三处版本号与 package.json 同步', () => {
    const source = readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8')
    expect(firstMatch(source, /@openlide\/geomstore，v(\d+\.\d+\.\d+)/, 'SKILL.md frontmatter description')).toBe(pkgVersion)
    expect(firstMatch(source, /当前版本 \*\*v(\d+\.\d+\.\d+)\*\*/, 'SKILL.md 正文「当前版本」')).toBe(pkgVersion)
    expect(firstMatch(source, /当前对应 v(\d+\.\d+\.\d+)/, 'SKILL.md 资源清单「当前对应」')).toBe(pkgVersion)
  })

  it('references/api/*.md 的「来源版本」行与 package.json 同步', () => {
    const apiDir = path.join(skillDir, 'references/api')
    const files = readdirSync(apiDir).filter((file) => file.endsWith('.md'))
    // 生成器按入口拆分出 12 个文件；目录被清空/漏生成时也要变红，故先卡数量
    expect(files.length).toBeGreaterThanOrEqual(12)

    const pattern = new RegExp(`> - 来源版本：\\\`${pkgName}@(\\d+\\.\\d+\\.\\d+)\\\``)
    for (const file of files) {
      const source = readFileSync(path.join(apiDir, file), 'utf8')
      expect(firstMatch(source, pattern, `references/api/${file}`)).toBe(pkgVersion)
    }
  })
})
