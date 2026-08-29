const sceneCheckpoints = require('./sceneGenerationCheckpointService');

const VIEW_ORDER = ['master', 'reverse', 'interaction', 'detail', 'layout'];
const VIEW_LABELS = {
  master: '主视角',
  reverse: '反向/侧向',
  interaction: '互动位',
  detail: '材质细节',
  layout: '俯视布局',
};

function text(value = '', max = 500) {
  return String(value || '').trim().slice(0, max);
}

function viewUrl(view = {}) {
  return text(view.url || view.image_url || view.imageUrl || '', 1200);
}

function plannedName(sceneConfig = {}, sceneId = '', spaceId = '') {
  const spaces = Array.isArray(sceneConfig?.spaces) ? sceneConfig.spaces : [];
  const match = spaces.find(space => {
    const id = text(space.id || space.space_id || space.scene_id, 120);
    return id && (id === sceneId || id === spaceId);
  });
  return text(match?.name || match?.label || '', 120);
}

function diagnosticIndex(modelCalls = []) {
  const index = new Map();
  (Array.isArray(modelCalls) ? modelCalls : []).forEach(call => {
    [call.submission_id, call.platform_request_id, call.provider_request_id]
      .map(value => text(value, 180)).filter(Boolean)
      .forEach(key => {
        const current = index.get(key);
        if (!current || String(call.updated_at || call.created_at || '') >= String(current.updated_at || current.created_at || '')) {
          index.set(key, call);
        }
      });
  });
  return index;
}

function checkpointPreview(row = {}, sceneConfig = {}, diagnostics = new Map()) {
  const checkpoint = row?.payload && typeof row.payload === 'object' ? row.payload : {};
  const views = VIEW_ORDER.map(key => {
    const source = checkpoint.views?.[key] || {};
    const url = source.status === 'succeeded' ? viewUrl(source) : '';
    return url ? {
      ...source,
      key,
      label: VIEW_LABELS[key],
      url,
      image_url: url,
    } : null;
  }).filter(Boolean);
  // The checkpoint status describes the aggregate attempt. A failed attempt may
  // still contain paid, succeeded views that must remain visible and reusable.
  // Trust the per-view success state instead of hiding those views behind the
  // aggregate status.
  if (!views.length) return null;
  const sceneId = text(checkpoint.scene_id || String(row.kind || '').replace(/^scene_asset_checkpoint:/, ''), 120);
  const spaceId = text(checkpoint.metadata?.space_id || sceneId, 120);
  const failed = Object.entries(checkpoint.views || {}).filter(([, view]) => view?.status === 'failed');
  const failedKeys = failed.map(([key]) => key);
  const viewStatuses = Object.fromEntries(Object.entries(checkpoint.views || {}).map(([key, view = {}]) => {
    const diagnosticKey = text(view.platform_request_id || view.submission_id || view.provider_request_id, 180);
    const call = diagnosticKey ? diagnostics.get(diagnosticKey) || {} : {};
    const billingState = text(view.billing_state, 40);
    const submissionState = text(view.provider_submission_state || view.submission_state, 60);
    const storedErrorCode = text(view.error_code, 120);
    const errorCode = (!storedErrorCode || storedErrorCode === 'UNKNOWN')
      ? text(call.error_code || storedErrorCode, 120)
      : storedErrorCode;
    let state = view.status === 'succeeded' ? 'complete' : 'missing';
    if (view.status === 'failed') {
      if (sceneCheckpoints.requiresBillingReview(view)) state = 'billing_review';
      else if (billingState === 'not_submitted' || submissionState === 'not_submitted' || errorCode === 'GENERATION_STOPPED_AFTER_BILLING_UNKNOWN') state = 'pending';
      else state = 'failed';
    }
    return [key, {
      state,
      status: text(view.status, 40),
      error_code: errorCode,
      billing_state: billingState,
      submission_state: submissionState,
      provider_id: text(view.provider_id || call.provider_id, 120),
      model_id: text(view.model_id || call.model_id, 160),
      http_status: text(view.provider_status || call.provider_status, 60),
      platform_request_id: text(view.platform_request_id || view.submission_id, 120),
      provider_request_id: text(view.provider_request_id, 180),
      provider_task_id: text(view.provider_task_id, 180),
      duration_ms: Math.max(0, Number(view.duration_ms || call.latency_ms || call.duration_ms || 0) || 0),
      message: text(view.error || view.message, 220),
    }];
  }));
  const unknownBilling = failed.some(([, view]) => sceneCheckpoints.requiresBillingReview(view));
  const repairKeys = VIEW_ORDER.filter(key => failedKeys.includes(key));
  return {
    id: sceneId,
    scene_id: sceneId,
    space_id: spaceId,
    name: plannedName(sceneConfig, sceneId, spaceId) || '部分生成场景',
    source: 'new_story_ad_scene_checkpoint',
    image_url: viewUrl(views[0]),
    view_images: views,
    view_count: views.length,
    generation_contract_version: Number(checkpoint.metadata?.generation_contract_version || 7) || 7,
    checkpoint_mode: text(checkpoint.metadata?.mode, 40),
    partial_checkpoint: true,
    checkpoint_status: text(checkpoint.status, 40),
    checkpoint_error_code: text(
      viewStatuses[failedKeys[0]]?.error_code || checkpoint.last_error_code || failed[0]?.[1]?.error_code || '',
      120,
    ),
    completed_view_keys: views.map(view => view.key),
    failed_view_keys: failedKeys,
    view_statuses: viewStatuses,
    billing_review_required: unknownBilling,
    repair_plan: {
      version: 6,
      action: 'regenerate_failed_views',
      view_keys: repairKeys,
      view_labels: repairKeys.map(key => VIEW_LABELS[key] || key),
      count: repairKeys.length,
      requires_billing_review: unknownBilling,
      message: unknownBilling
        ? '先逐项核对已提交但计费未知的视图，再只继续失败或尚未提交的视图。'
        : '只继续失败或尚未提交的视图，已成功图片保持不变。',
    },
    verification: {
      state: 'partial',
      message: unknownBilling
        ? `已保留 ${views.length}/5 张场景图；${failedKeys.map(key => VIEW_LABELS[key] || key).join('、') || '剩余视图'}的供应商计费状态未知，禁止自动重试。`
        : `已保留 ${views.length}/5 张场景图；剩余视图尚未完成。`,
      reasons: failed.map(([, view]) => text(view.error || view.error_code || '', 220)).filter(Boolean),
    },
  };
}

