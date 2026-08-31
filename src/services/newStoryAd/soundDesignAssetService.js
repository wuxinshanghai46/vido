'use strict';

const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const storage = require('./storageService');
const mediaAdapter = require('./mediaAdapter');

const PROFILE_KIND = 'scene_sound_profiles';
const ASSET_KIND = 'sound_assets';
const TIMELINE_KIND = 'audio_timeline';
const LEDGER_KIND = 'audio_license_ledger';
const ALLOWED_TRACKS = new Set(['room_tone', 'ambient', 'foley', 'sfx', 'transition']);
const OPEN_LICENSES = new Set(['cc0', 'pdm', 'by']);
const OPEN_AUDIO_HOSTS = Object.freeze(['cdn.freesound.org', 'upload.wikimedia.org', 'files.freemusicarchive.org', 'freemusicarchive.org', 'archive.org', 'storage.jamendo.com', 'mp3d.jamendo.com']);

function list(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }
function clean(value = '', max = 1000) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max); }
function recommendedTrack(shot = {}) { return list(shot.sfx).length ? 'sfx' : (clean(shot.ambient_sound, 260) ? 'ambient' : 'room_tone'); }
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
  if (asset.file_path && fs.existsSync(asset.file_path)) return asset.file_path;
  const filename = clean(asset.filename || String(asset.file_url || asset.url || '').split('/').pop()?.split('?')[0], 240);
  return filename ? mediaAdapter.assetPathFromName(filename) : '';
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

async function searchOpenverse(query = '') {
  const q = clean(query, 120);
  if (!q) return { results: [], license_note: '请输入要查找的环境声、拟音或动作音效。' };
  const response = await axios.get('https://api.openverse.org/v1/audio/', {
    timeout: 10000, headers: { 'User-Agent': 'VIDO/1.0 story-sound-search' },
    params: { q, license: 'cc0,pdm,by', page: 1, page_size: 20, filter_dead: true },
  });
  const results = list(response.data?.results).map(normalizeOpenverse)
    .filter(item => item.id && OPEN_LICENSES.has(item.license) && allowedOpenAudioUrl(item.audio_url))
    .slice(0, 20);
  return { results, license_note: '仅展示允许商用与修改的 CC0、PDM、CC BY 音频；CC BY 会自动写入署名清单。' };
}

