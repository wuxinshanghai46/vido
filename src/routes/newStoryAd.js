const express = require('express'), fs = require('fs'), path = require('path');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const router = express.Router();
const sharedDigitalHumanRouter = require('./digitalHuman');
const service = require('../services/newStoryAd'), storage = require('../services/newStoryAd/storageService');
const modelGateway = require('../services/newStoryAd/modelGateway'), mediaAdapter = require('../services/newStoryAd/mediaAdapter');
const ttsAdapter = require('../services/newStoryAd/ttsAdapter'), videoAdapter = require('../services/newStoryAd/videoAdapter');
const composeService = require('../services/newStoryAd/composeService'), sceneAssetService = require('../services/newStoryAd/sceneAssetService');
const scenePanoramaService = require('../services/newStoryAd/scenePanoramaService'), jobService = require('../services/newStoryAd/jobService');
const mediaPipeline = require('../services/newStoryAd/mediaPipelineService');
const cancellation = require('../services/newStoryAd/cancellationContext'), taskProgressProjection = require('../services/newStoryAd/taskProgressProjectionService');
const personIdentity = require('../services/newStoryAd/personIdentityContractService'), productAssetGeneration = require('../services/newStoryAd/productAssetGenerationService');
const subjectAssets = require('../services/newStoryAd/subjectAssetBundleService'), personAssetLifecycle = require('../services/newStoryAd/personAssetLifecycleService');
const visualAssetProgress = require('../services/newStoryAd/visualAssetProgressService');
const visualAssetOrchestration = require('../services/newStoryAd/visualAssetOrchestrationService');
const visualAssetBillingAuthorization = require('../services/newStoryAd/visualAssetBillingAuthorizationService');
const referenceVideoAnalyses = require('../services/newStoryAd/referenceVideoAnalysisService');
const referenceAnalysisTaskSync = require('../services/newStoryAd/referenceAnalysisTaskSyncService');
const referenceDetach = require('../services/newStoryAd/referenceDetachService');
const generationPermit = require('../services/newStoryAd/generationPermitService');
const personDossiers = require('../services/newStoryAd/personDossierService'), propAssetService = require('../services/newStoryAd/propAssetService'), registerPropRoutes = require('./newStoryAd/propRoutes');
const subjectAssetPersistence = require('./newStoryAd/subjectAssetPersistence');
const personProviderAssets = require('../services/newStoryAd/personProviderAssetLifecycleService');
const registerPersonDossierApprovalRoute = require('./newStoryAd/personDossierApprovalRoute');
const registerTaskUpdateRoute = require('./newStoryAd/taskUpdateRoute');
const registerVisualAssetBillingRoutes = require('./newStoryAd/visualAssetBillingRoutes');
const { registerVideoMonitorRoute } = require('./newStoryAd/videoMonitorRoute');
const directorWorkspace = require('../services/newStoryAd/directorWorkspaceService');
const paidExecutionPolicy = require('../services/newStoryAd/paidVideoExecutionPolicyService');
const visualRealismPolicy = require('../services/newStoryAd/visualRealismPolicyService');
const videoCore = require('../services/videoGenerationCore');
const db = require('../models/database');
function userFromReq(req) {
  return req.user || req.auth || {};
}
/** 统一捕获剧情广告接口异常，并保证所有用户可见错误均为中文。 */
function asyncRoute(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      const requestId = uuidv4();
      console.error(`[new-story-ad] request failed request_id=${requestId} code=${err.code || 'INTERNAL_ERROR'}:`, String(err.message || err));
      const publicError = videoCore.chineseError.ensureChineseError(err);
      res.status(publicError.status || 500).json({
        success: false,
        code: publicError.code || 'INTERNAL_ERROR',
        error: String(publicError.message),
        request_id: requestId,
        retryable: publicError.retryable === true,
        conflicts: publicError.conflicts || undefined,
        review: publicError.review || undefined,
        partial: publicError.partial || undefined,
        keyframes: publicError.keyframes || undefined,
        attempts: publicError.attempts || undefined,
        preflight: publicError.preflight || undefined,
        details: publicError.details || undefined,
        content_revision: err.content_revision || err.actual_content_revision || undefined,
        acknowledged_client_edit_seq: err.acknowledged_client_edit_seq || undefined,
        active_generation_id: err.active_generation_id || undefined,
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

function queueTaskStage(req, res, stage, execute, options = {}) {
  let task = taskForReq(req);
  const body = req.body || {};
  let snapshotId = String(body.snapshot_id || body.snapshotId || '');
  let expectedContentRevision = Math.max(0, Number(body.expected_content_revision || body.expectedContentRevision || 0) || 0);
  let inputFingerprint = String(body.input_fingerprint || body.inputFingerprint || '');
  if (!snapshotId && task.lineage_enforced === true) {
    const prepared = service.prepareGeneration(task.id, {
      expected_content_revision: expectedContentRevision || task.content_revision,
      client_edit_seq: task.latest_client_edit_seq || 0,
      target_stage: stage,
    }, userFromReq(req));
    snapshotId = prepared.snapshot_id;
    expectedContentRevision = prepared.content_revision;
    inputFingerprint = prepared.input_fingerprint;
    task = storage.getTask(task.id);
  }
  const deadlineMs = typeof options.deadlineMs === 'function'
    ? options.deadlineMs(task)
    : options.deadlineMs;
  const requestKey = String(body.request_key || body.requestKey || '').trim().slice(0, 180);
  const semanticTarget = String(
    body.scene_id || body.sceneId || body.space_id || body.spaceId
    || body.shot_id || body.shotId || body.shot_index || body.shotIndex || '',
  ).trim().slice(0, 120);
  const defaultIdempotencyKey = [
    task.id,
    stage,
    semanticTarget ? `target:${semanticTarget}` : '',
    `r${expectedContentRevision || task.content_revision || 1}`,
  ].filter(Boolean).join(':');
  const idempotencyKey = String(body.idempotency_key || body.idempotencyKey
    || (requestKey ? `${task.id}:${stage}:request:${requestKey}` : defaultIdempotencyKey));
  const permit = generationPermit.issue(task.id, stage, { idempotencyKey });
  const queued = jobService.queueStage({
    taskId: task.id,
    stage,
    execute: permit
      ? (job => {
        generationPermit.consume(task.id, permit);
        return execute({ ...job, generationPermit: permit });
      })
      : execute,
    deadlineMs,
    failureContext: typeof options.failureContext === 'function'
      ? options.failureContext(task)
      : (options.failureContext || {}),
    expectedContentRevision: expectedContentRevision || task.content_revision || 1,
    snapshotId,
    inputFingerprint,
    idempotencyKey,
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

const referenceVideoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const staging = path.join(referenceVideoAnalyses.ROOT_DIR, '_uploads');
      fs.mkdirSync(staging, { recursive: true });
      cb(null, staging);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.bin';
      cb(null, `reference_video_${Date.now()}_${uuidv4().slice(0, 8)}${ext}`);
    },
  }),
  limits: { fileSize: referenceVideoAnalyses.MAX_FILE_BYTES },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mime = String(file.mimetype || '').toLowerCase();
    cb(null, ['.mp4', '.mov', '.webm'].includes(ext) && (mime.startsWith('video/') || mime === 'application/octet-stream'));
  },
});

const referenceVideoChunkUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const staging = path.join(referenceVideoAnalyses.ROOT_DIR, '_chunk_staging');
      fs.mkdirSync(staging, { recursive: true });
      cb(null, staging);
    },
    filename: (req, file, cb) => cb(null, `chunk_${Date.now()}_${uuidv4().slice(0, 8)}.part`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 + 1024 },
});

const realPersonUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const staging = path.join(personDossiers.ROOT_DIR, '_uploads');
      fs.mkdirSync(staging, { recursive: true });
      cb(null, staging);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.bin';
      cb(null, `real_person_${Date.now()}_${uuidv4().slice(0, 8)}${ext}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mime = String(file.mimetype || '').toLowerCase();
    cb(null, ['.png', '.jpg', '.jpeg', '.webp'].includes(ext) && mime.startsWith('image/'));
  },
});

/** 执行单文件上传，并把 Multer 技术错误转换为中文。 */
function uploadSingle(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ success: false, error: '文件超过 50MB，请压缩后再上传' });
    }
    const publicError = videoCore.chineseError.ensureChineseError(err, { code: 'INVALID_ARGUMENT', status: 400, fallback: '文件上传失败，请检查文件格式后重试。' });
    return res.status(400).json({ success: false, code: publicError.code, error: publicError.message });
  });
}

function uploadReferenceVideo(req, res, next) {
  referenceVideoUpload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        success: false,
        code: 'REFERENCE_VIDEO_TOO_LARGE',
        error: '参考视频不能超过 200MB',
      });
    }
    const publicError = videoCore.chineseError.ensureChineseError(err, {
      code: 'INVALID_ARGUMENT',
      status: 400,
      fallback: '参考视频上传失败，请检查格式后重试。',
    });
    return res.status(400).json({ success: false, code: publicError.code, error: publicError.message });
  });
}

function uploadReferenceVideoChunk(req, res, next) {
  referenceVideoChunkUpload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        success: false,
        code: 'REFERENCE_VIDEO_CHUNK_TOO_LARGE',
        error: '单个参考视频分片不能超过 5MB',
      });
    }
    return res.status(400).json({
      success: false,
      code: 'REFERENCE_VIDEO_CHUNK_UPLOAD_FAILED',
      error: '参考视频分片上传失败',
    });
  });
}

function uploadRealPersonSource(req, res, next) {
  realPersonUpload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        success: false,
        code: 'REAL_PERSON_SOURCE_TOO_LARGE',
        error: '单张真人来源图片不能超过 20MB',
      });
    }
    return res.status(400).json({
      success: false,
      code: 'REAL_PERSON_SOURCE_UPLOAD_FAILED',
      error: '真人来源上传失败，请使用 PNG、JPG 或 WebP 图片',
    });
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
    infant_0_1: '0-1 year old infant',
    toddler_1_3: '1-3 year old toddler',
    child_4_7: '4-7 year old child',
    child_8_12: '8-12 year old child',
    teen_13_17: '13-17 year old teenager',
    match_brief: 'the age explicitly required by the campaign brief',
    young_adult_17_25: '18-25 years old adult',
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
    'Strict live-action photorealistic commercial casting reference. The subject must look like a real human photographed by a real camera at the exact locked age, not an AI beauty poster.',
    visualRealismPolicy.personRealismPrompt(),
    visualRealismPolicy.image2CompliancePrompt(),
    'Use realistic hands, real fabric wrinkles, normal body proportions, believable commercial wardrobe and a clean studio casting background.',
    'The actor must be reusable across multiple storyboard shots. Preserve face identity, age impression, hairstyle, body proportions and the exact same outfit across every generated view.',
    'Wardrobe consistency is mandatory: keep the same clothing category, color, fabric, cut, sleeve/hem length, shoes, accessories and styling in all views. If wardrobe is not specified, choose one simple commercial outfit and repeat that exact outfit in all views.',
    'The package must include frontal, side, back and natural action full-body references. Show the complete actor, clothing and shoes in every view; no cartoon, anime, 3D render, poster text or watermark.',
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
    front: 'View requirement: FRONT full-body casting reference of the same actor, standing naturally, facing the camera, both eyes visible, complete clothing and both feet visible.',
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
    'All four panels must be full-body casting photos from head to feet with realistic hands and feet. Use natural commercial expressions throughout; no cartoon, anime, 3D render, beauty poster, face smoothing or waxy/plastic skin.',
  ].filter(Boolean).join('\n\n');
}

router.get('/health', (req, res) => {
  const stages = [
    'new_story_ad.asset_plan', 'new_story_ad.scene_config',
    'new_story_ad.blueprint',
    'new_story_ad.storyboard_table',
    'new_story_ad.storyboard_rewrite',
    'new_story_ad.qa',
    'new_story_ad.json_repair',
    'new_story_ad.assist',
    'new_story_ad.person_sheet',
    'new_story_ad.scene_asset',
    'new_story_ad.scene_panorama',
    'new_story_ad.scene_panorama_qa',
    'new_story_ad.scene_depth',
    'new_story_ad.scene_spatial_reconstruction',
    'new_story_ad.scene_spatial_qa',
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
    runtime_policy: service.storyAdV3RuntimePolicy(),
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

router.post('/reference-video-upload-sessions', asyncRoute(async (req, res) => {
  const session = referenceVideoAnalyses.createUploadSession({
    body: req.body || {},
    user: userFromReq(req),
  });
  return res.status(201).json({ success: true, session });
}));

router.post('/reference-video-upload-sessions/:sessionId/chunks/:index', uploadReferenceVideoChunk, asyncRoute(async (req, res) => {
  if (!req.file) {
    return res.status(422).json({ success: false, code: 'REFERENCE_VIDEO_CHUNK_REQUIRED', error: '参考视频分片为空' });
  }
  try {
    const session = referenceVideoAnalyses.saveUploadChunk(
      req.params.sessionId,
      req.params.index,
      req.file,
      userFromReq(req),
    );
    return res.json({ success: true, session });
  } catch (error) {
    try { if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); } catch {}
    throw error;
  }
}));

router.post('/reference-video-upload-sessions/:sessionId/complete', asyncRoute(async (req, res) => {
  const completed = await referenceVideoAnalyses.completeUploadSession(req.params.sessionId, userFromReq(req));
  return res.status(201).json({ success: true, ...completed });
}));

router.delete('/reference-video-upload-sessions/:sessionId', asyncRoute(async (req, res) => {
  const cancelled = referenceVideoAnalyses.cancelUploadSession(req.params.sessionId, userFromReq(req));
  return res.json({ success: true, ...cancelled });
}));

function referenceTaskId(body = {}) {
  return String(body.task_id || body.taskId || '').trim();
}

function upsertActorAssetForUser(userId, actor = {}, patch = {}) {
  return personProviderAssets.upsertActorAsset({ db, userId, actor, patch, ensureActor: ensureActorAssetForUser });
}

function persistProviderPersonIds(userId, context = {}) {
  return personProviderAssets.persistProviderPersonIds({ context, upsert: (actor, patch) => upsertActorAssetForUser(userId, actor, patch) });
}

function assertReferenceReplacementAllowed(taskId, user) {
  if (!taskId) return null;
  const task = service.assertTaskOwner(taskId, user);
  if (task.active_generation_id) {
    const error = new Error('当前生成正在使用已锁定内容；请先取消或等待生成完成，再更换参考视频');
    error.code = 'GENERATION_ACTIVE_EDIT_BLOCKED';
    error.status = 409;
    error.retryable = false;
    throw error;
  }
  return task;
}

/** 在接口返回前先把新分析 ID 绑定当前任务，避免页面延迟时继续显示旧视频。 */
function bindInitialReferenceTask(taskId, analysis, user) {
  if (!taskId || !analysis?.id) return null;
  const current = storage.getOutput(taskId, 'context') || storage.getTask(taskId)?.request || {};
  const previous = current.reference_video_analysis || {};
  const previousCreatedAt = Date.parse(previous.created_at || '') || 0;
  const nextCreatedAt = Date.parse(analysis.created_at || '') || 0;
  if (previous.analysis_id && previous.analysis_id !== analysis.id
    && previousCreatedAt && nextCreatedAt && previousCreatedAt > nextCreatedAt) {
    try { referenceVideoAnalyses.cancel(analysis.id, user); } catch {}
    return null;
  }
  return service.updateTaskRequest(taskId, {
    reference_video_analysis: referenceVideoAnalyses.taskRecord(analysis),
  }, user);
}

router.post('/reference-video-links', asyncRoute(async (req, res) => {
  const user = userFromReq(req);
  const taskId = referenceTaskId(req.body || {});
  assertReferenceReplacementAllowed(taskId, user);
  const analysis = await referenceVideoAnalyses.createFromUrl({
    body: req.body || {},
    user,
  });
  const taskMutation = bindInitialReferenceTask(taskId, analysis, user);
  return res.status(202).json({ success: true, analysis, task_bound: Boolean(taskMutation), task_mutation: taskMutation });
}));

router.post('/reference-video-analyses', uploadReferenceVideo, asyncRoute(async (req, res) => {
  if (!req.file) {
    return res.status(422).json({
      success: false,
      code: 'REFERENCE_VIDEO_FORMAT_UNSUPPORTED',
      error: '请选择 MP4、MOV 或 WebM 参考视频',
    });
  }
  try {
    const user = userFromReq(req);
    const taskId = referenceTaskId(req.body || {});
    assertReferenceReplacementAllowed(taskId, user);
    const analysis = await referenceVideoAnalyses.create({
      file: req.file,
      body: req.body || {},
      user,
    });
    const taskMutation = bindInitialReferenceTask(taskId, analysis, user);
    return res.status(201).json({ success: true, analysis, task_bound: Boolean(taskMutation), task_mutation: taskMutation });
  } catch (error) {
    try { if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); } catch {}
    throw error;
  }
}));

router.post('/reference-video-analyses/:analysisId/start', asyncRoute(async (req, res) => {
  const started = referenceVideoAnalyses.start(req.params.analysisId, userFromReq(req));
  return res.status(202).json({ success: true, ...started, analysis: started.record });
}));

router.post('/reference-video-analyses/:analysisId/reanalyze', asyncRoute(async (req, res) => {
  const user = userFromReq(req);
  const current = referenceVideoAnalyses.get(req.params.analysisId, user);
  const taskId = String(current.task_id || '').trim();
  let previousContext = null;
  let scenePlan = null;
  if (taskId) {
    const task = service.assertTaskOwner(taskId, user);
    if (String(task.active_generation_id || '').trim()) {
      const error = new Error('当前生成正在使用已锁定内容；请先取消或等待生成完成，再重新识别参考视频');
      error.code = 'GENERATION_ACTIVE_EDIT_BLOCKED';
      error.status = 409;
      error.retryable = false;
      error.active_generation_id = task.active_generation_id;
      throw error;
    }
    previousContext = storage.getOutput(taskId, 'context') || task.request || {};
    const boundId = String(previousContext.reference_video_analysis?.analysis_id
      || previousContext.reference_video_analysis?.id || '').trim();
    if (boundId && boundId !== req.params.analysisId) {
      const error = new Error('当前项目已经绑定更新的参考视频，旧任务不能重新覆盖项目内容');
      error.code = 'REFERENCE_VIDEO_NEWER_SOURCE_BOUND';
      error.status = 409;
      error.retryable = false;
      throw error;
    }
    scenePlan = storage.getOutput(taskId, 'scene_config');
  }
  const started = referenceVideoAnalyses.reanalyze(req.params.analysisId, user, taskId ? {
    // Give the 202 response a short flush window before the synchronous part
    // of the legacy SQLite + JSON task projection begins in the background.
    scheduleDelayMs: 100,
    beforeRun: (queuedRecord) => service.updateTaskRequest(taskId, referenceDetach.buildReanalysisPatch(
      previousContext,
      scenePlan,
      referenceVideoAnalyses.taskRecord(queuedRecord),
      req.body || {},
    ), user),
  } : {});
  return res.status(202).json({
    success: true,
    ...started,
    analysis: started.record,
    task_reset: started.accepted && !!taskId,
  });
}));

router.get('/reference-video-analyses/:analysisId', asyncRoute(async (req, res) => {
  let analysis = referenceVideoAnalyses.get(req.params.analysisId, userFromReq(req));
  if (['completed', 'failed', 'cancelled'].includes(String(analysis.status || '').toLowerCase())
    && analysis.task_sync?.status !== 'synced') {
    try {
      await referenceAnalysisTaskSync.syncTerminalAnalysis(
        analysis,
        referenceVideoAnalyses.taskRecord(analysis),
      );
    } catch (syncError) {
      // Reading a paid, completed analysis must remain available even when a
      // recoverable task projection needs another server-side retry.
      console.error(`[new-story-ad] reference task sync failed analysis_id=${analysis.id || analysis.analysis_id || ''} code=${syncError.code || 'TASK_SYNC_FAILED'}`);
    }
    analysis = referenceVideoAnalyses.get(req.params.analysisId, userFromReq(req));
  }
  return res.json({ success: true, analysis });
}));

router.post('/reference-video-analyses/:analysisId/cancel', asyncRoute(async (req, res) => {
  const analysis = referenceVideoAnalyses.cancel(req.params.analysisId, userFromReq(req));
  return res.json({ success: true, analysis });
}));

router.post('/reference-video-analyses/:analysisId/map-scene-views', asyncRoute(async (req, res) => {
  const mapping = referenceVideoAnalyses.mapSceneViews(
    req.params.analysisId,
    userFromReq(req),
    req.body?.scene_assets || req.body?.sceneAssets || [],
  );
  return res.json({ success: true, mapping });
}));

router.delete('/reference-video-analyses/:analysisId', asyncRoute(async (req, res) => {
  const deleted = referenceVideoAnalyses.remove(req.params.analysisId, userFromReq(req));
  return res.json({ success: true, ...deleted });
}));

router.post('/real-person-sources', uploadRealPersonSource, asyncRoute(async (req, res) => {
  if (!req.file) {
    return res.status(422).json({
      success: false,
      code: 'REAL_PERSON_SOURCE_FORMAT_UNSUPPORTED',
      error: '请选择 PNG、JPG 或 WebP 真人来源图片',
    });
  }
  const source = await personDossiers.createSource({
    file: req.file,
    body: req.body || {},
    user: userFromReq(req),
  });
  return res.status(201).json({ success: true, source });
}));

router.get('/real-person-sources/:sourceId/image', asyncRoute(async (req, res) => {
  const filePath = personDossiers.sourceImagePath(req.params.sourceId, userFromReq(req));
  res.setHeader('Cache-Control', 'private, no-store');
  return res.sendFile(path.resolve(filePath));
}));

router.delete('/real-person-sources/:sourceId', asyncRoute(async (req, res) => {
  const deleted = personDossiers.deleteSource(req.params.sourceId, userFromReq(req));
  return res.json({ success: true, ...deleted });
}));

router.get('/tasks/:id/person-production', asyncRoute(async (req, res) => {
  taskForReq(req);
  const production = personDossiers.getProduction(req.params.id, userFromReq(req));
  return res.json({ success: true, production });
}));

router.post('/tasks/:id/person-outfit-candidates', asyncRoute(async (req, res) => {
  taskForReq(req);
  const started = personDossiers.startCandidates({
    taskId: req.params.id,
    user: userFromReq(req),
    sourceId: req.body?.source_id || req.body?.sourceId,
    outfitSourceId: req.body?.outfit_source_id || req.body?.outfitSourceId || '',
    mode: req.body?.mode || 'ai_outfit',
    wardrobe: req.body?.wardrobe || '',
    personProfile: req.body?.person_profile || req.body?.personProfile || {},
  });
  return res.status(202).json({ success: true, ...started });
}));

router.post('/tasks/:id/person-outfit-candidates/:candidateId/approve', asyncRoute(async (req, res) => {
  taskForReq(req);
  const production = personDossiers.approveCandidate({
    taskId: req.params.id,
    candidateId: req.params.candidateId,
    user: userFromReq(req),
  });
  return res.json({ success: true, production });
}));

router.post('/tasks/:id/person-dossiers', asyncRoute(async (req, res) => {
  taskForReq(req);
  const started = personDossiers.startDossier({
    taskId: req.params.id,
    user: userFromReq(req),
  });
  return res.status(202).json({ success: true, ...started });
}));

registerPersonDossierApprovalRoute(router, {
  asyncRoute, taskForReq, userFromReq, personDossiers, personProviderAssets, service,
  upsertActorAssetForUser, storage, videoAdapter, persistProviderPersonIds, uuidv4,
});

router.post('/tasks/:id/person-action-assets', asyncRoute(async (req, res) => {
  taskForReq(req);
  const storyboard = req.body?.storyboard
    || req.body?.storyboard_table
    || storage.getOutput(req.params.id, 'storyboard_table')
    || [];
  const started = personDossiers.startActionAssets({
    taskId: req.params.id,
    user: userFromReq(req),
    storyboard,
  });
  return res.status(202).json({ success: true, ...started });
}));

router.post('/tasks/:id/person-production/:kind/cancel', asyncRoute(async (req, res) => {
  taskForReq(req);
  const production = personDossiers.cancelJob({
    taskId: req.params.id,
    kind: req.params.kind,
    user: userFromReq(req),
  });
  return res.json({ success: true, production });
}));

router.post('/upload', uploadSingle, (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: '请选择文件' });
  const requestedRole = String(req.body?.role || 'asset').trim() || 'asset';
  if (requestedRole === 'brand_logo') {
    const isImage = ['image/png', 'image/jpeg', 'image/webp'].includes(String(req.file.mimetype || '').toLowerCase())
      && /\.(png|jpe?g|webp)$/i.test(req.file.originalname || '');
    if (!isImage || Number(req.file.size || 0) > 10 * 1024 * 1024) {
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(422).json({
        success: false,
        code: 'INVALID_BRAND_ASSET',
        error: '品牌 Logo 仅支持 10MB 以内的 PNG、JPG 或 WebP 图片。',
      });
    }
  }
  const filename = path.basename(req.file.filename);
  const url = mediaAdapter.publicAssetUrl(filename);
  const isAudio = req.file.mimetype?.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(req.file.originalname || '');
  const asset = {
    id: `new_story_asset_${uuidv4()}`,
    module: 'new_story_ad',
    role: requestedRole,
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
  if (String(req.query.download || '') === '1') {
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath).replace(/["\\]/g, '_')}"`);
  }
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
  const body = { ...(req.body || {}) };
  delete body.task_id;
  delete body.taskId;
  const created = service.createTask(body, userFromReq(req));
  res.json({ success: true, ...created });
}));

