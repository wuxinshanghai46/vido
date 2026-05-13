/**
 * 模块化 JSON 文件数据库
 * 按功能模块拆分为独立的 JSON 文件，互不干扰
 */
const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(__dirname, '../../outputs');

// ——— 通用读写工具 ———

function readJSON(filePath, defaultData) {
  try {
    if (!fs.existsSync(filePath)) return JSON.parse(JSON.stringify(defaultData));
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return JSON.parse(JSON.stringify(defaultData));
  }
}

function writeJSON(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// ——— 通用 CRUD 工厂 ———

function createStore(fileName, tableName, defaultTable = []) {
  const filePath = path.join(DB_DIR, fileName);
  const defaults = { [tableName]: defaultTable };

  function read() {
    const data = readJSON(filePath, defaults);
    if (!data[tableName]) data[tableName] = [];
    return data;
  }
  function write(data) { writeJSON(filePath, data); }

  return {
    insert(row) {
      const data = read();
      row.created_at = row.created_at || new Date().toISOString();
      row.updated_at = row.created_at;
      data[tableName].push(row);
      write(data);
    },
    get(id) {
      return read()[tableName].find(r => r.id === id) || null;
    },
    list(filterFn) {
      const rows = read()[tableName];
      const filtered = filterFn ? rows.filter(filterFn) : rows;
      return filtered.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    },
    update(id, fields) {
      const data = read();
      const idx = data[tableName].findIndex(r => r.id === id);
      if (idx !== -1) {
        data[tableName][idx] = { ...data[tableName][idx], ...fields, updated_at: new Date().toISOString() };
        write(data);
      }
    },
    delete(id) {
      const data = read();
      const idx = data[tableName].findIndex(r => r.id === id);
      if (idx !== -1) { data[tableName].splice(idx, 1); write(data); }
    },
    // 直接访问底层数据（用于多表文件）
    _read: read,
    _write: write
  };
}

// ——— 各模块存储 ———

// 项目管线：project_db.json（projects + stories + video_clips + final_videos）
const PROJECT_FILE = path.join(DB_DIR, 'project_db.json');
const PROJECT_DEFAULTS = { projects: [], stories: [], video_clips: [], final_videos: [] };

function readProjectDB() {
  const data = readJSON(PROJECT_FILE, PROJECT_DEFAULTS);
  for (const k of Object.keys(PROJECT_DEFAULTS)) { if (!data[k]) data[k] = []; }
  return data;
}
function writeProjectDB(data) { writeJSON(PROJECT_FILE, data); }

// 图生视频
const i2vStore    = createStore('i2v_db.json', 'i2v_tasks');
// AI 小说
const novelStore  = createStore('novel_db.json', 'novels');
// 素材库
const assetStore  = createStore('asset_db.json', 'assets');
// 漫画
const comicStore  = createStore('comic_db.json', 'comic_tasks');
// 形象生成
const portraitStore = createStore('portrait_db.json', 'portraits');
// 数字人
const avatarStore = createStore('avatar_db.json', 'avatar_tasks');
// 发布记录
const publishStore = createStore('publish_db.json', 'publications');
// 自定义声音
const voiceStore = createStore('voice_db.json', 'voices');
// 内容雷达 - 监控账号
const monitorStore = createStore('monitor_db.json', 'accounts');
// 内容雷达 - 内容库
const contentStore = createStore('content_db.json', 'contents');
// 内容雷达 - 复刻任务
const replicateStore = createStore('replicate_db.json', 'tasks');
// AI 能力 - 角色库/场景库/风格库
const aiCharStore  = createStore('ai_characters.json', 'characters');
const aiSceneStore = createStore('ai_scenes.json', 'scenes');
const aiStyleStore = createStore('ai_styles.json', 'styles');
// 知识库（数字人/网剧/分镜/氛围）
const knowledgeBaseStore = createStore('knowledge_base.json', 'documents');
// Token 使用追踪（每次 LLM/image/video/tts 调用记录）
const tokenUsageStore = createStore('token_usage.json', 'calls');
// 网剧：多表（projects + episodes）
const DRAMA_FILE = path.join(DB_DIR, 'drama_db.json');
const DRAMA_DEFAULTS = { drama_projects: [], drama_episodes: [] };
function readDramaDB() {
  const data = readJSON(DRAMA_FILE, DRAMA_DEFAULTS);
  for (const k of Object.keys(DRAMA_DEFAULTS)) { if (!data[k]) data[k] = []; }
  return data;
}
function writeDramaDB(data) { writeJSON(DRAMA_FILE, data); }

// ——— 数据迁移：从旧 vido_db.json 自动拆分 ———

const OLD_DB_PATH = path.join(DB_DIR, 'vido_db.json');

function migrateFromLegacy() {
  if (!fs.existsSync(OLD_DB_PATH)) return;
  let old;
  try { old = JSON.parse(fs.readFileSync(OLD_DB_PATH, 'utf8')); } catch { return; }

  let migrated = false;

  // 项目管线
  if (old.projects?.length || old.stories?.length || old.video_clips?.length || old.final_videos?.length) {
    if (!fs.existsSync(PROJECT_FILE)) {
      writeJSON(PROJECT_FILE, {
        projects:     old.projects     || [],
        stories:      old.stories      || [],
        video_clips:  old.video_clips  || [],
        final_videos: old.final_videos || []
      });
      migrated = true;
    }
  }

  // 各独立模块
  const mapping = [
    { key: 'i2v_tasks',   file: 'i2v_db.json',     table: 'i2v_tasks' },
    { key: 'novels',      file: 'novel_db.json',    table: 'novels' },
    { key: 'assets',      file: 'asset_db.json',    table: 'assets' },
    { key: 'comic_tasks', file: 'comic_db.json',    table: 'comic_tasks' },
    { key: 'portraits',   file: 'portrait_db.json', table: 'portraits' },
    { key: 'avatar_tasks',file: 'avatar_db.json',   table: 'avatar_tasks' },
    { key: 'publications',file: 'publish_db.json',  table: 'publications' }
  ];

  for (const { key, file, table } of mapping) {
    const target = path.join(DB_DIR, file);
    if (old[key]?.length && !fs.existsSync(target)) {
      writeJSON(target, { [table]: old[key] });
      migrated = true;
    }
  }

  if (migrated) {
    // 备份旧文件
    const backupPath = OLD_DB_PATH.replace('.json', '_backup.json');
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(OLD_DB_PATH, backupPath);
    }
    console.log('[DB] 已从 vido_db.json 迁移数据到模块化存储');
  }
}

