require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const assetUrlReadiness = require('./visualAssetUrlReadinessService');
const sharp = require('sharp');
const OpenAI = require('openai');
const pipeline = require('../pipelineModelService');
const { loadSettings } = require('../settingsService');
const deyunaiService = require('../deyunaiService');
const modelGateway = require('./modelGateway');
const generationConcurrency = require('./generationConcurrencyService');
const generationBillingGuard = require('./generationBillingGuardService');
const storage = require('./storageService');
const cancellation = require('./cancellationContext');
const publicReferences = require('./publicReferenceService');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, '../../../outputs'));
const ASSET_DIR = path.join(OUTPUT_DIR, 'new-story-ad-assets');
const THUMB_DIR = path.join(ASSET_DIR, 'thumbs');
const IMAGE_MAX_CANDIDATES = Math.max(1, Math.min(5, Number(process.env.NEW_STORY_AD_IMAGE_MAX_CANDIDATES) || 2));
const NANO_BANANA_PROMPT_LIMIT = 2400;
const STORY_AD_REQUIRED_IMAGE_MODEL = 'gpt-image-2';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function providerMatches(provider = {}, providerId = '') {
  const target = String(providerId || '').trim().toLowerCase();
  return [provider.id, provider.preset, provider.name]
    .filter(Boolean)
    .some(v => String(v).trim().toLowerCase() === target);
}

function imageUseMatches(model = {}) {
  return ['image', 'img', 'avatar'].includes(String(model.use || model.type || '').toLowerCase());
}

function adapterFamily(provider = {}) {
  return String(provider.adapter_config?.family || provider.adapter || provider.preset || provider.id || 'openai-compatible').toLowerCase();
}

function imageConfigStage(stage = '') {
  return String(stage || '').trim();
}

function stageCandidates(stage) {
  const configStage = imageConfigStage(stage);
  if (configStage.startsWith('new_story_ad.') && !pipeline.getStageMeta(configStage)) {
    const error = new Error(`${configStage} 尚未登记到模型调用管理，已在图片供应商调用前停止`);
    error.code = 'MODEL_STAGE_NOT_REGISTERED';
    error.status = 409;
    error.retryable = false;
    throw error;
  }
  const configured = pipeline.pickAllEnabled(configStage);
  const defaults = (pipeline.getStageDefaults(configStage) || []).filter(x => x.enabled !== false);
  return pipeline.hasStageConfig(configStage) ? configured : defaults;
}

function modelKey(model = {}) {
  return `${String(model.provider_id || model.providerId || '').trim()}/${String(model.model_id || model.model || '').trim()}`;
}

function requiredImageModelForStage(stage = '') {
  return String(stage || '').startsWith('new_story_ad.') ? STORY_AD_REQUIRED_IMAGE_MODEL : '';
}

function applyImageModelPolicy(stage = '', candidates = []) {
  const requiredModel = requiredImageModelForStage(stage);
  const list = Array.isArray(candidates) ? candidates : [];
  return requiredModel ? list.filter(model => preferredMatches(model, requiredModel)) : list;
}

function selectImageCandidates(stage = '', requested = 'auto', candidates = []) {
  const policyCandidates = applyImageModelPolicy(stage, candidates);
  const requiredModel = requiredImageModelForStage(stage);
  const requestedValue = String(requested || '').trim();
  const explicit = requestedValue && requestedValue.toLowerCase() !== 'auto';
  const preferred = explicit ? requestedValue : requiredModel;
  const preferredCandidates = preferred
    ? policyCandidates.filter(model => preferredMatches(model, preferred))
    : policyCandidates;
  const exactRouteRequested = explicit && requestedValue.includes('/');
  return {
    requiredModel,
    requested: requestedValue,
    preferred,
    preferredCandidates,
    candidates: policyCandidates,
    candidatePool: exactRouteRequested
      ? preferredCandidates
      : (preferredCandidates.length ? preferredCandidates : policyCandidates),
    exactRouteRequested,
  };
}

function availableImageCandidates(stage) {
  return applyImageModelPolicy(stage, stageCandidates(stage))
    .filter(model => !modelGateway.healthState(model).circuit_open)
    .filter(model => {
      try { resolveImageAdapter(model); return true; } catch { return false; }
    });
}

function imageCandidateAvailability(candidatePool = [], limit = IMAGE_MAX_CANDIDATES) {
  const rows = (Array.isArray(candidatePool) ? candidatePool : []).map(model => ({
    model,
    health: modelGateway.healthState(model),
  }));
  const available = rows.filter(row => !row.health.circuit_open).map(row => row.model).slice(0, limit);
  const cooldowns = rows.map(row => Number(row.health.cooldown_remaining_ms || 0)).filter(value => value > 0);
  return {
    available,
    configured_count: rows.length,
    circuit_open_count: rows.filter(row => row.health.circuit_open).length,
    retry_after_ms: cooldowns.length ? Math.min(...cooldowns) : 0,
    blocked_until_config_change: rows.length > 0 && rows.every(row => row.health.blocked_until_config_change === true),
  };
}

function preferredMatches(model = {}, preferred = '') {
  const raw = String(preferred || '').trim().toLowerCase();
  if (!raw || raw === 'auto') return true;
  const providerId = String(model.provider_id || model.providerId || '').trim().toLowerCase();
  const modelId = String(model.model_id || model.model || '').trim().toLowerCase();
  return raw === providerId || raw === modelId || raw === `${providerId}/${modelId}`;
}

function resolveImageAdapter(model = {}) {
  const providerId = String(model.provider_id || model.providerId || '').trim();
  const modelId = String(model.model_id || model.model || '').trim();
  if (!providerId || !modelId) throw new Error('图片生成缺少供应商或模型配置。');
  const settings = loadSettings();
  const provider = (settings.providers || []).find(p => p.enabled && p.api_key && providerMatches(p, providerId));
  if (!provider) throw new Error(`图片供应商 ${providerId} 当前不可用。`);
  const providerModel = (provider.models || []).find(m => String(m.id || '').trim() === modelId && m.enabled !== false && imageUseMatches(m));
  if (!providerModel) throw new Error(`图片模型 ${providerId}/${modelId} 未启用或类型不正确。`);
  return {
    adapter: provider.adapter || provider.preset || provider.id || providerId,
    family: adapterFamily(provider),
    provider,
    providerModel,
    providerId: provider.id || providerId,
    modelId,
    apiKey: provider.api_key,
    baseURL: provider.api_url || provider.base_url || '',
  };
}

