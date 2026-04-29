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

function buildHeaders(modelId) {
  const apiKey = getDeyunaiKey();
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (isOverseasModel(modelId)) headers.vendor = 'API_VENDOR';
  return headers;
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
async function generateImage({ model, prompt, n = 1, size = '1024x1024', referenceImages = [], timeoutMs = 180000, userId = null, agentId = null }) {
  const _started = Date.now();
  let _ok = false; let _err = null; let _taskId = null;
  try {
    const body = { model, prompt, n, size };
    if (Array.isArray(referenceImages) && referenceImages.length) {
      body.image_url = referenceImages[0];
      if (referenceImages.length > 1) body.image_urls = referenceImages;
    }
    const submitRes = await axios.post(
      buildUrl('/images/generations', model),
      body,
      { headers: buildHeaders(model), timeout: 30000, validateStatus: () => true }
    );
    if (submitRes.status >= 400) {
      throw new Error(`漫路 images 提交 HTTP ${submitRes.status}: ${JSON.stringify(submitRes.data).slice(0, 300)}`);
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
        buildUrl(`/images/generations/${_taskId}`, model),
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
        throw new Error(`漫路图像生成失败: ${d.error_msg || d.message || JSON.stringify(d)}`);
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
    _err = e.message; throw e;
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
