'use strict';

const storage = require('./storageService');
const narrativeOrder = require('./storyboardNarrativeOrderService');
const ttsAdapter = require('./ttsAdapter');

const RECOVERY_KIND = 'storyboard_narrative_order_recovery_v376';
const ALIGNED_OUTPUTS = ['storyboard_images', 'storyboard_sketches', 'keyframe_contracts', 'keyframes', 'sound_journey'];
function list(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }

function inspect(taskId) {
  const task = storage.getTask(taskId);
  const storyboard = storage.getOutput(taskId, 'storyboard_table');
  const blueprint = storage.getOutput(taskId, 'blueprint') || {};
  const coveragePlan = storage.getOutput(taskId, 'storyboard_coverage_plan') || {};
  const canonical = narrativeOrder.canonicalize(storyboard, { blueprint, coveragePlan });
  const hasCommittedVideo = list(storage.getOutput(taskId, 'video_clips')).length > 0 || Boolean(storage.getOutput(taskId, 'final_video'));
  return {
    task,
    storyboard: list(storyboard),
    canonical,
    eligible: Boolean(task && !task.active_generation_id && canonical.changed && !hasCommittedVideo),
    blocked_reason: hasCommittedVideo ? 'downstream_video_exists' : '',
  };
}

function recoverTask(taskId) {
  const state = inspect(taskId);
  if (!state.eligible) return { recovered: false, task_id: taskId, blocked_reason: state.blocked_reason };
  const { shots, permutation } = state.canonical;
  const recoveredAt = new Date().toISOString();
  const oldOrder = state.storyboard.map(narrativeOrder.shotIdentity);
  const newOrder = shots.map(narrativeOrder.shotIdentity);
  storage.saveOutput(taskId, RECOVERY_KIND, {
    migration_id: RECOVERY_KIND,
    recovered_at: recoveredAt,
    old_order: oldOrder,
    new_order: newOrder,
    permutation: permutation.map(index => index + 1),
    model_calls: 0,
    paid_calls: 0,
  });
  storage.saveOutput(taskId, 'storyboard_table', shots);
  ALIGNED_OUTPUTS.forEach(kind => {
    const current = storage.getOutput(taskId, kind);
    if (Array.isArray(current) && current.length === permutation.length) {
      storage.saveOutput(taskId, kind, narrativeOrder.reorderAligned(current, permutation, shots));
    }
  });
  const tts = storage.getOutput(taskId, 'tts_audio') || {};
  if (Array.isArray(tts.tracks) && tts.tracks.length === permutation.length) {
    const tracks = narrativeOrder.reorderAligned(tts.tracks, permutation, shots).map((track, index) => ({
      ...track,
      shot_id: shots[index]?.shot_id || shots[index]?.id || '',
    }));
    const aligned = tracks.every((track, index) => String(track.text || '').replace(/\s+/g, ' ').trim() === ttsAdapter.shotSpeechText(shots[index]));
    if (aligned) storage.saveOutput(taskId, 'tts_audio', { ...tts, tracks, narrative_order_recovered_at: recoveredAt });
    else storage.deleteOutput(taskId, 'tts_audio');
  } else if (Array.isArray(tts.tracks) && tts.tracks.length) storage.deleteOutput(taskId, 'tts_audio');
  const meta = storage.getOutput(taskId, 'storyboard_meta') || {};
  storage.saveOutput(taskId, 'storyboard_meta', { ...meta, narrative_order_recovered_at: recoveredAt });
  storage.deleteOutput(taskId, 'audio_production_approval');
  storage.deleteOutput(taskId, 'audio_mix_preview');
  return { recovered: true, task_id: taskId, recovered_at: recoveredAt, old_order: oldOrder, new_order: newOrder, model_calls: 0, paid_calls: 0 };
}

function recoverAll() {
  const tasks = storage.listTasks({ limit: 5000 });
  const results = tasks.map(task => recoverTask(task.id));
  return {
    scanned: tasks.length,
    recovered: results.filter(item => item.recovered).length,
    blocked: results.filter(item => item.blocked_reason).length,
    model_calls: 0,
    paid_calls: 0,
  };
}

module.exports = { RECOVERY_KIND, ALIGNED_OUTPUTS, inspect, recoverTask, recoverAll };
