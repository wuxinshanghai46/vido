const { v4: uuidv4 } = require('uuid');
const mediaAdapterDefault = require('./mediaAdapter');
const storageDefault = require('./storageService');
const checkpointsDefault = require('./assetGenerationCheckpointService');
const propIdentity = require('./propIdentityContractService');
const propTimeline = require('./propTimelineService');

const STATIC_VIEW_KEYS = ['hero', 'three_quarter', 'side', 'material_detail'];

function atlasPrompt(prop = {}) {
  return [
    'Create one photorealistic commercial prop identity contact sheet.',
    'LAYOUT IS MANDATORY: exact 2 columns x 2 rows, four equal cells.',
    `Cell order: ${STATIC_VIEW_KEYS.join(', ')}.`,
    `Prop: ${prop.name}. Type: ${prop.type}.`,
    prop.description ? `Appearance: ${prop.description}.` : '',
    prop.material ? `Material lock: ${prop.material}.` : '',
    prop.scale ? `Scale lock: ${prop.scale}.` : '',
    `Quantity lock: ${prop.quantity}.`,
    'Same exact object identity, geometry, color, material and wear state in every cell.',
    'Neutral studio background, no person, hand, scene, text, logo, label or watermark unless an uploaded advertised product reference already contains lawful packaging.',
  ].filter(Boolean).join('\n');
}

function statePrompt(prop = {}) {
  const stateContexts = prop.states.map(state => {
    const normalized = String(state || '').toLowerCase();
    if (/(held|hold|grip|hand|拿|握|持)/.test(normalized)) {
      return `${state}: show a close, physically plausible neutral hand contact that clearly demonstrates the declared held state.`;
    }
    if (/(rest|placed|tray|table|放|置|托盘|桌)/.test(normalized)) {
      return `${state}: show the object resting naturally at ${prop.placement || 'its declared support surface'}.`;
    }
    return `${state}: make the declared physical state visually unmistakable while preserving object identity.`;
  });
  return [
    'Create one state-variation contact sheet of the exact same prop identity.',
    `States left-to-right, top-to-bottom: ${prop.states.join(', ')}.`,
    `Use exactly ${prop.states.length} cells in a ${Math.min(2, prop.states.length)} column grid.`,
    `Prop: ${prop.name}. Preserve geometry, material, scale and brand-safe appearance.`,
    ...stateContexts,
    prop.hand_contact ? `Declared hand contact: ${prop.hand_contact}.` : '',
    prop.placement ? `Declared resting placement: ${prop.placement}.` : '',
    'Only the declared interaction state may change. Keep any hand or support surface minimal and physically realistic; never show a full person or unrelated scene.',
    'No text, caption, logo, label or watermark.',
  ].filter(Boolean).join('\n');
}

function checkpointRepository(storage, taskId, propId) {
  const kind = `prop_asset_checkpoint:${propId}`;
  return {
    load: async key => storage.getOutput(taskId, kind)?.units?.[key] || null,
    save: async (key, value) => {
      const current = storage.getOutput(taskId, kind) || { schema_version: 1, prop_id: propId, units: {} };
      storage.saveOutput(taskId, kind, {
        ...current,
        units: { ...(current.units || {}), [key]: value },
        updated_at: new Date().toISOString(),
      });
    },
  };
}

async function generateAtlasUnit({
  taskId,
  prop,
  unit,
  keys,
  columns,
  rows,
  prompt,
  referenceImages,
  mediaAdapter,
  checkpoints,
  repository,
}) {
  const identity = {
    taskId,
    assetType: 'prop_dossier',
    assetId: prop.id,
    unit,
    revision: prop.revision,
    input: { prop, keys },
  };
  return checkpoints.runCheckpointedUnit({
    identity,
    load: repository.load,
    save: repository.save,
    execute: async controls => {
      const atlas = controls.providerResult || await mediaAdapter.generateImage({
        taskId,
        stage: 'new_story_ad.prop_dossier_atlas',
        prompt,
        filename: `prop_${prop.id}_${unit}_r${prop.revision}`,
        aspectRatio: columns === rows ? '1:1' : '2:1',
        referenceImages,
        requireReferences: referenceImages.length > 0,
        inputFidelity: 'high',
        clientRequestId: checkpoints.checkpointKey(identity),
        onSubmitting: controls.onSubmitting,
        onSubmitted: controls.onSubmitted,
      });
      if (!controls.providerResult) await controls.onProviderResult(atlas);
      const views = await mediaAdapter.splitReferenceSheet({
        source: atlas,
        filenamePrefix: `prop_${prop.id}_${unit}`,
        filenameSuffix: `r${prop.revision}`,
        viewKeys: keys,
        columns,
        rows,
        outputWidth: 900,
        outputHeight: 900,
        fit: 'contain',
        background: { r: 245, g: 245, b: 245, alpha: 1 },
      });
      return {
        atlas: {
          image_url: atlas.image_url || atlas.url,
          filename: atlas.filename || '',
          provider_used: atlas.provider_used || '',
          grid: { columns, rows },
        },
        views,
      };
    },
  });
}

