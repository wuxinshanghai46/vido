import { getDb } from "./index.js";

/** 批量保存视频数据到 douyin_videos + video_snapshots */
export function saveVideosToDB(videos: any[]): void {
  const db = getDb();
  const insertVideo = db.prepare(`INSERT OR REPLACE INTO douyin_videos (id, title, description, url, thumbnail, duration, like_count, comment_count, share_count, collect_count, uploader, uploader_id, uploader_avatar, upload_date, video_url, view_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertSnapshot = db.prepare(`INSERT INTO video_snapshots (video_id, like_count, comment_count, share_count, collect_count, view_count) VALUES (?, ?, ?, ?, ?, ?)`);
  db.transaction(() => {
    for (const v of videos) {
      insertVideo.run(v.id, v.title||'', v.description||v.title||'', v.url||'', v.thumbnail||'', v.duration||0, v.like_count||0, v.comment_count||0, v.repost_count||v.share_count||0, v.collect_count||0, v.uploader||'', v.uploader_id||'', v.uploader_avatar||'', v.upload_date||'', v.video_url||'', v.view_count||0);
      insertSnapshot.run(v.id, v.like_count||0, v.comment_count||0, v.repost_count||v.share_count||0, v.collect_count||0, v.view_count||0);
    }
  })();
}
