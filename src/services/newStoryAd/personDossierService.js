const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const mediaAdapter = require('./mediaAdapter');
const modelGateway = require('./modelGateway');
const jsonRepair = require('./jsonRepairService');
const personDossierCompiler = require('./personDossierCompiler');
const generationConcurrency = require('./generationConcurrencyService');
const dossierComposites = require('./dossierCompositeService');
const wearableEvidence = require('./wearableEvidencePolicyService');
const knowledgeRuntime = require('./knowledgePolicyRuntimeService');
const taskStorage = require('./storageService');

const ROOT_DIR = path.resolve(process.env.OUTPUT_DIR || './outputs', 'new-story-ad', 'person-production');
const activeJobs = new Map();
const {
  BODY_VIEWS,
  IDENTITY_VIEWS,
  EXPRESSIONS,
  BASE_ACTIONS,
} = personDossierCompiler;

function now() {
  return new Date().toISOString();
}

function ownerId(user = {}) {
  return String(user.id || user.userId || user.username || 'anonymous').trim() || 'anonymous';
}

function safeSegment(value = '') {
  return String(value || '').replace(/[^a-z0-9_-]/ig, '_').slice(0, 90) || 'anonymous';
}

function userDir(userId) {
  return path.join(ROOT_DIR, safeSegment(userId));
}

function sourceDir(userId, sourceId) {
  return path.join(userDir(userId), 'sources', safeSegment(sourceId));
}

function productionPath(userId, taskId) {
  return path.join(userDir(userId), 'tasks', `${safeSegment(taskId)}.json`);
}

function sourceRecordPath(userId, sourceId) {
  return path.join(sourceDir(userId, sourceId), 'record.json');
}

function waitForWindowsFileRelease(delayMs) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
}

function replaceAtomicFile(tmp, filePath) {
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.renameSync(tmp, filePath);
      return;
    } catch (error) {
      lastError = error;
      const retryableWindowsLock = process.platform === 'win32'
        && ['EPERM', 'EACCES', 'EBUSY'].includes(error.code);
      if (!retryableWindowsLock) throw error;
      if (attempt < 4) waitForWindowsFileRelease(10 * (attempt + 1));
    }
  }
  try {
    fs.copyFileSync(tmp, filePath);
    fs.unlinkSync(tmp);
  } catch (copyError) {
    try { fs.unlinkSync(tmp); } catch {}
    copyError.cause = lastError;
    throw copyError;
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  try {
    replaceAtomicFile(tmp, filePath);
  } catch (error) {
    try { fs.unlinkSync(tmp); } catch {}
    throw error;
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readProduction(userId, taskId) {
  return readJson(productionPath(userId, taskId)) || {
    task_id: String(taskId),
    user_id: String(userId),
    source_identity_id: '',
    outfit_reference_id: '',
    mode: '',
    wardrobe: '',
    candidate_job: null,
    candidates: [],
    approved_candidate_id: '',
    approved_anchor: null,
    dossier_job: null,
    dossier: null,
    action_job: null,
    action_assets: [],
    versions: {
      source_identity: 0,
      person: 0,
      wardrobe: 0,
      expression: 0,
      action: 0,
    },
    invalidations: [],
    created_at: now(),
    updated_at: now(),
  };
}

function saveProduction(value) {
  const next = { ...value, updated_at: now() };
  writeJsonAtomic(productionPath(next.user_id, next.task_id), next);
  return next;
}

function readSource(userId, sourceId) {
  return readJson(sourceRecordPath(userId, sourceId));
}

function assertSource(sourceId, user = {}) {
  const userId = ownerId(user);
  const source = readSource(userId, sourceId);
  if (!source) {
    const error = new Error('真人来源不存在或无权访问');
    error.code = 'REAL_PERSON_SOURCE_NOT_FOUND';
    error.status = 404;
    throw error;
  }
  return source;
}

function publicSource(source = {}) {
  const copy = { ...source };
  delete copy.local_path;
  return copy;
}

function validateImage(file = {}) {
  const ext = path.extname(file.originalname || file.filename || '').toLowerCase();
  const mime = String(file.mimetype || '').toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext) || !mime.startsWith('image/')) {
    const error = new Error('真人来源仅支持 PNG、JPG 或 WebP 图片');
    error.code = 'REAL_PERSON_SOURCE_FORMAT_UNSUPPORTED';
    error.status = 422;
    throw error;
  }
  if (Number(file.size || 0) > 20 * 1024 * 1024) {
    const error = new Error('单张真人来源图片不能超过 20MB');
    error.code = 'REAL_PERSON_SOURCE_TOO_LARGE';
    error.status = 413;
    throw error;
  }
}

