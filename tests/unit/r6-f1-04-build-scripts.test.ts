/**
 * 第六轮 R6-031 / R6-077 / R6-078 / R6-032 回归锁：构建链脚本的命令级冒烟
 *
 * `scripts/*.mjs` 不在 jest 的采集与 eslint 射程内（见 eslint.config.js 的 ignores），
 * 沿用第五轮 R5-018/R5-022 确立的验证方式：在临时目录里搭出真实触发面（symlink 化的
 * 仓库根、junction 化的 dist/package.json、缺 dist 的门禁调用），以子进程跑脚本本体，
 * 断言**退出码 + stderr 文案 + 文件系统副作用**三件事。
 *
 * 四条锁分别对应：
 * - R6-031：仓库根经由链接到达时，dist 内每个真实目录都被判成 link → 清理整体空转；
 * - R6-077：postbuild 的 type 标记写入跟随重解析点（写穿 dist 之外）；
 * - R6-078：verify 的临时加载区在抛错路径上泄漏，且缺 dist 时是一条裸 ENOENT 栈；
 * - R6-032：`miniprogram` 字段可以指向从未被门禁验过的目录而全绿出包。
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const repoRoot = path.resolve(__dirname, '..', '..')
const scriptsDir = path.join(repoRoot, 'scripts')

/** 建一个一次性工作区（每用例独立，互不残留） */
function makeWorkspace(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `r6-f1-04-${name}-`))
  return fs.realpathSync(dir)
}

