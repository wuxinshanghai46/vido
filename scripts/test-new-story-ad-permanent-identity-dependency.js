'use strict';

const assert = require('assert');
const identities = require('../src/services/newStoryAd/permanentIdentityService');
const dependencies = require('../src/services/newStoryAd/revisionDependencyService');

const first = identities.reconcile('work-1', 'scene', [
  { name: '咖啡馆', type: '室内', location: '上海' },
  { name: '公园', type: '室外', location: '上海' },
]);
const second = identities.reconcile('work-1', 'scene', [
  { name: '公园', type: '室外', location: '上海', weather: '晴' },
  { name: '咖啡馆', type: '室内', location: '上海', time: '夜晚' },
], first.items);
assert.strictEqual(second.items[0].permanent_id, first.items[1].permanent_id, '重排后公园永久ID必须保持');
assert.strictEqual(second.items[1].permanent_id, first.items[0].permanent_id, '重排后咖啡馆永久ID必须保持');
assert.strictEqual(second.items[0].identity_revision, 2, '内容变化只增加实体版本');
assert.strictEqual(second.duplicate_semantic_keys.length, 0);

const shotImpact = dependencies.affectedDomains(['storyboard']);
assert.deepStrictEqual(shotImpact.invalidated.sort(), ['audio', 'compose', 'keyframes', 'video']);
assert(!shotImpact.invalidated.includes('subjects'));
assert(!shotImpact.invalidated.includes('scenes'));
const candidateImpact = dependencies.affectedDomains(['planning']);
assert.deepStrictEqual(candidateImpact.invalidated, [], '候选方案变化不得失效已发布生产链');
const activePlanImpact = dependencies.affectedDomains(['plan']);
assert(activePlanImpact.invalidated.includes('subjects'));
assert(activePlanImpact.invalidated.includes('keyframes'));
assert(activePlanImpact.invalidated.includes('compose'));
const sceneImpact = dependencies.affectedDomains(['scenes']);
assert(sceneImpact.invalidated.includes('storyboard'));
assert(sceneImpact.invalidated.includes('compose'));
assert(!sceneImpact.invalidated.includes('brief'));
console.log(JSON.stringify({ passed: true, stable_ids: true, local_revision: true, storyboard_invalidation: shotImpact.invalidated }));
