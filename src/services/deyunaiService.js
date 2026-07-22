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
const MODEL_PROVIDER_TIMEOUT_MS = 10 * 60 * 1000;
const CONTENT_GENERATION_TASKS_URL = `${BASE_HOST}/api/v3/contents/generations/tasks`;
const ASSET_API_BASE_URL = `${BASE_HOST}/api/v1`;
const ASSET_POLL_INTERVAL_MS = 5000;
const ASSET_POLL_TIMEOUT_MS = 3 * 60 * 1000;
const GPT_IMAGE2_STREAM_PARTIAL_IMAGES = Math.max(1, Math.min(3, Math.round(Number(process.env.GPT_IMAGE2_PARTIAL_IMAGES) || 2)));

function abortableWait(ms, signal) {
  if (!signal) return new Promise(resolve => setTimeout(resolve, ms));
  if (signal.aborted) return Promise.reject(signal.reason || new Error('Request aborted'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); reject(signal.reason || new Error('Request aborted')); };
    signal.addEventListener('abort', abort, { once: true });
  });
}

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

async function notifyGenerationObserver(observer, payload) {
  if (typeof observer !== 'function') return;
  try {
    await observer(payload);
  } catch (error) {
    console.warn('[DeyunAI] generation observer failed:', String(error?.message || error));
  }
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
  const clientRequestId = String(options.clientRequestId || '').replace(/[\r\n]/g, '').trim().slice(0, 100);
  if (clientRequestId) headers['X-Request-ID'] = clientRequestId;
  if (!options.forceDomestic && isOverseasModel(modelId)) headers.vendor = 'API_VENDOR';
  return headers;
}

function isSeedanceContentGenerationModel(modelId) {
  return /^doubao-seedance-2-0-(?:260128|fast-260128)$/i.test(String(modelId || '').trim());
}

function seedanceRatioFromSize(size = '') {
  const match = String(size || '').match(/^(\d+)x(\d+)$/i);
  if (!match) return '9:16';
  const width = Number(match[1]);
  const height = Number(match[2]);
  const supported = [
    { ratio: '9:16', value: 9 / 16 },
    { ratio: '3:4', value: 3 / 4 },
    { ratio: '1:1', value: 1 },
    { ratio: '4:3', value: 4 / 3 },
    { ratio: '16:9', value: 16 / 9 },
    { ratio: '21:9', value: 21 / 9 },
  ];
  const value = width / height;
  return supported
    .slice()
    .sort((a, b) => Math.abs(Math.log(value / a.value)) - Math.abs(Math.log(value / b.value)))[0].ratio;
}

function seedanceResolutionFromSize(size = '') {
  const match = String(size || '').match(/^(\d+)x(\d+)$/i);
  if (!match) return '720p';
  const shortSide = Math.min(Number(match[1]), Number(match[2]));
  if (shortSide >= 2160) return '4k';
  if (shortSide >= 1080) return '1080p';
  if (shortSide <= 480) return '480p';
  return '720p';
}

function normalizeSeedanceAssetUri(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^asset:\/\//i.test(raw)) return raw;
  if (/^asset-[a-z0-9-]+$/i.test(raw)) return `asset://${raw}`;
  throw new Error('漫路 Seedance 人物参考必须是已入库的 asset:// 素材 ID');
}

function buildSeedanceContentTaskBody({ model, prompt, duration, size, imageUrl, referenceAssetUrls = [] }) {
  const content = [{ type: 'text', text: String(prompt || '').trim().substring(0, 4000) }];
  // Seedance 2.0 rejects mixed first/last-frame and reference-media requests.
  // A verified private-library asset must win whenever one is supplied: this
  // is the compliant route for person shots. Shots without an asset keep the
  // exact generated keyframe as first_frame. The choice is data-driven and is
  // never tied to a user, task id, or a particular actor.
  const assets = [...new Set((Array.isArray(referenceAssetUrls) ? referenceAssetUrls : [referenceAssetUrls])
    .map(normalizeSeedanceAssetUri)
    .filter(Boolean))].slice(0, 8);
  for (const assetUrl of assets) {
    content.push({
      type: 'image_url',
      image_url: { url: assetUrl },
      role: 'reference_image',
    });
  }
  if (imageUrl && !assets.length) {
    content.push({
      type: 'image_url',
      image_url: { url: String(imageUrl).trim() },
      role: 'first_frame',
    });
  }
  return {
    model,
    content,
    ratio: seedanceRatioFromSize(size),
    duration: Math.min(15, Math.max(5, Math.round(Number(duration) || 5))),
    resolution: seedanceResolutionFromSize(size),
    generate_audio: false,
    watermark: false,
  };
}

function seedanceContentTaskError(payload = {}, phase = '提交') {
  const info = payload?.error || payload?.Error || payload?.data?.error || payload?.data?.Error || null;
  if (!info) return null;
  const providerCode = String(info.code || info.Code || info.type || info.Type || 'ProviderRequestRejected');
  const providerMessage = String(info.message || info.Message || JSON.stringify(info)).slice(0, 800);
  let code = 'PROVIDER_REQUEST_REJECTED';
  if (/PrivacyInformation|real person/i.test(`${providerCode} ${providerMessage}`)) code = 'INPUT_PERSON_PRIVACY';
  else if (/SensitiveContent/i.test(`${providerCode} ${providerMessage}`)) code = 'INPUT_SENSITIVE_CONTENT';
  else if (/InvalidParameter|BadRequest|not valid/i.test(`${providerCode} ${providerMessage}`)) code = 'INVALID_PROVIDER_INPUT';
  else if (/RateLimit|TooManyRequests|429/i.test(`${providerCode} ${providerMessage}`)) code = 'RATE_LIMIT';
  else if (/Internal|ServiceUnavailable|5\d\d/i.test(providerCode)) code = 'PROVIDER_5XX';
  const error = new Error(`漫路 Seedance 2.0 ${phase}失败 [${providerCode}]: ${providerMessage}`);
  error.code = code;
  error.providerCode = providerCode;
  error.status = code.startsWith('INPUT_') || code === 'INVALID_PROVIDER_INPUT' ? 422 : 502;
  error.retryable = ['RATE_LIMIT', 'PROVIDER_5XX'].includes(code);
  return error;
}

