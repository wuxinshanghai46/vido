/**
 * AI 团队/制片库 seed
 *
 * 覆盖 7 个新 agent 岗位的行业级知识：
 *   市场调研 / 艺术总监 / 文案策划 / 剪辑技巧 / 本地化 / 运营增长 / 制片协调
 *
 * 这些知识被注入到对应的新 agent（market_research / art_director /
 * copywriter / editor / localizer / growth_ops / executive_producer）
 */

module.exports = [

  // ═══════════════════════════════════════════════════
  // ① 市场调研（market_research）
  // ═══════════════════════════════════════════════════
  {
    id: 'kb_prod_mr_trending_tools',
    collection: 'production',
    subcategory: '市场调研',
    title: '内容热度监控工具链（TopHub / 新榜 / 蝉妈妈 / 飞瓜 / SocialBlade）',
    summary: '5 个必用热点监控工具 + 4 个维度的监控方法论（话题/账号/竞品/行业）。',
    content: `**国内监控工具清单**

| 工具 | 用途 | 付费 | 优势 |
|---|---|---|---|
| 新榜 newrank.cn | 公众号/视频号/小红书/抖音排行 | 部分免费 | 数据最全 |
| 蝉妈妈 chanmama.com | 抖音电商 + 达人数据 | 付费 | 电商数据权威 |
| 飞瓜数据 feigua.cn | 抖音/快手/B站 内容数据 | 付费 | 短视频实时 |
| TopHub tophub.today | 全网热榜聚合 | 免费 | 一站式 |
| 百度指数 index.baidu.com | 关键词搜索趋势 | 免费 | 长期趋势 |
| 微博热搜 | 实时社会热点 | 免费 | 最快 |

**海外监控工具**

| 工具 | 用途 | 付费 |
|---|---|---|
| Google Trends | 全球搜索趋势 | 免费 |
| SocialBlade | YouTube/TikTok/IG 账号数据 | 免费/付费 |
| TrendSpotter | TikTok 热点 | 付费 |
| Tubular Labs | YouTube 高级分析 | 付费 |
| BuzzSumo | 内容传播力 | 付费 |

**4 个监控维度**

**#1 话题监控（Topic Monitoring）**
- 关注每日热搜关键词
- 记录"突发性话题"（股票/明星/事件）
- 识别"长尾话题"（持续 3 天以上的）
- 按垂类细分（娱乐/财经/科技/情感）

**#2 账号监控（Account Monitoring）**
- 追踪同赛道头部 10-20 个账号
- 记录他们的发布频率/时间/内容类型
- 观察数据异常（某条突然爆量意味着选题对了）
- 分析他们的变现方式（带货/广告/接推广/引流私域）

**#3 竞品监控（Competitor Analysis）**
- 锁定 3-5 个直接竞品
- 内容层：选题/风格/节奏
- 数据层：播放/点赞/评论/完播
- 运营层：发布节奏/评论区运营/私信回复

**#4 行业监控（Industry Trend）**
- AI 视频工具更新（Sora/Veo/Kling 版本）
- 平台规则变化（抖音算法调整/TikTok 政策）
- 监管动态（短剧备案/广告法）
- 新兴赛道信号（AI 漫剧/数字人/AI 短剧）

**每周调研工作流**
- 周一：刷新 TopHub + 百度指数（大盘趋势）
- 周三：查蝉妈妈/飞瓜（竞品数据）
- 周五：Google Trends（海外趋势）
- 月底：综合生成月报`,
    tags: ['市场调研', '工具', '热度监控', '新榜', '蝉妈妈'],
    keywords: ['trend monitoring', 'competitor analysis', 'chanmama', 'xinbang', 'google trends', 'tophub', 'viral detection'],
    prompt_snippets: [
      '检索"AI 漫剧" 近 30 天全网热度趋势',
      '分析抖音短剧赛道 Top 10 账号 7 日数据',
      '对比国内 vs 海外 TikTok 同类型内容表现',
    ],
    applies_to: ['market_research', 'executive_producer'],
    source: '新榜/蝉妈妈/飞瓜/SocialBlade 等工具公开文档 + 行业实战',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_prod_mr_competitor_framework',
    collection: 'production',
    subcategory: '市场调研',
    title: '短剧 / AI 漫剧竞品分析三维框架（内容 × 投流 × 数据）',
    summary: '竞品分析 = 内容拆解 + 投流策略 + 数据追踪。三维才能看清对手的"套路-流量-转化"。',
    content: `**维度一：内容拆解**

每个竞品需要分析的内容参数：
1. **题材**：爽文/甜宠/重生/战神/悬疑...
2. **钩子**：开场 3 秒的钩子类型
3. **节奏**：ASL 平均镜头长度
4. **爽点密度**：60 秒内有几次兑现
5. **角色设定**：几个主角+几个反派+人设标签
6. **视觉风格**：色调/光影/服化道
7. **标题公式**：他们的爆款标题有何共性
8. **结尾钩子**：每集怎么留住观众

**拆解工具**：用表格记录 20 集数据，找规律。

**维度二：投流策略**

1. **投放平台**：巨量引擎 vs 磁力金牛 vs 千川
2. **素材类型**：完整集 vs 精剪集 vs 预告
3. **素材时长**：15s / 30s / 60s
4. **投放时段**：早 7-9 / 午 12-14 / 晚 19-22
5. **定向人群**：年龄/性别/地域/兴趣
6. **消耗量**：通过第三方工具（App Growing / 广大大）估算

**维度三：数据追踪**

1. **播放量**：总播放 + 首日播放
2. **完播率**：15s / 30s / 60s 完播
3. **互动率**：点赞/评论/分享/收藏
4. **留存率**：第二集观看率 / 第十集观看率
5. **转化率**：付费/加粉/私域转化
6. **ROI**：投流成本 vs 收入（付费短剧可估算）

**综合评分模型**

给每个竞品打分（100 分满）：
- 内容力 40 分：题材稀缺 + 执行品质 + 完成度
- 流量力 30 分：投流规模 + 算法推荐
- 转化力 30 分：付费率 + 留存 + ARPU

**结论产出**
- 可模仿的：Top 3 爆款共性
- 可超越的：对方的弱点
- 可错位的：他们没做过的题材

**分析模板示例**
\`\`\`markdown
## 竞品 A: 《XXX 短剧》
- 题材：重生复仇
- 内容评分：35/40 （视觉好，节奏慢）
- 流量评分：28/30 （投流大）
- 转化评分：20/30 （付费率不高）
- 总分：83/100
- 模仿点：开场打脸钩子
- 超越点：节奏可加快
- 数据来源：蝉妈妈 2025-04-01 ~ 2025-04-07
\`\`\``,
    tags: ['竞品分析', '三维框架', '内容', '投流', '数据'],
    keywords: ['competitor analysis', 'content breakdown', 'traffic strategy', 'data tracking', 'benchmark'],
    prompt_snippets: [
      '从内容/投流/数据三维度分析竞品',
      '识别 Top 10 爆款短剧的共性元素',
      '对比自己账号与竞品的完播率差距',
    ],
    applies_to: ['market_research', 'executive_producer', 'growth_ops'],
    source: '短剧行业竞品分析实战 + 投流平台数据模型',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_prod_mr_ai_video_2025',
    collection: 'production',
    subcategory: '市场调研',
    title: 'AI 视频行业趋势追踪（2025 工具链与模型更新速览）',
    summary: '2025 年 AI 视频工具生态：文生视频 / 图生视频 / 口型同步 / 配音 / 编辑 / 分发 全栈速览。',
    content: `**文生视频 / 图生视频（核心引擎）**

| 模型 | 厂商 | 时长 | 音频 | 价格 | 优势 |
|---|---|---|---|---|---|
| Sora 2 | OpenAI | 60s | ✓ | 高 | 物理+长镜头 |
| Veo 3.1 | Google | 60s+ | ✓ | 中 | Ingredients 参考图 |
| Kling 2.5 | 快手 | 10s | ✓ | 低 | 中文+首尾帧 |
| Runway Gen-4 | Runway | 10s+ | ✗ | 中 | References / Act One |
| Luma Dream Machine | Luma | 5s | ✗ | 低 | 动作流畅 |
| Pika 2.1 | Pika | 10s | ✓ | 低 | Ingredients |
| Minimax Hailuo | Minimax | 6s | ✗ | 低 | 人物一致性 |
| Hunyuan Video | 腾讯 | 10s | ✗ | 开源 | 可本地部署 |
| Wan 2.1 | 阿里 | 5s | ✗ | 开源 | 可本地部署 |
| Seedance 2.0 | 字节 | 10s | ✓ | 中 | 多镜头叙事 |
| Seedream 5.0 | 字节 | 图像 | - | 中 | 文生图+材质 |

**数字人/Avatar**

| 工具 | 类型 | 特点 |
|---|---|---|
| HeyGen Avatar IV | 商用 | 企业级，多语言 |
| Synthesia | 商用 | 企业培训首选 |
| D-ID Agents | 商用 | API 客服对话 |
| Hedra Character 3 | 商用 | 情感表达强 |
| 硅基智能 | 商用 | 中文直播带货 |
| 腾讯智影 | 商用 | 中文口播短视频 |
| MuseTalk | 开源 | 实时中文 |
| LivePortrait | 开源 | 短视频口播 |
| Wav2Lip | 开源 | 快速原型 |
| SadTalker | 开源 | 社交短片 |

**配音/TTS**

| 工具 | 中文 | 英文 | 克隆 | 情感 |
|---|---|---|---|---|
| ElevenLabs | ✓ | ★★★★★ | ★★★★★ | ★★★★★ |
| Fish Audio | ★★★★★ | ✓ | ★★★★ | ★★★★ |
| MiniMax Speech-02 | ★★★★★ | ✓ | ★★★ | ★★★★★ |
| XTTS-v2 | ✓ | ✓ | ★★★ | ★★★ |
| 微软 Edge TTS | ★★★★ | ★★★★ | ✗ | ★★ |

**AI 编辑/剪辑**

| 工具 | 功能 |
|---|---|
| Adobe Premiere + Sensei | 智能剪辑/自动字幕 |
| 剪映 / CapCut | AI 智能剪辑 + 模板 |
| Runway | 风格迁移 + 抠图 |
| RunwayML | V2V 视频到视频 |
| Descript | 文字编辑视频 |

**AI 字幕/翻译**

| 工具 | 功能 |
|---|---|
| Whisper (OpenAI) | 语音识别（开源顶级） |
| Deepgram | 实时语音识别 |
| RecCloud | 多语言翻译字幕 |
| DeepL | 高质量翻译 |

**变现平台**

| 平台 | 类型 | 特点 |
|---|---|---|
| ReelShort | 海外短剧 | 付费订阅 |
| DramaBox | 海外短剧 | 付费订阅 |
| FlexTV | 海外短剧 | 免费+广告 |
| 红果短剧 | 国内免费 | 番茄系 |
| 河马短剧 | 国内免费 | 广告模式 |
| 抖音/快手 | 免费+付费 | 平台分成 |

**每月更新机制**
- 第一周：追踪各厂商发布 + GitHub trending
- 第二周：实测新模型 + 对比评测
- 第三周：更新工作流
- 第四周：输出月报

**关键信号**
- 某模型突然降价 → 可能有新模型要发
- 某工具停止更新 → 可能被收购或倒闭
- 开源模型达到商用水平 → 降本机会
- 海外付费规模扩大 → 出海窗口期`,
    tags: ['AI视频', '行业趋势', '工具链', '2025'],
    keywords: ['ai video trends', 'generative video 2025', 'sora veo kling runway', 'tool landscape'],
    prompt_snippets: [
      '追踪 2025 年 AI 视频模型更新动态',
      '对比同类视频模型的价格和时长限制',
      '识别即将到来的 AI 视频赛道窗口期',
    ],
    applies_to: ['market_research', 'executive_producer'],
    source: '2024-2025 AI 视频厂商官方文档 + 行业公开评测',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_prod_mr_user_persona',
    collection: 'production',
    subcategory: '市场调研',
    title: '目标用户画像 5W1H 建模（为 AI 漫剧精准选题）',
    summary: '用户画像 = Who / What / When / Where / Why / How。六个维度建模才能选对题材。',
    content: `**5W1H 用户建模**

**Who（是谁）**
- 性别：男 / 女 / 通吃
- 年龄：18-24 / 25-34 / 35-44 / 45+
- 职业：学生 / 白领 / 宝妈 / 蓝领 / 老年
- 收入：低 / 中 / 高
- 学历：初中 / 高中 / 大学 / 研究生
- 地域：一线 / 二线 / 三四线 / 海外

**What（爱看什么）**
- 题材偏好：甜宠 / 战神 / 重生 / 悬疑 / 搞笑
- 人设偏好：霸总 / 傲娇 / 腹黑 / 傻白甜 / 御姐
- 情绪偏好：爽 / 虐 / 甜 / 燃 / 催泪
- 节奏偏好：快剪 / 慢节奏 / 长剧 / 短剧
- 时长偏好：15 秒 / 60 秒 / 3 分钟 / 长剧集

**When（什么时候看）**
- 时间段：早通勤 / 午休 / 下班后 / 睡前 / 周末
- 场景：地铁 / 餐桌 / 沙发 / 床上 / 工位
- 时长：碎片 < 5min / 短 5-15min / 长 > 15min
- 频率：每日刷 / 每周追 / 偶尔看

**Where（在哪里看）**
- 平台：抖音 / 快手 / 视频号 / 小红书 / B 站 / YouTube / TikTok / Instagram
- 设备：手机竖屏 / 手机横屏 / 平板 / 电视
- 网络：WiFi / 流量 / 无网（离线下载）
- 屏幕：5-6 寸手机为主 = 视频必须竖屏 9:16

**Why（为什么看）**
- 娱乐放松：消遣 / 减压
- 情感代入：恋爱 / 成功 / 复仇
- 学习成长：知识 / 技能 / 认知
- 社交谈资：热点 / 梗 / 谈资
- 陪伴感：孤独 / 失眠

**How（怎么发现）**
- 算法推荐：刷到的
- 主动搜索：搜关键词
- 朋友分享：转发来的
- 账号追更：关注的博主
- 热搜点击：从话题过来

**典型 AI 漫剧用户画像示例**

**画像 A：下沉市场宝妈（甜宠重生观众）**
- 女，30-45，三四线，初高中学历，家庭主妇/蓝领
- 爱看：甜宠 / 重生 / 霸总 / 萌宝
- 时间：中午 12-14 / 晚上 20-22
- 平台：抖音 / 快手 / 红果
- 动机：情感代入 + 逃避现实
- 发现：算法推荐为主
- 设备：低价安卓手机
- 付费意愿：1-10 元/部短剧

**画像 B：一线白领女性（悬疑情感观众）**
- 女，25-35，一二线，本科+，白领
- 爱看：悬疑 / 情感 / 古偶 / 韩剧
- 时间：睡前 22-24 / 地铁通勤
- 平台：B站 / 小红书 / 爱奇艺
- 动机：精神满足 + 谈资
- 发现：评分/推荐/朋友转发
- 设备：iPhone / iPad
- 付费意愿：高（会员制）

**画像 C：男频下沉市场（战神爽文观众）**
- 男，25-45，三四线，中低学历，蓝领/自由职业
- 爱看：战神 / 龙王 / 赘婿 / 都市异能
- 时间：午休 / 晚饭后
- 平台：抖音 / 快手 / 番茄小说
- 动机：爽感代入 + 逆袭幻想
- 发现：算法推荐
- 设备：普通安卓
- 付费意愿：低-中（免费看广告）

**画像决定一切**
- 画像 A → 做甜宠萌宝重生题材
- 画像 B → 做高质量悬疑古偶
- 画像 C → 做战神爽文投流短剧

**禁忌**
- 不要做"全年龄段"内容（会变平庸）
- 不要忽略画像验证（做了才发现没人看）
- 不要混淆画像（一部戏服务一个画像）`,
    tags: ['用户画像', '5W1H', '目标用户', '定位'],
    keywords: ['user persona', '5w1h', 'target audience', 'user segmentation', 'audience research'],
    prompt_snippets: [
      '为新项目建立目标用户 5W1H 画像',
      '针对下沉市场宝妈的甜宠短剧',
      '针对一线白领女性的高质量悬疑',
    ],
    applies_to: ['market_research', 'executive_producer', 'screenwriter'],
    source: '用户画像方法论 + 短剧平台用户数据公开分析',
    lang: 'zh',
    enabled: true,
  },

  // ═══════════════════════════════════════════════════
  // ② 艺术总监（art_director）
  // ═══════════════════════════════════════════════════
  {
    id: 'kb_prod_ad_style_bible',
    collection: 'production',
    subcategory: '艺术总监',
    title: '系列 Style Bible 模板（视觉一致性手册）',
    summary: 'Style Bible 是一部戏的视觉圣经。锁定色彩 / 光线 / 服化 / 场景 / 特效 五大维度。',
    content: `**Style Bible 标准模板**

任何一部戏开拍前必须有的视觉手册。

**第一部分：色彩系统**

**主色板（5 色）**
- 主色 Primary：出现在 60% 画面
- 辅色 Secondary：出现在 25% 画面
- 点缀色 Accent：出现在 10% 画面
- 阴影色 Shadow：暗部基调
- 高光色 Highlight：亮部基调

例（一部复古爱情剧）：
\`\`\`
Primary: warm cream #F5E8D5
Secondary: dusty rose #D4A5A5
Accent: gold #D4AF37
Shadow: deep brown #3E2F2F
Highlight: soft cream #FFF8F0
\`\`\`

**情绪色板变体**
- 日常：主色板
- 冲突：低饱和
- 回忆：褪色
- 高潮：高饱和

**第二部分：光线系统**

- **主光类型**：自然日光 / 实景灯光 / studio 柔光 / 硬光
- **光线方向**：正面 / 侧面 / 逆光 / 顶光 / 底光
- **色温**：2800K 暖 / 4500K 中 / 6500K 冷
- **对比度**：高 / 中 / 低
- **阴影**：硬 / 柔

**示例**：
\`\`\`
主光：自然窗光 + 实景烛光补光
方向：侧光 45 度
色温：3000K 暖
对比度：中高
阴影：柔和
\`\`\`

**第三部分：服化道**

**服装锚点**
- 主角日常服：1-3 套
- 特殊场合服：3-5 套
- 色彩规则：与色板一致
- 面料：织物类型（丝 / 棉 / 毛）

**妆容锚点**
- 主角妆容：眉形 / 唇色 / 眼影
- 反派妆容：对比色
- 自然光下的妆容：少油光 / 浅粉底

**道具锚点**
- 关键道具：信物 / 武器 / 项链
- 反复出现的小物品
- 载具：车 / 船 / 马

**第四部分：场景**

**场景清单**
- 主场景 A：主角家（内外）
- 主场景 B：工作场所
- 特殊场景：婚礼 / 医院 / 海边

**每个场景的视觉参数**
- 空间比例：宽 / 窄
- 材质：木 / 石 / 金属 / 织物
- 装饰风格：极简 / 繁复 / 复古
- 灯光布置：几盏灯 + 位置

**第五部分：特效 / 后期**

- **滤镜**：LUT 或色调
- **颗粒**：Film grain 强度
- **暗角**：Vignette 强度
- **光晕**：Halation / Bloom
- **暗部细节**：Crushed or detailed

**完整 Style Bible 示例（30 秒展示页）**

\`\`\`
Project: 《重生之千金归来》
Genre: 女频重生爽文
Target: 下沉市场宝妈

COLORS:
- Primary: warm gold #C9A66B
- Secondary: burgundy #6B1D1D
- Accent: pearl white #F5F5F0
- Shadow: deep brown #2D1810
- Highlight: cream #FFF9E6

LIGHTING:
- Source: window light + practical lamps
- Direction: side + backlight
- Color temp: 3200K warm
- Contrast: medium-high
- Shadows: soft

WARDROBE:
- Protagonist: silk qipao (burgundy/gold/cream)
- Villain: modern black suit with gold accents
- Supporting: modern casual warm tones

LOCATIONS:
- Mansion interior (warm wood, gold)
- Office tower (cold contrast when villain)
- Garden (soft backlight afternoon)

VFX:
- LUT: warm filmic
- Film grain: 5%
- Vignette: 15% soft
- Halation: on practical lights
\`\`\`

**这份 Bible 给到所有 agent（导演/编剧/氛围/人物一致性）后，整部戏的视觉统一性就锁定了。**`,
    tags: ['style bible', '艺术总监', '视觉一致性', '系列美学'],
    keywords: ['style bible', 'visual bible', 'art direction', 'color palette', 'production design', 'visual consistency'],
    prompt_snippets: [
      '建立 5 色主色板 + 情绪色板变体',
      '锁定光线方向 / 色温 / 对比度',
      '定义主角日常服与特殊场合服的视觉规则',
      '统一 LUT / film grain / vignette / halation 的强度',
    ],
    applies_to: ['art_director', 'director', 'atmosphere', 'character_consistency', 'executive_producer'],
    source: '好莱坞 Production Design 工作流 + 系列剧美学管理实践',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_prod_ad_color_psychology',
    collection: 'production',
    subcategory: '艺术总监',
    title: '色彩心理学 × 情绪映射（12 色 × 场景速查表）',
    summary: '每种色彩对应的情绪是被验证过的。12 色 × 典型场景 × AI 漫剧应用的速查。',
    content: `**12 色情绪映射速查表**

| 色彩 | 情绪 | 典型场景 | AI 漫剧应用 |
|---|---|---|---|
| 红 Red | 热情/危险/爱/愤怒 | 婚礼/战斗/警告 | 爽文爆发镜头 |
| 橙 Orange | 温暖/活力/乐观 | 日落/秋天/家庭 | 温馨家庭戏 |
| 黄 Yellow | 欢乐/警告/幼稚 | 夏天/校园/童年 | 校园青春剧 |
| 绿 Green | 自然/嫉妒/治愈 | 森林/医院/花园 | 治愈系 / 反派毒 |
| 青 Cyan | 冷静/科技/未来 | 实验室/赛博/水下 | 科幻 / 冷峻 |
| 蓝 Blue | 忧郁/信任/孤独 | 夜景/海洋/警察 | 悬疑 / 孤独 |
| 紫 Purple | 神秘/奢华/魔幻 | 魔法/皇室/黄昏 | 仙侠 / 奢华 |
| 粉 Pink | 浪漫/甜美/少女 | 爱情/化妆/儿童 | 甜宠 / 少女 |
| 白 White | 纯洁/空虚/医院 | 婚纱/雪/死亡 | 纯爱 / 死亡 |
| 黑 Black | 神秘/死亡/高级 | 葬礼/奢品/夜 | 悬疑 / 奢华 |
| 灰 Grey | 中性/冷漠/都市 | 办公室/水泥 | 都市职场 |
| 金 Gold | 财富/神圣/成功 | 皇宫/奖杯/神庙 | 古装 / 帝王 |

**颜色组合规则（色轮理论）**

**1. 互补色（Complementary）**
- 红 + 绿、蓝 + 橙、紫 + 黄
- 效果：极致对比，强烈张力
- 适用：海报 / 关键镜头
- 代表：《黑客帝国》绿 + 橙

**2. 类比色（Analogous）**
- 相邻 3 色（如红+橙+黄）
- 效果：和谐温暖
- 适用：日常场景 / 情感戏
- 代表：日系动漫常用

**3. 三角色（Triadic）**
- 色轮上三等分的 3 色
- 效果：平衡有活力
- 适用：动画 / 品牌
- 代表：Pixar 配色

**4. 分割互补（Split Complementary）**
- 1 主色 + 互补色两侧 2 色
- 效果：柔和的对比
- 适用：大多数电影
- 代表：《银翼杀手 2049》橙蓝紫

**5. 四元色（Tetradic）**
- 两组互补色
- 效果：丰富复杂
- 难度：最高
- 适用：史诗片

**6. 单色（Monochromatic）**
- 单一色相的不同明度
- 效果：极简统一
- 适用：文艺片
- 代表：《Dune》沙色渐变

**色彩情绪曲线（一部戏的色彩变化）**

**冲突型曲线（悬疑/动作）**
- 开场：中性灰
- 升温：冷蓝
- 高潮：红
- 结尾：中性灰

**浪漫型曲线（甜宠/情感）**
- 开场：暖白
- 升温：暖金
- 高潮：粉红
- 结尾：柔和暖

**史诗型曲线（战争/末日）**
- 开场：金橙
- 冲突：棕灰
- 最低：黑
- 希望：白/蓝

**色彩禁忌**

- 不要用纯黑背景配纯白主角（会显得廉价）
- 不要用 5 种以上对比色（会乱）
- 不要忽略文化差异（红 = 喜庆 vs 红 = 危险）
- 不要让背景色与主角色冲突（主角会被吞没）

**AI 漫剧色彩应用建议**

对每部剧在 Style Bible 中锁定：
1. 选 1 种色彩组合理论
2. 确定情绪曲线
3. 所有镜头 prompt 必须标注色板
4. 用色板反推 LUT 名称

**色彩 prompt 示例**
\`\`\`
# 爽文复仇（冷蓝冷峻）
cool blue monochromatic palette, desaturated shadows,
split complementary with orange accents for conflict moments

# 甜宠温馨（暖金柔光）
warm analogous palette of gold yellow orange,
soft lifted shadows, creamy highlights

# 仙侠唯美（梦幻紫青）
purple and cyan split complementary,
ethereal mist, silver highlights, fantasy atmosphere
\`\`\``,
    tags: ['色彩', '情绪', '色轮', '艺术总监'],
    keywords: ['color psychology', 'color wheel', 'complementary', 'analogous', 'triadic', 'monochromatic', 'mood mapping'],
    prompt_snippets: [
      'cool blue monochromatic palette with orange conflict accents',
      'warm analogous palette of gold yellow orange, cream highlights',
      'purple and cyan split complementary for fantasy atmosphere',
      'triadic color scheme with bold primary colors',
    ],
    applies_to: ['art_director', 'atmosphere', 'director'],
    source: '色彩心理学（Eva Heller）+ 电影调色理论 + 色轮配色法',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_prod_ad_moodboard',
    collection: 'production',
    subcategory: '艺术总监',
    title: 'Moodboard 情绪板构建法（从灵感到可执行）',
    summary: 'Moodboard = 15-30 张参考图的集合，把抽象"氛围"变成可执行的视觉语言。',
    content: `**Moodboard 是什么**

情绪板是艺术总监的第一份产出，把导演和编剧脑子里的"感觉"变成 15-30 张参考图的集合，让所有团队对视觉方向达成共识。

**Moodboard 的 5 个板块**

**1. Color 色彩板 (3-5 张)**
- 色卡图（直接提取主色）
- 有代表性的场景截图
- 色调样本

**2. Lighting 光影板 (3-5 张)**
- 不同时刻的打光案例
- 关键场景的灯光参考
- 光比示例

**3. Composition 构图板 (3-5 张)**
- 经典构图样本
- 景别参考
- 镜头运动样本

**4. Wardrobe 服化板 (3-5 张)**
- 主角服装参考
- 妆容参考
- 发型参考

**5. Texture 质感板 (3-5 张)**
- 材质近景
- 皮肤 / 织物 / 金属 / 木材质感

**Moodboard 制作工具**

| 工具 | 特点 | 付费 |
|---|---|---|
| Pinterest | 灵感收集 | 免费 |
| Milanote | 专业情绪板 | 免费+付费 |
| Figma | 团队协作 | 免费+付费 |
| Miro | 白板 + 情绪板 | 免费+付费 |
| PureRef | 桌面参考图 | 免费 |

**Moodboard 的信息来源**

- **电影截图**：Film-Grab、Shot Deck
- **品牌广告**：ADS of the World
- **时尚摄影**：Vogue / Harper's Bazaar
- **艺术作品**：Artstation、Behance
- **游戏截图**：The Art Of
- **真实生活**：Unsplash / Pexels

**Moodboard 制作工作流**

**Step 1: 用关键词搜索 (30 min)**
- 把剧本里的场景 / 情绪 / 题材翻译成英文关键词
- 在 Pinterest 搜索：mood board + 关键词
- 广撒网收集 50-100 张

**Step 2: 快速筛选 (15 min)**
- 从 100 张选 30-40 张
- 标准：视觉冲击力 + 与主题一致 + 可执行

**Step 3: 分类整理 (30 min)**
- 按 5 个板块分类
- 每类留 3-5 张最强的
- 剔除重复感觉的

**Step 4: 色彩提取 (15 min)**
- 用 Coolors / Adobe Color 提取主色
- 生成色板

**Step 5: 输出 Bible (30 min)**
- 整合到 Style Bible 文档
- 加说明文字
- 分享给团队

**Moodboard 的使用原则**

**1. 不是抄袭而是参考**
- 找到感觉的"锚点"
- 不照搬构图

**2. 保持视觉一致性**
- 30 张图必须有共同的感觉
- 如果一张突兀就删掉

**3. 给导演+AI agent 双重使用**
- 导演：看感觉
- AI：把图作为 reference image 输入到 Runway Gen-4 / Veo 3.1 Ingredients

**4. 更新而非丢弃**
- 拍摄中发现更好的参考 → 更新 moodboard
- 项目结束后归档作为下个项目灵感

**AI 漫剧 Moodboard 模板示例**

**项目：《沙漠末日》**

**Color Board:**
- Dune movie still (amber sky)
- Mad Max Fury Road (rust and orange)
- Breaking Bad desert scene
- Sahara sunset photography

**Lighting Board:**
- Harsh noon sun casting hard shadows
- Practical fire light at night
- Dust particles in god rays
- Low-angle silhouette against sky

**Composition Board:**
- Wide establishing shot of lone figure in vast desert
- Extreme close-up on weathered hands
- Low-angle hero shot
- Aerial drone shot of caravan

**Wardrobe Board:**
- Tattered leather coat
- Dust-covered goggles
- Face wraps
- Scavenged gear

**Texture Board:**
- Cracked dry earth
- Rusted metal
- Sand particles
- Weathered leather

**输出**
\`\`\`
color palette: amber #D9A14A, rust #B0462C,
sand beige #C8B993, deep brown #3D2817, sky blue #6D8EAE

key lighting: harsh noon sun 5500K, practical fires at night 2000K

wardrobe anchor: weathered leather + tattered fabric + goggles

texture priority: sand, rust, leather, cracked skin
\`\`\``,
    tags: ['moodboard', '情绪板', '艺术总监', '参考'],
    keywords: ['moodboard', 'visual reference', 'pinterest', 'style guide', 'inspiration board', 'shot deck', 'film grab'],
    prompt_snippets: [
      'collect 30 reference images grouped into color/light/composition/wardrobe/texture',
      'extract primary color palette from reference screenshots',
      'establish visual mood anchor for the entire series',
    ],
    applies_to: ['art_director', 'director', 'executive_producer'],
    source: '电影艺术指导工作流 + Moodboard 行业实践',
    lang: 'zh-en',
    enabled: true,
  },

  // ═══════════════════════════════════════════════════
  // ③ 文案策划（copywriter）
  // ═══════════════════════════════════════════════════
  {
    id: 'kb_prod_cw_title_100',
    collection: 'production',
    subcategory: '文案策划',
    title: '爆款视频标题 100 条公式（分类 + 套用模板）',
    summary: '标题是流量第一入口。10 大类 × 10 种公式 = 100 条可直接套用的爆款模板。',
    content: `**10 大类爆款标题公式**

**Type 1: 数字型（权威感）**
1. 《90% 的人不知道 XX 的真相》
2. 《用 3 天赚 10 万，只因做对了这件事》
3. 《5 个 XX 的方法，第 4 个最致命》
4. 《1 年 / 10 年 / 100 年后，你会后悔这件事》
5. 《月薪 3000 到月薪 3 万，我只用了 1 招》

**Type 2: 悬念型（好奇心）**
1. 《千万别 XX，除非你想……》
2. 《没想到 XX 竟然是这样》
3. 《看完这个你再也不敢 XX 了》
4. 《XX 背后的真相，让人细思极恐》
5. 《XX 的秘密终于被揭开》

**Type 3: 疑问型（互动感）**
1. 《你知道 XX 是怎么来的吗？》
2. 《为什么 XX 一夜爆火？》
3. 《XX 和 YY 到底有什么区别？》
4. 《如果 XX，你会怎么办？》
5. 《你还在 XX 吗？》

**Type 4: 对比型（反差）**
1. 《XX vs YY，结果让人意外》
2. 《从 XX 到 YY，发生了什么？》
3. 《XX 的 A 面和 B 面》
4. 《别人的 XX vs 我的 XX》
5. 《10 年前的 XX vs 现在的 XX》

**Type 5: 结果型（承诺）**
1. 《只需 3 分钟，让你 XX》
2. 《教你如何 XX，不看后悔》
3. 《学会 XX，直接起飞》
4. 《照做就能 XX》
5. 《30 天改变 XX，亲测有效》

**Type 6: 反转型（意外）**
1. 《她本以为 XX，没想到……》
2. 《XX 以为自己赢了，结果……》
3. 《看似 XX，其实 YY》
4. 《剧情反转了！XX 竟然是 YY》
5. 《我本来想 XX，结果……》

**Type 7: 身份型（权威）**
1. 《从业 10 年的 XX 告诉你》
2. 《清华博士 / 硅谷工程师都在用的 XX 方法》
3. 《XX 专家亲自教你》
4. 《某明星御用 XX 分享》
5. 《我是 XX，我来告诉你真相》

**Type 8: 情感型（共鸣）**
1. 《看完我哭了……》
2. 《这才是真正的 XX》
3. 《致所有正在 XX 的人》
4. 《如果你也 XX，请看这个》
5. 《泪目了，XX 的故事》

**Type 9: 行动型（紧迫感）**
1. 《现在就做，否则就晚了》
2. 《再不 XX 你就真的 OUT 了》
3. 《速看！XX 即将 YY》
4. 《抓紧时间，XX 就剩最后 XX 天》
5. 《今天不说，明天就没机会了》

**Type 10: 故事型（叙事）**
1. 《我是 XX，这是我的故事》
2. 《一个 XX 的真实经历》
3. 《XX 教会我的事》
4. 《那天 XX 改变了我的一生》
5. 《没人相信，但这就是我的 XX》

**标题公式叠加**

爆款 = 多种公式叠加：

- **数字 + 悬念**：《我 30 岁做了这件事，后来……》
- **反转 + 情感**：《她以为这是终点，没想到是新开始，看哭了》
- **对比 + 疑问**：《同样是 XX，为什么别人能 YY 而我不行？》
- **身份 + 结果**：《顶级摄影师教你 30 秒拍大片》

**AI 漫剧 / 短剧标题风格**

**甜宠霸总型**
- 《豪门千金回家复仇，却被 CEO 一眼认定》
- 《她重生回来，这次绝不嫁给渣男》
- 《被全家误会的她，其实是……》

**战神龙王型**
- 《被全家轻视的上门女婿，竟然是……》
- 《废物小子隐藏了 10 年，真实身份吓到所有人》
- 《他是保安，也是……》

**悬疑反转型**
- 《闺蜜突然消失，我发现了震惊的秘密》
- 《每天清晨，他都在做同一件事，直到……》
- 《死去的人出现在她家门口》

**情感催泪型**
- 《分别十年后，他在街角看到了她》
- 《妈妈走后，我才明白她说的那句话》
- 《这是我奶奶的最后一天》

**标题禁忌**

- ❌ 不要超过 25 字（手机屏显不全）
- ❌ 不要纯悬念没信息（观众不点）
- ❌ 不要直接剧透结局
- ❌ 不要低俗 / 擦边（会被限流）
- ❌ 不要全网重复（没差异化）

**标题 A/B 测试建议**

对同一个视频生成 5-10 个标题变体，投流测试点击率，找到最高的那个再大规模投放。

爆款标题的点击率通常比普通标题高 2-5 倍。`,
    tags: ['标题', '文案', '爆款', '公式'],
    keywords: ['viral title', 'copywriting formula', 'clickbait', 'hook title', '爆款标题'],
    prompt_snippets: [
      '用"数字+悬念"公式生成标题变体',
      '用"反转+情感"公式生成催泪标题',
      '为同一视频生成 5 种不同风格的标题 A/B 测试',
    ],
    applies_to: ['copywriter', 'growth_ops', 'screenwriter'],
    source: '抖音/TikTok/YouTube 2020-2025 爆款标题大数据分析',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_prod_cw_platform_diff',
    collection: 'production',
    subcategory: '文案策划',
    title: '各平台文案风格对比（抖音/小红书/B站/快手/TikTok/YouTube/Instagram）',
    summary: '不同平台的用户和算法完全不同，同一个内容要用 7 种不同的文案包装。',
    content: `**平台文案风格速查表**

**#1 抖音（Douyin）**
- 用户：全年龄，下沉偏多
- 语调：直接 / 情绪化 / 悬念
- 长度：15-25 字（黄金长度）
- Hashtag：3-5 个
- 表情：适度（1-3 个）
- 公式：钩子 + 爽点 + hashtag
- 示例：《她被赶出家门的第二天，就开上了豪车... #重生 #爽文 #短剧》

**#2 小红书（Xiaohongshu）**
- 用户：一二线女性，25-35 为主
- 语调：精致 / 种草 / 干货
- 长度：标题 20-30 字 + 正文 100-300 字
- Hashtag：10-20 个
- 表情：多 (3-10 个 emoji)
- 公式：干货 + 精致生活 + 细节
- 示例：《✨30 岁转型做自媒体，我走的弯路千万别再走 | 独居女性必看干货📝 #自媒体 #独居女性 #30岁转型 #搞钱女孩》

**#3 B 站（Bilibili）**
- 用户：Z 世代，学生+年轻白领
- 语调：玩梗 / 专业 / 不油腻
- 长度：25-40 字
- Hashtag：少（1-3 个）
- 表情：少
- 公式：反常识 + 梗 + 干货
- 示例：《【硬核】用 AI 做了一集漫剧，结果…老师都没看出来是 AI》

**#4 快手（Kuaishou）**
- 用户：下沉市场，三四线为主
- 语调：接地气 / 家常 / 真实
- 长度：15-20 字
- Hashtag：2-4 个
- 表情：适度
- 公式：情感 + 烟火气 + 爽点
- 示例：《她被婆婆欺负了 10 年，这次终于爆发了！ #婆婆 #媳妇 #家庭》

**#5 TikTok（海外）**
- 用户：全球 Z 世代
- 语调：直接 / 兴奋 / 英文
- 长度：150-300 characters
- Hashtag：4-8 个
- 表情：多
- 公式：POV + Trending + Challenge
- 示例：《POV: you wake up as the villain in a k-drama 😭 #kdrama #pov #fyp #viral》

**#6 YouTube Shorts**
- 用户：全球，更关注内容品质
- 语调：专业 / 叙事 / 英文
- 长度：标题 40-70 characters
- Hashtag：#Shorts 必加
- 表情：少
- 公式：问题 + 解答 + CTA
- 示例：《I tried AI video for 30 days, here's what happened #Shorts》

**#7 Instagram Reels**
- 用户：全球，注重美学
- 语调：精致 / 时尚 / 英文
- 长度：100-250 characters
- Hashtag：最多 30 个（推荐 15-20）
- 表情：多
- 公式：视觉奇观 + 简短文案 + emoji
- 示例：《Sunset in Bali never fails to take my breath away 🌅✨ #travel #baliindonesia #wanderlust》

**内容 → 7 平台本地化流程**

以一条 AI 漫剧为例：

**原素材**：60 秒甜宠短剧片段

**抖音版**
\`\`\`
标题：《她被青梅竹马背叛的那天，遇到了他... #甜宠 #短剧 #AI漫剧》
时长：60s
封面：男女主对视特写
\`\`\`

**小红书版**
\`\`\`
标题：《姐妹们！这部 AI 甜宠我真的哭了😭 | 推荐收藏🔖》
正文：
一口气看完了这部《XXX》
男主颜值真的绝了🤌
最喜欢他们第一次见面的那段
bgm 也超级好听
...
#AI漫剧 #甜宠剧 #短剧推荐 #AI视频 #AI 原创 #漫剧 #女频剧 #推荐 #好看推荐 #必追
\`\`\`

**B 站版**
\`\`\`
标题：《我用 Sora 做了一集甜宠漫剧，弹幕都在刷 AI 是不是有心了》
标签：#AI 漫剧 #Sora #原创
简介：这是我用 AI 制作的第 15 集漫剧，比起以前进步明显...
\`\`\`

**TikTok 版**
\`\`\`
标题：POV: you meet your destined love in 60 seconds 💖
#aidrama #romance #kdrama #fyp #viralvideo #foryou
\`\`\`

**YouTube Shorts 版**
\`\`\`
标题：This AI-made romance short will make you cry 😭 #Shorts #AIVideo
\`\`\`

**Instagram Reels 版**
\`\`\`
标题：When fate brings two souls together... 💕✨
#reels #romance #love #aivideo #shortfilm #creativecontent #reelsinstagram
\`\`\`

**共同原则**
1. 一稿多投是大忌（会被识别 AI）
2. 每个平台都要保留原味的同时加本地化元素
3. Hashtag 数量按平台规则走
4. 不要机器翻译（容易出错）

**快速本地化 AI 工具工作流**
- GPT-4 / Claude 生成本地化版本
- 检查语法 + 文化适配
- 人工润色

**禁忌**
- ❌ 在小红书用抖音的钩子（失去精致感）
- ❌ 在 YouTube 发中文标题（算法不识别）
- ❌ 忽略平台限流词汇
- ❌ 盲目堆 hashtag（会被判定垃圾）`,
    tags: ['平台差异', '文案', '抖音', '小红书', 'tiktok'],
    keywords: ['platform-specific copy', 'tiktok caption', 'xiaohongshu post', 'douyin title', 'youtube shorts', 'instagram reels'],
    prompt_snippets: [
      'generate Douyin title with hook + ellipsis + 3 hashtags',
      'create Xiaohongshu post with precious lifestyle tone and 15+ hashtags',
      'write TikTok caption with POV hook and trending hashtags',
    ],
    applies_to: ['copywriter', 'growth_ops', 'localizer'],
    source: '各主流平台 2022-2025 爆款文案风格对比分析',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_prod_cw_hashtag_strategy',
    collection: 'production',
    subcategory: '文案策划',
    title: 'Hashtag 策略矩阵（大/中/小 + 长尾 + 品牌 分层打法）',
    summary: 'Hashtag 不是越多越好，是"分层组合"。大词 + 中词 + 小词 + 长尾 + 品牌词 = 最强曝光组合。',
    content: `**Hashtag 5 层分类**

**Layer 1: 大词（百万级）**
- 播放量 >1000 万
- 例：#搞笑 #美食 #爱情 #动漫
- 优点：曝光大
- 缺点：竞争激烈，沉底快

**Layer 2: 中词（十万级）**
- 播放量 100-1000 万
- 例：#AI漫剧 #甜宠短剧 #重生 #穿越
- 优点：精准且有流量
- 缺点：需要内容过硬

**Layer 3: 小词（万级）**
- 播放量 1-100 万
- 例：#AI甜宠剧 #Sora漫剧 #Veo视频
- 优点：垂直精准
- 缺点：总曝光有限

**Layer 4: 长尾词（千级及以下）**
- 播放量 < 1 万
- 例：#2025AI漫剧新作 #自制Sora短剧
- 优点：可能"独占"
- 缺点：曝光少

**Layer 5: 品牌词**
- 自己造的词
- 例：#XXX系列 #某某某的漫剧日记
- 优点：沉淀观众
- 缺点：需要长期积累

**黄金分层组合（每个平台不同）**

**抖音 Hashtag 组合（3-5 个）**
\`\`\`
1 个大词（蹭流量）
1-2 个中词（精准定位）
1 个小词（垂直细分）
1 个品牌词（沉淀）
\`\`\`

示例：#短剧 #甜宠 #AI漫剧 #XX系列

**小红书 Hashtag 组合（15-20 个）**
\`\`\`
3 个大词
5-7 个中词
5-7 个小词
1-2 个长尾词
1-2 个品牌词
\`\`\`

示例：#短剧 #甜宠 #爱情剧 #女频 #AI漫剧 #重生 #霸总 #短剧推荐 #必追剧集 #AI原创 #2025新作 #XX系列

**TikTok Hashtag 组合（5-10 个）**
\`\`\`
必加：#fyp #foryou #viral
2 个大词
2 个中词
1-2 个趋势词（当下热门）
\`\`\`

示例：#fyp #foryou #viral #aidrama #shortfilm #kdrama #fypシ #trending

**Hashtag 的 5 个使用技巧**

**1. 抄爆款**
- 看同赛道最近的爆款视频用了哪些
- 直接抄过来
- 他们测试过了

**2. 蹭热点**
- 平台实时热点（#春节 #情人节 #开学季）
- 明星热搜（#某明星）
- 节日 / 季节

**3. 追趋势**
- TikTok 的 trending sound
- 抖音的挑战话题
- 蹭得快有流量

**4. 垂直标签**
- 建立自己账号的垂直标签
- 让算法知道你是什么类型的创作者
- 精准推送对的人

**5. 品牌标签**
- 自己造 hashtag
- 让粉丝自动使用
- 沉淀 UGC 内容

**Hashtag 禁忌**

- ❌ 不要和内容无关的 hashtag（会被降权）
- ❌ 不要纯大词（会被淹没）
- ❌ 不要重复同一类型 5 个以上（算法判定刷量）
- ❌ 不要限流词（平台禁止）
- ❌ 不要拼错（#happyday vs #happyday 差一个字母就不同）

**Hashtag 研究工具**

- 抖音：蝉妈妈 / 新榜
- TikTok：TikTok Creative Center、TikHashtags
- Instagram：Hashtagify、RiteTag
- 小红书：数据蚂蚁、千瓜数据

**实操：爆款 Hashtag 工作流**

**Step 1: 研究**（10 分钟）
- 搜同题材 Top 10 爆款
- 记录他们的 hashtag

**Step 2: 分类**（5 分钟）
- 按大/中/小词分类
- 选出交集

**Step 3: 组合**（5 分钟）
- 按平台规则组合
- 加自己的品牌词

**Step 4: A/B 测试**（持续）
- 两条视频用不同组合
- 对比流量
- 优化组合`,
    tags: ['hashtag', '标签', '策略', '分层'],
    keywords: ['hashtag strategy', 'tag hierarchy', 'trending hashtag', 'hashtag research', 'viral tags'],
    prompt_snippets: [
      'generate 5 hashtags: 1 big + 2 medium + 1 small + 1 brand',
      'research top 10 viral videos in this niche for hashtag pattern',
      'create platform-specific hashtag combination for Douyin/TikTok/Xiaohongshu',
    ],
    applies_to: ['copywriter', 'growth_ops'],
    source: '各主流社交平台 Hashtag 算法研究 + 爆款案例分析',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_prod_cw_thumbnail_text',
    collection: 'production',
    subcategory: '文案策划',
    title: '封面文字设计法则（3 秒抓住眼球的 7 条规则）',
    summary: '视频封面的文字 = 第二个标题。必须 3 秒内让用户决定点不点。7 条被验证的法则。',
    content: `**封面 vs 标题**

- **标题**：出现在视频下方 / 侧边
- **封面文字**：直接画在缩略图上
- 两者配合，不重复
- 封面文字要"互补"而不是"重复"

**7 大封面文字法则**

**#1 大字优先**
- 字号：覆盖 30-50% 画面
- 粗体：宋体黑体 / Impact / Montserrat Bold
- 避免细体（手机屏幕看不清）
- 数量：3-8 个字最好

**#2 颜色对比**
- 文字色 vs 背景色必须对比强烈
- 经典组合：
  - 黄 + 黑（最亮眼）
  - 白 + 红（强烈）
  - 黑 + 白（经典）
  - 荧光色 + 深色（年轻）
- 加描边 / 阴影 / 发光增强可读性

**#3 位置法则**
- 文字放在画面上 1/3 或下 1/3
- 不要盖住主角的脸
- 不要放在边缘（会被裁掉）
- 竖屏：文字在上方
- 横屏：文字在下方

**#4 信息层级**
- 最大字：核心信息（2-4 个字）
- 中字：补充说明（4-8 个字）
- 小字：细节 / 数字（可选）
- 例：
  \`\`\`
  大字：震惊！
  中字：XX 事件真相曝光
  小字：内幕 | 独家
  \`\`\`

**#5 情绪词**
- 用有情绪的词：震惊 / 崩溃 / 绝了 / 爆哭 / 泪崩
- 避免平淡词：如"故事" / "分享"
- 用极端数字：99%、最后一次、史上最

**#6 反差冲突**
- 对立词组："美女 vs 老板"、"从 0 到 100"
- 意外组合："小学生 + 股票"、"老奶奶 + 跑酷"
- 反常规："帅哥吃屎"

**#7 留白和呼吸**
- 不要塞满画面
- 保留 40% 以上空间给图像
- 文字密度：每行不超过 8 个字

**封面文字公式**

**公式 1: 数字 + 情绪**
"99% 的人都不知道，XX 居然是 XX"

**公式 2: 对比 + 悬念**
"她 10 岁 → 她 30 岁，你猜发生了什么"

**公式 3: 反转 + 震惊**
"以为赢了？其实是陷阱！"

**公式 4: 疑问 + 好奇**
"这个女的到底是谁？"

**公式 5: 承诺 + 速度**
"3 秒教你 XX"

**封面文字 vs 视频内容的匹配原则**

**✓ 正确**
- 封面文字："她被全家赶出门"
- 视频内容：女主被赶出家门的戏

**✗ 错误（标题党）**
- 封面文字："她一夜暴富"
- 视频内容：与暴富无关
- 结果：观众点进去发现被骗 → 差评 + 取关

**AI 漫剧封面文字实操**

**短剧一集封面**
\`\`\`
第 15 集
【反派终于下跪】
她 3 年后的大反击
\`\`\`

**数字人口播封面**
\`\`\`
AI 漫剧爆款
这样做能省 99% 时间
90 天实测
\`\`\`

**知识付费封面**
\`\`\`
100 集
免费教学
AI 视频完整教程
\`\`\`

**封面文字工具**

- Canva（模板丰富）
- 稿定设计（中文友好）
- 创客贴（国内）
- Adobe Express（专业）
- Figma（可团队协作）

**字体推荐**

**中文**
- 思源黑体 Bold（通用）
- 站酷系列（免费商用）
- 阿里巴巴普惠体（免费商用）
- 字魂系列（付费）

**英文**
- Impact（最粗，经典）
- Montserrat Black（现代）
- Bebas Neue（高挑）
- Anton（类 Impact）

**禁忌**

- ❌ 不要用宋体 / 楷体（不够粗）
- ❌ 不要用渐变文字（手机不清楚）
- ❌ 不要用花体字（识别度低）
- ❌ 不要超过 3 种颜色
- ❌ 不要无阴影（小屏看不清）`,
    tags: ['封面', '缩略图', '文案', '设计'],
    keywords: ['thumbnail text', 'cover design', 'youtube thumbnail', 'clickbait cover', 'thumbnail design'],
    prompt_snippets: [
      'large bold text on high contrast background',
      'yellow text on black background with black outline',
      'thumbnail text formula: number + emotion + shock word',
      'central large text with smaller supporting details',
    ],
    applies_to: ['copywriter', 'art_director', 'growth_ops'],
    source: 'YouTube / TikTok / 抖音封面设计工业经验 + 眼动研究',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_prod_cw_golden_phrase',
    collection: 'production',
    subcategory: '文案策划',
    title: '金句生成器（结尾 / 转折 / 情绪爆点的万能句式）',
    summary: '金句是视频的"记忆点"。一段内容没有金句就像没有高潮。10 类金句句式 + AI 生成方法。',
    content: `**金句的作用**

1. **被截图 / 转发**：金句容易被做成图
2. **记忆锚点**：让观众记住这条视频
3. **情绪爆发**：在关键时刻拉到顶点
4. **洗脑 / 重复**：成为段子 / 梗

**10 类金句句式**

**Type 1: 反转型**
- "你以为 XX，其实 YY"
- "所有人都说 XX，只有他知道 YY"
- "看似 XX，实为 YY"
示例：
- "你以为我在玩，其实我在准备退休"
- "所有人都说我疯了，只有我自己知道我在干什么"

**Type 2: 对比型**
- "别人 XX，我 YY"
- "10 年前 XX，现在 YY"
- "A 面 XX，B 面 YY"
示例：
- "别人加班是为了升职，我加班是为了副业"
- "10 年前我是个穷学生，现在我是自己公司的老板"

**Type 3: 矛盾型**
- "越 XX，越 YY"
- "既 XX，又 YY"
- "不 XX，就 YY"
示例：
- "越是用力，越抓不住"
- "既要努力，又要躺平"

**Type 4: 决绝型**
- "宁愿 XX，也不 YY"
- "绝不 XX"
- "从今天起，我 XX"
示例：
- "宁愿孤独终老，也不将就"
- "从今天起，我不再迁就任何人"

**Type 5: 疑问型**
- "凭什么 XX？"
- "为什么 XX？"
- "怎么可能 XX？"
示例：
- "凭什么她可以，而我不行？"
- "为什么受伤的总是我？"

**Type 6: 劝诫型**
- "记住，XX"
- "永远 XX"
- "千万别 XX"
示例：
- "记住，这个世界没有容易二字"
- "永远不要对着镜子说负面的话"

**Type 7: 宣言型**
- "我就是 XX"
- "这就是 XX 的命运"
- "这是我的 XX"
示例：
- "我就是我，不一样的烟火"
- "这就是我的选择"

**Type 8: 时间型**
- "多年以后，XX"
- "那一天，XX"
- "如果重来，XX"
示例：
- "多年以后，他才明白那句话的真正含义"
- "那一天，我决定不再回头"

**Type 9: 数字型**
- "100 次 XX 不如 1 次 YY"
- "一辈子做好一件事"
- "只 XX 一次"
示例：
- "100 次思考不如 1 次行动"
- "一辈子爱一个人已经够了"

**Type 10: 哲理型**
- "XX 本身就是 YY"
- "真正的 XX 是 YY"
- "XX 的意义在于 YY"
示例：
- "孤独本身就是一种成长"
- "真正的强大是不再需要证明自己"

**金句在视频中的位置**

**结尾金句（90%）**
- 最后 10 秒
- 配合定格画面 + 大字屏显
- 让观众在离开前被震撼
- 效果：高分享率

**转折金句（20%）**
- 剧情高潮
- 配合慢动作 + 特写
- 让观众意识到"这是关键点"

**开场金句（10%）**
- 前 3 秒
- 配合强视觉
- 吸引观众继续看
- 效果：低退出率

**金句 × 画面的配合**

**金句 + 停顿**
- 角色说完金句后停 1-2 秒
- 画面停在角色脸上
- 给观众"回味时间"

**金句 + 闪黑**
- 金句说完瞬间闪黑
- 再切到下一个场景
- 造成震撼感

**金句 + 环境音骤停**
- 金句说完所有环境音消失
- 只留金句余音
- 戏剧性极强

**金句 + 字幕**
- 大字黄色
- 画面中下方
- 配合 TTS 读出

**AI 金句生成方法**

**Prompt 模板**
\`\`\`
你是一名台词大师。根据以下情境生成 10 个金句：
情境：[XXX]
情绪：[愤怒/悲伤/决绝]
人物：[主角身份]
句式：[反转/对比/宣言/哲理]

要求：
- 每句 8-16 字
- 简练有力
- 朗朗上口
- 避免俗套
\`\`\`

**金句禁忌**

- ❌ 不要太长（超过 20 字就平了）
- ❌ 不要太深（观众听不懂）
- ❌ 不要抄袭（立刻被识破）
- ❌ 不要强行哲理（油腻）
- ❌ 一集 > 1 个金句（记忆点分散）`,
    tags: ['金句', '台词', '文案', '记忆点'],
    keywords: ['memorable quote', 'punchline', 'key line', 'signature dialogue', 'viral phrase'],
    prompt_snippets: [
      'generate 10 punchy 8-16 character lines for climactic scene',
      'reverse quote: "You think it\'s X, but it\'s actually Y"',
      'declarative quote: "From today, I will never Z"',
    ],
    applies_to: ['copywriter', 'screenwriter'],
    source: '短视频爆款金句大数据 + 电影经典台词',
    lang: 'zh',
    enabled: true,
  },

  // ═══════════════════════════════════════════════════
  // ④ 剪辑技巧（editor）
  // ═══════════════════════════════════════════════════
  {
    id: 'kb_prod_ed_murch_rules',
    collection: 'production',
    subcategory: '剪辑技巧',
    title: 'Walter Murch 剪辑 6 原则（剪辑大师的决策优先级）',
    summary: '《教父》《现代启示录》剪辑师 Walter Murch 的 6 条经典原则：情绪 → 故事 → 节奏 → 视线 → 二维 → 三维。按优先级排序。',
    content: `**Walter Murch 是谁**

- 《教父》三部曲剪辑师
- 《现代启示录》剪辑师（获奥斯卡）
- 《英国病人》剪辑师（获奥斯卡）
- 著有剪辑圣经《In the Blink of an Eye》

**6 大剪辑原则（按优先级从高到低）**

**#1 Emotion 情绪（51% 权重）**
- 这个剪辑点服务于观众的情绪吗？
- 剪得对 = 观众感受到情绪
- 即使其他规则违反了，只要情绪对就可以接受
- 这是最重要的

**#2 Story 故事（23% 权重）**
- 这个剪辑推进了故事吗？
- 让观众更理解剧情吗？
- 剪错会让观众"走神"

**#3 Rhythm 节奏（10% 权重）**
- 剪辑的节奏感对吗？
- 快慢交替
- 呼吸感

**#4 Eye-trace 视线追踪（7% 权重）**
- 观众的视线从上一镜平滑过渡到下一镜吗？
- 主体位置是否连贯？
- 避免视线"跳跃"

**#5 Two-dimensional plane 二维平面（5% 权重）**
- 画面构图是否连贯？
- 180 度规则
- 画面左右方向一致

**#6 Three-dimensional space 三维空间（4% 权重）**
- 角色在空间中的位置连贯吗？
- 观众能理解"谁在哪里"吗？
- 空间关系清晰

**关键洞察：6 项的权重总和 = 100%**

Murch 说："如果你一个剪辑点能满足前 3 个（情绪 + 故事 + 节奏），你就可以接受违反后 3 个（视线 + 构图 + 空间）。"

换句话说：**情绪对，其他都可以妥协**。

**实战应用**

**决策场景 A：情绪强烈但不连贯**
- 前镜：角色在哭
- 后镜：角色在笑
- 空间关系不对，但情绪对比强烈
- **Murch：剪！** 情绪（51%）+ 故事（23%）= 74% > 其他
- 效果：观众感受到情绪落差

**决策场景 B：空间完美但情绪缺失**
- 前镜：主角说"我爱你"
- 后镜：主角转身走开（空间连贯）
- 但缺少反应镜头（女主的表情）
- **Murch：不剪！** 情绪缺失，观众没被感动
- 解决：加一个女主的反应特写

**决策场景 C：常见对话戏**
- 两人对话，正反打
- 前镜 A，后镜 B（空间对）
- 节奏对 + 视线对 + 情绪对
- **Murch：剪！** 全部满足

**AI 漫剧剪辑决策流程**

每个剪辑点问自己这 6 个问题：

1. 这个剪辑点让观众感受到情绪了吗？（Y/N）
2. 这个剪辑推进了故事吗？（Y/N）
3. 节奏对吗？（Y/N）
4. 视线连贯吗？（Y/N）
5. 画面构图连贯吗？（Y/N）
6. 空间关系连贯吗？（Y/N）

**评分**
- 前 3 项都 Y → 可以剪
- 只有情绪 Y → 可以剪（Murch 的核心观点）
- 后 3 项都 Y 但情绪 N → 不要剪
- 前 3 项都 N → 绝对不能剪

**Murch 的其他名言**

- "A cut should feel like a blink — natural and invisible"
- "The best edit is the one you don't notice"
- "Emotion is 51% of everything"

**AI 漫剧剪辑建议**

由于 AI 视频是一次生成一个镜头，剪辑更像"组合"：

**组合原则**
1. 把情绪最强的镜头放在高潮位置
2. 每个镜头都要服务情绪
3. 不服务情绪的镜头 → 删掉
4. 节奏快慢交替
5. 视线连贯 > 空间连贯

**AI 剪辑的 checklist**
- [ ] 这段是否传达了情绪？
- [ ] 故事是否推进？
- [ ] 节奏是否对？
- [ ] 不要追求完美，追求感动`,
    tags: ['剪辑原则', 'walter murch', '情绪', '决策'],
    keywords: ['walter murch', 'editing rules', 'emotion first', 'in the blink of an eye', 'godfather editor', 'eye trace'],
    prompt_snippets: [
      'cut decision: emotion first, story second, rhythm third',
      'edit for emotional impact over technical continuity',
      'Walter Murch invisible cut that feels natural',
    ],
    applies_to: ['editor', 'director', 'executive_producer'],
    source: 'Walter Murch 《In the Blink of an Eye》+ 剪辑大师原则',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_prod_ed_music_sync',
    collection: 'production',
    subcategory: '剪辑技巧',
    title: '音乐驱动剪辑（节拍对齐 / 副歌爆发 / BPM 选择）',
    summary: '音乐与剪辑同步是 MV 和短视频的核心技法。选对 BPM + 把剪辑点卡在节拍上 = 爆款基础。',
    content: `**音乐剪辑的核心：BPM**

BPM = Beats Per Minute（每分钟节拍数）

**不同类型音乐的 BPM 范围**

| 类型 | BPM | 情绪 | 适用 |
|---|---|---|---|
| Ballad 慢歌 | 60-80 | 悲伤/浪漫 | 催泪戏 / 爱情戏 |
| Pop 流行 | 100-120 | 愉快/日常 | 日常戏 / 喜剧 |
| Dance 舞曲 | 120-130 | 兴奋/活力 | 蒙太奇 / 运动 |
| EDM 电子 | 128-140 | 燃/爽 | 爽点 / 战斗 |
| Rock 摇滚 | 110-140 | 力量/反叛 | 动作 / 宣泄 |
| Hip-hop | 80-100 | 酷/态度 | 城市 / 时尚 |
| 古典 | 变速 | 情绪多样 | 文艺 / 史诗 |

**节拍对齐法则**

**概念：Beat Matching**
- 视频的剪辑点对准音乐的强拍
- 强拍 = 每小节的第 1、3 拍（4/4 拍）
- 视觉切换与音乐 "撞"在一起
- 产生"对上了"的快感

**基础节奏模式 4/4 拍**
\`\`\`
1   2   3   4   |   1   2   3   4
强       弱       |   强       弱
^               ^               ^
剪辑点       剪辑点       剪辑点
\`\`\`

**实战：一段 8 秒的视频**
- BPM = 120 (常见流行)
- 每秒 2 拍
- 8 秒 = 16 拍
- 可以每 2-4 拍切一次
- 8 秒内 4-8 个镜头

**高级：副歌爆发剪辑**

**副歌的力量**
- 副歌通常在 45-60 秒位置
- 音乐瞬间"打开"
- 情绪强度 +50%
- 这是剪辑的"大杀器"

**副歌剪辑模式**
\`\`\`
主歌（0-45s）: 慢节奏，每 3-4 拍一剪
    ↓
Pre-chorus（45-55s）: 加速，每 2 拍一剪
    ↓
Chorus（55-85s）: 爆发，每 1 拍一剪 + 画面爆发
    ↓
Break（85-90s）: 戛然而止 + 慢镜头
\`\`\`

**剪辑点的 3 个层级**

**Hard Beat（强拍）**
- 每小节第 1 拍
- 剪辑点放这里 = 最强视觉冲击
- 例：爆炸 / 打脸 / 出现

**Weak Beat（弱拍）**
- 每小节第 2、4 拍
- 剪辑点放这里 = 节奏感
- 例：对话切换 / 走路节奏

**Off-beat（反拍）**
- 拍与拍之间（.5 位置）
- 剪辑点放这里 = 灵动感
- 例：动作转场 / 轻快氛围

**情绪与音乐的匹配**

| 情绪 | 音乐 | BPM | 剪辑节奏 |
|---|---|---|---|
| 悲伤 | 钢琴 ballad | 60-70 | 5-8s/剪 |
| 浪漫 | 弦乐 ballad | 70-85 | 4-6s/剪 |
| 日常 | 轻快 pop | 100-110 | 3-4s/剪 |
| 紧张 | 电子 / 鼓 | 120-130 | 1-2s/剪 |
| 爽 | EDM drop | 128-140 | 0.5-1s/剪 |
| 燃 | 摇滚 | 110-140 | 1-2s/剪 |
| 史诗 | 交响 | 变化 | 变化 |

**AI 漫剧音乐剪辑实战**

**场景：重生复仇爽文 60 秒版**

\`\`\`
0-5s (前戏): 低沉弦乐 60 BPM
  - 1 个镜头：主角站在雨中
  - 静止 5 秒

5-15s (觉醒): 鼓点加入 90 BPM
  - 3 个镜头：眼睛特写 → 握拳 → 回忆闪回
  - 每 3-4 秒一个

15-30s (冲突): 主旋律 110 BPM
  - 5 个镜头：反派嚣张 → 主角走来 → 反派惊恐 → 主角冷笑 → 动作
  - 每 2-3 秒一个

30-45s (爆发): 副歌 128 BPM + drop
  - 10 个镜头：快速切换反击戏
  - 每 1-1.5 秒一个
  - 必须卡在每个强拍

45-55s (余韵): 减速到 90 BPM
  - 3 个镜头：主角转身 → 反派倒下 → 主角离开
  - 每 3-4 秒一个

55-60s (收尾): 旋律结束
  - 1 个镜头：金句 + 字幕 + 停顿
\`\`\`

**音乐来源**

| 来源 | 授权 | 适用 |
|---|---|---|
| Epidemic Sound | 商用付费 | 专业项目 |
| Artlist | 商用付费 | 专业项目 |
| Musicbed | 商用付费 | 电影级 |
| YouTube Audio Library | 免费 | 个人 |
| Pixabay Music | 免费 | 个人商用 |
| Free Music Archive | 免费 | CC 授权 |
| Suno AI | AI 生成 | 快速自定义 |
| Udio AI | AI 生成 | 快速自定义 |
| 网易云音乐 | 需授权 | 国内付费 |
| 剪映自带 | 免费 | 国内短视频 |

**AI 音乐生成（2025 年新选择）**

- **Suno v4**: 可生成带人声的完整歌曲
- **Udio**: 专业音质的纯音乐
- **ElevenLabs Music**: 高质量配乐
- **MusicGen** (Meta 开源): 可本地部署

**剪辑软件音频工具**

- **DaVinci Resolve**: 专业音频剪辑
- **Premiere Pro**: 行业标准
- **Final Cut Pro**: Mac 首选
- **剪映专业版**: 中文友好
- **CapCut**: 海外版剪映

**禁忌**

- ❌ 不要选 BPM 不对的音乐
- ❌ 不要忽略节拍点
- ❌ 不要音乐压过对白
- ❌ 不要全程同一 BPM
- ❌ 不要用版权音乐（会被下架）`,
    tags: ['音乐剪辑', 'bpm', '节拍', '副歌'],
    keywords: ['music editing', 'beat matching', 'bpm', 'chorus drop', 'audio sync', 'epidemic sound', 'suno ai'],
    prompt_snippets: [
      'cut on the downbeat of every 4/4 measure',
      'faster cuts during chorus drop, slower during verses',
      'match BPM 120 music with 2-3 second cuts',
      'use Suno AI to generate custom soundtrack with specific BPM',
    ],
    applies_to: ['editor', 'director'],
    source: '音乐视频剪辑理论 + MV 行业实战经验',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_prod_ed_hook_editing',
    collection: 'production',
    subcategory: '剪辑技巧',
    title: '开头 3 秒剪辑钩子（5 种留人技巧）',
    summary: '短视频的完播率在前 3 秒决定一半。5 种剪辑级别的钩子技巧，不只是内容，还是"剪法"。',
    content: `**3 秒完播率的重要性**

- 抖音 / TikTok 算法的核心指标
- 前 3 秒如果流失 > 50% → 算法判定不适合大推
- 前 3 秒如果流失 < 20% → 算法持续推荐
- 剪辑层面的 3 秒钩子比内容更重要（因为观众来不及理解内容）

**5 种剪辑级别的钩子技巧**

**#1 Action Cut 动作切入**
- 0:00 直接进入动作中
- 不要有"铺垫"
- 不要有"开场 logo"
- 不要有"慢慢进入"

**错误示例**：
\`\`\`
0.0s - 0.5s: 黑屏
0.5s - 1.5s: logo 淡入
1.5s - 3.0s: 空镜头
3.0s+ : 开始剧情
\`\`\`
完播率：低

**正确示例**：
\`\`\`
0.0s: 直接切入主角被打脸的瞬间（动作中）
0.5s: 反派表情特写
1.0s: 主角冷笑
...
\`\`\`
完播率：高

**#2 Visual Shock 视觉奇观**
- 第一帧就是最惊艳的画面
- 用"最好的镜头"开场
- 不要"留后面用"

**应用**
- 爆炸
- 奇异景观
- 绝美画面
- 不合常理的场景（漂浮的人 / 下雪的夏天）

**#3 Quick Cut Tease 快切预告**
- 前 3 秒闪过 5-8 个后续精彩片段
- 每个只 0.3-0.5 秒
- 配合强节奏音乐
- 让观众"预期"后面有精彩

**结构**
\`\`\`
0.0s: 快切 #1（最爽的瞬间）
0.3s: 快切 #2（最美的画面）
0.6s: 快切 #3（最痛的瞬间）
0.9s: 快切 #4（最关键的线索）
1.2s: 快切 #5（最大的反转）
1.5s: 标题卡
2.0s: 正片开始
\`\`\`

**#4 Mystery Hook 悬念钩子**
- 开场提出一个问题
- 不给答案
- 让观众想看下去
- 必须在 3 秒内明确提出问题

**示例**
- "你知道她为什么要这样做吗？"（配合神秘画面）
- "这是我最后一次见到他"（配合离别画面）
- "当时我以为一切都结束了..."（配合倒叙）

**#5 Direct Address 直接对话观众**
- 角色直接看镜头
- 用"你"或"大家"称呼
- 打破第四面墙
- 制造亲近感

**示例**
- "你知道吗，90% 的人都在 XX"
- "如果你也 XX，那你一定要看这个"
- "我要告诉你一个秘密"

**组合使用：开场 3 秒黄金结构**

**完整示例：一条 60 秒短剧**

\`\`\`
0.0s - 0.5s: 主角被打耳光的慢动作特写（Action Cut + Visual Shock）
0.5s - 1.0s: 快切 5 个后续精彩瞬间（Quick Cut Tease）
1.0s - 2.0s: 主角转身冷笑（情绪爆点）
2.0s - 3.0s: 字幕"3 年后，她回来了"（Mystery Hook）
3.0s - 60s: 正片
\`\`\`

**剪辑技巧**
- 0-3 秒的 ASL < 0.5s（超快切）
- 配合强节奏音乐
- 字幕大号粗体
- 音效加持（爆炸声 / 玻璃破碎 / 心跳）

**Before / After 改造案例**

**改造前（差的开场）**
\`\`\`
0-5s: 空镜头（城市夜景）
5-10s: 主角走路背影
10-15s: 主角回家开门
15-20s: 主角坐下
20-25s: 主角打开电脑
25s+ : 开始剧情
\`\`\`
3 秒完播率：30%（太慢）

**改造后（好的开场）**
\`\`\`
0-1s: 主角打开电脑瞬间 + 屏幕弹出震惊消息特写
1-2s: 主角震惊表情（快速 zoom in）
2-3s: 字幕"她的世界从那一刻开始崩塌"
3s+: 倒叙正片
\`\`\`
3 秒完播率：75%

**通用优化清单**

- [ ] 第 0.0s 有动作吗？
- [ ] 第 0.5s 有视觉冲击吗？
- [ ] 第 1.0s 有情绪变化吗？
- [ ] 第 2.0s 有悬念提出吗？
- [ ] 第 3.0s 让观众想看下去吗？
- [ ] 前 3 秒 ASL < 1s？
- [ ] 前 3 秒有音效加持？
- [ ] 前 3 秒有字幕强调？

**禁忌**

- ❌ 不要开场 logo / 品牌片头
- ❌ 不要 "大家好我是 XX"
- ❌ 不要空镜头开场
- ❌ 不要慢推进
- ❌ 不要黑屏
- ❌ 不要音乐渐入`,
    tags: ['开头', '钩子', '3秒', '完播率'],
    keywords: ['hook editing', '3 second hook', 'opening cut', 'retention editing', 'quick cut tease'],
    prompt_snippets: [
      'action cut opening, straight into the most dramatic moment',
      'quick cut tease: 5 preview flashes in first 1 second',
      'zoom in fast on shocked face as opening frame',
      'bold large subtitle overlay at 2-3 second mark',
    ],
    applies_to: ['editor', 'director', 'growth_ops'],
    source: '短视频算法机制 + 前 3 秒完播率爆款研究',
    lang: 'zh',
    enabled: true,
  },

  // ═══════════════════════════════════════════════════
  // ⑤ 本地化（localizer）
  // ═══════════════════════════════════════════════════
  {
    id: 'kb_prod_loc_cn_en',
    collection: 'production',
    subcategory: '本地化',
    title: '中译英短剧本地化（美 / 英 / 澳市场差异 + 文化雷区）',
    summary: '中译英不是直译，是"重写"。霸总不能直接 translate，狼人 / 吸血鬼 / Luna 才是主流。',
    content: `**中文短剧出海第一步：题材转译**

**直译失败的原因**
- 霸总（bossy CEO）→ 欧美观众不接受
- 门当户对 → 没有对应概念
- 宫斗 → 没有宫廷基础
- 上门女婿 → 欧美文化不存在
- 小三 → 直接 translate 会显得 petty

**成功的转译方向**

| 中文原题 | 英文转译 | 原因 |
|---|---|---|
| 总裁 / 霸总 | Billionaire / CEO | 资本主义爱情 |
| 豪门 | Elite family / Royal family | 贵族感 |
| 重生 | Second life / Rebirth | 重生流全球通用 |
| 穿越 | Time travel / Transmigration | 全球通用 |
| 仙侠 | Fantasy / Magic realm | 包装成西式奇幻 |
| 宫斗 | Royal court drama | 借鉴 Downton |
| 古装 | Period drama | 历史剧 |
| 复仇 | Revenge / Comeback | 全球通用 |
| 战神 | Mafia / Warlord | 黑帮文化 |
| 甜宠 | Romance / Sweet love | 全球通用 |

**新加入的"本土题材"**

欧美观众偏爱但中文没有的：

**狼人 Werewolf / Alpha-Luna**
- 设定：狼人部落 + Alpha 阶层 + Luna 命定伴侣
- 氛围：神秘 + 命运
- 爆款保证：ReelShort 第一大赛道

**吸血鬼 Vampire**
- 设定：古老家族 + 血契 + 永生
- 氛围：哥特 + 浪漫
- 与狼人并列

**回魂 Ghost Romance**
- 设定：幽灵爱上活人
- 情绪：凄美 + 超自然
- 市场：欧美 + 韩国

**文化雷区（避免）**

**宗教**
- 不要涉及基督教 / 伊斯兰教 / 佛教的不当表达
- 不要亵渎圣经 / 古兰经 / 佛经
- 婚礼不要过度宗教化

**种族**
- 不要种族刻板印象
- 不要"黄人女 + 白人男"作为卖点
- 注意 Asian American 的不同于 Asian 的文化

**LGBTQ+**
- 欧美更接受
- 直接出现 CP 不是问题
- 注意不要 queerbait（只暗示不明确）

**历史敏感**
- 二战
- 殖民
- 战争罪行
- 少数民族

**性与暴力**
- 美国：中等包容
- 英国：较保守
- 澳洲：最包容
- 不要过度露骨（会限制年龄）

**语言层面的本地化**

**翻译原则**

**1. 意译 > 直译**
- ❌ "He is my food"（直译"他是我的菜"）
- ✓ "He's totally my type"

**2. 文化替换**
- ❌ "I'll give you a hutong in Beijing"
- ✓ "I'll buy you a brownstone in Manhattan"

**3. 俚语本土化**
- ❌ "You are so 牛"
- ✓ "You are so badass"

**4. 称呼简化**
- ❌ "叔叔 / 阿姨 / 哥哥 / 姐姐"
- ✓ 直接用名字

**5. 语气调整**
- 中文：含蓄
- 英文：直接
- 需要重写情感表达

**语言风格差异**

**美式英语（美国市场）**
- 随性 / 直接
- 俚语多（awesome / cool / dude）
- 短句多
- Z 世代用语（slay / bet / no cap）

**英式英语（英国市场）**
- 优雅 / 克制
- 礼貌用语多（lovely / splendid）
- 完整句子
- 贵族语气

**澳式英语（澳洲市场）**
- 最随性
- 独特俚语（mate / reckon / arvo）

**实操工作流**

**Step 1: 题材转译**
- 中文题材 → 目标市场可接受的版本
- 例：重生复仇 → Second Life Revenge

**Step 2: 人物重新设定**
- 中文名 → 英文名
- 中式身份 → 欧美身份
- 例：林总 → Michael Lin / Michael Bennett

**Step 3: 场景替换**
- 北京 → New York / London
- 四合院 → Brownstone / Manor
- 高铁 → Train
- 淘宝 → Amazon

**Step 4: 对白重写**
- 不要翻译，要重写
- 保留原意，改变表达
- 加入本土俚语

**Step 5: 文化细节**
- 节日替换（春节 → Christmas / Thanksgiving）
- 食物替换（饺子 → Steak）
- 交通替换（出租车 → Uber）

**Step 6: 配音本土化**
- 找英文母语配音
- 避免机翻口音
- 注意口音匹配（美 / 英 / 澳不同）

**AI 翻译工具**

- **DeepL** - 高质量翻译（付费）
- **GPT-4** - 可润色的翻译
- **Claude** - 创意翻译
- **Google Translate** - 免费但生硬
- **不推荐**: 纯机翻

**禁忌**

- ❌ 不要直接机翻
- ❌ 不要保留中文名
- ❌ 不要宫斗 / 上门女婿直接出海
- ❌ 不要中式幽默（观众 get 不到）
- ❌ 不要中国节日作为主线`,
    tags: ['本地化', '中译英', '出海', '文化适配'],
    keywords: ['localization', 'chinese to english', 'cultural adaptation', 'overseas market', 'reelshort', 'dramabox'],
    prompt_snippets: [
      'adapt Chinese bossy CEO to Western billionaire romance',
      'replace palace intrigue with royal family drama',
      'transform rebirth revenge into second life redemption story',
      'localize character names, settings, and dialogue for US market',
    ],
    applies_to: ['localizer', 'screenwriter', 'executive_producer'],
    source: 'ReelShort / DramaBox / FlexTV 2023-2025 成功出海案例分析',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_prod_loc_asia',
    collection: 'production',
    subcategory: '本地化',
    title: '日韩 / 东南亚市场本地化（文化偏好 + 禁忌）',
    summary: '日本爱纯爱 / 韩国爱反转 / 东南亚爱华人元素。每个市场有完全不同的口味。',
    content: `**日本市场**

**文化偏好**
- **纯爱至上**: 含蓄暧昧 > 直接热烈
- **日常细节**: 生活美学 + 四季 + 校园
- **羁绊**: 友情 > 爱情，家人 > 爱情
- **二次元**: 动漫文化接受度最高
- **匠人精神**: 专业细节的尊重

**受欢迎题材**
- 青春校园
- 日常治愈
- 穿越异世界 (Isekai)
- 温馨家庭
- 职人剧（医生 / 厨师 / 律师）

**禁忌**
- ❌ 过度亲密场面
- ❌ 直接表达"我爱你"过多
- ❌ 嚣张人设
- ❌ 大喊大叫
- ❌ 武打镜头过于夸张
- ❌ 涉及战争题材

**审美差异**
- 偏好柔和色彩
- 画面干净
- 字幕简洁
- 配音沉稳

**韩国市场**

**文化偏好**
- **反转至上**: K-drama 的灵魂
- **颜值正义**: 演员颜值决定一半
- **服化道**: 精致度要求高
- **情感浓烈**: 虐 + 甜 + 虐 + 甜
- **命运感**: 相遇 → 分离 → 重逢

**受欢迎题材**
- 现代浪漫（财阀爱情）
- 复仇虐恋（最强赛道）
- 穿越医疗 / 法律
- 鬼怪奇幻
- 狼人异能

**禁忌**
- ❌ 直接展示父母离异（敏感）
- ❌ 过度低龄化
- ❌ 虐待戏过度
- ❌ 反日情绪（日本商品 / 品牌出现要慎）
- ❌ 政治敏感

**审美差异**
- 偏好暖金色调
- 咖啡馆场景多
- 雪景 / 雨景多
- 慢动作多
- 专业配乐

**东南亚市场**

**主要国家**
- 印尼 (最大市场)
- 泰国
- 越南
- 菲律宾
- 马来西亚

**共通偏好**
- **华人元素接受度高**: 重生 / 穿越 / 豪门都能接受
- **家族观念**: 大家族 / 婆媳矛盾
- **超自然**: 鬼怪 / 占卜 / 算命
- **物质追求**: 富豪 / 豪车 / 豪宅
- **情感浓烈**: 像韩剧和宝莱坞的混合

**受欢迎题材**
- 豪门虐恋
- 家族恩怨
- 灵异恐怖
- 婆媳 / 姑嫂矛盾
- 重生复仇

**禁忌（印尼为例）**
- ❌ 伊斯兰教不敬
- ❌ 猪肉 / 酒精大量出现
- ❌ LGBTQ+ 直白内容
- ❌ 涉及王室
- ❌ 政治敏感

**禁忌（泰国为例）**
- ❌ 不敬王室
- ❌ 佛教不敬
- ❌ 过于露骨

**审美差异**
- 偏好强烈色彩
- 戏剧化表演
- 大场面 / 豪华场景
- 配乐煽情
- 配音本地语言（不是字幕）

**多市场通用策略**

**1. 画面为王**
- 减少对白依赖
- 画面能讲故事就不用对白
- 表情 > 语言

**2. 通用题材**
- 重生 / 穿越 / 爱情 / 家庭 / 复仇
- 避免过于本土的题材

**3. 视觉锚点**
- 华丽服化道
- 豪华场景
- 高颜值演员

**4. 多语言字幕**
- 必须本土语言字幕
- 配音更好
- 不要只给英文字幕

**5. 发行策略**
- 印尼：Meta 系（FB / IG）
- 泰国：TikTok + YouTube
- 越南：Zalo + Facebook
- 菲律宾：Facebook + TikTok

**各市场平台渗透率**

| 市场 | TikTok | IG | YouTube | 本土平台 |
|---|---|---|---|---|
| 日本 | 中 | 高 | 极高 | LINE VOOM |
| 韩国 | 高 | 极高 | 极高 | Kakao TV |
| 印尼 | 极高 | 高 | 高 | Vidio |
| 泰国 | 极高 | 极高 | 高 | LINE TV |
| 越南 | 极高 | 中 | 极高 | Zalo |
| 菲律宾 | 极高 | 极高 | 极高 | 无特定 |

**出海工作流**

1. 选市场：先选 1-2 个
2. 研究文化：禁忌 + 偏好
3. 内容本土化：题材 + 名字 + 场景 + 对白
4. 配音 / 字幕本土化
5. 试播 1-3 条
6. 数据分析
7. 规模化`,
    tags: ['日韩', '东南亚', '本地化', '出海'],
    keywords: ['japan market', 'korea market', 'southeast asia', 'localization', 'cultural taboo', 'indonesia', 'thailand'],
    prompt_snippets: [
      'adapt content for Japanese market: subtle romance, pure love, slice of life',
      'Korean K-drama style: high production value, twist-driven, emotional peaks',
      'Indonesian market: family drama, supernatural, wealthy protagonists',
    ],
    applies_to: ['localizer', 'executive_producer'],
    source: '日韩 / 东南亚市场 2022-2025 内容偏好数据 + 平台数据',
    lang: 'zh-en',
    enabled: true,
  },

  // ═══════════════════════════════════════════════════
  // ⑥ 运营增长（growth_ops）
  // ═══════════════════════════════════════════════════
  {
    id: 'kb_prod_go_traffic_platforms',
    collection: 'production',
    subcategory: '运营增长',
    title: '投流平台对比（巨量引擎 / 磁力金牛 / 千川 / Meta Ads）',
    summary: '4 大主流投流平台完整对比：流量池 / 转化能力 / 价格 / 适用场景。',
    content: `**4 大投流平台**

**#1 巨量引擎（抖音系）**

**流量池**
- 抖音：8 亿 DAU
- 头条：2 亿 DAU
- 西瓜视频：1.5 亿 DAU

**适用内容**
- 短视频 / 短剧 / 直播带货
- 付费短剧最大流量池

**优势**
- 流量最大
- 算法精准
- 用户付费意愿强
- 短剧专属通道

**劣势**
- 竞争激烈
- 素材要求高
- 价格较高

**典型出价**
- CPM: 30-80 元
- CPC: 0.5-3 元
- CPA: 10-100 元

**#2 磁力金牛（快手系）**

**流量池**
- 快手：4 亿 DAU
- 主要下沉市场

**适用内容**
- 短剧 / 带货
- 下沉市场爽文

**优势**
- 下沉用户精准
- 付费短剧友好
- 价格比巨量低
- 家庭主妇多

**劣势**
- 一线用户少
- 广告素材审美要求低

**典型出价**
- 比巨量低 20-30%

**#3 千川（淘宝/天猫系）**

**流量池**
- 淘宝直播
- 天猫
- 逛逛

**适用内容**
- 带货直播
- 产品种草

**优势**
- 转化链路短
- 直接下单
- 电商用户精准

**劣势**
- 只适合带货
- 不适合内容付费

**#4 Meta Ads（海外）**

**流量池**
- Facebook: 30 亿 MAU
- Instagram: 20 亿 MAU
- WhatsApp: 20 亿 MAU

**适用内容**
- 海外短剧（ReelShort / DramaBox）
- 跨境电商
- 应用下载

**优势**
- 全球流量
- 精准定向
- 成熟体系

**劣势**
- 价格高（美区特别高）
- 审核严

**典型出价**
- 美区 CPM: $10-30
- 欧洲 CPM: $5-15
- 东南亚 CPM: $1-5

**其他重要平台**

| 平台 | 类型 | 适用 |
|---|---|---|
| Google Ads | 搜索 + YouTube | 品牌 + 应用 |
| TikTok Ads | 全球短视频 | 内容 + 电商 |
| 微信朋友圈 | 微信系 | 品牌 |
| 知乎信息流 | 知乎 | 知识付费 |
| 小红书聚光 | 小红书 | 女性种草 |
| B 站花火 | B 站 | Z 世代 |

**投流选择决策树**

\`\`\`
想做什么？
├─ 国内短剧付费 → 巨量引擎 / 磁力金牛
├─ 国内品牌推广 → 巨量引擎 / 微信朋友圈
├─ 国内知识付费 → 知乎 / 巨量引擎
├─ 国内带货 → 千川 / 巨量引擎
├─ 海外短剧付费 → Meta Ads / TikTok Ads
├─ 海外品牌 → Google Ads / Meta Ads
└─ 海外应用下载 → Meta Ads / Google Ads
\`\`\`

**投流素材黄金结构**

**15 秒投流素材公式**
\`\`\`
0-2s: 最强钩子（爆点）
2-6s: 冲突 / 高潮预览
6-10s: 情感共鸣 / 爽点
10-13s: CTA
13-15s: 二维码 / 链接 / logo
\`\`\`

**30 秒投流素材公式**
\`\`\`
0-3s: 钩子
3-10s: 冲突展开
10-20s: 高潮爽点
20-25s: 情感升华
25-30s: CTA + 引导
\`\`\`

**投流 ROI 模型**

**计算公式**
\`\`\`
ROI = 收入 / 投流成本
ROAS = Revenue / Ad Spend
健康 ROI：> 1.5
优秀 ROI：> 3.0
\`\`\`

**付费短剧 ROI 案例**
\`\`\`
投流成本：10 万
带来付费用户：5000 人
ARPU：30 元
收入：15 万
ROI：1.5 ✓ (保本)

爆款案例：
投流成本：10 万
带来付费用户：10000 人
ARPU：50 元
收入：50 万
ROI：5.0 ⭐ (爆款)
\`\`\`

**优化策略**

**1. 素材测试**
- 每天测 5-10 条素材
- 保留 Top 2
- 淘汰底部 3

**2. 定向优化**
- 起量阶段：宽定向
- 稳定阶段：收窄定向
- 测试多个人群包

**3. 出价优化**
- 先测试出价
- 按 ROI 调整
- 平稳期自动出价

**4. 时段优化**
- 分析历史数据
- 找到高 ROI 时段
- 重点投放

**禁忌**

- ❌ 不要同一条素材投太久（疲劳）
- ❌ 不要 ROI 为负还坚持
- ❌ 不要违反平台规则（会封号）
- ❌ 不要忽略数据分析`,
    tags: ['投流', '广告', '巨量引擎', 'meta ads'],
    keywords: ['traffic acquisition', 'ad platform', 'ocean engine', 'magnetic gold bull', 'qianchuan', 'meta ads', 'roas'],
    prompt_snippets: [
      'compare ROAS across Douyin Ocean Engine and Kuaishou Magnetic Gold Bull',
      'design 15-second ad creative for short drama on TikTok Ads',
      'optimize traffic campaign targeting for female sweet romance audience',
    ],
    applies_to: ['growth_ops', 'executive_producer'],
    source: '巨量引擎 / 磁力金牛 / 千川 / Meta Ads 2023-2025 公开数据 + 实战案例',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_prod_go_ab_testing',
    collection: 'production',
    subcategory: '运营增长',
    title: 'A/B 测试方法论（素材 / 封面 / 标题 / 时长 / 定向 5 维度）',
    summary: 'A/B 测试是投流优化的核心。5 个维度 × 科学方法论 = 持续优化 ROI。',
    content: `**A/B 测试的 5 个维度**

**#1 素材测试**

**测试变量**
- 开头钩子（5 种钩子类型）
- 叙事节奏（快 vs 慢）
- 剪辑风格（MV 风 vs 纪录风）
- 配乐（情绪不同）
- 调色（暖 vs 冷）

**方法**
- 同一剧本拍 3-5 个版本
- 每版本投相同预算
- 跑 3 天看数据
- 选 ROI 最高的规模化

**#2 封面测试**

**测试变量**
- 主视觉（人物特写 vs 场景 vs 道具）
- 文字（有 vs 无 / 多 vs 少）
- 色彩（暖 vs 冷 / 高饱和 vs 低饱和）
- 字体（粗黑 vs 宋体）
- 构图（中心 vs 三分）

**方法**
- 5 种封面组合
- 同一素材
- 跑 2-3 天
- 看 CTR（点击率）

**#3 标题测试**

**测试变量**
- 长度（短 15 字 vs 长 25 字）
- 公式（数字 vs 悬念 vs 反转）
- 情绪词（有 vs 无）
- emoji（有 vs 无）
- hashtag（3 个 vs 8 个）

**方法**
- 同一视频
- 5-10 个标题版本
- 看点击率
- 选最高的

**#4 时长测试**

**测试变量**
- 15 秒（最短版）
- 30 秒（标准版）
- 60 秒（完整版）
- 90 秒（加长版）

**方法**
- 同一剧情
- 剪 4 个时长版本
- 投相同预算
- 看完播率 + ROI

**数据参考**
- 15 秒：完播率高 / 转化低
- 30 秒：平衡
- 60 秒：转化高 / 完播低
- 90 秒：适合付费转化

**#5 定向测试**

**测试变量**
- 年龄：18-24 / 25-34 / 35-44 / 45+
- 性别：男 / 女 / 不限
- 地域：一线 / 二线 / 三四线
- 兴趣：影视 / 美食 / 健身 等
- 设备：iOS / Android

**方法**
- 开 5 个广告计划
- 每个定向不同
- 跑 3 天
- 找最高 ROI 的定向

**A/B 测试的科学方法论**

**原则 1: 单变量**
- 每次只测一个变量
- 其他变量保持一致
- 否则无法归因

❌ 错误：同时测封面 + 标题 + 时长
✓ 正确：先测封面，再测标题，再测时长

**原则 2: 样本量充足**
- 每组测试至少 1000 次曝光
- 付费测试至少 100 次转化
- 样本小 → 结论不可信

**原则 3: 时间够长**
- 至少 3 天
- 避开节假日
- 涵盖工作日 + 周末

**原则 4: 预算对等**
- 两组预算 50 : 50
- 不要给"偏心"
- 统一开始 + 结束时间

**原则 5: 数据清洗**
- 排除异常数据（比如突然大推）
- 排除爬虫点击
- 排除重复转化

**A/B 测试工作流**

**Week 1: 素材大测**
- 准备 10 条素材
- 每条投 3000 元
- 保留 ROI Top 3
- 淘汰 Bottom 5

**Week 2: 封面优化**
- 对 Top 3 素材测封面
- 每素材 3 个封面
- 保留最优

**Week 3: 标题优化**
- 对最优素材测 10 个标题
- 保留 Top 3
- 组合最优

**Week 4: 定向优化**
- 对最优组合测定向
- 找到最精准人群
- 规模化

**常见测试误区**

- ❌ 没耐心，2 小时就下结论
- ❌ 两组同时改多个变量
- ❌ 小样本下结论
- ❌ 忽略季节性
- ❌ 测试完不优化

**工具推荐**

- 巨量引擎自带 A/B 测试
- Google Optimize（免费）
- Optimizely（专业）
- VWO（企业）

**AI A/B 测试生成**

用 AI 同时生成多个变体：

**Prompt 示例**
\`\`\`
为这段 60 秒短剧生成 10 个版本的：
- 开头 3 秒钩子（不同类型）
- 标题（不同公式）
- 封面文字（不同风格）

要求每个版本都基于不同的 A/B 变量，方便我测试。
\`\`\`

**付费短剧 A/B 测试的关键指标**

| 指标 | 含义 | 健康值 |
|---|---|---|
| CTR | 点击率 | > 2% |
| VV | 播放量 | 越多越好 |
| 3s 完播 | 前 3 秒完播 | > 80% |
| 15s 完播 | 前 15 秒完播 | > 50% |
| 付费率 | 付费用户比例 | > 5% |
| ROAS | 投产比 | > 1.5 |

**综合公式**
\`\`\`
最佳素材 = CTR × 3s 完播率 × 付费率 × ROAS
\`\`\`

选总分最高的素材规模化投放。`,
    tags: ['a/b测试', '优化', '方法论', '数据'],
    keywords: ['a/b testing', 'ab test', 'creative optimization', 'conversion rate', 'roas optimization'],
    prompt_snippets: [
      'design 5-variant A/B test for video creative opening',
      'generate 10 title variations for A/B testing',
      'analyze A/B test results across CTR, VV, completion, ROAS',
    ],
    applies_to: ['growth_ops', 'copywriter'],
    source: 'A/B 测试方法论 + 投流优化实战经验',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_prod_go_matrix_account',
    collection: 'production',
    subcategory: '运营增长',
    title: '账号矩阵运营（主号 + 小号 + 分发号）',
    summary: '单账号 = 鸡蛋放一个篮子。矩阵运营 = 1 主号 + 5 小号 + 10 分发号。风险分散 + 流量叠加。',
    content: `**矩阵运营的核心逻辑**

**单账号的 3 大风险**
1. 违规风险：一次违规可能封号
2. 审美疲劳：同一内容风格易疲劳
3. 流量天花板：单账号有上限

**矩阵的 3 大优势**
1. 风险分散：一个号封了还有其他
2. 人群覆盖：不同号触达不同人群
3. 数据互补：多账号数据汇总分析

**典型矩阵结构：1 + 5 + 10**

**主号 (1 个)**
- 定位：品牌 / IP 主阵地
- 内容：精品 + 原创
- 发布频率：每周 3-5 条
- 运营：深度
- 目标：沉淀粉丝 + 品牌资产

**小号 (5 个)**
- 定位：不同垂类试水
- 内容：主号内容二次剪辑 / 片段 / 花絮
- 发布频率：每日 1-2 条
- 运营：半自动
- 目标：矩阵流量 + 分担风险

**分发号 (10 个)**
- 定位：纯粹引流
- 内容：主号内容复制 + 改编
- 发布频率：每日 3-5 条
- 运营：全自动
- 目标：最大化曝光

**矩阵的人设差异化**

每个号必须有独立人设，不能完全重复：

**主号：XXX 官方**
- 定位：正统 + 权威
- 风格：精致 + 高冷

**小号 1：XXX 幕后**
- 定位：花絮 + 拍摄过程
- 风格：真实 + 亲切

**小号 2：XXX 评论**
- 定位：影评 + 分析
- 风格：专业 + 深度

**小号 3：XXX 配音**
- 定位：角色配音 / 台词
- 风格：声音内容

**小号 4：XXX 同人**
- 定位：粉丝互动
- 风格：社区感

**小号 5：XXX 二创**
- 定位：剪辑 / 混剪
- 风格：创意

**分发号：不同地域 / 垂类**
- XXX 东北分舵
- XXX 美食推荐
- XXX 情感语录
- ……

**矩阵的数据策略**

**主号数据 = 品牌健康度**
- 涨粉率
- 互动率
- 品牌搜索量
- UGC 数量

**小号数据 = 矩阵效果**
- 总播放量（所有号汇总）
- 跨号引流率
- 矩阵粉丝重叠率

**分发号数据 = 纯流量**
- 每条视频播放量
- CPM
- 无需考虑粉丝

**矩阵的 10 个运营原则**

**1. 账号分离**
- 不同手机 / IP / 设备
- 不要交叉登录
- 避免平台判定关联降权

**2. 内容差异**
- 同一素材不同包装
- 不同封面 + 不同标题
- 至少 30% 差异

**3. 发布错峰**
- 主号发布 → 间隔 2 小时 → 小号发布
- 间隔 2 小时 → 分发号发布
- 避免同时发同一内容

**4. 互动分离**
- 不要用主号给小号点赞
- 不要用小号大量转发主号
- 避免关联判定

**5. 专人专号**
- 小号由不同人运营
- 避免一人登录多号
- 减少关联风险

**6. 内容对齐**
- 所有号都要遵守品牌调性
- 核心信息一致
- 避免消息混乱

**7. 数据汇总**
- 统一后台看所有号数据
- 定期矩阵周报
- 找到最有效的号

**8. 优胜劣汰**
- 每月评估
- 淘汰低效号
- 扶持高效号

**9. 备用账号**
- 随时有 3-5 个备用号
- 主号被限立刻启用
- 避免流量断档

**10. 品牌护城河**
- 所有号都指向品牌
- 品牌 hashtag 统一
- 建立矩阵生态

**矩阵工具**

- **矩阵管家**（第三方）：多账号管理
- **新榜**：数据监控
- **蝉妈妈**：矩阵分析
- **企业微信**：内部管理
- **Notion / 飞书**：矩阵文档

**矩阵成本结构**

| 项目 | 月成本 | 备注 |
|---|---|---|
| 主号运营人员 | 8000-15000 | 1 人 |
| 小号运营人员 | 5000-10000 | 1 人管 5 个号 |
| 分发号自动化 | 2000-5000 | 工具 + 人工 |
| 内容制作 | 10000-50000 | 剪辑 + 拍摄 |
| 投流预算 | 10000+ | 按需 |
| 工具订阅 | 2000-5000 | 管理工具 |

**矩阵起步建议**

**新手（0-1 个月）**
- 1 主号 + 2 小号
- 投入：1 人
- 目标：跑通流程

**进阶（1-3 个月）**
- 1 主号 + 5 小号
- 投入：2 人
- 目标：矩阵初见成效

**成熟（3-6 个月）**
- 1 主号 + 5 小号 + 10 分发号
- 投入：3-5 人
- 目标：稳定 ROI

**规模（6 个月+）**
- 多主号 + 多小号 + 分发号网络
- 投入：5-15 人
- 目标：行业头部

**禁忌**
- ❌ 不要同内容 + 同时发布
- ❌ 不要交叉登录
- ❌ 不要让所有号都同风格
- ❌ 不要忽略风险管理`,
    tags: ['矩阵', '账号', '运营', '风险'],
    keywords: ['account matrix', 'multi-account', 'distribution network', 'risk diversification', 'matrix operation'],
    prompt_snippets: [
      'design 1 main + 5 secondary + 10 distribution account matrix',
      'differentiate content across matrix accounts while maintaining brand',
      'staggered publishing schedule across 16 accounts to avoid algorithm penalty',
    ],
    applies_to: ['growth_ops', 'executive_producer'],
    source: '抖音 / 快手 / 微信 / YouTube 矩阵运营实战经验',
    lang: 'zh-en',
    enabled: true,
  },

  // ═══════════════════════════════════════════════════
  // ⑦ 制片协调（executive_producer）
  // ═══════════════════════════════════════════════════
  {
    id: 'kb_prod_ep_workflow',
    collection: 'production',
    subcategory: '制片协调',
    title: 'AI 短剧全流程项目管理（选题 → 剧本 → 分镜 → 生成 → 后期 → 发布）',
    summary: '一部 AI 短剧的完整 7 阶段流程 + 每阶段的 agent 协作 + 时间预估。',
    content: `**完整 7 阶段工作流**

**Phase 1: 选题 (Day 1-2)**

**任务**
- 市场调研（市场调研官）
- 竞品分析
- 目标用户定位
- 题材确认

**产出**
- 选题方案文档
- 目标用户画像
- 竞品对标表
- ROI 预估

**协作 Agent**
- 🎯 市场调研官（提供数据）
- 🎩 制片（决策）
- 📝 文案策划（优化题材表达）

**Phase 2: 剧本 (Day 2-5)**

**任务**
- 大纲创作
- 分集编写
- 对白润色
- 审核修改

**产出**
- 完整剧本（80 集 / 30 集 / 短剧）
- 角色档案
- 分集梗概
- 台词表

**协作 Agent**
- ✍️ 编剧（主力）
- 🎯 市场调研官（数据支持）
- 📝 文案策划（金句）
- 🎩 制片（把关）

**Phase 3: 艺术 Bible (Day 5-7)**

**任务**
- 建立视觉风格
- Moodboard 制作
- 色板锁定
- 角色设定

**产出**
- Style Bible
- Moodboard (30 张参考图)
- 色板文档
- 角色三视图

**协作 Agent**
- 🎨 艺术总监（主力）
- 🎬 导演
- 🎭 人物一致性
- 🌫️ 氛围师

**Phase 4: 分镜 (Day 7-12)**

**任务**
- 每集 shot list
- Prompt 编写
- 参考图准备

**产出**
- Shot list 表格
- 每镜英文 + 中文 prompt
- 参考图库

**协作 Agent**
- 🎬 导演（主力）
- 🎥 分镜师
- 🌫️ 氛围师
- 🎭 人物一致性

**Phase 5: AI 生成 (Day 12-20)**

**任务**
- 文生图 / 图生视频
- 多轮迭代
- 质量把控

**产出**
- 所有镜头素材（通常 500-2000 镜）
- 废片记录
- 质量评分

**协作 Agent**
- 🎬 导演（复核）
- 🎩 制片（进度管理）
- 🎨 艺术总监（质量把关）

**Phase 6: 后期 (Day 20-25)**

**任务**
- 剪辑
- 调色
- 配音
- 配乐
- 字幕
- 特效

**产出**
- 成片（每集 / 每条）
- 多版本素材
- 封面 / 标题

**协作 Agent**
- ✂️ 剪辑师（主力）
- 🎤 配音
- 🌫️ 氛围师（调色）
- 📝 文案策划（标题 / 封面）

**Phase 7: 发布 + 运营 (Day 25+)**

**任务**
- 多平台分发
- A/B 测试
- 数据监控
- 迭代优化

**产出**
- 发布报表
- 数据分析
- 迭代方案

**协作 Agent**
- 📈 运营增长（主力）
- 📝 文案策划（平台文案）
- 🌍 本地化（海外版）
- 🎩 制片（决策）

**时间预估**

**单集 60 秒 AI 漫剧**
- 选题 + 剧本：3-5 天
- 分镜 + 生成：5-7 天
- 后期：2-3 天
- 总计：10-15 天

**10 集短剧**
- 整体规划：7 天
- 单集并行：15 天
- 串并行：20-30 天

**80 集长剧**
- 整体规划：14 天
- 多团队并行：60-90 天

**加速策略**

**并行化**
- 多集同时进行
- 前集后期 + 后集分镜
- 3 人以上团队

**模板化**
- 复用角色设定
- 复用场景
- 复用剪辑模板

**自动化**
- AI 脚本生成
- 批量 prompt
- 自动剪辑（如剪映 AI）

**检查点机制**

每个阶段结束前必须经过"检查点"：

**Phase 1 Check**：选题是否符合市场？
**Phase 2 Check**：剧本是否有爆款潜力？
**Phase 3 Check**：视觉风格是否统一？
**Phase 4 Check**：分镜是否清晰可执行？
**Phase 5 Check**：素材质量是否达标？
**Phase 6 Check**：成片是否符合预期？
**Phase 7 Check**：数据是否健康？

**未通过检查点 → 不进入下一阶段**

**资源预算**

**单集 60 秒 AI 漫剧成本**
- Prompt 设计：500-1500 元
- AI 生成成本：200-1000 元（取决于模型）
- 后期成本：300-800 元
- 音乐 / 配音：200-500 元
- 总计：1200-3800 元

**10 集短剧**
- 1.2-3.8 万
- 可压缩到 8000-15000（用开源模型）

**80 集长剧**
- 10-30 万
- 需要团队协作

**项目管理工具**

- **Notion**：文档 + 进度
- **飞书 / 企业微信**：沟通
- **Trello**：看板管理
- **Asana**：任务管理
- **Gantt**：时间规划

**禁忌**

- ❌ 不要跳过检查点
- ❌ 不要单集质量差却继续
- ❌ 不要忽略数据反馈
- ❌ 不要让 agent 之间信息断层
- ❌ 不要把时间压得太紧`,
    tags: ['全流程', '项目管理', 'AI短剧', '协作'],
    keywords: ['project management', 'workflow', 'production pipeline', 'ai drama workflow', 'cross functional team'],
    prompt_snippets: [
      'execute 7-phase AI drama production workflow',
      'coordinate market research → script → storyboard → generation → post → release',
      'milestone checkpoints between phases',
    ],
    applies_to: ['executive_producer', 'growth_ops'],
    source: 'AI 短剧工业化生产流程 + 项目管理方法论',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_prod_ep_decision_framework',
    collection: 'production',
    subcategory: '制片协调',
    title: '创意决策框架（何时做 / 何时改 / 何时砍 / 何时延）',
    summary: '制片人每天面对无数创意决策。4 个决策框架 + 10 个决策准则，避免犹豫和后悔。',
    content: `**制片人的 4 大决策类型**

**Decision 1: 何时做（Go）**
**Decision 2: 何时改（Revise）**
**Decision 3: 何时砍（Kill）**
**Decision 4: 何时延（Delay）**

**决策框架 1: Go - 何时果断执行**

**Go 的 5 个标志**
1. 市场数据支持（不是拍脑袋）
2. 团队有能力执行
3. 成本可承受（亏也不至于破产）
4. 时间窗口紧迫（错过就没了）
5. 核心决策者有信心

**Go 的决策工具：GIST**
- **G**oal：目标是什么
- **I**nsight：关键洞察是什么
- **S**trategy：策略是什么
- **T**actic：战术是什么

**示例 - 决定做一部仙侠漫剧**
- Goal：打入女频市场
- Insight：仙侠赛道 2024 爆款频出
- Strategy：差异化（不走《苍兰诀》同质化）
- Tactic：用 AI 生成 + 男主独特人设

**Go 决定**：全员投入，4 周产出第一集。

**决策框架 2: Revise - 何时修改**

**Revise 的 4 个触发点**
1. 观众数据不符合预期（但方向对）
2. 团队反馈有明显漏洞
3. 新的竞品信息改变了市场
4. 执行中发现原计划不可行

**Revise 的决策工具：3R**
- **R**etain：保留什么（核心）
- **R**eplace：替换什么（可改）
- **R**emove：移除什么（废弃）

**示例 - 第 3 集数据不佳，决定修改**
- Retain：角色设定 + 核心剧情（这是对的）
- Replace：剪辑节奏（太慢，改快）
- Remove：支线剧情（分散注意力）

**Revise 原则**
- 改核心 = 大手术（慎）
- 改形式 = 小手术（可）
- 改细节 = 微调（随时）

**决策框架 3: Kill - 何时砍掉**

**Kill 的 5 个信号**
1. 连续 3 次数据不达标
2. 修改已经改不动了
3. 成本超预算 50%
4. 团队失去信心
5. 市场窗口关闭

**Kill 的决策工具：SUNK COST FALLACY**

**沉没成本谬误**
- 已经投入的不是决策依据
- 决策只看"未来收益"
- 已投入 10 万但未来 20 万亏损？砍

**示例 - 一部投入 20 万但数据持续不佳**
- 已投入：20 万（沉没成本，不考虑）
- 继续投入：10 万
- 预期收益：5 万（失败概率 80%）
- 数学：-10 万 × 80% + 5 万 × 20% = -7 万
- 决策：Kill！

**Kill 不是失败**
- 砍掉 = 止损
- 继续 = 扩大损失
- 砍掉 = 释放资源给新机会

**决策框架 4: Delay - 何时延后**

**Delay 的 4 个理由**
1. 时机未到（市场未成熟）
2. 资源不足（现在做不好）
3. 技术未到（工具不支持）
4. 竞品太强（硬碰硬不划算）

**Delay 的决策工具：Wait for Catalyst**

**等待催化剂**
- 什么事件发生后可以重启？
- 新工具 / 新资金 / 新人才
- 具体时间点（不能无限拖）

**示例 - 想做一部海外漫剧但英文配音不到位**
- 等待催化剂：ElevenLabs v3 中英切换升级
- 预期时间：3-6 个月
- 替代：先做国内版

**Delay 原则**
- 必须设定"重启条件"
- 不能无限拖
- Delay ≠ 忘记

**10 个决策准则**

**#1 数据优先于直觉**
- 直觉可以提示，数据决策
- 无数据时才靠直觉

**#2 小步试错**
- 不确定就先 MVP
- 1 集 → 10 集 → 80 集

**#3 速度优于完美**
- 完美是完成的敌人
- 80 分发布 > 100 分延期

**#4 倾听用户不等于盲从**
- 用户说"我想要更快的马"
- 但真正的答案是"汽车"

**#5 及时止损**
- 沉没成本不是决策理由
- 果断砍是领导力

**#6 长期优于短期**
- 短期爽 vs 长期健康
- 品牌积累需要时间

**#7 避免决策疲劳**
- 重要决策放在上午
- 小决策交给规则 / 授权

**#8 团队意见兼听则明**
- 不要只听一个人
- 多角度看问题

**#9 决策后不反悔**
- 做了就执行
- 执行中发现问题再改
- 不要"做了又撤"

**#10 复盘所有决策**
- 每周 / 每月复盘
- 对了总结成功因素
- 错了找原因不找借口

**决策速度**

**快决策（< 1 小时）**
- 小事 / 低成本
- 日常事务

**中决策（1-7 天）**
- 项目方向
- 资源分配

**慢决策（1 个月+）**
- 战略方向
- 大笔投入

**禁忌**

- ❌ 不要拖延重要决策
- ❌ 不要因情感 override 数据
- ❌ 不要独裁（听听团队）
- ❌ 不要民主到底（最终要有人负责）
- ❌ 不要反复横跳`,
    tags: ['决策', '制片', '框架', '管理'],
    keywords: ['decision framework', 'go no-go', 'sunk cost', 'kill decision', 'executive producer', 'project management'],
    prompt_snippets: [
      'evaluate Go decision using GIST framework',
      'revise strategy with 3R: Retain Replace Remove',
      'kill decision when sunk cost fallacy applies',
      'delay until catalyst event occurs',
    ],
    applies_to: ['executive_producer'],
    source: '制片管理 + 产品决策框架（Eric Ries Lean Startup 等）',
    lang: 'zh-en',
    enabled: true,
  },
];