async function createSource({ file, body = {}, user = {} } = {}) {
  if (!file?.path) {
    const error = new Error('请选择真人来源图片');
    error.code = 'REAL_PERSON_SOURCE_REQUIRED';
    error.status = 400;
    throw error;
  }
  try {
    validateImage(file);
    if (String(body.rights_confirmed || body.rightsConfirmed || '') !== 'true') {
      const error = new Error('请确认已取得真人形象授权');
      error.code = 'REAL_PERSON_RIGHTS_REQUIRED';
      error.status = 422;
      throw error;
    }
    if (String(body.adult_confirmed || body.adultConfirmed || '') !== 'true') {
      const error = new Error('当前真人换装功能仅接受已确认年满 18 周岁的授权主体');
      error.code = 'REAL_PERSON_ADULT_REQUIRED';
      error.status = 422;
      throw error;
    }
    const metadata = await sharp(file.path).metadata();
    if (!metadata.width || !metadata.height || Math.min(metadata.width, metadata.height) < 512) {
      const error = new Error('真人来源图片短边需至少 512 像素');
      error.code = 'REAL_PERSON_SOURCE_RESOLUTION_LOW';
      error.status = 422;
      throw error;
    }
    const userId = ownerId(user);
    const id = `real_source_${uuidv4()}`;
    const ext = path.extname(file.originalname || '').toLowerCase();
    const dir = sourceDir(userId, id);
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, `source${ext}`);
    fs.renameSync(file.path, target);
    const source = {
      id,
      user_id: userId,
      kind: String(body.kind || 'identity') === 'outfit' ? 'outfit' : 'identity',
      original_name: String(file.originalname || ''),
      local_path: target,
      mimetype: String(file.mimetype || ''),
      size_bytes: Number(file.size || 0),
      width: Number(metadata.width || 0),
      height: Number(metadata.height || 0),
      rights_confirmed: true,
      adult_confirmed: true,
      immutable: true,
      public_library_visible: false,
      verification: {
        status: 'verified_for_generation',
        face_identity_expected: String(body.kind || 'identity') !== 'outfit',
        source_quality_passed: true,
      },
      created_at: now(),
    };
    writeJsonAtomic(sourceRecordPath(userId, id), source);
    return publicSource(source);
  } catch (error) {
    try { if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path); } catch {}
    throw error;
  }
}

function sourceImagePath(sourceId, user = {}) {
  return assertSource(sourceId, user).local_path;
}

function deleteSource(sourceId, user = {}) {
  const source = assertSource(sourceId, user);
  const dir = sourceDir(source.user_id, source.id);
  const root = path.resolve(ROOT_DIR);
  const resolved = path.resolve(dir);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    const error = new Error('真人来源目录不安全，已停止删除');
    error.code = 'UNSAFE_REAL_PERSON_SOURCE_PATH';
    error.status = 500;
    throw error;
  }
  fs.rmSync(resolved, { recursive: true, force: true });
  return { id: sourceId, deleted: true };
}

function jobKey(taskId, kind) {
  return `${taskId}:${kind}`;
}

function jobCancelled(production, kind) {
  return production?.[`${kind}_job`]?.cancel_requested === true;
}

function throwIfCancelled(userId, taskId, kind) {
  const latest = readProduction(userId, taskId);
  if (jobCancelled(latest, kind)) {
    const error = new Error('人物资产生成已取消');
    error.code = 'PERSON_PRODUCTION_CANCELLED';
    error.cancelled = true;
    throw error;
  }
}

function updateJob(production, kind, patch = {}) {
  const key = `${kind}_job`;
  return saveProduction({
    ...production,
    [key]: {
      ...(production[key] || {}),
      ...patch,
      updated_at: now(),
    },
  });
}

function makeBridge(source, prefix = 'person_source') {
  const ext = path.extname(source.local_path || '') || '.jpg';
  const filename = `${prefix}_${uuidv4().slice(0, 16)}${ext}`;
  const target = mediaAdapter.assetPathFromName(filename);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source.local_path, target);
  return { filename, path: target, url: mediaAdapter.publicAssetUrl(filename) };
}

function removeBridge(bridge) {
  try { if (bridge?.path && fs.existsSync(bridge.path)) fs.unlinkSync(bridge.path); } catch {}
}

function outfitPrompt(mode, wardrobe, index, knowledgePrompt = '') {
  const modeLine = mode === 'retain_original'
    ? 'Keep the original outfit exactly unchanged.'
    : mode === 'outfit_reference'
      ? 'Change only the outfit to match the separate outfit reference; do not copy the outfit reference person.'
      : `Change only the clothing to this authorized wardrobe specification: ${wardrobe || 'clean commercial casual outfit'}.`;
  return [
    'Create a photorealistic full-body front-view commercial actor anchor.',
    'The first reference is the immutable authorized person identity. Preserve face identity, apparent adult age, skin tone, hair identity and body proportions.',
    modeLine,
    knowledgePrompt,
    'Neutral standing pose, hands visible, plain studio background, accurate garment construction, no text, no collage.',
    `Candidate variation ${index + 1}: vary only styling execution and pose micro-adjustment.`,
  ].join('\n');
}

