const path = require('path');
const storage = require('./storageService');
const cancellation = require('./cancellationContext');
const deyunaiService = require('../deyunaiService');
const boundaryRepair = require('./videoBoundaryRepairService');
const publicReferences = require('./publicReferenceService');

function publicBaseUrl(options = {}) {
  return String(options.public_base_url || options.publicBaseUrl || publicReferences.publicBaseUrl()).replace(/\/+$/, '');
}

function absoluteAssetUrl(url = '', options = {}) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${publicBaseUrl(options)}${raw.startsWith('/') ? raw : `/${raw}`}`;
}

function safeBase(value = '') {
  return String(value || '').replace(/[^a-z0-9_.-]+/ig, '_').replace(/^_+|_+$/g, '') || 'asset';
}

async function prepareBoundaryReferenceAsset({ taskId = '', contract = {}, options = {} } = {}) {
  const sourceUrl = absoluteAssetUrl(contract.previous_tail_image_url || '', options);
  if (!sourceUrl || !contract.fingerprint) {
    const error = new Error('跨生成单元修复缺少可核验的上一单元尾帧，已在提交视频模型前停止。');
    error.code = 'VIDEO_BOUNDARY_REPAIR_EVIDENCE_MISSING'; error.status = 409; error.retryable = false;
    throw error;
  }
  const saved = storage.getOutput(taskId, 'deyunai_boundary_reference_assets') || {};
  const identity = safeBase(`${contract.previous_shot_index + 1}_${contract.current_shot_index + 1}_${contract.fingerprint}`).slice(0, 52);
  const asset = await deyunaiService.ensurePersonImageAsset({
    sourceUrl, assetKind: 'scene', name: `vido_boundary_${identity}`, groupName: `vido_boundary_${identity}`,
    groupType: 'AIGC', projectName: options.deyunai_project_name || options.deyunaiProjectName || 'default',
    existing: saved[contract.fingerprint] || null, signal: cancellation.signal(),
  });
  storage.saveOutput(taskId, 'deyunai_boundary_reference_assets', { ...saved, [contract.fingerprint]: asset });
  return asset;
}

function assertProviderInput({ contract = null, providerRoute = '', inputMode = '', currentKeyframeAssetUrl = '', previousTailAssetUrl = '', referenceAssetUrls = [] } = {}) {
  if (!contract?.fingerprint) return;
  const direct = inputMode === boundaryRepair.DIRECT_TAIL_FIRST_FRAME;
  if (direct) {
    const error = new Error('上一镜尾帧不能替代当前已批准关键帧，已在付费提交前停止。');
    error.code = 'VIDEO_BOUNDARY_REPAIR_TAIL_INSUFFICIENT'; error.status = 409; error.retryable = false;
    throw error;
  }
  const complete = !!(currentKeyframeAssetUrl && previousTailAssetUrl && referenceAssetUrls.includes(previousTailAssetUrl));
  if (!boundaryRepair.providerSupportsBoundaryReference(providerRoute) || !complete) {
    const error = new Error('跨镜修复输入未同时绑定当前关键帧和上一单元真实尾帧，已在付费提交前停止。');
    error.code = 'VIDEO_BOUNDARY_REPAIR_INPUT_INCOMPLETE'; error.status = 409; error.retryable = false;
    throw error;
  }
}

async function prepareInputs({ taskId = '', index = 0, keyframe = {}, contract = null, pinnedModelRoute = '', options = {}, prepareKeyframeReferenceAsset } = {}) {
  if (!contract) return null;
  if (!boundaryRepair.providerSupportsBoundaryReference(pinnedModelRoute)) {
    const error = new Error('当前视频模型不支持跨生成单元双素材修复，已在付费提交前停止。');
    error.code = 'VIDEO_BOUNDARY_REPAIR_MODEL_UNSUPPORTED'; error.status = 409; error.retryable = false;
    throw error;
  }
  const strategy = contract.input_strategy || boundaryRepair.inputStrategy(options);
  if (strategy === boundaryRepair.DIRECT_TAIL_FIRST_FRAME) {
    const error = new Error('上一镜尾帧不能替代当前已批准关键帧所定义的人物、服装、场景、构图和镜头意图，已在付费提交前停止。');
    error.code = 'VIDEO_BOUNDARY_REPAIR_TAIL_INSUFFICIENT'; error.status = 409; error.retryable = false;
    throw error;
  }
  const prepareKeyframe = typeof options._prepareKeyframeReferenceAsset === 'function' ? options._prepareKeyframeReferenceAsset : prepareKeyframeReferenceAsset;
  const prepareBoundary = typeof options._prepareBoundaryReferenceAsset === 'function' ? options._prepareBoundaryReferenceAsset : prepareBoundaryReferenceAsset;
  const [keyframeAsset, boundaryAsset] = await Promise.all([
    prepareKeyframe({ taskId, index, keyframe, options }),
    prepareBoundary({ taskId, contract, options }),
  ]);
  assertProviderInput({
    contract, providerRoute: pinnedModelRoute, inputMode: strategy,
    currentKeyframeAssetUrl: keyframeAsset?.asset_url || '', previousTailAssetUrl: boundaryAsset?.asset_url || '',
    referenceAssetUrls: [boundaryAsset?.asset_url].filter(Boolean),
  });
  return { contract, inputMode: strategy, firstFrameUrl: '', keyframeAsset, boundaryAsset };
}

module.exports = { prepareBoundaryReferenceAsset, assertProviderInput, prepareInputs };
