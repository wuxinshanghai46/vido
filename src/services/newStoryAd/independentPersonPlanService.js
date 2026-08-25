'use strict';

const storage = require('./storageService');
const assetPlan = require('./assetPlanService');
const subjectProfileText = require('./subjectProfileTextService');
const generationConcurrency = require('./generationConcurrencyService');
const { assertContextConsistent } = require('./contextBuilder');

async function complete(taskId, options = {}, deps = {}) {
  const assistBrief = deps.assistBrief;
  if (typeof assistBrief !== 'function') throw new TypeError('assistBrief is required');
  const task = storage.getTask(taskId);
  if (!task) throw new Error('任务不存在');
  const ctx = assertContextConsistent(storage.getOutput(taskId, 'context') || task.request || {});
  const profiles = Array.isArray(ctx.cast_profiles) ? ctx.cast_profiles : [];
  if (!profiles.length) return assetPlan.persistIndependentPersonProfiles(taskId, [], {
    generation_id: options.generation_id || options.generationId || '', model_meta: { model_call_count: 0 },
  }).cast_profiles || [];
  const checkpointKind = 'person_plan_character_checkpoints';
  const checkpoints = storage.getOutput(taskId, checkpointKind) || {};
  const active = new Set();
  const report = async (phase, message, extra = {}) => {
    if (typeof options.onProgress === 'function') await options.onProgress({
      phase, message, total: profiles.length,
      active_indexes: [...active].sort((a, b) => a - b).map(index => index + 1), ...extra,
    });
  };
  const scheduled = profiles.map((profile, index) => generationConcurrency.schedule(
    `new_story_ad.person_plan:${taskId}`,
    Math.min(2, profiles.length),
    async () => {
      const checkpoint = checkpoints[profile.id];
      if (checkpoint?.status === 'done' && subjectProfileText.assistedProfileQuality(checkpoint.profile || {}).valid) {
        await report('person_plan_reused', `已复用${profile.displayName || profile.name || `人物${index + 1}`}的完整方案`, { completed_index: index + 1 });
        return checkpoint.profile;
      }
      active.add(index);
      await report('person_plan_character', `正在独立完善${profile.displayName || profile.name || `人物${index + 1}`}的外观、穿着与造型`, { current_index: index + 1 });
      try {
        const subjectKind = subjectProfileText.subjectKind(profile);
        const forcedProfile = {
          ...profile,
          subject_kind: subjectKind,
          user_edited_fields: [], userEditedFields: [], _userEditedFields: [],
          field_authority: Object.fromEntries(subjectProfileText.ASSIST_PROFILE_FIELDS.map(field => [field, 'system_default'])),
        };
        const response = await assistBrief({
          ...ctx,
          task_id: taskId,
          mode: 'person_spec',
          cast_profiles: profiles.map((item, itemIndex) => itemIndex === index ? forcedProfile : item),
          assist_subject_target: { kind: 'human', index, id: profile.id },
          assist_subject_kind: subjectKind,
          assist_replaceable_fields: subjectProfileText.ASSIST_DETAIL_FIELDS,
          _internal_model_stage: 'new_story_ad.person_plan_character',
        }, options.user || {});
        const generated = response.cast_profiles?.[0] || {};
        const edited = new Set(subjectProfileText.userEditedFields(profile));
        const merged = {
          ...profile, ...generated,
          subject_kind: subjectKind,
          id: profile.id,
          displayName: profile.displayName || profile.name || generated.displayName,
          name: profile.name || profile.displayName || generated.name,
          roleName: profile.roleName || profile.role || generated.roleName,
          role: profile.role || profile.roleName || generated.role,
          age: profile.age || generated.age,
          ethnicity: profile.ethnicity || profile.ethnic_appearance || generated.ethnicity,
          field_authority: profile.field_authority || profile.fieldAuthority || {},
          user_edited_fields: subjectProfileText.userEditedFields(profile),
        };
        subjectProfileText.ASSIST_DETAIL_FIELDS.forEach(field => {
          if (edited.has(field) && profile[field]) merged[field] = subjectProfileText.dedupeClauses(`${profile[field]}；${generated[field] || ''}`, 800);
        });
        assetPlan.assertDetailedPersonProfiles([merged]);
        checkpoints[profile.id] = { status: 'done', profile: merged, model_meta: response.model_meta || {}, updated_at: new Date().toISOString() };
        storage.saveOutput(taskId, checkpointKind, checkpoints);
        return merged;
      } catch (error) {
        checkpoints[profile.id] = { status: 'failed', error_code: error.code || 'PERSON_PLAN_CHARACTER_FAILED', billing_state: error.billingState || error.billing_state || '', updated_at: new Date().toISOString() };
        storage.saveOutput(taskId, checkpointKind, checkpoints);
        throw error;
      } finally {
        active.delete(index);
        await report('person_plan_character', `${profile.displayName || profile.name || `人物${index + 1}`}方案处理完成`, { completed_index: index + 1 });
      }
    },
  ));
  const settled = await Promise.allSettled(scheduled);
  const failed = settled.find(item => item.status === 'rejected');
  if (failed) throw failed.reason;
  const completedProfiles = settled.map(item => item.value);
  const saved = assetPlan.persistIndependentPersonProfiles(taskId, completedProfiles, {
    generation_id: options.generation_id || options.generationId || '',
    production_graph_authority: options.production_graph_authority === true,
    model_meta: { model_call_count: completedProfiles.length, concurrency: Math.min(2, profiles.length), stage: 'new_story_ad.person_plan_character' },
  });
  storage.deleteOutput(taskId, checkpointKind);
  return saved.cast_profiles || completedProfiles;
}

module.exports = { complete };
