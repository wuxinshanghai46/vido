'use strict';

const storage = require('./storageService');
const ttsAdapter = require('./ttsAdapter');
const voicePlan = require('./voicePlanService');
const soundDesign = require('./soundDesignAssetService');

const OUTPUT_KIND = 'audio_production_approval';
const PLAN_KIND = 'audio_production_plan';
function list(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }
function clean(value = '', max = 180) { return String(value || '').trim().slice(0, max); }

function current(taskId) {
  const task = storage.getTask(taskId);
  if (!task) throw Object.assign(new Error('项目不存在'), { code: 'TASK_NOT_FOUND', status: 404 });
  const context = storage.getOutput(taskId, 'context') || task.request || {};
  const plan = storage.getOutput(taskId, PLAN_KIND) || {};
  const shots = list(storage.getOutput(taskId, 'storyboard_table'));
  const tts = storage.getOutput(taskId, 'tts_audio') || {};
  const voiceId = clean(plan.voice_id || context.voice_id || tts.voice_id);
  const assignments = voicePlan.resolveVoiceAssignments(plan, context, tts, voiceId);
  const speech = shots.map((shot, index) => ({
    shot_index: Number(shot.shot_index || shot.index || index + 1) || index + 1,
    mode: ttsAdapter.speechMode(shot),
    units: ttsAdapter.shotSpeechUnits(shot, voiceId, assignments),
  }));
  const speakers = [...new Set(speech.flatMap(row => row.units.map(unit => clean(unit.speaker, 100))).filter(Boolean))];
  const sound = soundDesign.compile(taskId);
  const signature = storage.canonicalFingerprint({
    storyboard: shots.map((shot, index) => ({
      shot_index: Number(shot.shot_index || shot.index || index + 1) || index + 1,
      speech_mode: ttsAdapter.speechMode(shot),
      speech_units: ttsAdapter.shotSpeechUnits(shot, voiceId, assignments),
      duration: shot.duration || shot.duration_sec || 0,
    })),
    include_voiceover: plan.include_voiceover === true,
    voice_id: voiceId,
    voice_assignments: assignments,
    tts_tracks: list(tts.tracks).map(track => ({ audio_url: track.audio_url || track.audioUrl || '', text: track.text || '', voice_signature: track.voice_signature || '' })),
    sound_timeline: sound.timeline,
    sound_assets: sound.assets.map(asset => ({ asset_id: asset.asset_id, file_sha256: asset.file_sha256, track_type: asset.track_type })),
    subtitle: plan.subtitle !== false,
    subtitle_style: plan.subtitle_style || context.subtitle_style || 'popup',
    voice_volume: plan.voice_volume ?? context.voice_volume ?? 1,
    bgm_volume: plan.bgm_volume ?? context.bgm_volume ?? 0.16,
  });
  const approval = storage.getOutput(taskId, OUTPUT_KIND) || {};
  return {
    context,
    plan,
    shots,
    tts,
    sound,
    speech,
    speakers,
    voice_id: voiceId,
    voice_assignments: assignments,
    include_voiceover: plan.include_voiceover === true,
    signature,
    approval,
    approved: approval.signature === signature && approval.confirmed === true,
  };
}

function savePlan(taskId, input = {}) {
  const state = current(taskId);
  const speakerAssignments = {};
  Object.entries(input.voice_assignments?.speakers || input.voiceAssignments?.speakers || {}).slice(0, 30).forEach(([speaker, id]) => {
    const name = clean(speaker, 100); const voice = clean(id, 120);
    if (name && voice) speakerAssignments[name] = voice;
  });
  const narrator = clean(input.voice_assignments?.narrator || input.voiceAssignments?.narrator || input.voice_id || input.voiceId || state.voice_id, 120);
  const includeVoiceover = input.include_voiceover === true || input.includeVoiceover === true;
  const nextPlan = {
    schema_version: 1,
    include_voiceover: includeVoiceover,
    voice_id: narrator,
    voice_assignments: { narrator, speakers: speakerAssignments },
    tts_speed: Math.max(0.5, Math.min(2, Number(input.tts_speed ?? input.speed ?? state.plan.tts_speed ?? state.context.tts_speed ?? 1) || 1)),
    voice_volume: Math.max(0.6, Math.min(1.2, Number(input.voice_volume ?? state.plan.voice_volume ?? state.context.voice_volume ?? 1) || 1)),
    bgm_volume: Math.max(0, Math.min(0.35, Number(input.bgm_volume ?? state.plan.bgm_volume ?? state.context.bgm_volume ?? 0.16) || 0)),
    subtitle: input.subtitle !== false,
    subtitle_style: clean(input.subtitle_style || state.plan.subtitle_style || state.context.subtitle_style || 'popup', 40),
    updated_at: new Date().toISOString(),
  };
  storage.saveOutput(taskId, PLAN_KIND, nextPlan);
  storage.deleteOutput(taskId, OUTPUT_KIND);
  storage.deleteOutput(taskId, 'final_video');
  return current(taskId);
}

function applyPlan(taskId, context = {}) {
  const plan = storage.getOutput(taskId, PLAN_KIND) || {};
  return { ...context, ...plan };
}

function confirm(taskId, actor = {}) {
  const state = current(taskId);
  const speechUnits = state.speech.flatMap(row => row.units);
  if (state.include_voiceover && speechUnits.length) {
    if (!state.voice_id && !Object.keys(state.voice_assignments.speakers || {}).length) {
      throw Object.assign(new Error('存在旁白或对白，请先选择可用音色并生成试听。'), { code: 'AUDIO_VOICE_REQUIRED', status: 422 });
    }
    if (!ttsAdapter.voiceoverReady(state.tts, state.shots, state.voice_id, state.voice_assignments)) {
      throw Object.assign(new Error('旁白或多人对白尚未全部生成，不能确认声音方案。'), { code: 'AUDIO_TTS_PREVIEW_REQUIRED', status: 422 });
    }
  }
  const approval = {
    confirmed: true,
    signature: state.signature,
    confirmed_at: new Date().toISOString(),
    confirmed_by: clean(actor.id || actor.email || actor.name || 'project_user', 160),
    voiceover_track_count: list(state.tts.tracks).length,
    sound_track_count: state.sound.timeline.length,
    bgm_track_count: state.sound.timeline.filter(row => row.track_type === 'bgm').length,
  };
  storage.saveOutput(taskId, OUTPUT_KIND, approval);
  return { ...state, approval, approved: true };
}

function assertApproved(taskId) {
  const state = current(taskId);
  if (state.approved) return state;
  throw Object.assign(new Error('请先试听并确认旁白/对白、场景音效和背景音乐；声音发生变化后需要重新确认。'), {
    code: 'AUDIO_PRODUCTION_APPROVAL_REQUIRED', status: 409, retryable: false,
  });
}

module.exports = { OUTPUT_KIND, PLAN_KIND, current, savePlan, confirm, assertApproved, applyPlan };
