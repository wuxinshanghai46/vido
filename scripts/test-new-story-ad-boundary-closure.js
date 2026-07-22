#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-nsa-boundary-closure-'));
process.env.OUTPUT_DIR = tempDir;
process.env.DB_ENABLED = '0';

const storage = require('../src/services/newStoryAd/storageService');
const storyAd = require('../src/services/newStoryAd/storyAdService');
const boundaries = require('../src/services/newStoryAd/videoBoundaryPolicyService');
const preflight = require('../src/services/newStoryAd/videoPreflightService');

const clip = (index, block, cross = undefined) => ({
  shot_index: index,
  video_url: `/shot-${index + 1}.mp4`,
  lineage_fingerprint: `lineage-${index + 1}`,
  scene_block_id: block,
  qa: { pass: true, frames: [{ image_url: `/shot-${index + 1}-head.jpg`, second: 0 }, { image_url: `/shot-${index + 1}-tail.jpg`, second: 4.95 }] },
  ...(cross === undefined ? {} : { cross_shot_qa: { pass: cross } }),
});

async function main() {
  const clips = [clip(0, 'block-a'), clip(1, 'block-b', true), clip(2, 'block-b'), clip(3, 'block-c')];
  const audit = boundaries.audit(clips, 4);
  assert.deepStrictEqual(audit.missing_indexes, [3], 'the first clip of a new generation unit must have an explicit boundary verdict');
  assert.deepStrictEqual(boundaries.requiredBoundaryIndexes(clips, [3]), [3], 'a successful shot re-review must schedule its previous cross-unit boundary');
  assert.deepStrictEqual(boundaries.requiredBoundaryIndexes(clips, [2]), [3], 're-reviewing the previous shot must also schedule the following cross-unit boundary');

  const shots = Array.from({ length: 4 }, (_, index) => ({ index: index + 1, title: `镜头 ${index + 1}`, duration: 5, scene_id: 'scene-a', visual: `画面 ${index + 1}`, action: '轻微动作' }));
  const keyframes = shots.map((_, index) => ({ image_url: `/frame-${index + 1}.jpg`, qa: { pass: true, person: { person_presence: 'none' } } }));
  const plan = preflight.buildVideoPreflight({ taskId: 'boundary-preflight', shots, keyframes, contracts: [{}, {}, {}, {}], clips, statuses: [], mode: 'economy' });
  const boundaryReview = plan.shots.find(item => item.index === 3);
  assert.strictEqual(boundaryReview.action, 'review_only');
  assert.strictEqual(boundaryReview.review_scope, 'cross_shot');
  assert.strictEqual(boundaryReview.paid, false);
  assert.strictEqual(plan.paid_unit_count, 0, 'closing a missing QA boundary must not regenerate video');

  const staleClips = clips.map((item, index) => index === 3 ? { ...item, error_code: 'VIDEO_LINEAGE_MISMATCH' } : item);
  const stalePlan = preflight.buildVideoPreflight({ taskId: 'boundary-stale-media', shots, keyframes, contracts: [{}, {}, {}, {}], clips: staleClips, statuses: [], mode: 'economy' });
  assert.strictEqual(stalePlan.shots.find(item => item.index === 3).action, 'provider_generate', 'missing boundary review must not override an independent regeneration reason');

  storyAd.createTask({ task_id: 'boundary-compose-block', brief: '跨生成单元封装门禁回归' }, { id: 'owner-1' });
  storage.saveOutput('boundary-compose-block', 'storyboard_table', shots);
  storage.saveOutput('boundary-compose-block', 'video_clips', clips);
  await assert.rejects(
    () => storyAd.composeStage('boundary-compose-block', {}),
    error => error.code === 'COMPOSE_BOUNDARY_QA_INCOMPLETE' && /第 3→4 镜/.test(error.message),
  );
  assert.strictEqual(storage.getOutput('boundary-compose-block', 'final_video'), null, 'blocked composition must not create or overwrite final output');

  const source = fs.readFileSync(path.join(__dirname, '../src/services/newStoryAd/storyAdService.js'), 'utf8');
  assert(source.includes('videoBoundaryPolicy.requiredBoundaryIndexes(clips, reviewedIndexes)'), 'shot re-review must automatically close adjacent required boundaries');
  console.log('new story ad boundary closure: ok');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
