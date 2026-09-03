const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;
const mediaAdapter = require('./mediaAdapter');
const ttsAdapter = require('./ttsAdapter');
const cancellation = require('./cancellationContext');

function createVideoAdapterMediaRuntime({ videoDir }) {
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
    return safe ? path.join(videoDir, safe) : '';
  }

  function clamp(num, min, max, fallback) {
    const value = Number(num);
    if (!Number.isFinite(value)) return fallback;
    return Math.max(min, Math.min(max, value));
  }

  function ratioSize(ratio = '9:16') {
    const key = String(ratio || '9:16').trim();
    if (key === '21:9') return { width: 1680, height: 720 };
    if (key === '16:9') return { width: 1280, height: 720 };
    if (key === '1:1') return { width: 1024, height: 1024 };
    if (key === '4:3') return { width: 1024, height: 768 };
    if (key === '3:4') return { width: 768, height: 1024 };
    return { width: 720, height: 1280 };
  }

  function outputSize(ratio = '9:16', resolution = '1080p') {
    const base = ratioSize(ratio);
    const scale = { '480p': 480 / 720, '720p': 1, '1080p': 1080 / 720, '4k': 2160 / 720 }[String(resolution || '1080p').toLowerCase()] || 1;
    const even = value => Math.max(2, Math.round(value * scale / 2) * 2);
    return { width: even(base.width), height: even(base.height) };
  }

  function execFfmpeg(args, timeoutMs = 120000) {
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
        reject(new Error('new_story_ad video render timed out'));
      }, timeoutMs);
      child.stderr.on('data', chunk => { stderr += chunk.toString(); });
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (signal?.aborted) return reject(signal.reason || new Error('FFmpeg aborted'));
        if (code === 0) return resolve();
        reject(new Error(stderr.split(/\r?\n/).filter(Boolean).slice(-6).join(' | ') || `ffmpeg exited ${code}`));
      });
    });
  }

  function probeDuration(filePath = '') {
    if (!filePath || !fs.existsSync(filePath) || !ffprobePath) return Promise.resolve(0);
    return new Promise(resolve => {
      const child = spawn(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', filePath], { windowsHide: true });
      let out = '';
      child.stdout.on('data', chunk => { out += chunk.toString(); });
      child.on('error', () => resolve(0));
      child.on('close', () => resolve(Math.max(0, Number(out.trim()) || 0)));
    });
  }

  function hasAudioStream(filePath = '') {
    if (!filePath || !fs.existsSync(filePath)) return Promise.resolve(false);
    return new Promise(resolve => {
      const child = spawn(ffprobePath, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=index', '-of', 'csv=p=0', filePath], { windowsHide: true });
      let out = '';
      child.stdout.on('data', chunk => { out += chunk.toString(); });
      child.on('error', () => resolve(false));
      child.on('close', () => resolve(!!out.trim()));
    });
  }

  function encodingProfile(qualityTier = 'final', resolution = '1080p') {
    const tier = String(qualityTier || 'final').toLowerCase();
    if (tier === 'draft') return { tier: 'draft', preset: 'veryfast', crf: '22', audio_bitrate: '128k' };
    if (String(resolution || '').toLowerCase() === '4k') return { tier: 'final', preset: 'fast', crf: '18', audio_bitrate: '192k' };
    return { tier: 'final', preset: 'fast', crf: '18', audio_bitrate: '160k' };
  }

  async function normalizeProviderClip({ inputPath, outputPath, audioPath = '', preserveDrivenAudio = false, requireSourceAudio = false, durationSec = 4, startSec = 0, aspectRatio = '9:16', resolution = '1080p', qualityTier = 'final' } = {}) {
    ensureDir(path.dirname(outputPath));
    const { width, height } = outputSize(aspectRatio, resolution);
    const profile = encodingProfile(qualityTier, resolution);
    const duration = clamp(durationSec, 1, 15, 4);
    const args = ['-y'];
    if (Number(startSec) > 0) args.push('-ss', String(Math.max(0, Number(startSec) || 0)));
    args.push('-i', inputPath);
    const sourceHasAudio = await hasAudioStream(inputPath);
    if (requireSourceAudio && await probeDuration(inputPath) > duration + 0.1) throw Object.assign(new Error('原生视频超过镜头时长，不能截断音轨后当作成功。'), { code: 'VIDEO_NATIVE_DURATION_MISMATCH', retryable: false });
    if (requireSourceAudio && !sourceHasAudio) throw Object.assign(new Error('视频缺少模型生成的真实声音，不能补静音后当作成功。'), { code: 'VIDEO_NATIVE_AUDIO_MISSING', retryable: false });
    const overlayAudio = audioPath && !(preserveDrivenAudio && sourceHasAudio);
    if (overlayAudio) args.push('-i', audioPath);
    else if (!sourceHasAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
    if (sourceHasAudio && overlayAudio) args.push('-filter_complex', `[0:a]aresample=44100,volume=0.38[amb];[1:a]aresample=44100,volume=1.0[voice];[amb][voice]amix=inputs=2:duration=longest:dropout_transition=0,apad,atrim=0:${duration}[aout]`);
    args.push('-t', String(duration), '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=30,setsar=1,format=yuv420p`, ...(sourceHasAudio && overlayAudio ? [] : ['-af', `apad,atrim=0:${duration},aresample=44100`]), '-map', '0:v:0', '-map', sourceHasAudio && overlayAudio ? '[aout]' : (sourceHasAudio ? '0:a:0' : '1:a:0'), '-c:v', 'libx264', '-preset', profile.preset, '-crf', profile.crf, '-c:a', 'aac', '-b:a', profile.audio_bitrate, '-ar', '44100', '-ac', '2', '-movflags', '+faststart', outputPath);
    await execFfmpeg(args, 240000);
    return outputPath;
  }

  function normalizeLocalUrl(url = '') {
    const raw = String(url || '').trim();
    const match = raw.match(/^https?:\/\/(?:127\.0\.0\.1|localhost):\d+(\/.+)$/i);
    return match ? match[1] : raw;
  }

  function localImagePath(url = '') {
    const clean = normalizeLocalUrl(url).split('?')[0];
    const prefix = '/api/new-story-ad/assets/';
    if (!clean.startsWith(prefix)) return '';
    const filePath = mediaAdapter.assetPathFromName(decodeURIComponent(clean.slice(prefix.length)));
    if (!filePath || !fs.existsSync(filePath)) return '';
    return ['.jpg', '.jpeg', '.png', '.webp'].includes(path.extname(filePath).toLowerCase()) ? filePath : '';
  }

  function localAudioPath(url = '') {
    const clean = normalizeLocalUrl(url).split('?')[0];
    const prefix = '/api/new-story-ad/audio/';
    if (!clean.startsWith(prefix)) return '';
    const filePath = ttsAdapter.audioPathFromName(decodeURIComponent(clean.slice(prefix.length)));
    return filePath && fs.existsSync(filePath) ? filePath : '';
  }

  return { ensureDir, safeBase, publicVideoUrl, videoPathFromName, clamp, ratioSize, outputSize, execFfmpeg, probeDuration, encodingProfile, normalizeProviderClip, localImagePath, localAudioPath };
}

module.exports = { createVideoAdapterMediaRuntime };
