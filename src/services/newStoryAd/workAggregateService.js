'use strict';

const storage = require('./storageService');
const identities = require('./permanentIdentityService');
const dependencyService = require('./revisionDependencyService');

const DOMAIN_KEYS = Object.freeze([
  'brief', 'subjects', 'scenes', 'blueprint', 'storyboard', 'audio', 'video', 'compose',
]);

const DEPENDENCIES = dependencyService.DEFAULT_DEPENDENCIES;

function clean(value = '') { return String(value ?? '').trim(); }
function now() { return new Date().toISOString(); }
function zeroRevisions() { return Object.fromEntries(DOMAIN_KEYS.map(key => [key, 0])); }

function domainPayloads(task = {}, outputs = []) {
  const byKind = Object.fromEntries((Array.isArray(outputs) ? outputs : []).map(row => [String(row.kind || ''), row.payload]));
  const context = byKind.context || task.request || {};
  return {
    brief: {
      brief: clean(context.brief || task.brief),
      brief_source: clean(context.brief_source || 'user') || 'user',
      content_mode: clean(context.content_mode),
      target_duration: Number(context.target_duration || 0) || 0,
      output_ratio: clean(context.output_ratio),
      context,
    },
    subjects: {
      people: context.cast_profiles || context.people || [],
      pets: context.pet_profiles || context.pets || [],
      product: context.product_contract || context.product_subject || null,
      props: byKind.prop_assets || context.prop_assets || [],
      person_contract: byKind.person_contract || null,
      subject_assets: byKind.subject_assets || null,
      product_asset: byKind.product_asset || null,
    },
    scenes: {
      plan: byKind.scene_config || context.scene_plan || null,
      assets: byKind.scene_assets || context.scene_assets || [],
    },
    blueprint: byKind.blueprint || null,
    storyboard: byKind.storyboard_table || [],
    audio: {
      tts_audio: byKind.tts_audio || null,
      sound_journey: byKind.sound_journey || null,
    },
    video: byKind.video_clips || [],
    compose: byKind.final_video || null,
  };
}

function payloadFingerprint(payload) {
  return storage.canonicalFingerprint(payload ?? null);
}

function initialRevisions(payloads = {}) {
  const revisions = zeroRevisions();
  DOMAIN_KEYS.forEach(key => {
    const value = payloads[key];
    const present = Array.isArray(value) ? value.length > 0 : Boolean(value && (typeof value !== 'object' || Object.values(value).some(item => item !== null && item !== undefined && (!Array.isArray(item) || item.length))));
    revisions[key] = present ? 1 : 0;
  });
  return revisions;
}

function buildShadowWork(task = {}, outputs = []) {
  const payloads = domainPayloads(task, outputs);
  const subjectInput = [
    ...(Array.isArray(payloads.subjects.people) ? payloads.subjects.people : []),
    ...(Array.isArray(payloads.subjects.pets) ? payloads.subjects.pets : []),
    ...(payloads.subjects.product ? [payloads.subjects.product] : []),
  ];
  const stableSubjects = identities.reconcile(task.id, 'subject', subjectInput, []);
  const stableScenes = identities.reconcile(task.id, 'scene', payloads.scenes.assets || [], []);
  const fingerprints = Object.fromEntries(DOMAIN_KEYS.map(key => [key, payloadFingerprint(payloads[key])]));
  return {
    id: String(task.id || ''),
    task_id: String(task.id || ''),
    schema_version: 1,
    mode: 'shadow',
    aggregate_version: 1,
    source_task_revision: Math.max(1, Number(task.content_revision || 1) || 1),
    owner_id: clean(task.user_id || task.request?.user_id),
    title: clean(task.title),
    status: clean(task.status || 'draft') || 'draft',
    stage: clean(task.stage || 'draft') || 'draft',
    domain_revisions: initialRevisions(payloads),
    domain_fingerprints: fingerprints,
    domain_payloads: payloads,
    dependency_graph: DEPENDENCIES,
    identity_projection: {
      subjects: stableSubjects.items,
      scenes: stableScenes.items,
      duplicate_subject_keys: stableSubjects.duplicate_semantic_keys,
      duplicate_scene_keys: stableScenes.duplicate_semantic_keys,
    },
    invalidated_domains: [],
    authority: {
      brief: clean(payloads.brief?.brief_source || 'user') || 'user',
      subjects: 'work',
      scenes: 'work',
      blueprint: 'work',
      storyboard: 'work',
    },
    last_command_id: 'shadow_create',
    last_command_at: now(),
  };
}

