# 分片 scripts — 第五轮（ocrreview.md）逐条判定，22 条

清单：`.ocr-fix/groups5/scripts.md`。拥有文件：
`scripts/{clean-dist,postbuild-dist,generate-subpath-stubs,minify-dist,generate-skill-api-reference}.mjs`。

冒烟方式：脚本副本 + fixture 放在 `.cache/r5-scripts-check/probe{A,B,C,D,E}/`（`.cache/` 由
`.gitignore:41` 覆盖，跑完 `rm -rf`，其他分片的 `r5cd*/r5stub/...` 未动）。
`npx prettier --check` 对 5 个脚本的 LF 副本全通过（工作树 CRLF 是 `core.autocrlf=true` 的既有状态，
HEAD 版本同样如此）；`scripts/**` 在 eslint 与 tsconfig 之外（`npx eslint scripts/clean-dist.mjs`
只给 1 条 `File ignored because of a matching ignore pattern` 警告、0 error、exit 0），
`node --check` 5 个全过。

> **接手复跑**（本分片停在「Now generate-skill-api-reference.mjs」之后）：22 条逐条对过
> `git diff -- scripts/` 与磁盘文件，结论是**磁盘上 5 个脚本的改动全部已落地**，包括被打断处
> 那 4 条（R5-032~R5-035：`RESERVED_FILES`/`skipLibCheck:false`/内容与清空前置/`types` 字符串校验
> 都能在文件里逐行指认，且 e1~e5 探针重跑通过）。判词与磁盘不符之处已就地改正，
> 原先三处「注入做不了、未做端到端」的说法本轮用脚本副本内故障注入补成了端到端（见 a6/a6b、b6/b7）。
> 复跑环境：Node v22.22.2 + Windows，链接一律用 `mklink /J`（`mklink /D` 与 `fs.symlinkSync`
> 本机都 EPERM，无符号链接权限）。

## R5-013  verdict=FIXED  dist 存在但读不动时给中止文案，不再抛内部栈

改前实测（fixture `probeA/a1`：`dist` 是个文件）→ `Error: ENOTDIR: not a directory, scandir ...` + 20 行栈。
改后 `node probeA/a1/scripts/postbuild-dist.mjs` → `[postbuild] 中止：无法读取 dist 目录（ENOTDIR ...）`，exit=1。
同一次 readdir 复用为「非空」判定；递归扫描的每个目录也各自兜错（读不动 → WARN + 汇总点名），
与文件头新增的失败分级一致。a2/a3 复跑正常（exit=0，`.css.map` 未被删、`dist/package.json` 字段仍合并保留）。

## R5-014  verdict=FIXED  注释改为「成功删除数」，并按成功计数实现

`removedMaps++` 位于 `fs.rmSync` 之后（抛错走失败清单），注释与实现同口径；
失败项改成 `{file, reason}` 结构，日志文案不变。a3 实测 `found 2, removed 2, remaining 0`。

## R5-015  verdict=FIXED  残留清单不再被失败清单整段吞掉

删掉 `mapFailures.length === 0` 这道闸门：后置校验现在把「不在失败清单里的残留」单独枚举
（`remaining.maps` 去掉 `reportedFailures`，另加撞名目录与读不动条目两条独立通道）。
三条通道互不依赖，本轮把「删除失败」这一档从替代证据升级为真正的端到端：在脚本副本里注入
（`bad1.js.map` 抛 EPERM、`ghost.js.map` 删除「成功」但文件仍在，正是并发写回的形状），
实测 a6 → 两条 WARN 同时出声：`1 个 sourcemap 未能删除…bad1.js.map: EPERM: injected delete failure`
与 `删除未抛错但 dist 下仍有 1 个 sourcemap：ghost.js.map`；同一 fixture 只把闸门
`&& mapFailures.length === 0` 加回去作对照件 a6b → 只剩第一条 WARN，`ghost.js.map` 全程无人点名
（汇总行仍是 `remaining 2`，即「数对了但从不列举」的原始缺陷形状）。
自然条件下的删除失败注入确实做不到：`attrib +R` 实测拦不住 `fs.rmSync`
（复跑确认：只读位设上后 `rmSync` 仍删成功），句柄占用 / `icacls /deny` 被权限层拦下。
另两档维持原判据：a4 `weird.js.map/`（撞名目录）→ WARN 逐条列出 + `map-named dirs kept 1`，
a5/a8 链接通道同样逐条出声。

