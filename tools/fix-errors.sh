#!/bin/bash
set -euo pipefail

# GeomStore 编译 + 测试校验脚本（只校验，不修任何东西）
#
# 严格模式是必需的：没有 `set -e`，`pnpm run build` / `pnpm test` 失败后脚本会继续
# 走到末尾的「完成」输出并以 0 退出，调用方与 CI 会把失败当成成功。
#
# 原先的「1. 修复导入错误」「2. 修复测试用例」两步只打印标签、不做任何事，
# 会让调用方以为问题已被自动修好；真正可自动修复的部分走 `pnpm lint:fix`，故删除。
# 文件名保留 fix-errors.sh 以免既有本地用法失配，语义以本注释为准。

# 按脚本自身位置定位仓库根：从别处调用时 build/test 会作用在错误目录上。
# pwd -P 只解析「所在目录」里的链接，解析不了脚本文件本身是软链的情形（例如被
# ln -s 到 ~/bin），故先沿符号链接逐级还原真实脚本路径。只用 readlink 的无 -f 形式
# （BSD/macOS 的 readlink -f 语义不同），readlink 不可用时 break，退化成按目录定位，
# 再由下面的 package.json 自查兜住（宁可明确报错，也不要在错误目录里跑 build）。
SOURCE=${BASH_SOURCE[0]:-$0}
while [ -L "$SOURCE" ]; do
  DIR=$(cd -- "$(dirname -- "$SOURCE")" && pwd -P)
  LINK=$(readlink "$SOURCE" 2>/dev/null) || break
  case $LINK in
    /*) SOURCE=$LINK ;;
    *) SOURCE=$DIR/$LINK ;;
  esac
done
SCRIPT_DIR=$(cd -- "$(dirname -- "$SOURCE")" && pwd -P)
cd -- "$SCRIPT_DIR/.."

if [ ! -f package.json ]; then
  echo "仓库根定位失败：$(pwd) 下没有 package.json（脚本被软链到了仓库之外的目录？）" >&2
  exit 1
fi

# 依赖未安装时 tsc / jest 根本不存在，直接跑只会得到 `pnpm: command not found` /
# `Cannot find module 'jest'` 一类底层报错，掩盖真实原因，故先行自查并给出可执行提示。
if ! command -v pnpm >/dev/null 2>&1; then
  echo "找不到 pnpm：本仓库是 pnpm-only（package.json > packageManager），请启用 corepack 后重试" >&2
  exit 1
fi
if [ ! -x node_modules/.bin/tsc ] || [ ! -x node_modules/.bin/jest ]; then
  echo "依赖未安装：node_modules/.bin 下缺 tsc 或 jest，请先运行 pnpm install --frozen-lockfile" >&2
  exit 1
fi

echo "校验 GeomStore（仓库根：$(pwd)）..."

echo "运行编译检查..."
pnpm run build

# 与 CI 同一包管理器、同一脚本入口：npm 会绕开 pnpm 的锁文件与 workspace 布局
# （hoisted/isolated 都由 pnpm-workspace.yaml 决定），还可能在根目录生成
# package-lock.json——它正被 .gitignore 忽略，于是污染悄无声息。
# --ci 显式给出：否则快照会被就地改写，「只校验」就成了「顺手改代码」。
# 注意不要写成 `pnpm test -- --ci`：pnpm 12 会把 `--` 一并转给 jest，jest 遂把
# --ci 当成测试路径正则，直接 "No tests found" 失败。
echo "运行测试..."
pnpm test --ci

echo "校验通过：编译与测试均无错误"
