'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const sqlite = read('src/db/sqlite.js');
const failureBranch = sqlite.slice(sqlite.indexOf('if (child.status !== 0)'), sqlite.indexOf("const output = (child.stdout"));
assert(failureBranch.includes('child.error?.code'), 'Python bridge errors must report the bounded process error code');
assert(failureBranch.includes('.slice(0, 2000)'), 'Python bridge error text must have a hard upper bound');
assert(!failureBranch.includes('child.stdout'), 'partial query payloads must never be copied into PM2 error logs');

const jobs = read('src/services/newStoryAd/jobService.js');
const reconciliation = jobs.slice(jobs.indexOf('function reconcileInterruptedJobs'), jobs.indexOf('function cancelJob'));
assert(reconciliation.includes('storage.listTaskRows()'), 'job reconciliation must load task rows only');
assert(!reconciliation.includes('storage.readDb()'), 'job reconciliation must not materialize artifact payload history');

const assetCenter = read('public/story-ad/views/assetCenterView.js');
const payloadBuilder = assetCenter.slice(assetCenter.indexOf('export function subjectGenerationPayload'), assetCenter.indexOf('function generationValidation'));
assert.equal((payloadBuilder.match(/person_change_kind = 'visual_dossier'/g) || []).length, 2,
  'single and batch visual generation payloads must both declare visual-only change scope');
assert(!/person_change_kind\s*=.*semantic/.test(payloadBuilder), 'image generation must not claim a semantic person edit');

const routes = read('src/routes/newStoryAd.js');
assert((routes.match(/commitGeneratedPersonAsset\([^\n]+change_kind: 'visual_dossier'/g) || []).length >= 2,
  'person-sheet success and fallback paths must preserve the blueprint');
assert(routes.includes("change_kind: 'visual_dossier',\n        })"), 'subject dossier generation must force visual-only invalidation');

const approval = read('src/routes/newStoryAd/personDossierApprovalRoute.js');
assert(approval.includes("change_kind: 'visual_dossier'"), 'approved person dossiers must remain a visual-only mutation');

const orchestrator = read('src/services/newStoryAd/productionAssetOrchestratorService.js');
assert(orchestrator.includes("{ change_kind: 'visual_dossier', deferContextWrite: true }"),
  'combined production asset generation must preserve the approved blueprint');

console.log(JSON.stringify({
  passed: true,
  checks: 10,
  bounded_sqlite_error_log: true,
  reconciliation_scope: 'tasks_only',
  person_visual_preserves_blueprint: true,
  model_calls: 0,
}));
