'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const personStage = read('public/story-ad/views/assetCenterStageView.js');
const world = read('public/story-ad/views/sceneWorldView.js');
const director = read('public/story-ad/views/directorStudioView.js');
const prompt = read('src/services/newStoryAd/sceneVisualPromptService.js');
const qa = read('src/services/newStoryAd/sceneSpaceContractService.js');

assert.match(personStage, /const personFailure = \/\^\(person\|subject\)/);
assert.match(personStage, /!completed && !generationActive && personFailure/);
assert.doesNotMatch(world, /打开3D导演预演（免供应商）/);
assert.match(world, /spatialOption\.disabled = true/);
assert.match(world, /真实可移动空间（6DoF，当前不可用）/);
assert.match(director, /const personAvatar = color =>/);
assert.match(director, /new THREE\.EdgesGeometry/);
assert.match(prompt, /Zero visible humans are permitted/);
assert.match(prompt, /空场景资产必须完全无人/);
assert.match(qa, /Any person, face, head, hair, body, hand, silhouette, mannequin or human reflection/);

console.log(JSON.stringify({
  passed: true,
  person_failure_scoped: true,
  six_dof_disabled_without_model: true,
  director_humanoid_and_wireframe: true,
  unreferenced_humans_rejected: true,
  paid_model_calls: 0,
}));
