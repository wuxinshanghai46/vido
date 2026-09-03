const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
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
  if (['dialogue', 'on_camera', 'on_camera_dialogue', 'visible_dialogue', 'speaking', 'lip_sync', 'on_camera_introduction', 'presenter', 'talking_head', 'self_introduction'].includes(mode)) return 'on_camera_dialogue';
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

function normalizeVoiceAssignments(value = {}, fallbackVoiceId = '') {
  const source = value && typeof value === 'object' ? value : {};
  const speakers = {};
  Object.entries(source.speakers || {}).slice(0, 30).forEach(([speaker, voice]) => {
    const safeSpeaker = normalizeSpeechSegment(speaker);
    const safeVoice = normalizeSpeechSegment(voice);
    if (safeSpeaker && safeVoice) speakers[safeSpeaker] = safeVoice;
  });
  return {
    narrator: normalizeSpeechSegment(source.narrator || source.narrator_voice_id || fallbackVoiceId),
    speakers,
  };
}

function shotSpeechUnits(shot = {}, fallbackVoiceId = '', voiceAssignments = {}) {
  const mode = speechMode(shot);
  if (mode === 'silent') return [];
  const assignments = normalizeVoiceAssignments(voiceAssignments, fallbackVoiceId);
  if (mode !== 'on_camera_dialogue') {
    const text = shotSpeechText(shot);
    return text ? [{ speaker: '旁白', text, voice_id: assignments.narrator || fallbackVoiceId, kind: 'narration' }] : [];
  }
  const dialogue = Array.isArray(shot.dialogue_lines) ? shot.dialogue_lines : [];
  const units = dialogue.map(line => {
    const voiceover = String(line?.speech_mode || line?.kind || '').trim().toLowerCase() === 'voiceover';
    const speaker = voiceover ? '旁白' : normalizeSpeechSegment(line?.speaker || '');
    const speakerId = voiceover ? 'narrator' : normalizeSpeechSegment(line?.speaker_id || line?.speakerId || '');
    const text = normalizeSpeechSegment(line?.line || line?.text || '');
    return {
      speaker,
      speaker_id: speakerId,
      text,
      voice_id: voiceover ? (assignments.narrator || fallbackVoiceId) : (assignments.speakers[speakerId] || assignments.speakers[speaker] || line?.voice_id || fallbackVoiceId),
      kind: voiceover ? 'narration' : 'dialogue',
    };
  }).filter(unit => unit.text);
  if (units.length) return units;
  const text = shotSpeechText(shot);
  const speaker = normalizeSpeechSegment(shot.speaker || shot.characters?.[0]?.name || '');
  const speakerId = normalizeSpeechSegment(shot.speaker_id || shot.speakerId || '');
  return text ? [{ speaker, speaker_id: speakerId, text, voice_id: assignments.speakers[speakerId] || assignments.speakers[speaker] || fallbackVoiceId, kind: 'dialogue' }] : [];
}

function voiceSignature(shot = {}, fallbackVoiceId = '', voiceAssignments = {}) {
  return shotSpeechUnits(shot, fallbackVoiceId, voiceAssignments)
    .map(unit => `${unit.speaker}:${unit.voice_id}:${unit.text}`)
    .join('|');
}

