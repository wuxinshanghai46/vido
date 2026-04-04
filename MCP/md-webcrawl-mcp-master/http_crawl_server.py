"""
HTTP 爬虫服务 - 供业务感知「信息获取」模块调用

提供 POST /crawl 接口，与后端 WebInfoController 约定一致：
- 请求体: { "url": string, "keywords": string?, "fetchImage": boolean? }
- 响应:   { "title": string?, "summary": string?, "content": string?, "images": string[]? }

运行: uvicorn http_crawl_server:app --host 0.0.0.0 --port 5203
"""
from __future__ import annotations

import os
import re
from urllib.parse import urljoin, urlparse

# 正文/摘要中的 base64 内联图片占位，避免存储和传输巨大字符串
BASE64_IMG_PLACEHOLDER = "[图片]"


def _strip_base64_images(text: str) -> str:
    """将 markdown 中的 data:image/...;base64,... 替换为占位符。"""
    if not text:
        return text
    return re.sub(r"!\[[^\]]*\]\(data:image/[^\)]+\)", BASE64_IMG_PLACEHOLDER, text)

import html2text
import requests
from bs4 import BeautifulSoup
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# 请求超时（秒）
REQUEST_TIMEOUT = int(os.environ.get("REQUEST_TIMEOUT", "30"))
# 默认请求头，减少被拒
DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}

app = FastAPI(title="Crawl HTTP Service", version="1.0.0")


class CrawlRequest(BaseModel):
    url: str
    keywords: str | None = None 
    fetchImage: bool | None = False


class CrawlResponse(BaseModel):
    title: str | None = None
    summary: str | None = None
    content: str | None = None
    images: list[str] | None = None


def _absolute_url(base: str, path: str) -> str:
    if not path or path.startswith(("http://", "https://")):
        return path
    return urljoin(base, path)


def _extract_title(soup: BeautifulSoup, fallback: str = "") -> str:
    if soup.title and soup.title.string:
        return soup.title.string.strip()
    og = soup.find("meta", property="og:title")
    if og and og.get("content"):
        return og.get("content", "").strip()
    return fallback


def _extract_description(soup: BeautifulSoup) -> str:
    for name in ("description", "og:description"):
        meta = soup.find("meta", attrs={"name": name}) or soup.find("meta", property=name)
        if meta and meta.get("content"):
            return meta.get("content", "").strip()
    return ""


def _extract_images(soup: BeautifulSoup, page_url: str, max_count: int = 20) -> list[str]:
    seen = set()
    out = []
    for img in soup.find_all("img", src=True):
        src = img.get("src", "").strip()
        if not src or src in seen:
            continue
        abs_url = _absolute_url(page_url, src)
        if abs_url.startswith(("http://", "https://")):
            seen.add(src)
            out.append(abs_url)
            if len(out) >= max_count:
                break
    return out


@app.post("/crawl", response_model=CrawlResponse)
def crawl(request: CrawlRequest) -> CrawlResponse:
    url = request.url.strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="url must start with http:// or https://")

    try:
        resp = requests.get(
            url,
            headers=DEFAULT_HEADERS,
            timeout=REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding or "utf-8"
        html = resp.text
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"请求页面失败: {str(e)}")

    soup = BeautifulSoup(html, "html.parser")

    # 移除 script/style 减少噪音
    for tag in soup.find_all(["script", "style"]):
        tag.decompose()

    h2t = html2text.HTML2Text()
    h2t.ignore_links = False
    h2t.body_width = 0
    content = h2t.handle(str(soup))
    content = _strip_base64_images(content)

    title = _extract_title(soup, urlparse(url).path or url)
    description = _extract_description(soup)
    summary = description or (content[:500] + "..." if len(content) > 500 else content)
    summary = _strip_base64_images(summary)
    if len(summary) > 500:
        summary = summary[:500] + "..."

    images = None
    if request.fetchImage:
        images = _extract_images(soup, url)

    return CrawlResponse(
        title=title,
        summary=summary,
        content=content,
        images=images,
    )


@app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("CRAWL_HTTP_PORT", "5203"))
    uvicorn.run(app, host="0.0.0.0", port=port)
