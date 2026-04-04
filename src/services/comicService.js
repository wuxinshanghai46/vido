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

// ——— LLM 生成漫画分镜脚本 ———
async function generateComicScript({ theme, style, pages = 4, panelsPerPage = 4, language = '中文', characters = [] }) {
  const { callLLM } = require('./storyService');
  const totalPanels = pages * panelsPerPage;

  const charDesc = characters.length
    ? `\n角色列表（visual_prompt 必须包含角色完整外貌描述以保持一致性）：\n${characters.map(c => `- ${c.name}：${c.description || '无描述'}`).join('\n')}`
    : '';

  const systemPrompt = `你是专业漫画分镜师，擅长创作引人入胜的漫画分镜脚本。严格按 JSON 格式输出，不要任何额外内容。所有字段值尽量精简，visual_prompt 控制在 80 词以内，dialogue 不超过 15 字。`;

  // 支持 title:content 格式或纯主题
  const hasColon = typeof theme === 'string' && theme.includes('：');
  const titlePart = hasColon ? theme.split('：')[0] : theme;
  const contentPart = hasColon ? theme.split('：').slice(1).join('：') : '';

  const userPrompt = `创作漫画分镜脚本：
标题：${titlePart}${contentPart ? `\n故事内容：${contentPart}` : ''}
画风：${style || '日系动漫'}
总页数：${pages}，每页 ${panelsPerPage} 格（共 ${totalPanels} 格）
语言：${language}${charDesc}

要求：
1. 每个面板(panel)必须有清晰的画面构图和镜头角度
2. 对话气泡内容要简洁有力（每句不超过20字）
3. visual_prompt 必须是详细的英文描述，包含：构图、角色姿态、表情、光影、背景
4. 每页的面板要有节奏变化（特写/中景/远景交替）
5. 漫画要有完整的起承转合

直接输出 JSON：
{
  "title": "漫画标题",
  "synopsis": "一句话简介",
  "style": "画风描述",
  "pages": [
    {
      "page_number": 1,
      "panels": [
        {
          "index": 1,
          "layout": "full|half|third|quarter",
          "description": "中文画面描述",
          "dialogue": "对话内容（可为空字符串）",
          "dialogue_position": "top|bottom|left|right",
          "narrator": "旁白（可为空字符串）",
          "sfx": "音效文字（可为空字符串，如「轰！」「哗——」）",
          "mood": "氛围",
          "camera": "镜头角度（特写/中景/远景/仰角/俯角/鸟瞰）",
          "visual_prompt": "detailed English visual description for image generation: composition, character poses, expressions, lighting, background, manga/comic style"
        }
      ]
    }
  ]
}`;

  const raw = await callLLM(systemPrompt, userPrompt);
  return repairAndParseJSON(raw);
}

// ——— 生成单个面板图片 ———
async function generatePanelImage(panel, style, taskDir) {
  const { generateCharacterImage } = require('./imageService');

  // 根据漫画画风增强 prompt
  const stylePrompts = {
    '日系动漫': 'Japanese manga style, clean linework, screen tones, dramatic shading, anime aesthetic',
    '美式漫画': 'American comic book style, bold ink lines, halftone dots, dynamic composition, Marvel/DC aesthetic',
    '韩国漫画': 'Korean manhwa webtoon style, clean digital art, soft gradients, modern character design',
    '欧式漫画': 'European graphic novel style, detailed cross-hatching, muted color palette, Moebius inspired',
    '水墨漫画': 'Chinese ink wash manga style, brush stroke art, traditional Chinese painting meets manga',
    '赛博朋克': 'cyberpunk manga style, neon lights, dark atmosphere, futuristic tech, high contrast',
    '少年漫画': 'shonen manga style, dynamic action lines, speed lines, intense expressions, dramatic poses',
    '少女漫画': 'shoujo manga style, sparkle effects, flower backgrounds, soft dreamy atmosphere, beautiful characters',
  };
  const styleSuffix = stylePrompts[style] || stylePrompts['日系动漫'];

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
  const { theme, style = '日系动漫', pages = 4, panelsPerPage = 4, characters = [] } = params;
  const taskDir = path.join(COMIC_DIR, taskId);
  ensureDir(taskDir);

  const progress = (step, pct, msg) => {
    if (progressCallback) progressCallback({ step, progress: pct, message: msg });
  };

  // 1. 生成分镜脚本
  progress('script', 5, '正在创作漫画分镜脚本...');
  let script;
  try {
    script = await generateComicScript({ theme, style, pages, panelsPerPage, characters });
  } catch (err) {
    throw new Error('分镜脚本生成失败: ' + err.message);
  }
  // 保存脚本
  fs.writeFileSync(path.join(taskDir, 'script.json'), JSON.stringify(script, null, 2), 'utf8');
  progress('script', 15, `分镜脚本完成：${script.title}，共 ${script.pages?.length || 0} 页`);

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
