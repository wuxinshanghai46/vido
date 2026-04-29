#!/usr/bin/env node
/**
 * 重新生成指定的数字人预设图（纯单人 + 纯影棚背景）
 *
 * 用法：
 *   node scripts/regen-avatar-presets.js female-biz-2 male-biz-2 female-news-2
 *   node scripts/regen-avatar-presets.js --all           # 全部重生
 *   node scripts/regen-avatar-presets.js --suspicious    # 带复杂环境描述的都重生
 *
 * 注意：会覆盖 outputs/presets/avatar_<key>.png
 */
const fs = require('fs');
const path = require('path');

// 直接从 routes/avatar 里抠 PRESET_AVATARS — 用 require 会触发整个 express 路由加载，不划算
// 改为：直接硬编码需要重生的 key + 新版 prompt（与 routes/avatar.js 的 PRESET_AVATARS 保持一致）
// 这里只覆盖本次要处理的 3 个，其他通过 --all 走 routes 模块的单 key 循环

const PRESETS_DIR = path.join(__dirname, '..', 'outputs', 'presets');

function _enhanceAvatarPrompt(desc) {
  return `ONE SINGLE PERSON SOLO, photorealistic portrait photograph of exactly one person, ${desc}, professional studio photography, shallow depth of field, DSLR photo, 8K ultra realistic skin texture, cinematic lighting, half-body shot, only one person in frame, 真人摄影写实人像照片.
NEGATIVE: illustration, cartoon, anime, manga, 3D render, painting, drawing, multiple people, group photo, two people, three people, crowd, 动漫, 插画, 卡通, 多人, 群体`;
}

// 加载 routes/avatar.js 里的 PRESET_AVATARS（脚本方式：读文件提 const 声明）
function loadPresetAvatars() {
  const routeFile = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'avatar.js'), 'utf-8');
  const m = routeFile.match(/const PRESET_AVATARS\s*=\s*(\{[\s\S]*?\n\})\s*;/m);
  if (!m) throw new Error('没找到 PRESET_AVATARS 定义');
  return new Function(`return ${m[1]};`)();
}

function loadPresetBackgrounds() {
  const routeFile = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'avatar.js'), 'utf-8');
  const m = routeFile.match(/const PRESET_BACKGROUNDS\s*=\s*(\{[\s\S]*?\n\})\s*;/m);
  if (!m) throw new Error('没找到 PRESET_BACKGROUNDS 定义');
  // PRESET_BACKGROUNDS 里的 prompt 引用了 BG_NEGATIVE，先替换掉
  let raw = m[1].replace(/BG_NEGATIVE/g, "'，绝对不要出现任何人物、人像、角色、动物，只画纯环境背景，空旷无人'");
  return new Function(`return ${raw};`)();
}

function _enhanceBackgroundPrompt(desc) {
  return `EMPTY SCENE with ABSOLUTELY NO PEOPLE, photorealistic landscape environment photograph, ${desc}, vacant unoccupied space, architectural or natural photography, DSLR camera, cinematic lighting, 8K ultra realistic, background plate, completely devoid of any human figures or characters, 空无一人的纯背景环境摄影.
NEGATIVE: any person, human, character, figure, silhouette, face, body, illustration, cartoon, anime, drawing, people, crowd, 人物, 人像, 角色, 动漫, 插画`;
}

