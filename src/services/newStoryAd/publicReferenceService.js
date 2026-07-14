require('dotenv').config();

const DEFAULT_PUBLIC_BASE_URL = 'https://www.vidoai.cn';

function publicBaseUrl(env = process.env) {
  return String(
    env.NEW_STORY_AD_PUBLIC_BASE_URL
      || env.PUBLIC_BASE_URL
      || DEFAULT_PUBLIC_BASE_URL
  ).trim().replace(/\/$/, '');
}

function absolutePublicUrl(value = '', options = {}) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^\/\//.test(raw)) return `https:${raw}`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return '';

  const base = String(options.baseUrl || publicBaseUrl(options.env)).trim().replace(/\/$/, '');
  if (!/^https?:\/\//i.test(base)) return '';
  try {
    return new URL(raw, `${base}/`).toString();
  } catch (_) {
    return '';
  }
}

function normalizeVisionReferences(values = [], options = {}) {
  const source = Array.isArray(values) ? values : [values];
  const max = Math.max(1, Math.min(32, Number(options.max) || 8));
  const urls = [];
  const rejected = [];
  const duplicates = [];
  const seen = new Set();

  source.forEach((value, index) => {
    const raw = String(value || '').trim();
    if (!raw) {
      rejected.push({ index, value: '', reason: 'empty' });
      return;
    }
    const normalized = absolutePublicUrl(raw, options);
    if (!normalized) {
      rejected.push({ index, value: raw.slice(0, 500), reason: 'unsupported_or_invalid_url' });
      return;
    }
    if (seen.has(normalized)) {
      duplicates.push({ index, value: raw.slice(0, 500), normalized });
      return;
    }
    seen.add(normalized);
    if (urls.length < max) urls.push(normalized);
  });

  return {
    urls,
    rejected,
    duplicates,
    source_count: source.length,
    accepted_count: urls.length,
    base_url: String(options.baseUrl || publicBaseUrl(options.env)),
  };
}

module.exports = {
  DEFAULT_PUBLIC_BASE_URL,
  publicBaseUrl,
  absolutePublicUrl,
  normalizeVisionReferences,
};
