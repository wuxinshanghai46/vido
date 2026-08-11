const fs = require('fs');
const path = require('path');

const VOICE_PACK_ROOT = path.resolve(process.env.VOICE_PACK_ROOT || path.join(__dirname, '../../outputs/voice-packs'));
let catalogCache = null;
let catalogMtime = 0;

function manifestPath() {
  return path.join(VOICE_PACK_ROOT, 'catalog.json');
}

function loadCatalog() {
  const file = manifestPath();
  if (!fs.existsSync(file)) return { version: 1, generated_at: null, rights: null, voices: [], summary: { available: false } };
  const stat = fs.statSync(file);
  if (!catalogCache || stat.mtimeMs !== catalogMtime) {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed.voices)) throw new Error('音色包清单格式错误：voices 必须为数组');
    catalogCache = parsed;
    catalogMtime = stat.mtimeMs;
  }
  return catalogCache;
}

function publicVoice(row) {
  return {
    id: row.id,
    name: row.name,
    gender: row.gender || 'neutral',
    category: row.category || '未分类',
    tags: Array.isArray(row.tags) ? row.tags : [],
    duration: Number(row.duration || 0),
    clonable: row.clonable === true,
    sample_rate: Number(row.sample_rate || 0),
    rights_status: row.rights_status || 'unknown',
  };
}

function listVoicePacks({ q = '', category = '', gender = '', page = 1, limit = 24 } = {}) {
  const catalog = loadCatalog();
  const needle = String(q || '').trim().toLowerCase();
  const wantedCategory = String(category || '').trim();
  const wantedGender = String(gender || '').trim();
  const safeLimit = Math.max(1, Math.min(60, Number(limit) || 24));
  const safePage = Math.max(1, Number(page) || 1);
  const filtered = catalog.voices.filter(row => {
    if (wantedCategory && row.category !== wantedCategory) return false;
    if (wantedGender && row.gender !== wantedGender) return false;
    if (!needle) return true;
    return [row.name, row.category, ...(row.tags || [])].join(' ').toLowerCase().includes(needle);
  });
  const offset = (safePage - 1) * safeLimit;
  return {
    voices: filtered.slice(offset, offset + safeLimit).map(publicVoice),
    page: safePage,
    limit: safeLimit,
    total: filtered.length,
    pages: Math.max(1, Math.ceil(filtered.length / safeLimit)),
    categories: [...new Set(catalog.voices.map(v => v.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    summary: catalog.summary || {},
    rights: catalog.rights ? { status: catalog.rights.status, confirmed_at: catalog.rights.confirmed_at } : null,
  };
}

function getVoicePack(id) {
  const key = String(id || '').trim();
  if (!/^vp_[a-f0-9]{16,64}$/i.test(key)) return null;
  return loadCatalog().voices.find(v => v.id === key) || null;
}

function resolveVoicePackAudio(id) {
  const voice = getVoicePack(id);
  if (!voice) return null;
  const file = path.resolve(VOICE_PACK_ROOT, String(voice.file || ''));
  const relative = path.relative(VOICE_PACK_ROOT, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(file)) return null;
  return { voice, file };
}

module.exports = {
  VOICE_PACK_ROOT,
  loadCatalog,
  listVoicePacks,
  getVoicePack,
  resolveVoicePackAudio,
};
