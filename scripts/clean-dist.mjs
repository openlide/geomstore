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
 * dist **内部**的链接不在那道守卫的射程内，由 removeDirTree 用 lstat 单独处理：
 * 只删链接本身，绝不递归进目标。
 * 两道配套规则：①存在性判定用 lstat 而不是 existsSync，否则**断链**的 dist 会被当成
 * 「不存在」而打出 nothing to clean、绕过守卫，把链接留给 tsc 去跟随；
 * ②守卫与删除之间隔着一次全树统计，故 removeDirTree 在删第一个文件前再校验一遍，
 * 让「判定」与「不可回滚的删除」不可分离。
 *
 * 与 postbuild-dist.mjs 的分工：本脚本负责「清空」，postbuild 负责「补丁」
 * （写 type 标记、剔除 sourcemap）。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(projectRoot, 'dist')

const reasonOf = (error) => (error instanceof Error ? error.message : String(error))

/** 路径等价判定：Windows 大小写不敏感，盘符 D: / d: 都可能出现 */
function samePath(a, b) {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/** lstat 版存在性判定：不存在返回 null，其余错误照抛（调用方按「状态不可确认」处理） */
function lstatOrNull(target) {
  try {
    return fs.lstatSync(target)
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null
    throw error
  }
}

/**
 * 条目分类：'link'（重解析点，只删链接本身）| 'dir'（真实目录，可递归）| 'file'。
 *
 * 用 lstat + realpath 双重判定：lstat 反映链接本身，realpathSync 一定解析重解析点。
 * 只信其一都不够——readdir 的 Dirent 与 lstat 在部分 Windows/Node 组合下会把 junction
 * 报告成普通目录，此时递归就会删掉链接目标（可能在仓库之外）里的真实文件。
 * realpath 失败时按 'link' 处理：本脚本的删除不可回滚，判不准时宁可留下残留（外层只告警），
 * 也不能冒删错目录的风险。
 *
 * 参照系必须两侧同源（都经 realpath 解析）：左侧 realpathSync(full) 会解析整条路径上的
 * 重解析点，而右侧若只用 path.resolve(full)（仅绝对化、不解析），那么**仓库根本身经由
 * 符号链接到达**时（POSIX 的 /tmp、/var/folders、bind mount、symlink 过的 workspace；
 * Windows 下 realpathSync 还会展开 8.3 短名）两侧恒不相等，dist 内每个真实目录都会被判成
 * 'link'：countFiles 把整目录算成 1 个文件、removeDirTree 走 unlinkSync/rmdirSync 抛错，
 * 最后只剩一条 WARN —— 本脚本存在的理由（清掉源已删除的旧产物）被整体抹掉。
 * 故先解析**父目录**再拼条目名，与左侧同源于真实路径空间。
 */
function classifyEntry(full) {
  const stat = fs.lstatSync(full)
  if (stat.isSymbolicLink()) return 'link'
  if (!stat.isDirectory()) return 'file'
  let real
  try {
    real = fs.realpathSync(full)
  } catch {
    return 'link'
  }
  // 父目录同样解析不动时按 'link' 收尾：判不准的保守侧与 realpathSync(full) 一致
  let realParent
  try {
    realParent = fs.realpathSync(path.dirname(full))
  } catch {
    return 'link'
  }
  return samePath(real, path.join(realParent, path.basename(full))) ? 'dir' : 'link'
}

/** 递归统计文件数（仅用于日志）：链接按 1 个条目计，绝不跟随进目标 */
function countFiles(dir) {
  let n = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    n += classifyEntry(full) === 'dir' ? countFiles(full) : 1
  }
  return n
}

/**
 * 删除重解析点本身（符号链接 / junction），绝不进入其目标。
 * Windows 上目录型链接用 unlink 会 EPERM，rmdir 才是删链接；POSIX 上反过来，
 * 故先 unlink、失败再 rmdir，两者都失败时抛出 unlink 的错误（更接近真实原因）。
 */
function removeLink(full) {
  try {
    fs.unlinkSync(full)
  } catch (unlinkError) {
    try {
      fs.rmdirSync(full)
    } catch {
      throw unlinkError
    }
  }
}

/**
 * 自底向上删除目录树（见文件头「实现说明」）。
 *
 * checkRoot 只由顶层调用传 true：在动第一个文件之前重做一遍可信校验，
 * 让「判定」与「删除」不可分离。main 里那道校验与这里之间隔着 countFiles 的
 * 整轮 readdir + realpath，这段时间足够另一个进程把 dist 换成链接（TOCTOU），
 * 而一旦开始删就不可回滚。
 */
function removeDirTree(dir, checkRoot = false) {
  if (checkRoot) {
    const untrusted = rejectUntrustedTarget()
    if (untrusted) abortUntrusted(untrusted)
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    // 顶层 realpath 守卫只覆盖 dist 本身：dist 内部的链接同样指向别处，
    // 必须走 classifyEntry 单独处理，否则等于绕过那道守卫。
    const kind = classifyEntry(full)
    if (kind === 'link') {
      removeLink(full)
    } else if (kind === 'dir') {
      removeDirTree(full)
      fs.rmdirSync(full)
    } else {
      fs.unlinkSync(full)
    }
  }
}

