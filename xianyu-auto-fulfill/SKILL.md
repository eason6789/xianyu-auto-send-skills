---
name: xianyu-auto-fulfill
description: 闲鱼自动发货监控。使用 browser tool + Chrome + Xvfb + 闲鱼H5 API 自动检查闲鱼消息，检测付款订单并自动发货。触发词：闲鱼发货、闲鱼监控、闲鱼自动化、xianyu、自动发货。
---

# 闲鱼自动发货

> **给所有 AI agent 的统一发货指南。** 无论你是什么模型、什么会话，按此流程执行即可。

---

## 系统架构

```
Cron(每30分钟) → Isolated Session
     │
     ├─ 浏览器CDP → 打开闲鱼聊天页
     │   ├─ 被风控(captcha) 
     │   │   ├─ 截图页面找二维码 → 发群让用户扫码
     │   │   ├─ 用户手动在APP扫码 → 恢复登录
     │   │   └─ 上报群聊：⚠️ 风控已触发，请扫码恢复
     │   ├─ 登录态失效(需要扫码登录)
     │   │   ├─ 截图二维码 → 发群让用户扫码
     │   │   └─ 上报群聊：⚠️ 登录已过期，请扫码重新登录
     │   └─ 正常加载 → 扫描聊天列表
     │       ├─ 无新订单 → 上报群聊 ✅
     │       └─ 有已付款订单 → 走发货流程
     │
     └─ 发货流程（顺序不能错）
         ├─ ① 获取订单号（点"去发货"进入订单详情页）
         ├─ ② 尝试调虚拟发货API（标记已发货）
         │   ├─ 成功 → 继续
         │   └─ 失败 → 通知群聊叫用户协助扫码
         └─ ③ 发送网盘链接/秘钥给买家
```

---

## 完整踩坑记录（12个坑）

### 🕳️ 坑1：headless 浏览器被闲鱼反爬
**问题：** Obscura/headless Chrome 访问闲鱼被拦截
**原因：** 闲鱼检测 navigator.webdriver 等 headless 特征
**解决：** headless=false + Xvfb 虚拟显示器（:99, 1920x1080x24）

### 🕳️ 坑13（新增）：持续风控拦截·QR码人工恢复
**问题：** 闲鱼持续弹出「非法访问」提示，所有自动操作被阻断
**原因：** 闲鱼风控系统激活，检测到自动化环境
**解决：** 
1. screenshot 当前页面，寻找二维码
2. 截图发送到闲鱼群聊（{{FEISHU_CHAT_ID}}）
3. 让用户用闲鱼APP扫描二维码恢复登录
4. 恢复后，所有 HTTP-only cookie 自动更新，token 刷新

### 🕳️ 坑14（profile=user 说明）：为什么不能用 profile=user
**问题：** `profile=user` 能绕过风控吗？
**原因：** OpenClaw 的 `profile=user` 使用 Chrome DevTools MCP 连接到**本机桌面 Chrome**，需要：
- 用户本机有 Chrome 144+ 并开启了远程调试
- OpenClaw 跑在用户桌面电脑上
- 用户手动批准连接提示

**我们的环境：** OpenClaw 运行在云端 VPS，没有用户桌面 Chrome 可连接。
即使 `profile=user` 能启动（返回 `running: true`），也找不到真正的 Chrome 实例。

**结论：** 无法在现有 VPS 环境用 `profile=user`。风控时走 QR码截图人工恢复流程。

### 🕳️ 坑2：Xvfb 进程会挂
**解决：** 保活：`pgrep Xvfb || (nohup Xvfb :99 -screen 0 1920x1080x24 > /tmp/xvfb.log 2>&1 &)`

### 🕳️ 坑3：DISPLAY 环境变量不传递
**解决：** systemd service 加 `Environment=DISPLAY=:99`

### 🕳️ 坑4：验证码收不到
**解决：** 换用闲鱼 APP 扫码登录

### 🕳️ 坑5：Cron 用 --system-event 无效
**解决：** 改用 `--message` + `--session isolated`

### 🕳️ 坑6：Cron 每分钟触发风控
**解决：** 改为 `*/30 * * * *` 每30分钟一次

### 🕳️ 坑7（已修正）：不要截图二维码发给用户
**错误做法：** 点"去发货"→截图二维码→发给用户扫码→用户APP确认
**正确做法：** 点"去发货" **只是为了获取订单号**（URL中orderId参数），然后**直接调虚拟发货API**完成发货
API返回 SUCCESS 后订单状态自动变为"你已发货"
如果API调用失败 → 通知群聊，叫用户用APP协助扫码确认