function voiceoverPlanMatches(ttsAudio = {}, shots = [], voiceId = '', voiceAssignments = {}) {
  const tracks = Array.isArray(ttsAudio?.tracks) ? ttsAudio.tracks : [];
  const shotList = Array.isArray(shots) ? shots : [];
  if (tracks.length !== shotList.length) return false;
  const expectedVoiceId = normalizeSpeechSegment(voiceId);
  const storedVoiceId = normalizeSpeechSegment(ttsAudio?.voice_id || ttsAudio?.voiceId || '');
  if (expectedVoiceId && storedVoiceId !== expectedVoiceId) return false;
  const multiVoice = Object.keys(voiceAssignments?.speakers || {}).length > 0;
  return shotList.every((shot, index) => {
    const storedSignature = String(tracks[index]?.voice_signature || '');
    return normalizeSpeechSegment(tracks[index]?.text) === shotSpeechUnits(shot, voiceId, voiceAssignments).map(unit => unit.text).join(' ')
      && ((!multiVoice && !storedSignature) || storedSignature === voiceSignature(shot, voiceId, voiceAssignments));
  });
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

function voiceoverReady(ttsAudio = {}, shots = [], voiceId = '', voiceAssignments = {}) {
  return voiceoverPlanMatches(ttsAudio, shots, voiceId, voiceAssignments) && voiceoverFilesReady(ttsAudio);
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

function concatGeneratedUnits(units = [], outputPath = '', { muteNarration = false } = {}) {
  if (!units.length || !outputPath) return '';
  if (units.length === 1 && (!muteNarration || units[0].kind === 'dialogue')) return units[0].file_path;
  const args = units.flatMap(unit => ['-i', unit.file_path]);
  const filters = units.map((unit, index) => `[${index}:a]${muteNarration && unit.kind !== 'dialogue' ? 'volume=0' : 'anull'}[unit${index}]`);
  filters.push(`${units.map((_, index) => `[unit${index}]`).join('')}concat=n=${units.length}:v=0:a=1[outa]`);
  args.push('-filter_complex', filters.join(';'), '-map', '[outa]', '-ac', '1', '-ar', '24000', '-b:a', '128k', '-y', outputPath);
  execFileSync(ffmpegPath, args, { timeout: 120000, stdio: 'pipe' });
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
  voiceAssignments = {},
  userId = '',
  requestBaseUrl = '',
  speed = 1,
  allowSilentFallback = false,
} = {}) {
  ensureDir(AUDIO_DIR);
  const mode = speechMode(shot);
  const units = shotSpeechUnits(shot, voiceId, voiceAssignments);
  const text = units.map(unit => unit.text).join(' ');
  const signature = voiceSignature(shot, voiceId, voiceAssignments);
  const trackIndex = Math.max(1, Number(shot.shot_index || shot.index || index + 1) || index + 1);
  const trackId = normalizeSpeechSegment(shot.shot_id || shot.id || '');
  const base = safeBase(`nsa_${taskId || 'task'}_${String(trackIndex).padStart(2, '0')}_${Date.now()}`);
  const estimatedDuration = clamp(shot.duration_sec || shot.duration || Math.ceil(Math.max(1, text.length) / 5), 1.2, 10, 3);
  if (mode === 'silent') {
    const out = path.join(AUDIO_DIR, `${base}_silent.wav`);
    writeSilenceWav(out, estimatedDuration);
    return publicResult(out, {
      shot_id: trackId,
      shot_index: trackIndex,
      index: trackIndex,
      text: '',
      duration_sec: estimatedDuration,
      provider_used: 'local/silent-shot',
      speech_mode: 'silent',
      voice_signature: signature,
      speech_units: [],
    });
  }
  if (!text) throw new Error(`第 ${trackIndex} 镜没有可生成的旁白或台词`);
  if (process.env.NEW_STORY_AD_MOCK_TTS === '1') {
    const out = path.join(AUDIO_DIR, `${base}.wav`);
    writeSilenceWav(out, estimatedDuration);
    const hasDialogue = units.some(unit => unit.kind === 'dialogue');
    return publicResult(out, {
      shot_id: trackId,
      shot_index: trackIndex,
      index: trackIndex,
      text,
      duration_sec: estimatedDuration,
      provider_used: 'mock/new-story-ad-tts',
      warning: 'test-only silent timing audio',
      speech_mode: mode,
      voice_signature: signature,
      speech_units: units,
      lip_sync_audio_url: mode === 'on_camera_dialogue' && hasDialogue ? publicAudioUrl(path.basename(out)) : '',
      lip_sync_file_path: mode === 'on_camera_dialogue' && hasDialogue ? out : '',
      lip_sync_unit_count: units.filter(unit => unit.kind === 'dialogue').length,
      narration_unit_count: units.filter(unit => unit.kind === 'narration').length,
    });
  }
  if (units.some(unit => !unit.voice_id)) {
    const missing = units.filter(unit => !unit.voice_id).map(unit => unit.speaker || '未标注角色');
    throw new Error(`以下说话人未选择配音音色：${[...new Set(missing)].join('、')}`);
  }

  const outBase = path.join(AUDIO_DIR, `${base}.mp3`);
  try {
    cancellation.throwIfCancelled(taskId);
    const generatedUnits = [];
    for (let unitIndex = 0; unitIndex < units.length; unitIndex++) {
      const unit = units[unitIndex];
      const unitBase = units.length === 1 ? outBase : path.join(AUDIO_DIR, `${base}_unit_${unitIndex + 1}.mp3`);
      const actualUnit = await ttsService.generateSpeech(unit.text, unitBase, {
        speed: clamp(speed, 0.5, 1.8, 1),
        voiceId: unit.voice_id,
        signal: cancellation.signal(),
        userId,
        requestBaseUrl,
      });
      if (!actualUnit || !fs.existsSync(actualUnit)) throw new Error(`说话人 ${unit.speaker || unitIndex + 1} 的音色 ${unit.voice_id} 未生成有效文件`);
      generatedUnits.push({ ...unit, file_path: actualUnit });
    }
    const actual = concatGeneratedUnits(generatedUnits, outBase);
    const dialogueUnits = generatedUnits.filter(unit => unit.kind === 'dialogue');
    const narrationUnits = generatedUnits.filter(unit => unit.kind === 'narration');
    const mixedSpeech = dialogueUnits.length > 0 && narrationUnits.length > 0;
    const lipSyncPath = mode === 'on_camera_dialogue' && dialogueUnits.length
      ? (mixedSpeech ? concatGeneratedUnits(generatedUnits, path.join(AUDIO_DIR, `${base}_lip_sync.mp3`), { muteNarration: true }) : actual)
      : '';
    cancellation.throwIfCancelled(taskId);
    if (!actual || !fs.existsSync(actual)) throw new Error(`所选音色 ${voiceId} 未生成有效配音文件`);
    return publicResult(actual, {
      shot_id: trackId,
      shot_index: trackIndex,
      index: trackIndex,
      text,
      duration_sec: estimatedDuration,
      provider_used: [...new Set(units.map(unit => `${ttsService.voiceProviderForId(unit.voice_id) || 'shared-tts'}/${unit.voice_id}`))].join(','),
      speech_mode: mode,
      voice_signature: signature,
      speech_units: units,
      lip_sync_audio_url: lipSyncPath ? publicAudioUrl(path.basename(lipSyncPath)) : '',
      lip_sync_file_path: lipSyncPath,
      lip_sync_unit_count: dialogueUnits.length,
      narration_unit_count: narrationUnits.length,
    });
  } catch (err) {
    if (err?.code === 'USER_CANCELLED' || err?.cancelled === true) throw err;
    if (!allowSilentFallback) throw err;
    const fallback = path.join(AUDIO_DIR, `${base}_fallback.wav`);
    writeSilenceWav(fallback, estimatedDuration);
    return publicResult(fallback, {
      shot_id: trackId,
      shot_index: trackIndex,
      index: trackIndex,
      text,
      duration_sec: estimatedDuration,
      provider_used: 'local/silent-audio-fallback',
      speech_mode: mode,
      warning: String(err.message || err).slice(0, 500),
      voice_signature: signature,
      speech_units: units,
    });
  }
}

async function generateVoiceover({
  taskId = '',
  shots = [],
  voiceId = '',
  voiceAssignments = {},
  userId = '',
  requestBaseUrl = '',
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
      && normalizeSpeechSegment(track?.text) === shotSpeechUnits(list[index], voiceId, voiceAssignments).map(unit => unit.text).join(' ')
      && String(track?.voice_signature || '') === voiceSignature(list[index], voiceId, voiceAssignments)
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
      voiceAssignments,
      userId,
      requestBaseUrl,
      speed,
      allowSilentFallback,
    })));
    indexes.forEach((index, offset) => { tracks[index] = generated[offset]; });
    if (typeof onCheckpoint === 'function') await onCheckpoint(tracks.slice(), {
      completed: tracks.filter(Boolean).length,
      total: list.length,
      completed_indexes: tracks.map((track, index) => track ? index + 1 : 0).filter(Boolean),
    });
    cancellation.throwIfCancelled(taskId);
  }
  return {
    tracks,
    voice_id: voiceId,
    voice_assignments: normalizeVoiceAssignments(voiceAssignments, voiceId),
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
  shotSpeechUnits,
  voiceSignature,
  voiceoverPlanMatches,
  voiceoverFilesReady,
  voiceoverReady,
  trackFileReady,
  generateShotAudio,
  generateVoiceover,
};