function ensureShadowWork(taskId) {
  const existing = storage.getWork(taskId);
  if (existing) return existing;
  const task = storage.getTask(taskId);
  if (!task) throw new Error('任务不存在');
  const work = storage.createWork(buildShadowWork(task, storage.listOutputs(taskId)));
  storage.appendWorkEvent(taskId, {
    aggregate_version: work.aggregate_version,
    command_id: 'shadow_create',
    type: 'work.shadow_created',
    changed_domains: DOMAIN_KEYS.filter(key => Number(work.domain_revisions?.[key] || 0) > 0),
    source_task_revision: work.source_task_revision,
    occurred_at: now(),
  });
  return work;
}

function normalizeDomains(domains = []) {
  return [...new Set((Array.isArray(domains) ? domains : [domains])
    .map(clean).filter(value => DOMAIN_KEYS.includes(value)))];
}

function syncFromTask(taskId, { domains = DOMAIN_KEYS, commandId = '', expectedVersion } = {}) {
  let work = ensureShadowWork(taskId);
  const normalizedDomains = normalizeDomains(domains);
  if (!normalizedDomains.length) return work;
  if (commandId && work.last_command_id === commandId) return work;
  if (expectedVersion !== undefined && Number(expectedVersion) !== Number(work.aggregate_version || 0)) {
    return storage.updateWork(taskId, {}, { expected_version: expectedVersion });
  }
  const task = storage.getTask(taskId);
  const payloads = domainPayloads(task, storage.listOutputs(taskId));
  const nextPayloads = { ...(work.domain_payloads || {}) };
  const nextFingerprints = { ...(work.domain_fingerprints || {}) };
  const nextRevisions = { ...zeroRevisions(), ...(work.domain_revisions || {}) };
  const actuallyChanged = [];
  normalizedDomains.forEach(domain => {
    const fingerprint = payloadFingerprint(payloads[domain]);
    if (nextFingerprints[domain] === fingerprint) return;
    nextPayloads[domain] = payloads[domain];
    nextFingerprints[domain] = fingerprint;
    nextRevisions[domain] = Number(nextRevisions[domain] || 0) + 1;
    actuallyChanged.push(domain);
  });
  if (!actuallyChanged.length) return work;
  const impact = dependencyService.affectedDomains(actuallyChanged, work.dependency_graph || DEPENDENCIES);
  const currentProjection = work.identity_projection || {};
  const nextProjection = { ...currentProjection };
  if (actuallyChanged.includes('subjects')) {
    const subjectInput = [
      ...(Array.isArray(payloads.subjects.people) ? payloads.subjects.people : []),
      ...(Array.isArray(payloads.subjects.pets) ? payloads.subjects.pets : []),
      ...(payloads.subjects.product ? [payloads.subjects.product] : []),
    ];
    const result = identities.reconcile(taskId, 'subject', subjectInput, currentProjection.subjects || []);
    nextProjection.subjects = result.items;
    nextProjection.duplicate_subject_keys = result.duplicate_semantic_keys;
  }
  if (actuallyChanged.includes('scenes')) {
    const result = identities.reconcile(taskId, 'scene', payloads.scenes.assets || [], currentProjection.scenes || []);
    nextProjection.scenes = result.items;
    nextProjection.duplicate_scene_keys = result.duplicate_semantic_keys;
  }
  const aggregateVersion = Number(work.aggregate_version || 0) + 1;
  const next = storage.updateWork(taskId, {
    aggregate_version: aggregateVersion,
    source_task_revision: Math.max(1, Number(task.content_revision || 1) || 1),
    title: clean(task.title),
    status: clean(task.status),
    stage: clean(task.stage),
    domain_revisions: nextRevisions,
    domain_fingerprints: nextFingerprints,
    domain_payloads: nextPayloads,
    identity_projection: nextProjection,
    invalidated_domains: impact.invalidated,
    last_command_id: clean(commandId || `shadow_sync_v${aggregateVersion}`),
    last_command_at: now(),
  }, { expected_version: work.aggregate_version });
  storage.appendWorkEvent(taskId, {
    aggregate_version: aggregateVersion,
    command_id: next.last_command_id,
    type: 'work.shadow_synced',
    changed_domains: actuallyChanged,
    invalidated_domains: impact.invalidated,
    domain_revisions: Object.fromEntries(actuallyChanged.map(domain => [domain, nextRevisions[domain]])),
    source_task_revision: next.source_task_revision,
    occurred_at: now(),
  });
  return next;
}

