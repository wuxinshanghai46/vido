const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const router = express.Router();
const sharedDigitalHumanRouter = require('./digitalHuman');
const service = require('../services/newStoryAd');
const storage = require('../services/newStoryAd/storageService');
const modelGateway = require('../services/newStoryAd/modelGateway');
const mediaAdapter = require('../services/newStoryAd/mediaAdapter');
const ttsAdapter = require('../services/newStoryAd/ttsAdapter');
const videoAdapter = require('../services/newStoryAd/videoAdapter');
const composeService = require('../services/newStoryAd/composeService');
const sceneAssetService = require('../services/newStoryAd/sceneAssetService');
const jobService = require('../services/newStoryAd/jobService');
const cancellation = require('../services/newStoryAd/cancellationContext');
const personIdentity = require('../services/newStoryAd/personIdentityContractService');
const db = require('../models/database');

function userFromReq(req) {
  return req.user || req.auth || {};
}

function asyncRoute(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      const requestId = uuidv4();
      console.error(`[new-story-ad] request failed request_id=${requestId} code=${err.code || 'INTERNAL_ERROR'}:`, String(err.message || err));
      res.status(err.status || 500).json({
        success: false,
        code: err.code || 'INTERNAL_ERROR',
        error: String(err.message || err),
        request_id: requestId,
        retryable: err.retryable === true,
        conflicts: err.conflicts || undefined,
        review: err.review || undefined,
        partial: err.partial || undefined,
        keyframes: err.keyframes || undefined,
        attempts: err.attempts || undefined,
      });
    }
  };
}

function forwardSharedOpenMusic(targetPath) {
  return (req, res, next) => {
    const originalUrl = req.url;
    const queryIndex = originalUrl.indexOf('?');
    const query = queryIndex >= 0 ? originalUrl.slice(queryIndex) : '';
    req.url = `${targetPath}${query}`;
    sharedDigitalHumanRouter.handle(req, res, err => {
      req.url = originalUrl;
      if (err) return next(err);
      if (!res.headersSent) return res.status(404).json({ success: false, error: '公开曲库能力不可用' });
      return undefined;
    });
  };
}

// 新剧情广告复用已经过商用许可过滤的公开曲库能力，但使用新版专属 URL，
// 避免再次依赖已下线的旧剧情广告入口。
router.get('/music/search', forwardSharedOpenMusic('/luxury-ad/open-music/search'));
router.post('/music/import', forwardSharedOpenMusic('/luxury-ad/open-music/import'));

function taskForReq(req) {
  return service.assertTaskOwner(req.params.id, userFromReq(req));
}

function adminOnly(req, res, next) {
  if (String(userFromReq(req).role || '').toLowerCase() !== 'admin') {
    return res.status(403).json({ success: false, code: 'ADMIN_REQUIRED', error: '逐镜头生成监控仅管理员可见' });
  }
  return next();
}

function monitorHealth(row = {}, now = Date.now()) {
  if (row.lifecycle === 'qa_passed') return 'passed';
  if (['qa_failed', 'failed', 'cancelled'].includes(row.lifecycle)) return 'failed';
  const active = ['queued', 'submitting', 'provider_submitted', 'provider_running', 'downloading', 'normalizing', 'generated', 'video_qa'];
  const heartbeat = Date.parse(row.last_heartbeat_at || row.updated_at || '') || 0;
  if (active.includes(row.lifecycle) && heartbeat && now - heartbeat > 120000) return 'suspected_stuck';
  if (row.provider_task_id && ['provider_submitted', 'provider_running', 'downloading'].includes(row.lifecycle)) return 'provider_running';
  if (active.includes(row.lifecycle)) return 'running';
  return 'pending';
}

