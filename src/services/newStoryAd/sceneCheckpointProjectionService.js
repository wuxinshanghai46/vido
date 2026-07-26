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

function checkpointPreview(row = {}, sceneConfig = {}) {
  const checkpoint = row?.payload && typeof row.payload === 'object' ? row.payload : {};
  if (!['running', 'partial', 'ready_for_qa'].includes(text(checkpoint.status, 40))) return null;
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
  if (!views.length) return null;
  const sceneId = text(checkpoint.scene_id || String(row.kind || '').replace(/^scene_asset_checkpoint:/, ''), 120);
  const spaceId = text(checkpoint.metadata?.space_id || sceneId, 120);
  const failed = Object.entries(checkpoint.views || {}).filter(([, view]) => view?.status === 'failed');
  const failedKeys = failed.map(([key]) => key);
  const unknownBilling = failed.some(([, view]) => view?.billing_state === 'unknown'
    || view?.provider_submission_state === 'submitted_unknown'
    || view?.error_code === 'PROVIDER_5XX_AMBIGUOUS');
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
    partial_checkpoint: true,
    checkpoint_status: text(checkpoint.status, 40),
    checkpoint_error_code: text(checkpoint.last_error_code || failed[0]?.[1]?.error_code || '', 120),
    completed_view_keys: views.map(view => view.key),
    failed_view_keys: failedKeys,
    billing_review_required: unknownBilling,
    verification: {
      state: 'partial',
      message: unknownBilling
        ? `已保留 ${views.length}/5 张场景图；${failedKeys.map(key => VIEW_LABELS[key] || key).join('、') || '剩余视图'}的供应商计费状态未知，禁止自动重试。`
        : `已保留 ${views.length}/5 张场景图；剩余视图尚未完成。`,
      reasons: failed.map(([, view]) => text(view.error || view.error_code || '', 220)).filter(Boolean),
    },
  };
}

function projectSceneAssets(outputRows = []) {
  const rows = Array.isArray(outputRows) ? outputRows : [];
  const context = rows.find(row => row?.kind === 'context')?.payload || {};
  const sceneConfig = rows.find(row => row?.kind === 'scene_config')?.payload || context.scene_config || {};
  const plannedIds = new Set((Array.isArray(sceneConfig?.spaces) ? sceneConfig.spaces : [])
    .map(space => text(space?.id || space?.space_id || space?.scene_id, 120))
    .filter(Boolean));
  const belongsToCurrentPlan = asset => {
    if (!plannedIds.size) return true;
    const id = text(asset?.space_id || asset?.scene_id || asset?.id, 120);
    return !!id && plannedIds.has(id);
  };
  const persistedOutput = rows.find(row => row?.kind === 'scene_assets')?.payload;
  const persisted = Array.isArray(persistedOutput) ? persistedOutput : context.scene_assets;
  const assets = Array.isArray(persisted)
    ? persisted.filter(belongsToCurrentPlan).map(asset => ({ ...asset }))
    : [];
  const assetIndexById = new Map(assets
    .map((asset, index) => [text(asset?.space_id || asset?.scene_id || asset?.id, 120), index])
    .filter(([id]) => id));
  rows.filter(row => String(row?.kind || '').startsWith('scene_asset_checkpoint:'))
    .map(row => checkpointPreview(row, sceneConfig))
    .filter(preview => preview && belongsToCurrentPlan(preview))
    .forEach(preview => {
      const id = text(preview.space_id || preview.scene_id || preview.id, 120);
      if (!id) return;
      const existingIndex = assetIndexById.get(id);
      if (existingIndex !== undefined) {
        assets[existingIndex] = { ...assets[existingIndex], ...preview };
        return;
      }
      assetIndexById.set(id, assets.length);
      assets.push(preview);
    });
  return assets;
}

module.exports = { VIEW_ORDER, VIEW_LABELS, checkpointPreview, projectSceneAssets };
