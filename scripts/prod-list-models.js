const path = require('path');
const { loadSettings } = require(path.join(__dirname, '..', 'src', 'services', 'settingsService'));
const s = loadSettings();
for (const prov of (s.providers || [])) {
  const id = (prov.id || '').toLowerCase();
  const name = prov.name || prov.id;
  if (id.includes('kling') || id.includes('minimax') || id.includes('api-key-2026') || /hedra|dashscope|通义|百炼/i.test(prov.name||'')) {
    console.log('=== ' + name + ' (id=' + prov.id + ') ===');
    console.log(' hasKey=', !!prov.api_key, ' api_url=', prov.api_url || '(default)');
    (prov.models || []).forEach(m => console.log('  -', m.id, 'use=' + (m.use||'-'), 'enabled=' + (m.enabled !== false)));
  }
}