async function identityQa({ taskId, sourceUrl, candidateUrl, knowledgePolicy = {} }) {
  if (process.env.NEW_STORY_AD_MOCK_LLM === '1') {
    return {
      pass: true,
      source_identity_score: 0.94,
      adult_age_consistency_score: 0.93,
      wardrobe_instruction_score: 0.92,
      reasons: [],
    };
  }
  const result = await modelGateway.generateVision({
    taskId,
    stage: 'new_story_ad.scene_consistency_qa',
    systemPrompt: 'Compare an authorized real-person source with a generated actor candidate. Do not identify the person by name.',
    userPrompt: [
      'Image 1 is the immutable authorized identity source; image 2 is the candidate.',
      'Return strict JSON: pass, source_identity_score, adult_age_consistency_score, wardrobe_instruction_score, reasons.',
      'Pass only when source_identity_score >= 0.86 and adult_age_consistency_score >= 0.84.',
      knowledgeRuntime.qaBlock(knowledgePolicy),
    ].join('\n'),
    imageUrls: [sourceUrl, candidateUrl],
    maxTokens: 1600,
  });
  return jsonRepair.parseOrRepair({ raw: result.text, expected: 'object', modelGateway, taskId });
}

async function runCandidates(initial, source, outfitSource) {
  let production = initial;
  const knowledgePolicy = knowledgeRuntime.resolveTaskMany({
    storage: taskStorage, taskId: production.task_id, context: production,
    selectors: [{ stage: 'person_dossier', assetType: 'person' }],
  });
  const knowledgePrompt = knowledgeRuntime.promptBlock(knowledgePolicy);
  const bridges = [makeBridge(source, 'identity_bridge')];
  if (outfitSource) bridges.push(makeBridge(outfitSource, 'outfit_bridge'));
  try {
    production = updateJob(production, 'candidate', { status: 'running', progress: 8, phase: '验证真人来源' });
    const candidates = [];
    for (let index = 0; index < 2; index += 1) {
      throwIfCancelled(production.user_id, production.task_id, 'candidate');
      production = updateJob(readProduction(production.user_id, production.task_id), 'candidate', {
        progress: 18 + index * 34,
        phase: `生成换装候选 ${index + 1}/2`,
      });
      const image = await mediaAdapter.generateActorReference({
        taskId: production.task_id,
        stage: 'new_story_ad.person_sheet',
        prompt: outfitPrompt(production.mode, production.wardrobe, index, knowledgePrompt),
        filename: `person_outfit_${index + 1}_${personDossierCompiler.compactAssetToken(production.task_id, 'outfit', index + 1)}`,
        aspectRatio: '3:4',
        referenceImages: bridges.map(item => item.url),
        requireReferences: true,
        inputFidelity: 'high',
        clientRequestId: `${production.task_id}:outfit:${production.versions.wardrobe + 1}:${index + 1}`,
        imageModel: production.image_model || 'auto',
        singleAttempt: true,
      });
      const qa = await identityQa({
        taskId: production.task_id,
        sourceUrl: bridges[0].url,
        candidateUrl: image.image_url || image.url,
        knowledgePolicy,
      });
      candidates.push({
        id: `outfit_candidate_${uuidv4()}`,
        index,
        image_url: image.image_url || image.url,
        filename: image.filename || '',
        provider_used: image.provider_used || '',
        strict_reference_required: true,
        input_fidelity: 'high',
        source_identity_id: source.id,
        outfit_reference_id: outfitSource?.id || '',
        mode: production.mode,
        qa,
        selectable: qa.pass !== false && Number(qa.source_identity_score || 0) >= 0.86,
        created_at: now(),
      });
    }
    production = readProduction(production.user_id, production.task_id);
    production = saveProduction({
      ...production,
      candidates,
      candidate_job: {
        ...(production.candidate_job || {}),
        status: 'completed',
        phase: '请选择一个换装候选作为人物锚点',
        progress: 100,
        completed_at: now(),
      },
    });
  } catch (error) {
    production = readProduction(production.user_id, production.task_id);
    production = updateJob(production, 'candidate', error.cancelled
      ? { status: 'cancelled', phase: '已取消', progress: production.candidate_job?.progress || 0 }
      : {
        status: 'failed',
        phase: '换装候选生成失败',
        error: { code: error.code || 'OUTFIT_CANDIDATE_FAILED', message: String(error.message || error).slice(0, 500) },
      });
  } finally {
    bridges.forEach(removeBridge);
    activeJobs.delete(jobKey(initial.task_id, 'candidate'));
  }
}

