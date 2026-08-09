const assert = require('assert/strict');
const repairTool = require('./repair-new-story-ad-person-looks');

const oldWardrobe = 'ancient and modern wardrobe merged into one scalar';
const task = {
  id: 'task-look-repair', title: 'Time crossing', user_id: 'user-1', content_revision: 3, stage: 'subject_assets_failed',
  request: {}, active_generation_id: '',
};
const context = {
  person_spec: { wardrobeText: oldWardrobe },
  cast_profiles: [{ id: 'person-1', displayName: 'Lin', appearanceText: 'adult woman', wardrobeText: oldWardrobe, hairMakeupText: 'natural hair' }],
};
task.request = context;
const outputs = new Map([
  ['context', context],
  ['asset_plan', { cast_profiles: context.cast_profiles, scene_plan: { cast_mode: 'single', scene_mode: 'multi', spaces: [] } }],
]);
const storage = {
  getTask: () => task,
  getOutput: (_, kind) => outputs.get(kind) || null,
  getTaskBundle: () => ({ model_calls: [] }),
};
const storyService = {
  async updateTaskRequest(_, body) {
    task.content_revision += 1;
    task.request = { ...context, ...body };
    outputs.set('context', task.request);
    return { invalidated_outputs: ['keyframes', 'video_clips'] };
  },
};
const assetPlan = {
  syncPrevious() {
    const next = outputs.get('context');
    outputs.set('asset_plan', { ...outputs.get('asset_plan'), cast_profiles: next.cast_profiles });
    task.stage = 'scene_config_done';
  },
};
const spec = {
  task_id: task.id, expected_title: task.title, person_id: 'person-1',
  expected_old_wardrobe_sha256: repairTool.sha256(oldWardrobe),
  look_profiles: [
    { id: 'look-ancient', name: 'Ancient', story_state: 'ancient', scene_ids: ['scene-ancient'], wardrobeText: 'cyan robe and cloth shoes', hairMakeupText: 'wooden hairpin' },
    { id: 'look-modern', name: 'Modern', story_state: 'modern', scene_ids: ['scene-modern'], wardrobeText: 'linen shirt and leather mules', hairMakeupText: 'natural hair' },
  ],
};

(async () => {
  const dry = await repairTool.repair(spec, {}, { storage, storyService, assetPlan });
  assert.equal(dry.status, 'ready');
  assert.equal(outputs.get('context').cast_profiles[0].look_profiles, undefined, 'dry run must not mutate task data');
  const applied = await repairTool.repair(spec, { apply: true }, { storage, storyService, assetPlan });
  assert.equal(applied.status, 'applied');
  assert.equal(applied.model_calls_before, 0);
  assert.equal(applied.model_calls_after, 0);
  assert.equal(outputs.get('context').cast_profiles.length, 1, 'repair must preserve one identity');
  assert.equal(outputs.get('context').cast_profiles[0].look_profiles.length, 2);
  assert.equal(outputs.get('asset_plan').cast_profiles[0].look_profiles.length, 2);
  assert.equal(outputs.get('context').cast_profiles[0].wardrobeText, 'cyan robe and cloth shoes');
  assert.equal(task.stage, 'scene_config_done');
  const repeated = await repairTool.repair(spec, { apply: true }, { storage, storyService, assetPlan });
  assert.equal(repeated.status, 'already_applied', 'repair must be idempotent');
  await assert.rejects(
    repairTool.repair({ ...spec, person_id: 'missing' }, {}, { storage, storyService, assetPlan }),
    /person not found/,
  );
  console.log('new story ad person look repair: 12 checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
