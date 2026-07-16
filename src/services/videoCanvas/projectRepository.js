const { executeBatch } = require('../../db/sqlite');
const { db } = require('./database');
const { graphFingerprint, normalizeGraph } = require('./graphService');
const { id, nowIso, parseJson } = require('./common');

function mapProject(row) {
  if (!row) return null;
  return { ...row, settings: parseJson(row.settings_json, {}) };
}
function mapRevision(row) {
  if (!row) return null;
  return { ...row, graph: parseJson(row.graph_json, { nodes: [], edges: [] }) };
}
function getProject(projectId) { return mapProject(db().prepare('SELECT * FROM video_canvas_projects WHERE id=?').get(projectId)); }
function getRevision(revisionId) { return mapRevision(db().prepare('SELECT * FROM video_canvas_graph_revisions WHERE id=?').get(revisionId)); }
function getCurrentBundle(projectId) {
  const project = getProject(projectId);
  return project ? { project, revision: getRevision(project.current_revision_id) } : null;
}
function listProjects({ userId, includeAll = false, limit = 100, status = 'active' }) {
  const params = []; const where = [];
  if (!includeAll) { where.push('user_id=?'); params.push(userId); }
  if (status && status !== 'all') { where.push('status=?'); params.push(status); }
  params.push(Math.max(1, Math.min(200, Number(limit) || 100)));
  return db().prepare(`SELECT * FROM video_canvas_projects ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC LIMIT ?`).all(...params).map(mapProject);
}
function createProject({ userId, name = '未命名视频项目', domainPack = 'blank', settings = {}, graph = {} }) {
  const projectId = id('vcp'); const revisionId = id('vcgr'); const now = nowIso();
  const normalized = normalizeGraph(graph);
  executeBatch([
    { sql: `INSERT INTO video_canvas_projects(id,user_id,name,domain_pack,status,current_revision_id,settings_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`, params: [projectId, userId, String(name).slice(0, 120), domainPack, 'active', revisionId, JSON.stringify(settings || {}), now, now] },
    { sql: `INSERT INTO video_canvas_graph_revisions(id,project_id,revision_no,base_revision_id,graph_schema_version,graph_json,graph_fingerprint,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)`, params: [revisionId, projectId, 1, null, normalized.schemaVersion, JSON.stringify(normalized), graphFingerprint(normalized), userId, now] },
  ], { force: true });
  return getCurrentBundle(projectId);
}
function saveRevision({ projectId, userId, baseRevisionId, graph }) {
  const project = getProject(projectId);
  if (!project) return { notFound: true };
  if (project.current_revision_id !== baseRevisionId) return { conflict: true, currentRevisionId: project.current_revision_id };
  const current = getRevision(baseRevisionId);
  const normalized = normalizeGraph(graph); const revisionId = id('vcgr'); const now = nowIso();
  try {
    const result = executeBatch([
      { sql: `INSERT INTO video_canvas_graph_revisions(id,project_id,revision_no,base_revision_id,graph_schema_version,graph_json,graph_fingerprint,created_by,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM video_canvas_projects WHERE id=? AND current_revision_id=?)`, params: [revisionId, projectId, Number(current?.revision_no || 0) + 1, baseRevisionId, normalized.schemaVersion, JSON.stringify(normalized), graphFingerprint(normalized), userId, now, projectId, baseRevisionId] },
      { sql: `UPDATE video_canvas_projects SET current_revision_id=?,updated_at=? WHERE id=? AND current_revision_id=? AND EXISTS(SELECT 1 FROM video_canvas_graph_revisions WHERE id=?)`, params: [revisionId, now, projectId, baseRevisionId, revisionId] },
    ], { force: true });
    const changed = Number(result?.results?.[1]?.changes || 0);
    if (!changed) return { conflict: true, currentRevisionId: getProject(projectId)?.current_revision_id };
  } catch (error) {
    if (/UNIQUE constraint/i.test(error.message)) return { conflict: true, currentRevisionId: getProject(projectId)?.current_revision_id };
    throw error;
  }
  return { project: getProject(projectId), revision: getRevision(revisionId) };
}
function updateProject(projectId, patch = {}) {
  const current = getProject(projectId); if (!current) return null;
  const name = patch.name === undefined ? current.name : String(patch.name || '未命名视频项目').slice(0, 120);
  const status = patch.status === undefined ? current.status : patch.status;
  const domainPack = patch.domainPack === undefined ? current.domain_pack : patch.domainPack;
  const settings = patch.settings === undefined ? current.settings : patch.settings;
  db().prepare('UPDATE video_canvas_projects SET name=?,status=?,domain_pack=?,settings_json=?,updated_at=? WHERE id=?').run(name, status, domainPack, JSON.stringify(settings || {}), nowIso(), projectId);
  return getProject(projectId);
}
function listRevisions(projectId, limit = 50) {
  return db().prepare('SELECT * FROM video_canvas_graph_revisions WHERE project_id=? ORDER BY revision_no DESC LIMIT ?').all(projectId, Math.max(1, Math.min(200, Number(limit) || 50))).map(mapRevision);
}

module.exports = { createProject, getCurrentBundle, getProject, getRevision, listProjects, listRevisions, saveRevision, updateProject };
