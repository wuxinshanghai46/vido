'use strict';
const fs = require('fs');
const service = require('../src/services/newStoryAd/storyboardAuthorityRepairService');
const [taskId, bindingsPath] = process.argv.slice(2);
if (!taskId || !bindingsPath) throw new Error('Usage: node scripts/repair-story-ad-authority-v413.js <taskId> <bindings.json> [--apply=<preflight fingerprint>]');
const bindings = JSON.parse(fs.readFileSync(bindingsPath, 'utf8'));
const apply = process.argv.find(x => x.startsWith('--apply='));
if (apply) console.log(JSON.stringify(service.apply(taskId, bindings, apply.slice(8))));
else {
  const plan = service.plan(taskId, bindings);
  console.log(JSON.stringify({ read_only: true, fingerprint: plan.sourceFingerprint, before: plan.oldShots.map(s => ({ scene: s.scene_id, people: s.expected_people })), after: plan.units.map(s => ({ scene: s.scene_id, people: s.character_ids.length })) }));
}
