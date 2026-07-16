const crypto = require('crypto');

function nowIso() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`; }
function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}
function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
}
function stableStringify(value) { return JSON.stringify(stableValue(value)); }
function fingerprint(value) { return crypto.createHash('sha256').update(stableStringify(value)).digest('hex'); }
function cleanText(value, max = 200) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max); }

module.exports = { cleanText, fingerprint, id, nowIso, parseJson, stableStringify };