function sizeFor(config = {}, aspectRatio = '9:16') {
  const ratio = String(aspectRatio || '9:16').trim();
  const sizes = config.provider?.adapter_config?.image?.sizes || {};
  if (ratio === '16:9') return sizes.landscape || '1536x1024';
  if (ratio === '2:1') return sizes.panorama || '2048x1024';
  if (ratio === '1:1') return sizes.square || '1024x1024';
  if (ratio === '3:2') return sizes.three_two || sizes.landscape || '1536x1024';
  if (ratio === '4:3') return sizes.four_three || '1024x768';
  if (ratio === '3:4') return sizes.three_four || '768x1024';
  return sizes.portrait || '1024x1536';
}

function publicAssetUrl(filename) {
  return `/api/new-story-ad/assets/${encodeURIComponent(path.basename(filename))}`;
}

function publicBaseUrl() {
  return publicReferences.publicBaseUrl();
}

function absolutePublicImageUrl(value = '') {
  return publicReferences.absolutePublicUrl(value);
}

function localStoryAssetName(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw, 'http://local.invalid');
    const prefix = '/api/new-story-ad/assets/';
    if (!parsed.pathname.startsWith(prefix)) return '';
    return path.basename(decodeURIComponent(parsed.pathname.slice(prefix.length)));
  } catch (_) {
    return '';
  }
}

async function providerReferenceImageUrl(value = '', width = 960) {
  const absolute = absolutePublicImageUrl(value);
  const filename = localStoryAssetName(absolute);
  if (!filename) return absolute;
  await ensureAssetThumbnail(filename, width);
  const parsed = new URL(absolute);
  parsed.searchParams.set('thumb', String(Math.max(160, Math.min(960, Number(width) || 960))));
  return parsed.toString();
}

async function providerReferenceImageUrls(values = [], width = 960) {
  const prepared = await Promise.all((Array.isArray(values) ? values : [])
    .filter(Boolean)
    .slice(0, 4)
    .map(value => providerReferenceImageUrl(value, width)));
  return prepared.filter(Boolean);
}

function supportsReferenceImages(config = {}) {
  const declared = config.provider?.adapter_config?.image?.reference_images;
  if (declared === true) return true;
  const family = `${config.family || ''} ${config.adapter || ''} ${config.providerId || ''}`;
  return /deyunai|漫路/i.test(family);
}

function providerQuality(value = 'standard') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'low' || normalized === 'high') return normalized;
  return 'medium';
}