## R5-016  verdict=FIXED  链接目录不跟随，但必须上报（跟随才是错方向）

采纳报告给的第一个出口并加严：新增 `classifyEntry`（lstat + realpath，同 clean-dist 的判据），
链接一律不进入。方向不取报告的 `statSync` 解引用——postbuild 是原地删除，
跟随进 junction 等于把删除落到 dist 之外，正是 R5-018 在 clean-dist 里刚关掉的那类口子。
实测 a5（`dist/linkdir` junction → `outside/`，内有 `hidden.js.map`）：
`WARN: 首次扫描 dist 时跳过 1 个链接条目 ... linkdir`（复查一次）、`links skipped 1`，
`outside/hidden.js.map` 与 `precious.txt` 逐字节未动；a8（`dist/link.js.map` junction）只删链接本身。

## R5-017  verdict=FIXED  存在性判定改 lstat，断链的 dist 进可信校验

`existsSync` 跟随链接，断链 junction 会打 `nothing to clean` 绕过守卫。探针（probeB 前置 node -e）：
`b4 existsSync=false | lstat: isDir=false isLink=true | realpath: throws ENOENT` —— 改前正是走
「不存在」分支。改后 `node probeB/b4/scripts/clean-dist.mjs` → `已中止：dist 的真实路径无法确认（ENOENT ...），可能是断链或已被并发删除` + exit 1。
非 ENOENT/ENOTDIR 的 lstat 失败也不当「不存在」，直接按「状态不可确认」中止（b2 真不存在仍 exit 0）。

## R5-019  verdict=FIXED  删除第一个文件之前重做可信校验

`removeDirTree(dir, checkRoot)`：顶层调用传 true，在动第一个条目前再跑一次 `rejectUntrustedTarget()`，
不过则 `abortUntrusted()` → 退出码 1。理由写成注释：main 那道守卫与删除之间隔着 `countFiles` 的整轮
readdir+realpath，这段时间足够把 dist 换成链接。守卫文案与退出码统一由 `abortUntrusted` 出，两处校验同一出口。
dist 内部的链接本就由 `classifyEntry` + `removeLink` 单独处理（R5-018 已落），故只需补根目录这一处。
冒烟：b1（dist 内挂 junction）仍 `removed dist (3 files)` 且 `outside/precious.txt` = `do-not-touch`。

## R5-020  verdict=FIXED  rejectUntrustedTarget 的解析调用全部兜错，契约回到「返回理由或 null」

`realpathSync(distDir)` / `realpathSync(projectRoot)` / `lstatSync` / `statSync` 整段入 try/catch，
抛错即 `return 'dist 的真实路径无法确认（...）'`，由调用方出中止文案 + exit 1；
竞态（守卫之后 dist 被删）不再以内部栈打断 prebuild。实测 b4（断链）与 b5（dist 是文件，
`已中止：dist 不是目录，而是文件：...`）都走文案出口，exit=1。

## R5-021  verdict=FIXED  计数失败不再伪装成 (0 files)

`before` 由 `0` 改 `null`，成功日志分叉为 `removed dist (3 files)` / `removed dist (file count unreadable)`，
残留 WARN 用 `beforeText`/`remainingText`（`未知数量`）。b1 实测正常路径输出 `removed dist (3 files)`。
统计失败这一档本轮补成端到端（真造 EACCES 需要 ACL 改动、被权限层拦下，故在脚本副本里让
`countFiles` 直接抛 `EACCES: injected readdir failure`）：b6（删除仍成功）→
`WARN: 无法统计 dist 文件数（EACCES …）` + `removed dist (file count unreadable)`、exit 0，
不再长得像「清空了一个空目录」；b7（再注入 rmdir 失败让 dist 存活）→
`WARN: dist 未被清空，仍有 未知数量 残留（清理前有 未知数量）`，两侧计数各自独立退化。
后置校验里 `stillThere` 现在也走 lstat（原 `existsSync` 会把「留下断链」误判成已清空）。

## R5-023  verdict=FIXED  没有 files 字段 = 无白名单，跳过覆盖校验