function startCandidates({ taskId, user = {}, sourceId, outfitSourceId = '', mode = 'ai_outfit', wardrobe = '', personProfile = {}, imageModel = '' } = {}) {
  const userId = ownerId(user);
  const source = assertSource(sourceId, user);
  if (source.kind !== 'identity') {
    const error = new Error('换装生成的第一参考必须是真人身份来源');
    error.code = 'IDENTITY_SOURCE_REQUIRED';
    error.status = 422;
    throw error;
  }
  if (!['retain_original', 'ai_outfit', 'outfit_reference'].includes(mode)) {
    const error = new Error('请选择保留原穿搭、AI 换装或服装参考图');
    error.code = 'OUTFIT_MODE_INVALID';
    error.status = 422;
    throw error;
  }
  const outfitSource = outfitSourceId ? assertSource(outfitSourceId, user) : null;
  if (mode === 'outfit_reference' && (!outfitSource || outfitSource.kind !== 'outfit')) {
    const error = new Error('服装参考图模式必须上传独立服装参考图');
    error.code = 'OUTFIT_REFERENCE_REQUIRED';
    error.status = 422;
    throw error;
  }
  const key = jobKey(taskId, 'candidate');
  let production = readProduction(userId, taskId);
  if (activeJobs.has(key) || ['queued', 'running'].includes(production.candidate_job?.status)) {
    return { production, accepted: false, duplicate: true };
  }
  const wardrobeChanged = production.wardrobe !== wardrobe || production.mode !== mode || production.outfit_reference_id !== outfitSourceId;
  production = saveProduction({
    ...production,
    source_identity_id: source.id,
    outfit_reference_id: outfitSource?.id || '',
    mode,
    wardrobe: String(wardrobe || '').slice(0, 1000),
    image_model: String(imageModel || '').slice(0, 220),
    person_profile: personProfile && typeof personProfile === 'object' ? {
      displayName: String(personProfile.displayName || personProfile.name || '').slice(0, 120),
      roleName: String(personProfile.roleName || personProfile.role || '').slice(0, 120),
      age: String(personProfile.age || '').slice(0, 80),
      appearanceText: String(personProfile.appearanceText || personProfile.appearance || '').slice(0, 1000),
      wardrobeText: String(personProfile.wardrobeText || wardrobe || '').slice(0, 1000),
      hairMakeupText: String(personProfile.hairMakeupText || '').slice(0, 1000),
      negativeText: String(personProfile.negativeText || '').slice(0, 1000),
      accessories: (Array.isArray(personProfile.accessories) ? personProfile.accessories : [])
        .map(item => String(item?.name || item?.key || item || '').slice(0, 120)).filter(Boolean).slice(0, 24),
      criticalAccessoryKeys: [
        ...(Array.isArray(personProfile.criticalAccessoryKeys) ? personProfile.criticalAccessoryKeys : []),
        ...(Array.isArray(personProfile.critical_accessory_keys) ? personProfile.critical_accessory_keys : []),
        ...(Array.isArray(personProfile.accessories)
          ? personProfile.accessories.filter(item => item?.critical === true).map(item => item.key || item.name)
          : []),
      ].map(item => String(item || '').slice(0, 120)).filter(Boolean).slice(0, 24),
    } : {},
    candidates: [],
    approved_candidate_id: '',
    approved_anchor: null,
    dossier: null,
    action_assets: [],
    versions: {
      ...production.versions,
      source_identity: Math.max(1, Number(production.versions.source_identity || 0) + (production.source_identity_id === source.id ? 0 : 1)),
      wardrobe: Math.max(1, Number(production.versions.wardrobe || 0) + (wardrobeChanged ? 1 : 0)),
    },
    invalidations: wardrobeChanged
      ? [...(production.invalidations || []), { at: now(), scope: 'person_keyframes_videos', reason: 'wardrobe_changed', preserves: ['scene_assets', 'script_text'] }].slice(-20)
      : production.invalidations,
    candidate_job: {
      id: `person_candidate_job_${uuidv4()}`,
      status: 'queued',
      progress: 1,
      phase: '已进入换装候选队列',
      cancel_requested: false,
      created_at: now(),
    },
  });
  const promise = runCandidates(production, source, outfitSource);
  activeJobs.set(key, promise);
  return { production, accepted: true, duplicate: false };
}

function approveCandidate({ taskId, candidateId, user = {} } = {}) {
  const production = readProduction(ownerId(user), taskId);
  const candidate = (production.candidates || []).find(item => item.id === candidateId);
  if (!candidate || candidate.selectable !== true) {
    const error = new Error('该换装候选不存在或未通过身份一致性校验');
    error.code = 'OUTFIT_CANDIDATE_NOT_APPROVABLE';
    error.status = 422;
    throw error;
  }
  return saveProduction({
    ...production,
    approved_candidate_id: candidate.id,
    approved_anchor: {
      ...candidate,
      approved_at: now(),
      immutable_for_person_revision: true,
    },
    versions: {
      ...production.versions,
      person: Math.max(1, Number(production.versions.person || 0) + 1),
    },
  });
}

