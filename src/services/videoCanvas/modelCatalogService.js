const { loadSettings } = require('../settingsService');

// Only expose image providers whose selected model is honored exactly by the
// V2 executor. This prevents a UI selection from silently falling back to a
// different model (and therefore a different price).
const EXACT_IMAGE_PROVIDERS = new Set(['deyunai', 'topview']);

function getModelCatalog() {
  let providers = [];
  try { providers = loadSettings().providers || []; } catch { providers = []; }
  const enabled = { image: [], video: [], text: [], voice: [], audio: [] };
  const disabled = [];
  for (const provider of providers) {
    const providerEnabled = provider.enabled !== false && !!provider.api_key;
    for (const model of provider.models || []) {
      const use = String(model.use || '').toLowerCase();
      if (!enabled[use]) continue;
      const entry = {
        providerId: String(provider.id || ''),
        providerName: String(provider.name || provider.id || ''),
        modelId: String(model.id || ''),
        modelName: String(model.name || model.id || ''),
        use,
        modelType: String(model.type || ''),
      };
      if (use === 'image' && !EXACT_IMAGE_PROVIDERS.has(entry.providerId)) {
        disabled.push({ ...entry, reason: '视频画布尚未启用该供应商的精确模型路由' });
        continue;
      }
      if (providerEnabled && model.enabled !== false && entry.providerId && entry.modelId) enabled[use].push(entry);
      else disabled.push({ ...entry, reason: !provider.api_key ? '未配置 API Key' : provider.enabled === false ? '供应商已停用' : '模型已停用' });
    }
  }
  return { ...enabled, disabled };
}

function findEnabledModel(use, providerId, modelId) {
  return (getModelCatalog()[use] || []).find(item => item.providerId === providerId && item.modelId === modelId) || null;
}

module.exports = { EXACT_IMAGE_PROVIDERS, findEnabledModel, getModelCatalog };
