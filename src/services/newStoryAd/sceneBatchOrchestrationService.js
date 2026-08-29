'use strict';

const crypto = require('crypto');
const DEFAULT_SCOPE_ID = 'scene-batch';

function text(value = '', max = 160) {
  return String(value ?? '').trim().slice(0, max);
}

function sceneLaneKey(sceneId = '') {
  return `scene_asset:${String(sceneId || '')}`;
}

function create(deps = {}) {
  const {
    storage,
    sceneAssets,
    promptAuthority,
    targetProgress,
    cancellation,
  } = deps;

  function plan(taskId, body = {}) {
    const task = storage.getTask(taskId);
    const activeSceneAction = Object.values(task?.active_target_generations || {}).find(item => (
      ['scene_asset', 'scene_qa'].includes(String(item?.stage || ''))
      && ['queued', 'running', 'processing', 'verifying'].includes(String(item?.status || '').toLowerCase())
    ));
    if (activeSceneAction) {
      const error = new Error('已有场景正在处理，本次没有重复提交模型调用');
      error.code = 'SCENE_BATCH_BUSY';
      error.status = 409;
      error.retryable = false;
      throw error;
    }
    const rows = Array.isArray(body.actions) ? body.actions : [];
    const seen = new Set();
    const currentAssets = sceneAssets.currentSceneAssets(taskId);
    const actions = rows.slice(0, 30).map(row => {
      const sceneId = text(row?.scene_id || row?.sceneId || row?.space_id || row?.spaceId, 120);
      if (!sceneId || seen.has(sceneId)) return null;
      seen.add(sceneId);
      const currentPrompt = promptAuthority.assertCurrentPrompt(taskId, sceneId, row);
      const current = currentAssets.find(item => String(item.scene_id || item.id || '') === sceneId) || null;
      const repairPlan = current
        ? (current.repair_plan || sceneAssets.buildSceneRepairPlan(current))
        : { action: 'generate' };
      if (current && String(repairPlan.action || '') === 'none') return null;
      return {
        scene_id: sceneId,
        name: text(row?.name || row?.scene_name || row?.sceneName || current?.name, 120),
        prompt_version_id: currentPrompt.prompt_version_id,
        quality: text(row?.quality || 'standard', 40),
        resolution: text(row?.resolution || '2K', 40),
        aspect_ratio: text(row?.aspect_ratio || row?.aspectRatio || '16:9', 20),
        image_model: text(body.image_model || body.imageModel, 220),
        single_attempt: true,
        action: !current ? 'generate' : String(repairPlan.action || 'generate'),
        image_total: !current ? Number(sceneAssets.SCENE_GENERATION_ORDER?.length || 5)
          : (String(repairPlan.action || '') === 'reverify' ? 0
            : Math.max(0, Number(repairPlan.count || repairPlan.view_keys?.length || 0) || 0)),
        scene_revision: Math.max(1, Number(current?.scene_revision || current?.revision || 1) || 1),
        repair_plan_version: Math.max(1, Number(repairPlan.version || 1) || 1),
      };
    }).filter(Boolean);
    if (!actions.length) {
      const error = new Error('当前没有需要继续处理的场景');
      error.code = 'SCENE_BATCH_EMPTY';
      error.status = 409;
      error.retryable = false;
      throw error;
    }
    return {
      scope_id: DEFAULT_SCOPE_ID,
      actions,
      signature: crypto.createHash('sha256').update(JSON.stringify(actions.map(item => ({
        scene_id: item.scene_id,
        prompt_version_id: item.prompt_version_id,
        scene_revision: item.scene_revision,
        repair_plan_version: item.repair_plan_version,
        action: item.action,
        image_total: item.image_total,
        image_model: item.image_model,
      })))).digest('hex').slice(0, 32),
    };
  }

  function writeProgress(taskId, generationId, state = {}) {
    const task = storage.getTask(taskId) || {};
    const now = new Date().toISOString();
    const total = Math.max(1, Number(state.total || state.scene_ids?.length || 1) || 1);
    const processed = Math.max(0, Math.min(total, Number(state.processed || 0) || 0));
    const progress = {
      schema_version: 1,
      stage: 'scene_asset',
      mode: 'scene_batch',
      generation_id: generationId,
      status: state.status || (processed >= total ? 'completed' : 'running'),
      phase: state.phase || (processed >= total ? 'complete' : 'generation'),
      message: text(state.message || '', 500),
      target_total: total,
      processed,
      succeeded: Math.max(0, Number(state.succeeded || 0) || 0),
      failed: Math.max(0, Number(state.failed || 0) || 0),
      percent: Math.min(100, Math.round((processed / total) * 100)),
      batch_scene_ids: Array.isArray(state.scene_ids) ? state.scene_ids.map(id => text(id, 120)).filter(Boolean) : [],
      current_scene_id: text(state.current_scene_id, 120),
      current_scene_name: text(state.current_scene_name, 120),
      current_action: text(state.current_action, 40),
      ...(state.image_target_total !== undefined ? { image_target_total: Math.max(0, Number(state.image_target_total) || 0) } : {}),
      ...(state.image_processed !== undefined ? { image_processed: Math.max(0, Number(state.image_processed) || 0) } : {}),
      ...(state.image_succeeded !== undefined ? { image_succeeded: Math.max(0, Number(state.image_succeeded) || 0) } : {}),
      ...(state.image_failed !== undefined ? { image_failed: Math.max(0, Number(state.image_failed) || 0) } : {}),
      ...(state.image_base_processed !== undefined ? { image_base_processed: Math.max(0, Number(state.image_base_processed) || 0) } : {}),
      ...(state.image_base_succeeded !== undefined ? { image_base_succeeded: Math.max(0, Number(state.image_base_succeeded) || 0) } : {}),
      ...(state.image_base_failed !== undefined ? { image_base_failed: Math.max(0, Number(state.image_base_failed) || 0) } : {}),
      started_at: state.started_at || task.generation_started_at || task.generation_queued_at || now,
      updated_at: now,
      ...(processed >= total ? { finished_at: now } : {}),
    };
    const patch = targetProgress.upsert(task, {
      stage: 'scene_asset', scopeId: DEFAULT_SCOPE_ID, generationId,
      status: progress.status, progress,
    });
    storage.updateTask(taskId, patch);
    return progress;
  }

  function writeSceneProgress(taskId, generationId, action = {}, state = {}) {
    const task = storage.getTask(taskId) || {};
    const laneKey = sceneLaneKey(action.scene_id);
    const storedPrevious = task.target_generation_progress?.[laneKey] || {};
    const previous = String(storedPrevious.generation_id || '') === String(generationId || '')
      ? storedPrevious
      : {};
    const now = new Date().toISOString();
    const targetTotal = Math.max(1, Number(previous.target_total || action.image_total || 1) || 1);
    const status = text(state.status || previous.status || 'queued', 40);
    const terminal = ['completed', 'failed', 'cancelled'].includes(status);
    const progress = {
      ...previous,
      schema_version: 2,
      stage: 'scene_asset',
      mode: 'scene_action',
      scene_id: action.scene_id,
      scene_name: action.name,
      current_action: action.action,
      generation_id: generationId,
      status,
      phase: text(state.phase || previous.phase || (action.action === 'reverify' ? 'verification' : 'generation'), 40),
      target_total: targetTotal,
      processed: Math.max(0, Math.min(targetTotal, Number(state.processed ?? previous.processed ?? 0) || 0)),
      succeeded: Math.max(0, Number(state.succeeded ?? previous.succeeded ?? 0) || 0),
      failed: Math.max(0, Number(state.failed ?? previous.failed ?? 0) || 0),
      image_target_total: Math.max(0, Number(action.image_total || previous.image_target_total || 0) || 0),
      ...(state.image_processed !== undefined ? { image_processed: Math.max(0, Number(state.image_processed) || 0) } : {}),
      ...(state.image_succeeded !== undefined ? { image_succeeded: Math.max(0, Number(state.image_succeeded) || 0) } : {}),
      ...(state.image_failed !== undefined ? { image_failed: Math.max(0, Number(state.image_failed) || 0) } : {}),
      message: text(state.message || previous.message || '', 500),
      started_at: previous.started_at || state.started_at || now,
      updated_at: now,
      ...(terminal ? { finished_at: now } : {}),
    };
    const patch = targetProgress.upsert(task, {
      stage: 'scene_asset', scopeId: action.scene_id, sceneId: action.scene_id,
      generationId, status, progress,
    });
    storage.updateTask(taskId, patch);
    return progress;
  }

  async function execute(taskId, batchPlan, job = {}) {
    const generationId = text(job.generationId, 120);
    const sceneIds = batchPlan.actions.map(item => item.scene_id);
    const startedAt = new Date().toISOString();
    const imageTotal = batchPlan.actions.reduce((sum, item) => sum + Math.max(0, Number(item.image_total || 0) || 0), 0);
    writeProgress(taskId, generationId, {
      total: batchPlan.actions.length, scene_ids: sceneIds, started_at: startedAt,
      image_target_total: imageTotal, image_processed: 0, image_succeeded: 0, image_failed: 0,
      message: `正在并行处理 ${batchPlan.actions.length} 个场景`,
    });
    batchPlan.actions.forEach(action => writeSceneProgress(taskId, generationId, action, {
      status: 'queued', phase: action.action === 'reverify' ? 'verification' : 'generation',
      message: `“${action.name || action.scene_id}”等待开始`, started_at: startedAt,
    }));

    const runAction = async action => {
      cancellation.throwIfCancelled(taskId);
      writeSceneProgress(taskId, generationId, action, {
        status: action.action === 'reverify' ? 'verifying' : 'running',
        phase: action.action === 'reverify' ? 'verification' : 'generation',
        message: action.action === 'reverify'
          ? `正在重新审核“${action.name || action.scene_id}”，图片调用 0`
          : `正在处理“${action.name || action.scene_id}”`,
      });
      try {
        let result;
        if (action.action === 'reverify') {
          result = await sceneAssets.reverifySceneAsset(taskId, action.scene_id);
          const nextPlan = result.scene_asset?.repair_plan
            || sceneAssets.buildSceneRepairPlan(result.scene_asset || {});
          if (String(nextPlan.action || '') === 'reverify') {
            const error = new Error(result.scene_asset?.scene_contract?.qa_error || '审核服务暂时没有完成，图片已保留');
            error.code = 'SCENE_QA_EVIDENCE_UNAVAILABLE';
            error.retryable = true;
            throw error;
          }
        } else {
          const latestAssets = sceneAssets.currentSceneAssets(taskId);
          const current = latestAssets.find(item => String(item.scene_id || item.id || '') === action.scene_id);
          const payload = {
            scene_id: action.scene_id,
            space_id: action.scene_id,
            name: action.name,
            prompt_version_id: action.prompt_version_id,
            quality: action.quality,
            resolution: action.resolution,
            aspect_ratio: action.aspect_ratio,
            image_model: action.image_model,
            single_attempt: true,
            generation_id: generationId,
          };
          result = current
            ? await sceneAssets.fixSceneAsset(taskId, action.scene_id, payload, { generationId })
            : await sceneAssets.generateSceneAsset(taskId, payload, { generationId });
        }
        const resultAsset = result?.scene_asset || (Array.isArray(result?.scene_assets)
          ? result.scene_assets.find(item => String(item.scene_id || item.id || '') === action.scene_id) : null);
        const nextPlan = resultAsset?.repair_plan || (resultAsset ? sceneAssets.buildSceneRepairPlan(resultAsset) : { action: 'none' });
        if (result?.enhancement_pending === true || !['', 'none'].includes(String(nextPlan.action || ''))) {
          const error = new Error(nextPlan.message || resultAsset?.scene_contract?.qa_error || '当前场景没有完成，已保留成功图片');
          error.code = String(nextPlan.action || '') === 'reverify'
            ? 'SCENE_QA_EVIDENCE_UNAVAILABLE' : 'SCENE_ASSET_INCOMPLETE';
          error.retryable = true;
          error.incomplete_image_count = Math.max(0, Number(nextPlan.count || nextPlan.view_keys?.length || action.image_total || 0) || 0);
          error.provider_image_call_count = Number(result?.provider_image_call_count || 0) || 0;
          throw error;
        }
        const currentLane = storage.getTask(taskId)?.target_generation_progress?.[sceneLaneKey(action.scene_id)] || {};
        const targetTotal = Math.max(1, Number(currentLane.target_total || action.image_total || 1) || 1);
        writeSceneProgress(taskId, generationId, action, {
          status: 'completed', phase: 'complete', processed: targetTotal, succeeded: targetTotal, failed: 0,
          message: `“${action.name || action.scene_id}”已完成`,
        });
        return { scene_id: action.scene_id, action: action.action, status: 'succeeded', provider_image_call_count: Number(result?.provider_image_call_count || 0) || 0 };
      } catch (error) {
        if (['USER_CANCELLED', 'STAGE_DEADLINE_EXCEEDED'].includes(String(error?.code || ''))) {
          writeSceneProgress(taskId, generationId, action, {
            status: 'cancelled', phase: 'stopped', message: `“${action.name || action.scene_id}”已停止`,
          });
          throw error;
        }
        const lane = storage.getTask(taskId)?.target_generation_progress?.[sceneLaneKey(action.scene_id)] || {};
        const incompleteImageCount = Math.min(Number(action.image_total || 0), Math.max(0, Number(error?.incomplete_image_count || 0) || 0));
        writeSceneProgress(taskId, generationId, action, {
          status: 'failed', phase: 'stopped',
          processed: Number(lane.processed || 0), succeeded: Number(lane.succeeded || 0),
          failed: Math.max(1, Number(lane.failed || 0) || 0),
          ...(incompleteImageCount ? {
            image_processed: Math.max(Number(lane.image_processed || 0), incompleteImageCount),
            image_succeeded: Number(lane.image_succeeded || 0),
            image_failed: Math.max(Number(lane.image_failed || 0), incompleteImageCount),
          } : {}),
          message: `“${action.name || action.scene_id}”未完成；其他场景继续独立处理`,
        });
        return {
          scene_id: action.scene_id,
          action: action.action,
          status: 'failed',
          error_code: text(error?.code || 'SCENE_ACTION_FAILED', 80),
          error: text(error?.message || '当前场景没有完成', 300),
          retryable: error?.retryable === true,
          provider_image_call_count: Number(error?.provider_image_call_count || 0) || 0,
        };
      }
    };
    const settled = await Promise.allSettled(batchPlan.actions.map(runAction));
    const interrupted = settled.find(item => item.status === 'rejected');
    if (interrupted) throw interrupted.reason;
    const results = settled.map(item => item.value);
    const succeeded = results.filter(item => item.status === 'succeeded').length;
    const failed = results.filter(item => item.status === 'failed').length;
    const lanes = storage.getTask(taskId)?.target_generation_progress || {};
    const imageProgress = batchPlan.actions.reduce((totals, action) => {
      const lane = lanes[sceneLaneKey(action.scene_id)] || {};
      const imageLaneTotal = Math.max(0, Number(lane.image_target_total ?? action.image_total ?? 0) || 0);
      totals.processed += Math.min(imageLaneTotal, Math.max(0, Number(lane.image_processed ?? lane.processed ?? 0) || 0));
      totals.succeeded += Math.min(imageLaneTotal, Math.max(0, Number(lane.image_succeeded ?? lane.succeeded ?? 0) || 0));
      totals.failed += Math.min(imageLaneTotal, Math.max(0, Number(lane.image_failed ?? lane.failed ?? 0) || 0));
      return totals;
    }, { processed: 0, succeeded: 0, failed: 0 });
    writeProgress(taskId, generationId, {
      total: batchPlan.actions.length, scene_ids: sceneIds, started_at: startedAt,
      processed: batchPlan.actions.length, succeeded, failed,
      image_target_total: imageTotal, image_processed: imageProgress.processed,
      image_succeeded: imageProgress.succeeded, image_failed: imageProgress.failed,
      status: failed ? 'failed' : 'completed', phase: 'complete',
      message: `场景并行处理完成：成功 ${succeeded}，未完成 ${failed}`,
    });
    const summary = {
      schema_version: 1,
      generation_id: generationId,
      status: failed ? (succeeded ? 'partial' : 'failed') : 'succeeded',
      total: batchPlan.actions.length,
      succeeded,
      failed,
      results,
      provider_image_call_count: results.reduce((sum, item) => sum + Math.max(0, Number(item.provider_image_call_count || 0) || 0), 0),
      finished_at: new Date().toISOString(),
    };
    storage.saveOutput(taskId, `scene_batch_result:${generationId}`, summary);
    return summary;
  }

  return { DEFAULT_SCOPE_ID, execute, plan, writeProgress, writeSceneProgress };
}

module.exports = { DEFAULT_SCOPE_ID, create };
