'use strict';

const crypto = require('crypto');
const storageDefault = require('./storageService');
const assetPlanDefault = require('./assetPlanService');
const publicationDefault = require('./assetPlanPublicationService');
const subjectAssetsDefault = require('./subjectAssetBundleService');
const taskStateAuditDefault = require('./taskStateAuditService');
const authorityProofDefault = require('./subjectProfileAuthorityProofService');

function text(value = '') { return String(value ?? '').trim(); }
function rows(value) { return Array.isArray(value) ? value : []; }

function checkpointUnits(checkpoint = {}) {
  return Object.values(checkpoint.person_dossier_checkpoints || {})
    .filter(unit => String(unit?.lifecycle_state || '') !== 'obsolete');
}

function recoveryCounts(checkpoint = {}) {
  const units = checkpointUnits(checkpoint);
  return {
    total: units.length,
    retained: units.filter(unit => unit?.status === 'completed').length,
    missing: units.filter(unit => unit?.status !== 'completed').length,
  };
}

function latestPartialCheckpoint(storage, taskId = '') {
  return storage.listOutputs(taskId)
    .filter(row => String(row?.kind || '').startsWith('subject_asset_checkpoint:'))
    .filter(row => ['running', 'partial', 'failed'].includes(String(row?.payload?.status || '')))
    .sort((left, right) => Date.parse(right.updated_at || right.payload?.updated_at || '') - Date.parse(left.updated_at || left.payload?.updated_at || ''))[0]?.payload || null;
}

function safeSummary(storage, value) {
  const serialized = JSON.stringify(value ?? null);
  return { length: serialized.length, fingerprint: storage.canonicalFingerprint(value ?? null).slice(0, 12) };
}

function generationInputs(body = {}, subjectAssets = subjectAssetsDefault) {
  const spec = body.person_spec && typeof body.person_spec === 'object' ? body.person_spec : {};
  const counts = subjectAssets.resolveCounts(spec, body);
  const humans = subjectAssets.humanMemberSpecs(spec, body, counts.people);
  const pets = subjectAssets.petMemberSpecs(spec, body, counts.pets);
  const targets = subjectAssets.requestedSubjectTargets(body, humans, pets);
  return { counts, humans, pets, targets };
}

function sealedAuthoritySnapshot(storage, taskId, revision, activeCast, subjectAssets, preferred = null) {
  const candidates = [preferred, ...rows(typeof storage.readDb === 'function' ? storage.readDb()?.snapshots : [])]
    .filter((row, index, all) => row && all.findIndex(item => item?.id === row.id) === index)
    .filter(row => String(row.task_id || '') === String(taskId)
      && Number(row.content_revision || 0) === Number(revision || 0)
      && String(row.status || '') === 'sealed');
  return candidates.find(row => {
    const cast = rows(row.payload?.cast_profiles);
    return cast.length === activeCast.length && cast.every((profile, index) => (
      subjectAssets.personProfileResumeCompatible(activeCast[index], profile)
    ));
  }) || null;
}

function candidateContext(task, context, activeFingerprint, assetPlan, storage) {
  const cast = rows(context.cast_profiles);
  const base = { ...context, asset_plan_generated_cast_fingerprint: storage.canonicalFingerprint(cast) };
  const current = Math.max(0, Number(context.revisions?.person_semantic ?? context.revisions?.person ?? 0) || 0);
  for (let revision = current; revision >= 0; revision -= 1) {
    const candidate = { ...base, revisions: { ...(base.revisions || {}), person_semantic: revision } };
    if (activeFingerprint && assetPlan.fingerprint(task, candidate) === activeFingerprint) return candidate;
  }
  return null;
}

