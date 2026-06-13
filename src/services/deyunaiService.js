/**
 * 漫路（DeyunAI）聚合平台统一客户端
 *
 * 职责：
 *   1. 统一封装漫路 chat / images / videos 三类 API（OpenAI 兼容 + 漫路扩展）
 *   2. 双通道路由（国内 /v1，海外 /c35/v1 + vendor header）
 *   3. 异步任务轮询（图像/视频）
 *   4. 强制埋点（每次调用都写 tokenTracker，准确按"次/秒/张"计价）
 *
 * 文档参考：
 *   - https://aiapi.deyunai.com 模型广场 → 接口文档
 *   - 文本: POST /v1/chat/completions（国内）/ POST /c35/v1/chat/completions（海外）
 *   - 图像: POST /v1/images/generations → 返回 task_id → GET /v1/images/generations/{task_id}
 *   - 视频: POST /v1/videos → 返回 task_id → GET 轮询
 */
const axios = require('axios');
const { loadSettings } = require('./settingsService');

const BASE_HOST = 'https://api.deyunai.com';
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

// 海外通道判定（用于决定走 /v1 还是 /c35/v1）
//   注意：gemini-3.1-flash-lite-preview 是漫路接的"国内代理 Gemini"，走 /v1
const OVERSEAS_MODEL_RE = /^(gpt-|o[1-9]|claude-|grok-|gemini-(?!3\.1-flash-lite-preview))/i;

function isOverseasModel(modelId) {
  return OVERSEAS_MODEL_RE.test(String(modelId || ''));
}

function getDeyunaiKey() {
  const settings = loadSettings();
  const p = (settings.providers || []).find(x => x.id === 'deyunai' || x.preset === 'deyunai');
  if (!p || !p.api_key) throw new Error('未配置 deyunai api_key（请在「AI 配置」添加漫路供应商）');
  return p.api_key;
}

function buildUrl(path, modelId) {
  // path 形如 '/chat/completions' | '/images/generations' | '/videos'
  const prefix = isOverseasModel(modelId) ? '/c35/v1' : '/v1';
  return BASE_HOST + prefix + path;
}

function buildImageUrl(path, modelId) {
  return buildUrl(path, modelId);
}

function buildEnterpriseImageUrl(path) {
  return BASE_HOST + '/ent/v1' + path;
}

function isGptImage2Model(modelId) {
  return String(modelId || '').toLowerCase() === 'gpt-image-2';
}

function normalizeGptImage2Reference(imageUrl) {
  const value = String(imageUrl || '').trim();
  if (!value) return '';
  if (value.startsWith('data:image/')) {
    throw new Error('gpt-image-2 通道不支持 base64/data URL 参考图，请先保存为公网可访问的图片 URL');
  }
  return value;
}

function buildHeaders(modelId, options = {}) {
  const apiKey = getDeyunaiKey();
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (!options.forceDomestic && isOverseasModel(modelId)) headers.vendor = 'API_VENDOR';
  return headers;
}

function extractImageUrlsFromSyncPayload(payload) {
  const arr = Array.isArray(payload?.data) ? payload.data : [];
  return arr.map(x => x?.url || x?.b64_json || '').filter(Boolean);
}

