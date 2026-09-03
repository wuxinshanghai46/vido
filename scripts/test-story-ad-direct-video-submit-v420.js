'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
process.env.OUTPUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-direct-video-'));
process.env.DB_ENABLED = '0';
const authorization = require('../src/services/newStoryAd/videoSubmissionAuthorizationService');
const policy = require('../src/services/newStoryAd/paidVideoExecutionPolicyService');
const costGuard = require('../src/services/videoGenerationCore/costGuard');
const failure = require('../src/services/newStoryAd/publicFailureProjectionService');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const source = read('src/services/newStoryAd/storyAdService.js');
const gateSource = source.slice(source.indexOf('function assertVideoPreflightConfirmation('), source.indexOf('async function generateVideoStage'));
const gate = require('../src/services/newStoryAd/videoSubmissionGateService');
const cost = costGuard.buildCostPlan({ providerId: 'configured-unpriced-test', modelId: 'video-test', executionPlan: { fingerprint: 'execution', generation_units: [{ id: 'unit-1', duration_sec: 5, edit_shot_indexes: [0], requires_manual_review: true }] } });
assert.equal(cost.price_known, false);
const base = { task_id: 'task-' + 'a'.repeat(180), mode: 'economy', provider_route: 'configured-unpriced-test/video-test', execution_plan: { fingerprint: 'execution', generation_units: [{ requires_manual_review: true }] }, cost_plan: cost, paid_unit_count: 1, blockers: [], scope: { requested_indexes: [0], expanded_indexes: [0] }, shots: [{ index: 0, action: 'generate' }], units: [{ id: 'unit-1', paid: true }], expected_lineages: ['lineage-a'] };
let plan = structuredClone(base), writes = [], authorizations = [];
const sandbox = { buildVideoPreflightPlan: () => structuredClone(plan), videoSubmissionAuthorization: authorization, videoSubmissionGate: gate, videoPreflight: { publicVideoPreflight: x => x }, videoCostAuthorization: { authorize: (...args) => authorizations.push(args) }, paidExecutionPolicy: policy, storage: { saveOutput: (...args) => writes.push(args) } };
vm.createContext(sandbox); vm.runInContext(gateSource + '\nglobalThis.validate = assertVideoPreflightConfirmation;', sandbox);
const prepared = sandbox.validate(base.task_id, {}, { persist: false });
assert.equal(writes.length + authorizations.length, 0, 'pre-queue validation must be read only');
const options = { _videoSubmissionFingerprint: authorization.submissionFingerprint(prepared) };
sandbox.validate(base.task_id, options);
assert.equal(authorizations.length, 1, 'supported unpriced model can authorize without price or complexity confirmation');
assert.equal(authorizations[0][1].estimated_cost_rmb, null);
assert.equal(authorizations[0][1].confirmed_cost_limit_rmb, null);
assert.equal(authorizations[0][1].automatic_paid_retry_count, 0);
plan.cost_plan = { ...cost, price_known: true, maximum_cost_rmb: 42, fingerprint: 'new-price' };
assert.doesNotThrow(() => sandbox.validate(base.task_id, options, { persist: false }), 'price metadata update cannot invalidate selected inputs');
for (const change of [{ provider_route: 'other/model' }, { expected_lineages: ['lineage-b'] }, { scope: { expanded_indexes: [0, 1] } }]) {
  plan = { ...base, ...change };
  assert.throws(() => sandbox.validate(base.task_id, options), error => error.code === 'VIDEO_SUBMISSION_CHANGED');
}
for (const code of ['VIDEO_PROVIDER_CAPABILITY_UNSUPPORTED', 'VIDEO_INPUT_QA_REQUIRED', 'VIDEO_PROVIDER_BILLING_BLOCKED']) {
  plan = { ...base, blockers: [{ code, message: 'internal reason' }] };
  assert.throws(() => sandbox.validate(base.task_id, {}), error => error.code === code);
}
assert.equal(authorizations.length, 1, 'rejections never write authorization');
assert.throws(() => policy.assertExternalRequest(options), error => error.code === 'VIDEO_PAID_EXECUTION_OPTION_FORBIDDEN');
const payload = { success: false, code: 'PRIVATE_FAILURE', error: 'private supplier reason', details: { provider: 'secret-route' }, preflight: base, request_id: 'support-1' };
assert.deepEqual(authorization.failureResponse(payload, true), payload);
const publicResult = authorization.failureResponse(payload, false);
assert.equal(publicResult.error, '视频生成失败。');
assert(!JSON.stringify(publicResult).includes('private') && !publicResult.details && !publicResult.preflight);
const task = { stage: 'video', error: '具体中文计价错误', error_code: 'PRIVATE_FAILURE' };
assert.equal(failure.project(task).public_error, '视频生成失败。');
assert.equal(failure.project(task, { isAdmin: true }).technical_diagnostics.error, task.error);
assert(!source.slice(source.indexOf('function buildVideoPreflightPlan'), source.indexOf('function assertVideoPreflightConfirmation')).includes('VIDEO_COST_PRICE_UNKNOWN'));

async function uiTest() {
  let submitted = 0, resolve, reject, handler, route = 'seedance-sz'; const messages = [];
  let pending = new Promise(r => { resolve = r; });
  const button = { dataset: {}, addEventListener: (_event, fn) => { handler = fn; } };
  const host = { innerHTML: '', querySelectorAll: () => [], querySelector: selector => selector === '[data-generate-video]' ? button : null };
  const ui = { emptyState: x => JSON.stringify(x), escapeHtml: String, mediaPreview: () => '', bindMoreMedia: () => {}, moreMediaButton: () => '', loadGenerationModelPicker: async () => ({ html: '' }), bindGenerationModelPicker: () => () => route, setButtonBusy: () => {}, toast: (...args) => messages.push(args) };
  vm.createContext(ui); vm.runInContext(read('public/story-ad/views/finalView.js').replace(/^import .*;\r?\n/gm, '').replace(/export /g, '') + '\nglobalThis.render = mount;', ui);
  const context = { bundle: { project: { id: base.task_id }, storyboard: { shots: [{}] }, generation: { approved_frames: [{}] } }, refreshShell: async () => {}, store: { startVideo: async options => { assert.equal(options.video_model_route, route); submitted++; return pending; } } };
  await ui.render(host, context);
  assert(!/data-cost-confirm|data-preflight-modal|预计上限|费用预检/.test(host.innerHTML));
  const first = handler({ currentTarget: button });
  await handler({ currentTarget: button }); await handler({ currentTarget: button });
  assert.equal(submitted, 1, 'concurrent clicks submit exactly once without a preflight roundtrip');
  resolve({}); await first;
  pending = new Promise((_resolve, r) => { reject = r; });
  const second = handler({ currentTarget: button }); reject(new Error('private pricing error')); await second;
  assert.equal(messages.at(-1)[0], '视频提交未完成。');
  route = ''; await handler({ currentTarget: button }); assert.equal(submitted, 2, 'no model selection cannot submit');
  console.log(JSON.stringify({ passed: true, checks: ['unpriced_route', 'no_manual_complexity_confirmation', 'readonly_prequeue', 'immutable_input_scope', 'price_update', 'capability_block', 'input_qa_block', 'billing_block', 'forgery_rejected', 'error_permissions', 'one_click_and_concurrent_clicks', 'long_task_id', 'generic_failure'], model_calls: 0 }));
}
uiTest().catch(error => { console.error(error); process.exitCode = 1; });
