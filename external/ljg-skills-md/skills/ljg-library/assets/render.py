#!/usr/bin/env python3
"""ljg-library 渲染器 —— 给一本书的数据 JSON，出卡。

用法：
    python3 render.py <data.json> <out.png>

分工：AI 负责智力内容（FRAME / ECHO / CHART / NOTE，见 references/extraction.md），
写进 JSON；本脚本做机械的提色 + 模板填充 + 渲染。

data.json 字段见 assets/example_antifragile.json。要点：
- CHART / NOTE / TAGS 可为字符串，或字符串数组（数组自动按行 join，写起来更省心）。
- 未给 ACCENT 但给了 COVER_LOCAL（封面本地路径）→ 自动从封面提取强调色。
- 未给 AVATAR → 省略头像，作者行不显示。
- COVER / AVATAR 用 file:// 绝对路径。
"""
import sys, json, subprocess, pathlib

ROOT = pathlib.Path(__file__).resolve().parent
CAPTURE = ROOT.parent.parent / "ljg-card" / "assets" / "capture.js"
KEYS = ["ACCENT", "COVER", "AVATAR_IMG", "TITLE", "EN", "SUBTITLE", "TAGS",
        "AUTHOR_CN", "AUTHOR_META", "FRAME", "ECHO", "CHART_TITLE", "CHART", "NOTE"]


def asstr(v):
    return "\n".join(v) if isinstance(v, list) else str(v)


def main(data_path, out_path):
    d = json.loads(pathlib.Path(data_path).read_text(encoding="utf-8"))
    if not d.get("ACCENT") and d.get("COVER_LOCAL"):
        d["ACCENT"] = subprocess.check_output(
            ["python3", str(ROOT / "extract_color.py"), d["COVER_LOCAL"]]
        ).decode().strip()
    d.setdefault("ACCENT", "#3d5a80")
    d["AVATAR_IMG"] = (f'<img class="avatar" src="{d["AVATAR"]}" alt="author">'
                       if d.get("AVATAR") else "")
    tpl = (ROOT / "library_template.html").read_text(encoding="utf-8")
    for k in KEYS:
        tpl = tpl.replace("{{" + k + "}}", asstr(d.get(k, "")))
    if "{{" in tpl:
        print("warn: unreplaced placeholder remains", file=sys.stderr)
    html = "/tmp/ljg_library_render.html"
    pathlib.Path(html).write_text(tpl, encoding="utf-8")
    subprocess.run(["node", str(CAPTURE), html, out_path, "1080", "1440", "fullpage"], check=True)
    print("OK:", out_path, "| accent:", d["ACCENT"])


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("usage: render.py <data.json> <out.png>", file=sys.stderr)
        sys.exit(1)
    main(sys.argv[1], sys.argv[2])
