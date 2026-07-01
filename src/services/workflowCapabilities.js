/**
 * VIDO Workflow Capabilities — 节点能力实现
 *
 * 注册到 workflowEngine。每个能力是一个 async function：
 *   run(params, ctx) → { ...outputs }
 *
 * 已实现节点：
 *   - image_gen          文生图 (deyunai nano-banana / volces seedream)
 *   - image_fuse         多图融合 (deyunai nano-banana / flux-kontext-multi)
 *   - cutout             单张抠图 (Replicate RMBG-2)
 *   - batch_cutout       批量抠图（数组循环）
 *   - inpaint            产品替换/局部重画 (Replicate flux-fill-pro)
 *   - id_swap            DreamID-V / InstantID 换脸保 ID
 *   - text_gen           LLM 文本生成 (复用 settings 里的 LLM provider)
 *   - asr_transcribe     Whisper 语音转字幕（带时间戳）
 *   - download_url       URL → 本地文件
 *   - http_get           通用 HTTP GET
 *   - var_set            设置变量（用于把字面量塞 ctx）
 *   - delay              延迟（调试用）
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { registerCapability } = require('./workflowEngine');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './outputs');
const WORKFLOW_ASSETS = path.join(OUTPUT_DIR, 'workflow-assets');
const MODEL_PROVIDER_TIMEOUT_MS = 10 * 60 * 1000;
if (!fs.existsSync(WORKFLOW_ASSETS)) fs.mkdirSync(WORKFLOW_ASSETS, { recursive: true });

function getKey(providerId, envFallback) {
  try {
    const { getApiKey } = require('./settingsService');
    const k = getApiKey(providerId);
    if (k) return k;
  } catch {}
  if (envFallback) {
    for (const e of envFallback) {
      if (process.env[e]) return process.env[e];
    }
  }
  return null;
}

function getProvider(providerId) {
  try {
    const { loadSettings } = require('./settingsService');
    const s = loadSettings();
    return (s.providers || []).find(p => (p.id === providerId || p.preset === providerId) && p.enabled);
  } catch { return null; }
}

function _publicUrl(localFilename) {
  // 把本地存到 workflow-assets 的文件转成对外可访问 URL
  // 走 server.js 已经挂的 /public/workflow-assets static
  const base = process.env.PUBLIC_BASE_URL || ('https://vido.smsend.cn');
  return `${base.replace(/\/$/, '')}/public/workflow-assets/${path.basename(localFilename)}`;
}

async function _downloadToFile(url, destPath) {
  const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000, maxContentLength: 100 * 1024 * 1024 });
  fs.writeFileSync(destPath, Buffer.from(r.data));
  return destPath;
}

const _sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ════════════════════════════════════════════════════════
// 1. image_gen — 文生图（deyunai nano-banana 优先，seedream fallback）
// ════════════════════════════════════════════════════════
registerCapability('image_gen', {
  label: '文生图',
  description: '根据 prompt 生成一张图。优先 deyunai nano-banana。',
  inputs: [
    { name: 'prompt', type: 'string', required: true, desc: '生成提示词，≤2000 字符' },
    { name: 'aspectRatio', type: 'string', default: '9:16', desc: '9:16 / 16:9 / 1:1 / 3:4 / 4:3' },
    { name: 'model', type: 'string', default: 'nano-banana', desc: '模型 id，默认 nano-banana' },
  ],
  outputs: [
    { name: 'imageUrl', type: 'string', desc: '生成图的对外可访问 URL' },
    { name: 'localPath', type: 'string', desc: '本地保存路径' },
  ],
  async run(params) {
    const prompt = String(params.prompt || '').slice(0, 2000);
    const aspectRatio = params.aspectRatio || '9:16';
    const filename = `wf_img_${Date.now()}_${uuidv4().slice(0, 6)}.png`;
    const destPath = path.join(WORKFLOW_ASSETS, filename);

    const dy = getProvider('deyunai');
    if (!dy?.api_key) throw new Error('未配置 deyunai provider（需 nano-banana 模型）');
    const baseUrl = (dy.api_url || 'https://api.deyunai.com/v1').replace(/\/$/, '');
    const headers = { Authorization: 'Bearer ' + dy.api_key, 'Content-Type': 'application/json' };
    const sizeMap = { '9:16': '720x1280', '16:9': '1280x720', '1:1': '1024x1024', '3:4': '768x1024', '4:3': '1024x768' };
    const size = sizeMap[aspectRatio] || '1024x1024';
    const body = { model: params.model || 'nano-banana', prompt, n: 1, size };

    const r = await axios.post(`${baseUrl}/images/generations`, body, { headers, timeout: MODEL_PROVIDER_TIMEOUT_MS });
    let url = _extractImageUrl(r.data);
    const taskId = _extractTaskId(r.data);
    if (!url && taskId) url = await _pollDeyunai(baseUrl, headers, taskId);
    if (!url) throw new Error('image_gen 未拿到结果 URL');

    if (url.startsWith('http')) await _downloadToFile(url, destPath);
    else if (url.startsWith('data:image/')) {
      const b64 = url.replace(/^data:image\/\w+;base64,/, '');
      fs.writeFileSync(destPath, Buffer.from(b64, 'base64'));
    } else {
      fs.writeFileSync(destPath, Buffer.from(url, 'base64'));
    }
    return { imageUrl: _publicUrl(filename), localPath: destPath };
  },
});

function _extractImageUrl(data) {
  if (!data) return null;
  if (data.data?.url) return data.data.url;
  if (Array.isArray(data.data) && data.data[0]?.url) return data.data[0].url;
  if (data.image_url) return data.image_url;
  if (data.url) return data.url;
  if (data.data?.image_url) return data.data.image_url;
  return null;
}

function _extractTaskId(data) {
  return data?.data?.task_id || data?.task_id || data?.id || null;
}

async function _pollDeyunai(baseUrl, headers, taskId) {
  const urls = [
    `${baseUrl}/images/generations/${encodeURIComponent(taskId)}`,
    `${baseUrl}/images/${encodeURIComponent(taskId)}`,
    `${baseUrl}/tasks/${encodeURIComponent(taskId)}`,
    `${baseUrl}/task/${encodeURIComponent(taskId)}`,
  ];
  const started = Date.now();
  let i = 0;
  while (Date.now() - started < MODEL_PROVIDER_TIMEOUT_MS) {
    await _sleep(i < 2 ? 1800 : 3000);
    i += 1;
    for (const u of urls) {
      try {
        const r = await axios.get(u, { headers, timeout: 25000 });
        const url = _extractImageUrl(r.data);
        if (url) return url;
        const status = String(r.data?.task_status || r.data?.status || '');
        if (status.startsWith('deyunai nano-banana 任务失败')) throw new Error(status);
      } catch (e) {
        if (e.message?.startsWith('deyunai')) throw e;
        // 404 等忽略，继续试下一个
      }
    }
  }
  throw new Error('deyunai 异步任务超时');
}

// ════════════════════════════════════════════════════════
// 2. image_fuse — 多图融合（人物+商品+场景；nano-banana 多 ref / flux-kontext-multi）
// ════════════════════════════════════════════════════════
registerCapability('image_fuse', {
  label: '多图融合',
  description: '把多张参考图融合到一张新图（如：人物+商品+场景）',
  inputs: [
    { name: 'prompt', type: 'string', required: true },
    { name: 'image1Url', type: 'string', required: true, desc: '主参考图（如人物）' },
    { name: 'image2Url', type: 'string', desc: '次参考图（如商品）' },
    { name: 'image3Url', type: 'string', desc: '可选第 3 张' },
    { name: 'image4Url', type: 'string', desc: '可选第 4 张' },
    { name: 'aspectRatio', type: 'string', default: '9:16' },
    { name: 'engine', type: 'string', default: 'auto', desc: 'auto | flux-kontext | nano-banana' },
  ],
  outputs: [
    { name: 'imageUrl', type: 'string' },
    { name: 'localPath', type: 'string' },
    { name: 'engineUsed', type: 'string' },
  ],
  async run(params) {
    const filename = `wf_fuse_${Date.now()}_${uuidv4().slice(0, 6)}.png`;
    const destPath = path.join(WORKFLOW_ASSETS, filename);
    const aspectRatio = params.aspectRatio || '9:16';
    const refs = [params.image1Url, params.image2Url, params.image3Url, params.image4Url].filter(Boolean);
    if (!refs.length) throw new Error('image_fuse: 至少需要一张 image1Url');

    const engine = params.engine || 'auto';
    const tryFlux = (engine === 'flux-kontext') || (engine === 'auto' && getKey('replicate', ['REPLICATE_API_TOKEN', 'REPLICATE_API_KEY']) && refs.length >= 2);
    let lastErr = null;

    if (tryFlux && refs.length >= 2) {
      try {
        const url = await _runFluxKontextMulti(params.prompt, refs[0], refs[1], aspectRatio);
        await _downloadToFile(url, destPath);
        return { imageUrl: _publicUrl(filename), localPath: destPath, engineUsed: 'flux-kontext-multi-pro' };
      } catch (e) {
        lastErr = e;
        console.warn('[wf:image_fuse] flux-kontext 失败 fallback nano-banana:', e.message);
      }
    }

    // nano-banana 多 ref
    try {
      const url = await _runNanoBananaMultiRef(params.prompt, refs, aspectRatio);
      if (url.startsWith('http')) await _downloadToFile(url, destPath);
      else if (url.startsWith('data:image/')) {
        fs.writeFileSync(destPath, Buffer.from(url.replace(/^data:image\/\w+;base64,/, ''), 'base64'));
      }
      return { imageUrl: _publicUrl(filename), localPath: destPath, engineUsed: 'nano-banana' };
    } catch (e) {
      throw new Error('image_fuse 全部失败: ' + (lastErr?.message || '') + ' | ' + e.message);
    }
  },
});

async function _runFluxKontextMulti(prompt, image1Url, image2Url, aspectRatio) {
  const key = getKey('replicate', ['REPLICATE_API_TOKEN', 'REPLICATE_API_KEY']);
  if (!key) throw new Error('未配置 Replicate API key');
  // 真实 owner/model：flux-kontext-apps/multi-image-kontext-pro（两段，不是三段）
  const modelPath = 'flux-kontext-apps/multi-image-kontext-pro';
  const submitUrl = `https://api.replicate.com/v1/models/${modelPath}/predictions`;
  const headers = { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'wait=60' };
  // aspect_ratio 支持 1:1 / 16:9 / 9:16 / 21:9 / 9:21 / 4:3 / 3:4 / match_input
  const body = {
    input: {
      input_image_1: image1Url,
      input_image_2: image2Url,
      prompt: String(prompt || '').slice(0, 2400),
      aspect_ratio: aspectRatio || 'match_input',
      safety_tolerance: 2,
    },
  };
  const r = await axios.post(submitUrl, body, { headers, timeout: MODEL_PROVIDER_TIMEOUT_MS });
  let result = r.data;
  const started = Date.now();
  while (Date.now() - started < MODEL_PROVIDER_TIMEOUT_MS && result?.status && !['succeeded', 'failed', 'canceled'].includes(result.status)) {
    await _sleep(2500);
    const pollR = await axios.get(`https://api.replicate.com/v1/predictions/${result.id}`, { headers: { Authorization: 'Bearer ' + key }, timeout: 25000 });
    result = pollR.data;
  }
  if (result.status !== 'succeeded') throw new Error('flux-kontext 失败: ' + (result.error || result.status));
  const out = Array.isArray(result.output) ? result.output[0] : result.output;
  if (!out) throw new Error('flux-kontext 无 output');
  return out;
}

async function _runNanoBananaMultiRef(prompt, refs, aspectRatio) {
  const dy = getProvider('deyunai');
  if (!dy?.api_key) throw new Error('未配置 deyunai provider');
  const baseUrl = (dy.api_url || 'https://api.deyunai.com/v1').replace(/\/$/, '');
  const headers = { Authorization: 'Bearer ' + dy.api_key, 'Content-Type': 'application/json' };
  const sizeMap = { '9:16': '720x1280', '16:9': '1280x720', '1:1': '1024x1024', '3:4': '768x1024', '4:3': '1024x768' };
  const body = {
    model: 'nano-banana',
    prompt: String(prompt || '').slice(0, 2000),
    n: 1,
    size: sizeMap[aspectRatio] || '1024x1024',
    image_url: refs[0],
  };
  if (refs.length > 1) body.image_urls = refs.slice(0, 4);
  const r = await axios.post(`${baseUrl}/images/generations`, body, { headers, timeout: MODEL_PROVIDER_TIMEOUT_MS });
  let url = _extractImageUrl(r.data);
  const taskId = _extractTaskId(r.data);
  if (!url && taskId) url = await _pollDeyunai(baseUrl, headers, taskId);
  if (!url) throw new Error('nano-banana 多 ref 无 URL');
  return url;
}

// ════════════════════════════════════════════════════════
// 3. cutout — 单张抠图 (Replicate 851-labs/background-remover RMBG-2)
// ════════════════════════════════════════════════════════
registerCapability('cutout', {
  label: '抠图（去背景）',
  description: '把图片背景抠掉，返回透明 PNG',
  inputs: [
    { name: 'imageUrl', type: 'string', required: true, desc: '要抠的图 URL' },
    { name: 'resolution', type: 'string', default: '1024x1024', desc: '输出分辨率，格式 WxH，例如 1024x1024 / 2048x2048' },
  ],
  outputs: [
    { name: 'imageUrl', type: 'string' },
    { name: 'localPath', type: 'string' },
  ],
  async run(params) {
    const filename = `wf_cut_${Date.now()}_${uuidv4().slice(0, 6)}.png`;
    const destPath = path.join(WORKFLOW_ASSETS, filename);
    const key = getKey('replicate', ['REPLICATE_API_TOKEN', 'REPLICATE_API_KEY']);
    if (!key) throw new Error('cutout 需要 Replicate API key（settings 加 replicate provider）');

    const modelPath = 'men1scus/birefnet'; // BiRefNet — 抠图业界顶尖之一，支持商品/人物
    const submitUrl = `https://api.replicate.com/v1/models/${modelPath}/predictions`;
    const headers = { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'wait=60' };
    // BiRefNet 真实 input：image + resolution（"WxH" 字符串），不存在 model_input_size 字段
    const body = { input: { image: params.imageUrl, resolution: params.resolution || '1024x1024' } };
    const r = await axios.post(submitUrl, body, { headers, timeout: MODEL_PROVIDER_TIMEOUT_MS });
    let result = r.data;
    const started = Date.now();
    while (Date.now() - started < MODEL_PROVIDER_TIMEOUT_MS && result?.status && !['succeeded', 'failed', 'canceled'].includes(result.status)) {
      await _sleep(2500);
      const pollR = await axios.get(`https://api.replicate.com/v1/predictions/${result.id}`, { headers: { Authorization: 'Bearer ' + key }, timeout: 25000 });
      result = pollR.data;
    }
    if (result.status !== 'succeeded') throw new Error('cutout 失败: ' + (result.error || result.status));
    const out = Array.isArray(result.output) ? result.output[0] : result.output;
    if (!out) throw new Error('cutout 无 output');
    await _downloadToFile(out, destPath);
    return { imageUrl: _publicUrl(filename), localPath: destPath };
  },
});

// ════════════════════════════════════════════════════════
// 4. batch_cutout — 批量抠图（内置数组循环）
// ════════════════════════════════════════════════════════
registerCapability('batch_cutout', {
  label: '批量抠图',
  description: '对一组图片 URL 批量去背景',
  inputs: [
    { name: 'imageUrls', type: 'array', required: true, desc: '图片 URL 数组' },
  ],
  outputs: [
    { name: 'cutImageUrls', type: 'array', desc: '抠图结果 URL 数组（按原顺序）' },
    { name: 'count', type: 'number' },
  ],
  async run(params) {
    const urls = Array.isArray(params.imageUrls) ? params.imageUrls : [];
    if (!urls.length) return { cutImageUrls: [], count: 0 };
    const cutCap = require('./workflowEngine').getCapability('cutout');
    if (!cutCap) throw new Error('cutout 节点未注册');
    const results = [];
    for (const u of urls) {
      try {
        const r = await cutCap.run({ imageUrl: u });
        results.push(r.imageUrl);
      } catch (e) {
        console.warn('[wf:batch_cutout] 单张失败:', e.message);
        results.push(null);
      }
    }
    return { cutImageUrls: results, count: results.filter(Boolean).length };
  },
});

// ════════════════════════════════════════════════════════
// 5. inpaint — 产品替换（Replicate flux-fill-pro）
// ════════════════════════════════════════════════════════
registerCapability('inpaint', {
  label: '产品替换 / 局部重画',
  description: 'flux-fill 在 mask 区域内重画，可附 ref 图（产品替换核心）',
  inputs: [
    { name: 'imageUrl', type: 'string', required: true, desc: '原图 URL' },
    { name: 'maskUrl', type: 'string', required: true, desc: 'mask 黑白图（白=要重画）' },
    { name: 'prompt', type: 'string', required: true, desc: '描述这块要画成什么' },
    { name: 'refImageUrl', type: 'string', desc: '可选 ref 图（如要替换的产品图）' },
    { name: 'aspectRatio', type: 'string', default: 'match_input_image' },
  ],
  outputs: [
    { name: 'imageUrl', type: 'string' },
    { name: 'localPath', type: 'string' },
  ],
  async run(params) {
    const key = getKey('replicate', ['REPLICATE_API_TOKEN', 'REPLICATE_API_KEY']);
    if (!key) throw new Error('inpaint 需要 Replicate API key');
    const filename = `wf_inpaint_${Date.now()}_${uuidv4().slice(0, 6)}.png`;
    const destPath = path.join(WORKFLOW_ASSETS, filename);

    // 如果有 ref，走 multi-image-kontext-pro（双图融合替换，无需 mask）；否则走 flux-fill-pro（标准 inpaint）
    const hasRef = !!params.refImageUrl;
    const modelPath = hasRef
      ? 'flux-kontext-apps/multi-image-kontext-pro'  // 两段，不是三段
      : 'black-forest-labs/flux-fill-pro';
    const submitUrl = `https://api.replicate.com/v1/models/${modelPath}/predictions`;
    const headers = { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'wait=60' };

    const input = hasRef
      ? {
          input_image_1: params.imageUrl,
          input_image_2: params.refImageUrl,
          prompt: String(params.prompt || '').slice(0, 2400),
          aspect_ratio: params.aspectRatio || 'match_input',
          safety_tolerance: 2,
        }
      : {
          // flux-fill-pro 真实 input：image / mask / prompt / steps / guidance / safety_tolerance / prompt_upsampling
          image: params.imageUrl,
          mask: params.maskUrl,
          prompt: String(params.prompt || ''),
          safety_tolerance: 2,
        };

    const r = await axios.post(submitUrl, { input }, { headers, timeout: MODEL_PROVIDER_TIMEOUT_MS });
    let result = r.data;
    const started = Date.now();
    while (Date.now() - started < MODEL_PROVIDER_TIMEOUT_MS && result?.status && !['succeeded', 'failed', 'canceled'].includes(result.status)) {
      await _sleep(2500);
      const pollR = await axios.get(`https://api.replicate.com/v1/predictions/${result.id}`, { headers: { Authorization: 'Bearer ' + key }, timeout: 25000 });
      result = pollR.data;
    }
    if (result.status !== 'succeeded') throw new Error('inpaint 失败: ' + (result.error || result.status));
    const out = Array.isArray(result.output) ? result.output[0] : result.output;
    await _downloadToFile(out, destPath);
    return { imageUrl: _publicUrl(filename), localPath: destPath };
  },
});

// ════════════════════════════════════════════════════════
// 6. id_swap — 锁脸换脸 / ID 一致性
//   主路径：Replicate zsxkib/instant-id（InstantID 单图 ID 锁定 + pose 引导）
//   可选：DashScope（需在 settings 里手动指定真实 model id；阿里 DreamID-V 暂未对外，无内置默认）
// ════════════════════════════════════════════════════════
registerCapability('id_swap', {
  label: 'ID 锁定换脸 (InstantID)',
  description: '把目标图里的脸换成参考人脸图的 ID。默认 Replicate InstantID。',
  inputs: [
    { name: 'referenceFaceUrl', type: 'string', required: true, desc: '参考人脸图 URL（要锁的脸；正面/清晰/单人）' },
    { name: 'targetUrl', type: 'string', desc: '目标姿势图 URL（可选；不提供则只按 prompt 生成）' },
    { name: 'prompt', type: 'string', default: 'photorealistic, natural lighting, preserve facial identity', desc: '风格/场景描述' },
    { name: 'negativePrompt', type: 'string', default: 'low quality, distorted, plastic skin', desc: '负向提示' },
    { name: 'engine', type: 'string', default: 'instantid', desc: 'instantid (默认) | dashscope (需手动配 model id)' },
    { name: 'dashscopeModel', type: 'string', desc: 'engine=dashscope 时必填，例如 facechain-generation' },
  ],
  outputs: [
    { name: 'imageUrl', type: 'string' },
    { name: 'localPath', type: 'string' },
    { name: 'engineUsed', type: 'string' },
  ],
  async run(params) {
    const filename = `wf_idswap_${Date.now()}_${uuidv4().slice(0, 6)}.png`;
    const destPath = path.join(WORKFLOW_ASSETS, filename);
    const engine = params.engine || 'instantid';

    if (engine === 'dashscope') {
      if (!params.dashscopeModel) throw new Error('engine=dashscope 时必须传 dashscopeModel（如 facechain-generation）');
      const url = await _runDashScopeFace(params.dashscopeModel, params.referenceFaceUrl, params.targetUrl, params.prompt);
      await _downloadToFile(url, destPath);
      return { imageUrl: _publicUrl(filename), localPath: destPath, engineUsed: 'dashscope:' + params.dashscopeModel };
    }

    // 默认 InstantID
    const url = await _runInstantID(params.referenceFaceUrl, params.targetUrl, params.prompt, params.negativePrompt);
    await _downloadToFile(url, destPath);
    return { imageUrl: _publicUrl(filename), localPath: destPath, engineUsed: 'instantid' };
  },
});

async function _runInstantID(refFaceUrl, targetUrl, prompt, negativePrompt) {
  const key = getKey('replicate', ['REPLICATE_API_TOKEN', 'REPLICATE_API_KEY']);
  if (!key) throw new Error('未配置 Replicate API key（InstantID 必需）');
  const modelPath = 'zsxkib/instant-id';
  const submitUrl = `https://api.replicate.com/v1/models/${modelPath}/predictions`;
  const headers = { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'wait=60' };
  // zsxkib/instant-id 真实输入：image (ID 参考脸图), prompt, 可选 pose_image (姿势引导)
  const input = {
    image: refFaceUrl,
    prompt: prompt || 'photorealistic, natural lighting, preserve facial identity',
    negative_prompt: negativePrompt || 'low quality, distorted, plastic skin',
    num_inference_steps: 30,
    guidance_scale: 5,
    ip_adapter_scale: 0.8,
    controlnet_conditioning_scale: 0.8,
  };
  if (targetUrl) input.pose_image = targetUrl;

  const r = await axios.post(submitUrl, { input }, { headers, timeout: MODEL_PROVIDER_TIMEOUT_MS });
  let result = r.data;
  const started = Date.now();
  while (Date.now() - started < MODEL_PROVIDER_TIMEOUT_MS && result?.status && !['succeeded', 'failed', 'canceled'].includes(result.status)) {
    await _sleep(2500);
    const pollR = await axios.get(`https://api.replicate.com/v1/predictions/${result.id}`, { headers: { Authorization: 'Bearer ' + key }, timeout: 25000 });
    result = pollR.data;
  }
  if (result.status !== 'succeeded') throw new Error('InstantID 失败: ' + (result.error || result.status));
  const out = Array.isArray(result.output) ? result.output[0] : result.output;
  if (!out) throw new Error('InstantID 无 output');
  return out;
}

// 通用 DashScope 多模态调用（用户在 dashscopeModel 里写真实 model id 时才会跑）
async function _runDashScopeFace(model, refFaceUrl, targetUrl, prompt) {
  const key = getKey('aliyun', ['DASHSCOPE_API_KEY', 'ALIYUN_API_KEY']);
  if (!key) throw new Error('未配置阿里 DashScope key（settings 里加 aliyun provider）');
  const body = {
    model,
    input: {
      reference_image: refFaceUrl,
      target_image: targetUrl,
      prompt: prompt || 'preserve identity, natural skin, photorealistic',
    },
    parameters: { n: 1 },
  };
  const r = await axios.post(
    'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    body,
    { headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, timeout: MODEL_PROVIDER_TIMEOUT_MS },
  );
  const url = r.data?.output?.results?.[0]?.url || r.data?.output?.url;
  if (!url) throw new Error('DashScope 无返回 URL: ' + JSON.stringify(r.data).slice(0, 200));
  return url;
}

// ════════════════════════════════════════════════════════
// 7. text_gen — LLM 文本生成
// ════════════════════════════════════════════════════════
registerCapability('text_gen', {
  label: 'LLM 文本生成',
  description: '调 LLM 生成文本（用 settings 里 use=story 的 model）',
  inputs: [
    { name: 'prompt', type: 'string', required: true },
    { name: 'system', type: 'string', desc: '可选系统提示' },
    { name: 'maxTokens', type: 'number', default: 1500 },
    { name: 'temperature', type: 'number', default: 0.7 },
  ],
  outputs: [
    { name: 'text', type: 'string' },
  ],
  async run(params) {
    const { loadSettings } = require('./settingsService');
    const s = loadSettings();
    let provider = null, model = null;
    for (const p of (s.providers || [])) {
      if (!p.enabled || !p.api_key) continue;
      const m = (p.models || []).find(m => m.use === 'story' && m.enabled !== false);
      if (m) { provider = p; model = m; break; }
    }
    if (!provider) throw new Error('未配置 use=story 的 LLM 模型');
    const baseUrl = (provider.api_url || 'https://api.openai.com/v1').replace(/\/$/, '');
    const messages = [];
    if (params.system) messages.push({ role: 'system', content: params.system });
    messages.push({ role: 'user', content: params.prompt });
    const t0 = Date.now();
    const r = await axios.post(`${baseUrl}/chat/completions`, {
      model: model.id,
      messages,
      max_tokens: Number(params.maxTokens) || 1500,
      temperature: Number(params.temperature) || 0.7,
    }, { headers: { Authorization: 'Bearer ' + provider.api_key, 'Content-Type': 'application/json' }, timeout: 60000 });
    const text = r.data?.choices?.[0]?.message?.content || '';
    const usage = r.data?.usage || {};
    const promptTokens = usage.prompt_tokens || 0;
    const completionTokens = usage.completion_tokens || 0;
    const { trackUsage } = require('./usageTracker');
    const { costUsd } = trackUsage({
      type: 'llm', provider: provider.id, model: model.id,
      promptTokens, completionTokens, durationMs: Date.now() - t0, source: 'workflow',
    });
    return { text, _usage: { model: model.id, promptTokens, completionTokens, costUsd } };
  },
});

// ════════════════════════════════════════════════════════
// 8. asr_transcribe — Whisper 转字幕
// ════════════════════════════════════════════════════════
registerCapability('asr_transcribe', {
  label: 'Whisper 语音转字幕',
  description: '抽视频/音频 audio → Whisper → 带时间戳的 segments',
  inputs: [
    { name: 'mediaUrl', type: 'string', required: true, desc: '视频或音频 URL' },
    { name: 'language', type: 'string', default: 'zh' },
  ],
  outputs: [
    { name: 'segments', type: 'array', desc: '[{start, end, text}]' },
    { name: 'fullText', type: 'string' },
  ],
  async run(params) {
    const key = getKey('openai', ['OPENAI_API_KEY']);
    if (!key) throw new Error('asr_transcribe 需要 OpenAI API key');
    // 下载到本地
    const ext = (params.mediaUrl.match(/\.(mp4|mp3|wav|m4a|webm)/i) || ['.mp4'])[0];
    const localFile = path.join(WORKFLOW_ASSETS, `asr_in_${Date.now()}${ext}`);
    await _downloadToFile(params.mediaUrl, localFile);

    const FormData = require('form-data');
    const fd = new FormData();
    fd.append('file', fs.createReadStream(localFile));
    fd.append('model', 'whisper-1');
    fd.append('language', params.language || 'zh');
    fd.append('response_format', 'verbose_json');
    fd.append('timestamp_granularities[]', 'segment');
    try {
      const r = await axios.post('https://api.openai.com/v1/audio/transcriptions', fd, {
        headers: { ...fd.getHeaders(), Authorization: 'Bearer ' + key },
        timeout: 120000, maxContentLength: 60 * 1024 * 1024, maxBodyLength: 60 * 1024 * 1024,
      });
      const segs = (r.data?.segments || []).map(s => ({ start: s.start, end: s.end, text: String(s.text || '').trim() }));
      const full = r.data?.text || segs.map(s => s.text).join(' ');
      return { segments: segs, fullText: full };
    } finally {
      try { fs.unlinkSync(localFile); } catch {}
    }
  },
});

// ════════════════════════════════════════════════════════
// 9. download_url — URL 下载到本地（返回 publicUrl）
// ════════════════════════════════════════════════════════
registerCapability('download_url', {
  label: '下载 URL 到本地',
  description: '把外部 URL 下载到 workflow-assets，返回我们自己的 public URL',
  inputs: [
    { name: 'url', type: 'string', required: true },
    { name: 'ext', type: 'string', default: '.bin' },
  ],
  outputs: [
    { name: 'publicUrl', type: 'string' },
    { name: 'localPath', type: 'string' },
  ],
  async run(params) {
    const ext = params.ext || (params.url.match(/\.(jpg|jpeg|png|webp|mp4|mp3|wav)/i)?.[0] || '.bin');
    const filename = `wf_dl_${Date.now()}_${uuidv4().slice(0, 6)}${ext}`;
    const destPath = path.join(WORKFLOW_ASSETS, filename);
    await _downloadToFile(params.url, destPath);
    return { publicUrl: _publicUrl(filename), localPath: destPath };
  },
});

// ════════════════════════════════════════════════════════
// 10. http_get — 通用 HTTP GET（用户拓展用）
// ════════════════════════════════════════════════════════
registerCapability('http_get', {
  label: 'HTTP GET',
  description: '通用 HTTP GET 请求',
  inputs: [
    { name: 'url', type: 'string', required: true },
    { name: 'headers', type: 'object', default: {} },
  ],
  outputs: [
    { name: 'data', type: 'any' },
    { name: 'status', type: 'number' },
  ],
  async run(params) {
    const r = await axios.get(params.url, { headers: params.headers || {}, timeout: 30000 });
    return { data: r.data, status: r.status };
  },
});

// ════════════════════════════════════════════════════════
// 11. var_set — 设置变量（用于把字面量放进 ctx）
// ════════════════════════════════════════════════════════
registerCapability('var_set', {
  label: '设置变量',
  description: '把字面量值放进上下文，方便后续步骤引用',
  inputs: [
    { name: 'value', type: 'any', required: true },
  ],
  outputs: [
    { name: 'value', type: 'any' },
  ],
  async run(params) {
    return { value: params.value };
  },
});

// ════════════════════════════════════════════════════════
// 12. delay — 延迟（调试）
// ════════════════════════════════════════════════════════
registerCapability('delay', {
  label: '延迟',
  description: '等待 N 毫秒（调试用）',
  inputs: [
    { name: 'ms', type: 'number', default: 1000 },
  ],
  outputs: [
    { name: 'waited', type: 'number' },
  ],
  async run(params) {
    const ms = Math.max(0, Math.min(60000, Number(params.ms) || 1000));
    await _sleep(ms);
    return { waited: ms };
  },
});

module.exports = { /* 注册即生效 */ };
