---
name: xianyu-auto-fulfill
description: >
  闲鱼自动发货系统 — 自动检测闲鱼聊天中的付款订单，调用虚拟发货API标记已发货，并自动发送商品内容给买家。
  使用 browser tool + Chrome + Xvfb + 闲鱼H5 API，含完整风控恢复流程和13条实战踩坑记录。
  支持秘钥、网盘链接、API调用等多种发货方式，发货逻辑可自定义扩展。
triggers:
  - 闲鱼发货
  - 闲鱼监控
  - 闲鱼自动化
  - 闲鱼自动发货
  - xianyu
  - 自动发货
  - 闲鱼检查
  - 闲鱼订单
metadata: {"clawdbot":{"emoji":"🐟","requires":["browser-tool"]}}
---

# 🐟 闲鱼自动发货系统

> 统一发货指南。无论什么模型、什么会话，按此流程执行即可。

---

## 一、设计理念

```
┌─────────────────────────────────────────────────────────────┐
│                    核心检测层（框架提供）                     │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │  监控聊天    │ -> │  检测付款    │ -> │  触发发货    │  │
│  │  - 新消息    │    │  - 系统卡片  │    │  - 调用钩子  │  │
│  │  - 未读标记  │    │  - 状态判断  │    │              │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  自定义发货层（可扩展）                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  秘钥发货    │  │  链接发货    │  │  API发货     │  ... │
│  │  - 固定秘钥  │  │  - 网盘链接  │  │  - 调用接口  │      │
│  │  - 秘钥池    │  │  - 下载地址  │  │  - 返回数据  │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

**核心原则：**
- **关注点分离**：检测逻辑统一，发货逻辑按商品类型自由定制
- **先标记后发货**：必须先调虚拟发货API让订单状态变更，再发送内容给买家
- **风控兜底**：遇到风控/登录失效自动截图通知用户扫码恢复
- **可扩展**：支持任意类型的发货方式（秘钥、链接、文件、API等）

---

## 二、系统架构

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
         ├─ ② 调虚拟发货API（标记已发货）
         │   ├─ 成功 → 继续
         │   └─ 失败 → 通知群聊叫用户协助扫码
         └─ ③ 发送商品内容给买家（秘钥/链接/文件）
```

---

## 三、浏览器配置

使用 **Chrome（非 headless）+ Xvfb 虚拟显示器**，避免被闲鱼反爬。

```bash
# Xvfb 保活
pgrep Xvfb || (nohup Xvfb :99 -screen 0 1920x1080x24 > /tmp/xvfb.log 2>&1 &)

# Chrome 由 Gateway 管理（CDP 18800）
# openclaw.json 配置 headless: false
# systemd service 配置 DISPLAY=:99
```

---

## 四、完整踩坑记录（13条）

### 🕳️ 坑1：headless 浏览器被闲鱼反爬
**问题：** Obscura/headless Chrome 访问闲鱼被拦截
**原因：** 闲鱼检测 navigator.webdriver 等 headless 特征
**解决：** headless=false + Xvfb 虚拟显示器（:99, 1920x1080x24）

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

### 🕳️ 坑7：不要截图二维码发给用户（已修正）
**错误做法：** 点"去发货"→截图二维码→发给用户扫码→用户APP确认
**正确做法：** 点"去发货" **只是为了获取订单号**（URL中orderId参数），然后**直接调虚拟发货API**完成发货。API返回 SUCCESS 后订单状态自动变为"你已发货"。如果API调用失败 → 通知群聊，叫用户用APP协助扫码确认

### 🕳️ 坑8：浏览器 Tab 会丢失
**解决：** 每次检查时用 `browser action=open` 重新创建

### 🕳️ 坑9：多订单处理（同一买家下多单）
**特征：** 聊天页显示"N个订单交易中"
**解决：** 检查所有 "等待你发货" 的消息卡片，逐一处理

### 🕳️ 坑10：发货后订单状态不变（已修正）
**解决：** 调 API `mtop.taobao.idle.logistic.consign.dummy` → 状态直接变"你已发货"

### 🕳️ 坑11：_m_h5_tk 会过期
**解决：** 浏览器访问闲鱼首页会自动续期，保持浏览器常开

### 🕳️ 坑12：QR登录不给 _m_h5_tk
**解决：** 从浏览器页面获取 _m_h5_tk，与 QR session cookie 合并使用