function buildOpenAiCompatibleGptImage2Request(config = {}, { prompt = '', size = '1024x1024', referenceImages = [], inputFidelity = 'high', quality = 'standard' } = {}) {
  const body = deyunaiService.buildGptImage2RequestBody({ prompt, n: 1, size, referenceImages, inputFidelity, quality: providerQuality(quality) });
  body.model = String(config.modelId || 'gpt-image-2').trim();
  body.quality = providerQuality(quality);
  const imageConfig = config.provider?.adapter_config?.image || {};
  if (imageConfig.input_fidelity === false) delete body.input_fidelity;
  const endpointPath = Array.isArray(body.images) && body.images.length
    ? (imageConfig.edit_endpoint || '/images/edits')
    : (imageConfig.generation_endpoint || '/images/generations');
  return {
    endpoint: `${String(config.baseURL || '').replace(/\/$/, '')}${endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`}`,
    body,
  };
}

function isWebangMaasConfig(config = {}) {
  return /webang-maas/i.test([config.family, config.adapter, config.providerId, config.provider?.preset, config.provider?.adapter]
    .filter(Boolean).join(' '));
}

async function buildWebangGptImage2EditForm(config = {}, { prompt = '', size = '1024x1024', referenceImages = [], quality = 'standard' } = {}) {
  const refs = (Array.isArray(referenceImages) ? referenceImages : []).filter(Boolean).slice(0, 6);
  if (!refs.length) throw new Error('微众 GPT Image 2 edits 至少需要一个参考图文件');
  const FormData = require('form-data');
  const form = new FormData();
  form.append('model', String(config.modelId || 'gpt-image-2'));
  form.append('prompt', String(prompt || '').slice(0, 32000));
  if (size) form.append('size', String(size));
  form.append('quality', providerQuality(quality));
  for (let index = 0; index < refs.length; index += 1) {
    const buffer = await imageBufferFromResult({ image_url: refs[index] });
    form.append('image[]', buffer, { filename: `reference_${index + 1}.png`, contentType: 'image/png' });
  }
  return form;
}

function buildWebangGptImage2GenerationBody(config = {}, { prompt = '', size = '1024x1024', quality = 'standard' } = {}) {
  return { model: String(config.modelId || 'gpt-image-2'), prompt: String(prompt || '').slice(0, 32000),
    n: 1, size: String(size || '1024x1024'), quality: providerQuality(quality) };
}

function normalizeCompatibleImageResponse(payload = {}) {
  const rows = Array.isArray(payload?.data) ? payload.data
    : (Array.isArray(payload?.images) ? payload.images : (Array.isArray(payload?.output) ? payload.output : []));
  return rows.map(item => typeof item === 'string' ? { url: item } : item).filter(Boolean);
}

async function notifyGenerationObserver(observer, payload) {
  if (typeof observer !== 'function') return;
  await observer(payload);
}

function createImageSubmissionTracker({ onSubmitting = null, onSubmitted = null } = {}) {
  let evidence = {
    provider_submission_state: 'not_submitted',
    billing_state: 'not_submitted',
    provider_request_id: '',
    provider_task_id: '',
  };
  return {
    evidence: () => ({ ...evidence }),
    onSubmitting: async payload => {
      evidence = { ...evidence, provider_submission_state: 'submitting', billing_state: 'unknown' };
      await notifyGenerationObserver(onSubmitting, payload);
    },
    onSubmitted: async payload => {
      const status = String(payload?.status || '').toLowerCase();
      const completed = status === 'completed';
      const rejected = status === 'rejected';
      evidence = {
        provider_submission_state: completed ? 'completed' : (rejected ? 'submission_rejected' : 'submitted'),
        billing_state: completed ? 'confirmed' : (rejected ? 'not_billed' : 'unknown'),
        provider_request_id: String(payload?.providerRequestId || payload?.provider_request_id || ''),
        provider_task_id: String(payload?.taskId || payload?.provider_task_id || ''),
      };
      await notifyGenerationObserver(onSubmitted, payload);
    },
    failure: error => {
      const current = evidence;
      if (current.provider_submission_state === 'submission_rejected' && current.billing_state === 'not_billed') return { ...current };
      return {
        provider_submission_state: String(error?.providerSubmissionState || error?.provider_submission_state
          || (current.provider_submission_state === 'submitting' ? 'submitted_unknown' : current.provider_submission_state)),
        billing_state: String(error?.billingState || error?.billing_state
          || (['submitting', 'submitted'].includes(current.provider_submission_state) ? 'unknown' : current.billing_state)),
        provider_request_id: String(error?.providerRequestId || error?.provider_request_id || current.provider_request_id || ''),
        provider_task_id: String(error?.providerTaskId || error?.provider_task_id || current.provider_task_id || ''),
      };
    },
  };
}

async function invokeOpenAiCompatibleGptImage2(config = {}, options = {}) {
  const request = buildOpenAiCompatibleGptImage2Request(config, options);
  await notifyGenerationObserver(options.onSubmitting, {
    clientRequestId: options.clientRequestId || '', status: 'submitting', submittedAt: new Date().toISOString(),
  });
  const webangEdit = isWebangMaasConfig(config) && Array.isArray(options.referenceImages) && options.referenceImages.filter(Boolean).length > 0;
  const webangImageConfig = config.provider?.adapter_config?.image || {};
  const webangForm = webangEdit ? await buildWebangGptImage2EditForm(config, options) : null;
  const endpoint = webangEdit
    ? `${String(config.baseURL || '').replace(/\/$/, '')}${String(webangImageConfig.edit_endpoint || '/images/edits').replace(/^([^/])/, '/$1')}`
    : request.endpoint;
  const generationBody = isWebangMaasConfig(config) && !webangEdit
    ? buildWebangGptImage2GenerationBody(config, options)
    : request.body;
  const response = await axios.post(endpoint, webangForm || generationBody, {
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      ...(webangForm ? webangForm.getHeaders() : { 'Content-Type': 'application/json' }),
      ...(options.clientRequestId ? { 'X-Request-ID': String(options.clientRequestId).slice(0, 100) } : {}),
    },
    timeout: options.timeoutMs,
    ...(webangForm ? { maxContentLength: 64 * 1024 * 1024, maxBodyLength: 64 * 1024 * 1024 } : {}),
    validateStatus: () => true,
    signal: options.signal,
  });
  const providerRequestId = String(response.headers?.['x-request-id'] || response.headers?.['request-id'] || response.data?.request_id || '');
  await notifyGenerationObserver(options.onSubmitted, {
    clientRequestId: options.clientRequestId || '', providerRequestId,
    status: response.status >= 400 ? 'rejected' : 'submitted', submittedAt: new Date().toISOString(),
  });
  if (response.status >= 400) {
    const error = new Error(`${config.providerId} GPT Image 2 HTTP ${response.status}: ${JSON.stringify(response.data).slice(0, 300)}`);
    error.response = response;
    error.providerRequestId = providerRequestId;
    if (response.status >= 500) error.billingState = 'unknown';
    throw error;
  }
  const data = normalizeCompatibleImageResponse(response.data);
  if (!data.length) throw new Error(`${config.providerId} GPT Image 2 未返回图片数据`);
  return { data, providerRequestId, raw: response.data };
}

function imagePromptLimit(config = {}) {
  const modelId = String(config.modelId || config.providerModel?.id || '').trim().toLowerCase();
  if (/nano-banana/.test(modelId)) return NANO_BANANA_PROMPT_LIMIT;
  if (/gpt-image-2/.test(modelId)) return 10000;
  return 6000;
}

function compactImagePrompt(prompt = '', maxLength = 6000) {
  const limit = Math.max(400, Number(maxLength) || 6000);
  const raw = String(prompt || '').replace(/\r/g, '').trim();
  if (raw.length <= limit) return raw;
  const blocks = raw.split(/\n{2,}/).map(value => value.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const priorityPattern = /mandatory correction|user scene requirement|scene layout requirement|material and lighting|interaction and camera|surface construction|task-specific|view requirement|camera|composition|advertised subject|campaign brief|final look target|originality requirement/i;
  const ordered = [
    ...blocks.slice(0, 2),
    ...blocks.filter(block => priorityPattern.test(block)),
    ...blocks,
  ].filter((block, index, list) => list.indexOf(block) === index);
  const selected = [];
  let used = 0;
  for (const block of ordered) {
    const remaining = limit - used - (selected.length ? 2 : 0);
    if (remaining <= 0) break;
    const piece = block.slice(0, remaining);
    if (!piece) continue;
    selected.push(piece);
    used += piece.length + (selected.length > 1 ? 2 : 0);
  }
  return selected.join('\n\n').slice(0, limit);
}

function isProviderSubmitAuditError(error = null) {
  if (isProviderRightsAuditError(error)) return false;
  const text = [
    error?.code,
    error?.message,
    error?.response?.data?.code,
    error?.response?.data?.reason,
    error?.response?.data?.message,
    error?.providerPayload?.code,
    error?.providerPayload?.reason,
    error?.providerPayload?.message,
  ].filter(Boolean).join(' ');
  return /AuditSubmitIllegal|submit.*illegal|content audit|审核|违规|safety|policy/i.test(text);
}

function providerErrorText(error = null) {
  return [
    error?.code,
    error?.message,
    error?.response?.data?.code,
    error?.response?.data?.reason,
    error?.response?.data?.message,
    error?.response?.data?.error,
    error?.providerPayload?.code,
    error?.providerPayload?.reason,
    error?.providerPayload?.message,
  ].filter(Boolean).join(' ');
}

function providerErrorDiagnostics(error = null) {
  const payload = error?.providerPayload && typeof error.providerPayload === 'object'
    ? error.providerPayload
    : (error?.response?.data && typeof error.response.data === 'object' ? error.response.data : {});
  const nested = payload?.error && typeof payload.error === 'object' ? payload.error : {};
  const cleanField = (value, max = 160) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
  return {
    provider_status: cleanField(error?.response?.status || payload?.status || payload?.code || ''),
    provider_reason: cleanField(payload?.reason || nested?.reason || ''),
    provider_request_id: cleanField(error?.providerRequestId || error?.provider_request_id || payload?.request_id || payload?.requestId || nested?.request_id || nested?.requestId || error?.response?.headers?.['x-request-id'] || ''),
    provider_error_code: cleanField(payload?.code || nested?.code || ''),
  };
}

function isProviderRightsAuditError(error = null) {
  return /copyright|copyrighted|infring(?:e|ement)|intellectual property|\bIP\s*(?:violation|rights|infringement)|版权|著作权|知识产权|侵权|肖像权|名人肖像|celebrity likeness|public figure likeness|trademark|商标权|角色版权/i
    .test(providerErrorText(error));
}

function classifyImageGenerationError(error = null) {
  if (error?.code === 'GENERATION_STOPPED_AFTER_BILLING_UNKNOWN') {
    return {
      code: error.code,
      retryable: false,
      terminal: true,
      message: error.message,
    };
  }
  if (isProviderRightsAuditError(error)) {
    return {
      code: 'PROVIDER_RIGHTS_AUDIT',
      retryable: false,
      terminal: true,
      message: '供应商判定输入可能涉及版权、商标、角色或人物肖像授权，已停止自动重试；请确认素材权利或改用原创内容。',
    };
  }
  if (isProviderSubmitAuditError(error)) {
    return {
      code: 'PROVIDER_CONTENT_AUDIT',
      retryable: false,
      terminal: true,
      message: '供应商内容审核未通过，已停止自动重试；请检查素材和生成要求。',
    };
  }
  const classified = modelGateway.classifyError(error);
  const providerStatus = Number(error?.response?.status
    || error?.providerPayload?.status
    || error?.providerPayload?.code
    || error?.response?.data?.status
    || error?.response?.data?.code
    || 0);
  if (classified.code === 'PROVIDER_5XX' || (providerStatus >= 500 && providerStatus < 600)) {
    const submissionState = String(error?.providerSubmissionState || error?.provider_submission_state || '').toLowerCase();
    const billingState = String(error?.billingState || error?.billing_state || '').toLowerCase();
    const safelyNotSubmitted = ['not_submitted', 'submission_rejected', 'request_not_sent'].includes(submissionState)
      && ['not_billed', 'none', 'confirmed_not_billed'].includes(billingState);
    return {
      code: safelyNotSubmitted ? 'PROVIDER_5XX_NOT_SUBMITTED' : 'PROVIDER_5XX_AMBIGUOUS',
      retryable: safelyNotSubmitted,
      terminal: !safelyNotSubmitted,
      message: safelyNotSubmitted
        ? '当前图片通道未成功提交且确认未计费，可以安全切换备用图片通道。'
        : '当前图片任务的提交或计费状态尚未确认，已停止自动切换，避免重复费用。',
    };
  }
  // Preserve the existing provider-fallback behavior for ordinary failures.
  // Only review-sensitive and ambiguous paid-call failures are terminal above.
  return { ...classified, terminal: false };
}

function rightsAwareImagePrompt(prompt = '') {
  const source = String(prompt || '').trim();
  if (!source) return '';
  // Rights are enforced before image submission by the blueprint quality gate.
  // State the positive production contract here without appending a catalogue of
  // restricted terms that a domestic gateway can misread as requested content.
  const safety = 'Originality requirement: create a task-specific visual solution from the supplied production contract and continuity evidence. Describe and preserve only observable lighting, colour, lens, material, spatial and composition attributes. Keep the result non-identifying and free of readable typography, signatures or identifying marks.';
  return source.includes('Originality requirement:') ? source : `${source}\n\n${safety}`.trim();
}

function domesticGptImage2ReviewPrompt(prompt = '') {
  let source = String(prompt || '').trim();
  if (!source) return '';
  const replacements = [
    [/少女/g, '成年女性（明确年龄20岁以上）'],
    [/少年/g, '成年男性（明确年龄20岁以上）'],
    [/(?:鲜血|血迹|血泊|血腥|喷血|染血|肢解|断肢)/g, '非血腥的戏剧性氛围'],
    [/(?:致命暗器|穿透身体|刺穿身体|开膛破肚)/g, '非血腥的突发危机'],
    [/\b(?:gore|bloody|bloodstain|blood pool|dismemberment)\b/gi, 'non-graphic dramatic atmosphere'],
    [/\b(?:deadly projectile|pierces? (?:the )?body)\b/gi, 'non-graphic sudden danger'],
  ];
  replacements.forEach(([pattern, replacement]) => { source = source.replace(pattern, replacement); });
  const reviewContract = 'Domestic image review contract: if people appear, depict only clearly identifiable adults aged 20 or older in natural poses. Keep all action non-graphic, with no visible blood, wounds, self-harm or weapon impact. Use only original generic visual design; do not reproduce celebrity likenesses, copyrighted characters, brand logos, readable marks, watermarks or CAPTCHA-like text.';
  return source.includes('Domestic image review contract:') ? source : `${source}\n\n${reviewContract}`.trim();
}

function promptForImageCandidate(prompt = '', config = {}, auditSafePrompt = '', forceAuditSafe = false) {
  const limit = imagePromptLimit(config);
  const primary = String(prompt || '').trim();
  const alternative = String(auditSafePrompt || '').trim();
  const source = forceAuditSafe && alternative
    ? alternative
    : (primary.length > limit && alternative ? alternative : primary);
  const governed = /gpt-image-2/i.test(String(config.modelId || config.model_id || ''))
    ? domesticGptImage2ReviewPrompt(source)
    : source;
  return compactImagePrompt(governed, limit);
}

function shouldStopImageFallback({ billingUnknown = false, classified = {}, providerTaskId = '', providerRequestId = '' } = {}) {
  if (classified?.code === 'PROVIDER_5XX_AMBIGUOUS'
    && !String(providerTaskId || '').trim()
    && !String(providerRequestId || '').trim()) return false;
  if (billingUnknown) return true;
  // 明确未计费的内容审核拒绝允许切换到下一条已配置图片路由；
  // 版权审核及其它终止错误仍然立即停止。
  return classified?.terminal === true && classified?.code !== 'PROVIDER_CONTENT_AUDIT';
}

function normalizeHandlelessSynchronous5xx({ classified = {}, providerTaskId = '', providerRequestId = '', submission = '', billing = '' } = {}) {
  const handleless = !String(providerTaskId || '').trim() && !String(providerRequestId || '').trim();
  if (classified?.code !== 'PROVIDER_5XX_AMBIGUOUS' || !handleless) {
    return { classified, submission, billing, normalized: false };
  }
  return {
    classified: {
      ...classified,
      code: 'PROVIDER_5XX_NOT_SUBMITTED',
      retryable: true,
      terminal: false,
      message: '供应商同步返回 HTTP 500，且未返回任务号、请求号或结果；该候选已确认失败且按未计费结束，可以切换备用通道。',
    },
    submission: 'submission_rejected',
    billing: 'not_billed',
    normalized: true,
  };
}

async function invokeWithAuditSafeRetry(invoke, candidatePrompt = '', retryPrompt = '', onAudit = null) {
  try {
    return await invoke(candidatePrompt);
  } catch (firstError) {
    if (!isProviderSubmitAuditError(firstError) || !retryPrompt || retryPrompt === candidatePrompt) throw firstError;
    if (typeof onAudit === 'function') onAudit(firstError);
    return invoke(retryPrompt);
  }
}

function assetPathFromName(filename = '') {
  const safe = path.basename(String(filename || '').split('?')[0]);
  if (!safe) return '';
  return path.join(ASSET_DIR, safe);
}

function assetThumbPathFromName(filename = '', width = 520) {
  const safe = path.basename(String(filename || '').split('?')[0]).replace(/[^a-z0-9_.-]/ig, '_');
  if (!safe) return '';
  const size = Math.max(160, Math.min(960, Number(width) || 520));
  return path.join(THUMB_DIR, `${safe}.${size}.webp`);
}

async function ensureAssetThumbnail(filename = '', width = 520) {
  const source = assetPathFromName(filename);
  if (!source || !fs.existsSync(source)) {
    const err = new Error('Asset not found');
    err.status = 404;
    throw err;
  }
  const out = assetThumbPathFromName(filename, width);
  if (out && fs.existsSync(out)) {
    const stat = fs.statSync(out);
    if (stat.isFile()) return out;
    fs.rmSync(out, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await sharp(source)
    .rotate()
    .resize({
      width: Math.max(160, Math.min(960, Number(width) || 520)),
      withoutEnlargement: true,
    })
    .webp({ quality: 72, effort: 4 })
    .toFile(out);
  return out;
}

function safeFilename(name = 'new_story_ad_asset', ext = '.png') {
  const base = String(name || 'new_story_ad_asset').replace(/[^a-z0-9_-]/ig, '_').slice(0, 96) || 'new_story_ad_asset';
  return `${base}${ext}`;
}

function writeBase64Asset(base64, filename) {
  ensureDir(ASSET_DIR);
  const clean = String(base64 || '').replace(/^data:image\/\w+;base64,/, '');
  const out = path.join(ASSET_DIR, filename);
  fs.writeFileSync(out, Buffer.from(clean, 'base64'));
  return out;
}

async function imageBufferFromResult(result = {}) {
  if (result.filePath && fs.existsSync(result.filePath)) return fs.readFileSync(result.filePath);
  const value = String(result.image_url || result.imageUrl || result.url || '').trim();
  if (!value) throw new Error('图片生成结果没有可读取的地址。');
  if (value.startsWith('/api/new-story-ad/assets/')) {
    const filePath = assetPathFromName(decodeURIComponent(value.split('/').pop() || ''));
    if (filePath && fs.existsSync(filePath)) return fs.readFileSync(filePath);
  }
  if (/^https?:\/\//i.test(value)) {
    const readiness = await assetUrlReadiness.probe(value, { timeoutMs: 120000, signal: cancellation.signal() });
    if (readiness.state !== 'ready') throw assetUrlReadiness.readinessError(readiness);
    return Buffer.from(readiness.data);
  }
  throw new Error(`当前图片地址不支持本地处理：${value.slice(0, 120)}`);
}

async function persistImageResult({ result = {}, filename = '', thumbnailWidths = [] } = {}) {
  const currentUrl = String(result.image_url || result.imageUrl || result.url || '').trim();
  if (currentUrl.startsWith('/api/new-story-ad/assets/')) {
    const localName = decodeURIComponent(currentUrl.split('/').pop()?.split('?')[0] || '');
    await Promise.all((thumbnailWidths || []).map(width => ensureAssetThumbnail(localName, width)));
    return { ...result, filename: result.filename || localName, image_url: currentUrl, url: currentUrl, remote: false };
  }
  const buffer = await imageBufferFromResult(result);
  const safe = safeFilename(filename || `new_story_ad_asset_${Date.now()}`, '.png');
  const filePath = path.join(ASSET_DIR, safe);
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  ensureDir(ASSET_DIR);
  try {
    await sharp(buffer).rotate().png({ compressionLevel: 8 }).toFile(tempPath);
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try { if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true }); } catch (_) {}
    throw error;
  }
  await Promise.all((thumbnailWidths || []).map(width => ensureAssetThumbnail(safe, width)));
  const localUrl = publicAssetUrl(safe);
  return {
    ...result,
    source_url: currentUrl,
    filePath,
    filename: safe,
    image_url: localUrl,
    url: localUrl,
    remote: false,
  };
}

async function splitActorSheet({ source = {}, filenamePrefix = 'new_story_actor_sheet', viewKeys = ['front', 'side', 'back', 'action'] } = {}) {
  return splitReferenceSheet({
    source,
    filenamePrefix,
    viewKeys,
    outputWidth: 768,
    outputHeight: 1024,
    fit: 'contain',
    background: { r: 242, g: 244, b: 247, alpha: 1 },
  });
}

async function splitReferenceSheet({
  source = {},
  filenamePrefix = 'new_story_reference_sheet',
  filenameSuffix = '',
  viewKeys = ['view_1', 'view_2', 'view_3', 'view_4'],
  columns = 2,
  rows = 2,
  outputWidth = 1024,
  outputHeight = 576,
  fit = 'cover',
  background = { r: 5, g: 7, b: 11, alpha: 1 },
} = {}) {
  const input = await imageBufferFromResult(source);
  const normalized = await sharp(input).rotate().png().toBuffer();
  const meta = await sharp(normalized).metadata();
  const fullW = Number(meta.width || 0);
  const fullH = Number(meta.height || 0);
  if (fullW < 400 || fullH < 400) throw new Error(`演员设定图尺寸过小：${fullW}x${fullH}。`);
  const gridColumns = Math.max(1, Math.min(6, Number(columns) || 2));
  const gridRows = Math.max(1, Math.min(6, Number(rows) || 2));
  if (viewKeys.length > gridColumns * gridRows) {
    throw new Error(`图集网格 ${gridColumns}x${gridRows} 无法容纳 ${viewKeys.length} 个原子视图。`);
  }
  const rects = viewKeys.map((_, index) => {
    const column = index % gridColumns;
    const row = Math.floor(index / gridColumns);
    const left = Math.floor((fullW * column) / gridColumns);
    const top = Math.floor((fullH * row) / gridRows);
    const right = Math.floor((fullW * (column + 1)) / gridColumns);
    const bottom = Math.floor((fullH * (row + 1)) / gridRows);
    return { left, top, width: right - left, height: bottom - top };
  });
  ensureDir(ASSET_DIR);
  const views = [];
  for (let i = 0; i < rects.length; i += 1) {
    const key = viewKeys[i] || `view_${i + 1}`;
    const stableSuffix = String(filenameSuffix || '').replace(/[^a-z0-9_-]/ig, '').slice(0, 32);
    const safe = safeFilename(`${filenamePrefix}_${key}_${stableSuffix || Date.now()}_${i + 1}`, '.png');
    const out = path.join(ASSET_DIR, safe);
    await sharp(normalized)
      .extract(rects[i])
      .resize(outputWidth, outputHeight, { fit, background })
      .png()
      .toFile(out);
    views.push({
      key,
      label: key,
      url: publicAssetUrl(safe),
      image_url: publicAssetUrl(safe),
      filename: safe,
      filePath: out,
      provider_used: source.provider_used || '',
    });
  }
  await Promise.all(views.flatMap(view => [320, 360, 480, 560].map(width => ensureAssetThumbnail(view.filename, width))));
  return views;
}

function writeMockSvg(filename, prompt = '') {
  ensureDir(ASSET_DIR);
  const safe = safeFilename(filename, '.svg');
  const out = path.join(ASSET_DIR, safe);
  const text = String(prompt || 'New Story Ad').replace(/[<>&]/g, '').slice(0, 160);
  fs.writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280"><rect width="100%" height="100%" fill="#111827"/><text x="48" y="96" fill="#f9fafb" font-size="38" font-family="Arial">New Story Ad</text><text x="48" y="160" fill="#9ca3af" font-size="24" font-family="Arial">${text}</text></svg>`, 'utf8');
  return { filePath: out, filename: safe, image_url: publicAssetUrl(safe), provider_used: 'mock/new-story-ad-image' };
}

