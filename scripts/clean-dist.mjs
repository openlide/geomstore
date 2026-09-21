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
 * 与 postbuild-dist.mjs 的分工：本脚本负责「清空」，postbuild 负责「补丁」
 * （写 type 标记、剔除 sourcemap）。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')

/** 递归统计文件数（仅用于日志） */
function countFiles(dir) {
  let n = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    n += entry.isDirectory() ? countFiles(path.join(dir, entry.name)) : 1
  }
  return n
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
    console.log(`[clean-dist] removed dist (${before} files)`)
  } catch (error) {
    console.warn(
      `[clean-dist] WARN: 未能清空 dist（${error instanceof Error ? error.message : String(error)}）。\n` +
        '            构建将继续，但 dist 中可能残留源文件已删除的旧产物。',
    )
  }
}