async function dossierQa({ taskId, sourceUrl, anchorUrl, atomicAssets = [], knowledgePolicy = {} } = {}) {
  if (process.env.NEW_STORY_AD_MOCK_LLM === '1') {
    return {
      pass: true,
      source_identity_score: 0.93,
      cross_view_identity_score: 0.91,
      adult_age_consistency_score: 0.94,
      body_proportion_score: 0.9,
      wardrobe_consistency_score: 0.92,
      expression_identity_score: 0.91,
      action_physics_score: 0.9,
      contact_consistency_score: 0.9,
      reasons: [],
      batch_count: Math.ceil(atomicAssets.length / 6),
    };
  }
  const batches = [];
  for (let index = 0; index < atomicAssets.length; index += 6) batches.push(atomicAssets.slice(index, index + 6));
  const rows = await generationConcurrency.map('new_story_ad.person_dossier_qa', batches, 2, async batch => {
    const result = await modelGateway.generateVision({
      taskId,
      stage: 'new_story_ad.scene_consistency_qa',
      systemPrompt: 'Audit an authorized real-person production dossier without identifying the person by name.',
      userPrompt: [
        'Image 1 is the immutable authorized source, image 2 is the approved outfit anchor, remaining images are derived atomic assets.',
        'Return strict JSON with pass, source_identity_score, cross_view_identity_score, adult_age_consistency_score, body_proportion_score, wardrobe_consistency_score, expression_identity_score, action_physics_score, contact_consistency_score, reasons.',
        'Fail when identity < 0.86, cross-view identity < 0.84, adult age consistency < 0.84, wardrobe < 0.86, or hands/prop contact are physically inconsistent.',
        knowledgeRuntime.qaBlock(knowledgePolicy),
      ].join('\n'),
      imageUrls: [sourceUrl, anchorUrl, ...batch.map(item => item.image_url)].slice(0, 8),
      maxTokens: 2200,
    });
    return jsonRepair.parseOrRepair({ raw: result.text, expected: 'object', modelGateway, taskId });
  });
  const scoreKeys = [
    'source_identity_score',
    'cross_view_identity_score',
    'adult_age_consistency_score',
    'body_proportion_score',
    'wardrobe_consistency_score',
    'expression_identity_score',
    'action_physics_score',
    'contact_consistency_score',
  ];
  const combined = Object.fromEntries(scoreKeys.map(key => [
    key,
    Math.min(...rows.map(row => Number(row[key] || 0))),
  ]));
  return {
    pass: rows.every(row => row.pass !== false)
      && combined.source_identity_score >= 0.86
      && combined.cross_view_identity_score >= 0.84
      && combined.adult_age_consistency_score >= 0.84
      && combined.wardrobe_consistency_score >= 0.86,
    ...combined,
    reasons: rows.flatMap(row => Array.isArray(row.reasons) ? row.reasons : []).slice(0, 30),
    batch_count: rows.length,
  };
}

