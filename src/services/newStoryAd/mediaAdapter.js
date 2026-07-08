require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');
const OpenAI = require('openai');
const pipeline = require('../pipelineModelService');
const { loadSettings } = require('../settingsService');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, '../../../outputs'));
const ASSET_DIR = path.join(OUTPUT_DIR, 'new-story-ad-assets');

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

function stageCandidates(stage) {
  return pipeline.pickAllEnabled(stage).length
    ? pipeline.pickAllEnabled(stage)
    : (pipeline.getStageDefaults(stage) || []).filter(x => x.enabled !== false);
}

function resolveImageAdapter(model = {}) {
  const providerId = String(model.provider_id || model.providerId || '').trim();
  const modelId = String(model.model_id || model.model || '').trim();
  if (!providerId || !modelId) throw new Error('new_story_ad image adapter requires provider_id/model_id');
  const settings = loadSettings();
  const provider = (settings.providers || []).find(p => p.enabled && p.api_key && providerMatches(p, providerId));
  if (!provider) throw new Error(`new_story_ad image provider unavailable: ${providerId}`);
  const providerModel = (provider.models || []).find(m => String(m.id || '').trim() === modelId && m.enabled !== false && imageUseMatches(m));
  if (!providerModel) throw new Error(`new_story_ad image model is not enabled image model: ${providerId}/${modelId}`);
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
  if (ratio === '1:1') return sizes.square || '1024x1024';
  if (ratio === '4:3') return sizes.four_three || '1024x768';
  if (ratio === '3:4') return sizes.three_four || '768x1024';
  return sizes.portrait || '1024x1536';
}

function isDeyunaiConfig(config = {}) {
  return /deyunai|漫路/i.test([
    config.providerId,
    config.provider?.id,
    config.provider?.preset,
    config.provider?.name,
    config.adapter,
    config.family,
  ].filter(Boolean).join(' '));
}

function deyunaiSizeFor(config = {}, aspectRatio = '9:16') {
  const size = sizeFor(config, aspectRatio);
  if (String(config.modelId || '').trim().toLowerCase() !== 'gpt-image-2') return size;
  const ratio = String(aspectRatio || '').trim();
  if (ratio === '16:9' || ratio === '4:3') return '1536x1024';
  if (ratio === '9:16' || ratio === '3:4') return '1024x1536';
  return '1024x1024';
}

function publicAssetUrl(filename) {
  return `/api/new-story-ad/assets/${encodeURIComponent(path.basename(filename))}`;
}

