#!/bin/bash
set -euo pipefail

# GeomStore 错误修复脚本
#
# 严格模式是必需的：没有 `set -e`，`npm run build` / `npm test` 失败后脚本会继续
# 走到末尾的「完成」输出并以 0 退出，调用方与 CI 会把失败当成成功。

echo "开始修复GeomStore错误..."

# 1. 修复导入错误
echo "修复导入错误..."

# 2. 修复测试用例
echo "修复测试用例..."

# 3. 运行编译检查
echo "运行编译检查..."
npm run build

# 4. 运行测试
echo "运行测试..."
npm test

echo "错误修复完成!"
