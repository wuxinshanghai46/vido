const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { execFileSync } = require('child_process');
const ffmpegStatic = require('ffmpeg-static');
const db = require('../models/database');

const OUTPUT_SIZE_PRESETS = {
  '9:16': { standard: [720, 1280], hd: [900, 1600], fullhd: [1080, 1920] },
  '16:9': { standard: [1280, 720], hd: [1600, 900], fullhd: [1920, 1080] },
  '1:1': { standard: [1024, 1024], hd: [1280, 1280], fullhd: [1536, 1536] },
  '3:4': { standard: [768, 1024], hd: [960, 1280], fullhd: [1080, 1440] },
  '4:3': { standard: [1024, 768], hd: [1280, 960], fullhd: [1440, 1080] },
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function normalizeAspectRatio(value, fallback = '16:9') {
  return Object.prototype.hasOwnProperty.call(OUTPUT_SIZE_PRESETS, value) ? value : fallback;
}

function normalizeOutputSize(value) {
  return ['standard', 'hd', 'fullhd'].includes(value) ? value : 'standard';
}

function outputPixels(aspectRatio, outputSize) {
  const ar = normalizeAspectRatio(aspectRatio);
  const size = normalizeOutputSize(outputSize);
  return OUTPUT_SIZE_PRESETS[ar][size] || OUTPUT_SIZE_PRESETS['16:9'].standard;
}

function outputSizeString(aspectRatio, outputSize) {
  return outputPixels(aspectRatio, outputSize).join('x');
}

function ffmpegBin() {
  return process.env.FFMPEG_PATH || ffmpegStatic || 'ffmpeg';
}

function publicBaseUrl(req) {
  const fromEnv = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host') || 'localhost:3007';
  return `${proto}://${host}`;
}

function toAbsoluteUrl(req, url) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return `${publicBaseUrl(req)}${String(url).startsWith('/') ? '' : '/'}${url}`;
}

function safeName(name) {
  return String(name || 'asset').replace(/[^a-z0-9_-]/gi, '_').slice(0, 60) || 'asset';
}

async function downloadAsset(req, url, destPath) {
  if (!url) throw new Error('asset url is required');
  const abs = toAbsoluteUrl(req, url);
  const headers = req?.headers?.authorization ? { Authorization: req.headers.authorization } : {};
  const response = await axios.get(abs, {
    responseType: 'arraybuffer',
    timeout: 120000,
    maxContentLength: 200 * 1024 * 1024,
    headers,
  });
  fs.writeFileSync(destPath, Buffer.from(response.data));
  if (!fs.existsSync(destPath) || fs.statSync(destPath).size < 512) {
    throw new Error(`downloaded asset is invalid: ${url}`);
  }
  return destPath;
}

function guessExtFromUrl(url, fallback = '.jpg') {
  const clean = String(url || '').split('?')[0].split('#')[0];
  const ext = path.extname(clean).toLowerCase();
  return ext && ext.length <= 6 ? ext : fallback;
}

function createBackgroundTrack({ inputPath, outputPath, durationSec, aspectRatio, outputSize }) {
  const [w, h] = outputPixels(aspectRatio, outputSize);
  execFileSync(ffmpegBin(), [
    '-y',
    '-loop', '1',
    '-t', String(durationSec),
    '-i', inputPath,
    '-vf', `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=30,format=yuv420p`,
    '-an',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '22',
    '-movflags', '+faststart',
    outputPath,
  ], { stdio: 'pipe', timeout: 180000 });
  assertVideo(outputPath, 'background track');
  return outputPath;
}

function normalizeVideoTrack({ inputPath, outputPath, aspectRatio, outputSize }) {
  const [w, h] = outputPixels(aspectRatio, outputSize);
  execFileSync(ffmpegBin(), [
    '-y',
    '-i', inputPath,
    '-vf', `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=30,format=yuv420p`,
    '-map', '0:v:0',
    '-map', '0:a?',
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '22',
    '-c:a', 'aac',
    '-movflags', '+faststart',
    outputPath,
  ], { stdio: 'pipe', timeout: 300000 });
  assertVideo(outputPath, 'render track');
  return outputPath;
}

