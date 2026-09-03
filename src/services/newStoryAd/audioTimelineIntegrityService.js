'use strict';

const fail = message => Object.assign(new Error(message), { code: 'AUDIO_TIMELINE_INTEGRITY_FAILED', status: 422, retryable: false });

function editedSpeech(clip = {}, edit = {}) {
  clip = clip || {};
  const utterances = clip.native_audio_qa?.utterances || [];
  if (!utterances.length) return [];
  const duration = Number(clip.native_audio_qa.observed_duration_sec || clip.duration_sec);
  const start = Number(edit.trim_start_sec || 0), end = duration - Number(edit.trim_end_sec || 0), speed = Number(edit.speed || 1);
  if (![duration, start, end, speed].every(Number.isFinite) || speed <= 0) throw fail('对白剪辑时间无效。');
  if (clip.native_audio_qa.lip_sync?.verified && Math.abs(clip.native_audio_qa.lip_sync.max_offset_ms) / speed > 120) throw fail('当前变速会放大口型与声音偏移，请调整播放速度。');
  if (edit.muted || Number(edit.clip_volume ?? 1) <= 0) throw fail('包含剧情台词的镜头不能直接静音；请通过声音修改替换。');
  return utterances.map(row => {
    if (start > row.start_sec || end < row.end_sec + 0.35) throw fail('裁剪会切掉台词或句尾，请保留完整语音。');
    return { ...row, start_sec: (row.start_sec - start) / speed, end_sec: (row.end_sec - start) / speed };
  });
}

function assertTransitionSpeech(clips, edits, plan, durations) {
  const rows = clips.map((clip, index) => editedSpeech(clip, edits.find(row => Number(row.shot_index) === index + 1) || {}));
  for (let index = 1; index < clips.length; index++) {
    const overlap = Math.max(Number(plan[index]?.overlap_sec || 0), Number(plan[index]?.audio_overlap_sec || 0));
    if (rows[index - 1].some(row => row.end_sec + 0.1 > durations[index - 1] - overlap) || rows[index].some(row => row.start_sec < overlap)) {
      throw fail('转场会覆盖正在说话的人物或重叠台词，请缩短转场或改用硬切。');
    }
  }
}

function assertReplacementFits(actual, available) {
  if (!Number.isFinite(actual) || actual <= 0 || actual > available - 0.35) throw fail('新配音无法在当前镜头内完整说完，未覆盖已有成片。');
}

module.exports = { editedSpeech, assertTransitionSpeech, assertReplacementFits };
