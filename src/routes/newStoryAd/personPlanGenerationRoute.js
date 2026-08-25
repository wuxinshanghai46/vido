'use strict';

function ageValue(profile = {}) {
  return String(profile.age_contract?.value || profile.age || 'match_brief');
}

function lookSnapshot(profile = {}) {
  return (Array.isArray(profile.look_profiles) ? profile.look_profiles : []).map(look => ({
    id: String(look?.id || ''), name: String(look?.name || ''), story_state: String(look?.story_state || ''),
    scene_ids: (Array.isArray(look?.scene_ids) ? look.scene_ids : []).map(String),
    wardrobeText: String(look?.wardrobeText || ''), hairMakeupText: String(look?.hairMakeupText || ''),
    negativeText: String(look?.negativeText || ''), style_richness: String(look?.style_richness || 'auto'),
  }));
}

function profileSnapshot(profile = {}) {
  return JSON.stringify({
    displayName: String(profile.displayName || ''), roleName: String(profile.roleName || ''), age: ageValue(profile),
    appearanceText: String(profile.appearanceText || ''), ethnicity: String(profile.ethnicity || profile.ethnic_appearance || ''),
    negativeText: String(profile.negativeText || ''), looks: lookSnapshot(profile), identity_id: String(profile.identity_id || profile.id || ''),
    lineage_identity_id: String(profile.lineage_identity_id || profile.source_identity_id || profile.id || ''),
    identity_continuity: String(profile.identity_continuity || ''), aging_mode: String(profile.aging_mode || ''),
    age_states: (Array.isArray(profile.age_states) ? profile.age_states : []).map(state => ({
      id: String(state?.id || ''), apparent_age: String(state?.apparent_age || ''), story_state: String(state?.story_state || ''),
      scene_ids: (Array.isArray(state?.scene_ids) ? state.scene_ids : []).map(String),
    })),
  });
}

function completePerson(item = {}) {
  if (!item.dossier_sheet?.image_url || Number(item.visual_asset_contract_version || 0) < 2) return false;
  if (!item.generated_profile || profileSnapshot(item.generated_profile) !== profileSnapshot(item.profile)) return false;
  const generatedLookIds = new Set((Array.isArray(item.look_assets) ? item.look_assets : [])
    .filter(look => look?.dossier_sheet?.image_url || look?.image_url)
    .map(look => String(look.id || look.look_id || '')));
  return (item.profile?.look_profiles || []).every(look => generatedLookIds.has(String(look.id || '')));
}

function currentPersonGenerationBody({ taskId, input = {}, service, storage }) {
  const task = storage.getTask(taskId) || {};
  const ctx = storage.getOutput(taskId, 'context') || task.request || {};
  const castProfiles = Array.isArray(ctx.cast_profiles) ? ctx.cast_profiles : [];
  const petProfiles = Array.isArray(ctx.pet_profiles) ? ctx.pet_profiles : [];
  const bundle = service.publicTaskBundle(taskId, { sections: 'summary,assets' });
  const people = bundle?.assets?.people || [], animals = bundle?.assets?.animals || [];
  const subjectTargets = [
    ...people.map((item, index) => ({ item, index, kind: 'human' })),
    ...animals.map((item, index) => ({ item, index, kind: 'pet' })),
  ].filter(entry => entry.kind === 'human' ? !completePerson(entry.item)
    : !(entry.item?.dossier_sheet?.image_url || entry.item?.view_images?.length))
    .map(entry => ({ kind: entry.kind, id: entry.item?.profile?.id || '', index: entry.index })).filter(entry => entry.id);
  return {
    ...input, task_id: taskId, brief: ctx.brief || task.brief || '', expected_people: castProfiles.length,
    expected_animals: petProfiles.length, cast_profiles: castProfiles, pet_profiles: petProfiles, subject_targets: subjectTargets,
    world_setting: ctx.world_setting || {}, person_change_kind: 'semantic',
    person_spec: { ...(ctx.person_spec || {}), castMode: ctx.cast_mode || ctx.person_spec?.castMode
      || (castProfiles.length > 1 ? 'group' : (castProfiles.length ? 'single' : 'no_human')),
    expectedPeople: castProfiles.length, expectedAnimals: petProfiles.length },
  };
}

