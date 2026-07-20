const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const storage = require('./storageService');
const mediaAdapter = require('./mediaAdapter');

const CHECKPOINT_SCHEMA_VERSION = 1;
const CHECKPOINT_OUTPUT_PREFIX = 'scene_asset_checkpoint:';
const DEFAULT_TTL_MS = 48 * 60 * 60 * 1000;
const CHECKPOINT_TTL_MS = Math.max(
  60 * 60 * 1000,
  Number(process.env.NEW_STORY_AD_SCENE_CHECKPOINT_TTL_MS || DEFAULT_TTL_MS) || DEFAULT_TTL_MS,
);
const RESUMABLE_STATUSES = new Set(['running', 'partial', 'ready_for_qa']);

function nowIso() {
  return new Date().toISOString();
}

function safePart(value = '', max = 48) {
  return String(value || '')
    .replace(/[^a-z0-9_-]/ig, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, max) || 'scene';
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) result[key] = stableValue(value[key]);
    return result;
  }, {});
}

function inputFingerprint(input = {}) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(stableValue(input)))
    .digest('hex');
}

function outputKind(sceneId = '') {
  return `${CHECKPOINT_OUTPUT_PREFIX}${safePart(sceneId, 100)}`;
}

function candidateFilename(checkpoint = {}, viewKey = '') {
  return [
    'scene_asset',
    safePart(checkpoint.task_id, 32),
    safePart(checkpoint.scene_id, 32),
    `r${Math.max(1, Number(checkpoint.candidate_revision || 1) || 1)}`,
    'candidate',
    String(checkpoint.input_fingerprint || '').slice(0, 12),
    safePart(viewKey, 24),
    'image',
  ].join('_');
}

function viewUrl(view = {}) {
  return String(view.url || view.image_url || view.imageUrl || '').trim();
}

function localAssetFile(view = {}) {
  const direct = String(view.filePath || view.file_path || '').trim();
  if (direct) {
    const resolved = path.resolve(direct);
    const root = path.resolve(mediaAdapter.ASSET_DIR);
    if (resolved === root || resolved.startsWith(root + path.sep)) return resolved;
  }
  const url = viewUrl(view);
  if (!url.startsWith('/api/new-story-ad/assets/')) return '';
  return mediaAdapter.assetPathFromName(decodeURIComponent(url.split('/').pop()?.split('?')[0] || ''));
}

function reusableView(view = {}) {
  if (!view || view.status !== 'succeeded' || !viewUrl(view)) return false;
  const localFile = localAssetFile(view);
  return localFile ? fs.existsSync(localFile) : true;
}

function checkpointView(checkpoint = {}, viewKey = '') {
  const view = checkpoint.views?.[viewKey] || null;
  return reusableView(view) ? view : null;
}

function initialViewStates(checkpoint = {}, viewKeys = []) {
  return viewKeys.map(key => {
    const view = checkpoint.views?.[key] || {};
    const reusable = reusableView(view);
    return {
      key,
      status: reusable ? 'succeeded' : (view.status === 'failed' ? 'failed' : 'queued'),
      attempt: Math.max(0, Number(view.attempts || 0) || 0),
      error: reusable ? '' : String(view.error || '').slice(0, 240),
      retrying: false,
      updated_at: view.updated_at || checkpoint.updated_at || nowIso(),
    };
  });
}

function save(checkpoint = {}) {
  checkpoint.updated_at = nowIso();
  storage.saveOutput(checkpoint.task_id, outputKind(checkpoint.scene_id), checkpoint);
  return checkpoint;
}

function checkpointExpired(checkpoint = {}) {
  const updated = Date.parse(checkpoint.updated_at || checkpoint.created_at || '') || 0;
  return updated > 0 && Date.now() - updated > CHECKPOINT_TTL_MS;
}

function cleanupUnpublishedFiles(checkpoint = {}) {
  if (!checkpoint || checkpoint.status === 'published') return 0;
  const assetRoot = path.resolve(mediaAdapter.ASSET_DIR);
  const thumbRoot = path.resolve(mediaAdapter.THUMB_DIR);
  let removed = 0;
  Object.values(checkpoint.views || {}).forEach(view => {
    const file = localAssetFile(view);
    if (!file || !path.basename(file).includes('_candidate_')) return;
    const resolved = path.resolve(file);
    if (!(resolved.startsWith(assetRoot + path.sep))) return;
    try {
      if (fs.existsSync(resolved)) {
        fs.rmSync(resolved, { force: true });
        removed += 1;
      }
      const base = path.basename(resolved);
      if (fs.existsSync(thumbRoot)) {
        fs.readdirSync(thumbRoot)
          .filter(name => name.startsWith(`${base}.`))
          .forEach(name => fs.rmSync(path.join(thumbRoot, name), { force: true }));
      }
    } catch (_) {}
  });
  return removed;
}

