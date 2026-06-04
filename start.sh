#!/bin/bash
# 闲鱼自动发货 - 启动脚本
# 用法: ./start.sh
# Cron: */15 * * * * /root/xianyu/start.sh >> /tmp/xianyu-cron.log 2>&1

set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="/tmp/xianyu-ship.log"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] ========== 闲鱼自动发货 START ==========" >> "$LOG_FILE"

# 1. 确保 Xvfb 运行
if ! pgrep Xvfb > /dev/null 2>&1; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 启动 Xvfb..." >> "$LOG_FILE"
    nohup Xvfb :99 -screen 0 1920x1080x24 > /tmp/xvfb.log 2>&1 &
    sleep 2
fi

# 2. 设置环境变量
export DISPLAY=:99

# 3. 运行主脚本
cd "$DIR"
/opt/node-v22.22.1-linux-x64/bin/node "$DIR/xianyu-ship.js" 2>&1 | tee -a "$LOG_FILE"
EXIT_CODE=${PIPESTATUS[0]}
echo "[$(date '+%Y-%m-%d %H:%M:%S')] ========== 闲鱼自动发货 END (exit: $EXIT_CODE) ==========" >> "$LOG_FILE"
exit $EXIT_CODE
