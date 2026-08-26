'use strict';

const storage = require('./storageService');
const releaseBundle = require('../storyAdReleaseBundleService');
const sceneWorkflowProjection = require('../storyAdWorkspace/sceneWorkflowProjectionService');

const CONTRACT_VERSION = 1;
const PROMPT_CONTRACT_VERSION = 'scene-prompt-confirmation-v1';

function clean(value = '', max = 12000) {
  return String(value || '').normalize('NFKC').replace(/\r\n?/g, '\n').trim().slice(0, max);
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

function authoritativePlan(taskId) {
  const plan = storage.getOutput(taskId, 'scene_config');
  if (!plan || !Array.isArray(plan.spaces) || !plan.spaces.length) {
    throw contractError('SCENE_PLAN_REQUIRED', '正式场景提示词尚未生成，请先完成场景文字规划');
  }
  return plan;
}

function authoritativeDescriptor(taskId, requestedSceneId) {
  const task = storage.getTask(taskId);
  if (!task) throw contractError('TASK_NOT_FOUND', '任务不存在', 404);
  const id = sceneId(requestedSceneId);
  const plan = authoritativePlan(taskId);
  const index = plan.spaces.findIndex((space, candidateIndex) => sceneId(space) === id || (!id && candidateIndex === 0));
  if (index < 0) throw contractError('SCENE_NOT_FOUND', '当前场景不存在，请刷新页面后重试', 404);
  const space = plan.spaces[index] || {};
  const spec = space.scene_spec && typeof space.scene_spec === 'object' ? space.scene_spec : {};
  const promptProjection = sceneWorkflowProjection.promptProjection({ space, spec, index, cleanText: clean });
  const prompt = clean(promptProjection.generationPrompt, 12000);
  if (!prompt) throw contractError('SCENE_PROMPT_MISSING', '当前场景提示词尚未生成，不能确认');
  const manifest = storage.getManifest(taskId);
  const identity = releaseBundle.identity();
  const canonicalScenePlan = {
    scene_id: sceneId(space) || id,
    name: clean(space.name || space.display_name, 240),
    description: clean(space.description, 1200),
    story_purpose: clean(space.story_purpose || space.purpose, 800),
    generation_prompt: prompt,
    scene_spec: spec,
    camera_plan: Array.isArray(spec.cameraPlan || spec.camera_plan || space.camera_plan)
      ? (spec.cameraPlan || spec.camera_plan || space.camera_plan)
      : [],
  };
  const descriptor = {
    version: CONTRACT_VERSION,
    prompt_contract_version: PROMPT_CONTRACT_VERSION,
    scene_id: canonicalScenePlan.scene_id,
    prompt_fingerprint: storage.canonicalFingerprint({ scene_id: canonicalScenePlan.scene_id, prompt }),
    scene_plan_fingerprint: storage.canonicalFingerprint(canonicalScenePlan),
    content_revision: Math.max(1, Number(task.content_revision || 1) || 1),
    scene_plan_revision: Math.max(0, Number(space.revision || space.scene_revision || plan.revision || 0) || 0),
    scene_config_artifact_id: clean(manifest?.artifacts?.scene_config, 160),
    snapshot_id: clean(task.current_snapshot_id, 180),
    required_bundle_id: clean(task.required_bundle_id, 100),
    producer_bundle_id: clean(identity.bundle_id, 100),
  };
  return { task, plan, space, prompt, descriptor: { ...descriptor, confirmation_id: storage.canonicalFingerprint(descriptor) } };
}

function currentState(taskId, requestedSceneId) {
  const current = authoritativeDescriptor(taskId, requestedSceneId);
  const stored = storage.getOutput(taskId, outputKind(current.descriptor.scene_id));
  const confirmed = Boolean(stored
    && stored.confirmation_id === current.descriptor.confirmation_id
    && stored.scene_id === current.descriptor.scene_id);
  return {
    ...current,
    receipt: confirmed ? stored : null,
    projection: {
      ...current.descriptor,
      confirmed,
      confirmed_at: confirmed ? clean(stored.confirmed_at, 80) : '',
      reason: confirmed ? 'current_prompt_confirmed' : (stored ? 'prompt_changed' : 'not_confirmed'),
    },
  };
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

function confirm(taskId, requestedSceneId, input = {}, actor = {}) {
  const current = currentState(taskId, requestedSceneId);
  const expected = clean(input.confirmation_id || input.confirmationId, 100);
  if (!expected) throw contractError('SCENE_PROMPT_CONFIRMATION_PROOF_REQUIRED', '请刷新场景页后重新确认当前提示词');
  if (expected !== current.descriptor.confirmation_id) {
    throw contractError('SCENE_PROMPT_CHANGED', '场景提示词已经更新，请重新查看并确认后再生成画面');
  }
  if (current.receipt) return { ...current.receipt, confirmed: true, duplicate: true };
  const receipt = {
    ...current.descriptor,
    confirmed_by: clean(actor.id || actor.userId || actor.username, 120),
    confirmed_at: new Date().toISOString(),
  };
  storage.saveOutput(taskId, outputKind(receipt.scene_id), receipt, {
    content_revision: receipt.content_revision,
    snapshot_id: receipt.snapshot_id,
    input_fingerprint: receipt.confirmation_id,
    qa_status: 'user_confirmed',
  });
  return { ...receipt, confirmed: true, duplicate: false };
}

function assertConfirmed(taskId, requestedSceneId, input = {}) {
  const current = currentState(taskId, requestedSceneId);
  const expected = clean(input.confirmation_id || input.confirmationId, 100);
  if (!current.receipt || (expected && expected !== current.descriptor.confirmation_id)) {
    throw contractError('SCENE_PROMPT_CONFIRMATION_REQUIRED', current.projection.reason === 'prompt_changed'
      ? '场景提示词已更新，请重新确认后再生成画面'
      : '请先确认当前场景提示词，再生成场景画面');
  }
  return current.receipt;
}

function assertAllConfirmed(taskId, sceneIds = [], input = {}) {
  const confirmationIds = input.confirmation_ids && typeof input.confirmation_ids === 'object' ? input.confirmation_ids : {};
  return [...new Set(sceneIds.map(sceneId).filter(Boolean))].map(id => assertConfirmed(taskId, id, {
    confirmation_id: confirmationIds[id] || '',
  }));
}

module.exports = {
  CONTRACT_VERSION,
  PROMPT_CONTRACT_VERSION,
  assertAllConfirmed,
  assertConfirmed,
  authoritativeDescriptor,
  confirm,
  currentState,
  outputKind,
  project,
  sceneId,
};