function open({
  taskId,
  sceneId,
  fingerprint,
  candidateRevision,
  viewKeys = [],
  retryBudget = null,
  metadata = {},
} = {}) {
  const kind = outputKind(sceneId);
  const existing = storage.getOutput(taskId, kind);
  const canResume = existing
    && existing.schema_version === CHECKPOINT_SCHEMA_VERSION
    && existing.input_fingerprint === fingerprint
    && RESUMABLE_STATUSES.has(existing.status)
    && !checkpointExpired(existing);

  if (canResume) {
    existing.status = 'running';
    existing.resume_count = Math.max(0, Number(existing.resume_count || 0) || 0) + 1;
    existing.last_resumed_at = nowIso();
    existing.view_keys = [...new Set([...(existing.view_keys || []), ...viewKeys])];
    existing.metadata = { ...(existing.metadata || {}), ...metadata };
    return { checkpoint: save(existing), resumed: true };
  }

  if (existing && existing.status !== 'published') {
    existing.status = 'invalidated';
    existing.invalidated_at = nowIso();
    existing.invalidated_reason = checkpointExpired(existing) ? 'checkpoint_expired' : 'input_fingerprint_changed';
    cleanupUnpublishedFiles(existing);
  }

  const checkpoint = {
    schema_version: CHECKPOINT_SCHEMA_VERSION,
    task_id: String(taskId),
    scene_id: String(sceneId),
    input_fingerprint: String(fingerprint),
    candidate_revision: Math.max(1, Number(candidateRevision || 1) || 1),
    status: 'running',
    view_keys: [...new Set(viewKeys)],
    views: {},
    retry_budget: {
      max_extra: Math.max(0, Number(retryBudget?.maxExtra ?? retryBudget?.max_extra ?? 0) || 0),
      used_extra: Math.max(0, Number(retryBudget?.usedExtra ?? retryBudget?.used_extra ?? 0) || 0),
      reasons: Array.isArray(retryBudget?.reasons) ? retryBudget.reasons.slice(-20) : [],
    },
    metadata,
    resume_count: 0,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  return { checkpoint: save(checkpoint), resumed: false };
}

function syncRetryBudget(checkpoint = {}, budget = {}) {
  checkpoint.retry_budget = {
    max_extra: Math.max(0, Number(budget.maxExtra || 0) || 0),
    used_extra: Math.max(0, Number(budget.usedExtra || 0) || 0),
    reasons: Array.isArray(budget.reasons) ? budget.reasons.slice(-20) : [],
  };
  return save(checkpoint);
}

function markSucceeded(checkpoint = {}, viewKey = '', view = {}, budget = null) {
  checkpoint.views[viewKey] = {
    ...(checkpoint.views[viewKey] || {}),
    ...view,
    key: viewKey,
    status: 'succeeded',
    attempts: Math.max(1, Number(view.attempts || checkpoint.views[viewKey]?.attempts || 1) || 1),
    error: '',
    error_code: '',
    succeeded_at: nowIso(),
    updated_at: nowIso(),
  };
  if (budget) checkpoint.retry_budget = {
    max_extra: budget.maxExtra,
    used_extra: budget.usedExtra,
    reasons: Array.isArray(budget.reasons) ? budget.reasons.slice(-20) : [],
  };
  return save(checkpoint);
}

function markFailed(checkpoint = {}, viewKey = '', error = null, budget = null) {
  checkpoint.status = 'partial';
  checkpoint.views[viewKey] = {
    ...(checkpoint.views[viewKey] || {}),
    key: viewKey,
    status: 'failed',
    attempts: Math.max(1, Number(checkpoint.views[viewKey]?.attempts || 0) + 1),
    error: String(error?.message || error || '').slice(0, 500),
    error_code: String(error?.code || 'SCENE_VIEW_GENERATION_FAILED').slice(0, 100),
    retryable: error?.retryable === true,
    failed_at: nowIso(),
    updated_at: nowIso(),
  };
  if (budget) checkpoint.retry_budget = {
    max_extra: budget.maxExtra,
    used_extra: budget.usedExtra,
    reasons: Array.isArray(budget.reasons) ? budget.reasons.slice(-20) : [],
  };
  return save(checkpoint);
}

function setLayoutAcquisition(checkpoint = {}, value = null) {
  checkpoint.layout_acquisition = value;
  return save(checkpoint);
}

function markReadyForQa(checkpoint = {}) {
  checkpoint.status = 'ready_for_qa';
  checkpoint.ready_for_qa_at = nowIso();
  return save(checkpoint);
}

function markPartial(checkpoint = {}, error = null) {
  checkpoint.status = 'partial';
  checkpoint.last_error = String(error?.message || error || '').slice(0, 500);
  checkpoint.last_error_code = String(error?.code || 'SCENE_VIEWS_INCOMPLETE').slice(0, 100);
  return save(checkpoint);
}

function markPublished(checkpoint = {}, asset = {}) {
  checkpoint.status = 'published';
  checkpoint.published_revision = Number(asset.scene_revision || checkpoint.candidate_revision || 1) || 1;
  checkpoint.published_at = nowIso();
  checkpoint.last_error = '';
  checkpoint.last_error_code = '';
  return save(checkpoint);
}

module.exports = {
  CHECKPOINT_SCHEMA_VERSION,
  CHECKPOINT_OUTPUT_PREFIX,
  CHECKPOINT_TTL_MS,
  inputFingerprint,
  outputKind,
  candidateFilename,
  reusableView,
  checkpointView,
  initialViewStates,
  open,
  syncRetryBudget,
  markSucceeded,
  markFailed,
  setLayoutAcquisition,
  markReadyForQa,
  markPartial,
  markPublished,
  cleanupUnpublishedFiles,
};
