'use strict';

const storage = require('./storageService');
const releaseBundle = require('../storyAdReleaseBundleService');
const sceneWorkflowProjection = require('../storyAdWorkspace/sceneWorkflowProjectionService');

const CONTRACT_VERSION = 2;
const PROMPT_CONTRACT_VERSION = 'scene-prompt-authority-v2';

function clean(value = '', max = 12000) {
  return String(value || '').normalize('NFKC').replace(/\r\n?/g, '\n').trim().slice(0, max);
}

function promptText(value = '') {
  return String(value || '').replace(/\r\n?/g, '\n').trim().slice(0, 12000);
}

function contractError(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.retryable = false;
  return error;
}

function sceneId(value = '') {
  return clean(typeof value === 'object' ? (value.id || value.scene_id || value.space_id) : value, 120);
}

function outputKind(id = '') {
  return `scene_prompt_confirmation:${storage.canonicalFingerprint(sceneId(id)).slice(0, 24)}`;
}

function overrideKind(id = '') {
  return `scene_prompt_override:${storage.canonicalFingerprint(sceneId(id)).slice(0, 24)}`;
}

function authoritativePlan(taskId) {
  const plan = storage.getOutput(taskId, 'scene_config');
  if (!plan || !Array.isArray(plan.spaces) || !plan.spaces.length) {
    throw contractError('SCENE_PLAN_REQUIRED', '正式场景提示词尚未生成，请先完成场景文字规划');
  }
  return plan;
}

function authoritativeBase(taskId, requestedSceneId) {
  const task = storage.getTask(taskId);
  if (!task) throw contractError('TASK_NOT_FOUND', '任务不存在', 404);
  const id = sceneId(requestedSceneId);
  const plan = authoritativePlan(taskId);
  const index = plan.spaces.findIndex((space, candidateIndex) => sceneId(space) === id || (!id && candidateIndex === 0));
  if (index < 0) throw contractError('SCENE_NOT_FOUND', '当前场景不存在，请刷新页面后重试', 404);
  const space = plan.spaces[index] || {};
  const spec = space.scene_spec && typeof space.scene_spec === 'object' ? space.scene_spec : {};
  const promptProjection = sceneWorkflowProjection.promptProjection({ space, spec, index, cleanText: clean });
  const basePrompt = clean(promptProjection.generationPrompt, 12000);
  if (!basePrompt) throw contractError('SCENE_PROMPT_MISSING', '当前场景提示词尚未生成，不能确认');
  const manifest = storage.getManifest(taskId);
  const identity = releaseBundle.identity();
  const canonicalScenePlan = {
    scene_id: sceneId(space) || id,
    name: clean(space.name || space.display_name, 240),
    description: clean(space.description, 1200),
    story_purpose: clean(space.story_purpose || space.purpose, 800),
    generation_prompt: basePrompt,
    scene_spec: spec,
    camera_plan: Array.isArray(spec.cameraPlan || spec.camera_plan || space.camera_plan)
      ? (spec.cameraPlan || spec.camera_plan || space.camera_plan)
      : [],
  };
  const binding = {
    content_revision: Math.max(1, Number(task.content_revision || 1) || 1),
    scene_plan_revision: Math.max(0, Number(space.revision || space.scene_revision || plan.revision || 0) || 0),
    scene_config_artifact_id: clean(manifest?.artifacts?.scene_config, 160),
    snapshot_id: clean(task.current_snapshot_id, 180),
    required_bundle_id: clean(task.required_bundle_id, 100),
    producer_bundle_id: clean(identity.bundle_id, 100),
  };
  return {
    task, plan, space, basePrompt, canonicalScenePlan, binding,
    base_scene_plan_fingerprint: storage.canonicalFingerprint(canonicalScenePlan),
  };
}

function authoritativeDescriptor(taskId, requestedSceneId) {
  const base = authoritativeBase(taskId, requestedSceneId);
  const storedOverride = storage.getOutput(taskId, overrideKind(base.canonicalScenePlan.scene_id));
  const overrideCurrent = Boolean(storedOverride
    && storedOverride.scene_id === base.canonicalScenePlan.scene_id
    && storedOverride.base_scene_plan_fingerprint === base.base_scene_plan_fingerprint
    && storedOverride.scene_config_artifact_id === base.binding.scene_config_artifact_id);
  const prompt = overrideCurrent ? promptText(storedOverride.generation_prompt) : base.basePrompt;
  const canonicalScenePlan = { ...base.canonicalScenePlan, generation_prompt: prompt };
  const descriptor = {
    version: CONTRACT_VERSION,
    prompt_contract_version: PROMPT_CONTRACT_VERSION,
    scene_id: base.canonicalScenePlan.scene_id,
    prompt_fingerprint: storage.canonicalFingerprint({ scene_id: canonicalScenePlan.scene_id, prompt }),
    scene_plan_fingerprint: storage.canonicalFingerprint(canonicalScenePlan),
    ...base.binding,
  };
  return {
    ...base,
    prompt,
    prompt_source: overrideCurrent ? 'user_override' : 'scene_plan',
    prompt_override: overrideCurrent ? storedOverride : null,
    descriptor: (() => {
      const promptVersionId = storage.canonicalFingerprint(descriptor);
      return {
        ...descriptor,
        prompt_version_id: promptVersionId,
        // Temporary read compatibility for bundles cached before the v2 UI is loaded.
        confirmation_id: promptVersionId,
      };
    })(),
  };
}

