const storage = require('./storageService');
const authorization = require('./visualAssetBillingAuthorizationService');
const reviewStates = require('./visualAssetBillingReviewStateService');

function findUnit(taskId, reviewKey) {
  return authorization.ambiguousUnits(taskId).find(unit => unit.review_key === String(reviewKey || '')) || null;
}

function preview({ taskId = '', reviewKey = '', state = '', evidence = '', reviewer = '', expectedRevision = 0 } = {}) {
  const unit = findUnit(taskId, reviewKey);
  if (!unit) {
    const error = new Error('指定核账单元不存在或已完成。');
    error.code = 'VISUAL_ASSET_BILLING_REVIEW_MISMATCH'; error.status = 404; throw error;
  }
  const resolved = reviewStates.resolve(unit.checkpoint, {
    state, evidence, reviewer, expected_revision: expectedRevision,
  });
  return {
    task_id: taskId, review_key: unit.review_key, kind: unit.kind,
    before: reviewStates.publicState(unit.checkpoint), after: reviewStates.publicState(resolved),
    resolved_checkpoint: resolved, unit,
  };
}

function apply(input = {}, options = {}) {
  if (options.apply !== true) return { applied: false, dry_run: true, ...preview(input), resolved_checkpoint: undefined, unit: undefined };
  const plan = preview(input);
  storage.withWriteBatch(() => {
    if (plan.unit.kind === 'subject') {
      storage.saveOutput(input.taskId, plan.unit.row.kind, {
        ...plan.unit.row.payload,
        person_dossier_checkpoints: {
          ...(plan.unit.row.payload?.person_dossier_checkpoints || {}),
          [plan.unit.key]: plan.resolved_checkpoint,
        },
        updated_at: new Date().toISOString(),
      });
    } else {
      storage.saveOutput(input.taskId, plan.unit.row.kind, {
        ...plan.unit.row.payload,
        views: { ...(plan.unit.row.payload?.views || {}), [plan.unit.key]: plan.resolved_checkpoint },
        updated_at: new Date().toISOString(),
      });
    }
  });
  if ([reviewStates.STATES.NOT_BILLED, reviewStates.STATES.COMPLETED].includes(plan.after.state)) {
    authorization.reconcileNestedOrchestrator(input.taskId, []);
  }
  return { applied: true, dry_run: false, task_id: input.taskId, review_key: input.reviewKey, before: plan.before, after: plan.after };
}

module.exports = { apply, findUnit, preview };
