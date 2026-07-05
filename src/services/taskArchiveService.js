const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const sqliteConfig = require('../db/sqlite');
const contentRecords = require('../repositories/contentRecordRepository');

const OUTPUT_ROOT_DIR = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, '../../outputs'));
const ARCHIVE_FILE = path.join(OUTPUT_ROOT_DIR, 'platform_task_archives.json');
const COLLECTION = 'platform_task_archives';
const ACTOR_COLLECTION = 'platform_actor_assets';
const MAX_STRING_LENGTH = 24000;
const MAX_ARRAY_LENGTH = 120;

function nowIso() {
  return new Date().toISOString();
}

function stableHash(value) {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 24);
}

function cleanKey(key = '') {
  return String(key || '').toLowerCase();
}

function isSensitiveKey(key = '') {
  return /password|passwd|secret|token|api[_-]?key|authorization|cookie/i.test(cleanKey(key));
}

function sanitizeString(value = '') {
  const text = String(value);
  if (/^data:[^;]+;base64,/i.test(text)) return '[base64 omitted]';
  if (text.length > MAX_STRING_LENGTH) return `${text.slice(0, MAX_STRING_LENGTH)}...[truncated ${text.length - MAX_STRING_LENGTH} chars]`;
  return text;
}

function sanitize(value, depth = 0, key = '') {
  if (isSensitiveKey(key)) return '[redacted]';
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return sanitizeString(value);
  if (depth > 8) return '[max depth omitted]';
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY_LENGTH).map(item => sanitize(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (/^local(_|-)?path$|^absolute(_|-)?path$/i.test(k)) continue;
      out[k] = sanitize(v, depth + 1, k);
    }
    return out;
  }
  return null;
}

function readFallbackStore() {
  try {
    if (!fs.existsSync(ARCHIVE_FILE)) return { tasks: [] };
    const parsed = JSON.parse(fs.readFileSync(ARCHIVE_FILE, 'utf8'));
    return { tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [] };
  } catch {
    return { tasks: [] };
  }
}

function writeFallbackArchive(record) {
  fs.mkdirSync(path.dirname(ARCHIVE_FILE), { recursive: true });
  const store = readFallbackStore();
  const idx = store.tasks.findIndex(item => item.id === record.id);
  if (idx >= 0) store.tasks[idx] = record;
  else store.tasks.push(record);
  const overflow = Math.max(0, store.tasks.length - 1000);
  if (overflow) store.tasks.splice(0, overflow);
  fs.writeFileSync(ARCHIVE_FILE, JSON.stringify(store, null, 2));
  return record;
}

function listFallbackArchives() {
  return readFallbackStore().tasks;
}

function upsertArchive(record = {}) {
  const now = nowIso();
  const id = String(record.id || record.task_id || record.project_id || `task_${stableHash(JSON.stringify(record).slice(0, 4000))}`).trim();
  if (!id) throw new Error('task archive id is required');
  const normalized = sanitize({
    ...record,
    id,
    task_id: record.task_id || id,
    project_id: record.project_id || id,
    updated_at: now,
    created_at: record.created_at || now,
  });
  const dbConfig = sqliteConfig.getDbConfig();
  if (dbConfig.enabled) {
    return contentRecords.upsert(COLLECTION, normalized);
  }
  if (dbConfig.jsonFallback !== false) return writeFallbackArchive(normalized);
  throw new Error('Task archive database is disabled and JSON fallback is disabled');
}

function listArchives(filters = {}) {
  const dbConfig = sqliteConfig.getDbConfig();
  const rows = dbConfig.enabled ? contentRecords.list(COLLECTION, filters) : listFallbackArchives();
  return rows
    .filter(row => !filters.user_id || row.user_id === filters.user_id)
    .filter(row => !filters.project_id || row.project_id === filters.project_id)
    .filter(row => !filters.module || row.module === filters.module)
    .filter(row => !filters.task_type || row.task_type === filters.task_type)
    .filter(row => !filters.type || row.type === filters.type)
    .filter(row => !filters.status || row.status === filters.status)
    .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')));
}