router.delete('/tasks/:id', asyncRoute(async (req, res) => {
  const task = taskForReq(req);
  const user = userFromReq(req);
  const cancelled = jobService.cancelJob(task.id, {
    cancelledBy: user.id || user.userId || user.username || '',
  });
  const deletion = require('../services/newStoryAd/taskDeletionService').deleteTaskPermanently(storage, task.id);
  if (!deletion.deleted) {
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
    cleanup: {
      deleted_files: deletion.deleted_files,
      preserved_shared_files: deletion.preserved_shared_files,
      failed_files: deletion.failed_files,
    },
  });
}));

router.delete('/tasks/:id/reference-video', asyncRoute(async (req, res) => {
  taskForReq(req);
  const detached = referenceDetach.detach({
    taskId: req.params.id,
    body: req.body || {},
    user: userFromReq(req),
    storyAdService: service,
    storage,
    referenceVideoAnalyses,
  });
  return res.json({ success: true, ...detached });
}));

registerTaskUpdateRoute(router, { asyncRoute, taskForReq, userFromReq });

router.post('/tasks/:id/prepare-generation', asyncRoute(async (req, res) => {
  taskForReq(req);
  const prepared = service.prepareGeneration(req.params.id, req.body || {}, userFromReq(req));
  res.json({ success: true, ...prepared });
}));