function createService(deps = {}) {
  const storage = deps.storage || storageDefault;
  const assetPlan = deps.assetPlan || assetPlanDefault;
  const publication = deps.publication || publicationDefault;
  const subjectAssets = deps.subjectAssets || subjectAssetsDefault;
  const taskStateAudit = deps.taskStateAudit || taskStateAuditDefault;
  const authorityProof = deps.authorityProof || authorityProofDefault;

  function preview(taskId = '', body = {}) {
    const task = storage.getTask(taskId);
    if (!task) { const error = new Error('任务不存在'); error.code = 'TASK_NOT_FOUND'; error.status = 404; throw error; }
    const context = storage.getOutput(taskId, 'context') || task.request || {};
    const active = publication.activeRecord(taskId);
    const activeFingerprint = text(active?.plan?.fingerprint || active?.fingerprint);
    const inputs = generationInputs({
      ...body, brief: context.brief || body.brief,
      cast_profiles: rows(context.cast_profiles), pet_profiles: rows(context.pet_profiles),
    }, subjectAssets);
    const latestCheckpoint = latestPartialCheckpoint(storage, taskId);
    const checkpoint = subjectAssets.resumablePartialCheckpoint(
      storage, taskId, inputs.counts, inputs.targets, inputs.humans, inputs.pets,
    );
    const activeCast = rows(active?.plan?.cast_profiles);
    const currentCast = rows(context.cast_profiles);
    const manifest = typeof storage.getManifest === 'function' ? storage.getManifest(taskId) : null;
    const activeArtifact = typeof storage.getArtifact === 'function'
      ? storage.getArtifact(manifest?.artifacts?.[publication.ACTIVE_KIND || 'asset_plan_active']) : null;
    const preferredSnapshot = activeArtifact?.snapshot_id && typeof storage.getSnapshot === 'function'
      ? storage.getSnapshot(activeArtifact.snapshot_id) : null;
    const sealedSnapshot = sealedAuthoritySnapshot(storage, taskId, task.content_revision, activeCast, subjectAssets, preferredSnapshot);
    const sealedCast = rows(sealedSnapshot?.payload?.cast_profiles);
    const checkpointCast = rows((checkpoint || latestCheckpoint)?.input_profiles?.humans);
    const completionOutput = storage.listOutputs(taskId).filter(row => String(row?.kind || '').startsWith('generation_spec_completion:person:'))
      .sort((left, right) => Date.parse(right.updated_at || '') - Date.parse(left.updated_at || ''))[0]?.payload;
    const authority = authorityProof.prove({ active: activeCast, sealed: sealedCast, checkpoint: checkpointCast,
      current: currentCast, completion: rows(completionOutput?.cast_profiles), contentRevision: task.content_revision,
      sealedRevision: sealedSnapshot?.content_revision, activeSnapshotId: activeArtifact?.snapshot_id,
      sealedSnapshotId: sealedSnapshot?.id, subjectAssets });
    const activeCastCompatible = activeCast.length === currentCast.length && activeCast.every((profile, index) => (
      subjectAssets.personProfileResumeCompatible(profile, currentCast[index])
    ));
    const counts = recoveryCounts(checkpoint || {});
    const currentFingerprint = assetPlan.fingerprint(task, context);
    const currentEligibility = publication.eligibility(taskId, { fingerprint: currentFingerprint });
    const repairedContext = checkpoint && activeCastCompatible && !currentEligibility.eligible
      ? candidateContext(task, context, activeFingerprint, assetPlan, storage)
      : null;
    const repairedFingerprint = repairedContext ? assetPlan.fingerprint(task, repairedContext) : '';
    const repairedEligibility = repairedContext
      ? publication.eligibility(taskId, { fingerprint: repairedFingerprint }) : currentEligibility;
    const risk = taskStateAudit.billingRiskForTask(storage.readDb(), taskId);
    const reviewPending = checkpointUnits(checkpoint || {}).some(unit => unit?.status !== 'completed'
      && String(unit?.billing_review?.state || '').toLowerCase() === 'pending');
    const unsafeBilling = risk.active_unknown_billing.length || reviewPending
      || risk.unquarantined_unknown_billing.some(item => item.source !== 'generation_checkpoint');
    const activeGeneration = text(task.active_generation_id);
    const differences = [];
    const publicField = field => ({ accessories: '配饰', footwear: '鞋履', garments: '服装', wardrobeText: '服装设定', hairMakeupText: '发型与妆容', negativeText: '禁止项', subject_targets: '人物与顺序' }[String(field || '').split('.').pop()] || '人物设定');
    if (!checkpoint && latestCheckpoint) {
      rows(latestCheckpoint.input_profiles?.humans).forEach((profile, index) => {
        const current = inputs.humans[index];
        if (!current) return differences.push({ subject_id: text(profile.id), display_name: text(profile.displayName || profile.name), field: 'person', field_path: 'person', reason_code: 'person_removed', before: safeSummary(storage, profile), after: safeSummary(storage, null), action: 'review_required', message: '人物已从当前内容移除' });
        const report = typeof subjectAssets.personProfileResumeCompatibility === 'function'
          ? subjectAssets.personProfileResumeCompatibility(profile, current) : null;
        if (report && !report.compatible) differences.push(...report.differences.map(item => ({ ...item, scope: 'person', relation: item.reason_code, message: `${item.display_name || '人物'}的${publicField(item.field_path)}已变化` })));
      });
      const priorTargets = rows(latestCheckpoint.targets).map(({ kind, id, index, key }) => ({ kind, id, index, key }));
      const nextTargets = rows(inputs.targets.selected).map(({ kind, id, index, key }) => ({ kind, id, index, key }));
      if (JSON.stringify(priorTargets) !== JSON.stringify(nextTargets)) differences.push({ scope: 'targets', relation: 'target_contract_changed', field: 'subject_targets', field_path: 'subject_targets', reason_code: 'target_contract_changed', before: safeSummary(storage, priorTargets), after: safeSummary(storage, nextTargets), action: 'review_required', message: '待生成人物或顺序已变化' });
    }
    if (!checkpoint && !differences.length) differences.push({ scope: 'checkpoint', relation: 'positive_changed', field: 'checkpoint', field_path: 'checkpoint', reason_code: 'checkpoint_incompatible', before: safeSummary(storage, latestCheckpoint), after: safeSummary(storage, inputs), action: 'review_required', message: '现有图片与当前人物设定不能安全复用' });
    if (!activeCastCompatible && !authority.compatible) differences.push({ scope: 'authority', relation: 'positive_changed', field: 'cast_profiles', field_path: 'cast_profiles', reason_code: authority.reason || 'active_cast_changed', before: safeSummary(storage, activeCast), after: safeSummary(storage, currentCast), action: 'review_required', message: '当前人物内容与已确认依据存在差异' });
    if (unsafeBilling) differences.push({ scope: 'billing', relation: 'review_required', field: 'billing_review', field_path: 'billing_review', reason_code: 'billing_review_required', before: safeSummary(storage, 'unknown'), after: safeSummary(storage, 'review_required'), action: 'wait_for_review', message: '计费核对尚未完成' });
    if (activeGeneration) differences.push({ scope: 'generation', relation: 'active', field: 'active_generation_id', field_path: 'active_generation_id', reason_code: 'active_generation_exists', before: safeSummary(storage, activeGeneration), after: safeSummary(storage, 'wait'), action: 'wait_for_generation', message: '当前已有生成任务正在处理' });
    const authorityCompatible = activeCastCompatible || authority.compatible;
    const planRebase = Boolean(checkpoint && !unsafeBilling && !activeGeneration && !currentEligibility.eligible && authority.compatible);
    if (!currentEligibility.eligible && !repairedContext && !planRebase) differences.push({ scope: 'lineage', relation: 'unproven', field: 'input_fingerprint', field_path: 'input_fingerprint', reason_code: 'lineage_unproven', before: safeSummary(storage, currentFingerprint), after: safeSummary(storage, activeFingerprint), action: 'review_required', message: '当前内容与已确认生成依据不一致' });
    const ready = Boolean(checkpoint && authorityCompatible && !unsafeBilling && !activeGeneration && currentEligibility.eligible);
    const rebase = Boolean(checkpoint && !unsafeBilling && !ready && ((repairedContext && repairedEligibility.eligible) || planRebase));
    const state = ready ? 'ready' : (rebase ? 'safe_rebase_available' : 'blocked');
    const proofPayload = {
      task_id: taskId, content_revision: Number(task.content_revision || 1), state,
      context: storage.canonicalFingerprint(context), checkpoint: storage.canonicalFingerprint(checkpoint || {}),
      active_fingerprint: activeFingerprint, active_revision: Number(active?.active_revision || 0),
      sealed_snapshot_id: text(sealedSnapshot?.id), authority: authority.reason || '', repaired_fingerprint: repairedFingerprint,
    };
    return {
      state, safe_to_continue: ready, checkpoint_compatible: Boolean(checkpoint),
      plan_eligible: currentEligibility.eligible, missing_count: counts.missing,
      retained_count: counts.retained, total_count: counts.total,
      required_action: ready ? 'none' : (rebase ? 'apply_zero_model_rebase' : 'user_review'),
      proof_token: storage.canonicalFingerprint(proofPayload), differences,
      model_call_count: 0, repaired_context: repairedContext, plan_rebase: planRebase,
      authority_proof: { compatible: authority.compatible, reason: authority.reason, contract_version: authority.contract_version || 1 },
    };
  }

  function apply(taskId = '', body = {}, expectedProofToken = '') {
    const before = preview(taskId, body);
    if (before.proof_token !== text(expectedProofToken)) {
      const error = new Error('安全检查结果已变化，请重新检查'); error.code = 'SUBJECT_RECOVERY_PREFLIGHT_STALE'; error.status = 409; throw error;
    }
    if (before.state === 'ready') return { ...before, applied: false };
    if (before.state !== 'safe_rebase_available' || (!before.repaired_context && !before.plan_rebase)) {
      const error = new Error('当前人物内容存在真实差异，不能自动继续生成'); error.code = 'SUBJECT_RECOVERY_PREFLIGHT_BLOCKED'; error.status = 409; error.details = before; throw error;
    }
    const task = storage.getTask(taskId), context = storage.getOutput(taskId, 'context') || task.request || {};
    const backupKind = `subject_recovery_preflight_backup:${crypto.createHash('sha256').update(before.proof_token).digest('hex').slice(0, 16)}`;
    storage.withWriteBatch(() => {
      if (preview(taskId, body).proof_token !== before.proof_token) {
        const error = new Error('安全检查结果已变化，请重新检查'); error.code = 'SUBJECT_RECOVERY_PREFLIGHT_STALE'; error.status = 409; throw error;
      }
      if (!storage.getOutput(taskId, backupKind)) storage.saveOutput(taskId, backupKind, {
        schema_version: 1, context, proof_token: before.proof_token, created_at: new Date().toISOString(),
      });
      if (before.repaired_context) {
        storage.saveOutput(taskId, 'context', before.repaired_context);
        storage.updateTask(taskId, { request: {
          ...(task.request || {}), revisions: before.repaired_context.revisions,
          asset_plan_generated_cast_fingerprint: before.repaired_context.asset_plan_generated_cast_fingerprint,
        }, updated_at: new Date().toISOString() }, { systemFinalization: true });
      } else {
        const active = publication.activeRecord(taskId);
        publication.publish(taskId, { ...(active?.plan || {}), cast_profiles: rows(context.cast_profiles) }, {
          fingerprint: assetPlan.fingerprint(task, context), source: 'subject_recovery_three_way_authority_rebase',
          model_meta: { model_call_count: 0, authority_contract_version: 1 }, scope: 'person',
        });
      }
      const repaired = preview(taskId, body);
      if (repaired.state !== 'ready') {
        const error = new Error('安全处理后生成许可仍未就绪'); error.code = 'SUBJECT_RECOVERY_PREFLIGHT_REBASE_FAILED'; error.status = 409; throw error;
      }
    });
    const after = preview(taskId, body);
    return { ...after, applied: true, backup_kind: backupKind, model_call_count: 0 };
  }

  return { apply, preview };
}

module.exports = { checkpointUnits, createService, generationInputs, latestPartialCheckpoint, recoveryCounts };