function upsertById(values = [], item = {}) {
  const list = Array.isArray(values) ? [...values] : [];
  const index = list.findIndex(value => String(value.id || value.prop_id) === String(item.id || item.prop_id));
  if (index >= 0) list[index] = item;
  else list.push(item);
  return list;
}

function updateProgress(storage, taskId, generationId, patch = {}) {
  if (!generationId) return;
  const task = storage.getTask(taskId) || {};
  const previous = task.generation_progress?.stage === 'prop_asset' ? task.generation_progress : {};
  const timestamp = new Date().toISOString();
  storage.updateTask(taskId, {
    generation_progress: {
      schema_version: 1,
      stage: 'prop_asset',
      generation_id: generationId,
      status: patch.status || 'running',
      phase: patch.phase || previous.phase || '正在准备人物随身道具',
      message: patch.message || previous.message || '',
      total: 2,
      completed: Number(patch.completed ?? previous.completed ?? 0) || 0,
      processed: Number(patch.completed ?? previous.completed ?? 0) || 0,
      percent: Math.max(0, Math.min(100, Number(patch.percent ?? previous.percent ?? 0) || 0)),
      started_at: previous.started_at || task.generation_started_at || timestamp,
      updated_at: timestamp,
      ...(patch.status === 'completed' ? { finished_at: timestamp } : {}),
    },
  });
}

async function generatePropAsset(taskId, input = {}, deps = {}) {
  const mediaAdapter = deps.mediaAdapter || mediaAdapterDefault;
  const storage = deps.storage || storageDefault;
  const checkpoints = deps.checkpoints || checkpointsDefault;
  const prop = propIdentity.normalizeProp(input.prop || input, 0);
  const generationId = String(input.generation_id || input.generationId || '');
  if (!prop.name || !prop.description) {
    const error = new Error('生成道具档案前必须填写道具名称和外观描述');
    error.code = 'PROP_PROFILE_REQUIRED';
    error.status = 422;
    throw error;
  }
  if (prop.type === 'fixed_scene_object') {
    const error = new Error('固定场景物件应进入场景锚点，不重复生成独立道具档案');
    error.code = 'FIXED_SCENE_OBJECT_USES_SCENE_CONTRACT';
    error.status = 422;
    throw error;
  }
  const repository = checkpointRepository(storage, taskId, prop.id);
  const references = prop.reference_image_url ? [prop.reference_image_url] : [];
  updateProgress(storage, taskId, generationId, { percent: 5, phase: '正在建立道具身份和材质锁' });
  const base = await generateAtlasUnit({
    taskId,
    prop,
    unit: 'identity',
    keys: STATIC_VIEW_KEYS,
    columns: 2,
    rows: 2,
    prompt: atlasPrompt(prop),
    referenceImages: references,
    mediaAdapter,
    checkpoints,
    repository,
  });
  updateProgress(storage, taskId, generationId, { percent: 58, completed: 1, phase: '道具身份视图已完成，正在处理动作状态' });
  const stateKeys = prop.states.length > 1 ? prop.states.slice(0, 4) : [];
  const state = stateKeys.length ? await generateAtlasUnit({
    taskId,
    prop,
    unit: 'states',
    keys: stateKeys,
    columns: Math.min(2, stateKeys.length),
    rows: Math.ceil(stateKeys.length / Math.min(2, stateKeys.length)),
    prompt: statePrompt({ ...prop, states: stateKeys }),
    referenceImages: [base.result.views[0]?.image_url || base.result.views[0]?.url].filter(Boolean),
    mediaAdapter,
    checkpoints,
    repository,
  }) : null;
  const storyboard = storage.getOutput(taskId, 'storyboard_table') || [];
  const asset = {
    ...prop,
    prop_id: prop.id,
    asset_id: `prop_asset_${uuidv4()}`,
    schema_version: 1,
    contract: propIdentity.buildContract(prop),
    image_url: base.result.views[0]?.image_url || base.result.views[0]?.url || '',
    cover_image_url: base.result.atlas.image_url,
    view_images: base.result.views,
    state_views: state?.result?.views || [],
    category_atlases: [base.result.atlas, state?.result?.atlas].filter(Boolean),
    shot_timeline: propTimeline.buildTimeline(prop, storyboard),
    generation_summary: {
      planned_provider_calls: stateKeys.length ? 2 : 1,
      provider_calls_this_run: Number(!base.reused) + Number(Boolean(state && !state.reused)),
      checkpoint_hits: Number(base.reused) + Number(Boolean(state?.reused)),
    },
    status: 'generated_pending_human_approval',
    updated_at: new Date().toISOString(),
  };
  const assets = upsertById(storage.getOutput(taskId, 'prop_assets') || [], asset);
  storage.saveOutput(taskId, 'prop_assets', assets);
  const context = storage.getOutput(taskId, 'context');
  if (context) storage.saveOutput(taskId, 'context', { ...context, prop_assets: assets });
  updateProgress(storage, taskId, generationId, { percent: 100, completed: 2, status: 'completed', phase: '人物随身道具档案已建立' });
  return asset;
}

