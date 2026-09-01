'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const storage = require('./storageService');
const audioProduction = require('./audioProductionService');
const soundDesign = require('./soundDesignAssetService');
const mediaAdapter = require('./mediaAdapter');
const ttsAdapter = require('./ttsAdapter');

function list(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }
function clamp(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Math.max(minimum, Math.min(maximum, Number.isFinite(number) ? number : fallback));
}
function audioPath(track = {}) {
  if (track.file_path && fs.existsSync(track.file_path)) return track.file_path;
  const filename = String(track.filename || track.audio_url || track.audioUrl || '').split('/').pop()?.split('?')[0] || '';
  const resolved = filename ? ttsAdapter.audioPathFromName(decodeURIComponent(filename)) : '';
  return resolved && fs.existsSync(resolved) ? resolved : '';
}
function trackMap(tracks = []) {
  const map = new Map();
  list(tracks).forEach((track, position) => {
    const shotId = String(track.shot_id || '').trim();
    const shotIndex = Number(track.index || track.shot_index || position + 1);
    if (shotId) map.set(`id:${shotId}`, track);
    map.set(`index:${shotIndex}`, track);
  });
  return map;
}
function trackFor(map, shot = {}, fallbackIndex = 1) {
  const shotId = String(shot.shot_id || shot.id || '').trim();
  const shotIndex = Number(shot.shot_index || shot.index || fallbackIndex);
  return (shotId ? map.get(`id:${shotId}`) : null) || map.get(`index:${shotIndex}`);
}
function describe(taskId) {
  const state = audioProduction.current(taskId);
  const bgm = soundDesign.resolvedBgm(taskId);
  const byShot = trackMap(state.tts.tracks);
  const spoken = state.speech.filter(row => list(row.units).length);
  const ready = spoken.filter((row, index) => audioPath(trackFor(byShot, row, index + 1))).length;
  return {
    bgm_selected: !!bgm,
    bgm_name: bgm?.name || '',
    bgm_url: bgm?.file_url || '',
    spoken_shot_count: spoken.length,
    ready_voice_track_count: ready,
    ready: !!bgm && spoken.length > 0 && ready === spoken.length,
  };
}
function execFfmpeg(args = []) {
  if (!ffmpegPath) return Promise.reject(Object.assign(new Error('当前服务器缺少音频混合组件'), { code: 'AUDIO_PREVIEW_FFMPEG_UNAVAILABLE', status: 503 }));
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); if (stderr.length > 16000) stderr = stderr.slice(-16000); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(stderr.split(/\r?\n/).filter(Boolean).slice(-5).join(' | ') || `ffmpeg exited ${code}`)));
  });
}
async function create(taskId, input = {}) {
  const state = audioProduction.current(taskId);
  const summary = describe(taskId);
  if (!summary.bgm_selected) throw Object.assign(new Error('请先选择一首背景音乐，再试听整体效果。'), { code: 'AUDIO_PREVIEW_BGM_REQUIRED', status: 422 });
  if (!summary.spoken_shot_count || summary.ready_voice_track_count !== summary.spoken_shot_count) {
    throw Object.assign(new Error(`请先生成全部配音对白（当前 ${summary.ready_voice_track_count}/${summary.spoken_shot_count} 段）。`), { code: 'AUDIO_PREVIEW_VOICE_REQUIRED', status: 422 });
  }
  const bgm = soundDesign.resolvedBgm(taskId);
  const voiceVolume = clamp(input.voice_volume ?? input.voiceVolume ?? state.plan.voice_volume, 1, 0.6, 1.5);
  const bgmVolume = clamp(input.bgm_volume ?? input.bgmVolume ?? state.plan.bgm_volume, 0.16, 0, 1);
  const byShot = trackMap(state.tts.tracks);
  let cursor = 0;
  const placements = [];
  state.shots.forEach((shot, index) => {
    const shotIndex = Number(shot.shot_index || shot.index || index + 1) || index + 1;
    const track = trackFor(byShot, shot, shotIndex);
    const filePath = audioPath(track);
    if (filePath) placements.push({ file_path: filePath, start_sec: cursor, duration_sec: Math.max(0.1, Number(shot.duration || shot.duration_sec || track.duration_sec || 3) || 3) });
    cursor += Math.max(0.1, Number(shot.duration || shot.duration_sec || 3) || 3);
  });
  const duration = Math.max(0.2, cursor);
  const signature = storage.canonicalFingerprint({
    task_id: taskId,
    duration_sec: duration,
    placements: placements.map(item => {
      const stat = fs.statSync(item.file_path);
      return { filename: path.basename(item.file_path), bytes: stat.size, modified_ms: Math.round(stat.mtimeMs), start_sec: item.start_sec, duration_sec: item.duration_sec };
    }),
    contract: 'story_ad_live_voice_stem_v2',
  });
  const filename = `story_ad_voice_preview_${String(taskId).replace(/[^a-z0-9_-]/gi, '_').slice(0, 80)}_${signature.slice(0, 18)}.mp3`;
  const outputPath = mediaAdapter.assetPathFromName(filename);
  const response = {
    ...summary,
    audio_url: `/api/new-story-ad/assets/${encodeURIComponent(filename)}`,
    voice_audio_url: `/api/new-story-ad/assets/${encodeURIComponent(filename)}`,
    bgm_audio_url: bgm.file_url,
    duration_sec: duration,
    voice_volume: voiceVolume,
    bgm_volume: bgmVolume,
    live_mix: true,
  };
  if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) return { ...response, cached: true };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const args = ['-y', '-f', 'lavfi', '-t', duration.toFixed(3), '-i', 'anullsrc=r=48000:cl=stereo'];
  placements.forEach(item => args.push('-i', item.file_path));
  const filters = [];
  placements.forEach((item, index) => {
    const delay = Math.max(0, Math.round(item.start_sec * 1000));
    filters.push(`[${index + 1}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:${item.duration_sec.toFixed(3)},asetpts=PTS-STARTPTS,adelay=${delay}|${delay}[voice${index}]`);
  });
  const inputs = ['[0:a]', ...placements.map((_, index) => `[voice${index}]`)].join('');
  filters.push(`${inputs}amix=inputs=${placements.length + 1}:duration=first:dropout_transition=0:normalize=0,atrim=0:${duration.toFixed(3)}[voice_stem]`);
  const temporaryPath = `${outputPath}.${process.pid}.tmp.mp3`;
  try {
    await execFfmpeg([...args, '-filter_complex', filters.join(';'), '-map', '[voice_stem]', '-c:a', 'libmp3lame', '-b:a', '192k', '-t', duration.toFixed(3), temporaryPath]);
    if (!fs.existsSync(temporaryPath) || fs.statSync(temporaryPath).size < 1000) throw new Error('整体试听音频为空');
    fs.renameSync(temporaryPath, outputPath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
  }
  return { ...response, cached: false };
}

module.exports = { create, describe };