function queueTaskStage(req, res, stage, execute, options = {}) {
  const task = taskForReq(req);
  const deadlineMs = typeof options.deadlineMs === 'function'
    ? options.deadlineMs(task)
    : options.deadlineMs;
  const queued = jobService.queueStage({
    taskId: task.id,
    stage,
    execute,
    deadlineMs,
  });
  return res.status(202).json({
    success: true,
    accepted: queued.accepted,
    duplicate: queued.duplicate,
    task_id: task.id,
    job: queued.job,
    task: service.taskSummary(storage.getTask(task.id)),
  });
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
    name: actor.name || patch.name || '剧情广告演员资产',
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
  const ageLabels = {
    match_brief: 'the age explicitly required by the campaign brief',
    young_adult_17_25: '17-25 years old',
    young_adult: '25-32 years old',
    adult_30_40: '30-40 years old',
    middle_40_55: '40-55 years old',
    senior_55_plus: '55 years old or above',
  };
  const age = String(spec.age || '').trim();
  const gender = String(spec.gender || '').trim();
  const origin = String(spec.origin || '').trim();
  const castMode = String(spec.castMode || spec.cast_mode || '').trim();
  return [
    'Strict live-action photorealistic full-body commercial actor casting reference. It must look like a real adult human photographed by a real camera, not an AI beauty poster.',
    'Natural skin pores, imperfect human expression, realistic hands, real fabric wrinkles, normal body proportions, believable commercial wardrobe, clean studio casting background.',
    'The actor must be reusable across multiple storyboard shots. Preserve face identity, age impression, hairstyle, body proportions and the exact same outfit across every generated view.',
    'Wardrobe consistency is mandatory: keep the same clothing category, color, fabric, cut, sleeve/hem length, shoes, accessories and styling in all views. If wardrobe is not specified, choose one simple commercial outfit and repeat that exact outfit in all views.',
    'Show full body from head to feet, realistic clothing and shoes, no cartoon, no anime, no 3D render, no waxy skin, no plastic face, no over-smoothed glamour retouching, no poster text.',
    brief ? `Campaign brief: ${String(brief).slice(0, 1200)}` : '',
    description ? `User actor description: ${String(description).slice(0, 800)}` : '',
    castMode ? `Cast mode lock: ${castMode}. This is a hard constraint.` : '',
    gender ? `Gender lock: ${gender}. This is a hard constraint.` : '',
    age ? `Age lock: ${ageLabels[age] || age}. This is a hard constraint. Do not depict another age group even if stale freeform text conflicts.` : '',
    origin ? `Origin/ethnicity lock: ${origin}. This is a hard constraint.` : '',
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
    side: 'View requirement: SIDE or three-quarter profile full-body casting reference of the same actor, same face identity, same age impression, same body proportions and the exact same outfit, both feet visible.',
    back: 'View requirement: BACK full-body casting reference of the same actor, same hairstyle, same body proportions and the exact same outfit, both feet visible.',
    action: 'View requirement: NATURAL COMMERCIAL ACTION POSE full-body casting reference of the same actor. Use only a subtle presenting gesture or walking-ready pose in the same studio. Keep the exact same outfit, shoes, accessories, hairstyle, body proportions and identity. This is not a storyboard scene.',
  };
  return [
    basePrompt,
    viewPrompts[view] || viewPrompts.front,
    'Background rule: every view must use the exact same clean light-gray studio casting background. No showroom, no interior scene, no product wall, no furniture, no props, no text, no logo, no environmental storytelling.',
    'Wardrobe lock rule: all four views must show the same exact clothing items, color, fabric, cut, sleeve/hem length, shoes and accessories. Do not change into another dress, shirt, jacket, pants, skirt, shoes, jewelry or styling between views.',
    'Consistency rule: this image is one view of a four-view actor package. Keep the actor identity, age, body type, hairstyle, exact outfit and realism consistent across all views.',
  ].filter(Boolean).join('\n\n');
}