async function runDossier(initial) {
  let production = initial;
  let sourceBridge = null;
  try {
    const knowledgePolicy = knowledgeRuntime.resolveTaskMany({
      storage: taskStorage, taskId: production.task_id, context: production,
      selectors: [{ stage: 'person_dossier', assetType: 'person' }],
    });
    const anchorUrl = production.approved_anchor.image_url;
    const source = readSource(production.user_id, production.source_identity_id);
    if (!source) {
      const error = new Error('真人身份来源已不存在，不能执行来源一致性校验');
      error.code = 'REAL_PERSON_SOURCE_NOT_FOUND';
      throw error;
    }
    sourceBridge = makeBridge(source, 'dossier_identity_bridge');
    const revision = Math.max(1, Number(production.versions.person || 1));
    const compiled = await personDossierCompiler.compilePersonDossier({
      taskId: production.task_id,
      assetId: production.approved_candidate_id || 'authorized_person',
      revision,
      anchorUrl,
      personPrompt: [
        production.wardrobe || '',
        production.approved_anchor?.prompt || '',
        production.person_profile?.displayName ? `Character name: ${production.person_profile.displayName}.` : '',
        production.person_profile?.roleName ? `Story role: ${production.person_profile.roleName}.` : '',
        production.person_profile?.age ? `Apparent age range: ${production.person_profile.age}.` : '',
        production.person_profile?.appearanceText ? `Authorized appearance notes: ${production.person_profile.appearanceText}.` : '',
        production.person_profile?.hairMakeupText ? `Hair and makeup lock: ${production.person_profile.hairMakeupText}.` : '',
        production.person_profile?.negativeText ? `Do not introduce: ${production.person_profile.negativeText}.` : '',
        'Authorized real-person identity. Preserve the approved outfit anchor exactly.',
      ].filter(Boolean).join('\n'),
      requireReferences: true,
      generationSettings: { model: production.image_model || 'auto', resolution: '2K', quality: 'standard' },
      knowledgePolicy: {
        ...knowledgePolicy,
        prompt_block: knowledgeRuntime.promptBlock(knowledgePolicy),
      },
      loadCheckpoint: async key => (
        readProduction(production.user_id, production.task_id).dossier_checkpoints?.[key] || null
      ),
      saveCheckpoint: async (key, checkpoint) => {
        const latest = readProduction(production.user_id, production.task_id);
        saveProduction({
          ...latest,
          dossier_checkpoints: {
            ...(latest.dossier_checkpoints || {}),
            [key]: checkpoint,
          },
        });
      },
      onProgress: async ({ completed, total, kind, reused }) => {
        throwIfCancelled(production.user_id, production.task_id, 'dossier');
        production = updateJob(readProduction(production.user_id, production.task_id), 'dossier', {
          status: 'running',
          phase: `${reused ? '复用' : '生成'}人物${kind}图集 ${completed}/${total}`,
          progress: 5 + Math.round((completed / total) * 75),
        });
      },
    });
    const atomicAssets = compiled.atomic_assets;
    production = updateJob(readProduction(production.user_id, production.task_id), 'dossier', {
      status: 'running',
      phase: '批量校验来源身份、跨视图、服装与动作一致性',
      progress: 86,
    });
    const qa = await dossierQa({
      taskId: production.task_id,
      sourceUrl: sourceBridge.url,
      anchorUrl,
      atomicAssets,
      knowledgePolicy,
    });
    production = updateJob(readProduction(production.user_id, production.task_id), 'dossier', {
      status: 'running',
      phase: '本地合成人物设定档案',
      progress: 94,
    });
    const referenceBoard = await dossierComposites.composePersonReferenceBoard({
      taskId: production.task_id,
      assetId: production.approved_candidate_id || 'authorized_person',
      anchor: production.approved_anchor,
      atomicAssets,
      revision,
    });
    const loadDetailCheckpoint = async key => (
      readProduction(production.user_id, production.task_id).dossier_checkpoints?.[key] || null
    );
    const saveDetailCheckpoint = async (key, value) => {
      const latest = readProduction(production.user_id, production.task_id);
      saveProduction({
        ...latest,
        dossier_checkpoints: { ...(latest.dossier_checkpoints || {}), [key]: value },
      });
    };
    const accessoryEvidence = await wearableEvidence.resolve({
      taskId: production.task_id,
      assetId: production.approved_candidate_id || 'authorized_person',
      anchor: production.approved_anchor,
      atomicAssets,
      revision,
      profile: { ...(production.person_profile || {}), generation_settings: { model: production.image_model || 'auto' } },
      loadCheckpoint: loadDetailCheckpoint,
      saveCheckpoint: saveDetailCheckpoint,
    });
    const accessoryDetails = accessoryEvidence.items;
    const wardrobeDetails = await dossierComposites.generateWardrobeDetails({
      taskId: production.task_id,
      assetId: production.approved_candidate_id || 'authorized_person',
      anchor: production.approved_anchor,
      atomicAssets,
      revision,
      profile: production.person_profile || {},
      loadCheckpoint: loadDetailCheckpoint,
      saveCheckpoint: saveDetailCheckpoint,
    });
    const sheet = await dossierComposites.composePersonDossier({
      taskId: production.task_id,
      assetId: production.approved_candidate_id || 'authorized_person',
      anchor: production.approved_anchor,
      atomicAssets,
      revision,
      profile: production.person_profile || {},
      wardrobeDetails,
      accessoryDetails,
    });
    production = readProduction(production.user_id, production.task_id);
    production = saveProduction({
      ...production,
      dossier: {
        id: `person_dossier_${uuidv4()}`,
        revision,
        status: 'pending_approval',
        anchor_candidate_id: production.approved_candidate_id,
        schema_version: compiled.schema_version,
        quality_status: compiled.quality_status,
        native_masters: compiled.native_masters,
        category_atlases: compiled.category_atlases,
        generation_summary: compiled.generation_summary,
        knowledge_policy_trace: knowledgeRuntime.trace(knowledgePolicy),
        atomic_assets: atomicAssets,
        body_views: atomicAssets.filter(item => item.kind === 'body'),
        identity_views: atomicAssets.filter(item => item.kind === 'identity'),
        expressions: atomicAssets.filter(item => item.kind === 'expression'),
        base_actions: atomicAssets.filter(item => item.kind === 'action'),
        accessory_details: accessoryDetails,
        accessory_evidence_trace: accessoryEvidence.trace,
        wardrobe_details: {
          source: 'gpt_image_2_high_resolution_details',
          description: production.wardrobe || (production.mode === 'retain_original' ? '保留原穿搭' : ''),
          items: wardrobeDetails,
          model_call_count: wardrobeDetails.reduce((sum, item) => sum + Number(item.model_call_count || 0), 0),
        },
        motion_profile: {
          dominant_hand: 'confirm_in_storyboard',
          gait: 'natural',
          base_actions: BASE_ACTIONS,
        },
        sheet,
        reference_board: referenceBoard,
        qa: {
          ...qa,
          status: qa.pass ? 'automated_pass_pending_human_approval' : 'automated_failed',
          source_identity_threshold: 0.86,
          cross_view_identity_threshold: 0.84,
          wardrobe_threshold: 0.86,
        },
        created_at: now(),
      },
      versions: {
        ...production.versions,
        expression: Math.max(1, Number(production.versions.expression || 0) + 1),
        action: Math.max(1, Number(production.versions.action || 0) + 1),
      },
      dossier_job: {
        ...(production.dossier_job || {}),
        status: 'completed',
        phase: '人物档案已生成，等待人工确认',
        progress: 100,
        completed_at: now(),
      },
    });
  } catch (error) {
    production = readProduction(production.user_id, production.task_id);
    updateJob(production, 'dossier', error.cancelled
      ? { status: 'cancelled', phase: '已取消' }
      : {
        status: 'failed',
        phase: '人物档案生成失败',
        error: { code: error.code || 'PERSON_DOSSIER_FAILED', message: String(error.message || error).slice(0, 500) },
      });
  } finally {
    removeBridge(sourceBridge);
    activeJobs.delete(jobKey(initial.task_id, 'dossier'));
  }
}

