---
name: xianyu-auto-fulfillment
description: >
  闲鱼自动发货框架 - 一个可扩展的闲鱼虚拟商品自动化发货系统。提供核心的付款检测逻辑，发货流程完全可自定义。
  - 核心功能：自动检测买家付款（系统卡片识别）
  - 可扩展：支持任意发货方式（秘钥、链接、图片、文件、自定义API等）
  - 灵活配置：通过脚本或配置文件自定义发货逻辑
  - 内置模板：提供多种常见发货场景的模板
  - 使用 browser tool + Obscura 进行网页自动化
metadata: {"clawdbot":{"emoji":"🐟","requires":["browser-tool","obscura"]}}
read_when:
  - Automating Xianyu (闲鱼) virtual goods delivery
  - Monitoring chat messages for payment confirmation
  - Customizable fulfillment workflow for various product types
---

# 🐟 闲鱼自动发货框架

一个可扩展的闲鱼虚拟商品自动化发货系统。核心提供付款检测，发货流程完全可自定义。

## 浏览器配置

本框架使用 **browser tool + Obscura** 作为浏览器内核。

**Obscura 配置（已就绪）：**
- profile 名称：`obscura`
- CDP 连接：`ws://127.0.0.1:9222`
- 内存占用：~30MB（比 Chrome 的 200MB+ 轻量很多）
- 启动命令：`obscura serve --port 9222`

**确保 Obscura 运行中：**
```bash
curl -s http://127.0.0.1:9222/json/version && echo "Obscura 运行正常" || \
  (nohup obscura serve --port 9222 > /tmp/obscura.log 2>&1 & sleep 3 && \
   curl -s http://127.0.0.1:9222/json/version && echo "Obscura 已启动")
```

---

## 🎯 设计理念

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
│                  自定义发货层（用户实现）                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  秘钥发货    │  │  链接发货    │  │  图片发货    │  ...  │
│  │  - 固定秘钥  │  │  - 网盘链接  │  │  - 二维码    │       │
│  │  - 秘钥池    │  │  - 下载地址  │  │  - 截图      │       │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  文件发货    │  │  API发货    │  │  自定义逻辑  │  ...  │
│  │  - 发送文件  │  │  - 调用接口  │  │  - 按需定制  │       │
│  │  - 上传网盘  │  │  - 返回数据  │  │              │       │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

**核心原则：**
- **关注点分离**：检测逻辑由框架提供，发货逻辑由用户自定义
- **可扩展性**：支持任意类型的发货方式
- **零侵入**：框架不强制特定的发货方式
- **开箱即用**：提供常用场景的完整模板

---

## 🏗️ 核心概念

### 1. 付款检测（框架核心）

自动检测闲鱼聊天中的系统付款卡片：

```
✅ 检测条件（AND 关系）：
  - 消息类型：系统卡片（不是用户文本）
  - 卡片内容："我已付款，等待你发货"
  - 按钮标识：有"去发货"按钮

❌ 排除情况：
  - 用户手打的："我已付款了"、"老板发货"等
  - 没有"去发货"按钮的消息
  - "待付款"状态的卡片
```

### 2. browser tool 调用方式

本框架使用 OpenClaw 的 browser tool 进行浏览器自动化。

**打开闲鱼聊天页面：**
```json
browser action=open profile=obscura targetUrl="https://www.goofish.com/im" label=xianyu-chat
```

**获取快照：**
```json
browser action=snapshot profile=obscura targetId=xianyu-chat
```

**点击元素：**
```json
browser action=act profile=obscura targetId=xianyu-chat kind=click ref=<element_ref>
```

**输入文本：**
```json
browser action=act profile=obscura targetId=xianyu-chat kind=type ref=<input_ref> text="要发送的内容"
```

**搜索文本并点击：**
先 snapshot，再根据文本内容找到对应的 ref 进行点击操作。

### 3. 发货钩子（用户实现）

当检测到付款后，框架调用用户定义的发货钩子。**注意：本框架的核心监控逻辑由 agent 在运行时通过 browser tool 执行**，发货钩子需要通过 exec tool 调用脚本或直接发送消息。

### 4. 订单上下文

发货时可用的上下文信息（由 agent 从页面快照中提取）：

| 变量 | 说明 | 示例 |
|-----|------|------|
| `$BUYER_NICKNAME` | 买家昵称 | "atting丶" |
| `$ORDER_AMOUNT` | 订单金额 | "9.90" |
| `$ORDER_TIME` | 下单时间 | "2026-02-28 15:30:00" |
| `$PRODUCT_TITLE` | 商品标题 | "VIP会员兑换码" |

---

## 📦 内置发货模板

框架提供了多种常见发货场景的完整模板，可直接使用或作为参考。

**重要：** 以下模板均为 agent 在执行发货时的行为指南，agent 通过 browser tool 与页面交互。

### 模板 1：秘钥发货（固定秘钥）

**适用场景：**
- 测试商品（所有人用同一个秘钥）
- 免费资源分享
- 公开教程

**Agent 执行流程：**
1. 使用 browser tool 获取聊天快照
2. 找到输入框 ref
3. 使用 `kind=type` 输入秘钥
4. 使用 `kind=click` 点击发送按钮

### 模板 2：秘钥发货（秘钥池）

**适用场景：**
- 每个订单使用不同秘钥
- 批量售卖虚拟商品
- 需要追踪每个秘钥使用情况

