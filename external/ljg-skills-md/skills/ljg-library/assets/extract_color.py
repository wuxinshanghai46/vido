#!/usr/bin/env python3
"""从书封提取最显著的彩色，作为这张卡的动态强调色。

用法：
    python3 extract_color.py <cover.jpg>
输出：
    一个 UI-ready 的 hex 强调色，如 #c43d30（已适度收敛饱和/明度，避免荧光刺眼）。
逻辑：
    缩图取像素 → 过滤掉近黑/近白/灰（无饱和的中性色不能当强调）→
    取最频繁的彩色 → 适度向沉稳收一档 → 输出。
    封面若整体灰白无显著彩色 → 回退到沉稳蓝 #3d5a80。
"""
import sys
import warnings
warnings.filterwarnings("ignore", category=DeprecationWarning)
from collections import Counter

try:
    from PIL import Image
except ImportError:
    print("#3d5a80")  # PIL 不在 → 安全回退，不阻塞出卡
    sys.exit(0)


def colorful(c):
    """有饱和度、非近黑近白的像素才算‘彩色’。"""
    mx, mn = max(c), min(c)
    return mx - mn > 38 and mx > 70 and mn < 210


def tame(c):
    """向沉稳收一档：太鲜的荧光色降饱和+压一点明度，得到高级、克制、点缀面积小也不刺眼的强调色。"""
    r, g, b = c
    mx, mn = max(c), min(c)
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    # 太亮的彩色压暗一点（浅玻璃上才压得住），与中性灰按比例混合降饱和
    target_lum = min(lum, 165)
    k = target_lum / max(lum, 1)
    r, g, b = (int(v * k) for v in (r, g, b))
    gray = int(0.299 * r + 0.587 * g + 0.114 * b)
    mix = 0.20  # 混 20% 同明度灰，收一档饱和
    r = int(r * (1 - mix) + gray * mix)
    g = int(g * (1 - mix) + gray * mix)
    b = int(b * (1 - mix) + gray * mix)
    return (max(0, min(255, r)), max(0, min(255, g)), max(0, min(255, b)))


def main(path):
    im = Image.open(path).convert("RGB").resize((60, 86))
    px = list(im.getdata())
    cands = [c for c in px if colorful(c)]
    if not cands:
        print("#3d5a80")
        return
    top = Counter(cands).most_common(1)[0][0]
    r, g, b = tame(top)
    print("#%02x%02x%02x" % (r, g, b))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: extract_color.py <cover.jpg>", file=sys.stderr)
        sys.exit(1)
    main(sys.argv[1])
