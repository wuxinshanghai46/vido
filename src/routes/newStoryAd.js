const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const router = express.Router();
const service = require('../services/newStoryAd');
const storage = require('../services/newStoryAd/storageService');
const modelGateway = require('../services/newStoryAd/modelGateway');
const mediaAdapter = require('../services/newStoryAd/mediaAdapter');
const ttsAdapter = require('../services/newStoryAd/ttsAdapter');
const videoAdapter = require('../services/newStoryAd/videoAdapter');
const composeService = require('../services/newStoryAd/composeService');
const db = require('../models/database');

function userFromReq(req) {
  return req.user || req.auth || {};
}

function asyncRoute(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      res.status(err.status || 500).json({
        success: false,
        error: String(err.message || err),
        review: err.review || undefined,
        partial: err.partial || undefined,
        keyframes: err.keyframes || undefined,
        attempts: err.attempts || undefined,
      });
    }
  };
}

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './outputs');
const PUBLIC_ACTOR_USER_ID = 'public_actor_library';

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(mediaAdapter.ASSET_DIR, { recursive: true });
      cb(null, mediaAdapter.ASSET_DIR);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.bin';
      const role = String(req.body?.role || 'asset').replace(/[^a-z0-9_-]/ig, '_').slice(0, 32) || 'asset';
      cb(null, `${role}_${Date.now()}_${uuidv4().slice(0, 8)}${ext}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const name = file.originalname || '';
    const ok = file.mimetype?.startsWith('image/')
      || file.mimetype?.startsWith('audio/')
      || /\.(png|jpe?g|webp|bmp|gif|mp3|wav|m4a|aac|ogg|flac)$/i.test(name);
    cb(null, ok);
  },
});

function uploadSingle(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ success: false, error: '文件超过 50MB，请压缩后再上传' });
    }
    return res.status(400).json({ success: false, error: err.message || '文件上传失败' });
  });
}

function normalizeLocalPublicUrl(url = '') {
  const raw = String(url || '').trim();
  if (!raw) return '';
  const m = raw.match(/^https?:\/\/(?:127\.0\.0\.1|localhost):\d+(\/.+)$/i);
  return m ? m[1] : raw;
}

function normalizeImageList(value) {
  const list = Array.isArray(value) ? value : (value ? [value] : []);
  const seen = new Set();
  return list
    .map(normalizeLocalPublicUrl)
    .filter(Boolean)
    .filter((url) => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    })
    .slice(0, 12);
}

function publicImageUrlToLocalPath(url = '') {
  const clean = normalizeLocalPublicUrl(url).split('?')[0];
  if (!clean) return '';
  const filename = path.basename(clean);
  if (!filename) return '';
  const candidates = [];
  if (clean.includes('/public/jimeng-assets/')) {
    candidates.push(path.join(OUTPUT_DIR, 'jimeng-assets', filename));
  }
  if (clean.includes('/api/story/character-image/')) {
    candidates.push(path.join(OUTPUT_DIR, 'characters', filename));
    candidates.push(path.join(OUTPUT_DIR, 'scenes', filename));
  }
  return candidates.find(p => p && fs.existsSync(p)) || '';
}

function inferActorViewKey(url = '', index = 0) {
  const name = path.basename(String(url || '').split('?')[0]).toLowerCase();
  if (/(^|[_-])(front|positive|main)([_-]|\.)/.test(name)) return 'front';
  if (/(^|[_-])(side|profile|semi|half)([_-]|\.)/.test(name)) return 'side';
  if (/(^|[_-])(back|rear)([_-]|\.)/.test(name)) return 'back';
  if (/(^|[_-])(action|pose|gesture|motion)([_-]|\.)/.test(name)) return 'action';
  return ['front', 'side', 'back', 'action'][Number(index) || 0] || `view_${index + 1}`;
}

function ensureFallbackViewImage(url = '', actorId = '', key = 'action') {
  const src = publicImageUrlToLocalPath(url);
  if (!src) return normalizeLocalPublicUrl(url);
  const ext = path.extname(src) || '.png';
  const safeId = String(actorId || path.basename(src, ext) || `actor_${Date.now()}`).replace(/[^a-z0-9_-]/ig, '_').slice(0, 80);
  const outDir = path.join(OUTPUT_DIR, 'jimeng-assets');
  fs.mkdirSync(outDir, { recursive: true });
  const safeKey = String(key || 'view').replace(/[^a-z0-9_-]/ig, '_').slice(0, 24);
  const dstName = `${safeId}_${safeKey}_reference${ext}`;
  const dst = path.join(outDir, dstName);
  if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
  return `/public/jimeng-assets/${dstName}`;
}

function normalizeActorViewImages(actor = {}) {
  const explicit = Array.isArray(actor.view_images) ? actor.view_images : [];
  const actorId = actor.actor_asset_id || actor.asset_library_id || actor.actor_id || actor.id || '';
  const sourceViews = explicit.length
    ? explicit.map((view, index) => ({
        key: view.key || view.view || inferActorViewKey(view.url || view.image_url || view.imageUrl || view.file_url || view.previewUrl || '', index),
        label: view.label || '',
        url: normalizeLocalPublicUrl(view.url || view.image_url || view.imageUrl || view.file_url || view.previewUrl || ''),
      }))
    : [actor.image_url || actor.file_url || actor.url, ...(Array.isArray(actor.extra_image_urls) ? actor.extra_image_urls : [])]
        .map((url, index) => ({
          key: inferActorViewKey(url, index),
          label: '',
          url: normalizeLocalPublicUrl(url),
        }));
  const seen = new Set();
  const views = sourceViews
    .filter(v => v.url)
    .filter(v => {
      const id = `${v.key}:${v.url}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .slice(0, 4);
  const byKey = new Map();
  views.forEach(view => {
    if (!byKey.has(view.key)) byKey.set(view.key, view);
  });
  const seed = byKey.get('front') || views[0] || null;
  if (seed) {
    ['front', 'side', 'back', 'action'].forEach(key => {
      if (!byKey.has(key)) {
        const url = ensureFallbackViewImage(seed.url, actorId, key);
        if (url) byKey.set(key, { key, label: key, url });
      }
    });
  }
  return ['front', 'side', 'back', 'action']
    .map(key => byKey.get(key))
    .filter(Boolean)
    .slice(0, 4)
    .map((view, index) => ({
    key: view.key || ['front', 'side', 'back', 'action'][index] || `view_${index + 1}`,
    label: view.label || '',
    url: view.url,
    image_url: view.url,
  }));
}

