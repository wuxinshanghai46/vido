'use strict';

function build(asset = {}, deps = {}) {
  const {
    cleanText, sceneViewLabel, sceneGenerationUpgradeRequired, fullSceneUpgradePlan,
    sceneRepairPlanVersion, requiredSceneViewKeys, sceneGenerationOrder,
  } = deps;
  const hasDeclaredGenerationContract = Object.prototype.hasOwnProperty.call(asset, 'generation_contract_version')
    || Object.prototype.hasOwnProperty.call(asset.view_acquisition || {}, 'generation_contract_version');
  const looksLikeStoredGeneratedAsset = Boolean(asset.id || asset.scene_id)
    && (Boolean(asset.image_url) || (Array.isArray(asset.view_images) && asset.view_images.length > 0));
  if ((hasDeclaredGenerationContract || looksLikeStoredGeneratedAsset) && sceneGenerationUpgradeRequired(asset)) {
    return fullSceneUpgradePlan();
  }
  const contract = asset.scene_contract && typeof asset.scene_contract === 'object' ? asset.scene_contract : asset;
  const verificationState = cleanText(contract.verification?.state || asset.verification?.state || '', 40);
  const issues = (Array.isArray(contract.view_issues) ? contract.view_issues : [])
    .filter(issue => cleanText(issue?.evidence || issue?.visual_evidence || '', 300));
  const reasons = issues.map(issue => cleanText(issue.reason || issue.code, 300)).filter(Boolean).slice(0, 8);
  const visibleViewKeys = new Set((Array.isArray(asset.view_images) ? asset.view_images : [])
    .filter(view => cleanText(view?.url || view?.image_url || '', 1000))
    .map(view => cleanText(view?.key || view?.view || '', 40))
    .filter(Boolean));
  const failedStatusKeys = Object.entries(asset.view_statuses || {})
    .filter(([, value]) => ['failed', 'error', 'rejected', 'billing_unknown']
      .includes(cleanText(value?.status || value?.state || value, 40).toLowerCase()))
    .map(([key]) => cleanText(key, 40));
  const deterministicRepairKeys = new Set([
    ...(looksLikeStoredGeneratedAsset ? requiredSceneViewKeys.filter(key => !visibleViewKeys.has(key)) : []),
    ...(Array.isArray(asset.failed_view_keys) ? asset.failed_view_keys : []),
    ...failedStatusKeys,
  ]);
  const incompleteViewKeys = sceneGenerationOrder.filter(key => deterministicRepairKeys.has(key));
  const atlasStrategy = cleanText(
    asset.view_strategy || asset.view_acquisition?.selected || asset.space_asset_contract?.strategy || '',
    40,
  ) === 'atlas_2x2';
  if (incompleteViewKeys.length) {
    if (atlasStrategy && incompleteViewKeys.some(key => key !== 'layout')) {
      return {
        version: sceneRepairPlanVersion, action: 'rebuild_atlas', view_keys: [...sceneGenerationOrder],
        view_labels: sceneGenerationOrder.map(sceneViewLabel), count: 2, provider_image_call_count: 2,
        reasons: incompleteViewKeys.map(key => `缺少或失败的必需视图：${sceneViewLabel(key)}`),
        issue_codes: ['SCENE_VIEWS_INCOMPLETE'],
        message: '空间母图派生视图不完整，系统将重建母图与俯视布局，共 2 次图片调用。',
      };
    }
    return {
      version: sceneRepairPlanVersion, action: 'regenerate_failed_views', view_keys: incompleteViewKeys,
      view_labels: incompleteViewKeys.map(sceneViewLabel), count: incompleteViewKeys.length,
      reasons: incompleteViewKeys.map(key => `缺少或失败的必需视图：${sceneViewLabel(key)}`),
      issue_codes: ['SCENE_VIEWS_INCOMPLETE'],
      message: `系统将先补齐 ${incompleteViewKeys.length} 张确定缺失或失败的视图：${incompleteViewKeys.map(sceneViewLabel).join('、')}；补齐后再统一复核。`,
    };
  }
  if (contract.full_space_lock === true && Number(contract.schema_version || 0) >= 6 && contract.camera_design_qa?.pass === true) {
    return { version: sceneRepairPlanVersion, action: 'none', view_keys: [], view_labels: [], count: 0, reasons: [], message: '完整空间已经锁定，无需修复。' };
  }
  if (contract.qa_unavailable === true || verificationState === 'unavailable') {
    return { version: sceneRepairPlanVersion, action: 'reverify', view_keys: [], view_labels: [], count: 0, reasons, message: '统一修复将先重新定位问题；未取得逐图证据前不会调用图片模型。' };
  }
  if (!issues.length) {
    return { version: sceneRepairPlanVersion, action: 'reverify', view_keys: [], view_labels: [], count: 0, reasons: [], message: '审核尚未提供逐图证据；统一修复会先定位，再决定是否需要图片调用。' };
  }
  const rootCodes = new Set(['ROOT_SCENE_IDENTITY_INVALID', 'ROOT_GEOMETRY_INVALID', 'ROOT_MATERIAL_IDENTITY_INVALID']);
  const rootFailure = issues.some(issue => rootCodes.has(issue.code));
  const keys = new Set(rootFailure
    ? sceneGenerationOrder
    : issues.flatMap(issue => Array.isArray(issue.view_keys) ? issue.view_keys : []));
  const viewKeys = sceneGenerationOrder.filter(key => keys.has(key));
  if (!viewKeys.length) {
    return { version: sceneRepairPlanVersion, action: 'reverify', view_keys: [], view_labels: [], count: 0, reasons, message: '审核证据尚未定位到具体视图；统一修复会先定位，再决定是否需要图片调用。' };
  }
  if (atlasStrategy && viewKeys.some(key => key !== 'layout')) {
    return {
      version: sceneRepairPlanVersion, action: 'rebuild_atlas', view_keys: [...sceneGenerationOrder],
      view_labels: sceneGenerationOrder.map(sceneViewLabel), count: 2, provider_image_call_count: 2,
      reasons: reasons.slice(0, 6), issue_codes: [...new Set(issues.map(issue => issue.code))],
      message: '透视视图来自同一张 2×2 空间母图，不能单独重做某一格；系统将重建整张母图并重新生成俯视布局，共 2 次图片调用。',
    };
  }
  return {
    version: sceneRepairPlanVersion, action: 'regenerate_failed_views', view_keys: viewKeys,
    view_labels: viewKeys.map(sceneViewLabel), count: viewKeys.length, reasons: reasons.slice(0, 6),
    issue_codes: [...new Set(issues.map(issue => issue.code))],
    message: `系统将只重做有逐图证据的 ${viewKeys.length} 张：${viewKeys.map(sceneViewLabel).join('、')}。`,
  };
}

module.exports = { build };
