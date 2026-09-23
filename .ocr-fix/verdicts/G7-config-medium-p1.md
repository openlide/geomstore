# G7-config-medium-p1 判定记录

#2 | FP | 实测不成立：临时文件（含 `??=`/`||=`/static block/`#priv`）以现配置跑 `npx eslint tmp-ecma-probe.ts` 退出 0、零解析错误——@typescript-eslint/parser 用 TS 自带 parser，`ecmaVersion` 对 .ts 不做语法限制；全仓 src/tests 无 ES2021+ 用例受影响。不改。
#3 | FP | `find`（排除 node_modules）全仓 .tsx/.mts/.cts 数量为 0，lint 脚本仅收集 src/tests 下 `**/*.ts`；为不存在的文件类型加 glob 属假想需求预留。不改。
#4 | fix（比报告更彻底） | tests/setup.ts 全文经 `const g = globalThis as unknown as ...` 成员赋值 + `process.on` 成员调用，无一处全局标识符重赋值 → `no-global-assign` 本就不触发；`no-undef` 已在 `**/*.ts` 全局关闭属冗余；全仓 setup 文件仅 tests/setup.ts 一个，glob 化是给假想改名留后路。整个 override 块删除，`pnpm run lint` 退出 0 验证。
#7 | fix（采报告方案二：删 emitDecoratorMetadata） | 实测 ts-jest `dist/legacy/compiler/ts-compiler.js:78` `if (!this.configSet.isolatedModules) _createLanguageService()`、`:379 transpileModule`——isolatedModules 走 transpile-only 属实，冲突真实；全仓 `Reflect.getMetadata/reflect-metadata` 消费点为 0。保留 isolatedModules（内联配置既定用途），删无消费者的 emitDecoratorMetadata；改后 `npx jest tests/unit/extras/action/decorators.test.ts` 88/88 通过，`node -e import('./jest.config.js')` 退出 0。
#9 | fix | 实测 `npx prettier --check src/index.ts` 原样输出三条 `Ignored unknown option { documentSelectors / disableLanguages / extends }`——Prettier 3.8 亲口确认忽略；已删 3 个无效键（wxml/wxss 的 overrides parser 映射真实生效，保留）。改后 check 退出 0 且无警告。VS Code 扩展侧两项需迁 .vscode/settings.json（越界）→ 待办。
#11 | fix | tsconfig.jest.json 并非死配置（tests/tsconfig.json extends 之，供 IDE 语义服务），noImplicitAny:false 与 strict 伞并存无注释属实；补一行「为什么」（对齐 tsconfig.tests.json：测试 mock/夹具大量无标注对象）。
#12 | fix | tsconfig.build.json 收敛为 extends + 全部真实 override（`npx tsc -p tsconfig.build.json --showConfig` 验证 module/moduleResolution/outDir/rootDir/declaration 等均正确继承，include/exclude 同步继承去重）；tsconfig.jest.json / tsconfig.tests.json 的 paths 整块删除（`@/*` 经 extends 继承，`@tests/*` 全仓零使用见 #22）。typecheck 三门禁退出 0。
#15 | fix | 实测成立：tsc 探针确认 emit `//# sourceMappingURL` 注释 + .map，而 scripts/postbuild-dist.mjs:40-49 删光 dist 下 .map → `pnpm build` 产物留死链。修复走「删 map 选项」：base 不再声明 sourceMap/declarationMap，build 侧显式 false；临时目录实测 `npx tsc -p tsconfig.build.json --outDir /tmp/buildprobe` 产出 0 个 .map、index.js 0 条 sourceMappingURL（dist 未动）。
#22 | fix | 实测 `@tests/` 在 src/tests/examples/packages/tools/scripts 引用数 0，且 include 仅 src、exclude tests，别名在基线中永远不可用 → 从 tsconfig.json paths 删除 `@tests/*`（jest.config.js moduleNameMapper 的 @tests 映射未被本条点名，未动）。门禁全绿。
#23 | fix（报告自带的"拆分配比"方案） | src 无任何 DOM 标识符，基线 lib 去 DOM/DOM.Iterable 后 `pnpm run typecheck`/`typecheck:examples` 退出 0——Node 侧确认不需要 DOM。但 tests/unit/extras/ocr-medium-round4.test.ts:52（同事文件，越界）用 DOM 的 `TimerHandler` 标注 setTimeout，全量移除使 typecheck:tests 报 TS2304 → 按报告替代方案拆分：基线（src）不含 DOM，仅 tsconfig.jest.json / tsconfig.tests.json 显式回补 `["ES2020","DOM"]` 并注释指明待该标注改为 `Parameters<typeof setTimeout>[0]` 后删除 → 待办。
#25 | FP | 报告自述失败模式属实但非配置 bug：ESM-only 包 exports 标准写法即 types+default 无 require 条件（与 `"type":"module"`/tsconfig NodeNext 一致）；README:18 已明文「本包为 ESM」；加 import/require 条件需 CJS 双构建（不成比例，报告亦承认）；engines>=22 面向开发/CI（matrix 22/24）。唯一失实点在 .npmignore 头注释误称「CJS/ESM 双格式」，已就地改为「纯 ESM」。root package.json 未动。
#440 | reject | 幽灵依赖权衡已在 pnpm-workspace.yaml:8-13 作为 Windows junction/重解析点安全策略（scandir UNKNOWN）的显式记录，`node_modules/.modules.yaml:12` `"nodeLinker": "hoisted"` 证明 pnpm 12.3.4 识别该键；改局部 override/CI env var 需重建布局（本轮禁 pnpm install），并造成 CI ubuntu 与本地双布局漂移。维持现状。

## 门禁结果（改动后全量复跑）
- pnpm run lint → 0；pnpm run typecheck → 0；pnpm run typecheck:tests → 0；pnpm run typecheck:examples → 0
- npx prettier --check src/index.ts → 0（unknown-option 警告消失）；node -e import('./jest.config.js') → 0
- 附加：npx jest decorators.test.ts → 88/88；npx tsc --noEmit -p tests/tsconfig.json → 0；build --showConfig → declarationMap:false/sourceMap:false/继承项齐全

## 待办（交主控）
1. tests/unit/extras/ocr-medium-round4.test.ts:52 `TimerHandler` → `Parameters<typeof setTimeout>[0]`，然后把 tsconfig.jest.json / tsconfig.tests.json 里的 DOM 回补项删掉（#23）。
2. .prettierrc.json 删除的 documentSelectors/disableLanguages 如需保留 VS Code 扩展行为，迁往 .vscode/settings.json 的 prettier.* 键（#9，越界未动）。
3. 全量 `pnpm test:ci` 对本分片 jest.config.js 改动（#7）的最终确认（本轮按约定未跑）。
4. .gitignore 中未提交的 `ocr.md` 行为他方所加，本轮未触碰、未删除；其去留随 Wave D 统一处理。
5. jest.config.js moduleNameMapper 中 `@tests/*` 两条映射全仓零使用，可随下轮清理（未在分片清单内，未动）。
