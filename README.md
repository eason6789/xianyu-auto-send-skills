# Xianyu Auto Send Skills (闲鱼自动发货系统)

Automated fulfillment system for Xianyu (闲鱼 / Goofish) second-hand marketplace. Monitors chat for paid orders via browser automation, calls the virtual delivery API to mark orders as shipped, and sends product content to buyers automatically.

## Features

- **Order detection** -- scans Xianyu chat list for system-generated "waiting for seller to ship" cards
- **Virtual delivery API** -- calls `mtop.taobao.idle.logistic.consign.dummy` to mark orders as shipped without manual intervention
- **Customizable delivery** -- supports fixed keys, key pools (file-based), external API keys, web disk links, or tutorial-first workflows
- **Anti-detection** -- uses non-headless Chrome + Xvfb virtual display to avoid Xianyu's headless-browser detection
- **Risk control recovery** -- detects CAPTCHA/blocked pages, screenshots the QR code, and sends it to a Feishu group for manual scan recovery
- **Session isolation** -- runs via cron with `--session isolated` to avoid interfering with the main Claude session
- **Feishu integration** -- reports check results, shipping confirmations, and risk-control alerts to a Feishu group chat

## Tech Stack

- **Claude Agent / openclaw** -- runtime that drives the browser via CDP
- **Chrome + Xvfb** -- non-headless browser with virtual framebuffer (`DISPLAY=:99`)
- **Xianyu H5 API** -- `mtop.taobao.idle.logistic.consign.dummy` for virtual delivery
- **Feishu (飞书)** -- notifications and QR code screenshots sent to group chat

## Local Development

This is a **Claude Skill** -- the skill definition lives in `SKILL.md` and is invoked by the Claude Agent runtime (openclaw).

### Prerequisites

```bash
# Xvfb virtual display
sudo apt install xvfb  # Linux
# Chrome managed by the agent runtime

# Start Xvfb
pgrep Xvfb || (nohup Xvfb :99 -screen 0 1920x1080x24 > /tmp/xvfb.log 2>&1 &)
```

### Cron setup

```bash
openclaw cron add \
  --name "闲鱼自动发货" \
  --cron "*/30 * * * *" \
  --tz "Asia/Shanghai" \
  --session isolated \
  --light-context \
  --announce \
  --channel feishu \
  --target {{FEISHU_CHAT_ID}} \
  --message '检查闲鱼新消息，有已付款订单就发货...'
```

### Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `FEISHU_CHAT_ID` | Yes | Feishu group chat ID for notifications |
| `FEISHU_USER_ID` | No | Feishu user ID for fallback notifications |
| `YOUR_APP_KEY` | Yes | Xianyu API signature appKey |
| `KEY_POOL_FILE` | No | Path to key pool file (default: `keys.txt`) |

## Deployment

See [DEPLOY.md](DEPLOY.md) and [../DEPLOY_COMMON.md](../DEPLOY_COMMON.md)