function mergeSuccessfulCheckpointViews(asset = {}, checkpoint = {}) {
  const byKey = new Map((Array.isArray(asset.view_images) ? asset.view_images : [])
    .map(view => [text(view?.key, 40), view]).filter(([key]) => key));
  VIEW_ORDER.forEach(key => {
    const view = sceneCheckpoints.checkpointView(checkpoint, key);
    const url = viewUrl(view || {});
    if (url) byKey.set(key, { ...view, key, label: VIEW_LABELS[key], url, image_url: url });
  });
  const viewImages = VIEW_ORDER.map(key => byKey.get(key)).filter(Boolean);
  return {
    ...asset,
    image_url: byKey.get('master')?.image_url || asset.image_url || viewImages[0]?.image_url || '',
    view_images: viewImages,
    view_count: viewImages.length,
  };
}

function projectSceneAssets(outputRows = [], modelCalls = []) {
  const rows = Array.isArray(outputRows) ? outputRows : [];
  const context = rows.find(row => row?.kind === 'context')?.payload || {};
  const sceneConfig = rows.find(row => row?.kind === 'scene_config')?.payload || context.scene_config || {};
  const plannedIds = new Set((Array.isArray(sceneConfig?.spaces) ? sceneConfig.spaces : [])
    .map(space => text(space?.id || space?.space_id || space?.scene_id, 120))
    .filter(Boolean));
  const assetIdentifiers = asset => [asset?.space_id, asset?.scene_id, asset?.id]
    .map(value => text(value, 120)).filter(Boolean);
  const assetPlanId = asset => assetIdentifiers(asset).find(id => plannedIds.has(id))
    || assetIdentifiers(asset)[0] || '';
  const belongsToCurrentPlan = asset => {
    if (!plannedIds.size) return true;
    return assetIdentifiers(asset).some(id => plannedIds.has(id));
  };
  const persistedOutput = rows.find(row => row?.kind === 'scene_assets')?.payload;
  const persisted = Array.isArray(persistedOutput) ? persistedOutput : context.scene_assets;
  const assets = Array.isArray(persisted)
    ? persisted.filter(belongsToCurrentPlan).map(asset => ({ ...asset }))
    : [];
  const assetIndexById = new Map(assets
    .map((asset, index) => [assetPlanId(asset), index])
    .filter(([id]) => id));
  const diagnostics = diagnosticIndex(modelCalls);
  rows.filter(row => String(row?.kind || '').startsWith('scene_asset_checkpoint:'))
    .map(row => checkpointPreview(row, sceneConfig, diagnostics))
    .filter(preview => preview && belongsToCurrentPlan(preview))
    .forEach(preview => {
      const id = assetPlanId(preview);
      if (!id) return;
      const existingIndex = assetIndexById.get(id);
      if (existingIndex !== undefined) {
        if (preview.checkpoint_mode === 'repair') {
          const viewByKey = new Map((Array.isArray(assets[existingIndex].view_images) ? assets[existingIndex].view_images : [])
            .map(view => [text(view?.key, 40), view]).filter(([key]) => key));
          preview.failed_view_keys.forEach(key => viewByKey.delete(text(key, 40)));
          preview.view_images.forEach(view => viewByKey.set(text(view?.key, 40), view));
          const mergedViews = VIEW_ORDER.map(key => viewByKey.get(key)).filter(Boolean);
          assets[existingIndex] = {
            ...assets[existingIndex],
            ...preview,
            image_url: viewByKey.get('master')?.image_url || assets[existingIndex].image_url || mergedViews[0]?.image_url || '',
            view_images: mergedViews,
            view_count: mergedViews.length,
          };
        } else {
          assets[existingIndex] = { ...assets[existingIndex], ...preview };
        }
        return;
      }
      assetIndexById.set(id, assets.length);
      assets.push(preview);
    });
  return assets;
}

module.exports = { VIEW_ORDER, VIEW_LABELS, checkpointPreview, mergeSuccessfulCheckpointViews, projectSceneAssets };
