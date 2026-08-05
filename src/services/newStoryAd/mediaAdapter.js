require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');
const OpenAI = require('openai');
const pipeline = require('../pipelineModelService');
const { loadSettings } = require('../settingsService');
const deyunaiService = require('../deyunaiService');
const modelGateway = require('./modelGateway');
const generationConcurrency = require('./generationConcurrencyService');
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
  const stageId = String(stage || '').trim();
  if (/^new_story_ad\.person_dossier(?:_|$)/.test(stageId)) return 'new_story_ad.person_sheet';
  if (/^new_story_ad\.prop_dossier(?:_|$)/.test(stageId)) return 'new_story_ad.scene_asset';
  return stageId;
}

function stageCandidates(stage) {
  const configStage = imageConfigStage(stage);
  const configured = pipeline.pickAllEnabled(configStage);
  const defaults = (pipeline.getStageDefaults(configStage) || []).filter(x => x.enabled !== false);
  return configured.length ? configured : defaults;
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

function availableImageCandidates(stage) {
  return applyImageModelPolicy(stage, stageCandidates(stage))
    .filter(model => !modelGateway.healthState(model).circuit_open)
    .filter(model => {
      try { resolveImageAdapter(model); return true; } catch { return false; }
    });
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

function supportsReferenceImages(config = {}) {
  const declared = config.provider?.adapter_config?.image?.reference_images;
  if (declared === true) return true;
  const family = `${config.family || ''} ${config.adapter || ''} ${config.providerId || ''}`;
  return /deyunai|漫路/i.test(family);
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
    return {
      code: 'PROVIDER_5XX_AMBIGUOUS',
      retryable: false,
      terminal: true,
      message: '供应商返回未分类 5xx，内部错误码没有公开定义；目前无法确认是审核拦截还是服务故障，已停止自动付费重试。',
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

function promptForImageCandidate(prompt = '', config = {}, auditSafePrompt = '', forceAuditSafe = false) {
  const limit = imagePromptLimit(config);
  const primary = String(prompt || '').trim();
  const alternative = String(auditSafePrompt || '').trim();
  const source = forceAuditSafe && alternative
    ? alternative
    : (primary.length > limit && alternative ? alternative : primary);
  return compactImagePrompt(source, limit);
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
    const response = await axios.get(value, { responseType: 'arraybuffer', timeout: 120000, signal: cancellation.signal() });
    return Buffer.from(response.data);
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
  const candidates = applyImageModelPolicy(stage, stageCandidates(stage));
  const requestedPreferred = String(imageModel || '').trim();
  const requiredModel = requiredImageModelForStage(stage);
  const preferred = requiredModel || requestedPreferred;
  const preferredCandidates = preferred && preferred !== 'auto'
    ? candidates.filter(m => preferredMatches(m, preferred))
    : candidates;
  const candidatePool = requiredModel
    ? preferredCandidates
    : (preferredCandidates.length ? preferredCandidates : candidates);
  const filtered = candidatePool
    .filter(model => !modelGateway.healthState(model).circuit_open)
    .slice(0, singleAttempt ? 1 : IMAGE_MAX_CANDIDATES);
  const candidateSummary = candidates.map(modelKey).filter(Boolean).join(', ');
  const errors = [];
  if (String(stage || '').startsWith('new_story_ad.')) {
    console.info('[new_story_ad:image_candidates]', JSON.stringify({
      stage,
      requested_image_model: requestedPreferred || 'auto',
      enforced_image_model: requiredModel || '',
      image_model: preferred || 'auto',
      preferred_matched: preferredCandidates.map(modelKey).filter(Boolean),
      candidates: candidates.map(modelKey).filter(Boolean),
    }));
  }
  if (!filtered.length) {
    const error = new Error(requiredModel
      ? `剧情广告图片只允许使用 ${requiredModel}，但当前没有可用通道；已停止生成且不会回退其他图片模型。`
      : `new_story_ad image models unavailable for ${stage}: no enabled candidate inside the current circuit-breaker window`);
    error.code = requiredModel ? 'NEW_STORY_AD_IMAGE2_UNAVAILABLE' : 'IMAGE_CIRCUIT_OPEN';
    error.retryable = true;
    throw error;
  }
  for (let candidateIndex = 0; candidateIndex < filtered.length; candidateIndex += 1) {
    cancellation.throwIfCancelled(taskId);
    const model = filtered[candidateIndex];
    const startedAt = Date.now();
    let config = null;
    try {
      config = resolveImageAdapter(model);
      if (!/(openai|compatible|apismile|webang|deyunai|bridgellm)/i.test(config.family + ' ' + config.adapter)) {
        throw new Error(`当前图片适配方式 ${config.adapter} 尚未实现。`);
      }
      const references = (Array.isArray(referenceImages) ? referenceImages : [])
        .map(absolutePublicImageUrl)
        .filter(Boolean)
        .slice(0, 4);
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
        const invokeDeyunai = candidatePrompt => generationConcurrency.schedule(
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
          signal: cancellation.signal(),
          clientRequestId,
          onSubmitting,
          onSubmitted,
          onProgress,
            timeoutMs: Math.max(30000, Math.min(10 * 60 * 1000, Number(timeoutMs) || (5 * 60 * 1000))),
          }),
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
      const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL || undefined });
      const genericPrompt = promptForImageCandidate(
        String(stage || '').startsWith('new_story_ad.') ? rightsAwareImagePrompt(prompt) : prompt,
        config,
        String(stage || '').startsWith('new_story_ad.') ? rightsAwareImagePrompt(auditSafePrompt) : auditSafePrompt,
      );
      const response = await generationConcurrency.schedule(
        'new_story_ad.image_provider',
        Number(process.env.NEW_STORY_AD_IMAGE_PROVIDER_CONCURRENCY) || 2,
        () => client.images.generate({
          model: config.modelId,
          prompt: genericPrompt,
          size: sizeFor(config, aspectRatio),
          n: 1,
        }, { signal: cancellation.signal() }),
      );
      cancellation.throwIfCancelled(taskId);
      const first = Array.isArray(response?.data) ? response.data[0] : null;
      if (first?.url) {
        const payload = {
          image_url: first.url,
          url: first.url,
          provider_used: `${config.providerId}/${config.modelId}`,
          adapter: config.adapter,
          family: config.family,
          remote: true,
          reference_count: 0,
          reference_preserving: false,
        };
        const stablePayload = await persistImageResult({
          result: payload,
          filename: filename || `${stage}_${Date.now()}`,
          thumbnailWidths: [520, 640],
        });
        modelGateway.recordHealth(model, { ok: true, latencyMs: Date.now() - startedAt });
        storage.saveModelCall({ task_id: taskId, stage, provider_id: model.provider_id, model_id: model.model_id, status: 'success', latency_ms: Date.now() - startedAt, fallback_rank: candidateIndex + 1 });
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
          reference_count: 0,
          reference_preserving: false,
        };
        modelGateway.recordHealth(model, { ok: true, latencyMs: Date.now() - startedAt });
        storage.saveModelCall({ task_id: taskId, stage, provider_id: model.provider_id, model_id: model.model_id, status: 'success', latency_ms: Date.now() - startedAt, fallback_rank: candidateIndex + 1 });
        return payload;
      }
      throw new Error('图片供应商没有返回图片地址或图片数据。');
    } catch (err) {
      if (cancellation.signal()?.aborted) cancellation.throwIfCancelled(taskId);
      const classified = classifyImageGenerationError(err);
      const providerDiagnostics = providerErrorDiagnostics(err);
      const billingUnknown = err.billingState === 'unknown' || err.billing_state === 'unknown';
      if (err.code !== 'REFERENCE_IMAGE_UNSUPPORTED' && !['PROVIDER_RIGHTS_AUDIT', 'PROVIDER_CONTENT_AUDIT', 'PROVIDER_5XX_AMBIGUOUS'].includes(classified.code)) {
        modelGateway.recordHealth(model, { ok: false, error: err, latencyMs: Date.now() - startedAt });
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
        provider_task_id: err.providerTaskId || err.provider_task_id || '',
        provider_submission_state: err.providerSubmissionState || err.provider_submission_state || '',
        billing_state: err.billingState || err.billing_state || '',
        latency_ms: Date.now() - startedAt,
        fallback_rank: candidateIndex + 1,
      });
      errors.push({
        model: modelKey(model),
        code: classified.code || err.code,
        retryable: classified.retryable === true,
        message: String(classified.message || err.message || err).slice(0, 240),
        ...providerDiagnostics,
        provider_task_id: err.providerTaskId || err.provider_task_id || '',
        provider_submission_state: err.providerSubmissionState || err.provider_submission_state || '',
        billing_state: err.billingState || err.billing_state || '',
      });
      if (billingUnknown || classified.terminal === true) break;
    }
  }
  const ignoredPreferred = preferred && preferred !== 'auto' && !preferredCandidates.length
    ? `；ignored preferred=${preferred} because it is not enabled for ${stage}`
    : '';
  const detail = errors
    .map(item => {
      const providerMarker = [item.provider_error_code || item.provider_status, item.provider_reason]
        .filter(Boolean).join('/');
      return `${item.model}：${item.message || item.code}${providerMarker ? `（供应商：${providerMarker}）` : ''}`;
    })
    .join('；');
  const error = new Error(`图片生成失败，已尝试 ${errors.length} 个模型并停止继续调用${ignoredPreferred ? `（${ignoredPreferred}）` : ''}${detail ? `：${detail}` : ''}`);
  error.code = errors.some(item => item.retryable) ? 'IMAGE_ATTEMPTS_EXHAUSTED' : (errors[0]?.code || 'IMAGE_MODEL_UNAVAILABLE');
  error.retryable = errors.some(item => item.retryable);
  error.attempts = errors;
  const uncertain = errors.find(item => item.billing_state === 'unknown');
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
  persistImageResult,
  supportsReferenceImages,
  imagePromptLimit,
  compactImagePrompt,
  isProviderSubmitAuditError,
  isProviderRightsAuditError,
  classifyImageGenerationError,
  providerErrorDiagnostics,
  rightsAwareImagePrompt,
  promptForImageCandidate,
  imageConfigStage,
  requiredImageModelForStage,
  applyImageModelPolicy,
  invokeWithAuditSafeRetry,
  availableImageCandidates,
  generateImage,
  generateActorReference,
  splitActorSheet,
  splitReferenceSheet,
};
