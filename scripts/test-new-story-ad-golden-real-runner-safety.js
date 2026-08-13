#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const script = path.resolve(__dirname, 'run-new-story-ad-golden-real-text.js');
const source = fs.readFileSync(script, 'utf8');
const denied = spawnSync(process.execPath, [script, '--budget-rmb=10'], { encoding: 'utf8' });
assert.notStrictEqual(denied.status, 0);
assert.match(`${denied.stdout}${denied.stderr}`, /REAL_GOLDEN_PAID_CONFIRMATION_REQUIRED/);
const oversized = spawnSync(process.execPath, [script, '--confirm-paid', '--budget-rmb=10.01'], { encoding: 'utf8' });
assert.notStrictEqual(oversized.status, 0);
assert.match(`${oversized.stdout}${oversized.stderr}`, /REAL_GOLDEN_BUDGET_MUST_BE_BETWEEN_0_AND_10_RMB/);
assert.match(source, /NEW_STORY_AD_TEXT_MAX_CANDIDATES = '1'/);
assert.match(source, /actual_provider_charge_rmb: null/);
assert.match(source, /assertBudget\(1\)/);
assert.match(source, /gatewayCallsStarted \+ 1/);
assert.match(source, /modelGateway\.generateText = async/);
assert.match(source, /paidBudget\.ledgerSummary/);
assert.match(source, /paidBudget\.assertWithinBudget/);
assert.match(source, /paidBudget\.acquire/);
assert.doesNotMatch(source, /generateKeyframesStage|generateVideoStage|composeStage/);
const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-golden-budget-test-'));
try {
  const priorRoot = path.join(isolatedRoot, 'outputs', 'audits', 'golden-real-text', 'prior');
  fs.mkdirSync(priorRoot, { recursive: true });
  fs.writeFileSync(path.join(priorRoot, 'audit.json'), JSON.stringify({
    evidence_class: 'real_candidate_release_text_only',
    status: 'failed',
    run_model_calls_started: 10,
    run_reserved_rmb: 10,
  }), 'utf8');
  const exhausted = spawnSync(process.execPath, [script, '--confirm-paid', '--budget-rmb=10'], {
    cwd: isolatedRoot,
    encoding: 'utf8',
  });
  assert.notStrictEqual(exhausted.status, 0);
  assert.match(`${exhausted.stdout}${exhausted.stderr}`, /REAL_GOLDEN_GLOBAL_BUDGET_EXHAUSTED/);
  assert.strictEqual(fs.existsSync(path.join(isolatedRoot, 'outputs', 'settings.json')), false);

  const outsideAudit = path.join(os.tmpdir(), `vido-external-audit-${process.pid}`);
  const escaped = spawnSync(process.execPath, [script, '--confirm-paid', '--budget-rmb=10', `--audit-dir=${outsideAudit}`], {
    cwd: isolatedRoot,
    encoding: 'utf8',
  });
  assert.notStrictEqual(escaped.status, 0);
  assert.match(`${escaped.stdout}${escaped.stderr}`, /REAL_GOLDEN_AUDIT_DIR_MUST_STAY_IN_GLOBAL_LEDGER/);
  assert.strictEqual(fs.existsSync(outsideAudit), false);

  fs.writeFileSync(path.join(priorRoot, 'audit.json'), JSON.stringify({ evidence_class: 'real_candidate_release_text_only', run_reserved_rmb: 0 }), 'utf8');
  const lockPath = path.join(isolatedRoot, 'outputs', 'audits', '.golden-paid-run.lock');
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, acquired_at: 'test' }), 'utf8');
  const concurrent = spawnSync(process.execPath, [script, '--confirm-paid', '--budget-rmb=10'], { cwd: isolatedRoot, encoding: 'utf8' });
  assert.notStrictEqual(concurrent.status, 0);
  assert.match(`${concurrent.stdout}${concurrent.stderr}`, /REAL_GOLDEN_PAID_RUN_ALREADY_ACTIVE/);
} finally {
  fs.rmSync(isolatedRoot, { recursive: true, force: true });
}
console.log(JSON.stringify({ passed: true, explicit_paid_confirmation: true, hard_budget_cap_rmb: 10, cross_run_budget_ledger: true, concurrent_paid_run_lock: true, external_audit_bypass_blocked: true, one_candidate_per_text_stage: true, no_media_calls: true, unknown_actual_charge_not_fabricated: true }));
