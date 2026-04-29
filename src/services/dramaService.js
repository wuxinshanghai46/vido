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
// Setting Lock — 时代/题材锚定（全链路硬约束）
// ═══════════════════════════════════════════════════
// 由 agentEraDetector 产出，在剧本/导演/视觉/对白 4 个 Agent 的
// systemPrompt 前置注入，保证"古代小说不会生出现代场景"。
function buildSettingLockBlock(settingLock) {
  if (!settingLock || typeof settingLock !== 'object') return '';
  const {
    era_cn = '未知', era = 'unknown', dynasty = null, time_period_cn = '',
    genre_tags = [], location_hint = '',
    forbidden_elements = [], required_elements = [], style_anchors = [],
    avoid_prompts_en = [],
  } = settingLock;

  const lines = [
    '【⚠️ 时代/题材锁定 — 绝对不可违反 / SETTING LOCK (HARD CONSTRAINT)】',
    `- 时代: ${era_cn}（${era}）${dynasty ? ' | 朝代: ' + dynasty : ''}${time_period_cn ? ' | 时期: ' + time_period_cn : ''}`,
    genre_tags.length ? `- 题材标签: ${genre_tags.join('、')}` : '',
    location_hint ? `- 地点暗示: ${location_hint}` : '',
    forbidden_elements.length ? `- ❌ 禁止出现: ${forbidden_elements.join('、')}` : '',
    required_elements.length ? `- ✅ 必须出现: ${required_elements.join('、')}` : '',
    style_anchors.length ? `- 🎨 风格锚点: ${style_anchors.join('、')}` : '',
    avoid_prompts_en.length ? `- 🚫 生图 prompt 黑名单(EN): ${avoid_prompts_en.join(', ')}` : '',
    '',
    '【违反后果】',
    '- 本条锁定优先于一切创作自由。禁止以"戏剧效果""现代化改编""观众理解"等任何理由违反。',
    '- 剧本/分镜/视觉描述/对白中出现上述禁止元素，该场景将被判定为无效输出。',
    '- 若原著本就跨时代（穿越类），遵守 era 主时空约束，现代元素仅允许出现在主角内心独白或<2秒回闪。',
  ].filter(Boolean);

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════
// Agent 0：时代/题材检测 — 产出 setting_lock
// ═══════════════════════════════════════════════════
async function agentEraDetector({ theme = '', novelText = '', genre = '' }) {
  const { callLLM } = require('./storyService');
  const kb = require('./knowledgeBaseService');

  const kbMethodology = kb.buildAgentContext('era_detector', { genre: genre || theme, maxDocs: 4, maxCharsPerDoc: 1200 });

  const systemPrompt = `你是世界级的中文小说时代/题材识别专家，任务是从输入文本中提取结构化的 setting_lock 对象。

${kbMethodology || ''}

【严格输出】只输出 JSON 对象，不要任何额外文字、解释、markdown 代码块标记。`;

  const src = (novelText && novelText.length > 20) ? novelText : theme;
  const userPrompt = `请分析以下小说文本，提取 setting_lock：

【用户提供的 genre 参考（可能为空或不准确，仅作参考）】: ${genre || '无'}

【小说文本】
${(src || '').substring(0, 5000)}

严格输出如下结构的 JSON（字段不可缺失，置信度低则填 unknown/空数组）：
{
  "era": "ancient|near_modern|modern|future|xianxia|wuxia|post_apocalyptic|cyberpunk|alt_history|unknown",
  "era_cn": "古代|近代|现代|未来|仙侠|武侠|末日|赛博朋克|架空|未知",
  "dynasty": "唐|宋|元|明|清|春秋战国|三国|魏晋|民国" or null,
  "genre_tags": ["数组：古偶/宫廷/权谋/仙侠/玄幻/穿越/重生/都市/校园/末日/科幻 等"],
  "time_period_cn": "可选，如'盛唐开元年间''民国二十年''近未来2045' 或 ''",
  "location_hint": "可选，如'中原江南''大漠孤烟''废土都市' 或 ''",
  "forbidden_elements": ["该时代禁止出现的元素，至少 5 项"],
  "required_elements": ["该时代必须出现的视觉锚点，至少 5 项"],
  "style_anchors": ["服化道风格关键词中英双语，至少 5 项"],
  "avoid_prompts_en": ["分镜/生图 prompt 黑名单英文，至少 3 项"],
  "confidence": 0.0-1.0
}`;

  try {
    const raw = await callLLM(systemPrompt, userPrompt);
    const lock = repairJSON(raw);
    if (lock && typeof lock === 'object') {
      // 兜底字段
      lock.era = lock.era || 'unknown';
      lock.era_cn = lock.era_cn || '未知';
      lock.genre_tags = Array.isArray(lock.genre_tags) ? lock.genre_tags : [];
      lock.forbidden_elements = Array.isArray(lock.forbidden_elements) ? lock.forbidden_elements : [];
      lock.required_elements = Array.isArray(lock.required_elements) ? lock.required_elements : [];
      lock.style_anchors = Array.isArray(lock.style_anchors) ? lock.style_anchors : [];
      lock.avoid_prompts_en = Array.isArray(lock.avoid_prompts_en) ? lock.avoid_prompts_en : [];
      lock.confidence = typeof lock.confidence === 'number' ? lock.confidence : 0.5;
      return lock;
    }
  } catch (e) {
    console.warn('[EraDetector] LLM 失败, 回退为 unknown:', e.message);
  }
  return {
    era: 'unknown', era_cn: '未知', dynasty: null, genre_tags: [],
    forbidden_elements: [], required_elements: [], style_anchors: [], avoid_prompts_en: [],
    confidence: 0,
  };
}

// ═══════════════════════════════════════════════════
// Agent 1：编剧 — 生成网剧剧情脚本
// ═══════════════════════════════════════════════════
async function agentDramaScreenwriter({ theme, novelText = '', style, sceneCount = 6, characters = [], episodeIndex = 1, episodeCount = 1, previousSummary = '', genre = '', settingLock = null }) {
  const { callLLM } = require('./storyService');
  const kb = require('./knowledgeBaseService');

  // 注入知识库上下文：编剧 + 市场调研 + 文案策划（更全面的创作视角）
  // 时代锚点：优先按 setting_lock 的朝代/题材过滤
  const eraKey = settingLock ? [settingLock.era_cn, settingLock.dynasty, ...(settingLock.genre_tags || [])].filter(Boolean).join(' ') : '';
  const ctxScreenwriter = kb.buildAgentContext('screenwriter', { genre: eraKey || genre || theme, maxDocs: 8 });
  const ctxMarket = kb.buildAgentContext('market_research', { genre: eraKey || genre || theme, maxDocs: 4 });
  const ctxCopy = kb.buildAgentContext('copywriter', { genre: eraKey || genre || theme, maxDocs: 2 });
  const ctxEra = kb.buildAgentContext('screenwriter', { genre: eraKey, maxDocs: 4, maxCharsPerDoc: 1200 });
  const kbContext = [ctxScreenwriter, ctxMarket, ctxCopy, ctxEra].filter(Boolean).join('\n\n');

  const charDesc = characters.length
    ? `\n角色列表：\n${characters.map(c => `- ${c.name}：${c.appearance_prompt || c.description || '无描述'}`).join('\n')}`
    : '';

  const episodeContext = episodeCount > 1
    ? `\n这是一部共${episodeCount}集的网剧，当前是第${episodeIndex}集。${previousSummary ? `\n前集摘要：${previousSummary}\n请确保故事与前集衔接，角色行为和情节发展保持连贯。` : '这是第一集，需要建立世界观和角色。'}` : '';

  const lockBlock = buildSettingLockBlock(settingLock);
  const novelCtx = novelText
    ? `\n【原著小说原文（必须严格基于此改编，不得添加原著没有的时代/地点元素）】\n${novelText.substring(0, 4000)}\n【原著结束】\n`
    : '';

  const systemPrompt = `${lockBlock ? lockBlock + '\n\n' : ''}你是一位世界级AI漫剧/网剧编剧，你的创作水平对标字节Seedance 2.0的多镜头叙事能力、OpenAI Sora 2的电影级叙事结构、Google Veo 3的视听协同思维。

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
场景数：${sceneCount}${charDesc}${episodeContext}${novelCtx}

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
async function agentDramaDirector(screenplay, style, characters = [], genre = '', settingLock = null) {
  const { callLLM } = require('./storyService');
  const kb = require('./knowledgeBaseService');

  // 注入知识库：导演 + 艺术总监 + 氛围 + 分镜 + 剪辑 五档上下文
  // 让导演同时拥有艺术总监的视觉锚点思维和剪辑师的节奏思维
  // 时代锚点：按 setting_lock 精细过滤（朝代/题材/era）
  const eraKey = settingLock ? [settingLock.era_cn, settingLock.dynasty, ...(settingLock.genre_tags || [])].filter(Boolean).join(' ') : '';
  const genreKey = eraKey || genre;
  const kbDirector = kb.buildAgentContext('director', { genre: genreKey, maxDocs: 6 });
  const kbArtDirector = kb.buildAgentContext('art_director', { genre: genreKey, maxDocs: 6 });
  const kbAtmosphere = kb.buildAgentContext('atmosphere', { genre: genreKey, maxDocs: 6 });
  const kbStoryboard = kb.buildAgentContext('storyboard', { genre: genreKey, maxDocs: 6 });
  const kbEditor = kb.buildAgentContext('editor', { genre: genreKey, maxDocs: 4 });
  const kbContext = [kbDirector, kbArtDirector, kbAtmosphere, kbStoryboard, kbEditor].filter(Boolean).join('\n\n');

  const charVisuals = characters.length
    ? `\n角色视觉参考：\n${characters.map(c => `- ${c.name}：${c.appearance_prompt || c.description || '无描述'}`).join('\n')}`
    : '';

  const lockBlock = buildSettingLockBlock(settingLock);

  const systemPrompt = `${lockBlock ? lockBlock + '\n\n' : ''}你是一位世界级AI漫剧导演，你的视觉叙事能力对标字节Seedance 2.0的导演智能、Google Veo 3.1的电影摄影术、OpenAI Sora 2的专业分镜控制。

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
// Agent 3：视觉描写 — 精确描述人物形象/背景/物品细节
// ═══════════════════════════════════════════════════
async function agentDramaVisualDescriber({ directed, novelText = '', style = '日系动漫', characters = [], genre = '', settingLock = null }) {
  const { callLLM } = require('./storyService');
  const kb = require('./knowledgeBaseService');

  const eraKey = settingLock ? [settingLock.era_cn, settingLock.dynasty, ...(settingLock.genre_tags || [])].filter(Boolean).join(' ') : '';
  const kbArtDirector = kb.buildAgentContext('art_director', { genre: eraKey || genre, maxDocs: 6 });
  const kbAtmosphere = kb.buildAgentContext('atmosphere', { genre: eraKey || genre, maxDocs: 6 });
  const kbContext = [kbArtDirector, kbAtmosphere].filter(Boolean).join('\n\n');

  const charDesc = characters.length
    ? `\n已知角色信息：\n${characters.map(c => `- ${c.name}：${c.appearance_prompt || c.description || '无描述'}`).join('\n')}`
    : '';

  const novelCtx = novelText
    ? `\n【小说原文（请从中提取精确的视觉细节）】\n${novelText.substring(0, 3000)}`
    : '';

  const lockBlock = buildSettingLockBlock(settingLock);

  const systemPrompt = `${lockBlock ? lockBlock + '\n\n' : ''}你是一位世界级的AI视觉描写专家，专精于将文学文本转化为精确到每个细节的视觉描述。你的描述粒度对标字节即梦 / Google Veo 3 / OpenAI Sora 2 的专业 prompt 规范。

【核心任务】
基于小说原文和剧本内容，为每个场景生成极度精确的视觉提示词。
必须精确到以下维度：
- 人物 (10 维)：发型+发色、瞳色、肤色质感、五官轮廓、身高体型、表情/微表情、姿态/手势、服装面料+颜色+款式+开合状态、配饰(首饰/鞋/腰带/武器)、标志特征(疤痕/胎记/眼镜)
- 背景 (10 维)：地点大类+小类、建筑/场所风格、墙面/地面/天花板材质、家具/陈设、光源(方向+色温)、阴影、色调(主色+辅色+点缀色 至少 3 种)、天气、季节、时间段(晨/午/黄昏/夜)
- 物品 (6 维 × 3-5 件)：名称、材质(木/铁/玉/纸/陶/丝)、颜色+光泽、尺寸(小/中/大+具体估算)、状态(新/旧/破损/发光)、位置关系(手持/桌上/腰间/墙挂)
- 氛围 (5 维)：色彩基调、空气粒子(尘/雾/雪/花瓣/火星)、声景暗示、情绪关键词、整体画风(日系动漫/3D写实/水墨/油画)

【关键原则】
1. **从小说原文中提取** — 不自己编造，而是把小说里描写的细节转化为视觉语言
2. **字数硬指标** — environment_detail_cn 必须 90-150 字 / character_visuals[].appearance_detail_cn 必须 100-150 字 / props_cn 必须含 3-5 个物品每个至少 15 字，少于硬指标视为无效输出
3. **精确用词** — 不写"漂亮的裙子"而写"淡粉色柔缎 A 字齐胸襦裙，膝下 5 厘米，腰间 3 厘米宽白缎蝴蝶结"
4. **颜色必须具体** — raven-black / chestnut brown / icy blue / sage green / cream white / vermillion red / moonlight silver
5. **每个角色在所有场景中外貌描述一致** — 使用相同的关键词锁定（发型发色瞳色服饰轮流复现）
6. **中英文双语输出** — 英文用于 AI 生图，中文用于人工审阅，两者一一对应且等价
7. **严禁偷懒** — 禁止输出"一个美丽的女人"、"装饰华丽"、"古香古色"、"富有韵味"这类抽象词，必须具体到眼见可画

严格输出 JSON，不要任何额外文字。${kbContext ? '\n\n' + kbContext : ''}`;

  const userPrompt = `基于以下剧本和小说原文，为每个场景生成精确的视觉描述：

【剧本】
${JSON.stringify(directed, null, 2)}

${novelCtx}${charDesc}

画风：${style}

为每个场景(scene)添加以下字段：
{
  "visual_prompt": "英文完整场景 prompt（120-180 词）：Cinematography + Subject + Action + Context + Style & Ambiance",
  "visual_prompt_cn": "中文一一对应版本（120-180 字）",
  "character_visuals": [
    {
      "name": "角色名",
      "appearance_detail": "100-150 词英文：脸型+五官+发型发色+瞳色+肤色+身型+服装面料色彩款式+配饰+标志特征+表情+姿态",
      "appearance_detail_cn": "100-150 字中文（一一对应）",
      "lock_face_cn": "面部锁定关键词（10-15 字，如'鹅蛋脸/丹凤眼/琥珀瞳/柳叶眉/薄唇'）",
      "lock_wardrobe_cn": "服装锁定关键词（10-20 字，如'月白交领襦裙/青玉发簪/银链长命锁'）",
      "expression_cn": "本场景表情（5-10 字，如'冷眼旁观'、'眉眼含笑'）"
    }
  ],
  "environment_detail": "英文 90-150 词：地点大类+建筑风格+墙/地/顶材质+家具+光源方向色温+阴影+3色调+天气+季节+时段",
  "environment_detail_cn": "中文 90-150 字（一一对应）",
  "lighting_cn": "光线简述（15-25 字，如'西斜日光穿过雕花窗棂，形成长条暖金斑'）",
  "color_palette_cn": "主色调 3-5 色（如'朱红 / 鹅黄 / 石青 / 玄黑 / 月白'）",
  "props_detail": [
    {
      "name_cn": "物品名",
      "material_cn": "材质（木/铁/玉/瓷/丝/纸）",
      "color_cn": "颜色光泽",
      "size_cn": "尺寸（小/中/大 + 估算）",
      "state_cn": "状态（新/旧/破损/发光/沾血）",
      "position_cn": "位置（手持/桌上/腰间/墙挂）"
    }
  ],
  "props_cn": "物品清单简述（兼容老版本，3-5 个物品用'、'分隔，每个至少 15 字）",
  "atmosphere_cn": "氛围关键词 3-5 个（如'清冷 / 孤寂 / 铁锈味 / 雪花飘 / 心跳加速'）"
}

重要：保留剧本中已有的所有字段不动（dialogue/narrator/sfx/emotion/pacing/shot_scale/lighting/composition 等），只新增上述视觉描写字段。

【强制要求 — 任一违反判为无效输出】
1. character_visuals：数组长度 ≥1，每条 appearance_detail_cn **必须 100-150 字**，少于 100 字视为无效
2. environment_detail_cn：字符串 **必须 90-150 字**，必须含"地点+材质+光源+色调+天气+季节"6 要素
3. props_detail：数组长度 **3-5**；每个物品 6 字段全填
4. lock_face_cn / lock_wardrobe_cn：必填，用于下游角色一致性锁定
5. 严禁抽象词（"华丽"、"古香古色"、"韵味"、"美丽"、"帅气"等）— 必须具体到眼见可画`;

  const raw = await callLLM(systemPrompt, userPrompt);
  return repairJSON(raw);
}

// ═══════════════════════════════════════════════════
// Agent 4：对白 — 生成对话+旁白（带音色标注）
// ═══════════════════════════════════════════════════
async function agentDramaDialogue({ directed, novelText = '', characters = [], genre = '', settingLock = null }) {
  const { callLLM } = require('./storyService');
  const kb = require('./knowledgeBaseService');

  const eraKey = settingLock ? [settingLock.era_cn, settingLock.dynasty, ...(settingLock.genre_tags || [])].filter(Boolean).join(' ') : '';
  const kbScreenwriter = kb.buildAgentContext('screenwriter', { genre: eraKey || genre, maxDocs: 6 });
  const kbContext = kbScreenwriter || '';

  const charDesc = characters.length
    ? `\n角色列表：\n${characters.map(c => `- ${c.name}：${c.appearance_prompt || c.description || '无描述'}${c.voice_tone ? '，音色：' + c.voice_tone : ''}`).join('\n')}`
    : '';

  const novelCtx = novelText
    ? `\n【小说原文（从中提取/改编对话和旁白）】\n${novelText.substring(0, 3000)}`
    : '';

  const lockBlock = buildSettingLockBlock(settingLock);
  const eraHint = settingLock && settingLock.era_cn && settingLock.era_cn !== '未知'
    ? `\n\n【对白称谓必须匹配时代】时代=${settingLock.era_cn}${settingLock.dynasty ? '('+settingLock.dynasty+')' : ''}。对白严禁使用该时代不存在的称谓与词汇（如古代不得出现"先生/老板/手机/你好"，现代不得出现"本宫/朕/娘子"）。`
    : '';

  const systemPrompt = `${lockBlock ? lockBlock + '\n\n' : ''}你是一位顶级影视对白编剧，专精于将小说文本改编为影视对白和旁白。${eraHint}

【核心任务】
根据小说原文和剧本内容，为每个场景生成精准的对话和旁白。

【对白原则】
1. **从小说中提取和改编** — 优先使用小说中已有的对话，适当精简使之适合影视节奏
2. **对话≤15字** — 影视对白简洁有力，每句不超过15个字
3. **旁白≤20字** — 旁白用于时间跳转、内心独白、氛围渲染
4. **每个角色有独特的说话风格** — 语气词、口头禅、句式各不相同
5. **对白推动剧情** — 每句对白必须推动剧情或揭示角色性格

【音色标注】
为每个说话角色标注推荐的音色特征，便于后续 TTS 合成时选择合适的声音：
- voice_gender: 性别（male/female）
- voice_age: 年龄段（child/young/adult/elder）
- voice_style: 情感风格（gentle/firm/cold/warm/playful/serious/mysterious）
- voice_speed: 说话速度（slow/normal/fast）

严格输出 JSON，不要任何额外文字。${kbContext ? '\n\n' + kbContext : ''}`;

  const userPrompt = `基于以下剧本和小说原文，为每个场景生成对话和旁白：

【剧本】
${JSON.stringify(directed, null, 2)}

${novelCtx}${charDesc}

为每个场景(scene)更新/添加以下字段：
{
  "dialogue": "对话内容（≤15字，可空）",
  "speaker": "说话角色名（可空）",
  "tone": "说话语气（低沉/温柔/颤抖/坚定/愤怒/平静等）",
  "narrator": "旁白内容（≤20字，可空）",
  "voice_config": {
    "gender": "male|female",
    "age": "child|young|adult|elder",
    "style": "gentle|firm|cold|warm|playful|serious|mysterious",
    "speed": "slow|normal|fast",
    "recommended_voice": "推荐的TTS音色名称（如有）"
  }
}

同时输出角色音色总表：
{
  "scenes": [...],
  "voice_profiles": [
    {
      "name": "角色名",
      "gender": "male|female",
      "age": "young|adult|elder",
      "default_style": "默认情感风格",
      "voice_description": "声音特征描述（如：低沉磁性的男中音）"
    }
  ]
}

重要：保留剧本中已有的所有字段不动，只更新对白相关字段。`;

  const raw = await callLLM(systemPrompt, userPrompt);
  return repairJSON(raw);
}

// ═══════════════════════════════════════════════════
// 运镜 — 自动标注镜头语言提示词
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
async function agentCharacterConsistency({ screenplay, characters = [], genre = '', settingLock = null }) {
  const { callLLM } = require('./storyService');
  const db = require('../models/database');
  const kb = require('./knowledgeBaseService');

  // 注入知识库：人物一致性 + 艺术总监（让角色锁定与艺术风格一致）
  const eraKey = settingLock ? [settingLock.era_cn, settingLock.dynasty, ...(settingLock.genre_tags || [])].filter(Boolean).join(' ') : '';
  const ctxCC = kb.buildAgentContext('character_consistency', { genre: eraKey || genre, maxDocs: 6 });
  const ctxAD = kb.buildAgentContext('art_director', { genre: eraKey || genre, maxDocs: 6 });
  const kbContext = [ctxCC, ctxAD].filter(Boolean).join('\n\n');
  const lockBlock = buildSettingLockBlock(settingLock);

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
  const systemPrompt = `${lockBlock ? lockBlock + '\n\n' : ''}你是顶级的 AI 漫剧角色设定师, 专精**人物一致性锁定**。你的能力对标:
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
// 全流程：生成网剧（10 步流水线）
// ① 剧集：编剧→导演  ② 提示词：视觉描写  ③ 对白：对白→TTS
// ④ AI智能创作：三视图→角色一致性→用户确认→分镜生成  ⑤ 成片
// ═══════════════════════════════════════════════════
async function generateDrama(taskId, params, progressCallback) {
  const { theme, style = '日系动漫', sceneCount = 6, durationPerScene = 5, characters = [], motionPreset = 'cinematic', styleId = null, character_ids = [], episodeIndex = 1, episodeCount = 1, previousSummary = '', image_model = '', video_model = '', aspect_ratio = '9:16', enable_voice = true, genre = '' } = params;
  const db = require('../models/database');
  const taskDir = path.join(DRAMA_DIR, taskId);
  ensureDir(taskDir);

  const progress = (step, pct, msg) => {
    if (progressCallback) progressCallback({ step, progress: pct, message: msg });
  };

  // Enrichment: 解析画风 + 角色库
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
        enrichedChars.push({ id: cid, name: c.name, description: c.appearance_prompt || c.appearance, appearance_prompt: c.appearance_prompt, three_view: c.three_view });
      }
    }
  }

  // 小说原文：永远全量透传（取消历史上的 200 字阈值 — 短输入也按梗概用，下游自行截断）
  const novelText = theme || '';

  // ════════════════════════════════════════════
  // ① 时代锚定阶段（Step 0）
  // ════════════════════════════════════════════
  progress('era_detect', 1, '🔍 时代检测 [LLM]：识别朝代/题材/必现/禁止元素...');
  let settingLock = null;
  try {
    settingLock = await agentEraDetector({ theme, novelText, genre });
    fs.writeFileSync(path.join(taskDir, 'setting_lock.json'), JSON.stringify(settingLock, null, 2), 'utf8');
    const era = settingLock?.era_cn || '未知';
    const dyn = settingLock?.dynasty ? `(${settingLock.dynasty})` : '';
    const conf = typeof settingLock?.confidence === 'number' ? ` 置信度=${(settingLock.confidence * 100).toFixed(0)}%` : '';
    progress('era_detect', 2, `🔍 时代锁定：${era}${dyn}${conf}`);
  } catch (err) {
    console.error('[EraDetector] 失败，回退无锁定:', err.message);
    progress('era_detect', 2, `⚠️ 时代检测失败，未锁定: ${err.message}`);
  }

  // ════════════════════════════════════════════
  // ① 剧集阶段
  // ════════════════════════════════════════════

  // Step 1: 编剧Agent [LLM文本模型]
  progress('screenwriter', 3, '✍️ 剧本生成 [LLM]：将小说改编为影视剧本...');
  let screenplay;
  try {
    screenplay = await agentDramaScreenwriter({ theme, novelText, style: resolvedStyle, sceneCount, characters: enrichedChars, episodeIndex, episodeCount, previousSummary, genre, settingLock });
  } catch (err) { throw new Error('编剧Agent失败: ' + err.message); }
  fs.writeFileSync(path.join(taskDir, 'screenplay.json'), JSON.stringify(screenplay, null, 2), 'utf8');
  progress('screenwriter', 10, `✍️ 剧本生成完成：「${screenplay.title || ''}」${screenplay.scenes?.length || 0}个场景`);

  // Step 2: 导演Agent [LLM文本模型]
  progress('director', 12, '🎬 分镜生成 [LLM]：设计镜头语言/构图/光影...');
  let directed;
  try {
    directed = await agentDramaDirector(screenplay, resolvedStyle, enrichedChars, genre, settingLock);
  } catch (err) { throw new Error('导演Agent失败: ' + err.message); }
  // 运镜标注（规则引擎，无模型调用）
  const withMotion = applyMotionPrompts(directed, motionPreset);
  fs.writeFileSync(path.join(taskDir, 'directed.json'), JSON.stringify(withMotion, null, 2), 'utf8');
  progress('director', 20, `🎬 分镜生成完成：分镜+运镜设计就绪`);

  // ════════════════════════════════════════════
  // ② 提示词阶段
  // ════════════════════════════════════════════

  // Step 3: 视觉描写Agent [LLM文本模型]
  progress('visual', 22, '🎨 提示词生成 [LLM]：精确描述人物/背景/物品细节...');
  let withVisuals = withMotion;
  try {
    const visualResult = await agentDramaVisualDescriber({ directed: withMotion, novelText, style: resolvedStyle, characters: enrichedChars, genre, settingLock });
    // 合并视觉描写到场景（按 index 匹配，回退按数组顺序）
    const vScenes = visualResult.scenes || visualResult.data?.scenes || [];
    if (vScenes.length) {
      withVisuals.scenes = (withMotion.scenes || []).map((s, i) => {
        // 按 index 匹配，回退按数组位置
        const vs = vScenes.find(v => v.index === (s.index || i + 1)) || vScenes[i] || {};
        return {
          ...s,
          visual_prompt: vs.visual_prompt || s.visual_prompt || '',
          visual_prompt_cn: vs.visual_prompt_cn || s.visual_prompt_cn || '',
          character_visuals: vs.character_visuals || [],
          environment_detail: vs.environment_detail || '',
          environment_detail_cn: vs.environment_detail_cn || '',
          props: vs.props || '',
          props_cn: vs.props_cn || '',
        };
      });
      console.log(`[VisualDescriber] 成功合并 ${vScenes.length} 个场景的视觉描写`);
    } else {
      console.warn('[VisualDescriber] LLM 返回无 scenes 字段, 原始:', JSON.stringify(visualResult).slice(0, 200));
    }
  } catch (err) {
    console.error('[VisualDescriber] failed:', err.message);
    progress('visual', 30, `⚠️ 视觉描写 fallback: ${err.message}`);
  }
  // —— 后处理兜底：若 LLM 未返回 character_visuals / environment_detail_cn / props_cn，
  //   从已有字段（character_profiles / lighting / composition / description）合成，避免前端三栏只有"人物"
  const profiles = screenplay.character_profiles || [];
  for (const s of (withVisuals.scenes || [])) {
    if (!s.character_visuals?.length) {
      const sceneText = `${s.description || ''} ${s.visual_prompt_cn || ''} ${s.dialogue || ''} ${s.speaker || ''}`;
      const matched = profiles.filter(p => p.name && sceneText.includes(p.name));
      s.character_visuals = (matched.length ? matched : profiles).map(p => ({
        name: p.name,
        appearance_detail_cn: p.appearance || '',
        appearance_detail: p.appearance_en || p.appearance || '',
      }));
    }
    if (!s.environment_detail_cn && !s.environment_detail) {
      s.environment_detail_cn = [s.lighting, s.composition, s.ambient_sound, s.music_mood]
        .filter(Boolean).join('，');
    }
    if (!s.props_cn && !s.props) {
      // 从场景描述中尝试提取物品（简单启发式：包含"持/握/拿/戴/穿/佩"等动词后的短语）
      const m = (s.description || '').match(/(?:持|握|拿着|戴着|穿着|佩着|身旁|桌上|手中)[^。,，；]{2,30}/g);
      if (m?.length) s.props_cn = m.join('；');
    }
  }
  fs.writeFileSync(path.join(taskDir, 'visuals.json'), JSON.stringify(withVisuals, null, 2), 'utf8');
  progress('visual', 30, `🎨 提示词生成完成：${withVisuals.scenes?.length || 0}个场景已精确描述`);

  // ════════════════════════════════════════════
  // ③ 人物锁定阶段（Bible → 三视图，严格顺序）
  //   按用户心智模型：先由剧本 profile 产出精确 character_bible，
  //   再用 full_lock_prompt 生成三视图，保证三视图各角度人物一致
  // ════════════════════════════════════════════

  // Step 4: 角色一致性 Bible [LLM文本模型] — 从剧本 character_profiles 精确锁定
  progress('consistency', 32, '🎭 人物一致性 [LLM]：从剧本锁定 face/wardrobe/distinguishing...');
  let characterBible = { characters: [], global_rules: {} };
  try {
    characterBible = await agentCharacterConsistency({ screenplay: withVisuals, characters: enrichedChars, genre, settingLock });
    fs.writeFileSync(path.join(taskDir, 'character_bible.json'), JSON.stringify(characterBible, null, 2), 'utf8');
    progress('consistency', 38, `🎭 已锁定 ${characterBible.characters?.length || 0} 个角色外观 (Bible)`);
  } catch (err) {
    console.error('[CharConsistency] failed:', err.message);
    progress('consistency', 38, `⚠️ 人物一致性 fallback: ${err.message}`);
  }

  // Step 5: 角色三视图 [图片生成模型] — 用 Bible 的 full_lock_prompt 驱动，连续 i2i
  progress('threeview', 40, '👤 角色三视图 [图片模型]：顺序 i2i 生成正/侧/背/面部特写...');
  const { generateCharacterThreeView } = require('./imageService');
  const charProfiles = screenplay.character_profiles || [];
  const threeViewResults = {};
  const bibleByName = new Map((characterBible.characters || []).map(c => [c.name, c]));

  // 三视图互相用前一视角作为 reference（i2i）—— 在 generateCharacterThreeView 内部按顺序跑
  // 不再并发多角色（并发会让同一 i2i provider 被打满）— 改串行
  for (const cp of charProfiles) {
    // 收集最详细的描述：Bible > scene.character_visuals > character_profile.appearance
    const bc = bibleByName.get(cp.name);
    let lockPromptEn = bc?.full_lock_prompt_en || '';
    let lockPromptCn = bc?.full_lock_prompt_cn || '';
    let charVisualDesc = cp.appearance || '';
    for (const scene of (withVisuals.scenes || [])) {
      const cv = (scene.character_visuals || []).find(v => v.name === cp.name);
      if (cv?.appearance_detail && cv.appearance_detail.length > charVisualDesc.length) {
        charVisualDesc = cv.appearance_detail;
      }
    }
    const extChar = enrichedChars.find(c => c.name === cp.name);
    if (extChar?.appearance_prompt && extChar.appearance_prompt.length > charVisualDesc.length) {
      charVisualDesc = extChar.appearance_prompt;
    }
    try {
      const tvResult = await generateCharacterThreeView({
        name: cp.name,
        role: cp.personality || '',
        description: charVisualDesc,
        lockPromptEn,   // 新：Bible 的英文锁定 prompt（优先）
        lockPromptCn,   // 新：Bible 的中文锁定 prompt
        dim: '2d',
        aspectRatio: '3:4',
        image_model,
      });
      for (const k of ['front', 'side', 'back', 'face', 'sheet']) {
        if (tvResult[k]?.filename && !tvResult[k].url) {
          tvResult[k].url = `/api/story/character-image/${tvResult[k].filename}`;
        }
      }
      threeViewResults[cp.name] = tvResult;
      const done = Object.keys(threeViewResults).length;
      const pct = 40 + Math.round((done / Math.max(charProfiles.length, 1)) * 12);
      progress('threeview', pct, `👤 三视图 ${done}/${charProfiles.length}：${cp.name} ✓`);
    } catch (err) {
      console.error(`[ThreeView] ${cp.name} 失败:`, err.message);
      threeViewResults[cp.name] = { error: err.message };
    }
  }
  fs.writeFileSync(path.join(taskDir, 'three_views.json'), JSON.stringify(threeViewResults, null, 2), 'utf8');
  // 把三视图 URL 合并回 Bible（给前端/下游分镜图注入用）
  for (const bc of characterBible.characters || []) {
    const tv = threeViewResults[bc.name];
    if (tv && !tv.error) {
      bc.three_view = {
        front: tv.front?.url || tv.front?.filename,
        side: tv.side?.url || tv.side?.filename,
        back: tv.back?.url || tv.back?.filename,
        face: tv.face?.url || tv.face?.filename,
        sheet: tv.sheet?.url || tv.sheet?.filename,
      };
    }
  }
  fs.writeFileSync(path.join(taskDir, 'character_bible.json'), JSON.stringify(characterBible, null, 2), 'utf8');
  progress('threeview', 52, `👤 三视图完成：${Object.keys(threeViewResults).filter(k => !threeViewResults[k].error).length}/${charProfiles.length} 个角色`);

  // Step 6: 用户确认（暂停点）— 确认 Bible + 三视图后才继续后续流程
  const confirmData = {
    character_bible: characterBible,
    three_views: threeViewResults,
    voice_profiles: [],   // 对白尚未生成，占位
    scenes_preview: (withVisuals.scenes || []).map((s, i) => ({
      index: i + 1,
      description: s.description,
      visual_prompt_cn: s.visual_prompt_cn,
      character_visuals: s.character_visuals || [],
      environment_detail_cn: s.environment_detail_cn || '',
      props_cn: s.props_cn || '',
    })),
  };
  fs.writeFileSync(path.join(taskDir, 'confirm_data.json'), JSON.stringify(confirmData, null, 2), 'utf8');
  progress('confirm', 54, '✅ 请确认角色三视图和 Bible（确认后继续生成对白+分镜）');

  const confirmed = await waitForConfirmation(taskId, progress);
  if (confirmed?.updated_bible) {
    characterBible = confirmed.updated_bible;
    fs.writeFileSync(path.join(taskDir, 'character_bible.json'), JSON.stringify(characterBible, null, 2), 'utf8');
  }

  // ════════════════════════════════════════════
  // ④ 对白阶段（移到 Bible 确认之后，更贴近用户心智）
  // ════════════════════════════════════════════

  // Step 7: 对白Agent [LLM文本模型]
  progress('dialogue', 56, '💬 对白生成 [LLM]：生成对话+旁白+音色标注...');
  let withDialogue = withVisuals;
  let voiceProfiles = [];
  try {
    const dialogueResult = await agentDramaDialogue({ directed: withVisuals, novelText, characters: enrichedChars, genre, settingLock });
    voiceProfiles = dialogueResult.voice_profiles || [];
    const dScenes = dialogueResult.scenes || dialogueResult.data?.scenes || [];
    if (dScenes.length) {
      withDialogue.scenes = (withVisuals.scenes || []).map((s, i) => {
        const ds = dScenes.find(d => d.index === (s.index || i + 1)) || dScenes[i] || {};
        return {
          ...s,
          dialogue: ds.dialogue || s.dialogue || '',
          speaker: ds.speaker || s.speaker || '',
          tone: ds.tone || s.tone || '',
          narrator: ds.narrator || s.narrator || '',
          voice_config: ds.voice_config || null,
        };
      });
      console.log(`[Dialogue] 成功合并 ${dScenes.length} 个场景的对白`);
    } else {
      console.warn('[Dialogue] LLM 返回无 scenes 字段, 原始:', JSON.stringify(dialogueResult).slice(0, 200));
    }
  } catch (err) {
    console.error('[Dialogue] failed:', err.message);
    progress('dialogue', 60, `⚠️ 对白生成 fallback: ${err.message}`);
  }
  withDialogue.voice_profiles = voiceProfiles;
  fs.writeFileSync(path.join(taskDir, 'dialogue.json'), JSON.stringify(withDialogue, null, 2), 'utf8');
  progress('dialogue', 60, `💬 对白生成完成`);

  // Step 8: TTS语音合成 [TTS语音模型]
  if (enable_voice) {
    progress('tts', 62, '🎙️ 对白语音合成 [语音模型]：生成角色语音...');
    try {
      const ttsProgress = (idx, total, speaker, text) => {
        const pct = 62 + Math.round((idx / Math.max(total, 1)) * 6);
        progress('tts', pct, `🎙️ TTS ${idx}/${total}：${speaker || '旁白'} — "${(text || '').slice(0, 15)}..."`);
      };
      const voiceCount = await agentDramaVoiceEnhanced(withDialogue.scenes || [], taskDir, voiceProfiles, ttsProgress);
      progress('tts', 68, `🎙️ TTS完成: ${voiceCount} 段语音`);
      withDialogue.voice_count = voiceCount;
    } catch (e) {
      console.error('[Drama TTS] step failed:', e.message);
      progress('tts', 68, `⚠️ TTS失败: ${e.message}`);
      withDialogue.voice_error = e.message;
    }
  } else {
    progress('tts', 68, '🎙️ TTS跳过（未启用）');
  }

  // 把角色锁注入每个场景（此时 withDialogue 含对白 + visual 字段）
  injectCharacterLocks(withDialogue.scenes || [], characterBible);

  // 提示词组装（规则引擎，无模型调用）
  progress('prompt_assemble', 69, '📝 提示词组装：融合角色锁+视觉描写+运镜...');
  const final = assemblePrompts(withDialogue, resolvedStyle);
  fs.writeFileSync(path.join(taskDir, 'script.json'), JSON.stringify(final, null, 2), 'utf8');
  progress('prompt_assemble', 70, '📝 提示词就绪');

  // Step 9: 分镜图生成 [图片生成模型]
  progress('imagegen', 72, '🖼️ 分镜生成 [图片模型]：以角色参考图注入生成场景...');
  const { generateDramaImage } = require('./imageService');
  const resultScenes = (final.scenes || []).map((s, i) => ({
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
    character_visuals: s.character_visuals || [],
    environment_detail: s.environment_detail || '',
    environment_detail_cn: s.environment_detail_cn || '',
    props: s.props || '',
    props_cn: s.props_cn || '',
    voice_config: s.voice_config || null,
    video_url: null,
    image_url: null,
  }));

  const totalScenes = resultScenes.length;
  // 限流并发（避免 zhipu / mxapi 等 provider 速率限制）
  const IMG_CONCURRENCY = parseInt(process.env.DRAMA_IMG_CONCURRENCY || '2', 10);
  let imgDone = 0;
  const renderScene = async (scene, i) => {
    try {
      const prompt = scene.full_prompt_en || scene.visual_prompt || scene.description;
      const refImages = (scene.char_ref_images || []).filter(Boolean);
      const absRefImages = refImages.map(u => {
        if (/^https?:\/\//.test(u)) return u;
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
        scene.main_image_url = scene.image_url;
        scene.variant_urls = scene.variant_urls || [scene.image_url, scene.image_url];
        scene.end_frame_url = scene.end_frame_url || scene.image_url;
      }
    } catch (err) {
      console.error(`[Drama] 分镜图 ${i + 1} 生成失败:`, err.message);
      scene.image_error = err.message;
    } finally {
      imgDone++;
      const pct = 72 + Math.round((imgDone / totalScenes) * 25);
      progress('imagegen', pct, `🖼️ 分镜图 ${imgDone}/${totalScenes} ✓`);
    }
  };
  let cursor = 0;
  const workers = Array.from({ length: Math.min(IMG_CONCURRENCY, totalScenes) }, async () => {
    while (cursor < totalScenes) {
      const myIdx = cursor++;
      await renderScene(resultScenes[myIdx], myIdx);
    }
  });
  await Promise.all(workers);

  // ════════════════════════════════════════════
  // Step 10: 物品专属图生成
  // ════════════════════════════════════════════
  progress('propgen', 97, '🎁 物品图生成 [图片模型]...');
  const propsMap = new Map(); // name -> { name, scene_refs:[], sample_env }
  for (const s of resultScenes) {
    const raw = s.props_cn || s.props || '';
    const env = s.environment_detail_cn || s.environment_detail || '';
    raw.split(/[；;。\n、]+/).map(x => x.trim()).filter(x => x && x !== '无' && x.length <= 30 && x.length >= 2).forEach(name => {
      if (!propsMap.has(name)) propsMap.set(name, { name, scene_refs: [s.index], sample_env: env });
      else propsMap.get(name).scene_refs.push(s.index);
    });
  }
  const propsList = Array.from(propsMap.values()).slice(0, 20);
  let propDone = 0;
  const totalProps = propsList.length;
  const renderProp = async (item, idx) => {
    try {
      const envHint = (item.sample_env || '').slice(0, 120);
      const promptEn = `Isolated product photo of "${item.name}", ${envHint}, clean neutral studio background, sharp focus, cinematic lighting, high detail, no characters, no people`;
      const imgResult = await generateDramaImage({
        prompt: promptEn,
        filename: `drama_${taskId}_prop${idx}`,
        aspectRatio: '1:1',
        referenceImages: [],
        image_model,
      });
      const propDest = path.join(taskDir, `prop_${idx}.png`);
      if (imgResult.filePath && fs.existsSync(imgResult.filePath)) {
        fs.copyFileSync(imgResult.filePath, propDest);
        item.image_url = `/api/drama/tasks/${taskId}/prop/${idx}`;
      }
    } catch (err) {
      console.warn(`[Drama] 物品「${item.name}」生图失败:`, err.message);
      item.image_error = err.message;
    } finally {
      propDone++;
      if (totalProps) progress('propgen', 97 + Math.round((propDone / totalProps) * 2), `🎁 物品图 ${propDone}/${totalProps}`);
    }
  };
  let pcursor = 0;
  const pworkers = Array.from({ length: Math.min(IMG_CONCURRENCY, Math.max(1, totalProps)) }, async () => {
    while (pcursor < totalProps) {
      const my = pcursor++;
      await renderProp(propsList[my], my);
    }
  });
  await Promise.all(pworkers);

  // ════════════════════════════════════════════
  // ⑤ 结果输出
  // ════════════════════════════════════════════
  const result = {
    title: final.title || screenplay.title,
    synopsis: final.synopsis || screenplay.synopsis,
    style: resolvedStyle,
    motion_preset: motionPreset,
    scenes: resultScenes,
    character_bible: characterBible,
    three_views: threeViewResults,
    voice_profiles: voiceProfiles,
    voice_count: withDialogue.voice_count || 0,
    voice_error: withDialogue.voice_error || null,
    total_duration: resultScenes.reduce((sum, s) => sum + (s.duration || durationPerScene), 0),
    image_model,
    video_model,
    aspect_ratio,
    props: propsList,
    setting_lock: settingLock,
  };

  fs.writeFileSync(path.join(taskDir, 'result.json'), JSON.stringify(result, null, 2), 'utf8');
  progress('done', 100, '✅ 网剧生成完成！');
  return result;
}

// ═══════════════════════════════════════════════════
// 增强版 TTS：使用对白Agent的音色标注
// ═══════════════════════════════════════════════════
async function agentDramaVoiceEnhanced(scenes, taskDir, voiceProfiles = [], onProgress = null) {
  const { generateSpeech } = require('./ttsService');
  let generated = 0;
  // 统计需要生成语音的场景数
  const voiceScenes = scenes.filter(s => (s.dialogue || '').trim() || (s.narrator || '').trim());
  const totalVoice = voiceScenes.length;
  // 从 voice_profiles 建立角色→音色映射
  const profileMap = {};
  for (const vp of voiceProfiles) {
    profileMap[vp.name] = vp;
  }

  let voiceIdx = 0;
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const text = (scene.dialogue || '').trim() || (scene.narrator || '').trim();
    if (!text) continue;
    voiceIdx++;
    if (onProgress) onProgress(voiceIdx, totalVoice, scene.speaker || '', text);

    const speaker = scene.speaker || '';
    // 优先用对白Agent标注的 voice_config，回退到 voice_profiles，再回退到性别推测
    const vc = scene.voice_config || {};
    const profile = profileMap[speaker] || {};
    let gender = vc.gender || profile.gender || 'female';
    // 最后回退：男性关键词检测
    if (!vc.gender && !profile.gender) {
      const maleHints = /男|父|爹|伯|叔|哥|爷|king|man/i;
      if (maleHints.test(speaker) || maleHints.test(scene.tone || '')) gender = 'male';
    }

    const speed = vc.speed === 'slow' ? 0.9 : vc.speed === 'fast' ? 1.1 : (scene.narrator && !scene.dialogue ? 0.95 : 1.0);
    const voiceId = vc.recommended_voice || null;

    try {
      const outputPath = path.join(taskDir, `voice_${i}.mp3`);
      await generateSpeech(text, outputPath, { gender, speed, voiceId });
      if (fs.existsSync(outputPath)) {
        scene.voice_url = `/api/drama/tasks/${path.basename(taskDir)}/voice/${i}`;
        scene.voice_text = text;
        scene.voice_speaker = speaker;
        generated++;
      }
    } catch (e) {
      console.warn(`[Drama TTS] scene ${i} failed:`, e.message);
      scene.voice_error = e.message;
    }
  }
  return generated;
}

// ═══════════════════════════════════════════════════
// 用户确认等待机制
// ═══════════════════════════════════════════════════
function waitForConfirmation(taskId, progress) {
  return new Promise((resolve) => {
    const taskDir = path.join(DRAMA_DIR, taskId);
    const confirmFile = path.join(taskDir, 'confirm_data.json');
    let checks = 0;
    const maxWait = 600; // 最多等待 10 分钟 (600 × 1s)

    const check = () => {
      checks++;
      try {
        const data = JSON.parse(fs.readFileSync(confirmFile, 'utf8'));
        if (data.confirmed) {
          progress('confirm', 67, '✅ 用户已确认角色，继续生成分镜...');
          resolve(data);
          return;
        }
      } catch {}
      if (checks >= maxWait) {
        // 超时自动确认
        progress('confirm', 67, '⏰ 等待超时，自动确认角色并继续...');
        resolve({});
        return;
      }
      setTimeout(check, 1000);
    };
    check();
  });
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
  agentDramaVoiceEnhanced,
  agentDramaVisualDescriber,
  agentDramaDialogue,
  agentCharacterConsistency,
  injectCharacterLocks,
};