function readLocalActorLibrary() {
  let dirs = [];
  try {
    dirs = fs.readdirSync(OUTPUT_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory() && /^actor-library-/i.test(d.name))
      .map(d => path.join(OUTPUT_DIR, d.name));
  } catch {
    return [];
  }
  return dirs.map((dir) => {
    const file = path.join(dir, 'actor_asset.json');
    if (!fs.existsSync(file)) return null;
    try {
      const actor = JSON.parse(fs.readFileSync(file, 'utf8'));
      const imageUrl = normalizeLocalPublicUrl(actor.image_url || actor.url || actor.file_url || '');
      const extra = normalizeImageList(actor.extra_image_urls || actor.extra_images || actor.views || []);
      if (!imageUrl && !extra.length) return null;
      const viewImages = normalizeActorViewImages({ ...actor, image_url: imageUrl || extra[0] || '', extra_image_urls: extra });
      return {
        ...actor,
        id: actor.actor_asset_id || actor.asset_library_id || actor.actor_id || path.basename(dir),
        actor_asset_id: actor.actor_asset_id || actor.asset_library_id || actor.actor_id || path.basename(dir),
        actor_id: actor.actor_id || actor.actor_asset_id || path.basename(dir),
        image_url: imageUrl || extra[0] || '',
        url: imageUrl || extra[0] || '',
        file_url: imageUrl || extra[0] || '',
        extra_image_urls: extra,
        view_images: viewImages,
        view_count: viewImages.length || (imageUrl ? 1 + extra.length : extra.length),
        source: actor.source || 'local_actor_library_generated',
        reference_kind: actor.reference_kind || 'synthetic_realistic_actor',
        production_usable_actor: actor.production_usable_actor !== false,
      };
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function requestedGender(spec = {}, text = '') {
  const raw = [
    spec.gender,
    spec.sex,
    spec.genderAge,
    spec.gender_age,
    spec.appearanceText,
    spec.roleName,
    text,
  ].filter(Boolean).join(' ').toLowerCase();
  if (/female|woman|girl|女士|女性|女主|女生|女人/.test(raw)) return 'female';
  if (/male|man|boy|男士|男性|男主|男生|男人/.test(raw)) return 'male';
  return '';
}

function pickLocalActorFallback({ userId = '', spec = {}, brief = '' } = {}) {
  const gender = requestedGender(spec, brief);
  const seen = new Set();
  const dbActors = [
    ...db.listAssets(PUBLIC_ACTOR_USER_ID, 'character'),
    ...db.listAssets(userId, 'character'),
  ]
    .filter(a => {
      const key = String(a?.id || a?.actor_asset_id || a?.metadata?.actor_asset_id || '');
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .filter(a => a && (a.image_url || a.file_url || a.url))
    .filter(a => a.production_usable_actor === true || /actor|synthetic_realistic|local_actor/i.test([a.source, a.reference_kind, a.description].filter(Boolean).join(' ')));
  const localActors = readLocalActorLibrary();
  const all = [...dbActors, ...localActors];
  const match = gender ? all.find(a => String(a.gender || a.metadata?.gender || '').toLowerCase() === gender) : null;
  return match || all[0] || null;
}

function ensureActorAssetForUser(userId, actor = {}, patch = {}) {
  const actorAssetId = String(actor.actor_asset_id || actor.id || actor.actor_id || `new_story_actor_${uuidv4()}`).trim();
  const existing = db.listAssets(userId, 'character')
    .find(a => String(a.id || '') === actorAssetId || String(a.actor_asset_id || a.metadata?.actor_asset_id || '') === actorAssetId);
  if (existing) return existing;
  const imageUrl = normalizeLocalPublicUrl(actor.image_url || actor.file_url || actor.url || '');
  const explicitViews = Array.isArray(actor.view_images) && actor.view_images.length ? actor.view_images : patch.view_images;
  const extraImages = normalizeImageList(actor.extra_image_urls || actor.extra_images || []);
  const viewImages = normalizeActorViewImages({ ...actor, view_images: explicitViews, image_url: imageUrl || extraImages[0] || '', extra_image_urls: extraImages });
  const now = new Date().toISOString();
  const row = {
    id: actorAssetId,
    user_id: userId,
    type: 'character',
    category: 'character',
    actor_asset_id: actorAssetId,
    actor_id: actor.actor_id || actorAssetId,
    name: actor.name || patch.name || '新剧情广告演员资产',
    original_name: actor.original_name || actor.name || '',
    file_path: '',
    file_url: imageUrl || extraImages[0] || '',
    image_url: imageUrl || extraImages[0] || '',
    extra_image_urls: extraImages,
    view_images: viewImages,
    view_count: Number(actor.view_count || viewImages.length || (imageUrl ? 1 + extraImages.length : extraImages.length)) || 1,
    status: actor.status || 'active',
    source: actor.source || 'new_story_ad_actor_sheet',
    reference_kind: actor.reference_kind || 'synthetic_realistic_actor',
    gender: actor.gender || patch.gender || '',
    origin: actor.origin || actor.region || actor.ethnicity || actor.race || '',
    cast_mode: actor.cast_mode || patch.cast_mode || '',
    expected_people: actor.expected_people || actor.person_count || patch.expected_people || '',
    person_count: actor.person_count || actor.expected_people || patch.person_count || '',
    cast_assets: Array.isArray(actor.cast_assets) ? actor.cast_assets : [],
    is_ai_generated: actor.is_ai_generated === true,
    production_usable_actor: actor.production_usable_actor !== false,
    description: actor.prompt || actor.description || patch.description || '',
    tags: ['new-story-ad', 'actor'],
    metadata: {
      ...actor,
      ...patch,
      actor_asset_id: actorAssetId,
      module: 'new_story_ad',
    },
    created_at: now,
    updated_at: now,
  };
  db.insertAsset(row);
  return row;
}

function actorPayload(actorAsset, extra = {}) {
  const imageUrl = normalizeLocalPublicUrl(actorAsset.image_url || actorAsset.file_url || actorAsset.url || '');
  const extraImages = normalizeImageList(actorAsset.extra_image_urls || actorAsset.extra_images || []);
  const viewImages = normalizeActorViewImages({ ...actorAsset, image_url: imageUrl, extra_image_urls: extraImages });
  return {
    success: true,
    module: 'new_story_ad',
    imageUrl,
    image_url: imageUrl,
    url: imageUrl,
    character: {
      ...actorAsset,
      image_url: imageUrl,
      url: imageUrl,
      file_url: imageUrl,
      extra_image_urls: extraImages,
      view_images: viewImages,
      view_count: viewImages.length || actorAsset.view_count || 0,
    },
    actor_asset: {
      ...actorAsset,
      image_url: imageUrl,
      url: imageUrl,
      file_url: imageUrl,
      extra_image_urls: extraImages,
      view_images: viewImages,
      view_count: viewImages.length || actorAsset.view_count || 0,
    },
    view_images: viewImages,
    view_count: viewImages.length || actorAsset.view_count || 0,
    ...extra,
  };
}

function buildActorDescription({ brief = '', description = '', spec = {}, context = {} } = {}) {
  return [
    'Strict live-action photorealistic full-body commercial actor casting reference. It must look like a real adult human photographed by a real camera, not an AI beauty poster.',
    'Natural skin pores, imperfect human expression, realistic hands, real fabric wrinkles, normal body proportions, believable commercial wardrobe, clean studio casting background.',
    'The actor must be reusable across multiple storyboard shots. Preserve face identity, age impression, hairstyle, body proportions and wardrobe family.',
    'Show full body from head to feet, realistic clothing and shoes, no cartoon, no anime, no 3D render, no waxy skin, no plastic face, no over-smoothed glamour retouching, no poster text.',
    brief ? `Campaign brief: ${String(brief).slice(0, 1200)}` : '',
    description ? `User actor description: ${String(description).slice(0, 800)}` : '',
    spec.roleName || spec.role_name ? `Role hint: ${String(spec.roleName || spec.role_name).slice(0, 120)}` : '',
    spec.appearanceText || spec.appearance_text ? `Appearance lock: ${String(spec.appearanceText || spec.appearance_text).slice(0, 300)}` : '',
    spec.wardrobeText || spec.wardrobe_text ? `Wardrobe lock: ${String(spec.wardrobeText || spec.wardrobe_text).slice(0, 300)}` : '',
    spec.hairMakeupText || spec.hair_makeup_text ? `Hair and makeup lock: ${String(spec.hairMakeupText || spec.hair_makeup_text).slice(0, 240)}` : '',
    Array.isArray(context.person_notes) && context.person_notes.length ? `Story characters: ${context.person_notes.slice(0, 8).join('; ')}` : '',
  ].filter(Boolean).join('\n');
}

function buildActorViewPrompt(basePrompt = '', view = 'front') {
  const viewPrompts = {
    front: 'View requirement: FRONT full-body casting reference, standing naturally, face clearly visible, both feet visible, clean neutral background.',
    side: 'View requirement: SIDE or three-quarter profile full-body casting reference of the same actor, same face identity, same age impression, same body proportions and wardrobe family, both feet visible.',
    back: 'View requirement: BACK full-body casting reference of the same actor, same hairstyle, same body proportions and same wardrobe family, both feet visible.',
    action: 'View requirement: NATURAL COMMERCIAL ACTION POSE full-body reference of the same actor, subtle presenting gesture, same identity, same outfit family, realistic human hands and feet.',
  };
  return [
    basePrompt,
    viewPrompts[view] || viewPrompts.front,
    'Background rule: every view must use the exact same clean light-gray studio casting background. No showroom, no interior scene, no product wall, no furniture, no props, no text, no logo, no environmental storytelling.',
    'Consistency rule: this image is one view of a four-view actor package. Keep the actor identity, age, body type, hairstyle, outfit color/material family and realism consistent across all views.',
  ].filter(Boolean).join('\n\n');
}

router.get('/health', (req, res) => {
  const stages = [
    'new_story_ad.scene_config',
    'new_story_ad.blueprint',
    'new_story_ad.storyboard_table',
    'new_story_ad.storyboard_rewrite',
    'new_story_ad.qa',
    'new_story_ad.json_repair',
    'new_story_ad.assist',
    'new_story_ad.person_sheet',
    'new_story_ad.keyframe',
    'new_story_ad.video',
    'new_story_ad.tts',
  ];
  res.json({
    success: true,
    module: 'new_story_ad',
    storage: {
      db_path: storage.DB_PATH,
      health_path: storage.HEALTH_PATH,
    },
    candidates: Object.fromEntries(stages.map(stage => [stage, modelGateway.candidatesForStage(stage).map(m => `${m.provider_id}/${m.model_id}`)])),
    model_health: service.modelHealth(),
  });
});

router.get('/model-health', (req, res) => {
  res.json({
    success: true,
    module: 'new_story_ad',
    model_health: service.modelHealth(),
  });
});

router.post('/upload', uploadSingle, (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: '请选择文件' });
  const filename = path.basename(req.file.filename);
  const url = mediaAdapter.publicAssetUrl(filename);
  const isAudio = req.file.mimetype?.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(req.file.originalname || '');
  const asset = {
    id: `new_story_asset_${uuidv4()}`,
    module: 'new_story_ad',
    role: String(req.body?.role || 'asset').trim() || 'asset',
    name: req.file.originalname || filename,
    original_name: req.file.originalname || filename,
    filename,
    file_url: url,
    url,
    image_url: isAudio ? '' : url,
    mimetype: req.file.mimetype || '',
    size: req.file.size || 0,
    created_at: new Date().toISOString(),
  };
  res.json({ success: true, data: asset, asset, url, file_url: url, image_url: asset.image_url });
});

router.get('/assets/:filename', (req, res) => {
  const filePath = mediaAdapter.assetPathFromName(req.params.filename);
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ success: false, error: '资产不存在' });
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(filePath);
});

router.get('/audio/:filename', (req, res) => {
  const filePath = ttsAdapter.audioPathFromName(req.params.filename);
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ success: false, error: 'Audio asset not found' });
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(filePath);
});

