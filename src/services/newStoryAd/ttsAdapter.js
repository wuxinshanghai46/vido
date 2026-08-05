const fs = require('fs');
const path = require('path');
const ttsService = require('../ttsService');
const cancellation = require('./cancellationContext');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, '../../../outputs'));
const AUDIO_DIR = path.join(OUTPUT_DIR, 'new-story-ad-audio');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeBase(value = 'new_story_ad_audio') {
  return String(value || 'new_story_ad_audio').replace(/[^a-z0-9_-]/ig, '_').slice(0, 96) || 'new_story_ad_audio';
}

function publicAudioUrl(filename = '') {
  return `/api/new-story-ad/audio/${encodeURIComponent(path.basename(filename))}`;
}

function audioPathFromName(filename = '') {
  const safe = path.basename(String(filename || '').split('?')[0]);
  if (!safe) return '';
  return path.join(AUDIO_DIR, safe);
}

function clamp(num, min, max, fallback) {
  const n = Number(num);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeSpeechSegment(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function speechSegmentKey(value = '') {
  return normalizeSpeechSegment(value)
    .replace(/^(?:旁白|解说|画外音|配音|台词|对白|字幕|屏幕字幕)\s*[:：]\s*/i, '')
    .toLowerCase()
    .replace(/[\s，。！？,.!?、；;：:"'“”‘’…·—-]+/g, '');
}

function dialogueSegments(shot = {}) {
  if (Array.isArray(shot.dialogue_lines)) {
    return shot.dialogue_lines.map((line) => {
      const text = normalizeSpeechSegment(line?.line || line?.text || '');
      const speaker = normalizeSpeechSegment(line?.speaker || '');
      return [speaker, text].filter(Boolean).join(': ');
    });
  }
  return [shot.dialogue || shot.dialog || ''];
}

function speechMode(shot = {}) {
  const mode = String(shot.speech_mode || shot.speechMode || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['on_camera', 'on_camera_dialogue', 'visible_dialogue', 'speaking', 'lip_sync'].includes(mode)) return 'on_camera_dialogue';
  if (['silent', 'mute', 'no_speech'].includes(mode)) return 'silent';
  return 'offscreen_voiceover';
}

function shotSpeechText(shot = {}) {
  const mode = speechMode(shot);
  if (mode === 'silent') return '';
  const voiceover = normalizeSpeechSegment(shot.voiceover || shot.narration || shot.ad_copy || shot.subtitle || '');
  if (mode !== 'on_camera_dialogue') {
    if (voiceover) return voiceover;
    return dialogueSegments(shot).map(segment => normalizeSpeechSegment(segment).replace(/^.*?:\s*/, '')).filter(Boolean).join(' ');
  }
  const seen = new Set();
  return [
    voiceover,
    ...dialogueSegments(shot),
  ].map(normalizeSpeechSegment).filter((segment) => {
    const key = speechSegmentKey(segment);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(' ');
}

function voiceoverPlanMatches(ttsAudio = {}, shots = [], voiceId = '') {
  const tracks = Array.isArray(ttsAudio?.tracks) ? ttsAudio.tracks : [];
  const shotList = Array.isArray(shots) ? shots : [];
  if (tracks.length !== shotList.length) return false;
  const expectedVoiceId = normalizeSpeechSegment(voiceId);
  const storedVoiceId = normalizeSpeechSegment(ttsAudio?.voice_id || ttsAudio?.voiceId || '');
  if (expectedVoiceId && storedVoiceId !== expectedVoiceId) return false;
  return shotList.every((shot, index) => (
    normalizeSpeechSegment(tracks[index]?.text) === shotSpeechText(shot)
  ));
}

function voiceoverFilesReady(ttsAudio = {}) {
  const tracks = Array.isArray(ttsAudio?.tracks) ? ttsAudio.tracks : [];
  if (!tracks.length) return false;
  return tracks.every(trackFileReady);
}

function trackFileReady(track = {}) {
  if (track?.file_path && fs.existsSync(track.file_path)) return true;
  const raw = String(track?.audio_url || track?.audioUrl || track?.url || '').trim().split('?')[0];
  const prefix = '/api/new-story-ad/audio/';
  if (!raw.startsWith(prefix)) return false;
  try {
    const filePath = audioPathFromName(decodeURIComponent(raw.slice(prefix.length)));
    return !!filePath && fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function voiceoverReady(ttsAudio = {}, shots = [], voiceId = '') {
  return voiceoverPlanMatches(ttsAudio, shots, voiceId) && voiceoverFilesReady(ttsAudio);
}

function wavHeader({ sampleRate, channels, bitsPerSample, dataBytes }) {
  const blockAlign = channels * bitsPerSample / 8;
  const byteRate = sampleRate * blockAlign;
  const buffer = Buffer.alloc(44);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

function writeSilenceWav(outputPath, durationSec = 2) {
  ensureDir(path.dirname(outputPath));
  const sampleRate = 16000;
  const channels = 1;
  const bitsPerSample = 16;
  const seconds = clamp(durationSec, 0.8, 12, 2);
  const dataBytes = Math.ceil(sampleRate * seconds) * channels * bitsPerSample / 8;
  const audio = Buffer.alloc(dataBytes);
  fs.writeFileSync(outputPath, Buffer.concat([
    wavHeader({ sampleRate, channels, bitsPerSample, dataBytes }),
    audio,
  ]));
  return outputPath;
}

function publicResult(filePath, extra = {}) {
  const filename = path.basename(filePath);
  return {
    filename,
    file_path: filePath,
    audio_url: publicAudioUrl(filename),
    audioUrl: publicAudioUrl(filename),
    ...extra,
  };
}

async function generateShotAudio({
  taskId = '',
  shot = {},
  index = 0,
  voiceId = '',
  speed = 1,
  allowSilentFallback = false,
} = {}) {
  const mode = speechMode(shot);
  const text = shotSpeechText(shot);
  const base = safeBase(`nsa_${taskId || 'task'}_${String(index + 1).padStart(2, '0')}_${Date.now()}`);
  const estimatedDuration = clamp(shot.duration_sec || shot.duration || Math.ceil(Math.max(1, text.length) / 5), 1.2, 10, 3);
  if (mode === 'silent') {
    const out = path.join(AUDIO_DIR, `${base}_silent.wav`);
    writeSilenceWav(out, estimatedDuration);
    return publicResult(out, {
      shot_index: index,
      index: index + 1,
      text: '',
      duration_sec: estimatedDuration,
      provider_used: 'local/silent-shot',
      speech_mode: 'silent',
    });
  }
  if (!text) throw new Error(`第 ${index + 1} 镜没有可生成的旁白或台词`);
  if (process.env.NEW_STORY_AD_MOCK_TTS === '1') {
    const out = path.join(AUDIO_DIR, `${base}.wav`);
    writeSilenceWav(out, estimatedDuration);
    return publicResult(out, {
      shot_index: index,
      index: index + 1,
      text,
      duration_sec: estimatedDuration,
      provider_used: 'mock/new-story-ad-tts',
      warning: 'test-only silent timing audio',
      speech_mode: mode,
    });
  }
  if (!voiceId) throw new Error('未选择配音音色，不能生成真实配音');

  const outBase = path.join(AUDIO_DIR, `${base}.mp3`);
  try {
    cancellation.throwIfCancelled(taskId);
    const actual = await ttsService.generateSpeech(text, outBase, {
      speed: clamp(speed, 0.5, 1.8, 1),
      voiceId,
      signal: cancellation.signal(),
    });
    cancellation.throwIfCancelled(taskId);
    if (!actual || !fs.existsSync(actual)) throw new Error(`所选音色 ${voiceId} 未生成有效配音文件`);
    return publicResult(actual, {
      shot_index: index,
      index: index + 1,
      text,
      duration_sec: estimatedDuration,
      provider_used: `${ttsService.voiceProviderForId(voiceId) || 'shared-tts'}/${voiceId}`,
      speech_mode: mode,
    });
  } catch (err) {
    if (err?.code === 'USER_CANCELLED' || err?.cancelled === true) throw err;
    if (!allowSilentFallback) throw err;
    const fallback = path.join(AUDIO_DIR, `${base}_fallback.wav`);
    writeSilenceWav(fallback, estimatedDuration);
    return publicResult(fallback, {
      shot_index: index,
      index: index + 1,
      text,
      duration_sec: estimatedDuration,
      provider_used: 'local/silent-audio-fallback',
      speech_mode: mode,
      warning: String(err.message || err).slice(0, 500),
    });
  }
}

async function generateVoiceover({
  taskId = '',
  shots = [],
  voiceId = '',
  speed = 1,
  allowSilentFallback = false,
  existingTracks = [],
  onCheckpoint = null,
  concurrency = Number(process.env.NEW_STORY_AD_TTS_CONCURRENCY) || 3,
} = {}) {
  const list = Array.isArray(shots) ? shots : [];
  const previous = Array.isArray(existingTracks) ? existingTracks : [];
  const tracks = Array.from({ length: list.length }, (_, index) => {
    const track = previous[index];
    return trackFileReady(track)
      && normalizeSpeechSegment(track?.text) === shotSpeechText(list[index])
      ? track
      : null;
  });
  const pending = tracks.map((track, index) => track ? -1 : index).filter(index => index >= 0);
  const width = Math.max(1, Math.min(5, Number(concurrency) || 3));
  for (let start = 0; start < pending.length; start += width) {
    cancellation.throwIfCancelled(taskId);
    const indexes = pending.slice(start, start + width);
    const generated = await Promise.all(indexes.map(index => generateShotAudio({
      taskId,
      shot: list[index],
      index,
      voiceId,
      speed,
      allowSilentFallback,
    })));
    indexes.forEach((index, offset) => { tracks[index] = generated[offset]; });
    if (typeof onCheckpoint === 'function') await onCheckpoint(tracks.slice());
    cancellation.throwIfCancelled(taskId);
  }
  return {
    tracks,
    voice_id: voiceId,
    provider_used: tracks.find(x => x.provider_used)?.provider_used || '',
    warnings: tracks.map(x => x.warning).filter(Boolean),
  };
}

module.exports = {
  AUDIO_DIR,
  audioPathFromName,
  publicAudioUrl,
  speechMode,
  shotSpeechText,
  voiceoverPlanMatches,
  voiceoverFilesReady,
  voiceoverReady,
  trackFileReady,
  generateShotAudio,
  generateVoiceover,
};
