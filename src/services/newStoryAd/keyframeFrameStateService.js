const fs = require('fs');
const mediaAdapter = require('./mediaAdapter');

function imageUrl(frame = {}) {
  const value = frame && typeof frame === 'object' ? frame : {};
  return String(value.image_url || value.imageUrl || value.url || '').trim();
}

function localAssetExists(url = '') {
  const clean = String(url || '').split('?')[0];
  // Historical frames can use a provider URL. Newly generated frames are
  // persisted locally, so local URLs must resolve to a real asset.
  if (!clean.startsWith('/api/new-story-ad/assets/')) return /^https?:\/\//i.test(clean);
  const filename = decodeURIComponent(clean.split('/').pop() || '');
  const filePath = mediaAdapter.assetPathFromName(filename);
  return !!(filePath && fs.existsSync(filePath));
}

function isComplete(frame = {}) {
  const url = imageUrl(frame);
  return !!(url && !frame.error && !frame.error_code && localAssetExists(url));
}

function hasUsablePrevious(frame = {}) {
  const url = imageUrl(frame);
  return !!(url && localAssetExists(url) && frame.qa?.pass === true);
}

function completion(keyframes = [], shots = []) {
  const total = Math.max(Array.isArray(shots) ? shots.length : 0, Array.isArray(keyframes) ? keyframes.length : 0);
  const indexes = Array.from({ length: total }, (_, index) => index);
  const completed = indexes.filter(index => isComplete(keyframes[index])).length;
  const failed = indexes.filter(index => keyframes[index]?.error && !isComplete(keyframes[index])).length;
  const missing_indexes = indexes.filter(index => !isComplete(keyframes[index]));
  const retained_previous = indexes.filter(index => isComplete(keyframes[index]) && !!keyframes[index]?.regeneration_error).length;
  const fresh_pass = indexes.filter(index => isComplete(keyframes[index])
    && !keyframes[index]?.regeneration_error
    && !['pending', 'generating', 'retrying_serial', 'outdated'].includes(String(keyframes[index]?.current_generation_status || ''))
    && keyframes[index]?.contract_outdated !== true
    && Number(keyframes[index]?.qa_policy_version || 0) >= 2
    && keyframes[index]?.qa?.pass === true).length;
  const outdated = indexes.filter(index => isComplete(keyframes[index])
    && !keyframes[index]?.regeneration_error
    && (Number(keyframes[index]?.qa_policy_version || 0) < 2
      || keyframes[index]?.contract_outdated === true
      || String(keyframes[index]?.current_generation_status || '') === 'outdated')).length;
  const needs_regeneration = indexes.filter(index => !isComplete(keyframes[index])
    || !!keyframes[index]?.regeneration_error
    || Number(keyframes[index]?.qa_policy_version || 0) < 2
    || keyframes[index]?.contract_outdated === true
    || ['pending', 'generating', 'retrying_serial', 'outdated'].includes(String(keyframes[index]?.current_generation_status || ''))
    || keyframes[index]?.qa?.pass !== true).length;
  return { total, completed, fresh_pass, outdated, retained_previous, latest_failed: retained_previous + failed, needs_regeneration, missing: Math.max(0, total - completed), failed, missing_indexes };
}

module.exports = { imageUrl, localAssetExists, isComplete, hasUsablePrevious, completion };