async function importOpenverseAsset(taskId, input = {}) {
  const sourceId = clean(input.openverse_id || input.id, 180);
  if (!sourceId) throw Object.assign(new Error('缺少 Openverse 音频 ID'), { code: 'OPENVERSE_AUDIO_ID_REQUIRED', status: 400 });
  const response = await axios.get(`https://api.openverse.org/v1/audio/${encodeURIComponent(sourceId)}/`, {
    timeout: 10000, headers: { 'User-Agent': 'VIDO/1.0 story-sound-import' },
  });
  const source = normalizeOpenverse(response.data || {});
  const downloadUrl = allowedOpenAudioUrl(source.audio_url);
  if (!source.id || !downloadUrl || !OPEN_LICENSES.has(source.license)) {
    throw Object.assign(new Error('该公开音频的下载地址或许可不符合导入规则'), { code: 'OPENVERSE_AUDIO_NOT_IMPORTABLE', status: 422 });
  }
  const ext = ['.mp3', '.m4a', '.wav', '.ogg', '.flac', '.aac'].includes(require('path').extname(downloadUrl.pathname).toLowerCase())
    ? require('path').extname(downloadUrl.pathname).toLowerCase() : '.mp3';
  const filename = `openverse_sound_${crypto.createHash('sha1').update(`${source.id}:${source.audio_url}`).digest('hex').slice(0, 18)}${ext}`;
  const destination = mediaAdapter.assetPathFromName(filename);
  fs.mkdirSync(require('path').dirname(destination), { recursive: true });
  if (!fs.existsSync(destination) || fs.statSync(destination).size < 1000) {
    const download = await axios.get(source.audio_url, { responseType: 'arraybuffer', timeout: 45000, maxContentLength: 35 * 1024 * 1024, headers: { 'User-Agent': 'VIDO/1.0 story-sound-import' } });
    const contentType = clean(download.headers['content-type'], 120).toLowerCase();
    const buffer = Buffer.from(download.data);
    if (!/audio|mpeg|octet-stream/.test(contentType) || buffer.length < 1000 || buffer.length > 35 * 1024 * 1024) {
      throw Object.assign(new Error('公开音频下载结果不是有效音频文件'), { code: 'OPENVERSE_AUDIO_DOWNLOAD_INVALID', status: 502 });
    }
    const temporary = `${destination}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, buffer);
    fs.renameSync(temporary, destination);
  }
  const importedAt = new Date().toISOString();
  const assetId = `openverse_${source.id}`;
  const state = compile(taskId);
  const shotIndex = Math.max(1, Number(input.shot_index || 1) || 1);
  const shot = state.shots.find(row => row.shot_index === shotIndex);
  if (!shot) throw Object.assign(new Error('没有找到对应镜头'), { code: 'SOUND_SHOT_NOT_FOUND', status: 404 });
  const trackType = ALLOWED_TRACKS.has(clean(input.track_type, 40)) ? clean(input.track_type, 40) : 'sfx';
  const asset = {
    asset_id: assetId, name: source.name, track_type: trackType, source: 'openverse', ownership: 'open_license',
    license: source.license.toUpperCase(), license_url: source.license_url, creator: source.creator, landing_url: source.landing_url,
    filename, file_url: `/api/new-story-ad/assets/${encodeURIComponent(filename)}`, file_path: destination,
    file_sha256: sha256File(destination), imported_at: importedAt, redistributable: true,
  };
  storage.saveOutput(taskId, ASSET_KIND, [...state.assets.filter(item => item.asset_id !== assetId), asset]);
  const timeline = {
    timeline_id: `audio_${shot.shot_id}_${trackType}_${assetId}`, shot_id: shot.shot_id, shot_index: shot.shot_index,
    scene_id: shot.scene_id, track_type: trackType, asset_id: assetId, start_sec: 0,
    duration_sec: Math.max(0.1, Math.min(shot.duration_sec, source.duration_sec || shot.duration_sec)),
    volume: Math.max(0, Math.min(1, Number(input.volume ?? 0.35) || 0.35)), status: 'ready',
  };
  storage.saveOutput(taskId, TIMELINE_KIND, [...state.timeline.filter(item => item.timeline_id !== timeline.timeline_id), timeline]);
  const ledger = {
    asset_id: assetId, source: 'openverse', creator: source.creator, license: asset.license,
    license_url: source.license_url, landing_url: source.landing_url,
    license_snapshot_sha256: storage.canonicalFingerprint({ id: source.id, creator: source.creator, license: source.license, license_url: source.license_url, landing_url: source.landing_url }),
    file_sha256: asset.file_sha256, downloaded_at: importedAt, requires_attribution: source.license === 'by', redistributable: true,
  };
  storage.saveOutput(taskId, LEDGER_KIND, [...state.ledger.filter(item => item.asset_id !== assetId), ledger]);
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
  const assets = list(storage.getOutput(taskId, ASSET_KIND));
  const timeline = list(storage.getOutput(taskId, TIMELINE_KIND));
  const ledger = list(storage.getOutput(taskId, LEDGER_KIND));
  return { profiles, assets, timeline, ledger, shots: shots.map((shot, index) => ({
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
    duration_sec: Math.max(0, Math.min(shot.duration_sec, Number(input.duration_sec || shot.duration_sec) || shot.duration_sec)),
    volume: Math.max(0, Math.min(1, Number(input.volume ?? 0.35) || 0.35)),
    status: 'ready',
  };
  const timeline = [...state.timeline.filter(item => item.timeline_id !== timelineId), timelineRow];
  storage.saveOutput(taskId, TIMELINE_KIND, timeline);
  const ledgerRow = {
    asset_id: assetId, source: 'user_upload', creator: row.creator, license: row.license,
    license_url: '', landing_url: '', license_snapshot_sha256: storage.canonicalFingerprint({ license: row.license, ownership: row.ownership, at: timestamp }),
    file_sha256: row.file_sha256, downloaded_at: timestamp, requires_attribution: false, redistributable: false,
  };
  storage.saveOutput(taskId, LEDGER_KIND, [...state.ledger.filter(item => item.asset_id !== assetId), ledgerRow]);
  storage.deleteOutput(taskId, 'final_video');
  return { asset: row, timeline: timelineRow, ledger: ledgerRow };
}

function resolvedTracks(taskId) {
  const state = compile(taskId);
  const assetById = new Map(state.assets.map(asset => [asset.asset_id, asset]));
  const shotStarts = new Map();
  let cursor = 0;
  state.shots.forEach(shot => { shotStarts.set(shot.shot_id, cursor); cursor += shot.duration_sec; });
  return state.timeline.filter(row => row.status === 'ready').map(row => {
    const asset = assetById.get(row.asset_id) || {};
    const path = localPath(asset);
    return {
      ...row,
      file_path: path,
      timeline_start_sec: (shotStarts.get(row.shot_id) || 0) + Number(row.start_sec || 0),
    };
  }).filter(row => row.file_path && fs.existsSync(row.file_path));
}

function attributionManifest(taskId) {
  const rows = list(storage.getOutput(taskId, LEDGER_KIND));
  return rows.filter(row => row.requires_attribution).map(row => ({
    asset_id: row.asset_id, creator: row.creator, license: row.license, license_url: row.license_url, landing_url: row.landing_url,
  }));
}

module.exports = { ALLOWED_TRACKS, ASSET_KIND, LEDGER_KIND, PROFILE_KIND, TIMELINE_KIND, addUserAsset, attributionManifest, compile, importOpenverseAsset, recommendedQuery, recommendedTrack, resolvedTracks, searchOpenverse };