function assertVideo(filePath, label) {
  if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).size < 1000) {
    throw new Error(`${label} output is invalid`);
  }
}

async function synthesizeSpeechTrack({ text, voiceId, taskDir, onProgress }) {
  const { generateSpeech } = require('../services/ttsService');
  const outputBase = path.join(taskDir, 'speech_track');
  onProgress?.({ stage: 'speech_track', progress: 18, message: 'Generating speech track' });
  const audioPath = await generateSpeech(text, outputBase, { voiceId: voiceId || null, speed: 1.0 });
  if (!audioPath || !fs.existsSync(audioPath)) throw new Error('speech track generation failed');
  return audioPath;
}

async function compositePersonOverBackground({
  personVideoPath,
  backgroundTrackPath,
  outputPath,
  aspectRatio,
  outputSize,
  taskDir,
  onProgress,
}) {
  const [width, height] = outputPixels(aspectRatio, outputSize);
  try {
    const { matteVideo, composeWithBackground } = require('./videoMattingPipeline');
    const mattedPath = path.join(taskDir, 'person_track_alpha.mov');
    onProgress?.({ stage: 'person_matting', progress: 88, message: 'Matting presenter action track' });
    await matteVideo(personVideoPath, mattedPath, {
      fps: 12,
      qps: 4,
      tmpDir: path.join(taskDir, 'matting_frames'),
      onProgress: info => {
        const suffix = info?.total ? ` ${info.done || 0}/${info.total}` : '';
        onProgress?.({ stage: 'person_matting', progress: 88, message: `Matting presenter action track${suffix}` });
      },
    });
    onProgress?.({ stage: 'composite_track', progress: 94, message: 'Compositing presenter over locked background' });
    await composeWithBackground(mattedPath, backgroundTrackPath, outputPath, {
      width,
      height,
      scaleMode: 'cover',
    });
    assertVideo(outputPath, 'composite track');
    return { path: outputPath, alphaPath: mattedPath, usedMatting: true };
  } catch (err) {
    console.warn('[AdTracks] matting composite failed:', err.message);
    onProgress?.({
      stage: 'person_matting_failed',
      progress: 94,
      message: `Presenter matting failed: ${err.message}`,
      warning: err.message,
    });
    err.code = err.code || 'PERSON_MATTING_FAILED';
    throw err;
  }
}

