#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EXPECTED_NODE="$(tr -d '[:space:]' < "$ROOT_DIR/.nvmrc")"

if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "此脚本仅用于 macOS。" >&2
    exit 1
fi

if ! command -v node >/dev/null 2>&1; then
    echo "未找到 Node.js。请先安装 Node.js $EXPECTED_NODE（推荐使用 nvm 或 fnm）。" >&2
    exit 1
fi

EXPECTED_PNPM="$(node -p "require('$ROOT_DIR/package.json').packageManager.split('@')[1]")"

ACTUAL_NODE="$(node -p 'process.versions.node')"
if [[ "$ACTUAL_NODE" != "$EXPECTED_NODE" ]]; then
    echo "Node.js 版本不匹配：当前 $ACTUAL_NODE，需要 $EXPECTED_NODE。" >&2
    echo "使用 nvm 时可执行：nvm install $EXPECTED_NODE && nvm use $EXPECTED_NODE" >&2
    exit 1
fi

if ! command -v corepack >/dev/null 2>&1; then
    echo "未找到 Corepack。请确认 Node.js 安装完整。" >&2
    exit 1
fi

corepack enable
corepack prepare "pnpm@$EXPECTED_PNPM" --activate

cd "$ROOT_DIR"
echo "正在安装适用于当前 Mac 架构的依赖……"
pnpm install --frozen-lockfile

echo "正在运行隐私扫描……"
pnpm readweave:privacy

echo "正在构建 ReadWeave Web 服务……"
pnpm --dir apps/server build

echo "MacBook 开发环境准备完成。"
echo "启动：bash scripts/readweave/start-macos.sh"
