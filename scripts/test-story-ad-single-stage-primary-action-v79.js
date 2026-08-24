'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const stageSource = read('public/story-ad/views/assetCenterStageView.js')
  .replace(/^import\s+.*?;\s*$/gm, '').replace(/\bexport\s+/g, '');
const sandbox = {};
vm.runInNewContext(`${stageSource}\nglobalThis.__stage=assetPlanStageView;`, sandbox);

const pending = sandbox.__stage({ generationActive: false, counts: { people: 2, scenes: 1 }, missingSubjectCount: 2 });
assert.match(pending, /data-generate-subject-assets[^>]*>生成人物资产/);
assert.equal((pending.match(/data-generate-subject-assets/g) || []).length, 1);
assert.doesNotMatch(pending, /data-generate-recovery|data-update-person-plan|data-generate-subjects/);

const active = sandbox.__stage({ generationActive: true, counts: { people: 2, scenes: 1 }, missingSubjectCount: 2 });
assert.match(active, /data-generate-subject-assets[^>]*disabled[^>]*>正在生成人物资产/);
assert.equal((active.match(/data-generate-subject-assets/g) || []).length, 1);

const ready = sandbox.__stage({
  generationActive: false,
  counts: { people: 2, scenes: 1 },
  missingSubjectCount: 0,
});
assert.match(ready, /data-confirm-assets[^>]*>人物资产已完成，进入场景/);
assert.doesNotMatch(ready, /data-generate-production-assets|data-generate-subject-assets|data-generate-recovery|data-update-person-plan/);

const liveSource = read('public/story-ad/views/assetCenterView.js');
assert.doesNotMatch(liveSource, /checkpointRecoveryBanner\s*\(/);
assert.doesNotMatch(liveSource, /querySelectorAll\('\[data-generate-subjects\]/);
assert.match(liveSource, /data-generate-subject-assets/);
assert.match(liveSource, /data-generate-scene/);

console.log(JSON.stringify({ passed: true, separated_subject_action: 1, separated_scene_action: true, model_calls: 0 }));
