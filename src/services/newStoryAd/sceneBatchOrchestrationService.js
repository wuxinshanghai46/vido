'use strict';

const crypto = require('crypto');
const DEFAULT_SCOPE_ID = 'scene-batch';

function text(value = '', max = 160) {
  return String(value ?? '').trim().slice(0, max);
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

  async function execute(taskId, batchPlan, job = {}) {
    const generationId = text(job.generationId, 120);
    const sceneIds = batchPlan.actions.map(item => item.scene_id);
    const startedAt = new Date().toISOString();
    const results = [];
    let succeeded = 0;
    let failed = 0;
    const imageTotal = batchPlan.actions.reduce((sum, item) => sum + Math.max(0, Number(item.image_total || 0) || 0), 0);
    let imageProcessed = 0;
    let imageSucceeded = 0;
    let imageFailed = 0;
    const syncImageProgress = () => {
      const live = storage.getTask(taskId)?.generation_progress || {};
      imageProcessed = Math.max(imageProcessed, Number(live.image_processed || 0) || 0);
      imageSucceeded = Math.max(imageSucceeded, Number(live.image_succeeded || 0) || 0);
      imageFailed = Math.max(imageFailed, Number(live.image_failed || 0) || 0);
    };
    writeProgress(taskId, generationId, {
      total: batchPlan.actions.length, scene_ids: sceneIds, started_at: startedAt,
      image_target_total: imageTotal, image_processed: 0, image_succeeded: 0, image_failed: 0,
      message: `正在依次处理 ${batchPlan.actions.length} 个场景`,
    });

    for (let index = 0; index < batchPlan.actions.length; index += 1) {
      cancellation.throwIfCancelled(taskId);
      const action = batchPlan.actions[index];
      const imageBaseProcessed = imageProcessed;
      const imageBaseSucceeded = imageSucceeded;
      const imageBaseFailed = imageFailed;
      writeProgress(taskId, generationId, {
        total: batchPlan.actions.length, scene_ids: sceneIds, started_at: startedAt,
        processed: index, succeeded, failed,
        image_target_total: imageTotal, image_processed: imageProcessed,
        image_succeeded: imageSucceeded, image_failed: imageFailed,
        image_base_processed: imageBaseProcessed, image_base_succeeded: imageBaseSucceeded, image_base_failed: imageBaseFailed,
        current_scene_id: action.scene_id, current_scene_name: action.name,
        current_action: action.action,
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
        syncImageProgress();
        const expectedProcessed = imageBaseProcessed + Number(action.image_total || 0);
        if (action.image_total > 0 && imageProcessed < expectedProcessed) {
          const missingProgress = expectedProcessed - imageProcessed;
          imageProcessed += missingProgress;
          imageSucceeded += missingProgress;
        }
        succeeded += 1;
        results.push({ scene_id: action.scene_id, action: action.action, status: 'succeeded', provider_image_call_count: Number(result?.provider_image_call_count || 0) || 0 });
      } catch (error) {
        if (['USER_CANCELLED', 'STAGE_DEADLINE_EXCEEDED'].includes(String(error?.code || ''))) throw error;
        failed += 1;
        syncImageProgress();
        const incompleteImageCount = Math.min(Number(action.image_total || 0), Math.max(0, Number(error?.incomplete_image_count || 0) || 0));
        if (incompleteImageCount > 0) {
          imageProcessed = Math.max(imageProcessed, imageBaseProcessed + incompleteImageCount);
          imageSucceeded = Math.max(imageBaseSucceeded, imageSucceeded - incompleteImageCount);
          imageFailed = Math.max(imageFailed, imageBaseFailed + incompleteImageCount);
        }
        results.push({
          scene_id: action.scene_id,
          action: action.action,
          status: 'failed',
          error_code: text(error?.code || 'SCENE_ACTION_FAILED', 80),
          error: text(error?.message || '当前场景没有完成', 300),
          retryable: error?.retryable === true,
          provider_image_call_count: Number(error?.provider_image_call_count || 0) || 0,
        });
        writeProgress(taskId, generationId, {
          total: batchPlan.actions.length, scene_ids: sceneIds, started_at: startedAt,
          processed: index + 1, succeeded, failed,
          image_target_total: imageTotal, image_processed: imageProcessed,
          image_succeeded: imageSucceeded, image_failed: imageFailed,
          current_scene_id: action.scene_id, current_scene_name: action.name,
          current_action: action.action, status: 'failed', phase: 'stopped',
          message: `“${action.name || action.scene_id}”未完成，已停止本批次，后续场景没有提交模型`,
        });
        break;
      }
      writeProgress(taskId, generationId, {
        total: batchPlan.actions.length, scene_ids: sceneIds, started_at: startedAt,
        processed: index + 1, succeeded, failed,
        image_target_total: imageTotal, image_processed: imageProcessed,
        image_succeeded: imageSucceeded, image_failed: imageFailed,
        image_base_processed: imageProcessed, image_base_succeeded: imageSucceeded, image_base_failed: imageFailed,
        current_scene_id: index + 1 < batchPlan.actions.length ? batchPlan.actions[index + 1].scene_id : '',
        current_scene_name: index + 1 < batchPlan.actions.length ? batchPlan.actions[index + 1].name : '',
        current_action: index + 1 < batchPlan.actions.length ? batchPlan.actions[index + 1].action : '',
        status: index + 1 >= batchPlan.actions.length ? 'completed' : 'running',
        phase: index + 1 >= batchPlan.actions.length ? 'complete' : 'generation',
        message: index + 1 >= batchPlan.actions.length
          ? `场景处理完成：成功 ${succeeded}，未完成 ${failed}`
          : `已处理 ${index + 1}/${batchPlan.actions.length} 个场景`,
      });
    }
    const summary = {
      schema_version: 1,
      generation_id: generationId,
      status: failed ? (succeeded ? 'partial_stopped' : 'failed') : 'succeeded',
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

  return { DEFAULT_SCOPE_ID, execute, plan, writeProgress };
}

module.exports = { DEFAULT_SCOPE_ID, create };
