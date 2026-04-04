const express = require('express');
const router = express.Router();
const https = require('https');
const { loadSettings, saveSettings, PROVIDER_PRESETS } = require('../services/settingsService');

// ——— 工具 ———
function maskKey(key) {
  if (!key) return '';
  if (key.length <= 10) return key.substring(0, 3) + '***';
  return key.substring(0, 6) + '***' + key.slice(-4);
}
function withMaskedKeys(settings) {
  return {
    ...settings,
    providers: settings.providers.map(p => ({
      ...p,
      api_key_masked: maskKey(p.api_key),
      api_key: undefined,
    })),
  };
}

// ——— 供应商预设（供前端展示快速填充） ———
router.get('/presets', (req, res) => {
  const presets = Object.entries(PROVIDER_PRESETS).map(([id, p]) => ({
    id, name: p.name, api_url: p.api_url, defaultModels: p.defaultModels,
  }));
  res.json({ success: true, data: presets });
});

// ——— 读取全部设置 ———
router.get('/', (req, res) => {
  res.json({ success: true, data: withMaskedKeys(loadSettings()) });
});

// ——— 供应商 CRUD ———

// 批量刷新所有供应商状态（必须在 :id 路由之前）
router.post('/providers/refresh-all', async (req, res) => {
  const settings = loadSettings();
  const results = [];
  for (const p of settings.providers) {
    if (!p.api_key || !p.enabled) {
      results.push({ id: p.id, status: 'skipped' });
      continue;
    }
    try {
      await testProviderConnection(p);
      p.last_tested = new Date().toISOString();
      p.test_status = 'ok';
      p.test_error = null;
      results.push({ id: p.id, status: 'ok' });
    } catch (err) {
      p.last_tested = new Date().toISOString();
      p.test_status = 'error';
      p.test_error = err.message;
      results.push({ id: p.id, status: 'error', error: err.message });
    }
  }
  saveSettings(settings);
  res.json({ success: true, results, refreshed_at: new Date().toISOString() });
});

// 新增供应商
router.post('/providers', (req, res) => {
  const { id, name, api_url, api_key, models = [] } = req.body;
  if (!name || !api_url) return res.status(400).json({ success: false, error: '请填写供应商名称和 API 地址' });
  const settings = loadSettings();
  const newId = (id || name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') || Date.now().toString());
  if (settings.providers.find(p => p.id === newId)) {
    return res.status(400).json({ success: false, error: '供应商 ID 已存在，请使用不同名称' });
  }
  settings.providers.push({
    id: newId, name, api_url, api_key: api_key || '', enabled: !!api_key,
    models: models.map(m => ({ ...m, enabled: true })),
    last_tested: null, test_status: null, created_at: new Date().toISOString(),
  });
  saveSettings(settings);
  res.json({ success: true, data: { id: newId } });
});

// 更新供应商基本信息（名称/URL/Key）
router.put('/providers/:id', (req, res) => {
  const { name, api_url, api_key } = req.body;
  const settings = loadSettings();
  const p = settings.providers.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ success: false, error: '供应商不存在' });
  if (name !== undefined) p.name = name;
  if (api_url !== undefined) p.api_url = api_url;
  if (api_key !== undefined) { p.api_key = api_key.trim(); p.enabled = !!p.api_key; }
  saveSettings(settings);
  res.json({ success: true });
});

// 删除供应商
router.delete('/providers/:id', (req, res) => {
  const settings = loadSettings();
  settings.providers = settings.providers.filter(p => p.id !== req.params.id);
  saveSettings(settings);
  res.json({ success: true });
});

// ——— 模型 CRUD ———

// 添加模型到供应商
router.post('/providers/:id/models', (req, res) => {
  const { id: modelId, name, type, use } = req.body;
  if (!modelId || !name) return res.status(400).json({ success: false, error: '请填写模型 ID 和名称' });
  const settings = loadSettings();
  const p = settings.providers.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ success: false, error: '供应商不存在' });
  if (!p.models) p.models = [];
  p.models.push({ id: modelId, name, type: type || 'chat', use: use || 'story', enabled: true });
  saveSettings(settings);
  res.json({ success: true });
});

// 删除模型
router.delete('/providers/:id/models/:modelId', (req, res) => {
  const settings = loadSettings();
  const p = settings.providers.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ success: false, error: '供应商不存在' });
  p.models = (p.models || []).filter(m => m.id !== req.params.modelId);
  saveSettings(settings);
  res.json({ success: true });
});

// 切换模型启用状态
router.put('/providers/:id/models/:modelId/toggle', (req, res) => {
  const settings = loadSettings();
  const p = settings.providers.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ success: false, error: '供应商不存在' });
  const m = (p.models || []).find(m => m.id === req.params.modelId);
  if (!m) return res.status(404).json({ success: false, error: '模型不存在' });
  m.enabled = !m.enabled;
  saveSettings(settings);
  res.json({ success: true, data: { enabled: m.enabled } });
});

