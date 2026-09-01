const fs = require('fs');
const path = require('path');

function parseWorkspaceCsv(csvPath) {
  const text = fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '');
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const comma = rawLine.indexOf(',');
    if (comma < 1) continue;
    const key = rawLine.slice(0, comma).trim();
    let value = rawLine.slice(comma + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1).replace(/""/g, '"');
    values[key] = value;
  }
  const apiKey = values.apiKey || values['API Key'] || '';
  const apiHost = values.apiHost || values['API Host'] || '';
  const workspaceId = values.workspaceId || values['Workspace ID'] || '';
  const dashScope = values.dashScope || '';
  if (!/^sk-ws-/.test(apiKey)) throw new Error('CSV 中不是百炼工作空间 sk-ws-* API Key');
  if (!/^ws-[a-z0-9]+\.cn-beijing\.maas\.aliyuncs\.com$/i.test(apiHost)) throw new Error('CSV 中 API Host 不符合北京工作空间地址');
  if (!/^ws-[a-z0-9]+$/i.test(workspaceId) || !apiHost.toLowerCase().startsWith(`${workspaceId.toLowerCase()}.`)) throw new Error('CSV 中 Workspace ID 与 API Host 不一致');
  const apiUrl = dashScope || `https://${apiHost}/api/v1`;
  return { apiKey, apiHost, workspaceId, apiUrl, wsUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference/' };
}

function inside(root, target) {
  const base = path.resolve(root);
  const resolved = path.resolve(target);
  return resolved !== base && resolved.startsWith(`${base}${path.sep}`);
}

function clearLegacyTtsState(outputDir) {
  const targets = [
    path.join(outputDir, '_cosy_cache'),
    path.join(outputDir, 'avatar', 'bad_preview_voices.json'),
  ];
  const removed = [];
  for (const target of targets) {
    if (!inside(outputDir, target)) throw new Error(`拒绝清理 OUTPUT_DIR 外路径: ${target}`);
    if (!fs.existsSync(target)) continue;
    fs.rmSync(target, { recursive: true, force: true });
    removed.push(path.relative(outputDir, target).replace(/\\/g, '/'));
  }
  return removed;
}

function configure(csvPath) {
  const config = parseWorkspaceCsv(csvPath);
  const outputDir = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, '../outputs'));
  const { voices } = require('../src/services/aliyunCosyVoiceCatalog');
  const settingsService = require('../src/services/settingsService');
  const current = settingsService.loadSettings();
  const legacyIds = new Set(['aliyun-tts', 'aliyun-nls', 'dashscope', 'aliyun']);
  const providers = (current.providers || []).filter(p => !legacyIds.has(String(p?.id || p?.preset || '').toLowerCase()));
  providers.push({
    id: 'aliyun-tts',
    preset: 'aliyun-tts',
    name: '阿里百炼工作空间 · CosyVoice',
    api_key: config.apiKey,
    api_url: config.apiUrl,
    api_host: config.apiHost,
    api_ws_url: config.wsUrl,
    workspace_id: config.workspaceId,
    region: 'cn-beijing',
    enabled: true,
    models: voices.map(v => ({ id: v.id, name: v.name, type: 'tts', use: 'tts', model: v.model, enabled: true })),
    test_status: null,
    last_tested: null,
    catalog_synced_at: '2026-09-01',
    updated_at: new Date().toISOString(),
  });
  settingsService.saveSettings({ ...current, providers });
  const removed = clearLegacyTtsState(outputDir);
  return { workspaceId: config.workspaceId, apiHost: config.apiHost, voiceCount: voices.length, removed, legacyProviderCount: (current.providers || []).length - providers.length + 1 };
}

if (require.main === module) {
  const csvPath = process.argv[2];
  if (!csvPath) throw new Error('用法: node scripts/configure-aliyun-workspace-tts.js <workspace-api-key.csv>');
  const result = configure(path.resolve(csvPath));
  process.stdout.write(JSON.stringify({ ok: true, ...result }, null, 2) + '\n');
}

module.exports = { parseWorkspaceCsv, clearLegacyTtsState, configure };
