const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const db = require('../models/database');
const { isAdmin, ownedBy, scopeUserId } = require('../middleware/auth');

// GET /api/works - 聚合所有模块的生成作品（admin 可见全部）
router.get('/', (req, res) => {
  const { type, page = 1, limit = 50 } = req.query;
  const userId = scopeUserId(req);
  const works = [];

  // 1. 数字人视频
  if (!type || type === 'all' || type === 'avatar') {
    const avatarTasks = db.listAvatarTasks(userId);
    for (const t of avatarTasks) {
      if (t.status !== 'done') continue;
      works.push({
        id: t.id,
        type: 'avatar',
        type_label: '数字人',
        title: (t.text || '').slice(0, 30) || '数字人视频',
        preview_url: t.videoUrl || `/api/avatar/tasks/${t.id}/stream`,
        download_url: `/api/avatar/tasks/${t.id}/download`,
        stream_url: `/api/avatar/tasks/${t.id}/stream`,
        media_type: 'video',
        created_at: t.created_at
      });
    }
  }

  // 2. 图生视频
  if (!type || type === 'all' || type === 'i2v') {
    const i2vTasks = db.listI2VTasks(userId);
    for (const t of i2vTasks) {
      if (t.status !== 'completed' && t.status !== 'done') continue;
      works.push({
        id: t.id,
        type: 'i2v',
        type_label: '图生视频',
        title: (t.prompt || '').slice(0, 30) || '图生视频',
        preview_url: `/api/i2v/tasks/${t.id}/stream`,
        download_url: `/api/i2v/tasks/${t.id}/download`,
        stream_url: `/api/i2v/tasks/${t.id}/stream`,
        thumbnail_url: t.image_url,
        media_type: 'video',
        created_at: t.created_at
      });
    }
  }

  // 3. AI 视频项目
  if (!type || type === 'all' || type === 'video') {
    const projects = db.listProjects(userId);
    for (const p of projects) {
      if (p.status !== 'done') continue;
      const finalVideo = db.getFinalVideoByProject(p.id);
      if (!finalVideo?.file_path) continue;
      works.push({
        id: p.id,
        type: 'video',
        type_label: 'AI 视频',
        title: p.title || p.theme || 'AI 视频',
        preview_url: `/api/projects/${p.id}/stream`,
        download_url: `/api/projects/${p.id}/download`,
        stream_url: `/api/projects/${p.id}/stream`,
        media_type: 'video',
        created_at: p.created_at
      });
    }
  }

  // 4. AI 形象
  if (!type || type === 'all' || type === 'portrait') {
    const portraits = db.listPortraits(userId);
    for (const p of portraits) {
      if (p.status !== 'completed' && p.status !== 'done') continue;
      works.push({
        id: p.id,
        type: 'portrait',
        type_label: 'AI 形象',
        title: (p.prompt || '').slice(0, 30) || 'AI 形象',
        preview_url: p.image_url,
        media_type: 'image',
        created_at: p.created_at
      });
    }
  }

  // 5. AI 漫画
  if (!type || type === 'all' || type === 'comic') {
    const comics = db.listComicTasks(userId);
    for (const c of comics) {
      if (c.status !== 'completed' && c.status !== 'done') continue;
      // 漫画数据在 c.result.pages[] 中，取第一页作为缩略图
      const firstPage = c.result?.pages?.[0];
      const totalPanels = (c.result?.pages || []).reduce((sum, p) => sum + (p.panels?.length || 0), 0);
      works.push({
        id: c.id,
        type: 'comic',
        type_label: 'AI 漫画',
        title: c.result?.title || c.title || 'AI 漫画',
        preview_url: firstPage ? `/api/comic/tasks/${c.id}/pages/1` : '',
        media_type: 'image',
        pages: c.result?.pages?.length || 0,
        panels: totalPanels,
        created_at: c.created_at
      });
    }
  }

  // 6. AI 网剧
  if (!type || type === 'all' || type === 'drama') {
    const dramaProjects = db.listDramaProjects(userId);
    for (const p of dramaProjects) {
      const episodes = db.listDramaEpisodes(p.id);
      const doneEps = episodes.filter(e => e.status === 'done');
      works.push({
        id: p.id,
        type: 'drama',
        type_label: 'AI 网剧',
        title: p.title || 'AI 网剧',
        preview_url: p.cover_url || '',
        media_type: 'image',
        episodes_total: episodes.length,
        episodes_done: doneEps.length,
        created_at: p.created_at
      });
    }
  }

  // 7. AI 小说
  if (!type || type === 'all' || type === 'novel') {
    const novels = db.listNovels(userId);
    for (const n of novels) {
      // 内容来源：top-level content 或 chapters 拼接
      const chapterText = (n.chapters || []).map(c => c.content || '').join('\n').trim();
      const novelContent = n.content || chapterText;
      if (!novelContent) continue;
      works.push({
        id: n.id,
        type: 'novel',
        type_label: 'AI 小说',
        title: n.title || 'AI 小说',
        preview_text: novelContent.slice(0, 100),
        media_type: 'text',
        word_count: n.total_words || novelContent.length,
        created_at: n.created_at
      });
    }
  }

  // 按时间倒序
  works.sort((a, b) => b.created_at.localeCompare(a.created_at));

  // 分页
  const start = (parseInt(page) - 1) * parseInt(limit);
  const paged = works.slice(start, start + parseInt(limit));

  res.json({
    success: true,
    works: paged,
    total: works.length,
    page: parseInt(page),
    limit: parseInt(limit)
  });
});

// DELETE /api/works/:type/:id - 删除指定作品（须为所有者或 admin）
router.delete('/:type/:id', (req, res) => {
  const { type, id } = req.params;
  try {
    // 先取原始数据做所有权校验
    const fetchers = {
      avatar: db.getAvatarTask,
      i2v: db.getI2VTask,
      video: db.getProject,
      portrait: db.getPortrait,
      comic: db.getComicTask,
      drama: db.getDramaProject,
      novel: db.getNovel,
    };
    const fetch = fetchers[type];
    if (!fetch) return res.status(400).json({ success: false, error: '未知类型' });
    const row = fetch.call(db, id);
    if (!row || !ownedBy(req, row)) return res.status(404).json({ success: false, error: '作品不存在' });
    switch (type) {
      case 'avatar': db.deleteAvatarTask(id); break;
      case 'i2v': db.deleteI2VTask(id); break;
      case 'video': db.deleteProject(id); break;
      case 'portrait': db.deletePortrait(id); break;
      case 'comic': db.deleteComicTask(id); break;
      case 'drama': db.deleteDramaProject(id); break;
      case 'novel': db.deleteNovel(id); break;
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/works/stats - 作品统计（只统计当前用户；admin 看全部）
router.get('/stats', (req, res) => {
  const userId = scopeUserId(req);
  res.json({
    success: true,
    stats: {
      avatar: db.listAvatarTasks(userId).filter(t => t.status === 'done').length,
      i2v: db.listI2VTasks(userId).filter(t => t.status === 'completed' || t.status === 'done').length,
      video: db.listProjects(userId).filter(p => p.status === 'done').length,
      portrait: db.listPortraits(userId).filter(p => p.status === 'completed' || p.status === 'done').length,
      comic: db.listComicTasks(userId).filter(c => c.status === 'completed' || c.status === 'done').length,
      novel: db.listNovels(userId).filter(n => !!n.content).length
    }
  });
});

module.exports = router;
