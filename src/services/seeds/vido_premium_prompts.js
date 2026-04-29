/**
 * VIDO 出品 · 高级提示词包（v1 / 2026-04-25）
 *
 * 用于在没有外部飞书 wiki 同步源时，作为「精品提示词」的内置 fallback。
 * 由 knowledgeBaseService.ensureSeeded() 启动时增量 insert（id 已存在自动跳过）。
 *
 * 涵盖：
 *  - AI 视频去 AI 味的 5 个抗瑕疵原则
 *  - 角色一致性的 7 元素描述协议
 *  - 商业短剧"3 秒钩子"开场公式
 *  - 数字人 60s 口播 BMC 模板
 *  - 多镜头动作戏的"主-反应-空镜"三联剪
 *  - 氛围层：电影级颗粒 / 雾气 / 体积光的英文 prompt 词库
 *  - 文生视频提示词的 7 段式工业模板
 */
module.exports = [
  {
    id: 'kb_vidopremium_video_anti_ai_5p',
    collection: 'atmosphere',
    subcategory: '去 AI 味',
    title: '去 AI 味五原则（视频画面避免一眼假大空）',
    summary:
      '抗 AI 味的核心是去除"过度对称、过度光滑、过度饱和、过度居中、过度长焦"。',
    content: `1. 反对称：构图刻意偏移黄金分割点 1/3 处，避免主体死正中
2. 加颗粒：35mm 胶片 grain 0.3-0.6 / Kodak Portra 400 噪点纹理
3. 降饱和：HSL 中红橙黄整体降 8-15%，营造 cinematic 真实感
4. 用广角：24mm / 28mm 视角带轻微桶形畸变，远胜过 85mm 长焦的"AI 完美脸"
5. 加光斑：anamorphic lens flare、镜头脏污、bokeh balls 自然散景`,
    tags: ['去AI味', '画面真实感', '电影感', 'cinematic'],
    keywords: ['anti-ai look', 'film grain', 'anamorphic', 'cinematic',
      'wide-angle distortion', '35mm', 'Kodak Portra'],
    prompt_snippets: [
      'shot on 35mm film, Kodak Portra 400 grain, slight color cast',
      'anamorphic lens flare, oval bokeh, lens dust artifacts',
      'rule of thirds composition, off-center subject placement',
      'desaturated cinematic palette, lifted blacks, teal-orange grade',
      'wide-angle 24mm distortion, slight barrel curve at edges',
    ],
    applies_to: ['atmosphere', 'storyboard', 'director', 'art_director'],
    source: 'VIDO 出品 · 飞书 wiki SUgDwo3PliqMebkq0LKcISn3nvd 抗 AI 味章节合成',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_vidopremium_character_7element',
    collection: 'storyboard',
    subcategory: '人物一致性',
    title: '角色一致性 7 元素描述协议（每镜必锁）',
    summary:
      '7 元素 = 性别年龄 / 发型发色 / 五官特征 / 体型身高 / 服装款式色 / 配饰 / 表情常态。',
    content: `每个角色首次出现，必须按 7 元素完整描述；后续镜头复用相同短语，禁止用代词或简写。

固定模板（中文）：
"{年龄段}{性别}，{发型 + 发色 + 长度}，{脸型 + 五官关键特征}，{体型 + 身高}，
身穿{上衣款式 + 颜色}+{下装款式 + 颜色}+{鞋子}，{配饰}，{常态表情}。"

固定模板（英文 prompt）：
"{age} {gender}, {hair style + color + length}, {face shape + key features},
{body type + height}, wearing {top + color}, {bottom + color}, {shoes},
{accessories}, {default expression}."

七元素必须在 character_image / 每个 visual_prompt / 每镜 prompt 中完整复读。
即梦/Seedance/Veo/NanoBanana 模型对前 200 字最敏感，把 7 元素塞进前 200 字。`,
    tags: ['角色一致性', '人物Bible', '跨镜头', 'character'],
    keywords: ['character consistency', 'character bible', '7-element',
      'cross-shot consistency', 'visual prompt prefix'],
    prompt_snippets: [
      'young woman, mid-20s, long straight black hair to waist, oval face, almond eyes, slim build 168cm, wearing white linen shirt, beige wide-leg pants, brown loafers, silver pendant necklace, calm gentle expression',
      'middle-aged man, late 30s, short messy brown hair, square jaw, scar on left cheek, athletic 180cm, wearing black leather jacket, gray T-shirt, dark jeans, combat boots, silver wristwatch, brooding expression',
    ],
    applies_to: ['character_consistency', 'screenwriter', 'storyboard', 'art_director'],
    source: 'VIDO 出品 · 飞书 wiki 角色 Bible 章节',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_vidopremium_3s_hook_formulas',
    collection: 'drama',
    subcategory: '钩子公式',
    title: '短剧/漫剧 3 秒钩子开场 6 公式（爆款率 +60%）',
    summary:
      '抖音/快手算法在前 3s 决定推流，必须在第 1 秒就给出反差/悬念/冲突。',
    content: `公式 1 — 反差揭露：
"她昨天还是CEO，今天在地铁里捡瓶子" → 立刻揭露身份反转

公式 2 — 提问爆破：
"你觉得月薪3千的女人能嫁豪门吗？答案让所有人哭了"

公式 3 — 数字冲击：
"我用 18 元工资养活了 3 个孩子，10 年后他们..."

公式 4 — 禁忌悬念：
"千万别让妈妈看到这条视频，否则..."

公式 5 — 现场冲突：
开场即是争吵 / 摔东西 / 哭泣高潮（in medias res）

公式 6 — 第二人称代入：
"如果你是她，你会怎么选？"+ 立刻展示选择题

每条第一帧必须强构图：人物特写占 60% 屏幕 / 鲜明色块对比 / 文字大字报`,
    tags: ['钩子', '3秒法则', '短剧', '爆款', 'hook'],
    keywords: ['3-second hook', 'in medias res', 'algorithm push',
      'opening shot', 'thumbnail viral'],
    prompt_snippets: [
      '开场反差揭露：身份A → 立刻反转身份B',
      'in medias res 现场冲突：摔东西/争吵特写',
      '禁忌悬念：千万别...否则 + 立刻镜头切走',
    ],
    applies_to: ['screenwriter', 'editor', 'copywriter', 'director'],
    source: 'VIDO 出品 · 飞书 wiki 短剧爆款公式',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_vidopremium_dh_60s_bmc',
    collection: 'digital_human',
    subcategory: '口播模板',
    title: '数字人 60 秒商业口播 BMC 模板（带货转化率 +40%）',
    summary: 'BMC = Belief（共鸣信念）+ Mechanism（独特机制）+ Call（明确指令）。',
    content: `60 秒精确节奏（按 4 字/秒中文语速 = 240 字）：

[0-5s · Belief 共鸣痛点]
"我知道你也试过很多减脂方法，但都失败了——"（直接代入用户痛苦）

[5-30s · Mechanism 独特机制]
"今天告诉你一个连健身教练都不愿意公开的秘密：
{核心卖点 1: 原理 X}，配合 {核心卖点 2: 成分 Y}，30 天瘦 8 斤。
我自己用了 3 个月，从 65 kg 降到 52 kg，照片对比给你看（左右对比图）。"

[30-50s · Proof 信任建立]
"已经有 1.2 万学员实测有效，{头部 KOL/医生/明星} 也在用。
今天我把全部 7 节课打包，原价 999 元——"

[50-60s · Call 明确指令]
"现在点击下方小黄车，前 100 名只要 99 元，付完款立刻拉你进群。
3、2、1，开抢！" （倒数+紧迫）

每段 5s 切镜头：特写 → 产品图 → 数据图 → 对比图 → CTA 大字版
说话节奏：前快后慢，最后 5s 必须慢下来 + 加重音`,
    tags: ['数字人', '口播', '带货', 'BMC', '转化'],
    keywords: ['digital human script', 'sales pitch', '60s template',
      'belief mechanism call', 'conversion'],
    prompt_snippets: [
      '5s 痛点共鸣 → 25s 机制讲解 → 20s 信任证明 → 10s 行动指令',
      '说话节奏前快后慢，最后 5s 慢+重音',
      '镜头切换 5s/次，最后 CTA 必须大字版',
    ],
    applies_to: ['digital_human', 'copywriter', 'screenwriter'],
    source: 'VIDO 出品 · 飞书 wiki 数字人带货 SOP',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_vidopremium_action_3shot_combo',
    collection: 'storyboard',
    subcategory: '动作戏剪辑',
    title: '动作戏「主-反应-空镜」三联剪辑公式',
    summary:
      '所有打斗/激烈场景必须按"主动作镜头(2s) → 受击者反应特写(1s) → 环境碎片空镜(0.5s)"循环，避免单调。',
    content: `三联剪辑标准时长（适用于 Sora 2 / Seedance 2.0 / Kling 2.1）：

主镜头（2-3s · 90fps 慢动作）：
- 完整动作弧线（出拳→击中→收回）
- 肩膀-臀部连成一条对角线（动态构图）
- 轻微 motion blur + speed lines

反应镜头（0.8-1.2s · 24fps）：
- 受击者面部特写：嘴角/眉毛肌肉 micro-expression
- 慢镜头中的飞溅唾液 / 汗水 / 血雾（慎用）
- 焦点死锁在眼睛

空镜头（0.4-0.6s · 24fps）：
- 飞散的碎片 / 落叶 / 玻璃碴
- 环境中的灯泡爆裂 / 杯子翻倒
- 背景里逃跑的路人惊恐脸

三镜组合后立刻接「重新建立空间关系」的全景中镜（1.5s）防止观众失去方位感。

色彩节奏：主镜 100% 饱和 → 反应镜降 30% → 空镜接近黑白，再回主镜炸回饱和。`,
    tags: ['动作戏', '剪辑', '三联剪', 'action', 'editing'],
    keywords: ['action editing', 'three-shot combo', 'reaction close-up',
      'environmental insert', 'speed ramp', 'micro expression'],
    prompt_snippets: [
      'main action shot 2-3s slow-motion 90fps with motion blur and speed lines',
      'reaction close-up on receiver eyes, micro-expression, frozen moment',
      'environmental insert: shattered glass / falling leaves / bursting bulb',
    ],
    applies_to: ['storyboard', 'director', 'editor'],
    source: 'VIDO 出品 · 飞书 wiki 动作戏分镜手册',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_vidopremium_atm_filmlight_dict',
    collection: 'atmosphere',
    subcategory: '光影词库',
    title: '电影级光影氛围词库（按场景类型 × 时间 × 情绪三维查询）',
    summary:
      '把"光线方向 × 色温 × 强度 × 衍射形态"组合成可直接复制的英文 prompt 短语库。',
    content: `## 黄金时刻 / Golden Hour（情感、温暖、回忆）
- "warm golden hour sidelight, low sun, 3200K, long shadows, dust particles in air"
- "honey-colored backlight rim, hair glowing, soft volumetric god rays through window"
- "magic hour orange-pink gradient sky, anti-rainbow gradient backdrop"

## 蓝调时刻 / Blue Hour（孤独、悬疑、夜归）
- "cold blue hour twilight, 6500K, deep shadows, glowing windows like lanterns"
- "moody overcast diffused light, no hard shadows, melancholic mood"
- "mixed lighting: warm indoor 3000K + cold outdoor blue 8000K"

## 霓虹之夜 / Neon Night（赛博、都市、欲望）
- "wet asphalt reflecting neon signs, magenta + cyan dual color rim"
- "rain-soaked street with bokeh of neon lights, anamorphic lens flare horizontal streaks"
- "cyberpunk noir lighting, harsh shadows, 30% magenta key + 70% cyan fill"

## 室内冷氛围 / Interior Cold（精致、冷静、专业）
- "soft daylight from north window, color temperature 5500K, low contrast"
- "single overhead pendant light, falloff to deep shadows, Caravaggio chiaroscuro"
- "natural daylight with bounce card fill, fashion editorial aesthetic"

## 雾气体积光 / Volumetric Fog（神秘、史诗、东方）
- "thick atmospheric haze with god rays piercing through tree canopy"
- "low-lying ground fog, knee-high mist, dawn light, mystical atmosphere"
- "Oriental ink-wash mist (水墨雾气), receding mountains, layered depth"`,
    tags: ['氛围', '光影', '色温', 'lighting', 'atmosphere'],
    keywords: ['lighting', 'golden hour', 'blue hour', 'neon', 'volumetric fog',
      'color temperature', 'cinematography'],
    prompt_snippets: [
      'warm golden hour sidelight, low sun, dust particles, long shadows',
      'cold blue hour twilight, glowing windows, melancholic mood',
      'wet asphalt + neon magenta cyan + anamorphic lens flare',
      'thick atmospheric haze, god rays through canopy',
    ],
    applies_to: ['atmosphere', 'storyboard', 'director', 'art_director'],
    source: 'VIDO 出品 · 飞书 wiki 光影词库',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_vidopremium_t2v_7part_industry',
    collection: 'storyboard',
    subcategory: '工业模板',
    title: '文生视频 7 段式工业级提示词模板（适配 Veo3.1/Sora2/Kling2.1/Seedance2.0）',
    summary:
      '7 段顺序：[相机] → [主体7元素] → [核心动作1拍] → [次要动作] → [环境光线] → [声音] → [风格氛围]。',
    content: `严格按以下顺序写英文 prompt（任何模型都能正确解析）：

[1] CAMERA（必须前置）
"Low-angle tracking shot, 24mm wide-angle lens, shallow depth of field, slight camera shake."

[2] SUBJECT（7 元素全描）
"young woman in her 20s, long wavy black hair to shoulders, oval face with high cheekbones,
slim 165cm, wearing oversized cream sweater and dark jeans, gold hoop earrings, pensive expression."

[3] PRIMARY ACTION（一个明确动作）
"slowly turning her head toward the rain-streaked window, fingers tightening around a ceramic mug."

[4] SECONDARY ACTION（次要细节让画面活）
"steam rising from the mug, raindrops sliding down glass, distant traffic lights pulsing."

[5] ENVIRONMENT & LIGHT（场景 + 时间 + 光）
"inside a small wooden cafe at dusk, blue-hour twilight outside, warm tungsten pendant light overhead,
mixed color temperature 3000K + 7000K, fogged window, autumn rain."

[6] SOUND（Sora 2 / Veo 3 支持原生音频）
"ambient cafe murmur, gentle jazz piano in background, rain hitting window, mug being set down on wood."

[7] STYLE & MOOD（最后强化）
"shot on 35mm film, Kodak Portra 400 grain, anamorphic lens flare, cinematic teal-orange grade,
melancholic introspective mood, Wong Kar-wai inspired aesthetic."

模型适配：
- Sora 2：CAMERA + SOUND 部分必须详写
- Veo 3.1：可加 "8s duration, 24fps, 1080p"
- Kling 2.1：偏好动作细节，PRIMARY ACTION 写得越具体越好
- Seedance 2.0：每镜只塞 1 个 PRIMARY ACTION，不要堆叠
- NanoBanana：偏好简短 50 词内，把 7 段缩成 4 段（主体+动作+环境+风格）`,
    tags: ['T2V', '提示词模板', '工业级', 'prompt-template'],
    keywords: ['text-to-video', '7-part prompt', 'sora', 'veo', 'kling',
      'seedance', 'nanobanana', 'cinematography prefix'],
    prompt_snippets: [
      'CAMERA → SUBJECT(7 elements) → PRIMARY ACTION → SECONDARY ACTION → ENV/LIGHT → SOUND → STYLE',
    ],
    applies_to: ['storyboard', 'director', 'art_director', 'atmosphere'],
    source: 'VIDO 出品 · 飞书 wiki 工业级提示词模板',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_vidopremium_drama_reversal_engine',
    collection: 'drama',
    subcategory: '反转引擎',
    title: '短剧 5 段反转引擎（每集 1 个大反转 + 3 个小反转）',
    summary:
      '抖音/快手短剧每 60s-90s 必须 1 个反转，每 15-20s 一个小反转，否则完播率 < 30%。',
    content: `每集结构（90 秒 = 6 段 × 15 秒）：

段 1 [0-15s]：状态建立 + 第一个反转
- 看似 A，揭露其实是 B（身份反转 / 处境反转）

段 2 [15-30s]：危机升级 + 小反转
- 反派出场，主角陷入更深危机
- 小反转：主角看似无助，其实早有伏笔

段 3 [30-45s]：盟友出现 + 小反转
- 看似友善的人其实另有目的
- 或：看似敌人的人开始帮助

段 4 [45-60s]：信息揭露
- 抛出关键信息（出身/血缘/秘密）
- 改变对前面剧情的认知

段 5 [60-75s]：高潮对峙
- 主角与反派正面交锋
- 大反转：主角隐藏的实力/身份被亮出

段 6 [75-90s]：结尾钩子
- 留一个新悬念（新人物登场 / 新威胁出现 / 真相只揭一半）
- 必须让观众想点下一集

反转必须遵守：
1. 每个反转必须有前面伏笔（不能凭空发生）
2. 反转 > 期望值的 1.5 倍才有冲击（"她以为只是普通员工，其实是CEO千金"）
3. 反转后立刻给情绪反应特写（受冲击的人脸 1.5s）`,
    tags: ['短剧', '反转', '叙事结构', 'reversal'],
    keywords: ['plot twist', 'reversal engine', 'short drama structure',
      'completion rate', 'chinese vertical drama'],
    prompt_snippets: [
      '每 15s 一个小反转 + 每 60-90s 一个大反转',
      '反转必须有前面伏笔，不能凭空发生',
      '反转后给受冲击者面部特写 1.5s',
    ],
    applies_to: ['screenwriter', 'director', 'editor'],
    source: 'VIDO 出品 · 飞书 wiki 短剧反转引擎',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_vidopremium_copy_titlefactory',
    collection: 'production',
    subcategory: '文案工厂',
    title: '爆款标题 9 种工厂式公式（CTR +200%）',
    summary:
      '所有抖音/小红书/视频号/B站爆款标题归结为 9 种公式，按平台调权重。',
    content: `## 1. 数字 + 反差
"我月薪3000，却存下了10万——3 个反人性方法"

## 2. 提问 + 答案钩子
"为什么985毕业生不愿进华为？真相让人沉默"

## 3. 时间 + 转变
"3 天前还在哭泣，今天她笑着说..."

## 4. 身份 + 反差
"清华学霸辞职去摆摊，3 个月后..."

## 5. 禁忌 + 警告
"千万别对你的孩子说这 5 句话，会毁掉他一生"

## 6. 第二人称 + 共鸣
"如果你也常感到孤独，请看完这条视频"

## 7. 揭秘 + 内幕
"航空公司不告诉你的 7 个购票省钱秘密"

## 8. 极端 + 对比
"全网最丑的房子改造，结果惊艳所有人"

## 9. 事件 + 立场
"我支持取消公摊面积，原因有 3 个"

平台权重：
- 抖音：1/3/5/9 优先（强情绪、强反差）
- 小红书：4/6/7 优先（个人经历、利他、揭秘）
- 视频号：2/4/8 优先（中年用户偏理性 + 共鸣）
- B站：6/7/9 优先（年轻用户偏求知 + 立场）

字数：
- 抖音 12-18 字
- 小红书 18-25 字（带 emoji）
- 视频号 16-24 字
- B站 20-30 字`,
    tags: ['标题', '爆款', '文案', 'title', 'CTR'],
    keywords: ['viral title', 'click-through rate', 'platform-specific copy',
      'douyin xiaohongshu wechat bilibili'],
    prompt_snippets: [
      '数字+反差 / 提问+答案钩子 / 时间+转变 / 身份+反差 / 禁忌+警告',
      '抖音12-18字 / 小红书18-25字带emoji / 视频号16-24字 / B站20-30字',
    ],
    applies_to: ['copywriter', 'social_media_ops', 'growth_ops'],
    source: 'VIDO 出品 · 飞书 wiki 爆款标题工厂',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_vidopremium_drama_dialogue_quality',
    collection: 'drama',
    subcategory: '对白质量',
    title: '高级对白 4 标准（避免 AI 对白"水"的核心法则）',
    summary:
      '好对白 = 1) 双层意思 2) 角色专属语言 3) 推进剧情 4) 制造潜台词。',
    content: `## 标准 1：双层意思（每句话至少 2 层）
平凡："今天天气真好"
高级："今天天气真好" + 上下文是离婚律师楼，→ 暗讽"我们的婚姻完了"

## 标准 2：角色专属词汇
- 医生角色：必带专业术语 + 偶尔的冷幽默
- 程序员：bug / commit / 上线 / 996
- 武侠人物：江湖/恩怨/前辈/晚辈
- 古言宫廷：本宫/臣妾/皇上/请安

## 标准 3：推进剧情
每句对白必须满足以下至少一个：
- 揭示角色信息（性格/背景/关系）
- 透露剧情信息（线索/伏笔/转折）
- 改变角色关系（拉近/疏远/对立）
- 推进物理动作（去做某事）

## 标准 4：制造潜台词
表面 vs 真实意图：
表面："你回来了"
真实："我等了你 3 小时，但我不会说"

表面："这个项目不错"
真实："我不想接但不能直接拒绝你"

潜台词通过：
- 重复（"是吗？是吗？"）
- 转移话题（突然问无关的事）
- 沉默 3 秒（动作描述里写）
- 反向反应（应该哭却笑）

## AI 写对白避坑清单
❌ 全是疑问句（显得做作）
❌ 角色都用相同词汇（没有声音特征）
❌ 解释性对白过多（"她知道你说的是..."）
❌ 完美的语法（真人会说半句、口头禅、停顿）`,
    tags: ['对白', '剧本', 'dialogue', '潜台词'],
    keywords: ['dialogue craft', 'subtext', 'character voice',
      'screenwriting fundamentals'],
    prompt_snippets: [
      '每句对白双层意思 + 角色专属词汇 + 推进剧情 + 制造潜台词',
      '避免全疑问句、避免相同词汇、避免解释性对白、保留半句和口头禅',
    ],
    applies_to: ['screenwriter'],
    source: 'VIDO 出品 · 飞书 wiki 高级对白手册',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_vidopremium_dh_avatar_visual_brief',
    collection: 'digital_human',
    subcategory: '形象设计',
    title: '数字人形象设计 5 维度 brief（避免 AI 千篇一律）',
    summary:
      '5 维度 = 信任度场景 / 性别风格 / 年龄段心理 / 职业垂类 / 服装色块。',
    content: `## 维度 1：根据信任度场景选脸型
- 高信任度（金融/医疗/教育）→ 圆润脸型 + 柔和五官 + 温和眉眼
- 高专业度（法律/科技/咨询）→ 棱角脸型 + 利落五官 + 锐利眉眼
- 高亲和力（带货/美妆/育儿）→ 邻家脸型 + 微笑唇形 + 灵动眼神

## 维度 2：性别 + 风格组合
- 女性·知性：黑长直 + 鸭蛋脸 + 一字眉 + 卡其驼色
- 女性·活力：齐耳短发 + 圆脸 + 弯眉 + 鲜亮色
- 女性·御姐：大波浪 + 立体五官 + 丹凤眼 + 黑/白/红
- 男性·儒雅：四六分头 + 长脸 + 淡眉 + 灰蓝调
- 男性·商务：板寸 + 国字脸 + 浓眉 + 深蓝/灰色西装
- 男性·活力：碎发 + 苹果脸 + 浓黑眉 + 街头牌子

## 维度 3：年龄段心理
- 20-25：用户希望"我也能成为她"（励志感）
- 26-32：用户希望"她和我一样优秀"（同伴感）
- 33-40：用户希望"她比我懂"（导师感）
- 40+：用户希望"她值得信任"（专家感）

## 维度 4：职业垂类色板
- 教育：蓝/白/灰 + 一抹活力黄
- 医疗：白/天蓝/淡绿 + 干净背景
- 金融：藏青/酒红/金 + 深色背景
- 美妆：粉/裸/玫瑰金 + 浅色背景
- 母婴：奶白/燕麦/浅木 + 自然光
- 科技：黑/银/电子蓝 + 冷光

## 维度 5：服装色块比例
- 主色块（70%）：冷色或中性色降低焦虑
- 辅色块（25%）：相邻色或互补色营造层次
- 跳色（5%）：耳环/手表/纽扣等小面积亮色
- 严禁全身一种颜色或纯黑全身（视觉单调）`,
    tags: ['数字人', '形象设计', 'avatar', 'visual brief'],
    keywords: ['digital human persona', 'avatar design', 'face shape psychology',
      'color palette by industry', 'character vertical'],
    prompt_snippets: [
      '高信任金融医疗教育用圆润脸 / 高专业法律科技用棱角脸 / 高亲和带货美妆用邻家脸',
      '主色块 70% + 辅色块 25% + 跳色 5%',
    ],
    applies_to: ['digital_human', 'character_consistency', 'art_director'],
    source: 'VIDO 出品 · 飞书 wiki 数字人形象设计手册',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_vidopremium_localizer_culture_minefield',
    collection: 'production',
    subcategory: '本地化',
    title: '海外本地化文化雷区清单（美/英/日/韩/印尼/泰/越/菲）',
    summary:
      '把中文剧情搬到海外不能直译，必须做"题材转译 + 场景替换 + 人物简化"。',
    content: `## 美/英市场（北美 + 西欧）
✅ 搬：复仇/逆袭、单亲妈妈、职场霸凌、阶级跃迁
❌ 不搬：宫斗（无文化背景）、农村婆媳（不共鸣）、武侠（小众）
🚫 雷区：种族议题不要随意提，性别议题用积极视角，避免基督教文化敏感

## 日本市场
✅ 搬：校园青春、办公室人际、轻百合、慢生活、职场新人
❌ 不搬：手撕渣男（节奏太快不符合日式细腻）
🚫 雷区：避免"中国元素强行嫁接"，原作日本化要彻底

## 韩国市场
✅ 搬：财阀少爷、灰姑娘、医院/律所剧、复仇剧（韩剧国民题材）
❌ 不搬：太草根（韩剧观众偏好精致质感）
🚫 雷区：兵役议题敏感、不要美化朝鲜、注意年龄阶级敬语

## 印尼/泰/越/菲（东南亚）
✅ 搬：家族/宗教/婚姻、灰姑娘、商战
❌ 不搬：包含猪肉/酒精消费（穆斯林市场）
🚫 雷区：印尼避免穆斯林禁忌，泰国注意泰皇室神圣，越南注意中越历史

## 通用本地化技法
1. 称呼简化：去掉"哥/姐/总监/经理"等中式职称，用名字
2. 食物替换：饺子 → pasta / sushi / kimchi
3. 节日替换：春节 → Christmas / Eid / Songkran
4. 钱币改写：100 万 → $100K / ¥10M / ₩100M
5. 地标替换：上海外滩 → Manhattan skyline / Tokyo skyline
6. 工作场景：BAT → Google/Apple/Samsung 等当地巨头
7. 学校：清华北大 → Harvard / Tokyo U / Seoul U`,
    tags: ['本地化', '海外', 'localization', '文化'],
    keywords: ['localization', 'cultural minefield', 'overseas adaptation',
      'global drama'],
    prompt_snippets: [
      '美/英可搬复仇逆袭 + 不搬宫斗 + 避种族议题',
      '日本可搬校园办公室 + 节奏要慢 + 中国元素彻底日本化',
      '韩国可搬财阀医院律所 + 注意敬语 + 避兵役议题',
      '东南亚避猪肉酒精 + 注意宗教 + 注意皇室历史',
    ],
    applies_to: ['localizer', 'screenwriter', 'market_research'],
    source: 'VIDO 出品 · 飞书 wiki 海外本地化手册',
    lang: 'zh',
    enabled: true,
  },
];
