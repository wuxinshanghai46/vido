const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const { db } = require('./database');
const { id, nowIso, parseJson } = require('./common');

const ROOT = path.resolve(process.env.OUTPUT_DIR || './outputs', 'video-canvas');
const ARTIFACT_ROOT = path.join(ROOT, 'artifacts');
const UPLOAD_ROOT = path.join(ROOT, 'uploads');

function safePath(candidate) {
  const resolved = path.resolve(candidate || '');
  const root = path.resolve(ROOT) + path.sep;
  if (resolved !== path.resolve(ROOT) && !resolved.startsWith(root)) throw new Error('非法视频画布文件路径');
  return resolved;
}
function sha256(filePath) {
  const hash = crypto.createHash('sha256'); hash.update(fs.readFileSync(filePath)); return hash.digest('hex');
}
function mapArtifact(row) { return row ? { ...row, metadata: parseJson(row.metadata_json, {}) } : null; }
function getArtifact(artifactId) { return mapArtifact(db().prepare('SELECT * FROM video_canvas_artifacts WHERE id=?').get(artifactId)); }
function listArtifacts({ userId, includeAll = false, projectId = '', kind = '', limit = 100 }) {
  const where = []; const params = [];
  if (!includeAll) { where.push('p.user_id=?'); params.push(userId); }
  if (projectId) { where.push('a.project_id=?'); params.push(projectId); }
  if (kind) { where.push('a.kind=?'); params.push(kind); }
  params.push(Math.max(1, Math.min(300, Number(limit) || 100)));
  return db().prepare(`SELECT a.* FROM video_canvas_artifacts a JOIN video_canvas_projects p ON p.id=a.project_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.created_at DESC LIMIT ?`).all(...params).map(mapArtifact);
}
function createArtifact({ projectId, nodeRunId = null, kind, filePath = '', publicUrl = '', inputFingerprint = '', metadata = {}, status = 'ready' }) {
  const artifactId = id('vca'); const now = nowIso();
  let finalPath = filePath ? safePath(filePath) : '';
  const exists = finalPath && fs.existsSync(finalPath);
  const stat = exists ? fs.statSync(finalPath) : null;
  const digest = exists && stat.isFile() ? sha256(finalPath) : (metadata.sha256 || '');
  db().prepare(`INSERT INTO video_canvas_artifacts(id,project_id,node_run_id,kind,storage_path,public_url,sha256,size_bytes,duration_sec,width,height,input_fingerprint,metadata_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(artifactId, projectId, nodeRunId, kind, finalPath || null, publicUrl || `/api/video-canvas/artifacts/${artifactId}/content`, digest, stat?.size || 0, Number(metadata.duration || 0), Number(metadata.width || 0), Number(metadata.height || 0), inputFingerprint || '', JSON.stringify(metadata || {}), status, now, now);
  return getArtifact(artifactId);
}
function registerUpload({ projectId, kind, tempPath, originalName, mimeType }) {
  fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
  const ext = path.extname(originalName || '') || extensionForMime(mimeType);
  const target = safePath(path.join(UPLOAD_ROOT, `${id('upload')}${ext}`));
  fs.renameSync(tempPath, target);
  return createArtifact({ projectId, kind, filePath: target, metadata: { originalName, mimeType, source: 'upload' } });
}
function createTextArtifact({ projectId, nodeRunId, text, inputFingerprint, kind = 'text', metadata = {} }) {
  return createArtifact({ projectId, nodeRunId, kind, inputFingerprint, metadata: { ...metadata, text: String(text || '') } });
}
function outputPath(projectId, nodeRunId, extension) {
  const dir = safePath(path.join(ARTIFACT_ROOT, projectId, nodeRunId)); fs.mkdirSync(dir, { recursive: true });
  return safePath(path.join(dir, `${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${String(extension || 'bin').replace(/^\./, '')}`));
}
function importFile({ projectId, nodeRunId, sourcePath, extension = '' }) {
  if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error('生成结果文件不存在');
  const ext = extension || path.extname(sourcePath) || '.bin';
  const target = outputPath(projectId, nodeRunId, ext);
  fs.copyFileSync(sourcePath, target);
  return target;
}
async function downloadRemote({ projectId, nodeRunId, url, extension = '' }) {
  if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('生成结果不是有效的 http(s) 地址');
  const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000, maxContentLength: 100 * 1024 * 1024, maxBodyLength: 100 * 1024 * 1024 });
  const ext = extension || extensionForMime(response.headers['content-type']) || path.extname(new URL(url).pathname) || '.bin';
  const target = outputPath(projectId, nodeRunId, ext);
  fs.writeFileSync(target, Buffer.from(response.data));
  return target;
}
function extensionForMime(mime = '') {
  if (/png/i.test(mime)) return '.png'; if (/jpe?g/i.test(mime)) return '.jpg'; if (/webp/i.test(mime)) return '.webp';
  if (/mp4/i.test(mime)) return '.mp4'; if (/mpeg|mp3/i.test(mime)) return '.mp3'; if (/wav/i.test(mime)) return '.wav'; return '.bin';
}
function userOwnsArtifact(artifactId, userId, includeAll = false) {
  if (includeAll) return !!getArtifact(artifactId);
  return !!db().prepare('SELECT 1 AS ok FROM video_canvas_artifacts a JOIN video_canvas_projects p ON p.id=a.project_id WHERE a.id=? AND p.user_id=?').get(artifactId, userId);
}

module.exports = { ARTIFACT_ROOT, ROOT, UPLOAD_ROOT, createArtifact, createTextArtifact, downloadRemote, getArtifact, importFile, listArtifacts, outputPath, registerUpload, safePath, userOwnsArtifact };