function assetResult(payload = {}) {
  return payload?.Result || payload?.result || payload?.data?.Result || payload?.data?.result || payload?.data || payload || {};
}

function assetApiError(payload = {}) {
  const metadata = payload?.ResponseMetadata || payload?.response_metadata || {};
  const err = metadata.Error || metadata.error || payload?.Error || payload?.error || null;
  if (!err) return '';
  return String(err.Message || err.message || err.Code || err.code || JSON.stringify(err)).slice(0, 500);
}

function mappedAssetApiError(action, payload = {}, status = 502) {
  const metadata = payload?.ResponseMetadata || payload?.response_metadata || {};
  const detail = metadata.Error || metadata.error || payload?.Error || payload?.error || {};
  const providerCode = String(detail.Code || detail.code || '').trim();
  const providerMessage = String(detail.Message || detail.message || providerCode || 'unknown provider error').slice(0, 500);
  const error = new Error(`漫路素材库 ${action} 失败 [${providerCode || 'Unknown'}]: ${providerMessage}`);
  error.code = /SubscriptionRequired/i.test(providerCode) ? 'DEYUNAI_ASSET_SUBSCRIPTION_REQUIRED'
    : /NotFound\.group_id/i.test(providerCode) ? 'DEYUNAI_ASSET_GROUP_NOT_FOUND' : 'DEYUNAI_ASSET_API_FAILED';
  error.providerCode = providerCode;
  error.status = Number(status || 502);
  error.retryable = false;
  return error;
}

async function requestAssetApi(action, body = {}, { httpClient = axios, signal = null } = {}) {
  let response;
  try {
    response = await httpClient.post(`${ASSET_API_BASE_URL}/${encodeURIComponent(action)}`, body, {
      headers: buildHeaders('', { forceDomestic: true }), timeout: 30000, signal,
    });
  } catch (error) {
    if (assetApiError(error?.response?.data || {})) throw mappedAssetApiError(action, error.response.data, error.response.status);
    throw error;
  }
  const businessError = assetApiError(response.data);
  if (businessError) throw mappedAssetApiError(action, response.data, response.status);
  return response.data;
}

async function listAssetGroups({ groupType = 'AIGC', name = '', projectName = 'default', httpClient = axios, signal = null } = {}) {
  const filter = { GroupType: groupType };
  if (String(name || '').trim()) filter.Name = String(name).trim().slice(0, 64);
  const payload = await requestAssetApi('ListAssetGroups', {
    Filter: filter,
    PageNumber: 1,
    PageSize: 100,
    SortBy: 'UpdateTime',
    SortOrder: 'Desc',
    ProjectName: projectName,
  }, { httpClient, signal });
  const result = assetResult(payload);
  return Array.isArray(result.Items || result.items) ? (result.Items || result.items) : [];
}

async function createAssetGroup({ name, description = '', groupType = 'AIGC', projectName = 'default', httpClient = axios, signal = null } = {}) {
  const payload = await requestAssetApi('CreateAssetGroup', {
    Name: String(name || '').trim().slice(0, 64),
    Description: String(description || '').trim().slice(0, 300),
    GroupType: groupType,
    ProjectName: projectName,
  }, { httpClient, signal });
  const id = assetId(assetResult(payload));
  if (!id) throw new Error('漫路虚拟人像素材组创建成功但未返回 Group ID');
  return id;
}

async function listAssets({ groupId, groupType = 'AIGC', projectName = 'default', httpClient = axios, signal = null } = {}) {
  const payload = await requestAssetApi('ListAssets', {
    Filter: { GroupIds: [groupId], GroupType: groupType },
    PageNumber: 1,
    PageSize: 100,
    SortBy: 'UpdateTime',
    SortOrder: 'Desc',
    ProjectName: projectName,
  }, { httpClient, signal });
  const result = assetResult(payload);
  return Array.isArray(result.Items || result.items) ? (result.Items || result.items) : [];
}

function assetStatus(item = {}) {
  return String(item.Status || item.status || item.State || item.state || '').trim();
}

function assetId(item = {}) {
  return String(item.Id || item.id || item.AssetId || item.asset_id || item.assetId || '').trim();
}