async function regeneratePropStates(taskId, input = {}, deps = {}) {
  const mediaAdapter = deps.mediaAdapter || mediaAdapterDefault;
  const storage = deps.storage || storageDefault;
  const checkpoints = deps.checkpoints || checkpointsDefault;
  const propId = String(input.prop_id || input.propId || input.id || '').trim();
  const assets = storage.getOutput(taskId, 'prop_assets') || [];
  const existing = assets.find(item => String(item.id || item.prop_id) === propId);
  if (!existing) {
    const error = new Error(`未找到可复用身份图的道具档案: ${propId}`);
    error.code = 'PROP_ASSET_NOT_FOUND';
    error.status = 404;
    throw error;
  }
  const prop = propIdentity.normalizeProp(existing, 0);
  const stateKeys = prop.states.length > 1 ? prop.states.slice(0, 4) : [];
  if (!stateKeys.length) {
    const error = new Error('道具没有可重新生成的多状态定义');
    error.code = 'PROP_STATES_REQUIRED';
    error.status = 422;
    throw error;
  }
  const identityReference = existing.view_images?.[0]?.image_url || existing.view_images?.[0]?.url || '';
  if (!identityReference) {
    const error = new Error('仅重生状态图前必须存在可复用的道具身份图');
    error.code = 'PROP_IDENTITY_REFERENCE_REQUIRED';
    error.status = 409;
    throw error;
  }
  const stateRevision = Math.max(2, Number(input.state_revision || input.stateRevision || 2) || 2);
  const unit = `states_v${stateRevision}`;
  const repository = checkpointRepository(storage, taskId, prop.id);
  const state = await generateAtlasUnit({
    taskId,
    prop,
    unit,
    keys: stateKeys,
    columns: Math.min(2, stateKeys.length),
    rows: Math.ceil(stateKeys.length / Math.min(2, stateKeys.length)),
    prompt: statePrompt({ ...prop, states: stateKeys }),
    referenceImages: [identityReference],
    mediaAdapter,
    checkpoints,
    repository,
  });
  const identityAtlas = (existing.category_atlases || []).find(atlas => (
    Number(atlas?.grid?.columns) === 2 && Number(atlas?.grid?.rows) === 2
  )) || existing.category_atlases?.[0] || null;
  const asset = {
    ...existing,
    state_views: state.result.views,
    category_atlases: [identityAtlas, {
      ...state.result.atlas,
      unit: 'states',
      state_revision: stateRevision,
    }].filter(Boolean),
    state_revision: stateRevision,
    state_revalidation: {
      status: 'generated_pending_human_approval',
      provider_calls_this_run: Number(!state.reused),
      checkpoint_hits: Number(state.reused),
      checkpoint_key: state.checkpoint.key,
      generated_at: new Date().toISOString(),
    },
    status: 'generated_pending_human_approval',
    updated_at: new Date().toISOString(),
  };
  const nextAssets = upsertById(assets, asset);
  storage.saveOutput(taskId, 'prop_assets', nextAssets);
  const context = storage.getOutput(taskId, 'context');
  if (context) storage.saveOutput(taskId, 'context', { ...context, prop_assets: nextAssets });
  return asset;
}

function listPropAssets(taskId, deps = {}) {
  return (deps.storage || storageDefault).getOutput(taskId, 'prop_assets') || [];
}

function refreshPropTimelines(taskId, deps = {}) {
  const storage = deps.storage || storageDefault;
  const assets = storage.getOutput(taskId, 'prop_assets') || [];
  const shots = storage.getOutput(taskId, 'storyboard_table') || [];
  const next = propTimeline.attachTimelines(assets, shots);
  storage.saveOutput(taskId, 'prop_assets', next);
  const context = storage.getOutput(taskId, 'context');
  if (context) storage.saveOutput(taskId, 'context', { ...context, prop_assets: next });
  return next;
}

module.exports = {
  STATIC_VIEW_KEYS,
  atlasPrompt,
  statePrompt,
  generatePropAsset,
  regeneratePropStates,
  listPropAssets,
  refreshPropTimelines,
};