`Array.isArray(pkg.files) ? new Set(...) : null`（改前是空 Set：真值，于是 14 项全被报成 unshipped）。
A/B 对照（同一 fixture，`probeC/c2` 改后 vs `c2b` 只把该表达式退回 `new Set()`）：
`c2` → `[stubs] generated 14 subpath stub dirs`，exit=0；`c2b` → `以下 stub 目录未列入 ... store, hooks, ..., cache`，exit=1。
读/解析 package.json 失败仍走 `problems`，没有放宽成静默。

## R5-024  verdict=FIXED  写盘中途失败回滚 + 可读中止；报告给的「重跑 clean」不够

`clean()` 按 mapping 名字 + 精确 main 判据访问，对「mkdir 成功、writeFileSync 失败」的空目录和
半截 manifest 一律不认，回滚必须自己记账：新增前置校验第 3 条（目标目录不存在或已是本脚本 stub 才允许写，
实测 `c5` → `目录 \`cache\` 已存在且不是本脚本生成的转发 stub，拒绝覆写它的 package.json` + exit 1，
真实 manifest 未被改）+ 逐目录 `{created, previous}` 回滚（新建的整目录删、原有 stub 写回原 manifest）。
端到端（`c7`：在 mapping 里塞一个非法名让第 15 项在 mkdir 处抛错）：
`[stubs] 已中止：生成第 15 个 stub 时写盘失败（ENOENT ... probe?illegal）。已回滚：删除本次新建的 13 个目录、还原 1 个原有 stub。` exit=1，
事后 pkgRoot 只剩 dist/package.json/scripts/store，且 `store/package.json` 回到 `types: "PRE-EXISTING"`。
API-CHANGE: `prepack` 多一道「同名真实目录不得覆写」的前置校验，命中时打包以退出码 1 提前失败（改前会覆写该目录的 package.json 后正常出包）。

## R5-025  verdict=FIXED  一级目录按形状补扫孤儿 stub

`clean()` 末段对**未登记**的一级目录用 `isGeneratedStubTree`：package.json 键恰为 main+types、
两者都落在 dist 之内、目录内其余条目递归满足同一条件（深度上限 `MAX_STUB_DEPTH=3`），才 `rmSync(recursive)`。
实测 `probeC/c4 --clean` → `removed 2 subpath stub dirs（含 2 个 mapping 里已不存在的孤儿 stub）`，
`legacy/`、`oldset/`（含嵌套 `oldset/nested`）被收掉；同时必须存活的四类全部存活：
`plugins/`（main=`../distributed/index.js` + `keep-me.ts`，即 R5-022 判据）、`nearmiss/`（形状对但另有他人文件）、
`named/`（多了 name 键）。`git status` 与打包前逐行一致。
API-CHANGE: `postpack` 的清理面从「mapping 里的 14 个名字」扩到「仓库根一级目录里形状匹配的本脚本产物」；仓库内如留有旧别名 stub，下一次打包后会被收掉，发布面随之少掉那份死转发。

## R5-026  verdict=FIXED  writeAll 回滚已写入文件，「一次性落盘」不再被写成原子

`writeAll` 逐文件记录写成功项，抛错时按内存里的 `original`（后端读取时顺手带上，零额外读盘）还原，
再把原因包成一条可读 Error 交给 main 的 catch（exit 1）。只还原**写成功**的那些：写失败的那个内容没变，
把它算进「必须手工恢复」会把干净的错误说成数据已损坏（第一版就踩到了，已改）。
实测 `probeD/d5`（对 `dist/aaa.js` 用 `attrib +R` 造真实写盘失败）：
`[minify-dist] failed: Error: 压缩结果写盘失败（EPERM ... aaa.js）；2 个已写入的文件已还原为压缩前内容` exit=1，
随后 sha1 比对 `dist` 全部文件与运行前快照「无差异」。d6 正常路径 `12 js files: 1.5 KB -> 0.6 KB (-57.3%)`
（那两个 KB 是 fixture 内容量，不是判据；本轮同一 d6 形状重跑得到 `3.3 KB -> 1.6 KB (-51.1%)`，
文件数、`minifier: terser`、exit=0 三项一致）。