function assetPathFromName(filename = '') {
  const safe = path.basename(String(filename || '').split('?')[0]);
  if (!safe) return '';
  return path.join(ASSET_DIR, safe);
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

function imageUrlsFromPayload(payload = {}) {
  const urls = [];
  const add = value => {
    const text = String(value || '').trim();
    if (text) urls.push(text);
  };
  const data = payload?.data;
  if (Array.isArray(data)) data.forEach(item => add(item?.url || item?.b64_json || item?.image_url));
  if (Array.isArray(data?.task_result?.images)) data.task_result.images.forEach(item => add(item?.url || item?.b64_json || item?.image_url));
  if (Array.isArray(payload?.task_result?.images)) payload.task_result.images.forEach(item => add(item?.url || item?.b64_json || item?.image_url));
  add(payload?.url || payload?.image_url || payload?.b64_json);
  return urls.filter(Boolean);
}

function taskIdFromPayload(payload = {}) {
  return String(payload?.data?.task_id || payload?.task_id || payload?.id || '').trim();
}

function taskStatusFromPayload(payload = {}) {
  return String(payload?.data?.task_status || payload?.task_status || payload?.status || '').trim().toLowerCase();
}

function taskErrorFromPayload(payload = {}) {
  const data = payload?.data || payload || {};
  return data.error_msg || data.error || data.message || data.task_status_msg || JSON.stringify(payload).slice(0, 300);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function generateDeyunaiImageViaTask(config = {}, { prompt = '', aspectRatio = '9:16', filename = '', stage = '', resolution = '2K' } = {}) {
  const baseURL = String(config.baseURL || 'https://api.deyunai.com/v1').replace(/\/+$/, '');
  const body = {
    model: config.modelId,
    prompt,
    size: deyunaiSizeFor(config, aspectRatio),
    n: 1,
  };
  if (config.modelId !== 'gpt-image-2' && aspectRatio) {
    body.aspect_ratio = aspectRatio;
    body.aspectRatio = aspectRatio;
  }
  const headers = {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  };
  const submit = await axios.post(`${baseURL}/images/generations`, body, {
    headers,
    timeout: 120000,
    validateStatus: () => true,
  });
  if (submit.status >= 400) {
    throw new Error(`deyunai image submit HTTP ${submit.status}: ${JSON.stringify(submit.data).slice(0, 300)}`);
  }
  let payload = submit.data || {};
  let urls = imageUrlsFromPayload(payload);
  const taskId = taskIdFromPayload(payload);
  if (!urls.length && taskId) {
    const deadline = Date.now() + 360000;
    while (Date.now() < deadline) {
      await wait(3000);
      const poll = await axios.get(`${baseURL}/images/generations/${encodeURIComponent(taskId)}`, {
        headers,
        timeout: 30000,
        validateStatus: () => true,
      });
      if (poll.status >= 400) {
        throw new Error(`deyunai image poll HTTP ${poll.status}: ${JSON.stringify(poll.data).slice(0, 300)}`);
      }
      payload = poll.data || {};
      urls = imageUrlsFromPayload(payload);
      const status = taskStatusFromPayload(payload);
      if (urls.length) break;
      if (['failed', 'fail', 'error', 'cancelled', 'canceled'].includes(status)) {
        throw new Error(`deyunai image task failed: ${taskErrorFromPayload(payload)}`);
      }
    }
  }
  const firstUrl = urls[0] || '';
  if (!firstUrl) throw new Error(`deyunai image provider returned no image url: ${JSON.stringify(payload).slice(0, 300)}`);
  if (/^data:image\/\w+;base64,/i.test(firstUrl)) {
    const safe = safeFilename(filename || `${stage}_${Date.now()}`, '.png');
    const filePath = writeBase64Asset(firstUrl, safe);
    return {
      filePath,
      filename: safe,
      image_url: publicAssetUrl(safe),
      url: publicAssetUrl(safe),
      provider_used: `${config.providerId}/${config.modelId}`,
      adapter: config.adapter,
      family: config.family,
      resolution,
      task_id: taskId,
    };
  }
  return {
    image_url: firstUrl,
    url: firstUrl,
    provider_used: `${config.providerId}/${config.modelId}`,
    adapter: config.adapter,
    family: config.family,
    remote: true,
    task_id: taskId,
  };
}

async function imageBufferFromResult(result = {}) {
  if (result.filePath && fs.existsSync(result.filePath)) return fs.readFileSync(result.filePath);
  const value = String(result.image_url || result.imageUrl || result.url || '').trim();
  if (!value) throw new Error('image result has no readable url');
  if (value.startsWith('/api/new-story-ad/assets/')) {
    const filePath = assetPathFromName(decodeURIComponent(value.split('/').pop() || ''));
    if (filePath && fs.existsSync(filePath)) return fs.readFileSync(filePath);
  }
  if (/^https?:\/\//i.test(value)) {
    const response = await axios.get(value, { responseType: 'arraybuffer', timeout: 120000 });
    return Buffer.from(response.data);
  }
  throw new Error(`unsupported image url for local processing: ${value.slice(0, 120)}`);
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
  viewKeys = ['view_1', 'view_2', 'view_3', 'view_4'],
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
  if (fullW < 400 || fullH < 400) throw new Error(`actor sheet image is too small: ${fullW}x${fullH}`);
  const cellW = Math.floor(fullW / 2);
  const cellH = Math.floor(fullH / 2);
  const rects = [
    { left: 0, top: 0, width: cellW, height: cellH },
    { left: cellW, top: 0, width: fullW - cellW, height: cellH },
    { left: 0, top: cellH, width: cellW, height: fullH - cellH },
    { left: cellW, top: cellH, width: fullW - cellW, height: fullH - cellH },
  ];
  ensureDir(ASSET_DIR);
  const views = [];
  for (let i = 0; i < rects.length; i += 1) {
    const key = viewKeys[i] || `view_${i + 1}`;
    const safe = safeFilename(`${filenamePrefix}_${key}_${Date.now()}_${i + 1}`, '.png');
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
  stage = 'new_story_ad.keyframe',
  prompt = '',
  filename = '',
  aspectRatio = '9:16',
  resolution = '2K',
  imageModel = 'auto',
} = {}) {
  if (process.env.NEW_STORY_AD_MOCK_IMAGE === '1') return writeMockSvg(filename || `${stage}_${Date.now()}`, prompt);
  const candidates = stageCandidates(stage);
  const preferred = String(imageModel || '').trim();
  const filtered = preferred && preferred !== 'auto'
    ? candidates.filter(m => String(m.model_id || m.model || '') === preferred || String(m.provider_id || '') === preferred)
    : candidates;
  const errors = [];
  for (const model of filtered) {
    let config = null;
    try {
      config = resolveImageAdapter(model);
      if (!/(openai|compatible|apismile|webang|deyunai|bridgellm)/i.test(config.family + ' ' + config.adapter)) {
        throw new Error(`adapter ${config.adapter} is not implemented in new_story_ad image adapter`);
      }
      if (isDeyunaiConfig(config)) {
        return await generateDeyunaiImageViaTask(config, {
          prompt,
          aspectRatio,
          filename,
          stage,
          resolution,
        });
      }
      const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL || undefined });
      const response = await client.images.generate({
        model: config.modelId,
        prompt,
        size: sizeFor(config, aspectRatio),
        n: 1,
      });
      const first = Array.isArray(response?.data) ? response.data[0] : null;
      if (first?.url) {
        return {
          image_url: first.url,
          url: first.url,
          provider_used: `${config.providerId}/${config.modelId}`,
          adapter: config.adapter,
          family: config.family,
          remote: true,
        };
      }
      if (first?.b64_json) {
        const safe = safeFilename(filename || `${stage}_${Date.now()}`, '.png');
        const filePath = writeBase64Asset(first.b64_json, safe);
        return {
          filePath,
          filename: safe,
          image_url: publicAssetUrl(safe),
          url: publicAssetUrl(safe),
          provider_used: `${config.providerId}/${config.modelId}`,
          adapter: config.adapter,
          family: config.family,
          resolution,
        };
      }
      throw new Error('image provider returned no url or b64_json');
    } catch (err) {
      errors.push(`${model.provider_id}/${model.model_id}: ${String(err.message || err).slice(0, 180)}`);
    }
  }
  throw new Error(`new_story_ad image models failed: ${errors.join('；')}`);
}

async function generateActorReference({ prompt = '', filename = '', aspectRatio = '3:4', imageModel = 'auto' } = {}) {
  return generateImage({
    stage: 'new_story_ad.person_sheet',
    prompt,
    filename: filename || `new_story_actor_${Date.now()}`,
    aspectRatio,
    imageModel,
  });
}

module.exports = {
  ASSET_DIR,
  assetPathFromName,
  publicAssetUrl,
  generateImage,
  generateActorReference,
  splitActorSheet,
  splitReferenceSheet,
};
