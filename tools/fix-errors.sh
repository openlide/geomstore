#!/bin/bash
set -euo pipefail

# GeomStore 编译 + 测试校验脚本（只校验，不修任何东西）
#
# 严格模式是必需的：没有 `set -e`，`npm run build` / `npm test` 失败后脚本会继续
# 走到末尾的「完成」输出并以 0 退出，调用方与 CI 会把失败当成成功。
#
# 原先的「1. 修复导入错误」「2. 修复测试用例」两步只打印标签、不做任何事，
# 会让调用方以为问题已被自动修好；真正可自动修复的部分走 `pnpm lint:fix`，故删除。
# 文件名保留 fix-errors.sh 以免既有本地用法失配，语义以本注释为准。

# 按脚本自身位置定位仓库根：从别处调用时 npm run build / npm test 会作用在错误目录上。
# 用 dirname + cd + pwd -P 而非 readlink -f：后者在 BSD/macOS 与部分 Windows shims 上不可用。
SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd -P)
cd -- "$SCRIPT_DIR/.."

if [ ! -f package.json ]; then
  echo "仓库根定位失败：$(pwd) 下没有 package.json" >&2
  exit 1
fi

echo "校验 GeomStore（仓库根：$(pwd)）..."

echo "运行编译检查..."
npm run build

echo "运行测试..."
npm test

echo "校验通过：编译与测试均无错误"