function updatePersonPlanProgress(storage, taskId, generationId, update = {}) {
  const task = storage.getTask(taskId) || {}, previous = task.generation_progress || {};
  if (String(task.active_generation_id || '') !== String(generationId || '')) return null;
  const now = new Date().toISOString(), percent = Math.max(1, Math.min(99, Number(update.percent || 1) || 1));
  const total = Math.max(1, Number(update.total || previous.total || 1) || 1);
  const completed = Math.max(0, Math.min(total, Number(update.completed ?? previous.completed ?? 0) || 0));
  const progress = { schema_version: 1, stage: 'person_plan', generation_id: generationId, status: 'running',
    phase: String(update.phase || previous.phase || 'planning'), message: String(update.message || previous.message || '正在生成人物方案'),
    total, completed, processed: completed, percent,
    active_indexes: Array.isArray(update.active_indexes) ? update.active_indexes : (previous.active_indexes || []),
    current_index: Number(update.current_index || 0) || undefined,
    started_at: previous.started_at || task.generation_started_at || task.generation_queued_at || now, updated_at: now };
  storage.updateTask(taskId, { generation_progress: progress });
  return progress;
}

function registerPersonPlanGenerationRoute(router, deps = {}) {
  const { asyncRoute, queueTaskStage, userFromReq, service, storage, generationPermit, generateAndCommitSubjectAssets } = deps;
  router.post('/tasks/:id/person-plan', asyncRoute(async (req, res) => {
    const user = userFromReq(req), userId = String(user.id || user.userId || user.username || 'anonymous');
    return queueTaskStage(req, res, 'person_plan', async job => {
      const initial = currentPersonGenerationBody({ taskId: req.params.id, input: req.body || {}, service, storage });
      const personTotal = Math.max(1, initial.cast_profiles.length);
      const completedPeople = new Set();
      updatePersonPlanProgress(storage, req.params.id, job.generationId, { percent: 3, total: personTotal, completed: 0, phase: 'planning', message: '正在并行启动独立人物方案' });
      const personPlan = await service.updatePersonPlan(req.params.id, {
        generation_id: job.generationId,
        person_plan_authority: true,
        user,
        onProgress: event => {
          if (event.completed_index) completedPeople.add(event.completed_index);
          return updatePersonPlanProgress(storage, req.params.id, job.generationId, {
            percent: Math.min(35, 5 + Math.round((completedPeople.size / personTotal) * 30)),
            total: personTotal,
            completed: completedPeople.size,
            active_indexes: event.active_indexes || [],
            current_index: event.current_index,
            phase: event.phase,
            message: event.message,
          });
        },
      });
      updatePersonPlanProgress(storage, req.params.id, job.generationId, { percent: 38, total: personTotal, completed: personTotal, phase: 'asset_preflight', message: '完整人物方案已发布，正在核对缺失图片' });
      const subjectBody = currentPersonGenerationBody({ taskId: req.params.id, input: req.body || {}, service, storage });
      if (!subjectBody.subject_targets.length) { updatePersonPlanProgress(storage, req.params.id, job.generationId, { percent: 99, total: personTotal, completed: personTotal, phase: 'finishing', message: '人物方案和图片已齐全，正在完成任务' }); return { person_plan: personPlan, subject_assets: null, generated_subjects: 0 }; }
      const visualPermit = generationPermit.issue(req.params.id, 'subject_assets', {
        idempotencyKey: `${req.params.id}:person_plan_assets:${String(req.body?.request_key || job.generationId)}`,
      });
      generationPermit.consume(req.params.id, visualPermit);
      const subjectAssets = await generateAndCommitSubjectAssets({ body: subjectBody, taskId: req.params.id, generationId: job.generationId, userId });
      return { person_plan: personPlan, subject_assets: subjectAssets, generated_subjects: subjectBody.subject_targets.length };
    }, { deadlineMs: 45 * 60 * 1000 });
  }));
}

module.exports = registerPersonPlanGenerationRoute;
module.exports.currentPersonGenerationBody = currentPersonGenerationBody;
module.exports.completePerson = completePerson;
module.exports.profileSnapshot = profileSnapshot;
module.exports.updatePersonPlanProgress = updatePersonPlanProgress;
