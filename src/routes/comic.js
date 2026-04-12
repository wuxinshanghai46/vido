/**
 * 漫画生成 API 路由
 */
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../models/database');
const { generateComic, COMIC_DIR } = require('../services/comicService');
const orchestrator = require('../services/agentOrchestrator');
const { ownedBy, scopeUserId } = require('../middleware/auth');

// SSE 进度监听器
const progressListeners = new Map();

function getOwnedComic(req, res, id) {
  const task = db.getComicTask(id);
  if (!task || !ownedBy(req, task)) { res.status(404).json({ success: false, error: '任务不存在' }); return null; }
  return task;
}

// POST /api/comic/ai-story — AI 根据标题生成故事内容
router.post('/ai-story', async (req, res) => {
  try {
    const { title, style } = req.body;
    if (!title) return res.status(400).json({ success: false, error: '请输入标题' });

    const { callLLM } = require('../services/storyService');
    const systemPrompt = `你是一位资深漫画剧情编剧，拥有20年漫画脚本创作经验。你擅长：
- 用简洁有力的文字构建完整的叙事弧线（起承转合）
- 塑造立体的角色形象，赋予独特的性格和动机
- 设计富有张力的冲突和令人意外的转折
- 在200-400字内呈现一个打动人心的故事

根据标题创作漫画故事大纲，200-400字，包含：世界观背景、主要角色（含性格特点）、核心冲突、起承转合。只输出故事内容，不要标题或格式标记。`;
    const userPrompt = `漫画标题：${title}\n画风：${style || '日系动漫'}\n\n请以编剧的专业视角，为这部漫画创作故事内容。注意角色要有鲜明性格，情节要有悬念和转折：`;

    const content = await callLLM(systemPrompt, userPrompt);
    res.json({ success: true, data: { content: content.trim() } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/comic/generate — 启动漫画生成任务
router.post('/generate', async (req, res) => {
  try {
    const { theme, style, pages, panels_per_page, characters, styleId, character_ids } = req.body;
    if (!theme) return res.status(400).json({ success: false, error: '请输入漫画主题' });

    const taskId = uuidv4();
    const task = {
      id: taskId,
      user_id: req.user?.id,
      theme,
      style: style || '日系动漫',
      pages: Math.min(pages || 4, 12),
      panels_per_page: Math.min(panels_per_page || 4, 6),
      characters: characters || [],
      status: 'processing',
      progress: 0,
      message: '初始化...',
      result: null,
      error_message: null
    };

    db.insertComicTask(task);
    res.json({ success: true, data: { id: taskId } });

    // 异步执行（先跑工作流分析，再生成漫画）
    (async () => {
      const updateProgress = (update) => {
        db.updateComicTask(taskId, { progress: update.progress, message: update.message });
        const listener = progressListeners.get(taskId);
        if (listener) listener.write(`data: ${JSON.stringify(update)}\n\n`);
      };

      // Phase A: 跑 orchestrator comic 工作流
      let workflowAnalysis = null;
      try {
        updateProgress({ step: 'workflow', progress: 2, message: '📖 调用漫画工作流分析...' });
        const wfResult = await orchestrator.runWorkflow(`漫画主题: ${theme}\n画风: ${task.style}\n页数: ${task.pages}`, {
          taskType: 'business',
          workflowName: 'comic',
        });
        workflowAnalysis = wfResult;
        updateProgress({ step: 'workflow_done', progress: 8, message: `📖 工作流完成 (${wfResult.total_agents_involved} agent / ${(wfResult.total_duration_ms/1000).toFixed(0)}s)` });
      } catch (wfErr) {
        console.warn('[Comic] orchestrator workflow failed (non-fatal):', wfErr.message);
        updateProgress({ step: 'workflow_skip', progress: 8, message: '⚠️ 工作流分析跳过' });
      }

      // Phase B: 实际生成漫画
      return generateComic(taskId, {
        theme,
        style: task.style,
        pages: task.pages,
        panelsPerPage: task.panels_per_page,
        characters: task.characters,
        styleId: styleId || null,
        character_ids: character_ids || [],
        workflowAnalysis,
      }, updateProgress);
    })().then(result => {
      db.updateComicTask(taskId, { status: 'done', progress: 100, result });
      const listener = progressListeners.get(taskId);
      if (listener) {
        listener.write(`data: ${JSON.stringify({ step: 'done', progress: 100, message: '完成', result })}\n\n`);
        listener.end();
        progressListeners.delete(taskId);
      }
    }).catch(err => {
      console.error('[Comic] 生成失败:', err);
      db.updateComicTask(taskId, { status: 'error', error_message: err.message });
      const listener = progressListeners.get(taskId);
      if (listener) {
        listener.write(`data: ${JSON.stringify({ step: 'error', message: err.message })}\n\n`);
        listener.end();
        progressListeners.delete(taskId);
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/comic/tasks — 任务列表
router.get('/tasks', (req, res) => {
  const tasks = db.listComicTasks(scopeUserId(req));
  res.json({ success: true, data: tasks });
});

// GET /api/comic/tasks/:id — 任务详情
router.get('/tasks/:id', (req, res) => {
  const task = getOwnedComic(req, res, req.params.id);
  if (!task) return;
  res.json({ success: true, data: task });
});

// GET /api/comic/tasks/:id/progress — SSE 进度流
router.get('/tasks/:id/progress', (req, res) => {
  const task = getOwnedComic(req, res, req.params.id);
  if (!task) return;

  if (task.status === 'done' || task.status === 'error') {
    res.json({ success: true, data: task });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.write(`data: ${JSON.stringify({ step: 'init', progress: task.progress || 0, message: task.message || '处理中...' })}\n\n`);

  progressListeners.set(req.params.id, res);
  req.on('close', () => {
    progressListeners.delete(req.params.id);
  });
});

// GET /api/comic/tasks/:id/pages/:pageNum — 获取漫画页面图片
router.get('/tasks/:id/pages/:pageNum', (req, res) => {
  const taskDir = path.join(COMIC_DIR, req.params.id);
  const filePath = path.join(taskDir, `page_${req.params.pageNum}.png`);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.sendFile(filePath);
});

// GET /api/comic/tasks/:id/panels/:filename — 获取单个面板图片
router.get('/tasks/:id/panels/:filename', (req, res) => {
  const taskDir = path.join(COMIC_DIR, req.params.id);
  const filename = path.basename(req.params.filename);
  const filePath = path.join(taskDir, filename);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.sendFile(filePath);
});

// DELETE /api/comic/tasks/:id — 删除任务
router.delete('/tasks/:id', (req, res) => {
  if (!getOwnedComic(req, res, req.params.id)) return;

  // 删除文件
  const taskDir = path.join(COMIC_DIR, req.params.id);
  try { fs.rmSync(taskDir, { recursive: true, force: true }); } catch {}

  db.deleteComicTask(req.params.id);
  res.json({ success: true });
});

module.exports = router;
