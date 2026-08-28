'use strict';

const fs = require('fs');
const path = require('path');
const mediaAdapter = require('./mediaAdapter');

function mediaUrl(value = {}) {
  if (typeof value === 'string') return String(value || '').trim();
  return String(value?.url || value?.image_url || value?.imageUrl || value?.file_path || value?.filePath || '').trim();
}

function localFile(value = {}) {
  const direct = String(value?.file_path || value?.filePath || '').trim();
  if (direct) {
    const resolved = path.resolve(direct);
    const root = path.resolve(mediaAdapter.ASSET_DIR);
    if (resolved.startsWith(`${root}${path.sep}`)) return resolved;
  }
  const url = mediaUrl(value);
  if (!url.startsWith('/api/new-story-ad/assets/')) return '';
  const filename = decodeURIComponent(url.split('/').pop()?.split('?')[0] || '');
  return filename ? mediaAdapter.assetPathFromName(filename) : '';
}

function inspect(value = {}) {
  const file = localFile(value);
  const local = Boolean(file);
  return {
    url: mediaUrl(value),
    local,
    available: local ? fs.existsSync(file) : Boolean(mediaUrl(value)),
    filename: file ? path.basename(file) : '',
    file,
  };
}

function partitionViews(views = []) {
  const available = [];
  const missing = [];
  (Array.isArray(views) ? views : []).forEach((view, index) => {
    const state = inspect(view);
    const row = { view, index, ...state };
    if (state.available) available.push(row);
    else if (state.local) missing.push(row);
  });
  return { available, missing };
}

function collectLocalFilenames(value, result = new Set(), seen = new Set()) {
  if (value === null || value === undefined) return result;
  if (typeof value === 'string') {
    const state = inspect(value);
    if (state.filename) result.add(state.filename);
    return result;
  }
  if (typeof value !== 'object' || seen.has(value)) return result;
  seen.add(value);
  if (!Array.isArray(value)) {
    const state = inspect(value);
    if (state.filename) result.add(state.filename);
  }
  Object.values(value).forEach(child => collectLocalFilenames(child, result, seen));
  return result;
}

function publishedFilenames(storage, taskId = '') {
  const result = new Set();
  [storage.getOutput(taskId, 'scene_assets'), storage.getOutput(taskId, 'context')]
    .filter(Boolean)
    .forEach(value => collectLocalFilenames(value, result));
  return result;
}

module.exports = { collectLocalFilenames, inspect, localFile, mediaUrl, partitionViews, publishedFilenames };
