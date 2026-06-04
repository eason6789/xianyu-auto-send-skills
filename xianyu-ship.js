#!/usr/bin/env node
// 闲鱼多货品自动发货 CLI 脚本
//
// 用法: node xianyu-ship.js
// Cron: (每15分钟) cd /root/xianyu && node xianyu-ship.js >> /tmp/xianyu-ship.log 2>&1
//
// 特点:
// - 0 token 消耗 (纯本地脚本)
// - 多货品配置 (products.json)
// - 自动 Xvfb 管理
// - Cookie 持久化 (避免反复登录)
// - 风控自动检测 + 飞书通知
// - MTop 虚拟发货 API 签名

const { chromium, request } = require('playwright');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ===================== 配置 =====================

// 敏感配置从 config.local.json 读取 (不入 git)
const configPath = path.join(__dirname, 'config.local.json');
let localConfig = {};
if (fs.existsSync(configPath)) {
  localConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

const CONFIG = {
  // 闲鱼
  chatUrl: 'https://www.goofish.com/im',
  // Chrome (根据实际路径修改)
  chromePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  userDataDir: path.join(__dirname, '.chrome-profile'),
  // 如果有旧的浏览器 profile (已有登录态)，填到这里复用
  legacyProfile: localConfig.legacyProfile || '',
  // Xvfb
  xvfbDisplay: process.env.DISPLAY || ':99',
  xvfbScreen: '1920x1080x24',
  // 飞书 (从 config.local.json 或环境变量读取)
  feishu: {
    appId: localConfig.feishuAppId || process.env.FEISHU_APP_ID || '',
    appSecret: localConfig.feishuAppSecret || process.env.FEISHU_APP_SECRET || '',
    chatId: localConfig.feishuChatId || process.env.FEISHU_CHAT_ID || '',
  },
  // MTop API
  mtopAppKey: '12574478',
  mtopApi: 'mtop.taobao.idle.logistic.consign.dummy',
  mtopUrl: 'https://h5api.m.goofish.com/h5/mtop.taobao.idle.logistic.consign.dummy/1.0/',
  // 超时
  timeout: 30000,
};

// 校验必要配置
if (!CONFIG.feishu.appId && !process.env.FEISHU_APP_ID) {
  console.warn('⚠️ 未配置飞书通知，将只输出到本地日志');
}

// 加载货品配置
const productsPath = path.join(__dirname, 'products.json');
if (!fs.existsSync(productsPath)) {
  console.error('❌ products.json 不存在，请先配置货品');
  process.exit(1);
}
const PRODUCTS = JSON.parse(fs.readFileSync(productsPath, 'utf-8'));

// ===================== 工具函数 =====================

function log(msg) {
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  console.log(`[${ts}] ${msg}`);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// MD5
function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

// ===================== Xvfb =====================

function ensureXvfb() {
  const { execSync } = require('child_process');
  try {
    execSync(`pgrep Xvfb`, { stdio: 'ignore' });
    log('✅ Xvfb 已在运行');
  } catch {
    log('🔄 启动 Xvfb...');
    execSync(
      `nohup Xvfb ${CONFIG.xvfbDisplay} -screen 0 ${CONFIG.xvfbScreen} > /tmp/xvfb.log 2>&1 &`,
      { stdio: 'ignore' }
    );
    sleep(2000);
    log('✅ Xvfb 已启动');
  }
}

// ===================== 飞书通知 =====================

let feishuToken = null;
let feishuTokenExpiry = 0;

async function getFeishuToken() {
  if (feishuToken && Date.now() < feishuTokenExpiry) return feishuToken;

  const resp = await fetch(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: CONFIG.feishu.appId,
        app_secret: CONFIG.feishu.appSecret,
      }),
    }
  );
  const data = await resp.json();
  if (data.code !== 0) throw new Error(`飞书 token 获取失败: ${data.msg}`);
  feishuToken = data.tenant_access_token;
  feishuTokenExpiry = Date.now() + (data.expire - 300) * 1000;
  return feishuToken;
}