async function ensurePersonImageAsset({
  sourceUrl,
  assetKind = 'person',
  name = '',
  groupName = '',
  groupType = 'AIGC',
  groupId = '',
  projectName = 'default',
  existing = null,
  timeoutMs = ASSET_POLL_TIMEOUT_MS,
  pollIntervalMs = ASSET_POLL_INTERVAL_MS,
  httpClient = axios,
  signal = null,
} = {}) {
  const sceneAsset = String(assetKind || '').toLowerCase() === 'scene';
  const assetLabel = sceneAsset ? '场景空间参考' : '人物';
  const url = String(sourceUrl || '').trim();
  if (!/^https?:\/\//i.test(url) || /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::|\/|$)/i.test(url)) {
    const error = new Error(`漫路${assetLabel}素材必须使用公网可访问的 http(s) 图片 URL`);
    error.code = sceneAsset ? 'DEYUNAI_SCENE_ASSET_URL_REQUIRED' : 'DEYUNAI_PERSON_ASSET_URL_REQUIRED';
    throw error;
  }
  if (existing && String(existing.source_url || '') === url && /^active$/i.test(String(existing.status || '')) && existing.asset_id) {
    return { ...existing, asset_url: normalizeSeedanceAssetUri(existing.asset_id) };
  }

  const resolvedGroupType = /^livenessface$/i.test(String(groupType || '')) ? 'LivenessFace' : 'AIGC';
  const safeGroupName = String(groupName || `vido_${sceneAsset ? 'scene' : 'person'}_${Date.now()}`).replace(/[^a-z0-9_.-]+/ig, '_').slice(0, 64);
  let resolvedGroupId = String(groupId || existing?.group_id || '').trim();
  if (!resolvedGroupId) {
    if (resolvedGroupType === 'LivenessFace') {
      const error = new Error('真实人物必须绑定该人物本人已授权的漫路 LivenessFace GroupId；系统不会自动选择其他真人素材组');
      error.code = 'DEYUNAI_LIVENESS_GROUP_BINDING_REQUIRED';
      error.status = 422;
      error.retryable = false;
      throw error;
    }
    const groups = await listAssetGroups({ groupType: resolvedGroupType, name: safeGroupName, projectName, httpClient, signal });
    const exact = groups.find(item => String(item.Name || item.name || '') === safeGroupName);
    resolvedGroupId = String(exact?.Id || exact?.id || '').trim();
    if (!resolvedGroupId) {
      resolvedGroupId = await createAssetGroup({
        name: safeGroupName,
        description: sceneAsset
          ? 'VIDO 当前任务场景空间参考素材组；仅用于 Seedance 2.0 空间一致性锁定'
          : 'VIDO 独立虚拟人物素材组；仅用于同一人物的 Seedance 2.0 一致性锁定',
        groupType: 'AIGC',
        projectName,
        httpClient,
        signal,
      });
    }
  }
  if (!resolvedGroupId) {
    const error = new Error(`漫路账号没有可用的${resolvedGroupType === 'LivenessFace' ? '真人' : '虚拟人像'}素材组，请先在供应商控制台完成授权并创建素材组`);
    error.code = 'DEYUNAI_PERSON_ASSET_GROUP_REQUIRED';
    error.status = 422;
    error.retryable = false;
    throw error;
  }

  const safeName = String(name || `vido_${sceneAsset ? 'scene' : 'actor'}_${Date.now()}`).replace(/[^a-z0-9_.-]+/ig, '_').slice(0, 64);
  const createPayload = await requestAssetApi('CreateAsset', {
    GroupId: resolvedGroupId,
    URL: url,
    Name: safeName || `vido_actor_${Date.now()}`,
    AssetType: 'Image',
    ProjectName: projectName,
  }, { httpClient, signal });
  const createdId = assetId(assetResult(createPayload));
  if (!createdId) throw new Error(`漫路${assetLabel}素材上传成功但未返回 Asset ID`);

  const startedAt = Date.now();
  let lastStatus = 'Processing';
  while (Date.now() - startedAt < timeoutMs) {
    const items = await listAssets({ groupId: resolvedGroupId, groupType: resolvedGroupType, projectName, httpClient, signal });
    const current = items.find(item => assetId(item).toLowerCase() === createdId.toLowerCase());
    if (current) {
      lastStatus = assetStatus(current) || lastStatus;
      if (/^active$/i.test(lastStatus)) {
        return {
          asset_id: createdId,
          asset_url: normalizeSeedanceAssetUri(createdId),
          group_id: resolvedGroupId,
          group_type: resolvedGroupType,
          status: 'Active',
          source_url: url,
          project_name: projectName,
          updated_at: new Date().toISOString(),
        };
      }
      if (/^failed$/i.test(lastStatus)) {
        const detail = current.Error || current.error || current.Message || current.message || '';
        throw new Error(`漫路${assetLabel}素材处理失败: ${String(detail || JSON.stringify(current)).slice(0, 500)}`);
      }
    }
    await abortableWait(Math.max(0, Number(pollIntervalMs) || 0), signal);
  }
  throw new Error(`漫路${assetLabel}素材处理超时，asset=${createdId}, lastStatus=${lastStatus}`);
}

function extractSeedanceContentTaskVideoUrl(payload) {
  const data = payload?.data || payload || {};
  const direct = data.video_url
    || data.videoUrl
    || data.content?.video_url
    || data.content?.videoUrl
    || data.output?.video_url
    || data.output?.videoUrl
    || data.output?.video?.url
    || data.result?.video_url
    || data.result?.videoUrl
    || data.result?.video?.url
    || data.videos?.[0]?.url
    || data.videos?.[0]?.video_url;
  if (direct) return direct;

  const visit = (value, depth = 0) => {
    if (!value || depth > 6) return '';
    if (typeof value === 'string') return /^https?:\/\//i.test(value) ? value : '';
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item, depth + 1);
        if (found) return found;
      }
      return '';
    }
    if (typeof value !== 'object') return '';
    for (const [key, child] of Object.entries(value)) {
      if (!/video|url|output|result|content/i.test(key)) continue;
      const found = visit(child, depth + 1);
      if (found) return found;
    }
    return '';
  };
  return visit(data);
}

