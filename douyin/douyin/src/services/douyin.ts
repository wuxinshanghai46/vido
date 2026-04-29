import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, join } from "node:path";
import { mkdirSync, statSync } from "node:fs";
import { getConfig } from "../config.js";

const execFileAsync = promisify(execFile);

/** 下载进度追踪 */
export const downloadProgressMap = new Map<string, { downloaded: number; total: number; progress: number }>();

export interface DouyinVideoInfo {
  id: string;
  title: string;
  description: string;
  url: string;
  thumbnail: string;
  duration: number;
  like_count: number;
  comment_count: number;
  share_count: number;
  collect_count: number;
  view_count: number;
  upload_date: string;
  uploader: string;
  uploader_id: string;
  uploader_url: string;
  uploader_avatar: string;
  video_url: string;
}

export interface DouyinUserInfo {
  id: string;
  name: string;
  url: string;
  avatar: string;
  sec_uid: string;
}

const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1";

/** 从分享文本中提取 URL */
export function extractUrl(shareText: string): string | null {
  const match = shareText.match(/https?:\/\/[^\s]+/);
  return match ? match[0] : null;
}

/** 跟随短链接重定向，提取视频 ID */
async function resolveVideoId(url: string): Promise<string> {
  const resp = await fetch(url, {
    method: "GET",
    headers: { "User-Agent": MOBILE_UA },
    redirect: "follow",
  });
  const finalUrl = resp.url;

  const m1 = finalUrl.match(/\/video\/(\d+)/);
  if (m1) return m1[1];
  const m2 = finalUrl.match(/\/note\/(\d+)/);
  if (m2) return m2[1];

  throw new Error(`无法从 URL 中提取视频 ID: ${finalUrl}`);
}

/** 通过 iesdouyin 分享页面获取视频信息 */
export async function getVideoInfo(shareUrl: string): Promise<DouyinVideoInfo> {
  const videoId = await resolveVideoId(shareUrl);

  // 请求 iesdouyin 分享页面（返回带 SSR 数据的 HTML）
  const pageUrl = `https://www.iesdouyin.com/share/video/${videoId}/`;
  const resp = await fetch(pageUrl, {
    headers: { "User-Agent": MOBILE_UA },
  });
  const html = await resp.text();

  // 从 window._ROUTER_DATA 提取 JSON
  const routerMatch = html.match(/window\._ROUTER_DATA\s*=\s*(\{.+?\})\s*<\/script>/s);
  if (!routerMatch) {
    throw new Error("无法解析抖音页面数据");
  }

  const routerData = JSON.parse(routerMatch[1]);

  // 查找 videoInfoRes
  let item: any = null;
  for (const key of Object.keys(routerData.loaderData || {})) {
    const val = routerData.loaderData[key];
    if (val?.videoInfoRes?.item_list?.[0]) {
      item = val.videoInfoRes.item_list[0];
      break;
    }
  }

  if (!item) {
    throw new Error("未找到视频数据，可能视频已被删除或不可见");
  }

  const stats = item.statistics || {};
  const author = item.author || {};
  const video = item.video || {};

  return {
    id: item.aweme_id || videoId,
    title: item.desc || "",
    description: item.desc || "",
    url: `https://www.douyin.com/video/${item.aweme_id || videoId}`,
    thumbnail: video.cover?.url_list?.[0] || "",
    duration: Math.round((video.duration || 0) / 1000),
    like_count: stats.digg_count || 0,
    comment_count: stats.comment_count || 0,
    share_count: stats.share_count || 0,
    collect_count: stats.collect_count || 0,
    view_count: stats.play_count || 0,
    upload_date: item.create_time
      ? new Date(item.create_time * 1000).toISOString().slice(0, 10).replace(/-/g, "")
      : "",
    uploader: author.nickname || "",
    uploader_id: author.unique_id || author.short_id || "",
    uploader_url: author.sec_uid
      ? `https://www.douyin.com/user/${author.sec_uid}`
      : "",
    uploader_avatar: author.avatar_thumb?.url_list?.[0] || "",
    video_url: video.play_addr?.url_list?.[0] || "",
  };
}

/** 下载视频到本地（通过直链或从 iesdouyin 获取直链） */
export async function downloadVideo(url: string, videoId: string, directPlayUrl?: string): Promise<string> {
  const config = getConfig();
  const dir = resolve(config.server.uploadDir, "douyin");
  mkdirSync(dir, { recursive: true });
  const outputPath = join(dir, `${videoId}.mp4`);

  // 先检查文件是否已存在
  try { statSync(outputPath); return outputPath; } catch {}

  // 确定下载地址
  let playUrl = directPlayUrl;
  if (!playUrl) {
    const info = await getVideoInfo(url);
    playUrl = info.video_url;
  }
  if (!playUrl) {
    throw new Error("无法获取视频下载地址");
  }

  console.log(`[Douyin] 下载视频: ${videoId}`);

  // 通过直链下载视频（流式，支持进度回调）
  const resp = await fetch(playUrl, {
    headers: {
      "User-Agent": MOBILE_UA,
      "Referer": "https://www.douyin.com/",
    },
    redirect: "follow",
  });

  if (!resp.ok) {
    throw new Error(`视频下载失败 (${resp.status})`);
  }

  const contentLength = parseInt(resp.headers.get("content-length") || "0");
  const { createWriteStream } = await import("node:fs");
  const { Readable } = await import("node:stream");
  const { pipeline } = await import("node:stream/promises");

  let downloaded = 0;
  const body = resp.body;
  if (!body) throw new Error("响应无 body");

  const writer = createWriteStream(outputPath);
  const reader = Readable.fromWeb(body as any);

  reader.on("data", (chunk: Buffer) => {
    downloaded += chunk.length;
    if (contentLength > 0) {
      const progress = Math.round(downloaded / contentLength * 100);
      downloadProgressMap.set(videoId, { downloaded, total: contentLength, progress });
    }
  });

  await pipeline(reader, writer);
  downloadProgressMap.delete(videoId);

  const finalSize = downloaded;
  console.log(`[Douyin] 下载完成: ${outputPath} (${(finalSize / 1024 / 1024).toFixed(1)}MB)`);
  return outputPath;
}

/** 获取用户的视频列表 */
export async function getUserVideos(userUrl: string): Promise<DouyinVideoInfo[]> {
  const args = ["--flat-playlist", "-j", "--no-download"];

  const cookieFile = resolve("data/douyin_cookies.txt");
  try {
    statSync(cookieFile);
    args.push("--cookies", cookieFile);
  } catch {}

  args.push(userUrl);

  const { stdout } = await execFileAsync("yt-dlp", args, {
    maxBuffer: 50 * 1024 * 1024,
    timeout: 120000,
  });

  const lines = stdout.trim().split("\n").filter(Boolean);
  return lines.map((line) => {
    const data = JSON.parse(line);
    return {
      id: data.id || "",
      title: data.title || "",
      description: data.description || "",
      url: data.webpage_url || data.url || "",
      thumbnail: data.thumbnail || "",
      duration: data.duration || 0,
      like_count: data.like_count || 0,
      comment_count: data.comment_count || 0,
      share_count: data.repost_count || 0,
      collect_count: 0,
      view_count: data.view_count || 0,
      upload_date: data.upload_date || "",
      uploader: data.uploader || data.channel || "",
      uploader_id: data.uploader_id || data.channel_id || "",
      uploader_url: data.uploader_url || data.channel_url || "",
      uploader_avatar: "",
      video_url: "",
    };
  });
}
