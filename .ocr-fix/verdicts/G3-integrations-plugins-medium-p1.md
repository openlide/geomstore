# G3-integrations-plugins-medium-p1 判定记录

#317 | FP | 路径真实发布：scripts/generate-subpath-stubs.mjs:38 在 prepack 生成 integrations/enterprise 转发 stub（main/types 指向 dist，dist/integrations/enterprise/index.js 已存在），package.json files 含 integrations；目标平台（小程序构建 npm）忽略 exports，doc 无误
#324 | FP | backup 来自 storage、运行时不可信，`!== undefined` 是对旧版无 version 备份的生效守卫（非死代码）；报告建议删守卫反而会把缺字段误报成 "(undefined) 不一致"，补注释固化
#325 | fix | timestamp 缺失→NaN age→`NaN > BACKUP_EXPIRY_MS` 为 false，过期门禁被损坏数据静默绕过；非有限值按 Infinity 计龄走过期清理
#326 | fix | 备份键在 init/restore 两处字面量各自派生、user-store 键在 store-manager.logout 重复硬编码；提取 resolveBackupKey/userStoreKey 单点派生
#329 | reject | 不对称属实但全库无受影响调用点（标记按存在性、userId 为字符串、备份/队列为对象）；唯一彻底修法是类型信封+legacy 兼容垫片，属禁走的折中；保留启发式并在 get 的 JSDoc 里写明契约
#331 | fix | 外层 catch 静默吞读取失败，set/remove 都记日志而 get 不记；补 logger.error
#332 | fix | JSON.stringify 对 undefined/function/symbol 返回 undefined 不外抛，仍会调 setStorageSync 并误报成功返回 true；按报告守卫
#335 | fix | syncWithServer 无 catch，失败仅 reject 无日志；补 logger.error 后 rethrow（保留调用方感知失败的契约）
#336 | fix | /api/user/sync 硬编码违反业务 URL 不落码规则；UserStoreConfig 增加 syncUrl，模块默认常量兜底
#337 | fix | 空/纯空白 userId 生成 `user-store-` 键致跨账号碰撞；createUserStore 入口校验抛错（同时覆盖经 StoreManager 的路径）
#339 | fix | excludeUserId 恒不在 map（调用点在未命中分支）为死参数；仅剩当前用户时无可淘汰候选、stores 静默达 maxStores+1；删死参数+补 warn
#340 | fix | switchUser 是文档宣称的身份变更唯一入口且 logout 会 remove CURRENT_USER_KEY，但 switchUser 从不写键→其它调用方换号后冷启动恢复旧身份；补 storage.set（login 处的重复写一并收敛）

## 主控需知
- #337 使既有测试 ENTERPRISE-031（固化 `user-store-` 畸形键旧行为）反转：改为断言入口抛错（新行为正确，键碰撞即跨账号泄漏）。
- #337/#340 连带：createEnterpriseApp 冷启动读到的历史脏标识（空白 userId）switchUser 会抛错，已加 try/catch 清键按未登录处理，避免 App 构造崩溃。
- #317 若要 Node/ESM 消费者也可用 `./integrations/enterprise`，需改 package.json exports——根配置越界，留作待办。
- docs/API.md 未列 syncUrl 新配置项，建议 Wave D 文档同步时补充。
