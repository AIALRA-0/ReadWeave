#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DATA_DIR="$ROOT_DIR/apps/server/data-readweave"
PID_FILE="$DATA_DIR/readweave.pid"

if [[ ! -f "$PID_FILE" ]]; then
    echo "没有找到 ReadWeave 的运行记录；无需停止。"
    exit 0
fi

READWEAVE_PID="$(tr -d '[:space:]' < "$PID_FILE")"
if [[ ! "$READWEAVE_PID" =~ ^[0-9]+$ ]]; then
    echo "PID 文件内容无效；为避免误停进程，未执行操作。" >&2
    exit 1
fi

if ! kill -0 "$READWEAVE_PID" 2>/dev/null; then
    rm -f "$PID_FILE"
    echo "ReadWeave 已经停止，过期运行记录已清理。"
    exit 0
fi

COMMAND_LINE="$(ps -p "$READWEAVE_PID" -o command= 2>/dev/null || true)"
if [[ "$COMMAND_LINE" != *"dist/main.cjs"* ]]; then
    echo "运行记录指向的进程不是 ReadWeave；为避免误停进程，未执行操作。" >&2
    exit 1
fi

kill "$READWEAVE_PID"
for _ in $(seq 1 30); do
    if ! kill -0 "$READWEAVE_PID" 2>/dev/null; then
        rm -f "$PID_FILE"
        echo "ReadWeave 已停止。"
        exit 0
    fi
    sleep 0.5
done

echo "ReadWeave 未在 15 秒内退出，请检查进程 $READWEAVE_PID。" >&2
exit 1
