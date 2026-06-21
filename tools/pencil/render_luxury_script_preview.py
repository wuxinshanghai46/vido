from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 1440, 950
img = Image.new("RGB", (W, H), (11, 13, 18))
d = ImageDraw.Draw(img)

root = Path(__file__).resolve().parents[2]
font_path = root / "public" / "fonts" / "NotoSansSC-Regular.otf"
bold_path = root / "public" / "fonts" / "NotoSansSC-Bold.otf"

font_big = ImageFont.truetype(str(bold_path), 34)
font_h = ImageFont.truetype(str(bold_path), 21)
font = ImageFont.truetype(str(font_path), 16)
font_b = ImageFont.truetype(str(bold_path), 16)
font_s = ImageFont.truetype(str(font_path), 13)
font_ss = ImageFont.truetype(str(font_path), 12)

nav = (9, 11, 16)
panel = (20, 24, 33)
panel2 = (16, 21, 29)
line = (41, 51, 69)
text = (246, 248, 252)
muted = (142, 153, 173)
cyan = (40, 242, 223)
lime = (216, 255, 66)
amber = (255, 200, 87)
blue = (127, 180, 255)


def rr(xy, r, fill, outline=None, width=1):
    d.rounded_rectangle(xy, radius=r, fill=fill, outline=outline, width=width)


def txt(x, y, s, f=font, fill=text):
    d.text((x, y), s, font=f, fill=fill)


def text_width(s, f=font):
    box = d.textbbox((0, 0), s, font=f)
    return box[2] - box[0]


def wrap_text(s, max_px, f=font):
    lines = []
    current = ""
    for ch in s:
        test = current + ch
        if text_width(test, f) <= max_px:
            current = test
        else:
            if current:
                lines.append(current)
            current = ch
    if current:
        lines.append(current)
    return lines