### 🕳️ 坑13：持续风控拦截·QR码人工恢复
**问题：** 闲鱼持续弹出「非法访问」提示，所有自动操作被阻断
**原因：** 闲鱼风控系统激活，检测到自动化环境
**解决：** 
1. screenshot 当前页面，寻找二维码
2. 截图发送到闲鱼群聊（{{FEISHU_CHAT_ID}}）
3. 让用户用闲鱼APP扫描二维码恢复登录
4. 恢复后，所有 HTTP-only cookie 自动更新，token 刷新

---

## 五、统一发货流程（核心）

**顺序固定：先标记发货 → 再发送内容。** 不要搞反。

### 步骤1：打开闲鱼聊天页
```
browser action=open label=xianyu profile=openclaw targetUrl=https://www.goofish.com/im
```

### 步骤2：检查风控
获取快照，搜索关键字：
- "unusual traffic" / "滑块" / "slide to verify" / "非法访问" / "使用正常浏览器" → **被风控，执行风控恢复流程（见第六章），不要直接退出**
- 没有以上关键字 → 正常继续

### 步骤3：快速检测付款
在快照中搜索以下**系统消息**（不是用户手打文本）：
- "等待卖家发货"
- "等待你发货"
- "我已付款，等待你发货"

**付费订单特征：** 系统消息卡片（带图标）+ 文本含以上关键字 + 旁边有"去发货"按钮

**排除情况：**
- 用户手打的："我已付款了"、"老板发货"等
- 没有"去发货"按钮的消息
- "待付款"状态的卡片

**无新消息快速退出：** 如果当前聊天列表没有新消息（没有红点、没有"刚刚"时间戳），可以快速结束检查。

### 步骤4：进入买家聊天并获取订单号
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
- 配合已有的 session cookie（cookie2, t, _tb_token_ 等）合并使用

**处理结果：**
- API返回包含 `SUCCESS::调用成功` 或 `ORDER_ALREADY_DELIVERY` → ✅ 标记成功，继续步骤6
- API返回 `FAIL_SYS_TOKEN_EXOIRED` → token过期，放弃，等下次
- API返回其他错误 → ⚠️ API失败，通知群聊让用户协助扫码确认

### 步骤6：发送内容给买家
回到聊天页，在输入框输入内容并发送。

**方式A - 固定秘钥/链接：**
```
您的秘钥：XXXX-XXXX-XXXX，祝您使用愉快！
```
或
```
你好！资料已发到网盘，链接：{{YOUR_PAN_LINK}} 提取码：{{EXTRACT_CODE}} 请及时下载！
```

**方式B - 秘钥池（每个订单用不同秘钥）：**
1. 从秘钥池文件读取第一行
2. 删除已用行
3. 将秘钥发送给买家

**方式C - 调用外部API获取秘钥：**
```
先 curl 调用外部API获取秘钥 → 再将秘钥发送给买家
```

**方式D - 混合方式（先发教程再发秘钥）：**
```
分别发送两条消息
```

### 步骤7：返回聊天列表并上报结果
```json
browser action=navigate profile=openclaw targetId=xianyu url="https://www.goofish.com/im"
```

用 `message` 工具发送到闲鱼群聊（`target: {{FEISHU_CHAT_ID}}`）：

**三种情况：**
```
✅ 闲鱼检查通过，无新订单
⚠️ 闲鱼页面被风控拦截，下次再试
✅ 已处理 X 笔订单：买家名 | 订单号 xxx
```

---

## 六、风控恢复流程

当检测到风控/登录失效时，不要直接放弃，按以下步骤尝试恢复：

### 风控拦截（滑块/非法访问）
1. **截图当前页面**，寻找二维码
2. **将截图发送到闲鱼群聊**，让用户用APP扫码
   ```
   message action=send channel=feishu target={{FEISHU_CHAT_ID}} message="⚠️ 闲鱼被风控拦截，请打开闲鱼APP扫描下方二维码恢复登录"
   ```
   发送截图到群聊：
   ```
   message action=send channel=feishu target={{FEISHU_CHAT_ID}} filePath=/tmp/openclaw/screenshot-xxx.png
   ```
3. **等待用户扫码恢复**，当前任务结束。下次 Cron 触发时自动使用新的登录态。

### 登录失效（需要扫码登录）
1. 截图二维码所在区域
2. 发送到闲鱼群聊让用户扫码
3. 通知用户

> 如果页面有可识别的二维码元素，优先截图包含二维码的区域。
> 如果页面没有二维码（如纯文字提示），截全屏并发到群聊说明情况。

---

## 七、API发货失败兜底