**Agent 执行流程：**
1. 从秘钥池文件（keys.txt）读取第一行
2. 删除已用行
3. 在页面输入框中输入秘钥
4. 点击发送

### 模板 3：链接发货（网盘/下载链接）

**适用场景：**
- 数字资源下载（软件、电子书、课程）
- 大文件分享（视频、音频）
- 云盘分享

### 模板 4：API 发货（调用外部服务）

**适用场景：**
- 调用自动生成秘钥的 API
- 集成第三方发货服务
- 调用自己的服务器

---

## 🚀 框架核心实现

### 监控流程（Agent 执行步骤）

当 cron 触发或 agent 被要求"检查闲鱼"时，执行以下步骤：

**Step 0: 确保 Obscura 运行**
```bash
curl -s http://127.0.0.1:9222/json/version > /dev/null 2>&1 || \
  nohup obscura serve --port 9222 > /tmp/obscura.log 2>&1 &
```

**Step 1: 打开闲鱼聊天页面**
```json
browser action=open profile=obscura targetUrl="https://www.goofish.com/im" label=xianyu-chat
```

**Step 2: 快速检测付款**
```json
browser action=snapshot profile=obscura targetId=xianyu-chat
```
在快照中搜索：
- ✅ 找到 `"我已付款，等待你发货"` 或 `"等待卖家发货"` → 进入 Step 3
- ❌ 无匹配 → 结束

**Step 3: 进入买家聊天**
```json
browser action=act profile=obscura targetId=xianyu-chat kind=click ref=<买家消息的链接ref>
```

**Step 4: 获取输入框并发送秘钥**
```json
browser action=snapshot profile=obscura targetId=xianyu-chat
```
找到输入框 ref，然后：
```json
browser action=act profile=obscura targetId=xianyu-chat kind=type ref=<input_ref> text="您的秘钥：xxx，祝您使用愉快！"
browser action=act profile=obscura targetId=xianyu-chat kind=click ref=<发送按钮ref>
```

**Step 5: 返回聊天列表**
```json
browser action=navigate profile=obscura targetId=xianyu-chat url="https://www.goofish.com/im"
```

---

## ⚠️ 重要经验教训

### 1. 不要点击"去发货"按钮

**原因：** 点击"去发货"按钮会弹出需要 APP 扫码确认的对话框，网页版无法完成此操作。

**正确做法：** 检测到付款订单后，直接在聊天框发送秘钥/链接即可，无需点击任何按钮。

### 2. 定时任务必须使用 main session

**原因：** isolated session 每次启动都是新的浏览器实例，无法复用已登录的浏览器状态。

**正确做法：**
```bash
openclaw cron add \
  --name "闲鱼自动发货" \
  --cron "* * * * *" \
  --tz "Asia/Shanghai" \
  --session main \
  --announce \
  --channel feishu \
  --target {{FEISHU_CHAT_ID}} \
  --system-event "检查闲鱼新消息，有付款订单就发货。发货方式：<根据用户回答填写>" \
  --wake now
```

**⚠️ 致命警告：所有通知必须推送到指定群聊**
- `--target {{FEISHU_CHAT_ID}}` 是这个 crontab 工作的关键
- 所有闲鱼相关通知只能推送到指定群聊，禁止在主会话提闲鱼任何事

### 3. 快速判断：无新消息 = 无新订单

**如果当前聊天列表没有显示新消息（没有红点、没有"刚刚"时间戳），可以快速结束检查。**

---

## 🔧 配置选项

### 环境变量

| 变量 | 说明 | 默认值 |
|-----|------|--------|
| `OBSCURA_CDP_URL` | Obscura CDP 地址 | `ws://127.0.0.1:9222` |
| `OBSCURA_PROFILE` | Browser profile 名称 | `obscura` |
| `CHAT_URL` | 闲鱼聊天 URL | `https://www.goofish.com/im` |
| `KEY_POOL_FILE` | 秘钥池文件路径 | `keys.txt` |
| `CHECK_INTERVAL` | 检查间隔（秒） | `30` |

### Obscura 常用命令

```bash
# 启动 Obscura
nohup obscura serve --port 9222 > /tmp/obscura.log 2>&1 &

# 检查运行状态
curl -s http://127.0.0.1:9222/json/version

# 停止 Obscura
pkill obscura
```

---

## ⚠️ 故障排查

### 问题 1：无法检测付款

**症状：** 始终返回"暂无新付款"

**排查步骤：**
1. 确认买家已付款（在闲鱼 APP 中查看）
2. 确认是系统卡片，不是用户文本
3. 检查快照内容是否包含付款关键字

### 问题 2：browser tool 连接失败

**症状：** `cdpUrl is not reachable`

**解决方案：**
```bash
# 确认 Obscura 正在运行
curl -s http://127.0.0.1:9222/json/version

# 如果没有运行，启动它
nohup obscura serve --port 9222 > /tmp/obscura.log 2>&1 &
sleep 3
```

### 问题 3：页面元素找不到

**症状：** `ref` 无效或按钮点击失败

**解决方案：**
1. 重新执行 snapshot 获取最新页面状态
2. 使用新的 ref（ref 会随着页面变化而失效）
3. 使用 `urls=true` 查看页面中的链接

---

## ⚠️ 免责声明

本框架仅供学习和个人使用，请遵守闲鱼的使用条款。作者不对使用本框架造成的任何后果负责。
