import { escapeHtml } from '../components/ui.js?v=20260902-production-v382';
import { renderCheckpointRecoveryBanner } from './billingRecoveryBanner.js?v=20260902-production-v382';

export function checkpointRecoverySummary(people = []) {
  const rows = people.filter(item => item.checkpoint_recovery_summary);
  const sum = key => rows.reduce((value, item) => value + Number(item.checkpoint_recovery_summary[key] || 0), 0);
  const missing = rows.flatMap(item => (item.checkpoint_recovery_summary.missing_units || []).map(unit => ({ ...unit, person_name: item.name || '人物' })));
  const unitState = unit => unit.billing_review_state || (unit.retry_blocked ? 'pending' : 'not_billed');
  const state = missing.some(unit => unitState(unit) === 'pending') ? 'pending'
    : (missing.some(unit => unitState(unit) === 'unverifiable') ? 'unverifiable'
      : (missing.some(unit => unitState(unit) === 'not_billed') ? 'not_billed' : 'completed'));
  return { completed: sum('completed_units'), total: sum('total_units'), missing, billing_review_state: state, retry_blocked: missing.some(unit => unit.retry_blocked) };
}

export function checkpointRecoveryBanner(summary = {}) {
  return renderCheckpointRecoveryBanner(summary, escapeHtml);
}