## R5-027  verdict=FIXED  后端返回假值不再静默丢文件

新增 `requireCode`：非字符串一律 `TypeError` 中止；压成空串只在源文件本就是空白/注释
（`isBlankOrComments`）时算合法。esbuild 分支同用一把尺子（原来 `result.code`  undefined 会变成
`writeFileSync(file, undefined)` 的内部抛错）。实测 d1：`empty.js` 与 `comment-only.js` 合法写成 0 字节、
不中止；原实现会把它们从 outputs 里悄悄剔掉，仍打成功行。「原实现」这句本轮对 HEAD 钉死了：
`git show HEAD:scripts/minify-dist.mjs` 的 `minifyWithTerser` 里就是
`if (result.code) outputs.push({ file, code: result.code })` —— 假值直接不进 outputs、
不进任何清单，紧接着的 `writeAll(outputs)` 与成功行照打。
API-CHANGE: 若 dist 出现「只有注释」的 .js，压缩后其内容变为空（改前保留未压缩原文），
`dist 下全部 js 已压缩` 这条对外承诺自此不再靠跳过实现。

## R5-028  verdict=FIXED  链接按「是否藏着未压缩 js」分类，无关链接不再拦发布

`collectJs` 的 `links` 拆成 `jsLinks / dirLinks / otherLinks`（目录链接经 `classifyEntry` 的
lstat+realpath 判定，不再只信 Dirent），只有前两类参与 `--strict` 中止，otherLinks 只 WARN。
实测 `probeD/d2`：lax 模式分别打出 `2 个链接藏着未被压缩的 js（指向 js 的 1 个、指向目录的 1 个）` 与
`1 个链接与 js 无关（断链或指向非 js 文件）...不计入未压缩产物`，exit=0；`--strict` → exit=1。
`d3 --strict`（dist 里只有无关链接）→ 只 WARN，压缩照常完成，exit=0（改前这类链接会计入「未被压缩」并中止发布）。
复跑补一条 fixture 口径，免得后人照着判词造不出同一形状：本机无符号链接权限
（`mklink <文件>` 与 `fs.symlinkSync(...,'file')` 都 EPERM），所以 `jsLinks` 那一档是用
**名字叫 `brokenlink.js` 的悬空 junction** 命中的（`classifyEntry`→link、`statSync` 抛错→非目录、
名字以 `.js` 结尾→jsLinks）；`dirlink`（活 junction→`outside_jsdir/hidden.js`）走 dirLinks、
`irrelevant`（悬空、名字不以 .js 结尾）走 otherLinks。三档分类与两条文案、两个退出码都按原判词复现，
`outside_jsdir/hidden.js` 逐字节未动。

## R5-029  verdict=FIXED  文件头失败分级与 bailNothingToDo 对齐

头注释把「dist 无可压缩内容」从「一律退出码 1」那一档挪到宽松分级那一档（实际行为：
`bailNothingToDo` 非 `--strict` 只告警、exit 0），并补上 R5-028 新定的链接档位；代码未动，
因为「上游没产出 JS」与「没装压缩器」同属非故障。「代码未动」本轮对 HEAD 核过：
`git show HEAD:scripts/minify-dist.mjs` 的 `bailNothingToDo` 函数体与现文件逐行相同（只有文件头
注释块变了）。验证靠 d1/d6 的宽松 exit=0 与 `--strict` exit=1 两向对拍。

## R5-030  verdict=FIXED  两个后端共用有界并发

新增 `mapLimit(items, CONVERT_LIMIT=8, convert)`，esbuild 与 terser 分支都改走它（结果按入参顺序回填，
体积统计与写盘顺序不变），并在常量处写明「峰值内存必然随 dist 线性」这一条来自备齐再落盘的不变式，
这里限的是同时在转换中的文件数。报告说的不对称对 HEAD 核过：旧 esbuild 分支是
`await Promise.all(files.map(...))`（整批同时进后端），旧 terser 分支是 `for (const file of files)` 串行。
实测 d6（12 文件 / 3 层目录）本轮做成逐字节对拍：同一份 fixture（sha1 校验两副本一致）分别跑
新脚本与 `git show HEAD:scripts/minify-dist.mjs` 的副本 → 两边汇总行同为
`12 js files: 3.3 KB -> 1.6 KB (saved 1.7 KB, -51.1%)`，且 `diff <(新 12 文件 sha1) <(HEAD 12 文件 sha1)`
无输出（输出树逐字节相同），即「换共用并发」没有顺带改变压缩结果。