// ——— 测试连接 ———
router.post('/providers/:id/test', async (req, res) => {
  const settings = loadSettings();
  const p = settings.providers.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ success: false, error: '供应商不存在' });
  if (!p.api_key) return res.json({ success: false, error: '未配置 API Key' });
  try {
    const testResult = await testProviderConnection(p);
    p.last_tested = new Date().toISOString();
    p.test_status = 'ok';
    p.test_error = null;
    p.test_detail = testResult.detail || null;
    saveSettings(settings);
    res.json({ success: true, message: testResult.message || '连接正常', detail: testResult.detail || null });
  } catch (err) {
    p.last_tested = new Date().toISOString();
    p.test_status = 'error';
    p.test_error = err.message;
    saveSettings(settings);
    res.json({ success: false, error: err.message });
  }
});


async function testProviderConnection(p) {
  const testUrls = {
    'api.openai.com':            '/v1/models',
    'api.deepseek.com':          '/v1/models',
    'open.bigmodel.cn':          '/api/paas/v4/models',
    'api.stability.ai':          '/v2beta/user/balance',
    'api.replicate.com':         '/v1/account',
    'api-inference.huggingface.co': null,
    'api.anthropic.com':         '/v1/models',
    'api-beijing.klingai.com':   '/v1/videos/text2video',  // Kling uses JWT
    'fal.run':                   '/fal-ai/wan/v2.1/1.3b',
    'api.minimaxi.chat':        '/v1/models',
    'api.lumalabs.ai':          '/dream-machine/v1/generations',
    'api.pika.art':             '/api/v1/generations',
    'api.elevenlabs.io':        '/v1/voices',
    'api.fish.audio':           '/v1/models',
    'dashscope.aliyuncs.com':   '/compatible-mode/v1/models',
  };
  const urlObj = new URL(p.api_url);
  const testPath = testUrls[urlObj.hostname] || '/v1/models';

  // Kling 使用 JWT 鉴权
  let authKey = p.api_key;
  if (p.id === 'kling' && p.api_key.includes(':')) {
    const crypto = require('crypto');
    const [ak, sk] = p.api_key.split(':');
    const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
    const now = Math.floor(Date.now()/1000);
    const payload = Buffer.from(JSON.stringify({iss:ak,exp:now+1800,nbf:now-5})).toString('base64url');
    const sig = crypto.createHmac('sha256',sk).update(`${header}.${payload}`).digest('base64url');
    authKey = `${header}.${payload}.${sig}`;
  }
  // Anthropic 使用 x-api-key
  if (p.id === 'anthropic') {
    const body = await httpGetCustom(`https://${urlObj.hostname}/v1/models`, { 'x-api-key': p.api_key, 'anthropic-version': '2023-06-01' });
    return checkResponseBody(body, p);
  }
  // ElevenLabs 使用 xi-api-key
  if (p.id === 'elevenlabs') {
    const body = await httpGetCustom(`https://api.elevenlabs.io/v1/voices`, { 'xi-api-key': p.api_key });
    return checkResponseBody(body, p);
  }

  const authType = p.id === 'huggingface' ? 'hf' : 'bearer';
  const proto = urlObj.protocol === 'https:' ? 'https' : 'http';
  const body = await httpGet(`${proto}://${urlObj.hostname}${testPath}`, authKey, authType);
  return checkResponseBody(body, p);
}

// 解析 API 响应内容，检测余额/配额问题
function checkResponseBody(body, provider) {
  const result = { message: '连接正常', detail: null };
  if (!body) return result;
  try {
    const j = JSON.parse(body);
    // Stability AI: 检查 balance
    if (j.credits !== undefined) {
      const credits = parseFloat(j.credits);
      result.detail = `余额: ${credits.toFixed(2)}`;
      if (credits <= 0) throw new Error(`余额不足 (${credits.toFixed(2)} credits)`);
      if (credits < 1) result.message = `连接正常 (余额偏低: ${credits.toFixed(2)})`;
    }
    // DeepSeek / OpenAI 兼容: 检查 error 字段
    if (j.error) {
      const errMsg = typeof j.error === 'string' ? j.error : (j.error.message || j.error.type || JSON.stringify(j.error));
      if (/insufficient|quota|balance|exceeded|billing|payment|credit/i.test(errMsg)) {
        throw new Error(`额度问题: ${errMsg}`);
      }
    }
    // 通用: 检查 detail 字段（一些 API 用 detail 返回错误）
    if (j.detail && typeof j.detail === 'string' && /insufficient|quota|balance|exceeded|billing/i.test(j.detail)) {
      throw new Error(`额度问题: ${j.detail}`);
    }
    // Replicate: 检查 billing 状态
    if (j.billing_status && j.billing_status !== 'active') {
      throw new Error(`账户状态异常: ${j.billing_status}`);
    }
  } catch (e) {
    if (e.message.startsWith('余额') || e.message.startsWith('额度') || e.message.startsWith('账户')) throw e;
    // JSON parse 失败不是错误，有些 API 返回非 JSON
  }
  return result;
}

