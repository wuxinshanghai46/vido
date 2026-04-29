#!/usr/bin/env python3
"""
获取抖音作者的全部视频列表
使用 Playwright + cookies 拦截抖音 API 响应获取完整视频数据
"""

import sys
import json
import argparse
import time
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", type=str, required=True, help="作者主页 URL")
    parser.add_argument("--cookies", type=str, required=True, help="cookies 文件路径")
    parser.add_argument("--limit", type=int, default=0, help="最多获取数量(0=全部)")
    args = parser.parse_args()

    from playwright.sync_api import sync_playwright

    cookies = load_netscape_cookies(args.cookies)
    if not cookies:
        print(json.dumps({"error": "cookies_expired", "message": "无法加载 cookies"}))
        sys.exit(1)

    videos = {}  # id -> video data

    def handle_response(response):
        """拦截抖音 API 响应，提取视频数据"""
        url = response.url
        if "/aweme/v1/web/aweme/post/" not in url and "/aweme/post" not in url:
            return
        try:
            data = response.json()
            aweme_list = data.get("aweme_list", [])
            for item in aweme_list:
                vid = item.get("aweme_id", "")
                if not vid or vid in videos:
                    continue
                stats = item.get("statistics", {})
                author = item.get("author", {})
                video = item.get("video", {})
                cover = video.get("cover", {}) or video.get("origin_cover", {})

                videos[vid] = {
                    "id": vid,
                    "title": item.get("desc", ""),
                    "url": f"https://www.douyin.com/video/{vid}",
                    "thumbnail": (cover.get("url_list") or [""])[0],
                    "duration": round((video.get("duration", 0)) / 1000),
                    "view_count": stats.get("play_count", 0),
                    "like_count": stats.get("digg_count", 0),
                    "comment_count": stats.get("comment_count", 0),
                    "collect_count": stats.get("collect_count", 0),
                    "repost_count": stats.get("share_count", 0),
                    "upload_date": time.strftime("%Y%m%d", time.localtime(item.get("create_time", 0))) if item.get("create_time") else "",
                    "uploader": author.get("nickname", ""),
                    "uploader_id": author.get("unique_id", "") or author.get("short_id", ""),
                    "video_url": (video.get("play_addr", {}).get("url_list") or [""])[0],
                }
            print(f"  API intercepted: +{len(aweme_list)} videos, total: {len(videos)}", file=sys.stderr, flush=True)
        except Exception as e:
            pass  # 非 JSON 响应忽略

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        context.add_cookies(cookies)

        page = context.new_page()
        page.on("response", handle_response)

        print(f"Fetching: {args.url}", file=sys.stderr, flush=True)
        page.goto(args.url)
        page.wait_for_load_state("load", timeout=30000)
        time.sleep(3)

        # 滚动加载更多
        max_scroll = 100 if args.limit == 0 else (args.limit // 18 + 3)
        no_new_count = 0

        for i in range(max_scroll):
            prev_count = len(videos)
            page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            time.sleep(2)

            if args.limit > 0 and len(videos) >= args.limit:
                break

            if len(videos) == prev_count:
                no_new_count += 1
                if no_new_count >= 3:
                    print(f"  No more videos after {i+1} scrolls", file=sys.stderr, flush=True)
                    break
                time.sleep(2)
            else:
                no_new_count = 0
                print(f"  Scroll {i+1}: {len(videos)} videos", file=sys.stderr, flush=True)

        browser.close()

    result = list(videos.values())
    if args.limit > 0:
        result = result[:args.limit]

    # 按发布时间降序排列
    result.sort(key=lambda x: x.get("upload_date", ""), reverse=True)

    print(f"Total: {len(result)} videos", file=sys.stderr, flush=True)
    print(json.dumps(result, ensure_ascii=False))


def load_netscape_cookies(filepath):
    """加载 Netscape 格式 cookies 为 Playwright 格式"""
    cookies = []
    try:
        for line in Path(filepath).read_text().split("\n"):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split("\t")
            if len(parts) < 7:
                continue
            domain, _, path, secure, expires, name, value = parts[0], parts[1], parts[2], parts[3], parts[4], parts[5], parts[6]
            cookies.append({
                "name": name,
                "value": value,
                "domain": domain,
                "path": path,
                "secure": secure == "TRUE",
                "expires": int(expires) if expires.isdigit() else -1,
            })
    except Exception as e:
        print(f"Error loading cookies: {e}", file=sys.stderr)
    return cookies


if __name__ == "__main__":
    main()
