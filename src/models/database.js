/**
 * 轻量级 JSON 文件数据库（无需编译，纯 Node.js）
 */
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../outputs/vido_db.json');

const DEFAULT_DB = {
  projects: [],
  stories: [],
  video_clips: [],
  final_videos: [],
  i2v_tasks: []
};

function readDB() {
  try {
    if (!fs.existsSync(DB_PATH)) return JSON.parse(JSON.stringify(DEFAULT_DB));
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_DB));
  }
}

function writeDB(data) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

const db = {
  // ——— Projects ———
  insertProject(row) {
    const data = readDB();
    row.created_at = new Date().toISOString();
    row.updated_at = row.created_at;
    data.projects.push(row);
    writeDB(data);
  },
  getProject(id) {
    return readDB().projects.find(p => p.id === id) || null;
  },
  listProjects() {
    return readDB().projects.sort((a, b) => b.created_at.localeCompare(a.created_at));
  },
  updateProject(id, fields) {
    const data = readDB();
    const idx = data.projects.findIndex(p => p.id === id);
    if (idx !== -1) {
      data.projects[idx] = { ...data.projects[idx], ...fields, updated_at: new Date().toISOString() };
      writeDB(data);
    }
  },

  // ——— Stories ———
  insertStory(row) {
    const data = readDB();
    row.created_at = new Date().toISOString();
    data.stories.push(row);
    writeDB(data);
  },
  getStoryByProject(projectId) {
    return readDB().stories.find(s => s.project_id === projectId) || null;
  },

  // ——— Video Clips ———
  insertClip(row) {
    const data = readDB();
    row.created_at = new Date().toISOString();
    data.video_clips.push(row);
    writeDB(data);
  },
  updateClip(id, fields) {
    const data = readDB();
    const idx = data.video_clips.findIndex(c => c.id === id);
    if (idx !== -1) {
      data.video_clips[idx] = { ...data.video_clips[idx], ...fields };
      writeDB(data);
    }
  },
  getClipsByProject(projectId) {
    return readDB().video_clips
      .filter(c => c.project_id === projectId)
      .sort((a, b) => a.scene_index - b.scene_index);
  },
  getClip(id, projectId) {
    return readDB().video_clips.find(c => c.id === id && c.project_id === projectId) || null;
  },

  // ——— Final Videos ———
  insertFinalVideo(row) {
    const data = readDB();
    row.created_at = new Date().toISOString();
    data.final_videos.push(row);
    writeDB(data);
  },
  getFinalVideoByProject(projectId) {
    return readDB().final_videos.find(v => v.project_id === projectId) || null;
  },

  // ——— I2V Tasks（图生视频）———
  insertI2VTask(row) {
    const data = readDB();
    if (!data.i2v_tasks) data.i2v_tasks = [];
    row.created_at = new Date().toISOString();
    row.updated_at = row.created_at;
    data.i2v_tasks.push(row);
    writeDB(data);
  },
  getI2VTask(id) {
    const data = readDB();
    return (data.i2v_tasks || []).find(t => t.id === id) || null;
  },
  listI2VTasks() {
    const data = readDB();
    return (data.i2v_tasks || []).sort((a, b) => b.created_at.localeCompare(a.created_at));
  },
  updateI2VTask(id, fields) {
    const data = readDB();
    if (!data.i2v_tasks) data.i2v_tasks = [];
    const idx = data.i2v_tasks.findIndex(t => t.id === id);
    if (idx !== -1) {
      data.i2v_tasks[idx] = { ...data.i2v_tasks[idx], ...fields, updated_at: new Date().toISOString() };
      writeDB(data);
    }
  }
};

module.exports = db;
