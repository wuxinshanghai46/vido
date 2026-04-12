/**
 * 网剧生成服务
 * 流程：编剧Agent → 导演Agent(分镜) → 运镜Agent(镜头语言) → 提示词组装 → 视频生成 → 合成
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './outputs');
const DRAMA_DIR = path.join(OUTPUT_DIR, 'dramas');

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }

// ═══════════════════════════════════════════════════
// 运镜提示词库（22种镜头语言）
// ═══════════════════════════════════════════════════
const CAMERA_MOTIONS = [
  // 距离变化
  { id: 'dolly_in', name: '推进', icon: '↗', category: '距离', prompt_en: 'slow dolly push forward', prompt_cn: '缓慢推进镜头' },
  { id: 'dolly_out', name: '后拉', icon: '↙', category: '距离', prompt_en: 'slow dolly pull back, gradually revealing the scene', prompt_cn: '缓慢后拉镜头，逐渐展现全景' },
  { id: 'zoom_in', name: '变焦推', icon: '🔍', category: '距离', prompt_en: 'smooth zoom in, focusing on the subject', prompt_cn: '平滑变焦推进，聚焦主体' },
  { id: 'zoom_out', name: '变焦拉', icon: '🔎', category: '距离', prompt_en: 'smooth zoom out, revealing the wider scene', prompt_cn: '平滑变焦拉远，展现广阔场景' },
  // 方向控制
  { id: 'pan_left', name: '左摇', icon: '←', category: '方向', prompt_en: 'slow horizontal pan from right to left', prompt_cn: '从右向左缓慢水平摇镜' },
  { id: 'pan_right', name: '右摇', icon: '→', category: '方向', prompt_en: 'slow horizontal pan from left to right', prompt_cn: '从左向右缓慢水平摇镜' },
  { id: 'tilt_up', name: '上仰', icon: '↑', category: '方向', prompt_en: 'slow vertical tilt upward, revealing the sky', prompt_cn: '缓慢向上仰拍，展现天空' },
  { id: 'tilt_down', name: '下俯', icon: '↓', category: '方向', prompt_en: 'slow vertical tilt downward', prompt_cn: '缓慢向下俯拍' },
  // 空间位移
  { id: 'orbit', name: '环绕', icon: '⟳', category: '空间', prompt_en: 'smooth 180-degree orbit around the subject', prompt_cn: '围绕主体平滑环绕180度' },
  { id: 'crane_up', name: '升镜', icon: '⬆', category: '空间', prompt_en: 'dramatic crane shot rising upward', prompt_cn: '戏剧性升镜头，向上升起' },
  { id: 'crane_down', name: '降镜', icon: '⬇', category: '空间', prompt_en: 'crane shot descending smoothly', prompt_cn: '平滑降落镜头' },
  { id: 'tracking', name: '跟踪', icon: '🏃', category: '空间', prompt_en: 'tracking shot following the character movement', prompt_cn: '跟踪拍摄，跟随角色移动' },
  { id: 'fly_through', name: '穿越', icon: '✈', category: '空间', prompt_en: 'fly-through shot moving through the environment', prompt_cn: '穿越镜头，穿过环境空间' },
  // 特殊技法
  { id: 'pov', name: 'POV', icon: '👁', category: '特殊', prompt_en: 'first-person POV shot from character perspective', prompt_cn: '第一人称视角镜头' },
  { id: 'dutch', name: '荷兰角', icon: '📐', category: '特殊', prompt_en: 'dutch angle tilted camera creating tension', prompt_cn: '倾斜荷兰角镜头，制造紧张感' },
  { id: 'whip_pan', name: '甩镜', icon: '💨', category: '特殊', prompt_en: 'fast whip pan with motion blur', prompt_cn: '快速甩镜，带运动模糊' },
  { id: 'rack_focus', name: '焦点转移', icon: '🎯', category: '特殊', prompt_en: 'rack focus shifting from foreground to background', prompt_cn: '焦点从前景转移到背景' },
  { id: 'handheld', name: '手持', icon: '🤳', category: '特殊', prompt_en: 'handheld camera with slight natural shake', prompt_cn: '手持摄影，轻微自然抖动' },
  { id: 'steadicam', name: '稳定跟', icon: '🎥', category: '特殊', prompt_en: 'smooth steadicam following shot', prompt_cn: '平稳跟随拍摄' },
  // 静态
  { id: 'static', name: '静止', icon: '⏸', category: '静态', prompt_en: 'static camera, locked-off shot', prompt_cn: '静止固定镜头' },
  { id: 'slow_push', name: '微推', icon: '🔹', category: '静态', prompt_en: 'very subtle slow push in, almost imperceptible', prompt_cn: '极缓慢微推，几乎不可察觉' },
  { id: 'parallax', name: '视差', icon: '🔷', category: '静态', prompt_en: 'parallax effect with layered depth movement', prompt_cn: '视差效果，层次纵深运动' },
];

// 景别/构图库
const SHOT_SCALES = [
  { id: 'extreme_wide', name: '大远景', prompt_en: 'extreme wide shot, vast landscape' },
  { id: 'wide', name: '远景', prompt_en: 'wide establishing shot' },
  { id: 'full', name: '全景', prompt_en: 'full shot showing entire body' },
  { id: 'medium', name: '中景', prompt_en: 'medium shot from waist up' },
  { id: 'medium_close', name: '近景', prompt_en: 'medium close-up from chest up' },
  { id: 'close', name: '特写', prompt_en: 'close-up shot on face' },
  { id: 'extreme_close', name: '大特写', prompt_en: 'extreme close-up on eyes or detail' },
  { id: 'low_angle', name: '仰角', prompt_en: 'low angle shot looking upward' },
  { id: 'high_angle', name: '俯角', prompt_en: 'high angle shot looking downward' },
  { id: 'bird_eye', name: '鸟瞰', prompt_en: 'bird\'s eye view, top-down aerial shot' },
  { id: 'over_shoulder', name: '过肩', prompt_en: 'over-the-shoulder shot' },
];

// 运镜预设模板
const MOTION_PRESETS = {
  cinematic: { name: '电影感', desc: '推拉+环绕+特写交替', pattern: ['dolly_in', 'pan_right', 'close', 'orbit', 'crane_up', 'dolly_out'] },
  documentary: { name: '纪录片', desc: '稳定跟踪+缓慢推进', pattern: ['steadicam', 'slow_push', 'tracking', 'pan_right', 'static', 'dolly_in'] },
  action: { name: '动作片', desc: '快速切换+荷兰角+手持', pattern: ['whip_pan', 'handheld', 'dutch', 'tracking', 'zoom_in', 'crane_up'] },
  mv: { name: 'MV风格', desc: '升降+环绕+慢动作', pattern: ['crane_up', 'orbit', 'slow_push', 'crane_down', 'parallax', 'fly_through'] },
  romance: { name: '浪漫', desc: '柔和推进+环绕+焦点转移', pattern: ['slow_push', 'rack_focus', 'orbit', 'dolly_in', 'parallax', 'crane_up'] },
};

// ═══════════════════════════════════════════════════
// Agent 1：编剧 — 生成网剧剧情脚本
// ═══════════════════════════════════════════════════
async function agentDramaScreenwriter({ theme, style, sceneCount = 6, characters = [], episodeIndex = 1, episodeCount = 1, previousSummary = '', genre = '' }) {
  const { callLLM } = require('./storyService');
  const kb = require('./knowledgeBaseService');

  // 注入知识库上下文：编剧 + 市场调研 + 文案策划（更全面的创作视角）
  const ctxScreenwriter = kb.buildAgentContext('screenwriter', { genre: genre || theme, maxDocs: 3 });
  const ctxMarket = kb.buildAgentContext('market_research', { genre: genre || theme, maxDocs: 2 });
  const ctxCopy = kb.buildAgentContext('copywriter', { genre: genre || theme, maxDocs: 1 });
  const kbContext = [ctxScreenwriter, ctxMarket, ctxCopy].filter(Boolean).join('\n\n');

  const charDesc = characters.length
    ? `\n角色列表：\n${characters.map(c => `- ${c.name}：${c.appearance_prompt || c.description || '无描述'}`).join('\n')}`
    : '';

  const episodeContext = episodeCount > 1
    ? `\n这是一部共${episodeCount}集的网剧，当前是第${episodeIndex}集。${previousSummary ? `\n前集摘要：${previousSummary}\n请确保故事与前集衔接，角色行为和情节发展保持连贯。` : '这是第一集，需要建立世界观和角色。'}` : '';

  const systemPrompt = `你是一位世界级AI漫剧/网剧编剧，你的创作水平对标字节Seedance 2.0的多镜头叙事能力、OpenAI Sora 2的电影级叙事结构、Google Veo 3的视听协同思维。

【核心创作法则】
1. 黄金三秒：第一个场景必须在3秒内制造视觉冲击或悬念钩子
2. 五段式情绪曲线：钩子(hook)→铺垫(setup)→升温(rising)→爆发(climax)→余韵(resolution)
3. 每个场景都是一个"镜头"：有明确的开始动作和结束动作，便于AI视频模型理解
4. 场景间要有叙事逻辑链：因果关系 > 时间顺序 > 空间转换

【Seedance 2.0 多镜头叙事思维】
- 将故事拆解为${sceneCount}个连续镜头，每个镜头是一个完整的视觉单元
- 每个镜头只做一件事：一个主体动作 + 一个情绪传达
- 镜头间设计"视觉钩子"：上一镜头的结尾暗示下一镜头的开始
- 支持多角色交互场景，但每个镜头聚焦1-2个主体
- 标注音效和环境声（风声/脚步/心跳/雨声），用于音视频同步生成

【Sora 2 场景描写规范 — 像给摄影师写拍摄备忘录】
每个场景的 description 必须包含：
- 主体(Subject)：谁？穿什么？什么表情？什么姿态？
- 动作(Action)：具体做什么？用1-2个动作节拍描述
- 环境(Context)：在哪里？什么天气？什么季节？
- 氛围(Mood)：什么光线？什么色调？什么情绪？
- 声音(Sound)：环境音 + 音效 + 是否有对话

【Google Veo 3 音画协同思维】
- 每个场景标注 sound_design：环境底噪(ambient) + 关键音效(sfx) + 音乐情绪(music_mood)
- 对话场景标注说话者的情绪和语气（低语/呐喊/颤抖/平静）
- 标注节奏建议：slow(≥5s) / normal(3-5s) / fast(2-3s)

【对话与旁白】
- 对话≤15字，必须推动剧情或揭示性格
- 每个角色有独特说话方式（语气词/口头禅/句式）
- 旁白≤20字，只用于时间跳转/内心独白/氛围渲染
- 对话标注 speaker 和 tone（如：低沉/温柔/颤抖/坚定）

【角色一致性锁定】
- 首次出场时给出角色完整外貌描述（发型/发色/瞳色/服装/体型/配饰）
- 后续场景引用相同描述关键词，确保AI生图的角色一致性
- 多角色场景明确标注每个角色的相对位置${episodeCount > 1 ? '\n\n【多集连续剧结构】\n- 共' + episodeCount + '集，当前第' + episodeIndex + '集\n- 每集结尾必须留"钩子"（悬念/反转/情感未完成感）\n- 集与集之间角色成长有递进\n- 复现上集关键视觉元素，形成系列感' : ''}

严格输出 JSON，不要任何额外文字。${kbContext ? '\n\n' + kbContext : ''}`;

  const userPrompt = `创作网剧分场脚本：
故事：${theme}
画风：${style || '日系动漫'}
场景数：${sceneCount}${charDesc}${episodeContext}

按照 Seedance 2.0 多镜头叙事标准输出 JSON：
{
  "title": "标题",
  "synopsis": "一句话简介（≤30字）",
  "character_profiles": [
    { "name": "角色名", "appearance": "完整外貌关键词（发型/发色/瞳色/服装/体型）", "personality": "性格特征", "voice_tone": "说话语调特征" }
  ],
  "scenes": [
    {
      "index": 1,
      "description": "详细画面描述（主体+动作+环境+氛围+光线+色调），像给摄影师写备忘录",
      "action_beats": "1-2个具体动作节拍（如：缓缓转身→抬起右手触碰花瓣）",
      "dialogue": "对话（可空，≤15字）",
      "speaker": "说话角色（可空）",
      "tone": "说话语气（低语/坚定/颤抖/温柔/愤怒，可空）",
      "narrator": "旁白（可空，≤20字）",
      "sfx": "关键音效（可空，如：咔嚓！/哗——/心跳声）",
      "ambient_sound": "环境底噪（可空，如：风声/雨声/人群嘈杂/寂静）",
      "music_mood": "背景音乐情绪（可空，如：悲伤钢琴/紧张弦乐/轻快吉他）",
      "emotion": "情感基调",
      "pacing": "slow|normal|fast",
      "duration": 5
    }
  ]
}`;

  const raw = await callLLM(systemPrompt, userPrompt);
  return repairJSON(raw);
}

// ═══════════════════════════════════════════════════
// Agent 2：导演 — 分镜设计 + 景别
// ═══════════════════════════════════════════════════
async function agentDramaDirector(screenplay, style, characters = [], genre = '') {
  const { callLLM } = require('./storyService');
  const kb = require('./knowledgeBaseService');

  // 注入知识库：导演 + 艺术总监 + 氛围 + 分镜 + 剪辑 五档上下文
  // 让导演同时拥有艺术总监的视觉锚点思维和剪辑师的节奏思维
  const kbDirector = kb.buildAgentContext('director', { genre, maxDocs: 2 });
  const kbArtDirector = kb.buildAgentContext('art_director', { genre, maxDocs: 2 });
  const kbAtmosphere = kb.buildAgentContext('atmosphere', { genre, maxDocs: 2 });
  const kbStoryboard = kb.buildAgentContext('storyboard', { genre, maxDocs: 2 });
  const kbEditor = kb.buildAgentContext('editor', { genre, maxDocs: 1 });
  const kbContext = [kbDirector, kbArtDirector, kbAtmosphere, kbStoryboard, kbEditor].filter(Boolean).join('\n\n');

  const charVisuals = characters.length
    ? `\n角色视觉参考：\n${characters.map(c => `- ${c.name}：${c.appearance_prompt || c.description || '无描述'}`).join('\n')}`
    : '';

  const systemPrompt = `你是一位世界级AI漫剧导演，你的视觉叙事能力对标字节Seedance 2.0的导演智能、Google Veo 3.1的电影摄影术、OpenAI Sora 2的专业分镜控制。

【Seedance 2.0 多镜头导演思维】
- 每个场景是一个独立"镜头"，有明确的起始画面和结束画面
- 镜头间设计视觉过渡逻辑（动作匹配/视线引导/色调衔接）
- 自动规划镜头语言节奏：紧张段落用短镜头快切，情感段落用长镜头缓推
- 支持多角色交互场景的镜头分配（主视角/反应镜头/全景交代）
- 角色外貌描述在所有镜头中保持绝对一致（锁定关键词）

【Google Veo 3.1 五段式 Prompt 公式 — 必须严格遵守】
visual_prompt 结构：Cinematography + Subject + Action + Context + Style & Ambiance
1. Cinematography（前置）: 镜头类型 + 景深 + 焦段/镜头风格
   示例: "Low-angle tracking shot, shallow depth of field, anamorphic lens"
2. Subject（主体）: 角色完整外貌 + 服装 + 表情 + 姿态
   示例: "young woman with long black hair, blue eyes, wearing white dress, melancholic expression"
3. Action（动作）: 1-2个具体动作节拍
   示例: "slowly reaching out to touch a frozen rose, fingers trembling"
4. Context（环境）: 地点 + 天气 + 季节 + 时间 + 环境细节
   示例: "inside a dimly lit weather station, cold blue monitor light, snow outside window"
5. Style & Ambiance: 光源 + 色调(3-5色) + 画风 + 氛围
   示例: "cool blue and warm amber color palette, side lighting, Japanese anime style, melancholic atmosphere, cinematic, 4K"

【OpenAI Sora 2 镜头控制法则】
- camera instruction 必须前置（放在 prompt 最前面），确保AI先锁定虚拟相机
- 每个镜头只允许一个镜头运动 + 一个主体动作
- 用动作节拍(beats)描述时间节奏，而非抽象描述
- 指定 key light（主光）、fill light（辅光）、accent tones（点缀色）保持多镜头色调一致

【景别 × 情绪矩阵】
| 情绪 | 首选景别 | 次选 | 禁用 |
| 孤独/思念 | 远景+留白 | 特写侧脸 | 全景热闹 |
| 对话/日常 | 中景+过肩 | 近景正反打 | 鸟瞰 |
| 紧张/恐惧 | 仰角+特写 | 荷兰角+手持 | 远景+静止 |
| 浪漫/温馨 | 近景+浅景深 | 环绕+暖光 | 俯角+冷调 |
| 愤怒/冲突 | 仰角+推进 | 手持+快切 | 慢推+柔光 |
| 震撼/史诗 | 鸟瞰/远景 | 升镜+广角 | 特写+静止 |
| 悲伤/告别 | 特写+后拉 | 远景+留白 | 快切+鲜色 |

【运镜 × 叙事功能】
- dolly in(推进): 进入内心 / 揭示细节 / 聚焦重要物件
- dolly out(后拉): 揭示真相 / 角色渺小 / 离别
- orbit(环绕): 仪式感 / 重要时刻 / 浪漫凝视
- crane up(升镜): 希望 / 升华 / 全片结尾
- crane down(降镜): 压抑 / 发现 / 进入新场景
- tracking(跟踪): 追逐 / 紧随 / 行走叙事
- whip pan(甩镜): 时间跳转 / 场景切换 / 突发
- pan(横摇): 环境展示 / 对话过渡 / 视线引导
- tilt up/down(俯仰): 从脚到头揭示角色 / 压迫感
- handheld(手持): 纪录感 / 紧张 / 第一人称
- static(静止): 庄重 / 凝视 / 对峙 / 定格
- rack focus(焦点转移): 注意力转移 / 因果关系
- parallax(视差): 层次 / 梦境 / 回忆

【构图法则】
- 三分法: 主体置于交叉点，留出视线方向空间
- 对角线: 动态场景，从左下到右上的能量方向
- 框中框: 门/窗/镜子框住主体，窥视感/隔阂感
- 前景虚化: bokeh前景增加纵深和电影质感
- 对称: 仪式/对峙/建筑/镜像
- 留白: 孤独/思考/极简美学
- 引导线: 道路/河流/走廊引导视线至主体

【专业光影设计】
- Golden hour(黄金时刻): 温暖/怀旧/浪漫 → warm amber tones
- Blue hour(蓝色时刻): 忧郁/宁静/过渡 → cool blue palette
- Side lighting(侧光): 戏剧性/双面人/内心冲突 → sharp shadow
- Backlight(逆光): 轮廓/神秘/仙气 → silhouette with rim light
- Top light(顶光): 审判/压迫/舞台 → harsh downward shadow
- Practical lights(实景光): 烛光/霓虹/屏幕光 → motivated lighting
- Overcast diffused(阴天散射): 柔和/日常/平静 → soft even light

保留编剧原文不做任何修改。严格输出 JSON。${kbContext ? '\n\n' + kbContext : ''}`;

  const userPrompt = `作为导演，为以下网剧脚本的每个场景添加专业视觉指令：

${JSON.stringify(screenplay, null, 2)}

画风：${style || '日系动漫'}${charVisuals}

严格要求：
1. visual_prompt 必须遵循 Veo 3.1 五段式公式：Cinematography + Subject + Action + Context + Style
2. Camera instruction 前置（Sora 2 法则）
3. 根据情绪矩阵选择最佳景别
4. 角色外貌描述在所有镜头中保持一致（锁定关键词）
5. 标注光影设计方案

输出完整 JSON，每个 scene 新增字段：
{
  "shot_scale": "景别名称（远景/全景/中景/近景/特写/大特写/仰角/俯角/鸟瞰/过肩）",
  "suggested_motion": "运镜手法名称（推进/后拉/横摇/环绕/升镜/降镜/跟踪/甩镜/手持/静止等）",
  "composition": "构图方案（法则名+理由）",
  "lighting": "光影设计（光源方向+色温+氛围）",
  "visual_prompt": "详细英文视觉描述（≤80词，Veo 3.1 五段式）",
  "visual_prompt_cn": "精确的中文视觉描述（与英文一一对应，同样详细精确，包含：镜头景别+运镜+主体外貌姿态表情+动作+环境+光影+色调+风格）"
}

重要：
- 编剧的 dialogue/narrator/sfx/emotion/pacing 必须保留不动
- 如果编剧没写 dialogue，你可以根据场景补充合适的对话
- 每个场景的 emotion 必须填写
- visual_prompt_cn 必须和 visual_prompt 同等精确，不是简单翻译，而是用中文专业术语精确描述画面`;

  const raw = await callLLM(systemPrompt, userPrompt);
  return repairJSON(raw);
}

// ═══════════════════════════════════════════════════
// Agent 3：运镜 — 自动标注镜头语言提示词
// ═══════════════════════════════════════════════════
function applyMotionPrompts(script, motionPreset = 'cinematic') {
  const preset = MOTION_PRESETS[motionPreset] || MOTION_PRESETS.cinematic;
  const scenes = script.scenes || [];

  scenes.forEach((scene, i) => {
    // 从预设模板循环分配运镜
    const motionId = preset.pattern[i % preset.pattern.length];
    const motion = CAMERA_MOTIONS.find(m => m.id === motionId) || CAMERA_MOTIONS[0];

    // 如果导演已建议运镜，尝试匹配
    if (scene.suggested_motion) {
      const suggested = CAMERA_MOTIONS.find(m =>
        scene.suggested_motion.includes(m.name) || scene.suggested_motion.toLowerCase().includes(m.id.replace('_', ' '))
      );
      if (suggested) {
        scene.motion_id = suggested.id;
        scene.motion_name = suggested.name;
        scene.motion_icon = suggested.icon;
        scene.motion_prompt = suggested.prompt_en;
        return;
      }
    }

    scene.motion_id = motion.id;
    scene.motion_name = motion.name;
    scene.motion_icon = motion.icon;
    scene.motion_prompt = motion.prompt_en;
  });

  return script;
}

// ═══════════════════════════════════════════════════
// 提示词组装：主体 + 场景 + 运镜 + 构图 + 风格
// ═══════════════════════════════════════════════════
function assemblePrompts(script, style = '日系动漫') {
  const db = require('../models/database');
  // 从风格库查询
  let styleSuffix = '';
  const allStyles = db.listAIStyles();
  const matched = allStyles.find(s => s.name === style);
  if (matched) {
    styleSuffix = matched.prompt_en;
  } else {
    const fallback = {
      '日系动漫': 'Japanese anime style, clean linework, dramatic shading, anime aesthetic',
      '韩国漫画': 'Korean manhwa webtoon style, clean digital art, soft gradients',
      '水墨漫画': 'Chinese ink wash manga style, brush stroke art',
      '赛博朋克': 'cyberpunk style, neon lights, dark atmosphere, high contrast',
      '国风仙侠': 'Chinese xianxia fantasy style, flowing robes, ethereal atmosphere',
      '迪士尼卡通': 'Disney cartoon style, vibrant colors, 3D render aesthetic',
      '油画写实': 'oil painting style, realistic proportions, dramatic chiaroscuro lighting',
      '治愈系': 'healing iyashikei style, soft pastel colors, warm lighting, watercolor texture',
    };
    styleSuffix = fallback[style] || fallback['日系动漫'];
  }

  const scenes = script.scenes || [];
  scenes.forEach(scene => {
    const shotScale = SHOT_SCALES.find(s => s.name === scene.shot_scale);
    const shotPrompt = shotScale ? shotScale.prompt_en : 'medium shot';

    // ═══ 英文提示词（精确版，用于AI生图/视频） ═══
    const enParts = [];
    // 角色锁定 prompt 必须放在最前面 (Sora 2 法则: identity tokens 前置)
    if (scene._char_lock_en) enParts.push(scene._char_lock_en);
    if (scene.visual_prompt) enParts.push(scene.visual_prompt);
    enParts.push(shotPrompt);
    if (scene.motion_prompt) enParts.push(scene.motion_prompt);
    enParts.push(styleSuffix);
    enParts.push('consistent character design, same face same outfit as reference, cinematic lighting, high quality, 4K');
    scene.full_prompt_en = enParts.join(', ');
    // 把 negative lock 也保存下来,供生图时用
    if (scene._char_negative) scene.negative_prompt_en = scene._char_negative;

    // ═══ 中文提示词 ═══
    // 优先使用导演Agent输出的精确中文描述，回退到结构化拼接
    if (scene.visual_prompt_cn) {
      // 导演已输出精确中文，追加运镜和风格信息
      const motionObj = CAMERA_MOTIONS.find(m => m.id === scene.motion_id);
      const motionCn = motionObj ? motionObj.prompt_cn : (scene.motion_name || '');
      const lockCnPrefix = scene._char_lock_cn ? scene._char_lock_cn + '。' : '';
      scene.full_prompt_cn = lockCnPrefix + scene.visual_prompt_cn + (motionCn ? `，${motionCn}` : '') + `，${style}风格，人物外观保持一致，电影级画质，4K高清`;
    } else {
      // 回退：从英文版结构化翻译
      const motionObj = CAMERA_MOTIONS.find(m => m.id === scene.motion_id);
      const motionCn = motionObj ? motionObj.prompt_cn : (scene.motion_name || '');
      const lockCnPrefix = scene._char_lock_cn ? scene._char_lock_cn + '。' : '';
      scene.full_prompt_cn = lockCnPrefix + `${scene.shot_scale || '中景'}，${motionCn ? motionCn + '，' : ''}${scene.description || ''}${scene.composition ? '，构图：' + scene.composition : ''}${scene.lighting ? '，光影：' + scene.lighting : ''}，${style}风格，人物外观保持一致，电影级画质，4K高清`;
    }
  });

  return script;
}

// ═══════════════════════════════════════════════════
// Agent 3.5: 角色一致性 (Character Consistency Lock)
// 学习即梦/Seedance 2.0/Veo 3 的角色一致性技术:
// 1) 为每个角色生成"视觉锁定表" (Character Bible) - 严格的可视化关键词
// 2) 把锁定表注入到每个 scene prompt 的开头
// 3) 配合 reference image 双重锁定 (锁定 face + wardrobe + distinguishing tokens)
// ═══════════════════════════════════════════════════
async function agentCharacterConsistency({ screenplay, characters = [], genre = '' }) {
  const { callLLM } = require('./storyService');
  const db = require('../models/database');
  const kb = require('./knowledgeBaseService');

  // 注入知识库：人物一致性 + 艺术总监（让角色锁定与艺术风格一致）
  const ctxCC = kb.buildAgentContext('character_consistency', { genre, maxDocs: 2 });
  const ctxAD = kb.buildAgentContext('art_director', { genre, maxDocs: 2 });
  const kbContext = [ctxCC, ctxAD].filter(Boolean).join('\n\n');

  // 收集角色信息: 优先用编剧 Agent 生成的 character_profiles, 回退到传入的 characters
  const charProfiles = screenplay?.character_profiles || [];
  const allChars = [];
  // 合并 character_profiles 和外部 characters (角色库)
  for (const cp of charProfiles) {
    const extChar = characters.find(c => c.name === cp.name);
    allChars.push({
      name: cp.name,
      appearance: cp.appearance || extChar?.appearance_prompt || extChar?.appearance || '',
      personality: cp.personality || extChar?.personality || '',
      voice_tone: cp.voice_tone || '',
      // 从角色库带上三视图(用作 reference image)
      ext_id: extChar?.id || null,
      three_view: extChar?.three_view || null,
      ref_images: extChar?.ref_images || [],
    });
  }
  // 也加上 character_profiles 没列但 characters 有的(防漏)
  for (const c of characters) {
    if (!allChars.find(x => x.name === c.name)) {
      allChars.push({
        name: c.name,
        appearance: c.appearance_prompt || c.appearance || '',
        personality: c.personality || '',
        voice_tone: '',
        ext_id: c.id || null,
        three_view: c.three_view || null,
        ref_images: c.ref_images || [],
      });
    }
  }

  if (allChars.length === 0) {
    return { characters: [], global_consistency_rules: [] };
  }

  // 调 LLM 生成视觉锁定表
  const systemPrompt = `你是顶级的 AI 漫剧角色设定师, 专精**人物一致性锁定**。你的能力对标:
- 字节即梦 (JiMeng): subject_reference 模式, 锁面部+服装跨镜头
- 字节 Seedance 2.0: character token + wardrobe token 双锁
- Google Veo 3: subject anchor + style anchor 跨镜头一致性
- OpenAI Sora 2: identity tokens 严格 lock

【任务】
为每个角色生成一份"视觉锁定表" (Character Bible), 让 AI 图像/视频模型在不同分镜中生成同一个角色时**外观完全一致**。

【核心原则】
1. **每个特征都用具体可视化的关键词**, 禁止抽象描述
   - ✗ 不写 "dark hair" → ✓ 写 "raven-black mid-back length hair, side bangs"
   - ✗ 不写 "tall" → ✓ 写 "175cm tall, slender athletic build"
   - ✗ 不写 "casual outfit" → ✓ 写 "white cotton T-shirt, dark blue denim jeans, brown leather belt"
2. **颜色必须是具体词** (raven-black / chestnut brown / icy blue / sage green / cream white)
3. **服装锁定 3 个层次**: 主色调 + 款式 + 关键配饰
4. **标志特征 (distinguishing marks) 是最强的识别符**: 疤痕/纹身/胎记/眼镜/帽子/项链/特殊发饰
5. **id_token** 是 1-3 个英文词的短标识, 在每个 prompt 里复用 (类似 "the same Asian young woman with raven-black hair")

【输出严格 JSON】(不要任何额外文字, 不要 markdown 代码块):
{
  "characters": [
    {
      "name": "角色名(中文)",
      "id_token_en": "the same [adjective] [age] [gender]",
      "id_token_cn": "同一个 [形容词] [年龄] [性别]",
      "lock_face": "面部锁定: 脸型/肤色/瞳色/发型/发色 (英文, 6-10 个具体特征, 30-50 词)",
      "lock_body": "身体锁定: 身高/体型/年龄感 (英文, 3-5 个特征)",
      "lock_wardrobe": "服装锁定: 主色 + 款式 + 配饰 (英文, 5-8 个具体词)",
      "lock_distinguishing": "标志特征 (英文, 1-3 个最显著的, 例如 'small star-shaped scar above left eyebrow, silver wing-shaped earring')",
      "lock_expression_default": "默认气质 (英文, 1-2 词, 例如 'serene and composed' / 'mischievous smirk')",
      "full_lock_prompt_en": "把以上全部融合成一句完整英文锁定 prompt (60-100 词, 用逗号分隔, 以 id_token_en 开头)",
      "full_lock_prompt_cn": "中文版本 (与英文一一对应)",
      "negative_lock": "禁止特征英文 (例如 'different hair color, different outfit, blonde hair, glasses')"
    }
  ],
  "global_rules": {
    "lighting_anchor": "全剧光线锚点 (例如 'soft diffused warm sunlight, cinematic golden hour')",
    "color_palette": "5 个主色 (例如 'cream white, sage green, dusty rose, charcoal grey, warm amber')",
    "style_anchor": "整体画风锚点 (例如 'Studio Ghibli style, hand-painted watercolor texture')"
  }
}${kbContext ? '\n\n' + kbContext : ''}`;

  const userPrompt = `请为以下网剧角色生成视觉锁定表:

${allChars.map((c, i) => `角色 ${i + 1}:
- 名字: ${c.name}
- 现有外貌描述: ${c.appearance || '无'}
- 性格: ${c.personality || '无'}
${c.three_view ? '- 已有角色库三视图,需要根据描述生成更精确的锁定表' : ''}`).join('\n\n')}

剧情背景: ${screenplay?.synopsis || screenplay?.title || '无'}

请输出严格 JSON 锁定表。`;

  let raw, parsed;
  try {
    raw = await callLLM(systemPrompt, userPrompt);
    parsed = repairJSON(raw);
  } catch (err) {
    console.error('[CharConsistency] LLM 失败:', err.message);
    // 回退: 用现有信息构造一个基础锁定表
    parsed = {
      characters: allChars.map(c => ({
        name: c.name,
        id_token_en: `the same character ${c.name}`,
        id_token_cn: `同一个角色 ${c.name}`,
        lock_face: c.appearance || c.name,
        lock_body: '',
        lock_wardrobe: '',
        lock_distinguishing: '',
        lock_expression_default: '',
        full_lock_prompt_en: c.appearance || c.name,
        full_lock_prompt_cn: c.appearance || c.name,
        negative_lock: 'different character, different appearance',
      })),
      global_rules: {},
    };
  }

  // 把角色库带的 three_view + ref_images 合并进结果(后续生图作为 reference image 用)
  for (const lockChar of parsed.characters || []) {
    const src = allChars.find(c => c.name === lockChar.name);
    if (src) {
      lockChar.ext_id = src.ext_id;
      lockChar.three_view = src.three_view;
      lockChar.ref_images = src.ref_images;
    }
  }

  return parsed;
}

// 把角色 bible 注入到每个 scene 的 prompt 中
function injectCharacterLocks(scenes, characterBible) {
  const lockChars = characterBible?.characters || [];
  if (!lockChars.length) return scenes;

  const globalRules = characterBible?.global_rules || {};
  const styleAnchor = globalRules.style_anchor || '';
  const lightingAnchor = globalRules.lighting_anchor || '';

  scenes.forEach(scene => {
    // 探测当前场景出现了哪些已锁定的角色
    const sceneText = `${scene.description || ''} ${scene.dialogue || ''} ${scene.speaker || ''} ${scene.visual_prompt || ''} ${scene.visual_prompt_cn || ''}`;
    const presentChars = lockChars.filter(lc => sceneText.includes(lc.name));

    if (presentChars.length === 0) {
      // 没有锁定角色出现, 直接加全局规则
      if (styleAnchor) scene._char_lock_en = styleAnchor;
      return;
    }

    // 拼接出现角色的锁定 prompt
    const lockEn = presentChars.map(c => c.full_lock_prompt_en).filter(Boolean).join('. ');
    const lockCn = presentChars.map(c => c.full_lock_prompt_cn).filter(Boolean).join('。 ');
    const negative = presentChars.map(c => c.negative_lock).filter(Boolean).join(', ');
    // 收集出现角色的 reference image (用三视图 front 优先)
    const refImages = [];
    presentChars.forEach(c => {
      if (c.three_view?.front) refImages.push(c.three_view.front);
      else if (c.ref_images?.[0]) refImages.push(c.ref_images[0]);
    });

    scene._char_lock_en = `${lockEn}${styleAnchor ? '. ' + styleAnchor : ''}`;
    scene._char_lock_cn = lockCn;
    scene._char_negative = negative;
    scene._char_ref_images = refImages;
    scene._present_chars = presentChars.map(c => c.name);
  });

  return scenes;
}

// ═══════════════════════════════════════════════════
// Agent 4: 配音 — 给每个有 dialogue 的场景生成 TTS 音频
// ═══════════════════════════════════════════════════
async function agentDramaVoice(scenes, taskDir) {
  const { generateSpeech } = require('./ttsService');
  let generated = 0;
  // 角色名 → 性别映射(用于选择 TTS 音色)
  const speakerGenders = {};
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const text = (scene.dialogue || '').trim() || (scene.narrator || '').trim();
    if (!text) continue;
    // 简单按说话者名字推测性别(默认 female)
    const speaker = scene.speaker || '';
    let gender = speakerGenders[speaker] || 'female';
    if (!speakerGenders[speaker]) {
      // 如果之前 director 标了 tone 含 "男" 或常见男性词, 用 male
      const maleHints = /男|父|爹|伯|叔|哥|爷|king|man/i;
      if (maleHints.test(speaker) || maleHints.test(scene.tone || '')) gender = 'male';
      speakerGenders[speaker] = gender;
    }
    try {
      const outputPath = path.join(taskDir, `voice_${i}.mp3`);
      // 旁白用慢速, 对话用正常
      const speed = scene.narrator && !scene.dialogue ? 0.95 : 1.0;
      await generateSpeech(text, outputPath, { gender, speed });
      if (fs.existsSync(outputPath)) {
        scene.voice_url = `/api/drama/tasks/${path.basename(taskDir)}/voice/${i}`;
        scene.voice_text = text;
        scene.voice_speaker = speaker;
        generated++;
      }
    } catch (e) {
      console.warn(`[Drama voice] scene ${i} failed:`, e.message);
      scene.voice_error = e.message;
    }
  }
  return generated;
}

// ═══════════════════════════════════════════════════
// 全流程：生成网剧
// ═══════════════════════════════════════════════════
async function generateDrama(taskId, params, progressCallback) {
  const { theme, style = '日系动漫', sceneCount = 6, durationPerScene = 5, characters = [], motionPreset = 'cinematic', styleId = null, character_ids = [], episodeIndex = 1, episodeCount = 1, previousSummary = '', image_model = '', video_model = '', aspect_ratio = '9:16', enable_voice = true, genre = '' } = params;
  const db = require('../models/database');
  const taskDir = path.join(DRAMA_DIR, taskId);
  ensureDir(taskDir);

  const progress = (step, pct, msg) => {
    if (progressCallback) progressCallback({ step, progress: pct, message: msg });
  };

  // Enrichment
  let resolvedStyle = style;
  if (styleId) {
    const sr = db.getAIStyle(styleId);
    if (sr) resolvedStyle = sr.name;
  }
  const enrichedChars = [...characters];
  if (character_ids?.length) {
    for (const cid of character_ids) {
      const c = db.getAIChar(cid);
      if (c && !enrichedChars.find(x => x.id === cid)) {
        enrichedChars.push({ id: cid, name: c.name, description: c.appearance_prompt || c.appearance, appearance_prompt: c.appearance_prompt });
      }
    }
  }

  // Step 1: 编剧
  progress('screenwriter', 5, '✍️ 编剧Agent：正在构思网剧剧情...');
  let screenplay;
  try {
    screenplay = await agentDramaScreenwriter({ theme, style: resolvedStyle, sceneCount, characters: enrichedChars, episodeIndex, episodeCount, previousSummary, genre });
  } catch (err) { throw new Error('编剧Agent失败: ' + err.message); }
  fs.writeFileSync(path.join(taskDir, 'screenplay.json'), JSON.stringify(screenplay, null, 2), 'utf8');
  progress('screenwriter', 20, `✍️ 编剧完成：「${screenplay.title || ''}」${screenplay.scenes?.length || 0}个场景`);

  // Step 2: 导演
  progress('director', 22, '🎬 导演Agent：正在设计分镜与镜头...');
  let directed;
  try {
    directed = await agentDramaDirector(screenplay, resolvedStyle, enrichedChars, genre);
  } catch (err) { throw new Error('导演Agent失败: ' + err.message); }
  fs.writeFileSync(path.join(taskDir, 'directed.json'), JSON.stringify(directed, null, 2), 'utf8');
  progress('director', 35, `🎬 导演完成：分镜设计就绪`);

  // Step 2.5: 角色一致性 (Character Consistency Lock)
  progress('consistency', 37, '🎭 人物一致性：生成 Character Bible 锁定外观...');
  let characterBible = { characters: [], global_rules: {} };
  try {
    characterBible = await agentCharacterConsistency({ screenplay: directed, characters: enrichedChars, genre });
    fs.writeFileSync(path.join(taskDir, 'character_bible.json'), JSON.stringify(characterBible, null, 2), 'utf8');
    progress('consistency', 42, `🎭 已锁定 ${characterBible.characters?.length || 0} 个角色外观`);
  } catch (err) {
    console.error('[CharConsistency] failed:', err.message);
    progress('consistency', 42, `⚠️ 人物一致性 fallback: ${err.message}`);
  }
  // 把角色锁注入每个场景
  injectCharacterLocks(directed.scenes || [], characterBible);

  // Step 3: 运镜标注
  progress('motion', 44, '🎥 运镜标注：匹配镜头语言...');
  const withMotion = applyMotionPrompts(directed, motionPreset);
  progress('motion', 50, `🎥 运镜完成：已标注${withMotion.scenes?.length || 0}个镜头`);

  // Step 4: 提示词组装
  progress('prompt', 52, '📝 提示词组装：生成完整 Prompt...');
  const final = assemblePrompts(withMotion, resolvedStyle);
  fs.writeFileSync(path.join(taskDir, 'script.json'), JSON.stringify(final, null, 2), 'utf8');
  progress('prompt', 60, '📝 提示词就绪：所有分镜 Prompt 已生成');

  // 返回结果（视频生成是可选的后续步骤）
  const result = {
    title: final.title || screenplay.title,
    synopsis: final.synopsis || screenplay.synopsis,
    style: resolvedStyle,
    motion_preset: motionPreset,
    scenes: (final.scenes || []).map((s, i) => ({
      index: s.index || i + 1,
      description: s.description,
      dialogue: s.dialogue || '',
      speaker: s.speaker || '',
      narrator: s.narrator || '',
      sfx: s.sfx || '',
      emotion: s.emotion || '',
      pacing: s.pacing || 'normal',
      duration: s.duration || durationPerScene,
      shot_scale: s.shot_scale || '中景',
      motion_id: s.motion_id || '',
      motion_name: s.motion_name || '',
      motion_icon: s.motion_icon || '',
      motion_prompt: s.motion_prompt || '',
      tone: s.tone || '',
      action_beats: s.action_beats || '',
      ambient_sound: s.ambient_sound || '',
      music_mood: s.music_mood || '',
      lighting: s.lighting || '',
      composition: s.composition || '',
      visual_prompt: s.visual_prompt || '',
      visual_prompt_cn: s.visual_prompt_cn || '',
      full_prompt_en: s.full_prompt_en || '',
      full_prompt_cn: s.full_prompt_cn || '',
      negative_prompt_en: s.negative_prompt_en || '',
      char_ref_images: s._char_ref_images || [],
      present_chars: s._present_chars || [],
      char_lock_cn: s._char_lock_cn || '',
      video_url: null,
      image_url: null,
    })),
    character_bible: characterBible,
    total_duration: (final.scenes || []).reduce((sum, s) => sum + (s.duration || durationPerScene), 0),
  };

  // Step 5: 自动生成所有分镜图
  progress('imagegen', 62, '🖼️ 分镜图生成：正在生成场景图片...');
  const { generateDramaImage } = require('./imageService');
  const totalScenes = result.scenes.length;

  for (let i = 0; i < totalScenes; i++) {
    const scene = result.scenes[i];
    const pct = 62 + Math.round((i / totalScenes) * 33);
    progress('imagegen', pct, `🖼️ 生成分镜图 ${i + 1}/${totalScenes}：${(scene.description || '').substring(0, 25)}...`);

    try {
      const prompt = scene.full_prompt_en || scene.visual_prompt || scene.description;
      // 用角色一致性 Agent 收集到的 reference images (三视图 front 优先)
      const refImages = (scene.char_ref_images || []).filter(Boolean);
      // 把相对 URL 转成绝对 URL (供 jimeng 等需要公网 URL 的供应商)
      const absRefImages = refImages.map(u => {
        if (/^https?:\/\//.test(u)) return u;
        // 内部 URL: 先拼上本机域名 (生产环境会走 PUBLIC_URL)
        const base = process.env.PUBLIC_URL || `http://127.0.0.1:${process.env.PORT || 4600}`;
        return base + u;
      });
      const imgResult = await generateDramaImage({
        prompt,
        filename: `drama_${taskId}_s${i}`,
        aspectRatio: aspect_ratio,
        referenceImages: absRefImages,
        image_model,
      });
      const imgDest = path.join(taskDir, `scene_${i}.png`);
      if (imgResult.filePath && fs.existsSync(imgResult.filePath)) {
        fs.copyFileSync(imgResult.filePath, imgDest);
        scene.image_url = `/api/drama/tasks/${taskId}/image/${i}`;
      }
    } catch (err) {
      console.error(`[Drama] 分镜图 ${i + 1} 生成失败:`, err.message);
      scene.image_error = err.message;
      // 继续生成下一张，不中断流程
    }
  }

  // Step 6: 配音 (TTS, 可选)
  if (enable_voice) {
    progress('voice', 96, '🎙️ AI 配音：为有对话的分镜生成语音...');
    try {
      const voiceCount = await agentDramaVoice(result.scenes, taskDir);
      progress('voice', 99, `🎙️ 配音完成: ${voiceCount} 段语音`);
      result.voice_count = voiceCount;
    } catch (e) {
      console.error('[Drama voice] step failed:', e.message);
      result.voice_error = e.message;
    }
  }

  // 保存模型选择和输出比例到结果
  result.image_model = image_model;
  result.video_model = video_model;
  result.aspect_ratio = aspect_ratio;

  fs.writeFileSync(path.join(taskDir, 'result.json'), JSON.stringify(result, null, 2), 'utf8');
  progress('done', 100, '网剧分镜生成完成！');
  return result;
}

// ═══════════════════════════════════════════════════
// JSON 修复（复用 comicService 的逻辑）
// ═══════════════════════════════════════════════════
function repairJSON(raw) {
  let str = raw.trim();
  const m = str.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) str = m[1].trim();
  else if (str.startsWith('```')) str = str.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
  const start = str.indexOf('{');
  const end = str.lastIndexOf('}');
  if (start !== -1 && end > start) str = str.slice(start, end + 1);
  try { return JSON.parse(str); } catch (_) {}
  let fixed = str.replace(/,\s*([}\]])/g, '$1');
  try { return JSON.parse(fixed); } catch (_) {}
  // 尝试闭合截断的 JSON
  const opens = { '{': '}', '[': ']' };
  let repaired = fixed;
  const stack = [];
  let inStr = false, escape = false;
  for (const ch of repaired) {
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{' || ch === '[') stack.push(opens[ch]);
    else if (ch === '}' || ch === ']') stack.pop();
  }
  if (stack.length > 0) {
    repaired = repaired.replace(/,\s*"[^"]*"?\s*:?\s*"?[^"]*$/, '');
    repaired = repaired.replace(/,\s*\{[^}]*$/, '');
    repaired = repaired.replace(/,\s*$/, '');
    const stack2 = [];
    let inStr2 = false, esc2 = false;
    for (const ch of repaired) {
      if (esc2) { esc2 = false; continue; }
      if (ch === '\\') { esc2 = true; continue; }
      if (ch === '"') { inStr2 = !inStr2; continue; }
      if (inStr2) continue;
      if (ch === '{' || ch === '[') stack2.push(opens[ch]);
      else if (ch === '}' || ch === ']') stack2.pop();
    }
    repaired += stack2.reverse().join('');
  }
  try { return JSON.parse(repaired); } catch (e) { throw new Error(e.message); }
}

module.exports = {
  generateDrama,
  CAMERA_MOTIONS,
  SHOT_SCALES,
  MOTION_PRESETS,
  DRAMA_DIR,
  assemblePrompts,
  applyMotionPrompts,
  agentDramaVoice,
  agentCharacterConsistency,
  injectCharacterLocks,
};