async function generateImage({
  taskId = '',
  stage = 'new_story_ad.keyframe',
  prompt = '',
  filename = '',
  aspectRatio = '9:16',
  resolution = '2K',
  quality = 'standard',
  imageModel = 'auto',
  referenceImages = [],
  requireReferences = false,
  inputFidelity = 'high',
  auditSafePrompt = '',
  singleAttempt = false,
  clientRequestId = '',
  shotIndex = null,
  generationId = '',
  onSubmitting = null,
  onSubmitted = null,
  onProgress = null,
  timeoutMs = Number(process.env.NEW_STORY_AD_IMAGE_TIMEOUT_MS) || (5 * 60 * 1000),
} = {}) {
  if (process.env.NEW_STORY_AD_MOCK_IMAGE === '1') return writeMockSvg(filename || `${stage}_${Date.now()}`, prompt);
  const requestedPreferred = String(imageModel || '').trim();
  const selection = selectImageCandidates(stage, requestedPreferred, stageCandidates(stage));
  const { candidates, requiredModel, preferred, preferredCandidates, candidatePool, exactRouteRequested } = selection;
  const availability = imageCandidateAvailability(candidatePool, singleAttempt ? 1 : IMAGE_MAX_CANDIDATES);
  const filtered = availability.available;
  const candidateSummary = candidates.map(modelKey).filter(Boolean).join(', ');
  const errors = [];
  const effectiveGenerationId = String(generationId || cancellation.current()?.generationId || taskId || '').slice(0, 120);
  if (String(stage || '').startsWith('new_story_ad.')) {
    console.info('[new_story_ad:image_candidates]', JSON.stringify({
      stage,
      requested_image_model: requestedPreferred || 'auto',
      enforced_image_model: requiredModel || '',
      image_model: preferred || 'auto',
      preferred_matched: preferredCandidates.map(modelKey).filter(Boolean),
      exact_route_requested: exactRouteRequested,
      candidates: candidates.map(modelKey).filter(Boolean),
    }));
  }
  if (!filtered.length) {
    const coolingDown = availability.retry_after_ms > 0;
    const retrySeconds = Math.max(1, Math.ceil(availability.retry_after_ms / 1000));
    const error = new Error(coolingDown
      ? `${requiredModel || '图片模型'}刚发生超时或供应商故障，系统已暂停该通道约 ${retrySeconds} 秒以避免连续提交和重复费用；本次没有发起新的图片调用，已成功资产继续保留。`
      : (requiredModel
        ? `剧情广告图片只允许使用 ${requiredModel}，但当前配置没有可执行通道；本次没有发起新的图片调用，也不会回退到未经确认的图片模型。`
        : `new_story_ad image models unavailable for ${stage}: no enabled candidate`));
    error.code = coolingDown ? 'IMAGE_CIRCUIT_OPEN' : (requiredModel ? 'NEW_STORY_AD_IMAGE2_UNAVAILABLE' : 'IMAGE_MODEL_UNAVAILABLE');
    error.retryable = true;
    error.retryAfterMs = availability.retry_after_ms;
    error.modelAvailability = availability;
    throw error;
  }
  for (let candidateIndex = 0; candidateIndex < filtered.length; candidateIndex += 1) {
    cancellation.throwIfCancelled(taskId);
    const model = filtered[candidateIndex];
    const startedAt = Date.now();
    let config = null;
    const submissionTracker = createImageSubmissionTracker({ onSubmitting, onSubmitted });
    const observeSubmitting = submissionTracker.onSubmitting;
    const observeSubmitted = submissionTracker.onSubmitted;
    try {
      config = resolveImageAdapter(model);
      if (!/(openai|compatible|apismile|webang|deyunai|bridgellm)/i.test(config.family + ' ' + config.adapter)) {
        throw new Error(`当前图片适配方式 ${config.adapter} 尚未实现。`);
      }
      // Providers fetch reference URLs on a short timeout. Generated master PNGs can
      // exceed 2 MB, so publish the existing 960px WebP derivative instead of the raw
      // asset. External references are kept unchanged.
      const references = await providerReferenceImageUrls(referenceImages, 960);
      const referenceCapable = supportsReferenceImages(config);
      if (requireReferences && (!references.length || !referenceCapable)) {
        const reason = !references.length ? '没有可访问的公网参考图' : '模型适配器未声明参考图能力';
        const error = new Error(`${config.providerId}/${config.modelId} 无法执行严格参考图生成：${reason}`);
        error.code = 'REFERENCE_IMAGE_UNSUPPORTED';
        error.retryable = false;
        throw error;
      }
      // DeyunAI/漫路 image APIs have provider-specific streaming/async response
      // formats. Always use the dedicated adapter, including text-to-image calls
      // without reference images; the generic OpenAI image client cannot decode
      // those responses reliably.
      if (/deyunai|漫路/i.test(`${config.family} ${config.adapter} ${config.providerId}`)) {
        const invokeDeyunai = candidatePrompt => generationBillingGuard.run(
          {
            taskId,
            generationId: effectiveGenerationId,
            unitKey: clientRequestId || `${stage}:${shotIndex}:${filename}`,
            providerId: config.providerId,
            failureClass: 'paid_image_generation',
          },
          () => generationConcurrency.schedule(
            'new_story_ad.image_provider',
            Number(process.env.NEW_STORY_AD_IMAGE_PROVIDER_CONCURRENCY) || 2,
            () => deyunaiService.generateImage({
          model: config.modelId,
          prompt: candidatePrompt,
          n: 1,
          size: sizeFor(config, aspectRatio),
          aspectRatio,
          referenceImages: referenceCapable ? references : [],
          inputFidelity,
          quality: providerQuality(quality),
          signal: cancellation.signal(),
          clientRequestId,
          onSubmitting: observeSubmitting,
          onSubmitted: observeSubmitted,
          onProgress,
            timeoutMs: Math.max(30000, Math.min(10 * 60 * 1000, Number(timeoutMs) || (5 * 60 * 1000))),
            }),
          ),
        );
        const governedPrompt = String(stage || '').startsWith('new_story_ad.') ? rightsAwareImagePrompt(prompt) : prompt;
        const governedAuditPrompt = String(stage || '').startsWith('new_story_ad.') ? rightsAwareImagePrompt(auditSafePrompt) : auditSafePrompt;
        const candidatePrompt = promptForImageCandidate(governedPrompt, config, governedAuditPrompt);
        const retryPrompt = promptForImageCandidate(governedPrompt, config, governedAuditPrompt, true);
        const generated = singleAttempt
          ? await invokeDeyunai(candidatePrompt)
          : await invokeWithAuditSafeRetry(invokeDeyunai, candidatePrompt, retryPrompt, firstError => {
          storage.saveModelCall({
            task_id: taskId,
            stage,
            provider_id: model.provider_id,
            model_id: model.model_id,
            status: 'failed',
            error_code: 'PROVIDER_CONTENT_AUDIT',
            error_message: String(firstError.message || firstError).slice(0, 500),
            latency_ms: Date.now() - startedAt,
            fallback_rank: candidateIndex + 1,
          });
          });
        cancellation.throwIfCancelled(taskId);
        const url = Array.isArray(generated?.urls) ? generated.urls.find(Boolean) : '';
        if (!url) throw new Error('漫路图片生成未返回图片 URL');
        const payload = {
          image_url: url,
          url,
          provider_used: `${config.providerId}/${config.modelId}`,
          adapter: config.adapter,
          family: config.family,
          remote: true,
          reference_count: references.length,
          reference_preserving: references.length > 0,
          provider_request_id: generated.providerRequestId || '',
          provider_task_id: generated.taskId || '',
          submission_id: clientRequestId || '',
        };
        const stablePayload = await persistImageResult({
          result: payload,
          filename: filename || `${stage}_${Date.now()}`,
          thumbnailWidths: [520, 640],
        });
        modelGateway.recordHealth(model, { ok: true, latencyMs: Date.now() - startedAt });
        storage.saveModelCall({
          task_id: taskId, stage, provider_id: model.provider_id, model_id: model.model_id,
          status: 'success', latency_ms: Date.now() - startedAt, fallback_rank: candidateIndex + 1,
          shot_index: shotIndex, generation_id: generationId, submission_id: clientRequestId,
          provider_task_id: generated.taskId || '', provider_request_id: generated.providerRequestId || '',
          provider_submission_state: 'completed', billing_state: 'confirmed',
        });
        return stablePayload;
      }
      const genericPrompt = promptForImageCandidate(
        String(stage || '').startsWith('new_story_ad.') ? rightsAwareImagePrompt(prompt) : prompt,
        config,
        String(stage || '').startsWith('new_story_ad.') ? rightsAwareImagePrompt(auditSafePrompt) : auditSafePrompt,
      );
      const compatibleImage2 = /gpt-image-2/i.test(config.modelId) && /openai-compatible|webang-maas/i.test(config.family);
      const client = compatibleImage2 ? null : new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL || undefined });
      const response = await generationBillingGuard.run(
        {
          taskId,
          generationId: effectiveGenerationId,
          unitKey: clientRequestId || `${stage}:${shotIndex}:${filename}`,
          providerId: config.providerId,
          failureClass: 'paid_image_generation',
        },
        () => generationConcurrency.schedule(
          'new_story_ad.image_provider',
          Number(process.env.NEW_STORY_AD_IMAGE_PROVIDER_CONCURRENCY) || 2,
          () => compatibleImage2
            ? invokeOpenAiCompatibleGptImage2(config, {
              prompt: genericPrompt,
              size: sizeFor(config, aspectRatio),
              referenceImages: referenceCapable ? references : [],
              inputFidelity,
              quality,
              signal: cancellation.signal(),
              clientRequestId,
              onSubmitting: observeSubmitting,
              onSubmitted: observeSubmitted,
              timeoutMs: Math.max(30000, Math.min(10 * 60 * 1000, Number(timeoutMs) || (5 * 60 * 1000))),
            })
            : (async () => {
              await observeSubmitting({
                clientRequestId, status: 'submitting', submittedAt: new Date().toISOString(),
              });
              const generated = await client.images.generate({
                model: config.modelId,
                prompt: genericPrompt,
                size: sizeFor(config, aspectRatio),
                n: 1,
                quality: providerQuality(quality),
              }, { signal: cancellation.signal() });
              await observeSubmitted({
                clientRequestId, providerRequestId: String(generated?._request_id || ''),
                status: 'completed', submittedAt: new Date().toISOString(),
              });
              return generated;
            })(),
        ),
      );
      cancellation.throwIfCancelled(taskId);
      const first = Array.isArray(response?.data) ? response.data[0] : null;
      const submissionEvidence = submissionTracker.evidence();
      if (first?.url) {
        const payload = {
          image_url: first.url,
          url: first.url,
          provider_used: `${config.providerId}/${config.modelId}`,
          adapter: config.adapter,
          family: config.family,
          remote: true,
          reference_count: references.length,
          reference_preserving: references.length > 0,
          provider_request_id: response.providerRequestId || '',
        };
        const stablePayload = await persistImageResult({
          result: payload,
          filename: filename || `${stage}_${Date.now()}`,
          thumbnailWidths: [520, 640],
        });
        modelGateway.recordHealth(model, { ok: true, latencyMs: Date.now() - startedAt });
        storage.saveModelCall({
          task_id: taskId, stage, provider_id: model.provider_id, model_id: model.model_id,
          status: 'success', latency_ms: Date.now() - startedAt, fallback_rank: candidateIndex + 1,
          shot_index: shotIndex, generation_id: generationId, submission_id: clientRequestId,
          provider_request_id: submissionEvidence.provider_request_id || response.providerRequestId || '',
          provider_task_id: submissionEvidence.provider_task_id,
          provider_submission_state: 'completed', billing_state: 'confirmed',
        });
        return stablePayload;
      }
      if (first?.b64_json) {
        const safe = safeFilename(filename || `${stage}_${Date.now()}`, '.png');
        const filePath = writeBase64Asset(first.b64_json, safe);
        const payload = {
          filePath,
          filename: safe,
          image_url: publicAssetUrl(safe),
          url: publicAssetUrl(safe),
          provider_used: `${config.providerId}/${config.modelId}`,
          adapter: config.adapter,
          family: config.family,
          resolution,
          reference_count: references.length,
          reference_preserving: references.length > 0,
          provider_request_id: response.providerRequestId || '',
        };
        modelGateway.recordHealth(model, { ok: true, latencyMs: Date.now() - startedAt });
        storage.saveModelCall({
          task_id: taskId, stage, provider_id: model.provider_id, model_id: model.model_id,
          status: 'success', latency_ms: Date.now() - startedAt, fallback_rank: candidateIndex + 1,
          shot_index: shotIndex, generation_id: generationId, submission_id: clientRequestId,
          provider_request_id: submissionEvidence.provider_request_id || response.providerRequestId || '',
          provider_task_id: submissionEvidence.provider_task_id,
          provider_submission_state: 'completed', billing_state: 'confirmed',
        });
        return payload;
      }
      throw new Error('图片供应商没有返回图片地址或图片数据。');
    } catch (err) {
      if (cancellation.signal()?.aborted) cancellation.throwIfCancelled(taskId);
      let classified = classifyImageGenerationError(err);
      const providerDiagnostics = providerErrorDiagnostics(err);
      const submissionEvidence = submissionTracker.failure(err);
      const providerTaskId = err.providerTaskId || err.provider_task_id || submissionEvidence.provider_task_id || '';
      const providerRequestId = err.providerRequestId || err.provider_request_id || submissionEvidence.provider_request_id || '';
      const normalizedFailure = normalizeHandlelessSynchronous5xx({
        classified,
        providerTaskId,
        providerRequestId,
        submission: submissionEvidence.provider_submission_state,
        billing: submissionEvidence.billing_state,
      });
      classified = normalizedFailure.classified;
      const evidenceSubmission = normalizedFailure.submission;
      const evidenceBilling = normalizedFailure.billing;
      const billingUnknown = evidenceBilling === 'unknown';
      if (err.code !== 'REFERENCE_IMAGE_UNSUPPORTED' && !['PROVIDER_RIGHTS_AUDIT', 'PROVIDER_CONTENT_AUDIT'].includes(classified.code)) {
        const healthError = classified.code === 'PROVIDER_5XX_AMBIGUOUS'
          ? Object.assign(new Error(classified.message || err.message), { code: 'PROVIDER_5XX' })
          : err;
        modelGateway.recordHealth(model, { ok: false, error: healthError, latencyMs: Date.now() - startedAt });
      }
      storage.saveModelCall({
        task_id: taskId,
        stage,
        provider_id: model.provider_id,
        model_id: model.model_id,
        status: 'failed',
        error_code: classified.code || err.code,
        error_message: String(classified.message || err.message || err).slice(0, 500),
        ...providerDiagnostics,
        shot_index: shotIndex,
        generation_id: generationId,
        submission_id: clientRequestId,
        provider_task_id: providerTaskId,
        provider_request_id: providerRequestId,
        provider_submission_state: evidenceSubmission,
        billing_state: evidenceBilling,
        latency_ms: Date.now() - startedAt,
        fallback_rank: candidateIndex + 1,
      });
      errors.push({
        model: modelKey(model),
        code: classified.code || err.code,
        retryable: classified.retryable === true,
        message: String(classified.message || err.message || err).slice(0, 240),
        ...providerDiagnostics,
        provider_task_id: providerTaskId,
        provider_request_id: providerRequestId,
        provider_submission_state: evidenceSubmission,
        billing_state: evidenceBilling,
      });
      if (shouldStopImageFallback({
        billingUnknown,
        classified,
        providerTaskId,
        providerRequestId,
      })) break;
    }
  }
  const ignoredPreferred = preferred && preferred !== 'auto' && !preferredCandidates.length
    ? `；ignored preferred=${preferred} because it is not enabled for ${stage}`
    : '';
  const uncertainAttempt = errors.find(item => item.billing_state === 'unknown'
    || item.provider_submission_state === 'submitted_unknown'
    || item.code === 'PROVIDER_5XX_AMBIGUOUS');
  const error = new Error(uncertainAttempt
    ? '当前图片任务已停止；已生成资产均已保留。提交或计费状态需要管理员核对，确认前不能安全重试。'
    : `图片生成未完成；已生成资产均已保留。${errors.some(item => item.retryable) ? '可以稍后安全重试。' : '请修改生成要求或联系管理员核对。'}`);
  error.code = errors.some(item => item.retryable) ? 'IMAGE_ATTEMPTS_EXHAUSTED' : (errors[0]?.code || 'IMAGE_MODEL_UNAVAILABLE');
  error.retryable = errors.some(item => item.retryable);
  error.attempts = errors;
  const uncertain = errors.find(item => item.billing_state === 'unknown' || item.provider_submission_state === 'submitted_unknown' || item.code === 'PROVIDER_5XX_AMBIGUOUS');
  if (uncertain) {
    error.billingState = 'unknown';
    error.providerSubmissionState = uncertain.provider_submission_state || 'submitted_unknown';
    error.providerRequestId = uncertain.provider_request_id || '';
    error.providerTaskId = uncertain.provider_task_id || '';
  }
  error.generationId = String(generationId || '').slice(0, 100);
  error.submissionId = String(clientRequestId || '').slice(0, 100);
  throw error;
}

  async function generateActorReference({
  taskId = '',
  prompt = '',
  filename = '',
  aspectRatio = '3:4',
    imageModel = 'auto',
    resolution = '2K',
    quality = 'standard',
  referenceImages = [],
  requireReferences = false,
  inputFidelity = 'high',
  stage = 'new_story_ad.person_sheet',
  clientRequestId = '',
  onSubmitting = null,
  onSubmitted = null,
  onProgress = null,
} = {}) {
  return generateImage({
    taskId,
    stage,
    prompt,
    filename: filename || `new_story_actor_${Date.now()}`,
    aspectRatio,
      imageModel,
      resolution,
      quality,
    referenceImages,
    requireReferences,
    inputFidelity,
    clientRequestId,
    onSubmitting,
    onSubmitted,
    onProgress,
  });
}