router.put('/tasks/:id/blueprint', asyncRoute(async (req, res) => {
  taskForReq(req);
  const body = req.body || {};
  const blueprint = service.updateBlueprint(req.params.id, body.blueprint || body || {}, userFromReq(req), body);
  res.json({ success: true, task_id: req.params.id, blueprint, task: service.taskSummary(storage.getTask(req.params.id)) });
}));

router.put('/tasks/:id/storyboard', asyncRoute(async (req, res) => {
  taskForReq(req);
  const body = req.body || {};
  const result = service.updateStoryboardTable(req.params.id, body.shots || body.storyboard_table || [], userFromReq(req), body);
  res.json({ success: true, task_id: req.params.id, ...result, task: service.taskSummary(storage.getTask(req.params.id)) });
}));

router.post('/assist', asyncRoute(async (req, res) => {
  const body = req.body || {};
  const user = userFromReq(req);
  const taskId = String(body.task_id || body.taskId || '').trim();
  if (taskId) service.assertTaskOwner(taskId, user);
  const generationId = String(body.generation_id || body.generationId || uuidv4());
  const ownerId = String(user.id || user.userId || user.username || 'anonymous');
  const mode = String(body.mode || 'write').replace(/[^a-z0-9_-]/ig, '_').slice(0, 60) || 'write';
  return cancellation.run({
    generationId,
    taskId,
    stage: `assist_${mode}`,
    ownerId,
  }, async () => {
    const result = await service.assistBrief(body, user);
    cancellation.throwIfCancelled(taskId);
    res.json({ success: true, generation_id: generationId, ...result });
  });
}));

