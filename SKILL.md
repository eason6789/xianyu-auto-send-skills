---
name: xianyu-auto-fulfill
description: >
  闲鱼多货品自动发货系统 (CLI版) — 0 Token 消耗，纯本地 Playwright 脚本驱动。
  支持多货品配置表、多种发货方式、风控自动检测+通知。
  支持同买家多订单、自动状态检测、键盘输入发送消息。
triggers:
  - 闲鱼发货
  - 闲鱼自动发货
  - xianyu
  - 自动发货
  - 闲鱼配置
metadata: {"clawdbot":{"emoji":"🐟","requires":["playwright","nodejs"]}}
---

# 闲鱼多货品自动发货系统 (CLI版)

> **0 Token 消耗** | 纯本地脚本 | 多货品配置表 | 全自动

## 为什么从 LLM Skill 改成 CLI 脚本？

| 对比维度 | 旧方案 (LLM Skill) | 新方案 (CLI脚本) |
|---------|-------------------|-----------------|
| Token 消耗 | 5万-8万/次 | **0** |
| 执行时间 | 2-5分钟 | 15-30秒 |
| 多货品 | ❌ 单商品 | ✅ 配置表驱动 |
| 可靠性 | 依赖LLM判断 | 逻辑固定，100%确定 |

## 使用方式

### 1. 部署到服务器

```bash
# 安装依赖
npm install playwright

# 上传脚本
scp xianyu-ship.js start.sh products.json root@YOUR_SERVER:/opt/xianyu/
```

### 2. 配置敏感信息 (config.local.json)

```json
{
  "legacyProfile": "/path/to/existing/browser/profile",
  "feishuAppId": "cli_xxxxxxxxxxxxxx",
  "feishuAppSecret": "xxxxxxxxxxxxxxxxxxxxxx",
  "feishuChatId": "oc_xxxxxxxxxxxxxxxxxxxxxx"
}
```

### 3. 配置货品 (products.json)

```json
{
  "YOUR_PRODUCT_ID": {
    "name": "商品名称",
    "delivery": {
      "type": "link",
      "message": "你好！资料链接：{{link}} 提取码：{{code}}",
      "link": "https://example.com/your-file",
      "code": "提取码"
    }
  }
}
```

### 4. 支持的发货方式

| type | 说明 | 配置示例 |
|------|------|---------|
| `link` | 链接发货 (网盘/下载) | `{"type":"link","link":"...","code":"..."}` |
| `fixed` | 固定文本 | `{"type":"fixed","message":"您的秘钥: XXX"}` |
| `keypool` | 秘钥池 (每单消耗一行) | `{"type":"keypool","keypoolFile":"keys.txt"}` |
| `api` | 调用外部API获取内容 | `{"type":"api","apiUrl":"http://..."}` |

### 5. 手动执行

```bash
cd /opt/xianyu && ./start.sh
```

### 6. Cron 自动执行

```bash
*/5 * * * * /root/xianyu/start.sh >> /tmp/xianyu-cron.log 2>&1
```

## 系统架构

```
Cron (每N分钟) → start.sh
  │
  ├─ ① 确保 Xvfb 运行 (虚拟显示)
  ├─ ② 启动 Chrome (反检测注入)
  ├─ ③ 打开闲鱼聊天页 (goofish.com/im)
  │   ├─ 风控？ → 截图 → 通知用户扫码 → 退出
  │   ├─ 需登录？→ 截图 → 通知用户扫码 → 退出
  │   └─ 正常 → 继续
  ├─ ④ 扫描"等待你发货"订单
  │   └─ 无 → 结束
  └─ ⑤ 逐一处理每个会话：
       ├─ 点击会话 → 查找所有"去发货"按钮 (支持同买家多订单)
       ├─ 从最新到最旧处理每个按钮
       ├─ 点击"去发货" → 打开订单详情
       ├─ 检测订单状态 (已完成→跳过 / 待发货→处理)
       ├─ 提取 orderId → 匹配 products.json
       ├─ 调用 MTop 虚拟发货 API
       │   └─ 使用 Playwright request.newContext(storageState) 共享认证态
       ├─ 刷新IM页面 → 重新进入对话
       ├─ 通过 textarea 输入框发送发货内容给买家
       └─ 飞书通知发货结果
```

## 关键技术点

### 反检测
- Chrome 启动参数: `--disable-blink-features=AutomationControlled`
- `addInitScript` 覆盖 `navigator.webdriver` 为 false
- 使用 `launchPersistentContext` 持久化 Cookie，避免反复登录

### MTop API 签名
```
sign = MD5(token + "&" + timestamp + "&" + appKey + "&" + data)
token = _m_h5_tk cookie 中 "_" 前面的部分
```

### API 认证 (关键！)
使用 Playwright 的 `request.newContext({ storageState })` 共享浏览器登录态，而不是手动拼接 Cookie。这是解决 `SESSION_EXPIRED` 的核心方法。

```javascript
const { chromium, request } = require('playwright');
const storageState = await page.context().storageState();
const apiContext = await request.newContext({ storageState });
const resp = await apiContext.post(mtopUrl, { headers, data });
```

### 同买家多订单处理
一个买家可能多次购买同一商品，每个未发货订单在聊天中都有一个"去发货"按钮。脚本通过 class `msg-dx-button--UaR60azu` 定位所有按钮，从最后一个（最新订单）开始处理。

### 订单状态检测
打开订单详情页后，检测页面内容判断订单状态：
- 出现「去评价」→ 已完成，跳过
- 出现「已发货」「交易成功」→ 已发货，跳过
- 出现「去发货」→ 待发货，继续处理

### 消息发送
闲鱼聊天输入框是 `<textarea class="textarea-no-border--...">`，通过 `textarea.fill()` 填入内容后按 Enter 发送。

### 浏览器 Profile 隔离
首次运行自动从旧 Profile 复制登录态到专属目录（过滤 Singleton 锁文件），避免与 OpenClaw 等工具的 Chrome 进程冲突。

## 新增货品步骤

1. 在闲鱼APP上架新商品，记下商品ID（从商品分享链接中提取 `id=` 参数）
2. 编辑 `products.json`，加入新货品配置
3. 选择发货方式（link/fixed/keypool/api）
4. 如果是秘钥池，创建对应的 `keys-xxx.txt` 文件
5. 下次 cron 自动识别新货品

## 文件说明

| 文件 | 用途 |
|------|------|
| `xianyu-ship.js` | 主脚本，包含完整发货逻辑 |
| `start.sh` | 启动脚本，管理 Xvfb + 环境变量 |
| `products.json` | 货品配置表（多商品支持） |
| `config.local.json` | 本地敏感配置（不入 git） |
| `keys-*.txt` | 秘钥池文件（可选，按需创建） |
