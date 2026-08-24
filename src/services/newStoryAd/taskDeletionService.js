const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, '../../../outputs'));

function insideOutput(filePath = '') {
  const resolved = path.resolve(filePath);
  return resolved.startsWith(`${OUTPUT_DIR}${path.sep}`) && resolved !== OUTPUT_DIR;
}

function strings(value, result = []) {
  if (typeof value === 'string') result.push(value);
  else if (Array.isArray(value)) value.forEach(item => strings(item, result));
  else if (value && typeof value === 'object') Object.values(value).forEach(item => strings(item, result));
  return result;
}

function retainedReferencePaths(value, result = new Set()) {
  if (Array.isArray(value)) value.forEach(item => retainedReferencePaths(item, result));
  else if (value && typeof value === 'object') {
    const marker = [value.role, value.source_type, value.sourceType, value.origin, value.kind].join(' ').toLowerCase();
    const sharedReference = Boolean(value.source_library_asset_id || value.asset_library_id || value.material_id)
      || value.user_owned === true || /upload|reference|library|brand_logo/.test(marker);
    if (sharedReference) strings(value).map(toPath).filter(Boolean).forEach(filePath => result.add(filePath));
    Object.values(value).forEach(item => retainedReferencePaths(item, result));
  }
  return result;
}

function toPath(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  if (path.isAbsolute(text) && insideOutput(text)) return path.resolve(text);
  const assetMatch = text.match(/^\/api\/new-story-ad\/assets\/([^?#/]+)(?:[?#].*)?$/i);
  if (assetMatch) {
    const candidate = path.join(OUTPUT_DIR, 'new-story-ad-assets', path.basename(decodeURIComponent(assetMatch[1])));
    return insideOutput(candidate) ? candidate : '';
  }
  return '';
}

function taskPayload(storage, taskId) {
  if (typeof storage.taskDeletionPayload === 'function') return storage.taskDeletionPayload(taskId);
  const db = storage.readDb();
  const rows = {};
  for (const [key, items] of Object.entries(db)) {
    if (!Array.isArray(items)) continue;
    rows[key] = items.filter(row => String(row.task_id || row.id || '') === String(taskId));
  }
  return { task: (db.tasks || []).find(row => String(row.id || '') === String(taskId)) || null, rows };
}

function cleanupFiles(candidates = [], retainedPaths = new Set()) {
  const result = { deleted_files: 0, preserved_shared_files: 0, failed_files: [] };
  for (const filePath of candidates) {
    if (retainedPaths.has(filePath)) { result.preserved_shared_files += 1; continue; }
    try {
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        fs.rmSync(filePath, { force: true });
        result.deleted_files += 1;
      }
    } catch (error) {
      result.failed_files.push({ file: path.relative(OUTPUT_DIR, filePath).replace(/\\/g, '/'), error: error.message });
    }
  }
  return result;
}

function deleteTaskPermanently(storage, taskId, options = {}) {
  const payload = taskPayload(storage, taskId);
  const candidates = [...new Set(strings({ task: payload.task, rows: payload.rows }).map(toPath).filter(Boolean))];
  const retainedPaths = retainedReferencePaths({ task: payload.task, rows: payload.rows });
  const deleted = storage.deleteTask(taskId);
  if (!deleted) return { deleted: false, deleted_files: 0, preserved_shared_files: 0, failed_files: [] };
  if (options.deferFileCleanup === true) {
    setImmediate(() => cleanupFiles(candidates, retainedPaths));
    return { deleted: true, deleted_files: 0, preserved_shared_files: 0, failed_files: [], cleanup_pending: candidates.length > 0 };
  }
  return { deleted: true, cleanup_pending: false, ...cleanupFiles(candidates, retainedPaths) };
}

module.exports = { OUTPUT_DIR, insideOutput, toPath, retainedReferencePaths, cleanupFiles, deleteTaskPermanently };