function attachSubmittedVideoTask(error, taskId, duration) {
  const next = error instanceof Error ? error : new Error(String(error || 'Video generation failed'));
  next.providerTaskId = next.providerTaskId || taskId;
  next.requestedVideoSeconds = Number(next.requestedVideoSeconds || duration || 0);
  next.billingState = next.billingState || 'unknown';
  return next;
}

function seedanceTaskSnapshot(payload = {}, fallbackDuration = 0) {
  const task = payload?.data || payload || {};
  const status = String(task.status || task.task_status || task.state || '').trim().toLowerCase();
  const url = extractSeedanceContentTaskVideoUrl(task);
  const succeeded = !!url && (!status || ['succeeded', 'success', 'completed', 'done', 'finished'].includes(status));
  const failed = ['failed', 'fail', 'error', 'cancelled', 'canceled'].includes(status);
  return {
    task,
    status,
    url,
    succeeded,
    failed,
    terminal: succeeded || failed,
    durationSec: Number(task.duration || task.duration_sec) || Number(fallbackDuration) || 0,
    message: task.error?.message || task.message || task.error_message || '',
  };
}

async function resumeVideo({ model, taskId, duration = 5, timeoutMs = 600000, signal = null, onProgress = null }) {
  const providerTaskId = String(taskId || '').trim();
  if (!providerTaskId) throw new Error('漫路视频续接缺少 provider task ID');
  if (!isSeedanceContentGenerationModel(model)) {
    const error = new Error(`当前漫路模型不支持按任务 ID 续接: ${model || 'unknown'}`);
    error.code = 'PROVIDER_TASK_RESUME_UNSUPPORTED';
    error.retryable = false;
    throw error;
  }
  const headers = buildHeaders(model, { forceDomestic: true });
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    let queryRes;
    try {
      queryRes = await axios.get(`${CONTENT_GENERATION_TASKS_URL}/${encodeURIComponent(providerTaskId)}`, {
        headers,
        timeout: 30000,
        signal,
      });
    } catch (requestError) {
      const businessError = seedanceContentTaskError(requestError?.response?.data, '续接查询');
      throw attachSubmittedVideoTask(businessError || requestError, providerTaskId, duration);
    }
    const queryError = seedanceContentTaskError(queryRes.data, '续接查询');
    if (queryError) throw attachSubmittedVideoTask(queryError, providerTaskId, duration);
    const snapshot = seedanceTaskSnapshot(queryRes.data, duration);
    await notifyGenerationObserver(onProgress, {
      provider: 'deyunai', model, taskId: providerTaskId, status: snapshot.status || 'polling',
      elapsedMs: Date.now() - startedAt, polledAt: new Date().toISOString(), hasOutputUrl: !!snapshot.url,
      resumed: true,
    });
    if (snapshot.succeeded) {
      return { url: snapshot.url, taskId: providerTaskId, durationSec: snapshot.durationSec || duration, resumed: true };
    }
    if (snapshot.failed) {
      const error = new Error(`漫路 Seedance 2.0 原任务已失败: ${snapshot.message || JSON.stringify(snapshot.task).slice(0, 500)}`);
      error.code = 'PROVIDER_TASK_TERMINAL_FAILED';
      error.retryable = true;
      throw attachSubmittedVideoTask(error, providerTaskId, duration);
    }
    await abortableWait(5000, signal);
  }
  const error = new Error(`漫路 Seedance 2.0 原任务续接超时（${timeoutMs}ms）`);
  error.code = 'PROVIDER_TASK_RESUME_TIMEOUT';
  error.retryable = true;
  throw attachSubmittedVideoTask(error, providerTaskId, duration);
}

async function generateSeedanceContentTask({ model, prompt, duration, size, imageUrl, referenceAssetUrls, timeoutMs, signal, onSubmitted = null, onProgress = null }) {
  const headers = buildHeaders(model, { forceDomestic: true });
  const body = buildSeedanceContentTaskBody({ model, prompt, duration, size, imageUrl, referenceAssetUrls });
  let submitRes;
  try {
    submitRes = await axios.post(CONTENT_GENERATION_TASKS_URL, body, { headers, timeout: 30000, signal });
  } catch (requestError) {
    const businessError = seedanceContentTaskError(requestError?.response?.data, '提交');
    if (businessError) throw businessError;
    throw requestError;
  }
  const submitError = seedanceContentTaskError(submitRes.data, '提交');
  if (submitError) throw submitError;
  const taskId = submitRes.data?.data?.id || submitRes.data?.id || submitRes.data?.data?.task_id || submitRes.data?.task_id;
  if (!taskId) {
    const error = new Error('漫路 Seedance 2.0 返回格式异常，未返回任务 ID: ' + JSON.stringify(submitRes.data).slice(0, 300));
    error.code = 'PROVIDER_RESPONSE_INVALID';
    error.retryable = true;
    throw error;
  }

  await notifyGenerationObserver(onSubmitted, {
    provider: 'deyunai', model, taskId, status: 'submitted', submittedAt: new Date().toISOString(),
  });

  try {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      await abortableWait(5000, signal);
      let queryRes;
      try {
        queryRes = await axios.get(`${CONTENT_GENERATION_TASKS_URL}/${encodeURIComponent(taskId)}`, {
          headers,
          timeout: 30000,
          signal,
        });
      } catch (requestError) {
        const businessError = seedanceContentTaskError(requestError?.response?.data, '查询');
        if (businessError) throw businessError;
        throw requestError;
      }
      const queryError = seedanceContentTaskError(queryRes.data, '查询');
      if (queryError) throw queryError;
      const task = queryRes.data?.data || queryRes.data || {};
      const status = String(task.status || task.task_status || task.state || '').trim().toLowerCase();
      const url = extractSeedanceContentTaskVideoUrl(task);
      await notifyGenerationObserver(onProgress, {
        provider: 'deyunai', model, taskId, status: status || 'polling',
        elapsedMs: Date.now() - startedAt, polledAt: new Date().toISOString(), hasOutputUrl: !!url,
      });
      if (url && (!status || ['succeeded', 'success', 'completed', 'done', 'finished'].includes(status))) {
        return { url, taskId, durationSec: Number(task.duration || task.duration_sec) || duration };
      }
      if (['failed', 'fail', 'error', 'cancelled', 'canceled'].includes(status)) {
        const message = task.error?.message || task.message || task.error_message || JSON.stringify(task).slice(0, 500);
        throw new Error(`漫路 Seedance 2.0 生成失败: ${message}`);
      }
    }
    throw new Error(`漫路 Seedance 2.0 生成超时（${timeoutMs}ms）`);
  } catch (error) {
    throw attachSubmittedVideoTask(error, taskId, duration);
  }
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

