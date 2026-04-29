/**
 * 关键字订阅调度器
 *
 * 启动时初始化 setInterval（每 10 分钟检查一次），扫描所有 enabled 订阅，
 * 满足下次执行时间则调用 searchProviders.searchAll，新视频对比已抓取过的入库。
 *
 * 订阅记录字段：
 *   id, user_id, keyword, providers[], interval_minutes(默认 60),
 *   last_run_at, next_run_at, last_count, total_new, enabled
 */
const db = require('../models/database');
const searchProviders = require('./searchProviders');
const { v4: uuidv4 } = require('uuid');

let timer = null;

async function runOne(sub) {
  const startTs = Date.now();
  console.log(`[SubScheduler] 跑订阅 ${sub.id} keyword="${sub.keyword}"`);
  let newCount = 0;
  try {
    const r = await searchProviders.searchAll({ keyword: sub.keyword, limit: 24 });
    const userContents = db.listContents(sub.user_id);
    const seenIds = new Set(userContents.map(c => c.id));
    const seenUrls = new Set(userContents.map(c => c.video_url).filter(Boolean));

    for (const item of (r.results || [])) {
      // 简单去重：URL + provider id
      if (item.video_url && seenUrls.has(item.video_url)) continue;
      // 落库到 contents（标记为订阅来源）
      const cid = uuidv4();
      try {
        db.insertContent({
          id: cid,
          user_id: sub.user_id,
          video_url: item.video_url || '',
          platform: item.platform,
          platform_name: item.platform_name,
          title: item.title || '',
          transcript: item.transcript || '',
          tags: item.tags || [],
          author: item.author || '',
          subscription_id: sub.id,
          subscription_keyword: sub.keyword,
          search_source: item.source,
          views: item.views || 0,
          likes: item.likes || 0,
          cover: item.cover || '',
          status: 'pending',
          crawled: false,
        });
        newCount++;
      } catch (e) {
        console.warn('[SubScheduler] insert content failed:', e.message);
      }
    }
  } catch (e) {
    console.warn(`[SubScheduler] sub ${sub.id} failed:`, e.message);
    db.updateSubscription(sub.id, { last_error: e.message });
  }

  const interval = (sub.interval_minutes || 60) * 60 * 1000;
  db.updateSubscription(sub.id, {
    last_run_at: new Date().toISOString(),
    next_run_at: new Date(Date.now() + interval).toISOString(),
    last_count: newCount,
    total_new: (sub.total_new || 0) + newCount,
    last_error: null,
  });
  console.log(`[SubScheduler] 订阅 ${sub.id} 完成 · 新增 ${newCount} 条 · 用时 ${Date.now() - startTs}ms`);
  return newCount;
}

async function tick() {
  try {
    const subs = db.listAllSubscriptions().filter(s => s.enabled !== false);
    const now = Date.now();
    for (const sub of subs) {
      const next = sub.next_run_at ? new Date(sub.next_run_at).getTime() : 0;
      if (now >= next) {
        await runOne(sub);
      }
    }
  } catch (e) {
    console.warn('[SubScheduler] tick error:', e.message);
  }
}

function start() {
  if (timer) return;
  // 启动 30 秒后第一次跑，之后每 10 分钟一次
  setTimeout(tick, 30 * 1000);
  timer = setInterval(tick, 10 * 60 * 1000);
  console.log('[SubScheduler] 已启动，每 10 分钟轮询一次订阅');
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, runOne, tick };
