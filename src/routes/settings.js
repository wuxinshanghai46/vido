const express = require('express');
const router = express.Router();
const https = require('https');
const fs = require('fs');
const path = require('path');
const { loadSettings, saveSettings, PROVIDER_PRESETS, inferProviderAdapter } = require('../services/settingsService');
const { voices: VOLCENGINE_SPEECH_VOICES } = require('../services/volcengineSpeechCatalog');

function validateVolcengineSpeech(provider) {
  if (provider.id === 'aliyun-tts' || provider.preset === 'aliyun-tts') throw new Error('阿里 TTS 已停用，请配置字节豆包语音 TTS');
  if (provider.id !== 'volcengine-tts' && provider.preset !== 'volcengine-tts') return;
  const url = new URL(String(provider.api_url || 'https://openspeech.bytedance.com'));
  if (url.protocol !== 'https:' || url.hostname !== 'openspeech.bytedance.com') throw new Error('字节豆包语音 API 地址必须为 https://openspeech.bytedance.com');
  const invalid = (provider.models || []).find(model => (
    !['seed-tts-2.0', 'seed-icl-2.0'].includes(String(model?.id || ''))
    || model.type !== 'tts' || model.use !== 'tts'
  ));
  if (invalid) throw new Error(`字节语音专用供应商禁止配置非 TTS 模型：${invalid.id || 'unknown'}`);
  provider.api_url = 'https://openspeech.bytedance.com';
  provider.tts_resource_id = 'seed-tts-2.0';
  provider.clone_resource_id = 'seed-icl-2.0';
  provider.capability_scope = ['tts', 'voice_clone'];
}

function resetTtsRuntimeState() {
  const outputDir = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, '../../outputs'));
  const cacheDir = path.join(outputDir, '_cosy_cache');
  if (cacheDir.startsWith(`${outputDir}${path.sep}`)) fs.rmSync(cacheDir, { recursive: true, force: true });
  const badFile = path.join(outputDir, 'avatar', 'bad_preview_voices.json');
  if (!fs.existsSync(badFile)) return;
  try {
    const providerIds = new Set(VOLCENGINE_SPEECH_VOICES.map(v => v.id));
    const rows = JSON.parse(fs.readFileSync(badFile, 'utf8'));
    if (Array.isArray(rows)) fs.writeFileSync(badFile, JSON.stringify(rows.filter(id => !providerIds.has(String(id))), null, 2));
  } catch {}
}

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
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  const presets = Object.entries(PROVIDER_PRESETS).map(([id, p]) => ({
    id,
    name: p.name,
    api_url: p.api_url,
    defaultModels: p.defaultModels,
    adapter: inferProviderAdapter({ id, preset: id, api_url: p.api_url, name: p.name })?.adapter || '',
    adapter_config: inferProviderAdapter({ id, preset: id, api_url: p.api_url, name: p.name })?.adapter_config || null,
  }));
  res.json({ success: true, data: presets });
});

// ——— 读取全部设置 ———
router.get('/', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
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
  const { id, name, api_url, api_key, api_host, api_ws_url, workspace_id, tts_resource_id, clone_resource_id, topview_uid, api_uid, uid, webang_asset_group_id, webang_asset_api_url, adapter, adapter_config, models = [] } = req.body;
  if (!name || !api_url) return res.status(400).json({ success: false, error: '请填写供应商名称和 API 地址' });
  const settings = loadSettings();
  const newId = (id || name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') || Date.now().toString());
  if (settings.providers.find(p => p.id === newId)) {
    return res.status(400).json({ success: false, error: '供应商 ID 已存在，请使用不同名称' });
  }
  const provider = {
    id: newId, name, api_url, api_key: api_key || '', enabled: !!api_key,
    models: models.map(m => ({ ...m, enabled: true })),
    last_tested: null, test_status: null, created_at: new Date().toISOString(),
  };
  if (api_ws_url !== undefined) provider.api_ws_url = String(api_ws_url || '').trim();
  if (api_host !== undefined) provider.api_host = String(api_host || '').trim();
  if (workspace_id !== undefined) provider.workspace_id = String(workspace_id || '').trim();
  if (tts_resource_id !== undefined) provider.tts_resource_id = String(tts_resource_id || '').trim();
  if (clone_resource_id !== undefined) provider.clone_resource_id = String(clone_resource_id || '').trim();
  if (adapter !== undefined) provider.adapter = String(adapter || '').trim();
  if (adapter_config && typeof adapter_config === 'object') provider.adapter_config = adapter_config;
  if (topview_uid !== undefined) provider.topview_uid = String(topview_uid || '').trim();
  if (api_uid !== undefined) provider.api_uid = String(api_uid || '').trim();
  if (uid !== undefined) provider.uid = String(uid || '').trim();
  if (webang_asset_group_id !== undefined) provider.webang_asset_group_id = String(webang_asset_group_id || '').trim();
  if (webang_asset_api_url !== undefined) provider.webang_asset_api_url = String(webang_asset_api_url || '').trim();
  try { validateVolcengineSpeech(provider); } catch (error) { return res.status(400).json({ success: false, error: error.message }); }
  settings.providers.push(provider);
  saveSettings(settings);
  if (provider.id === 'volcengine-tts') resetTtsRuntimeState();
  res.json({ success: true, data: { id: newId } });
});