function isReadableStream(value) {
  return !!value && typeof value.on === 'function' && typeof value.pipe === 'function';
}

function providerRequestIdFromHeaders(headers = {}) {
  return String(headers?.['x-request-id'] || headers?.['request-id'] || headers?.['x-trace-id'] || '').trim().slice(0, 160);
}

function streamPayloadSnapshot(text = '') {
  const payloads = parseSseDataPayloads(text);
  let taskId = '';
  let providerRequestId = '';
  let status = '';
  for (const payload of payloads) {
    if (!payload || typeof payload !== 'object') continue;
    taskId = payload.task_id || payload.taskId || payload.data?.task_id || payload.data?.taskId || taskId;
    providerRequestId = payload.request_id || payload.requestId || payload.data?.request_id || payload.data?.requestId || providerRequestId;
    status = payload.status || payload.task_status || payload.data?.status || payload.data?.task_status || payload.type || status;
  }
  return {
    taskId: String(taskId || '').slice(0, 160),
    providerRequestId: String(providerRequestId || '').slice(0, 160),
    status: String(status || '').slice(0, 80),
  };
}

function extractCompletedImageUrlsFromStreamText(text = '') {
  const urls = new Set();
  for (const payload of parseSseDataPayloads(text)) {
    if (!payload || typeof payload !== 'object') continue;
    const marker = String(payload.type || payload.status || payload.task_status || payload.data?.status || payload.data?.task_status || '').toLowerCase();
    const explicitlyComplete = /(?:^|[._-])(completed?|succeeded?|success|succeed)(?:$|[._-])/.test(marker);
    const explicitlyPartial = /partial|progress|processing|running|queued|submitted/.test(marker);
    const openAiStyleFinal = !explicitlyPartial && Array.isArray(payload.data)
      && payload.data.some(item => item && typeof item === 'object' && (item.url || item.image_url));
    if (!explicitlyComplete && !openAiStyleFinal) continue;
    extractImageUrlsFromAnyPayload(payload).forEach(url => urls.add(url));
  }
  return Array.from(urls);
}

function readStreamText(stream, timeoutMs = MODEL_PROVIDER_TIMEOUT_MS, options = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let pending = '';
    let observedText = '';
    let snapshot = { taskId: '', providerRequestId: '', status: '' };
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      try { stream.destroy?.(); } catch {}
      const err = new Error(`DeyunAI gpt-image-2 stream did not finish within ${timeoutMs}ms`);
      err.code = 'DEYUNAI_GPT_IMAGE2_STREAM_TIMEOUT';
      const partialResponseText = Buffer.concat(chunks).toString('utf8').slice(-1024 * 1024);
      const finalSnapshot = streamPayloadSnapshot(partialResponseText);
      err.partialResponseText = partialResponseText;
      err.providerTaskId = finalSnapshot.taskId || snapshot.taskId || '';
      err.providerRequestId = finalSnapshot.providerRequestId || snapshot.providerRequestId || options.providerRequestId || '';
      err.generatedUrls = extractCompletedImageUrlsFromStreamText(partialResponseText);
      err.providerSubmissionState = err.generatedUrls.length ? 'completed' : 'submitted_unknown';
      err.billingState = 'unknown';
      finish(reject, err);
    }, Math.max(1000, Number(timeoutMs) || MODEL_PROVIDER_TIMEOUT_MS));
    stream.on('data', chunk => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      chunks.push(buffer);
      pending += buffer.toString('utf8');
      const lastBoundary = Math.max(pending.lastIndexOf('\n\n'), pending.lastIndexOf('\r\n\r\n'));
      if (lastBoundary < 0) return;
      const consumed = pending.slice(0, lastBoundary + (pending.slice(lastBoundary, lastBoundary + 4) === '\r\n\r\n' ? 4 : 2));
      pending = pending.slice(consumed.length);
      observedText += consumed;
      snapshot = { ...snapshot, ...Object.fromEntries(Object.entries(streamPayloadSnapshot(observedText)).filter(([, value]) => value)) };
      const completedUrls = extractCompletedImageUrlsFromStreamText(observedText);
      void notifyGenerationObserver(options.onProgress, {
        ...snapshot,
        providerRequestId: snapshot.providerRequestId || options.providerRequestId || '',
        completedUrls,
        at: new Date().toISOString(),
      });
      if (completedUrls.length) {
        const text = Buffer.concat(chunks).toString('utf8');
        finish(resolve, text);
        try { stream.destroy?.(); } catch {}
      }
    });
    stream.on('error', err => {
      const partialResponseText = Buffer.concat(chunks).toString('utf8').slice(-1024 * 1024);
      const finalSnapshot = streamPayloadSnapshot(partialResponseText);
      err.partialResponseText = partialResponseText;
      err.providerTaskId = err.providerTaskId || finalSnapshot.taskId || snapshot.taskId || '';
      err.providerRequestId = err.providerRequestId || finalSnapshot.providerRequestId || snapshot.providerRequestId || options.providerRequestId || '';
      err.generatedUrls = err.generatedUrls || extractCompletedImageUrlsFromStreamText(partialResponseText);
      err.providerSubmissionState = err.providerSubmissionState || (err.generatedUrls.length ? 'completed' : 'submitted_unknown');
      err.billingState = 'unknown';
      finish(reject, err);
    });
    stream.on('end', () => finish(resolve, Buffer.concat(chunks).toString('utf8')));
  });
}

