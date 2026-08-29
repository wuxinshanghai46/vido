const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const cancellation = require('./cancellationContext');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;
const videoAdapter = require('./videoAdapter');
const ttsAdapter = require('./ttsAdapter');
const mediaAdapter = require('./mediaAdapter');
const finalVideoQa = require('./finalVideoQaService');

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

function ffmpegDurationBudgetMs(durationSec = 0, minimumMs = 360000) {
  return Math.max(minimumMs, Math.ceil(Math.max(1, Number(durationSec) || 1) * 3000));
}

function hasAudioStream(filePath = '') {
  if (!filePath || !fs.existsSync(filePath) || !ffprobePath) return Promise.resolve(false);
  return new Promise(resolve => {
    const child = spawn(ffprobePath, [
      '-v', 'error',
      '-select_streams', 'a:0',
      '-show_entries', 'stream=index',
      '-of', 'csv=p=0',
      filePath,
    ], { windowsHide: true });
    let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.on('error', () => resolve(false));
    child.on('close', code => resolve(code === 0 && !!stdout.trim()));
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

function normalizeBrandOverlay(overlay = {}) {
  const source = overlay && typeof overlay === 'object' ? overlay : {};
  const asset = source.asset && typeof source.asset === 'object' ? source.asset : null;
  if (source.enabled !== true) return { enabled: false };
  if (source.authorization_confirmed !== true) {
    const error = new Error('品牌 Logo 后期叠加尚未确认素材授权，本次未合成。');
    error.code = 'BRAND_ASSET_AUTHORIZATION_REQUIRED';
    error.status = 422;
    throw error;
  }
  const rawUrl = normalizeLocalUrl(asset?.file_url || asset?.image_url || asset?.url || '').split('?')[0];
  const prefix = '/api/new-story-ad/assets/';
  const filePath = rawUrl.startsWith(prefix)
    ? mediaAdapter.assetPathFromName(decodeURIComponent(rawUrl.slice(prefix.length)))
    : '';
  if (!filePath || !fs.existsSync(filePath)) {
    const error = new Error('已授权品牌 Logo 素材不存在或不是本项目上传文件，本次未合成。');
    error.code = 'BRAND_ASSET_UNAVAILABLE';
    error.status = 422;
    throw error;
  }
  const allowedPositions = new Set(['top_left', 'top_right', 'center', 'bottom_left', 'bottom_center', 'bottom_right']);
  const position = allowedPositions.has(String(source.position || '')) ? String(source.position) : 'bottom_center';
  return {
    enabled: true,
    file_path: filePath,
    asset_id: String(asset?.id || ''),
    position,
    width_percent: Math.max(8, Math.min(45, Number(source.width_percent ?? 22) || 22)),
    margin_percent: Math.max(0, Math.min(20, Number(source.margin_percent ?? 5) || 5)),
    end_duration_sec: Math.max(0.5, Math.min(15, Number(source.end_duration_sec ?? 3) || 3)),
  };
}

async function applyBrandOverlay(videoPath = '', overlay = {}, outputPath = '') {
  if (!overlay.enabled) return videoPath;
  const duration = Math.max(0.2, await videoAdapter.probeDuration(videoPath));
  const holdDuration = Math.max(0.5, Math.min(15, Number(overlay.end_duration_sec || 3) || 3));
  const finalDuration = duration + holdDuration;
  const margin = overlay.margin_percent / 100;
  const positions = {
    top_left: [`W*${margin}`, `H*${margin}`],
    top_right: [`W-w-W*${margin}`, `H*${margin}`],
    center: ['(W-w)/2', '(H-h)/2'],
    bottom_left: [`W*${margin}`, `H-h-H*${margin}`],
    bottom_center: ['(W-w)/2', `H-h-H*${margin}`],
    bottom_right: [`W-w-W*${margin}`, `H-h-H*${margin}`],
  };
  const [x, y] = positions[overlay.position] || positions.bottom_center;
  const widthRatio = overlay.width_percent / 100;
  const filter = `[0:v]tpad=stop_mode=clone:stop_duration=${holdDuration.toFixed(3)}[scenehold];`
    + `[1:v][scenehold]scale2ref=w=main_w*${widthRatio}:h=ow/mdar[logo][base];`
    + `[base][logo]overlay=x=${x}:y=${y}:enable='gte(t,${duration.toFixed(3)})'[v]`;
  await execFfmpeg([
    '-y', '-i', videoPath, '-loop', '1', '-i', overlay.file_path,
    '-filter_complex', filter,
    '-map', '[v]', '-map', '0:a?',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'copy', '-t', finalDuration.toFixed(3), '-movflags', '+faststart', outputPath,
  ], ffmpegDurationBudgetMs(finalDuration));
  return outputPath;
}

function buildVisualComposeUnits(clips = []) {
  const units = [];
  (Array.isArray(clips) ? clips : []).forEach((clip, index) => {
    const source = clip?.scene_block_source_file && fs.existsSync(clip.scene_block_source_file)
      ? clip.scene_block_source_file
      : localVideoPath(clip || {});
    if (!source) return;
    const previous = units[units.length - 1];
    const canJoinMother = !!clip.scene_block_id
      && !!clip.scene_block_source_file
      && previous?.scene_block_id === clip.scene_block_id
      && previous.file_path === source;
    if (canJoinMother) {
      previous.clips.push(clip);
      previous.member_indexes.push(index);
      previous.timeline_beats.push({
        shot_index: index + 1,
        start_sec: Number(clip.scene_block_start_sec || 0),
        end_sec: Number(clip.scene_block_end_sec || 0),
        planned_start_sec: Number(clip.planned_scene_block_start_sec ?? clip.scene_block_start_sec ?? 0),
        planned_end_sec: Number(clip.planned_scene_block_end_sec ?? clip.scene_block_end_sec ?? 0),
      });
      previous.last_index = index;
      return;
    }
    units.push({
      file_path: source,
      source_file_path: source,
      scene_block_id: clip.scene_block_id || '',
      clips: [clip],
      member_indexes: [index],
      first_index: index,
      last_index: index,
      preserved_continuous_source: !!(clip.scene_block_id && clip.scene_block_source_file),
      timeline_beats: [{
        shot_index: index + 1,
        start_sec: Number(clip.scene_block_start_sec || 0),
        end_sec: Number(clip.scene_block_end_sec || clip.duration_sec || 0),
        planned_start_sec: Number(clip.planned_scene_block_start_sec ?? clip.scene_block_start_sec ?? 0),
        planned_end_sec: Number(clip.planned_scene_block_end_sec ?? clip.scene_block_end_sec ?? clip.duration_sec ?? 0),
      }],
    });
  });
  return units;
}

async function muxTimelineVoiceTracks(videoPath = '', placements = [], outputPath = '', durationSec = 0, voiceVolume = 1, ensureAudio = false) {
  const duration = Math.max(0.2, Number(durationSec) || await videoAdapter.probeDuration(videoPath));
  const valid = placements.filter(item => item.audio_path && fs.existsSync(item.audio_path));
  if (!valid.length && !ensureAudio) return videoPath;
  const args = ['-y', '-i', videoPath];
  valid.forEach(item => args.push('-i', item.audio_path));
  const sourceHasAudio = await hasAudioStream(videoPath);
  const filters = [sourceHasAudio
    ? `[0:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:${duration.toFixed(3)},asetpts=PTS-STARTPTS[abase]`
    : `anullsrc=r=44100:cl=stereo,atrim=0:${duration.toFixed(3)}[abase]`];
  const audioLabels = ['[abase]'];
  valid.forEach((item, index) => {
    const delay = Math.max(0, Math.round(Number(item.offset_sec || 0) * 1000));
    const clipDuration = Math.max(0.1, Number(item.duration_sec || duration));
    filters.push(`[${index + 1}:a]atrim=0:${clipDuration.toFixed(3)},asetpts=PTS-STARTPTS,adelay=${delay}|${delay},volume=${clampVolume(voiceVolume, 1, 0.6, 1.2)}[av${index}]`);
    audioLabels.push(`[av${index}]`);
  });
  filters.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=first:dropout_transition=0,atrim=0:${duration.toFixed(3)}[aout]`);
  args.push(
    '-filter_complex', filters.join(';'), '-map', '0:v:0', '-map', '[aout]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-t', duration.toFixed(3),
    '-movflags', '+faststart', outputPath,
  );
  await execFfmpeg(args, 240000);
  return outputPath;
}

async function muxVoiceTrack(videoPath = '', audioPath = '', outputPath = '') {
  if (!videoPath || !audioPath || !outputPath) return videoPath;
  const duration = Math.max(0.2, await videoAdapter.probeDuration(videoPath));
  await execFfmpeg([
    '-y', '-i', videoPath, '-i', audioPath,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k',
    '-af', `apad,atrim=0:${duration.toFixed(3)}`, '-t', duration.toFixed(3),
    '-movflags', '+faststart', outputPath,
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

function transitionType(item = {}) {
  return String(item?.transition_type || item?.transitionType || 'hard_cut').trim().toLowerCase() || 'hard_cut';
}

function buildTransitionPlan(clips = [], transitions = [], durations = []) {
  return clips.map((clip, index) => {
    const authored = transitionType({
      ...(transitions[index] || {}),
      ...(clip?.transition_override ? { transition_type: clip.transition_override } : {}),
    });
    const previous = index > 0 ? clips[index - 1] || {} : {};
    const sameContinuousSource = index > 0
      && clip?.scene_block_id
      && clip.scene_block_id === previous.scene_block_id
      && Array.isArray(clip.scene_block_members)
      && clip.scene_block_members.length > 1;
    const effect = sameContinuousSource
      ? 'continuous_source_cut'
      : (authored === 'dissolve'
          ? 'dissolve'
          : (authored === 'fade'
              ? 'fade_black'
              : (authored === 'cut_on_action'
                  ? 'cut_on_action'
                  : (authored === 'match_cut' ? 'match_cut' : 'hard_cut'))));
    const available = index > 0 ? Math.min(Number(durations[index - 1] || 0), Number(durations[index] || 0)) : 0;
    const requestedDuration = Math.max(0, Math.min(
      2,
      Number(transitions[index]?.transition_duration_sec ?? transitions[index]?.transitionDurationSec ?? 0) || 0,
    ));
    const overlap = ['dissolve', 'fade_black'].includes(effect)
      ? Math.max(0, Math.min(requestedDuration || 0.35, available / 3))
      : 0;
    const audioBridge = transitions[index]?.audio_bridge || transitions[index]?.audioBridge || '';
    const requestedAudioOverlap = Math.max(0, Math.min(
      1.5,
      Number(transitions[index]?.audio_bridge_duration_sec ?? transitions[index]?.audioBridgeDurationSec ?? 0) || 0,
    ));
    const audioOverlap = index > 0 && audioBridge
      ? Math.max(0.05, Math.min(requestedAudioOverlap || 0.35, available / 3))
      : overlap;
    return {
      shot_index: index + 1,
      first_shot_index: Number(clip?._first_shot_index || index + 1),
      type: authored,
      reason: transitions[index]?.transition_reason || transitions[index]?.transitionReason || '',
      audio_bridge: audioBridge,
      audio_bridge_execution: audioBridge ? 'j_cut_crossfade' : (overlap > 0 ? 'transition_crossfade' : 'none'),
      execution: effect,
      overlap_sec: Number(overlap.toFixed(3)),
      audio_overlap_sec: Number(audioOverlap.toFixed(3)),
      match_anchor: transitions[index]?.transition_match_anchor || transitions[index]?.transitionMatchAnchor || '',
      verification_required: ['cut_on_action', 'match_cut'].includes(effect),
      same_continuous_source: sameContinuousSource,
    };
  });
}

async function composeWithTransitionFilters(inputs = [], outputPath = '', plan = [], durations = []) {
  const args = ['-y'];
  inputs.forEach(input => args.push('-i', input));
  const filters = [];
  inputs.forEach((_, index) => {
    filters.push(`[${index}:v]fps=30,settb=AVTB,setpts=PTS-STARTPTS,format=yuv420p[v${index}]`);
    filters.push(`[${index}:a]aresample=44100,asetpts=PTS-STARTPTS[a${index}]`);
  });
  let videoLabel = 'v0';
  let audioLabel = 'a0';
  let timeline = Number(durations[0] || 0);
  for (let index = 1; index < inputs.length; index += 1) {
    const row = plan[index] || {};
    const overlap = Number(row.overlap_sec || 0);
    const audioOverlap = Number(row.audio_overlap_sec || 0);
    const nextVideo = `vj${index}`;
    const nextAudio = `aj${index}`;
    if (overlap > 0) {
      const offset = Math.max(0, timeline - overlap);
      const previousHead = `vhead${index}`;
      const previousTail = `vtail${index}`;
      const previousVisible = `vpre${index}`;
      const outgoing = `vout${index}`;
      const incomingHead = `vinhead${index}`;
      const incomingTail = `vintail${index}`;
      const incoming = `vin${index}`;
      const incomingVisible = `vpost${index}`;
      const blended = `vblend${index}`;
      const rawVideo = `vraw${index}`;
      const blendExpression = row.execution === 'fade_black'
        ? `if(lt(T,${(overlap / 2).toFixed(6)}),A*(1-T/${(overlap / 2).toFixed(6)}),B*((T-${(overlap / 2).toFixed(6)})/${(overlap / 2).toFixed(6)}))`
        : `A*(1-T/${overlap.toFixed(6)})+B*(T/${overlap.toFixed(6)})`;
      filters.push(`[${videoLabel}]split=2[${previousHead}][${previousTail}]`);
      filters.push(`[${previousHead}]trim=start=0:end=${offset.toFixed(3)},setpts=PTS-STARTPTS[${previousVisible}]`);
      filters.push(`[${previousTail}]trim=start=${offset.toFixed(3)}:end=${timeline.toFixed(3)},setpts=PTS-STARTPTS[${outgoing}]`);
      filters.push(`[v${index}]split=2[${incomingHead}][${incomingTail}]`);
      filters.push(`[${incomingHead}]trim=start=0:end=${overlap.toFixed(3)},setpts=PTS-STARTPTS[${incoming}]`);
      filters.push(`[${incomingTail}]trim=start=${overlap.toFixed(3)},setpts=PTS-STARTPTS[${incomingVisible}]`);
      filters.push(`[${outgoing}][${incoming}]blend=all_expr='${blendExpression}'[${blended}]`);
      filters.push(`[${previousVisible}][${blended}][${incomingVisible}]concat=n=3:v=1:a=0[${rawVideo}]`);
      filters.push(`[${rawVideo}]fps=30,settb=AVTB,setpts=PTS-STARTPTS[${nextVideo}]`);
      if (audioOverlap > 0) {
        filters.push(`[${audioLabel}][a${index}]acrossfade=d=${audioOverlap.toFixed(3)}:c1=tri:c2=tri[${nextAudio}]`);
      } else {
        filters.push(`[${audioLabel}][a${index}]concat=n=2:v=0:a=1[${nextAudio}]`);
      }
      timeline += Number(durations[index] || 0) - overlap;
    } else {
      const rawVideo = `vraw${index}`;
      filters.push(`[${videoLabel}][v${index}]concat=n=2:v=1:a=0[${rawVideo}]`);
      filters.push(`[${rawVideo}]fps=30,settb=AVTB,setpts=PTS-STARTPTS[${nextVideo}]`);
      if (audioOverlap > 0) {
        filters.push(`[${audioLabel}][a${index}]acrossfade=d=${audioOverlap.toFixed(3)}:c1=tri:c2=tri[${nextAudio}]`);
      } else {
        filters.push(`[${audioLabel}][a${index}]concat=n=2:v=0:a=1[${nextAudio}]`);
      }
      timeline += Number(durations[index] || 0);
    }
    videoLabel = nextVideo;
    audioLabel = nextAudio;
  }
  const finalAudio = 'afinal';
  filters.push(`[${audioLabel}]apad,atrim=0:${Math.max(0.2, timeline).toFixed(3)},asetpts=PTS-STARTPTS[${finalAudio}]`);
  args.push(
    '-filter_complex', filters.join(';'),
    '-map', `[${videoLabel}]`, '-map', `[${finalAudio}]`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2',
    '-movflags', '+faststart', outputPath,
  );
  await execFfmpeg(args, ffmpegDurationBudgetMs(timeline));
}

function transitionTimelineDuration(durations = [], plan = []) {
  return Math.max(0, durations.reduce((sum, value) => sum + Number(value || 0), 0)
    - plan.reduce((sum, row) => sum + Number(row?.overlap_sec || 0), 0));
}

async function composeTransitionHierarchy(inputs = [], outputPath = '', plan = [], durations = [], {
  taskId = '',
  groupSize = 12,
  level = 1,
} = {}) {
  const width = Math.max(2, Math.min(16, Number(groupSize) || 12));
  if (inputs.length <= width) {
    await composeWithTransitionFilters(inputs, outputPath, plan, durations);
    return { outputPath, duration: transitionTimelineDuration(durations, plan), levels: level };
  }
  const nextInputs = [];
  const nextDurations = [];
  const nextPlan = [];
  for (let start = 0, groupIndex = 0; start < inputs.length; start += width, groupIndex += 1) {
    const groupInputs = inputs.slice(start, start + width);
    const groupDurations = durations.slice(start, start + width);
    const groupPlan = plan.slice(start, start + width).map((row, index) => index === 0
      ? { ...row, overlap_sec: 0, audio_overlap_sec: 0, execution: 'hard_cut', audio_bridge_execution: 'none' }
      : row);
    const groupPath = path.join(COMPOSE_DIR, `${safeBase(`transition_${taskId || 'task'}_l${level}_g${groupIndex + 1}_${Date.now()}`)}.mp4`);
    await composeWithTransitionFilters(groupInputs, groupPath, groupPlan, groupDurations);
    nextInputs.push(groupPath);
    nextDurations.push(transitionTimelineDuration(groupDurations, groupPlan));
    nextPlan.push(groupIndex === 0
      ? { ...plan[start], overlap_sec: 0, audio_overlap_sec: 0, execution: 'hard_cut', audio_bridge_execution: 'none' }
      : plan[start]);
  }
  return composeTransitionHierarchy(nextInputs, outputPath, nextPlan, nextDurations, {
    taskId,
    groupSize: width,
    level: level + 1,
  });
}

async function conformVideoDuration(inputPath = '', targetDurationSec = 0, outputPath = '') {
  const target = Math.max(0, Number(targetDurationSec) || 0);
  if (!target) return inputPath;
  const actual = Math.max(0.2, await videoAdapter.probeDuration(inputPath));
  if (Math.abs(actual - target) <= 0.25) return inputPath;
  const videoRatio = target / actual;
  const args = ['-y', '-i', inputPath, '-map', '0:v:0', '-map', '0:a?', '-filter:v', `setpts=${videoRatio.toFixed(8)}*PTS`];
  if (await hasAudioStream(inputPath)) args.push('-filter:a', audioTempoFilter(1 / videoRatio));
  args.push(
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-t', target.toFixed(3), '-movflags', '+faststart', outputPath,
  );
  await execFfmpeg(args, ffmpegDurationBudgetMs(target));
  return outputPath;
}

function audioTempoFilter(rate = 1) {
  let remaining = Math.max(0.01, Number(rate) || 1);
  const factors = [];
  while (remaining > 2) {
    factors.push(2);
    remaining /= 2;
  }
  while (remaining < 0.5) {
    factors.push(0.5);
    remaining /= 0.5;
  }
  factors.push(remaining);
  return factors.map(value => `atempo=${value.toFixed(8)}`).join(',');
}

function adjustSubtitlesForTransitionOverlaps(subtitles = [], plan = []) {
  return subtitles.map(item => {
    const shotIndex = Math.max(1, Number(item?.shot_index || 1));
    const shift = plan.slice(1).filter(row => Number(row.first_shot_index || row.shot_index || 1) <= shotIndex)
      .reduce((sum, row) => sum + Number(row.overlap_sec || 0), 0);
    return {
      ...item,
      startTime: Math.max(0, Number(item.startTime || 0) - shift),
      endTime: Math.max(0, Number(item.endTime || 0) - shift),
    };
  });
}

async function mixTimelineSound(videoPath = '', tracks = [], outputPath = '') {
  const usable = (Array.isArray(tracks) ? tracks : []).filter(track => track?.file_path && fs.existsSync(track.file_path));
  if (!usable.length) return videoPath;
  const duration = Math.max(0.2, await videoAdapter.probeDuration(videoPath));
  const args = ['-y', '-i', videoPath];
  usable.forEach(track => args.push('-i', track.file_path));
  const filters = ['[0:a]aformat=sample_rates=48000:channel_layouts=stereo[base]'];
  usable.forEach((track, index) => {
    const delay = Math.max(0, Math.round(Number(track.timeline_start_sec || 0) * 1000));
    const length = Math.max(0.05, Number(track.duration_sec || duration) || duration);
    const volume = clampVolume(track.volume, 0.35, 0, 1);
    filters.push(`[${index + 1}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:${length.toFixed(3)},adelay=${delay}|${delay},volume=${volume}[sound${index}]`);
  });
  filters.push(`[base]${usable.map((_, index) => `[sound${index}]`).join('')}amix=inputs=${usable.length + 1}:duration=first:dropout_transition=0:normalize=0[mixed]`);
  args.push('-filter_complex', filters.join(';'), '-map', '0:v:0', '-map', '[mixed]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', duration.toFixed(3), '-movflags', '+faststart', outputPath);
  await execFfmpeg(args, ffmpegDurationBudgetMs(duration));
  return outputPath;
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
  brandOverlay = null,
  targetDurationSec = 0,
  soundTracks = [],
} = {}) {
  ensureDir(COMPOSE_DIR);
  const visualUnits = buildVisualComposeUnits(clips);
  const rawInputs = visualUnits.map(unit => unit.file_path);
  if (!rawInputs.length) throw new Error('最终合成至少需要一个已通过审核的本地视频镜头。');
  const tracks = Array.isArray(ttsAudio?.tracks) ? ttsAudio.tracks : (Array.isArray(ttsAudio) ? ttsAudio : []);
  const transitionRows = visualUnits.map(unit => transitions[unit.first_index] || {});
  const anyVoiceTrack = visualUnits.some(unit => unit.member_indexes.some(index => !!localAudioPath(tracks[index] || {})))
    || (Array.isArray(soundTracks) && soundTracks.length > 0);
  const authoredAudioTransitions = transitionRows.some((row, index) => index > 0
    && (['dissolve', 'fade'].includes(transitionType(row)) || String(row?.audio_bridge || row?.audioBridge || '').trim()));
  const inputs = [];
  const durations = [];
  let voiceTrackCount = 0;
  for (let index = 0; index < visualUnits.length; index += 1) {
    const unit = visualUnits[index];
    const duration = Math.max(0.2, await videoAdapter.probeDuration(unit.file_path));
    const placements = unit.member_indexes.map((shotIndex, memberPosition) => {
      const audioPath = localAudioPath(tracks[shotIndex] || {});
      if (audioPath) voiceTrackCount += 1;
      const clip = unit.clips[memberPosition] || {};
      return {
        audio_path: audioPath,
        offset_sec: unit.preserved_continuous_source ? Number(clip.scene_block_start_sec || 0) : 0,
        duration_sec: Number(clip.duration_sec || duration),
      };
    }).filter(item => item.audio_path);
    const voiceFilename = `${safeBase(`voice_${taskId || 'task'}_unit_${index + 1}_${Date.now()}`)}.mp4`;
    const voicedPath = path.join(COMPOSE_DIR, voiceFilename);
    inputs.push(await muxTimelineVoiceTracks(unit.file_path, placements, voicedPath, duration, voiceVolume, anyVoiceTrack || authoredAudioTransitions));
    durations.push(duration);
  }
  const filename = `${safeBase(`nsa_final_${taskId || 'task'}_${Date.now()}`)}.mp4`;
  const out = path.join(COMPOSE_DIR, filename);
  const transitionClips = visualUnits.map(unit => ({ ...unit.clips[0], _first_shot_index: unit.first_index + 1 }));
  const transitionPlan = buildTransitionPlan(transitionClips, transitionRows, durations);
  const needsTransitionFilters = transitionPlan.some(row => (
    Number(row.overlap_sec || 0) > 0 || Number(row.audio_overlap_sec || 0) > 0
  ));
  if (inputs.length === 1) {
    fs.copyFileSync(inputs[0], out);
  } else if (needsTransitionFilters) {
    await composeTransitionHierarchy(inputs, out, transitionPlan, durations, { taskId });
  } else {
    const listFile = path.join(COMPOSE_DIR, `${safeBase(`concat_${taskId || 'task'}_${Date.now()}`)}.txt`);
    fs.writeFileSync(listFile, inputs.map(p => `file '${quoteConcatPath(p)}'`).join('\n'), 'utf8');
    await execFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', out]);
  }
  let finalPath = out;
  let finalUrl = publicComposeUrl(filename);
  let soundTrackCount = 0;
  if (Array.isArray(soundTracks) && soundTracks.length) {
    const soundFilename = `${safeBase(`sound_${taskId || 'task'}_${Date.now()}`)}.mp4`;
    const soundPath = path.join(COMPOSE_DIR, soundFilename);
    finalPath = await mixTimelineSound(finalPath, soundTracks, soundPath);
    finalUrl = publicComposeUrl(soundFilename);
    soundTrackCount = soundTracks.filter(track => track?.file_path && fs.existsSync(track.file_path)).length;
  }
  const bgmPath = localBgmPath(bgmAsset || {});
  const validSubtitles = subtitleEnabled
    ? adjustSubtitlesForTransitionOverlaps((Array.isArray(subtitles) ? subtitles : []).filter(item => item && item.text), transitionPlan)
    : [];
  const needsEffects = !!bgmPath || validSubtitles.length > 0;
  let providerUsed = `local-ffmpeg/new-story-ad-compose${needsTransitionFilters ? '+authored-transitions' : ''}${soundTrackCount ? '+timeline-sound' : ''}`;
  if (needsEffects) {
    const { applyEffects } = require('../effectsService');
    const fx = await applyEffects({
      videoPath: finalPath,
      texts: validSubtitles,
      bgm: bgmPath ? {
        path: bgmPath,
        volume: clampVolume(bgmVolume, 0.16, 0, 0.35),
        voice_volume: 1,
        fadeIn: 1,
        fadeOut: 2,
      } : null,
      voiceVolume: 1,
      subtitleStyle: subtitleStyle || 'popup',
    });
    if (fx?.outputPath && fs.existsSync(fx.outputPath)) {
      finalPath = fx.outputPath;
      finalUrl = effectsResultUrl(fx.outputPath);
      providerUsed += '+effects';
    }
  }
  const normalizedBrandOverlay = normalizeBrandOverlay(brandOverlay || {});
  if (normalizedBrandOverlay.enabled) {
    const brandedFilename = `${safeBase(`brand_${taskId || 'task'}_${Date.now()}`)}.mp4`;
    const brandedPath = path.join(COMPOSE_DIR, brandedFilename);
    await applyBrandOverlay(finalPath, normalizedBrandOverlay, brandedPath);
    finalPath = brandedPath;
    finalUrl = publicComposeUrl(brandedFilename);
    providerUsed += '+authorized-brand-overlay';
  }
  const requestedDurationSec = Math.max(0, Number(targetDurationSec) || 0);
  if (requestedDurationSec > 0) {
    const conformedFilename = `${safeBase(`duration_${taskId || 'task'}_${Date.now()}`)}.mp4`;
    const conformedPath = path.join(COMPOSE_DIR, conformedFilename);
    const conformed = await conformVideoDuration(finalPath, requestedDurationSec, conformedPath);
    if (conformed !== finalPath) {
      finalPath = conformed;
      finalUrl = publicComposeUrl(conformedFilename);
      providerUsed += '+target-duration-contract';
    }
  }
  const expectedDurationSec = requestedDurationSec || (transitionTimelineDuration(durations, transitionPlan)
    + (normalizedBrandOverlay.enabled ? normalizedBrandOverlay.end_duration_sec : 0));
  const technicalQa = await finalVideoQa.inspectFinalVideo({
    filePath: finalPath,
    expectedDurationSec,
    requireAudio: voiceTrackCount > 0 || soundTrackCount > 0 || !!bgmPath || authoredAudioTransitions,
    transitionPlan,
    inputDurations: durations,
  });
  if (!technicalQa.pass) {
    const error = new Error(`Final video technical QA failed: ${(technicalQa.problems || []).join('; ')}`);
    error.code = 'FINAL_VIDEO_TECHNICAL_QA_FAILED';
    error.status = 422;
    error.retryable = true;
    error.technical_qa = technicalQa;
    throw error;
  }
  return {
    filename,
    file_path: finalPath,
    source_file_path: out,
    video_url: finalUrl,
    videoUrl: finalUrl,
    clip_count: clips.length,
    visual_input_count: inputs.length,
    voiceover_applied: voiceTrackCount > 0,
    voiceover_track_count: voiceTrackCount,
    bgm_applied: !!bgmPath,
    sound_effects_applied: soundTrackCount > 0,
    sound_effect_track_count: soundTrackCount,
    audio_bridge_applied: transitionPlan.some(row => row.audio_bridge_execution === 'j_cut_crossfade'),
    audio_bridge_count: transitionPlan.filter(row => row.audio_bridge_execution === 'j_cut_crossfade').length,
    subtitle_applied: validSubtitles.length > 0,
    subtitle_style: subtitleStyle || 'popup',
    brand_overlay_applied: normalizedBrandOverlay.enabled,
    brand_overlay: normalizedBrandOverlay.enabled ? {
      asset_id: normalizedBrandOverlay.asset_id,
      position: normalizedBrandOverlay.position,
      width_percent: normalizedBrandOverlay.width_percent,
      margin_percent: normalizedBrandOverlay.margin_percent,
      end_duration_sec: normalizedBrandOverlay.end_duration_sec,
      mode: 'last_scene_hold',
      appended_duration_sec: normalizedBrandOverlay.end_duration_sec,
    } : null,
    provider_used: providerUsed,
    transition_plan: transitionPlan,
    visual_units: visualUnits.map(unit => ({
      source_file_path: unit.source_file_path,
      member_indexes: unit.member_indexes,
      preserved_continuous_source: unit.preserved_continuous_source,
      timeline_beats: unit.timeline_beats,
    })),
    technical_qa: technicalQa,
  };
}

module.exports = {
  COMPOSE_DIR,
  composePathFromName,
  publicComposeUrl,
  buildVisualComposeUnits,
  muxVoiceTrack,
  muxTimelineVoiceTracks,
  buildTransitionPlan,
  transitionTimelineDuration,
  composeTransitionHierarchy,
  conformVideoDuration,
  audioTempoFilter,
  adjustSubtitlesForTransitionOverlaps,
  normalizeBrandOverlay,
  applyBrandOverlay,
  mixTimelineSound,
  concatVideos,
};