function httpGetCustom(url, headers) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.request({ hostname: urlObj.hostname, path: urlObj.pathname + (urlObj.search || ''), method: 'GET', headers: { ...headers, 'User-Agent': 'VIDO/1.0' } }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        if (res.statusCode === 401 || res.statusCode === 403) reject(new Error('API Key 无效'));
        else if (res.statusCode === 402) reject(new Error('余额不足 (HTTP 402)'));
        else if (res.statusCode === 429) {
          try { const j = JSON.parse(body); reject(new Error(j.message || j.error?.message || '余额不足或请求过多')); } catch { reject(new Error('余额不足或请求过多')); }
        }
        else if (res.statusCode >= 500) reject(new Error(`服务异常 HTTP ${res.statusCode}`));
        else resolve(body);
      });
    });
    req.on('error', e => reject(new Error('网络不通: ' + e.message)));
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('连接超时')); });
    req.end();
  });
}

function httpGet(url, apiKey, authType = 'bearer') {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const headers = authType === 'hf'
      ? { 'Authorization': `token ${apiKey}`, 'User-Agent': 'VIDO/1.0' }
      : { 'Authorization': `Bearer ${apiKey}`, 'User-Agent': 'VIDO/1.0' };
    const req = https.request({ hostname: urlObj.hostname, path: urlObj.pathname + (urlObj.search || ''), method: 'GET', headers }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        if (res.statusCode === 401 || res.statusCode === 403) reject(new Error('API Key 无效'));
        else if (res.statusCode === 402) reject(new Error('余额不足 (HTTP 402)'));
        else if (res.statusCode === 429) {
          try { const j = JSON.parse(body); reject(new Error(j.message || j.error?.message || '余额不足或请求过多')); } catch { reject(new Error('余额不足或请求过多')); }
        }
        else if (res.statusCode >= 500) reject(new Error(`服务异常 HTTP ${res.statusCode}`));
        else resolve(body);
      });
    });
    req.on('error', e => reject(new Error('网络不通: ' + e.message)));
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('连接超时')); });
    req.end();
  });
}

// ——— MCP 连接器 ———
router.post('/mcps', (req, res) => {
  const { name, url, description } = req.body;
  if (!name || !url) return res.status(400).json({ success: false, error: '请填写名称和 URL' });
  const settings = loadSettings();
  settings.mcps.push({ id: Date.now().toString(), name, url, description: description || '', enabled: true, created_at: new Date().toISOString() });
  saveSettings(settings);
  res.json({ success: true });
});
router.delete('/mcps/:id', (req, res) => {
  const settings = loadSettings();
  settings.mcps = settings.mcps.filter(m => m.id !== req.params.id);
  saveSettings(settings);
  res.json({ success: true });
});

// ——— Skill 管理 ———
router.post('/skills', (req, res) => {
  const { name, description, type, endpoint, emoji } = req.body;
  if (!name) return res.status(400).json({ success: false, error: '请填写 Skill 名称' });
  const settings = loadSettings();
  settings.skills.push({ id: Date.now().toString(), name, description: description || '', type: type || '通用', endpoint: endpoint || '', emoji: emoji || '⚡', enabled: true, created_at: new Date().toISOString() });
  saveSettings(settings);
  res.json({ success: true });
});
router.delete('/skills/:id', (req, res) => {
  const settings = loadSettings();
  settings.skills = settings.skills.filter(s => s.id !== req.params.id);
  saveSettings(settings);
  res.json({ success: true });
});

// ——— 风格模板 ———
router.get('/style-templates', (req, res) => {
  const settings = loadSettings();
  // 合并内置 + 自定义模板
  const builtin = require('../services/projectService').ANIM_STYLE_PROMPTS || {};
  const custom = settings.style_templates || {};
  const templates = {};
  for (const [id, conf] of Object.entries(builtin)) {
    templates[id] = { ...conf, builtin: true };
  }
  for (const [id, conf] of Object.entries(custom)) {
    templates[id] = { ...conf, builtin: false };
  }
  res.json({ success: true, templates });
});

router.post('/style-templates', (req, res) => {
  const { id, prefix, negative, storyHint } = req.body;
  if (!id || !prefix) return res.status(400).json({ success: false, error: '缺少 id 或 prefix' });
  const settings = loadSettings();
  if (!settings.style_templates) settings.style_templates = {};
  settings.style_templates[id] = { prefix, negative: negative || '', storyHint: storyHint || '' };
  saveSettings(settings);
  res.json({ success: true });
});

router.delete('/style-templates/:id', (req, res) => {
  const settings = loadSettings();
  if (settings.style_templates) {
    delete settings.style_templates[req.params.id];
    saveSettings(settings);
  }
  res.json({ success: true });
});

module.exports = router;
