const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../models/database');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './outputs');
const ASSETS_DIR = path.join(OUTPUT_DIR, 'assets');
const PUBLIC_ACTOR_USER_ID = 'public_actor_library';

// 确保目录存在
['music', 'characters', 'scenes'].forEach(sub => {
  fs.mkdirSync(path.join(ASSETS_DIR, sub), { recursive: true });
});

// 上传配置
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const isAudio = file.mimetype.startsWith('audio/') || /\.(mp3|wav|ogg|flac|aac|m4a)$/i.test(file.originalname);
    const sub = isAudio ? 'music' : 'scenes';
    cb(null, path.join(ASSETS_DIR, sub));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.bin';
    cb(null, `asset_${Date.now()}_${uuidv4().slice(0, 8)}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

function normalizeAssetImageList(value) {
  const list = Array.isArray(value) ? value : (value ? [value] : []);
  const seen = new Set();
  return list
    .map(x => String(x || '').trim())
    .filter(Boolean)
    .filter(x => {
      if (seen.has(x)) return false;
      seen.add(x);
      return true;
    })
    .slice(0, 12);
}

function normalizeAssetViewImages(value) {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set();
  return list.map(item => {
    if (typeof item === 'string') return { url: item };
    if (!item || typeof item !== 'object') return null;
    const url = String(item.url || item.image_url || item.imageUrl || item.file_url || '').trim();
    if (!url) return null;
    return {
      ...item,
      url,
      image_url: String(item.image_url || item.url || item.imageUrl || item.file_url || '').trim() || url,
    };
  }).filter(Boolean).filter(item => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  }).slice(0, 12);
}

function publicAssetUrl(asset) {
  return asset.file_url || asset.image_url || asset.url || '';
}

function compactAssetUrl(url = '') {
  let raw = String(url || '').trim();
  if (!raw) return '';
  raw = raw.replace(/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?/i, '');
  raw = raw.replace(/^https?:\/\/vido\.smsend\.cn/i, '');
  raw = raw.split('#')[0].split('?')[0].replace(/\\/g, '/');
  try { raw = decodeURI(raw); } catch {}
  return raw.replace(/\/+/g, '/').toLowerCase();
}

function actorIdentityParts(asset = {}) {
  if (!asset || typeof asset !== 'object') return [];
  const metadata = asset.metadata || {};
  const keys = [];
  const add = (prefix, value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized) keys.push(`${prefix}:${normalized}`);
  };
  add('actor_asset', asset.actor_asset_id || asset.asset_library_id || metadata.actor_asset_id || metadata.asset_library_id);
  add('actor', asset.actor_id || metadata.actor_id);
  const viewImages = normalizeAssetViewImages(asset.view_images || metadata.view_images || metadata.views || []);
  const viewUrls = [...new Set(viewImages
    .map(view => compactAssetUrl(view.url || view.image_url || view.imageUrl || view.file_url || ''))
    .filter(Boolean))];
  if (viewUrls.length >= 2) keys.push(`views:${viewUrls.sort().join('|')}`);
  const imageUrl = compactAssetUrl(asset.image_url || asset.file_url || asset.url || metadata.image_url || metadata.file_url || metadata.url || '');
  if (imageUrl) keys.push(`image:${imageUrl}`);
  return [...new Set(keys)];
}

function sameActorAsset(left = {}, right = {}) {
  const leftKeys = new Set(actorIdentityParts(left));
  return actorIdentityParts(right).some(key => leftKeys.has(key));
}

function findDuplicateCharacterAsset(userId, asset) {
  if (!asset || asset.type !== 'character') return null;
  const candidates = [
    ...db.listAssets(PUBLIC_ACTOR_USER_ID, 'character'),
    ...db.listAssets(userId, 'character'),
  ];
  return candidates.find(existing => sameActorAsset(existing, asset)) || null;
}

function verifiedCharacterLibraryEvidence(personContract = {}) {
  const qa = personContract.cross_view_qa || {};
  const verification = personContract.verification || {};
  const score = key => Number(qa[key]);
  const realism = Number(qa.photographic_realism_score);
  return personContract.status === 'verified'
    && qa.pass === true
    && verification.state === 'verified'
    && Boolean(String(qa.used_model || verification.used_model || '').trim())
    && score('identity_score') >= 0.82
    && score('age_score') >= 0.75
    && score('wardrobe_score') >= 0.75
    && score('body_score') >= 0.72
    && (!Number.isFinite(realism) || realism >= 0.72);
}

function serializeAsset(asset, options = {}) {
  if (!asset) return asset;
  const imageUrl = publicAssetUrl(asset);
  const extraImages = normalizeAssetImageList(asset.extra_image_urls || asset.extra_images || []);
  const metadata = asset.metadata || {};
  const viewImages = normalizeAssetViewImages(asset.view_images || metadata.view_images || metadata.views || []);
  const source = asset.source || metadata.source || '';
  const actorText = [asset.name, asset.description, metadata.name, metadata.prompt, metadata.reference_kind]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const referenceKind = asset.reference_kind
    || metadata.reference_kind
    || (/uploaded|real_photo|human_photo/i.test(source)
      ? 'real_photo'
      : (/local_actor_library_generated/i.test(source) || /fixed real actor asset|realistic actor|真人感演员|真人演员包/.test(actorText)
        ? 'synthetic_realistic_actor'
        : (/generated|ai/i.test(source) ? 'ai_generated' : '')));
  const profile = metadata.subject_profile || metadata.profile || asset.subject_profile || {};
  const personContract = asset.person_contract || metadata.person_contract || {};
  const identityViews = normalizeAssetViewImages(asset.identity_views || metadata.identity_views || []);
  const bodyViews = normalizeAssetViewImages(asset.body_views || metadata.body_views || viewImages);
  const expressions = normalizeAssetViewImages(asset.expressions || metadata.expressions || []);
  const baseActions = normalizeAssetViewImages(asset.base_actions || metadata.base_actions || []);
  const dossierSheet = asset.dossier_sheet || metadata.dossier_sheet || null;
  const nativeMasters = asset.native_masters || metadata.native_masters || {};
  const portrait = nativeMasters.face?.image_url
    || identityViews.find(view => ['face_front', 'portrait', 'front'].includes(String(view.key || view.id || '').toLowerCase()))?.image_url
    || metadata.cover_image_url
    || imageUrl;
  const fullBody = nativeMasters.body?.image_url
    || bodyViews.find(view => ['front', 'body_front'].includes(String(view.key || view.id || '').toLowerCase()))?.image_url
    || imageUrl;
  const portraitFallbackUrls = [...new Set([
    portrait,
    ...identityViews.map(view => view.image_url),
    fullBody,
    ...bodyViews.map(view => view.image_url),
    dossierSheet?.image_url,
    imageUrl,
  ].map(normalizeLocalPublicUrl).filter(Boolean))].slice(0, 8);
  const libraryReady = verifiedCharacterLibraryEvidence(personContract)
    && bodyViews.length >= 4 && identityViews.length >= 1 && expressions.length >= 6
    && Boolean(String(dossierSheet?.image_url || '').trim())
    && asset.production_usable_actor !== false && metadata.production_usable_actor !== false;
  const profileText = [profile.roleName, profile.appearanceText, profile.wardrobeText, profile.hairMakeupText]
    .filter(Boolean).join(' ');
  const ageText = String(profile.age_contract?.display_text || profile.age || profile.age_range || personContract.identity?.age_range || '');
  const ageNumber = Number((ageText.match(/\d{1,3}/) || [])[0]);
  const ageBand = Number.isFinite(ageNumber)
    ? (ageNumber < 13 ? '儿童' : (ageNumber < 18 ? '少年' : (ageNumber < 35 ? '青年' : (ageNumber < 55 ? '中年' : '老年'))))
    : '';
  const era = /古代|古装|汉服|唐制|宋制|明制|武侠|仙侠/.test(profileText) ? '古代'
    : (/民国/.test(profileText) ? '近代' : (/未来|赛博|科幻/.test(profileText) ? '未来' : '现代'));
  const serialized = {
    ...asset,
    category: asset.category || asset.type,
    image_url: asset.image_url || imageUrl,
    file_url: asset.file_url || imageUrl,
    extra_image_urls: extraImages,
    view_images: viewImages,
    view_count: asset.view_count || viewImages.length || (imageUrl ? 1 + extraImages.length : extraImages.length),
    source,
    reference_kind: referenceKind,
    gender: asset.gender || metadata.gender || '',
    origin: asset.origin || metadata.origin || metadata.region || metadata.ethnicity || metadata.race || '',
    cast_mode: asset.cast_mode || metadata.cast_mode || '',
    expected_people: asset.expected_people || metadata.expected_people || metadata.person_count || '',
    person_count: asset.person_count || metadata.person_count || metadata.expected_people || '',
    cast_assets: Array.isArray(asset.cast_assets)
      ? asset.cast_assets
      : (Array.isArray(metadata.cast_assets) ? metadata.cast_assets : []),
    is_ai_generated: asset.is_ai_generated === true || metadata.is_ai_generated === true || referenceKind === 'ai_generated',
    production_usable_actor: asset.production_usable_actor === true
      || metadata.production_usable_actor === true
      || referenceKind === 'synthetic_realistic_actor',
    library_ready: libraryReady,
    cover_image_url: portrait,
    subject_profile: profile,
    person_contract: personContract,
    dossier_sheet: dossierSheet,
    native_masters: nativeMasters,
    body_views: bodyViews,
    identity_views: identityViews,
    expressions,
    base_actions: baseActions,
    character_library: {
      portrait_image_url: portrait,
      full_body_image_url: fullBody,
      dossier_image_url: dossierSheet?.image_url || '',
      portrait_fallback_urls: portraitFallbackUrls,
      body_views: bodyViews,
      identity_views: identityViews,
      expressions,
      actions: baseActions,
      filters: {
        gender: asset.gender || metadata.gender || profile.gender || personContract.identity?.gender || '',
        age_band: ageBand,
        era,
        role: profile.roleName || asset.cast_role || metadata.cast_role || '',
        origin: asset.origin || metadata.origin || metadata.region || profile.ethnicity || personContract.identity?.origin || '',
      },
    },
  };
  if (options.summary === true) {
    return {
      id: serialized.id,
      type: serialized.type,
      name: serialized.name,
      description: serialized.description,
      source: serialized.source,
      library_ready: serialized.library_ready,
      cover_image_url: serialized.cover_image_url,
      image_url: serialized.cover_image_url,
      subject_profile: serialized.subject_profile,
      person_contract: {
        status: serialized.person_contract?.status,
        verification: serialized.person_contract?.verification,
      },
      character_library: {
        portrait_image_url: serialized.character_library.portrait_image_url,
        portrait_fallback_urls: serialized.character_library.portrait_fallback_urls,
        filters: serialized.character_library.filters,
        summary_only: true,
      },
    };
  }
  return serialized;
}

function isCharacterAssetType(type) {
  return !type || type === 'all' || type === 'character';
}

function mergeAssetRows(rows = []) {
  const seen = new Set();
  return rows.filter(asset => {
    const keys = actorIdentityParts(asset);
    const fallbackId = String(asset?.id || '').trim().toLowerCase();
    const identityKeys = keys.length ? keys : (fallbackId ? [`id:${fallbackId}`] : []);
    if (!identityKeys.length) return true;
    if (identityKeys.some(key => seen.has(key))) return false;
    identityKeys.forEach(key => seen.add(key));
    return true;
  });
}

function listAssetsForRequest(userId, type) {
  const own = db.listAssets(userId, type || 'all');
  if (!isCharacterAssetType(type)) return own;
  const publicActors = db.listAssets(PUBLIC_ACTOR_USER_ID, 'character');
  return mergeAssetRows([...publicActors, ...own]);
}

function normalizeLocalPublicUrl(url = '') {
  const raw = String(url || '').trim();
  if (!raw) return '';
  const m = raw.match(/^https?:\/\/(?:127\.0\.0\.1|localhost):\d+(\/.+)$/i);
  return m ? m[1] : raw;
}

function syncGeneratedActorLibraryAssets(userId) {
  const outputDir = path.resolve(process.env.OUTPUT_DIR || './outputs');
  let dirs = [];
  try {
    dirs = fs.readdirSync(outputDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && /^actor-library-/i.test(d.name))
      .map(d => path.join(outputDir, d.name));
  } catch {
    return [];
  }
  const existing = db.listAssets(userId, 'all');
  const existingKeys = new Set(existing.flatMap(a => [
    a.id,
    a.actor_asset_id,
    a.metadata && a.metadata.actor_asset_id,
    a.metadata && a.metadata.actor_id,
  ].filter(Boolean)));
  const inserted = [];
  dirs.forEach(dir => {
    const file = path.join(dir, 'actor_asset.json');
    if (!fs.existsSync(file)) return;
    let actor = null;
    try { actor = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return; }
    const actorAssetId = String(actor.actor_asset_id || actor.asset_library_id || actor.actor_id || path.basename(dir)).trim();
    if (!actorAssetId || existingKeys.has(actorAssetId)) return;
    const imageUrl = normalizeLocalPublicUrl(actor.image_url || actor.url || actor.file_url || '');
    const extraImageUrls = normalizeAssetImageList(actor.extra_image_urls || actor.extra_images || [])
      .map(normalizeLocalPublicUrl)
      .filter(Boolean);
    if (!imageUrl && !extraImageUrls.length) return;
    const asset = {
      id: actorAssetId,
      user_id: userId,
      type: 'character',
      category: 'character',
      actor_asset_id: actorAssetId,
      actor_id: actor.actor_id || actorAssetId,
      name: actor.name || '本地演员素材',
      original_name: actor.name || '',
      file_path: '',
      file_url: imageUrl,
      image_url: imageUrl,
      extra_image_urls: extraImageUrls,
      view_count: Number(actor.view_count || (imageUrl ? 1 + extraImageUrls.length : extraImageUrls.length)) || 1,
      status: actor.status || 'active',
      source: actor.source || 'local_actor_library_generated',
      reference_kind: actor.reference_kind || 'synthetic_realistic_actor',
      gender: actor.gender || '',
      origin: actor.origin || actor.region || actor.ethnicity || actor.race || '',
      cast_mode: actor.cast_mode || '',
      expected_people: actor.expected_people || actor.person_count || '',
      person_count: actor.person_count || actor.expected_people || '',
      cast_assets: Array.isArray(actor.cast_assets) ? actor.cast_assets : [],
      is_ai_generated: actor.reference_kind === 'ai_generated' || actor.is_ai_generated === true,
      production_usable_actor: actor.production_usable_actor !== false,
      description: actor.prompt || actor.description || '',
      tags: ['演员', '角色素材', '本地生成'],
      metadata: {
        ...actor,
        actor_asset_id: actorAssetId,
        synced_from: file,
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    db.insertAsset(asset);
    existingKeys.add(actorAssetId);
    inserted.push(asset);
  });
  return inserted;
}

// GET /api/assets — 列表
router.get('/', (req, res) => {
  const { type } = req.query;
  const skipSync = /^(1|true|yes)$/i.test(String(req.query.skip_sync || req.query.fast || ''));
  if (!skipSync && isCharacterAssetType(type)) {
    syncGeneratedActorLibraryAssets(PUBLIC_ACTOR_USER_ID);
  }
  const limit = Math.max(1, Math.min(300, Number(req.query.limit) || 0));
  const summary = /^(summary|compact)$/i.test(String(req.query.view || req.query.fields || ''));
  let assets = listAssetsForRequest(req.user.id, type || 'all').map(asset => serializeAsset(asset, { summary }));
  if (/^(1|true|yes)$/i.test(String(req.query.character_library || ''))) {
    assets = assets.filter(asset => asset.type === 'character' && asset.library_ready === true);
  }
  if (limit) assets = assets.slice(0, limit);
  res.json({ success: true, data: assets });
});

// GET /api/assets/:id — 详情
router.get('/:id', (req, res) => {
  const asset = db.getAsset(req.params.id);
  if (!asset) return res.status(404).json({ success: false, error: '素材不存在' });
  if (String(asset.user_id || '') !== String(req.user.id || '') && String(asset.user_id || '') !== PUBLIC_ACTOR_USER_ID) {
    return res.status(403).json({ success: false, error: '无权读取该人物素材' });
  }
  res.json({ success: true, data: serializeAsset(asset) });
});

// POST /api/assets/upload — 上传素材
router.post('/', (req, res) => {
  const body = req.body || {};
  const type = String(body.type || body.category || '').trim() || 'scene';
  if (!['character', 'scene', 'product', 'reference', 'music'].includes(type)) {
    return res.status(400).json({ success: false, error: '无效素材类型' });
  }
  const imageUrl = String(body.image_url || body.file_url || body.url || '').trim();
  const extraImageUrls = normalizeAssetImageList(body.extra_image_urls || body.extra_images || body.views);
  const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {};
  const viewImages = normalizeAssetViewImages(body.view_images || metadata.view_images || []);
  const actorAssetId = type === 'character'
    ? String(body.actor_asset_id || body.asset_library_id || metadata.actor_asset_id || metadata.asset_library_id || '').trim()
    : '';
  const actorId = type === 'character'
    ? String(body.actor_id || metadata.actor_id || actorAssetId || '').trim()
    : '';
  if (type !== 'music' && !imageUrl && !extraImageUrls.length && !viewImages.length) {
    return res.status(400).json({ success: false, error: '请提供素材图片 URL' });
  }

  const asset = {
    id: uuidv4(),
    user_id: req.user.id,
    type,
    category: type,
    name: String(body.name || '').trim() || (type === 'character' ? '角色素材' : '素材'),
    original_name: String(body.original_name || body.name || '').trim(),
    file_path: '',
    file_url: imageUrl,
    image_url: imageUrl,
    extra_image_urls: extraImageUrls,
    view_images: viewImages,
    view_count: Number(body.view_count || viewImages.length || (imageUrl ? 1 + extraImageUrls.length : extraImageUrls.length)) || 1,
    status: body.status || 'active',
    source: body.source || 'linked',
    actor_asset_id: actorAssetId,
    actor_id: actorId,
    reference_kind: body.reference_kind || metadata.reference_kind || '',
    gender: body.gender || metadata.gender || '',
    origin: body.origin || metadata.origin || metadata.region || metadata.ethnicity || metadata.race || '',
    cast_mode: body.cast_mode || body.castMode || metadata.cast_mode || '',
    expected_people: body.expected_people || metadata.expected_people || metadata.person_count || '',
    person_count: body.person_count || metadata.person_count || metadata.expected_people || '',
    cast_assets: Array.isArray(body.cast_assets) ? body.cast_assets : (Array.isArray(metadata.cast_assets) ? metadata.cast_assets : []),
    is_ai_generated: body.is_ai_generated === true || metadata.is_ai_generated === true,
    production_usable_actor: body.production_usable_actor === true || metadata.production_usable_actor === true,
    description: String(body.description || '').trim(),
    tags: Array.isArray(body.tags) ? body.tags.slice(0, 20) : [],
    metadata: {
      ...metadata,
      actor_asset_id: metadata.actor_asset_id || actorAssetId,
      actor_id: metadata.actor_id || actorId,
    },
    created_at: new Date().toISOString()
  };

  const duplicate = findDuplicateCharacterAsset(req.user.id, asset);
  if (duplicate) {
    return res.json({ success: true, data: serializeAsset(duplicate), deduped: true });
  }

  db.insertAsset(asset);
  res.json({ success: true, data: serializeAsset(asset) });
});

router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: '请选择文件' });

  const isAudio = req.file.mimetype.startsWith('audio/') || /\.(mp3|wav|ogg|flac|aac|m4a)$/i.test(req.file.originalname);
  const type = isAudio ? 'music' : (req.body.type || 'scene');
  const filename = path.basename(req.file.path);

  const asset = {
    id: uuidv4(),
    user_id: req.user.id,
    type,
    category: type,
    name: req.body.name || req.file.originalname,
    original_name: req.file.originalname,
    file_path: req.file.path,
    file_url: `/api/assets/file/${filename}`,
    image_url: isAudio ? '' : `/api/assets/file/${filename}`,
    extra_image_urls: [],
    view_count: isAudio ? 0 : 1,
    duration: null,
    source: 'uploaded',
    created_at: new Date().toISOString()
  };

  db.insertAsset(asset);
  res.json({ success: true, data: serializeAsset(asset) });
});

// POST /api/assets/trim-music — 裁剪音乐并保存
router.post('/trim-music', async (req, res) => {
  const { source_path, source_url, start, end, name } = req.body;

  // 确定源文件路径
  let srcPath = source_path;
  if (!srcPath && source_url) {
    // 从 URL 推断路径 (/api/projects/music/xxx -> outputs/music/xxx)
    const match = source_url.match(/\/music\/([^?]+)/);
    if (match) srcPath = path.join(OUTPUT_DIR, 'music', match[1]);
  }
  if (!srcPath || !fs.existsSync(srcPath)) {
    return res.status(400).json({ success: false, error: '源音乐文件不存在' });
  }
  if (start == null || end == null || end <= start) {
    return res.status(400).json({ success: false, error: '无效的裁剪范围' });
  }

  const ext = path.extname(srcPath) || '.mp3';
  const outFilename = `trim_${Date.now()}_${uuidv4().slice(0, 8)}${ext}`;
  const outPath = path.join(ASSETS_DIR, 'music', outFilename);

  try {
    const ffmpeg = require('fluent-ffmpeg');
    const ffmpegPath = require('ffmpeg-static');
    ffmpeg.setFfmpegPath(ffmpegPath);

    await new Promise((resolve, reject) => {
      ffmpeg(srcPath)
        .setStartTime(start)
        .setDuration(end - start)
        .output(outPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    const stat = fs.statSync(outPath);
    const asset = {
      id: uuidv4(),
      user_id: req.user.id,
      type: 'music',
      name: name || `裁剪片段 ${Math.floor(start)}s-${Math.floor(end)}s`,
      original_name: path.basename(srcPath),
      file_path: outPath,
      file_url: `/api/assets/file/${outFilename}`,
      duration: Math.round((end - start) * 100) / 100,
      file_size: stat.size,
      source: 'trimmed',
      trim_start: start,
      trim_end: end,
      source_ref: srcPath,
      created_at: new Date().toISOString()
    };

    db.insertAsset(asset);
    res.json({ success: true, data: asset });
  } catch (err) {
    console.error('Music trim error:', err.message);
    res.status(500).json({ success: false, error: '裁剪失败: ' + err.message });
  }
});

// POST /api/assets/import — 导入已有文件到素材库
router.post('/import', (req, res) => {
  const { type, source_path, name } = req.body;
  if (!type || !source_path) return res.status(400).json({ success: false, error: '缺少参数' });
  if (!fs.existsSync(source_path)) return res.status(400).json({ success: false, error: '文件不存在' });

  const ext = path.extname(source_path);
  const subDir = type === 'music' ? 'music' : type === 'character' ? 'characters' : 'scenes';
  const newFilename = `asset_${Date.now()}_${uuidv4().slice(0, 8)}${ext}`;
  const newPath = path.join(ASSETS_DIR, subDir, newFilename);

  // 复制文件
  fs.copyFileSync(source_path, newPath);

  const asset = {
    id: uuidv4(),
    user_id: req.user.id,
    type,
    category: type,
    name: name || path.basename(source_path, ext),
    original_name: path.basename(source_path),
    file_path: newPath,
    file_url: `/api/assets/file/${newFilename}`,
    image_url: type === 'music' ? '' : `/api/assets/file/${newFilename}`,
    extra_image_urls: [],
    view_count: type === 'music' ? 0 : 1,
    source: 'generated',
    created_at: new Date().toISOString()
  };

  db.insertAsset(asset);
  res.json({ success: true, data: serializeAsset(asset) });
});

// PUT /api/assets/:id — 更新
router.put('/:id', (req, res) => {
  const asset = db.getAsset(req.params.id);
  if (!asset) return res.status(404).json({ success: false, error: '素材不存在' });
  const { name, tags } = req.body;
  const fields = {};
  if (name !== undefined) fields.name = name;
  if (tags !== undefined) fields.tags = tags;
  db.updateAsset(req.params.id, fields);
  res.json({ success: true, data: { ...asset, ...fields } });
});

// DELETE /api/assets/:id — 删除
router.delete('/:id', (req, res) => {
  const asset = db.getAsset(req.params.id);
  if (!asset) return res.status(404).json({ success: false, error: '素材不存在' });
  // 删除文件
  if (asset.file_path && fs.existsSync(asset.file_path)) {
    try { fs.unlinkSync(asset.file_path); } catch {}
  }
  db.deleteAsset(req.params.id);
  res.json({ success: true });
});

module.exports = router;
module.exports.serializeAsset = serializeAsset;
module.exports.verifiedCharacterLibraryEvidence = verifiedCharacterLibraryEvidence;
