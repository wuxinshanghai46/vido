import { scenePendingAction } from './scenePromptPreview.js?v=20260904-production-v456';

function text(value = '') { return String(value || '').trim(); }

export function buildSceneBatchActionPlan(scenes = [], activeTargets = []) {
  const batchActive = (Array.isArray(activeTargets) ? activeTargets : []).some(item => (
    text(item?.stage) === 'scene_asset'
    && text(item?.target_id || item?.scope_id) === 'scene-batch'
    && ['queued', 'running', 'processing', 'verifying'].includes(text(item?.status).toLowerCase())
  ));
  if (batchActive) return {
    ready: [], generate: [], review: [], repair: [], count: 0,
    requiresBillingConfirmation: false,
  };
  const active = new Set((Array.isArray(activeTargets) ? activeTargets : [])
    .filter(item => text(item?.stage) === 'scene_asset'
      && ['queued', 'running', 'processing', 'verifying'].includes(text(item?.status).toLowerCase()))
    .map(item => text(item?.target_id || item?.scope_id))
    .filter(Boolean));
  const ready = [];
  for (const scene of Array.isArray(scenes) ? scenes : []) {
    const sceneId = text(scene?.id || scene?.scene_id);
    const action = scenePendingAction(scene);
    if (!sceneId || !action || active.has(sceneId)) continue;
    ready.push({ scene, sceneId, action });
  }
  const generate = ready.filter(item => item.action.kind === 'generate');
  const review = ready.filter(item => item.action.kind === 'fix' && item.action.billable === false);
  const repair = ready.filter(item => item.action.kind === 'fix' && item.action.billable !== false);
  return {
    ready, generate, review, repair,
    count: ready.length,
    requiresBillingConfirmation: generate.length + repair.length > 0,
  };
}
