# Topview 数字人与语音模块差距报告（2026-05-01）

## 调研范围

- 目标页面：`https://www.topview.ai/board/7c65e7e540bb451d81adb0e4844648db?tool-type=product-avatar`
- 当前限制：Codex in-app browser runtime 启动失败，无法使用本机 Chrome 已登录态进入私有 board 内部操作页；本报告基于 Topview 官方公开页面、工具入口和当前 VIDO 功能对比形成。
- 主要参考：Topview AI Avatar、Product Avatar、Lip Sync、Voiceover、Home/Agent 页面。

## Topview 已表现出的关键能力

1. 数字人定位更偏“电商营销成片”
   - Product Avatar 明确围绕商品展示：上传商品图或商品链接，生成“拿着商品/指向商品/解释商品”的真人 presenter。
   - 宣称适配商品页、广告、Marketplace、Amazon、Shopify、TikTok Shop 等商业场景。

2. 数字人素材库规模和标签化更强
   - 官方页面强调 2,000+ ultra-realistic AI avatars，覆盖多国家、不同人群、母语。
   - 不是只让用户生成一个形象，而是先从丰富 avatar library 里选，再做定制。

3. 商品与人物融合是独立卖点
   - Topview 强调 product-avatar 能让商品与 avatar 自然连接，而不是后期贴图。
   - 这点比普通“图片口播 + 字幕”更贴近电商广告。

4. 语音模块是视频优先
   - Voiceover 支持脚本粘贴、选择 voice/language/style、试听、导出。
   - 强调 natural prosody、pacing、emphasis、breathing、brand-ready tone、pronunciation control。

5. 多语言/本地化能力是默认产品能力
   - Avatar 页面强调 multilingual avatars。
   - Lip Sync 页面强调 50+ languages。
   - Home 页面强调 30+ languages voiceover/captions。

6. 生成流程更像“创意工作台”
   - 首页有模板频道：Social Content、Ad Video、Ecommerce、Local Services、UGC、Explainer、Corporate 等。
   - 支持参考视频/参考风格、产品 URL、脚本、声音、字幕、成片下载的一体化路径。

## VIDO 当前缺少或较弱的能力

1. 缺少“商品数字人”专用链路
   - 当前 VIDO 更像“选形象 + 写台词 + 配音 + 口播生成”。
   - 缺少商品图/商品 URL 解析、商品卖点提取、商品入手/展示/指向动作、商品与手部自然融合。

2. 数字人库和筛选标签不足
   - 目前偏“我的形象/生成形象”，缺少商业化 avatar library。
   - 需要增加国家/年龄/风格/行业/肤色/语言/服装/场景/是否可拿商品等筛选。

3. 语音体验不够产品化
   - 已有 TTS 和克隆，但缺少品牌声音 profile、发音词典、语气强度、停顿控制、试听历史、音色可用性健康状态。
   - 失败音色已开始清理，但还需要定时健康检查和厂商级刷新。

4. 多语言本地化链路缺失
   - 当前可生成中文口播，但缺少“一键翻译脚本 + 换目标语言声音 + 字幕本地化 + 口型同步”的完整工作流。

5. 成片前的分镜/模板能力不足
   - Topview 强调参考视频、模板频道、UGC/广告/电商场景。
   - VIDO 需要模板化的“开场钩子/痛点/卖点/证据/行动号召”结构，支持批量变体。

6. 生成前预检不足
   - 需要在点击生成前明确提示：当前引擎、音色是否可用、字幕烧录能力、预计时长、预计成本、是否支持商品互动。

## 建议的产品迭代优先级

P0：稳定基础能力
- 音色列表服务端健康检查、失败黑名单、厂商动态拉取。
- 字幕烧录改为 ASS/libass 后继续做线上回归。
- 生成前预检：模型链路、TTS、字幕、图片可访问性。

P1：补齐 Topview 最核心差距
- 新增“商品数字人”入口：
  - 上传商品图/粘贴商品链接。
  - 自动提取商品名、卖点、目标人群、使用场景。
  - 生成商品展示动作提示词：拿起、指向、对比、开箱、试用。
  - 输出商品演示口播脚本和分镜。
- Avatar library 标签体系：
  - 行业、国家、年龄、性别、服装、语言、场景、可拿商品、风格。

P2：语音模块产品化
- 音色健康中心：可用/失败/未测试/厂商异常。
- 发音词典：品牌词、人名、英文缩写、数字读法。
- 语气控制：自然、热情、专业、温柔、紧迫、促销。
- 试听缓存和厂商级刷新按钮。

P3：批量与本地化
- 同一商品批量生成 5-20 条变体。
- 一键翻译 30+ 语言脚本/字幕。
- 按语言自动匹配音色和字幕样式。

## 设计要求

后续相关界面应先用 Pencil Project 产出原型：
- 商品数字人创建页
- 音色健康中心
- Avatar library 筛选页
- 多语言本地化弹窗
- 生成前预检弹窗

## 参考来源

- Topview Home: https://www.topview.ai/
- Topview AI Avatar: https://www.topview.ai/ai-avatar
- Topview Product Avatar: https://www.topview.ai/ai-avatar/product-avatar
- Topview Lip Sync: https://www.topview.ai/lip-sync
- Topview Voiceover: https://www.topview.ai/voiceover
