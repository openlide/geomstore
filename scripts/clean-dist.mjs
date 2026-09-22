/**
 * 构建前置清理：删除 dist 旧产物（prebuild 钩子）。
 *
 * 为什么必须清理：`tsc` 不会移除「源文件已删除」的旧产物。
 * 历史上 core/error → core/errors + extras/error 的迁移、Optimizations.ts /
 * TypeValidator.ts 的删除，都在 dist 里留下了尸体——实测 11 个文件 / 131.7 KB，
 * 占全部 js 产物的 19.3%。
 *
 * 除了纯体积浪费，这些残留还会让**早已废弃的导入路径继续可达**，
 * 等于对外暴露「已删除 API 的旧实现」，绕过 package.json exports 的收口——
 * 这是正确性问题，不只是体积问题。
 *
 * 实现说明：不使用 `fs.rmSync(dir, { recursive: true })`。
 * 部分环境（如 IDE 注入的删除 shim）会把它重定向到「回收站」，该操作在目录被
 * 占用时会整批失败；逐文件 `unlinkSync` + 自底向上 `rmdirSync` 在这些环境下稳定可用。
 * 清理失败只告警不中断构建：tsc 仍会覆盖同名产物，残留属于「未清理干净」而非「构建错误」，
 * 为环境怪癖中断开发链路得不偿失。
 *
 * 上述「只告警」的豁免不适用于「目标不可信」：dist 若是符号链接 / Windows junction，
 * existsSync/readdirSync 会跟随到链接的真实落点，删掉的就是仓库外的文件——不可回滚，
 * 与环境怪癖不同类，必须以退出码 1 中止（prebuild 失败会阻断整条构建链）。
 *
 * 与 postbuild-dist.mjs 的分工：本脚本负责「清空」，postbuild 负责「补丁」
 * （写 type 标记、剔除 sourcemap）。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(projectRoot, 'dist')

/** 递归统计文件数（仅用于日志） */
function countFiles(dir) {
  let n = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    n += entry.isDirectory() ? countFiles(path.join(dir, entry.name)) : 1
  }
  return n
}

/**
 * 确认 dist 就是「仓库内那个真实目录」，返回 null 或人可读的拒绝理由。
 *
 * 删除不可回滚，所以判定取 realpath 全等而不是「仍在项目根之内」：
 * 指向仓库内别处（例如被误链到 src）的重解析点同样必须拒绝。
 * Windows junction 的 lstat().isSymbolicLink() 行为不稳定，realpathSync 则一定解析重解析点，
 * 故以 realpath 为准；lstat 只用于把「是链接」这件事说清楚。
 */
function rejectUntrustedTarget() {
  const realDist = fs.realpathSync(distDir)
  const expected = path.join(fs.realpathSync(projectRoot), 'dist')
  // Windows 路径大小写不敏感（盘符 D: / d: 都可能出现），直接 === 会误判成「不可信」
  const same =
    process.platform === 'win32' ? realDist.toLowerCase() === expected.toLowerCase() : realDist === expected
  if (!same) {
    const via = fs.lstatSync(distDir).isSymbolicLink() ? '符号链接' : '链接或 junction'
    return `dist 是${via}，真实落点为 ${realDist}（期望 ${expected}）`
  }
  if (!fs.statSync(realDist).isDirectory()) {
    return `dist 不是目录，而是文件：${realDist}`
  }
  return null
}

/** 自底向上删除目录树（见文件头「实现说明」） */
function removeDirTree(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      removeDirTree(full)
      fs.rmdirSync(full)
    } else {
      fs.unlinkSync(full)
    }
  }
}

if (!fs.existsSync(distDir)) {
  console.log('[clean-dist] dist not present; nothing to clean')
} else {
  const untrusted = rejectUntrustedTarget()
  if (untrusted) {
    console.error(
      `[clean-dist] 已中止：${untrusted}。\n` +
        '            自底向上的 unlink/rmdir 会删掉链接目标里的真实文件（可能在仓库之外），不可回滚。\n' +
        '            请让 dist 恢复为仓库内的真实目录后再构建。',
    )
    process.exit(1)
  }
  // 统计仅用于日志，且发生在删除之前：readdirSync 抛错（EACCES/ENOTDIR/Windows 占用）
  // 若不被兜住会让整个 prebuild 中断，违背本脚本「清理失败只告警不中断构建」的承诺
  let before = 0
  try {
    before = countFiles(distDir)
  } catch (error) {
    console.warn(`[clean-dist] WARN: 无法统计 dist 文件数（${error instanceof Error ? error.message : String(error)}）。`)
  }
  try {
    removeDirTree(distDir)
    fs.rmdirSync(distDir)
  } catch (error) {
    console.warn(
      `[clean-dist] WARN: 未能清空 dist（${error instanceof Error ? error.message : String(error)}）。\n` +
        '            构建将继续，但 dist 中可能残留源文件已删除的旧产物。',
    )
  }
  // 后置校验：日志不能只由「有没有抛错」推断结果——removeDirTree 可能在半途失败后
  // 只留下告警，也可能整个目录被外部进程重建。以 dist 是否真的消失为准；仍按本脚本
  // 头部的既定策略只告警、不改退出码（残留属「未清理干净」，不是构建错误）。
  if (!fs.existsSync(distDir)) {
    console.log(`[clean-dist] removed dist (${before} files)`)
  } else {
    let remaining = -1
    try {
      remaining = countFiles(distDir)
    } catch {
      // 统计失败不改变结论：目录还在本身就是需要人看一眼的信号
    }
    console.warn(
      `[clean-dist] WARN: dist 未被清空，仍有 ${remaining < 0 ? '未知数量' : remaining} 个文件残留` +
        `（清理前有 ${before} 个）。构建继续，但旧产物（含已删除 API 的 .js/.d.ts）可能被一并发布。`,
    )
  }
}