module.exports = {
  ASSET_DIR,
  THUMB_DIR,
  safeFilename,
  assetPathFromName,
  assetThumbPathFromName,
  ensureAssetThumbnail,
  publicAssetUrl,
  absolutePublicImageUrl,
  localStoryAssetName,
  providerReferenceImageUrl,
  providerReferenceImageUrls,
  persistImageResult,
  supportsReferenceImages,
  imagePromptLimit,
  compactImagePrompt,
  isProviderSubmitAuditError,
  isProviderRightsAuditError,
  classifyImageGenerationError,
  providerErrorDiagnostics,
  rightsAwareImagePrompt,
  domesticGptImage2ReviewPrompt,
  buildOpenAiCompatibleGptImage2Request,
  buildWebangGptImage2EditForm,
  buildWebangGptImage2GenerationBody,
  isWebangMaasConfig,
  normalizeCompatibleImageResponse,
  createImageSubmissionTracker,
  sizeFor,
  promptForImageCandidate,
  imageConfigStage,
  requiredImageModelForStage,
  applyImageModelPolicy,
  selectImageCandidates,
  invokeWithAuditSafeRetry,
  shouldStopImageFallback,
  normalizeHandlelessSynchronous5xx,
  availableImageCandidates,
  imageCandidateAvailability,
  generateImage,
  generateActorReference,
  splitActorSheet,
  splitReferenceSheet,
};
