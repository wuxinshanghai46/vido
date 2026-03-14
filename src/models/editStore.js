/**
 * 编辑数据存储（附加到 JSON 数据库）
 */
const fs = require('fs');
const path = require('path');

const EDIT_DB = path.join(__dirname, '../../outputs/edit_db.json');

function readDB() {
  try {
    if (!fs.existsSync(EDIT_DB)) return { edits: {} };
    return JSON.parse(fs.readFileSync(EDIT_DB, 'utf8'));
  } catch { return { edits: {} }; }
}

function writeDB(data) {
  fs.mkdirSync(path.dirname(EDIT_DB), { recursive: true });
  fs.writeFileSync(EDIT_DB, JSON.stringify(data, null, 2));
}

// 获取项目编辑数据（不存在则返回默认）
function getEdit(projectId) {
  return readDB().edits[projectId] || {
    project_id: projectId,
    scenes_order: null,       // null = 原始顺序
    scene_trims: {},          // { sceneIndex: { start, end } }
    deleted_scenes: [],       // 已删除的 sceneIndex
    music: null,              // { file_path, volume, loop }
    dialogues: [],            // [{ scene_index, text, start, duration, position, font_size, color }]
    updated_at: null
  };
}

function saveEdit(projectId, editData) {
  const db = readDB();
  db.edits[projectId] = { ...editData, project_id: projectId, updated_at: new Date().toISOString() };
  writeDB(db);
}

function clearEdit(projectId) {
  const db = readDB();
  delete db.edits[projectId];
  writeDB(db);
}

module.exports = { getEdit, saveEdit, clearEdit };