function extractImageUrlsFromAnyPayload(payload) {
  const urls = new Set();
  const visit = (value, depth = 0) => {
    if (!value || depth > 5) return;
    if (typeof value === 'string') {
      if (/^https?:\/\/.+\.(png|jpe?g|webp)(\?|$)/i.test(value) || /^data:image\//i.test(value)) urls.add(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(item => visit(item, depth + 1));
      return;
    }
    if (typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (/^(url|image_url|imageUrl|b64_json)$/i.test(key)) visit(child, depth + 1);
      else if (/image|result|data|output|candidate|asset/i.test(key)) visit(child, depth + 1);
    }
  };
  visit(payload, 0);
  return Array.from(urls);
}

function buildProviderImageError(message, payload) {
  const err = new Error(message);
  const urls = extractImageUrlsFromAnyPayload(payload);
  if (urls.length) err.generatedUrls = urls;
  err.providerPayload = payload;
  return err;
}

function extractProviderBusinessError(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const code = payload.code ?? payload.error?.code;
  const reason = payload.reason || payload.error?.reason || '';
  const message = payload.message || payload.msg || payload.error?.message || '';
  const numericCode = Number(code);
  if ((Number.isFinite(numericCode) && numericCode >= 400) || /error|fail/i.test(String(reason || message))) {
    return [code ? `code=${code}` : '', reason ? `reason=${reason}` : '', message ? `message=${message}` : '']
      .filter(Boolean)
      .join(', ') || JSON.stringify(payload).slice(0, 300);
  }
  return null;
}

function publicHttpImageRefs(referenceImages = []) {
  return (Array.isArray(referenceImages) ? referenceImages : [])
    .map(x => String(x || '').trim())
    .filter(Boolean)
    .filter(url => /^https?:\/\//i.test(url) && !/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(?::|\/|$)/i.test(url));
}

function normalizeGptImage2N(value) {
  const n = Math.round(Number(value) || 1);
  return Math.max(1, Math.min(10, n));
}

function normalizeGptImage2Size(size) {
  const raw = String(size || '').trim().toLowerCase();
  if (!raw || raw === 'auto') return 'auto';
  const m = raw.match(/^(\d{2,5})x(\d{2,5})$/);
  if (!m) return 'auto';
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 'auto';
  const ratio = w / h;
  if (ratio > 3 || ratio < 1 / 3) return 'auto';
  return `${w}x${h}`;
}

function assertGptImage2BodyContract(body) {
  const allowed = new Set([
    'images',
    'prompt',
    'background',
    'n',
    'output_compression',
    'output_format',
    'quality',
    'size',
    'input_fidelity',
    'mask_url',
  ]);
  const unexpected = Object.keys(body || {}).filter(k => !allowed.has(k));
  if (unexpected.length) {
    throw new Error(`gpt-image-2 请求体包含接口文档未声明字段: ${unexpected.join(', ')}`);
  }
  if (body.images !== undefined && (!Array.isArray(body.images) || body.images.some(x =>
    typeof x !== 'string' || !/^https?:\/\//i.test(x)
  ))) {
    throw new Error('gpt-image-2 images 必须按企业接口文档发送公网 http(s) URL 字符串数组');
  }
  if (body.output_compression !== undefined && !/^(webp|jpeg)$/i.test(String(body.output_format || ''))) {
    throw new Error('gpt-image-2 output_compression 只允许在 output_format 为 webp 或 jpeg 时发送');
  }
}

function summarizeGptImage2Request(endpoint, body = {}) {
  const images = Array.isArray(body.images) ? body.images : [];
  const firstImage = images[0];
  return {
    endpoint,
    body_keys: Object.keys(body || {}).sort(),
    size: body.size || '',
    output_format: body.output_format || '',
    n: body.n || 0,
    image_count: images.length,
    images_shape: !images.length
      ? 'none'
      : (typeof firstImage === 'string' ? 'string_url_array' : typeof firstImage),
    has_aspect_ratio_field: Object.prototype.hasOwnProperty.call(body, 'aspect_ratio') || Object.prototype.hasOwnProperty.call(body, 'aspectRatio'),
    has_output_compression: Object.prototype.hasOwnProperty.call(body, 'output_compression'),
  };
}

// ════════════════════════════════════════════════
// 1. 文本 chat completions
// ════════════════════════════════════════════════
/**
 * @param {object} opts
 * @param {string} opts.model
 * @param {Array}  opts.messages  - [{role,content}, ...]
 * @param {number} [opts.maxTokens=4096]
 * @param {string} [opts.userId]
 * @param {string} [opts.agentId]
 * @returns {Promise<{ text:string, raw:object }>}
 */
async function chat({ model, messages, maxTokens = 4096, userId = null, agentId = null }) {
  const _started = Date.now();
  let _ok = false; let _err = null;
  let _inputTokens = 0; let _outputTokens = 0;
  try {
    const res = await axios.post(
      buildUrl('/chat/completions', model),
      { model, messages, max_tokens: maxTokens },
      { headers: buildHeaders(model), timeout: 120000 }
    );
    let data = res.data;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch (_) {}
    }
    const msg = data?.choices?.[0]?.message;
    const text = msg?.content || msg?.reasoning_content || '';
    if (!text) throw new Error('LLM 返回空内容: ' + JSON.stringify(data).slice(0, 300));
    _inputTokens = data?.usage?.prompt_tokens || 0;
    _outputTokens = data?.usage?.completion_tokens || 0;
    _ok = true;
    return { text, raw: data };
  } catch (e) {
    _err = e.response?.data ? JSON.stringify(e.response.data).slice(0, 300) : e.message;
    throw new Error('漫路 chat 调用失败: ' + _err);
  } finally {
    try {
      require('./tokenTracker').record({
        provider: 'deyunai', model,
        category: 'llm',
        inputTokens: _inputTokens, outputTokens: _outputTokens,
        durationMs: Date.now() - _started,
        status: _ok ? 'success' : 'fail', errorMsg: _err,
        userId, agentId,
      });
    } catch {}
  }
}

// ════════════════════════════════════════════════
// 2. 图像生成（异步轮询）
// ════════════════════════════════════════════════
/**
 * @param {object} opts
 * @param {string} opts.model       - gemini-2.5-flash-image / nano-banana / dall-e-3 / imagen-4 / flux-pro / jimeng-t2i-v4 等
 * @param {string} opts.prompt
 * @param {number} [opts.n=1]
 * @param {string} [opts.size='1024x1024']
 * @param {Array}  [opts.referenceImages] - 参考图 URL（多模态模型支持）
 * @param {number} [opts.timeoutMs=180000]
 * @param {string} [opts.userId]
 * @param {string} [opts.agentId]
 * @returns {Promise<{ urls:string[], taskId:string }>}
 */
async function generateImage({ model, prompt, n = 1, size = '1024x1024', aspectRatio = '', referenceImages = [], timeoutMs = 180000, userId = null, agentId = null }) {
  const _started = Date.now();
  let _ok = false; let _err = null; let _taskId = null;
  try {
    if (isGptImage2Model(model)) {
      const rawRefCount = (Array.isArray(referenceImages) ? referenceImages : []).filter(Boolean).length;
      const refs = publicHttpImageRefs(referenceImages).slice(0, 14);
      if (rawRefCount > 0 && refs.length === 0) throw new Error('漫路图片参考必须是公网 http(s) URL，不支持 base64、blob 或本地文件路径');
      const body = {
        prompt,
        background: 'auto',
        n: normalizeGptImage2N(n),
        output_format: 'png',
        quality: 'auto',
        size: normalizeGptImage2Size(size),
      };
      const isEdit = refs.length > 0;
      if (isEdit) {
        body.images = refs
          .map(normalizeGptImage2Reference)
          .filter(Boolean);
        body.input_fidelity = 'high';
      }
      assertGptImage2BodyContract(body);
      const endpoint = isEdit ? '/images/edits' : '/images/generations';
      const requestSummary = summarizeGptImage2Request(endpoint, body);
      const submitRes = await axios.post(
        buildEnterpriseImageUrl(endpoint),
        body,
        { headers: buildHeaders(model, { forceDomestic: true }), timeout: timeoutMs, validateStatus: () => true }
      );
      if (submitRes.status >= 400) {
        const err = buildProviderImageError(`漫路 GPT Image 2 ${isEdit ? 'edits' : 'generations'} HTTP ${submitRes.status}: ${JSON.stringify(submitRes.data).slice(0, 300)}`, submitRes.data);
        err.providerRequest = requestSummary;
        throw err;
      }
      const businessError = extractProviderBusinessError(submitRes.data);
      if (businessError) {
        const err = buildProviderImageError(`漫路 GPT Image 2 ${isEdit ? 'edits' : 'generations'} provider error: ${businessError}`, submitRes.data);
        err.providerRequest = requestSummary;
        throw err;
      }
      _taskId = submitRes.data?.task_id || submitRes.data?.data?.task_id || null;
      const urls = extractImageUrlsFromSyncPayload(submitRes.data);
      if (!urls.length) {
        const err = new Error('漫路 GPT Image 2 未返回图片数据: ' + JSON.stringify(submitRes.data).slice(0, 300));
        err.providerRequest = requestSummary;
        throw err;
      }
      _ok = true;
      return { urls, taskId: _taskId, raw: submitRes.data };
    }

    const body = { model, prompt, n, size };
    if (aspectRatio) {
      // 中文说明：不同漫路模型/代理对画幅字段兼容性不同，保留 size 同时补比例字段。
      body.aspect_ratio = aspectRatio;
      body.aspectRatio = aspectRatio;
    }
    const rawRefCount = (Array.isArray(referenceImages) ? referenceImages : []).filter(Boolean).length;
    const refs = publicHttpImageRefs(referenceImages).slice(0, 4);
    if (rawRefCount > 0 && refs.length === 0) throw new Error('漫路图片参考必须是公网 http(s) URL，不支持 base64、blob 或本地文件路径');
    if (refs.length) {
      body.image_url = refs[0];
      if (refs.length > 1) body.image_urls = refs;
    }
    const submitRes = await axios.post(
      buildImageUrl('/images/generations', model),
      body,
      { headers: buildHeaders(model), timeout: 30000, validateStatus: () => true }
    );
    if (submitRes.status >= 400) {
      throw buildProviderImageError(`漫路 images 提交 HTTP ${submitRes.status}: ${JSON.stringify(submitRes.data).slice(0, 300)}`, submitRes.data);
    }
    _taskId = submitRes.data?.data?.task_id || submitRes.data?.task_id;
    // 同步返回 (OpenAI 风格)
    if (!_taskId && submitRes.data?.data) {
      const arr = submitRes.data.data;
      if (Array.isArray(arr) && arr[0]?.url) {
        _ok = true;
        return { urls: arr.map(x => x.url || x.b64_json).filter(Boolean), taskId: null };
      }
    }
    if (!_taskId) {
      throw new Error('漫路 images 提交失败: ' + JSON.stringify(submitRes.data).slice(0, 300));
    }

    // 轮询
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      const queryRes = await axios.get(
        buildImageUrl(`/images/generations/${_taskId}`, model),
        { headers: buildHeaders(model), timeout: 15000 }
      );
      const d = queryRes.data?.data || {};
      if (d.task_status === 'succeed') {
        const urls = (d.task_result?.images || []).map(im => im.url).filter(Boolean);
        if (!urls.length) throw new Error('图像生成成功但 url 列表为空');
        _ok = true;
        return { urls, taskId: _taskId };
      }
      if (d.task_status === 'failed' || d.task_status === 'fail') {
        throw buildProviderImageError(`漫路图像生成失败: ${d.error_msg || d.message || JSON.stringify(d)}`, d);
      }
      // submitted / processing → 继续轮询
    }
    throw new Error(`漫路图像生成超时（${timeoutMs}ms）`);
  } catch (e) {
    _err = e.message; throw e;
  } finally {
    try {
      require('./tokenTracker').record({
        provider: 'deyunai', model,
        category: 'image', imageCount: _ok ? n : 0,
        durationMs: Date.now() - _started,
        status: _ok ? 'success' : 'fail', errorMsg: _err,
        userId, agentId, requestId: _taskId,
      });
    } catch {}
  }
}

