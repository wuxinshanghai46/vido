/**
 * 数字人知识库 seed
 *
 * 覆盖：角色资产库、国内外数字人工作流、直播带货话术（李佳琦/董宇辉/小杨哥/辛巴模式）、
 * 口型技术栈、音色克隆、AI课程讲解、TikTok Shop 海外带货、虚拟主播运营
 *
 * 注：以下内容基于 2025-2026 年公开的数字人工具文档与直播电商实战经验合成
 */

module.exports = [

  // —— 原有 v1 条目（保持 id 不变）——
  {
    id: 'kb_dh_character_assets',
    collection: 'digital_human',
    subcategory: '角色资产库',
    title: '打造可复用的 AI 角色资产库（视觉锁定 + 三视图 + ID Token）',
    summary: '一次建库、百次复用：为每个数字人角色生成面部锁、服装锁、ID token 和三视图，保证跨镜头、跨作品的视觉一致性。',
    content: `角色资产库的核心是让同一个角色在任何新画面中都长得一样。每个角色需锁定 5 层：
1) 面部锁 lock_face：脸型/肤色/瞳色/发型/发色（6-10 个具体词，英文）
2) 身体锁 lock_body：身高/体型/年龄感（3-5 个特征）
3) 服装锁 lock_wardrobe：主色 + 款式 + 配饰（5-8 个具体词）
4) 标志特征 lock_distinguishing：疤痕/纹身/眼镜/发饰（1-3 个最显著的）
5) ID Token：1-3 个英文词的短标识，每个 prompt 复用，如 "the same Asian young woman with raven-black hair"
配套产物：三视图（front / side / back）+ 5-8 张参考图作为 reference image。
禁止抽象词（dark hair ✗ → raven-black mid-back length hair ✓）。`,
    tags: ['角色资产', '一致性', 'ID token', '三视图', 'reference image'],
    keywords: ['character bible', 'subject reference', 'identity lock', 'wardrobe lock', 'id_token', '跨镜头一致性'],
    prompt_snippets: [
      'the same [age] [gender] with [hair color] [hair style], [eye color] eyes, wearing [main outfit]',
      'consistent character, identity lock, subject_reference mode',
      'raven-black mid-back length hair, side bangs, icy blue eyes',
      'small star-shaped scar above left eyebrow, silver wing earring',
    ],
    applies_to: ['character_consistency', 'screenwriter', 'director', 'digital_human'],
    source: '抖音 @只关于Ai的学妹《轻松打造角色资产库》+ 通用 AI 视频一致性实践',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_dh_script_structure',
    collection: 'digital_human',
    subcategory: '口播话术',
    title: '数字人口播黄金结构（3-7-15-30 秒节奏）',
    summary: '一条口播视频必须在 3s 内钩子、7s 内立论、15s 内给证据、30s 前给行动指令。',
    content: `黄金节奏：
- 0-3s 钩子：反常识/痛点/数字/冲突（"90% 的人都不知道……"）
- 3-7s 立论：一句话亮出核心观点
- 7-15s 证据：案例/数据/对比/演示
- 15-25s 展开：2-3 个 how 步骤或细节
- 25-30s CTA：关注/评论/点赞/截图收藏
数字人口播尤其要在每一段配合表情切换和小手势，避免"塑料感"。`,
    tags: ['口播', '话术', '节奏', '黄金开头'],
    keywords: ['hook', 'cta', '黄金3秒', '口播结构', 'pacing'],
    prompt_snippets: [
      'engaging opening hook in first 3 seconds',
      'call to action at the end',
      'presenter-style dialogue with micro gestures',
    ],
    applies_to: ['screenwriter', 'digital_human'],
    source: '通用数字人口播经验 + 短视频创作范式',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_dh_livestream_ecommerce',
    collection: 'digital_human',
    subcategory: '带货脚本',
    title: '数字人带货脚本的"痛-品-证-利-催"五步法',
    summary: '带货脚本 = 痛点场景 → 产品亮相 → 证据背书 → 利益点 → 催单话术。',
    content: `五步法：
1) 痛点场景：演出用户未解决的痛苦画面（3-5s）
2) 产品亮相：产品特写 + 一句核心卖点
3) 证据：数据/实验/对比/用户反馈
4) 利益点：价格锚点 + 赠品 + 限时优惠
5) 催单：库存告急 + 倒计时 + 重复价格
数字人带货一定要有产品与数字人同框的镜头（避免绿幕感），并在"催单"段加表情特写和快速切换。`,
    tags: ['带货', '直播', '电商脚本'],
    keywords: ['ecommerce script', 'live commerce', 'pain point', 'anchor price'],
    prompt_snippets: [
      'digital human presenting the product with close-up insert shots',
      'countdown urgency, stock scarcity call-out',
    ],
    applies_to: ['screenwriter', 'digital_human'],
    source: '通用数字人带货脚本结构',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_dh_lipsync_expression',
    collection: 'digital_human',
    subcategory: '口型与表情',
    title: '数字人口型与微表情的协同要点',
    summary: '避免"AI 木偶感"的关键：元音口型准确 + 眨眼节奏 2-5s/次 + 眉毛微动 + 手势辅助。',
    content: `要点：
- 元音 A/O/U/E/I 对应不同口型宽高比，不要让数字人一直嘟嘴
- 眨眼节奏 2-5 秒一次，避免机械同步
- 讲到重点词时眉毛微抬（0.3s）
- 每 6-10 秒加一次小手势（指、摊、握拳）
- 说话结束的最后一个音节要有"收尾表情"（微笑/抿嘴/点头）`,
    tags: ['口型', '表情', '微表情', '数字人'],
    keywords: ['lip sync', 'blink rhythm', 'micro expression', 'gesture'],
    prompt_snippets: [
      'natural blink every 2 to 5 seconds',
      'subtle eyebrow raise on key words',
      'small hand gesture punctuation every 6-10 seconds',
    ],
    applies_to: ['director', 'digital_human'],
    source: '数字人制作通用实践',
    lang: 'zh',
    enabled: true,
  },

  // ═══════════════════════════════════════════════════
  // —— v2 新增：行业工具链 + 实战话术 ——
  // ═══════════════════════════════════════════════════
  {
    id: 'kb_dh_v2_heygen_avatar_iv',
    collection: 'digital_human',
    subcategory: '直播场景',
    title: 'HeyGen Avatar IV 工作流（企业级 3D 数字人）',
    summary: 'HeyGen Avatar IV 的四段式制作：录制 → 克隆 → 脚本化 → 批量生成。',
    content: `HeyGen Avatar IV 是目前 2025 年企业级数字人最被广泛采用的 SaaS 工具之一，标准工作流：
1) 录制 (Recording)：一次录制 2 分钟正面讲话视频，要求均匀光照 / 纯色背景 / 直视镜头 / 不同元音覆盖
2) 克隆 (Avatar Training)：平台 2-24h 训练出专属 Avatar，含面部 rig 和口型库
3) 脚本化 (Scripting)：直接粘贴文字，平台自动 TTS + 口型对齐 + 眨眼 + 头部微动
4) 批量生成 (Batch Generation)：配合 Heygen API 一天出 100+ 条，支持 40+ 语言切换
关键 tips：
- 录制时必须包含微笑 / 严肃 / 强调三种基础表情
- 背景建议后期绿幕合成真实场景，避免"AI感"
- 不要用超过 200 字的长句，数字人会出现呼吸节奏不自然
- 海外品牌带货推荐 Synthesia / HeyGen，中文抖音直播推荐硅基智能 / 腾讯智影 / 小冰`,
    tags: ['heygen', '数字人', 'avatar', '企业级'],
    keywords: ['heygen avatar iv', 'digital human', 'avatar cloning', 'synthesia', 'presenter video', 'lip sync'],
    prompt_snippets: [
      'professional business presenter style, neutral background, even lighting',
      'natural hand gestures, subtle head tilt, confident posture',
      'short sentences under 20 words, natural pauses',
    ],
    applies_to: ['digital_human', 'screenwriter', 'director'],
    source: 'HeyGen 官方文档 + 企业级数字人实战经验',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_dh_v2_livestream_top_anchors',
    collection: 'digital_human',
    subcategory: '带货脚本',
    title: '顶级主播话术模型：李佳琦/董宇辉/小杨哥/辛巴四派',
    summary: '四种被验证的百亿级直播话术模型，AI 数字人带货可直接模仿人设驱动的话术结构。',
    content: `【李佳琦派 - 女性种草型】
- 尖叫式情绪："OMG!!"、"买它买它买它"、"所有女生"
- 颜色情绪化命名："斩男色"、"元气橘"、"奶茶色"
- 上嘴 / 上脸演示：必须在产品 3 秒内出现试色/试用
- 价格三连："最低价""前 3000 单""再送 XXX"
- 节奏：每 90 秒一个爆点 + 每 10 分钟重复一次全网最低价

【董宇辉派 - 知识带货型】
- 文学引用 + 产品背景故事（诗词/历史/哲学）
- 长时间情绪铺垫（3-5 分钟），再转入产品
- 语调沉稳、语速慢、停顿多
- 不打"全网最低"，打"值得"
- 适合客单价 100-500 的品质商品

【小杨哥派 - 搞笑下沉型】
- 兄弟团群体对话 + 夸张表情
- 主播自我调侃 + 产品槽点反向种草
- 现场整活 + 打闹 + 突发惊喜
- 适合 9.9-99 元快消品
- 节奏：每 30 秒一个笑点 + 每 5 分钟一次"上车"

【辛巴派 - 家族信任型】
- 家人/家族叙事：把粉丝称作"家人"
- 开场必报产地 / 工厂 / 源头故事
- 价格血腥切：当场砍价 / 老板下跪
- 适合生鲜 / 食品 / 家居日用
- 节奏：每 10 分钟一次"补库存"/"秒杀"喊单

AI 数字人带货应选一种派系 lock 住人设，不要混用。`,
    tags: ['带货', '主播', '话术', '直播电商'],
    keywords: ['li jiaqi', 'dong yuhui', 'xiao yangge', 'xinba', 'live commerce', 'oh my god', 'all the girls'],
    prompt_snippets: [
      'excited female beauty presenter style, emotional product reveal',
      'calm knowledgeable male presenter, literary narration, slow pace',
      'group comedy presenters, exaggerated expressions, product roast',
      'trust-building family style, source story, price negotiation drama',
    ],
    applies_to: ['digital_human', 'screenwriter'],
    source: '淘宝/抖音直播电商 2023-2025 顶部主播公开话术分析',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_dh_v2_lipsync_tech_stack',
    collection: 'digital_human',
    subcategory: '口型与表情',
    title: '口型同步技术栈选型（Wav2Lip / SadTalker / LivePortrait / Hedra / 腾讯 MuseTalk）',
    summary: '不同场景选不同 lip sync 工具：短视频选 LivePortrait，直播选 Hedra，长视频选 MuseTalk。',
    content: `2025 年主流开源与商用口型同步技术栈对比：

| 工具 | 类型 | 优势 | 劣势 | 适用 |
|---|---|---|---|---|
| Wav2Lip | 开源/经典 | 任意人脸、速度快 | 嘴部模糊、只动嘴 | 快速原型 |
| SadTalker | 开源 | 头部动、表情丰富 | 分辨率 256/512 偏低 | 社交短片 |
| LivePortrait (Kwai) | 开源 | 实时、表情迁移 | 需要驱动视频 | 短视频口播 |
| Hedra Character-3 | 商用 | 情感表达强、长视频 | 收费 | 角色对话 / 访谈 |
| Heygen Avatar IV | 商用 | 企业级、多语言 | 需训练专属 | 品牌宣传 |
| MuseTalk (Tencent) | 开源 | 30fps 实时、中文优化 | 需 GPU | 直播数字人 |
| D-ID Agents | 商用 | API 接入、快 | 精度一般 | 客服对话 |
| Synthesia | 商用 | 专业 presenter | 贵 | 企业培训 |

选型建议：
- 抖音爆款短视频 → LivePortrait + ElevenLabs
- 企业级培训 → HeyGen 或 Synthesia
- 实时直播 → MuseTalk 或 Heygen Streaming API
- 角色对话剧情 → Hedra Character-3
- 大规模批量生成 → 基于 Wav2Lip + SadTalker 自建流水线`,
    tags: ['口型', '技术栈', 'lip sync', '工具对比'],
    keywords: ['wav2lip', 'sadtalker', 'liveportrait', 'hedra', 'heygen', 'musetalk', 'd-id', 'synthesia', 'lip sync stack'],
    prompt_snippets: [
      'high quality lip sync, natural mouth movement, teeth visible on vowels',
      'realistic head motion synchronized with speech rhythm',
      'micro-expression changes driven by sentiment of speech',
    ],
    applies_to: ['digital_human', 'director'],
    source: '开源社区 + 商业工具 2025 公开对比评测',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_dh_v2_voice_cloning',
    collection: 'digital_human',
    subcategory: '音色与人设',
    title: '音色克隆工作流（ElevenLabs / Fish Audio / XTTS-v2 / MiniMax）',
    summary: '3 分钟干净录音即可克隆主播音色，关键是录音质量而非时长。',
    content: `2025 年主流音色克隆方案：

**ElevenLabs** — 全球标杆
- 最小 10 秒即可，推荐 3-5 分钟
- 多语言（32 种）保持同一音色特征
- Instant Voice Cloning：秒级生成
- Professional Voice Cloning：更逼真，但需 30 分钟素材
- 适合：英文/多语言全球带货

**Fish Audio (Fish Speech)** — 开源之选
- 中文表现极强，情感自然
- 10 秒即可克隆，支持方言
- 免费开源部署
- 适合：中文短视频、数字人口播

**XTTS-v2 (Coqui)** — 完全开源
- 13 种语言，6 秒样本
- 自部署，无 API 费用
- 适合：大规模批量生成

**MiniMax Speech-02** — 中文顶级
- 情感表达最丰富（开心/悲伤/愤怒/惊讶）
- 韵律节奏最接近真人
- 适合：播客、知识付费、有声书

**录音要求**：
- 干净环境（<-60dB 底噪）
- 采样率 44.1kHz 或 48kHz
- 单声道 WAV
- 内容覆盖：陈述句 / 疑问句 / 感叹句 / 数字 / 英文
- 一次录完，不要分段拼接
- 录"吗呢啊哦嗯" 五种语气词各一遍

**禁忌**：
- 不要用耳机麦克风 / 电话录音
- 不要有背景音乐 / 环境音
- 不要念太快（AI 会学到机械感）
- 不要只念一种情绪（AI 会失去弹性）`,
    tags: ['音色', '克隆', 'TTS', '数字人'],
    keywords: ['voice cloning', 'elevenlabs', 'fish audio', 'xtts', 'minimax speech', 'tts', 'voice clone workflow'],
    prompt_snippets: [
      'natural emotional tone, warm presenter voice',
      'conversational pace, subtle pauses between key phrases',
      'cloned voice matching source speaker timbre and prosody',
    ],
    applies_to: ['digital_human'],
    source: 'ElevenLabs / Fish Audio / Coqui XTTS / MiniMax 2024-2025 公开文档',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_dh_v2_anchor_4beat',
    collection: 'digital_human',
    subcategory: '口播话术',
    title: '抖音口播博主的"起-承-转-合"四字节奏',
    summary: '百万级口播博主共性结构：起（反常识）→ 承（展开）→ 转（反转）→ 合（金句）。',
    content: `2024-2025 抖音百万级口播博主（交个朋友系、混子曰、半佛仙人、所长林超）共性结构：

**起（0-5s）——反常识钩子**
- "你知道吗，其实 XX 根本不是……"
- "为什么越努力越穷？"
- "一个被 99% 的人忽略的真相……"
- 表情：一脸严肃 / 不屑 / 神秘

**承（5-30s）——展开论点**
- 3 个分论点或 1 个详细案例
- 每 10 秒变一次镜头（中景→近景→特写）
- 关键词屏显（大号字幕）
- 语速 1.2-1.3 倍

**转（30-55s）——反转 / 认知刷新**
- "但是，有一件事你没想到……"
- "真正的原因，其实是……"
- 情绪推至顶点，可加背景音乐鼓点
- 此处必须有一个"哦原来如此"的信息增量

**合（55-60s）——金句 / 行动**
- 一句押韵或对仗的金句
- 或直接 CTA："关注我，下期讲 XX"
- 最后一帧停顿 0.5 秒给观众"回味"

**60 秒黄金时长禁忌**：
- 不要超过 75 秒（完播率断崖）
- 不要少于 45 秒（信息密度不足）
- 开头 3 秒禁止自我介绍
- 禁止"大家好我是 XX"开头`,
    tags: ['抖音', '口播', '博主', '四段式'],
    keywords: ['douyin presenter', 'short video structure', 'hook twist payoff', '起承转合', 'completion rate'],
    prompt_snippets: [
      'presenter stares directly into camera with skeptical expression',
      'zoom in shot transitions every 10 seconds',
      'large bold Chinese subtitle keywords floating on screen',
      'musical rhythm hit at twist moment',
    ],
    applies_to: ['digital_human', 'screenwriter', 'director'],
    source: '2024-2025 抖音知识博主爆款结构分析',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_dh_v2_tiktok_shop',
    collection: 'digital_human',
    subcategory: '带货脚本',
    title: 'TikTok Shop 海外带货脚本（GMV 千万级卖家共性）',
    summary: '海外 TikTok Shop 爆款带货的 6 段式：hook → problem → product → demo → social proof → urgency。',
    content: `TikTok Shop 美国/英国/东南亚市场 GMV 千万级卖家 2024-2025 爆款共性结构：

**1) Hook (0-3s)** — 视觉奇观或痛点冲突
- "Stop scrolling if you have ___"
- "I wish I found this 10 years ago"
- "This is the only ___ you need"
- 演员大表情 / 产品特写 / 快速切换

**2) Problem (3-8s)** — 具体痛点场景
- 真人演出"没有这个产品的惨状"
- 字幕叠加："Here's what everyone gets wrong"

**3) Product Reveal (8-15s)** — 产品亮相
- 产品包装开箱 / 360 度旋转
- 字幕大写品牌名 + 核心功能
- 配乐 drop 点

**4) Demo (15-35s)** — 真实使用演示
- 分屏 before / after
- 延时摄影 / 慢动作
- 3 个以上使用场景

**5) Social Proof (35-45s)** — 信任背书
- 用户评论截图滚动
- "Over 100k sold" / "5-star reviews"
- 创作者个人证言

**6) Urgency (45-60s)** — 紧迫感催单
- "Only 20 left"
- "Link in bio - limited time"
- "Use code XXX for 30% off"
- 最后一帧停留产品 + 折扣码 3 秒

**关键词差异**：
- 美国市场：benefit-driven（"saves time", "changes life"）
- 英国市场：understated quality（"actually works", "proper quality"）
- 东南亚市场：price + family（"affordable for family", "gift for mom"）

**AI 数字人做 TikTok Shop 的禁忌**：
- 不要用完美纯净主播（美国观众反感）
- 一定要有真实感缺陷（头发凌乱 / 家居背景 / 手持抖动感）
- 不要讲解超过 30 秒才出产品`,
    tags: ['tiktok shop', '海外带货', '跨境电商'],
    keywords: ['tiktok shop', 'gmv', 'social commerce', 'hook problem product demo proof urgency', 'ugc'],
    prompt_snippets: [
      'UGC style handheld camera, home background, natural lighting',
      'person showing surprised reaction while using product, split screen before and after',
      'text overlay with bold sans-serif font, scrolling customer reviews',
      'product packshot with discount code overlay',
    ],
    applies_to: ['digital_human', 'screenwriter', 'director'],
    source: 'TikTok Shop 2024-2025 美英东南亚市场千万级卖家公开案例分析',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_dh_v2_knowledge_course',
    collection: 'digital_human',
    subcategory: '口播话术',
    title: 'AI 知识付费课程口播结构化讲解（樊登/刘润/罗振宇模式）',
    summary: '30 分钟课程的四段式：悬念开场 → 故事引入 → 框架讲解 → 行动清单。',
    content: `2025 年知识付费头部创作者（樊登读书、刘润进化岛、罗辑思维）的课程口播共性：

**Part 1 悬念开场 (0-90s)**
- 提出一个"反直觉的问题"或"惊人数据"
- 承诺观看收益："今天这 30 分钟，我会给你一套 XX 方法"
- 约定结构："接下来我会讲 3 件事"
- 情绪：严肃 + 权威

**Part 2 故事引入 (90s-5min)**
- 一个真实案例或历史故事（不超过 3 分钟）
- 案例主角有名字、时间、地点（增加真实感）
- 故事结束提炼出"洞察"

**Part 3 框架讲解 (5-25min)**
- 3-5 个分论点，每个配 1 个例子
- 每论点结尾有"小结句"（金句）
- 每 5 分钟有一个"章节过渡"（画面切换 + 背景音乐变调）
- 配合图表屏显（不超过 1 屏 1 图）

**Part 4 行动清单 (25-30min)**
- 3-5 条可执行动作
- 鼓励笔记截图
- 预告下一期
- CTA：关注/订阅/买书

**数字人讲课的额外要求**：
- 每 2-3 分钟切换一次镜头（主讲景别 / 特写 / 屏显 / 资料画面）
- 背景 30% 虚化书架或演讲厅
- 手势以"指向屏幕" / "数指头" / "划重点"为主
- 禁止机械播报感 — 语速 1.0-1.15，每段有呼吸停顿`,
    tags: ['知识付费', '课程', '口播', '樊登', '刘润'],
    keywords: ['knowledge course', 'online learning', 'lecture structure', 'fan deng', 'liu run', 'luo zhenyu'],
    prompt_snippets: [
      'professional lecturer presenting to camera, blurred bookshelf background',
      'middle shot to medium close-up with occasional cutaway to screen graphics',
      'thoughtful hand gestures, pointing, counting, emphasizing',
    ],
    applies_to: ['digital_human', 'screenwriter', 'director'],
    source: '知识付费头部创作者 2023-2025 课程结构公开分析',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_dh_v2_virtual_idol',
    collection: 'digital_human',
    subcategory: '直播场景',
    title: '虚拟主播 V-tuber 与虚拟偶像运营公式',
    summary: 'V-tuber = 人设 + 世界观 + 技能 + 互动梗。AI 驱动虚拟偶像已成 2025 产业方向。',
    content: `虚拟主播 / 虚拟偶像运营的四大支柱：

**人设 (Persona)**
- 外形：二次元 / 3D / 半兽人 / 机娘 / 魔法少女
- 性格：阳光 / 腹黑 / 冷静 / 呆萌 / 大姐姐
- 口头禅：1-3 句标志性台词
- 禁区：不能脱人设

**世界观 (Worldview)**
- 来源故事：哪个星球 / 什么时代 / 什么身份
- 与现实世界的联系（比如"穿越而来"）
- 朋友圈：其他虚拟角色朋友
- 每期直播可引用的"角色档案"

**技能 (Skills)**
- 唱歌 / 跳舞 / 游戏 / 聊天 / 读书 / 教学
- 一定要至少 1 个"绝活"作为记忆点
- AI 驱动时代：实时对话 / 即时反馈

**互动梗 (Interaction Meme)**
- 固定问候仪式
- 弹幕互动固定回复
- 周期性活动（生日会 / 周年庆 / 打 Boss）
- 粉丝自己造的梗要主播主动复用

**AI 驱动虚拟偶像差异点**：
- 不再依赖中之人（背后演员）
- 24/7 在线直播
- 多语言同步
- 支持 1-on-1 私聊
- 典型案例：Neuro-sama (Vedal987) / 神椿市建造中 / 洛天依升级版 AI 模式`,
    tags: ['虚拟主播', 'vtuber', '虚拟偶像', 'AI主播'],
    keywords: ['vtuber', 'virtual idol', 'neuro-sama', 'ai streamer', 'virtual persona', 'persona design'],
    prompt_snippets: [
      'anime style virtual streamer, consistent character design, signature outfit',
      'stylized 2D avatar with expressive facial animations',
      'idol stage performance with particle effects and neon lighting',
    ],
    applies_to: ['digital_human', 'character_consistency'],
    source: 'V-tuber 行业 2023-2025 运营案例 + AI 驱动虚拟主播公开文档',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_dh_v2_avatar_emotion_curve',
    collection: 'digital_human',
    subcategory: '口型与表情',
    title: '数字人情绪曲线设计（一条口播的 5 种情绪节拍）',
    summary: '30 秒口播应该至少经历 3-5 次情绪切换，否则会被感知为"假人"。',
    content: `让数字人不假的秘诀不是更高的分辨率，而是情绪曲线。

**30 秒口播的情绪节拍模板**：
| 时间 | 情绪 | 表情关键词 |
|---|---|---|
| 0-3s | 期待 / 好奇 | eyes widen, slight smile, lean in |
| 3-10s | 严肃 / 思考 | neutral mouth, slight frown, straight gaze |
| 10-18s | 兴奋 / 强调 | raised eyebrows, open gesture, smile |
| 18-25s | 疑问 / 停顿 | head tilt, brow furrow, small pause |
| 25-30s | 确定 / 邀请 | confident smile, direct eye contact, open palm |

**情绪转换的物理细节**：
- 每次情绪切换前 0.3s 会先有眼神变化（不要嘴先变）
- 大情绪（惊讶 / 喜悦）会伴随轻微头部后仰或前倾
- 小情绪（思考 / 赞同）只动眼眉，头不动
- 呼吸节奏 — 严肃时慢 / 兴奋时快

**常见错误**：
- 整段一个表情（观众会马上察觉是 AI）
- 表情切换过于突兀（从冷漠直接到大笑）
- 情绪与语音内容脱节（说悲伤话却微笑）
- 眼神永远直视镜头（真人会偶尔偏离）`,
    tags: ['情绪', '微表情', '数字人', '自然度'],
    keywords: ['emotion curve', 'micro expression', 'digital human authenticity', 'expression timing'],
    prompt_snippets: [
      'eyes widen with curiosity, slight lean forward',
      'subtle frown and straight gaze for serious moments',
      'raised eyebrows and open palm gesture for emphasis',
      'head tilt and brow furrow for questioning beats',
    ],
    applies_to: ['digital_human', 'director', 'character_consistency'],
    source: '微表情研究 (Paul Ekman FACS) + 数字人制作实践',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_dh_v2_chinese_platforms',
    collection: 'digital_human',
    subcategory: '直播场景',
    title: '中国数字人工具链（硅基智能 / 腾讯智影 / 阿里通义万相 / 小冰 / 即构）',
    summary: '国产数字人平台选型：硅基主打直播带货、智影主打短视频、小冰主打情感陪伴、即构主打实时互动。',
    content: `2024-2025 中国主流数字人 SaaS：

**硅基智能 (Silicon Intelligence)**
- 核心能力：7×24 小时直播带货数字人
- 优势：中文口型同步顶尖，支持抖音/快手/视频号直播间挂载
- 劣势：需要购买算力包
- 典型用户：电商品牌 / MCN 机构

**腾讯智影 (Tencent Zenvideo)**
- 核心能力：企业 PPT 讲解 / 新闻播报 / 口播短视频
- 优势：接入微信生态，Avatar 模板丰富
- 劣势：定制化不如硅基
- 典型用户：企业品宣 / 培训

**阿里通义万相 (Tongyi Wanxiang)**
- 核心能力：电商主图/详情页数字人 + 模特换衣换脸
- 优势：淘宝直通车，商家 0 成本接入
- 典型用户：淘宝天猫卖家

**微软小冰 (Xiaoice)**
- 核心能力：情感陪伴对话 / 虚拟恋人 / AI 面试官
- 优势：对话情感引擎最强
- 典型用户：社交娱乐 / 招聘

**即构科技 (Zego)**
- 核心能力：实时音视频互动数字人（直播+连麦）
- 优势：低延迟 300ms
- 典型用户：直播平台 / 教育

**选型决策树**：
- 要做电商直播带货 → 硅基 / 即构
- 要做企业内部培训 → 腾讯智影 / HeyGen
- 要做电商主图 → 通义万相
- 要做情感陪伴 APP → 小冰 / Character.AI
- 要做短视频口播 → 硅基 + 小冰混用`,
    tags: ['国产数字人', 'saas', '硅基', '智影', '小冰'],
    keywords: ['silicon intelligence', 'tencent zenvideo', 'tongyi wanxiang', 'xiaoice', 'zego', '硅基智能', '腾讯智影'],
    prompt_snippets: [
      'Chinese e-commerce livestream anchor, product display table, bright studio lighting',
      'corporate Chinese presenter in suit, office background, professional tone',
      'friendly chatbot avatar, soft lighting, casual conversation tone',
    ],
    applies_to: ['digital_human'],
    source: '2024-2025 中国数字人 SaaS 行业公开报告 + 各厂商官方文档',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_dh_v2_streaming_setup',
    collection: 'digital_human',
    subcategory: '直播场景',
    title: '数字人直播间搭建清单（硬件 + 软件 + 话术池）',
    summary: '一个真实感强的数字人直播间需要：多机位 + 实时互动 + 话术库 + 场控员。',
    content: `2025 年主流数字人直播间标准配置：

**硬件层**
- 主机：1 张 RTX 4090 (24GB) 或 A6000 (48GB)
- 摄像头：虚拟摄像头（OBS Virtual Camera）
- 麦克风：不需要（TTS 合成）
- 灯光：后期合成，不需要实体
- 绿幕 / 真实场景：二选一

**软件层**
- 数字人引擎：硅基 / 腾讯智影 / Hedra / 即构
- 直播推流：OBS Studio + RTMP
- TTS 合成：ElevenLabs API / Fish Audio / MiniMax
- 话术调度：自研脚本库 + 定时触发
- 场控 GPT：实时分析弹幕，触发话术

**话术池（必备）**
- 欢迎语（按进入人数触发）
- 互动语（按弹幕关键词触发）
- 产品讲解（1 产品 = 1 话术包 30-60 秒）
- 催单语（按时间间隔触发）
- 异常应对（差评 / 比价 / 嘲讽 / 不相关提问）

**关键话术触发逻辑**：
- 每 5 秒扫描弹幕
- 每 45 秒重复一次核心卖点
- 每 3 分钟报一次"秒杀倒计时"
- 在线人数跌破阈值时切换"拉人话术"

**真实感加分项**：
- 数字人"抬头看镜头"的频率：每 20 秒 1 次
- 偶尔"翻车话术"：故意卡壳 0.5 秒（增真实感）
- 背景音效：键盘声 / 翻纸声 / 杯子放下声
- 场景道具变化：每 30 分钟换一件小道具`,
    tags: ['直播', '数字人', '直播间', '带货'],
    keywords: ['live streaming setup', 'digital human broadcast', 'obs virtual camera', 'livestream scripts pool'],
    prompt_snippets: [
      'modern livestream studio with soft warm lighting, product shelves in background',
      'digital human anchor with natural idle movements between product pitches',
      'multi-camera angle cuts every 30 seconds for visual variety',
    ],
    applies_to: ['digital_human', 'director'],
    source: '2024-2025 数字人直播带货行业实战配置',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_dh_v2_persona_archetypes',
    collection: 'digital_human',
    subcategory: '音色与人设',
    title: '10 个被验证有效的数字人人设原型',
    summary: '选对人设比选对产品更重要。10 个抖音/小红书验证过的高转化原型。',
    content: `**#1 邻家大姐姐** — 亲切、耐心、懂生活，适合家居/食品/美妆
  外貌：长发 / 温柔妆 / 米白色卫衣
  语调：温柔慢速 / 带笑意
  场景：厨房 / 客厅 / 阳台

**#2 专业顾问** — 权威、冷静、有数据，适合金融/保险/医疗
  外貌：西装衬衫 / 眼镜 / 办公室
  语调：沉稳 / 慢语速 / 专业术语
  场景：办公室 / 会议室 / 书房

**#3 元气少女** — 活泼、正能量、梗多，适合美妆/服饰/零食
  外貌：短发或马尾 / 学生妆 / 彩色穿搭
  语调：快速 / 高音 / 笑声多
  场景：卧室 / 咖啡厅 / 街拍

**#4 性冷淡 OL** — 高级感、不多话、一句顶一万句，适合奢品/护肤/配饰
  外貌：直发 / 裸妆 / 黑白灰
  语调：低沉 / 停顿多 / 气声
  场景：极简工作室 / 画廊 / 酒店

**#5 硬核老师傅** — 经验老道、敢说真话、接地气，适合数码/工具/食材
  外貌：工装 / 花白头发 / 围裙
  语调：浑厚 / 直白 / 偶尔骂人
  场景：车间 / 厨房 / 工地

**#6 佛系宅男** — 自嘲、深度、情绪稳定，适合游戏/数码/小众书籍
  外貌：T 恤 / 胡茬 / 乱发
  语调：低沉 / 反讽 / 冷幽默
  场景：房间 / 咖啡店角落

**#7 搞笑表情包** — 夸张、反转、二次元，适合快消品/零食/玩具
  外貌：夸张妆容 / 鬼畜道具
  语调：语速快 / 梗多 / 表情管理失控
  场景：道具间 / 绿幕 / 整蛊场景

**#8 学霸博士** — 知识密集、有引用、有图表，适合知识付费/保健品
  外貌：白衬衫 / 黑框眼镜 / 实验室
  语调：中速 / 清晰 / 有节奏
  场景：实验室 / 图书馆 / 讲台

**#9 文艺女孩** — 诗意、慢生活、有情怀，适合文创/咖啡/旅行/家居
  外貌：波西米亚 / 长裙 / 手工饰品
  语调：轻柔 / 停顿长 / 引用诗句
  场景：书店 / 咖啡馆 / 民宿

**#10 硬汉特警** — 力量、干脆、权威，适合户外/汽车/健身/男士用品
  外貌：短发 / 硬朗 / 战术装
  语调：低沉 / 简短 / 命令式
  场景：健身房 / 户外 / 训练场

**人设 lock 原则**：选定一个后，AI 数字人的外貌 / 场景 / 音色 / 话术风格四者必须全部匹配，不能混搭。`,
    tags: ['人设', '数字人', '原型', '选型'],
    keywords: ['persona archetype', 'digital human character design', 'casting', 'personality matching'],
    prompt_snippets: [
      'warm friendly big sister style in cozy home kitchen with soft natural light',
      'professional consultant in office with bookshelves, calm confident demeanor',
      'high energy cheerful girl in colorful casual outfit, studio background',
      'minimalist cold elegant OL in white gallery space, composed expression',
    ],
    applies_to: ['digital_human', 'character_consistency', 'screenwriter'],
    source: '抖音/小红书 2023-2025 高转化数字人内容分析',
    lang: 'zh-en',
    enabled: true,
  },
];
