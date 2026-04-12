/**
 * 网剧模块 API 路由（项目→剧集层级）
 */
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../models/database');
const { generateDrama, CAMERA_MOTIONS, SHOT_SCALES, MOTION_PRESETS, DRAMA_DIR } = require('../services/dramaService');

const progressListeners = new Map();

// ═══════════════════════════════════════════
// 运镜库
// ═══════════════════════════════════════════
router.get('/motions', (req, res) => {
  res.json({ success: true, data: { motions: CAMERA_MOTIONS, shot_scales: SHOT_SCALES, presets: MOTION_PRESETS } });
});

// ═══════════════════════════════════════════
// 大纲生成 (小说→大纲→剧本三层)
// ═══════════════════════════════════════════
// POST /api/drama/generate-outline — 把 theme 扩为结构化大纲(章节列表)
router.post('/generate-outline', async (req, res) => {
  const { theme, episode_count = 5, style = '日系动漫', genre = '' } = req.body;
  if (!theme || !theme.trim()) return res.status(400).json({ success: false, error: '请提供主题' });
  try {
    const { callLLM } = require('../services/storyService');
    const systemPrompt = `你是顶级的连续剧编剧。用户给你一个主题, 你要先输出一份**故事大纲**(不是完整剧本), 让用户审核后再生成详细分镜。

输出严格 JSON 格式:
{
  "title": "整部剧的标题",
  "synopsis": "一句话介绍(≤30字)",
  "world_setting": "世界观/时代背景(1-2句)",
  "main_characters": [
    { "name": "角色名", "role": "main/supporting/antagonist", "appearance": "外貌特征", "personality": "性格" }
  ],
  "episodes": [
    {
      "index": 1,
      "title": "本集标题",
      "hook": "黄金三秒钩子(≤20字)",
      "summary": "本集剧情大纲(80-150字)",
      "key_scenes": ["关键场景1","关键场景2","关键场景3"],
      "ending_hook": "本集结尾留的悬念(≤30字)",
      "emotion_arc": "情绪走向(如: 平静→紧张→爆发→余韵)"
    }
  ]
}

要求:
- 共输出 ${episode_count} 集
- 每集独立完整, 但与下一集有钩子衔接
- main_characters 3-5 个, 包括主角和重要配角
- 严格 JSON, 无任何额外文字, 无 markdown 代码块`;

    const userPrompt = `主题: ${theme.trim()}
画风: ${style}
${genre ? `类型: ${genre}\n` : ''}集数: ${episode_count}
请输出大纲 JSON。`;

    const raw = await callLLM(systemPrompt, userPrompt);
    // 复用 dramaService 的 JSON 修复逻辑
    let outline;
    try {
      let str = raw.trim();
      const m = str.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (m) str = m[1].trim();
      const start = str.indexOf('{');
      const end = str.lastIndexOf('}');
      if (start !== -1 && end > start) str = str.slice(start, end + 1);
      outline = JSON.parse(str);
    } catch (e) {
      return res.status(500).json({ success: false, error: '大纲解析失败: ' + e.message, raw });
    }
    res.json({ success: true, data: outline });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════
// 项目级 CRUD
// ═══════════════════════════════════════════

// POST /api/drama/projects — 创建网剧项目
router.post('/projects', (req, res) => {
  try {
    const {
      title, synopsis, style, motion_preset, characters,
      episode_count, aspect_ratio,
      // v15: 创建时一次性确定全部生成参数
      scene_count, shot_duration, image_model, video_model,
    } = req.body;
    if (!title) return res.status(400).json({ success: false, error: '请输入网剧标题' });
    const project = {
      id: uuidv4(),
      user_id: req.user?.id,
      title,
      synopsis: synopsis || '',
      style: style || '日系动漫',
      motion_preset: motion_preset || 'cinematic',
      characters: characters || [],
      episode_count: episode_count || 10,
      aspect_ratio: aspect_ratio || '9:16',
      // v15: 默认生成参数，后续每集 episode 自动继承
      scene_count: scene_count || 6,
      shot_duration: shot_duration || 8,
      image_model: image_model || 'auto',
      video_model: video_model || 'auto',
      cover_url: '',
      status: 'active',
    };
    db.insertDramaProject(project);

    // v15 fix #5: 创建项目时预创建 N 个空 episode 占位
    // 用户进入 drama-studio 直接看到 N 个剧集 chip,点击其中一个再触发生成
    const N = project.episode_count;
    for (let i = 1; i <= N; i++) {
      db.insertDramaEpisode({
        id: uuidv4(),
        project_id: project.id,
        user_id: req.user?.id,
        episode_index: i,
        title: `第${i}集`,
        theme: '',
        status: 'empty',     // 新增状态：空占位 (vs draft/processing/done/error)
        progress: 0,
        message: '未开始',
        result: null,
        error_message: null,
      });
    }

    res.json({ success: true, data: project });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/drama/projects — 项目列表
router.get('/projects', (req, res) => {
  const { scopeUserId } = require('../middleware/auth');
  const projects = db.listDramaProjects(scopeUserId(req));
  // 附带每个项目的剧集数量
  const result = projects.map(p => {
    const episodes = db.listDramaEpisodes(p.id);
    const doneCount = episodes.filter(e => e.status === 'done').length;
    return { ...p, episodes_total: episodes.length, episodes_done: doneCount };
  });
  res.json({ success: true, data: result });
});

// 归属检查辅助 — 用于 drama 的 :pid 路由（drama 路由参数名是 pid 而不是 id）
const { ownedBy: _dramaOwnedBy } = require('../middleware/auth');
router.param('pid', (req, res, next, pid) => {
  const project = db.getDramaProject(pid);
  if (!project || !_dramaOwnedBy(req, project)) {
    return res.status(404).json({ success: false, error: '项目不存在' });
  }
  req._dramaProject = project;
  next();
});

// GET /api/drama/projects/:pid — 项目详情
router.get('/projects/:pid', (req, res) => {
  const project = req._dramaProject;
  const episodes = db.listDramaEpisodes(project.id);
  res.json({ success: true, data: { ...project, episodes } });
});

// PUT /api/drama/projects/:pid — 更新项目
router.put('/projects/:pid', (req, res) => {
  const project = req._dramaProject;
  const allowed = ['title', 'synopsis', 'style', 'motion_preset', 'characters', 'episode_count', 'aspect_ratio', 'scene_count', 'shot_duration', 'image_model', 'video_model', 'cover_url', 'status', 'final_video_url'];
  const fields = {};
  for (const k of allowed) { if (req.body[k] !== undefined) fields[k] = req.body[k]; }
  db.updateDramaProject(req.params.pid, fields);
  res.json({ success: true, data: { ...project, ...fields } });
});

// DELETE /api/drama/projects/:pid — 删除项目（含所有剧集文件）
router.delete('/projects/:pid', (req, res) => {
  const episodes = db.listDramaEpisodes(req.params.pid);
  for (const ep of episodes) {
    const taskDir = path.join(DRAMA_DIR, ep.id);
    try { fs.rmSync(taskDir, { recursive: true, force: true }); } catch {}
  }
  db.deleteDramaProject(req.params.pid);
  res.json({ success: true });
});

// ═══════════════════════════════════════════
// 剧集级
// ═══════════════════════════════════════════

// POST /api/drama/projects/:pid/episodes — 生成新剧集
router.post('/projects/:pid/episodes', async (req, res) => {
  try {
    const project = db.getDramaProject(req.params.pid);
    if (!project) return res.status(404).json({ success: false, error: '项目不存在' });

    const { theme, sceneCount, durationPerScene, styleId, character_ids, image_model, video_model, aspect_ratio } = req.body;
    const existingEps = db.listDramaEpisodes(project.id);
    const episodeIndex = existingEps.length + 1;

    // 获取前一集的摘要
    let previousSummary = '';
    if (existingEps.length > 0) {
      const lastEp = existingEps[existingEps.length - 1];
      if (lastEp.result) {
        previousSummary = lastEp.result.synopsis || lastEp.result.title || '';
        // 拼接场景描述作为更详细的摘要
        const sceneDescs = (lastEp.result.scenes || []).map(s => s.description).join('；');
        if (sceneDescs) previousSummary += '。剧情：' + sceneDescs.substring(0, 300);
      }
    }

    const episodeId = uuidv4();
    const episode = {
      id: episodeId,
      project_id: project.id,
      user_id: req.user?.id,
      episode_index: episodeIndex,
      title: `第${episodeIndex}集`,
      theme: theme || project.synopsis || project.title,
      status: 'processing',
      progress: 0,
      message: '初始化...',
      result: null,
      error_message: null,
    };

    db.insertDramaEpisode(episode);
    res.json({ success: true, data: { id: episodeId, episode_index: episodeIndex } });

    // 异步生成
    generateDrama(episodeId, {
      theme: episode.theme,
      style: project.style,
      sceneCount: sceneCount || 6,
      durationPerScene: durationPerScene || 5,
      characters: project.characters || [],
      motionPreset: project.motion_preset || 'cinematic',
      styleId: styleId || null,
      character_ids: character_ids || [],
      episodeIndex,
      episodeCount: project.episode_count || 10,
      previousSummary,
      image_model: image_model || '',
      video_model: video_model || '',
      aspect_ratio: aspect_ratio || project.aspect_ratio || '9:16',
      genre: project.genre || project.drama_type || req.body.genre || '',
    }, (update) => {
      db.updateDramaEpisode(episodeId, { progress: update.progress, message: update.message });
      const listener = progressListeners.get(episodeId);
      if (listener) listener.write(`data: ${JSON.stringify(update)}\n\n`);
    }).then(result => {
      db.updateDramaEpisode(episodeId, { status: 'done', progress: 100, result, title: `第${episodeIndex}集：${result.title || ''}` });
      // 设置项目封面（第一集第一个场景）
      if (episodeIndex === 1 && !project.cover_url && result.scenes?.[0]?.image_url) {
        db.updateDramaProject(project.id, { cover_url: result.scenes[0].image_url });
      }
      const listener = progressListeners.get(episodeId);
      if (listener) { listener.write(`data: ${JSON.stringify({ step: 'done', progress: 100, message: '完成', result })}\n\n`); listener.end(); progressListeners.delete(episodeId); }
    }).catch(err => {
      console.error('[Drama] 剧集生成失败:', err);
      db.updateDramaEpisode(episodeId, { status: 'error', error_message: err.message });
      const listener = progressListeners.get(episodeId);
      if (listener) { listener.write(`data: ${JSON.stringify({ step: 'error', message: err.message })}\n\n`); listener.end(); progressListeners.delete(episodeId); }
    });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/drama/projects/:pid/episodes — 剧集列表
router.get('/projects/:pid/episodes', (req, res) => {
  const episodes = db.listDramaEpisodes(req.params.pid);
  res.json({ success: true, data: episodes });
});

// GET /api/drama/projects/:pid/episodes/:eid — 剧集详情
router.get('/projects/:pid/episodes/:eid', (req, res) => {
  const ep = db.getDramaEpisode(req.params.eid);
  if (!ep || ep.project_id !== req.params.pid) return res.status(404).json({ success: false, error: '剧集不存在' });
  res.json({ success: true, data: ep });
});

// GET /api/drama/projects/:pid/episodes/:eid/progress — SSE
router.get('/projects/:pid/episodes/:eid/progress', (req, res) => {
  const ep = db.getDramaEpisode(req.params.eid);
  if (!ep) return res.status(404).json({ success: false, error: '剧集不存在' });
  if (ep.status === 'done' || ep.status === 'error') return res.json({ success: true, data: ep });
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
  res.write(`data: ${JSON.stringify({ step: 'init', progress: ep.progress || 0, message: ep.message || '处理中...' })}\n\n`);
  progressListeners.set(req.params.eid, res);
  req.on('close', () => progressListeners.delete(req.params.eid));
});

// PUT /api/drama/projects/:pid/episodes/:eid — 更新剧集（保存全部）
router.put('/projects/:pid/episodes/:eid', (req, res) => {
  const ep = db.getDramaEpisode(req.params.eid);
  if (!ep) return res.status(404).json({ success: false, error: '剧集不存在' });
  const allowed = ['title', 'theme', 'result'];
  const fields = {};
  for (const k of allowed) { if (req.body[k] !== undefined) fields[k] = req.body[k]; }
  db.updateDramaEpisode(req.params.eid, fields);
  res.json({ success: true });
});

// PUT /api/drama/projects/:pid/episodes/:eid/scenes/:idx — 编辑分镜
router.put('/projects/:pid/episodes/:eid/scenes/:idx', (req, res) => {
  const ep = db.getDramaEpisode(req.params.eid);
  if (!ep?.result) return res.status(404).json({ success: false, error: '剧集不存在或未完成' });
  const idx = parseInt(req.params.idx);
  const scenes = ep.result.scenes;
  if (!scenes || idx < 0 || idx >= scenes.length) return res.status(400).json({ success: false, error: '索引无效' });

  const updates = req.body;
  const allowed = ['description', 'dialogue', 'speaker', 'narrator', 'sfx', 'emotion', 'pacing', 'duration', 'shot_scale', 'motion_id', 'motion_name', 'motion_icon', 'motion_prompt', 'visual_prompt', 'full_prompt_en', 'full_prompt_cn'];
  for (const key of allowed) { if (updates[key] !== undefined) scenes[idx][key] = updates[key]; }

  if (updates.motion_id || updates.shot_scale || updates.visual_prompt) {
    const { assemblePrompts } = require('../services/dramaService');
    const project = db.getDramaProject(req.params.pid);
    assemblePrompts({ scenes: [scenes[idx]] }, project?.style || ep.result?.style || '日系动漫');
  }

  db.updateDramaEpisode(req.params.eid, { result: ep.result });
  res.json({ success: true, data: scenes[idx] });
});

// ═══════════════════════════════════════════════════
// 【v15 NEW】POST /api/drama/projects/:pid/episodes/:eid/generate
// 在【已存在的空 episode】上触发生成 (而不是创建新 episode)
// 流程：
//   1. 先调 orchestrator.runWorkflow('drama', task) 跑团队 6 阶段分析（题材选品→大纲→人物→分镜→生成→投放）
//   2. 把团队分析结果作为增强 context 传给 dramaService.generateDrama()
//   3. 实际生成 scenes + 角色 bible + 分镜图
// ═══════════════════════════════════════════════════
router.post('/projects/:pid/episodes/:eid/generate', async (req, res) => {
  const project = db.getDramaProject(req.params.pid);
  if (!project) return res.status(404).json({ success: false, error: '项目不存在' });
  const ep = db.getDramaEpisode(req.params.eid);
  if (!ep) return res.status(404).json({ success: false, error: '剧集不存在' });
  if (ep.status === 'processing') return res.status(409).json({ success: false, error: '本集正在生成中' });

  // 用户提供的本集剧本 (来自 textarea)
  const customScript = (req.body.theme || req.body.script || '').trim();

  // 获取前一集的摘要
  const allEps = db.listDramaEpisodes(project.id).sort((a, b) => (a.episode_index || 0) - (b.episode_index || 0));
  let previousSummary = '';
  const prevEp = allEps.find(e => e.episode_index === (ep.episode_index - 1) && e.result);
  if (prevEp?.result) {
    previousSummary = prevEp.result.synopsis || prevEp.result.title || '';
    const sceneDescs = (prevEp.result.scenes || []).map(s => s.description).join('；');
    if (sceneDescs) previousSummary += '。剧情：' + sceneDescs.substring(0, 300);
  }

  // 标记 episode 状态
  db.updateDramaEpisode(ep.id, {
    status: 'processing',
    progress: 0,
    message: '初始化…',
    theme: customScript || ep.theme || project.synopsis || project.title,
    error_message: null,
  });
  res.json({ success: true, data: { id: ep.id, status: 'processing' } });

  // ─── 异步执行 ───
  const { generateDrama } = require('../services/dramaService');
  const orchestrator = require('../services/agentOrchestrator');

  const updateProgress = (update) => {
    db.updateDramaEpisode(ep.id, { progress: update.progress, message: update.message });
    const listener = progressListeners.get(ep.id);
    if (listener) listener.write(`data: ${JSON.stringify(update)}\n\n`);
  };

  (async () => {
    try {
      // ── Phase A: 跑 orchestrator drama workflow (团队 6 阶段分析) ──
      let workflowAnalysis = null;
      try {
        updateProgress({ step: 'workflow', progress: 3, message: '🎭 调用漫剧工作流 (6 阶段 12 agent)...' });
        const taskDesc = `
项目: ${project.title}
画风: ${project.style || '日系动漫'}
比例: ${project.aspect_ratio || '9:16'}
当前是第 ${ep.episode_index} 集 / 共 ${project.episode_count} 集
${previousSummary ? '前集摘要: ' + previousSummary + '\n' : ''}
${customScript ? '本集剧本:\n' + customScript : '本集主题: 自动承接上集'}
要求: 把上面的内容转换成专业的影视语言分镜方案。
        `.trim();
        const wfResult = await orchestrator.runWorkflow(taskDesc, {
          taskType: 'business',
          workflowName: 'drama',
        });
        workflowAnalysis = wfResult;
        updateProgress({ step: 'workflow_done', progress: 12, message: `🎭 工作流完成 (${wfResult.total_agents_involved} agent / ${(wfResult.total_duration_ms/1000).toFixed(0)}s)` });
      } catch (wfErr) {
        console.error('[drama generate] orchestrator workflow failed:', wfErr.message, wfErr.stack);
        updateProgress({ step: 'workflow_skip', progress: 12, message: `⚠️ 团队工作流失败: ${wfErr.message.slice(0, 80)}` });
      }

      // ── Phase B: 跑 dramaService 生成实际 scenes + 图片 ──
      // 把 workflow 分析作为增强 previousSummary 注入
      let enhancedSummary = previousSummary;
      if (workflowAnalysis?.phases) {
        const summaries = workflowAnalysis.phases
          .flatMap(p => p.participants.map(pp => `[${p.name} · ${pp.agent_name}] ${pp.summary}`))
          .filter(Boolean)
          .join('\n');
        enhancedSummary = (previousSummary ? previousSummary + '\n\n' : '') + '【团队工作流分析】\n' + summaries;
      }

      const result = await generateDrama(ep.id, {
        theme: customScript || ep.theme || project.synopsis || project.title,
        style: project.style,
        sceneCount: project.scene_count || 6,
        durationPerScene: project.shot_duration || 5,
        characters: project.characters || [],
        motionPreset: project.motion_preset || 'cinematic',
        episodeIndex: ep.episode_index,
        episodeCount: project.episode_count || 10,
        previousSummary: enhancedSummary,
        image_model: project.image_model || '',
        video_model: project.video_model || '',
        aspect_ratio: project.aspect_ratio || '9:16',
        genre: project.genre || project.drama_type || '',
      }, updateProgress);

      // 把 workflow 分析也存到 result
      if (workflowAnalysis) result.workflow_analysis = workflowAnalysis;

      db.updateDramaEpisode(ep.id, {
        status: 'done',
        progress: 100,
        result,
        title: `第${ep.episode_index}集：${result.title || ''}`,
      });

      // 设置项目封面
      if (ep.episode_index === 1 && !project.cover_url && result.scenes?.[0]?.image_url) {
        db.updateDramaProject(project.id, { cover_url: result.scenes[0].image_url });
      }

      const listener = progressListeners.get(ep.id);
      if (listener) {
        listener.write(`data: ${JSON.stringify({ step: 'done', progress: 100, message: '完成', result })}\n\n`);
        listener.end();
        progressListeners.delete(ep.id);
      }
    } catch (err) {
      console.error('[drama generate] failed:', err);
      db.updateDramaEpisode(ep.id, { status: 'error', error_message: err.message });
      const listener = progressListeners.get(ep.id);
      if (listener) {
        listener.write(`data: ${JSON.stringify({ step: 'error', message: err.message })}\n\n`);
        listener.end();
        progressListeners.delete(ep.id);
      }
    }
  })();
});

// POST /api/drama/projects/:pid/episodes/:eid/scenes/:idx/generate-video — 单镜头生图(带角色一致性)
router.post('/projects/:pid/episodes/:eid/scenes/:idx/generate-video', async (req, res) => {
  const ep = db.getDramaEpisode(req.params.eid);
  if (!ep?.result) return res.status(404).json({ success: false, error: '剧集不存在或未完成' });
  const idx = parseInt(req.params.idx);
  const scene = ep.result.scenes?.[idx];
  if (!scene) return res.status(400).json({ success: false, error: '场景不存在' });

  try {
    const { generateDramaImage } = require('../services/imageService');
    const prompt = scene.full_prompt_en || scene.visual_prompt || scene.description;
    // 角色一致性: 用本场景出现角色的三视图作为 reference image
    const refImages = (scene.char_ref_images || []).filter(Boolean);
    const absRefImages = refImages.map(u => {
      if (/^https?:\/\//.test(u)) return u;
      const base = process.env.PUBLIC_URL || `http://127.0.0.1:${process.env.PORT || 4600}`;
      return base + u;
    });
    const aspectRatio = ep.result?.aspect_ratio || '9:16';
    const imgResult = await generateDramaImage({
      prompt,
      filename: `drama_${ep.id}_s${idx}`,
      aspectRatio,
      referenceImages: absRefImages,
    });
    const taskDir = path.join(DRAMA_DIR, ep.id);
    fs.mkdirSync(taskDir, { recursive: true });
    const imgDest = path.join(taskDir, `scene_${idx}.png`);
    if (imgResult.filePath && fs.existsSync(imgResult.filePath)) fs.copyFileSync(imgResult.filePath, imgDest);
    scene.image_url = `/api/drama/tasks/${ep.id}/image/${idx}`;
    db.updateDramaEpisode(ep.id, { result: ep.result });
    res.json({ success: true, data: { image_url: scene.image_url, used_refs: absRefImages.length } });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /api/drama/projects/:pid/episodes/:eid/regenerate-character-bible — 重新生成 Character Bible
router.post('/projects/:pid/episodes/:eid/regenerate-character-bible', async (req, res) => {
  const ep = db.getDramaEpisode(req.params.eid);
  if (!ep?.result) return res.status(404).json({ success: false, error: '剧集不存在或未完成' });
  try {
    const { agentCharacterConsistency, injectCharacterLocks } = require('../services/dramaService');
    const project = db.getDramaProject(req.params.pid);
    // 获取角色库角色
    const enrichedChars = [];
    for (const c of (project?.characters || [])) {
      if (c.id) {
        const dbChar = db.getAIChar(c.id);
        if (dbChar) enrichedChars.push({ ...dbChar, ...c });
        else enrichedChars.push(c);
      } else enrichedChars.push(c);
    }
    const screenplayLike = {
      title: ep.result.title,
      synopsis: ep.result.synopsis,
      character_profiles: ep.result.character_bible?.characters || [],
    };
    const bible = await agentCharacterConsistency({ screenplay: screenplayLike, characters: enrichedChars, genre: project?.genre || project?.drama_type || '' });
    // 重新注入到所有 scene
    injectCharacterLocks(ep.result.scenes || [], bible);
    // 把注入后的字段写回 scene
    for (const s of (ep.result.scenes || [])) {
      s.char_ref_images = s._char_ref_images || [];
      s.present_chars = s._present_chars || [];
      s.char_lock_cn = s._char_lock_cn || '';
      // 重组 full_prompt_en/cn
      const prefixEn = s._char_lock_en ? s._char_lock_en + ', ' : '';
      const prefixCn = s._char_lock_cn ? s._char_lock_cn + '。' : '';
      // 去掉旧的 lock 前缀(如果存在)
      const baseEn = (s.full_prompt_en || '').replace(/^the same [^,]+,\s*/i, '');
      const baseCn = (s.full_prompt_cn || '').replace(/^同一个[^。]+。/, '');
      s.full_prompt_en = prefixEn + baseEn;
      s.full_prompt_cn = prefixCn + baseCn;
    }
    ep.result.character_bible = bible;
    db.updateDramaEpisode(ep.id, { result: ep.result });
    res.json({ success: true, data: { character_count: bible.characters?.length || 0, bible } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/drama/projects/:pid/episodes/:eid/scenes/:idx/make-video — 单镜头生成视频
router.post('/projects/:pid/episodes/:eid/scenes/:idx/make-video', async (req, res) => {
  const ep = db.getDramaEpisode(req.params.eid);
  if (!ep?.result) return res.status(404).json({ success: false, error: '剧集不存在或未完成' });
  const project = db.getDramaProject(req.params.pid);
  const idx = parseInt(req.params.idx);
  const scene = ep.result.scenes?.[idx];
  if (!scene) return res.status(400).json({ success: false, error: '场景不存在' });

  try {
    const { generateVideoClip } = require('../services/videoService');
    const prompt = scene.full_prompt_en || scene.visual_prompt || scene.description;

    // 参考图：用分镜图做 I2V（读取为 base64 或本地路径）
    let imageUrl = null;
    const imgPath = path.join(DRAMA_DIR, ep.id, `scene_${idx}.png`);
    if (fs.existsSync(imgPath)) {
      imageUrl = imgPath; // videoService 支持本地路径
    }

    // 从请求或项目中获取视频模型
    const videoModel = req.body.video_model || ep.result?.video_model || '';
    let videoProvider = '', videoModelId = '';
    if (videoModel && videoModel.includes('::')) {
      [videoProvider, videoModelId] = videoModel.split('::');
    }

    const taskDir = path.join(DRAMA_DIR, ep.id);
    fs.mkdirSync(taskDir, { recursive: true });
    const videoFilename = `video_${idx}`;

    const result = await generateVideoClip({
      prompt,
      image_url: imageUrl,
      video_provider: videoProvider || undefined,
      video_model: videoModelId || undefined,
      duration: scene.duration || 5,
      scene_index: idx,
      project_id: ep.id,
      outputDir: taskDir,
      filename: videoFilename,
    });

    // 检查视频文件是否生成
    const expectedPath = path.join(taskDir, `${videoFilename}.mp4`);
    const videoFile = result?.filePath || result?.file_path || expectedPath;
    if (fs.existsSync(videoFile)) {
      if (videoFile !== expectedPath) fs.copyFileSync(videoFile, expectedPath);
      scene.video_url = `/api/drama/tasks/${ep.id}/video/${idx}`;
    } else if (typeof videoFile === 'string' && videoFile.startsWith('http')) {
      scene.video_url = videoFile;
    }

    db.updateDramaEpisode(ep.id, { result: ep.result });
    res.json({ success: true, data: { video_url: scene.video_url } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/drama/tasks/:id/video/:idx — 场景视频流播放
router.get('/tasks/:id/video/:idx', (req, res) => {
  const filePath = path.join(DRAMA_DIR, req.params.id, `video_${req.params.idx}.mp4`);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  const stat = fs.statSync(filePath);
  res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': stat.size });
  fs.createReadStream(filePath).pipe(res);
});

// GET /api/drama/tasks/:id/voice/:idx — 场景配音 mp3 流
router.get('/tasks/:id/voice/:idx', (req, res) => {
  const filePath = path.join(DRAMA_DIR, req.params.id, `voice_${req.params.idx}.mp3`);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  const stat = fs.statSync(filePath);
  res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': stat.size });
  fs.createReadStream(filePath).pipe(res);
});

// POST /api/drama/projects/:pid/episodes/:eid/regenerate-voice — 重新生成本集所有配音
router.post('/projects/:pid/episodes/:eid/regenerate-voice', async (req, res) => {
  const ep = db.getDramaEpisode(req.params.eid);
  if (!ep?.result) return res.status(404).json({ success: false, error: '剧集不存在或未完成' });
  try {
    const taskDir = path.join(DRAMA_DIR, ep.id);
    fs.mkdirSync(taskDir, { recursive: true });
    // 复用 dramaService 的 agentDramaVoice
    const dramaSvc = require('../services/dramaService');
    if (typeof dramaSvc.agentDramaVoice !== 'function') {
      // 兜底: 直接调 ttsService
      const { generateSpeech } = require('../services/ttsService');
      let count = 0;
      for (let i = 0; i < ep.result.scenes.length; i++) {
        const s = ep.result.scenes[i];
        const text = (s.dialogue || '').trim() || (s.narrator || '').trim();
        if (!text) continue;
        const out = path.join(taskDir, `voice_${i}.mp3`);
        try {
          await generateSpeech(text, out, { gender: 'female', speed: 1.0 });
          if (fs.existsSync(out)) {
            s.voice_url = `/api/drama/tasks/${ep.id}/voice/${i}`;
            count++;
          }
        } catch (e) { s.voice_error = e.message; }
      }
      db.updateDramaEpisode(ep.id, { result: ep.result });
      return res.json({ success: true, data: { voice_count: count } });
    }
    const count = await dramaSvc.agentDramaVoice(ep.result.scenes, taskDir);
    db.updateDramaEpisode(ep.id, { result: ep.result });
    res.json({ success: true, data: { voice_count: count } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/drama/projects/:pid/episodes/:eid/compose — 一键合成成片
// 步骤: 拼接所有 scene 视频 → 可选叠加 BGM → 输出最终 mp4
router.post('/projects/:pid/episodes/:eid/compose', async (req, res) => {
  const ep = db.getDramaEpisode(req.params.eid);
  if (!ep?.result) return res.status(404).json({ success: false, error: '剧集不存在或未完成' });
  const scenes = ep.result.scenes || [];
  if (!scenes.length) return res.status(400).json({ success: false, error: '本集没有场景' });

  try {
    const taskDir = path.join(DRAMA_DIR, ep.id);
    fs.mkdirSync(taskDir, { recursive: true });

    // 1) 收集所有已生成的 scene 视频文件 (并尝试与对应配音 mux)
    const { mergeVideoClips, addAudioToVideo } = require('../services/ffmpegService');
    const muxedDir = path.join(taskDir, '_muxed');
    fs.mkdirSync(muxedDir, { recursive: true });

    const clipPaths = [];
    const missing = [];
    let muxedVoiceCount = 0;
    for (let i = 0; i < scenes.length; i++) {
      const videoPath = path.join(taskDir, `video_${i}.mp4`);
      const voicePath = path.join(taskDir, `voice_${i}.mp3`);
      if (!fs.existsSync(videoPath)) { missing.push(i); continue; }
      // 如果有配音, 把视频+配音 mux 成一个临时片段
      if (fs.existsSync(voicePath)) {
        try {
          const muxedPath = path.join(muxedDir, `clip_${i}.mp4`);
          await addAudioToVideo({
            videoPath, audioPath: voicePath, outputPath: muxedPath, volume: 1.0
          });
          if (fs.existsSync(muxedPath)) {
            clipPaths.push(muxedPath);
            muxedVoiceCount++;
            continue;
          }
        } catch (e) {
          console.warn(`[compose] mux voice scene ${i} failed:`, e.message);
        }
      }
      clipPaths.push(videoPath);
    }
    if (clipPaths.length === 0) {
      return res.status(400).json({
        success: false,
        error: '没有可用的分镜视频。请先在每个分镜点击"生成视频"或调用全部生成接口。'
      });
    }

    // 2) 拼接所有片段
    const concatPath = path.join(taskDir, 'final_concat.mp4');
    await mergeVideoClips({ clipPaths, outputPath: concatPath });

    // 3) 可选: 叠加 BGM (如果用户上传了 bgm 或指定了 bgm_url)
    let finalPath = concatPath;
    const bgmPath = req.body.bgm_path; // 后端绝对路径(可选)
    if (bgmPath && fs.existsSync(bgmPath)) {
      finalPath = path.join(taskDir, 'final.mp4');
      await addAudioToVideo({
        videoPath: concatPath,
        audioPath: bgmPath,
        outputPath: finalPath,
        volume: req.body.bgm_volume ?? 0.4
      });
      try { fs.unlinkSync(concatPath); } catch {}
    } else {
      // 没 BGM 就把 concat 重命名为 final
      const finalRenamed = path.join(taskDir, 'final.mp4');
      try { fs.renameSync(concatPath, finalRenamed); finalPath = finalRenamed; } catch {}
    }

    // 清理临时 muxed 目录
    try { fs.rmSync(muxedDir, { recursive: true, force: true }); } catch {}

    // 4) 更新 episode.result.final_video_url
    ep.result.final_video_url = `/api/drama/tasks/${ep.id}/final`;
    ep.result.composed_at = new Date().toISOString();
    ep.result.composed_clips = clipPaths.length;
    ep.result.composed_with_voice = muxedVoiceCount;
    db.updateDramaEpisode(ep.id, { result: ep.result, status: 'composed' });

    res.json({
      success: true,
      data: {
        final_video_url: ep.result.final_video_url,
        composed_clips: clipPaths.length,
        composed_with_voice: muxedVoiceCount,
        missing_scenes: missing,
        total_scenes: scenes.length,
      }
    });
  } catch (err) {
    console.error('[Drama compose]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/drama/projects/:pid/episodes/:eid/compose-from-images — 图片快速合成成片
// 用 ffmpeg 把每个 scene 的图片按 duration 拼成 slideshow 视频, 自动叠加配音
// 不依赖 video_<i>.mp4, 适合"分镜图都生成完了但还没生成视频"的场景
router.post('/projects/:pid/episodes/:eid/compose-from-images', async (req, res) => {
  const ep = db.getDramaEpisode(req.params.eid);
  if (!ep?.result) return res.status(404).json({ success: false, error: '剧集不存在或未完成' });
  const scenes = ep.result.scenes || [];
  if (!scenes.length) return res.status(400).json({ success: false, error: '本集没有场景' });

  try {
    const taskDir = path.join(DRAMA_DIR, ep.id);
    fs.mkdirSync(taskDir, { recursive: true });

    // 收集每个 scene 的图片 + 时长 + 可选配音
    const clips = [];
    const missing = [];
    for (let i = 0; i < scenes.length; i++) {
      const imgPath = path.join(taskDir, `scene_${i}.png`);
      if (!fs.existsSync(imgPath)) { missing.push(i); continue; }
      const voicePath = path.join(taskDir, `voice_${i}.mp3`);
      clips.push({
        path: imgPath,
        duration: scenes[i].duration || 5,
        voicePath: fs.existsSync(voicePath) ? voicePath : null,
      });
    }
    if (clips.length === 0) {
      return res.status(400).json({
        success: false,
        error: '没有可用的分镜图。请先确认每个分镜都已生成图片(scene_<i>.png)。'
      });
    }

    // 根据剧集 aspect_ratio 计算输出尺寸
    const ar = ep.result?.aspect_ratio || '9:16';
    const sizeMap = {
      '9:16': { width: 1080, height: 1920 },
      '16:9': { width: 1920, height: 1080 },
      '1:1':  { width: 1080, height: 1080 },
      '4:3':  { width: 1440, height: 1080 },
    };
    const { width, height } = sizeMap[ar] || sizeMap['9:16'];

    const { composeImagesToVideo, addAudioToVideo } = require('../services/ffmpegService');
    const concatPath = path.join(taskDir, 'final_slideshow.mp4');
    await composeImagesToVideo(clips, concatPath, { width, height, fps: 30 });

    // 可选: 叠加 BGM
    let finalPath = concatPath;
    const bgmPath = req.body.bgm_path;
    if (bgmPath && fs.existsSync(bgmPath)) {
      finalPath = path.join(taskDir, 'final.mp4');
      await addAudioToVideo({
        videoPath: concatPath, audioPath: bgmPath, outputPath: finalPath,
        volume: req.body.bgm_volume ?? 0.4
      });
      try { fs.unlinkSync(concatPath); } catch {}
    } else {
      const finalRenamed = path.join(taskDir, 'final.mp4');
      try { fs.renameSync(concatPath, finalRenamed); finalPath = finalRenamed; } catch {}
    }

    const voiceMuxedCount = clips.filter(c => c.voicePath).length;
    ep.result.final_video_url = `/api/drama/tasks/${ep.id}/final`;
    ep.result.composed_at = new Date().toISOString();
    ep.result.composed_clips = clips.length;
    ep.result.composed_with_voice = voiceMuxedCount;
    ep.result.composed_mode = 'images';
    db.updateDramaEpisode(ep.id, { result: ep.result, status: 'composed' });

    res.json({
      success: true,
      data: {
        final_video_url: ep.result.final_video_url,
        composed_clips: clips.length,
        composed_with_voice: voiceMuxedCount,
        missing_scenes: missing,
        total_scenes: scenes.length,
        mode: 'images',
        aspect_ratio: ar,
      }
    });
  } catch (err) {
    console.error('[Drama compose-from-images]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/drama/tasks/:id/final — 成片视频流
router.get('/tasks/:id/final', (req, res) => {
  const filePath = path.join(DRAMA_DIR, req.params.id, 'final.mp4');
  if (!fs.existsSync(filePath)) return res.status(404).end();
  const stat = fs.statSync(filePath);
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': 'video/mp4',
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': stat.size });
    fs.createReadStream(filePath).pipe(res);
  }
});

// GET /api/drama/tasks/:id/final/download — 下载成片
router.get('/tasks/:id/final/download', (req, res) => {
  const filePath = path.join(DRAMA_DIR, req.params.id, 'final.mp4');
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.download(filePath, `drama_${req.params.id}.mp4`);
});

// POST /api/drama/projects/:pid/episodes/:eid/generate-all-videos — 批量生成所有分镜视频
router.post('/projects/:pid/episodes/:eid/generate-all-videos', async (req, res) => {
  const ep = db.getDramaEpisode(req.params.eid);
  if (!ep?.result) return res.status(404).json({ success: false, error: '剧集不存在或未完成' });
  const scenes = ep.result.scenes || [];
  if (!scenes.length) return res.status(400).json({ success: false, error: '本集没有场景' });

  // 立即返回, 后台异步执行
  res.json({ success: true, data: { total: scenes.length, started: true } });

  const { generateVideoClip } = require('../services/videoService');
  const taskDir = path.join(DRAMA_DIR, ep.id);
  fs.mkdirSync(taskDir, { recursive: true });
  const videoModel = req.body.video_model || ep.result?.video_model || '';
  let videoProvider = '', videoModelId = '';
  if (videoModel && videoModel.includes('::')) [videoProvider, videoModelId] = videoModel.split('::');

  let done = 0, failed = 0;
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    // 跳过已生成的
    const existPath = path.join(taskDir, `video_${i}.mp4`);
    if (fs.existsSync(existPath)) {
      done++;
      db.updateDramaEpisode(ep.id, { progress: Math.round((done / scenes.length) * 100), message: `已存在 ${i + 1}/${scenes.length}` });
      continue;
    }
    try {
      const prompt = scene.full_prompt_en || scene.visual_prompt || scene.description;
      const imgPath = path.join(taskDir, `scene_${i}.png`);
      const result = await generateVideoClip({
        prompt,
        image_url: fs.existsSync(imgPath) ? imgPath : null,
        video_provider: videoProvider || undefined,
        video_model: videoModelId || undefined,
        duration: scene.duration || 5,
        scene_index: i,
        project_id: ep.id,
        outputDir: taskDir,
        filename: `video_${i}`,
      });
      const videoFile = result?.filePath || result?.file_path || existPath;
      if (fs.existsSync(videoFile)) {
        if (videoFile !== existPath) fs.copyFileSync(videoFile, existPath);
        scene.video_url = `/api/drama/tasks/${ep.id}/video/${i}`;
      }
      done++;
    } catch (err) {
      console.error(`[Drama generateAll] scene ${i} failed:`, err.message);
      scene.video_error = err.message;
      failed++;
    }
    db.updateDramaEpisode(ep.id, {
      result: ep.result,
      progress: Math.round(((done + failed) / scenes.length) * 100),
      message: `已生成 ${done}/${scenes.length}, 失败 ${failed}`
    });
  }
  db.updateDramaEpisode(ep.id, {
    result: ep.result,
    message: `批量生成完成: ${done} 成功, ${failed} 失败`,
  });
});

// DELETE /api/drama/projects/:pid/episodes/:eid — 删除剧集
router.delete('/projects/:pid/episodes/:eid', (req, res) => {
  const taskDir = path.join(DRAMA_DIR, req.params.eid);
  try { fs.rmSync(taskDir, { recursive: true, force: true }); } catch {}
  db.deleteDramaEpisode(req.params.eid);
  res.json({ success: true });
});

// ═══════════════════════════════════════════
// 兼容旧端点（图片服务等）
// ═══════════════════════════════════════════
router.get('/tasks/:id/image/:idx', (req, res) => {
  const filePath = path.join(DRAMA_DIR, req.params.id, `scene_${req.params.idx}.png`);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.sendFile(filePath);
});

// ═══════════════════════════════════════════
// POST /api/drama/projects/:pid/episodes/:eid/scenes/:idx/generate-prompt
// AI 生成影视提示词（将小说描述转换为影视脚本提示词）
// ═══════════════════════════════════════════
router.post('/projects/:pid/episodes/:eid/scenes/:idx/generate-prompt', async (req, res) => {
  const ep = db.getDramaEpisode(req.params.eid);
  if (!ep?.result) return res.status(404).json({ success: false, error: '剧集不存在或未完成' });
  const idx = parseInt(req.params.idx);
  const scene = ep.result.scenes?.[idx];
  if (!scene) return res.status(400).json({ success: false, error: '场景不存在' });

  try {
    const { callLLM } = require('../services/storyService');
    const systemPrompt = `你是专业的 AI 影视分镜提示词专家。你需要将场景描述转换为适合 AI 图像/视频生成的提示词。

【提示词要求】
1. 描述画面中的人物外貌（具体的发型/发色/服装/体型/表情）
2. 描述场景环境（地点/天气/时间/背景元素）
3. 描述物件和道具
4. 描述光影和氛围（光线方向/色温/情绪）
5. 描述镜头语言（景别/构图/运镜）
6. 禁止使用小说化的叙述语句，只用视觉描述关键词

【输出格式 JSON】
{
  "prompt_cn": "中文提示词（视觉描述，60-120字）",
  "prompt_en": "英文提示词（视觉描述，40-80词）"
}`;

    const userPrompt = `场景描述: ${scene.description || ''}
对话: ${scene.dialogue || '无'}
旁白: ${scene.narrator || '无'}
角色: ${scene.speaker || '未知'}
情绪: ${scene.emotion || '未知'}
景别: ${scene.shot_scale || '中景'}

请将上面的场景信息转换为 AI 生图/生视频的提示词。`;

    const raw = await callLLM(systemPrompt, userPrompt);
    let parsed;
    try {
      let str = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
      const start = str.indexOf('{');
      const end = str.lastIndexOf('}');
      if (start !== -1 && end > start) str = str.slice(start, end + 1);
      parsed = JSON.parse(str);
    } catch {
      throw new Error('AI 返回格式异常，请重试');
    }

    // 保存到 episode 数据
    scene.full_prompt_cn = parsed.prompt_cn || scene.full_prompt_cn;
    scene.full_prompt_en = parsed.prompt_en || scene.full_prompt_en;
    db.updateDramaEpisode(ep.id, { result: ep.result });

    res.json({ success: true, data: { prompt_cn: parsed.prompt_cn, prompt_en: parsed.prompt_en } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════
// POST /api/drama/projects/:pid/episodes/:eid/scenes/:idx/rewrite-dialogue
// AI 改写对话/旁白（优化为影视表达）
// ═══════════════════════════════════════════
router.post('/projects/:pid/episodes/:eid/scenes/:idx/rewrite-dialogue', async (req, res) => {
  const ep = db.getDramaEpisode(req.params.eid);
  if (!ep?.result) return res.status(404).json({ success: false, error: '剧集不存在或未完成' });
  const idx = parseInt(req.params.idx);
  const scene = ep.result.scenes?.[idx];
  if (!scene) return res.status(400).json({ success: false, error: '场景不存在' });

  try {
    const { callLLM } = require('../services/storyService');
    const { dialogue, narrator, speaker, description } = req.body;

    const systemPrompt = `你是专业的短剧台词编剧。你需要将对话/旁白改写为更适合短视频的表达方式。

【改写原则】
1. 对话≤15字，要有冲击力，推动剧情
2. 旁白≤20字，用于渲染氛围或内心独白
3. 保持角色性格一致
4. 语言要口语化、有画面感
5. 适合配音朗读，节奏感强

【输出格式 JSON】
{
  "dialogue": "改写后的对话（如果原文有对话）",
  "narrator": "改写后的旁白（如果原文有旁白）"
}`;

    const userPrompt = `场景: ${description || ''}
角色: ${speaker || '未知'}
原对话: ${dialogue || '无'}
原旁白: ${narrator || '无'}

请改写得更有影视感和冲击力。`;

    const raw = await callLLM(systemPrompt, userPrompt);
    let parsed;
    try {
      let str = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
      const start = str.indexOf('{');
      const end = str.lastIndexOf('}');
      if (start !== -1 && end > start) str = str.slice(start, end + 1);
      parsed = JSON.parse(str);
    } catch {
      throw new Error('AI 返回格式异常，请重试');
    }

    // 保存到 episode 数据
    if (parsed.dialogue) scene.dialogue = parsed.dialogue;
    if (parsed.narrator) scene.narrator = parsed.narrator;
    db.updateDramaEpisode(ep.id, { result: ep.result });

    res.json({ success: true, data: { dialogue: parsed.dialogue, narrator: parsed.narrator } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════
// POST /api/drama/projects/:pid/episodes/:eid/generate-voice
// 一键配音（调用 TTS 为所有有对话的分镜生成语音）
// ═══════════════════════════════════════════
router.post('/projects/:pid/episodes/:eid/generate-voice', async (req, res) => {
  const ep = db.getDramaEpisode(req.params.eid);
  if (!ep?.result) return res.status(404).json({ success: false, error: '剧集不存在或未完成' });

  try {
    const taskDir = path.join(DRAMA_DIR, ep.id);
    fs.mkdirSync(taskDir, { recursive: true });
    const dramaSvc = require('../services/dramaService');
    const count = await dramaSvc.agentDramaVoice(ep.result.scenes, taskDir);
    db.updateDramaEpisode(ep.id, { result: ep.result });
    res.json({ success: true, data: { count } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
