const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const videoAdapter = require('./videoAdapter');

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

function quoteConcatPath(filePath = '') {
  return String(filePath).replace(/\\/g, '/').replace(/'/g, "'\\''");
}

async function concatVideos({ taskId = '', clips = [] } = {}) {
  const inputs = (Array.isArray(clips) ? clips : []).map(localVideoPath).filter(Boolean);
  if (!inputs.length) throw new Error('new_story_ad compose requires at least one local video clip');
  ensureDir(COMPOSE_DIR);
  const filename = `${safeBase(`nsa_final_${taskId || 'task'}_${Date.now()}`)}.mp4`;
  const out = path.join(COMPOSE_DIR, filename);
  if (inputs.length === 1) {
    fs.copyFileSync(inputs[0], out);
  } else {
    const listFile = path.join(COMPOSE_DIR, `${safeBase(`concat_${taskId || 'task'}_${Date.now()}`)}.txt`);
    fs.writeFileSync(listFile, inputs.map(p => `file '${quoteConcatPath(p)}'`).join('\n'), 'utf8');
    await execFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', out]);
  }
  return {
    filename,
    file_path: out,
    video_url: publicComposeUrl(filename),
    videoUrl: publicComposeUrl(filename),
    clip_count: inputs.length,
    provider_used: 'local-ffmpeg/new-story-ad-compose',
  };
}

module.exports = {
  COMPOSE_DIR,
  composePathFromName,
  publicComposeUrl,
  concatVideos,
};
