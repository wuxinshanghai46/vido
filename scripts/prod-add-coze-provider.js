// 在生产机 settings.json 中新增/更新 Coze provider（PAT + bot_id）
const fs = require('fs');
const SETTINGS_PATH = '/data/vido/outputs/settings.json';
const ALT_PATH = '/opt/vido/app/outputs/settings.json';

const PAT = process.env.COZE_PAT_ARG;
const BOT = process.env.COZE_BOT_ID_ARG;
if (!PAT || !BOT) { console.error('need COZE_PAT_ARG + COZE_BOT_ID_ARG env'); process.exit(1); }

const actualPath = fs.existsSync(SETTINGS_PATH) ? SETTINGS_PATH : ALT_PATH;
const s = JSON.parse(fs.readFileSync(actualPath, 'utf-8'));
s.providers = s.providers || [];

const existing = s.providers.find(p =>
  ((p.id||'')+'|'+(p.name||'')+'|'+(p.preset||'')).toLowerCase().includes('coze')
);

if (existing) {
  existing.api_key = PAT;
  existing.bot_id = BOT;
  existing.metadata = { ...(existing.metadata||{}), bot_id: BOT };
  existing.api_url = 'https://api.coze.cn';
  console.log('[updated coze provider]', existing.id);
} else {
  s.providers.push({
    id: 'coze',
    preset: 'coze',
    name: 'Coze（调飞影插件）',
    api_url: 'https://api.coze.cn',
    api_key: PAT,
    bot_id: BOT,
    metadata: { bot_id: BOT, workspace_id: '7576120672012468230' },
    models: [
      { id: 'coze-chat-hifly', use: 'video', enabled: true },
    ],
    created_at: new Date().toISOString(),
  });
  console.log('[created coze provider]');
}

fs.writeFileSync(actualPath, JSON.stringify(s, null, 2));
console.log('written to', actualPath);
console.log('total providers:', s.providers.length);