router.get('/videos/:filename', (req, res) => {
  const filePath = videoAdapter.videoPathFromName(req.params.filename);
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ success: false, error: 'Video asset not found' });
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(filePath);
});

router.get('/compose/:filename', (req, res) => {
  const filePath = composeService.composePathFromName(req.params.filename);
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ success: false, error: 'Final video not found' });
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(filePath);
});

router.get('/tasks', (req, res) => {
  res.json({
    success: true,
    tasks: storage.listTasks({
      limit: req.query.limit || 50,
      status: req.query.status || '',
      userId: req.query.mine ? userFromReq(req).id : '',
    }),
  });
});

router.post('/tasks', (req, res) => {
  const created = service.createTask(req.body || {}, userFromReq(req));
  res.json({ success: true, ...created });
});

router.put('/tasks/:id', (req, res) => {
  const updated = service.updateTaskRequest(req.params.id, req.body || {}, userFromReq(req));
  res.json({ success: true, ...updated, bundle: service.publicTaskBundle(req.params.id) });
});

router.post('/assist', asyncRoute(async (req, res) => {
  const result = await service.assistBrief(req.body || {}, userFromReq(req));
  res.json({ success: true, ...result });
}));

router.post('/person-sheet', asyncRoute(async (req, res) => {
  const body = req.body || {};
  const user = userFromReq(req);
  const userId = user.id || user.username || 'anonymous';
  const brief = String(body.brief || body.content || '').trim();
  if (brief.length < 6) {
    return res.status(400).json({ success: false, error: '请先填写广告需求，再生成新剧情广告人物演员包' });
  }
  const spec = body.person_spec && typeof body.person_spec === 'object' ? body.person_spec : {};
  const context = body.person_context && typeof body.person_context === 'object' ? body.person_context : {};
  const gender = requestedGender(spec, `${brief} ${body.description || ''}`);
  const castMode = String(spec.castMode || spec.cast_mode || '').trim() || 'single';
  const expectedPeople = castMode === 'group' ? 3 : (castMode === 'dual' ? 2 : 1);
  const actorId = `new_story_actor_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const description = buildActorDescription({
    brief,
    description: body.description,
    spec,
    context,
  });
  try {
    const viewKeys = ['front', 'side', 'back', 'action'];
    const generatedViews = [];
    for (const key of viewKeys) {
      const generated = await mediaAdapter.generateActorReference({
        filename: `actor_${actorId}_${key}_${Date.now()}`,
        prompt: buildActorViewPrompt(description, key),
        aspectRatio: '3:4',
        imageModel: body.image_model || body.imageModel || 'auto',
      });
      const actorUrl = normalizeLocalPublicUrl(generated.image_url || generated.url || '');
      if (actorUrl) {
        generatedViews.push({
          key,
          label: key,
          url: actorUrl,
          image_url: actorUrl,
          provider_used: generated.provider_used || '',
        });
      }
    }
    const viewImages = generatedViews;
    const extraImages = viewImages.slice(1).map(v => v.url).filter(Boolean);
    const providerUsed = [...new Set(viewImages.map(v => v.provider_used).filter(Boolean))].join(', ');
    const actorAsset = ensureActorAssetForUser(PUBLIC_ACTOR_USER_ID, {
      id: `actor_asset_${actorId}`,
      actor_asset_id: `actor_asset_${actorId}`,
      actor_id: actorId,
      name: '新剧情广告拟真演员',
      source: 'new_story_ad_actor_sheet',
      reference_kind: 'synthetic_realistic_actor',
      production_usable_actor: true,
      is_ai_generated: true,
      gender,
      cast_mode: castMode,
      expected_people: expectedPeople,
      person_count: expectedPeople,
      image_url: viewImages[0]?.url || '',
      extra_image_urls: extraImages,
      view_images: viewImages,
      view_count: viewImages.length,
      description,
      prompt: description,
    }, {
      generated_by: 'new_story_ad.person_sheet',
      provider_used: providerUsed,
      request_key: body.request_key || '',
    });
    return res.json(actorPayload(actorAsset, {
      status: 'done',
      generated: true,
      fallback_used: false,
      public_actor_library: true,
      provider_used: providerUsed,
      request_key: body.request_key || '',
    }));
  } catch (err) {
    const fallback = pickLocalActorFallback({ userId, spec, brief });
    if (!fallback) {
      err.status = err.status || 503;
      err.code = err.code || 'NEW_STORY_PERSON_SHEET_PROVIDER_UNAVAILABLE';
      throw err;
    }
    const actorAsset = ensureActorAssetForUser(PUBLIC_ACTOR_USER_ID, fallback, {
      generated_by: 'new_story_ad.person_sheet.fallback',
      fallback_reason: String(err.message || err).slice(0, 500),
      request_key: body.request_key || '',
      gender,
      cast_mode: castMode,
      expected_people: expectedPeople,
      person_count: expectedPeople,
    });
    return res.json(actorPayload(actorAsset, {
      status: 'fallback_actor_library',
      generated: false,
      fallback_used: true,
      public_actor_library: true,
      fallback_reason: '图片供应商额度/频率或通道失败，已切换到本地可商用演员库候选。',
      provider_error: String(err.message || err).slice(0, 500),
      request_key: body.request_key || '',
    }));
  }
}));

router.get('/tasks/:id', (req, res) => {
  const bundle = service.publicTaskBundle(req.params.id);
  if (!bundle.task) return res.status(404).json({ success: false, error: '任务不存在' });
  res.json({ success: true, ...bundle });
});

router.post('/tasks/:id/scene-config', asyncRoute(async (req, res) => {
  const scene_config = await service.generateSceneConfig(req.params.id);
  res.json({ success: true, task_id: req.params.id, scene_config, bundle: service.publicTaskBundle(req.params.id) });
}));

router.post('/tasks/:id/blueprint', asyncRoute(async (req, res) => {
  const blueprint = await service.generateBlueprintStage(req.params.id);
  res.json({ success: true, task_id: req.params.id, blueprint, bundle: service.publicTaskBundle(req.params.id) });
}));

router.post('/tasks/:id/storyboard', asyncRoute(async (req, res) => {
  const result = await service.generateStoryboardStage(req.params.id);
  res.json({ success: true, task_id: req.params.id, ...result, bundle: service.publicTaskBundle(req.params.id) });
}));

router.post('/tasks/:id/keyframe-contract', asyncRoute(async (req, res) => {
  const keyframe_contracts = await service.buildKeyframeContractStage(req.params.id);
  res.json({ success: true, task_id: req.params.id, keyframe_contracts, bundle: service.publicTaskBundle(req.params.id) });
}));

router.post('/tasks/:id/keyframes', asyncRoute(async (req, res) => {
  const result = await service.generateKeyframesStage(req.params.id, req.body || {});
  res.json({
    success: true,
    task_id: req.params.id,
    ...result,
    note: '当前接口生成关键帧合同，供后续图片/视频生成模块消费。',
    bundle: service.publicTaskBundle(req.params.id),
  });
}));

router.post('/tasks/:id/tts', asyncRoute(async (req, res) => {
  const result = await service.generateTtsStage(req.params.id, req.body || {});
  res.json({ success: true, task_id: req.params.id, ...result, bundle: service.publicTaskBundle(req.params.id) });
}));

router.post('/tasks/:id/video', asyncRoute(async (req, res) => {
  const result = await service.generateVideoStage(req.params.id, req.body || {});
  res.json({ success: true, task_id: req.params.id, ...result, bundle: service.publicTaskBundle(req.params.id) });
}));

router.post('/tasks/:id/compose', asyncRoute(async (req, res) => {
  const result = await service.composeStage(req.params.id, req.body || {});
  res.json({ success: true, task_id: req.params.id, ...result, bundle: service.publicTaskBundle(req.params.id) });
}));

router.post('/storyboard', asyncRoute(async (req, res) => {
  const result = await service.runFull(req.body || {}, userFromReq(req));
  res.status(result.success ? 200 : 422).json(result);
}));

module.exports = router;