def button(x, y, w, h, label, primary=False):
    if primary:
        rr((x, y, x + w, y + h), h // 2, cyan)
        txt(x + (w - text_width(label, font_b)) // 2, y + 10, label, font_b, (6, 16, 20))
    else:
        rr((x, y, x + w, y + h), h // 2, (15, 20, 28), line)
        txt(x + (w - text_width(label, font)) // 2, y + 10, label, font, text)


def chip(x, y, label, active=False):
    w = text_width(label, font_s) + 26
    rr((x, y, x + w, y + 32), 16, (13, 33, 36) if active else panel2, cyan if active else line)
    txt(x + 13, y + 6, label, font_s, cyan if active else (217, 226, 241))
    return w


# Sidebar
rr((0, 0, 220, H), 0, nav)
txt(28, 28, "VIDO", font_h)
txt(24, 90, "广告生成", font_s, muted)
nav_items = [("普通广告数字人", False), ("高定广告片", True), ("商品数字人", False)]
for i, (name, active) in enumerate(nav_items):
    y = 120 + i * 44
    rr((18, y, 202, y + 34), 7, cyan if active else nav)
    txt(38, y + 6, name, font_b if active else font, (6, 16, 20) if active else (200, 210, 225))
txt(24, 280, "资产", font_s, muted)
for i, name in enumerate(["我的素材", "任务中心"]):
    txt(38, 314 + i * 44, name, font, (200, 210, 225))

# Header
x0 = 250
txt(x0, 30, "高定广告片", font_big)
txt(x0, 78, "粘贴脚本、产品介绍、卖点资料或一句需求，AI 自动反推分镜并生成广告片。", font, muted)
rr((1165, 40, 1390, 82), 21, (15, 20, 28), line)
txt(1194, 50, "默认：先生成可确认分镜", font, (220, 228, 242))
d.line((250, 116, 1400, 116), fill=line, width=1)

# Workspace panels
rr((250, 145, 1005, 545), 8, panel, line)
rr((1025, 145, 1400, 930), 8, panel, line)

txt(275, 168, "告诉 AI 你要做什么广告", font_h)
rr((822, 164, 982, 200), 18, (15, 20, 28), line)
txt(850, 172, "支持内容直出", font_s, (220, 228, 242))

rr((275, 215, 980, 405), 8, (14, 18, 25), (58, 70, 89))
sample = "帮我做一条高端艺术墙广告，突出金属肌理、灯光纹理、定制工艺，适合高端会所和设计师客户。画面要像品牌广告，不要像数字人讲解，最后引导预约咨询。"
for i, line_text in enumerate(wrap_text(sample, 650, font)[:5]):
    txt(295, 238 + i * 28, line_text, font, text)

x = 275
for label, active in [("自动判断广告类型", True), ("产品宣传", False), ("品牌故事", False), ("空间展示", False)]:
    w = chip(x, 425, label, active)
    x += w + 8

button(275, 475, 160, 44, "一键生成广告片", True)
button(448, 475, 140, 44, "先生成分镜表")
button(600, 475, 146, 44, "AI 帮我整理内容")
button(758, 475, 116, 44, "粘贴示例")

# Side panel
txt(1050, 168, "参考素材", font_h)
rr((1050, 210, 1375, 320), 8, (14, 18, 25), (58, 70, 89))
txt(1110, 246, "上传产品图、品牌图、场景图或参考画面", font, muted)
txt(1168, 276, "可不上传，先由 AI 生成分镜", font_s, muted)
labels = ["产品", "场景", "品牌", "+"]
for i, label in enumerate(labels):
    x = 1050 + i * 82
    rr((x, 340, x + 72, 412), 7, (34, 43, 62), line)
    rr((x + 8, 348, x + 50, 370), 11, (0, 0, 0))
    txt(x + 18, 350, label, font_ss, (220, 228, 242))
txt(1050, 427, "多张素材用于绑定不同镜头，不再要求用户先决定“多个背景”。", font_s, muted)
d.line((1050, 462, 1375, 462), fill=line, width=1)
txt(1050, 485, "生成设置", font_h)
rr((1050, 525, 1375, 585), 8, panel2, line)
d.ellipse((1064, 538, 1096, 570), fill=cyan)
txt(1074, 543, "音", font_b, (6, 16, 20))
txt(1110, 535, "自动选择", font_b, text)
txt(1110, 558, "根据广告文案自动匹配音色", font_s, muted)
button(1260, 535, 95, 38, "选择配音")

settings = [
    ("生成时长", "30 秒"),
    ("画面比例", "9:16 竖屏广告"),
    ("像素尺寸", "标准"),
    ("字幕", "默认生成"),
]
for i, (label, value) in enumerate(settings):
    x = 1050 + (i % 2) * 165
    y = 605 + (i // 2) * 82
    txt(x, y, label, font_s, (220, 228, 242))
    rr((x, y + 24, x + 150, y + 64), 7, (15, 20, 28), line)
    txt(x + 12, y + 34, value, font_s, text)
txt(1050, 755, "9:16 · 1080×1920", font_s, muted)
d.line((1050, 790, 1375, 790), fill=line, width=1)
txt(1050, 813, "生成进度", font_h)
for i, (label, active) in enumerate([("理解广告内容", True), ("生成分镜表", False), ("生成关键帧", False), ("合成广告片", False)]):
    y = 845 + i * 24
    d.ellipse((1052, y + 4, 1064, y + 16), fill=cyan if active else line)
    txt(1076, y, label, font_s, text if active else muted)

# Person optional strip
rr((250, 565, 1005, 645), 8, panel, line)
txt(275, 588, "人物形象，可选", font_h)
txt(275, 621, "需要真人出镜时再选择。人物用于保持身份一致，不等于普通数字人站桩讲解。", font_s, muted)
rr((810, 578, 866, 634), 8, (34, 43, 62), line)
txt(825, 596, "未选", font_s, muted)
button(880, 585, 105, 42, "选择人物")

# Storyboard
rr((250, 665, 1005, 930), 8, panel, line)
txt(275, 690, "AI 反推的广告分镜表", font_h)
button(805, 682, 175, 42, "确认分镜并生成", True)

cols = [275, 390, 505, 650, 810, 920]
headers = ["镜头", "画面预览", "旁白 / 字幕", "画面内容", "使用素材", "状态"]
for i, h in enumerate(headers):
    txt(cols[i], 745, h, font_s, (185, 197, 216))
d.line((275, 772, 980, 772), fill=line, width=1)

rows = [
    ("01 开场钩子", "空间高级感", "完整空间缓慢推进", "主参考图", "待生成"),
    ("02 材质细节", "金属肌理与光影", "纹理、边缘、灯光特写", "产品图 / 参考", "待生成"),
    ("03 场景价值", "会所与设计师客户", "会所、展厅、住宅场景", "场景图 / AI 补图", "待生成"),
    ("04 品牌收束", "预约定制咨询", "品牌画面和行动引导", "品牌图 / Logo", "待生成"),
]
for r, row in enumerate(rows):
    y = 792 + r * 36
    if r:
        d.line((275, y - 7, 980, y - 7), fill=line, width=1)
    txt(cols[0], y, row[0], font_b, cyan)
    thumb_fill = [(31, 48, 66), (58, 45, 39), (29, 48, 66), (30, 58, 54)][r]
    rr((cols[1], y - 4, cols[1] + 92, y + 31), 7, thumb_fill, line)
    d.ellipse((cols[1] + 60, y + 2, cols[1] + 82, y + 24), fill=(216, 255, 66) if r in (0, 3) else (127, 180, 255))
    txt(cols[1] + 8, y + 15, ["空间", "材质", "场景", "品牌"][r], font_ss, text)
    txt(cols[2], y, row[1], font, text)
    for i, l in enumerate(wrap_text(row[2], 145, font)[:1]):
        txt(cols[3], y + i * 22, l, font, text)
    txt(cols[4], y, row[3], font, text)
    txt(cols[5], y, row[4], font, amber)
    rr((cols[4], y + 15, cols[4] + 58, y + 35), 10, (18, 35, 47), None)
    txt(cols[4] + 11, y + 15, "可替换", font_ss, blue)

out = root / "tools" / "pencil" / "luxury-ad-script-to-video-generator-preview.png"
img.save(out, quality=95)
print(out)