function buildActorSheetPrompt(basePrompt = '') {
  return [
    basePrompt,
    'Generate one single 2x2 actor casting reference sheet, not four separate images.',
    'Panel order is mandatory: top-left FRONT full body, top-right SIDE or three-quarter full body, bottom-left BACK full body, bottom-right SUBTLE COMMERCIAL ACTION POSE full body.',
    'Every panel must show the same adult actor identity, same face, same age impression, same body proportions, same hairstyle, and the exact same outfit.',
    'Wardrobe lock is mandatory across all four panels: identical clothing items, color, fabric, cut, sleeve length, hem length, shoes, accessories and styling. Do not change clothing in the action pose.',
    'Use the same clean light-gray studio casting background in all panels. No showroom, no interior scene, no product wall, no furniture, no props, no text, no labels, no logo, no watermark.',
    'Each panel should be a full-body casting photo from head to feet, realistic hands and feet, natural commercial expression, no cartoon, no anime, no 3D render, no beauty poster.',
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
    'new_story_ad.scene_asset',
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
    candidates: Object.fromEntries(stages.map((stage) => {
      const rows = stage === 'new_story_ad.video'
        ? videoAdapter.videoCandidates({})
        : ['new_story_ad.person_sheet', 'new_story_ad.scene_asset', 'new_story_ad.keyframe'].includes(stage)
          ? mediaAdapter.availableImageCandidates(stage)
          : stage === 'new_story_ad.tts'
            ? []
            : modelGateway.candidatesForStage(stage);
      return [stage, rows.map(m => `${m.provider_id}/${m.model_id}`)];
    })),
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

router.get('/assets/:filename', asyncRoute(async (req, res) => {
  const filePath = mediaAdapter.assetPathFromName(req.params.filename);
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ success: false, error: '资产不存在' });
  const thumb = req.query.thumb || req.query.w || req.query.width;
  if (thumb) {
    const thumbPath = await mediaAdapter.ensureAssetThumbnail(req.params.filename, thumb);
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    res.type('image/webp');
    return res.sendFile(thumbPath);
  }
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.sendFile(filePath);
}));

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

router.get('/tasks', asyncRoute(async (req, res) => {
  const user = userFromReq(req);
  const canListAll = String(user.role || '').toLowerCase() === 'admin' && String(req.query.all || '') === '1';
  const result = service.listTaskSummaries({
    limit: req.query.limit || 50,
    page: req.query.page || 1,
    status: req.query.status || '',
    userId: canListAll ? '' : (user.id || user.userId || ''),
  });
  res.json({
    success: true,
    ...result,
  });
}));

router.post('/tasks', asyncRoute(async (req, res) => {
  const created = service.createTask(req.body || {}, userFromReq(req));
  res.json({ success: true, ...created });
}));

router.delete('/tasks/:id', asyncRoute(async (req, res) => {
  const task = taskForReq(req);
  const user = userFromReq(req);
  const cancelled = jobService.cancelJob(task.id, {
    cancelledBy: user.id || user.userId || user.username || '',
  });
  const deleted = storage.deleteTask(task.id);
  if (!deleted) {
    const err = new Error('任务不存在或已被删除');
    err.status = 404;
    err.code = 'TASK_NOT_FOUND';
    throw err;
  }
  res.json({
    success: true,
    deleted: true,
    task_id: task.id,
    cancelled_running_job: cancelled.cancelled === true,
  });
}));

router.put('/tasks/:id', asyncRoute(async (req, res) => {
  taskForReq(req);
  const updated = service.updateTaskRequest(req.params.id, req.body || {}, userFromReq(req));
  res.json({ success: true, ...updated });
}));

router.put('/tasks/:id/blueprint', asyncRoute(async (req, res) => {
  taskForReq(req);
  const body = req.body || {};
  const blueprint = service.updateBlueprint(req.params.id, body.blueprint || body || {}, userFromReq(req));
  res.json({ success: true, task_id: req.params.id, blueprint });
}));

router.put('/tasks/:id/storyboard', asyncRoute(async (req, res) => {
  taskForReq(req);
  const body = req.body || {};
  const result = service.updateStoryboardTable(req.params.id, body.shots || body.storyboard_table || [], userFromReq(req));
  res.json({ success: true, task_id: req.params.id, ...result });
}));