## R5-031  verdict=FIXED  只认「找不到的就是它自己」为未安装

`isMissingItself(error, name)`：`code === 'MODULE_NOT_FOUND'` 且消息点名 `Cannot find module '<name>'`。
探针先证实两种 code 相同、消息不同（`node --input-type=module -e` + 沙箱 node_modules）：
`definitely-not-installed -> Cannot find module 'definitely-not-installed'`、
`broken-pkg -> Cannot find module 'no-such-dep-xyz'`。本轮两条都重跑过并把 code 也打出来：
真未安装 `definitely-not-installed -> code=MODULE_NOT_FOUND | Cannot find module 'definitely-not-installed'`，
d8 沙箱里那个「在、但传递依赖缺失」的 terser `-> code=MODULE_NOT_FOUND | Cannot find module 'no-such-dep-xyz'`
—— 同 code、异名，正是只判 code 会放过去的那一类。
端到端 A/B（`probeD/d8` 沙箱内放一个「在、但传递依赖缺失」的 terser）：
改后 `terser 的加载失败不是「未安装 terser」...` + exit=1；
改前（`d8b`，仅把判据退回 `error?.code === 'MODULE_NOT_FOUND'`）→ `minifier: esbuild`、exit=0 并真的产出了包，
即报告说的「破损安装被静默降级」。
API-CHANGE: `build:release` 在 terser 装坏时由「用幽灵依赖 esbuild 压一遍并发布」改为失败退出。

## R5-032  verdict=FIXED  index.md 进保留名集合，validateEntries 直接拒绝撞名入口

`RESERVED_FILES = new Set(['index.md'])` + validateEntries 逐入口检查（放在同文件名互覆检查之前）。
实测 `probeE/e2`（exports 加 `./index`）→ `入口 \`./index\` 的输出文件名 \`index.md\` 是脚本保留名（...）`，exit=1，
输出目录未被触碰。改前该入口会在索引写完之后把 `index.md` 连同所有链接一起覆盖，且报「成功」。
**磁盘核对（接手时被打断处）**：`RESERVED_FILES` 在文件第 55 行、检查体在 106-112 行（确在 114 行的
互覆检查之前），头注释也已把「有入口撞上脚本保留名」写进中止清单——改动是真的落盘了，不是计划。
复跑 `node probeE/e2/scripts/generate-skill-api-reference.mjs` → 上面那条保留名判词逐字命中、exit=1、
`references/api/` 里仍只有投放的 `PREVIOUS.md`。

## R5-033  verdict=FIXED  程序改按 skipLibCheck:false 建，语义诊断不再是死代码

探针：同一份真 dist 入口，`skipLibCheck=true` → 入口文件诊断 0；`false` → 入口文件诊断 0、源文件 186 个
（今天不误报）。本轮把这条探针原样重跑（拿真 `package.json` 的 11 条字符串 types 直接
`ts.createProgram`，两种 flag 各数一遍）：`skipLibCheck=true | sourceFiles=186 | entry diagnostics=0`、
`skipLibCheck=false | sourceFiles=186 | entry diagnostics=0` —— 「关掉 flag 只是让语义诊断活起来、
不会把第三方噪音算到入口头上」这一条成立。破损输入 `probeE/e4`（往 `dist/index.d.ts` 追加一个引用未定义类型的导出）：
改后 → `[语义] TS2304 @ dist\index.d.ts：Cannot find name 'TotallyUndefinedTypeName'` + exit=1；
改前对照件 `e4b`（同一输入，仅把该 flag 退回 true）→ exit=0 并把破损符号写进参考；
原判词挂在 `e4b` 名下的那两个数（360 符号 / main.md 76.9 KB）其实是**真 dist 副本**那一组的数，
本轮由下面的 `e4rb` 复现，最小 fixture 的 `e4b` 同分支但只有 4 个符号；
不取「只文档化」：那条盲区第四轮已写进注释，报告这次的增量是「它确实抓不住破损声明」，已被 e4/e4b 证实。
注释同步改写，说明噪音只按入口文件取（`collectProblems` 的过滤），第三方的错不会算到这里头上。
**磁盘核对（接手时被打断处）**：`skipLibCheck: false` 就在 `ts.createProgram` 的选项里（第 170 行），
上面 5 行注释即判词所述理由，`collectProblems` 的循环确以 `entryFiles` 为界。复跑三件：
`probeE/e4`（真 dist 副本 + 追加 `export declare const brokenRef: TotallyUndefinedTypeName;`）→
`[skill-api] 中止（输入不可信，未改动已有产出）：\n  [语义] TS2304 @ dist\index.d.ts：Cannot find name
'TotallyUndefinedTypeName'.` exit=1、输出目录只剩投放的哨兵文件；
最小 fixture 对照件 `e4b`（3 入口，仅该 flag 回退 true）→ exit=0 并把破损符号真写进参考
（`grep -c brokenRef main.md` = 2）；本轮另外用**真 dist 的副本**做成同一对：`e4r`（现脚本）→
那条 TS2304 + exit=1，`e4rb`（只回退 flag）→ exit=0 且汇总为 `11 个入口 / 360 个符号`、
`main.md 61 符号 76.9 KB`、破损符号同样落进参考 —— 原判词那两个数字（360 / 76.9 KB）复现一致；
`e1` 用真 dist 证明不误报（见 R5-034 的逐字节对拍）。