// ════════════════════════════════════════════════
// 3. 视频生成（异步轮询）
// ════════════════════════════════════════════════
/**
 * @param {object} opts
 * @param {string} opts.model       - sora-2 / kling-v2-master / veo-3 等
 * @param {string} opts.prompt
 * @param {number} [opts.duration=5]   - 秒，整数
 * @param {string} [opts.size='720x1280']  - 注意 sora-2 仅接受 1280x720 / 720x1280
 * @param {string} [opts.imageUrl]     - 图生视频时的参考图
 * @param {number} [opts.timeoutMs=600000]
 * @param {string} [opts.userId]
 * @param {string} [opts.agentId]
 * @returns {Promise<{ url:string, taskId:string, durationSec:number }>}
 */
async function generateVideo({ model, prompt, duration = 5, size = '720x1280', imageUrl, timeoutMs = 600000, userId = null, agentId = null }) {
  const _started = Date.now();
  let _ok = false; let _err = null; let _taskId = null;
  let _videoSeconds = duration || 5;
  try {
    const body = { model, prompt, duration: parseInt(duration, 10), size };
    if (imageUrl) body.image_url = imageUrl;

    const submitRes = await axios.post(
      buildUrl('/videos', model),
      body,
      { headers: buildHeaders(model), timeout: 30000 }
    );
    _taskId = submitRes.data?.data?.task_id || submitRes.data?.task_id;
    if (!_taskId) {
      throw new Error('漫路 video 提交失败: ' + JSON.stringify(submitRes.data).slice(0, 300));
    }

    // 轮询（视频可能 5-10 分钟）
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await new Promise(r => setTimeout(r, 5000));
      const queryRes = await axios.get(
        buildUrl(`/videos/${_taskId}`, model),
        { headers: buildHeaders(model), timeout: 15000 }
      );
      const d = queryRes.data?.data || {};
      if (d.task_status === 'succeed') {
        const url = d.task_result?.videos?.[0]?.url || d.task_result?.video_url;
        if (!url) throw new Error('视频生成成功但 url 为空');
        _videoSeconds = Number(d.task_result?.duration) || _videoSeconds;
        _ok = true;
        return { url, taskId: _taskId, durationSec: _videoSeconds };
      }
      if (d.task_status === 'failed' || d.task_status === 'fail') {
        throw new Error(`漫路视频生成失败: ${d.error_msg || d.message || JSON.stringify(d)}`);
      }
    }
    throw new Error(`漫路视频生成超时（${timeoutMs}ms）`);
  } catch (e) {
    const detail = e.response?.data
      ? `HTTP ${e.response.status}: ${JSON.stringify(e.response.data).slice(0, 500)}`
      : e.message;
    _err = detail;
    if (e.response?.data) throw new Error('漫路 video 调用失败: ' + detail);
    throw e;
  } finally {
    try {
      require('./tokenTracker').record({
        provider: 'deyunai', model,
        category: 'video', videoSeconds: _ok ? _videoSeconds : 0,
        durationMs: Date.now() - _started,
        status: _ok ? 'success' : 'fail', errorMsg: _err,
        userId, agentId, requestId: _taskId,
      });
    } catch {}
  }
}

module.exports = {
  isOverseasModel,
  getDeyunaiKey,
  chat,
  generateImage,
  generateVideo,
};