// 更新供应商基本信息（名称/URL/Key）
router.put('/providers/:id', (req, res) => {
  const { name, api_url, api_key, api_host, api_ws_url, workspace_id, tts_resource_id, clone_resource_id, topview_uid, api_uid, uid, webang_asset_group_id, webang_asset_api_url, adapter, adapter_config } = req.body;
  const settings = loadSettings();
  const p = settings.providers.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ success: false, error: '供应商不存在' });
  if (name !== undefined) p.name = name;
  if (api_url !== undefined) p.api_url = api_url;
  if (api_key !== undefined) { p.api_key = api_key.trim(); p.enabled = !!p.api_key; }
  if (api_ws_url !== undefined) p.api_ws_url = String(api_ws_url || '').trim();
  if (api_host !== undefined) p.api_host = String(api_host || '').trim();
  if (workspace_id !== undefined) p.workspace_id = String(workspace_id || '').trim();
  if (tts_resource_id !== undefined) p.tts_resource_id = String(tts_resource_id || '').trim();
  if (clone_resource_id !== undefined) p.clone_resource_id = String(clone_resource_id || '').trim();
  if (topview_uid !== undefined) p.topview_uid = String(topview_uid || '').trim();
  if (api_uid !== undefined) p.api_uid = String(api_uid || '').trim();
  if (uid !== undefined) p.uid = String(uid || '').trim();
  if (webang_asset_group_id !== undefined) p.webang_asset_group_id = String(webang_asset_group_id || '').trim();
  if (webang_asset_api_url !== undefined) p.webang_asset_api_url = String(webang_asset_api_url || '').trim();
  if (adapter !== undefined) p.adapter = String(adapter || '').trim();
  if (adapter_config !== undefined) p.adapter_config = (adapter_config && typeof adapter_config === 'object') ? adapter_config : {};
  try { validateVolcengineSpeech(p); } catch (error) { return res.status(400).json({ success: false, error: error.message }); }
  p.test_status = null; p.last_tested = null; p.test_error = null;
  saveSettings(settings);
  if (p.id === 'volcengine-tts') resetTtsRuntimeState();
  res.json({ success: true });
});

// 删除供应商
router.delete('/providers/:id', (req, res) => {
  const settings = loadSettings();
  settings.providers = settings.providers.filter(p => p.id !== req.params.id);
  saveSettings(settings);
  res.json({ success: true });
});

// 启用/禁用供应商（一键切换；禁用后所有 service 跳过该 provider 的所有模型）
router.put('/providers/:id/toggle', (req, res) => {
  const settings = loadSettings();
  const p = settings.providers.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ success: false, error: '供应商不存在' });
  // 显式 body.enabled 优先；否则取反当前状态
  if (typeof req.body?.enabled === 'boolean') {
    p.enabled = req.body.enabled;
  } else {
    p.enabled = !p.enabled;
  }
  saveSettings(settings);
  res.json({ success: true, data: { enabled: p.enabled } });
});

// ——— 模型 CRUD ———

// 添加模型到供应商
router.post('/providers/:id/models', (req, res) => {
  const { id: modelId, name, type, use } = req.body;
  if (!modelId || !name) return res.status(400).json({ success: false, error: '请填写模型 ID 和名称' });
  const settings = loadSettings();
  const p = settings.providers.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ success: false, error: '供应商不存在' });
  if (p.id === 'volcengine-tts') return res.status(400).json({ success: false, error: '字节语音专用供应商的能力固定为 TTS 2.0 / 声音复刻 2.0，禁止添加其他模型' });
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
  const before = (p.models || []).length;
  p.models = (p.models || []).filter(m => m.id !== req.params.modelId);
  if (p.models.length === before) {
    return res.status(404).json({ success: false, error: '模型不存在或模型 ID 未正确编码' });
  }
  saveSettings(settings);
  res.json({ success: true, removed: before - p.models.length });
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