## R5-034  verdict=FIXED  内容全部前置备齐后才清空；清空用 withFileTypes + force:true

`documents`（index + 每个入口）在动输出目录之前全部构造完，体积取 `Buffer.byteLength(text)`，
删掉了写盘后的 `statSync`（`statSync` 已从 import 里移除），于是「已清空、却没写成」的窗口只剩最后那串
`writeFileSync`（头注释已如实写明，不做临时目录换名）。删除改 `readdirSync(..., {withFileTypes:true})`
+ `rmSync(..., {force:true})`，`.md` 撞名的**目录**只 WARN 不递归删。
**磁盘核对（接手时被打断处）**：`documents` 数组与 `Buffer.byteLength(text)` 在清空之前
（289-316 行），`mkdirSync` + `readdirSync(OUT_DIR, {withFileTypes:true})` + `rmSync(..., {force:true})`
+ `strayDirs` 全在 318-339 行，`writeFileSync` 循环是清空之后的唯一动作（335 行）；
`statSync` 已从第 33 行的 import 列表里去掉（`grep -n "^import {.*statSync"` = 0 命中，
文件里剩下的唯一一处 `statSync` 是 288 行注释里「不再 writeFileSync + statSync」这句话本身）。复跑两件：
`probeE/e5`：`stale.md` 被清掉、`weirddir.md/` 目录及其 `inner.txt` 原样保留（内容仍是
`IMPORTANT-NOT-TOUCH`）并打出 `WARN: 输出目录下有个叫 \`weirddir.md\` 的**目录** ...`，
历史单文件版 `references/api.md` 一并删除；
`e1` 本轮改成**隔离副本**跑（fixture 根下放真 `package.json` + 真 `dist` + 已提交 `references/api` 的拷贝，
避免动到受版本控制的产出），结果 `11 个入口 / 359 个符号`、exit 0，
`diff -r .codebuddy/skills/geomstore/references/api <fixture>/.../references/api` **无输出**（12 个文件逐字节一致），
耗时 1.3s（原判词 3.3s 是机器负载差异，不是产出差异）。

## R5-035  verdict=FIXED  types 必须是字符串路径，否则显式失败（不抛 TypeError，也不静默漏入口）