/**
 * 确认 dist 就是「仓库内那个真实目录」，返回 null 或人可读的拒绝理由。
 *
 * 删除不可回滚，所以判定取 realpath 全等而不是「仍在项目根之内」：
 * 指向仓库内别处（例如被误链到 src）的重解析点同样必须拒绝。
 * Windows junction 的 lstat().isSymbolicLink() 行为不稳定，realpathSync 则一定解析重解析点，
 * 故以 realpath 为准；lstat 只用于把「是链接」这件事说清楚。
 *
 * 这一串解析调用全都兜住：本函数的契约是「返回理由或 null」，realpath/lstat 在
 * 竞态（dist 刚被删掉）、EACCES、断链（realpath 目标不存在）下会抛错，未捕获就等于
 * 用一条内部栈取代了「目标不可信 → 退出码 1 + 可执行建议」这条既定分级。
 */
function rejectUntrustedTarget() {
  try {
    const realDist = fs.realpathSync(distDir)
    const expected = path.join(fs.realpathSync(projectRoot), 'dist')
    if (!samePath(realDist, expected)) {
      const via = fs.lstatSync(distDir).isSymbolicLink() ? '符号链接' : '链接或 junction'
      return `dist 是${via}，真实落点为 ${realDist}（期望 ${expected}）`
    }
    if (!fs.statSync(realDist).isDirectory()) {
      return `dist 不是目录，而是文件：${realDist}`
    }
    return null
  } catch (error) {
    return `dist 的真实路径无法确认（${reasonOf(error)}），可能是断链或已被并发删除`
  }
}

/** 不可信目标的统一出口：无论哪一道校验失败，文案与退出码都必须一致 */
function abortUntrusted(reason) {
  console.error(
    `[clean-dist] 已中止：${reason}。\n` +
      '            自底向上的 unlink/rmdir 会删掉链接目标里的真实文件（可能在仓库之外），不可回滚。\n' +
      '            请让 dist 恢复为仓库内的真实目录后再构建。',
  )
  process.exit(1)
}

// existsSync 会跟随链接：dist 是断链时它报「不存在」，本脚本就会打出
// 「nothing to clean」、跳过可信校验，把那个链接留给 tsc 去跟随（写穿到链接目标）。
// 故用 lstat 判存在——链接本身无论指向什么都算存在。
let distExists = false
try {
  distExists = lstatOrNull(distDir) !== null
} catch (error) {
  abortUntrusted(`dist 的状态无法确认（${reasonOf(error)}）`)
}

if (!distExists) {
  console.log('[clean-dist] dist not present; nothing to clean')
} else {
  const untrusted = rejectUntrustedTarget()
  if (untrusted) abortUntrusted(untrusted)
  // 统计仅用于日志，且发生在删除之前：readdirSync 抛错（EACCES/ENOTDIR/Windows 占用）
  // 若不被兜住会让整个 prebuild 中断，违背本脚本「清理失败只告警不中断构建」的承诺
  let before = null
  try {
    before = countFiles(distDir)
  } catch (error) {
    console.warn(`[clean-dist] WARN: 无法统计 dist 文件数（${reasonOf(error)}）。`)
  }
  const beforeText = before === null ? '未知数量' : `${before} 个文件`
  const beforeLog = before === null ? 'file count unreadable' : `${before} files`
  try {
    removeDirTree(distDir, true)
    fs.rmdirSync(distDir)
  } catch (error) {
    console.warn(`[clean-dist] WARN: 未能清空 dist（${reasonOf(error)}）。\n` + '            构建将继续，但 dist 中可能残留源文件已删除的旧产物。')
  }
  // 后置校验：日志不能只由「有没有抛错」推断结果——removeDirTree 可能在半途失败后
  // 只留下告警，也可能整个目录被外部进程重建。以 dist 是否真的消失为准；仍按本脚本
  // 头部的既定策略只告警、不改退出码（残留属「未清理干净」，不是构建错误）。
  let stillThere = true
  try {
    stillThere = lstatOrNull(distDir) !== null
  } catch {
    // 连 lstat 都读不动：按「还在」处理，这同样是必须人看一眼的信号
  }
  if (!stillThere) {
    // 计数失败时不能报 (0 files)：那与「清空了一个空目录」长得一模一样，
    // 而本脚本存在的意义正是把残留产物这件事说清楚
    console.log(`[clean-dist] removed dist (${beforeLog})`)
  } else {
    let remaining = null
    try {
      remaining = countFiles(distDir)
    } catch {
      // 统计失败不改变结论：目录还在本身就是需要人看一眼的信号
    }
    const remainingText = remaining === null ? '未知数量' : `${remaining} 个文件`
    console.warn(
      `[clean-dist] WARN: dist 未被清空，仍有 ${remainingText} 残留（清理前有 ${beforeText}）。` +
        '构建继续，但旧产物（含已删除 API 的 .js/.d.ts）可能被一并发布。',
    )
  }
}
