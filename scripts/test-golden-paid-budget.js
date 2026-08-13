#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const budget = require('./lib/goldenPaidBudget');

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-paid-budget-'));
try {
  const firstDir = path.join(cwd, 'outputs', 'audits', 'golden-real-text', 'first');
  const secondDir = path.join(cwd, 'outputs', 'audits', 'golden-real-image-readiness', 'second');
  fs.mkdirSync(firstDir, { recursive: true });
  fs.mkdirSync(secondDir, { recursive: true });
  fs.writeFileSync(path.join(firstDir, 'audit.json'), JSON.stringify({ evidence_class: 'real_candidate_release_text_only', run_reserved_rmb: 2, run_model_calls_started: 2 }), 'utf8');
  fs.writeFileSync(path.join(secondDir, 'audit.json'), JSON.stringify({ evidence_class: 'real_image_to_video_readiness_hybrid', run_reserved_rmb: 4, run_provider_submissions_started: 2 }), 'utf8');
  const summary = budget.ledgerSummary({ cwd });
  assert.strictEqual(summary.reserved_rmb, 6);
  assert.strictEqual(summary.submissions_started, 4);
  assert.throws(() => budget.assertWithinBudget({ authorizedLimitRmb: 10, priorReservedRmb: 6, nextReserveRmb: 6 }), /REAL_GOLDEN_GLOBAL_BUDGET_EXHAUSTED/);
  assert.strictEqual(budget.assertWithinBudget({ authorizedLimitRmb: 10, priorReservedRmb: 6, nextReserveRmb: 4 }), 10);

  const staleAudit = path.join(cwd, 'outputs', 'audits', 'stale', 'audit.json');
  fs.mkdirSync(path.dirname(staleAudit), { recursive: true });
  fs.writeFileSync(staleAudit, JSON.stringify({ evidence_class: 'real_candidate_release_text_only', status: 'running', run_reserved_rmb: 1 }), 'utf8');
  const lockPath = path.join(cwd, 'outputs', 'audits', '.golden-paid-run.lock');
  fs.writeFileSync(lockPath, JSON.stringify({ pid: 99999999, audit_path: staleAudit }), 'utf8');
  const lock = budget.acquire({ cwd, auditPath: path.join(cwd, 'next-audit.json') });
  assert.strictEqual(JSON.parse(fs.readFileSync(staleAudit, 'utf8')).status, 'aborted_ungraceful');
  lock.release();
  assert.strictEqual(fs.existsSync(lockPath), false);
  console.log(JSON.stringify({ passed: true, cross_stage_budget_ledger: true, stale_lock_recovery: true, conservative_reserve_preserved: true }));
} finally {
  fs.rmSync(cwd, { recursive: true, force: true });
}
