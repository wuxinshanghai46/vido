#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function argument(name, fallback = '') {
  const prefix = `--${name}=`;
  const match = process.argv.find(value => value.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}
function stamp() { return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14); }
function rows(value) { return Array.isArray(value) ? value : []; }
function clean(value = '') { return String(value ?? '').trim(); }
function persist(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }

if (!process.argv.includes('--confirm-paid')) throw new Error('REAL_GOLDEN_PAID_CONFIRMATION_REQUIRED');
const budgetRmb = Number(argument('budget-rmb', '0'));
if (!(budgetRmb > 0) || budgetRmb > 50) throw new Error('REAL_GOLDEN_BUDGET_MUST_BE_BETWEEN_0_AND_50_RMB');
const reservePerTextCallRmb = 1;
const requestedProject = clean(argument('project'));
const auditRoot = path.resolve(argument('audit-dir', path.join(process.cwd(), 'outputs', 'audits', 'golden-real-text', stamp())));
const temporaryOutput = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-golden-real-text-'));
fs.mkdirSync(auditRoot, { recursive: true });
process.env.OUTPUT_DIR = temporaryOutput;
process.env.DB_ENABLED = '0';
process.env.DB_READ_PRIMARY = '0';
process.env.DB_DUAL_WRITE = '0';
process.env.DB_JSON_FALLBACK = '1';
process.env.NEW_STORY_AD_TEXT_MAX_CANDIDATES = '1';
const settingsSource = path.join(process.cwd(), 'outputs', 'settings.json');
if (fs.existsSync(settingsSource)) fs.copyFileSync(settingsSource, path.join(temporaryOutput, 'settings.json'));

const contracts = require('../src/services/newStoryAd/goldenProjectContractService');
const storage = require('../src/services/newStoryAd/storageService');
const service = require('../src/services/newStoryAd');
const works = require('../src/services/newStoryAd/workAggregateService');

const auditPath = path.join(auditRoot, 'audit.json');
const audit = {
  schema_version: 1,
  status: 'running',
  evidence_class: 'real_production_route_text_only',
  started_at: new Date().toISOString(),
  budget: {
    authorized_limit_rmb: budgetRmb,
    conservative_reserve_per_text_call_rmb: reservePerTextCallRmb,
    actual_provider_charge_rmb: null,
    actual_charge_note: '供应商响应与本地调用账本未提供可核对的人民币实扣字段，不把保守预留冒充实付。',
  },
  projects: [],
  total_model_calls_started: 0,
  conservative_reserved_rmb: 0,
};
persist(auditPath, audit);

function assertBudget(additionalCalls = 1) {
  const reserved = (audit.total_model_calls_started + additionalCalls) * reservePerTextCallRmb;
  if (reserved > budgetRmb) throw Object.assign(new Error('REAL_GOLDEN_BUDGET_EXHAUSTED'), { code: 'REAL_GOLDEN_BUDGET_EXHAUSTED' });
}
function modelCalls(taskId) { return storage.getTaskBundle(taskId, { diagnostics: true }).model_calls; }
function subjectCounts(context = {}) {
  const people = rows(context.cast_profiles).length ? rows(context.cast_profiles) : rows(context.characters);
  const pets = rows(context.pet_profiles).length ? rows(context.pet_profiles) : rows(context.pet_contract?.profiles);
  return { people: people.length, animals: pets.length };
}
function validateTextEvidence(project, taskId) {
  const context = storage.getOutput(taskId, 'context') || {};
  const sceneConfig = storage.getOutput(taskId, 'scene_config') || {};
  const blueprint = storage.getOutput(taskId, 'blueprint') || null;
  const storyboard = rows(storage.getOutput(taskId, 'storyboard_table'));
  const authored = JSON.stringify({ scene_config: sceneConfig, blueprint, storyboard });
  const counts = subjectCounts(context);
  const issues = [];
  if (clean(context.brief) !== clean(project.request.brief) || context.brief_source !== 'user') issues.push('user_brief_changed');
  if (context.content_form !== project.request.content_form || context.content_mode !== project.request.content_mode) issues.push('content_form_changed');
  if (!blueprint) issues.push('blueprint_missing');
  if (!storyboard.length) issues.push('storyboard_missing');
  if (rows(project.expected.required_facts).some(fact => !authored.includes(fact))) issues.push('required_user_fact_missing');
  if (rows(project.expected.forbidden_terms).some(term => authored.includes(term))) issues.push('forbidden_content_present');
  if (counts.people !== Number(project.expected.expected_people || 0)) issues.push('people_count_mismatch');
  if (counts.animals !== Number(project.expected.expected_animals || 0)) issues.push('animal_count_mismatch');
  const sceneCount = rows(sceneConfig.spaces || sceneConfig.scenes || sceneConfig.scene_plan?.spaces).length;
  if (sceneCount < Number(project.expected.min_scene_count || 0)) issues.push('scene_count_incomplete');
  const calls = modelCalls(taskId);
  if (!calls.length) issues.push('real_model_call_missing');
  if (calls.some(call => clean(call.billing_state) === 'unknown')) issues.push('billing_unknown');
  if (calls.some(call => call.status !== 'success')) issues.push('model_call_failed');
  return {
    ok: issues.length === 0,
    issues,
    counts: { scenes: sceneCount, storyboard: storyboard.length, people: counts.people, animals: counts.animals, model_calls: calls.length },
    models: calls.map(call => ({ stage: call.stage, provider_id: call.provider_id, model_id: call.model_id, status: call.status, billing_state: call.billing_state || '' })),
    outputs: { scene_config: sceneConfig, blueprint, storyboard_table: storyboard },
  };
}