async function regenOne(key, preset, kind = 'avatar') {
  const { generateDramaImage } = require('../src/services/imageService');
  const fullPrompt = kind === 'avatar' ? _enhanceAvatarPrompt(preset.prompt) : _enhanceBackgroundPrompt(preset.prompt);
  const negativePrompt = kind === 'avatar'
    ? 'multiple people, group photo, two people, three people, crowd, anime, cartoon, illustration, manga, 3D render, 多人, 动漫, 插画, 卡通, 背景人物'
    : 'person, people, human, character, figure, silhouette, face, body, anime, cartoon, illustration, drawing, 人物, 人像, 角色, 动漫, 插画';
  const prefix = kind === 'avatar' ? 'avatar' : 'bg';
  const aspectRatio = kind === 'avatar' ? '1:1' : '16:9';
  const destPath = path.join(PRESETS_DIR, `${prefix}_${key}.png`);

  const tryOrder = ['mxapi', 'jimeng', 'nanobanana'];
  let lastErr = null;
  for (const model of tryOrder) {
    try {
      console.log(`  [${kind}/${key}] 尝试 ${model}...`);
      const result = await generateDramaImage({
        prompt: fullPrompt,
        filename: `${prefix}_${key}_regen_${Date.now()}`,
        aspectRatio,
        resolution: '2K',
        referenceImages: [],
        image_model: model,
      });
      if (result?.filePath && fs.existsSync(result.filePath)) {
        fs.copyFileSync(result.filePath, destPath);
        const sz = (fs.statSync(destPath).size / 1024).toFixed(0);
        console.log(`  ✅ [${kind}/${key}] 完成 (${model}, ${sz}KB) → ${destPath}`);
        return { key, kind, ok: true, model, size: sz };
      }
    } catch (e) {
      lastErr = e.message;
      console.log(`  ⚠️  [${kind}/${key}] ${model} 失败: ${e.message.slice(0, 80)}`);
    }
  }
  console.log(`  ❌ [${kind}/${key}] 全部 provider 失败`);
  return { key, kind, ok: false, error: lastErr };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log(`用法:
  node scripts/regen-avatar-presets.js <key1> [<key2> ...]
  node scripts/regen-avatar-presets.js --all           # 所有 avatar
  node scripts/regen-avatar-presets.js --new           # 非原始 avatar
  node scripts/regen-avatar-presets.js --bg            # 所有 background
  node scripts/regen-avatar-presets.js --bg-new        # 非原始 bg（空，因 bg 都是原始 4 个）
  node scripts/regen-avatar-presets.js --all-bg        # avatar + bg
示例:
  node scripts/regen-avatar-presets.js --bg`);
    process.exit(0);
  }

  const avatars = loadPresetAvatars();
  const bgs = loadPresetBackgrounds();

  const tasks = []; // [{kind:'avatar'|'bg', key, preset}]

  if (args.includes('--all')) {
    Object.keys(avatars).forEach(k => tasks.push({ kind: 'avatar', key: k, preset: avatars[k] }));
  } else if (args.includes('--new')) {
    const ORIGINALS = new Set(['female-1', 'male-1', 'female-2', 'male-2']);
    Object.keys(avatars).filter(k => !ORIGINALS.has(k)).forEach(k => tasks.push({ kind: 'avatar', key: k, preset: avatars[k] }));
  }

  if (args.includes('--bg') || args.includes('--all-bg')) {
    Object.keys(bgs).forEach(k => tasks.push({ kind: 'bg', key: k, preset: bgs[k] }));
  }

  if (tasks.length === 0 && !args.some(a => a.startsWith('--'))) {
    // 位置参数：当作 avatar key
    for (const k of args) {
      if (avatars[k]) tasks.push({ kind: 'avatar', key: k, preset: avatars[k] });
      else console.warn('未知 avatar key（跳过）:', k);
    }
  }

  if (tasks.length === 0) { console.log('没有要处理的项'); process.exit(0); }

  console.log(`\n将重生成 ${tasks.length} 项:`);
  tasks.forEach(t => console.log(`  [${t.kind}] ${t.key} - ${t.preset.name}`));
  console.log('');

  const results = [];
  for (const t of tasks) {
    console.log(`\n▶ [${t.kind}/${t.key}] ${t.preset.name}`);
    const r = await regenOne(t.key, t.preset, t.kind);
    results.push(r);
    if (results.length < tasks.length) await new Promise(r => setTimeout(r, 2000));
  }

  console.log('\n═══ 结果 ═══');
  const ok = results.filter(r => r.ok);
  const fail = results.filter(r => !r.ok);
  console.log(`成功: ${ok.length} / ${results.length}`);
  ok.forEach(r => console.log(`  ✓ ${r.kind}/${r.key} (${r.model}, ${r.size}KB)`));
  if (fail.length) {
    console.log(`失败: ${fail.length}`);
    fail.forEach(r => console.log(`  ✗ ${r.kind}/${r.key}: ${r.error?.slice(0, 120)}`));
  }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