function startDossier({ taskId, user = {}, imageModel = '' } = {}) {
  const userId = ownerId(user);
  let production = readProduction(userId, taskId);
  if (!production.approved_anchor?.image_url) {
    const error = new Error('请先确认一个通过身份校验的换装候选');
    error.code = 'APPROVED_PERSON_ANCHOR_REQUIRED';
    error.status = 422;
    throw error;
  }
  const key = jobKey(taskId, 'dossier');
  if (activeJobs.has(key) || ['queued', 'running'].includes(production.dossier_job?.status)) {
    return { production, accepted: false, duplicate: true };
  }
  production = saveProduction({ ...production, image_model: String(imageModel || '').slice(0, 220) });
  production = updateJob(production, 'dossier', {
    id: `person_dossier_job_${uuidv4()}`,
    status: 'queued',
    phase: '已进入人物档案队列',
    progress: 1,
    cancel_requested: false,
    created_at: now(),
    error: null,
  });
  const promise = runDossier(production);
  activeJobs.set(key, promise);
  return { production, accepted: true, duplicate: false };
}

function approveDossier({ taskId, user = {} } = {}) {
  const production = readProduction(ownerId(user), taskId);
  if (!production.dossier || production.dossier.status !== 'pending_approval' || production.dossier.qa?.pass !== true) {
    const error = new Error('没有待确认的人物档案');
    error.code = 'PERSON_DOSSIER_NOT_APPROVABLE';
    error.status = 422;
    throw error;
  }
  return saveProduction({
    ...production,
    dossier: {
      ...production.dossier,
      status: 'approved',
      approved_at: now(),
      production_usable_actor: true,
    },
    provider_sync: {
      status: 'pending',
      progress: 0,
      phase: '人物档案已确认，等待同步到 Seedance 人物资产库',
      error: null,
      updated_at: now(),
    },
  });
}

function updateApprovedAsset({ taskId, user = {}, asset = null, providerSync = null } = {}) {
  const production = readProduction(ownerId(user), taskId);
  if (production.dossier?.status !== 'approved') {
    const error = new Error('人物档案尚未确认，不能写入人物资产或厂商人物 ID');
    error.code = 'PERSON_DOSSIER_NOT_APPROVED';
    error.status = 422;
    throw error;
  }
  return saveProduction({
    ...production,
    ...(asset ? { committed_asset: asset } : {}),
    ...(providerSync ? {
      provider_sync: {
        ...(production.provider_sync || {}),
        ...providerSync,
        updated_at: now(),
      },
    } : {}),
  });
}

function deriveActionContracts(storyboard = {}) {
  const shots = Array.isArray(storyboard) ? storyboard : (storyboard.shots || storyboard.rows || []);
  return shots.slice(0, 30).map((shot, index) => ({
    id: `action_contract_${index + 1}`,
    shot_index: Number(shot.shot_index ?? shot.index ?? index),
    start_pose: String(shot.action_start || shot.start_pose || '承接上一镜头姿态'),
    key_action: String(shot.action || shot.key_action || '执行剧情关键动作'),
    end_pose: String(shot.action_end || shot.end_pose || '形成可衔接的结束姿态'),
    dominant_hand: String(shot.dominant_hand || '按人物动作档案'),
    prop_contact: String(shot.prop_contact || shot.interaction || '按分镜确认'),
    screen_direction: String(shot.screen_direction || '保持既定屏幕方向'),
    eyeline: String(shot.eyeline || '按互动目标'),
    expression_change: String(shot.expression_change || '与剧情节点一致'),
    required_scene_zone: String(shot.scene_zone || shot.zone || '按场景空间锁'),
    previous_frame_dependency: String(shot.previous_frame_dependency || '延续上一镜头人物与道具状态'),
  }));
}

function actionTriptychPrompt(contract = {}, knowledgePrompt = '') {
  return [
    'Use the approved authorized person anchor as the immutable identity and outfit reference.',
    'Create a three-panel action continuity reference on a plain background, left-to-right: START, KEY ACTION, END.',
    `Start pose: ${contract.start_pose}.`,
    `Key action: ${contract.key_action}.`,
    `End pose: ${contract.end_pose}.`,
    `Dominant hand: ${contract.dominant_hand}; prop/contact: ${contract.prop_contact}.`,
    `Screen direction: ${contract.screen_direction}; eyeline: ${contract.eyeline}; expression change: ${contract.expression_change}.`,
    `Required scene zone: ${contract.required_scene_zone}; continuity: ${contract.previous_frame_dependency}.`,
    knowledgePrompt,
    'Preserve face, apparent adult age, body proportions, hairstyle, garments, shoes and accessories exactly.',
    'No labels, no captions, no typography. Leave visual separation between three panels.',
  ].join('\n');
}

