'use strict';

const storage = require('./storageService');

const OUTPUT_KIND = 'edit_timeline';
const TRANSITIONS = new Set(['hard_cut', 'cut_on_action', 'match_cut', 'dissolve', 'fade']);
function list(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }
function clamp(value, fallback, min, max) { const number = Number(value); return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback; }

function defaults(taskId) {
  const shots = list(storage.getOutput(taskId, 'storyboard_table'));
  return shots.map((shot, index) => ({
    shot_index: index + 1,
    trim_start_sec: 0,
    trim_end_sec: 0,
    speed: 1,
    clip_volume: 1,
    muted: false,
    transition_type: TRANSITIONS.has(String(shot.transition_type || '')) ? String(shot.transition_type) : 'hard_cut',
    transition_duration_sec: clamp(shot.transition_duration_sec, 0.35, 0, 2),
  }));
}

function get(taskId) {
  const base = defaults(taskId);
  const existing = list(storage.getOutput(taskId, OUTPUT_KIND));
  const byIndex = new Map(existing.map(row => [Number(row.shot_index), row]));
  return base.map(row => ({ ...row, ...(byIndex.get(row.shot_index) || {}) }));
}

function save(taskId, input = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw Object.assign(new Error('项目不存在'), { code: 'TASK_NOT_FOUND', status: 404 });
  const base = defaults(taskId);
  const incoming = new Map(list(input.items || input.timeline).map(row => [Number(row.shot_index), row]));
  const items = base.map(row => {
    const patch = incoming.get(row.shot_index) || {};
    const transition = String(patch.transition_type || row.transition_type);
    return {
      shot_index: row.shot_index,
      trim_start_sec: clamp(patch.trim_start_sec, 0, 0, 120),
      trim_end_sec: clamp(patch.trim_end_sec, 0, 0, 120),
      speed: clamp(patch.speed, 1, 0.5, 2),
      clip_volume: clamp(patch.clip_volume, 1, 0, 1),
      muted: patch.muted === true,
      transition_type: TRANSITIONS.has(transition) ? transition : 'hard_cut',
      transition_duration_sec: clamp(patch.transition_duration_sec, 0.35, 0, 2),
    };
  });
  const clips = storage.getOutput(taskId, 'video_clips') || [];
  items.forEach((edit, index) => require('./audioTimelineIntegrityService').editedSpeech(clips[index], edit));
  storage.saveOutput(taskId, OUTPUT_KIND, items);
  // Publish a replacement only after rendering and audiovisual QA succeed.
  return items;
}

module.exports = { OUTPUT_KIND, TRANSITIONS, defaults, get, save };