async function submitPersonActionTrack({ req, presenterImageUrl, text, voiceId, title, aspectRatio, outputSize, taskDir, onProgress }) {
  const base = publicBaseUrl(req);
  const headers = req.headers.authorization ? { Authorization: req.headers.authorization } : {};
  let promptKbContext = '';
  try {
    const kb = require('./knowledgeBaseService');
    promptKbContext = kb.injectKB({
      scene: 'showroom_guide',
      query: [title, text, 'ordinary digital human ad presenter scene character voice action camera prompt'].filter(Boolean).join('\n'),
      limit: 3,
      maxCharsPerDoc: 420,
    });
  } catch {}
  onProgress?.({ stage: 'person_action_submit', progress: 35, message: 'Submitting presenter action track' });
  const response = await axios.post(`${base}/api/avatar/jimeng-omni/generate`, {
    image_url: presenterImageUrl,
    text,
    audio_url: null,
    voiceId: voiceId || null,
    title: title || 'showroom guide tracks',
    prompt: [
      'Showroom guide presenter action track. Preserve the confirmed presenter identity, gender, outfit, face, and body proportions from the input image.',
      'This track will be professionally matted and composited over the locked uploaded background later; do not invent a new showroom, second room, poster, inset, or extra people.',
      'The presenter speaks naturally with visible lip sync and real docent actions: one or two small forward/diagonal steps, torso turning toward the display area, an open-palm sweep, a clear pointing gesture toward the material/product, then gaze returns to camera.',
      'Stable continuous guide shot with real spatial motion: gentle dolly-in or lateral truck, visible foreground/background parallax, natural focus shift from presenter to display details and back. Do not fake this with a static crop zoom.',
      'Action template: enter or settle from the left third, walk half a step forward, lift the hand into frame, point or sweep across the display wall, pause on the key detail, return gaze to camera, confident ending nod.',
      'Voice delivery should feel commercial but natural: warm opening, confident explanation, slightly lifted recommendation ending.',
      'No extra people, no generated captions, no watermark, no gender change, no outfit change.',
      promptKbContext ? `Prompt engineer constraints and reusable prompt notes:\n${promptKbContext}` : '',
    ].join(' '),
    speed: 1.0,
    textEffects: [],
    stickers: [],
    cameraMotion: 'handheld',
    cameraSegments: [
      { start: 0, end: 0.3, camera: 'dolly_in', intent: 'guide takes a small step into position and opens the scene depth' },
      { start: 0.3, end: 0.75, camera: 'lateral_truck', intent: 'follow the guide gesture toward the material or product area with parallax' },
      { start: 0.75, end: 1, camera: 'focus_return', intent: 'settle back on the guide face after the pointing gesture' },
    ],
    coverWatermark: true,
    aspectRatio,
    ratio: aspectRatio,
    output_size: outputSize,
    resolution: outputSizeString(aspectRatio, outputSize),
    kind: 'production',
    agentId: 'ad_avatar.showroom_guide_tracks.person_action',
  }, { headers, timeout: 30000 });

  if (!response.data?.success || !response.data?.taskId) {
    throw new Error(response.data?.error || 'person action track submit failed');
  }

  const linkedTaskId = response.data.taskId;
  onProgress?.({ stage: 'person_action_rendering', progress: 48, message: 'Rendering presenter action track', linkedTaskId });

  const startedAt = Date.now();
  while (Date.now() - startedAt < 50 * 60 * 1000) {
    await sleep(6000);
    const status = await axios.get(`${base}/api/avatar/jimeng-omni/tasks/${linkedTaskId}`, { headers, timeout: 20000 }).catch(() => null);
    const linked = status?.data?.task;
    if (!linked) continue;

    onProgress?.({
      stage: 'person_action_rendering',
      progress: Math.min(86, 52 + Math.round((Date.now() - startedAt) / 30000)),
      message: linked.fallback_message || linked.stage || 'Rendering presenter action track',
      linkedTaskId,
      actual_provider: linked.actual_provider,
      actual_model: linked.actual_model,
    });

    if (linked.status === 'error') throw new Error(linked.error || 'person action track failed');
    if (linked.status === 'done' && (linked.local_path || linked.video_url || linked.videoUrl)) {
      const localPath = linked.local_path || linked.videoPath || '';
      if (localPath && fs.existsSync(localPath)) {
        const copyPath = path.join(taskDir, 'person_action_track.mp4');
        fs.copyFileSync(localPath, copyPath);
        return { path: copyPath, linkedTaskId, linked };
      }
      const videoUrl = linked.video_url || linked.videoUrl;
      const downloaded = path.join(taskDir, 'person_action_track.mp4');
      await downloadAsset(req, videoUrl, downloaded);
      return { path: downloaded, linkedTaskId, linked };
    }
  }

  throw new Error('person action track polling timed out');
}

function publicAssetUrl(req, filename) {
  return `${publicBaseUrl(req)}/public/jimeng-assets/${filename}`;
}

function publishFinalVideo(req, taskId, sourcePath, outputDir) {
  const name = `ad_showroom_tracks_${taskId}.mp4`;
  const dest = path.join(outputDir, name);
  if (path.resolve(sourcePath) !== path.resolve(dest)) fs.copyFileSync(sourcePath, dest);
  return { localPath: dest, publicUrl: publicAssetUrl(req, name) };
}