async function runActionAssets(initial, contracts) {
  let production = initial;
  try {
    const knowledgePolicy = knowledgeRuntime.resolveTaskMany({
      storage: taskStorage, taskId: production.task_id, context: production,
      selectors: [{ stage: 'person_dossier', assetType: 'person' }],
    });
    const knowledgePrompt = knowledgeRuntime.promptBlock(knowledgePolicy);
    const revision = Math.max(1, Number(production.versions.action || 1));
    const assets = [];
    for (let index = 0; index < contracts.length; index += 1) {
      throwIfCancelled(production.user_id, production.task_id, 'action');
      const contract = contracts[index];
      production = updateJob(readProduction(production.user_id, production.task_id), 'action', {
        status: 'running',
        phase: `生成剧情动作三联图 ${index + 1}/${contracts.length}`,
        progress: 5 + Math.round((index / Math.max(1, contracts.length)) * 88),
      });
      const image = await mediaAdapter.generateActorReference({
        taskId: production.task_id,
        stage: 'new_story_ad.person_sheet',
        prompt: actionTriptychPrompt(contract, knowledgePrompt),
        filename: `person_action_${contract.shot_index}_r${revision}_${personDossierCompiler.compactAssetToken(production.task_id, production.approved_candidate_id, contract.shot_index)}`,
        aspectRatio: '16:9',
        referenceImages: [production.approved_anchor.image_url],
        requireReferences: true,
        inputFidelity: 'high',
        clientRequestId: `${production.task_id}:action:${contract.shot_index}:r${revision}`,
        imageModel: production.image_model || 'auto',
        singleAttempt: true,
      });
      assets.push({
        id: `action_asset_${uuidv4()}`,
        contract,
        image_url: image.image_url || image.url,
        filename: image.filename || '',
        provider_used: image.provider_used || '',
        strict_reference_required: true,
        input_fidelity: 'high',
        status: 'pending_approval',
        created_at: now(),
      });
    }
    production = readProduction(production.user_id, production.task_id);
    saveProduction({
      ...production,
      action_assets: assets,
      versions: {
        ...production.versions,
        action: Math.max(1, Number(production.versions.action || 0) + 1),
      },
      action_job: {
        ...(production.action_job || {}),
        status: 'completed',
        phase: '剧情动作资产已生成，等待确认',
        progress: 100,
        completed_at: now(),
      },
    });
  } catch (error) {
    production = readProduction(production.user_id, production.task_id);
    updateJob(production, 'action', error.cancelled
      ? { status: 'cancelled', phase: '已取消' }
      : {
        status: 'failed',
        phase: '剧情动作资产生成失败',
        error: { code: error.code || 'PERSON_ACTION_ASSET_FAILED', message: String(error.message || error).slice(0, 500) },
      });
  } finally {
    activeJobs.delete(jobKey(initial.task_id, 'action'));
  }
}

function startActionAssets({ taskId, user = {}, storyboard = {}, imageModel = '' } = {}) {
  const userId = ownerId(user);
  let production = readProduction(userId, taskId);
  if (production.dossier?.status !== 'approved' || !production.approved_anchor?.image_url) {
    const error = new Error('请先确认人物档案，再生成剧情专用动作资产');
    error.code = 'APPROVED_PERSON_DOSSIER_REQUIRED';
    error.status = 422;
    throw error;
  }
  const contracts = deriveActionContracts(storyboard).filter(contract => (
    contract.key_action && !/自然站立|无动作|none/i.test(contract.key_action)
  ));
  if (!contracts.length) {
    const error = new Error('当前分镜没有需要单独生成人物动作资产的镜头');
    error.code = 'ACTION_CONTRACTS_EMPTY';
    error.status = 422;
    throw error;
  }
  const key = jobKey(taskId, 'action');
  if (activeJobs.has(key) || ['queued', 'running'].includes(production.action_job?.status)) {
    return { production, accepted: false, duplicate: true };
  }
  production = saveProduction({ ...production, image_model: String(imageModel || '').slice(0, 220) });
  production = updateJob(production, 'action', {
    id: `person_action_job_${uuidv4()}`,
    status: 'queued',
    phase: '已进入剧情动作资产队列',
    progress: 1,
    cancel_requested: false,
    contract_count: contracts.length,
    created_at: now(),
    error: null,
  });
  const promise = runActionAssets(production, contracts);
  activeJobs.set(key, promise);
  return { production, accepted: true, duplicate: false };
}

function cancelJob({ taskId, kind, user = {} } = {}) {
  if (!['candidate', 'dossier', 'action'].includes(kind)) {
    const error = new Error('人物任务类型无效');
    error.code = 'PERSON_JOB_KIND_INVALID';
    error.status = 422;
    throw error;
  }
  let production = readProduction(ownerId(user), taskId);
  const current = production[`${kind}_job`];
  if (!current || !['queued', 'running'].includes(current.status)) return production;
  production = updateJob(production, kind, {
    cancel_requested: true,
    status: 'cancelling',
    phase: '正在取消',
  });
  return production;
}

function getProduction(taskId, user = {}) {
  return readProduction(ownerId(user), taskId);
}

module.exports = {
  ROOT_DIR,
  BODY_VIEWS,
  IDENTITY_VIEWS,
  EXPRESSIONS,
  BASE_ACTIONS,
  createSource,
  sourceImagePath,
  deleteSource,
  startCandidates,
  approveCandidate,
  startDossier,
  approveDossier,
  updateApprovedAsset,
  startActionAssets,
  cancelJob,
  getProduction,
  deriveActionContracts,
  _private: {
    activeJobs,
    readProduction,
    composeDossier: (taskId, atomicAssets, revision) => dossierComposites.composePersonDossier({
      taskId,
      atomicAssets,
      revision,
    }),
    sourceDir,
    outfitPrompt,
    actionTriptychPrompt,
  },
};