router.post('/assist', asyncRoute(async (req, res) => {
  const result = await service.assistBrief(req.body || {}, userFromReq(req));
  res.json({ success: true, ...result });
}));

router.post('/person-sheet', asyncRoute(async (req, res) => {
  const body = req.body || {};
  const user = userFromReq(req);
  const generationId = String(body.generation_id || body.generationId || uuidv4());
  const ownerId = String(user.id || user.userId || user.username || 'anonymous');
  return cancellation.run({ generationId, taskId: body.task_id || body.taskId || '', stage: 'person_sheet', ownerId }, async () => {
  const userId = user.id || user.username || 'anonymous';
  const brief = String(body.brief || body.content || '').trim();
  if (brief.length < 6) {
    return res.status(400).json({ success: false, error: '请先填写广告需求，再生成剧情广告人物演员包' });
  }
  const spec = body.person_spec && typeof body.person_spec === 'object' ? body.person_spec : {};
  const context = body.person_context && typeof body.person_context === 'object' ? body.person_context : {};
  const gender = requestedGender(spec, `${brief} ${body.description || ''}`);
  const castMode = String(spec.castMode || spec.cast_mode || '').trim() || 'single';
  const requestedPeople = Number(spec.expected_people || spec.expectedPeople || spec.person_count || body.expected_people || body.expectedPeople || 0) || 0;
  const expectedPeople = requestedPeople > 0
    ? Math.max(1, Math.min(12, Math.round(requestedPeople)))
    : (castMode === 'dual' ? 2 : (castMode === 'single' ? 1 : 0));
  const actorId = `new_story_actor_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const description = buildActorDescription({
    brief,
    description: body.description,
    spec,
    context,
  });
  try {
    const viewKeys = ['front', 'side', 'back', 'action'];
    const sheet = await mediaAdapter.generateActorReference({
      filename: `actor_${actorId}_sheet_${Date.now()}`,
      prompt: buildActorSheetPrompt(description),
      aspectRatio: '3:4',
      imageModel: body.image_model || body.imageModel || 'auto',
    });
    const viewImages = await mediaAdapter.splitActorSheet({
      source: sheet,
      filenamePrefix: `actor_${actorId}`,
      viewKeys,
    });
    cancellation.throwIfCancelled();
    const extraImages = viewImages.slice(1).map(v => v.url).filter(Boolean);
    const providerUsed = [...new Set(viewImages.map(v => v.provider_used).filter(Boolean))].join(', ');
    const personContract = await personIdentity.verifyPersonAsset({
      taskId: body.task_id || body.taskId || generationId,
      asset: {
        id: `actor_asset_${actorId}`,
        actor_id: actorId,
        gender,
        cast_mode: castMode,
        expected_people: expectedPeople,
        image_url: viewImages[0]?.url || '',
        view_images: viewImages,
        description,
      },
      spec,
      revision: 1,
    });
    const actorAsset = ensureActorAssetForUser(PUBLIC_ACTOR_USER_ID, {
      id: `actor_asset_${actorId}`,
      actor_asset_id: `actor_asset_${actorId}`,
      actor_id: actorId,
      name: '剧情广告拟真演员',
      source: 'new_story_ad_actor_sheet',
      reference_kind: 'synthetic_realistic_actor',
      production_usable_actor: personContract.status === 'verified',
      is_ai_generated: true,
      gender,
      cast_mode: castMode,
      expected_people: expectedPeople,
      person_count: expectedPeople,
      image_url: viewImages[0]?.url || '',
      extra_image_urls: extraImages,
      view_images: viewImages,
      view_count: viewImages.length,
      person_revision: personContract.person_revision,
      person_contract: personContract,
      description,
      prompt: description,
    }, {
      generated_by: 'new_story_ad.person_sheet',
      provider_used: providerUsed,
      actor_sheet_url: normalizeLocalPublicUrl(sheet.image_url || sheet.url || ''),
      request_key: body.request_key || '',
    });
    return res.json(actorPayload(actorAsset, {
      status: 'done',
      generated: true,
      fallback_used: false,
      public_actor_library: true,
      provider_used: providerUsed,
      request_key: body.request_key || '',
      verification_status: personContract.status,
      person_contract: personContract,
    }));
  } catch (err) {
    if (err?.code === 'USER_CANCELLED' || err?.cancelled === true) throw err;
    const allowActorLibraryFallback = body.allow_actor_library_fallback === true || body.allowActorLibraryFallback === true;
    if (!allowActorLibraryFallback) {
      err.status = err.status || 503;
      err.code = err.code || 'NEW_STORY_PERSON_SHEET_PROVIDER_FAILED';
      throw err;
    }
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
  });
}));

router.post('/generations/:generationId/cancel', asyncRoute(async (req, res) => {
  const user = userFromReq(req);
  const ownerId = String(user.id || user.userId || user.username || 'anonymous');
  const result = cancellation.cancelActive(req.params.generationId, { ownerId, cancelledBy: ownerId });
  if (result.forbidden) return res.status(403).json({ success: false, code: 'FORBIDDEN', error: '无权取消该生成任务' });
  res.json({ success: true, ...result });
}));

router.post('/tasks/:id/scene-assets', asyncRoute(async (req, res) => {
  const body = req.body || {};
  return queueTaskStage(req, res, 'scene_asset', () => sceneAssetService.generateSceneAsset(req.params.id, body));
}));

router.post('/tasks/:id/person-verify', asyncRoute(async (req, res) => {
  taskForReq(req);
  const result = await service.verifyPersonContract(req.params.id);
  res.json({ success: true, task_id: req.params.id, ...result });
}));

router.post('/tasks/:id/product-verify', asyncRoute(async (req, res) => {
  taskForReq(req);
  const result = await service.verifyProductContract(req.params.id);
  res.json({ success: true, task_id: req.params.id, ...result });
}));

router.put('/tasks/:id/scene-assets', asyncRoute(async (req, res) => {
  taskForReq(req);
  const body = req.body || {};
  const sceneAssets = sceneAssetService.saveSceneAssetsToTask(req.params.id, body.scene_assets || body.sceneAssets || []);
  res.json({
    success: true,
    task_id: req.params.id,
    scene_assets: sceneAssets,
  });
}));

router.post('/tasks/:id/scene-assets/:sceneId/verify', asyncRoute(async (req, res) => {
  taskForReq(req);
  const result = await sceneAssetService.reverifySceneAsset(req.params.id, req.params.sceneId);
  res.json({ success: true, task_id: req.params.id, ...result });
}));

router.get('/tasks/:id', asyncRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  taskForReq(req);
  const bundle = service.publicTaskBundle(req.params.id);
  if (!bundle.task) return res.status(404).json({ success: false, error: '任务不存在' });
  res.json({ success: true, ...bundle });
}));

router.post('/tasks/:id/cancel', asyncRoute(async (req, res) => {
  const task = taskForReq(req);
  const user = userFromReq(req);
  const result = jobService.cancelJob(task.id, {
    generationId: req.body?.generation_id || req.body?.generationId || '',
    cancelledBy: user.id || user.userId || user.username || '',
  });
  if (result.conflict) {
    return res.status(409).json({
      success: false,
      code: 'GENERATION_CHANGED',
      error: '当前生成任务已变化，请刷新后再取消',
      job: result.job,
      task: service.taskSummary(storage.getTask(task.id)),
    });
  }
  res.json({
    success: true,
    ...result,
    task_id: task.id,
    task: service.taskSummary(storage.getTask(task.id)),
  });
}));

router.get('/tasks/:id/diagnostics', asyncRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  taskForReq(req);
  const bundle = service.publicTaskBundle(req.params.id, { diagnostics: true });
  res.json({
    success: true,
    task_id: req.params.id,
    stages: bundle.stages,
    model_calls: bundle.model_calls,
    reviews: bundle.reviews,
  });
}));

router.post('/tasks/:id/scene-config', asyncRoute(async (req, res) => {
  return queueTaskStage(req, res, 'scene_config', () => service.generateSceneConfig(req.params.id));
}));

router.post('/tasks/:id/blueprint', asyncRoute(async (req, res) => {
  return queueTaskStage(req, res, 'blueprint', () => service.generateBlueprintStage(req.params.id));
}));

router.post('/tasks/:id/storyboard', asyncRoute(async (req, res) => {
  return queueTaskStage(req, res, 'storyboard', () => service.generateStoryboardStage(req.params.id));
}));

router.post('/tasks/:id/keyframe-contract', asyncRoute(async (req, res) => {
  taskForReq(req);
  const keyframe_contracts = await service.buildKeyframeContractStage(req.params.id);
  res.json({ success: true, task_id: req.params.id, keyframe_contracts });
}));

router.post('/tasks/:id/keyframes', asyncRoute(async (req, res) => {
  const body = req.body || {};
  return queueTaskStage(
    req,
    res,
    'keyframes',
    job => service.generateKeyframesStage(req.params.id, { ...body, generation_id: job.generationId }),
    { deadlineMs: task => service.keyframeStageBudgetMs(task.id, body) },
  );
}));

router.post('/tasks/:id/prompt-preview', asyncRoute(async (req, res) => {
  taskForReq(req);
  const preview = service.previewShotPrompts(req.params.id, req.body || {});
  res.json({ success: true, task_id: req.params.id, ...preview });
}));

router.put('/tasks/:id/keyframes/:index/select', asyncRoute(async (req, res) => {
  taskForReq(req);
  const result = service.selectKeyframeCandidate(req.params.id, req.params.index, req.body?.candidate_id || req.body?.candidateId || '');
  res.json({ success: true, task_id: req.params.id, ...result });
}));

router.post('/tasks/:id/keyframes/:index/candidates/:candidateId/manual-accept', asyncRoute(async (req, res) => {
  taskForReq(req);
  const result = service.acceptKeyframeCandidateOverride(
    req.params.id,
    req.params.index,
    req.params.candidateId,
    req.body || {},
    userFromReq(req),
  );
  res.json({ success: true, task_id: req.params.id, ...result });
}));

router.post('/tasks/:id/keyframes/:index/candidates/:candidateId/review', asyncRoute(async (req, res) => {
  taskForReq(req);
  const result = await service.retryKeyframeCandidateQa(req.params.id, req.params.index, req.params.candidateId);
  res.json({ success: true, task_id: req.params.id, ...result });
}));

router.post('/tasks/:id/tts', asyncRoute(async (req, res) => {
  const body = req.body || {};
  return queueTaskStage(req, res, 'tts', () => service.generateTtsStage(req.params.id, body));
}));

router.post('/tasks/:id/video', asyncRoute(async (req, res) => {
  const body = req.body || {};
  return queueTaskStage(req, res, 'video', () => service.generateVideoStage(req.params.id, body));
}));

router.post('/tasks/:id/compose', asyncRoute(async (req, res) => {
  const body = req.body || {};
  return queueTaskStage(req, res, 'compose', () => service.composeStage(req.params.id, body));
}));

router.get('/admin/tasks/:id/video-monitor', adminOnly, asyncRoute(async (req, res) => {
  const task = storage.getTask(req.params.id);
  if (!task) return res.status(404).json({ success: false, error: '任务不存在' });
  const storyboard = storage.getOutput(task.id, 'storyboard_table') || [];
  const contracts = storage.getOutput(task.id, 'keyframe_contracts') || [];
  const clips = storage.getOutput(task.id, 'video_clips') || [];
  const repairHistory = storage.getOutput(task.id, 'video_repair_history') || [];
  const pipelinePolicy = storage.getOutput(task.id, 'video_pipeline_policy') || null;
  const context = storage.getOutput(task.id, 'context') || task.request || {};
  const statuses = videoAdapter.listVideoShotStatuses(task.id, storyboard.length);
  const now = Date.now();
  const shots = Array.from({ length: Math.max(storyboard.length, statuses.length, clips.length) }, (_, index) => {
    const clip = clips[index] || {};
    const hasOutput = !!(clip.video_url || clip.videoUrl || clip.file_path);
    const legacyFailed = !!clip.error_code || clip.qa?.pass === false || clip.cross_shot_qa?.pass === false;
    const inferredLifecycle = legacyFailed
      ? 'qa_failed'
      : (clip.qa?.pass === true ? 'qa_passed' : (hasOutput ? 'generated' : 'pending'));
    const row = statuses[index] || {
      shot_index: index,
      index: index + 1,
      lifecycle: inferredLifecycle,
      provider_task_id: clip.provider_task_id || '',
      provider_status: clip.provider_status || '',
      error: clip.error || '',
      error_code: clip.error_code || '',
      qa_status: clip.qa?.pass === true ? 'passed' : (legacyFailed ? 'failed' : ''),
      legacy_inferred: true,
    };
    const filePath = row.file_path || clip.file_path || '';
    return {
      ...row,
      shot_index: index,
      index: index + 1,
      title: row.title || storyboard[index]?.title || contracts[index]?.title || `镜头 ${index + 1}`,
      health: monitorHealth(row, now),
      file_path: filePath,
      file_exists: !!(filePath && fs.existsSync(filePath)),
      video_url: row.video_url || clip.video_url || clip.videoUrl || '',
      provider_used: clip.provider_used || [row.provider_id, row.model_id].filter(Boolean).join('/'),
      qa: clip.qa || null,
      cross_shot_qa: clip.cross_shot_qa || null,
      repair_attempt: Number(clip.repair_attempt || row.repair_attempt || 0),
      pipeline_policy_version: clip.pipeline_policy_version || pipelinePolicy?.version || '',
      lineage_fingerprint: clip.lineage_fingerprint || '',
    };
  });
  const bundle = service.publicTaskBundle(task.id, { diagnostics: true, includeVideoMonitor: true });
  const summary = service.taskSummary(task);
  res.json({
    success: true,
    task_id: task.id,
    task: summary,
    actor: {
      name: context.person_asset?.name || context.person_spec?.displayName || context.person_spec?.roleName || '',
      asset_id: context.person_asset?.id || context.person_asset?.actor_id || '',
      verified: context.person_contract?.status === 'verified',
    },
    generation_progress: summary.generation_progress || null,
    shots,
    repair_history: repairHistory,
    pipeline_policy: pipelinePolicy,
    stages: bundle.stages,
    model_calls: bundle.model_calls,
    generated_at: new Date(now).toISOString(),
  });
}));

router.post('/tasks/:id/media', asyncRoute(async (req, res) => {
  const body = req.body || {};
  return queueTaskStage(req, res, 'media', async () => {
    // Video owns the idempotent TTS decision: matching voice tracks are reused,
    // missing/outdated tracks are generated, and silent mode skips TTS. Keeping
    // all media stages in one server job means closing the browser cannot stop
    // the transition from video generation to final composition.
    await service.generateVideoStage(req.params.id, { ...body, missing_only: true });
    await service.composeStage(req.params.id, body);
  }, { deadlineMs: 60 * 60 * 1000 });
}));

router.post('/storyboard', asyncRoute(async (req, res) => {
  const created = service.createTask(req.body || {}, userFromReq(req));
  req.params.id = created.task.id;
  return queueTaskStage(req, res, 'full', async () => {
    await service.generateSceneConfig(created.task.id);
    await service.generateBlueprintStage(created.task.id);
    await service.generateStoryboardStage(created.task.id);
  });
}));

module.exports = router;

// Exported for focused regression tests without changing the router contract.
module.exports.buildActorDescription = buildActorDescription;