function compareWithTask(taskId) {
  const work = storage.getWork(taskId);
  const task = storage.getTask(taskId);
  if (!work || !task) return { comparable: false, issues: ['work_or_task_missing'] };
  const payloads = domainPayloads(task, storage.listOutputs(taskId));
  const issues = DOMAIN_KEYS.filter(domain => payloadFingerprint(payloads[domain]) !== work.domain_fingerprints?.[domain])
    .map(domain => `domain_mismatch:${domain}`);
  if (Number(work.source_task_revision || 0) !== Number(task.content_revision || 1)) issues.push('source_task_revision_mismatch');
  return { comparable: true, ok: issues.length === 0, work_id: work.id, aggregate_version: work.aggregate_version, issues };
}

function syncShadowSafely(taskId, options = {}) {
  try {
    return { ok: true, work: syncFromTask(taskId, options), error: null };
  } catch (error) {
    const task = storage.getTask(taskId);
    storage.saveStage(taskId, 'work_shadow_sync', {
      status: 'failed',
      output_summary: 'Work 影子聚合同步失败；旧权威保存结果保持有效，尚未切换新读取。',
      error: String(error.message || error),
      diagnostics: {
        error_code: String(error.code || 'WORK_SHADOW_SYNC_FAILED'),
        source_task_revision: Number(task?.content_revision || 0),
        model_calls_started: 0,
      },
    }, { systemFinalization: true });
    return { ok: false, work: storage.getWork(taskId), error };
  }
}

const OUTPUT_DOMAIN_MAP = Object.freeze({
  context: ['brief', 'context'],
  person_contract: ['subjects', 'person_contract'],
  subject_assets: ['subjects', 'subject_assets'],
  prop_assets: ['subjects', 'props'],
  product_asset: ['subjects', 'product_asset'],
  scene_config: ['scenes', 'plan'],
  scene_assets: ['scenes', 'assets'],
  blueprint: ['blueprint', 'value'],
  storyboard_table: ['storyboard', 'value'],
  tts_audio: ['audio', 'tts_audio'],
  sound_journey: ['audio', 'sound_journey'],
  video_clips: ['video', 'value'],
  final_video: ['compose', 'value'],
});

function outputDomain(kind = '') { return OUTPUT_DOMAIN_MAP[String(kind || '')] || null; }

function outputFromWork(work = {}, kind = '') {
  const mapping = outputDomain(kind);
  if (!mapping) return undefined;
  const [domain, field] = mapping;
  const payload = work.domain_payloads?.[domain];
  if (field === 'value') return payload;
  return payload?.[field];
}