router.post('/person-sheet', asyncRoute(async (req, res) => {
  const body = req.body || {};
  const user = userFromReq(req);
  const taskId = String(body.task_id || body.taskId || '').trim();
  if (taskId) service.assertTaskOwner(taskId, user);
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
    : (castMode === 'dual' ? 2 : (['single', 'human_pet'].includes(castMode) ? 1 : 0));
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
      taskId: taskId || generationId,
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
    let actorAsset = upsertActorAssetForUser(userId, {
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
    let committed = null;
    actorAsset = {
      ...actorAsset,
      person_revision: personContract.person_revision,
      person_contract: personContract,
      production_usable_actor: personContract.status === 'verified',
    };
    if (taskId) {
      committed = service.commitGeneratedPersonAsset(taskId, actorAsset, spec);
      actorAsset = committed.person_asset;
    }
    let providerSync = { status: taskId ? 'pending' : 'not_required' };
    if (taskId && committed?.person_contract?.status === 'verified') {
      try {
        const synced = await videoAdapter.prepareDeyunaiPersonAsset({ taskId, ctx: storage.getOutput(taskId, 'context') || {}, options: {} });
        persistProviderPersonIds(userId, storage.getOutput(taskId, 'context') || {});
        providerSync = { status: 'completed', ...synced };
        storage.saveOutput(taskId, 'person_provider_sync', providerSync);
      } catch (error) {
        providerSync = { status: 'failed', error_code: error.code || 'PERSON_PROVIDER_SYNC_FAILED', error: String(error.message || error).slice(0, 500), retryable: true };
        storage.saveOutput(taskId, 'person_provider_sync', providerSync);
      }
    }
    return res.json(actorPayload(actorAsset, {
      status: 'done',
      generated: true,
      fallback_used: false,
      public_actor_library: false,
      provider_sync: providerSync,
      provider_used: providerUsed,
      request_key: body.request_key || '',
      verification_status: personContract.status,
      person_contract: committed?.person_contract || personContract,
      invalidated_outputs: committed?.invalidated_outputs || [],
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
    const fallbackSourceId = String(fallback.actor_asset_id || fallback.id || fallback.actor_id || 'library_actor')
      .replace(/[^a-z0-9_-]/ig, '_').slice(0, 48);
    const privateFallbackId = `actor_asset_${String(taskId || generationId).replace(/[^a-z0-9_-]/ig, '_').slice(0, 36)}_${fallbackSourceId}`;
    let actorAsset = upsertActorAssetForUser(userId, {
      ...fallback,
      id: privateFallbackId,
      actor_asset_id: privateFallbackId,
      actor_id: `actor_${privateFallbackId}`,
      source_library_asset_id: fallback.actor_asset_id || fallback.id || '',
    }, {
      generated_by: 'new_story_ad.person_sheet.fallback',
      fallback_reason: String(err.message || err).slice(0, 500),
      request_key: body.request_key || '',
      gender,
      cast_mode: castMode,
      expected_people: expectedPeople,
      person_count: expectedPeople,
    });
    const fallbackContract = await personIdentity.verifyPersonAsset({
      taskId: taskId || generationId,
      asset: actorAsset,
      spec,
      revision: 1,
    });
    actorAsset = {
      ...actorAsset,
      person_revision: fallbackContract.person_revision,
      person_contract: fallbackContract,
      production_usable_actor: fallbackContract.status === 'verified',
    };
    const committed = taskId ? service.commitGeneratedPersonAsset(taskId, actorAsset, spec) : null;
    if (committed) actorAsset = committed.person_asset;
    let providerSync = { status: taskId ? 'pending' : 'not_required' };
    if (taskId && committed?.person_contract?.status === 'verified') {
      try {
        const synced = await videoAdapter.prepareDeyunaiPersonAsset({ taskId, ctx: storage.getOutput(taskId, 'context') || {}, options: {} });
        persistProviderPersonIds(userId, storage.getOutput(taskId, 'context') || {});
        providerSync = { status: 'completed', ...synced };
        storage.saveOutput(taskId, 'person_provider_sync', providerSync);
      } catch (providerError) {
        providerSync = { status: 'failed', error_code: providerError.code || 'PERSON_PROVIDER_SYNC_FAILED', error: String(providerError.message || providerError).slice(0, 500), retryable: true };
        storage.saveOutput(taskId, 'person_provider_sync', providerSync);
      }
    }
    return res.json(actorPayload(actorAsset, {
      status: 'fallback_actor_library',
      generated: false,
      fallback_used: true,
      public_actor_library: false,
      provider_sync: providerSync,
      fallback_reason: '图片供应商额度/频率或通道失败，已切换到本地可商用演员库候选。',
      provider_error: String(err.message || err).slice(0, 500),
      request_key: body.request_key || '',
      verification_status: committed?.person_contract?.status || fallbackContract.status,
      person_contract: committed?.person_contract || fallbackContract,
    }));
  }
  });
}));

async function generateAndCommitSubjectAssets({ body = {}, taskId = '', generationId = '', userId = 'anonymous', deferCommit = false } = {}) {
    const bundle = await subjectAssets.generateSubjectBundle({
      body,
      taskId,
      generationId,
      deferContextCommit: deferCommit,
      // The combined visual-assets stage shares a provider pool with scenes.
      // Keep one slot available so a large person dossier cannot starve the scene lane.
      personDossierConcurrency: deferCommit ? 1 : undefined,
      onProgress: progress => visualAssetOrchestration.updateSubjectProgress(taskId, generationId, progress),
    });
    const persistedCast = bundle.cast_assets.map((asset) => upsertActorAssetForUser(userId, asset, {
      generated_by: 'new_story_ad.subject_assets',
      cast_member_index: asset.cast_member_index,
      cast_role: asset.cast_role,
    }));
    const normalizedBundle = {
      ...bundle,
      cast_assets: subjectAssetPersistence.restoreGeneratedDossierFields(persistedCast, bundle.cast_assets),
    };
    if (deferCommit) {
      return { module: 'new_story_ad', status: 'generated', normalized_bundle: normalizedBundle };
    }
    const committed = taskId
      ? personAssetLifecycle.commitGeneratedSubjectAssets(taskId, normalizedBundle, body.person_spec || {}, {
          change_kind: body.person_change_kind || body.change_kind || (body.regenerate_selected ? 'visual_dossier' : 'semantic'),
        })
      : {
          person_asset: normalizedBundle.cast_assets.length ? {
            id: `cast_bundle_${generationId}`,
            name: normalizedBundle.cast_assets.length > 1 ? `剧情广告人物组（${normalizedBundle.cast_assets.length}人）` : normalizedBundle.cast_assets[0].name,
            source: 'new_story_ad_cast_bundle',
            cast_mode: normalizedBundle.counts.mode,
            expected_people: normalizedBundle.cast_assets.length,
            image_url: normalizedBundle.cast_assets[0]?.image_url || '',
            view_images: normalizedBundle.cast_assets[0]?.view_images || [],
            cast_assets: normalizedBundle.cast_assets,
            person_contract: normalizedBundle.person_contract,
            subject_board_url: normalizedBundle.subject_board_url || '',
          } : null,
          person_contract: normalizedBundle.person_contract,
          cast_profiles: [],
          pet_profiles: normalizedBundle.pet_profiles,
          pet_contract: normalizedBundle.pet_contract,
          subject_board_url: normalizedBundle.subject_board_url || '',
        };
    let providerSync = { status: normalizedBundle.cast_assets.length ? 'pending' : 'not_required', assets: [] };
    if (taskId && committed.person_asset && committed.person_contract?.status === 'verified') {
      visualAssetOrchestration.updateSubjectProgress(taskId, generationId, { percent: 94, phase: 'provider_sync', message: '正在上传人物档案到 Seedance 人物素材库' });
      try {
        const synced = await videoAdapter.prepareDeyunaiPersonAsset({ taskId, ctx: storage.getOutput(taskId, 'context') || {}, options: {} });
        providerSync = { status: 'completed', ...synced };
        persistProviderPersonIds(userId, storage.getOutput(taskId, 'context') || {});
        storage.saveOutput(taskId, 'person_provider_sync', providerSync);
      } catch (error) {
        providerSync = {
          status: 'failed',
          error_code: error.code || 'PERSON_PROVIDER_SYNC_FAILED',
          error: String(error.message || error).slice(0, 500),
          retryable: true,
          updated_at: new Date().toISOString(),
        };
        storage.saveOutput(taskId, 'person_provider_sync', providerSync);
      }
    }
    visualAssetOrchestration.updateSubjectProgress(taskId, generationId, {
      percent: 100,
      status: 'completed',
      phase: providerSync.status === 'failed' ? 'complete_with_provider_sync_warning' : 'complete',
      message: providerSync.status === 'failed' ? '人物档案已保存，Seedance 人物素材同步待重试' : '人物档案与 Seedance 人物素材 ID 已保存',
    });
    return {
      module: 'new_story_ad',
      status: 'done',
      counts: normalizedBundle.counts,
      generated_counts: normalizedBundle.generated_counts || normalizedBundle.counts,
      subject_targets: normalizedBundle.subject_targets || [],
      ...committed,
      verification_status: {
        people: committed.person_contract?.status || 'not_required',
        pets: committed.pet_contract?.status || 'not_required',
      },
      provider_sync: providerSync,
    };
}

router.post('/subject-assets', asyncRoute(async (req, res) => {
  const body = req.body || {};
  const user = userFromReq(req);
  const taskId = String(body.task_id || body.taskId || '').trim();
  if (taskId) service.assertTaskOwner(taskId, user);
  const generationId = String(body.generation_id || body.generationId || uuidv4());
  const ownerId = String(user.id || user.userId || user.username || 'anonymous');
  return cancellation.run({ generationId, taskId, stage: 'subject_assets', ownerId }, async () => {
    const result = await generateAndCommitSubjectAssets({ body, taskId, generationId, userId: ownerId });
    return res.json({ success: true, ...result });
  });
}));

router.post('/tasks/:id/subject-assets', asyncRoute(async (req, res) => {
  taskForReq(req);
  const user = userFromReq(req);
  const userId = String(user.id || user.userId || user.username || 'anonymous');
  const body = { ...(req.body || {}), task_id: req.params.id };
  return queueTaskStage(req, res, 'subject_assets', job => generateAndCommitSubjectAssets({ body, taskId: req.params.id, generationId: job.generationId, userId }), {
    deadlineMs: 45 * 60 * 1000,
  });
}));

router.post('/tasks/:id/person-provider-sync', asyncRoute(async (req, res) => {
  taskForReq(req);
  const user = userFromReq(req);
  const userId = String(user.id || user.userId || user.username || 'anonymous');
  return queueTaskStage(req, res, 'person_provider_sync', async (job) => {
    const ctx = storage.getOutput(req.params.id, 'context') || {};
    const synced = await videoAdapter.prepareDeyunaiPersonAsset({ taskId: req.params.id, ctx, options: {} });
    const latestContext = storage.getOutput(req.params.id, 'context') || {};
    const persistedActors = persistProviderPersonIds(userId, latestContext);
    const production = personDossiers.getProduction(req.params.id, user);
    if (production.dossier?.status === 'approved') {
      personDossiers.updateApprovedAsset({
        taskId: req.params.id,
        user,
        asset: persistedActors[0] || latestContext.person_asset || null,
        providerSync: {
          status: 'completed', progress: 100, phase: '人物档案和 Seedance 人物资产 ID 已保存',
          provider_asset_ids: synced?.asset_ids || [synced?.asset_id].filter(Boolean),
          completed_at: new Date().toISOString(), error: null,
        },
      });
    }
    storage.saveOutput(req.params.id, 'person_provider_sync', { status: 'completed', ...synced, generation_id: job.generationId });
    return synced;
  }, { deadlineMs: 10 * 60 * 1000 });
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
  return queueTaskStage(req, res, 'scene_asset', job => (
    body.repair_existing === true || body.repairExisting === true
      ? sceneAssetService.repairSceneAsset(req.params.id, body.space_id || body.scene_id, {
          ...body,
          generation_id: job.generationId,
        }, { generationId: job.generationId })
      : sceneAssetService.generateSceneAsset(req.params.id, {
          ...body,
          generation_id: job.generationId,
        }, { generationId: job.generationId })
  ), {
    failureContext: {
      scene_id: body.space_id || body.spaceId || body.scene_id || body.sceneId || '',
      scene_name: body.name || body.scene_name || body.sceneName || '',
    },
  });
})); registerPropRoutes(router, { asyncRoute, taskForReq, queueTaskStage, propAssetService });

router.get('/tasks/:id/scene-assets/:sceneId/panorama/plan', asyncRoute(async (req, res) => {
  taskForReq(req);
  res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
  res.setHeader('Vary', 'Authorization');
  const plan = scenePanoramaService.planForScene(req.params.id, req.params.sceneId);
  res.json({ success: true, task_id: req.params.id, scene_id: req.params.sceneId, ...plan });
}));

router.get('/tasks/:id/scene-assets/panoramas/plan', asyncRoute(async (req, res) => {
  taskForReq(req);
  res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
  res.setHeader('Vary', 'Authorization');
  res.json({ success: true, ...scenePanoramaService.planForTask(req.params.id) });
}));

registerVisualAssetBillingRoutes(router, {
  asyncRoute, taskForReq, userFromReq, authorization: visualAssetBillingAuthorization,
});

router.post('/tasks/:id/visual-assets', asyncRoute(async (req, res) => {
  taskForReq(req);
  const user = userFromReq(req);
  const userId = String(user.id || user.userId || user.username || 'anonymous');
  const body = { ...(req.body || {}), task_id: req.params.id };
  const sceneTargets = visualAssetOrchestration.normalizedSceneTargets(body);
  const subjectTotal = Math.max(0, Number(body.expected_people || 0)) + Math.max(0, Number(body.expected_animals || 0));
  const subjectsRequired = body.generate_subjects !== false && subjectTotal > 0;
  return queueTaskStage(req, res, 'visual_assets', async (job) => {
    const taskId = req.params.id;
    const baseContext = storage.getOutput(taskId, 'context') || storage.getTask(taskId)?.request || {};
    visualAssetProgress.initialize(taskId, job.generationId, {
      subjectsRequired,
      subjectTotal,
      scenesRequired: sceneTargets.length > 0,
      sceneTotal: sceneTargets.length,
    });
    const subjectLane = subjectsRequired
      ? generateAndCommitSubjectAssets({ body, taskId, generationId: job.generationId, userId, deferCommit: true })
      : Promise.resolve(null);
    const sceneLane = (async () => {
      let sceneAssets = storage.getOutput(taskId, 'scene_assets') || baseContext.scene_assets || [];
      let latestSceneSpec = null;
      const sceneFailures = [];
      for (let index = 0; index < sceneTargets.length; index += 1) {
        const target = sceneTargets[index];
        visualAssetProgress.updateLane(taskId, 'scenes', {
          status: 'running', completed_scenes: index, completed: index,
          current_scene_id: target.scene_id,
          message: `正在生成场景 ${index + 1}/${sceneTargets.length}：${target.name}`,
        });
        let result;
        try {
          const runOptions = {
            generationId: job.generationId,
            deferPublish: true,
            existingSceneAssets: sceneAssets,
          };
          result = target.repair_existing
            ? await sceneAssetService.repairSceneAsset(taskId, target.scene_id, {
                ...target,
                generation_id: job.generationId,
              }, runOptions)
            : await sceneAssetService.generateSceneAsset(taskId, {
                ...target,
                generation_id: job.generationId,
              }, runOptions);
        } catch (sceneError) {
          // A billing-ambiguous view freezes only that exact paid unit. Reload
          // the base/checkpoint projection persisted by the scene service and
          // continue with independent scenes instead of aborting the batch.
          sceneAssets = storage.getOutput(taskId, 'scene_assets') || sceneAssets;
          sceneFailures.push({
            scene_id: target.scene_id,
            scene_name: target.name,
            error: sceneError,
          });
          visualAssetProgress.updateLane(taskId, 'scenes', {
            status: 'running', completed_scenes: index + 1, completed: index + 1,
            percent: Math.round(((index + 1) / sceneTargets.length) * 100),
            message: `场景 ${index + 1}/${sceneTargets.length} 已保存可用资产；失败单元已隔离，继续后续场景`,
          });
          continue;
        }
        sceneAssets = result.scene_assets || sceneAssets;
        latestSceneSpec = result.scene_spec || latestSceneSpec;
        visualAssetProgress.updateLane(taskId, 'scenes', {
          status: index + 1 === sceneTargets.length ? 'completed' : 'running',
          completed_scenes: index + 1, completed: index + 1, percent: Math.round(((index + 1) / sceneTargets.length) * 100),
          message: `已完成场景 ${index + 1}/${sceneTargets.length}`,
        });
      }
      if (sceneFailures.length) {
        const primary = sceneFailures.find(item => item.error?.billingState === 'unknown'
          || item.error?.billing_state === 'unknown'
          || item.error?.code === 'PROVIDER_5XX_AMBIGUOUS') || sceneFailures[0];
        const error = primary.error instanceof Error ? primary.error : new Error('部分场景资产未完成');
        error.partial_scene_assets = sceneAssets;
        error.partial_scene_spec = latestSceneSpec;
        error.scene_failures = sceneFailures.map(item => ({
          scene_id: item.scene_id,
          scene_name: item.scene_name,
          error_code: item.error?.code || 'SCENE_ASSET_GENERATION_FAILED',
          billing_state: item.error?.billingState || item.error?.billing_state || '',
        }));
        throw error;
      }
      return { scene_assets: sceneAssets, scene_spec: latestSceneSpec };
    })();
    const [subjects, scenes] = await Promise.allSettled([subjectLane, sceneLane]);
    visualAssetOrchestration.markRejectedLanes(taskId, subjects, scenes);
    const sceneCommit = scenes.status === 'fulfilled'
      ? scenes.value
      : { scene_assets: scenes.reason?.partial_scene_assets || [], scene_spec: scenes.reason?.partial_scene_spec || null };
    let subjectCommit = null;
    if (subjects.status === 'fulfilled' && subjects.value?.normalized_bundle) {
      subjectCommit = personAssetLifecycle.commitGeneratedSubjectAssets(
        taskId,
        subjects.value.normalized_bundle,
        body.person_spec || {},
        { change_kind: body.person_change_kind || body.change_kind || 'semantic', deferContextWrite: true },
      );
      visualAssetProgress.updateLane(taskId, 'subjects', { status: 'completed', percent: 100, message: '人物与动物档案已保存' });
    }
    if (sceneCommit.scene_assets?.length) {
      sceneAssetService.saveSceneAssetsToTask(taskId, sceneCommit.scene_assets, { deferContextWrite: true });
    }
    if (subjectCommit || sceneCommit.scene_assets?.length) {
      const combined = {
        ...baseContext,
        ...(subjectCommit || {}),
        ...(sceneCommit.scene_assets?.length ? { scene_assets: sceneCommit.scene_assets } : {}),
        ...(sceneCommit.scene_spec ? { scene_spec: sceneCommit.scene_spec } : {}),
      };
      delete combined.invalidated_outputs;
      delete combined.visual_refresh;
      storage.saveOutput(taskId, 'context', combined);
      storage.updateTask(taskId, { request: combined, updated_at: new Date().toISOString() });
      if (subjectCommit?.person_contract?.status === 'verified') {
        try {
          const synced = await videoAdapter.prepareDeyunaiPersonAsset({ taskId, ctx: combined, options: {} });
          persistProviderPersonIds(userId, combined);
          storage.saveOutput(taskId, 'person_provider_sync', { status: 'completed', ...synced, generation_id: job.generationId });
        } catch (syncError) {
          storage.saveOutput(taskId, 'person_provider_sync', {
            status: 'failed', error_code: syncError.code || 'PERSON_PROVIDER_SYNC_FAILED',
            error: String(syncError.message || syncError).slice(0, 500), retryable: true,
            generation_id: job.generationId, updated_at: new Date().toISOString(),
          });
        }
      }
    }
    const rejected = visualAssetOrchestration.rejectedResults(subjects, scenes);
    const failed = visualAssetOrchestration.primaryFailure(rejected);
    if (failed) {
      visualAssetProgress.finish(taskId, 'partial_failed');
      const error = failed.reason instanceof Error ? failed.reason : new Error(String(failed.reason || '视觉资产生成失败'));
      throw visualAssetOrchestration.attachFailureMetadata(error, rejected, { subjectCommit, sceneCommit, subjects, scenes });
    }
    visualAssetProgress.finish(taskId, 'completed');
    return { subjects: subjectCommit, scenes: scenes.value, synchronized: true };
  }, { deadlineMs: 45 * 60 * 1000 });
}));

router.post('/tasks/:id/scene-assets/:sceneId/panorama', asyncRoute(async (req, res) => {
  taskForReq(req);
  res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
  res.setHeader('Vary', 'Authorization');
  const body = req.body || {};
  const expected = scenePanoramaService.planForScene(req.params.id, req.params.sceneId);
  scenePanoramaService.assertConfirmedPlan(body, expected);
  req.body = {
    ...body,
    idempotency_key: `${req.params.id}:scene_panorama:${req.params.sceneId}:${expected.source_fingerprint}:v${scenePanoramaService.PANORAMA_CONTRACT_VERSION}`,
  };
  return queueTaskStage(req, res, 'scene_panorama', job => scenePanoramaService.generateScenePanorama(
    req.params.id,
    req.params.sceneId,
    { ...body, generation_id: job.generationId },
    { generationId: job.generationId },
  ), {
    deadlineMs: 12 * 60 * 1000,
    failureContext: {
      scene_id: req.params.sceneId,
      scene_name: body.scene_name || body.sceneName || '',
    },
  });
}));

router.post('/tasks/:id/scene-assets/panoramas', asyncRoute(async (req, res) => {
  taskForReq(req);
  res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
  res.setHeader('Vary', 'Authorization');
  const body = req.body || {};
  const expected = scenePanoramaService.planForTask(req.params.id);
  scenePanoramaService.assertConfirmedTaskPlan(body, expected);
  req.body = {
    ...body,
    idempotency_key: `${req.params.id}:scene_panorama_batch:${expected.plan_fingerprint}:v${scenePanoramaService.PANORAMA_CONTRACT_VERSION}`,
  };
  return queueTaskStage(req, res, 'scene_panorama_batch', job => scenePanoramaService.generateTaskPanoramas(
    req.params.id,
    { ...body, generation_id: job.generationId },
    { generationId: job.generationId },
  ), { deadlineMs: 45 * 60 * 1000 });
}));

router.post('/tasks/:id/product-assets', asyncRoute(async (req, res) => {
  taskForReq(req);
  const body = req.body || {};
  return queueTaskStage(req, res, 'product_asset', job => productAssetGeneration.generateProductAsset(req.params.id, body, { generationId: job.generationId }), {
    deadlineMs: 20 * 60 * 1000,
  });
}));

router.post('/tasks/:id/person-verify', asyncRoute(async (req, res) => {
  taskForReq(req);
  const result = await service.verifyPersonContract(req.params.id, req.body || {});
  res.json({ success: true, task_id: req.params.id, ...result });
}));

router.post('/tasks/:id/product-verify', asyncRoute(async (req, res) => {
  taskForReq(req);
  const result = await service.verifyProductContract(req.params.id);
  res.json({ success: true, task_id: req.params.id, ...result });
}));

router.put('/tasks/:id/scene-assets', asyncRoute(async (req, res) => {
  const task = taskForReq(req);
  const body = req.body || {};
  const submitted = body.scene_assets || body.sceneAssets || [];
  const authoritative = storage.getOutput(req.params.id, 'scene_assets') || [];
  if (task.lineage_enforced === true
    && storage.canonicalFingerprint(submitted) !== storage.canonicalFingerprint(authoritative)) {
    const error = new Error('场景生成产物由服务器版本管理，浏览器旧快照不能覆盖当前场景；请刷新任务后继续');
    error.code = 'CLIENT_GENERATED_OUTPUT_REJECTED';
    error.status = 409;
    error.retryable = false;
    throw error;
  }
  const sceneAssets = task.lineage_enforced === true
    ? authoritative
    : sceneAssetService.saveSceneAssetsToTask(req.params.id, submitted);
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

router.post('/tasks/:id/scene-assets/:sceneId/repair', asyncRoute(async (req, res) => {
  const body = req.body || {};
  return queueTaskStage(req, res, 'scene_asset', job => sceneAssetService.repairSceneAsset(req.params.id, req.params.sceneId, {
    ...body,
    generation_id: job.generationId,
  }, {
    generationId: job.generationId,
  }), {
    failureContext: {
      scene_id: req.params.sceneId,
      scene_name: body.name || body.scene_name || body.sceneName || '',
    },
  });
}));

router.get('/tasks/:id/progress', asyncRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  const task = taskForReq(req);
  const projection = taskProgressProjection.projectTaskProgress(task, String(req.query.since || ''));
  res.json({ success: true, task_id: task.id, ...projection });
}));

router.get('/tasks/:id/director-workspace', asyncRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
  res.setHeader('Vary', 'Authorization');
  const task = taskForReq(req);
  const bundle = service.publicTaskBundle(task.id);
  let personProduction = {};
  try {
    personProduction = personDossiers.getProduction(task.id, userFromReq(req));
  } catch (error) {
    if (!['PERSON_PRODUCTION_NOT_FOUND', 'TASK_NOT_FOUND'].includes(String(error?.code || ''))) throw error;
  }
  const workspace = directorWorkspace.createDirectorWorkspace({
    task: bundle.task || task,
    outputs: bundle.outputs || {},
    personProduction,
  }, {
    sections: req.query.sections || 'overview',
    shotOffset: req.query.shot_offset,
    shotLimit: req.query.shot_limit,
    candidateLimit: req.query.candidate_limit,
  });
  res.json({ success: true, task_id: task.id, ...workspace });
}));

router.get('/tasks/:id', asyncRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  taskForReq(req);
  const fullBundle = service.publicTaskBundle(req.params.id);
  const bundle = String(req.query.compact || '') === '1'
    ? service.compactPublicTaskBundle(fullBundle)
    : fullBundle;
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
  const replanSceneCoverage = req.body?.replan_scene_coverage === true || req.body?.replanSceneCoverage === true;
  return queueTaskStage(req, res, 'scene_config', job => service.generateSceneConfig(req.params.id, {
    generation_id: job.generationId,
    replan_scene_coverage: replanSceneCoverage,
  }), { deadlineMs: task => service.sceneConfigStageBudgetMs(task.id, {
    replan_scene_coverage: replanSceneCoverage,
  }) });
}));