async function sendFeishu(text) {
  // 方式1: 飞书 API
  try {
    const token = await getFeishuToken();
    const resp = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        receive_id: CONFIG.feishu.chatId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      }),
    });
    const data = await resp.json();
    if (data.code === 0) {
      log('✅ 飞书通知已发送');
      return;
    }
    log(`⚠️ 飞书API发送失败: ${data.msg}`);
  } catch (err) {
    log(`⚠️ 飞书API异常: ${err.message}`);
  }

  // 方式2: Webhook 兜底
  try {
    await fetch('http://127.0.0.1:8000/webhook/feishu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    log('✅ 飞书Webhook已发送');
    return;
  } catch {}

  // 方式3: 写本地日志兜底
  const logFile = '/tmp/xianyu-notify.log';
  fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${text}\n`);
  log(`⚠️ 通知已写入本地: ${logFile}`);
}

// ===================== 浏览器 =====================

async function launchBrowser() {
  const xianyuProfile = CONFIG.userDataDir;

  // 首次运行：从旧 profile 复制登录态到 xianyu 专属目录 (避免与 OpenClaw 锁冲突)
  if (!fs.existsSync(xianyuProfile) && CONFIG.legacyProfile && fs.existsSync(CONFIG.legacyProfile)) {
    log('📋 首次运行，从旧 profile 复制登录态...');
    try {
      fs.cpSync(CONFIG.legacyProfile, xianyuProfile, { recursive: true,
        filter: (src) => !src.includes('Singleton') });
      log('✅ 登录态已复制到专属目录');
    } catch (e) {
      log(`⚠️ 复制失败: ${e.message}，将使用新 profile`);
    }
  }

  if (!fs.existsSync(xianyuProfile)) {
    log('🆕 使用全新浏览器 profile (首次需手动登录)');
  }

  const context = await chromium.launchPersistentContext(xianyuProfile, {
    executablePath: CONFIG.chromePath,
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
    viewport: { width: 1280, height: 800 },
  });

  // 注入反检测脚本
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
    window.chrome = { runtime: {} };
  });

  return context;
}

// ===================== 页面检测 =====================

function hasWindControl(text) {
  const keywords = [
    'unusual traffic', '非法访问', '使用正常浏览器',
    '滑块', 'slide to verify', '验证', 'captcha',
    '频率过高', '操作太频繁',
  ];
  const lower = text.toLowerCase();
  return keywords.some(k => lower.includes(k.toLowerCase()));
}

function hasLoginRequired(text, pageUrl) {
  // 页面URL对了但导航栏有"登录"按钮 = 未登录
  if (pageUrl && pageUrl.includes('goofish.com/im') && text.includes('登录') && text.includes('消息') && text.length < 200) {
    return true;
  }
  return text.includes('扫码登录') || text.includes('请登录');
}

/**
 * 检查订单是否已发货/已完成
 * @param {object} orderPage - 订单详情页
 * @returns {string} 'pending' | 'shipped' | 'completed' | 'unknown'
 */
async function checkOrderStatus(orderPage) {
  const status = await orderPage.evaluate(() => {
    const text = document.body.innerText || '';

    // 有"去评价"按钮 → 订单已完成
    if (/去评价/.test(text)) return 'completed';

    // 查找状态进度条中的当前/高亮状态
    const allEls = document.querySelectorAll('span, div, li, [class*="status"], [class*="step"], [class*="progress"]');
    for (const el of allEls) {
      const t = (el.textContent || '').trim();
      const cls = (el.className || '').toString();
      const isActive = /active|current|selected|highlight|finish/i.test(cls);
      if (isActive && /已发货|交易成功|交易关闭/.test(t)) return 'shipped';
    }

    // 兜底：检查页面是否有发货相关按钮
    if (/去发货|确认发货|立即发货/.test(text)) return 'pending';

    return 'unknown';
  });

  return status;
}

/**
 * 从页面文本中检测待发货订单
 * 返回买家昵称列表（或空数组）
 */
function findPendingOrders(text) {
  // 寻找系统消息 "等待你发货" "等待卖家发货" 等
  const patterns = [
    /等待你发货/g,
    /等待卖家发货/g,
    /我已付款[，,]等待你发货/g,
  ];

  const found = [];
  for (const p of patterns) {
    let m;
    while ((m = p.exec(text)) !== null) {
      found.push(m[0]);
    }
  }
  return found;
}

// ===================== MTop API =====================

/**
 * 调用闲鱼虚拟发货 API
 * @param {object} page - Playwright page (用于获取 cookie)
 * @param {string} orderId - 订单号
 */
async function callShippingAPI(page, orderId) {
  // 使用 Playwright APIRequestContext (共享浏览器 storage state, 正确处理 cookies)
  const storageState = await page.context().storageState();
  const apiContext = await request.newContext({ storageState });

  // 从 storage state 中找到 _m_h5_tk
  const mh5tkEntry = storageState.cookies.find(c => c.name === '_m_h5_tk');
  if (!mh5tkEntry) throw new Error('未找到 _m_h5_tk cookie，可能未登录');

  const token = mh5tkEntry.value.split('_')[0];
  const timestamp = Date.now();

  const data = JSON.stringify({
    orderId: orderId,
    tradeText: '',
    picList: [],
    newUnconsign: true,
  });

  const signStr = `${token}&${timestamp}&${CONFIG.mtopAppKey}&${data}`;
  const sign = md5(signStr);

  log(`  token: ${token.slice(0, 20)}...`);
  log(`  sign: ${sign.slice(0, 20)}...`);

  const params = new URLSearchParams({
    data, sign, t: String(timestamp), appKey: CONFIG.mtopAppKey,
    api: CONFIG.mtopApi, v: '1.0', type: 'originaljson', dataType: 'json'
  });

  const resp = await apiContext.post(CONFIG.mtopUrl, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Origin': 'https://www.goofish.com',
      'Referer': 'https://www.goofish.com/',
    },
    data: params.toString(),
  });

  const result = await resp.text();
  await apiContext.dispose();
  log(`  API 响应: ${result.slice(0, 400)}`);
  return result;
}

// ===================== 发货内容 =====================

/**
 * 根据货品配置生成发货消息
 */
function getDeliveryMessage(product, orderId) {
  switch (product.delivery.type) {
    case 'link':
      return product.delivery.message
        .replace('{{link}}', product.delivery.link)
        .replace('{{code}}', product.delivery.code || '');

    case 'keypool': {
      // 从秘钥池取一个
      const poolFile = path.join(__dirname, product.delivery.keypoolFile);
      if (!fs.existsSync(poolFile)) return null;
      const lines = fs.readFileSync(poolFile, 'utf-8')
        .split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#'));
      if (lines.length === 0) return null;
      const key = lines.shift();
      fs.writeFileSync(poolFile, lines.join('\n'), 'utf-8');
      // 记录已使用
      fs.appendFileSync(
        path.join(__dirname, 'used-keys.log'),
        `[${new Date().toISOString()}] orderId=${orderId} key=${key}\n`
      );
      return product.delivery.message.replace('{{key}}', key);
    }

    case 'fixed':
      return product.delivery.message;

    case 'api': {
      // 调用外部 API 获取内容 (同步)
      try {
        const https = require('https');
        const http = require('http');
        const lib = product.delivery.apiUrl.startsWith('https') ? https : http;
        return new Promise((resolve) => {
          lib.get(product.delivery.apiUrl, (res) => {
            let body = '';
            res.on('data', d => body += d);
            res.on('end', () => resolve(body.trim()));
          }).on('error', () => resolve(null));
        });
      } catch {
        return null;
      }
    }

    default:
      return null;
  }
}

// ===================== 主流程 =====================

async function main() {
  log('🚀 闲鱼自动发货 CLI 启动');
  const activeProducts = Object.keys(PRODUCTS).filter(k => !k.startsWith('_'));
  log(`📦 已加载 ${activeProducts.length} 个货品配置`);

  // 确保 Xvfb
  ensureXvfb();

  // 设置 DISPLAY
  process.env.DISPLAY = CONFIG.xvfbDisplay;

  let context;
  const results = { shipped: 0, noOrders: true, windControl: false, loginFailed: false, errors: [] };

  try {
    // 启动浏览器
    log('🌐 启动浏览器...');
    context = await launchBrowser();
    const page = await context.newPage();

    // 打开闲鱼 IM
    log('📱 打开闲鱼聊天页...');
    await page.goto(CONFIG.chatUrl, { waitUntil: 'domcontentloaded', timeout: CONFIG.timeout });
    await sleep(3000);

    // 获取页面文本
    let pageText = await page.evaluate(() => document.body.innerText || '');
    log(`  页面文本长度: ${pageText.length} 字符`);

    // === 风控检测 ===
    if (hasWindControl(pageText)) {
      log('⚠️ 检测到风控拦截！');
      results.windControl = true;
      const screenshotPath = `/tmp/xianyu-windcontrol-${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      log(`  截图已保存: ${screenshotPath}`);

      await sendFeishu(
        `⚠️ 闲鱼风控拦截！\n` +
        `时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n` +
        `请打开闲鱼APP扫码恢复登录\n` +
        `截图已保存到服务器: ${screenshotPath}`
      );

      await context.close();
      log('🏁 风控拦截，已通知用户');
      return;
    }

    // === 登录检测 + 自动触发 QR 登录 ===
    if (hasLoginRequired(pageText, page.url())) {
      log('⚠️ 未登录，触发登录流程...');
      results.loginFailed = true;

      // 点击"登录"按钮触发 QR 码弹窗
      const loginBtn = await page.$('text=登录');
      if (loginBtn) {
        await loginBtn.click();
        await sleep(3000);
        pageText = await page.evaluate(() => document.body.innerText || '');
      }

      // 截图 QR 码
      const screenshotPath = `/tmp/xianyu-login-${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      log(`  QR截图: ${screenshotPath}`);

      await sendFeishu(
        `⚠️ 闲鱼需要扫码登录！\n` +
        `时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n` +
        `请打开闲鱼APP扫描二维码登录\n` +
        `截图路径: ${screenshotPath}`
      );

      await context.close();
      log('🏁 需登录，已通知用户');
      return;
    }

    // === 扫描待发货订单 ===
    log('🔍 扫描待发货订单...');
    const pendingOrders = findPendingOrders(pageText);

    if (pendingOrders.length === 0) {
      log('✅ 无待发货订单');
      await context.close();
      log('🏁 检查完毕，无新订单');
      return;
    }

    log(`📋 发现 ${pendingOrders.length} 个待发货标识`);

    // === 逐条处理 ===
    // 在会话列表中找出所有带 "等待卖家发货" 的会话，逐一点击进入
    const pendingConvs = await page.evaluate(() => {
      const items = document.querySelectorAll('[class*="conversation-item"]');
      const results = [];
      for (const item of items) {
        const text = item.textContent || '';
        if (text.includes('等待卖家发货') || text.includes('等待你发货')) {
          results.push({
            text: text.slice(0, 120),
            hasWaitTag: true
          });
        }
      }
      return results;
    });

    log(`  其中 ${pendingConvs.length} 个会话有待发货订单`);

    for (let i = 0; i < pendingConvs.length; i++) {
      try {
        log(`\n📦 处理第 ${i + 1}/${pendingConvs.length} 个订单...`);

        // 重新获取会话列表元素（页面可能变化），点击对应会话
        const convItems = await page.$$('[class*="conversation-item"]');
        let clicked = false;
        for (const item of convItems) {
          const t = await item.textContent();
          if (t && (t.includes('等待卖家发货') || t.includes('等待你发货'))) {
            await item.click();
            await sleep(3000);
            clicked = true;
            break;
          }
        }

        if (!clicked) {
          log('  ⚠️ 未能点击会话，跳过');
          continue;
        }

        // 此时进入聊天详情，查找所有"去发货"按钮
        // 一个买家可能有多个订单，每个未发货订单对应一个"去发货"按钮
        const shipBtns = await page.$$('button.msg-dx-button--UaR60azu');
        const actualBtns = [];
        for (const btn of shipBtns) {
          const t = await btn.textContent();
          if (t && t.trim() === '去发货') actualBtns.push(btn);
        }

        // 也尝试通用查找兜底
        if (actualBtns.length === 0) {
          const allBtns = await page.$$('button, [role="button"], a');
          for (const btn of allBtns) {
            const t = await btn.textContent();
            if (t && t.trim() === '去发货') actualBtns.push(btn);
          }
        }

        if (actualBtns.length === 0) {
          log('  ⚠️ 未找到"去发货"按钮，跳过');
          await page.goto(CONFIG.chatUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
          await sleep(2000);
          continue;
        }

        log(`  找到 ${actualBtns.length} 个"去发货"按钮`);

        // 从最后一个开始处理 (最新订单在最下面)
        for (let bi = actualBtns.length - 1; bi >= 0; bi--) {
          const btn = actualBtns[bi];
          let orderPage = null;

          try {
            // 滚动到按钮可见
            await btn.scrollIntoViewIfNeeded();
            await sleep(500);
            await btn.click();
            await sleep(3000);

            // 检查是否打开了新标签页
            const pages = context.pages();
            orderPage = pages[pages.length - 1];

            // 从 URL 提取 orderId
            const orderUrl = orderPage.url();
            const orderIdMatch = orderUrl.match(/orderId=(\d+)/);
            if (!orderIdMatch) {
              log(`  按钮${bi + 1}: 无法从 URL 提取 orderId，跳过`);
              await orderPage.close();
              continue;
            }
            const orderId = orderIdMatch[1];
            log(`  按钮${bi + 1}: 订单号 ${orderId}`);

            // 检查订单是否已完成/已发货
            const orderStatus = await checkOrderStatus(orderPage);
            log(`  订单状态: ${orderStatus}`);
            if (orderStatus === 'completed' || orderStatus === 'shipped') {
              log(`  ⏭️ 已发货/已完成，跳过`);
              await orderPage.close();
              continue;
            }

            // 从页面提取商品 ID
            const orderPageText = await orderPage.evaluate(() => document.body.innerText || '');
            let productId = null;

            for (const pid of Object.keys(PRODUCTS)) {
              if (orderPageText.includes(pid) || orderUrl.includes(pid)) {
                productId = pid;
                break;
              }
            }

            if (!productId) {
              const itemIdMatch = orderUrl.match(/itemId=(\d+)/);
              if (itemIdMatch && PRODUCTS[itemIdMatch[1]]) {
                productId = itemIdMatch[1];
              }
            }

            if (!productId && activeProducts.length === 1) {
              productId = activeProducts[0];
              log(`  💡 仅1个货品，默认: ${PRODUCTS[productId].name}`);
            }

            if (!productId) {
              log(`  ⚠️ 无法匹配货品配置，跳过`);
              await sendFeishu(`⚠️ 发现新订单但无法匹配货品\n订单号: ${orderId}\nURL: ${orderUrl.slice(0, 120)}`);
              await orderPage.close();
              continue;
            }

            const product = PRODUCTS[productId];
            log(`  🏷️ ${product.name} (${productId})`);

            // === 调虚拟发货 API ===
            log(`  🚚 调用虚拟发货 API...`);
            const apiResult = await callShippingAPI(page, orderId);

            if (apiResult.includes('SUCCESS') || apiResult.includes('ORDER_ALREADY_DELIVERY')) {
              log(`  ✅ API 调用成功`);
            } else {
              log(`  ⚠️ API 异常: ${apiResult.slice(0, 200)}`);
              await sendFeishu(
                `⚠️ 闲鱼发货API异常\n` +
                `订单号: ${orderId}\n` +
                `货品: ${product.name}\n` +
                `API返回: ${apiResult.slice(0, 300)}\n` +
                `请手动确认发货状态`
              );
              await orderPage.close();
              results.errors.push(`API失败: ${orderId}`);
              continue;
            }

            // === 发送发货内容 ===
            const deliveryMsg = await getDeliveryMessage(product, orderId);
            if (deliveryMsg) {
              log(`  💬 发送发货内容...`);

              // 回到聊天页并重新打开对话
              const chatPage = pages[0];
              await chatPage.bringToFront();
              await sleep(500);

              // 刷新IM页面确保聊天UI正常
              await chatPage.goto(CONFIG.chatUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
              await sleep(3000);

              // 重新点击该对话
              const cvItems = await chatPage.$$('[class*="conversation-item"]');
              for (const cv of cvItems) {
                const t = await cv.textContent();
                if (t && (t.includes('等待卖家发货') || t.includes('等待你发货') || t.includes('等待买家收货'))) {
                  await cv.click();
                  await sleep(3000);
                  break;
                }
              }

              try {
                // 找到输入框 (闲鱼聊天用的是 textarea.textarea-no-border)
                const textarea = await chatPage.$('textarea, [class*="textarea-no-border"]');
                if (textarea) {
                  await textarea.click();
                  await sleep(300);
                  await textarea.fill(deliveryMsg);
                  await sleep(500);
                  // 点击发送按钮或 Enter
                  const sendBtn = await chatPage.$('[class*="send-btn"], [class*="send-button"], button:has-text("发送")');
                  if (sendBtn) {
                    await sendBtn.click();
                  } else {
                    await chatPage.keyboard.press('Enter');
                  }
                  log(`  ✅ 消息已发送`);
                } else {
                  // 兜底：鼠标点击 + 键盘输入
                  log(`  ⚠️ 未找到textarea，尝试键盘输入...`);
                  await chatPage.mouse.click(800, 670);
                  await sleep(500);
                  await chatPage.keyboard.type(deliveryMsg, { delay: 50 });
                  await sleep(500);
                  await chatPage.keyboard.press('Enter');
                  log(`  ✅ 消息已发送(键盘)`);
                }
              } catch (e) {
                log(`  ⚠️ 发送失败: ${e.message}`);
              }
            }

            if (!orderPage.isClosed()) {
              await orderPage.close();
            }
            results.shipped++;
            results.noOrders = false;

          } catch (err) {
            log(`  ❌ 按钮${bi + 1}处理异常: ${err.message}`);
            results.errors.push(err.message);
            if (orderPage && !orderPage.isClosed()) {
              try { await orderPage.close(); } catch {}
            }
          }
        }

        // 处理完回 IM 列表
        await page.goto(CONFIG.chatUrl, { waitUntil: 'domcontentloaded', timeout: CONFIG.timeout });
        await sleep(3000);

      } catch (err) {
        log(`  ❌ 处理订单异常: ${err.message}`);
        results.errors.push(err.message);
        try { await page.goto(CONFIG.chatUrl, { waitUntil: 'domcontentloaded', timeout: 10000 }); await sleep(2000); } catch {}
      }
    }

    await context.close();

  } catch (err) {
    log(`❌ 主流程异常: ${err.message}`);
    if (context) {
      try { await context.close(); } catch {}
    }
    results.errors.push(err.message);
  }

  // === 上报结果 ===
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  let report = '';
  if (results.windControl) {
    report = `⚠️ 闲鱼被风控拦截\n时间: ${now}\n请扫码恢复`;
  } else if (results.loginFailed) {
    report = `⚠️ 闲鱼需要重新登录\n时间: ${now}\n请扫码登录`;
  } else if (results.shipped > 0) {
    report = `✅ 闲鱼自动发货完成\n时间: ${now}\n已处理 ${results.shipped} 笔订单`;
    if (results.errors.length > 0) {
      report += `\n⚠️ ${results.errors.length} 笔异常: ${results.errors.join('; ')}`;
    }
  } else if (results.errors.length > 0) {
    report = `⚠️ 闲鱼巡检异常\n时间: ${now}\n错误: ${results.errors.slice(0, 3).join('; ')}`;
  } else {
    report = `✅ 闲鱼检查通过，无新订单\n时间: ${now}`;
    // 无订单时不发通知，避免刷屏
    log('🏁 ' + report);
    return;
  }

  log('🏁 上报结果到飞书...');
  await sendFeishu(report);
}

// ===================== 启动 =====================

main().catch(err => {
  log(`❌ 未捕获异常: ${err.message}`);
  console.error(err);
  process.exit(1);
});
