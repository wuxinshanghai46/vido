const assert = require('assert');

const shotDesign = require('../src/services/newStoryAd/shotDesignService');
const continuity = require('../src/services/newStoryAd/continuityService');
const storyAd = require('../src/services/newStoryAd/storyAdService');
const videoAdapter = require('../src/services/newStoryAd/videoAdapter');
const sceneAssets = require('../src/services/newStoryAd/sceneAssetService');

const empty = shotDesign.normalizeShotDesign({});
assert.strictEqual(empty.shot_scope, 'auto');
assert.strictEqual(empty.surface_topology, undefined);
assert.strictEqual(empty.motion_effect, undefined);
assert.strictEqual(shotDesign.surfacePrompt(empty.surface_topology, empty.shot_scope), '');
assert.strictEqual(shotDesign.motionEffectPrompt(empty.motion_effect), '');

const continuousShot = {
  title: 'generic environment shot',
  visual: 'A task-defined primary surface behind the subject',
  action: 'The subject stands still',
  shot_scope: 'environment',
  surface_topology: {
    mode: 'continuous',
    seam_policy: 'hidden',
    finish_distribution: 'uniform',
  },
};
const surfaceText = shotDesign.surfacePrompt(continuousShot.surface_topology, continuousShot.shot_scope);
assert.match(surfaceText, /continuous, uninterrupted construction plane/i);
assert.match(surfaceText, /hide construction joints/i);
assert.doesNotMatch(surfaceText, /stainless|wall|actress|佛山/i);

const comparisonText = shotDesign.surfacePrompt({
  mode: 'segmented',
  seam_policy: 'visible',
  finish_distribution: 'sample_comparison',
}, 'product_comparison');
assert.match(comparisonText, /isolated product\/sample comparison insert/i);
assert.match(comparisonText, /must not redefine the topology of the master environment/i);

const particleShot = {
  title: 'brand endcard',
  visual: 'A clean task-defined background with dispersed material particles and clear central space',
  action: 'Particles gather into the authored target',
  shot_scope: 'brand_endcard',
  motion_effect: {
    type: 'particle_assembly',
    source_state: 'particles remain dispersed around the center',
    target_state: 'the approved brand mark is fully formed',
    timeline: '0-1s hold; 1-3.5s converge; 3.5-4.5s form; final frame holds',
    preserve_scene_geometry: true,
  },
};
const keyframePrompt = storyAd.buildKeyframePrompt({
  brief: 'A generic commercial task',
  product_subject: 'task subject',
  output_ratio: '9:16',
}, particleShot, { visual_contract: {} }, 5);
assert.match(keyframePrompt, /START KEYFRAME/i);
assert.match(keyframePrompt, /not yet fully formed/i);

const motionPrompt = videoAdapter.clipPrompt(particleShot, { product_subject: 'task subject' }, {}, null);
assert.match(motionPrompt, /Within-shot motion effect: particle_assembly/i);
assert.match(motionPrompt, /Do not substitute a simple opacity fade or dissolve/i);
assert.match(motionPrompt, /explicitly authored effect target is allowed/i);

const defaultMotionPrompt = videoAdapter.clipPrompt({ visual: 'ordinary frame', action: 'ordinary motion' }, { product_subject: 'task subject' }, {}, null);
assert.doesNotMatch(defaultMotionPrompt, /Within-shot motion effect/i);
assert.match(defaultMotionPrompt, /Do not add unrelated people, objects, text, logos/i);

const stateContract = continuity.continuityContract({
  object_states: { package: 'open', product: { position: 'right', state: 'stable' } },
});
assert.match(stateContract.object_states, /package: open/i);
assert.match(stateContract.object_states, /position: right/i);
assert.doesNotMatch(stateContract.object_states, /\[object Object\]/i);

const defaultScenePrompt = sceneAssets.buildSceneSheetPrompt({ ctx: { brief: 'generic task' } });
assert.match(defaultScenePrompt, /visible panel seams, joints/i);
assert.doesNotMatch(defaultScenePrompt, /Task-specific surface construction contract|Shot scope:/i);
const continuousScenePrompt = sceneAssets.buildSceneSheetPrompt({
  ctx: {
    brief: 'generic task',
    scene_spec: {
      surfaceTopology: { mode: 'continuous', seam_policy: 'hidden', finish_distribution: 'uniform' },
    },
  },
});
assert.match(continuousScenePrompt, /explicitly continuous surface topology/i);
assert.doesNotMatch(continuousScenePrompt, /visible panel seams, joints/i);

console.log('new-story-ad shot design tests passed');
