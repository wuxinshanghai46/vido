'use strict';

const fs = require('fs');
const path = require('path');
const storage = require('../src/services/newStoryAd/storageService');
const recoveryService = require('../src/services/newStoryAd/historicalDomainRecoveryService');
const audioProduction = require('../src/services/newStoryAd/audioProductionService');

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : '';
}

const taskId = String(arg('task') || '').trim();
const historicalPath = path.resolve(arg('historical') || '');
const confirmAudio = process.argv.includes('--confirm-audio');
if (!taskId || !arg('historical')) {
  throw new Error('Usage: node scripts/recover-story-ad-historical-domains-v399.js --task <id> --historical <work.json> [--confirm-audio]');
}

const task = storage.getTask(taskId);
const currentWork = storage.getWork(taskId);
if (!task || !currentWork) throw new Error(`Task or work aggregate not found: ${taskId}`);
if (currentWork.mode !== 'authoritative') throw new Error(`Task ${taskId} is not on authoritative work mode`);
const historicalWork = JSON.parse(fs.readFileSync(historicalPath, 'utf8'));
const recovered = recoveryService.buildRecovery({ currentWork, historicalWork });
const revision = Number(task.content_revision || 1) || 1;
const callsBefore = storage.listModelCalls(taskId).length;
const visualKinds = [
  'keyframe_contracts', 'keyframes', 'keyframe_provider_audit', 'quality_review',
  'shot_reference_packs', 'video_clips', 'final_video', 'edit_timeline', 'media_runtime_context',
  'video_generation_authorization', 'video_cost_authorization',
];

storage.withWriteBatch(() => {
  storage.saveOutput(taskId, 'context', recovered.context, { content_revision: revision });
  storage.saveOutput(taskId, 'blueprint', recovered.blueprint, { content_revision: revision });
  storage.saveOutput(taskId, 'storyboard_table', recovered.storyboard_table, { content_revision: revision });
  storage.saveOutput(taskId, 'storyboard_meta', recovered.storyboard_meta, { content_revision: revision });
  storage.saveOutput(taskId, 'tts_audio', recovered.tts_audio, { content_revision: revision });
  storage.saveOutput(taskId, 'sound_journey', recovered.sound_journey, { content_revision: revision });
  storage.deleteOutputs(taskId, visualKinds);
  storage.deleteOutput(taskId, audioProduction.OUTPUT_KIND);
  storage.updateTask(taskId, recovered.task_patch);
  const nextWork = storage.getWork(taskId);
  storage.updateWork(taskId, {
    status: recovered.task_patch.status,
    stage: recovered.task_patch.stage,
    invalidated_domains: recovered.invalidated_domains,
    last_command_id: `historical_domain_recovery_v399:${taskId}:r${revision}`,
    last_command_at: new Date().toISOString(),
  }, { expected_version: nextWork.aggregate_version });
});

let approval = null;
if (confirmAudio) approval = audioProduction.confirm(taskId, { id: 'historical-confirmation-recovery-v399' }).approval;
const callsAfter = storage.listModelCalls(taskId).length;
if (callsAfter !== callsBefore) throw new Error(`Recovery unexpectedly changed model calls: ${callsBefore} -> ${callsAfter}`);

const finalWork = storage.getWork(taskId);
const finalAudio = audioProduction.current(taskId);
process.stdout.write(`${JSON.stringify({
  ok: true,
  task_id: taskId,
  content_revision: revision,
  diagnostics: recovered.diagnostics,
  invalidated_domains: finalWork.invalidated_domains,
  audio_approved: finalAudio.approved,
  audio_approval: approval,
  model_calls_before: callsBefore,
  model_calls_after: callsAfter,
}, null, 2)}\n`);
