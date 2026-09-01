const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-aliyun-workspace-'));
process.env.OUTPUT_DIR = root;
process.env.DB_ENABLED = '0';
const csv = path.join(root, 'workspace.csv');
fs.writeFileSync(csv, [
  'apiKey,sk-ws-test-key',
  'apiHost,ws-example123.cn-beijing.maas.aliyuncs.com',
  'dashScope,https://ws-example123.cn-beijing.maas.aliyuncs.com/api/v1',
  'workspaceId,ws-example123',
].join('\n'));

const settingsPath = path.join(root, 'settings.json');
fs.writeFileSync(settingsPath, JSON.stringify({ providers: [
  { id: 'aliyun-tts', api_key: 'old-cosy-key', enabled: true },
  { id: 'aliyun-nls', api_key: 'old-nls-key', enabled: true },
  { id: 'zhipu', api_key: 'keep-me', enabled: true },
] }));
fs.mkdirSync(path.join(root, '_cosy_cache'), { recursive: true });
fs.writeFileSync(path.join(root, '_cosy_cache', 'old.mp3'), 'old');
fs.mkdirSync(path.join(root, 'avatar', '__preview_cache'), { recursive: true });
fs.writeFileSync(path.join(root, 'avatar', '__preview_cache', 'old.mp3'), 'old');
fs.writeFileSync(path.join(root, 'avatar', 'bad_preview_voices.json'), '["longxiaochun_v3"]');

const migration = require('./configure-aliyun-workspace-tts');
const result = migration.configure(csv);
const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
const ali = saved.providers.find(p => p.id === 'aliyun-tts');
assert(ali, 'new aliyun workspace provider must exist');
assert.equal(ali.api_key, 'sk-ws-test-key');
assert.equal(ali.workspace_id, 'ws-example123');
assert.equal(ali.api_ws_url, 'wss://dashscope.aliyuncs.com/api-ws/v1/inference/');
assert.equal(saved.providers.some(p => p.id === 'aliyun-nls'), false, 'legacy NLS provider must be removed');
assert(saved.providers.some(p => p.id === 'zhipu'), 'unrelated provider must be preserved');
assert(result.voiceCount >= 80, 'official catalog must contain the full current voice set');
assert.equal(fs.existsSync(path.join(root, '_cosy_cache')), false);
assert.equal(fs.existsSync(path.join(root, 'avatar', '__preview_cache')), true, 'shared preview cache must not be deleted');
assert.equal(fs.existsSync(path.join(root, 'avatar', 'bad_preview_voices.json')), false);

const aliyun = require('../src/services/aliyunVoiceService');
assert.equal(aliyun._getProviderConfig().wsUrl, ali.api_ws_url, 'runtime must use workspace WebSocket endpoint');
assert.equal(require('../src/services/ttsService').getAvailableVoices().filter(v => v.provider === '阿里云').length, result.voiceCount);
assert.equal(require('../src/services/ttsService').getAvailableVoices().some(v => v.provider === '阿里NLS'), false);

fs.rmSync(root, { recursive: true, force: true });
console.log(`aliyun workspace tts tests passed: voices=${result.voiceCount}, removed=${result.removed.length}`);
