// 检查生产机上哪些 avatar-video provider 有 key
const path = require('path');
const { loadSettings } = require(path.join(__dirname, '..', 'src', 'services', 'settingsService'));
const s = loadSettings();
const want = ['hedra', 'kling', 'minimax', 'runway', 'luma', 'vidu', 'dashscope', 'seedance', '通义', '百炼'];
const providers = s.providers || [];
console.log('[providers total]', providers.length);
for (const p of providers) {
  const hay = ((p.id||'') + '|' + (p.preset||'') + '|' + (p.name||'') + '|' + (p.api_url||'')).toLowerCase();
  for (const w of want) {
    if (hay.includes(w.toLowerCase())) {
      console.log('✓', (p.id||'').padEnd(26), (p.preset||p.name||'').slice(0,30).padEnd(30), 'hasKey=', !!p.api_key, 'models=', (p.models||[]).length);
      break;
    }
  }
}
