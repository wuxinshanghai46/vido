const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqliteConfig = require('../src/db/sqlite');
const appKv = require('../src/repositories/appKvRepository');
const { loadSettings } = require('../src/services/settingsService');

function providerKey(provider = {}) {
  return String(provider.id || provider.preset || '').trim().toLowerCase();
}

function credentialFingerprint(value = '') {
  return value
    ? crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12)
    : '';
}

function sanitized(provider = null) {
  if (!provider) return null;
  return {
    id: provider.id || '',
    preset: provider.preset || '',
    name: provider.name || '',
    enabled: provider.enabled !== false,
    has_key: !!provider.api_key,
    model_count: Array.isArray(provider.models) ? provider.models.length : 0,
    vision_models: (provider.models || [])
      .filter(model => /gemini|gpt-4o|glm|qwen.*vl/i.test(String(model.id || '')))
      .map(model => ({
        id: model.id,
        use: model.use || model.type || '',
        enabled: model.enabled !== false,
      })),
  };
}

function readSettingsFromBackupDb(dbPath = '') {
  const resolved = path.resolve(String(dbPath || ''));
  if (!resolved || !fs.existsSync(resolved)) {
    throw new Error(`生产备份数据库不存在: ${resolved || 'empty'}`);
  }
  const originalDbPath = process.env.DB_PATH;
  try {
    process.env.DB_PATH = resolved;
    const batch = sqliteConfig.executeBatch([{
      sql: 'SELECT value_json FROM app_kv WHERE key = ?',
      params: ['settings.full'],
      mode: 'get',
    }], { fresh: true });
    const row = batch?.results?.[0];
    if (!row?.value_json) throw new Error('生产备份数据库缺少 settings.full');
    const parsed = JSON.parse(row.value_json);
    if (!Array.isArray(parsed.providers) || !parsed.providers.length) {
      throw new Error('生产备份数据库中的 settings.full 供应商为空');
    }
    return parsed;
  } finally {
    sqliteConfig.closeDatabase();
    if (originalDbPath === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = originalDbPath;
  }
}

function main(argv = process.argv.slice(2)) {
  const apply = argv.includes('--apply');
  const baseDbIndex = argv.indexOf('--base-db');
  const baseDbPath = baseDbIndex >= 0 ? argv[baseDbIndex + 1] : '';
  const dbConfig = sqliteConfig.getDbConfig();
  if (!dbConfig.enabled || !dbConfig.readPrimary) {
    throw new Error('必须在生产 PM2 的 SQLite 主读环境中执行');
  }
  const jsonPath = path.resolve(process.env.OUTPUT_DIR || './outputs', 'settings.json');
  const mirror = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const source = (mirror.providers || []).find(provider => providerKey(provider) === 'deyunai');
  if (!source || !source.api_key) throw new Error('JSON 镜像中没有完整的漫路供应商配置');

  const current = baseDbPath
    ? readSettingsFromBackupDb(baseDbPath)
    : (appKv.get('settings.full', null) || { providers: [], mcps: [], skills: [] });
  current.providers = Array.isArray(current.providers) ? current.providers : [];
  const existing = current.providers.find(provider => providerKey(provider) === 'deyunai');
  const sourceFingerprint = credentialFingerprint(source.api_key);
  const existingFingerprint = credentialFingerprint(existing?.api_key);
  const credentialDiffers = !!existing && sourceFingerprint !== existingFingerprint;
  const shouldWrite = !!baseDbPath || !existing || credentialDiffers;
  if (apply && shouldWrite) {
    if (existing) {
      Object.assign(existing, JSON.parse(JSON.stringify(source)));
    } else {
      current.providers.push(JSON.parse(JSON.stringify(source)));
    }
    appKv.set('settings.full', current);
  }
  const verified = (loadSettings().providers || []).find(provider => providerKey(provider) === 'deyunai');
  const runtimeFingerprint = credentialFingerprint(verified?.api_key);
  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry_run',
    db_path: dbConfig.path,
    base_db_path: baseDbPath ? path.resolve(baseDbPath) : '',
    provider_count: current.providers.length,
    existed_before: !!existing,
    credential_differs_before: credentialDiffers,
    source: sanitized(source),
    runtime_after: sanitized(verified),
    credential_matches_after: sourceFingerprint === runtimeFingerprint,
    restored: apply && shouldWrite && !!verified
      && sourceFingerprint === runtimeFingerprint,
  }));
  if (apply && (!verified || sourceFingerprint !== runtimeFingerprint)) {
    throw new Error('漫路供应商写入后未能从生产运行时读取');
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

module.exports = { main, providerKey, sanitized };