API发货失败时，通知群聊让用户协助：
```
message action=send channel=feishu target={{FEISHU_CHAT_ID}} message="⚠️ 发货API调用失败，请扫码确认发货"
```
然后发送截图给用户扫码（作为兜底方案）：
```
message action=send filePath=截图路径 message="请扫码确认发货" target={{FEISHU_USER_ID}}
```

---

## 八、Cron 配置

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
  --message '检查闲鱼新消息，有已付款订单就发货。流程：①打开聊天页→②检查风控→③扫描待发货订单→④点去发货获取订单号→⑤调虚拟发货API标记已发货→⑥发送商品内容给买家→⑦上报结果到群聊。遇到风控或登录失效截图发群让用户扫码。'
```

**配置说明：**
- `--session isolated`：不占用主会话
- `--light-context`：轻量上下文加速
- `--announce`：公告到飞书
- `--target {{FEISHU_CHAT_ID}}`：**必须指定群聊**，不能发到用户 DM
- `*/30 * * * *`：安全频率，不要改短

**⚠️ 致命警告：永远不要在主会话提到闲鱼**
- 所有闲鱼相关通知（巡检、发货、风控、API失败、扫码请求）**只能**推送到群聊（{{FEISHU_CHAT_ID}}）
- 禁止在主会话回复任何闲鱼相关内容

---

## 九、配置选项

### 商品信息（按实际商品修改）
```
商品：{{YOUR_PRODUCT_TITLE}}（ID: {{YOUR_PRODUCT_ID}}）
发货内容：{{YOUR_DELIVERY_CONTENT}}
```

### 环境变量

| 变量 | 说明 | 默认值 |
|-----|------|--------|
| `FEISHU_CHAT_ID` | 飞书群聊ID | 必填 |
| `FEISHU_USER_ID` | 飞书用户ID（兜底通知用） | 可选 |
| `YOUR_APP_KEY` | 闲鱼API签名用appKey | 必填 |
| `KEY_POOL_FILE` | 秘钥池文件路径 | `keys.txt` |
| `CHAT_URL` | 闲鱼聊天URL | `https://www.goofish.com/im` |

---

## 十、故障排查

### 问题1：browser tool 连接失败
**症状：** CDP 不可达
**解决方案：**
```bash
# 确认 Chrome 正在运行
curl -s http://127.0.0.1:18800/json/version

# 确认 Xvfb 正在运行
pgrep Xvfb || (nohup Xvfb :99 -screen 0 1920x1080x24 > /tmp/xvfb.log 2>&1 &)
```

### 问题2：页面元素找不到
**症状：** ref 无效或按钮点击失败
**解决方案：**
1. 重新执行 snapshot 获取最新页面状态
2. 使用新的 ref（ref 会随着页面变化而失效）

### 问题3：无法检测付款
**症状：** 始终返回"暂无新付款"
**排查步骤：**
1. 确认买家已付款（在闲鱼 APP 中查看）
2. 确认是系统卡片，不是用户文本
3. 检查快照内容是否包含付款关键字

### 问题4：_m_h5_tk 获取失败
**症状：** API 返回 token 过期
**解决方案：**
1. 确认使用的是 goofish.com 域的 cookie，不是 taobao.com 的
2. 浏览器访问闲鱼首页让 token 自动续期
3. 如仍失败，截图发群让用户重新扫码登录

---

## 十一、给新 Agent 的快速指南

如果你刚接手这个任务，按以下步骤做就行：

1. `browser action=open label=xianyu profile=openclaw targetUrl=https://www.goofish.com/im`
2. `browser action=snapshot targetId=xianyu`
3. 看有没有"等待卖家发货"或"等待你发货"的买家
4. 如果页面有风控/滑块/非法访问 → 
   a. `browser action=screenshot targetId=xianyu` 截屏
   b. 发到闲鱼群聊让用户扫码恢复登录
   c. 上报：⚠️ 风控，已发截图到群聊请扫码
5. 如果页面显示登录二维码 → 截图发群让用户扫码
6. 如果有待发货订单：
   a. 点击买家进入聊天
   b. 点"去发货"按钮 → 得到订单号（来自URL）
   c. 用 document.cookie 拿 _m_h5_tk（goofish.com 域）
   d. 调虚拟发货API → 标记已发货
   e. 如果API失败 → 发消息到群聊叫用户扫码
   f. 聊天框输入发货内容 → 发送
7. 上报结果到闲鱼群聊

---

## 十二、免责声明

本系统仅供学习和个人使用，请遵守闲鱼的使用条款。作者不对使用本系统造成的任何后果负责。
