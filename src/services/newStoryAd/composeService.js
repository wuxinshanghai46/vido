const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const cancellation = require('./cancellationContext');
const ffmpegPath = require('ffmpeg-static');
const videoAdapter = require('./videoAdapter');
const ttsAdapter = require('./ttsAdapter');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, '../../../outputs'));
const COMPOSE_DIR = path.join(OUTPUT_DIR, 'new-story-ad-compose');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeBase(value = 'new_story_ad_final') {
  return String(value || 'new_story_ad_final').replace(/[^a-z0-9_-]/ig, '_').slice(0, 96) || 'new_story_ad_final';
}

function publicComposeUrl(filename = '') {
  return `/api/new-story-ad/compose/${encodeURIComponent(path.basename(filename))}`;
}

function composePathFromName(filename = '') {
  const safe = path.basename(String(filename || '').split('?')[0]);
  if (!safe) return '';
  return path.join(COMPOSE_DIR, safe);
}

function execFfmpeg(args, timeoutMs = 180000) {
  if (!ffmpegPath) return Promise.reject(new Error('ffmpeg-static is unavailable'));
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    const signal = cancellation.signal();
    const abort = () => child.kill('SIGKILL');
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error('new_story_ad compose timed out'));
    }, timeoutMs);
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', code => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) return reject(signal.reason || new Error('FFmpeg aborted'));
      if (code === 0) return resolve();
      reject(new Error(stderr.split(/\r?\n/).filter(Boolean).slice(-6).join(' | ') || `ffmpeg exited ${code}`));
    });
  });
}

function normalizeLocalUrl(url = '') {
  const raw = String(url || '').trim();
  const m = raw.match(/^https?:\/\/(?:127\.0\.0\.1|localhost):\d+(\/.+)$/i);
  return m ? m[1] : raw;
}

function localVideoPath(clip = {}) {
  if (clip.file_path && fs.existsSync(clip.file_path)) return clip.file_path;
  const clean = normalizeLocalUrl(clip.video_url || clip.videoUrl || clip.url || '').split('?')[0];
  const prefix = '/api/new-story-ad/videos/';
  if (!clean.startsWith(prefix)) return '';
  const filePath = videoAdapter.videoPathFromName(decodeURIComponent(clean.slice(prefix.length)));
  return filePath && fs.existsSync(filePath) ? filePath : '';
}

function localAudioPath(track = {}) {
  const clean = normalizeLocalUrl(track.audio_url || track.audioUrl || track.url || '').split('?')[0];
  const prefix = '/api/new-story-ad/audio/';
  if (!clean.startsWith(prefix)) return '';
  const filePath = ttsAdapter.audioPathFromName(decodeURIComponent(clean.slice(prefix.length)));
  return filePath && fs.existsSync(filePath) ? filePath : '';
}

async function muxVoiceTrack(videoPath = '', audioPath = '', outputPath = '') {
  if (!videoPath || !audioPath || !outputPath) return videoPath;
  await execFfmpeg([
    '-y', '-i', videoPath, '-i', audioPath,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k',
    '-af', 'apad', '-shortest', '-movflags', '+faststart', outputPath,
  ], 240000);
  return outputPath;
}

function normalizeMediaRef(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const m = raw.match(/^https?:\/\/[^/]+(\/.+)$/i);
  return m ? m[1] : raw;
}

function mediaRefFromAsset(asset = {}) {
  if (!asset || typeof asset !== 'object') return '';
  return asset.file_path || asset.path || asset.file_url || asset.url || asset.previewUrl || asset.preview_url || '';
}

function localBgmPath(asset = {}) {
  const ref = normalizeMediaRef(mediaRefFromAsset(asset)).split('?')[0];
  if (!ref) return '';
  const decoded = decodeURIComponent(ref);
  const filename = path.basename(decoded);
  const candidates = [
    decoded,
    path.join(OUTPUT_DIR, 'music', filename),
    path.join(OUTPUT_DIR, 'assets', 'music', filename),
    path.join(OUTPUT_DIR, 'effects_assets', filename),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const resolved = path.resolve(path.isAbsolute(candidate) ? candidate : path.join(process.cwd(), candidate.replace(/^\/+/, '')));
    if (!resolved.startsWith(path.resolve(OUTPUT_DIR))) continue;
    if (fs.existsSync(resolved)) return resolved;
  }
  return '';
}

