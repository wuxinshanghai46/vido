#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const pipeline = require('../src/services/pipelineModelService');

const root = path.resolve(__dirname, '..');
const registered = new Set(Object.values(pipeline.listSchema()).flat().map(stage => stage.id));
const nonModelLabels = new Set([
  'new_story_ad.authorized_real_person_dossier', // generated_by audit label
  'new_story_ad.person_sheet.fallback', // generated_by fallback audit label
  'new_story_ad.subject_assets', // generated_by audit label
  'new_story_ad.image_provider', // concurrency bucket, actual model uses the caller stage
  'new_story_ad.person_dossier', // concurrency bucket, actual model uses each dossier stage
]);
const files = [];
function walk(directory) {
  fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(target);
    else if (entry.name.endsWith('.js')) files.push(target);
  });
}
walk(path.join(root, 'src'));

const literalUses = new Map();
files.forEach((file) => {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/['"](new_story_ad\.[a-zA-Z0-9_.-]+)['"]/g)) {
    if (!literalUses.has(match[1])) literalUses.set(match[1], new Set());
    literalUses.get(match[1]).add(path.relative(root, file).replace(/\\/g, '/'));
  }
});
const unclassified = [...literalUses]
  .filter(([stage]) => !registered.has(stage) && !nonModelLabels.has(stage))
  .map(([stage, locations]) => ({ stage, locations: [...locations] }));
assert.deepEqual(unclassified, [], `存在未登记、也未声明为非模型标签的 new_story_ad 流程：${JSON.stringify(unclassified)}`);

[
  'new_story_ad.person_dossier_wearable_accessory',
  'new_story_ad.person_dossier_wardrobe_detail',
].forEach(stage => assert(registered.has(stage), `动态图片阶段 ${stage} 必须可在模型调用管理中维护`));

const gateway = fs.readFileSync(path.join(root, 'src/services/newStoryAd/modelGateway.js'), 'utf8');
const media = fs.readFileSync(path.join(root, 'src/services/newStoryAd/mediaAdapter.js'), 'utf8');
assert.match(gateway, /MODEL_STAGE_NOT_REGISTERED/);
assert.match(media, /MODEL_STAGE_NOT_REGISTERED/);
assert.match(media, /pipeline\.hasStageConfig\(configStage\) \? configured : defaults/);

console.log(JSON.stringify({
  model_management_audit: 'passed',
  registered_stages: registered.size,
  referenced_story_ad_labels: literalUses.size,
  explicitly_non_model_labels: nonModelLabels.size,
  unclassified: 0,
}));