`collectEntries` 返回 `{entries, problems}`：非对象值、缺 `types`、`types` 为对象/空串都记一条问题，
与 `validateEntries` 的问题合并后统一走「中止（清单与 exports 不一致，未改动已有产出）」。
实测 `probeE/e3`（`"./cond": {"types": {"import": ..., "require": ...}}`）→
`入口 \`./cond\` 没有字符串形式的 types（实际是 条件式 types 对象）：...`，exit=1；改前该入口会带着对象
去 `path.join` → `TypeError: Path must be a string`。真 package.json 的 11 个入口全是字符串 types，不误伤（e1）。
**磁盘核对（接手时被打断处）**：`collectEntries` 的两个分支（76-79 行非对象值、80-87 行 `typeof value.types !== 'string' || === ''`）
与 92 行的 `{entries, problems}` 返回、143-152 行的合并中止都在文件里。复跑 `probeE/e3` →
`入口 \`./cond\` 没有字符串形式的 types（实际是 条件式 types 对象）：…`、exit=1、输出目录只剩哨兵文件；
「改前」这一半本轮补了真对照件 `e3b`（同一份 package.json 与 dist，只把脚本换成
`git show HEAD:scripts/generate-skill-api-reference.mjs`）→ 它也是 exit=1，但走的是
`node:path:528 TypeError [ERR_INVALID_ARG_TYPE]: The "path" argument must be of type string. Received an instance of Object`
这条内部栈（原判词把它意译成「Path must be a string」，此处按 Node 22 的实际文案钉准）：
同样是失败，一条可执行判词与一坨栈的差别就是这条的价值。

## R5-036  verdict=FP  仓库里没有「禁止嵌套三元」的项目规则（第四轮 #41 判例维持）

复核同第四轮：`grep -rn "ternary" eslint.config.js CONTRIBUTING.md` → 0 命中；
全仓 `grep -rniE "no-nested-ternary|嵌套三元" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist -l`
只命中报告派生物自身，且**本轮重跑时列表比原判词更窄**：`ocr.md` 其实 0 命中（它不含这条主张），
真正命中的是 `ocrreview.md:4117`（报告自己那句「项目规范禁止嵌套三元」）与 `.ocr-fix/**`
（含另一分片的 `groups5/plugins-types-p1.md`、`ledger5.json`、第四轮两份 verdicts、本台账）；
`.codebuddy` 目录内 0 命中。再加一把正面证据：`eslint.config.js` 的 rules 只有
`...tseslint.configs.recommended.rules` + 手写的 `@typescript-eslint/*` 若干条，`grep -c ternary eslint.config.js` = 0，
仓库用的是 `@eslint/js` + typescript-eslint 两个插件、没有 airbnb 之类会带进 `no-nested-ternary` 的预设；
`eslint.config.js:88` 的 ignores 含 `scripts/**`，`lint` 脚本只收 `src tests --ext .ts` → 该文件根本不进 lint。
第四轮对同一主张已判 FP（verdicts/G6-scripts-tools-medium.md #41），本轮无新证据，不推翻，代码未改。

## 冒烟与自验汇总（本轮接手后全部重跑，Node v22.22.2 / Windows）

- `node --check` 5 个脚本全过；LF 副本 `npx prettier --check .cache/r5-lf/scripts/*.mjs` →
  `All matched files use Prettier code style!`（exit 0）；`npx eslint scripts/clean-dist.mjs` →
  0 error / 1 「File ignored」warning / exit 0。
- postbuild：a1（dist 是文件 → `无法读取 dist 目录（ENOTDIR …）` exit 1）/a2/a3（`found 2, removed 2,
  remaining 0`，`.css.map` 逐字节存活、`dist/package.json` 的 name/sideEffects 与 type 合并保留）/
  a4（撞名目录 → `map-named dirs kept 1`、`inner.txt` 存活）/a5（junction → 首扫+复查各一条 WARN、
  `links skipped 1`、`outside/` 未动）/a8（`.js.map` 名 junction：只删链接本身、目标完好）/
  **a6 + a6b（删除失败与静默残留的注入对拍，见 R5-015）**。
- clean-dist：b1（正常 + 内部 junction → `removed dist (3 files)`、`outside/precious.txt` 未动）/
  b2（不存在 → exit 0）/b3（junction dist → 中止）/b4（断链 junction → `真实路径无法确认（ENOENT …）`）/
  b5（dist 是文件 → `dist 不是目录，而是文件`）/ **b6 + b7（计数失败注入，见 R5-021）**。
  b4 的前置判据探针复跑：`existsSync=false | lstat: isDir=false isLink=true | realpath: throws ENOENT`。