async function runProject(project) {
  assertBudget(3);
  const created = service.createTask({ ...project.request, task_id: `golden-real-text-${project.id}-${Date.now()}` }, { id: 'golden-real-audit' });
  const entry = { project_id: project.id, task_id: created.task.id, status: 'running', started_at: new Date().toISOString(), stages: [] };
  audit.projects.push(entry);
  persist(auditPath, audit);
  for (const [name, execute] of [
    ['scene_config', () => service.generateSceneConfig(created.task.id)],
    ['blueprint', () => service.generateBlueprintStage(created.task.id)],
    ['storyboard', () => service.generateStoryboardStage(created.task.id)],
  ]) {
    assertBudget(1);
    const before = modelCalls(created.task.id).length;
    const started = Date.now();
    await execute();
    const after = modelCalls(created.task.id).length;
    const callsStarted = after - before;
    audit.total_model_calls_started += callsStarted;
    audit.conservative_reserved_rmb = audit.total_model_calls_started * reservePerTextCallRmb;
    entry.stages.push({ stage: name, status: 'passed', latency_ms: Date.now() - started, model_calls_started: callsStarted });
    persist(auditPath, audit);
  }
  const comparison = works.compareWithTask(created.task.id);
  if (!comparison.ok) throw Object.assign(new Error(`WORK_PARITY_FAILED:${comparison.issues.join(',')}`), { code: 'WORK_PARITY_FAILED' });
  works.promoteToAuthoritative(created.task.id);
  const evidence = validateTextEvidence(project, created.task.id);
  entry.status = evidence.ok ? 'passed' : 'failed';
  entry.finished_at = new Date().toISOString();
  entry.validation = evidence;
  entry.work_mode = storage.getWork(created.task.id)?.mode || '';
  if (!evidence.ok) throw Object.assign(new Error(`REAL_GOLDEN_TEXT_CONTRACT_FAILED:${evidence.issues.join(',')}`), { code: 'REAL_GOLDEN_TEXT_CONTRACT_FAILED' });
}

(async () => {
  const projects = contracts.readRegistry().projects.filter(project => !requestedProject || project.id === requestedProject);
  if (!projects.length) throw new Error(`GOLDEN_PROJECT_NOT_FOUND:${requestedProject}`);
  for (const project of projects) await runProject(project);
  audit.status = 'passed';
  audit.finished_at = new Date().toISOString();
  persist(auditPath, audit);
  console.log(JSON.stringify({
    passed: true,
    evidence_class: audit.evidence_class,
    projects: audit.projects.map(project => ({ project_id: project.project_id, task_id: project.task_id, counts: project.validation.counts })),
    total_model_calls_started: audit.total_model_calls_started,
    conservative_reserved_rmb: audit.conservative_reserved_rmb,
    authorized_limit_rmb: budgetRmb,
    actual_provider_charge_rmb: null,
    audit_path: auditPath,
  }));
})().catch(error => {
  audit.status = error.code === 'REAL_GOLDEN_BUDGET_EXHAUSTED' ? 'stopped_budget' : 'failed';
  audit.finished_at = new Date().toISOString();
  audit.error = { code: clean(error.code || 'ERROR'), message: clean(error.message || error).slice(0, 1000) };
  persist(auditPath, audit);
  console.error(JSON.stringify({ passed: false, ...audit.error, total_model_calls_started: audit.total_model_calls_started, conservative_reserved_rmb: audit.conservative_reserved_rmb, audit_path: auditPath }));
  process.exitCode = 1;
}).finally(() => fs.rmSync(temporaryOutput, { recursive: true, force: true }));
