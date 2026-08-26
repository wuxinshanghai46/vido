const crypto = require('crypto');

const METADATA_KEYS = new Set([
  'base_content_revision', 'baseContentRevision', 'client_edit_seq', 'clientEditSeq',
]);
const WORKFLOW_CONFIRMATION_KEYS = new Set([
  'asset_setup_confirmed', 'assetSetupConfirmed', 'scene_setup_confirmed', 'sceneSetupConfirmed',
  'shot_design_confirmed', 'shotDesignConfirmed',
]);

/** 判断请求是否只更新环节完成状态，不包含创意内容。 */
function isWorkflowConfirmationOnly(body = {}) {
  const businessKeys = Object.keys(body || {}).filter(key => !METADATA_KEYS.has(key));
  return businessKeys.length > 0 && businessKeys.every(key => WORKFLOW_CONFIRMATION_KEYS.has(key));
}

/** 在不重新规范化创意上下文的前提下写入显式环节确认。 */
function applyWorkflowConfirmations(previous = {}, body = {}) {
  return {
    ...previous,
    ...(Object.prototype.hasOwnProperty.call(body, 'asset_setup_confirmed')
      || Object.prototype.hasOwnProperty.call(body, 'assetSetupConfirmed')
      ? { asset_setup_confirmed: body.asset_setup_confirmed === true || body.assetSetupConfirmed === true }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(body, 'shot_design_confirmed')
      || Object.prototype.hasOwnProperty.call(body, 'shotDesignConfirmed')
      ? { shot_design_confirmed: body.shot_design_confirmed === true || body.shotDesignConfirmed === true }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(body, 'scene_setup_confirmed')
      || Object.prototype.hasOwnProperty.call(body, 'sceneSetupConfirmed')
      ? { scene_setup_confirmed: body.scene_setup_confirmed === true || body.sceneSetupConfirmed === true }
      : {}),
  };
}

function canonicalStoryboardValue(value) {
  if (Array.isArray(value)) return value.map(canonicalStoryboardValue);
  if (!value || typeof value !== 'object') return value;
  const ignored = new Set(['edited_at', '_prompt_preview']);
  return Object.keys(value).sort().reduce((out, key) => {
    if (!ignored.has(key) && value[key] !== undefined) out[key] = canonicalStoryboardValue(value[key]);
    return out;
  }, {});
}

function canonicalBlueprintValue(value) {
  if (Array.isArray(value)) return value.map(canonicalBlueprintValue);
  if (!value || typeof value !== 'object') return value;
  const ignored = new Set(['edited_at', 'edited_by_user', 'model_meta', 'revision', 'fingerprint']);
  return Object.keys(value).sort().reduce((out, key) => {
    if (!ignored.has(key)) out[key] = canonicalBlueprintValue(value[key]);
    return out;
  }, {});
}

/** 按真实剧情内容计算指纹，忽略版本和编辑元数据。 */
function blueprintFingerprint(blueprint = {}) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(canonicalBlueprintValue(blueprint || {})))
    .digest('hex');
}

/** 阻止旧页面的手工编辑覆盖服务端最新内容版本。 */
function assertManualEditRevision(task = {}, options = {}) {
  const raw = options.expected_content_revision ?? options.expectedContentRevision;
  if (raw === undefined || raw === null || raw === '') return;
  const expected = Math.max(1, Number(raw) || 1);
  const actual = Math.max(1, Number(task.content_revision || 1) || 1);
  if (expected === actual) return;
  const error = new Error(`任务已在其他页面更新为版本 ${actual}，当前编辑版本 ${expected} 不能覆盖最新内容。`);
  Object.assign(error, { code: 'CONTENT_REVISION_CONFLICT', status: 409, retryable: false, content_revision: actual });
  throw error;
}

/** 只按真实分镜内容计算指纹，忽略编辑时间和预览缓存字段。 */
function storyboardFingerprint(shots = []) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(canonicalStoryboardValue(Array.isArray(shots) ? shots : [])))
    .digest('hex');
}

/** 为参考视频投影补齐下一环节要求的起止状态草稿。 */
function referenceFrameStates(shot = {}, { visual = '', action = '', cleanText } = {}) {
  const clean = typeof cleanText === 'function' ? cleanText : value => String(value || '').trim();
  const source = clean(shot.source || '', 80);
  const referenceProjection = ['reference_analysis_projection', 'user_confirmed_reference'].includes(source);
  return {
    entry_frame_state: clean(
      shot.entry_frame_state || shot.entry || shot.start_state
        || (referenceProjection ? `镜头开始：${visual}` : ''),
      900,
    ) || undefined,
    exit_frame_state: clean(
      shot.exit_frame_state || shot.exit || shot.end_state
        || (referenceProjection ? `镜头结束：${action || visual}` : ''),
      900,
    ) || undefined,
  };
}

module.exports = {
  applyWorkflowConfirmations,
  assertManualEditRevision,
  blueprintFingerprint,
  isWorkflowConfirmationOnly,
  referenceFrameStates,
  storyboardFingerprint,
};