function writeFile(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

function copyScript(name: string, workspace: string): string {
  const target = path.join(workspace, 'scripts', name)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(path.join(scriptsDir, name), target)
  return target
}

interface RunResult {
  status: number
  stdout: string
  stderr: string
}

/** 跑脚本：允许非零退出码，把 stdout/stderr 与退出码原样交回断言 */
function runScript(script: string, options: { cwd: string; env?: Record<string, string> }): RunResult {
  try {
    const stdout = execFileSync(process.execPath, [script], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { status: 0, stdout, stderr: '' }
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string }
    return { status: failure.status ?? -1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' }
  }
}

describe('R6-031 clean-dist：仓库根经由链接到达时仍要真的清空 dist', () => {
  it('符号链接化的项目根：dist 整树被删除、日志按真实文件数计', () => {
    const workspace = makeWorkspace('clean')
    const realRoot = path.join(workspace, 'real-root')
    const linkedRoot = path.join(workspace, 'linked-root')
    const script = copyScript('clean-dist.mjs', realRoot)

    // dist 里放三层真实目录 + 4 个文件；旧判据把每个目录算成 1 个文件
    writeFile(path.join(realRoot, 'dist', 'core', 'cache', 'LRUCache.js'), 'export {}')
    writeFile(path.join(realRoot, 'dist', 'core', 'cache', 'LRUCache.d.ts'), 'export {}')
    writeFile(path.join(realRoot, 'dist', 'index.js'), 'export {}')
    writeFile(path.join(realRoot, 'dist', 'index.d.ts'), 'export {}')
    fs.symlinkSync(realRoot, linkedRoot, 'junction')

    const result = runScript(script, { cwd: linkedRoot })
    const distViaLink = path.join(linkedRoot, 'dist')

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('removed dist (4 files)')
    expect(result.stdout).not.toContain('WARN')
    expect(fs.existsSync(path.join(realRoot, 'dist'))).toBe(false)
    expect(fs.existsSync(path.join(realRoot, 'scripts', 'clean-dist.mjs'))).toBe(true)
    // 经链接路径判定的 dist 目录本身也被摘掉（旧行为：只剩一条 WARN，dist 原样留下）
    expect(fs.existsSync(distViaLink)).toBe(false)
  })

  it('dist 内部的 junction 仍按 link 处理：只删链接本身，绝不删目标内容', () => {
    const workspace = makeWorkspace('cleanlink')
    const root = workspace
    const script = copyScript('clean-dist.mjs', root)
    const outside = path.join(workspace, 'outside')
    writeFile(path.join(outside, 'keep.js'), 'export {}')
    writeFile(path.join(root, 'dist', 'index.js'), 'export {}')
    fs.mkdirSync(path.join(root, 'dist'), { recursive: true })
    fs.symlinkSync(outside, path.join(root, 'dist', 'linked'), 'junction')

    const result = runScript(script, { cwd: root })

    expect(result.status).toBe(0)
    expect(fs.existsSync(path.join(root, 'dist'))).toBe(false)
    expect(fs.existsSync(path.join(outside, 'keep.js'))).toBe(true)
  })
})

describe('R6-077 postbuild-dist：dist 与 type 标记都不得写穿重解析点', () => {
  it('dist/package.json 是链接时以退出码 1 中止，且链接目标内容一字不改', () => {
    const workspace = makeWorkspace('marker')
    const script = copyScript('postbuild-dist.mjs', workspace)
    const outside = path.join(workspace, 'outside-manifest')
    writeFile(path.join(outside, 'placeholder'), '')
    writeFile(path.join(workspace, 'dist', 'index.js'), 'export {}')
    fs.symlinkSync(outside, path.join(workspace, 'dist', 'package.json'), 'junction')

    const result = runScript(script, { cwd: workspace })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('dist/package.json 不是普通文件')
    expect(fs.readFileSync(path.join(outside, 'placeholder'), 'utf8')).toBe('')
    expect(fs.existsSync(path.join(outside, 'package.json'))).toBe(false)
  })

  it('dist 整体是 junction 时先中止：不在链接目标里建 package.json、不删 map', () => {
    const workspace = makeWorkspace('distjunction')
    const script = copyScript('postbuild-dist.mjs', workspace)
    const outside = path.join(workspace, 'elsewhere')
    writeFile(path.join(outside, 'index.js'), 'export {}')
    writeFile(path.join(outside, 'index.js.map'), '{"version":3}')
    fs.symlinkSync(outside, path.join(workspace, 'dist'), 'junction')

    const result = runScript(script, { cwd: workspace })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('已中止')
    expect(fs.existsSync(path.join(outside, 'package.json'))).toBe(false)
    expect(fs.existsSync(path.join(outside, 'index.js.map'))).toBe(true)
  })

  it('正常仓库内真实 dist：合并 type 标记并剔除 map（不得因新增守卫而误伤）', () => {
    const workspace = makeWorkspace('happy')
    const script = copyScript('postbuild-dist.mjs', workspace)
    writeFile(path.join(workspace, 'dist', 'package.json'), JSON.stringify({ name: 'geomstore-dist' }, null, 2))
    writeFile(path.join(workspace, 'dist', 'core', 'index.js'), 'export {}')
    writeFile(path.join(workspace, 'dist', 'core', 'index.js.map'), '{"version":3}')
    writeFile(path.join(workspace, 'dist', 'core', 'style.css.map'), '{"version":3}')

    const result = runScript(script, { cwd: workspace })
    const marker = JSON.parse(fs.readFileSync(path.join(workspace, 'dist', 'package.json'), 'utf8')) as Record<string, unknown>

    expect(result.status).toBe(0)
    expect(marker).toEqual({ name: 'geomstore-dist', type: 'module' })
    expect(fs.existsSync(path.join(workspace, 'dist', 'core', 'index.js.map'))).toBe(false)
    expect(fs.existsSync(path.join(workspace, 'dist', 'core', 'style.css.map'))).toBe(true)
  })
})

describe('R6-078 verify-weapp：缺 dist 走可读文案且不泄漏临时加载区', () => {
  it('只跑了 build:weapp（无 dist）时 bail 退出码 1，tmpdir 里不留 geomstore-weapp-verify-*', () => {
    const workspace = makeWorkspace('verify')
    const script = copyScript('verify-weapp-bundle.mjs', workspace)
    copyScript('weapp-entries.mjs', workspace)
    const fakeTmp = path.join(workspace, 'tmp')
    fs.mkdirSync(fakeTmp, { recursive: true })
    writeFile(path.join(workspace, 'package.json'), JSON.stringify({ miniprogram: 'dist-weapp', exports: { '.': { default: './dist/index.js' } } }, null, 2))
    writeFile(path.join(workspace, 'src', 'index.ts'), 'export const x = 1')
    writeFile(path.join(workspace, 'dist-weapp', 'index.js'), 'exports.x = 1')

    const result = runScript(script, { cwd: workspace, env: { TMPDIR: fakeTmp, TEMP: fakeTmp, TMP: fakeTmp } })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('找不到 dist/')
    expect(result.stderr).not.toContain('ENOENT')
    expect(fs.readdirSync(fakeTmp).filter((entry) => entry.startsWith('geomstore-weapp-verify-'))).toEqual([])
  })

  it('抛错路径同样收掉加载区：产物目录里有读不动的条目时不留残骸', () => {
    const workspace = makeWorkspace('verifythrow')
    const script = copyScript('verify-weapp-bundle.mjs', workspace)
    copyScript('weapp-entries.mjs', workspace)
    const fakeTmp = path.join(workspace, 'tmp')
    fs.mkdirSync(fakeTmp, { recursive: true })
    writeFile(path.join(workspace, 'package.json'), JSON.stringify({ miniprogram: 'dist-weapp', exports: { '.': { default: './dist/index.js' } } }, null, 2))
    writeFile(path.join(workspace, 'src', 'index.ts'), 'export const x = 1')
    writeFile(path.join(workspace, 'dist', 'index.js'), 'export const x = 1')
    writeFile(path.join(workspace, 'dist-weapp', 'index.js'), 'exports.x = 1')
    // 产物目录里挂一个指向不存在目录的 junction：遍历到它时 readdirSync 抛 ENOENT，
    // 这条抛错发生在临时加载区建立之后（修复前它是 listJs 的调用点，位于 mkdtemp 之后）
    fs.symlinkSync(path.join(workspace, 'no-such-dir'), path.join(workspace, 'dist-weapp', 'dangling'), 'junction')

    const result = runScript(script, { cwd: workspace, env: { TMPDIR: fakeTmp, TEMP: fakeTmp, TMP: fakeTmp } })
    const leaked = fs.readdirSync(fakeTmp).filter((entry) => entry.startsWith('geomstore-weapp-verify-'))

    expect(result.status).toBe(1)
    expect(leaked).toEqual([])
  })
})

describe('R6-032 prepack：miniprogram 字段必须与被门禁验过的产物目录同源', () => {
  const stubScript = 'generate-subpath-stubs.mjs'

  function prepareFixture(miniprogram: string | undefined): { script: string; cwd: string } {
    const workspace = makeWorkspace('stubs')
    const script = copyScript(stubScript, workspace)
    const pkg: Record<string, unknown> = { name: '@openlide/geomstore', version: '0.0.0', exports: { '.': { default: './dist/index.js' } } }
    if (miniprogram !== undefined) pkg.miniprogram = miniprogram
    writeFile(path.join(workspace, 'package.json'), JSON.stringify(pkg, null, 2))
    writeFile(path.join(workspace, 'dist-weapp', 'index.js'), 'exports.x = 1')
    writeFile(path.join(workspace, 'dist', 'index.js'), 'export {}')
    return { script, cwd: workspace }
  }

  it('字段写成 dist（存在、含 .js、无 files 白名单可查）时 prepack 以退出码 1 拦下', () => {
    const { script, cwd } = prepareFixture('dist')
    writeFile(path.join(cwd, 'dist', 'package.json'), JSON.stringify({ type: 'module' }, null, 2))

    const result = runScript(script, { cwd })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('miniprogram 字段指向 dist/')
    expect(result.stderr).toContain('pnpm run verify:weapp')
  })

  it('字段缺失同样拦下（微信会退回拼接 main 那条事故路径）', () => {
    const { script, cwd } = prepareFixture(undefined)

    const result = runScript(script, { cwd })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('没有 miniprogram 字段')
  })

  it('字段指向 dist-weapp 时不再报同源问题（其余前置条件不在本条射程内）', () => {
    const { script, cwd } = prepareFixture('dist-weapp')

    const result = runScript(script, { cwd })

    expect(result.stderr).not.toContain('门禁（pnpm run verify:weapp）验的是')
    expect(result.stderr).not.toContain('没有 miniprogram 字段')
  })
})
