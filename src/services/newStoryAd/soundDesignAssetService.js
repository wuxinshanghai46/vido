'use strict';

const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const { execFileSync } = require('child_process');
const storage = require('./storageService');
const mediaAdapter = require('./mediaAdapter');

const PROFILE_KIND = 'scene_sound_profiles';
const ASSET_KIND = 'sound_assets';
const TIMELINE_KIND = 'audio_timeline';
const LEDGER_KIND = 'audio_license_ledger';
const ALLOWED_TRACKS = new Set(['room_tone', 'ambient', 'foley', 'sfx', 'transition', 'bgm']);
const OPEN_LICENSES = new Set(['cc0', 'pdm', 'by']);
const OPEN_AUDIO_HOSTS = Object.freeze(['cdn.freesound.org', 'upload.wikimedia.org', 'files.freemusicarchive.org', 'freemusicarchive.org', 'archive.org', 'storage.jamendo.com', 'mp3d.jamendo.com']);
const recentOpenverseSources = new Map();
const openverseCacheInflight = new Map();

function list(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }
function clean(value = '', max = 1000) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max); }
function recommendedTrack(shot = {}) { return list(shot.sfx).length ? 'sfx' : (clean(shot.ambient_sound, 260) ? 'ambient' : 'room_tone'); }
function shouldAutoRecommend(shot = {}) {
  // ambient_sound 是分镜的声音设计参考，不代表每镜都必须铺环境声。
  // 只有剧情明确写出的动作/拟音才主动推荐，普通环境底噪保持可选。
  return list(shot.sfx).some(value => clean(value, 160));
}
function recommendedQuery(shot = {}) {
  const source = clean(list(shot.sfx)[0] || shot.ambient_sound || shot.music_cue || 'room ambience', 260);
  const rules = [
    [/脚步|行走|走动/u, 'indoor footsteps'], [/金属|不锈钢|触摸|摩擦/u, 'metal touch'],
    [/展厅|展示厅|陈列/u, 'showroom ambience'], [/空调|底噪|室内/u, 'indoor room tone'],
    [/转场|切换/u, 'soft transition whoosh'], [/门|入口/u, 'interior door'],
  ];
  return rules.find(([pattern]) => pattern.test(source))?.[1] || source;
}
function sha256File(filePath = '') {
  if (!filePath || !fs.existsSync(filePath)) return '';
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
function localPath(asset = {}) {
  const filename = clean(asset.filename || String(asset.file_url || asset.url || '').split('/').pop()?.split('?')[0], 240);
  const cachedPath = filename ? mediaAdapter.assetPathFromName(filename) : '';
  if (asset.source === 'openverse' && cachedPath) {
    if (fs.existsSync(cachedPath) && fs.statSync(cachedPath).size >= 1000) return cachedPath;
    if (asset.file_path && fs.existsSync(asset.file_path) && require('path').resolve(asset.file_path) !== require('path').resolve(cachedPath)) {
      fs.mkdirSync(require('path').dirname(cachedPath), { recursive: true });
      const temporary = `${cachedPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      try { fs.copyFileSync(asset.file_path, temporary); fs.renameSync(temporary, cachedPath); }
      finally { if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true }); }
      return cachedPath;
    }
  }
  if (asset.file_path && fs.existsSync(asset.file_path)) return asset.file_path;
  return cachedPath;
}

function upsertTimelineTrack(rows = [], next = {}) {
  return [...list(rows).filter(item => item.timeline_id !== next.timeline_id
    && !(next.track_type === 'bgm' && item.track_type === 'bgm')), next];
}
function normalizeTimelineTracks(rows = []) {
  const values = list(rows);
  const activeBgm = values.filter(item => item.track_type === 'bgm').at(-1);
  return [...values.filter(item => item.track_type !== 'bgm'), ...(activeBgm ? [activeBgm] : [])];
}

function allowedOpenAudioUrl(raw = '') {
  try {
    const url = new URL(String(raw || ''));
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    return OPEN_AUDIO_HOSTS.some(allowed => host === allowed || host.endsWith(`.${allowed}`)) ? url : null;
  } catch { return null; }
}

function normalizeOpenverse(item = {}) {
  const license = clean(item.license, 20).toLowerCase();
  return {
    id: clean(item.id, 180), name: clean(item.title || item.name || '公开音频', 180),
    creator: clean(item.creator || 'Unknown', 160), license,
    license_url: clean(item.license_url || item.licenseUrl, 1200),
    landing_url: clean(item.foreign_landing_url || item.landing_url || item.foreignLandingUrl, 1200),
    audio_url: clean(item.url || item.audio_url, 1600), duration_sec: Math.max(0, Number(item.duration || item.duration_sec || 0) || 0),
  };
}

function rememberOpenverseSources(items = []) {
  list(items).forEach(item => { if (item?.id) recentOpenverseSources.set(String(item.id), item); });
  while (recentOpenverseSources.size > 200) recentOpenverseSources.delete(recentOpenverseSources.keys().next().value);
}

async function resolveOpenverseSource(sourceId = '') {
  if (sourceId.startsWith('vido_generated_')) return generatedSoundSource(sourceId);
  const remembered = recentOpenverseSources.get(sourceId);
  if (remembered) return remembered;
  const response = await axios.get(`https://api.openverse.org/v1/audio/${encodeURIComponent(sourceId)}/`, {
    timeout: 10000, headers: { 'User-Agent': 'VIDO/1.0 story-sound-import' },
  });
  const source = normalizeOpenverse(response?.data || {});
  rememberOpenverseSources([source]);
  return source;
}

async function cacheOpenverseSource(source = {}) {
  const generatedSource = String(source.id || '').startsWith('vido_generated_');
  const downloadUrl = generatedSource ? null : allowedOpenAudioUrl(source.audio_url);
  if (!source.id || (!generatedSource && (!downloadUrl || !OPEN_LICENSES.has(source.license)))) {
    throw Object.assign(new Error('该公开音频的下载地址或许可不符合导入规则'), { code: 'OPENVERSE_AUDIO_NOT_IMPORTABLE', status: 422 });
  }
  const ext = generatedSource ? '.mp3' : (['.mp3', '.m4a', '.wav', '.ogg', '.flac', '.aac'].includes(require('path').extname(downloadUrl.pathname).toLowerCase())
    ? require('path').extname(downloadUrl.pathname).toLowerCase() : '.mp3');
  const filename = generatedSource ? source.filename : `openverse_sound_${crypto.createHash('sha1').update(`${source.id}:${source.audio_url}`).digest('hex').slice(0, 18)}${ext}`;
  const destination = generatedSource ? source.file_path : mediaAdapter.assetPathFromName(filename);
  fs.mkdirSync(require('path').dirname(destination), { recursive: true });
  if (generatedSource || (fs.existsSync(destination) && fs.statSync(destination).size >= 1000)) return { source, filename, destination, cached: true };
  const key = `${source.id}:${source.audio_url}`;
  if (!openverseCacheInflight.has(key)) openverseCacheInflight.set(key, (async () => {
    const download = await axios.get(source.audio_url, { responseType: 'arraybuffer', timeout: 45000, maxContentLength: 35 * 1024 * 1024, headers: { 'User-Agent': 'VIDO/1.0 story-sound-import' } });
    const contentType = clean(download.headers['content-type'], 120).toLowerCase();
    const buffer = Buffer.from(download.data);
    if (!/audio|mpeg|octet-stream/.test(contentType) || buffer.length < 1000 || buffer.length > 35 * 1024 * 1024) {
      throw Object.assign(new Error('公开音频下载结果不是有效音频文件'), { code: 'OPENVERSE_AUDIO_DOWNLOAD_INVALID', status: 502 });
    }
    const temporary = `${destination}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try { fs.writeFileSync(temporary, buffer); fs.renameSync(temporary, destination); }
    finally { if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true }); }
  })().finally(() => openverseCacheInflight.delete(key)));
  await openverseCacheInflight.get(key);
  return { source, filename, destination, cached: false };
}

async function prepareOpenverseAsset(input = {}) {
  const sourceId = clean(input.openverse_id || input.id, 180);
  if (!sourceId) throw Object.assign(new Error('缺少 Openverse 音频 ID'), { code: 'OPENVERSE_AUDIO_ID_REQUIRED', status: 400 });
  const cached = await cacheOpenverseSource(await resolveOpenverseSource(sourceId));
  return { id: sourceId, filename: cached.filename, cached: cached.cached, ready: true };
}

function generatedSoundKind(query = '') {
  const value = clean(query, 160).toLowerCase();
  if (/music|bgm|音乐/.test(value)) return 'ambient_music';
  if (/metal|金属|不锈钢/.test(value)) return 'metal_touch';
  if (/footstep|脚步|行走/.test(value)) return 'footsteps';
  if (/whoosh|transition|转场/.test(value)) return 'soft_whoosh';
  return 'indoor_ambience';
}

function ensureGeneratedSound(kind = 'indoor_ambience') {
  const safeKind = ['ambient_music', 'metal_touch', 'footsteps', 'soft_whoosh', 'indoor_ambience'].includes(kind) ? kind : 'indoor_ambience';
  const filename = `vido_generated_${safeKind}_v1.mp3`;
  const destination = mediaAdapter.assetPathFromName(filename);
  if (fs.existsSync(destination) && fs.statSync(destination).size > 1000) return { filename, destination };
  fs.mkdirSync(require('path').dirname(destination), { recursive: true });
  const ffmpeg = require('ffmpeg-static');
  const argsByKind = {
    ambient_music: ['-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=30:sample_rate=48000', '-f', 'lavfi', '-i', 'sine=frequency=277.18:duration=30:sample_rate=48000', '-f', 'lavfi', '-i', 'sine=frequency=329.63:duration=30:sample_rate=48000', '-filter_complex', '[0:a][1:a][2:a]amix=inputs=3:weights=0.45 0.32 0.23,lowpass=f=1800,volume=0.16,afade=t=in:st=0:d=2,afade=t=out:st=27:d=3[a]', '-map', '[a]', '-c:a', 'libmp3lame', '-q:a', '4', destination],
    metal_touch: ['-y', '-f', 'lavfi', '-i', 'sine=frequency=920:duration=2.2:sample_rate=48000', '-f', 'lavfi', '-i', 'sine=frequency=1380:duration=2.2:sample_rate=48000', '-filter_complex', '[0:a][1:a]amix=inputs=2:weights=0.7 0.3,volume=0.32,afade=t=out:st=0.05:d=2.1[a]', '-map', '[a]', '-c:a', 'libmp3lame', '-q:a', '4', destination],
    footsteps: ['-y', '-f', 'lavfi', '-i', 'sine=frequency=78:duration=5:sample_rate=48000', '-af', "volume='if(lt(mod(t,0.75),0.11),0.42,0)':eval=frame,lowpass=f=210,afade=t=out:st=4.7:d=0.3", '-c:a', 'libmp3lame', '-q:a', '4', destination],
    soft_whoosh: ['-y', '-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.18:duration=2.5:sample_rate=48000', '-af', 'highpass=f=180,lowpass=f=4800,afade=t=in:st=0:d=0.45,afade=t=out:st=1.1:d=1.4', '-c:a', 'libmp3lame', '-q:a', '4', destination],
    indoor_ambience: ['-y', '-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.045:duration=12:sample_rate=48000', '-af', 'highpass=f=70,lowpass=f=1400,volume=0.45,afade=t=in:st=0:d=0.4,afade=t=out:st=11:d=1', '-c:a', 'libmp3lame', '-q:a', '4', destination],
  };
  execFileSync(ffmpeg, argsByKind[safeKind], { stdio: 'ignore', timeout: 30000 });
  if (!fs.existsSync(destination) || fs.statSync(destination).size < 1000) throw new Error('本地安全声音生成失败');
  return { filename, destination };
}

function generatedSoundSource(queryOrKind = '') {
  const kind = String(queryOrKind || '').startsWith('vido_generated_')
    ? String(queryOrKind).replace(/^vido_generated_/, '').replace(/_v1$/, '')
    : generatedSoundKind(queryOrKind);
  const generated = ensureGeneratedSound(kind);
  const titles = { ambient_music: '克制氛围背景音乐', metal_touch: '轻柔金属触碰', footsteps: '室内脚步', soft_whoosh: '柔和转场', indoor_ambience: '安静室内空间底噪' };
  return {
    id: `vido_generated_${kind}_v1`, name: titles[kind] || '系统安全声音', creator: 'VIDO', license: 'vido',
    license_url: '', landing_url: '', audio_url: `/api/new-story-ad/assets/${encodeURIComponent(generated.filename)}`,
    duration_sec: kind === 'ambient_music' ? 30 : (kind === 'indoor_ambience' ? 12 : 5),
    filename: generated.filename, file_path: generated.destination,
  };
}

const CHINESE_BGM_INTENTS = Object.freeze([
  { pattern: /相思|思念|怀念|离别|故乡|乡愁/u, label: '思念、离别与东方器乐', queries: ['longing traditional Chinese instrumental music', 'nostalgic guzheng instrumental', 'melancholic erhu instrumental', 'Chinese flute longing music'] },
  { pattern: /星|月|夜|神话|古风|国风|东方/u, label: '古风、夜色与东方器乐', queries: ['ancient Chinese instrumental music', 'moonlight guzheng instrumental', 'Chinese flute ambient music'] },
  { pattern: /温暖|治愈|柔和|钢琴/u, label: '温暖、治愈与轻柔钢琴', queries: ['warm piano instrumental music', 'soft healing piano music'] },
  { pattern: /紧张|悬疑|悬念|压迫/u, label: '紧张、悬疑与电影配乐', queries: ['cinematic suspense instrumental music', 'dark tension soundtrack'] },
  { pattern: /轻快|活力|商业|欢快/u, label: '轻快、活力与商业节奏', queries: ['upbeat acoustic background music', 'positive corporate instrumental music'] },
]);

function bgmSearchIntent(query = '') {
  const original = clean(query, 120);
  if (!/[\u3400-\u9fff]/u.test(original)) return null;
  const matched = CHINESE_BGM_INTENTS.find(intent => intent.pattern.test(original));
  return matched || { label: '电影氛围与器乐叙事', queries: ['cinematic instrumental background music', 'ambient storytelling instrumental music'] };
}

function openverseQueryCandidates(query = '', { trackType = '' } = {}) {
  const original = clean(query, 120);
  if (!original) return [];
  const containsChinese = /[\u3400-\u9fff]/u.test(original);
  const candidates = trackType === 'bgm' && containsChinese ? [] : [original];
  const rules = [
    [/showroom|exhibition|gallery/i, ['indoor ambience', 'indoor room tone']],
    [/room ambience/i, ['indoor ambience', 'indoor room tone']],
    [/footstep/i, ['indoor footsteps', 'footsteps']],
    [/metal.*(?:touch|rub|scrape)|(?:touch|rub|scrape).*metal/i, ['metal scrape', 'metal impact']],
    [/door/i, ['interior door', 'door close']],
    [/whoosh|transition/i, ['soft whoosh', 'whoosh']],
    [/cinematic|background music|corporate music/i, ['instrumental music', 'piano music']],
  ];
  const fallback = rules.find(([pattern]) => pattern.test(original))?.[1] || [];
  const intent = trackType === 'bgm' ? bgmSearchIntent(original) : null;
  const bgmFallback = trackType === 'bgm'
    ? (intent?.queries || ['instrumental music', 'background music'])
    : [];
  return [...new Set([...candidates, ...fallback, ...bgmFallback].map(value => clean(value, 120)).filter(Boolean))];
}

function likelyBackgroundMusic(item = {}) {
  const title = clean(item.name, 240).toLowerCase().replace(/[_-]+/g, ' ');
  return !/cat|protest|speech|interview|applause|crowd|walla|rehearsal|children.*sing|funeral|middle east|south american|door|footstep|room tone|field recording|sound effect|gong(?:\.|$)/i.test(title);
}

async function searchOpenverseOnce(query = '') {
  const response = await axios.get('https://api.openverse.org/v1/audio/', {
    timeout: 6000, headers: { 'User-Agent': 'VIDO/1.0 story-sound-search' },
    params: { q: query, license: 'cc0,pdm,by', page: 1, page_size: 20, filter_dead: true },
  });
  return list(response.data?.results).map(normalizeOpenverse)
    .filter(item => item.id && OPEN_LICENSES.has(item.license) && allowedOpenAudioUrl(item.audio_url))
    .slice(0, 20);
}

async function searchOpenverse(query = '', { trackType = '' } = {}) {
  const q = clean(query, 120);
  if (!q) return { results: [], license_note: '请输入要查找的环境声、拟音或动作音效。' };
  let lastError = null;
  let completedRequest = false;
  const merged = [];
  const seen = new Set();
  const matchedQueries = [];
  const queryCandidates = openverseQueryCandidates(q, { trackType });
  const similarOpenLicense = trackType === 'bgm' && !queryCandidates.includes(q);
  const searchIntent = trackType === 'bgm' ? bgmSearchIntent(q) : null;
  const targetCount = trackType === 'bgm' || /music|bgm|音乐/i.test(q) ? 8 : 1;
  for (const candidate of queryCandidates) {
    try {
      const found = await searchOpenverseOnce(candidate);
      const results = trackType === 'bgm' ? found.filter(likelyBackgroundMusic) : found;
      completedRequest = true;
      if (results.length) matchedQueries.push(candidate);
      for (const item of results) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        merged.push({ ...item, ...(searchIntent ? { match_reason: searchIntent.label } : {}), matched_query: candidate });
      }
      if (merged.length >= targetCount) break;
    } catch (error) {
      lastError = error;
      // 网络不可用时继续尝试更多关键词只会把同一次页面等待放大数倍；
      // 立即转入本地可播放声音，关键词回退只处理“请求成功但无结果”。
      break;
    }
  }
  if (merged.length) {
    const results = merged.slice(0, 20);
    rememberOpenverseSources(results);
    return {
    results,
    requested_query: q,
    selected_query: matchedQueries.join(' + ') || q,
    selected_queries: matchedQueries,
    match_mode: similarOpenLicense ? 'similar_open_license' : 'open_license_search',
    reference_query: similarOpenLicense ? q : '',
    match_reason: searchIntent?.label || '',
    fallback_used: matchedQueries.some(candidate => candidate !== q),
    license_note: `系统合并 ${matchedQueries.length || 1} 组相关关键词；仅展示允许商用与修改的 CC0、PDM、CC BY 音频，CC BY 会自动写入署名清单。`,
  }; }
  const generated = generatedSoundSource(trackType === 'bgm' ? 'ambient_music' : q);
  return {
    results: [generated], requested_query: q, selected_query: 'VIDO 本地安全声音', fallback_used: true,
    online_search_error: !completedRequest && lastError ? clean(lastError.code || lastError.message, 80) : '',
    license_note: '在线声音库暂未返回合规结果，已提供 VIDO 本地程序化声音；未使用第三方采样，可直接试听和合成。',
  };
}

function recommendedBgmQuery(shots = []) {
  const source = list(shots).map(shot => clean(shot.music_cue, 180)).filter(Boolean).join(' ');
  if (/温暖|治愈|柔和|钢琴/u.test(source)) return 'warm piano background music';
  if (/紧张|悬念|压迫/u.test(source)) return 'cinematic suspense music';
  if (/高级|克制|品牌|现代|科技/u.test(source)) return 'elegant cinematic background music';
  return 'cinematic background music';
}

async function importOpenverseAsset(taskId, input = {}) {
  const sourceId = clean(input.openverse_id || input.id, 180);
  if (!sourceId) throw Object.assign(new Error('缺少 Openverse 音频 ID'), { code: 'OPENVERSE_AUDIO_ID_REQUIRED', status: 400 });
  const source = await resolveOpenverseSource(sourceId);
  const generatedSource = sourceId.startsWith('vido_generated_');
  const cachedSource = await cacheOpenverseSource(source);
  const { filename, destination } = cachedSource;
  const importedAt = new Date().toISOString();
  const assetId = generatedSource ? source.id : `openverse_${source.id}`;
  const state = compile(taskId);
  const shotIndex = Math.max(1, Number(input.shot_index || 1) || 1);
  const shot = state.shots.find(row => row.shot_index === shotIndex);
  if (!shot) throw Object.assign(new Error('没有找到对应镜头'), { code: 'SOUND_SHOT_NOT_FOUND', status: 404 });
  const trackType = ALLOWED_TRACKS.has(clean(input.track_type, 40)) ? clean(input.track_type, 40) : 'sfx';
  const asset = {
    asset_id: assetId, name: source.name, track_type: trackType, source: generatedSource ? 'vido_generated' : 'openverse', ownership: generatedSource ? 'vido_generated' : 'open_license',
    license: generatedSource ? 'VIDO_GENERATED' : source.license.toUpperCase(), license_url: source.license_url, creator: source.creator, landing_url: source.landing_url,
    filename, file_url: `/api/new-story-ad/assets/${encodeURIComponent(filename)}`, file_path: destination,
    file_sha256: sha256File(destination), imported_at: importedAt, redistributable: true,
  };
  storage.saveOutput(taskId, ASSET_KIND, [...state.assets.filter(item => item.asset_id !== assetId), asset]);
  const timeline = {
    timeline_id: `audio_${shot.shot_id}_${trackType}_${assetId}`, shot_id: shot.shot_id, shot_index: shot.shot_index,
    scene_id: shot.scene_id, track_type: trackType, asset_id: assetId, start_sec: 0,
    duration_sec: trackType === 'bgm'
      ? Math.max(0.1, Math.min(state.shots.reduce((sum, row) => sum + row.duration_sec, 0), source.duration_sec || state.shots.reduce((sum, row) => sum + row.duration_sec, 0)))
      : Math.max(0.1, Math.min(shot.duration_sec, source.duration_sec || shot.duration_sec)),
    volume: Math.max(0, Math.min(1, Number(input.volume ?? 0.35) || 0.35)), status: 'ready',
  };
  storage.saveOutput(taskId, TIMELINE_KIND, upsertTimelineTrack(state.timeline, timeline));
  const ledger = {
    asset_id: assetId, source: generatedSource ? 'vido_generated' : 'openverse', creator: source.creator, license: asset.license,
    license_url: source.license_url, landing_url: source.landing_url,
    license_snapshot_sha256: storage.canonicalFingerprint({ id: source.id, creator: source.creator, license: source.license, license_url: source.license_url, landing_url: source.landing_url }),
    file_sha256: asset.file_sha256, downloaded_at: importedAt, requires_attribution: !generatedSource && source.license === 'by', redistributable: true,
  };
  storage.saveOutput(taskId, LEDGER_KIND, [...state.ledger.filter(item => item.asset_id !== assetId), ledger]);
  storage.deleteOutput(taskId, 'audio_production_approval');
  storage.deleteOutput(taskId, 'final_video');
  return { asset, timeline, ledger };
}

function compile(taskId) {
  const task = storage.getTask(taskId);
  if (!task) throw Object.assign(new Error('项目不存在'), { code: 'TASK_NOT_FOUND', status: 404 });
  const context = storage.getOutput(taskId, 'context') || task.request || {};
  const scenes = list(storage.getOutput(taskId, 'scene_assets') || context.scene_assets);
  const shots = list(storage.getOutput(taskId, 'storyboard_table'));
  const existingProfiles = list(storage.getOutput(taskId, PROFILE_KIND));
  const profileByScene = new Map(existingProfiles.map(row => [row.scene_id, row]));
  const profiles = scenes.map((scene, index) => {
    const sceneId = clean(scene.scene_id || scene.id, 160);
    const shotRows = shots.filter(shot => clean(shot.scene_id || shot.scene_asset_id, 160) === sceneId);
    const existing = profileByScene.get(sceneId) || {};
    return {
      sound_profile_id: clean(existing.sound_profile_id || scene.sound_profile_id || `sound_profile_${sceneId || index + 1}`, 180),
      scene_id: sceneId,
      scene_revision: Math.max(1, Number(scene.scene_revision || scene.revision || 1) || 1),
      scene_name: clean(scene.name || scene.scene_name || `场景 ${index + 1}`, 120),
      room_tone: clean(existing.room_tone || shotRows.find(shot => shot.ambient_sound)?.ambient_sound || '保持当前场景连续空间底噪', 260),
      forbidden_sounds: list(existing.forbidden_sounds).map(value => clean(value, 160)),
      status: clean(existing.status || 'planned', 40),
    };
  });
  const assets = list(storage.getOutput(taskId, ASSET_KIND)).map(asset => {
    const migratedPath = localPath(asset);
    return migratedPath && migratedPath !== asset.file_path ? { ...asset, file_path: migratedPath } : asset;
  });
  const timeline = normalizeTimelineTracks(storage.getOutput(taskId, TIMELINE_KIND));
  const ledger = list(storage.getOutput(taskId, LEDGER_KIND));
  return { profiles, assets, timeline, ledger, bgm_query: recommendedBgmQuery(shots), shots: shots.map((shot, index) => ({
    shot_id: clean(shot.shot_id || `shot_${index + 1}`, 160),
    shot_index: Number(shot.index || shot.shot_index || index + 1) || index + 1,
    scene_id: clean(shot.scene_id || shot.scene_asset_id, 160),
    duration_sec: Math.max(0.1, Number(shot.duration || shot.duration_sec || 3) || 3),
    ambient_sound: clean(shot.ambient_sound, 260),
    sfx: list(shot.sfx).map(value => clean(value, 160)),
    music_cue: clean(shot.music_cue, 260),
    voice_bindings: shot.voice_bindings || {},
    recommended_track_type: recommendedTrack(shot),
    recommended_query: recommendedQuery(shot),
    auto_recommend_sound: shouldAutoRecommend(shot),
    sound_optional: true,
    preview_duration_sec: Math.max(0.1, Math.min(6, Number(shot.duration || shot.duration_sec || 3) || 3)),
  })) };
}

function addUserAsset(taskId, input = {}, actor = {}) {
  const state = compile(taskId);
  const asset = input.asset && typeof input.asset === 'object' ? input.asset : {};
  const trackType = ALLOWED_TRACKS.has(clean(input.track_type, 40)) ? clean(input.track_type, 40) : 'sfx';
  const shotIndex = Math.max(1, Number(input.shot_index || 1) || 1);
  const shot = state.shots.find(row => row.shot_index === shotIndex);
  if (!shot) throw Object.assign(new Error('没有找到对应镜头'), { code: 'SOUND_SHOT_NOT_FOUND', status: 404 });
  const filePath = localPath(asset);
  if (!filePath || !fs.existsSync(filePath)) throw Object.assign(new Error('上传的音频文件不可用'), { code: 'SOUND_FILE_NOT_FOUND', status: 422 });
  const mime = clean(asset.mimetype, 100).toLowerCase();
  if (mime && !mime.startsWith('audio/')) throw Object.assign(new Error('只允许添加音频文件'), { code: 'SOUND_FILE_TYPE_INVALID', status: 422 });
  const assetId = clean(asset.id || `sound_${crypto.randomUUID()}`, 180);
  const timestamp = new Date().toISOString();
  const row = {
    asset_id: assetId,
    name: clean(asset.name || asset.original_name || asset.filename || '用户音效', 180),
    track_type: trackType,
    source: 'user_upload',
    ownership: 'user_confirmed',
    license: 'USER_OWNED',
    license_url: '',
    creator: clean(actor.name || actor.email || '项目用户', 160),
    landing_url: '',
    filename: clean(asset.filename, 240),
    file_url: clean(asset.file_url || asset.url, 1200),
    file_path: filePath,
    file_sha256: sha256File(filePath),
    imported_at: timestamp,
    redistributable: false,
  };
  const assets = [...state.assets.filter(item => item.asset_id !== assetId), row];
  storage.saveOutput(taskId, ASSET_KIND, assets);
  const timelineId = clean(input.timeline_id || `audio_${shot.shot_id}_${trackType}_${assetId}`, 220);
  const timelineRow = {
    timeline_id: timelineId,
    shot_id: shot.shot_id,
    shot_index: shot.shot_index,
    scene_id: shot.scene_id,
    track_type: trackType,
    asset_id: assetId,
    start_sec: Math.max(0, Math.min(shot.duration_sec, Number(input.start_sec || 0) || 0)),
    duration_sec: trackType === 'bgm'
      ? Math.max(0.1, Math.min(state.shots.reduce((sum, row) => sum + row.duration_sec, 0), Number(input.duration_sec || state.shots.reduce((sum, row) => sum + row.duration_sec, 0)) || 0.1))
      : Math.max(0, Math.min(shot.duration_sec, Number(input.duration_sec || shot.duration_sec) || shot.duration_sec)),
    volume: Math.max(0, Math.min(1, Number(input.volume ?? 0.35) || 0.35)),
    status: 'ready',
  };
  const timeline = upsertTimelineTrack(state.timeline, timelineRow);
  storage.saveOutput(taskId, TIMELINE_KIND, timeline);
  const ledgerRow = {
    asset_id: assetId, source: 'user_upload', creator: row.creator, license: row.license,
    license_url: '', landing_url: '', license_snapshot_sha256: storage.canonicalFingerprint({ license: row.license, ownership: row.ownership, at: timestamp }),
    file_sha256: row.file_sha256, downloaded_at: timestamp, requires_attribution: false, redistributable: false,
  };
  storage.saveOutput(taskId, LEDGER_KIND, [...state.ledger.filter(item => item.asset_id !== assetId), ledgerRow]);
  storage.deleteOutput(taskId, 'audio_production_approval');
  storage.deleteOutput(taskId, 'final_video');
  return { asset: row, timeline: timelineRow, ledger: ledgerRow };
}

function resolvedTracks(taskId) {
  const state = compile(taskId);
  const assetById = new Map(state.assets.map(asset => [asset.asset_id, asset]));
  const shotStarts = new Map();
  let cursor = 0;
  state.shots.forEach(shot => { shotStarts.set(shot.shot_id, cursor); cursor += shot.duration_sec; });
  return state.timeline.filter(row => row.status === 'ready' && row.track_type !== 'bgm').map(row => {
    const asset = assetById.get(row.asset_id) || {};
    const path = localPath(asset);
    return {
      ...row,
      file_path: path,
      timeline_start_sec: (shotStarts.get(row.shot_id) || 0) + Number(row.start_sec || 0),
    };
  }).filter(row => row.file_path && fs.existsSync(row.file_path));
}

function resolvedBgm(taskId) {
  const state = compile(taskId);
  const row = state.timeline.find(item => item.status === 'ready' && item.track_type === 'bgm');
  const asset = state.assets.find(item => item.asset_id === row?.asset_id) || null;
  if (!row || !asset) return null;
  const filePath = localPath(asset);
  return filePath && fs.existsSync(filePath) ? { ...asset, file_path: filePath, volume: row.volume } : null;
}

function attributionManifest(taskId) {
  const rows = list(storage.getOutput(taskId, LEDGER_KIND));
  const activeAssetIds = new Set(compile(taskId).timeline.map(row => row.asset_id).filter(Boolean));
  return rows.filter(row => row.requires_attribution && activeAssetIds.has(row.asset_id)).map(row => ({
    asset_id: row.asset_id, creator: row.creator, license: row.license, license_url: row.license_url, landing_url: row.landing_url,
  }));
}

module.exports = { ALLOWED_TRACKS, ASSET_KIND, LEDGER_KIND, PROFILE_KIND, TIMELINE_KIND, addUserAsset, attributionManifest, bgmSearchIntent, cacheOpenverseSource, compile, generatedSoundKind, generatedSoundSource, importOpenverseAsset, normalizeTimelineTracks, openverseQueryCandidates, prepareOpenverseAsset, recommendedBgmQuery, recommendedQuery, recommendedTrack, resolvedBgm, resolvedTracks, searchOpenverse, shouldAutoRecommend, upsertTimelineTrack };
