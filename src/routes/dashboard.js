const express = require('express');
const router = express.Router();
const db = require('../models/database');
const storyAdStorage = require('../services/newStoryAd/storageService');
const { loadSettings } = require('../services/settingsService');
const { scopeUserId } = require('../middleware/auth');

const DONE = new Set(['done', 'completed', 'success', 'published']);
const ACTIVE = new Set(['running', 'processing', 'generating', 'working', 'queued', 'pending']);
const FAILED = new Set(['failed', 'error', 'cancelled', 'timeout']);

function validDate(value) {
  const date = new Date(value || 0);
  return Number.isFinite(date.getTime()) ? date : new Date(0);
}

function isToday(value) {
  const date = validDate(value);
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

function timeAgo(value) {
  const seconds = Math.max(0, Math.floor((Date.now() - validDate(value).getTime()) / 1000));
  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  if (seconds < 2592000) return `${Math.floor(seconds / 86400)} 天前`;
  return validDate(value).toLocaleDateString('zh-CN');
}

function statusGroup(status) {
  const value = String(status || '').toLowerCase();
  if (DONE.has(value)) return 'completed';
  if (FAILED.has(value)) return 'failed';
  if (ACTIVE.has(value)) return 'active';
  return 'draft';
}

function storyAdStep(stage) {
  const value = String(stage || 'draft');
  if (/final|compose|video|tts/.test(value)) return 5;
  if (/keyframe/.test(value)) return 4;
  if (/storyboard|blueprint/.test(value)) return 3;
  if (/scene/.test(value)) return 2;
  return 1;
}

function storyAdView(stage) {
  const value = String(stage || 'draft').toLowerCase();
  if (/final|compose|video|tts/.test(value)) return 'final';
  if (/keyframe|shot/.test(value)) return 'shots';
  if (/storyboard/.test(value)) return 'storyboard';
  if (/blueprint|script|plot/.test(value)) return 'plot';
  if (/scene|asset|character|product/.test(value)) return 'assets';
  return 'brief';
}

function task(record, options) {
  const updatedAt = record.updated_at || record.created_at || '';
  const group = statusGroup(record.status);
  return {
    id: String(record.id || ''), title: /\?{3,}/.test(String(options.title || '')) ? `${options.type}项目` : options.title, type: options.type,
    module: options.module, icon: options.icon, status: record.status || 'draft',
    status_group: group, stage: options.stage || record.stage || '', progress: Number(record.progress || 0),
    error: group === 'failed' ? '生成未完成，请进入项目查看失败原因并继续处理' : '',
    resume_url: options.resumeUrl, created_at: record.created_at || updatedAt,
    updated_at: updatedAt, time_ago: timeAgo(updatedAt), retryable: record.retryable === true
  };
}

function stageLabel(item) {
  if (item.status_group === 'failed') return '需要处理';
  const stage = String(item.stage || '').toLowerCase();
  if (item.module === 'new-story-ad') {
    const labels = ['广告需求', '场景配置', '剧本与分镜', '画面生成', '广告合成'];
    return labels[storyAdStep(stage) - 1];
  }
  if (/final|compose|export/.test(stage)) return '合成导出';
  if (/voice|audio|tts|subtitle/.test(stage)) return '配音与字幕';
  if (/video|motion|animate/.test(stage)) return '视频生成';
  if (/image|frame|visual|scene/.test(stage)) return '画面生成';
  if (/story|script|outline|chapter/.test(stage)) return '内容创作';
  if (item.status_group === 'active') return '正在生成';
  return '等待继续';
}

function cleanTitle(value, fallback) {
  const title = String(value || '').replace(/\s+/g, ' ').trim();
  if (!title || /\?{3,}/.test(title)) return fallback;
  return title.slice(0, 80);
}

function firstRelativeUrl(...values) {
  for (const value of values) {
    const raw = String(value || '').trim();
    if (!raw) continue;
    if (raw.startsWith('/')) return raw;
    try {
      const parsed = new URL(raw);
      if (['localhost', '127.0.0.1', '119.29.128.12'].includes(parsed.hostname)) return `${parsed.pathname}${parsed.search}`;
      return raw;
    } catch { /* 不是 URL 时继续检查下一个候选 */ }
  }
  return '';
}

function videoItem(record, options) {
  const updatedAt = options.updatedAt || record.updated_at || record.finished_at || record.created_at || '';
  return {
    id: `${options.module}:${record.id}`,
    task_id: String(record.id || ''),
    title: cleanTitle(options.title, `${options.type}作品`),
    type: options.type,
    module: options.module,
    video_url: options.videoUrl,
    thumbnail_url: options.thumbnailUrl || '',
    duration: Math.max(0, Number(options.duration || record.duration || 0)),
    aspect_ratio: options.aspectRatio || record.aspect_ratio || record.ratio || '',
    resume_url: options.resumeUrl || '',
    created_at: record.created_at || updatedAt,
    updated_at: updatedAt,
    time_ago: timeAgo(updatedAt)
  };
}

function collectVideos({ projects, avatars, i2v, storyAds }) {
  const videos = [];
  const paths = new Set();
  const add = (key, item) => {
    if (!item.video_url || paths.has(key || item.video_url)) return;
    paths.add(key || item.video_url);
    videos.push(item);
  };

  projects.forEach(project => {
    const finalVideo = db.getFinalVideoByProject(project.id);
    if (!finalVideo || statusGroup(finalVideo.status) !== 'completed' || !finalVideo.file_path) return;
    add(finalVideo.file_path, videoItem(project, {
      module: 'create', type: '视频动漫', title: project.title || project.theme,
      videoUrl: `/api/showcase/stream/${encodeURIComponent(`v:${project.id}`)}`,
      duration: finalVideo.duration || project.duration,
      aspectRatio: project.aspect_ratio,
      updatedAt: finalVideo.created_at || project.updated_at,
      resumeUrl: `/?page=projects&project=${encodeURIComponent(project.id)}`
    }));
  });

  avatars.forEach(record => {
    if (statusGroup(record.status) !== 'completed') return;
    const videoUrl = record.videoPath
      ? `/api/avatar/tasks/${encodeURIComponent(record.id)}/stream`
      : firstRelativeUrl(record.videoUrl, record.video_url);
    if (!videoUrl) return;
    add(record.videoPath || videoUrl, videoItem(record, {
      module: 'avatar', type: '数字人', title: record.title || record.text,
      videoUrl,
      thumbnailUrl: firstRelativeUrl(record.thumbnail_url, record.imageUrl, record.image_url),
      aspectRatio: record.ratio,
      updatedAt: record.finished_at || record.updated_at,
      resumeUrl: '/digital-human'
    }));
  });

  i2v.forEach(record => {
    if (statusGroup(record.status) !== 'completed' || !record.file_path) return;
    add(record.file_path, videoItem(record, {
      module: 'i2v', type: '图生视频', title: record.title || record.prompt,
      videoUrl: `/api/i2v/tasks/${encodeURIComponent(record.id)}/stream`,
      thumbnailUrl: firstRelativeUrl(record.image_url, record.resolved_image_url),
      duration: record.duration,
      aspectRatio: record.aspect_ratio,
      resumeUrl: '/?page=works'
    }));
  });

  storyAds.forEach(record => {
    if (statusGroup(record.status) !== 'completed') return;
    const finalVideo = storyAdStorage.getOutput(record.id, 'final_video') || {};
    const keyframes = storyAdStorage.getOutput(record.id, 'keyframes') || [];
    const firstFrame = Array.isArray(keyframes) ? keyframes.find(frame => frame?.image_url || frame?.imageUrl || frame?.url) : null;
    const videoUrl = firstRelativeUrl(finalVideo.video_url, finalVideo.videoUrl, finalVideo.url);
    if (!videoUrl) return;
    add(finalVideo.file_path || videoUrl, videoItem(record, {
      module: 'new-story-ad', type: '剧情广告', title: record.title || record.brief,
      videoUrl,
      thumbnailUrl: firstRelativeUrl(firstFrame?.image_url, firstFrame?.imageUrl, firstFrame?.url),
      duration: finalVideo.duration || record.duration,
      aspectRatio: record.aspect_ratio || record.ratio,
      updatedAt: finalVideo.created_at || record.updated_at,
      resumeUrl: `/story-ad/projects/${encodeURIComponent(record.id)}?view=final`
    }));
  });

  videos.sort((a, b) => validDate(b.updated_at) - validDate(a.updated_at));
  return videos.slice(0, 60);
}

function getDashboardData(req) {
  const uid = scopeUserId(req);
  const rows = [];
  const projects = db.listProjects(uid);
  const avatars = db.listAvatarTasks(uid).filter(x => !x.hidden && !x.superseded_by);
  const comics = db.listComicTasks(uid);
  const portraits = db.listPortraits(uid);
  const novels = db.listNovels(uid).filter(x => !x.deleted_at && x.status !== 'deleted');
  const i2v = db.listI2VTasks(uid);
  const storyAds = storyAdStorage.listTasks({ limit: 200, userId: uid });

  projects.forEach(x => rows.push(task(x, { title: x.title || x.theme || 'AI 视频项目', type: '视频动漫', module: 'create', icon: '🎬', resumeUrl: `/?page=projects&project=${encodeURIComponent(x.id)}` })));
  avatars.forEach(x => rows.push(task(x, { title: String(x.title || x.text || '广告 / 数字人').slice(0, 48), type: '广告 / 数字人', module: 'avatar', icon: '🧑‍💼', resumeUrl: '/digital-human' })));
  comics.forEach(x => rows.push(task(x, { title: x.title || '漫画项目', type: '漫画', module: 'comic', icon: '📚', resumeUrl: '/?page=comic' })));
  portraits.forEach(x => rows.push(task(x, { title: String(x.title || x.prompt || '角色形象').slice(0, 48), type: '角色形象', module: 'portrait', icon: '👤', resumeUrl: '/?page=portrait' })));
  novels.forEach(x => rows.push(task(x, { title: x.title || '小说项目', type: '小说', module: 'novel', icon: '✍️', resumeUrl: `/ai-novel?novel=${encodeURIComponent(x.id)}&panel=write` })));
  i2v.forEach(x => rows.push(task(x, { title: String(x.title || x.prompt || '图生视频').slice(0, 48), type: '图生视频', module: 'i2v', icon: '🎞️', resumeUrl: '/?page=works' })));
  storyAds.forEach(x => rows.push(task(x, { title: x.title || '剧情广告', type: '剧情广告', module: 'new-story-ad', icon: '剧', stage: x.stage, resumeUrl: `/story-ad/projects/${encodeURIComponent(x.id)}?view=${storyAdView(x.stage)}` })));

  rows.forEach(item => { item.stage_label = stageLabel(item); });
  rows.sort((a, b) => validDate(b.updated_at) - validDate(a.updated_at));
  const unfinished = rows.filter(x =>
    x.status_group === 'active' || x.status_group === 'draft' || (x.status_group === 'failed' && x.retryable)
  );
  const videos = collectVideos({ projects, avatars, i2v, storyAds });
  const counts = { total: rows.length, active: 0, completed: 0, failed: 0, draft: 0 };
  rows.forEach(x => { counts[x.status_group] += 1; });
  return {
    stats: {
      ...counts, today_created: rows.filter(x => isToday(x.created_at)).length,
      total_projects: projects.length, total_avatars: avatars.length,
      total_novels: novels.length, total_comics: comics.length,
      total_portraits: portraits.length, total_story_ads: storyAds.length
    },
    tasks: rows.slice(0, 200),
    unfinished_count: unfinished.length,
    unfinished_tasks: unfinished.slice(0, 200),
    continue_tasks: unfinished.slice(0, 200),
    videos,
    attention_tasks: rows.filter(x => x.status_group === 'failed').slice(0, 5)
  };
}

router.get('/summary', (req, res) => {
  try { const data = getDashboardData(req); res.json({ success: true, data: data.stats, tasks: data.tasks, unfinished_count: data.unfinished_count, unfinished_tasks: data.unfinished_tasks, continue_tasks: data.continue_tasks, videos: data.videos, attention_tasks: data.attention_tasks }); }
  catch (err) { res.status(500).json({ success: false, error: '工作台数据加载失败' }); }
});
router.get('/stats', (req, res) => { try { res.json({ success: true, data: getDashboardData(req).stats }); } catch { res.status(500).json({ success: false, error: '统计加载失败' }); } });
router.get('/recent-tasks', (req, res) => { try { res.json({ success: true, tasks: getDashboardData(req).tasks }); } catch { res.status(500).json({ success: false, error: '任务加载失败' }); } });
router.get('/model-status', (req, res) => {
  try {
    const result = [];
    for (const provider of (loadSettings().providers || [])) {
      const types = new Set((provider.models || []).map(model => model.use).filter(Boolean));
      if (!types.size) types.add('other');
      for (const type of types) result.push({ name: provider.name || provider.id, type, enabled: provider.enabled !== false, hasKey: Boolean(provider.api_key) });
    }
    res.json({ success: true, models: result });
  } catch { res.status(500).json({ success: false, error: '模型状态加载失败' }); }
});

module.exports = router;
module.exports._test = { statusGroup, storyAdStep, timeAgo, stageLabel, firstRelativeUrl, collectVideos };
