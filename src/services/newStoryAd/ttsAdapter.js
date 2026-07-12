const fs = require('fs');
const path = require('path');
const aliyunVoice = require('../aliyunVoiceService');
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

function dialogueText(shot = {}) {
  if (Array.isArray(shot.dialogue_lines)) {
    return shot.dialogue_lines
      .map(line => [line.speaker || '', line.line || line.text || ''].filter(Boolean).join(': '))
      .filter(Boolean)
      .join(' ');
  }
  return shot.dialogue || shot.dialog || '';
}

function shotSpeechText(shot = {}) {
  return [
    shot.voiceover,
    shot.narration,
    shot.ad_copy,
    shot.subtitle,
    dialogueText(shot),
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
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
  const text = shotSpeechText(shot) || `Shot ${index + 1}`;
  const base = safeBase(`nsa_${taskId || 'task'}_${String(index + 1).padStart(2, '0')}_${Date.now()}`);
  const estimatedDuration = clamp(shot.duration_sec || shot.duration || Math.ceil(text.length / 5), 1.2, 10, 3);
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
    });
  }
  if (!voiceId) throw new Error('未选择配音音色，不能生成真实配音');

  const outBase = path.join(AUDIO_DIR, `${base}.mp3`);
  try {
    const actual = await aliyunVoice.synthesize(text, voiceId, outBase, {
      speed: clamp(speed, 0.5, 1.8, 1),
      format: 'mp3',
    });
    return publicResult(actual, {
      shot_index: index,
      index: index + 1,
      text,
      duration_sec: estimatedDuration,
      provider_used: `aliyun-tts/${voiceId}`,
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
} = {}) {
  const list = Array.isArray(shots) ? shots : [];
  const tracks = [];
  for (let i = 0; i < list.length; i += 1) {
    cancellation.throwIfCancelled(taskId);
    tracks.push(await generateShotAudio({
      taskId,
      shot: list[i],
      index: i,
      voiceId,
      speed,
      allowSilentFallback,
    }));
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
  shotSpeechText,
  generateShotAudio,
  generateVoiceover,
};
