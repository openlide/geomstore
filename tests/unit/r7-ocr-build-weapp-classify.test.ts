/**
 * 第七轮 R7 回归锁：build-weapp 在「仓库根经由 junction 抵达」的检出下仍要真的清空旧产物
 *
 * 背景：classifyEntry 原先拿 `path.resolve(full)` 去和 `fs.realpathSync(full)` 比，
 * 两侧参照系不同源，与 clean-dist / minify-dist 的同一函数（正本）漂移。minify-dist
 * 确实踩过：dist 经 junction 抵达时整棵目录树被判成 link，压缩「成功」而产物原样未动。
 * build-weapp 这边把判据对齐到正本，消除的是同源函数之间的口径漂移。
 *
 * 口径说明（不要把本条读成「旧写法在本脚本里可复现」）：本脚本的 projectRoot 取自
 * import.meta.url，Node 已解析过重解析点；dist-weapp 自身是链接的场景又由
 * rejectUntrustedTarget 提前中止。所以旧写法在本脚本里当下未必可达——本条锁的是
 * 「链接化检出下清理照常发生」这条不变式，而不是旧缺陷的可复现性。
 *
 * 沿用 r6-f1-04-build-scripts 的验证方式：临时目录里搭出 junction 化的仓库根，
 * 以子进程跑脚本本体，断言文件系统副作用（产物目录真的被清掉）而不是只看退出码——
 * 脚本在清空之后还有转译/镜像校验等步骤，fixture 不完整时退出码非零是预期的。
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const repoRoot = path.resolve(__dirname, '..', '..')
const scriptsDir = path.join(repoRoot, 'scripts')

function copyScript(name: string, workspace: string): string {
  const target = path.join(workspace, 'scripts', name)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(path.join(scriptsDir, name), target)
  return target
}

function writeFile(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

function runScript(script: string, cwd: string): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [script], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { status: 0, stdout, stderr: '' }
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string }
    return { status: failure.status ?? -1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' }
  }
}

describe('R7 build-weapp：仓库根经由链接到达时产物目录仍要真的清空', () => {
  it('junction 化的项目根：旧产物被删除，且不报「未能清空」', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'r7-build-weapp-'))
    const realRoot = path.join(workspace, 'real-root')
    const linkedRoot = path.join(workspace, 'linked-root')
    const script = copyScript('build-weapp.mjs', realRoot)
    copyScript('weapp-entries.mjs', realRoot)

    // 旧产物：两层真实子目录。判据错时它们被当成 link，removeLink 抛错后构建中止
    writeFile(path.join(realRoot, 'dist-weapp', 'core', 'store', 'Store.js'), 'exports.x = 1')
    writeFile(path.join(realRoot, 'dist-weapp', 'index.js'), 'exports.x = 1')
    // 夹具要越过脚本前置的几道门禁（子路径收集 / 产物镜像校验），否则清理那一步根本走不到：
    // exports 至少要有一个指向 ./dist 下 .js 的子路径，且它对应的 src 入口与 dist 产物都得在
    writeFile(
      path.join(realRoot, 'package.json'),
      JSON.stringify(
        {
          name: '@openlide/geomstore',
          version: '0.0.0',
          miniprogram: 'dist-weapp',
          exports: {
            '.': { default: './dist/index.js' },
            './core': { default: './dist/core/index.js' },
          },
        },
        null,
        2,
      ),
    )
    writeFile(path.join(realRoot, 'src', 'index.ts'), 'export const x = 1')
    writeFile(path.join(realRoot, 'src', 'core', 'index.ts'), 'export const y = 1')
    writeFile(path.join(realRoot, 'dist', 'index.js'), 'export const x = 1')
    writeFile(path.join(realRoot, 'dist', 'core', 'index.js'), 'export const y = 1')
    // esbuild 探活排在清理**之前**，临时工作区没有 node_modules 就会在这一步中止，
    // 永远走不到本条要验的删除分支。给一个只满足 `build()` 形状的桩即可：
    // 本条只关心清空副作用，之后的转译/镜像校验成败与它无关
    writeFile(path.join(realRoot, 'node_modules', 'esbuild', 'package.json'), JSON.stringify({ name: 'esbuild', version: '0.0.0-stub', main: 'index.js' }))
    writeFile(path.join(realRoot, 'node_modules', 'esbuild', 'index.js'), 'module.exports = { build: async () => ({ errors: [], warnings: [] }) }')
    fs.symlinkSync(realRoot, linkedRoot, 'junction')

    const result = runScript(script, linkedRoot)

    expect(result.stderr).not.toContain('未能清空 dist-weapp')
    // 判据正确时旧产物被清掉（esbuild 随后可能重建同名空目录，所以断言的是旧文件而非目录本身）
    expect(fs.existsSync(path.join(realRoot, 'dist-weapp', 'core', 'store', 'Store.js'))).toBe(false)
    expect(fs.existsSync(path.join(realRoot, 'dist-weapp', 'index.js'))).toBe(false)
  })
})