function parseSseDataPayloads(text = '') {
  const payloads = [];
  const blocks = String(text || '').split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const dataText = block
      .split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.replace(/^data:\s?/, ''))
      .join('\n')
      .trim();
    if (!dataText || dataText === '[DONE]') continue;
    try { payloads.push(JSON.parse(dataText)); } catch { payloads.push(dataText); }
  }
  return payloads;
}

function parseStreamResponsePayload(text = '') {
  const ssePayloads = parseSseDataPayloads(text);
  if (ssePayloads.length) return ssePayloads[ssePayloads.length - 1];
  try { return JSON.parse(String(text || '')); } catch {}
  return String(text || '');
}

function extractImageUrlsFromStreamText(text = '') {
  const urls = new Set();
  const payloads = parseSseDataPayloads(text);
  if (!payloads.length) {
    try { payloads.push(JSON.parse(String(text || ''))); } catch {}
  }
  for (const payload of payloads) {
    extractImageUrlsFromAnyPayload(payload).forEach(url => urls.add(url));
  }
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
  if (['1024x1024', '1536x1024', '1024x1536'].includes(raw)) return raw;
  const m = raw.match(/^(\d{2,5})x(\d{2,5})$/);
  if (!m) return 'auto';
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 'auto';
  const ratio = w / h;
  if (ratio > 3 || ratio < 1 / 3) return 'auto';
  if (ratio > 1.2) return '1536x1024';
  if (ratio < 0.84) return '1024x1536';
  return '1024x1024';
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
    'stream',
    'partial_images',
  ]);
  const unexpected = Object.keys(body || {}).filter(k => !allowed.has(k));
  if (unexpected.length) {
    throw new Error(`gpt-image-2 请求体包含接口文档未声明字段: ${unexpected.join(', ')}`);
  }
  if (body.images !== undefined && (!Array.isArray(body.images) || body.images.some(x => {
    if (typeof x === 'string') return !/^https?:\/\//i.test(x);
    if (x && typeof x === 'object') return !/^https?:\/\//i.test(String(x.image_url || ''));
    return true;
  }))) {
    throw new Error('gpt-image-2 images 必须是公网 http(s) URL；当前企业 edits 解析器要求 { image_url } 数组');
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
    input_fidelity: body.input_fidelity || '',
    output_format: body.output_format || '',
    n: body.n || 0,
    stream: body.stream === true,
    partial_images: body.partial_images || 0,
    image_count: images.length,
    images_shape: !images.length
      ? 'none'
      : (typeof firstImage === 'string' ? 'string_url_array' : (firstImage && typeof firstImage === 'object' && firstImage.image_url ? 'object_image_url_array' : typeof firstImage)),
    has_aspect_ratio_field: Object.prototype.hasOwnProperty.call(body, 'aspect_ratio') || Object.prototype.hasOwnProperty.call(body, 'aspectRatio'),
    has_output_compression: Object.prototype.hasOwnProperty.call(body, 'output_compression'),
  };
}

