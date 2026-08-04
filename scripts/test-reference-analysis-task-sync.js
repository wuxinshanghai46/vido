#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-reference-task-sync-'));
process.env.OUTPUT_DIR = tempRoot;
process.env.DB_ENABLED = '0';
process.env.DB_READ_PRIMARY = '0';
process.env.DB_DUAL_WRITE = '0';
process.env.DB_JSON_FALLBACK = '1';

const storage = require('../src/services/newStoryAd/storageService');
const storyAd = require('../src/services/newStoryAd');
const referenceVideoAnalyses = require('../src/services/newStoryAd/referenceVideoAnalysisService');
const taskSync = require('../src/services/newStoryAd/referenceAnalysisTaskSyncService');
const productAssetResolver = require('../src/services/newStoryAd/productAssetResolverService');
const bundles = require('../src/services/storyAdWorkspace/projectBundleService');

const user = { id: 'reference-task-sync-owner', role: 'user' };
const taskId = `task-${'t'.repeat(75)}`.slice(0, 80);
const analysisId = `ref-${'a'.repeat(76)}`.slice(0, 80);
const genericProduct = [...productAssetResolver.GENERIC_SUBJECTS][0];
const startedAt = '2026-08-03T08:54:10.561Z';
const completedAt = '2026-08-03T08:58:42.833Z';

function completedRecord() {
  return {
    id: analysisId,
    user_id: user.id,
    task_id: taskId,
    status: 'completed',
    progress: 100,
    phase: 'analysis completed',
    created_at: '2026-08-03T08:34:42.000Z',
    started_at: startedAt,
    updated_at: completedAt,
    completed_at: completedAt,
    source: { original_name: 'reference.mp4', metadata: { duration_seconds: 30 } },
    result: {
      schema_version: 3,
      generated_brief: 'Complete evidence-grounded advertising objective from the reference video.',
      summary: 'Short summary that must not replace the complete objective.',
      source_facts: {
        product_or_service: 'Custom furniture set',
        environment: 'Interior showroom',
        human_presence: false,
        animal_presence: false,
      },
      analysis_quality: { valid: true },
      story_outline: { logline: 'One-line logline.' },
      plot_beats: [{ order: 1, purpose: 'show product' }],
      reference_understanding: {
        contract_version: 'reference-understanding-v6',
        completeness: { valid: true },
        story_summary: { full_synopsis: 'Complete story understanding.' },
      },
      character_prompts: [],
      animal_prompts: [],
      scene_prompts: [{
        id: 'showroom',
        location_type: 'showroom',
        layout_prompt: 'Furniture is arranged in a stable showroom layout.',
        material_light_prompt: 'Wood surfaces under soft window light.',
        interaction_prompt: 'The camera reveals the furniture set in place.',
        negative_prompt: 'Do not change doors, windows, or furniture positions.',
      }],
      shot_breakdown: [{ order: 1, visual: 'furniture in showroom' }],
      camera_intents: [{ range: [0, 3], movement: 'static' }],
      character_actions: [],
      animal_actions: [],
    },
  };
}

async function main() {
  storyAd.createTask({
    task_id: taskId,
    project_name: 'Reference sync regression',
    brief: '',
    product_subject: genericProduct,
  }, user);
  storyAd.updateTaskRequest(taskId, {
    reference_video_analysis: {
      analysis_id: analysisId,
      status: 'running',
      progress: 14,
      phase: 'detecting shots',
      started_at: startedAt,
      updated_at: startedAt,
    },
  }, user);

  const record = completedRecord();
  const recordDir = path.join(referenceVideoAnalyses.ROOT_DIR, user.id, analysisId);
  fs.mkdirSync(recordDir, { recursive: true });
  fs.writeFileSync(path.join(recordDir, 'record.json'), JSON.stringify(record, null, 2), 'utf8');

  const beforeRead = storage.getOutput(taskId, 'context');
  assert.equal(beforeRead.reference_video_analysis.status, 'running');
  assert.equal(beforeRead.brief, '');

  const firstBundle = bundles.buildProjectBundle(taskId, { sections: 'summary,reference', user });
  assert.equal(firstBundle.reference.status, 'completed', 'first project read must use the authoritative terminal status');
  assert.equal(firstBundle.reference.progress, 100, 'first project read must not replay stale progress');
  assert.equal(firstBundle.reference.analysis_valid, true);
  assert.equal(firstBundle.brief.text, record.result.generated_brief, 'first project read must project the completed objective immediately');
  assert.equal(firstBundle.brief.product_subject, record.result.source_facts.product_or_service);
  assert.equal(
    Date.parse(firstBundle.reference.completed_at) - Date.parse(firstBundle.reference.started_at),
    272272,
    'terminal elapsed time must be frozen at completion instead of growing after re-entry',
  );
  assert.equal(storage.getOutput(taskId, 'context').reference_video_analysis.status, 'running', 'bundle reconciliation must remain read-only');

  const reference = referenceVideoAnalyses.taskRecord(record);
  const revisionBefore = storage.getTask(taskId).content_revision;
  const results = await Promise.all(Array.from({ length: 12 }, () => taskSync.syncTerminalAnalysis(record, reference)));
  assert.equal(results.every(result => result.model_call_count === 0), true);
  assert.equal(taskSync.activeSyncs.size, 0, 'concurrent synchronization lock must be released');

  const context = storage.getOutput(taskId, 'context');
  assert.equal(context.reference_video_analysis.status, 'completed');
  assert.equal(context.reference_video_analysis.progress, 100);
  assert.equal(context.reference_video_analysis.reference_understanding.completeness.valid, true, 'V6 understanding must survive the task transport');
  assert.equal(context.brief, record.result.generated_brief, 'full generated brief must be persisted');
  assert.equal(context.brief_source, 'reference_analysis');
  assert.equal(context.product_subject, record.result.source_facts.product_or_service, 'generic subject must be replaced by recognized evidence');
  assert.ok(context.reference_analysis_projection?.fingerprint, 'zero-model asset/story projection must be persisted');
  assert.ok(storage.getTask(taskId).content_revision <= revisionBefore + 1, 'concurrent terminal reads must not create repeated content revisions');
  assert.equal((storyAd.publicTaskBundle(taskId, { diagnostics: true }).model_calls || []).length, 0, 'repair path must not call any model');

  const storeSource = fs.readFileSync(path.join(__dirname, '../public/story-ad/store/projectStore.js'), 'utf8');
  assert.match(storeSource, /reference_understanding:\s*result\.reference_understanding\s*\|\|\s*analysis\.reference_understanding/, 'browser transport must include V6 reference_understanding');
  const stopIndex = storeSource.indexOf('if (terminal) stopReferencePolling();');
  const bindIndex = storeSource.indexOf('if (terminal || analysis.status !== previousStatus) await bindReferenceAnalysis(analysis);');
  assert.ok(stopIndex >= 0 && bindIndex > stopIndex, 'terminal polling must stop before the projection write');

  console.log(JSON.stringify({
    passed: true,
    checks: 24,
    concurrent_sync_requests: results.length,
    model_calls: 0,
    elapsed_ms: 272272,
  }));
}

main().finally(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}).catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
