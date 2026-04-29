#!/usr/bin/env node
/**
 * 在本地 settings.json 中 upsert 飞影 Hifly provider，token 从 env 取（不进代码/git）。
 * 用法: HIFLY_TOKEN='xxx' node scripts/setup-hifly-local.js
 */
const { loadSettings, saveSettings } = require('../src/services/settingsService');

const TOKEN = process.env.HIFLY_TOKEN;
if (!TOKEN) { console.error('需 HIFLY_TOKEN 环境变量'); process.exit(1); }

(async () => {
  const settings = loadSettings();
  settings.providers = settings.providers || [];

  const isHifly = (p) => /hifly|lingverse/i.test((p.id || '') + '|' + (p.preset || '') + '|' + (p.name || ''));
  let prov = settings.providers.find(isHifly);

  const stub = {
    id: 'hifly',
    name: '飞影 Hifly',
    preset: 'hifly',
    api_key: TOKEN,
    api_url: 'https://hfw-api.hifly.cc',
    enabled: true,
    created_at: new Date().toISOString(),
    models: [
      { id: 'hifly', model_id: 'hifly', name: '飞影口型同步', use: 'avatar', enabled: true },
    ],
  };

  if (prov) {
    prov.api_key = TOKEN;
    prov.api_url = prov.api_url || stub.api_url;
    prov.enabled = true;
    prov.updated_at = new Date().toISOString();
    if (!prov.models || !prov.models.length) prov.models = stub.models;
    console.log('✓ 已更新现有 hifly provider:', prov.id);
  } else {
    settings.providers.push(stub);
    console.log('✓ 已新增 hifly provider: hifly');
  }
  saveSettings(settings);

  // 烟测
  try {
    const hifly = require('../src/services/hiflyService');
    const left = await hifly.getCredit();
    console.log(`✓ getCredit 烟测通过: 剩余积分 = ${left}`);
  } catch (e) {
    console.error('✗ getCredit 烟测失败:', e.message);
    process.exit(2);
  }
})();