// ════════════════════════════════════════════════
// 1. 文本 chat completions
// ════════════════════════════════════════════════
function estimateTextTokens(value) {
  const source = typeof value === 'string' ? value : JSON.stringify(value || '');
  const cjk = (source.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const nonCjk = Math.max(0, source.length - cjk);
  return source.length ? Math.max(1, Math.ceil(cjk + (nonCjk / 4))) : 0;
}

/**
 * @param {object} opts
 * @param {string} opts.model
 * @param {Array}  opts.messages  - [{role,content}, ...]
 * @param {number} [opts.maxTokens=4096]
 * @param {string} [opts.userId]
 * @param {string} [opts.agentId]
 * @returns {Promise<{ text:string, raw:object }>}
 */
async function chat({ model, messages, maxTokens = 4096, userId = null, agentId = null, signal = null }) {
  const _started = Date.now();
  let _ok = false; let _err = null;
  let _inputTokens = 0; let _outputTokens = 0;
  let _usageSource = 'actual';
  try {
    const res = await axios.post(
      buildUrl('/chat/completions', model),
      { model, messages, max_tokens: maxTokens },
      { headers: buildHeaders(model), timeout: 120000, signal }
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
    if (!_inputTokens && !_outputTokens) {
      _inputTokens = estimateTextTokens(messages);
      _outputTokens = estimateTextTokens(text);
      _usageSource = 'estimated';
    }
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
        userId, agentId, usageSource: _usageSource,
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
 * @param {number} [opts.timeoutMs=MODEL_PROVIDER_TIMEOUT_MS]
 * @param {string} [opts.userId]
 * @param {string} [opts.agentId]
 * @returns {Promise<{ urls:string[], taskId:string }>}
 */
async function generateImage({ model, prompt, n = 1, size = '1024x1024', aspectRatio = '', referenceImages = [], inputFidelity = 'high', timeoutMs = MODEL_PROVIDER_TIMEOUT_MS, userId = null, agentId = null, signal = null, clientRequestId = '', onSubmitting = null, onSubmitted = null, onProgress = null }) {
  const _started = Date.now();
  let _ok = false; let _err = null; let _taskId = null; let _providerRequestId = ''; let _submissionStarted = false;
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
        stream: true,
        partial_images: GPT_IMAGE2_STREAM_PARTIAL_IMAGES,
      };
      const isEdit = refs.length > 0;
      if (isEdit) {
        body.images = refs
          .map(normalizeGptImage2Reference)
          .filter(Boolean)
          .map(image_url => ({ image_url }));
        const fidelity = String(inputFidelity || 'high').trim().toLowerCase();
        body.input_fidelity = fidelity === 'low' ? 'low' : 'high';
      }
      assertGptImage2BodyContract(body);
      const endpoint = isEdit ? '/images/edits' : '/images/generations';
      const requestSummary = summarizeGptImage2Request(endpoint, body);
      await notifyGenerationObserver(onSubmitting, {
        clientRequestId,
        status: 'submitting',
        submittedAt: new Date().toISOString(),
      });
      _submissionStarted = true;
      const submitRes = await axios.post(
        buildEnterpriseImageUrl(endpoint),
        body,
        { headers: buildHeaders(model, { forceDomestic: true, clientRequestId }), timeout: timeoutMs, responseType: 'stream', validateStatus: () => true, signal }
      );
      _providerRequestId = providerRequestIdFromHeaders(submitRes.headers);
      await notifyGenerationObserver(onSubmitted, {
        clientRequestId,
        providerRequestId: _providerRequestId,
        status: submitRes.status >= 400 ? 'rejected' : 'submitted',
        submittedAt: new Date().toISOString(),
      });
      const streamText = isReadableStream(submitRes.data)
        ? await readStreamText(submitRes.data, timeoutMs, { onProgress, providerRequestId: _providerRequestId })
        : '';
      if (streamText) submitRes.data = parseStreamResponsePayload(streamText);
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
      const streamSnapshot = streamText ? streamPayloadSnapshot(streamText) : {};
      _taskId = _taskId || streamSnapshot.taskId || null;
      _providerRequestId = _providerRequestId || streamSnapshot.providerRequestId || '';
      const completedStreamUrls = streamText ? extractCompletedImageUrlsFromStreamText(streamText) : [];
      const streamUrls = completedStreamUrls.length ? completedStreamUrls : (streamText ? extractImageUrlsFromStreamText(streamText) : []);
      const urls = streamUrls.length ? streamUrls : extractImageUrlsFromSyncPayload(submitRes.data);
      if (!urls.length) {
        const err = new Error('漫路 GPT Image 2 未返回图片数据: ' + JSON.stringify(submitRes.data).slice(0, 300));
        err.providerRequest = requestSummary;
        throw err;
      }
      _ok = true;
      return { urls, taskId: _taskId, providerRequestId: _providerRequestId, raw: submitRes.data, stream: !!streamText, partial_images: GPT_IMAGE2_STREAM_PARTIAL_IMAGES };
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
    await notifyGenerationObserver(onSubmitting, {
      clientRequestId,
      status: 'submitting',
      submittedAt: new Date().toISOString(),
    });
    _submissionStarted = true;
    const submitRes = await axios.post(
      buildImageUrl('/images/generations', model),
      body,
      { headers: buildHeaders(model, { clientRequestId }), timeout: timeoutMs, validateStatus: () => true, signal }
    );
    _providerRequestId = providerRequestIdFromHeaders(submitRes.headers);
    if (submitRes.status >= 400) {
      throw buildProviderImageError(`漫路 images 提交 HTTP ${submitRes.status}: ${JSON.stringify(submitRes.data).slice(0, 300)}`, submitRes.data);
    }
    _taskId = submitRes.data?.data?.task_id || submitRes.data?.task_id;
    await notifyGenerationObserver(onSubmitted, {
      clientRequestId,
      taskId: _taskId || '',
      providerRequestId: _providerRequestId,
      status: _taskId ? 'submitted' : 'responded',
      submittedAt: new Date().toISOString(),
    });
    // 同步返回 (OpenAI 风格)
    if (!_taskId && submitRes.data?.data) {
      const arr = submitRes.data.data;
      if (Array.isArray(arr) && arr[0]?.url) {
        _ok = true;
        return { urls: arr.map(x => x.url || x.b64_json).filter(Boolean), taskId: null, providerRequestId: _providerRequestId };
      }
    }
    if (!_taskId) {
      throw new Error('漫路 images 提交失败: ' + JSON.stringify(submitRes.data).slice(0, 300));
    }

    // 轮询
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await abortableWait(POLL_INTERVAL_MS, signal);
      const queryRes = await axios.get(
        buildImageUrl(`/images/generations/${_taskId}`, model),
        { headers: buildHeaders(model), timeout: 15000, signal }
      );
      const d = queryRes.data?.data || {};
      await notifyGenerationObserver(onProgress, {
        clientRequestId,
        taskId: _taskId,
        providerRequestId: _providerRequestId,
        status: d.task_status || 'processing',
        completedUrls: d.task_status === 'succeed' ? (d.task_result?.images || []).map(im => im.url).filter(Boolean) : [],
        polledAt: new Date().toISOString(),
      });
      if (d.task_status === 'succeed') {
        const urls = (d.task_result?.images || []).map(im => im.url).filter(Boolean);
        if (!urls.length) throw new Error('图像生成成功但 url 列表为空');
        _ok = true;
        return { urls, taskId: _taskId, providerRequestId: _providerRequestId };
      }
      if (d.task_status === 'failed' || d.task_status === 'fail') {
        throw buildProviderImageError(`漫路图像生成失败: ${d.error_msg || d.message || JSON.stringify(d)}`, d);
      }
      // submitted / processing → 继续轮询
    }
    throw new Error(`漫路图像生成超时（${timeoutMs}ms）`);
  } catch (e) {
    const status = Number(e?.response?.status || 0);
    const ambiguous = _submissionStarted && (!status || status >= 500
      || /timeout|timed\s*out|ECONNRESET|socket hang up/i.test(`${e?.code || ''} ${e?.message || ''}`));
    if (_submissionStarted) {
      e.providerRequestId = e.providerRequestId || _providerRequestId || providerRequestIdFromHeaders(e?.response?.headers);
      e.providerTaskId = e.providerTaskId || _taskId || '';
      e.providerSubmissionState = e.providerSubmissionState || (ambiguous ? 'submitted_unknown' : 'rejected');
      if (ambiguous) e.billingState = 'unknown';
    }
    _err = e.message; throw e;
  } finally {
    try {
      require('./tokenTracker').record({
        provider: 'deyunai', model,
        category: 'image', imageCount: _ok ? n : 0,
        durationMs: Date.now() - _started,
        status: _ok ? 'success' : 'fail', errorMsg: _err,
        userId, agentId, requestId: _taskId || _providerRequestId || clientRequestId,
        billingState: _ok ? 'confirmed' : (_submissionStarted ? 'unknown' : 'not_submitted'),
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
async function generateVideo({ model, prompt, duration = 5, size = '720x1280', imageUrl, referenceAssetUrls = [], timeoutMs = 600000, userId = null, agentId = null, signal = null, onSubmitted = null, onProgress = null }) {
  const _started = Date.now();
  let _ok = false; let _err = null; let _taskId = null;
  let _videoSeconds = duration || 5;
  try {
    if (isSeedanceContentGenerationModel(model)) {
      const result = await generateSeedanceContentTask({ model, prompt, duration, size, imageUrl, referenceAssetUrls, timeoutMs, signal, onSubmitted, onProgress });
      _taskId = result.taskId;
      _videoSeconds = Number(result.durationSec) || _videoSeconds;
      _ok = true;
      return result;
    }

    const body = { model, prompt, duration: parseInt(duration, 10), size };
    if (imageUrl) body.image_url = imageUrl;

    const submitRes = await axios.post(
      buildUrl('/videos', model),
      body,
      { headers: buildHeaders(model), timeout: 30000, signal }
    );
    _taskId = submitRes.data?.data?.task_id || submitRes.data?.task_id;
    if (!_taskId) {
      throw new Error('漫路 video 提交失败: ' + JSON.stringify(submitRes.data).slice(0, 300));
    }
    await notifyGenerationObserver(onSubmitted, {
      provider: 'deyunai', model, taskId: _taskId, status: 'submitted', submittedAt: new Date().toISOString(),
    });

    // 轮询（视频可能 5-10 分钟）
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await abortableWait(5000, signal);
      const queryRes = await axios.get(
        buildUrl(`/videos/${_taskId}`, model),
        { headers: buildHeaders(model), timeout: 15000, signal }
      );
      const d = queryRes.data?.data || {};
      await notifyGenerationObserver(onProgress, {
        provider: 'deyunai', model, taskId: _taskId, status: String(d.task_status || 'polling').toLowerCase(),
        elapsedMs: Date.now() - start, polledAt: new Date().toISOString(), hasOutputUrl: !!(d.task_result?.videos?.[0]?.url || d.task_result?.video_url),
      });
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
    _taskId = _taskId || e.providerTaskId || null;
    _videoSeconds = Number(e.requestedVideoSeconds || _videoSeconds || duration || 0);
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
        category: 'video', videoSeconds: (_ok || _taskId) ? _videoSeconds : 0,
        durationMs: Date.now() - _started,
        status: _ok ? 'success' : 'fail', errorMsg: _err,
        userId, agentId, requestId: _taskId,
        billingState: _ok ? 'confirmed' : (_taskId ? 'unknown' : 'not_submitted'),
      });
    } catch {}
  }
}

module.exports = {
  isOverseasModel,
  isSeedanceContentGenerationModel,
  normalizeSeedanceAssetUri,
  buildSeedanceContentTaskBody,
  seedanceContentTaskError,
  extractSeedanceContentTaskVideoUrl,
  attachSubmittedVideoTask,
  seedanceTaskSnapshot,
  resumeVideo,
  estimateTextTokens,
  listAssetGroups,
  createAssetGroup,
  listAssets,
  ensurePersonImageAsset,
  getDeyunaiKey,
  readStreamText,
  parseSseDataPayloads,
  streamPayloadSnapshot,
  extractCompletedImageUrlsFromStreamText,
  chat,
  generateImage,
  generateVideo,
};
