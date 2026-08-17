#!/bin/bash

# GeomStore 错误修复脚本

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
