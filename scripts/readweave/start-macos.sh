#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVER_DIR="$ROOT_DIR/apps/server"
DATA_DIR="$SERVER_DIR/data-readweave"
PID_FILE="$DATA_DIR/readweave.pid"
OUT_LOG="$DATA_DIR/readweave.out.log"
ERR_LOG="$DATA_DIR/readweave.error.log"
PORT="${1:-8082}"
ADDRESS="http://127.0.0.1:$PORT"

for command_name in node pnpm curl screen; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
        echo "未找到 $command_name，请先运行 bootstrap-macos.sh。" >&2
        exit 1
    fi
done

if [[ ! "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
    echo "端口必须是 1 到 65535 之间的数字。" >&2
    exit 1
fi

mkdir -p "$DATA_DIR"

if [[ -f "$PID_FILE" ]]; then
    EXISTING_PID="$(tr -d '[:space:]' < "$PID_FILE")"
    if [[ "$EXISTING_PID" =~ ^[0-9]+$ ]] && kill -0 "$EXISTING_PID" 2>/dev/null; then
        EXISTING_COMMAND="$(ps -p "$EXISTING_PID" -o command= 2>/dev/null || true)"
        if [[ "$EXISTING_COMMAND" == *"dist/main.cjs"* ]]; then
            echo "ReadWeave 已在运行：$ADDRESS"
            open "$ADDRESS"
            exit 0
        fi
        echo "PID 文件指向其他进程，为避免误操作已停止启动。" >&2
        exit 1
    fi
    rm -f "$PID_FILE"
fi

if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "端口 $PORT 已被其他程序占用。请停止占用程序或传入其他端口。" >&2
    exit 1
fi

echo "正在构建最新 ReadWeave……"
pnpm --config.verify-deps-before-run=warn --dir "$SERVER_DIR" run build

echo "正在后台启动 ReadWeave……"
SESSION_NAME="readweave-$PORT"
screen -dmS "$SESSION_NAME" \
    env \
    TRILIUM_ENV=production \
    TRILIUM_PORT="$PORT" \
    TRILIUM_DATA_DIR="$DATA_DIR" \
    READWEAVE_SERVER_DIR="$SERVER_DIR" \
    READWEAVE_PID_FILE="$PID_FILE" \
    READWEAVE_OUT_LOG="$OUT_LOG" \
    READWEAVE_ERR_LOG="$ERR_LOG" \
    bash -c 'cd "$READWEAVE_SERVER_DIR" && echo $$ >"$READWEAVE_PID_FILE" && exec node dist/main.cjs >>"$READWEAVE_OUT_LOG" 2>>"$READWEAVE_ERR_LOG"'

for _ in $(seq 1 50); do
    [[ -s "$PID_FILE" ]] && break
    sleep 0.1
done

if [[ ! -s "$PID_FILE" ]]; then
    screen -S "$SESSION_NAME" -X quit 2>/dev/null || true
    echo "ReadWeave 未能创建进程记录，请查看 $ERR_LOG。" >&2
    exit 1
fi

READWEAVE_PID="$(tr -d '[:space:]' < "$PID_FILE")"
for _ in $(seq 1 180); do
    if ! kill -0 "$READWEAVE_PID" 2>/dev/null; then
        echo "ReadWeave 提前退出。错误日志：" >&2
        tail -n 40 "$ERR_LOG" >&2 || true
        rm -f "$PID_FILE"
        exit 1
    fi
    if curl --silent --show-error --max-time 2 "$ADDRESS" >/dev/null 2>&1; then
        echo "ReadWeave 已启动：$ADDRESS"
        echo "独立数据目录：$DATA_DIR"
        open "$ADDRESS"
        exit 0
    fi
    sleep 0.5
done

kill "$READWEAVE_PID" 2>/dev/null || true
rm -f "$PID_FILE"
echo "ReadWeave 在 90 秒内没有完成启动，请查看 $ERR_LOG。" >&2
exit 1
