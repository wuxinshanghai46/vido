/**
 * 漫画生成服务
 * 流程：LLM 生成分镜脚本 → 图片生成每个面板 → 组合成漫画页面
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './outputs');
const COMIC_DIR = path.join(OUTPUT_DIR, 'comics');

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }

// ——— 健壮的 JSON 解析（修复 LLM 常见格式问题）———
function repairAndParseJSON(raw) {
  let str = raw.trim();
  // 去掉 markdown 代码块
  const m = str.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) {
    str = m[1].trim();
  } else if (str.startsWith('```')) {
    str = str.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
  }
  // 提取第一个 { ... } 块
  const start = str.indexOf('{');
  const end = str.lastIndexOf('}');
  if (start !== -1 && end > start) str = str.slice(start, end + 1);

  // 第一次尝试直接解析
  try { return JSON.parse(str); } catch (_) {}

  // 修复1：移除尾随逗号 (,] 或 ,})
  let fixed = str.replace(/,\s*([}\]])/g, '$1');
  try { return JSON.parse(fixed); } catch (_) {}

  // 修复2：JSON 被截断 — 闭合未关闭的括号
  let repaired = fixed;
  const opens = { '{': '}', '[': ']' };
  const stack = [];
  let inStr = false, escape = false;
  for (const ch of repaired) {
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{' || ch === '[') stack.push(opens[ch]);
    else if (ch === '}' || ch === ']') stack.pop();
  }
  // 去掉末尾不完整的键值对（截断在字符串中间）
  if (stack.length > 0) {
    // 移除末尾残缺内容：最后一个完整的 } 或 ] 或 "..." 之后的垃圾
    repaired = repaired.replace(/,\s*"[^"]*"?\s*:?\s*"?[^"]*$/, '');
    repaired = repaired.replace(/,\s*\{[^}]*$/, '');
    repaired = repaired.replace(/,\s*$/, '');
    // 重新计算需要闭合的括号
    const stack2 = [];
    let inStr2 = false, esc2 = false;
    for (const ch of repaired) {
      if (esc2) { esc2 = false; continue; }
      if (ch === '\\') { esc2 = true; continue; }
      if (ch === '"') { inStr2 = !inStr2; continue; }
      if (inStr2) continue;
      if (ch === '{' || ch === '[') stack2.push(opens[ch]);
      else if (ch === '}' || ch === ']') stack2.pop();
    }
    repaired += stack2.reverse().join('');
  }
  try { return JSON.parse(repaired); } catch (e) {
    throw new Error(e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// Agent 1：剧情编剧 — 负责故事结构、角色塑造、对话、旁白、节奏
// ═══════════════════════════════════════════════════════════════
async function agentScreenwriter({ theme, style, pages = 4, panelsPerPage = 4, language = '中文', characters = [] }) {
  const { callLLM } = require('./storyService');
  const totalPanels = pages * panelsPerPage;

  const charDesc = characters.length
    ? `\n角色列表：\n${characters.map(c => `- ${c.name}：${c.appearance_prompt || c.description || '无描述'}`).join('\n')}`
    : '';

  const hasColon = typeof theme === 'string' && theme.includes('：');
  const titlePart = hasColon ? theme.split('：')[0] : theme;
  const contentPart = hasColon ? theme.split('：').slice(1).join('：') : '';

  const systemPrompt = `你是一位资深漫画剧情编剧，拥有20年漫画脚本创作经验。你的核心能力：

【剧本结构法则】
- 黄金第一格：第一页第一格必须用视觉冲击或悬念抓住读者
- 情绪曲线：按"钩子→铺垫→升温→爆发→余韵"编排全篇
- 每页结尾留"翻页钩子"（悬念、反转、情感高潮的未完成感）

【对话与旁白法则】
- 对话≤15字，必须推动剧情或揭示性格，禁止说明性台词
- 每个角色有独特说话方式（语气词、口头禅、句式特征）
- 旁白只在时间跳转、内心独白、氛围渲染时使用
- 音效(sfx)要生动具象（如「咔嚓！」「哗——」「砰！」）

【场景描写规范】
- 必须包含：谁(WHO) + 在哪里(WHERE) + 做什么(WHAT) + 环境氛围(MOOD)
- 明确标注光线条件和天气/季节元素
- 标注角色的微表情和肢体语言细节

【节奏控制】
- pacing=slow：情感戏、回忆、独白（配合特写/慢推）
- pacing=normal：日常对话、过渡场景
- pacing=fast：冲突、追逐、紧张时刻

你只负责「文字层面」的创作，画面构图和镜头是导演的工作。
严格按 JSON 格式输出，不要任何额外文字。`;

  const userPrompt = `请为以下漫画创作完整的剧情脚本：
标题：${titlePart}${contentPart ? `\n故事梗概：${contentPart}` : ''}
画风参考：${style || '日系动漫'}
总页数：${pages}，每页 ${panelsPerPage} 格（共 ${totalPanels} 格）
语言：${language}${charDesc}

创作要求：
1. 第1页建立世界观和人物，制造悬念或冲突
2. 中间页推进剧情，逐步升级矛盾，展现角色成长
3. 倒数第2页推至高潮，情感爆发
4. 最后一页收束故事，留下余韵或反转
5. 对话要体现角色性格，避免说明性台词
6. 旁白用于时间跳转、内心独白、氛围渲染
7. 音效(sfx)要生动（如「咔嚓！」「哗——」「砰！」）

直接输出 JSON：
{
  "title": "漫画标题",
  "synopsis": "一句话简介（30字以内）",
  "characters_summary": [
    { "name": "角色名", "personality": "性格特征", "appearance": "外貌特征关键词" }
  ],
  "pages": [
    {
      "page_number": 1,
      "page_purpose": "本页叙事目的（如：建立世界观、引入冲突）",
      "panels": [
        {
          "index": 1,
          "description": "中文场景描述（谁在哪里做什么，情绪状态）",
          "dialogue": "对话内容（可为空字符串）",
          "speaker": "说话角色名（可为空字符串）",
          "narrator": "旁白（可为空字符串）",
          "sfx": "音效文字（可为空字符串）",
          "emotion": "本格的情感基调（如：孤独、紧张、温暖、震惊）",
          "pacing": "slow|normal|fast（叙事节奏）"
        }
      ]
    }
  ]
}`;

  const raw = await callLLM(systemPrompt, userPrompt);
  return repairAndParseJSON(raw);
}

// ═══════════════════════════════════════════════════════════════
// Agent 2：漫剧导演 — 负责分镜设计、镜头语言、画面构图、视觉指令
// ═══════════════════════════════════════════════════════════════
async function agentDirector(screenplay, style, characters = []) {
  const { callLLM } = require('./storyService');

  const charVisuals = characters.length
    ? `\n角色视觉参考（visual_prompt 中必须包含对应角色的完整外貌描述以保持一致性）：\n${characters.map(c => `- ${c.name}：${c.description || '无描述'}`).join('\n')}`
    : (screenplay.characters_summary || []).length
      ? `\n角色视觉参考：\n${screenplay.characters_summary.map(c => `- ${c.name}：${c.appearance || c.personality || '无描述'}`).join('\n')}`
      : '';

  const systemPrompt = `你是一位顶级漫剧导演，精通电影化分镜语言和漫画视觉叙事。你的核心能力：

【景别选择 — 情绪驱动】
- 建立世界观 → 远景/鸟瞰    - 角色登场 → 全景/中景
- 对话场景 → 中景+正反打     - 情感爆发 → 特写/大特写
- 紧张冲突 → 仰角/荷兰角    - 转折揭示 → 俯角/鸟瞰

【构图法则】
- 三分法：主体放在三分线交叉点    - 对角线：动态场景引导视线
- 框中框：用环境元素框住主体      - 前景遮挡：增加纵深感
- 对称构图：仪式感/对峙场景      - 留白：孤独/思考/空间感

【光影设计】
- 晨光/暖光→希望  - 侧光→戏剧性  - 逆光→神秘/浪漫
- 冷光/蓝调→孤独  - 顶光→压迫    - 烛光→亲密/温馨

【漫画视觉技法】
- 速度线/集中线：动作和情绪冲击    - 网点/渐变：氛围和质感
- 出血格：高潮场景突破格子边界    - 分格节奏：大格=重要/慢，小格=快/紧凑

【visual_prompt 公式】
主体描述 + 姿态表情 + 景别构图 + 光影色调 + 环境细节 + 画风关键词

你不修改编剧的对话和旁白，只负责「视觉层面」的导演工作。
严格按 JSON 格式输出，保留编剧的所有文字内容。`;

  const screenplayJSON = JSON.stringify(screenplay, null, 2);

  const userPrompt = `以下是编剧完成的剧情脚本，请作为导演为每个面板添加视觉导演指令：

【编剧脚本】
${screenplayJSON}

【画风】${style || '日系动漫'}${charVisuals}

导演要求：
1. 保留编剧的 description/dialogue/narrator/sfx 不做修改
2. 为每个面板新增导演字段：layout, camera, mood, dialogue_position, visual_prompt
3. visual_prompt 必须是详细英文，80词以内，包含：
   - 构图方式（居中/三分法/对角线/留白）
   - 角色完整外貌 + 姿态 + 表情
   - 光源方向和色调（暖光/冷光/逆光/侧光）
   - 背景细节和景深
   - 画风关键词
4. camera 选择要配合叙事节奏：
   - 建立镜头用远景/鸟瞰
   - 对话用中景/正反打
   - 情感爆发用特写/大特写
   - 动作场景用仰角/荷兰角
5. layout 要制造视觉变奏：不要每格都一样大

直接输出完整 JSON：
{
  "title": "保持原标题",
  "synopsis": "保持原简介",
  "style": "${style || '日系动漫'}风格的详细描述",
  "pages": [
    {
      "page_number": 1,
      "panels": [
        {
          "index": 1,
          "layout": "full|half|third|quarter",
          "description": "保持编剧原文",
          "dialogue": "保持编剧原文",
          "dialogue_position": "top|bottom|left|right",
          "narrator": "保持编剧原文",
          "sfx": "保持编剧原文",
          "mood": "画面氛围关键词",
          "camera": "镜头角度（特写/中景/远景/仰角/俯角/鸟瞰/荷兰角）",
          "visual_prompt": "detailed English visual description..."
        }
      ]
    }
  ]
}`;

  const raw = await callLLM(systemPrompt, userPrompt);
  return repairAndParseJSON(raw);
}

// ——— 完整分镜脚本生成（编剧 + 导演 双 Agent 协作）———
// characters 支持两种格式：
//   1. 前端直传 [{name, description}]
//   2. 角色库 ID [{id}] → 自动查询角色库填充 appearance_prompt
async function generateComicScript({ theme, style, pages = 4, panelsPerPage = 4, language = '中文', characters = [], styleId = null }) {
  const db = require('../models/database');

  // 如果传了 styleId，从风格库查询真实 prompt
  if (styleId) {
    const styleRow = db.getAIStyle(styleId);
    if (styleRow) style = styleRow.name;
  }

  // 解析角色：如果 character 带 id，从角色库填充完整信息
  const enrichedChars = characters.map(c => {
    if (c.id && !c.appearance_prompt) {
      const dbChar = db.getAIChar(c.id);
      if (dbChar) return { ...c, name: dbChar.name, description: dbChar.appearance || dbChar.personality, appearance_prompt: dbChar.appearance_prompt, ref_images: dbChar.ref_images };
    }
    return c;
  });

  // Phase 1：编剧 Agent 创作剧情脚本
  const screenplay = await agentScreenwriter({ theme, style, pages, panelsPerPage, language, characters: enrichedChars });

  // Phase 2：导演 Agent 添加视觉导演指令
  const directedScript = await agentDirector(screenplay, style, enrichedChars);

  return directedScript;
}

// ——— 生成单个面板图片 ———
async function generatePanelImage(panel, style, taskDir) {
  const { generateCharacterImage } = require('./imageService');
  const db = require('../models/database');

  // 优先从风格库查询，回退到硬编码
  let styleSuffix = '';
  const allStyles = db.listAIStyles();
  const matchedStyle = allStyles.find(s => s.name === style);
  if (matchedStyle) {
    styleSuffix = matchedStyle.prompt_en;
  } else {
    const fallbackStyles = {
      '日系动漫': 'Japanese manga style, clean linework, screen tones, dramatic shading, anime aesthetic',
      '美式漫画': 'American comic book style, bold ink lines, halftone dots, dynamic composition, Marvel/DC aesthetic',
      '韩国漫画': 'Korean manhwa webtoon style, clean digital art, soft gradients, modern character design',
      '欧式漫画': 'European graphic novel style, detailed cross-hatching, muted color palette, Moebius inspired',
      '水墨漫画': 'Chinese ink wash manga style, brush stroke art, traditional Chinese painting meets manga',
      '赛博朋克': 'cyberpunk manga style, neon lights, dark atmosphere, futuristic tech, high contrast',
      '少年漫画': 'shonen manga style, dynamic action lines, speed lines, intense expressions, dramatic poses',
      '少女漫画': 'shoujo manga style, sparkle effects, flower backgrounds, soft dreamy atmosphere, beautiful characters',
    };
    styleSuffix = fallbackStyles[style] || fallbackStyles['日系动漫'];
  }

  const prompt = `${panel.visual_prompt}, ${styleSuffix}, single comic panel, no text, no speech bubbles, high quality illustration`;
  const filename = `panel_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  try {
    const result = await generateCharacterImage({
      name: filename,
      role: 'other',
      description: prompt,
      dim: '2d',
      race: '人',
      species: '',
      animStyle: ''
    });
    // 复制到漫画任务目录
    const destPath = path.join(taskDir, `${filename}.png`);
    if (result.filePath && fs.existsSync(result.filePath)) {
      fs.copyFileSync(result.filePath, destPath);
    }
    return { filename: `${filename}.png`, path: destPath };
  } catch (err) {
    console.error(`[ComicService] 面板图生成失败:`, err.message);
    // 生成占位图
    return await generatePlaceholderPanel(panel, filename, taskDir);
  }
}

// ——— 占位面板（Demo 模式）———
async function generatePlaceholderPanel(panel, filename, taskDir) {
  const ffmpegStatic = require('ffmpeg-static');
  const { exec } = require('child_process');
  const ffmpegPath = (process.env.FFMPEG_PATH && process.env.FFMPEG_PATH !== 'ffmpeg')
    ? process.env.FFMPEG_PATH : ffmpegStatic;

  const destPath = path.join(taskDir, `${filename}.png`);
  const safeText = (panel.description || '面板').replace(/['"\\:<>]/g, ' ').substring(0, 20);
  const colors = ['0x2a1a4a', '0x1a2a4a', '0x1a4a2a', '0x4a1a2a', '0x3a2a1a'];
  const color = colors[Math.floor(Math.random() * colors.length)];

  const cmd = [
    `"${ffmpegPath}"`,
    `-f lavfi -i "color=c=${color}:size=768x768:duration=1"`,
    `-vframes 1`,
    `-vf "drawtext=text='${safeText}':fontsize=36:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:alpha=0.8"`,
    `-y "${destPath}"`
  ].join(' ');

  await new Promise((resolve, reject) => {
    exec(cmd, { stdio: 'pipe' }, (err) => err ? reject(err) : resolve());
  });
  return { filename: `${filename}.png`, path: destPath };
}

// ——— 用 FFmpeg 合成漫画页面（将面板拼接成网格）———
async function composePage(panelPaths, pageNum, taskDir, layout = '2x2') {
  const ffmpegStatic = require('ffmpeg-static');
  const { exec } = require('child_process');
  const ffmpegPath = (process.env.FFMPEG_PATH && process.env.FFMPEG_PATH !== 'ffmpeg')
    ? process.env.FFMPEG_PATH : ffmpegStatic;

  const outputPath = path.join(taskDir, `page_${pageNum}.png`);
  const panelCount = panelPaths.length;

  if (panelCount === 0) return null;
  if (panelCount === 1) {
    fs.copyFileSync(panelPaths[0], outputPath);
    return outputPath;
  }

  // 确定网格布局
  let cols, rows;
  if (panelCount <= 2) { cols = 2; rows = 1; }
  else if (panelCount <= 4) { cols = 2; rows = 2; }
  else if (panelCount <= 6) { cols = 2; rows = 3; }
  else { cols = 3; rows = Math.ceil(panelCount / 3); }

  const cellW = 512, cellH = 512;
  const gap = 8;
  const pageW = cols * cellW + (cols + 1) * gap;
  const pageH = rows * cellH + (rows + 1) * gap;

  // 构建 FFmpeg filter_complex
  const inputs = panelPaths.map((p, i) => `-i "${p}"`).join(' ');
  const scales = panelPaths.map((_, i) => `[${i}:v]scale=${cellW}:${cellH}:force_original_aspect_ratio=decrease,pad=${cellW}:${cellH}:(ow-iw)/2:(oh-ih)/2:color=0x111118[p${i}]`).join(';');

  // 使用 overlay 逐个放置
  let filterParts = [scales];
  // 创建白色背景
  filterParts.push(`color=c=0x0e0e14:s=${pageW}x${pageH}[bg]`);

  let prevLabel = 'bg';
  for (let i = 0; i < panelCount && i < cols * rows; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = gap + col * (cellW + gap);
    const y = gap + row * (cellH + gap);
    const outLabel = i < panelCount - 1 ? `t${i}` : 'out';
    filterParts.push(`[${prevLabel}][p${i}]overlay=${x}:${y}[${outLabel}]`);
    prevLabel = outLabel;
  }

  const filter = filterParts.join(';');
  const cmd = `"${ffmpegPath}" ${inputs} -filter_complex "${filter}" -map "[out]" -frames:v 1 -y "${outputPath}"`;

  await new Promise((resolve, reject) => {
    exec(cmd, { stdio: 'pipe', maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) { console.error('[ComicService] 页面合成失败:', stderr); reject(err); }
      else resolve();
    });
  });

  return outputPath;
}

// ——— 全流程：生成漫画任务 ———
async function generateComic(taskId, params, progressCallback) {
  let { theme, style = '日系动漫', pages = 4, panelsPerPage = 4, characters = [] } = params;
  const { styleId, character_ids } = params;
  const db = require('../models/database');
  const taskDir = path.join(COMIC_DIR, taskId);
  ensureDir(taskDir);

  const progress = (step, pct, msg) => {
    if (progressCallback) progressCallback({ step, progress: pct, message: msg });
  };

  // ── Enrichment：从角色库和风格库填充完整信息 ──
  if (styleId) {
    const styleRow = db.getAIStyle(styleId);
    if (styleRow) style = styleRow.name;
  }
  // 合并角色库中选中的角色
  const enrichedChars = [...characters];
  if (character_ids?.length) {
    for (const cid of character_ids) {
      const dbChar = db.getAIChar(cid);
      if (dbChar && !enrichedChars.find(c => c.id === cid)) {
        enrichedChars.push({
          id: cid, name: dbChar.name,
          description: dbChar.appearance_prompt || dbChar.appearance || dbChar.personality,
          appearance_prompt: dbChar.appearance_prompt,
          ref_images: dbChar.ref_images
        });
      }
    }
  }
  // 为已有角色补充 appearance_prompt（如果角色带 id 但无 prompt）
  for (const c of enrichedChars) {
    if (c.id && !c.appearance_prompt) {
      const dbChar = db.getAIChar(c.id);
      if (dbChar) c.appearance_prompt = dbChar.appearance_prompt;
    }
  }

  // 1. 编剧 Agent — 创作剧情脚本
  progress('screenwriter', 3, '📝 编剧Agent：正在构思故事结构与对话...');
  let screenplay;
  try {
    screenplay = await agentScreenwriter({ theme, style, pages, panelsPerPage, characters: enrichedChars });
  } catch (err) {
    throw new Error('编剧Agent剧情创作失败: ' + err.message);
  }
  fs.writeFileSync(path.join(taskDir, 'screenplay.json'), JSON.stringify(screenplay, null, 2), 'utf8');
  progress('screenwriter', 8, `📝 编剧Agent完成：「${screenplay.title || ''}」— ${screenplay.synopsis || ''}`);

  // 2. 导演 Agent — 设计分镜与视觉指令
  progress('director', 9, '🎬 导演Agent：正在设计分镜镜头与画面构图...');
  let script;
  try {
    script = await agentDirector(screenplay, style, enrichedChars);
  } catch (err) {
    throw new Error('导演Agent分镜设计失败: ' + err.message);
  }
  fs.writeFileSync(path.join(taskDir, 'script.json'), JSON.stringify(script, null, 2), 'utf8');
  progress('director', 15, `🎬 导演Agent完成：${script.pages?.length || 0} 页分镜，视觉指令已就绪`);

  // 2. 逐页逐面板生成图片
  const allPages = script.pages || [];
  const totalPanels = allPages.reduce((sum, p) => sum + (p.panels?.length || 0), 0);
  let panelsDone = 0;

  for (let pi = 0; pi < allPages.length; pi++) {
    const page = allPages[pi];
    const panels = page.panels || [];

    for (let pj = 0; pj < panels.length; pj++) {
      const panel = panels[pj];
      const pctBase = 15 + (panelsDone / totalPanels) * 65;
      progress('image', Math.round(pctBase), `生成面板 ${panelsDone + 1}/${totalPanels}：${(panel.description || '').substring(0, 30)}...`);

      const result = await generatePanelImage(panel, style, taskDir);
      panel._image = result.filename;
      panel._imagePath = result.path;
      panelsDone++;
    }
  }

  // 3. 合成每页漫画
  progress('compose', 82, '正在合成漫画页面...');
  const composedPages = [];
  for (let pi = 0; pi < allPages.length; pi++) {
    const page = allPages[pi];
    const panelPaths = (page.panels || []).map(p => p._imagePath).filter(Boolean);
    progress('compose', 82 + (pi / allPages.length) * 13, `合成第 ${pi + 1}/${allPages.length} 页...`);

    try {
      const pagePath = await composePage(panelPaths, pi + 1, taskDir);
      composedPages.push({
        page_number: pi + 1,
        filename: path.basename(pagePath),
        path: pagePath,
        panels: (page.panels || []).map(p => ({
          index: p.index,
          description: p.description,
          dialogue: p.dialogue,
          narrator: p.narrator,
          sfx: p.sfx,
          image: p._image
        }))
      });
    } catch (err) {
      console.error(`[ComicService] 第 ${pi + 1} 页合成失败:`, err.message);
    }
  }

  // 保存最终数据
  const result = {
    title: script.title,
    synopsis: script.synopsis,
    style: script.style || style,
    pages: composedPages,
    total_panels: totalPanels
  };
  fs.writeFileSync(path.join(taskDir, 'result.json'), JSON.stringify(result, null, 2), 'utf8');

  progress('done', 100, '漫画生成完成！');
  return result;
}

module.exports = { generateComicScript, generatePanelImage, composePage, generateComic, COMIC_DIR };
