/**
 * 分镜库 seed
 *
 * 覆盖：Sora 2 / Veo 3.1 / Kling 2.1 / Runway Gen-4 的各自 prompt schema +
 * 电影大师（Nolan/Wes Anderson/Fincher/Villeneuve/Deakins/Lubezki）镜头语言 +
 * 动作戏分镜 + MV 镜头语言 + 一镜到底技法
 */

module.exports = [

  // —— v1 原有条目 ——
  {
    id: 'kb_sb_shot_emotion_matrix',
    collection: 'storyboard',
    subcategory: '景别矩阵',
    title: '景别 × 情绪矩阵（哪种情绪用哪种景别）',
    summary: '情绪与景别有黄金对应：孤独用远景留白、紧张用特写、震撼用鸟瞰。',
    content: `| 情绪 | 首选景别 | 次选 | 禁用 |
| 孤独/思念 | 远景+留白 | 特写侧脸 | 全景热闹 |
| 对话/日常 | 中景+过肩 | 近景正反打 | 鸟瞰 |
| 紧张/恐惧 | 仰角+特写 | 荷兰角+手持 | 远景+静止 |
| 浪漫/温馨 | 近景+浅景深 | 环绕+暖光 | 俯角+冷调 |
| 愤怒/冲突 | 仰角+推进 | 手持+快切 | 慢推+柔光 |
| 震撼/史诗 | 鸟瞰/远景 | 升镜+广角 | 特写+静止 |
| 悲伤/告别 | 特写+后拉 | 远景+留白 | 快切+鲜色 |`,
    tags: ['景别', '情绪', '分镜'],
    keywords: ['shot scale', 'emotion matrix', 'composition', 'extreme close-up', 'bird eye'],
    prompt_snippets: [
      'extreme wide shot with negative space for loneliness',
      'low angle close-up for tension and fear',
      'bird eye view for epic scale',
    ],
    applies_to: ['director', 'storyboard'],
    source: '电影摄影通用原理 + VIDO dramaService',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_sb_seedance_multishot',
    collection: 'storyboard',
    subcategory: '分镜模板',
    title: 'Seedance 2.0 多镜头叙事范式',
    summary: 'Seedance 2.0 强调：每个镜头只做一件事 + 镜头间设计视觉钩子 + 多角色交互时分配主/反应/全景三类镜头。',
    content: `Seedance 2.0 核心多镜头思维：
1) 每个镜头只完成"一个主体动作 + 一个情绪传达"，不要塞太多事件
2) 镜头间设"视觉钩子"——上镜结尾暗示下镜开头（动作匹配 / 视线引导 / 物件传递）
3) 多角色场景用三类镜头交替：
   - 主视角：正在发生动作的角色
   - 反应镜头：另一个角色的面部反应
   - 全景交代：说明空间关系
4) 每镜时长 3-5s 为主，紧张段 2-3s，情感段 5-8s
5) 色调与光线在整组镜头中保持锚点一致，禁止色调跳变`,
    tags: ['seedance', '多镜头', '分镜', 'AI视频'],
    keywords: ['seedance 2.0', 'multi-shot', 'visual hook', 'action match cut'],
    prompt_snippets: [
      'single subject action per shot, one emotion per shot',
      'match cut between action end and next action start',
      'alternate main POV, reaction close-up, and wide establishing shot',
    ],
    applies_to: ['screenwriter', 'director', 'storyboard'],
    source: '抖音 @阿拉赛博蕾《seedance2.0+seedream5.0高级玩法》合成整理 + Seedance 2.0 公开技术文档',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_sb_veo3_5part_formula',
    collection: 'storyboard',
    subcategory: '运镜公式',
    title: 'Veo 3.1 五段式 Prompt 公式（Cinematography + Subject + Action + Context + Style）',
    summary: '所有 visual_prompt 必须按 5 段顺序写：镜头前置 → 主体 → 动作 → 环境 → 风格氛围。',
    content: `严格顺序（camera instruction 必须前置，这是 Sora 2 的核心法则）：
1) Cinematography：镜头类型 + 景深 + 焦段
   例: "Low-angle tracking shot, shallow depth of field, anamorphic lens"
2) Subject：角色完整外貌 + 服装 + 表情 + 姿态
   例: "young woman with long black hair, blue eyes, white dress, melancholic expression"
3) Action：1-2 个具体动作节拍
   例: "slowly reaching out to touch a frozen rose, fingers trembling"
4) Context：地点 + 天气 + 季节 + 时间 + 环境细节
   例: "inside a dimly lit weather station, cold blue monitor light, snow outside window"
5) Style & Ambiance：光源 + 色调(3-5色) + 画风 + 氛围
   例: "cool blue and warm amber palette, side lighting, Japanese anime style, cinematic, 4K"`,
    tags: ['veo', '公式', 'prompt', 'cinematography'],
    keywords: ['5-part prompt', 'camera first', 'veo 3.1', 'anamorphic'],
    prompt_snippets: [
      'Low-angle tracking shot, shallow depth of field, anamorphic lens',
      'cool blue and warm amber palette, side lighting, cinematic, 4K',
      'Japanese anime style, melancholic atmosphere',
    ],
    applies_to: ['director', 'storyboard'],
    source: 'Google Veo 3.1 prompt guide + OpenAI Sora 2 公开建议',
    lang: 'en-zh',
    enabled: true,
  },
  {
    id: 'kb_sb_composition_rules',
    collection: 'storyboard',
    subcategory: '构图法则',
    title: '七条构图法则（三分 / 对角线 / 框中框 / 前景虚化 / 对称 / 留白 / 引导线）',
    summary: '每个镜头必须明确使用的构图法则，并给出"为什么"。',
    content: `- 三分法：主体在交叉点，留出视线方向空间
- 对角线：动态能量，从左下到右上
- 框中框：用门 / 窗 / 镜子 framing，表达窥视或隔阂
- 前景虚化：bokeh 前景增加纵深和电影质感
- 对称：仪式 / 对峙 / 建筑 / 镜像
- 留白 (negative space)：孤独 / 思考 / 极简美学
- 引导线：道路 / 河流 / 走廊引导视线至主体`,
    tags: ['构图', '法则', '分镜'],
    keywords: ['rule of thirds', 'diagonal', 'frame within frame', 'negative space', 'leading lines'],
    prompt_snippets: [
      'rule of thirds composition',
      'frame within frame through a doorway',
      'diagonal composition from lower left to upper right',
      'negative space emphasizing loneliness',
    ],
    applies_to: ['director', 'storyboard'],
    source: '电影摄影通用构图理论',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_sb_pacing_control',
    collection: 'storyboard',
    subcategory: '节奏控制',
    title: '节奏三档：slow / normal / fast 对应的镜头时长与运镜',
    summary: 'slow ≥ 5s + 静止或慢推，normal 3-5s + 常规运镜，fast 2-3s + 快切或甩镜。',
    content: `三档节奏：
- slow（情感/孤独/重要凝视）≥5s：静止 / 缓推 / 环绕 / 长特写
- normal（日常对话/过渡）3-5s：中景 / 过肩 / 跟踪 / 横摇
- fast（紧张/冲突/追逐）2-3s：手持 / 甩镜 / 快切 / 荷兰角
节奏切换要与剧情情绪对齐：不要在情感段用快切，不要在动作段用慢推。每一组镜头节奏 ≤3 次切换。`,
    tags: ['节奏', 'pacing', '镜头时长'],
    keywords: ['pacing', 'shot duration', 'rhythm', 'fast cut', 'long take'],
    prompt_snippets: [
      'slow pacing, 5 seconds long take',
      'fast pacing, 2 second quick cut, handheld whip pan',
    ],
    applies_to: ['director', 'storyboard'],
    source: '电影剪辑通用理论 + VIDO dramaService',
    lang: 'zh',
    enabled: true,
  },

  // ═══════════════════════════════════════════════════
  // —— v2 新增：AI 模型专属 schema ——
  // ═══════════════════════════════════════════════════
  {
    id: 'kb_sb_v2_sora2_schema',
    collection: 'storyboard',
    subcategory: '运镜公式',
    title: 'OpenAI Sora 2 专用 Prompt Schema（2025 最新）',
    summary: 'Sora 2 支持物理准确 + 原生音频 + 最长 60 秒。Prompt 必须按 Camera → Subject → Action → Environment → Audio → Style 六段写。',
    content: `Sora 2 相比 Sora 1 的关键升级（2025 年 10 月发布）：
- 60 秒长镜头（原 20 秒）
- 原生音频生成（对话 / 环境音 / 背景音乐同步）
- 物理准确度大幅提升
- 支持 1080p 输出
- 角色一致性跨镜头

**Sora 2 六段式 Prompt Schema**

**Segment 1: Camera Instruction（必须前置）**
- 镜头类型 + 焦段 + 运动
- 例："medium tracking shot, 35mm lens, slow push-in"
- 注意：Sora 2 对 anamorphic / dolly / steadicam 识别极好

**Segment 2: Subject**
- 主角外貌锁定（英文关键词）
- 服装 + 表情 + 姿态
- 例："a young Asian woman with mid-length black hair, wearing a white cotton shirt, melancholic expression, standing still"

**Segment 3: Action Beats**
- 1-2 个具体动作
- 用物理描述而非抽象词
- 例："slowly turning her head to look at the falling petals, hand lifting to catch one"

**Segment 4: Environment**
- 地点 + 天气 + 时间 + 光源
- 例："inside a quiet traditional Japanese garden, late afternoon, soft golden sunlight filtering through maple leaves"

**Segment 5: Audio Design（Sora 2 独有）**
- 环境底噪 + 关键音效 + 对白
- 例："sound of gentle wind, rustling leaves, distant wind chime, no dialogue"
- 对白格式："she whispers, 'I remember this place.'"

**Segment 6: Style Anchor**
- 画风 + 色调 + 后期
- 例："cinematic, teal and amber color grade, shallow depth of field, subtle film grain, 4K"

**完整 Sora 2 Prompt 示例**
\`\`\`
Medium tracking shot, 50mm lens, slow dolly in.
A young Asian woman with mid-length raven-black hair,
wearing an oversized cream sweater, melancholic expression,
standing alone on an empty train platform.
She slowly turns her head as a leaf falls past her face,
lifting her hand hesitantly to catch it.
Inside a quiet old railway station, overcast autumn afternoon,
soft diffused cool light, distant steam from an arriving train.
Ambient sound of distant train horn, gentle wind, rustling leaves,
no dialogue.
Cinematic, muted color grade with warm amber accents,
shallow depth of field, subtle film grain, 4K.
\`\`\`

**Sora 2 禁忌**
- 不要超过 6 个段落（会失去重点）
- 不要在动作段写情绪词（Sora 看不懂"sad"，要写"tears in eyes"）
- 不要用负面描述（"no people in background" 无效，改为 "empty background"）
- 不要混用 2D/3D 风格词（cartoon + realistic）`,
    tags: ['sora', 'openai', 'prompt', 'schema'],
    keywords: ['sora 2', 'openai sora', 'six segment prompt', 'audio design', 'physics accuracy'],
    prompt_snippets: [
      'Medium tracking shot, 50mm lens, slow dolly in',
      'Sound of gentle wind, rustling leaves, distant wind chime',
      'Cinematic, teal and amber color grade, subtle film grain, 4K',
    ],
    applies_to: ['director', 'storyboard'],
    source: 'OpenAI Sora 2 官方文档 + 2025 prompting 最佳实践',
    lang: 'en',
    enabled: true,
  },
  {
    id: 'kb_sb_v2_veo31_cinematographer',
    collection: 'storyboard',
    subcategory: '运镜公式',
    title: 'Google Veo 3.1 摄影指导 Prompt 模式（2025 最新）',
    summary: 'Veo 3.1 支持原生音频 + Ingredients (参考图) + 4K。Prompt 用"DOP 备忘录"风格最有效。',
    content: `Veo 3.1 特性（2025 年 10 月发布）：
- 原生音频（含对话、音效、音乐）
- Ingredients 功能（上传最多 3 张参考图做视觉锚点）
- Scene Extension（延长已生成视频）
- 增强的镜头控制

**Veo 3.1 "DOP 备忘录" Prompt 模式**

用专业电影摄影师（Director of Photography）给助手写备忘录的语气：

\`\`\`
Shot #1: [类型] [焦段] [运动]
Subject: [主角描述]
Action: [动作节拍]
Lighting: [光源 + 方向 + 色温]
Lens: [焦段 + 特性]
Color: [色调]
Mood: [氛围]
Audio: [环境 + 对白]
Reference: [风格参考，可选]
\`\`\`

**示例**
\`\`\`
Shot #1: Wide establishing shot, 24mm lens, static.
Subject: A lone traveler in a long brown coat standing at the edge of a salt flat.
Action: The traveler slowly raises her head toward the horizon.
Lighting: Harsh midday sun, high contrast, practical sun backlighting creating a silhouette.
Lens: 24mm anamorphic with natural lens flare from sun.
Color: Bleached white ground contrasting with dark silhouette, sepia sky.
Mood: Isolation, vast scale, existential loneliness.
Audio: Distant wind howling across the flats, no dialogue, subtle low drone.
Reference: Roger Deakins cinematography, desert epic style.
\`\`\`

**Ingredients 功能 (Veo 3.1 独有)**
可以上传最多 3 张参考图，分别用于：
1. **Subject Ingredient**: 锁定角色外貌
2. **Environment Ingredient**: 锁定场景
3. **Style Ingredient**: 锁定色调 / 画风

这比纯文字 prompt 的一致性强 10 倍。

**Veo 3.1 音频 prompt 技巧**
\`\`\`
Audio:
  Ambient: ocean waves, gentle breeze
  SFX: footsteps on sand at 0:03
  Music: melancholic cello, fade in at 0:05
  Dialogue: She says quietly, "I finally made it."
\`\`\`

**Veo 3.1 vs Sora 2 对比**
| 维度 | Veo 3.1 | Sora 2 |
|---|---|---|
| 最长时长 | 60s (extend 可到 2 min+) | 60s |
| 音频 | 原生多层音轨 | 原生 |
| 参考图 | Ingredients (3 张) | 无 |
| 物理 | 优秀 | 优秀 |
| 镜头控制 | 强 | 强 |
| 4K | ✓ | ✓ |
| 长镜头稳定性 | 更强 | 稍弱 |`,
    tags: ['veo', 'google', 'ingredients', 'dop'],
    keywords: ['veo 3.1', 'google veo', 'dop memo', 'ingredients feature', 'scene extension'],
    prompt_snippets: [
      'Wide establishing shot, 24mm anamorphic lens, natural lens flare',
      'Lighting: harsh midday sun, high contrast, practical backlighting',
      'Reference: Roger Deakins cinematography, desert epic style',
    ],
    applies_to: ['director', 'storyboard'],
    source: 'Google Veo 3.1 官方文档 + 2025 最佳实践',
    lang: 'en',
    enabled: true,
  },
  {
    id: 'kb_sb_v2_kling21_camera',
    collection: 'storyboard',
    subcategory: '运镜公式',
    title: '可灵 Kling 2.1 / 2.5 镜头控制语法（中文 AI 视频顶级）',
    summary: '可灵支持精准的 camera motion 指令 + 首尾帧控制 + 角色一致性 subject reference。中文 prompt 友好。',
    content: `快手可灵（Kling）2024-2025 升级到 2.1/2.5 版本，在中文市场是 Sora 和 Veo 的主要替代品。

**可灵核心功能**
- 文生视频 / 图生视频 / 首尾帧生视频
- 最长 10 秒（专业版 2 分钟）
- 1080p 输出
- 角色一致性（subject reference）
- 精准 camera motion
- 中文 prompt 极友好

**可灵镜头控制 6 大指令**

**1. Push-in (推进)**
\`\`\`
镜头缓慢推进，聚焦主体面部
camera slowly pushes in, focusing on subject's face
\`\`\`

**2. Pull-out (后拉)**
\`\`\`
镜头缓慢后拉，展现主体所在环境的全貌
camera slowly pulls back, revealing the full environment
\`\`\`

**3. Pan (摇镜)**
\`\`\`
镜头从左向右缓慢摇移
camera pans slowly from left to right
\`\`\`

**4. Tilt (俯仰)**
\`\`\`
镜头从地面缓慢向上仰起
camera tilts up slowly from ground level
\`\`\`

**5. Orbit (环绕)**
\`\`\`
镜头围绕主体顺时针环绕 180 度
camera orbits 180 degrees clockwise around subject
\`\`\`

**6. Tracking (跟随)**
\`\`\`
镜头跟随主体向前移动
camera tracks forward following the subject
\`\`\`

**可灵首尾帧模式（独家优势）**
可以上传两张图：第一张是镜头起始画面，第二张是结束画面。可灵会自动生成中间过渡。
- 适合：完整的动作序列（从站起到坐下）
- 适合：环境变化（白天到夜晚）
- 适合：情绪转换（笑到哭）

**可灵中文 prompt 示例**
\`\`\`
一位穿白色长裙的年轻女子，站在樱花树下，
微风吹动花瓣。镜头缓慢推进，聚焦她
温柔的侧脸。背景虚化，暖金色阳光从叶
缝洒下。日系动漫风格，浅景深，电影感。
\`\`\`

**可灵 vs 国际模型对比**
| 维度 | 可灵 2.5 | Sora 2 | Veo 3.1 |
|---|---|---|---|
| 中文理解 | **极强** | 一般 | 一般 |
| 角色一致性 | 强 | 强 | 强 |
| 物理准确 | 优秀 | 优秀 | 优秀 |
| 镜头控制 | 强 | 强 | 强 |
| 首尾帧 | **独家** | 无 | 无 |
| 价格 | 低 | 高 | 中 |

**国内 AI 漫剧首选可灵 + 海外首选 Veo/Sora 的混合工作流**是 2025 年的最佳实践。`,
    tags: ['可灵', 'kling', '中文ai视频'],
    keywords: ['kling 2.1', 'kling 2.5', 'chinese ai video', 'kuaishou', 'first last frame', 'subject reference'],
    prompt_snippets: [
      '镜头缓慢推进，聚焦主体面部，浅景深',
      '镜头从地面缓慢向上仰起，展现全景',
      '镜头围绕主体顺时针环绕 180 度',
      'camera tracks forward following the subject, cinematic lighting',
    ],
    applies_to: ['director', 'storyboard'],
    source: '快手可灵 2024-2025 官方文档 + 国内 AI 漫剧工作流实践',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_sb_v2_runway_gen4',
    collection: 'storyboard',
    subcategory: '运镜公式',
    title: 'Runway Gen-4 / Gen-4 Turbo references 模式',
    summary: 'Runway Gen-4 最强的是 References 功能：上传 3-5 张参考图，自动保持角色/环境/风格一致。',
    content: `Runway Gen-4 (2025) 相比 Gen-3 的核心升级：
- **References 功能**：上传最多 5 张参考图
- 角色一致性跨镜头
- 环境一致性
- 风格一致性
- 10 秒单镜头 + 2 分钟 Act One 长镜头
- 1080p / 4K upscale

**References 工作流**

**Step 1: 建立角色库**
- 为每个角色上传 3-5 张参考图（正面/侧面/全身）
- 给每个角色命名 @character_name

**Step 2: 建立环境库**
- 为每个主要场景上传 1-3 张参考图
- 命名 @location_name

**Step 3: 建立风格库**
- 上传 1-2 张风格参考（可以是电影截图 / 插画 / 照片）
- 命名 @style_reference

**Step 4: Prompt 中引用**
\`\`\`
@sarah walks into @coffee_shop, soft morning light,
reaching for a cup on the counter,
medium shot, slow push-in, @cinematic_amber style
\`\`\`

**Gen-4 Act One 模式**
Runway Gen-4 有独家的 Act One 功能 — 上传一段你自己的表演视频（用手机录），AI 会把你的表情和动作迁移到任意角色上。
- 适合：角色对话戏
- 适合：情绪细节（哭 / 笑 / 惊讶）
- 适合：难以描述的微表情

**Gen-4 Video to Video**
可以把现有视频"风格化"成动画 / 赛博朋克 / 油画风格。
- 输入：实拍视频
- 输出：保持动作和构图，转换风格

**Gen-4 的最佳实践**
- 不要同时引用超过 3 个 references（会混乱）
- 每个 reference 图要清晰、无遮挡
- 风格参考图优于文字风格描述
- 角色参考图必须面部清晰正脸

**Gen-4 vs 其他模型**
| 维度 | Gen-4 | Sora 2 | Veo 3.1 | Kling 2.5 |
|---|---|---|---|---|
| 参考图 | **5 张** | 无 | 3 张 | 1 张 |
| 角色一致性 | **最强** | 强 | 强 | 强 |
| Act One 迁移 | **独家** | 无 | 无 | 无 |
| V2V 风格化 | **独家** | 无 | 无 | 无 |
| 音频 | 无 | ✓ | ✓ | ✓ |`,
    tags: ['runway', 'gen-4', 'references', 'act one'],
    keywords: ['runway gen-4', 'references feature', 'act one', 'video to video', 'character reference'],
    prompt_snippets: [
      '@character walks into @location, @style reference',
      'Act One performance transfer from source video',
      'video to video style transfer with consistent motion',
    ],
    applies_to: ['director', 'storyboard', 'character_consistency'],
    source: 'Runway Gen-4 官方文档 2025',
    lang: 'en',
    enabled: true,
  },

  // ═══════════════════════════════════════════════════
  // —— v2 新增：电影大师镜头语言 ——
  // ═══════════════════════════════════════════════════
  {
    id: 'kb_sb_v2_nolan_time',
    collection: 'storyboard',
    subcategory: '分镜模板',
    title: '克里斯托弗·诺兰 (Christopher Nolan) 时间诡计镜头语言',
    summary: '诺兰的标志：多线时间剪辑 + IMAX 广角 + 实景拍摄 + 紧凑对白。AI 漫剧做复杂叙事时的参考。',
    content: `诺兰的核心视觉特征（《盗梦空间》《星际穿越》《敦刻尔克》《信条》《奥本海默》）：

**1. 多线时间剪辑**
- 同时推进 2-3 条时间线
- 用剪辑节奏制造焦虑感
- 每条线都有独立色调 / 光线
- 例：《敦刻尔克》一周/一天/一小时三线并行

**2. IMAX 广角 + 实景**
- 优先 65mm IMAX 摄影
- 真实场景 > 绿幕
- 避免过度 CG
- 大量远景镜头建立尺度感

**3. 紧凑对白 + 低频音乐**
- 对白语速快，信息密集
- 配乐以 Hans Zimmer 风格的低频弦乐 + 电子低音为主
- 环境音放大（风声 / 机器声）

**4. 反向镜头 & 时间倒流**
- 《信条》中的反向运动
- 《盗梦空间》的折叠城市
- 《奥本海默》的彩色/黑白切换

**5. 特写镜头的克制使用**
- 诺兰较少用大特写
- 更偏好中景 / 远景 + 人物在环境中的渺小感
- 用肢体动作表达情绪 > 用表情

**诺兰风格 Prompt 模板**
\`\`\`
wide cinematic shot, IMAX scale, 65mm anamorphic lens,
subject dwarfed by massive environment,
practical on-location cinematography, natural light,
cold blue and steel grey palette, high contrast,
Hans Zimmer style tension, intricate narrative atmosphere,
Christopher Nolan cinematography style
\`\`\`

**诺兰常用视觉锚点**
- 巨大机械 / 工业设备
- 无垠的自然景观（沙漠 / 海洋 / 雪原）
- 封闭空间的压迫（潜艇 / 电梯 / 飞机）
- 倒立 / 旋转 / 无重力
- 黑白 + 彩色交替

**应用场景**
- 复杂叙事的 AI 漫剧
- 科幻 / 战争 / 悬疑类型
- 需要"史诗感"的镜头`,
    tags: ['nolan', '诺兰', '大师镜头', '电影'],
    keywords: ['christopher nolan', 'imax', 'non-linear time', 'practical cinematography', 'hans zimmer', 'dunkirk', 'inception'],
    prompt_snippets: [
      'wide cinematic shot, IMAX scale, 65mm anamorphic lens',
      'subject dwarfed by massive industrial machinery, natural light',
      'cold blue and steel grey palette, high contrast, Nolan style',
      'multiple timeline intercut with different color palettes',
    ],
    applies_to: ['director', 'storyboard', 'atmosphere'],
    source: '克里斯托弗·诺兰 2000-2024 作品视觉风格分析',
    lang: 'en',
    enabled: true,
  },
  {
    id: 'kb_sb_v2_anderson_symmetry',
    collection: 'storyboard',
    subcategory: '构图法则',
    title: '韦斯·安德森 (Wes Anderson) 对称平面构图',
    summary: '完美对称 + 饱和色彩 + 平面化构图 + 俯视镜头 + 复古质感。近期 AI 漫剧美学热点。',
    content: `韦斯·安德森风格（《布达佩斯大饭店》《法兰西特派》《月升王国》《水中生活》）的视觉 DNA：

**1. 完美中心对称**
- 主角永远在画面正中
- 两侧元素完美镜像
- 背景也对称（灯 / 窗 / 画 / 椅子）
- 摄像机高度固定在主角视平线

**2. 平面化构图**
- 主体与背景平行
- 禁止斜角
- 禁止透视变形
- 感觉像舞台剧或立体书

**3. 饱和粉彩色板**
- 粉红 + 薄荷绿 + 奶油黄 + 浅蓝 + 紫丁香
- 每一部电影有一个主色（《布达佩斯》粉 / 《水中生活》蓝）
- 避免纯黑 / 纯白

**4. 俯视镜头 (God's Eye View)**
- 大量 90 度俯拍
- 物品陈列式（餐桌 / 工具 / 书桌）
- 像商品照片

**5. 画面内字幕 / 标签**
- 直接在画面上标注章节名 / 人名 / 地名
- 字体复古 Serif
- 增加叙事层次

**6. 线性运动**
- 横向跟拍 (lateral tracking)
- 90 度切镜
- 禁止任何斜角运动

**Wes Anderson 风格 Prompt 模板**
\`\`\`
perfect centered symmetric composition, flat frontal framing,
subject precisely in the middle of the frame,
pastel color palette (pink, mint green, cream, soft blue),
deliberate set design with mirrored elements,
overhead flat lay shot, whimsical retro atmosphere,
Wes Anderson cinematography style, The Grand Budapest Hotel aesthetic,
medium shot, static camera, cinematic 2.39:1 aspect ratio
\`\`\`

**常见构图**
- 单人正面直视镜头（像护照照片）
- 两人对峙（各占画面一半）
- 餐桌俯拍（所有餐具对齐）
- 长廊正对镜头（一点透视）
- 开卷照片（打开的书 / 信 / 地图正对镜头）

**应用场景**
- 文艺 / 复古 / 童话类 AI 漫剧
- 品牌广告 / 时尚短片
- 需要"高级感"和"作者性"的镜头`,
    tags: ['wes anderson', '韦斯安德森', '对称', '粉彩'],
    keywords: ['wes anderson', 'symmetry', 'pastel palette', 'grand budapest hotel', 'moonrise kingdom', 'centered composition'],
    prompt_snippets: [
      'perfect centered symmetric composition, flat frontal framing',
      'pastel color palette pink mint cream soft blue',
      'overhead flat lay shot with mirrored symmetric props',
      'Wes Anderson cinematography style, whimsical retro',
    ],
    applies_to: ['director', 'storyboard', 'atmosphere'],
    source: 'Wes Anderson 1996-2024 作品视觉风格分析',
    lang: 'en',
    enabled: true,
  },
  {
    id: 'kb_sb_v2_fincher_precision',
    collection: 'storyboard',
    subcategory: '运镜公式',
    title: '大卫·芬奇 (David Fincher) 精密推轨与冷调暗色',
    summary: '芬奇 = 机械般精准的推轨 + 低照度暗色 + 大量 CGI 隐形修图 + 强对比阴影。最适合悬疑/惊悚类。',
    content: `芬奇风格（《七宗罪》《搏击俱乐部》《社交网络》《消失的爱人》《曼克》《心灵猎人》）：

**1. 机械般精准的推轨**
- 所有运动都是 Motion Control Rig 精确计算
- 推拉速度匀速，不靠手持
- 角度精确到度
- 摄像机是"透明观察者"，不应该被感知

**2. 低照度冷调**
- 大量 ISO 800+ 拍摄
- 光源多来自 practical（台灯 / 电脑屏 / 窗外）
- 阴影占画面 50%+
- 蓝绿色调主导

**3. 隐形 CGI**
- 大量后期修图 / 合成 / 数字延伸
- 但做到观众察觉不出来
- 例：《社交网络》温克莱沃斯双胞胎是一个演员两次拍摄合成

**4. 强烈的明暗对比**
- 脸部一半亮一半暗
- 背景有光源突出
- 道具（杯子 / 书 / 电脑）被光源强调

**5. 对白场景的镜头运动**
- 不用传统正反打
- 用推轨 + 跟拍 + 环绕代替
- 让对话有"动感"

**6. 重复的镜头构图**
- 同一场景反复用相同构图（强化记忆点）
- 例：《社交网络》Facemash 场景

**Fincher 风格 Prompt 模板**
\`\`\`
precise motion control tracking shot, mechanical smoothness,
low-key lighting with strong practical sources,
deep shadows occupying half the frame,
cool teal and green palette, high contrast,
subject partially lit by computer screen glow,
David Fincher cinematography style, forensic precision,
anamorphic lens, shallow depth of field, cinematic 2.39:1
\`\`\`

**应用场景**
- 悬疑 / 惊悚 / 犯罪类 AI 漫剧
- 科技公司 / 办公室 / 审讯场景
- 需要"精密冷酷"感的镜头

**芬奇禁忌**
- 不要手持
- 不要过度饱和
- 不要温暖光
- 不要自然抖动`,
    tags: ['fincher', '芬奇', '精密', '冷调'],
    keywords: ['david fincher', 'motion control', 'low key lighting', 'precision', 'social network', 'gone girl', 'zodiac'],
    prompt_snippets: [
      'precise motion control tracking shot, mechanical smoothness',
      'low-key lighting with practical sources, deep shadows',
      'cool teal and green palette, subject lit by computer screen',
      'David Fincher forensic precision style',
    ],
    applies_to: ['director', 'storyboard', 'atmosphere'],
    source: 'David Fincher 1995-2024 作品视觉风格分析',
    lang: 'en',
    enabled: true,
  },
  {
    id: 'kb_sb_v2_villeneuve_scale',
    collection: 'storyboard',
    subcategory: '分镜模板',
    title: '丹尼斯·维伦纽瓦 (Denis Villeneuve) 的尺度感与沉默美学',
    summary: '维伦纽瓦 = 巨大尺度 + 微小人物 + 沉默时刻 + 低饱和暖调。《沙丘》《降临》《银翼杀手2049》的核心。',
    content: `维伦纽瓦风格（《降临》《银翼杀手2049》《沙丘 1/2》《焦土之城》）：

**1. 极端尺度对比**
- 巨型建筑 / 飞船 / 自然景观占据 2/3 画面
- 人物是小点或剪影
- 让观众感受"存在的渺小"

**2. 极长停顿**
- 镜头经常 5-10 秒不切换
- 没有对白也没有音乐
- 只有环境音（风 / 沙 / 水）
- 制造"冥想感"

**3. 低饱和暖调**
- 橘色 / 琥珀色 / 铜色为主
- 蓝色作为阴影
- 避免纯粹的饱和色

**4. 结构化几何**
- 建筑 / 场景有强烈几何感
- 直角 / 圆形 / 三角形清晰
- 人物行走在几何图形中

**5. 环境音 > 配乐**
- 配乐低频持续（Hans Zimmer 式）
- 环境音放大到超真实（风声震撼耳朵）
- 音量动态范围极大

**6. 广角 + 超长焦交替**
- 广角：展示尺度（14mm）
- 超长焦：压缩空间（200mm）
- 很少用标准 50mm

**Villeneuve 风格 Prompt 模板**
\`\`\`
extreme wide shot, massive architectural scale,
tiny silhouette of human figure in foreground,
amber and sepia color palette, low saturation,
monolithic geometric structures dominating the frame,
oppressive silence, contemplative atmosphere,
Denis Villeneuve cinematography style,
Dune Arrakis aesthetic, 65mm lens, cinematic 2.39:1
\`\`\`

**典型视觉**
- 沙漠中的飞船阴影笼罩一个小人
- 未来城市的巨大全息投影
- 螺旋楼梯俯视小小身影
- 巨型雕塑前的朝圣者

**应用场景**
- 科幻 / 史诗 / 宗教题材
- 需要"敬畏感"的镜头
- 氛围型（非剧情型）漫剧`,
    tags: ['villeneuve', '维伦纽瓦', '尺度', '沙丘'],
    keywords: ['denis villeneuve', 'scale', 'silence', 'dune', 'blade runner 2049', 'arrival', 'amber palette'],
    prompt_snippets: [
      'extreme wide shot, massive architectural scale, tiny human silhouette',
      'amber and sepia palette, low saturation, geometric monoliths',
      'Denis Villeneuve cinematography, Dune Arrakis aesthetic',
      'oppressive silence, contemplative atmosphere, 65mm lens',
    ],
    applies_to: ['director', 'storyboard', 'atmosphere'],
    source: 'Denis Villeneuve 2010-2024 作品视觉风格分析',
    lang: 'en',
    enabled: true,
  },
  {
    id: 'kb_sb_v2_deakins_natural',
    collection: 'storyboard',
    subcategory: '运镜公式',
    title: '罗杰·狄金斯 (Roger Deakins) 自然光布光与黄金构图',
    summary: '狄金斯 = 最会用自然光的摄影师 + 软硬光混合 + 完美三分构图。《1917》《肖申克的救赎》《银翼杀手2049》。',
    content: `罗杰·狄金斯（15 次奥斯卡提名，2 次获奖）的布光与构图法则：

**1. 自然光优先**
- 尽可能使用现场自然光
- 人工光源模仿自然（天光 / 月光 / 蜡烛）
- 避免 studio 式"干净"的布光

**2. 软硬光的精确混合**
- Key light 硬光（有明显阴影）
- Fill light 软光（填充阴影）
- 两者比例 4:1 或 3:1

**3. 黄金时刻拍摄**
- 日出后 1 小时 / 日落前 1 小时
- 拒绝正午硬光
- 利用长阴影和暖色

**4. Practical lighting (实景光源)**
- 窗户 / 灯笼 / 烛台 / 电视
- 光源必须在画面内可见
- 增加"真实感"

**5. 完美三分构图**
- 主体严格在三分点
- 水平线严格对齐
- 视线方向留 60% 空间

**6. 长焦人像**
- 85mm / 135mm 压缩空间
- 浅景深分离人物与背景
- 避免广角人像变形

**Deakins 风格 Prompt 模板**
\`\`\`
natural lighting from large window, soft diffused daylight
with harder key light from side, rule of thirds composition,
practical lamp source visible in frame,
long focal length 85mm portrait, shallow depth of field,
warm golden hour color temperature,
Roger Deakins cinematography style, naturalistic beauty,
subtle film grain, organic feel
\`\`\`

**标志性作品参考**
- 《1917》一镜到底 + 夜晚照明弹
- 《银翼杀手2049》橙色沙漠 + 巨型赌场
- 《肖申克的救赎》放风场景的逆光
- 《007大破天幕杀机》上海玻璃幕墙

**应用场景**
- 现实题材 AI 漫剧
- 年代戏 / 古装
- 需要"真实感"和"质感"的镜头
- 情感戏 / 人物特写`,
    tags: ['deakins', '狄金斯', '自然光', '布光'],
    keywords: ['roger deakins', 'natural lighting', 'practical sources', 'golden hour', '1917', 'blade runner 2049', 'shawshank'],
    prompt_snippets: [
      'natural lighting from large window, soft diffused daylight',
      'practical lamp source visible in frame, rule of thirds',
      '85mm long focal length portrait, shallow depth of field',
      'Roger Deakins cinematography, naturalistic beauty',
    ],
    applies_to: ['director', 'storyboard', 'atmosphere'],
    source: 'Roger Deakins 访谈 + 1994-2024 作品分析',
    lang: 'en',
    enabled: true,
  },
  {
    id: 'kb_sb_v2_lubezki_oneshot',
    collection: 'storyboard',
    subcategory: '分镜模板',
    title: 'Emmanuel "Chivo" Lubezki 手持长镜头与自然光',
    summary: 'Lubezki = 长到夸张的手持长镜 + 广角贴近拍摄 + 纯自然光。《人类之子》《地心引力》《荒野猎人》。',
    content: `Emmanuel Lubezki (3 次连续奥斯卡最佳摄影) 的标志：

**1. 超长手持长镜头**
- 单镜头 5-10 分钟不切
- 完全手持，有自然呼吸感
- 通过精确编舞实现"一镜到底"假象
- 例：《人类之子》汽车伏击 6 分钟一镜

**2. 广角贴近拍摄**
- 大量 14-24mm 广角
- 摄像机几乎贴到演员脸上
- 制造"第一人称"的沉浸感
- 演员有时直接看镜头

**3. 100% 自然光**
- 拒绝人工打光
- 甚至拍夜戏用真实月光或篝火
- 《荒野猎人》全片自然光
- 只在极端情况用反光板补光

**4. 环境作为角色**
- 大量空镜 / 风景 / 自然现象
- 风 / 雪 / 雨 / 树叶 / 云
- 环境参与叙事情绪

**5. 生理级真实感**
- 摄像机跟随演员呼吸
- 有偶尔的失焦和抖动
- 不追求"完美"，追求"真实"

**Lubezki 风格 Prompt 模板**
\`\`\`
handheld long take shot, 14mm wide angle lens very close to subject,
natural organic camera movement with subtle breathing,
100% natural lighting, overcast sky or magic hour,
immersive first-person feel, subject sometimes glances at camera,
Emmanuel Lubezki cinematography style,
Terrence Malick / Alejandro Gonzalez Inarritu film aesthetic,
organic imperfect beauty
\`\`\`

**应用场景**
- 沉浸式叙事 AI 漫剧
- 战争 / 灾难 / 冒险
- 需要"纪实感"的镜头
- 情绪戏（不用剪辑靠一镜头）

**Lubezki 禁忌**
- 不要静止三脚架
- 不要 studio 光
- 不要快速剪辑
- 不要完美构图（要"不完美的完美"）`,
    tags: ['lubezki', '长镜头', '手持', '广角'],
    keywords: ['emmanuel lubezki', 'long take', 'handheld', 'natural light', 'children of men', 'gravity', 'revenant', 'tree of life'],
    prompt_snippets: [
      'handheld long take, 14mm wide angle very close to subject',
      'natural organic camera movement, subtle breathing',
      '100% natural lighting, overcast sky, magic hour',
      'Lubezki Malick Inarritu organic imperfect beauty',
    ],
    applies_to: ['director', 'storyboard'],
    source: 'Emmanuel Lubezki 访谈 + 2000-2024 作品分析',
    lang: 'en',
    enabled: true,
  },
  {
    id: 'kb_sb_v2_action_choreography',
    collection: 'storyboard',
    subcategory: '分镜模板',
    title: '动作戏分镜语言（袁和平 / 甄子丹 / 中村元树 / Chad Stahelski 四派）',
    summary: '动作戏不是随便打，有严格的分镜语法：起势 → 交锋 → 转折 → 收势。4 种顶尖动作设计师风格。',
    content: `**袁和平派 (港式传统)**
- 《黑客帝国》《杀死比尔》《卧虎藏龙》动作指导
- 特征：慢动作 + 威亚 + 招式分明 + 飘逸
- 节奏：起势-亮相-交手-绝招-定格
- 镜头：全景为主，展示完整身法
- 每招都有命名（降龙十八掌 / 六脉神剑）

**甄子丹派 (硬派实战)**
- 《叶问》《杀破狼》《倒数计时》
- 特征：咏春贴身搏斗 + 低威亚 + 硬桥硬马
- 节奏：快速连招 + 密集
- 镜头：中景 + 特写拳脚
- 强调"打得真"的速度感和击打声

**中村元树派 (日式斩杀)**
- 《热血街区》《剑心》《浪客剑心》
- 特征：一击必杀的日式斩击
- 节奏：静止 0.5s + 爆发 0.3s + 余韵 1s
- 镜头：极端特写 + 慢动作血飞溅
- 配合金属音效 + 刀鸣

**Chad Stahelski 派 (战术格斗)**
- 《约翰·威克》系列导演
- 特征：枪战 + 柔道 + BJJ 结合
- 节奏：连贯无剪辑 + 5-10 秒一镜
- 镜头：手持长镜头跟拍 + 中景
- 强调"专业"和"效率"

**动作戏 4 段式分镜结构**

**Beat 1: 起势 (2s)**
- 对手进入视野
- 主角摆出架势
- 环境紧张（风 / 灯 / 音乐停）
- 镜头：远景 + 慢推

**Beat 2: 交锋 (3-5s)**
- 第一次接触
- 3-5 个快速动作
- 镜头：中景跟拍 + 快切 + 特写拳脚

**Beat 3: 转折 (2-3s)**
- 主角中招 or 反击
- 节奏变化（快 → 慢）
- 镜头：慢动作特写

**Beat 4: 收势 (2s)**
- 最后一击
- 对手倒下 / 退开
- 主角喘息 or 转身
- 镜头：远景 + 静止

**动作戏 Prompt 模板**
\`\`\`
dynamic action choreography, medium tracking shot,
protagonist in martial arts stance, opponent charging in,
rapid strike sequence with impact effects,
slow motion close-up on decisive blow,
wide shot of opponent falling, dramatic silhouette,
Yuen Woo-ping / Chad Stahelski style action design,
cinematic fight cinematography
\`\`\`

**动作戏禁忌**
- 不要全程慢动作（会假）
- 不要一直特写（观众看不懂空间）
- 不要镜头摇晃过度（观众晕）
- 不要无因击倒（每一击必须有原因）`,
    tags: ['动作戏', '武打', '分镜', '袁和平', '甄子丹'],
    keywords: ['action choreography', 'martial arts', 'fight scene', 'yuen woo-ping', 'chad stahelski', 'john wick', 'ip man'],
    prompt_snippets: [
      'dynamic martial arts stance, medium tracking shot, impact effects',
      'slow motion close-up on decisive strike, dramatic silhouette',
      'handheld fight cinematography, John Wick style tactical combat',
      'Hong Kong wuxia wire work, flowing movements, slow reveal',
    ],
    applies_to: ['director', 'storyboard'],
    source: '香港动作片 + 好莱坞动作片 1980-2025 分镜语言分析',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_sb_v2_mv_language',
    collection: 'storyboard',
    subcategory: '分镜模板',
    title: 'MV / 品牌片镜头语言（Hype Williams / David Fincher / Dave Meyers 三派）',
    summary: 'MV 和品牌片有独特的"非叙事视觉语法"：节奏跟音乐 + 视觉奇观 + 情绪为王。',
    content: `**Hype Williams 派 (HipHop 美学)**
- 《Missy Elliott》《Kanye West》《Beyoncé》MV 导演
- 特征：超饱和色 + 鱼眼广角 + 金属反光 + 夸张服装
- 镜头：快切 + 变焦 + 旋转
- 情绪：张扬 + 力量 + 酷

**David Fincher 派 (优雅黑暗)**
- 《Madonna - Vogue》《Rolling Stones》
- 特征：黑白 + 低对比 + 精准运动
- 镜头：精密推轨 + 对称
- 情绪：神秘 + 性感

**Dave Meyers 派 (视觉奇观)**
- 《Kendrick Lamar》《Ariana Grande》MV
- 特征：超现实 + 布景 + 集体舞蹈
- 镜头：大场面 + 升降机 + 环绕
- 情绪：梦幻 + 戏剧

**MV 视觉语法的 6 个核心**

**1. 节奏跟音乐**
- 剪辑点卡在节拍上
- 每 4 拍一次场景 / 服装 / 动作变化
- 副歌必须有视觉高潮

**2. 视觉奇观**
- 不合常理的画面（漂浮 / 反重力 / 颜色异常）
- 大场面（100 人舞蹈 / 废墟 / 沙漠）
- 服装变换（同一场景不同造型）

**3. 情绪为王**
- 不需要完整故事
- 靠视觉碎片传递情绪
- 允许逻辑跳跃

**4. 主体永远在中心**
- 艺人 / 主角一定在画面中心
- 背景服务于主角
- 禁止喧宾夺主

**5. 多景别交替**
- 特写 / 中景 / 远景 / 鸟瞰快速切换
- 每个景别停留 1-3 秒
- 副歌段切换更快

**6. 后期重塑**
- 大量调色 / 叠加 / 特效
- 允许不真实的色彩
- 追求"不真实的美"

**MV 风格 Prompt 模板**
\`\`\`
high-fashion music video cinematography,
rhythmic fast cuts synchronized to beat,
surreal visual spectacle, impossible dreamy atmosphere,
hero subject in center frame, dramatic costume and styling,
Hype Williams / Dave Meyers style,
vibrant saturated colors, post-processed color grade,
cinematic anamorphic lens, dynamic camera movement
\`\`\`

**应用场景**
- 音乐 MV
- 品牌广告 / TVC
- 时尚短片
- 抖音/TikTok 高颜值内容`,
    tags: ['mv', '品牌', '镜头语言', 'hype williams'],
    keywords: ['music video', 'mv cinematography', 'hype williams', 'dave meyers', 'brand commercial', 'tvc'],
    prompt_snippets: [
      'high-fashion music video cinematography, rhythmic cuts',
      'surreal visual spectacle, hero subject in center frame',
      'Hype Williams style vibrant saturated hip-hop aesthetic',
      'Dave Meyers style dreamy surreal large-scale composition',
    ],
    applies_to: ['director', 'storyboard', 'atmosphere'],
    source: '音乐 MV 工业 1990-2025 顶尖导演风格分析',
    lang: 'en',
    enabled: true,
  },

  // ═══════════════════════════════════════════════════
  // —— v3 新增：转场技法 + 剪辑语法 + 分镜模板 ——
  // ═══════════════════════════════════════════════════

  {
    id: 'kb_sb_v3_transition_12',
    collection: 'storyboard',
    subcategory: '转场技法',
    title: '电影转场 12 大技法系统（硬切 / 溶接 / 擦除 / 动作匹配 / 形状匹配等）',
    summary: '转场是剪辑的语法。12 种主流转场：硬切 / 溶接 / 擦除 / 匹配剪辑 / 渐黑 / 渐白 / 甩镜 / 声音先行 / 形状匹配 / 色彩匹配 / 物体遮挡 / 时间跳跃。',
    content: `转场决定剪辑的呼吸节奏，错用转场会让观众出戏。

**12 种主流转场技法**

**#1 Hard Cut (硬切)**
- 最基础、最常用
- 直接切换到下一镜
- 适用：90% 的情况
- 注意：同一对话正反打都是硬切

**#2 Dissolve / Cross-Dissolve (溶接/叠化)**
- 前画面淡出同时后画面淡入
- 时长：0.5-2s
- 适用：时间跳跃 / 回忆 / 梦境 / 情绪柔和过渡
- 禁忌：不要用在动作戏
- 视觉效果：prompt 里加 "cross dissolve transition, soft blend"

**#3 Fade to Black (渐黑)**
- 画面逐渐变黑
- 时长：1-3s
- 适用：场景终结 / 章节结束 / 角色死亡 / 重大情绪节点
- 标志性用法：电影开头 "fade in from black"、结尾 "fade out to black"

**#4 Fade to White (渐白)**
- 画面逐渐变白
- 适用：天堂 / 回忆 / 初恋 / 梦醒
- 情绪：轻盈 / 梦幻 / 希望

**#5 Match Cut (动作匹配剪辑)**
- 前一镜的动作在下一镜继续
- 典型案例：《2001 太空漫游》骨头 → 宇宙飞船
- 两个镜头必须有相似的形状 / 方向 / 运动
- 效果：优雅、诗意、暗示主题

**#6 Shape Match (形状匹配)**
- 前画面圆形 → 后画面同位置的圆形
- 例：太阳 → 月亮 / 眼睛 → 硬币 / 轮胎 → 方向盘
- 视觉连贯性最强

**#7 Color Match (色彩匹配)**
- 前一镜主色与后一镜主色一致
- 例：红裙子 → 红色的玫瑰
- 情绪连贯、暗示关联

**#8 Whip Pan / Whip Cut (甩镜转场)**
- 镜头快速横扫，运动模糊中切换场景
- 时长：0.3-0.5s
- 适用：动作场面 / 紧张追逐 / 时间跳跃
- 效果：能量、动感、速度
- 现代：HuallyS / 抖音 / 短视频标配

**#9 L-Cut / J-Cut (声画错位)**
- **L-Cut**：上一镜的音频延续到下一镜的画面（声音先走）
- **J-Cut**：下一镜的音频提前在上一镜出现（画面先走）
- 用途：让剪辑更"丝滑"，观众不察觉切换
- 适用：对话场景 / 情绪过渡

**#10 Smash Cut (冲击剪辑)**
- 突然从安静 / 缓慢镜头 → 激烈 / 高能镜头
- 或反向：激烈 → 完全静止
- 时长：0s（瞬间）
- 适用：制造震撼 / 反差 / 反转
- 代表：梦中惊醒 / 枪响后的寂静

**#11 Iris Transition (圈入圈出)**
- 画面被圆形收缩或扩散
- 复古感强
- 适用：默片风格 / 复古作品 / 童话
- 现代很少用，除非刻意做复古

**#12 Object Wipe (物体擦除)**
- 前景物品横扫过画面完成切换
- 例：人物走过相机 / 车横驶 / 旗子飘过
- 效果：平滑、隐形
- 视觉连贯性强

**AI 漫剧转场实操**

由于 AI 视频模型通常一次生成一个镜头，转场在**后期合成**阶段实现。在 prompt 中需要设计"便于转场的起始帧或结束帧"：

- 想做 Match Cut：前镜结束于一个形状，下镜开始于同形状
- 想做 Whip Pan：前镜结束于镜头快速向右移，下镜开始于快速向右进入
- 想做 Color Match：前镜主色 = 下镜主色
- 想做 L-Cut：两镜的音频 prompt 保持连贯

**转场选择决策树**
\`\`\`
是同一场景吗？
├─ 是 → Hard Cut / L-J Cut
└─ 否 → 场景意义有关联吗？
         ├─ 是 → Match Cut / Color Match / Shape Match
         └─ 否 → 需要情绪过渡吗？
                  ├─ 是 → Dissolve / Fade
                  └─ 否 → 需要动感吗？
                           ├─ 是 → Whip Pan / Smash Cut
                           └─ 否 → Hard Cut
\`\`\``,
    tags: ['转场', '剪辑', 'transition', '切换'],
    keywords: ['transition', 'cut', 'dissolve', 'match cut', 'whip pan', 'smash cut', 'L-cut', 'J-cut', 'fade', 'iris', 'object wipe'],
    prompt_snippets: [
      'hard cut between two scenes',
      'cross dissolve transition with 1 second soft blend',
      'fade to black with slow 2 second duration',
      'match cut from spinning wheel to sun',
      'whip pan transition with motion blur between scenes',
      'smash cut from silence to sudden loud action',
    ],
    applies_to: ['director', 'storyboard'],
    source: '电影剪辑理论（Walter Murch / Thelma Schoonmaker）+ 现代剪辑实践',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_sb_v3_match_cut',
    collection: 'storyboard',
    subcategory: '转场技法',
    title: 'Match Cut 动作/形状匹配剪辑深度（诗意剪辑的黄金技法）',
    summary: 'Match Cut 是电影语言最优雅的转场：两个镜头通过"相似元素"无缝连接，观众体验到诗意的关联。',
    content: `Match Cut 是剪辑艺术的"高级感"顶点，从《2001 太空漫游》（骨头 → 太空船）到《盗梦空间》到《沙丘》到处都是。

**Match Cut 的 6 种类型**

**#1 Action Match（动作匹配）**
前一镜结束的动作在下一镜继续。
- 例：角色在房间 A 抬手 → 下一镜在房间 B 完成抬手动作
- 例：关门 → 下一场景开门
- 例：跳起 → 落地在不同时空
- 效果：时间流动感，空间不连续但动作连续

**#2 Shape Match（形状匹配）**
前一镜的形状 = 下一镜的形状，但内容完全不同。
- 《2001》：旋转的骨头 → 旋转的太空站
- 《阿拉伯的劳伦斯》：火柴火焰 → 沙漠日出
- 例：圆形餐盘 → 月亮 / 太阳
- 例：窗户方框 → 电影屏幕
- 效果：诗意、命运感、隐喻

**#3 Graphic Match（图形匹配）**
前后两镜的构图、线条、色块一致。
- 例：地平线高度相同
- 例：主体位置相同
- 例：相似对称构图
- 效果：视觉流畅，不察觉切换

**#4 Color Match（色彩匹配）**
前后两镜主色调一致。
- 例：红裙子 → 红色玫瑰 → 红色日落
- 例：金色咖啡 → 金色黄昏 → 金色头发
- 效果：情绪连贯、色彩作为主题

**#5 Sound Match（声音匹配）**
前一镜的声音与下一镜同步继续。
- 例：前镜喇叭声 → 下镜警报声（声音模式相似）
- 例：前镜心跳 → 下镜鼓点
- 例：前镜钟表滴答 → 下镜打字机敲击
- 效果：听觉桥梁，情绪传递

**#6 Eye Match / Look Match（视线匹配）**
前一镜角色看向右 → 下一镜是他看到的东西。
- 经典正反打就是 Eye Match
- 也可跨时空：前镜小孩看向天空 → 下一镜多年后的大人在同一角度看向天空
- 效果：主观代入 / 情感连接

**Match Cut 的经典案例清单**

1. **《2001 太空漫游》骨头 → 飞船**（Action + Shape）
2. **《阿拉伯的劳伦斯》火柴 → 日出**（Shape + Color）
3. **《盗梦空间》翻转的城市 → 梦中的旋转**（Shape）
4. **《沙丘》（2021）沙丘纹路 → 少女的衣服褶皱**（Shape）
5. **《疯狂麦克斯》爆炸火焰 → 日出**（Color + Shape）
6. **《闪灵》孩子骑三轮车 → 移动镜头跟拍**（Graphic）
7. **《教父》婴儿洗礼 → 血腥屠杀**（Sound，经典 parallel edit）
8. **《星际穿越》书架摇晃 → 宇宙引力波动**（Action）

**在 AI 漫剧中制造 Match Cut**

由于 AI 视频是一镜一镜生成的，Match Cut 需要在 prompt 中设计：

**Shape Match 设计**
\`\`\`
Shot 1 结束于："close-up of round coffee cup on wooden table, center frame"
Shot 2 开始于："close-up of full moon in night sky, center frame"
\`\`\`

**Action Match 设计**
\`\`\`
Shot 1 结束于："hand raising upward, palm open, frame cuts off at wrist"
Shot 2 开始于："hand continuing to reach upward toward sky, same angle"
\`\`\`

**Color Match 设计**
\`\`\`
Shot 1 主色："dominant red color of woman's dress, warm tones"
Shot 2 主色："dominant red color of blooming rose, warm tones"
\`\`\`

**Graphic Match 设计**
\`\`\`
两镜使用相同的 aspect ratio + 相同的 lens + 相同的 composition (e.g. rule of thirds with subject on right)
\`\`\`

**Match Cut 的禁忌**
- 不要牵强（勉强的匹配会很尬）
- 不要高频使用（诗意会变油腻）
- 不要与主题无关
- 不要喧宾夺主（剪辑服务于故事）`,
    tags: ['match cut', '匹配剪辑', '诗意', '转场'],
    keywords: ['match cut', 'action match', 'shape match', 'graphic match', 'color match', 'eye match', '2001 space odyssey', 'lawrence of arabia'],
    prompt_snippets: [
      'Shot 1: close-up of round coffee cup on wooden table, center frame',
      'Shot 2: close-up of full moon in night sky, center frame',
      'match cut design: end shot 1 with hand raising, begin shot 2 with hand reaching',
      'graphic match: rule of thirds composition preserved across scene change',
    ],
    applies_to: ['director', 'storyboard'],
    source: 'Walter Murch 《In the Blink of an Eye》+ 电影 Match Cut 经典案例',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_sb_v3_jl_cut',
    collection: 'storyboard',
    subcategory: '转场技法',
    title: 'J-Cut / L-Cut 声画错位剪辑（对话戏的灵魂）',
    summary: 'J-Cut = 新场景的声音先进来；L-Cut = 旧场景的声音持续到新画面。对话戏 90% 都是 J/L Cut。',
    content: `J-Cut 和 L-Cut 是"隐形"的转场技法，观众察觉不到但体验更丝滑。

**定义与区别**

**L-Cut（L 型剪辑）**
- 形状：轨道面板上，视频先切，音频延迟切
- 效果：上一镜的声音（对话/音效/音乐）持续到下一镜的画面
- 时机：下一镜的音频比画面晚 0.5-3s

**J-Cut（J 型剪辑）**
- 形状：轨道面板上，音频先切，视频延迟切
- 效果：下一镜的声音提前在上一镜画面出现
- 时机：下一镜的音频比画面早 0.5-3s

**视觉示意（剪辑轨道）**
\`\`\`
L-Cut:
Video:  [Shot A        ][Shot B      ]
Audio:  [Audio A              ][B      ]
                              ↑ audio 延迟切

J-Cut:
Video:  [Shot A        ][Shot B      ]
Audio:  [Audio A    ][Audio B            ]
                    ↑ audio 提前切
\`\`\`

**L-Cut 的 4 种用法**

**1. 对话场景**
A 说话 → 画面切到 B 反应 → A 的声音继续（L-Cut）
效果：让观众看到 B 听到 A 说的话时的反应

**2. 情绪延续**
悲伤场景的钢琴 → 切到下一个场景但音乐继续
效果：情绪桥梁

**3. 空间转换**
室内对话的环境音 → 切到室外但室内声音继续 0.5s
效果：空间缓冲

**4. 回忆/内心独白**
当前场景 → 切到回忆画面但当前角色的声音继续
效果：主观视角

**J-Cut 的 4 种用法**

**1. 对话引导**
B 开始说话 → 画面还在 A 身上（观众看到 A 的反应）→ 切到 B
效果：观众先听到内容再看到说话者

**2. 预告式**
下一场景的音效（关门声 / 脚步声 / 音乐）提前进入
效果：提示观众下一幕来了

**3. 环境导入**
下一场景的环境音（海浪 / 城市 / 雨）提前进入
效果：空间提示

**4. 紧张感**
下一场景的危险声（刀剑 / 枪声 / 尖叫）提前进入
效果：制造紧张

**经典案例**

- **《阿甘正传》**大量 L-Cut 连接不同年代的回忆
- **《社交网络》**对话戏几乎全是 J/L Cut，节奏感极强
- **《搏击俱乐部》**用 J-Cut 制造跳跃感和不安
- **《穆赫兰道》**用 J-Cut 制造梦境与现实模糊

**在 AI 漫剧中实现 J/L Cut**

由于 AI 视频生成时音频和视频是绑定的，J/L Cut 需要在**后期剪辑**阶段完成：

**后期工作流**
1. 让 AI 生成两镜，各自带完整音频
2. 导入剪辑软件（Premiere / Final Cut / DaVinci）
3. 解绑音视频
4. 按 J-Cut / L-Cut 调整音频时间轴
5. 加 0.3-0.5s 的音频淡入淡出

**AI Prompt 中预留 J/L Cut 空间**
\`\`\`
Shot 1 的 audio prompt: "soft conversation in restaurant, ambient chatter, ending with character's voice saying 'I had no idea...'"
Shot 2 的 audio prompt: "kitchen clanking sounds continuing from previous scene, character's voice fading out naturally"
\`\`\`

**J/L Cut 的禁忌**
- 不要超过 3s 的错位（观众会察觉）
- 不要在高能动作戏用（需要清脆节奏）
- 不要错位不匹配的声音（例：室内对话延续到水下）`,
    tags: ['J-cut', 'L-cut', '声画错位', '对话剪辑'],
    keywords: ['j-cut', 'l-cut', 'audio video offset', 'dialogue editing', 'invisible edit', 'walter murch'],
    prompt_snippets: [
      'L-cut: previous scene dialogue audio continues into new scene visual',
      'J-cut: next scene audio starts before visual cuts',
      'dialogue scene with L-cut showing listener reaction',
      'J-cut with environmental sound preview of next location',
    ],
    applies_to: ['director', 'storyboard'],
    source: 'Walter Murch 《In the Blink of an Eye》+ 《The Conversations》+ 现代剪辑实践',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_sb_v3_montage',
    collection: 'storyboard',
    subcategory: '分镜模板',
    title: '蒙太奇序列模板（5 种经典蒙太奇 + AI 视频应用）',
    summary: '蒙太奇 = 用多个短镜头压缩时间 / 空间 / 情感。5 种经典：训练 / 时间流逝 / 浪漫 / 破坏 / 思考。',
    content: `蒙太奇（Montage）是电影用多镜头浓缩长时间过程的技法，AI 漫剧需要表达"一段时间的成长/变化"时必用。

**5 种经典蒙太奇类型**

**#1 训练蒙太奇 (Training Montage)**
- 用途：表达主角在一段时间内的成长/训练
- 节奏：快速切换 + 渐进难度 + 音乐驱动
- 经典：《Rocky》跑步、打沙袋、举铁、最后冲上楼梯
- 镜头清单（6-10 镜）：
  1. 起点：主角虚弱 / 失败 / 流汗
  2. 基础训练：重复动作
  3. 进阶训练：更难动作 / 更长时间
  4. 挣扎：摔倒 / 放弃 / 起来
  5. 突破：成功做到了 / 眼神变化
  6. 展示：向师父 / 朋友展示新能力
- 音乐：从低沉到高潮的渐进节拍

**#2 时间流逝蒙太奇 (Time Lapse Montage)**
- 用途：表达"几年过去了" / "四季变化" / "城市日夜"
- 节奏：匀速 + 同一位置 + 变化
- 经典：《Up》开场的几十年回忆、《Forrest Gump》跑步
- 镜头清单：
  1. 同一位置 + 不同季节
  2. 同一角色 + 不同年龄
  3. 同一事件 + 不同年份
  4. 天空 / 太阳 / 月亮变化
  5. 日历翻页 / 时钟转动
- 音乐：主旋律贯穿

**#3 浪漫蒙太奇 (Romance Montage)**
- 用途：表达情侣从相识到相恋的过程
- 节奏：慢 + 柔 + 浪漫
- 经典：《Up》夫妻一生、《La La Land》追梦
- 镜头清单：
  1. 偶遇（第一次见面）
  2. 约会（咖啡馆 / 电影 / 散步）
  3. 分享（笑 / 聊天 / 玩耍）
  4. 亲密（牵手 / 拥抱 / 亲吻）
  5. 困难（争吵 / 分开）
  6. 重聚（和解 / 爱的表达）
- 音乐：情歌 / 钢琴

**#4 破坏蒙太奇 (Destruction Montage)**
- 用途：表达世界 / 关系的崩塌
- 节奏：快速 + 破坏性音效 + 高对比
- 经典：《Joker》下楼梯 → 《Fight Club》炸大楼
- 镜头清单：
  1. 破坏开始
  2. 规模扩大
  3. 他人反应（恐惧 / 惊叹）
  4. 破坏完成
  5. 主角的冷静 / 狂喜 / 眼神
- 音乐：重金属 / 交响乐

**#5 思考蒙太奇 (Contemplation Montage)**
- 用途：表达角色内心挣扎 / 决定前的回想
- 节奏：慢 + 碎片化 + 主观
- 经典：《盗梦空间》的梦境回忆、《记忆碎片》的碎片化
- 镜头清单：
  1. 现实场景：角色独自沉思
  2. 闪回片段 A（关键对话）
  3. 现实：眼神变化
  4. 闪回片段 B（关键事件）
  5. 现实：开始做决定
  6. 闪回片段 C（转折点）
  7. 现实：下定决心
- 音乐：心跳 / 低频 / 环境音放大

**蒙太奇的构造原则**

**1. 音乐驱动**
- 音乐决定剪辑节奏
- 每个镜头对应一个节拍
- 高潮对应音乐高潮

**2. 视觉连贯**
- 色调保持一致
- 主角出现在每镜
- 关键道具反复出现（剪绳子 / 手表 / 照片）

**3. 节奏变化**
- 开头慢 → 中间加速 → 结尾极快 or 骤停
- 不要全程同一速度

**4. 时长控制**
- 训练蒙太奇：30-60s
- 时间流逝：60-180s
- 浪漫：45-90s
- 破坏：30-60s
- 思考：30-90s

**AI 漫剧中的蒙太奇 prompt 模板**

**训练蒙太奇（6 镜头）**
\`\`\`
Shot 1 (3s): protagonist exhausted on the ground, early morning
Shot 2 (3s): doing push-ups in the rain, determined face
Shot 3 (3s): running up stairs, sweating, faster than before
Shot 4 (3s): punching training bag, intense focus
Shot 5 (3s): training partner falling defeated, protagonist triumphant
Shot 6 (3s): protagonist at sunset, transformed, confident stance
All shots: consistent color grading warm amber, dynamic camera movement,
rocky training montage aesthetic, motivational atmosphere
\`\`\`

**时间流逝蒙太奇（5 镜头）**
\`\`\`
Shot 1: same park bench, spring with cherry blossoms
Shot 2: same bench, summer with green leaves
Shot 3: same bench, autumn with red leaves
Shot 4: same bench, winter with snow
Shot 5: same bench, spring again, different character sitting
All shots: locked-off camera, same framing, cinematic still-like quality
\`\`\``,
    tags: ['蒙太奇', '剪辑', '序列', '压缩时间'],
    keywords: ['montage', 'training montage', 'time lapse', 'romance montage', 'sequence editing', 'rocky', 'up', 'la la land'],
    prompt_snippets: [
      'training montage with progressive difficulty, warm amber color grade',
      'time lapse montage of same location through four seasons',
      'romance montage from first meeting to marriage, soft romantic lighting',
      'destruction montage with high contrast and intense music',
      'contemplation montage with fragmented flashback intercut',
    ],
    applies_to: ['director', 'storyboard'],
    source: '电影蒙太奇理论（Eisenstein）+ 当代电影蒙太奇实践',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_sb_v3_180_rule',
    collection: 'storyboard',
    subcategory: '分镜模板',
    title: '180 度轴线规则（Continuity Editing 连续性剪辑的核心）',
    summary: '180 度规则 = 相机不要跨过想象中的轴线，否则观众会迷失空间感。这是新手最常犯的错。',
    content: `180 度规则是电影剪辑的基础法则之一，确保空间连贯性。

**基本原理**

在两个角色（或物体）之间画一条"想象的轴线"，摄像机只能在这条线的**同一侧**移动，不能跨过。

**示例**
\`\`\`
        A ←——————————————————→ B
              想象的 180 度轴线
         ↑                   ↑
         |                   |
    摄像机在下方               摄像机在下方
    (正确)                    (正确)
\`\`\`

**如果跨过 180 度线**
- 观众会看到 A 和 B 的相对位置颠倒
- 例：本来 A 在画面左侧看向右，跨线后 A 变成在右侧看向左
- 观众会瞬间感到"空间混乱"

**180 度规则的 4 个要点**

**#1 对话场景**
- A 看向右 / B 看向左 = 他们在面对面
- 摄像机必须保持在想象轴线的一侧
- 正反打都要在同一侧拍

**#2 追逐场景**
- 追赶者向右跑 → 被追者也必须向右跑
- 方向一致 = 还在追
- 如果方向反了 = 观众会以为他们在面对面跑

**#3 运动场景**
- 汽车向右驶过 → 下一镜也必须从左到右
- 否则观众会觉得车调头了

**#4 空间感建立**
- 开场的 establishing shot（全景）就确定了轴线
- 后续所有镜头要遵守这个轴线

**如何合法跨越 180 度线？**

有 4 种方法合法跨线：

**1. 过渡镜头 (Neutral Shot)**
- 插入一个不强调方向的中性镜头
- 例：特写角色的脸（无背景方向感）
- 然后切到对面，观众不会觉得突兀

**2. 运动跨越 (Moving Camera)**
- 摄像机连续运动跨越轴线
- 观众跟着相机一起"转"到对面
- 例：镜头绕着两个角色走半圈

**3. 切到第三方视角 (Cutaway)**
- 切到完全不相关的镜头（手 / 物品 / 窗外）
- 再切回对面
- 给观众"重置"空间感的机会

**4. 主角自己转身**
- 角色自己转身 / 走位
- 相机跟拍
- 新的轴线建立

**180 度规则的经典违反 (有意为之)**

- **《2001 太空漫游》**：跨越轴线制造失重感
- **《闪灵》**：故意跨线制造幽灵感
- **《罗拉快跑》**：跨线增加不稳定感
- **《盗梦空间》**：旋转场景中故意打破空间

这些都是有意为之，服务于主题。新手不建议主动违反。

**AI 漫剧中遵守 180 度规则**

由于 AI 视频模型每次生成一个镜头，**连续性需要在 prompt 层面设计**：

**对话场景 prompt 设计**
\`\`\`
Shot 1 (建立轴线): wide shot of two characters facing each other
at a café table, character A on left looking right, character B on right looking left

Shot 2 (A 的反打): medium close-up of character A, looking to the right,
café background behind her

Shot 3 (B 的反打): medium close-up of character B, looking to the left,
café background behind him

两人的视线方向（A 向右 / B 向左）必须保持一致。
\`\`\`

**180 度规则的常见错误**

❌ 第一镜 A 在左看右，B 在右看左
❌ 第二镜切到对面，A 变成在右看左
❌ 观众困惑："他们对调位置了吗？"

✅ 正确：保持 A 永远在左看右，B 永远在右看左

**例外情况**
- 如果空间故意设计成"混乱"（梦境 / 超现实）可以打破
- 纯特写场景（只有脸）可以不严格遵守
- 一人对着墙壁说话不涉及`,
    tags: ['180度', '轴线', '连续剪辑', '空间'],
    keywords: ['180 degree rule', 'axis of action', 'continuity editing', 'crossing the line', 'eye line match', 'screen direction'],
    prompt_snippets: [
      'wide shot establishing 180 degree axis between two characters',
      'character A on left looking right, character B on right looking left',
      'medium close-up reverse shot maintaining eye line direction',
      'moving camera tracking shot that crosses axis smoothly',
    ],
    applies_to: ['director', 'storyboard'],
    source: '电影剪辑理论（Grammar of Film Language） + 连续性剪辑法则',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_sb_v3_shot_list_template',
    collection: 'storyboard',
    subcategory: '分镜模板',
    title: '专业分镜脚本 (Shot List) 模板（好莱坞 + 中国短剧两种格式）',
    summary: 'Shot List 是导演的作战地图。好莱坞格式 vs 中国短剧格式，两种都要会写。',
    content: `专业分镜脚本（Shot List）是导演拍摄前必备的文档，列出每一个镜头的所有参数。

**好莱坞标准 Shot List 格式**

| Shot # | Scene | Shot Type | Angle | Camera Movement | Lens | Description | Duration | Audio |
|---|---|---|---|---|---|---|---|---|
| 1A | INT. Kitchen - Day | WS | Eye-level | Static | 24mm | Sarah enters kitchen | 3s | Diegetic: ambient kitchen |
| 1B | INT. Kitchen - Day | MS | Eye-level | Slow push-in | 35mm | Sarah opens fridge, determined | 4s | Fridge hum, door click |
| 1C | INT. Kitchen - Day | CU | Low angle | Static | 85mm | Close-up of bottle being taken | 2s | Glass clink |
| 1D | INT. Kitchen - Day | MCU | Eye-level | Handheld | 50mm | Sarah's reaction to seeing something | 3s | Sharp inhale |

**关键字段解释**
- **Shot #**: 镜号（场号 + 字母）
- **Scene**: 场景（INT/EXT + 地点 + 时间）
- **Shot Type**:
  - EWS: Extreme Wide Shot（大远景）
  - WS: Wide Shot（远景）
  - MS: Medium Shot（中景）
  - MCU: Medium Close-Up（中近景）
  - CU: Close-Up（特写）
  - ECU: Extreme Close-Up（大特写）
  - OTS: Over The Shoulder（过肩）
  - POV: Point of View（主观视角）
- **Angle**: 角度（eye-level / high / low / bird's eye / worm's eye / dutch）
- **Camera Movement**: 运动（static / push-in / pull-out / pan / tilt / tracking / dolly / crane / handheld）
- **Lens**: 镜头焦段
- **Description**: 画面描述
- **Duration**: 时长
- **Audio**: 音频设计

**中国短剧简化格式**

| 镜号 | 场景 | 景别 | 运镜 | 描述 | 时长 | 音效 |
|---|---|---|---|---|---|---|
| 1-1 | 家-客厅-日 | 远景 | 固定 | 女主坐沙发看手机 | 3s | 家庭环境音 |
| 1-2 | 家-客厅-日 | 中景 | 缓推 | 女主收到消息表情变化 | 4s | 消息提示音 |
| 1-3 | 家-客厅-日 | 特写 | 固定 | 手机屏幕显示"妈妈住院" | 2s | 无 |
| 1-4 | 家-客厅-日 | 近景 | 手持 | 女主抓起外套冲出门 | 3s | 脚步声 + 门响 |

**AI 漫剧的 Shot List 扩展格式**

由于 AI 漫剧直接对应 prompt，可以扩展字段：

| 镜号 | 景别 | 运镜 | 描述 | 时长 | 英文 Prompt | 中文 Prompt | 音频 prompt | 参考图 |
|---|---|---|---|---|---|---|---|---|
| 1-1 | Wide | Static | 女主在客厅 | 3s | "Wide establishing shot of modern living room..." | "现代客厅的远景..." | "gentle ambient home sounds" | @sarah_ref |

**一集完整 shot list 示例（90 秒短剧）**

**场 1：家 - 客厅 - 日**
- 1-1 (3s) 远景：建立女主在客厅的空间关系
- 1-2 (3s) 中景：女主的日常动作
- 1-3 (2s) 特写：关键物品（手机 / 信件）
- 1-4 (3s) 近景：女主情绪变化

**场 2：家 - 卧室 - 日**
- 2-1 (3s) 中景：女主进入卧室
- 2-2 (3s) 特写：手的动作（收拾 / 找东西）
- 2-3 (4s) 近景：重要发现

**场 3：路上 - 日**
- 3-1 (3s) 全景：女主奔跑
- 3-2 (3s) 跟拍：脚步特写
- 3-3 (3s) 全景：到达目的地

**场 4：医院 - 走廊 - 日**
- 4-1 (4s) 中景：女主推开门
- 4-2 (3s) 特写：紧张表情
- 4-3 (5s) 近景：与医生对话
- 4-4 (4s) 特写：听到坏消息的反应

**场 5：医院 - 病房 - 日**
- 5-1 (5s) 中景：女主靠近病床
- 5-2 (6s) 特写：妈妈的脸
- 5-3 (8s) 近景：握手 + 眼泪

**场 6：下集预告 (cliffhanger)**
- 6-1 (3s) 远景：医生拿着文件走来
- 6-2 (3s) 特写：文件上的字（模糊不清）

**Shot List 填写的 6 个原则**

1. **每场戏必须有建立镜头**（开场远景或中景，交代空间）
2. **景别必须有变化**（同一场不要全中景，要远近交替）
3. **关键情绪必须有特写**（重要瞬间不要远景）
4. **镜头方向要一致**（遵守 180 度规则）
5. **时长要服务节奏**（紧张短 / 情感长）
6. **音频要设计**（不是全靠 BGM）

**AI 漫剧 Shot List 的 prompt 模板工具**

建议在生成 shot list 时，让 AI 同时输出：
- 中文镜头描述
- 英文 prompt（用于 Sora/Veo/Kling）
- 音频 prompt
- 时长建议
- 参考角色/场景标签
- 与前一镜的连接方式（match cut / hard cut / dissolve）`,
    tags: ['分镜', 'shot list', '脚本', '模板'],
    keywords: ['shot list', 'storyboard', 'shooting script', 'director tool', 'scene breakdown', 'shot planning'],
    prompt_snippets: [
      'Shot 1A: Wide Shot, eye-level, static, 24mm, establishing room',
      'Shot 1B: Medium Shot, slow push-in, 35mm, character action',
      'Shot 1C: Close-Up, low angle, static, 85mm, key object detail',
      'Shot 1D: Medium Close-Up, handheld, 50mm, emotional reaction',
    ],
    applies_to: ['director', 'storyboard'],
    source: '好莱坞 Shot List 标准格式 + 中国短剧制作规范',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_sb_v3_opening_closing',
    collection: 'storyboard',
    subcategory: '分镜模板',
    title: '建场镜头 (Establishing Shot) + 收场镜头 (Closing Shot) 设计',
    summary: '开场的第一个镜头和结尾的最后一个镜头决定了观众的"第一印象"和"最后印象"。',
    content: `建场镜头和收场镜头是电影开头结尾最重要的两个镜头。

**Establishing Shot（建场镜头）**

**定义**：让观众理解"这里是哪里"的镜头，通常是远景。

**功能**
1. 交代地理位置（城市 / 乡村 / 室内 / 室外）
2. 交代时间（日 / 夜 / 季节 / 年代）
3. 建立氛围（浪漫 / 紧张 / 神秘）
4. 暗示主题（压抑 / 自由 / 权力）

**5 种经典建场镜头**

**#1 鸟瞰城市**
- 摩天大楼俯视
- 车水马龙
- 暗示"都市故事"
- 代表：无数都市剧开场

**#2 自然全景**
- 山脉 / 草原 / 沙漠 / 海洋
- 人物渺小
- 暗示"史诗感"
- 代表：《魔戒》《沙丘》

**#3 门面招牌**
- 从招牌推入室内
- 明确地点
- 暗示"小人物故事"
- 代表：《老友记》《生活大爆炸》

**#4 窗外推入**
- 外面街景 → 推到窗内
- 从公共到私人
- 暗示"偷窥视角"
- 代表：《后窗》

**#5 时间流逝**
- 延时 / 阳光移动
- 暗示"时间主题"
- 代表：《La La Land》《Up》

**AI 建场镜头 Prompt 模板**
\`\`\`
establishing wide shot of busy Shanghai Bund at twilight,
towering skyscrapers with illuminated windows,
golden sunset reflecting on Huangpu River,
street traffic flowing, atmospheric haze,
cinematic opening shot, aerial view,
modern Chinese city drama aesthetic, 2.39:1 cinematic
\`\`\`

**Closing Shot（收场镜头）**

**定义**：电影 / 剧集 / 单集的最后一个镜头，决定观众的"最后印象"。

**5 种经典收场镜头**

**#1 远景留白**
- 从角色拉远到全景
- 观众看到角色在世界中的位置
- 情绪：孤独 / 释怀 / 命运感
- 代表：《肖申克的救赎》海边

**#2 特写定格**
- 最后一个特写
- 角色的表情成为观众记忆的锚点
- 情绪：思考 / 决心 / 悲伤
- 代表：《重庆森林》《400 Blows》

**#3 渐黑 Fade to Black**
- 画面逐渐变黑
- 给观众 "情绪缓冲"
- 适合悲剧 / 开放结局
- 代表：《教父》《大片时代》

**#4 环形呼应**
- 最后一个镜头 = 第一个镜头的变奏
- 观众感受到"故事完整了"
- 代表：《霸王别姬》《太阳照常升起》

**#5 悬念钩子**
- 最后一个镜头抛出新谜团
- 留给下一集 / 下一季
- 代表：所有长剧集的集末

**AI 收场镜头 Prompt 模板**
\`\`\`
closing wide shot pulling back from protagonist standing alone,
sunset behind him, long shadow stretching forward,
peaceful yet contemplative atmosphere,
slow pull-out camera movement from medium to extreme wide,
warm golden hour lighting, cinematic finale shot,
leaves rustling in wind, fade to black transition
\`\`\`

**开头 vs 结尾的呼应设计**

好的作品开头和结尾有视觉呼应：

**环形结构（Ring Structure）**
- 开头：主角在某个位置做某件事
- 结尾：主角在同一位置但变了
- 视觉相似但意义不同

**反转结构（Mirror Structure）**
- 开头：主角是 A 状态
- 结尾：主角是 A 的反面
- 视觉对比强烈

**螺旋结构（Spiral Structure）**
- 开头：起点
- 结尾：比起点高一个层次
- 视觉相似但有"上升"感

**经典呼应案例**
- 《美国丽人》开头俯拍 + 结尾俯拍
- 《肖申克的救赎》墙海报开头 + 结尾海滩
- 《教父》开场西西里花园 + 结尾西西里花园
- 《霸王别姬》舞台开头 + 舞台结尾

**AI 漫剧的开头结尾设计建议**

一集短剧的镜头结构：
1. **开场建场镜头**（0-3s）：远景或特写，建立兴趣
2. **主体剧情**（3-85s）：冲突 + 发展 + 高潮
3. **收场钩子**（85-90s）：下集预告或情绪停留

**禁忌**
- 开头不要用普通 middle shot（没有信息量）
- 结尾不要太平（要留情绪）
- 不要与主题无关
- 不要大量对白（留给视觉）`,
    tags: ['建场', '收场', '开头', '结尾', '呼应'],
    keywords: ['establishing shot', 'closing shot', 'opening shot', 'final shot', 'ring structure', 'cinematic opening'],
    prompt_snippets: [
      'establishing wide shot of busy Shanghai Bund at twilight',
      'closing wide shot pulling back from protagonist alone at sunset',
      'establishing aerial view of vast mountain landscape at dawn',
      'closing extreme close-up on character face with subtle smile, fade to black',
    ],
    applies_to: ['director', 'storyboard'],
    source: '电影开场结尾经典案例 + 建场镜头理论',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_sb_v3_editing_rhythm',
    collection: 'storyboard',
    subcategory: '节奏控制',
    title: '剪辑节奏心理学（镜头平均长度 ASL + 节拍呼吸）',
    summary: 'ASL (Average Shot Length) 是剪辑节奏的量化指标。动作片 2-3s / 对话片 4-6s / 艺术片 8s+。不同节奏创造不同情绪。',
    content: `**ASL (Average Shot Length) 量化剪辑节奏**

| 类型 | ASL | 代表作 |
|---|---|---|
| 超快剪辑 | < 2s | 《Bourne》系列、音乐 MV |
| 快剪辑 | 2-3s | 动作片、惊悚片 |
| 中速剪辑 | 3-5s | 主流商业片 |
| 慢剪辑 | 5-8s | 剧情片、文艺片 |
| 超慢剪辑 | 8s+ | 艺术电影（贝拉·塔尔 20s+） |
| 长镜头 | 一镜到底 | 《人类之子》《1917》 |

**节奏与情绪的对应**

**快节奏（< 3s）**
- 情绪：兴奋 / 紧张 / 焦虑 / 混乱
- 适用：动作戏 / 追逐戏 / 争吵 / 战斗
- 风险：观众疲劳 / 看不清

**中节奏（3-5s）**
- 情绪：正常 / 叙事性 / 平衡
- 适用：对话 / 日常 / 铺垫
- 最舒适的节奏

**慢节奏（5-8s）**
- 情绪：沉思 / 悲伤 / 浪漫 / 孤独
- 适用：情感戏 / 告别 / 凝视
- 风险：观众走神

**超慢节奏（8s+）**
- 情绪：冥想 / 压迫 / 绝望 / 神圣
- 适用：艺术表达 / 关键凝视
- 难度：极高

**节奏呼吸法则**

电影应该像呼吸一样，快慢交替。

**3 段式节奏呼吸（适合 30 秒短片）**
\`\`\`
[0-5s]   慢 (建场 + 情绪)     ASL: 5s (1 个长镜头)
[5-20s]  快 (冲突 + 发展)     ASL: 2.5s (6 个短镜头)
[20-30s] 慢 (情感停留)         ASL: 5s (2 个中镜头)
\`\`\`

**5 段式节奏呼吸（适合 90 秒一集短剧）**
\`\`\`
[0-10s]   中速 (开场 + 钩子)    ASL: 3-4s
[10-30s]  快速 (冲突升级)       ASL: 2-3s
[30-50s]  中速 (关键发现)       ASL: 4s
[50-70s]  快速 (高潮对决)       ASL: 2s
[70-90s]  慢速 (情感收尾)       ASL: 5s
\`\`\`

**不同类型的 ASL 策略**

**动作片**（《Mad Max Fury Road》ASL 2.1s）
- 高速追逐：1-2s
- 间歇喘息：4-5s
- 爆发瞬间：0.5s
- 原则：快到观众跟不上 → 强行制造紧张

**艺术片**（《Stalker》ASL 60s+）
- 超长镜头
- 缓慢运动
- 气氛压抑
- 原则：慢到观众沉思 → 强迫深度参与

**恐怖片**（《The Conjuring》ASL 4s）
- 缓慢铺垫 → 突然高速
- 静 → 动的反差
- 原则：慢慢吓 + 突然惊

**爱情片**（《Before Sunrise》ASL 8s+）
- 长镜头对话
- 让观众听完整的话
- 原则：慢到观众共情

**节奏的 6 个黄金法则**

**1. 对话要慢，动作要快**
- 对话给观众时间理解
- 动作用剪辑制造动感

**2. 情绪高潮要给时间**
- 大哭 / 大笑 / 大震撼 要停 3-5s
- 不要切太快破坏情绪

**3. 信息镜头要慢**
- 重要道具 / 线索 / 表情
- 停留足够让观众看清

**4. 过渡镜头可以快**
- 走路 / 开门 / 坐下
- 不要浪费观众注意力

**5. 开头第一分钟要"抓住"**
- ASL 要快一点
- 信息密度要高

**6. 结尾最后 10 秒要"停留"**
- ASL 要慢
- 让情绪沉淀

**AI 漫剧节奏设计技巧**

由于 AI 视频一次生成一个固定时长的镜头（通常 3-10s），节奏控制主要靠：

1. **指定镜头时长**：在 prompt 中写 "short 2 second quick cut" vs "long 6 second contemplative hold"
2. **设计镜头数量**：90 秒一集要 15-25 个镜头（平均 4-6s/镜）
3. **分段策略**：快段 6-8 镜 + 慢段 2-3 镜 交替
4. **后期剪辑调整**：不满意可以剪短

**AI Prompt 节奏关键词**
- Quick cut / rapid montage / fast-paced
- Slow motion / long take / contemplative pause
- Static hold / frozen moment
- Time-lapse acceleration / speed ramp`,
    tags: ['节奏', 'ASL', '剪辑', '呼吸'],
    keywords: ['average shot length', 'editing rhythm', 'pacing', 'cut frequency', 'breathing editing', 'asl'],
    prompt_snippets: [
      'fast pace 2 second quick cuts for action sequence',
      'slow contemplative 6 second long take for emotional moment',
      'montage with progressively faster cuts building tension',
      'static 8 second hold on character face at climax',
    ],
    applies_to: ['director', 'storyboard'],
    source: 'Walter Murch 《In the Blink of an Eye》+ ASL 量化研究（Cinemetrics 数据库）',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_sb_v3_smash_cut',
    collection: 'storyboard',
    subcategory: '转场技法',
    title: 'Smash Cut 冲击剪辑（最强反差的剪辑技法）',
    summary: 'Smash Cut = 从一个极端镜头瞬间切到反面极端。用于震撼、反转、梦中惊醒、黑色幽默。',
    content: `Smash Cut 是最具冲击力的剪辑技法之一：两个完全对立的镜头之间没有任何过渡，直接硬切。

**定义**

Smash Cut 特征：
- 没有音频过渡
- 没有画面过渡
- 两个镜头在情绪 / 节奏 / 音量上**极度反差**
- 观众瞬间被震撼

**5 种经典用法**

**#1 安静 → 吵闹**
- 前镜：角色在图书馆安静坐着
- 后镜：摇滚演唱会 / 爆炸 / 尖叫
- 效果：心跳加速

**#2 吵闹 → 安静**
- 前镜：激烈争吵 / 战斗 / 高潮
- 后镜：黑屏 / 空镜 / 完全无声
- 效果：情绪空洞、震惊

**#3 梦中 → 现实**
- 前镜：梦中宁静美景 / 恐怖幻象
- 后镜：角色在床上猛地坐起，满头大汗
- 效果：观众跟着一起惊醒

**#4 计划 → 现实反差**
- 前镜：角色幻想完美计划（慢动作、配乐）
- 后镜：现实一团糟（狼狈、尴尬）
- 效果：黑色幽默、反差萌

**#5 生 → 死**
- 前镜：角色笑着说话 / 幸福时刻
- 后镜：角色躺在医院床上 / 葬礼
- 效果：悲剧冲击

**经典案例**

- **《Hot Fuzz》**：前镜主角幻想英勇动作 → 后镜现实中在小镇无聊巡逻
- **《老无所依》**：紧张追杀 → 后一镜已经结束
- **《搏击俱乐部》**：主角讲完话 → 瞬间切到完全不同场景
- **《美国美人》**：玫瑰花瓣幻想 → 现实的尴尬
- **《Inception》**：梦境爆炸 → 现实中的安静
- **《Parks and Rec》**：角色刚说完 → 瞬间切到灾难后果（喜剧）

**Smash Cut 的情绪公式**

\`\`\`
情绪冲击 = 前镜情绪 A + 后镜情绪 -A
\`\`\`

- 越对立，冲击越强
- 越无预警，冲击越强
- 音量变化越大，冲击越强

**AI 漫剧中实现 Smash Cut**

Smash Cut 需要在**后期剪辑**时精确控制，但也可以在 prompt 阶段设计：

**Prompt 设计示例**

**Shot 1**（2s）:
\`\`\`
serene peaceful scene of woman meditating in quiet Japanese garden,
soft morning light, complete silence except for distant bamboo chime,
medium close-up, static camera
\`\`\`

**Shot 2**（3s，紧接 Shot 1）:
\`\`\`
chaotic loud rock concert with thousands of fans screaming,
flashing stage lights, pyrotechnics,
wide shot of massive crowd, handheld camera
\`\`\`

后期直接硬切，无任何过渡 = Smash Cut 完成。

**Smash Cut 的 6 个注意事项**

1. **必须有对比性**：前后两镜情绪必须极度不同
2. **不要用过渡效果**：no fade / no dissolve / no wipe
3. **音频也要切**：前镜音频瞬间切断，后镜音频瞬间进入
4. **慎用**：一集不要超过 2-3 次
5. **服务主题**：不要为了炫技而用
6. **节奏合适**：在慢节奏段落中突然 smash 效果最好

**Smash Cut vs Hard Cut**

- **Hard Cut**：常规切换，情绪连贯
- **Smash Cut**：极端反差，情绪断裂

**Smash Cut vs Match Cut**

- **Match Cut**：通过相似元素连接，强调连贯
- **Smash Cut**：通过对立元素连接，强调断裂`,
    tags: ['smash cut', '冲击剪辑', '反差', '转场'],
    keywords: ['smash cut', 'jarring cut', 'contrast edit', 'shock cut', 'dream wake up', 'dark comedy cut'],
    prompt_snippets: [
      'Shot 1: peaceful meditation in quiet garden, complete silence',
      'Shot 2: sudden loud rock concert with screaming fans, flashing lights',
      'dreaming protagonist in blissful scene, then smash cut to sweaty awakening',
      'character laughing, smash cut to funeral scene, emotional contrast',
    ],
    applies_to: ['director', 'storyboard'],
    source: 'Smash Cut 经典案例 + 《Hot Fuzz》《Fight Club》剪辑分析',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_sb_v3_dream_transition',
    collection: 'storyboard',
    subcategory: '转场技法',
    title: '梦境 / 回忆 / 幻想转场设计（6 种明确区分现实与虚幻的方法）',
    summary: '从现实切到梦境/回忆/幻想需要明确的视觉信号，否则观众会迷惑。6 种经典方法。',
    content: `梦境、回忆、幻想是叙事中的重要工具，但必须让观众明确知道"这不是现实"。

**6 种梦境/回忆/幻想转场方法**

**#1 色彩切换（Color Shift）**
- 现实：正常色调
- 梦境/回忆：完全不同的色调
- 经典：黑白 → 彩色（《绿野仙踪》）、彩色 → 黑白（回忆）、饱和 → 褪色（老电影质感）
- 优点：最明显，观众立刻 get
- 缺点：有点老套

**#2 波浪过渡（Ripple Transition）**
- 画面像水波一样扭曲
- 配合"回忆音效"（铃铛 / 钢琴 / 风声）
- 老电影的经典梦境转场
- 现代用得少，除非做复古风

**#3 白屏闪烁（White Flash）**
- 画面突然全白，然后切到新场景
- 伴随"叮"的音效
- 适合：突然的闪回 / 顿悟时刻
- 代表：《记忆碎片》《闪灵》

**#4 主观模糊（Subjective Blur）**
- 画面从清晰逐渐失焦模糊
- 然后切到新场景
- 适合：角色进入睡梦 / 药物影响 / 头晕
- 代表：《盗梦空间》《穆赫兰道》

**#5 对象聚焦（Object Zoom）**
- 推镜头到一个关键物品
- 再从物品推出到新场景
- 物品是梦境/回忆的触发器
- 代表：玩具 / 相册 / 信件 / 钥匙

**#6 门/镜穿越（Door/Mirror Portal）**
- 角色走进门 / 照镜子 / 穿过走廊
- 出来就到了新世界
- 适合：超现实 / 魔幻 / 童话
- 代表：《千与千寻》《爱丽丝漫游仙境》

**梦境场景的视觉语言**

除了转场，梦境本身需要视觉标记：

**1. 景深异常**
- 全景深 或 极浅景深
- 与现实不同

**2. 色彩异常**
- 过饱和 或 去饱和
- 单色调（全蓝 / 全红 / 全绿）

**3. 运动异常**
- 慢动作 或 超快
- 不符合物理规律

**4. 空间异常**
- 无限的长廊
- 漂浮的物体
- 颠倒的重力

**5. 声音异常**
- 回音
- 远处的人声
- 音乐变调

**6. 光线异常**
- 光源来自不合理方向
- 超亮 / 超暗
- 光斑漂浮

**AI 漫剧中的梦境/回忆 Prompt 模板**

**现实 → 回忆**
\`\`\`
Shot 1 (现实): character sitting quietly looking at old photograph,
warm soft afternoon light, present day setting, sharp focus, normal color

Transition: slow push-in to the photograph in character's hand, losing focus

Shot 2 (回忆): same character 20 years younger in same photograph setting,
desaturated vintage color palette, subtle sepia tone, softer focus,
film grain texture, nostalgic atmosphere, slower motion
\`\`\`

**现实 → 梦境**
\`\`\`
Shot 1 (现实): character lying in bed, eyes slowly closing,
normal bedroom lighting, eye-level angle

Transition: white flash with subtle ringing sound

Shot 2 (梦境): same character floating in endless white space,
surreal dreamy atmosphere, hyper-saturated colors,
slow motion, impossible physics, ethereal lighting,
no clear boundary between floor and ceiling
\`\`\`

**现实 → 幻想**
\`\`\`
Shot 1 (现实): character sitting in boring office meeting,
drab grey corporate lighting, neutral expression

Transition: camera push-in to character's eyes with subtle motion blur

Shot 2 (幻想): same character as action hero fighting villains,
dramatic high contrast lighting, cinematic action cinematography,
slow motion punches, explosion effects, confident expression
\`\`\`

**回来到现实**

梦境结束 → 现实的转场也需要标志：
1. 角色"猛地惊醒"
2. 光线突变
3. 声音骤停
4. 色彩恢复

**梦境转场禁忌**

- 不要让观众怀疑"这是真的还是梦"（除非故意模糊）
- 不要一集里有 3 次以上梦境切换（观众会晕）
- 不要梦境和现实完全一样（失去意义）
- 不要忘记设计"回到现实"的转场`,
    tags: ['梦境', '回忆', '幻想', '转场'],
    keywords: ['dream sequence', 'flashback', 'fantasy sequence', 'dream transition', 'memory cut', 'subjective blur', 'ripple'],
    prompt_snippets: [
      'Shot 1 reality: character looking at photograph in warm afternoon light',
      'Shot 2 flashback: same scene 20 years ago in desaturated vintage tones',
      'white flash transition to surreal dream space with hyper-saturated colors',
      'subjective blur from reality to hallucination with impossible physics',
    ],
    applies_to: ['director', 'storyboard'],
    source: '电影梦境场景经典技法 + 《盗梦空间》《穆赫兰道》《记忆碎片》分析',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_sb_v3_parallel_editing',
    collection: 'storyboard',
    subcategory: '分镜模板',
    title: '平行剪辑 (Parallel Editing) / 交叉剪辑 (Cross-Cutting)',
    summary: '平行剪辑 = 同时展示两条以上时间线的故事。紧张感倍增的核心技法。',
    content: `**定义**

平行剪辑（Parallel Editing / Cross-Cutting）是在两条或多条同时发生的故事线之间切换，观众同时跟随多条线索。

**与 Match Cut 的区别**
- Match Cut：单独两个镜头的优雅过渡
- Parallel Editing：贯穿整段戏的多线交叉

**4 种平行剪辑场景**

**#1 危机 + 救援**
- A 线：受害者面临危险（在倒数）
- B 线：救援者在赶来
- 切换频率逐渐加快
- 经典：《悬崖上的野餐》《Fast & Furious》

**#2 计划 + 执行**
- A 线：一个人在布置陷阱
- B 线：另一个人走向陷阱
- 观众看到双方看不到的
- 经典：《教父》婴儿洗礼 + 多处屠杀

**#3 不同人物同一目标**
- A 线：主角追逐目标
- B 线：反派也在追同一目标
- 谁先到达？
- 经典：《黑客帝国》Neo vs 探员

**#4 回忆 + 现实**
- A 线：当前角色回忆
- B 线：当前角色的现状
- 形成对比或因果关系
- 经典：《godfather II》

**平行剪辑的节奏公式**

**标准 5 阶段节奏**
\`\`\`
阶段 1 (建立): 两条线各展示 5-6s，ASL 5s
阶段 2 (同步): 两条线各展示 3-4s，ASL 3.5s
阶段 3 (加速): 两条线各展示 2-3s，ASL 2.5s
阶段 4 (急速): 两条线各展示 1-2s，ASL 1.5s
阶段 5 (汇合): 两条线汇合为一个镜头（相遇 / 救援 / 对峙）
\`\`\`

**经典案例：《教父》婴儿洗礼**
\`\`\`
A 线 (神圣): 婴儿在教堂受洗，神父祈祷
B 线 (邪恶): 多个地方的黑帮成员被暗杀

节奏:
- 洗礼 (10s) → 暗杀 #1 (5s)
- 洗礼 (8s) → 暗杀 #2 (4s)
- 洗礼 (6s) → 暗杀 #3 (3s)
- 洗礼 (5s) → 暗杀 #4 (2s)
- 洗礼 (4s) → 暗杀 #5 (2s)
- 汇合: Michael 承担教父责任的特写
\`\`\`

**平行剪辑的情绪作用**

**1. 制造紧张**
- 观众知道即将发生的灾难
- 角色不知道
- 双方差距越接近，紧张越大

**2. 制造讽刺**
- 两条线情绪对立
- 造成黑色幽默或悲剧

**3. 揭示主题**
- 两条线代表不同价值观
- 让观众比较

**4. 浓缩时间**
- 用剪辑让不同时间的事件"同时发生"
- 信息密度倍增

**AI 漫剧中的平行剪辑设计**

**Prompt 设计示例**

**场景设定**：女主在医院等待手术结果，男主在赶来医院的路上

**Shot 分配（30s 平行段）**

\`\`\`
Shot 1A (6s): female protagonist pacing in hospital waiting room,
anxious expression, cold fluorescent light, medium shot

Shot 1B (6s): male protagonist driving car in heavy rain,
worried face, windshield wipers working, medium close-up

Shot 2A (4s): woman looking at phone no messages, nervous
Shot 2B (4s): man dialing phone while driving, getting voicemail

Shot 3A (3s): doctor walking down hallway toward woman
Shot 3B (3s): car running red light, honking

Shot 4A (2s): woman standing up, fear
Shot 4B (2s): car crashing through puddle, tires screeching

Shot 5A (2s): doctor reaching woman, serious face
Shot 5B (2s): man running into hospital lobby

Shot 6 (合并 5s): man sees woman with doctor in hallway,
time slows down, emotional reunion shot
\`\`\`

**平行剪辑禁忌**

- 不要超过 3 条线（观众跟不上）
- 不要切换不均衡（一条线太多戏）
- 不要无意义的平行（两条线要有关联）
- 不要平均主义（节奏要加快）`,
    tags: ['平行剪辑', '交叉剪辑', 'parallel', '多线叙事'],
    keywords: ['parallel editing', 'cross cutting', 'intercut', 'multi thread narrative', 'godfather baptism', 'cross-cut tension'],
    prompt_snippets: [
      'parallel editing between rescue mission and victim in danger',
      'cross-cutting between two characters racing to same location',
      'intercut scenes of planning and execution with increasing tempo',
      'final convergence shot where two parallel storylines meet',
    ],
    applies_to: ['director', 'storyboard'],
    source: 'D.W. Griffith 开创平行剪辑 + 《教父》《Fast Furious》案例',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_sb_v3_30_degree_rule',
    collection: 'storyboard',
    subcategory: '分镜模板',
    title: '30 度规则 + 景别跳跃规则（避免"跳切感"）',
    summary: '连续两个镜头之间，相机角度至少差 30 度，景别至少差 1 级，否则会产生"跳切"的视觉不适。',
    content: `**30 度规则 (30 Degree Rule)**

连续两个镜头如果是同一个主体，相机位置必须至少移动 30 度，否则会看起来像"跳切"（jump cut）。

**为什么？**
- < 30 度的切换让观众觉得"这是同一个镜头，只是跳了一下"
- 观众会察觉到剪辑 → 出戏
- 大脑无法流畅接受

**正确做法**
- 切换相机位置时移动 30 度以上
- 例：从正面切到斜 45 度
- 例：从左前方切到右后方

**错误做法**
- 正面 → 稍微斜一点的正面（< 30 度）
- 观众会觉得"画面抖了一下"

**景别跳跃规则 (Size Jump Rule)**

连续两个镜头如果是同一个主体，景别必须至少差一级：
- Wide → Medium ✓
- Medium → Close-up ✓
- Wide → Close-up ✓（跳两级也行）
- Wide → Wide（相似）✗

**为什么？**
- 相似景别 + 相似角度 = 跳切感
- 观众会觉得"画面突然变了一点"

**跳切 (Jump Cut) 的正确用法**

虽然跳切是"错误"，但也可以故意使用：

**1. 故意表达焦虑 / 不稳定**
- 代表：《精疲力竭》（戈达尔，法国新浪潮）
- 《现代生活》（Modern Times）
- 效果：打破第四面墙，让观众察觉这是电影

**2. 时间压缩**
- 同一角色同一场景跳切表示"时间流逝"
- 例：角色从坐着 → 站着 → 走动
- 代表：现代 vlog 风格

**3. 节奏加快**
- 连续跳切制造紧张感
- 代表：《Requiem for a Dream》药物场景

**规则总结**

**避免跳切的 3 种方法**
1. **大幅度改变角度**（30 度以上）
2. **大幅度改变景别**（1 级以上）
3. **插入过渡镜头**（cutaway）

**AI 漫剧中的应用**

**错误示例**（跳切）
\`\`\`
Shot 1: medium shot of woman facing camera directly, talking
Shot 2: medium shot of same woman facing camera at slight angle, still talking
\`\`\`
❌ 观众会觉得突兀

**正确示例**
\`\`\`
Shot 1: medium shot of woman facing camera directly, talking
Shot 2: close-up of woman's face, 45-degree angle, same moment
\`\`\`
✓ 景别跳（medium → close）+ 角度跳（0 → 45 度）

**相机位置的 8 个标准角度**

想象一个人站在中心，周围 8 个位置：
\`\`\`
       后
    后左  后右
  左    主体    右
    前左  前右
       前 (正面)
\`\`\`

合法切换需要跨越至少 1 个位置（> 45 度）

**相机高度的 3 个标准**

- Low angle（仰拍）: 相机低于主体
- Eye level（平视）: 相机与主体眼睛齐平
- High angle（俯拍）: 相机高于主体
- Bird's eye（鸟瞰）: 相机在主体正上方

连续切换时也要变化高度。

**综合应用：一场戏的相机变化**

**A 女主在咖啡馆听坏消息场景**

\`\`\`
Shot 1 (Wide, Eye Level, 正面): 女主坐在咖啡馆窗边
    ↓ 切
Shot 2 (Medium, 45 度左, Eye Level): 女主接电话
    ↓ 切
Shot 3 (Close-up, 正面, Low Angle): 女主震惊的表情
    ↓ 切
Shot 4 (ECU, 侧面, Eye Level): 手机屏幕的文字
    ↓ 切
Shot 5 (Medium, 90 度右, Eye Level): 女主眼含泪光
    ↓ 切
Shot 6 (Wide, 俯拍, High Angle): 咖啡馆全景，女主显得渺小
\`\`\`

每次切换都改变了 1-2 个维度，不会跳切。

**常见错误避免 checklist**
- [ ] 两个连续镜头角度差 > 30 度？
- [ ] 两个连续镜头景别差 > 1 级？
- [ ] 如果角度不够，是否用了 cutaway 过渡？
- [ ] 是否在 180 度线的同一侧？
- [ ] 光线方向是否保持一致？`,
    tags: ['30度', '跳切', '景别跳跃', '连续性'],
    keywords: ['30 degree rule', 'jump cut', 'size jump', 'continuity', 'shot change', 'editing grammar'],
    prompt_snippets: [
      'Shot 1: medium wide shot eye level front angle',
      'Shot 2: close-up 45 degree side angle low angle, same character',
      'Shot 3: extreme close-up on detail, different angle',
      'avoid jump cut by changing both shot size and camera angle',
    ],
    applies_to: ['director', 'storyboard'],
    source: '电影剪辑连续性理论（Grammar of Film Language）',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_sb_v3_handheld_vs_stable',
    collection: 'storyboard',
    subcategory: '运镜公式',
    title: '手持 vs 稳定拍摄的情绪语言（Handheld vs Steadicam vs Tripod）',
    summary: '相机稳定度本身就是一种情绪：三脚架=庄严，稳定器=专业，手持=真实，抖动=焦虑，失稳=崩溃。',
    content: `相机的稳定性（或不稳定性）直接影响观众的情绪感受，是重要的导演工具。

**5 种相机稳定度对应的情绪**

**#1 Tripod / Locked Off（完全静止）**
- 摄像机完全不动
- 情绪：庄严 / 严肃 / 正式 / 权威
- 适用：仪式 / 审讯 / 新闻 / 访谈 / 旁白叙述
- 代表：《辛德勒的名单》审讯场景、《教父》家族会议
- AI Prompt: "static locked off camera, tripod stability"

**#2 Dolly / Steadicam（平滑运动）**
- 专业稳定器 + 轨道
- 情绪：优雅 / 电影感 / 控制 / 精准
- 适用：正常叙事 / 动作跟拍 / 长镜头
- 代表：《社交网络》《闪灵》走廊、几乎所有商业片
- AI Prompt: "smooth steadicam tracking shot, precise controlled movement"

**#3 Gentle Handheld（轻度手持）**
- 相机跟着人的呼吸微动
- 情绪：真实 / 日常 / 人性 / 接近
- 适用：纪录片 / 现实主义 / 情感戏
- 代表：达顿兄弟电影、《男孩时代》、《Nomadland》
- AI Prompt: "gentle handheld camera with subtle organic breathing movement"

**#4 Active Handheld（活跃手持）**
- 相机跟着动作快速移动
- 情绪：紧张 / 混乱 / 激动 / 沉浸
- 适用：战斗 / 追逐 / 争吵 / 突发事件
- 代表：《拯救大兵瑞恩》、《波恩身份》、《黑鹰坠落》
- AI Prompt: "active handheld camera following action, reactive movement"

**#5 Shaking / Unstable（强烈晃动）**
- 相机剧烈晃动 / 失焦
- 情绪：焦虑 / 恐惧 / 精神崩溃 / 战争
- 适用：恐怖 / 精神状态崩塌 / 灾难
- 代表：《女巫布莱尔》、《Cloverfield》、《母亲!》
- AI Prompt: "shaking unstable camera, found footage style, panic"

**混合使用的技巧**

**一场戏中的稳定度变化**

**Case A: 从平静到恐惧**
\`\`\`
Shot 1: Tripod (静止) - 女主坐在家中看书
Shot 2: Gentle handheld (轻度) - 女主听到奇怪声音
Shot 3: Active handheld (活跃) - 女主走向声源
Shot 4: Shaking (强烈) - 女主看到恐怖画面
\`\`\`
观众跟着相机的稳定度一起紧张。

**Case B: 从混乱到平静**
\`\`\`
Shot 1: Shaking (强烈) - 战斗中的士兵
Shot 2: Active handheld (活跃) - 战斗结束，幸存者喘息
Shot 3: Gentle handheld (轻度) - 幸存者走向家
Shot 4: Tripod (静止) - 幸存者回到安静的家
\`\`\`
观众跟着一起放松。

**稳定度与景别的组合**

不同景别适合不同的稳定度：

| 景别 | 稳定度 | 效果 |
|---|---|---|
| 远景 | Tripod | 史诗感 |
| 远景 | Handheld | 纪实感 |
| 中景 | Steadicam | 商业感 |
| 中景 | Gentle handheld | 剧情感 |
| 特写 | Static | 凝视感 |
| 特写 | Shaking | 恐惧感 |

**AI 漫剧中的稳定度 prompt**

**严肃审讯场景**
\`\`\`
locked-off static camera, tripod stability, medium close-up,
interrogation room with harsh top light, no camera movement,
oppressive formal atmosphere
\`\`\`

**情感对话场景**
\`\`\`
gentle handheld camera with subtle breathing movement,
medium close-up of two characters, warm cafe lighting,
naturalistic feel, immersive emotional
\`\`\`

**追逐战斗场景**
\`\`\`
active handheld camera following protagonist running,
fast movement with natural shake, urban street setting,
intense kinetic energy, Bourne-style cinematography
\`\`\`

**恐怖惊悚场景**
\`\`\`
shaking unstable camera, found footage style,
rapid panic movements, dark corridor with flickering light,
character breathing heavily, horror atmosphere
\`\`\`

**禁忌**

- 不要一场戏内频繁切换稳定度（观众会晕）
- 严肃场景用手持 → 显得不专业
- 战斗场景用三脚架 → 失去紧张感
- 纪录片风格项目用 steadicam → 失去真实感
- 手持不等于摇晃失控，要有意识地控制强度`,
    tags: ['手持', '稳定器', 'handheld', 'steadicam', '相机稳定度'],
    keywords: ['handheld camera', 'steadicam', 'tripod', 'camera stability', 'jittery', 'organic movement', 'bourne style'],
    prompt_snippets: [
      'locked-off static tripod camera, formal serious atmosphere',
      'smooth steadicam tracking shot, cinematic control',
      'gentle handheld with subtle breathing, naturalistic intimate feel',
      'active handheld following action, Bourne-style kinetic energy',
      'shaking unstable camera, found footage horror panic style',
    ],
    applies_to: ['director', 'storyboard'],
    source: '电影摄影稳定度分析 + 达顿兄弟 / 保罗·格林格拉斯 / 拉尔斯·冯·特里尔风格研究',
    lang: 'zh-en',
    enabled: true,
  },
];
