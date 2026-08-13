#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-golden-no-fee-'));
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';

const contracts = require('../src/services/newStoryAd/goldenProjectContractService');
const contextBuilder = require('../src/services/newStoryAd/contextBuilder');
const identities = require('../src/services/newStoryAd/permanentIdentityService');
const storage = require('../src/services/newStoryAd/storageService');
const works = require('../src/services/newStoryAd/workAggregateService');

function sourceSubjects(project) {
  return [
    ...(project.request.characters || []).map(item => ({ ...item, subject_type: 'person' })),
    ...(project.request.pet_profiles || []).map(item => ({ ...item, subject_type: 'animal' })),
    ...(project.request.product_subject ? [{ name: project.request.product_subject, role: 'advertised_product', subject_type: 'product' }] : []),
  ];
}

function planThreeRevisions(project, taskId) {
  let subjects = identities.reconcile(taskId, 'subject', sourceSubjects(project), []).items;
  let scenes = identities.reconcile(taskId, 'scene', [
    { name: `${project.label}-开端空间`, type: 'opening', location: '空间一' },
    { name: `${project.label}-证据空间`, type: 'proof', location: '空间二' },
    { name: `${project.label}-结果空间`, type: 'resolution', location: '空间三' },
  ], []).items;
  const snapshots = [{ subjects, scenes, assets: scenes.map(scene => ({ id: `asset:${scene.permanent_id}`, reused: true })) }];
  for (let cycle = 1; cycle <= project.expected.replan_cycles; cycle += 1) {
    const subjectInput = [...subjects].reverse().map(({ permanent_id, identity_revision, identity_content_fingerprint, source_position, ...item }) => ({ ...item, revision_note: `cycle-${cycle}` }));
    const sceneInput = [...scenes].reverse().map(({ permanent_id, identity_revision, identity_content_fingerprint, source_position, ...item }) => ({ ...item, revision_note: `cycle-${cycle}` }));
    subjects = identities.reconcile(taskId, 'subject', subjectInput, subjects).items;
    scenes = identities.reconcile(taskId, 'scene', sceneInput, scenes).items;
    snapshots.push({
      subjects,
      scenes,
      assets: scenes.map(scene => ({ id: `asset:${scene.permanent_id}`, reused: true })),
    });
  }
  return { subjects, scenes, snapshots };
}

function runProject(project) {
  const taskId = `no-fee:${project.id}`;
  const context = contextBuilder.buildContext(project.request);
  context.capability_pack = contracts.validateDefinition(project).pack;
  const planned = planThreeRevisions(project, taskId);
  const storyboard = planned.scenes.map((scene, index) => ({
    id: `${taskId}:shot:${index + 1}`,
    permanent_id: identities.permanentId(taskId, 'shot', `shot:${index + 1}`),
    scene_permanent_id: scene.permanent_id,
    title: `${project.label}镜头${index + 1}`,
    visual: `${project.request.brief}；本镜头属于${scene.name}`,
    duration_sec: Math.max(1, Number(project.request.target_duration || 15) / planned.scenes.length),
  }));

  storage.createTask({
    id: taskId, title: project.label, brief: project.request.brief, user_id: 'golden-contract',
    status: 'draft', stage: 'planning', content_revision: 1, lineage_enforced: true, request: project.request,
  });
  storage.saveOutput(taskId, 'context', context);
  storage.saveOutput(taskId, 'scene_config', { scenes: planned.scenes });
  storage.saveOutput(taskId, 'blueprint', { title: project.label, synopsis: project.request.brief, required_facts: project.expected.required_facts });
  storage.saveOutput(taskId, 'storyboard_table', storyboard);
  storage.saveOutput(taskId, 'keyframes', storyboard.map((shot, index) => ({
    id: `${taskId}:frame:${index + 1}`, shot_permanent_id: shot.permanent_id,
    image_url: `/golden-no-fee/${project.id}/frame-${index + 1}.png`, qa: { pass: true, source: 'deterministic_fixture' },
  })));
  storage.saveOutput(taskId, 'tts_audio', { audio_url: `/golden-no-fee/${project.id}/voice.mp3`, qa: { pass: true } });
  storage.saveOutput(taskId, 'video_clips', storyboard.map((shot, index) => ({
    id: `${taskId}:clip:${index + 1}`, shot_index: index, shot_permanent_id: shot.permanent_id,
    video_url: `/golden-no-fee/${project.id}/clip-${index + 1}.mp4`, qa: { pass: true, source: 'deterministic_fixture' },
  })));
  storage.saveOutput(taskId, 'final_video', {
    video_url: `/golden-no-fee/${project.id}/final.mp4`, technical_qa: { pass: true, source: 'deterministic_fixture' },
  });
  storage.createGenerationRun({
    id: `${taskId}:generation`, task_id: taskId, work_id: taskId, state: 'succeeded', unit_version: 1,
    automatic_retry_allowed: false, model_calls_started: 0, provider_cost: 0, evidence: 'deterministic_no_fee_fixture',
  });
  storage.saveOutput(taskId, 'golden_acceptance_evidence', {
    replan_snapshots: planned.snapshots,
    ui_assertions: project.expected.ui_assertions,
    media_assertions: project.expected.media_assertions,
    model_calls_started: 0,
    evidence_class: 'deterministic_no_fee_contract',
  });
  const comparison = works.compareWithTask(taskId);
  assert.strictEqual(comparison.ok, true, JSON.stringify(comparison));
  works.promoteToAuthoritative(taskId);
  storage.updateTask(taskId, { status: 'done', stage: 'completed' }, { systemFinalization: true });

  const report = contracts.validateResult(project, contracts.bundleFromStorage(storage, taskId));
  assert.strictEqual(report.ok, true, JSON.stringify(report));
  assert.strictEqual(storage.listGenerationRuns({ task_id: taskId }).reduce((sum, run) => sum + Number(run.model_calls_started || 0), 0), 0);
  assert.strictEqual(storage.getWork(taskId).mode, 'authoritative');
  assert.strictEqual(planned.snapshots.length, 4);
  return { project_id: project.id, task_id: taskId, shots: report.counts.storyboard, replans: 3, model_calls_started: 0 };
}

try {
  const results = contracts.readRegistry().projects.map(runProject);
  console.log(JSON.stringify({ passed: true, evidence_class: 'deterministic_no_fee_contract', projects: results, total_model_calls_started: 0 }));
} finally {
  fs.rmSync(outputDir, { recursive: true, force: true });
}