- stubs：c1（生成 14 → 幂等再生成 14 → `--clean` removed 14）/c2 vs c2b（无 files 字段：改后 exit 0，
  退回 `new Set()` 的对照件把 14 项全报 unshipped、exit 1）/c3（白名单缺 `error` → exit 1 且零落盘）/
  c4（`removed 2 …（含 2 个 mapping 里已不存在的孤儿 stub）`，`plugins/`+`keep-me.ts`、`nearmiss/`、
  `named/` 全部存活）/c5（同名真实目录 → 拒绝覆写、真 manifest 未改）/c7（第 15 项 mkdir ENOENT →
  `已回滚：删除本次新建的 13 个目录、还原 1 个原有 stub`，事后只剩 dist/package.json/scripts/store）。
- minify：d1（`empty.js` 与 `comment-only.js` 写成 0 字节、`3 js files` 全部处理、exit 0）/
  d6（12 文件 / 3 层，terser 成功路径）+ **d6head（与 HEAD 版脚本同 fixture 的逐字节对拍，见 R5-030）**/
  d2/d3（三类链接 × lax/strict 的四个退出码，见 R5-028）/d5（`attrib +R` 造真实写盘 EPERM →
  `压缩结果写盘失败（…）；2 个已写入的文件已还原为压缩前内容` exit 1，`sha1sum -c` 三文件全 OK、
  与运行前快照 diff 无输出）/d8 vs d8b（破损安装：现版本 exit 1 点名「不是未安装」，
  对照件退回旧判据则 `minifier: esbuild` + exit 0 并真的产出）。
- skill-api：e1（隔离副本跑真 dist，11 入口 / 359 符号，与已提交 `references/api/` `diff -r` 无输出）/
  e2（保留名）/e3 + **e3b（同一输入的 HEAD 对照件，见 R5-035）**/e4 vs e4b（最小 fixture 的语义诊断死活）/
  **e4r vs e4rb（真 dist 副本 + 破损导出：TS2304 中止 vs 退回 flag 后 360 符号 / main.md 76.9 KB）**/
  e5（陈旧 .md 清掉、`weirddir.md/` 目录连同 `inner.txt` 保留并 WARN、legacy `references/api.md` 删除）。
- 真实仓库端到端：`git status --porcelain` 取基线 → `node scripts/generate-subpath-stubs.mjs` →
  `generated 14 subpath stub dirs`（根目录多出 11 个未跟踪条目）→ `npm pack --dry-run` →
  **`total files: 229`**、`npm notice` 清单里 14 份 stub manifest 逐条在场
  （`actions/ cache/ compose/ error/ hooks/ integrations/ integrations/enterprise/ performance/
  plugins/ plugins/devtools/ plugins/performance/ selectors/ snapshot/ store/` 的 `package.json`，
  闭合第四轮待办 5）→ 手动 `--clean`。**本轮新事实**：`npm pack --dry-run` 自己就会依次触发
  `prepack` 与 `postpack`（输出里能看到 `[stubs] generated 14 …` 紧跟 `[stubs] removed 14 …`），
  故紧随其后的手动 `--clean` 打的是 `removed 0 subpath stub dirs`，两侧都不留残渣。
  收尾 `git status --porcelain` 与基线逐行比对：stub 条目 0 条残留，唯一差异是
  ` M tests/unit/extras/snapshot/snapshot-custom-cloner-consistency.test.ts` 一行——打包窗口内
  并行分片写的 tests 文件，与本分片无关（原判词「逐行一致」在这个意义上不成立，已按事实改写）。
- fixture 位置：`.cache/r5-scripts-check/probe{A,B,C,D,E}/` 与 `.cache/r5-lf/`，收尾 `rm -rf`；
  其他分片的 `r5cd*/r5stub/...` 未动。
- 未改 `package.json` / `.github/workflows/ci.yml` / `.gitignore` / `jest.config.js` / `eslint.config.js`；
  本分片无 NEEDS-MAIN 项（判词里出现的两处对外行为变化 R5-024 的 `prepack` 新增前置校验、
  R5-031 的 `build:release` 不再静默降级，都只落在脚本自身，无需主会话接线）。
- `npx tsc -p tsconfig.json --noEmit` 未跑：`tsconfig.json` 的 include 只有 `src/**/*`（allowJs 未开），
  scripts/*.mjs 不在编译输入内，本分片不可能影响它；src 由其他分片并行改动中，跑出的红不是本分片信号。