router.post('/tasks/:id/person-plan', asyncRoute(async (req, res) => {
  return queueTaskStage(req, res, 'person_plan', job => service.updatePersonPlan(req.params.id, {
    generation_id: job.generationId,
  }), { deadlineMs: task => service.sceneConfigStageBudgetMs(task.id, {}) });
}));

router.post('/tasks/:id/scene-plan', asyncRoute(async (req, res) => {
  return queueTaskStage(req, res, 'scene_plan', job => service.updateScenePlan(req.params.id, {
    generation_id: job.generationId,
  }), { deadlineMs: task => service.sceneConfigStageBudgetMs(task.id, { replan_scene_coverage: true }) });
}));

router.post('/tasks/:id/blueprint', asyncRoute(async (req, res) => {
  const forceRegenerate = req.body?.force_regenerate === true || req.body?.forceRegenerate === true;
  return queueTaskStage(req, res, 'blueprint', job => service.generateBlueprintStage(req.params.id, { ...job, force_regenerate: forceRegenerate }));
}));

router.post('/tasks/:id/script-package', asyncRoute(async (req, res) => {
  return queueTaskStage(
    req,
    res,
    'script_package',
    job => service.generateScriptPackageStage(req.params.id, job),
    { deadlineMs: task => service.longFormStageBudgetMs(task.id, 'script_package') },
  );
}));

