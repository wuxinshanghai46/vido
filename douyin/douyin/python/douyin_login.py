#!/usr/bin/env python3
"""
抖音扫码登录 + Cookies 导出
用 Playwright 打开浏览器，用户扫码后自动导出 Netscape 格式 cookies
"""

import sys
import os
import time
import json
import argparse
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=str, required=True, help="cookies 输出路径")
    parser.add_argument("--timeout", type=int, default=180, help="等待登录超时(秒)")
    args = parser.parse_args()

    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        page = context.new_page()

        print("OPENING", file=sys.stderr, flush=True)
        page.goto("https://www.douyin.com")

        # 等待页面加载
        page.wait_for_load_state("load", timeout=30000)

        # 截图保存路径
        screenshot_path = Path(args.output).parent / "login_qrcode.png"

        # 多次截图，裁剪中间二维码区域
        for attempt in range(5):
            time.sleep(3)
            try:
                # 先截全页
                full_path = str(screenshot_path) + ".full.png"
                page.screenshot(path=full_path)

                # 裁剪中间区域（二维码弹窗通常在页面中间）
                from PIL import Image
                img = Image.open(full_path)
                w, h = img.size
                # 裁剪中心 50% 区域
                left = w * 0.2
                top = h * 0.15
                right = w * 0.8
                bottom = h * 0.75
                cropped = img.crop((int(left), int(top), int(right), int(bottom)))
                cropped.save(str(screenshot_path))
                print(f"Cropped QR screenshot saved (attempt {attempt+1}), size={cropped.size}", file=sys.stderr, flush=True)
                os.remove(full_path)
                break
            except ImportError:
                # 没有 PIL，直接用全页截图
                page.screenshot(path=str(screenshot_path))
                print(f"Full screenshot saved (no PIL)", file=sys.stderr, flush=True)
                break
            except Exception as e:
                page.screenshot(path=str(screenshot_path))
                print(f"Screenshot attempt {attempt+1}: {e}", file=sys.stderr, flush=True)
                break

        print("WAITING_SCAN", file=sys.stderr, flush=True)
        print(json.dumps({"status": "waiting_scan"}), flush=True)

        # 等待用户登录成功
        start = time.time()
        logged_in = False
        prev_count = 0

        while time.time() - start < args.timeout:
            try:
                cookies = context.cookies()
                douyin_cookies = [c for c in cookies if "douyin" in c.get("domain", "")]
                cookie_names = set(c["name"] for c in douyin_cookies)

                # 登录成功的标志：必须有 sessionid（不能用 passport_csrf_token，页面加载就有）
                login_indicators = {"sessionid", "sessionid_ss"}
                if cookie_names & login_indicators:
                    logged_in = True
                    found = cookie_names & login_indicators
                    print(f"Login detected! Found: {found}", file=sys.stderr, flush=True)
                    time.sleep(2)  # 等待所有 cookie 都设置完
                    break

                prev_count = len(douyin_cookies)

                # 每次轮询都更新截图（每2秒）
                try:
                    full_tmp = str(screenshot_path) + ".full.png"
                    page.screenshot(path=full_tmp)
                    try:
                        from PIL import Image as PILImage
                        img = PILImage.open(full_tmp)
                        w, h = img.size
                        cropped = img.crop((int(w*0.2), int(h*0.15), int(w*0.8), int(h*0.75)))
                        cropped.save(str(screenshot_path))
                        os.remove(full_tmp)
                    except ImportError:
                        os.rename(full_tmp, str(screenshot_path))
                except:
                    pass
            except Exception as e:
                print(f"Check error: {e}", file=sys.stderr, flush=True)
            time.sleep(2)

        if not logged_in:
            print("TIMEOUT", file=sys.stderr, flush=True)
            print(json.dumps({"status": "timeout"}), flush=True)
            browser.close()
            sys.exit(1)

        print("LOGGED_IN", file=sys.stderr, flush=True)

        # 导出 cookies 为 Netscape 格式
        cookies = context.cookies()
        save_netscape_cookies(cookies, args.output)

        # 清理截图
        try:
            screenshot_path.unlink(missing_ok=True)
        except:
            pass

        print(json.dumps({"status": "ok", "cookie_count": len(cookies)}), flush=True)
        browser.close()


def save_netscape_cookies(cookies, filepath):
    """导出为 Netscape 格式（yt-dlp 兼容）"""
    lines = ["# Netscape HTTP Cookie File\n"]
    for c in cookies:
        domain = c.get("domain", "")
        flag = "TRUE" if domain.startswith(".") else "FALSE"
        path = c.get("path", "/")
        secure = "TRUE" if c.get("secure", False) else "FALSE"
        expires = int(c.get("expires", time.time() + 86400))
        name = c.get("name", "")
        value = c.get("value", "")
        lines.append(f"{domain}\t{flag}\t{path}\t{secure}\t{expires}\t{name}\t{value}\n")

    Path(filepath).write_text("".join(lines), encoding="utf-8")
    print(f"Cookies saved: {filepath} ({len(cookies)} cookies)", file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()