function getArchive(id) {
  const clean = String(id || '').trim();
  if (!clean) return null;
  const dbConfig = sqliteConfig.getDbConfig();
  if (dbConfig.enabled) return contentRecords.get(COLLECTION, clean);
  return listFallbackArchives().find(row => row.id === clean || row.task_id === clean || row.project_id === clean) || null;
}

function removeArchive(id) {
  const clean = String(id || '').trim();
  if (!clean) return;
  const dbConfig = sqliteConfig.getDbConfig();
  if (dbConfig.enabled) {
    contentRecords.remove(COLLECTION, clean);
    return;
  }
  const store = readFallbackStore();
  const tasks = store.tasks.filter(row => row.id !== clean && row.task_id !== clean && row.project_id !== clean);
  fs.mkdirSync(path.dirname(ARCHIVE_FILE), { recursive: true });
  fs.writeFileSync(ARCHIVE_FILE, JSON.stringify({ tasks }, null, 2), 'utf8');
}

function promptTextFrom(item = {}) {
  // 中文注释：归档可能接收到失败链路留下的空镜头，空项不应阻断任务状态写回。
  if (!item || typeof item !== 'object') return '';
  return [
    item.prompt,
    item.image_prompt,
    item.compiled_image_prompt,
    item.visual_prompt,
    item.reference_prompt,
    item.video_prompt,
    item.negative_prompt,
  ].filter(Boolean).join('\n').trim();
}

function compactPromptItem(item = {}, index = 0, source = '') {
  // 中文注释：只归档真实存在的提示词项，避免 null/非对象数据导致整条任务归档失败。
  if (!item || typeof item !== 'object') return null;
  const prompt = promptTextFrom(item);
  if (!prompt) return null;
  return {
    source,
    index,
    shot_no: Number(item.shot_no || item.index || index + 1) || index + 1,
    prompt,
    model: item.model || item.provider || item.fusion_model || '',
    qa: item.qa || null,
  };
}

function buildLuxuryAdArchive(row = {}) {
  const draft = row.draft_state || {};
  const scenes = Array.isArray(row.scenes) ? row.scenes : [];
  const keyframes = Array.isArray(row.keyframes) ? row.keyframes : [];
  const storyboardSheets = Array.isArray(row.storyboard_sheets) ? row.storyboard_sheets : [];
  const prompts = [
    ...scenes.map((scene, index) => compactPromptItem(scene, index, 'scene')).filter(Boolean),
    ...keyframes.map((kf, index) => compactPromptItem(kf, index, 'keyframe')).filter(Boolean),
  ];
  return {
    id: row.id,
    task_id: row.id,
    project_id: row.id,
    user_id: row.user_id || null,
    module: 'digital_human',
    task_type: 'luxury_story_ad',
    title: row.title || '剧情广告项目',
    status: row.status || row.project_state || '',
    stage: row.project_state || '',
    task_scope_hash: row.task_scope_hash || '',
    task_scope: row.task_scope || null,
    request_keys: row.request_keys || {},
    content: {
      brief: row.text || '',
      product_name: row.product_name || '',
      product_subject: row.product_subject || '',
      brief_info: row.brief_info || null,
      product_profile: row.product_profile || null,
      controlled_production: row.controlled_production || null,
    },
    industry: {
      selection: row.industry_selection || draft.industry_selection || null,
      contract: row.industry_contract || draft.industry_contract || null,
    },
    people: {
      person_spec: draft.person_spec || null,
      person_asset: draft.person_asset || null,
      cast_profiles: row.cast_profiles || draft.cast_profiles || [],
    },
    script: {
      segment_plan: row.segment_plan || draft.segment_plan || null,
      scenes,
    },
    storyboard: {
      scenes,
      keyframes,
      sheets: storyboardSheets,
      visual_asset: row.visual_asset || null,
      keyframe_generation_status: row.keyframe_generation_status || '',
      reference_mode: row.reference_mode || '',
    },
    prompts,
    voice: {
      voice_id: row.voice_id || draft.voice_id || '',
      voice_direction: row.voice_direction || draft.voice_direction || '',
      voice_volume: row.voice_volume ?? draft.voice_volume ?? null,
      voiceover_segments: scenes.map((scene, index) => ({
        index,
        text: scene.voiceover || scene.narration || scene.dialogue || scene.text || '',
        duration: scene.duration || scene.duration_sec || null,
      })).filter(item => item.text),
    },
    subtitles: row.subtitle || draft.subtitle || null,
    bgm: {
      asset: row.bgm_asset || draft.bgm_asset || null,
      volume: row.bgm_volume ?? draft.bgm_volume ?? null,
    },
    video: {
      video_url: row.video_url || row.videoUrl || '',
      clips: row.clips || [],
      clip_urls: row.clip_urls || [],
      avatar_task_id: row.avatar_task_id || '',
      ratio: row.ratio || '',
      output_size: row.output_size || '',
      resolution: row.resolution || '',
    },
    failures: {
      last_error: row.last_error || '',
      last_error_code: row.last_error_code || '',
      keyframe_error_details: row.keyframe_error_details || null,
    },
    source_snapshot: row,
    created_at: row.created_at,
  };
}

