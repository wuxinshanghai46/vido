#!/usr/bin/env node
/**
 * 把火山方舟 /api/v3/models 拉到的在线模型同步到 outputs/settings.json
 * 保留用户现有 models 条目（按 id 去重），新模型追加在后面
 * 按 use 字段自动分类（video / image / story / vision / 3d / embedding）
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const SETTINGS_PATH = path.join(__dirname, '..', 'outputs', 'settings.json');

// 火山方舟对应的 provider name 片段（匹配时不区分大小写）
const PROVIDER_MATCH = /火山|volcengine|ark|seedance|doubao/i;

function categorizeModel(m) {
  const id = (m.id || '').toLowerCase();
  const tt = (m.task_type || []).join(',').toLowerCase();
  const om = (m.modalities?.output_modalities || []).join(',').toLowerCase();

  if (id.includes('embedding')) return { use: 'embedding', type: 'embedding' };
  if (om.includes('three_d') || id.includes('3d')) return { use: '3d', type: '3d' };
  if (tt.includes('imagetovideo') || tt.includes('texttovideo') || tt.includes('multimodaltovideo') || tt.includes('videoextension') || tt.includes('videoediting') || tt.includes('imagetoaudiovideo') || tt.includes('texttoaudiovideo')) return { use: 'video', type: 'video' };
  if (tt.includes('texttoimage') || tt.includes('imagetoimage') || id.includes('seedream')) return { use: 'image', type: 'image' };
  if (id.includes('vision') || (tt.includes('visualquestionanswering') && !tt.includes('textgeneration'))) return { use: 'vision', type: 'vision' };
  if (tt.includes('textgeneration') || tt.includes('visualquestionanswering')) return { use: 'story', type: 'llm' };
  return { use: 'story', type: 'llm' };
}

function friendlyName(m, use) {
  const id = m.id;
  // 手工修一些明显的名字
  const NAME_MAP = {
    'doubao-seedance-2-0-260128': 'Seedance 2.0（多模态·视频编辑·扩展）',
    'doubao-seedance-2-0-fast-260128': 'Seedance 2.0 Fast（加速版）',
    'doubao-seedance-1-5-pro-251215': 'Seedance 1.5 Pro（图+音频→视频，数字人核心）⭐',
    'doubao-seedance-1-0-pro-250528': 'Seedance 1.0 Pro（基础 i2v/t2v）',
    'doubao-seedance-1-0-pro-fast-251015': 'Seedance 1.0 Pro Fast',
    'doubao-seedream-5-0-260128': 'Seedream 5.0（最新图像，t2i+i2i）⭐',
    'doubao-seedream-4-5-251128': 'Seedream 4.5',
    'doubao-seedream-4-0-250828': 'Seedream 4.0',
    'doubao-seed-2-0-pro-260215': 'Doubao Seed 2.0 Pro（最强 LLM）⭐',
    'doubao-seed-2-0-mini-260215': 'Doubao Seed 2.0 Mini',
    'doubao-seed-2-0-lite-260215': 'Doubao Seed 2.0 Lite',
    'doubao-seed-2-0-code-preview-260215': 'Doubao Seed 2.0 代码专用',
    'doubao-seed-character-251128': 'Doubao Seed Character（角色扮演/主播人设）⭐',
    'doubao-seed-1-8-251228': 'Doubao Seed 1.8',
    'doubao-seed-1-6-251015': 'Doubao Seed 1.6',
    'doubao-seed-1-6-flash-250828': 'Doubao Seed 1.6 Flash',
    'doubao-seed-1-6-flash-250615': 'Doubao Seed 1.6 Flash (0615)',
    'doubao-seed-1-6-250615': 'Doubao Seed 1.6 (0615)',
    'doubao-seed-1-6-vision-250815': 'Doubao Seed 1.6 Vision（视觉理解）',
    'doubao-1-5-vision-pro-32k-250115': 'Doubao 1.5 Vision Pro',
    'doubao-1-5-pro-32k-250115': 'Doubao 1.5 Pro 32k',
    'doubao-1-5-lite-32k-250115': 'Doubao 1.5 Lite 32k',
    'doubao-1-5-pro-32k-character-250715': 'Doubao 1.5 Pro 角色版',
    'doubao-seed-translation-250915': 'Doubao Seed Translation（翻译专用）',
    'doubao-smart-router-250928': 'Doubao Smart Router（智能路由）',
    'doubao-seed-code-preview-251028': 'Doubao Seed 代码专用',
    'doubao-seed3d-2-0-260328': 'Doubao Seed3D 2.0（图生 3D）⭐',
    'doubao-embedding-vision-250615': 'Doubao Embedding Vision (0615)',
    'doubao-embedding-vision-251215': 'Doubao Embedding Vision (1215)',
    'glm-4-5-air-20250728': 'GLM 4.5 Air',
    'glm-4-7-251222': 'GLM 4.7',
    'qwen3-8b-20250429': 'Qwen3 8B',
    'qwen3-14b-20250429': 'Qwen3 14B',
    'qwen3-32b-20250429': 'Qwen3 32B',
    'qwen3-0-6b-20250429': 'Qwen3 0.6B',
    'qwen2-5-72b-20240919': 'Qwen2.5 72B',
    'deepseek-v3-2-251201': 'DeepSeek V3.2',
  };
  if (NAME_MAP[id]) return NAME_MAP[id];
  return id;
}

async function fetchModels(apiKey) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'ark.cn-beijing.volces.com',
      path: '/api/v3/models',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      timeout: 20000,
    }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(buf);
          resolve(j.data || []);
        } catch (e) { reject(new Error('parse: ' + e.message + ' body=' + buf.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

async function main() {
  const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  const providers = settings.providers || [];

  // 找火山方舟 provider（name 含"火山"或 api_url 含 volces）
  const p = providers.find(pr => PROVIDER_MATCH.test(pr.name || '') || /volces/.test(pr.api_url || ''));
  if (!p) {
    console.error('❌ 未找到火山方舟 provider，在 settings 里找不到 name 含"火山"或 api_url 含 volces 的条目');
    process.exit(1);
  }
  if (!p.api_key) {
    console.error('❌ 火山方舟 provider 未配置 api_key');
    process.exit(1);
  }

  console.log(`✓ 找到 provider: ${p.name} (id=${p.id})`);
  console.log(`  api_url: ${p.api_url}`);
  console.log(`  现有 models: ${(p.models || []).length} 个`);

  console.log('\n→ 拉取 /api/v3/models ...');
  const all = await fetchModels(p.api_key);
  const live = all.filter(m => m.status !== 'Shutdown' && m.status !== 'Retiring');
  console.log(`  返回 ${all.length} 个，在线 ${live.length} 个`);

  const existingIds = new Set((p.models || []).map(m => m.id));

  const additions = [];
  const byUse = { video: 0, image: 0, story: 0, vision: 0, '3d': 0, embedding: 0 };

  // 排序：video > image > story(pro/mini/character) > vision > 3d > embedding，每组内按 id 倒序（新→旧）
  const sorted = [...live].sort((a, b) => {
    const ca = categorizeModel(a).use;
    const cb = categorizeModel(b).use;
    const order = { video: 1, image: 2, story: 3, vision: 4, '3d': 5, embedding: 6 };
    if (order[ca] !== order[cb]) return (order[ca] || 9) - (order[cb] || 9);
    return (b.id || '').localeCompare(a.id || '');
  });

  for (const m of sorted) {
    if (existingIds.has(m.id)) continue;
    const cat = categorizeModel(m);
    additions.push({
      id: m.id,
      name: friendlyName(m, cat.use),
      type: cat.type,
      use: cat.use,
      enabled: true,
    });
    byUse[cat.use] = (byUse[cat.use] || 0) + 1;
  }

  p.models = [...(p.models || []), ...additions];
  p.last_synced = new Date().toISOString();

  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');

  console.log(`\n✅ 同步完成`);
  console.log(`  新增: ${additions.length}`);
  console.log(`  分类: ${Object.entries(byUse).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
  console.log(`  现 provider models 总数: ${p.models.length}`);
  console.log('\n新增列表:');
  for (const m of additions) console.log(`  [${m.use.padEnd(9)}] ${m.id}  ← ${m.name}`);
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
