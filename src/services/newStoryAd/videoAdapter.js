const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const mediaAdapter = require('./mediaAdapter');
const ttsAdapter = require('./ttsAdapter');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, '../../../outputs'));
const VIDEO_DIR = path.join(OUTPUT_DIR, 'new-story-ad-videos');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeBase(value = 'new_story_ad_video') {
  return String(value || 'new_story_ad_video').replace(/[^a-z0-9_-]/ig, '_').slice(0, 96) || 'new_story_ad_video';
}

function publicVideoUrl(filename = '') {
  return `/api/new-story-ad/videos/${encodeURIComponent(path.basename(filename))}`;
}

function videoPathFromName(filename = '') {
  const safe = path.basename(String(filename || '').split('?')[0]);
  if (!safe) return '';
  return path.join(VIDEO_DIR, safe);
}

function clamp(num, min, max, fallback) {
  const n = Number(num);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function ratioSize(ratio = '9:16') {
  const key = String(ratio || '9:16').trim();
  if (key === '16:9') return { width: 1280, height: 720 };
  if (key === '1:1') return { width: 1024, height: 1024 };
  if (key === '4:3') return { width: 1024, height: 768 };
  if (key === '3:4') return { width: 768, height: 1024 };
  return { width: 720, height: 1280 };
}

function execFfmpeg(args, timeoutMs = 120000) {
  if (!ffmpegPath) return Promise.reject(new Error('ffmpeg-static is unavailable'));
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error('new_story_ad video render timed out'));
    }, timeoutMs);
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', code => {
      clearTimeout(timer);
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

function localImagePath(url = '') {
  const clean = normalizeLocalUrl(url).split('?')[0];
  const prefix = '/api/new-story-ad/assets/';
  if (!clean.startsWith(prefix)) return '';
  const filePath = mediaAdapter.assetPathFromName(decodeURIComponent(clean.slice(prefix.length)));
  if (!filePath || !fs.existsSync(filePath)) return '';
  const ext = path.extname(filePath).toLowerCase();
  return ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? filePath : '';
}

function localAudioPath(url = '') {
  const clean = normalizeLocalUrl(url).split('?')[0];
  const prefix = '/api/new-story-ad/audio/';
  if (!clean.startsWith(prefix)) return '';
  const filePath = ttsAdapter.audioPathFromName(decodeURIComponent(clean.slice(prefix.length)));
  return filePath && fs.existsSync(filePath) ? filePath : '';
}

function clipPrompt(shot = {}, ctx = {}, contract = {}) {
  return [
    `Subject: ${ctx.product_subject || ''}`,
    `Shot: ${shot.title || ''}`,
    `Visual: ${shot.visual || shot.visual_description || shot.content_prompt || ''}`,
    `Action: ${shot.action || shot.visual_action || ''}`,
    `Camera: ${shot.camera || shot.camera_movement || contract.camera_strategy || ''}`,
    `Transition: ${shot.transition || contract.transition || ''}`,
  ].filter(Boolean).join('\n');
}

function outputPayload(filePath, extra = {}) {
  const filename = path.basename(filePath);
  return {
    filename,
    file_path: filePath,
    video_url: publicVideoUrl(filename),
    videoUrl: publicVideoUrl(filename),
    ...extra,
  };
}

async function renderLocalClip({
  outputPath,
  imagePath = '',
  audioPath = '',
  durationSec = 4,
  aspectRatio = '9:16',
} = {}) {
  ensureDir(path.dirname(outputPath));
  const { width, height } = ratioSize(aspectRatio);
  const duration = clamp(durationSec, 1, 15, 4);
  const args = ['-y'];
  if (imagePath) {
    args.push('-loop', '1', '-framerate', '30', '-i', imagePath);
  } else {
    args.push('-f', 'lavfi', '-i', `color=c=0x111827:s=${width}x${height}:r=30`);
  }
  if (audioPath) {
    args.push('-i', audioPath);
  } else {
    args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=mono:sample_rate=44100');
  }
  args.push(
    '-t', String(duration),
    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,format=yuv420p`,
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-r', '30',
    '-movflags', '+faststart',
    outputPath,
  );
  await execFfmpeg(args);
  return outputPath;
}

async function generateShotVideo({
  taskId = '',
  shot = {},
  keyframe = {},
  audio = {},
  contract = {},
  ctx = {},
  index = 0,
  options = {},
} = {}) {
  const duration = clamp(
    options.duration_sec || options.durationSec || shot.duration_sec || shot.duration || audio.duration_sec,
    1,
    15,
    4,
  );
  const base = safeBase(`nsa_${taskId || 'task'}_${String(index + 1).padStart(2, '0')}_${Date.now()}`);
  const out = path.join(VIDEO_DIR, `${base}.mp4`);
  const imagePath = localImagePath(keyframe.image_url || keyframe.imageUrl || keyframe.url || '');
  const audioPath = localAudioPath(audio.audio_url || audio.audioUrl || audio.url || '');
  await renderLocalClip({
    outputPath: out,
    imagePath,
    audioPath,
    durationSec: duration,
    aspectRatio: ctx.output_ratio || options.aspectRatio || '9:16',
  });
  return outputPayload(out, {
    shot_index: index,
    index: index + 1,
    title: shot.title || `Shot ${index + 1}`,
    duration_sec: duration,
    provider_used: 'local-ffmpeg/new-story-ad-video',
    image_source: imagePath ? (keyframe.image_url || keyframe.imageUrl || '') : '',
    audio_source: audioPath ? (audio.audio_url || audio.audioUrl || '') : '',
    motion_prompt: clipPrompt(shot, ctx, contract),
    mode: imagePath ? 'still_keyframe_video' : 'placeholder_video',
  });
}

async function generateShotVideos({
  taskId = '',
  shots = [],
  keyframes = [],
  ttsAudio = {},
  contracts = [],
  ctx = {},
  options = {},
} = {}) {
  const list = Array.isArray(shots) ? shots : [];
  const tracks = Array.isArray(ttsAudio?.tracks) ? ttsAudio.tracks : (Array.isArray(ttsAudio) ? ttsAudio : []);
  const clips = [];
  for (let i = 0; i < list.length; i += 1) {
    clips.push(await generateShotVideo({
      taskId,
      shot: list[i],
      keyframe: keyframes[i] || {},
      audio: tracks[i] || {},
      contract: contracts[i] || {},
      ctx,
      index: i,
      options,
    }));
  }
  return {
    clips,
    provider_used: clips.find(x => x.provider_used)?.provider_used || '',
  };
}

module.exports = {
  VIDEO_DIR,
  videoPathFromName,
  publicVideoUrl,
  generateShotVideo,
  generateShotVideos,
};