// 启动时执行迁移
migrateFromLegacy();

// ——— 导出统一接口（保持向后兼容）———

const db = {
  // ——— Projects ———
  insertProject(row) {
    const data = readProjectDB();
    row.created_at = new Date().toISOString();
    row.updated_at = row.created_at;
    data.projects.push(row);
    writeProjectDB(data);
  },
  getProject(id) {
    return readProjectDB().projects.find(p => p.id === id) || null;
  },
  listProjects(userId) {
    return readProjectDB().projects
      .filter(p => !userId || p.user_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  },
  updateProject(id, fields) {
    const data = readProjectDB();
    const idx = data.projects.findIndex(p => p.id === id);
    if (idx !== -1) {
      data.projects[idx] = { ...data.projects[idx], ...fields, updated_at: new Date().toISOString() };
      writeProjectDB(data);
    }
  },
  deleteProject(id) {
    const data = readProjectDB();
    const idx = data.projects.findIndex(p => p.id === id);
    if (idx !== -1) { data.projects.splice(idx, 1); writeProjectDB(data); }
  },

  // ——— Stories ———
  insertStory(row) {
    const data = readProjectDB();
    row.created_at = new Date().toISOString();
    data.stories.push(row);
    writeProjectDB(data);
  },
  getStoryByProject(projectId) {
    return readProjectDB().stories.find(s => s.project_id === projectId) || null;
  },

  // ——— Video Clips ———
  insertClip(row) {
    const data = readProjectDB();
    row.created_at = new Date().toISOString();
    data.video_clips.push(row);
    writeProjectDB(data);
  },
  updateClip(id, fields) {
    const data = readProjectDB();
    const idx = data.video_clips.findIndex(c => c.id === id);
    if (idx !== -1) {
      data.video_clips[idx] = { ...data.video_clips[idx], ...fields };
      writeProjectDB(data);
    }
  },
  getClipsByProject(projectId) {
    return readProjectDB().video_clips
      .filter(c => c.project_id === projectId)
      .sort((a, b) => a.scene_index - b.scene_index);
  },
  getClip(id, projectId) {
    return readProjectDB().video_clips.find(c => c.id === id && c.project_id === projectId) || null;
  },

  // ——— Final Videos ———
  insertFinalVideo(row) {
    const data = readProjectDB();
    row.created_at = new Date().toISOString();
    data.final_videos.push(row);
    writeProjectDB(data);
  },
  getFinalVideoByProject(projectId) {
    // 取最新的记录（多次生成时返回最后一条）
    const matches = readProjectDB().final_videos.filter(v => v.project_id === projectId);
    return matches.length ? matches[matches.length - 1] : null;
  },

  // ——— I2V Tasks（图生视频）———
  insertI2VTask(row)          { i2vStore.insert(row); },
  getI2VTask(id)              { return i2vStore.get(id); },
  listI2VTasks(userId)        { return i2vStore.list(t => !userId || t.user_id === userId); },
  updateI2VTask(id, fields)   { i2vStore.update(id, fields); },
  deleteI2VTask(id)           { i2vStore.delete(id); },

  // ——— Novels（AI 小说）———
  insertNovel(row)            { novelStore.insert(row); },
  getNovel(id)                { return novelStore.get(id); },
  listNovels(userId)          { return novelStore.list(n => !userId || n.user_id === userId); },
  updateNovel(id, fields)     { novelStore.update(id, fields); },
  deleteNovel(id)             { novelStore.delete(id); },

  // ——— Assets（素材库）———
  insertAsset(row)            { assetStore.insert(row); },
  getAsset(id)                { return assetStore.get(id); },
  listAssets(userId, type)    { return assetStore.list(a => (!userId || a.user_id === userId) && (!type || type === 'all' || a.type === type)); },
  updateAsset(id, fields)     { assetStore.update(id, fields); },
  deleteAsset(id)             { assetStore.delete(id); },

  // ——— Portraits（形象生成）———
  insertPortrait(row)         { portraitStore.insert(row); },
  getPortrait(id)             { return portraitStore.get(id); },
  listPortraits(userId)       { return portraitStore.list(t => !userId || t.user_id === userId); },
  updatePortrait(id, fields)  { portraitStore.update(id, fields); },
  deletePortrait(id)          { portraitStore.delete(id); },

  // ——— Comic Tasks（漫画生成）———
  insertComicTask(row)        { comicStore.insert(row); },
  getComicTask(id)            { return comicStore.get(id); },
  listComicTasks(userId)      { return comicStore.list(t => !userId || t.user_id === userId); },
  updateComicTask(id, fields) { comicStore.update(id, fields); },
  deleteComicTask(id)         { comicStore.delete(id); },

  // ——— Avatar Tasks（数字人视频）———
  insertAvatarTask(row)       { avatarStore.insert(row); },
  getAvatarTask(id)           { return avatarStore.get(id); },
  listAvatarTasks(userId)     { return avatarStore.list(t => !userId || t.user_id === userId); },
  updateAvatarTask(id, fields){ avatarStore.update(id, fields); },
  deleteAvatarTask(id)        { avatarStore.delete(id); },

  // ——— Monitor Accounts（监控账号）———
  insertMonitor(row)            { monitorStore.insert(row); },
  getMonitor(id)                { return monitorStore.get(id); },
  listMonitors(userId)          { return monitorStore.list(m => !userId || m.user_id === userId); },
  updateMonitor(id, fields)     { monitorStore.update(id, fields); },
  deleteMonitor(id)             { monitorStore.delete(id); },

  // ——— Monitor Contents（内容库）———
  insertContent(row)            { contentStore.insert(row); },
  getContent(id)                { return contentStore.get(id); },
  listContents(userId, accountId) {
    return contentStore.list(c => (!userId || c.user_id === userId) && (!accountId || c.account_id === accountId));
  },
  updateContent(id, fields)     { contentStore.update(id, fields); },
  deleteContent(id)             { contentStore.delete(id); },

  // ——— Replicate Tasks（复刻任务）———
  insertReplicateTask(row)      { replicateStore.insert(row); },
  getReplicateTask(id)          { return replicateStore.get(id); },
  listReplicateTasks(userId)    { return replicateStore.list(t => !userId || t.user_id === userId); },
  updateReplicateTask(id, fields){ replicateStore.update(id, fields); },
  deleteReplicateTask(id)       { replicateStore.delete(id); },

  // ——— Custom Voices（自定义声音）———
  insertVoice(row)            { voiceStore.insert(row); },
  getVoice(id)                { return voiceStore.get(id); },
  listVoices(userId)          { return voiceStore.list(v => !userId || v.user_id === userId); },
  updateVoice(id, fields)     { voiceStore.update(id, fields); },
  deleteVoice(id)             { voiceStore.delete(id); },

  // ——— Publications（发布记录）———
  insertPublication(row)      { publishStore.insert(row); },
  getPublication(id)          { return publishStore.get(id); },
  listPublications()          { return publishStore.list(); },
  updatePublication(id, fields){ publishStore.update(id, fields); },
  deletePublication(id)       { publishStore.delete(id); },

  // ——— AI 能力：角色库 ———
  insertAIChar(row)           { aiCharStore.insert(row); },
  getAIChar(id)               { return aiCharStore.get(id); },
  listAIChars(userId)         { return aiCharStore.list(c => !userId || c.user_id === userId); },
  updateAIChar(id, fields)    { aiCharStore.update(id, fields); },
  deleteAIChar(id)            { aiCharStore.delete(id); },

  // ——— AI 能力：场景库 ———
  insertAIScene(row)          { aiSceneStore.insert(row); },
  getAIScene(id)              { return aiSceneStore.get(id); },
  listAIScenes(userId)        { return aiSceneStore.list(s => !userId || s.user_id === userId); },
  updateAIScene(id, fields)   { aiSceneStore.update(id, fields); },
  deleteAIScene(id)           { aiSceneStore.delete(id); },

  // ——— AI 能力：风格库 ———
  insertAIStyle(row)          { aiStyleStore.insert(row); },
  getAIStyle(id)              { return aiStyleStore.get(id); },
  listAIStyles()              { return aiStyleStore.list(); },
  updateAIStyle(id, fields)   { aiStyleStore.update(id, fields); },
  deleteAIStyle(id)           { aiStyleStore.delete(id); },

  // ——— 知识库（数字人 / 网剧 / 分镜 / 氛围）———
  // 每条 document: { id, collection, subcategory, title, summary, content,
  //                  tags[], keywords[], prompt_snippets[], applies_to[], source, lang, enabled }
  // collection: 'digital_human' | 'drama' | 'storyboard' | 'atmosphere'
  // applies_to: ['screenwriter','director','character_consistency','atmosphere','storyboard']
  insertKnowledgeDoc(row)         { knowledgeBaseStore.insert(row); },
  getKnowledgeDoc(id)             { return knowledgeBaseStore.get(id); },
  listKnowledgeDocs(filter = {})  {
    return knowledgeBaseStore.list(d => {
      if (filter.collection && d.collection !== filter.collection) return false;
      if (filter.subcategory && d.subcategory !== filter.subcategory) return false;
      if (filter.appliesTo && !(d.applies_to || []).includes(filter.appliesTo)) return false;
      if (filter.enabledOnly && d.enabled === false) return false;
      if (filter.q) {
        const q = String(filter.q).toLowerCase();
        const hay = [d.title, d.summary, d.content, (d.tags || []).join(' '), (d.keywords || []).join(' ')]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  },
  updateKnowledgeDoc(id, fields)  { knowledgeBaseStore.update(id, fields); },
  deleteKnowledgeDoc(id)          { knowledgeBaseStore.delete(id); },
  bulkInsertKnowledgeDocs(rows)   {
    for (const r of rows) {
      if (!knowledgeBaseStore.get(r.id)) knowledgeBaseStore.insert(r);
    }
  },

  // ——— Token 使用追踪 ———
  insertTokenUsage(row)       { tokenUsageStore.insert(row); },
  listTokenUsage(filter = {}) {
    return tokenUsageStore.list(r => {
      if (filter.from && r.timestamp < filter.from) return false;
      if (filter.to && r.timestamp > filter.to) return false;
      if (filter.provider && r.provider !== filter.provider) return false;
      if (filter.model && r.model !== filter.model) return false;
      if (filter.category && r.category !== filter.category) return false;
      if (filter.agent_id && r.agent_id !== filter.agent_id) return false;
      if (filter.user_id && r.user_id !== filter.user_id) return false;
      if (filter.status && r.status !== filter.status) return false;
      return true;
    });
  },
  getTokenUsage(id)           { return tokenUsageStore.get(id); },
  deleteTokenUsage(id)        { tokenUsageStore.delete(id); },
  // 用于快速清理：按时间截断
  pruneTokenUsageBefore(ts) {
    const data = tokenUsageStore._read();
    const before = data.calls.length;
    data.calls = data.calls.filter(r => r.timestamp >= ts);
    tokenUsageStore._write(data);
    return before - data.calls.length;
  },

  // ——— 网剧项目 ———
  insertDramaProject(row) {
    const data = readDramaDB(); row.created_at = row.created_at || new Date().toISOString(); row.updated_at = row.created_at;
    data.drama_projects.push(row); writeDramaDB(data);
  },
  getDramaProject(id) { return readDramaDB().drama_projects.find(r => r.id === id) || null; },
  listDramaProjects(userId) {
    return readDramaDB().drama_projects.filter(r => !userId || r.user_id === userId).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  },
  updateDramaProject(id, fields) {
    const data = readDramaDB(); const idx = data.drama_projects.findIndex(r => r.id === id);
    if (idx !== -1) { data.drama_projects[idx] = { ...data.drama_projects[idx], ...fields, updated_at: new Date().toISOString() }; writeDramaDB(data); }
  },
  deleteDramaProject(id) {
    const data = readDramaDB();
    data.drama_projects = data.drama_projects.filter(r => r.id !== id);
    data.drama_episodes = data.drama_episodes.filter(r => r.project_id !== id);
    writeDramaDB(data);
  },

  // ——— 网剧剧集 ———
  insertDramaEpisode(row) {
    const data = readDramaDB(); row.created_at = row.created_at || new Date().toISOString(); row.updated_at = row.created_at;
    data.drama_episodes.push(row); writeDramaDB(data);
  },
  getDramaEpisode(id) { return readDramaDB().drama_episodes.find(r => r.id === id) || null; },
  listDramaEpisodes(projectId) {
    return readDramaDB().drama_episodes.filter(r => r.project_id === projectId).sort((a, b) => (a.episode_index || 0) - (b.episode_index || 0));
  },
  updateDramaEpisode(id, fields) {
    const data = readDramaDB(); const idx = data.drama_episodes.findIndex(r => r.id === id);
    if (idx !== -1) { data.drama_episodes[idx] = { ...data.drama_episodes[idx], ...fields, updated_at: new Date().toISOString() }; writeDramaDB(data); }
  },
  deleteDramaEpisode(id) {
    const data = readDramaDB(); data.drama_episodes = data.drama_episodes.filter(r => r.id !== id); writeDramaDB(data);
  },

  // 兼容旧接口（works.js 等可能用到）
  insertDramaTask(row) { this.insertDramaEpisode(row); },
  getDramaTask(id) { return this.getDramaEpisode(id); },
  listDramaTasks(userId) { return readDramaDB().drama_episodes.filter(r => !userId || r.user_id === userId).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')); },
  updateDramaTask(id, fields) { this.updateDramaEpisode(id, fields); },
  deleteDramaTask(id) { this.deleteDramaEpisode(id); }
};

module.exports = db;
