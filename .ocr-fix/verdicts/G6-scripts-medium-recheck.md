# G6 scripts medium 补审计（改动已落盘、scripts 判定表缺失的回填）

审计基线：`git show 5a677d2 -- scripts/generate-skill-api-reference.mjs` + HEAD 现状。
格式：`#id | verdict | 一句话依据`

#33 | fix | 生成脚本已按要求收口：collectProblems() 逐入口消费 getSyntacticDiagnostics/getSemanticDiagnostics；「解析不出源文件」「入口零可导出符号」「同文件名互覆」都以退出码 1 中止，且校验前置于清空输出目录（失败时保留上一版正确产出）；「（无导出）」占位渲染分支删除，逐符号缺声明降级为 WARN；getAliasedSymbol 失败不再静默退回（会点名并抛错）。skipLibCheck 按注释保留为 true（global.d.ts 的 declare global 关掉会连带误报），其盲区由「零导出即中止」兜底——为文档化取舍，不是遗漏。

## 验证记录
- `node --check scripts/generate-skill-api-reference.mjs` 通过。
- dist-probe/ 临时副本端到端跑过一次 happy-path：3 入口 3 符号 → exit 0，产出 4 个 md（证明诊断收集/校验链路不误伤正常输入）；临时目录已删除。
- 待办：中止分支（破损 .d.ts、零导出入口）的端到端运行验证在本轮被权限层拦截未执行，留待 Wave D `pnpm build && pnpm skill:api` 时顺带回归（静态逻辑见脚本 main() 内 collectProblems 与 problems.length>0 → exit(1)）。