function clampVolume(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function effectsResultUrl(filePath = '') {
  const base = path.basename(filePath || '', '.mp4').replace(/^fx_/, '');
  return base ? `/api/workflow/effects/result/${encodeURIComponent(base)}` : '';
}

function quoteConcatPath(filePath = '') {
  return String(filePath).replace(/\\/g, '/').replace(/'/g, "'\\''");
}

async function concatVideos({
  taskId = '',
  clips = [],
  ttsAudio = {},
  bgmAsset = null,
  bgmVolume = 0.16,
  voiceVolume = 1,
  subtitles = [],
  subtitleEnabled = false,
  subtitleStyle = 'popup',
  transitions = [],
} = {}) {
  ensureDir(COMPOSE_DIR);
  const rawInputs = (Array.isArray(clips) ? clips : []).map(localVideoPath).filter(Boolean);
  if (!rawInputs.length) throw new Error('new_story_ad compose requires at least one local video clip');
  const tracks = Array.isArray(ttsAudio?.tracks) ? ttsAudio.tracks : (Array.isArray(ttsAudio) ? ttsAudio : []);
  const inputs = [];
  let voiceTrackCount = 0;
  for (let index = 0; index < rawInputs.length; index += 1) {
    const audioPath = localAudioPath(tracks[index] || {});
    if (!audioPath) {
      inputs.push(rawInputs[index]);
      continue;
    }
    const voiceFilename = `${safeBase(`voice_${taskId || 'task'}_${index + 1}_${Date.now()}`)}.mp4`;
    const voicedPath = path.join(COMPOSE_DIR, voiceFilename);
    inputs.push(await muxVoiceTrack(rawInputs[index], audioPath, voicedPath));
    voiceTrackCount += 1;
  }
  const filename = `${safeBase(`nsa_final_${taskId || 'task'}_${Date.now()}`)}.mp4`;
  const out = path.join(COMPOSE_DIR, filename);
  if (inputs.length === 1) {
    fs.copyFileSync(inputs[0], out);
  } else {
    const listFile = path.join(COMPOSE_DIR, `${safeBase(`concat_${taskId || 'task'}_${Date.now()}`)}.txt`);
    fs.writeFileSync(listFile, inputs.map(p => `file '${quoteConcatPath(p)}'`).join('\n'), 'utf8');
    await execFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', out]);
  }
  let finalPath = out;
  let finalUrl = publicComposeUrl(filename);
  const bgmPath = localBgmPath(bgmAsset || {});
  const validSubtitles = subtitleEnabled
    ? (Array.isArray(subtitles) ? subtitles : []).filter(item => item && item.text)
    : [];
  const needsEffects = !!bgmPath || validSubtitles.length > 0;
  let providerUsed = 'local-ffmpeg/new-story-ad-compose';
  if (needsEffects) {
    const { applyEffects } = require('../effectsService');
    const fx = await applyEffects({
      videoPath: out,
      texts: validSubtitles,
      bgm: bgmPath ? {
        path: bgmPath,
        volume: clampVolume(bgmVolume, 0.16, 0, 0.35),
        voice_volume: clampVolume(voiceVolume, 1, 0.6, 1.2),
        fadeIn: 1,
        fadeOut: 2,
      } : null,
      voiceVolume: clampVolume(voiceVolume, 1, 0.6, 1.2),
      subtitleStyle: subtitleStyle || 'popup',
    });
    if (fx?.outputPath && fs.existsSync(fx.outputPath)) {
      finalPath = fx.outputPath;
      finalUrl = effectsResultUrl(fx.outputPath);
      providerUsed += '+effects';
    }
  }
  return {
    filename,
    file_path: finalPath,
    source_file_path: out,
    video_url: finalUrl,
    videoUrl: finalUrl,
    clip_count: inputs.length,
    voiceover_applied: voiceTrackCount > 0,
    voiceover_track_count: voiceTrackCount,
    bgm_applied: !!bgmPath,
    subtitle_applied: validSubtitles.length > 0,
    subtitle_style: subtitleStyle || 'popup',
    provider_used: providerUsed,
    transition_plan: (Array.isArray(transitions) ? transitions : []).map((item, index) => ({
      shot_index: index + 1,
      type: item?.transition_type || item?.transitionType || 'hard_cut',
      reason: item?.transition_reason || item?.transitionReason || '',
      audio_bridge: item?.audio_bridge || item?.audioBridge || '',
    })),
  };
}

module.exports = {
  COMPOSE_DIR,
  composePathFromName,
  publicComposeUrl,
  concatVideos,
};
