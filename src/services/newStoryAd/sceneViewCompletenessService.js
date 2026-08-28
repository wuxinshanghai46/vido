const { cleanText } = require('./contextBuilder');

function assertComplete(views = [], requiredKeys = []) {
  const keys = (Array.isArray(views) ? views : [])
    .map(view => cleanText(view?.key || view?.view || '', 40))
    .filter(Boolean);
  const missing = requiredKeys.filter(key => !keys.includes(key));
  const duplicates = [...new Set(keys.filter((key, index) => keys.indexOf(key) !== index))];
  if (!missing.length && !duplicates.length) return { keys, missing, duplicates };
  const error = new Error(`场景资产视图不完整：${missing.length ? `缺少 ${missing.join('、')}` : ''}${missing.length && duplicates.length ? '；' : ''}${duplicates.length ? `重复 ${duplicates.join('、')}` : ''}`);
  error.code = 'SCENE_VIEWS_INCOMPLETE';
  error.status = 422;
  error.retryable = true;
  error.missing_view_keys = missing;
  error.duplicate_view_keys = duplicates;
  error.provider_image_call_count = 0;
  throw error;
}

module.exports = { assertComplete };
