# Deploy: Xianyu Auto Send Skills

## Type

Claude Skill -- deployed via GitHub, runs on a server with Chrome + Xvfb. The skill is invoked by the Claude Agent runtime (openclaw) on a cron schedule.

## Prerequisites

- Linux or macOS server with Chrome installed
- Xvfb virtual display (`DISPLAY=:99, 1920x1080x24`)
- Claude Agent runtime (openclaw) configured with browser tool
- Feishu bot with group chat access
- Xianyu account with valid login session

## How to Use

1. **Install the skill** in Claude Code / openclaw
2. **Configure environment variables** -- copy `.env.example` to `.env` and fill in:
   - `FEISHU_CHAT_ID` (Feishu group chat ID)
   - `YOUR_APP_KEY` (Xianyu API appKey)
3. **Start Xvfb** on the server:
   ```bash
   pgrep Xvfb || (nohup Xvfb :99 -screen 0 1920x1080x24 > /tmp/xvfb.log 2>&1 &)
   ```
4. **Configure systemd** or equivalent to set `DISPLAY=:99` for the agent service
5. **Set up cron** via openclaw (`*/30 * * * *`, isolated session)
6. **Log in to Xianyu** by scanning the QR code (first run will show a QR; scan with Xianyu app)

## Cron Configuration

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
  --message '检查闲鱼新消息，有已付款订单就发货。流程：1.打开聊天页 2.检查风控 3.扫描待发货订单 4.点去发货获取订单号 5.调虚拟发货API标记已发货 6.发送商品内容给买家 7.上报结果到群聊。遇到风控或登录失效截图发群让用户扫码。'
```

## Delivery Flow

1. Open Xianyu chat page (`https://www.goofish.com/im`)
2. Check for risk control (CAPTCHA, blocked pages)
3. Scan for "waiting for seller to ship" system cards
4. Click "去发货" to get the order ID from the URL
5. Call virtual delivery API (`mtop.taobao.idle.logistic.consign.dummy`)
6. Send product content (key/link) to the buyer
7. Report results to Feishu group chat

## Recovery

If the API fails or risk control is triggered:
- Screenshot is taken and sent to the Feishu group
- User scans the QR code with the Xianyu app to restore the session
- Next cron run picks up with the refreshed session
