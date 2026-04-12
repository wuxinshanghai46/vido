const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../models/database');
const novelService = require('../services/novelService');
const { deductCredits } = require('../middleware/credits');
const { ownedBy, scopeUserId } = require('../middleware/auth');
const orchestrator = require('../services/agentOrchestrator');

function getOwnedNovel(req, res, id) {
  const novel = db.getNovel(id);
  if (!novel || !ownedBy(req, novel)) { res.status(404).json({ success: false, error: '小说不存在' }); return null; }
  return novel;
}

// 获取可用模型
router.get('/models', (req, res) => {
  try {
    const models = novelService.getAvailableModels();
    res.json({ success: true, models });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 小说列表
router.get('/', (req, res) => {
  try {
    const novels = db.listNovels(scopeUserId(req));
    res.json({ success: true, novels });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 小说详情
router.get('/:id', (req, res) => {
  const novel = getOwnedNovel(req, res, req.params.id);
  if (!novel) return;
  res.json({ success: true, novel });
});

// 创建小说
router.post('/', (req, res) => {
  try {
    const { title, genre = 'fantasy', style = 'descriptive', novel_type = 'short', chapter_count = 10, chapter_words = 2000, description = '', provider } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ success: false, error: '请输入小说标题' });
    const novel = {
      id: uuidv4(),
      user_id: req.user?.id,
      title: title.trim(),
      genre,
      style,
      novel_type,
      description,
      chapter_count: parseInt(chapter_count) || 10,
      chapter_words: parseInt(chapter_words) || 2000,
      provider: provider || null,
      outline: null,
      chapters: [],
      total_words: 0,
      status: 'draft',
      created_at: new Date().toISOString()
    };
    db.insertNovel(novel);
    res.json({ success: true, novel });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 更新小说
router.put('/:id', (req, res) => {
  try {
    const novel = getOwnedNovel(req, res, req.params.id);
    if (!novel) return;
    const { title, genre, style, novel_type, chapter_count, chapter_words, chapters, outline, description, provider } = req.body;
    const fields = {};
    if (title !== undefined) fields.title = title;
    if (genre !== undefined) fields.genre = genre;
    if (style !== undefined) fields.style = style;
    if (novel_type !== undefined) fields.novel_type = novel_type;
    if (description !== undefined) fields.description = description;
    if (provider !== undefined) fields.provider = provider;
    if (chapter_count !== undefined) fields.chapter_count = parseInt(chapter_count);
    if (chapter_words !== undefined) fields.chapter_words = parseInt(chapter_words);
    if (chapters !== undefined) {
      fields.chapters = chapters;
      fields.total_words = chapters.reduce((sum, c) => sum + (c.word_count || 0), 0);
    }
    if (outline !== undefined) fields.outline = outline;
    db.updateNovel(req.params.id, fields);
    res.json({ success: true, novel: db.getNovel(req.params.id) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 删除小说
router.delete('/:id', (req, res) => {
  try {
    if (!getOwnedNovel(req, res, req.params.id)) return;
    db.deleteNovel(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 生成大纲
router.post('/:id/generate-outline', async (req, res) => {
  try {
    const novel = getOwnedNovel(req, res, req.params.id);
    if (!novel) return;
    db.updateNovel(req.params.id, { status: 'generating' });
    deductCredits(req.user?.id, 'novel_outline', `生成大纲: ${novel.title}`);

    // 先跑小说工作流分析
    let workflowAnalysis = null;
    try {
      const wfResult = await orchestrator.runWorkflow(
        `小说标题: ${novel.title}\n类型: ${novel.genre || '通用'}\n风格: ${novel.style || '默认'}\n章节数: ${novel.chapter_count || 10}`,
        { taskType: 'business', workflowName: 'novel' }
      );
      workflowAnalysis = wfResult;
      console.log(`[Novel] 工作流完成 (${wfResult.total_agents_involved} agent / ${(wfResult.total_duration_ms/1000).toFixed(0)}s)`);
    } catch (wfErr) {
      console.warn('[Novel] orchestrator workflow failed (non-fatal):', wfErr.message);
    }

    const outline = await novelService.generateOutline({
      title: novel.title,
      genre: novel.genre,
      style: novel.style,
      chapterCount: novel.chapter_count,
      description: novel.description,
      provider: novel.provider,
      novelType: novel.novel_type || 'short'
    });
    db.updateNovel(req.params.id, { outline, status: 'draft' });
    res.json({ success: true, outline });
  } catch (e) {
    db.updateNovel(req.params.id, { status: 'draft' });
    res.status(500).json({ success: false, error: e.message });
  }
});

// SSE 流式生成章节
router.get('/:id/generate-chapter-stream', async (req, res) => {
  const novel = getOwnedNovel(req, res, req.params.id);
  if (!novel) return;
  if (!novel.outline) return res.status(400).json({ error: '请先生成大纲' });

  const chapterIndex = parseInt(req.query.chapter);
  if (!chapterIndex) return res.status(400).json({ error: '缺少 chapter 参数' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  try {
    db.updateNovel(req.params.id, { status: 'generating' });
    deductCredits(req.user?.id, 'novel_chapter', `生成章节: 第${chapterIndex}章`);
    const chapterInfo = novel.outline.chapters.find(c => c.index === chapterIndex);
    const fullText = await novelService.generateChapterStream({
      outline: novel.outline,
      chapterIndex,
      chapters: novel.chapters || [],
      genre: novel.genre,
      style: novel.style,
      chapterWords: novel.chapter_words,
      provider: novel.provider,
      novelType: novel.novel_type || 'short'
    }, (chunk) => {
      res.write(`data: ${JSON.stringify({ type: 'chunk', text: chunk })}\n\n`);
    });

    // 保存章节
    const chapters = [...(novel.chapters || [])];
    const existing = chapters.findIndex(c => c.index === chapterIndex);
    const chapterData = {
      index: chapterIndex,
      title: chapterInfo?.title || `第${chapterIndex}章`,
      content: fullText,
      word_count: fullText.length,
      status: 'done'
    };
    if (existing >= 0) chapters[existing] = chapterData;
    else chapters.push(chapterData);
    chapters.sort((a, b) => a.index - b.index);

    const totalWords = chapters.reduce((s, c) => s + (c.word_count || 0), 0);
    db.updateNovel(req.params.id, { chapters, total_words: totalWords, status: 'draft' });

    res.write(`data: ${JSON.stringify({ type: 'done', chapter: chapterData, total_words: totalWords })}\n\n`);
  } catch (e) {
    db.updateNovel(req.params.id, { status: 'draft' });
    res.write(`data: ${JSON.stringify({ type: 'error', message: e.message })}\n\n`);
  }
  res.end();
});

// SSE 流式优化文本
router.get('/:id/refine-stream', async (req, res) => {
  const novel = getOwnedNovel(req, res, req.params.id);
  if (!novel) return;

  const instruction = req.query.instruction;
  const text = req.query.text;
  if (!text || !instruction) return res.status(400).json({ error: '缺少 text 或 instruction 参数' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  try {
    const fullText = await novelService.refineTextStream({
      text: decodeURIComponent(text),
      instruction: decodeURIComponent(instruction),
      genre: novel.genre,
      style: novel.style,
      provider: novel.provider
    }, (chunk) => {
      res.write(`data: ${JSON.stringify({ type: 'chunk', text: chunk })}\n\n`);
    });
    res.write(`data: ${JSON.stringify({ type: 'done', text: fullText })}\n\n`);
  } catch (e) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: e.message })}\n\n`);
  }
  res.end();
});

// 导出小说
router.get('/:id/export', (req, res) => {
  const novel = getOwnedNovel(req, res, req.params.id);
  if (!novel) return;

  let content = `# ${novel.title}\n\n`;
  if (novel.outline?.synopsis) content += `> ${novel.outline.synopsis}\n\n---\n\n`;
  for (const ch of (novel.chapters || []).sort((a, b) => a.index - b.index)) {
    content += `## 第${ch.index}章 ${ch.title}\n\n${ch.content}\n\n---\n\n`;
  }

  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(novel.title)}.md"`);
  res.send(content);
});

module.exports = router;
