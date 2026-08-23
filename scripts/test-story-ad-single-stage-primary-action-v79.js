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

const pending = sandbox.__stage({ generationActive: false, counts: { people: 2, scenes: 1 } });
assert.match(pending, /data-generate-production-assets[^>]*>生成全部制作资产/);
assert.equal((pending.match(/data-(?:generate-production-assets|confirm-assets)/g) || []).length, 1);
assert.doesNotMatch(pending, /data-generate-recovery|data-update-person-plan|data-generate-subjects/);

const active = sandbox.__stage({ generationActive: true, counts: { people: 2, scenes: 1 } });
assert.match(active, /data-generate-production-assets[^>]*disabled[^>]*>正在生成全部制作资产/);
assert.equal((active.match(/data-(?:generate-production-assets|confirm-assets)/g) || []).length, 1);

const ready = sandbox.__stage({
  generationActive: false,
  counts: { people: 2, scenes: 1 },
  productionGraph: { validation: { status: 'ready' } },
});
assert.match(ready, /data-confirm-assets[^>]*>确认制作资产，进入场景世界/);
assert.doesNotMatch(ready, /data-generate-production-assets|data-generate-recovery|data-update-person-plan/);
assert.equal((ready.match(/data-(?:generate-production-assets|confirm-assets)/g) || []).length, 1);

const liveSource = read('public/story-ad/views/assetCenterView.js');
assert.doesNotMatch(liveSource, /checkpointRecoveryBanner\s*\(/);
assert.doesNotMatch(liveSource, /querySelectorAll\('\[data-generate-subjects\]/);
assert.match(liveSource, /data-generate-production-assets/);

console.log(JSON.stringify({ passed: true, unified_primary_actions: 1, legacy_mounted_actions: 0, model_calls: 0 }));