### 🕳️ 坑8：浏览器 Tab 会丢失
**解决：** 每次检查时用 `browser action=open` 重新创建

### 🕳️ 坑9：多订单处理（同一买家下多单）
**特征：** 聊天页显示"N个订单交易中"
**解决：** 检查所有 "等待你发货" 的消息卡片，逐一处理

### 🕳️ 坑10（已修正）：发货后订单状态不变
**解决：** 调 API `mtop.taobao.idle.logistic.consign.dummy` → 状态直接变"你已发货"

### 🕳️ 坑11：_m_h5_tk 会过期
**解决：** 浏览器访问闲鱼首页会自动续期，保持浏览器常开

### 🕳️ 坑12：QR登录不给 _m_h5_tk
**解决：** 从浏览器页面获取 _m_h5_tk，与 QR session cookie 合并使用

---

## 统一发货流程（所有发货方式通用）

**顺序固定：先标记发货 → 再发送内容。** 不要搞反。

### 步骤1：打开闲鱼聊天页
```
browser action=open label=xianyu profile=openclaw targetUrl=https://www.goofish.com/im
```

### 步骤2：检查风控
获取快照，搜索关键字：
- "unusual traffic" / "滑块" / "slide to verify" / "非法访问" / "使用正常浏览器" → **被风控，执行风控恢复流程（见下文），不要直接退出。**
- 没有以上关键字 → 正常继续

### 风控恢复流程（遇到风控时执行）
当检测到风控时，不要直接放弃，按以下步骤尝试恢复：

1. **截图当前页面**，寻找二维码
   ```
   browser action=screenshot targetId=xianyu
   ```
2. **将截图发送到闲鱼群聊**，让用户用APP扫码
   ```
   message action=send channel=feishu target={{FEISHU_CHAT_ID}} message="⚠️ 闲鱼被风控拦截，请打开闲鱼APP扫描下方二维码恢复登录"
   ```
   发送截图到群聊（用 filePath 参数附加截图）：
   ```
   message action=send channel=feishu target={{FEISHU_CHAT_ID}} filePath=/tmp/openclaw/screenshot-xxx.png
   ```
3. **发送单独通知给用户（可选）**：如果需要单独提醒用户
   ```
   message action=send channel=feishu target={{FEISHU_USER_ID}} message="闲鱼被风控了，请看群聊二维码扫码恢复"
   ```
4. **等待用户扫码恢复**，当前任务结束。
   下次 Cron 触发时会自动使用新的 cookie/登录态。

> **注意：** 如果页面有可识别的二维码元素，优先截图包含二维码的区域。
> 如果页面没有二维码（如纯文字提示），截全屏并发到群聊说明情况。

### 登录失效处理流程
如果闲鱼页面加载正常，但显示登录页面（需要扫码登录），同样处理：
1. 截图二维码所在区域
2. 发送到闲鱼群聊让用户扫码
3. 通知用户

### 步骤3：查找待发货订单
在快照中搜索以下系统消息：
- "等待卖家发货"
- "等待你发货"
- "我已付款，等待你发货"

**付费订单的特征：** 系统消息卡片（带图标）+ 文本含以上关键字 + 旁边有"去发货"按钮
**不能发货的情况：** 用户手打文本（如"老板发货"）、没有"去发货"按钮、"待付款"状态

### 步骤4：获取订单号
找到对应买家 → 点击进入聊天 → 点击"去发货"按钮
→ 这会打开订单详情页（新标签页）
→ 从 URL 中提取 `orderId=数字`，这就是订单号

### 步骤5：调 API 标记已发货（关键步骤）
用虚拟发货API标记订单为"已发货"：

```
API: mtop.taobao.idle.logistic.consign.dummy
参数: {"orderId":"订单号","tradeText":"","picList":[],"newUnconsign":true}
签名: MD5(token + "&" + timestamp + "&" + {{YOUR_APP_KEY}} + "&" + data)
```

**Cookie 构造（重要）：**
- 需要从浏览器获取最新的 `_m_h5_tk`（执行 document.cookie）
- **关键：必须用 goofish.com 域的 cookie**，不要用 taobao.com 域的！
  - 通过 Network.getAllCookies 获取全部 cookie，筛选 domain 包含 .goofish.com 的
  - goofish.com 的 _m_h5_tk 是扫码登录后生成的，有完整会话
  - taobao.com 的 _m_h5_tk 只是浏览页面时生成的，未登录，不能用于发货 API
- 配合已有的 session cookie（cookie2, t, _tb_token_ 等）
- 合并使用

