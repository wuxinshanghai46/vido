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
const THUMB_DIR = path.join(ASSET_DIR, 'thumbs');

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
  const configured = pipeline.pickAllEnabled(stage);
  const defaults = (pipeline.getStageDefaults(stage) || []).filter(x => x.enabled !== false);
  return configured.length ? configured : defaults;
}

function modelKey(model = {}) {
  return `${String(model.provider_id || model.providerId || '').trim()}/${String(model.model_id || model.model || '').trim()}`;
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

function publicAssetUrl(filename) {
  return `/api/new-story-ad/assets/${encodeURIComponent(path.basename(filename))}`;
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
  const preferredCandidates = preferred && preferred !== 'auto'
    ? candidates.filter(m => preferredMatches(m, preferred))
    : candidates;
  const filtered = preferredCandidates.length ? preferredCandidates : candidates;
  const candidateSummary = candidates.map(modelKey).filter(Boolean).join(', ');
  const errors = [];
  if (String(stage || '').startsWith('new_story_ad.')) {
    console.info('[new_story_ad:image_candidates]', JSON.stringify({
      stage,
      image_model: preferred || 'auto',
      preferred_matched: preferredCandidates.map(modelKey).filter(Boolean),
      candidates: candidates.map(modelKey).filter(Boolean),
    }));
  }
  if (!filtered.length) {
    throw new Error(`new_story_ad image models failed: no enabled image candidates for ${stage}`);
  }
  for (const model of filtered) {
    let config = null;
    try {
      config = resolveImageAdapter(model);
      if (!/(openai|compatible|apismile|webang|deyunai|bridgellm)/i.test(config.family + ' ' + config.adapter)) {
        throw new Error(`adapter ${config.adapter} is not implemented in new_story_ad image adapter`);
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
      errors.push(`${modelKey(model)}: ${String(err.message || err).slice(0, 180)}`);
    }
  }
  const ignoredPreferred = preferred && preferred !== 'auto' && !preferredCandidates.length
    ? `；ignored preferred=${preferred} because it is not enabled for ${stage}`
    : '';
  throw new Error(`new_story_ad image models failed: candidates=${candidateSummary}${ignoredPreferred}；${errors.join('；')}`);
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
  THUMB_DIR,
  assetPathFromName,
  assetThumbPathFromName,
  ensureAssetThumbnail,
  publicAssetUrl,
  generateImage,
  generateActorReference,
  splitActorSheet,
  splitReferenceSheet,
};
