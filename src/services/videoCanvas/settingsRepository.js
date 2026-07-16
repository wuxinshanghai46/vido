const { db } = require('./database');
const { nowIso, parseJson } = require('./common');

const DEFAULT_SETTINGS = Object.freeze({
  quality: 'preview',
  maxCostUsd: 5,
  autoRetry: 0,
  concurrency: 2,
});

function sanitizeSettings(value = {}) {
  return {
    quality: value.quality === 'final' ? 'final' : 'preview',
    maxCostUsd: Math.max(0, Number(value.maxCostUsd ?? DEFAULT_SETTINGS.maxCostUsd) || 0),
    autoRetry: Math.max(0, Math.min(1, Number(value.autoRetry ?? DEFAULT_SETTINGS.autoRetry) || 0)),
    concurrency: Math.max(1, Math.min(4, Number(value.concurrency ?? DEFAULT_SETTINGS.concurrency) || DEFAULT_SETTINGS.concurrency)),
    ...(Array.isArray(value.enabledPacks) ? { enabledPacks: value.enabledPacks.slice(0, 10) } : {}),
  };
}

function getSettings(userId) {
  const row = db().prepare('SELECT settings_json,updated_at FROM video_canvas_settings WHERE user_id=?').get(userId);
  return {
    settings: sanitizeSettings({ ...DEFAULT_SETTINGS, ...parseJson(row?.settings_json, {}) }),
    updatedAt: row?.updated_at || '',
  };
}

function saveSettings(userId, value) {
  const settings = sanitizeSettings(value);
  const updatedAt = nowIso();
  db().prepare('INSERT OR REPLACE INTO video_canvas_settings(user_id,settings_json,updated_at) VALUES(?,?,?)').run(userId, JSON.stringify(settings), updatedAt);
  return { settings, updatedAt };
}

module.exports = { DEFAULT_SETTINGS, getSettings, sanitizeSettings, saveSettings };