function authoritativeOutput(taskId, kind = '') {
  const work = storage.getWork(taskId);
  if (!work || work.mode !== 'authoritative') return { authoritative: false, value: undefined };
  const mapping = outputDomain(kind);
  if (!mapping) return { authoritative: false, value: undefined };
  return { authoritative: true, value: outputFromWork(work, kind) ?? null };
}

function writeAuthoritativeOutput(taskId, kind, payload, { commandId = '' } = {}) {
  const work = storage.getWork(taskId);
  if (!work || work.mode !== 'authoritative') return null;
  const mapping = outputDomain(kind);
  if (!mapping) return work;
  const [domain, field] = mapping;
  const currentDomain = work.domain_payloads?.[domain];
  const nextDomain = field === 'value'
    ? payload
    : { ...(currentDomain && typeof currentDomain === 'object' ? currentDomain : {}), [field]: payload };
  const fingerprint = payloadFingerprint(nextDomain);
  if (work.domain_fingerprints?.[domain] === fingerprint) return work;
  const impact = dependencyService.affectedDomains([domain], work.dependency_graph || DEPENDENCIES);
  const aggregateVersion = Number(work.aggregate_version || 0) + 1;
  const nextRevisions = { ...zeroRevisions(), ...(work.domain_revisions || {}), [domain]: Number(work.domain_revisions?.[domain] || 0) + 1 };
  const next = storage.updateWork(taskId, {
    aggregate_version: aggregateVersion,
    domain_payloads: { ...(work.domain_payloads || {}), [domain]: nextDomain },
    domain_fingerprints: { ...(work.domain_fingerprints || {}), [domain]: fingerprint },
    domain_revisions: nextRevisions,
    invalidated_domains: impact.invalidated,
    last_command_id: clean(commandId || `authoritative:${kind}:${fingerprint.slice(0, 20)}`),
    last_command_at: now(),
  }, { expected_version: work.aggregate_version });
  storage.appendWorkEvent(taskId, {
    aggregate_version: aggregateVersion,
    command_id: next.last_command_id,
    type: 'work.authoritative_output_written',
    output_kind: String(kind),
    changed_domains: [domain],
    invalidated_domains: impact.invalidated,
    domain_revisions: { [domain]: nextRevisions[domain] },
    occurred_at: now(),
  });
  return next;
}

function promoteToAuthoritative(taskId) {
  const comparison = compareWithTask(taskId);
  if (!comparison.comparable || !comparison.ok) {
    const error = new Error(`Work 与旧输出尚未一致，禁止切换权威读取：${comparison.issues.join(', ')}`);
    error.code = 'WORK_AUTHORITY_PARITY_REQUIRED';
    error.status = 409;
    error.retryable = false;
    error.issues = comparison.issues;
    throw error;
  }
  const work = storage.getWork(taskId);
  if (work.mode === 'authoritative') return work;
  const aggregateVersion = Number(work.aggregate_version || 0) + 1;
  const next = storage.updateWork(taskId, {
    mode: 'authoritative',
    aggregate_version: aggregateVersion,
    authority_promoted_at: now(),
    last_command_id: `authority_promoted:v${aggregateVersion}`,
    last_command_at: now(),
  }, { expected_version: work.aggregate_version });
  storage.appendWorkEvent(taskId, {
    aggregate_version: aggregateVersion,
    command_id: next.last_command_id,
    type: 'work.authority_promoted',
    changed_domains: [],
    occurred_at: now(),
  });
  return next;
}

module.exports = {
  DEPENDENCIES,
  DOMAIN_KEYS,
  buildShadowWork,
  compareWithTask,
  domainPayloads,
  ensureShadowWork,
  normalizeDomains,
  payloadFingerprint,
  syncFromTask,
  syncShadowSafely,
  OUTPUT_DOMAIN_MAP,
  outputDomain,
  outputFromWork,
  authoritativeOutput,
  writeAuthoritativeOutput,
  promoteToAuthoritative,
};