function currentState(taskId, requestedSceneId) {
  const current = authoritativeDescriptor(taskId, requestedSceneId);
  return {
    ...current,
    receipt: null,
    projection: {
      ...current.descriptor,
      generation_prompt: current.prompt,
      prompt_source: current.prompt_source,
      editable: true,
      authoritative: true,
      saved: true,
      // Compatibility only. v2 consumers use authoritative/saved + prompt_version_id.
      confirmed: true,
      confirmed_at: '',
      reason: 'current_prompt_authoritative',
    },
  };
}

function savePromptOverride(taskId, requestedSceneId, input = {}, actor = {}) {
  const current = currentState(taskId, requestedSceneId);
  if (current.task.active_generation_id) {
    throw contractError('SCENE_PROMPT_EDIT_ACTIVE_GENERATION', '当前场景生成正在运行，请完成或取消后再编辑提示词');
  }
  const expected = clean(
    input.base_prompt_version_id || input.basePromptVersionId
      || input.base_confirmation_id || input.baseConfirmationId,
    100,
  );
  if (!expected || expected !== current.descriptor.prompt_version_id) {
    throw contractError('SCENE_PROMPT_EDIT_CONFLICT', '场景提示词已在其他窗口更新，请刷新后再编辑');
  }
  const prompt = promptText(input.generation_prompt || input.generationPrompt);
  if (prompt.length < 30) throw contractError('SCENE_PROMPT_TOO_SHORT', '场景提示词至少需要 30 个字符', 422);
  storage.saveOutput(taskId, overrideKind(current.descriptor.scene_id), {
    scene_id: current.descriptor.scene_id,
    generation_prompt: prompt,
    base_scene_plan_fingerprint: current.base_scene_plan_fingerprint,
    scene_config_artifact_id: current.descriptor.scene_config_artifact_id,
    updated_by: clean(actor.id || actor.userId || actor.username, 120),
    updated_at: new Date().toISOString(),
  }, {
    content_revision: current.descriptor.content_revision,
    snapshot_id: current.descriptor.snapshot_id,
    input_fingerprint: storage.canonicalFingerprint({ scene_id: current.descriptor.scene_id, prompt }),
    qa_status: 'user_edited',
  });
  return currentState(taskId, current.descriptor.scene_id);
}

function project(taskId, requestedSceneId) {
  try {
    return currentState(taskId, requestedSceneId).projection;
  } catch (error) {
    if (['SCENE_PLAN_REQUIRED', 'SCENE_NOT_FOUND', 'SCENE_PROMPT_MISSING'].includes(String(error.code || ''))) {
      return { confirmed: false, reason: String(error.code || 'prompt_missing').toLowerCase() };
    }
    throw error;
  }
}

function confirm() {
  throw contractError(
    'LEGACY_SCENE_PROMPT_CONFIRMATION_DISABLED',
    '场景提示词显式确认入口已停用；保存后的当前版本将直接用于生成',
    410,
  );
}

function assertCurrentPrompt(taskId, requestedSceneId, input = {}) {
  const current = currentState(taskId, requestedSceneId);
  const expected = clean(input.prompt_version_id || input.promptVersionId, 100);
  if (expected && expected !== current.descriptor.prompt_version_id) {
    throw contractError('SCENE_PROMPT_VERSION_STALE', '场景提示词已更新，请使用保存后的最新版本生成画面');
  }
  return {
    ...current.descriptor,
    generation_prompt: current.prompt,
    prompt_source: current.prompt_source,
    authoritative: true,
  };
}

function assertAllCurrentPrompts(taskId, sceneIds = [], input = {}) {
  const promptVersionIds = input.prompt_version_ids && typeof input.prompt_version_ids === 'object'
    ? input.prompt_version_ids
    : {};
  return [...new Set(sceneIds.map(sceneId).filter(Boolean))].map(id => assertCurrentPrompt(taskId, id, {
    prompt_version_id: promptVersionIds[id] || '',
  }));
}

// Internal compatibility aliases. They enforce the v2 current-authority contract and
// do not read or create legacy confirmation receipts.
const assertConfirmed = assertCurrentPrompt;
const assertAllConfirmed = assertAllCurrentPrompts;

module.exports = {
  CONTRACT_VERSION,
  PROMPT_CONTRACT_VERSION,
  assertAllConfirmed,
  assertAllCurrentPrompts,
  assertConfirmed,
  assertCurrentPrompt,
  authoritativeDescriptor,
  confirm,
  currentState,
  outputKind,
  overrideKind,
  project,
  savePromptOverride,
  sceneId,
};
