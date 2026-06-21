from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

W, H = 1440, 950
img = Image.new("RGB", (W, H), (11, 13, 18))
d = ImageDraw.Draw(img)

font_path = "E:/AI/VIDO/public/fonts/NotoSansSC-Regular.otf"
bold_path = "E:/AI/VIDO/public/fonts/NotoSansSC-Bold.otf"
font_big = ImageFont.truetype(bold_path, 34)
font_h = ImageFont.truetype(bold_path, 22)
font = ImageFont.truetype(font_path, 17)
font_b = ImageFont.truetype(bold_path, 17)
font_s = ImageFont.truetype(font_path, 14)

nav = (9, 11, 16)
panel = (19, 23, 32)
panel2 = (23, 29, 40)
line = (40, 49, 65)
text = (245, 247, 251)
muted = (141, 151, 170)
cyan = (40, 242, 223)
lime = (216, 255, 66)


def rr(xy, r, fill, outline=None, width=1):
    d.rounded_rectangle(xy, radius=r, fill=fill, outline=outline, width=width)


def txt(x, y, s, f=font, fill=text):
    d.text((x, y), s, font=f, fill=fill)


def wrap(s, n):
    return [s[i:i + n] for i in range(0, len(s), n)]


rr((0, 0, 220, H), 0, nav)
txt(28, 28, "VIDO", font_h)
txt(24, 86, "广告带货", font_s, muted)
for i, (name, active) in enumerate([("广告数字人", False), ("高定广告片", True), ("商品数字人", False)]):
    y = 116 + i * 44
    rr((18, y, 202, y + 34), 7, (18, 31, 36) if active else nav)
    txt(38, y + 6, name, font_b if active else font, cyan if active else (201, 209, 223))
txt(24, 276, "资产", font_s, muted)
for i, name in enumerate(["我的形象", "任务中心"]):
    txt(38, 310 + i * 44, name, font, (201, 209, 223))

x0 = 250
txt(x0, 32, "高定广告片", font_big)
txt(x0, 82, "上传产品/品牌素材，填写宣传内容，生成广告故事板与成片。", font, muted)
rr((1190, 38, 1390, 86), 28, cyan)
txt(1230, 52, "生成广告故事板", font_b, (6, 16, 20))
d.line((250, 118, 1400, 118), fill=line, width=1)

for c in [(250, 145, 545, 865), (565, 145, 1035, 865), (1055, 145, 1400, 865)]:
    rr(c, 8, panel, line)

txt(272, 165, "广告素材", font_h)
rr((272, 205, 523, 350), 8, (14, 18, 25), line)
txt(314, 252, "上传产品、品牌、场景或参考画面", font_b, (235, 240, 248))
txt(342, 282, "支持 1-8 张，第一张作为主参考", font_s, muted)
for i in range(4):
    x = 272 + i * 62
    y = 370
    rr((x, y, x + 52, y + 52), 6, (35, 43, 58), cyan if i == 0 else line)
    rr((x + 5, y + 5, x + 23, y + 23), 9, (0, 0, 0))
    txt(x + 11, y + 4, str(i + 1), font_s)

rr((272, 450, 523, 585), 8, panel2, line)
txt(290, 470, "人物身份参考（可选）", font_h)
txt(290, 510, "不选人物也能生成产品/场景广告片", font_s, muted)
txt(290, 535, "选择后只锁定同一人物身份", font_s, muted)
rr((290, 610, 505, 650), 20, (15, 20, 28), line)
txt(363, 617, "选择人物", font)

txt(590, 165, "产品宣传故事", font_h)
fields = [
    (590, 205, 200, 62, "产品/品牌名称", "Time Patina\n艺术墙"),
    (805, 205, 200, 62, "目标用户", "高端住宅/设计师\n品牌展厅"),
    (590, 292, 420, 86, "核心卖点", "定制金属肌理，灯光下呈现时间沉淀感，适合高端空间建立品牌记忆点。"),
    (590, 395, 200, 62, "使用场景", "展厅 / 会所"),
    (805, 395, 200, 62, "想要的感觉", "高级柔光 / 品牌质感"),
    (590, 482, 420, 86, "完整宣传内容", "用一支高定广告片呈现这面艺术墙的品牌质感。开场建立空间第一眼，中段推进材质、纹理和光影细节，最后收束到定制咨询。"),
]
for x, y, w, h, lab, val in fields:
    txt(x, y, lab, font_s, (220, 228, 242))
    rr((x, y + 24, x + w, y + 24 + h), 7, (14, 18, 25), line)
    lines = []
    for part in val.split("\n"):
        lines += wrap(part, 22 if w > 300 else 11)
    for li, l in enumerate(lines[:3]):
        txt(x + 12, y + 34 + li * 22, l, font_s, text)

rr((590, 605, 720, 645), 22, (15, 20, 28), line)
txt(610, 614, "AI 整理内容", font)
rr((735, 605, 920, 645), 22, cyan)
txt(770, 614, "生成广告故事板", font_b, (6, 16, 20))

txt(590, 680, "广告故事板", font_h)
shots = [
    ("开场吸引", "建立完整空间第一眼"),
    ("产品细节", "推进材质与光泽层次"),
    ("使用/互动", "展示高端定制场景"),
    ("品牌收束", "引导咨询与品牌记忆"),
]
for i, (title, desc) in enumerate(shots):
    x = 590 + (i % 2) * 215
    y = 720 + (i // 2) * 110
    rr((x, y, x + 200, y + 92), 8, panel2, line)
    rr((x + 12, y + 12, x + 72, y + 72), 6, (35, 43, 58), line)
    txt(x + 30, y + 28, f"{i + 1:02d}", font_b, cyan)
    txt(x + 85, y + 17, title, font_b)
    txt(x + 85, y + 48, desc, font_s, muted)

txt(1080, 165, "预览", font_h)
rr((1080, 205, 1375, 445), 8, (14, 18, 25), line)
txt(1165, 295, "关键帧预览区域", font_h, (220, 228, 242))
txt(1128, 330, "确认故事板后生成每个镜头的关键帧", font_s, muted)
txt(1080, 485, "生成进度", font_h)
for i, (s, active) in enumerate([("生成广告方案", True), ("生成关键帧", False), ("合成广告片", False), ("任务中心查看结果", False)]):
    y = 530 + i * 48
    d.ellipse((1082, y + 6, 1096, y + 20), fill=cyan if active else line)
    txt(1110, y, s, font, text if active else muted)

out = Path("tools/pencil/luxury-ad-product-story-generator-preview.png")
img.save(out, quality=95)
print(out.resolve())