async function runShowroomGuideTracksTask({
  req,
  taskId,
  input,
  avatar = null,
  tasks,
  patchTask,
  outputDir,
}) {
  const taskDir = path.join(outputDir, `ad_showroom_tracks_${taskId}`);
  fs.mkdirSync(taskDir, { recursive: true });

  const patch = update => {
    if (typeof patchTask === 'function') patchTask(taskId, update);
    else if (tasks?.has(taskId)) tasks.set(taskId, { ...tasks.get(taskId), ...update, updated_at: new Date().toISOString() });
  };

  const aspectRatio = normalizeAspectRatio(input.aspect_ratio || input.aspectRatio, '16:9');
  const outputSize = normalizeOutputSize(input.output_size || input.outputSize);
  const durationSec = Math.max(8, Math.min(60, Number(input.duration_sec) || Math.ceil(String(input.text || '').length / 4) || 16));
  const keyframes = Array.isArray(input.keyframes) ? input.keyframes : [];
  const presenterFrame = keyframes.find(k => k?.guide_asset_url || k?.shot_plan?.guide_asset_url || k?.plan?.guide_asset_url || k?.image_url) || {};
  const presenterImageUrl = presenterFrame.guide_asset_url
    || presenterFrame.shot_plan?.guide_asset_url
    || presenterFrame.plan?.guide_asset_url
    || presenterFrame.image_url
    || avatar?.image_url
    || '';

  try {
    if (!input.background_url) throw new Error('background_url is required');
    if (!String(input.text || '').trim()) throw new Error('text is required');
    if (!String(input.voice_id || '').trim()) throw new Error('voice_id is required');
    if (!presenterImageUrl) {
      throw new Error('showroom_guide_tracks requires a confirmed guide keyframe or avatar image');
    }

    patch({ status: 'running', stage: 'background_track', progress: 8, message: 'Building locked background track' });
    const bgSource = path.join(taskDir, `background_source${guessExtFromUrl(input.background_url)}`);
    await downloadAsset(req, input.background_url, bgSource);
    const backgroundTrack = createBackgroundTrack({
      inputPath: bgSource,
      outputPath: path.join(taskDir, 'background_track.mp4'),
      durationSec,
      aspectRatio,
      outputSize,
    });

    let speechTrack = '';
    try {
      speechTrack = await synthesizeSpeechTrack({
        text: String(input.text || '').trim(),
        voiceId: input.voice_id,
        taskDir,
        onProgress: patch,
      });
    } catch (speechErr) {
      console.warn('[AdTracks] standalone speech track skipped:', speechErr.message);
      patch({ stage: 'speech_track_warning', progress: 22, message: `Standalone speech track skipped: ${speechErr.message}` });
    }

    const personTrack = await submitPersonActionTrack({
      req,
      presenterImageUrl,
      text: String(input.text || '').trim(),
      voiceId: input.voice_id,
      title: input.title,
      aspectRatio,
      outputSize,
      taskDir,
      onProgress: patch,
    });

    patch({ stage: 'composite_track', progress: 87, message: 'Compositing presenter and locked background tracks' });
    const compositeTrack = await compositePersonOverBackground({
      personVideoPath: personTrack.path,
      backgroundTrackPath: backgroundTrack,
      outputPath: path.join(taskDir, 'composite_track.mp4'),
      aspectRatio,
      outputSize,
      taskDir,
      onProgress: patch,
    });
    const published = publishFinalVideo(req, taskId, compositeTrack.path, outputDir);

    const manifest = {
      version: 1,
      mode: 'showroom_guide_tracks',
      taskId,
      tracks: {
        background: { type: 'locked_background_video', path: backgroundTrack, source_url: input.background_url },
        speech: { type: 'tts_audio', path: speechTrack || '', voice_id: input.voice_id, optional: true },
        person_action: { type: 'lip_sync_action_video', path: personTrack.path, source_url: presenterImageUrl, linkedTaskId: personTrack.linkedTaskId },
        composite: {
          type: 'alpha_person_over_locked_background',
          path: compositeTrack.path,
          alpha_path: compositeTrack.alphaPath || '',
          warning: compositeTrack.warning || '',
        },
        render: { type: 'final_video', path: published.localPath, public_url: published.publicUrl },
      },
      constraints: {
        isolated_route_branch: true,
        does_not_modify_avatar_routes: true,
        does_not_touch_product_or_luxury_ad: true,
      },
      created_at: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(taskDir, 'tracks_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    const taskData = {
      id: taskId,
      taskId,
      status: 'done',
      stage: 'done',
      progress: 100,
      message: 'Showroom guide tracks video completed',
      title: input.title || 'showroom guide tracks',
      text: input.text,
      avatar_id: input.avatar_id || '',
      background_url: input.background_url,
      keyframes: keyframes.map(k => ({ image_url: k.image_url, keyframe_id: k.keyframe_id || '', reference_mode: k.reference_mode || '' })),
      keyframeUrl: presenterImageUrl,
      image_url: presenterImageUrl || input.background_url,
      thumbnail_url: presenterImageUrl || input.background_url,
      videoPath: published.localPath,
      local_path: published.localPath,
      videoUrl: `/api/avatar/tasks/${taskId}/stream`,
      video_url: published.publicUrl,
      kind: 'production',
      mode: 'digital_ad',
      generation_mode: 'showroom_guide_tracks',
      ad_mode: 'showroom_guide',
      track_mode: 'independent_three_tracks',
      tracks_manifest_path: path.join(taskDir, 'tracks_manifest.json'),
      linkedTaskId: personTrack.linkedTaskId,
      user_id: tasks?.get(taskId)?.user_id || req.user?.id || null,
      ratio: aspectRatio,
      output_size: outputSize,
      resolution: outputSizeString(aspectRatio, outputSize),
      duration_sec: durationSec,
      actual_provider: personTrack.linked?.actual_provider,
      actual_model: personTrack.linked?.actual_model,
      created_at: tasks?.get(taskId)?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (tasks?.has(taskId)) tasks.set(taskId, { ...tasks.get(taskId), ...taskData });
    if (!db.getAvatarTask(taskId)) db.insertAvatarTask(taskData);
    else db.updateAvatarTask(taskId, taskData);
  } catch (err) {
    const errorData = {
      status: 'error',
      stage: 'error',
      error: err.message,
      message: err.message,
      updated_at: new Date().toISOString(),
    };
    patch(errorData);
    const current = tasks?.get(taskId) || {};
    const taskData = {
      ...current,
      ...errorData,
      id: taskId,
      taskId,
      kind: 'production',
      mode: 'digital_ad',
      generation_mode: 'showroom_guide_tracks',
      ad_mode: 'showroom_guide',
      track_mode: 'independent_three_tracks',
      user_id: current.user_id || req.user?.id || null,
      created_at: current.created_at || new Date().toISOString(),
    };
    if (!db.getAvatarTask(taskId)) db.insertAvatarTask(taskData);
    else db.updateAvatarTask(taskId, taskData);
  }
}

function buildInitialTask({ taskId, input, avatar, userId }) {
  const aspectRatio = normalizeAspectRatio(input.aspect_ratio || input.aspectRatio, '16:9');
  const outputSize = normalizeOutputSize(input.output_size || input.outputSize);
  return {
    id: taskId,
    taskId,
    status: 'submitted',
    stage: 'submitted',
    progress: 3,
    message: 'Submitted showroom guide tracks task',
    avatar_id: input.avatar_id || '',
    background_url: input.background_url || '',
    voice_id: input.voice_id || null,
    title: input.title || 'showroom guide tracks',
    text: input.text || '',
    duration_sec: input.duration_sec || null,
    subtitle: input.subtitle || null,
    keyframes: Array.isArray(input.keyframes) ? input.keyframes : [],
    user_id: userId || null,
    created_at: new Date().toISOString(),
    started_at: Date.now(),
    kind: 'production',
    mode: 'digital_ad',
    generation_mode: 'showroom_guide_tracks',
    ad_mode: 'showroom_guide',
    track_mode: 'independent_three_tracks',
    guide_gender: input.guide_gender || avatar?.gender || '',
    ratio: aspectRatio,
    output_size: outputSize,
    resolution: outputSizeString(aspectRatio, outputSize),
  };
}

module.exports = {
  buildInitialTask,
  runShowroomGuideTracksTask,
  normalizeAspectRatio,
  normalizeOutputSize,
  outputSizeString,
};