// ——— TTS 批量体检 ———
// POST /api/settings/tts-health-check — 真合成一次短语，按结果更新 test_status
router.post('/tts-health-check', async (req, res) => {
  const { testProviderSynthesis } = require('../services/ttsService');
  const fs = require('fs');
  const path = require('path');
  const settings = loadSettings();
  const TTS_IDS = ['volcengine-tts'];
  const outDir = path.join(__dirname, '../../outputs/tts-health');
  fs.mkdirSync(outDir, { recursive: true });
  const results = [];
  for (const pid of TTS_IDS) {
    const p = (settings.providers || []).find(x => x.id === pid);
    if (!p || !p.enabled || !p.api_key) { results.push({ id: pid, skipped: true, reason: '未配置或已停用' }); continue; }
    const hasTTS = (p.models || []).some(m => m.enabled !== false && m.use === 'tts');
    if (!hasTTS) { results.push({ id: pid, skipped: true, reason: '无 TTS 模型' }); continue; }
    const outPath = path.join(outDir, `test_${pid}_${Date.now()}`);
    const started = Date.now();
    try {
      const r = await Promise.race([
        testProviderSynthesis(pid, outPath),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 15s')), 15000)),
      ]);
      const latency = Date.now() - started;
      const ok = !!r && fs.existsSync(r) && fs.statSync(r).size > 200;
      try { if (r && fs.existsSync(r)) fs.unlinkSync(r); } catch {}
      if (ok) {
        p.test_status = 'ok'; p.last_tested = new Date().toISOString(); p.test_error = null;
        results.push({ id: pid, ok: true, latency });
      } else {
        p.test_status = 'error'; p.last_tested = new Date().toISOString(); p.test_error = '输出为空';
        results.push({ id: pid, ok: false, latency, error: '输出为空' });
      }
    } catch (err) {
      p.test_status = 'error'; p.last_tested = new Date().toISOString(); p.test_error = err.message;
      results.push({ id: pid, ok: false, latency: Date.now() - started, error: err.message });
    }
  }
  saveSettings(settings);
  res.json({ success: true, results });
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
  if (p.id === 'volcengine-tts' || p.preset === 'volcengine-tts') {
    validateVolcengineSpeech(p);
    const outDir = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, '../../outputs'), 'tts-health');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `volcengine-tts-${Date.now()}`);
    const audioPath = await require('../services/ttsService').testProviderSynthesis('volcengine-tts', outPath);
    const bytes = fs.statSync(audioPath).size;
    fs.rmSync(audioPath, { force: true });
    return { message: '字节豆包语音 2.0 合成正常', detail: `真实合成 ${bytes} bytes` };
  }
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
    'test-tk.iserviceapi.com':  '/api/v1/models',
    'tk.iserviceapi.com':       '/api/v1/models',
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
  // Topview requires both UID and bearer key. The upload credential endpoint is
  // a low-cost auth check and does not start a generation task.
  if (p.id === 'topview' || p.preset === 'topview') {
    const uid = p.topview_uid || p.api_uid || p.uid || process.env.TOPVIEW_UID;
    if (!uid) throw new Error('Topview UID 未配置');
    const body = await httpGetCustom('https://api.topview.ai/v1/upload/credential?format=png', {
      'Topview-Uid': uid,
      'Authorization': `Bearer ${p.api_key}`,
      'Accept': '*/*',
    });
    return checkResponseBody(body, p);
  }

  const authType = p.id === 'huggingface' ? 'hf' : 'bearer';
  const proto = urlObj.protocol === 'https:' ? 'https' : 'http';
  let testUrl = `${proto}://${urlObj.hostname}${testPath}`;
  if (!testUrls[urlObj.hostname]) {
    // 中文说明：OpenAI 兼容网关可能把 /v1 挂在自定义路径下，测试时必须保留用户填写的 base URL。
    const baseUrl = String(p.api_url || '').replace(/\/+$/, '');
    testUrl = /\/v\d+(?:\/)?$/i.test(baseUrl) ? `${baseUrl}/models` : `${baseUrl}/v1/models`;
  }
  const body = await httpGet(testUrl, authKey, authType);
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