**处理结果：**
- API返回包含 `SUCCESS::调用成功` 或 `ORDER_ALREADY_DELIVERY` → ✅ 标记成功
- API返回 `FAIL_SYS_TOKEN_EXOIRED` → token过期，放弃，等下次
- API返回其他错误 → ⚠️ API失败，调用回调，通知群聊让用户协助

### 步骤6：发送内容给买家（三种发货方式）
回到聊天页，在输入框输入对应内容并按 Enter 发送：

**方式A - 固定网盘链接：**
```
你好！电子书资料已发到网盘，链接：{{YOUR_BAIDU_PAN_LINK}} 提取码：{{YOUR_EXTRACT_CODE}} 请及时下载，祝使用愉快！
```

（如商品不是电子书，发送对应的固定内容即可）

**方式B - 调用 API 获取秘钥/激活码：**
```
先 curl 调用外部API获取秘钥 → 再将秘钥发送给买家
```
示例消息：`你的激活码是：XXXX-XXXX-XXXX，请妥善保管`

**方式C - 混合方式（先发教程再发秘钥）：**
```
分别发送两条消息
```

### 步骤7：上报结果到群聊
用 `message` 工具发送到闲鱼群聊（`target: {{FEISHU_CHAT_ID}}`）：

**三种情况：**
```
✅ 闲鱼检查通过，无新订单
⚠️ 闲鱼页面被风控拦截，下次再试
✅ 已处理 X 笔订单：买家名 | 订单号 xxx
```

---

## 错误处理

**API发货失败时，调用回调通知群聊让用户协助：**
```
message action=send channel=feishu target={{FEISHU_CHAT_ID}} message="⚠️ 发货API调用失败，请扫码确认发货"
```
然后发送截图给用户扫码（作为兜底方案）：
```
message action=send filePath=截图路径 message="请扫码确认发货" target={{FEISHU_USER_ID}}
```

---

## 浏览器配置

使用 Chrome（非 headless）+ Xvfb。

```bash
# Xvfb
nohup Xvfb :99 -screen 0 1920x1080x24 > /tmp/xvfb.log 2>&1 &

# Chrome（由Gateway管理，CDP 18800）
# openclaw.json 配置 headless: false
# systemd service 配置 DISPLAY=:99
```

---

## 发货信息

```
商品：理财相关电子书整理（ID: {{YOUR_PRODUCT_ID}}）
网盘：{{YOUR_BAIDU_PAN_LINK}}
提取码：{{YOUR_EXTRACT_CODE}}
```

---

## Cron 配置

```bash
openclaw cron add \
  --name "闲鱼自动发货v5" \
  --cron "*/30 * * * *" \
  --tz "Asia/Shanghai" \
  --session isolated \
  --light-context \
  --announce \
  --channel feishu \
  --target {{FEISHU_CHAT_ID}} \
  --message '完整的发货指令'
```

**说明：**
- `--session isolated`：不占用主会话
- `--light-context`：轻量上下文加速
- `--announce`：公告到飞书
- `--target {{FEISHU_CHAT_ID}}`：**必须指定群聊**，不能发到用户 DM
- `*/30 * * * *`：安全频率，不要改短

**⚠️ 致命警告：永远不要在主会话提到闲鱼**
- 所有闲鱼相关通知（巡检、发货、风控、API失败、扫码请求）**只能**推送到群聊（{{FEISHU_CHAT_ID}}）
- 禁止在主会话回复任何闲鱼相关内容，即使只是说

---

## 给低阶模型/新agent的快速指南

如果你刚接手这个任务，按以下步骤做就行：

1. `browser action=open label=xianyu profile=openclaw targetUrl=https://www.goofish.com/im`
2. `browser action=snapshot targetId=xianyu refs=aria`
3. 看有没有"等待卖家发货"或"等待你发货"的买家
4. 如果有：
   a. 点击买家进入聊天
   b. 点"去发货"按钮 → 得到订单号（来自URL）
   c. 用 document.cookie 拿 _m_h5_tk
   d. 调虚拟发货API → 标记已发货
   e. 如果API失败 → 发消息到群聊叫用户扫码
   f. 聊天框输入网盘链接 → 按Enter发送
5. 上报结果到闲鱼群聊
6. 如果页面有风控/滑块验证/非法访问 → 
   a. `browser action=screenshot targetId=xianyu` 截屏
   b. 发到闲鱼群聊让用户扫码恢复登录
   c. 上报：⚠️ 风控，已发截图到群聊请扫码
7. 如果页面显示登录二维码 → 截图发群让用户扫码
