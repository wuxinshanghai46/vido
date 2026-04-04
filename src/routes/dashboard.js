const express = require('express');
const router = express.Router();
const db = require('../models/database');
const { loadSettings } = require('../services/settingsService');

// ---------- helpers ----------

function isToday(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
         d.getMonth() === now.getMonth() &&
         d.getDate() === now.getDate();
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}天前`;
  const mon = Math.floor(day / 30);
  if (mon < 12) return `${mon}个月前`;
  return `${Math.floor(mon / 12)}年前`;
}

// ---------- GET /api/dashboard/stats ----------

router.get('/stats', (req, res) => {
  try {
    const projects    = db.listProjects();
    const avatars     = db.listAvatarTasks();
    const comics      = db.listComicTasks();
    const portraits   = db.listPortraits();
    const novels      = db.listNovels();

    res.json({
      success: true,
      data: {
        today_videos:   projects.filter(p => isToday(p.created_at)).length,
        today_avatars:  avatars.filter(a => isToday(a.created_at)).length,
        today_novels:   novels.filter(n => isToday(n.created_at)).length,
        total_projects: projects.length,
        total_avatars:  avatars.length,
        total_novels:   novels.length,
        total_comics:   comics.length,
        total_portraits: portraits.length
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------- GET /api/dashboard/recent-tasks ----------

router.get('/recent-tasks', (req, res) => {
  try {
    const merged = [];

    for (const p of db.listProjects()) {
      merged.push({
        id: p.id,
        title: p.title || p.theme || 'AI 视频',
        type: 'AI视频',
        status: p.status,
        error: p.error || p.error_message || '',
        created_at: p.created_at
      });
    }

    for (const t of db.listAvatarTasks()) {
      merged.push({
        id: t.id,
        title: (t.text || '').slice(0, 30) || '数字人视频',
        type: '数字人',
        status: t.status,
        error: t.error || '',
        created_at: t.created_at
      });
    }

    for (const c of db.listComicTasks()) {
      merged.push({
        id: c.id,
        title: c.title || 'AI 漫画',
        type: 'AI漫画',
        status: c.status,
        error: c.error || '',
        created_at: c.created_at
      });
    }

    for (const p of db.listPortraits()) {
      merged.push({
        id: p.id,
        title: (p.prompt || '').slice(0, 30) || 'AI 图片',
        type: 'AI图片',
        status: p.status,
        error: p.error || '',
        created_at: p.created_at
      });
    }

    for (const n of db.listNovels()) {
      merged.push({
        id: n.id,
        title: n.title || 'AI 小说',
        type: 'AI小说',
        status: n.status,
        error: n.error || '',
        created_at: n.created_at
      });
    }

    for (const t of db.listI2VTasks()) {
      merged.push({
        id: t.id,
        title: (t.prompt || '').slice(0, 30) || '图生视频',
        type: '图生视频',
        status: t.status,
        error: t.error || '',
        created_at: t.created_at
      });
    }

    merged.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    const top10 = merged.slice(0, 10).map(t => ({
      ...t,
      time_ago: timeAgo(t.created_at)
    }));

    res.json({ success: true, tasks: top10 });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------- GET /api/dashboard/model-status ----------

router.get('/model-status', (req, res) => {
  try {
    const settings = loadSettings();
    const providers = settings.providers || [];
    const result = [];

    for (const prov of providers) {
      // Determine provider types from its models' use field
      const types = new Set();
      for (const m of (prov.models || [])) {
        if (m.use) types.add(m.use);
      }
      // If no models or no use tags, infer a generic type
      if (types.size === 0) types.add('other');

      for (const type of types) {
        result.push({
          name: prov.name || prov.id,
          type,
          enabled: prov.enabled !== false,
          hasKey: !!(prov.api_key)
        });
      }
    }

    res.json({ success: true, models: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
