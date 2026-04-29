// 在生产机 settings.json 中新增 Hifly provider（幂等，存在则更新 api_key）
const fs = require('fs');
const path = require('path');
const SETTINGS_PATH = '/data/vido/outputs/settings.json';
// 兼容可能软链未生效的情况
const ALT_PATH = '/opt/vido/app/outputs/settings.json';

const TOKEN = process.env.HIFLY_TOKEN_ARG;
if (!TOKEN) { console.error('need HIFLY_TOKEN_ARG env'); process.exit(1); }

const actualPath = fs.existsSync(SETTINGS_PATH) ? SETTINGS_PATH : ALT_PATH;
const s = JSON.parse(fs.readFileSync(actualPath, 'utf-8'));
s.providers = s.providers || [];

const existing = s.providers.find(p =>
  ((p.id||'')+ '|' +(p.name||'')+ '|' +(p.preset||'')).toLowerCase().includes('hifly')
);

if (existing) {
  existing.api_key = TOKEN;
  existing.api_url = 'https://hfw-api.hifly.cc';
  existing.name = existing.name || 'Hifly';
  console.log('[updated]', existing.id, '← api_key set');
} else {
  s.providers.push({
    id: 'hifly',
    preset: 'hifly',
    name: 'Hifly 数字人',
    api_url: 'https://hfw-api.hifly.cc',
    api_key: TOKEN,
    models: [
      { id: 'hifly-avatar-image', use: 'avatar', enabled: true },
      { id: 'hifly-avatar-video', use: 'avatar', enabled: true },
      { id: 'hifly-voice-clone', use: 'tts', enabled: true },
      { id: 'hifly-video-tts', use: 'video', enabled: true },
    ],
    created_at: new Date().toISOString(),
  });
  console.log('[created] hifly provider appended');
}

fs.writeFileSync(actualPath, JSON.stringify(s, null, 2));
console.log('written to', actualPath);
console.log('total providers:', s.providers.length);