router.post('/tasks/:id/storyboard', asyncRoute(async (req, res) => {
  return queueTaskStage(
    req,
    res,
    'storyboard',
    job => service.generateStoryboardStage(req.params.id, { generation_id: job.generationId }),
    { deadlineMs: task => service.longFormStageBudgetMs(task.id, 'storyboard') },
  );
}));

router.post('/tasks/:id/keyframe-contract', asyncRoute(async (req, res) => {
  taskForReq(req);
  const keyframe_contracts = await service.buildKeyframeContractStage(req.params.id);
  res.json({ success: true, task_id: req.params.id, keyframe_contracts });
}));

router.post('/tasks/:id/keyframes', asyncRoute(async (req, res) => {
  const body = req.body || {};
  taskForReq(req);
  service.keyframeSubmissionPreflight(req.params.id, body, userFromReq(req));
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
  const permit = generationPermit.issue(req.params.id, 'keyframes', {
    idempotencyKey: `${req.params.id}:keyframe-review:${req.params.index}:${req.params.candidateId}`,
  });
  generationPermit.consume(req.params.id, permit);
  const result = await service.retryKeyframeCandidateQa(req.params.id, req.params.index, req.params.candidateId);
  res.json({ success: true, task_id: req.params.id, ...result });
}));

router.post('/tasks/:id/tts', asyncRoute(async (req, res) => {
  const body = req.body || {};
  return queueTaskStage(
    req,
    res,
    'tts',
    () => service.generateTtsStage(req.params.id, body),
    { deadlineMs: task => service.longFormStageBudgetMs(task.id, 'tts') },
  );
}));

