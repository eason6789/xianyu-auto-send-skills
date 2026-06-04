---
name: xianyu-auto-fulfill
description: >
  闲鱼多货品自动发货系统 (CLI版) — 0 Token 消耗，纯本地 Playwright 脚本驱动。
  支持多货品配置表、多种发货方式、风控自动检测+通知。
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
*/5 * * * * /opt/xianyu/start.sh >> /tmp/xianyu-cron.log 2>&1
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
  └─ ⑤ 逐一处理每个订单：
       ├─ 点击"去发货" → 提取 orderId
       ├─ 从页面提取 productId → 查 products.json
       ├─ 调用 MTop 虚拟发货 API
       └─ 按货品配置发送内容给买家
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

### 通知机制
- 主通道: 飞书机器人 API (tenant_access_token → im/v1/messages)
- 兜底通道: Webhook + 本地日志文件

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
