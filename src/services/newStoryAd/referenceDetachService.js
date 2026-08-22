const ACTIVE_STATUSES = new Set(['importing', 'running', 'queued', 'cancelling']);

function projected(item = {}) {
  return item?.source === 'reference_analysis_projection' || item?.projection_only === true;
}

/** 构造移除参考来源后的权威任务补丁，只清理由参考分析自动投影的草稿。 */
function buildDetachPatch(previous = {}, scenePlan = null, body = {}) {
  const previousCast = Array.isArray(previous.cast_profiles) ? previous.cast_profiles : [];
  const previousPets = Array.isArray(previous.pet_profiles) ? previous.pet_profiles : [];
  const castProfiles = previousCast.filter(item => !projected(item));
  const petProfiles = previousPets.filter(item => !projected(item));
  const projectedCastRemoved = castProfiles.length !== previousCast.length;
  const projectedPetsRemoved = petProfiles.length !== previousPets.length;
  const patch = {
    reference_video_analysis: null,
    reference_analysis_projection: null,
    reference_required: false,
    brief_intake: {
      ...(previous.brief_intake && typeof previous.brief_intake === 'object' ? previous.brief_intake : {}),
      reference_decision: 'skipped',
      active_dialogue_topic: '',
    },
    asset_setup_confirmed: false,
    story_setup_confirmed: false,
    shot_design_confirmed: false,
    changed_domains: ['source'],
    base_content_revision: body.base_content_revision ?? body.baseContentRevision,
    client_edit_seq: body.client_edit_seq ?? body.clientEditSeq,
  };
  if (previous.brief_source === 'reference_analysis') Object.assign(patch, {
    brief: '', content: '', brief_source: 'system',
  });
  if (projectedCastRemoved) Object.assign(patch, {
    cast_profiles: castProfiles,
    expected_people: castProfiles.length,
    cast_mode: castProfiles.length ? (castProfiles.length > 2 ? 'multi' : (castProfiles.length === 2 ? 'dual' : 'single')) : 'auto',
    person_spec: castProfiles.length ? previous.person_spec : { castMode: 'auto' },
  });
  if (projectedPetsRemoved) Object.assign(patch, {
    pet_profiles: petProfiles,
    expected_animals: petProfiles.length,
    pet_contract: previous.pet_contract?.source === 'reference_analysis_projection' ? null : previous.pet_contract,
  });
  if (projected(scenePlan || {})) Object.assign(patch, { scene_spec: {}, scene_mode: 'auto', scene_assets: [] });
  if (projected(previous.story_seed || {})) patch.story_seed = null;
  return patch;
}

/** 重新识别时保留同一视频绑定，只撤下该参考自动投影出的旧草稿。 */
function buildReanalysisPatch(previous = {}, scenePlan = null, reference = {}, body = {}) {
  return {
    ...buildDetachPatch(previous, scenePlan, body),
    reference_video_analysis: reference,
    reference_analysis_projection: null,
    reference_required: true,
  };
}

/** 从项目解除参考绑定；任务数据先成功提交，再停止或清理孤立分析记录。 */
function detach({ taskId, body = {}, user = {}, storyAdService, storage, referenceVideoAnalyses } = {}) {
  const task = storyAdService.assertTaskOwner(taskId, user);
  const previous = storage.getOutput(taskId, 'context') || task.request || {};
  const reference = previous.reference_video_analysis && typeof previous.reference_video_analysis === 'object'
    ? previous.reference_video_analysis
    : {};
  const analysisId = String(reference.analysis_id || reference.id || '').trim();
  if (!analysisId) return {
    task,
    context: previous,
    content_revision: Math.max(1, Number(task.content_revision || 1) || 1),
    reference_removed: true,
    already_removed: true,
    analysis_cleanup: 'not_needed',
  };
  const scenePlan = storage.getOutput(taskId, 'scene_config');
  const updated = storyAdService.updateTaskRequest(taskId, buildDetachPatch(previous, scenePlan, body), user);
  let analysisCleanup = 'retained_for_audit';
  try {
    const analysis = referenceVideoAnalyses.get(analysisId, user);
    if (ACTIVE_STATUSES.has(String(analysis.status || '').toLowerCase())) {
      referenceVideoAnalyses.cancel(analysisId, user);
      analysisCleanup = 'cancelling';
    } else {
      referenceVideoAnalyses.remove(analysisId, user);
      analysisCleanup = 'deleted';
    }
  } catch {
    analysisCleanup = 'unavailable';
  }
  return { ...updated, reference_removed: true, removed_analysis_id: analysisId, analysis_cleanup: analysisCleanup };
}

module.exports = { ACTIVE_STATUSES, projected, buildDetachPatch, buildReanalysisPatch, detach };