router.get('/tasks/:id/video/preflight', asyncRoute(async (req, res) => {
  taskForReq(req);
  const rawIndexes = req.query.only_indexes !== undefined ? req.query.only_indexes : req.query.only_index;
  const rawIndexParts = rawIndexes === undefined ? null : (Array.isArray(rawIndexes) ? rawIndexes : [rawIndexes])
    .flatMap(value => String(value).split(','))
    .map(value => String(value).trim());
  const requestedIndexes = rawIndexParts === null ? null : [...new Set(rawIndexParts.map(value => value === '' ? NaN : Number(value)))];
  if (requestedIndexes && (!requestedIndexes.length || requestedIndexes.some(index => !Number.isInteger(index) || index < 0))) {
    const error = new Error('指定的镜头序号无效，本次没有提交视频模型');
    error.code = 'VIDEO_SHOT_INDEX_INVALID';
    error.status = 422;
    throw error;
  }
  const plan = service.buildVideoPreflightPlan(req.params.id, {
    video_generation_mode: req.query.mode || 'economy',
    ...(requestedIndexes ? { only_indexes: requestedIndexes } : {}),
  });
  res.json({ success: true, task_id: req.params.id, preflight: service.publicVideoPreflight(plan) });
}));

router.post('/tasks/:id/video', asyncRoute(async (req, res) => {
  taskForReq(req);
  paidExecutionPolicy.assertExternalRequest(req.body || {});
  const body = paidExecutionPolicy.canonicalize({ ...(req.body || {}), require_video_preflight: true });
  service.assertVideoPreflightConfirmation(req.params.id, body);
  return queueTaskStage(
    req,
    res,
    'video',
    job => service.generateVideoStage(req.params.id, { ...body, generation_id: job.generationId }),
    { deadlineMs: task => service.longFormStageBudgetMs(task.id, 'video') },
  );
}));

router.post('/tasks/:id/video/:index/manual-accept', asyncRoute(async (req, res) => {
  taskForReq(req);
  const result = service.acceptVideoClipOverride(
    req.params.id,
    req.params.index,
    req.body || {},
    userFromReq(req),
  );
  res.json({ success: true, task_id: req.params.id, ...result });
}));

router.post('/tasks/:id/compose', asyncRoute(async (req, res) => {
  const body = req.body || {};
  return queueTaskStage(
    req,
    res,
    'compose',
    job => service.composeStage(req.params.id, { ...body, generation_id: job.generationId }),
    { deadlineMs: task => service.longFormStageBudgetMs(task.id, 'compose') },
  );
}));

registerVideoMonitorRoute(router, {
  asyncRoute,
  userFromReq,
  storage,
  videoAdapter,
  videoGenerationUnits: require('../services/newStoryAd/videoGenerationUnitProjection'),
  service,
});

router.post('/tasks/:id/media', asyncRoute(async (req, res) => {
  paidExecutionPolicy.assertExternalRequest(req.body || {});
  const body = paidExecutionPolicy.canonicalize({ ...(req.body || {}), require_video_preflight: true });
  service.assertVideoPreflightConfirmation(req.params.id, body);
  return queueTaskStage(req, res, 'media', async job => {
    // 同一后台任务先验证可选配音，再生成纯视觉连续段，最后只在本地混音合成。
    await mediaPipeline.runMediaPipeline({
      taskId: req.params.id,
      options: body,
      generationId: job.generationId,
      service,
    });
  }, { deadlineMs: 60 * 60 * 1000 });
}));

router.post('/storyboard', asyncRoute(async (req, res) => {
  const body = { ...(req.body || {}) };
  delete body.task_id;
  delete body.taskId;
  const created = service.createTask(body, userFromReq(req));
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
module.exports.buildActorViewPrompt = buildActorViewPrompt;
module.exports.buildActorSheetPrompt = buildActorSheetPrompt;
