/**
 * 本地验收脚本：创建一个完整的剧情广告故事板任务。
 *
 * 说明：
 * - 只用于验证任务中心、数据分区、镜头合同、逐镜状态和分段故事板展示。
 * - 不调用付费图像模型，不合成视频，不向任何外部服务发送素材。
 * - 默认样例内容仅是测试输入；真实生产链路仍然完全来自用户 brief、素材和人工编辑。
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const sharp = require('sharp');
const authStore = require('../src/models/authStore');
const { signToken } = require('../src/middleware/auth');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'outputs', 'jimeng-assets');
const BASE_URL = process.env.VIDO_BASE_URL || 'http://localhost:3007';

function argValue(name, fallback = '') {
  const prefix = `--${name}=`;
  const found = process.argv.find(item => item.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function esc(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function hash(value, len = 12) {
  return crypto.createHash('sha1').update(JSON.stringify(value || null)).digest('hex').slice(0, len);
}

function localAuthHeaders() {
  // 中文注释：验收脚本只在本地使用已有 active 用户签 JWT，不读取、不输出任何密码。
  if (authStore.init) authStore.init();
  const users = authStore.getUsers ? authStore.getUsers() : [];
  const user = users.find(item => item && item.status === 'active' && item.role === 'admin')
    || users.find(item => item && item.status === 'active');
  if (!user) throw new Error('本地没有可用的 active 用户，无法创建任务中心验收任务');
  return { Authorization: `Bearer ${signToken(user.id, user.role)}` };
}

function wrapText(value = '', max = 20, maxLines = 3) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  const chars = Array.from(text);
  const lines = [];
  for (let i = 0; i < chars.length && lines.length < maxLines; i += max) {
    lines.push(chars.slice(i, i + max).join(''));
  }
  return lines;
}

function textLinesSvg(value, x, y, opts = {}) {
  const lines = wrapText(value, opts.max || 24, opts.maxLines || 3);
  const size = opts.size || 28;
  const lineHeight = opts.lineHeight || Math.round(size * 1.35);
  const fill = opts.fill || '#111827';
  const weight = opts.weight || 700;
  return lines.map((line, index) => (
    `<text x="${x}" y="${y + index * lineHeight}" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(line)}</text>`
  )).join('\n');
}

async function writePngFromSvg(filePath, svg) {
  await sharp(Buffer.from(svg)).png().toFile(filePath);
}

function buildDynamicScenes(totalDuration) {
  // 中文注释：镜头数量由时长推导，测试样例也不固定为 6 镜；这里按约 5 秒一镜生成 4-10 镜。
  const shotCount = Math.max(4, Math.min(10, Math.round(totalDuration / 5)));
  const base = Math.floor(totalDuration / shotCount);
  let rest = totalDuration - base * shotCount;
  const purposes = ['开场问题', '主体亮相', '核心能力', '使用过程', '结果证明', '行动号召', '细节补充', '对比强化', '信任背书', '收束画面'];
  const visuals = [
    '客户当前的业务流程显得分散，画面聚焦真实工作台和待处理事项。',
    '产品或服务主体清晰出现，与当前业务场景保持同一空间关系。',
    '镜头展示核心能力如何解决当前任务，不引入未确认人物或无关道具。',
    '画面跟随一次真实使用动作，突出操作路径和反馈结果。',
    '结果以可见证据呈现，保持真实商业场景，不制造夸张科幻效果。',
    '最后留出干净画面空间，用于后期行动号召和品牌信息。',
    '补充一个近景细节，帮助观众理解产品或服务的质感。',
    '通过前后状态变化体现价值，仍保持同一任务语境。',
    '用客户、团队或流程证据增强信任，但不强行增加人物。',
    '用稳定镜头收束，确保画面可直接进入成片阶段。',
  ];
  let cursor = 0;
  return Array.from({ length: shotCount }, (_, index) => {
    const duration = base + (rest > 0 ? 1 : 0);
    if (rest > 0) rest -= 1;
    const scene = {
      index,
      shot_index: index,
      title: `镜头 ${index + 1} · ${purposes[index] || '业务推进'}`,
      role: purposes[index] || '业务推进',
      duration,
      seconds: duration,
      time_start: cursor,
      time_end: cursor + duration,
      visual: visuals[index] || visuals[visuals.length - 1],
      action: index === 0
        ? '镜头缓慢推进，先交代真实环境和当前问题。'
        : index === shotCount - 1
          ? '镜头稳定停留，形成可剪辑的收束画面。'
          : '镜头按当前业务动作推进，保持主体和环境一致。',
      camera: index % 3 === 0 ? 'wide establishing shot, slow push-in' : (index % 3 === 1 ? 'medium shot, eye-level' : 'close-up insert, shallow depth of field'),
      voiceover: index === 0
        ? '先看清当前业务里的关键问题。'
        : index === shotCount - 1
          ? '现在就把流程推进到可执行的下一步。'
          : '每一步都围绕客户确认的目标展开。',
      sfx_audio: '轻微环境声，音乐保持克制，不抢主体。',
      person_required: false,
      requires_person: false,
      subjectType: 'content_driven',
    };
    cursor += duration;
    return scene;
  });
}

async function createKeyframeImages(taskId, scenes) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const palette = [
    ['#e0f2fe', '#0f172a', '#0284c7'],
    ['#ecfdf5', '#064e3b', '#10b981'],
    ['#fef3c7', '#78350f', '#f59e0b'],
    ['#f5f3ff', '#312e81', '#7c3aed'],
    ['#f1f5f9', '#1f2937', '#64748b'],
  ];
  const keyframes = [];
  for (const scene of scenes) {
    const colors = palette[scene.index % palette.length];
    const filename = `commercial_storyboard_sample_${taskId}_kf_${String(scene.index + 1).padStart(2, '0')}.png`;
    const filePath = path.join(OUT_DIR, filename);
    // 中文注释：这里生成的是本地验收故事板图，验证每镜可见；正式关键帧仍由真实模型生成。
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${colors[0]}"/>
      <stop offset="1" stop-color="#ffffff"/>
    </linearGradient>
  </defs>
  <rect width="1080" height="1920" fill="url(#bg)"/>
  <rect x="82" y="110" width="916" height="130" rx="28" fill="#ffffff" opacity="0.86"/>
  <text x="120" y="190" font-size="44" font-weight="900" fill="${colors[1]}">${esc(scene.title)}</text>
  <rect x="82" y="320" width="916" height="980" rx="36" fill="#ffffff" opacity="0.72"/>
  <circle cx="540" cy="720" r="220" fill="${colors[2]}" opacity="0.18"/>
  <rect x="240" y="610" width="600" height="270" rx="30" fill="${colors[1]}" opacity="0.92"/>
  <rect x="285" y="655" width="510" height="42" rx="21" fill="#ffffff" opacity="0.68"/>
  <rect x="285" y="735" width="430" height="42" rx="21" fill="#ffffff" opacity="0.52"/>
  <rect x="285" y="815" width="360" height="42" rx="21" fill="#ffffff" opacity="0.38"/>
  <text x="120" y="1415" font-size="34" font-weight="900" fill="${colors[1]}">画面合同</text>
  ${textLinesSvg(scene.visual, 120, 1480, { max: 22, maxLines: 4, size: 34, fill: '#334155', weight: 700 })}
  <text x="120" y="1715" font-size="30" font-weight="900" fill="${colors[2]}">动作：${esc(scene.action.slice(0, 28))}</text>
</svg>`;
    await writePngFromSvg(filePath, svg);
    keyframes.push({
      index: scene.index,
      shot_index: scene.index,
      image_url: `/public/jimeng-assets/${filename}`,
      _localPath: filePath,
      reference_mode: 'local_storyboard_validation_keyframe',
      qa: {
        pass: true,
        strict_pass: true,
        score: 88,
        subject_match: true,
        storyboard_match: true,
        reason: '本地验收图：镜头合同、主体策略和分段故事板展示链路通过。',
        quality_dimensions: {
          realism: 82,
          asset_fidelity: 82,
          scene_continuity: 86,
          product_fidelity: 82,
        },
      },
    });
  }
  return keyframes;
}

async function createStoryboardSheets(taskId, title, scenes, keyframes, ratio) {
  const sheets = [];
  const perSheet = 4;
  for (let start = 0; start < scenes.length; start += perSheet) {
    const slice = scenes.slice(start, start + perSheet);
    const sheetIndex = Math.floor(start / perSheet) + 1;
    const filename = `commercial_storyboard_sample_${taskId}_sheet_${String(sheetIndex).padStart(2, '0')}.png`;
    const filePath = path.join(OUT_DIR, filename);
    const cards = slice.map((scene, localIndex) => {
      const absolute = start + localIndex;
      const row = localIndex;
      const y = 245 + row * 400;
      const frame = keyframes[absolute] || {};
      let href = '';
      // 中文注释：故事板验收图直接嵌入刚生成的本地关键帧，避免再通过 HTTP 回拉图片导致页面或服务缓存干扰。
      if (frame._localPath && fs.existsSync(frame._localPath)) {
        const ext = path.extname(frame._localPath).toLowerCase() === '.jpg' ? 'jpeg' : 'png';
        href = `data:image/${ext};base64,${fs.readFileSync(frame._localPath).toString('base64')}`;
      }
      return `<g transform="translate(70,${y})">
        <rect x="0" y="0" width="1460" height="330" rx="18" fill="#ffffff" stroke="#cbd5e1" stroke-width="2"/>
        <rect x="0" y="0" width="108" height="330" rx="18" fill="#0f172a"/>
        <text x="54" y="96" text-anchor="middle" font-size="52" font-weight="900" fill="#ffffff">${String(scene.index + 1).padStart(2, '0')}</text>
        <text x="54" y="160" text-anchor="middle" font-size="26" font-weight="900" fill="#cbd5e1">${scene.time_start}-${scene.time_end}s</text>
        ${href ? `<image href="${esc(href)}" x="138" y="28" width="330" height="274" preserveAspectRatio="xMidYMid slice"/>` : ''}
        <text x="500" y="64" font-size="30" font-weight="900" fill="#0f172a">${esc(scene.title)}</text>
        ${textLinesSvg(scene.visual, 500, 118, { max: 32, maxLines: 3, size: 24, fill: '#334155', weight: 700 })}
        <text x="500" y="255" font-size="22" font-weight="900" fill="#475569">CAMERA / ${esc(scene.camera.slice(0, 62))}</text>
        <text x="500" y="294" font-size="22" font-weight="900" fill="#64748b">AUDIO / ${esc(scene.sfx_audio.slice(0, 62))}</text>
      </g>`;
    }).join('\n');
    // 中文注释：分段故事板是正式中间产物，按镜头顺序组织，不把多行业内容写死在模板里。
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="2140" viewBox="0 0 1600 2140">
  <rect width="1600" height="2140" fill="#f8fafc"/>
  <rect x="70" y="55" width="1460" height="130" rx="18" fill="#0f172a"/>
  <text x="110" y="115" font-size="38" font-weight="900" fill="#ffffff">${esc(title)}</text>
  <text x="110" y="158" font-size="24" font-weight="900" fill="#93c5fd">SEGMENT ${sheetIndex} OF ${Math.ceil(scenes.length / perSheet)} · ${ratio}</text>
  <text x="1490" y="130" text-anchor="end" font-size="24" font-weight="900" fill="#ffffff">SHOTS ${start + 1}-${start + slice.length}</text>
  ${cards}
</svg>`;
    await writePngFromSvg(filePath, svg);
    sheets.push({
      index: sheetIndex,
      kind: 'storyboard_sheet',
      planning_only: false,
      layout: 'commercial_storyboard_sheet',
      shot_start: start + 1,
      shot_end: start + slice.length,
      image_url: `/public/jimeng-assets/${filename}`,
    });
  }
  return sheets;
}

async function main() {
  const title = argValue('title', '本地验收 · 通用商业故事板');
  const duration = Math.max(8, Math.min(90, Number(argValue('duration', '30')) || 30));
  const ratio = argValue('ratio', '9:16');
  const brief = argValue('brief', '为一个客户确认的业务目标生成通用商业短片故事板，要求每个镜头都跟随当前 brief、素材角色和镜头合同，不继承旧任务内容。');
  const taskId = `sample_${Date.now()}_${hash({ title, duration, ratio }, 6)}`;
  const scenes = buildDynamicScenes(duration);
  const keyframes = await createKeyframeImages(taskId, scenes);
  const storyboardSheets = await createStoryboardSheets(taskId, title, scenes, keyframes, ratio);
  const versionId = `sample_v_${hash({ brief, scenes, ratio }, 16)}`;
  const assetBindings = [
    {
      asset_binding_id: `asset_01_${hash({ brief }, 8)}`,
      source: 'sample_brief',
      role: 'mixed_reference',
      name: '本地验收 brief',
      url: '',
      usage_rule: '仅用于当前样例任务验收，不允许被真实客户任务复用。',
    },
  ];
  const shotContracts = scenes.map(scene => ({
    shot_contract_id: `shot_${String(scene.index + 1).padStart(2, '0')}_${hash({ taskId, index: scene.index }, 8)}`,
    project_id: taskId,
    version_id: versionId,
    shot_index: scene.index,
    shot_no: scene.index + 1,
    time_start: scene.time_start,
    time_end: scene.time_end,
    duration: scene.duration,
    title: scene.title,
    story_role: scene.role,
    subject_strategy: 'content_driven',
    visual: scene.visual,
    action: scene.action,
    voiceover: scene.voiceover,
    camera: scene.camera,
    asset_binding_ids: assetBindings.map(x => x.asset_binding_id),
    source_rule: '只允许使用当前样例任务自己的 brief、素材角色和镜头合同。',
  }));
  const shotStatuses = scenes.map(scene => ({
    shot_index: scene.index,
    shot_no: scene.index + 1,
    status: 'keyframe_passed',
    title: scene.title,
    message: '本地验收故事板图已生成，任务中心应可见。',
    has_keyframe: true,
    has_storyboard_sheet: true,
  }));

  const publicKeyframes = keyframes.map(({ _localPath, ...frame }) => frame);

  const payload = {
    title,
    text: brief,
    duration_sec: duration,
    aspect_ratio: ratio,
    ad_mode: 'luxury_ad',
    request_stage: 'keyframe',
    request_key: `sample_storyboard_${taskId}`,
    storyboard_final_keyframes: true,
    project_state: 'frame_ready',
    version_id: versionId,
    scenes,
    keyframes: publicKeyframes,
    storyboard_sheets: storyboardSheets,
    asset_bindings: assetBindings,
    shot_contracts: shotContracts,
    shot_statuses: shotStatuses,
    production_contract: {
      schema: 'commercial_storyboard_v2',
      title,
      duration_sec: duration,
      ratio,
      human_required: false,
      source_rule: '当前合同只来自本次 brief 和样例镜头，不包含固定行业、固定场景、固定职业或固定道具模板。',
    },
  };

  const res = await axios.post(`${BASE_URL}/api/dh/luxury-ad/projects/save`, payload, {
    timeout: 15000,
    headers: localAuthHeaders(),
  });
  const project = res.data.project || res.data.production_project || {};
  console.log(JSON.stringify({
    success: true,
    project_id: project.id,
    version_id: project.version_id,
    shot_count: scenes.length,
    storyboard_sheet_count: storyboardSheets.length,
    task_center_url: `${BASE_URL}/digital-human?tab=tasks&task_type=luxury_ad`,
    project_url: `${BASE_URL}/digital-human?tab=luxury-ad&lux_step=4&luxury_project=${project.id}`,
  }, null, 2));
}

main().catch(err => {
  console.error(JSON.stringify({
    success: false,
    error: err.response?.data || err.message || String(err),
  }, null, 2));
  process.exit(1);
});
