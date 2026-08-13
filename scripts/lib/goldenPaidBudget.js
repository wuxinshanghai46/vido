'use strict';

const fs = require('fs');
const path = require('path');

function auditRoot(cwd = process.cwd()) {
  return path.resolve(cwd, 'outputs', 'audits');
}

function walkAuditFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walkAuditFiles(target) : (entry.name === 'audit.json' ? [target] : []);
  });
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function atomicJson(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, file);
}

function ownReserve(audit = {}) {
  const value = Number(audit.run_reserved_rmb ?? audit.budget?.run_reserved_rmb
    ?? audit.conservative_reserved_rmb ?? audit.budget?.conservative_reserved_rmb ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function ownSubmissions(audit = {}) {
  const value = Number(audit.run_provider_submissions_started ?? audit.run_model_calls_started
    ?? audit.total_model_calls_started ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function ledgerSummary({ cwd = process.cwd(), excludeAuditPath = '' } = {}) {
  const excluded = excludeAuditPath ? path.resolve(excludeAuditPath) : '';
  const entries = walkAuditFiles(auditRoot(cwd))
    .filter(file => path.resolve(file) !== excluded)
    .map(file => ({ file, audit: readJson(file) }))
    .filter(entry => entry.audit)
    .filter(entry => /^real_candidate_release_|^real_image_to_video_readiness/.test(String(entry.audit.evidence_class || '')));
  return {
    entries,
    reserved_rmb: entries.reduce((sum, entry) => sum + ownReserve(entry.audit), 0),
    submissions_started: entries.reduce((sum, entry) => sum + ownSubmissions(entry.audit), 0),
  };
}

function pidAlive(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return false;
  try { process.kill(value, 0); return true; } catch { return false; }
}

function reconcileStaleLock(lock = {}) {
  const auditPath = String(lock.audit_path || '').trim();
  if (!auditPath || !fs.existsSync(auditPath)) return;
  const audit = readJson(auditPath);
  if (!audit || audit.status !== 'running') return;
  audit.status = 'aborted_ungraceful';
  audit.finished_at = new Date().toISOString();
  audit.error = {
    code: 'PAID_RUN_PROCESS_DISAPPEARED',
    message: '付费执行进程非正常退出；所有已登记提交继续按保守预留计入全局预算，未自动重试。',
  };
  atomicJson(auditPath, audit);
}

function acquire({ cwd = process.cwd(), auditPath = '' } = {}) {
  const root = auditRoot(cwd);
  fs.mkdirSync(root, { recursive: true });
  const lockPath = path.join(root, '.golden-paid-run.lock');
  if (fs.existsSync(lockPath)) {
    const existing = readJson(lockPath) || {};
    if (pidAlive(existing.pid)) {
      const error = new Error('REAL_GOLDEN_PAID_RUN_ALREADY_ACTIVE');
      error.code = 'REAL_GOLDEN_PAID_RUN_ALREADY_ACTIVE';
      throw error;
    }
    reconcileStaleLock(existing);
    fs.unlinkSync(lockPath);
  }
  const handle = fs.openSync(lockPath, 'wx');
  fs.writeFileSync(handle, `${JSON.stringify({ pid: process.pid, acquired_at: new Date().toISOString(), audit_path: path.resolve(auditPath) })}\n`, 'utf8');
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try { fs.closeSync(handle); } catch {}
    try {
      const current = readJson(lockPath);
      if (!current || Number(current.pid) === process.pid) fs.unlinkSync(lockPath);
    } catch {}
  };
  process.once('exit', release);
  return { lockPath, release };
}

function assertWithinBudget({ authorizedLimitRmb = 0, priorReservedRmb = 0, runReservedRmb = 0, nextReserveRmb = 0 } = {}) {
  const projected = Number(priorReservedRmb) + Number(runReservedRmb) + Number(nextReserveRmb);
  if (projected > Number(authorizedLimitRmb) + 1e-9) {
    const error = new Error('REAL_GOLDEN_GLOBAL_BUDGET_EXHAUSTED');
    error.code = 'REAL_GOLDEN_GLOBAL_BUDGET_EXHAUSTED';
    throw error;
  }
  return projected;
}

module.exports = { acquire, assertWithinBudget, atomicJson, auditRoot, ledgerSummary, ownReserve, walkAuditFiles };