function upsertLuxuryAdProject(row = {}) {
  return upsertArchive(buildLuxuryAdArchive(row));
}

function upsertActorAsset(asset = {}) {
  const id = String(asset.id || '').trim();
  if (!id) throw new Error('actor asset id is required');
  const now = nowIso();
  const record = sanitize({
    id,
    asset_id: id,
    user_id: asset.user_id || null,
    type: 'character',
    category: asset.category || asset.type || 'character',
    name: asset.name || asset.title || '角色素材',
    status: asset.status || 'active',
    source: asset.source || '',
    image_url: asset.image_url || asset.file_url || asset.url || '',
    file_url: asset.file_url || asset.image_url || asset.url || '',
    extra_image_urls: Array.isArray(asset.extra_image_urls) ? asset.extra_image_urls : [],
    view_images: Array.isArray(asset.view_images) ? asset.view_images : [],
    cast_assets: Array.isArray(asset.cast_assets) ? asset.cast_assets : [],
    metadata: asset.metadata || {},
    tags: Array.isArray(asset.tags) ? asset.tags : [],
    prompt: asset.prompt || asset.metadata?.prompt || '',
    consistency_key: asset.consistency_key || asset.metadata?.consistency_key || '',
    created_at: asset.created_at || now,
    updated_at: asset.updated_at || now,
  });
  const dbConfig = sqliteConfig.getDbConfig();
  if (dbConfig.enabled) return contentRecords.upsert(ACTOR_COLLECTION, record);
  if (dbConfig.jsonFallback !== false) {
    const fallbackFile = path.join(OUTPUT_ROOT_DIR, 'platform_actor_assets.json');
    fs.mkdirSync(path.dirname(fallbackFile), { recursive: true });
    let rows = [];
    try {
      const parsed = JSON.parse(fs.readFileSync(fallbackFile, 'utf8'));
      rows = Array.isArray(parsed.assets) ? parsed.assets : [];
    } catch {}
    const idx = rows.findIndex(item => item.id === id);
    if (idx >= 0) rows[idx] = record;
    else rows.push(record);
    fs.writeFileSync(fallbackFile, JSON.stringify({ assets: rows.slice(-2000) }, null, 2), 'utf8');
    return record;
  }
  throw new Error('Actor asset archive database is disabled and JSON fallback is disabled');
}

module.exports = {
  ACTOR_COLLECTION,
  COLLECTION,
  buildLuxuryAdArchive,
  getArchive,
  listArchives,
  removeArchive,
  upsertActorAsset,
  upsertArchive,
  upsertLuxuryAdProject,
};
