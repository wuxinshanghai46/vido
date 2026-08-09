const crypto = require('crypto');
const fs = require('fs');
const storageDefault = require('../src/services/newStoryAd/storageService');
const storyServiceDefault = require('../src/services/newStoryAd/storyAdService');
const assetPlanDefault = require('../src/services/newStoryAd/assetPlanService');
const personLooks = require('../src/services/newStoryAd/personLookProfileService');

function sha256(value = '') {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function profileById(rows = [], id = '') {
  return (Array.isArray(rows) ? rows : []).find(profile => String(profile?.id || '') === String(id));
}

function normalizeSpec(spec = {}) {
  const taskId = String(spec.task_id || '').trim();
  const personId = String(spec.person_id || '').trim();
  const looks = personLooks.normalizeLookProfiles({ id: personId, look_profiles: spec.look_profiles || [] });
  if (!taskId || !personId || looks.length < 2) throw new Error('repair spec requires task_id, person_id and at least two look_profiles');
  const unbound = looks.filter(look => !look.scene_ids.length && !look.story_state);
  if (unbound.length) throw new Error(`repair look is not bound to a scene or story state: ${unbound.map(look => look.id).join(', ')}`);
  return {
    task_id: taskId,
    person_id: personId,
    expected_title: String(spec.expected_title || '').trim(),
    expected_old_wardrobe_sha256: String(spec.expected_old_wardrobe_sha256 || '').trim(),
    look_profiles: looks,
  };
}

function sameLooks(profile = {}, looks = []) {
  const current = personLooks.normalizeLookProfiles(profile);
  return current.length === looks.length && current.every((look, index) => (
    look.id === looks[index].id
    && look.wardrobeText === looks[index].wardrobeText
    && JSON.stringify(look.scene_ids) === JSON.stringify(looks[index].scene_ids)
  ));
}

function repairedProfile(profile = {}, looks = []) {
  const primary = looks[0];
  const wardrobeText = primary.wardrobeText;
  const hairMakeupText = primary.hairMakeupText || profile.hairMakeupText || '';
  return {
    ...profile,
    look_profiles: looks,
    wardrobeText,
    hairMakeupText,
    wardrobe: { ...(profile.wardrobe && typeof profile.wardrobe === 'object' ? profile.wardrobe : {}), userPrompt: wardrobeText },
    hairMakeup: { ...(profile.hairMakeup && typeof profile.hairMakeup === 'object' ? profile.hairMakeup : {}), userPrompt: hairMakeupText },
    outfit: wardrobeText,
    description: [profile.appearanceText, `服装：${wardrobeText}`, `发型妆造：${hairMakeupText}`].filter(Boolean).join('；'),
  };
}

async function repair(specInput = {}, options = {}, deps = {}) {
  const storage = deps.storage || storageDefault;
  const storyService = deps.storyService || storyServiceDefault;
  const assetPlan = deps.assetPlan || assetPlanDefault;
  const spec = normalizeSpec(specInput);
  const task = storage.getTask(spec.task_id);
  if (!task) throw new Error(`task not found: ${spec.task_id}`);
  if (task.active_generation_id) throw new Error(`task has active generation: ${task.active_generation_id}`);
  if (spec.expected_title && String(task.title || '') !== spec.expected_title) throw new Error(`task title mismatch: ${task.title || ''}`);
  const context = storage.getOutput(spec.task_id, 'context') || task.request || {};
  const profile = profileById(context.cast_profiles, spec.person_id);
  if (!profile) throw new Error(`person not found: ${spec.person_id}`);
  if (sameLooks(profile, spec.look_profiles)) return { status: 'already_applied', task_id: spec.task_id, person_id: spec.person_id, look_count: spec.look_profiles.length };
  if (!spec.expected_old_wardrobe_sha256 || sha256(profile.wardrobeText || '') !== spec.expected_old_wardrobe_sha256) {
    throw new Error('current wardrobe does not match the reviewed pre-repair evidence');
  }
  const nextProfile = repairedProfile(profile, spec.look_profiles);
  const castProfiles = context.cast_profiles.map(item => String(item?.id || '') === spec.person_id ? nextProfile : item);
  const personSpec = {
    ...(context.person_spec || {}),
    wardrobeText: nextProfile.wardrobeText,
    hairMakeupText: nextProfile.hairMakeupText,
    look_profiles: nextProfile.look_profiles,
  };
  const preview = {
    status: 'ready', task_id: spec.task_id, person_id: spec.person_id,
    before_look_count: personLooks.normalizeLookProfiles(profile).length,
    after_look_count: spec.look_profiles.length,
    look_ids: spec.look_profiles.map(look => look.id),
  };
  if (options.apply !== true) return preview;
  const modelCallsBefore = storage.getTaskBundle(spec.task_id).model_calls.length;
  const updated = await storyService.updateTaskRequest(spec.task_id, {
    cast_profiles: castProfiles,
    person_spec: personSpec,
    changed_domains: ['person'],
    asset_setup_confirmed: false,
  }, { id: task.user_id || '', userId: task.user_id || '' });
  assetPlan.syncPrevious(spec.task_id);
  const finalContext = storage.getOutput(spec.task_id, 'context') || {};
  const finalPlan = storage.getOutput(spec.task_id, 'asset_plan') || {};
  const finalTask = storage.getTask(spec.task_id) || {};
  const contextProfile = profileById(finalContext.cast_profiles, spec.person_id);
  const planProfile = profileById(finalPlan.cast_profiles, spec.person_id);
  if (!sameLooks(contextProfile, spec.look_profiles) || !sameLooks(planProfile, spec.look_profiles)) {
    throw new Error('post-repair verification failed: context and asset plan are not synchronized');
  }
  const modelCallsAfter = storage.getTaskBundle(spec.task_id).model_calls.length;
  if (modelCallsAfter !== modelCallsBefore) throw new Error('repair unexpectedly submitted a model call');
  return {
    ...preview,
    status: 'applied',
    content_revision: finalTask.content_revision,
    stage: finalTask.stage,
    invalidated_outputs: updated.invalidated_outputs || [],
    model_calls_before: modelCallsBefore,
    model_calls_after: modelCallsAfter,
  };
}

async function main(argv = process.argv.slice(2)) {
  if (!argv.includes('--stdin')) throw new Error('usage: node scripts/repair-new-story-ad-person-looks.js --stdin [--apply]');
  const spec = JSON.parse(fs.readFileSync(0, 'utf8'));
  console.log(JSON.stringify(await repair(spec, { apply: argv.includes('--apply') }), null, 2));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });

module.exports = { sha256, normalizeSpec, repairedProfile, sameLooks, repair };
