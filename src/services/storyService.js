require('dotenv').config();
const https = require('https');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

// ───────────────────────────────────────────────
// 强制 KB 全局开关（落盘 outputs/kb_force.json，默认开）
// 与 admin.js 「强制使用 KB」复选框 + /api/admin/knowledgebase/_force 同源
// ───────────────────────────────────────────────
const _KB_FORCE_FILE = path.resolve(__dirname, '../../outputs/kb_force.json');
let _kbForceCache = { val: true, ts: 0 };
function _isKBForced() {
  // 1s 缓存避免 hot path 频繁读盘
  if (Date.now() - _kbForceCache.ts < 1000) return _kbForceCache.val;
  let v = true; // 默认开启（CLAUDE.md 要求"AI 创作时需要强制使用知识库"）
  try {
    if (fs.existsSync(_KB_FORCE_FILE)) {
      v = JSON.parse(fs.readFileSync(_KB_FORCE_FILE, 'utf8')).enabled !== false;
    }
  } catch {}
  _kbForceCache = { val: v, ts: Date.now() };
  return v;
}

// 启发式：根据 systemPrompt 关键词推断 KB scene
function _guessKBScene(sp) {
  if (!sp) return null;
  const s = String(sp);
  if (/分镜|shot ?list|镜头清单|storyboard/i.test(s)) return 'storyboard';
  if (/视频提示词|视频生成|文生视频|i2v|t2v|video.*prompt/i.test(s)) return 'video_prompt';
  if (/导演|镜头|运镜|景别|director/i.test(s)) return 'director';
  if (/角色形象|人物一致|character.*consistency|character.*image/i.test(s)) return 'character_image';
  if (/背景图|场景图|background|环境画/i.test(s)) return 'background_image';
  if (/氛围|atmosphere|颗粒|质感|去 ?ai 味/i.test(s)) return 'image';
  if (/数字人|口播|配音稿|avatar/i.test(s)) return 'digital_human';
  if (/网剧|短剧|集数|多集|episode|drama/i.test(s)) return 'drama';
  if (/编剧|剧本|对白|screenwriter/i.test(s)) return 'screenwriter';
  if (/标题|hashtag|文案|爆款|copy/i.test(s)) return 'copy';
  if (/剪辑|节奏|转场|editor/i.test(s)) return 'editor';
  if (/本地化|海外|localiz/i.test(s)) return 'localize';
  // 视频/图像/通用兜底
  if (/视频/.test(s)) return 'video';
  if (/图像|绘画|插画/.test(s)) return 'image';
  return 'story';
}

// 全局默认文本模型优先级（用户未显式指定模型时生效）
//   1. 漫路（deyunai）聚合平台 · ChatGPT 系列（gpt-4o 优先）
//   2. deepseek
//   3. openai / anthropic / 其他
const PREFERRED_TEXT_PROVIDERS = [
  /^deyunai$|漫路/i,
  /^deepseek$/i,
  /^openai$/i,
  /^anthropic$|claude/i,
  /^zhipu$|智谱/i,
];

// 为一个 provider 挑最好的 story 模型
//   漫路 deyunai 实测可用：qwen3-32b > gemini-3.1-flash-lite-preview > deepseek-r1
//   注意：R1 是推理模型，输出在 reasoning_content（业务层不一定能解析），
//        qwen3-32b 是普通模型 content 直接有内容，优先级最高
function _pickPreferredStoryModel(p) {
  const models = (p.models || []).filter(m => m.enabled !== false && m.use === 'story');
  if (!models.length) return null;
  // 注意：models.find 里拼接的是 "id name"（如 "qwen3-32b Qwen3 32B"），
  //       所以正则不能用 ^...$ 全行锚定，要用 \b 单词边界匹配
  // 漫路实测可用 9 个，按"输出标准 + 速度 + 成本"综合排序：
  const preferred = [
    /^gpt-4o-mini\b/i,                       // 最快+最便宜，默认首选
    /^qwen3-32b\b/i,                         // 国内通道最稳
    /^gpt-4o\b/i,                            // OpenAI 旗舰
    /^claude.*sonnet.*4-6\b/i,               // Claude 4.6
    /^gemini-2\.5-flash\b/i,                 // Gemini Flash
    /^gemini-2\.5-pro\b/i,                   // Gemini Pro
    /^gemini-2\.0-flash\b/i,
    /^gemini-3\.1-flash-lite-preview\b/i,    // 国内通道 Gemini
    /^deepseek-r1\b/i,                       // R1 推理慢，兜底
    // 其他 provider 偏好（非 deyunai 时）
    /chatgpt/i,
    /^deepseek-chat\b/i,
    /^deepseek-v3\b/i,
    /^kimi-k2-instruct\b/i,
    /^claude.*sonnet/i,
  ];
  for (const re of preferred) {
    const m = models.find(x => re.test(x.id + ' ' + (x.name || '')));
    if (m) return m;
  }
  return models[0];
}

// 动态获取故事生成配置：优先读取 settings 中配置的 story 模型，回退到 env vars
function getStoryConfig() {
  try {
    const { loadSettings } = require('./settingsService');
    const settings = loadSettings();
    const candidates = (settings.providers || []).filter(p => p.enabled && p.api_key && (p.models || []).some(m => m.enabled !== false && m.use === 'story'));
    // 按优先级关键词排序
    candidates.sort((a, b) => {
      const scoreOf = (p) => {
        const hay = (p.id || '') + ' ' + (p.preset || '') + ' ' + (p.name || '');
        for (let i = 0; i < PREFERRED_TEXT_PROVIDERS.length; i++) {
          if (PREFERRED_TEXT_PROVIDERS[i].test(hay)) return i;
        }
        return 999;
      };
      return scoreOf(a) - scoreOf(b);
    });
    for (const provider of candidates) {
      const model = _pickPreferredStoryModel(provider);
      if (model) return { apiKey: provider.api_key, baseURL: provider.api_url, model: model.id, providerId: provider.id };
    }
  } catch {}
  // Fallback to env vars
  if (process.env.DEEPSEEK_API_KEY) return { apiKey: process.env.DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-chat', providerId: 'deepseek' };
  if (process.env.OPENAI_API_KEY)   return { apiKey: process.env.OPENAI_API_KEY,   baseURL: null,                               model: 'gpt-4o',          providerId: 'openai'   };
  if (process.env.CLAUDE_API_KEY)   return { apiKey: process.env.CLAUDE_API_KEY,   baseURL: 'https://api.anthropic.com/v1',     model: 'claude-sonnet-4-6', providerId: 'anthropic' };
  return null;
}

// Anthropic Messages API（非 OpenAI 兼容）
// 返回 { text, usage: { input_tokens, output_tokens } }
function callAnthropicLLM(config, systemPrompt, userPrompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: config.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body)
      }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          if (data.error) return reject(new Error(`Anthropic: ${data.error.message}`));
          resolve({
            text: data.content[0].text,
            usage: {
              input_tokens: data.usage?.input_tokens || 0,
              output_tokens: data.usage?.output_tokens || 0,
            },
          });
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * 统一 LLM 调用入口（自动记录到 tokenTracker）
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {object} [opts] - { agentId?, userId?, requestId? } 追踪上下文
 * @returns {string} 响应文本
 */
async function callLLM(systemPrompt, userPrompt, opts = {}) {
  const config = getStoryConfig();
  if (!config) throw new Error('未配置 AI 供应商，请在「AI 配置」页面添加供应商并设置 story 模型');

  // v9: 自动注入 KB 上下文
  //   模式1: 显式 opts.kb = { scene, query } → 按 scene 映射 agents 注入
  //   模式2: 仅 opts.agentId → 按该 agent 的 KB 注入（向后兼容 agentOrchestrator）
  //   模式3 [v12 强制 KB]：无 opts.kb / opts.agentId 时按 systemPrompt 关键词启发式注入
  try {
    const kb = require('./knowledgeBaseService');
    let kbCtx = '';
    const alreadyInjected = /【(?:知识库上下文|动态检索到的知识|[^】]+?全量知识库)/.test(systemPrompt);

    if (opts.kb && opts.kb.scene) {
      kbCtx = kb.injectKB({
        scene: opts.kb.scene,
        query: opts.kb.query || userPrompt,
        limit: opts.kb.limit || 4,
        maxCharsPerDoc: opts.kb.maxCharsPerDoc || 500,
      });
    } else if (opts.agentId) {
      if (!alreadyInjected) {
        kbCtx = kb.searchForAgent(opts.agentId, userPrompt, { limit: 3, maxCharsPerDoc: 400 }) || '';
      }
    } else if (!alreadyInjected && opts.skipKB !== true && _isKBForced()) {
      // 强制使用 KB：根据 systemPrompt 启发式选 scene
      const scene = _guessKBScene(systemPrompt);
      if (scene) {
        kbCtx = kb.injectKB({ scene, query: userPrompt, limit: 4, maxCharsPerDoc: 500 }) || '';
      }
    }
    if (kbCtx) {
      systemPrompt = `${kbCtx}\n\n${systemPrompt}\n\n（请深度学习上方知识库内容，在你的输出中自然体现这些专业手法和专业术语）`;
    }
  } catch (e) {
    console.warn('[callLLM] KB 注入失败:', e.message);
  }

  const tracker = (() => { try { return require('./tokenTracker'); } catch { return null; } })();
  const startTime = Date.now();
  let inputTokens = 0, outputTokens = 0, status = 'success', errorMsg = null, text = '';

  try {
    if (config.providerId === 'anthropic') {
      const { text: t, usage } = await callAnthropicLLM(config, systemPrompt, userPrompt);
      text = t;
      inputTokens = usage.input_tokens;
      outputTokens = usage.output_tokens;
    } else {
      const sdkOpts = { apiKey: config.apiKey };
      if (config.baseURL) sdkOpts.baseURL = config.baseURL;

      // 漫路（deyunai）双通道路由：
      //   - 国内模型走 /v1（默认 baseURL = https://api.deyunai.com/v1）
      //   - 海外模型走 /c35/v1（OpenAI/Claude/Gemini 等需走中转通道，并加 vendor header）
      // 模型 channel 由 settings.json 模型项的 'channel' 字段标注（'cn' / 'overseas'）
      const _isDeyunai = config.providerId === 'deyunai' || /deyunai|漫路/i.test(config.providerId || '');
      let _vendorHeader = null;
      if (_isDeyunai) {
        // 模型名启发式：含 gpt/claude/gemini/o1/grok 等海外品牌 → 走 c35
        const m = String(config.model || '').toLowerCase();
        const isOverseas = config.channel === 'overseas'
          || /^gpt-|^o[1-9]|^claude-|^gemini-(?!3\.1-flash-lite-preview)|^grok-/i.test(m);
        if (isOverseas && config.baseURL && !config.baseURL.includes('/c35/')) {
          // 把 https://api.deyunai.com/v1 → https://api.deyunai.com/c35/v1
          sdkOpts.baseURL = config.baseURL.replace(/\/v1\/?$/, '/c35/v1');
          _vendorHeader = { vendor: 'API_VENDOR' };
          console.log(`[deyunai] 海外模型 ${config.model} 切到 ${sdkOpts.baseURL}`);
        }
      }
      // 把 vendor header 注入 SDK（OpenAI SDK v4 支持 defaultHeaders）
      if (_vendorHeader) sdkOpts.defaultHeaders = _vendorHeader;

      const client = new OpenAI(sdkOpts);
      let completion = await client.chat.completions.create({
        model: config.model,
        max_tokens: 4096,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      });
      // 漫路 (deyunai) 等聚合平台有时把 chat.completions 返回成"字符串化的 JSON"而不是对象
      //   ↓ 检测到字符串先 JSON.parse 一下，恢复成标准结构
      if (typeof completion === 'string') {
        try { completion = JSON.parse(completion); }
        catch (_) { /* 留给下面 defensive 检查抛错 */ }
      }
      // 推理类模型（DeepSeek-R1 / Gemini-3.x-thinking）输出在 reasoning_content 而非 content
      // → fallback 同时读 content + reasoning_content
      const _msg = completion?.choices?.[0]?.message;
      const _content = _msg?.content || _msg?.reasoning_content || '';
      if (!completion?.choices?.length || !_content) {
        const raw = (typeof completion === 'string' ? completion : JSON.stringify(completion || {})).slice(0, 300);
        throw new Error(`LLM 返回异常（${config.providerId}/${config.model}），无 choices 内容。原始响应: ${raw}`);
      }
      text = _content;
      inputTokens = completion.usage?.prompt_tokens || 0;
      outputTokens = completion.usage?.completion_tokens || 0;
    }
    return text;
  } catch (e) {
    status = 'fail';
    errorMsg = e.message;
    // 失败也要估算一个 input token（用字符数/4 粗略估算）
    inputTokens = Math.ceil((String(systemPrompt).length + String(userPrompt).length) / 4);
    throw e;
  } finally {
    if (tracker) {
      try {
        tracker.record({
          provider: config.providerId,
          model: config.model,
          category: 'llm',
          inputTokens,
          outputTokens,
          durationMs: Date.now() - startTime,
          status,
          errorMsg,
          userId: opts.userId,
          agentId: opts.agentId,
          requestId: opts.requestId,
        });
      } catch {}
    }
  }
}

// 导出供 server.js health 使用
function getStoryInfo() {
  const config = getStoryConfig();
  if (!config) return { provider: 'none', model: 'none' };
  return { provider: config.providerId, model: config.model };
}

function parseJSON(raw) {
  let str = raw.trim();
  // 去掉 markdown 代码块（含未闭合的情况）
  const m = str.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) {
    str = m[1].trim();
  } else if (str.startsWith('```')) {
    str = str.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
  }
  // 提取第一个 { ... } 块
  const start = str.indexOf('{');
  const end = str.lastIndexOf('}');
  if (start !== -1 && end > start) str = str.slice(start, end + 1);
  return JSON.parse(str);
}

const SCENE_JSON_SCHEMA = `{
  "title": "视频标题",
  "synopsis": "100字以内故事简介",
  "full_script": "完整剧本",
  "characters": [
    { "name": "角色名", "role": "main或supporting", "appearance": "详细外貌特征：发型发色、脸型五官、体型身高、服装款式和颜色、配饰（必须足够具体，用于生成角色设定图，80-150字）" }
  ],
  "scenes": [
    {
      "index": 1,
      "title": "场景标题",
      "duration": 10,
      "location": "场景地点（简短）",
      "background": "纯环境背景描述（不含人物！）：具体地点、环境物体细节、时间（白天/黄昏/夜晚）、天气、光线方向和颜色、氛围。像给画家看的场景说明，要能直接画出来（用中文，80-150字）",
      "time_of_day": "白天",
      "characters_in_scene": ["角色名"],
      "characters_action": "该场景中角色的具体动作、表情、互动（用中文，50-100字）",
      "action": "场景动作描述（中文，具体描述角色的肢体动作、移动轨迹、攻防交互）",
      "action_type": "场景动作类型，必须为以下之一：normal（日常对话/静态场景）| combat（近身格斗/武术对决/拳脚搏击）| ranged（远程攻击/枪战/魔法对射）| chase（追逐/飞车/逃跑）| explosion（爆炸/大规模破坏/坍塌）| power（能量爆发/变身/大招释放）| stealth（潜行/暗杀/偷袭）| aerial（空战/飞行/高空坠落）",
      "vfx": ["场景需要的视觉特效标签数组，可选值：shockwave（冲击波）| sparks（火花飞溅）| debris（碎片飞散）| energy_burst（能量爆发）| speed_lines（速度线）| impact_flash（打击闪光）| dust_cloud（烟尘）| fire（火焰）| lightning（闪电）| blood（血雾，慎用）| water_splash（水花）| screen_shake（镜头震动）| slow_motion（慢动作）| afterimage（残影）| particle_trail（粒子拖尾）| aura_glow（气场光晕）| ground_crack（地面龟裂）| explosion_ring（爆炸环）| lens_flare（镜头光晕）| motion_blur（运动模糊）| sword_qi（剑气/刀光）| qi_flow（灵力/真气流动）| ink_splash（水墨泼溅）| celestial_light（天光/仙光）"],
      "dialogue": "对白（可为空）",
      "mood": "场景氛围",
      "camera": "镜头运动描述（如：从远景推进到特写 / 跟拍横移 / 低角度仰拍 / 环绕 360 度 / 子弹时间环绕 / 高速跟拍）",
      "visual_prompt": "中文视频画面描述：镜头类型+运动方向、光线方向+强度、人物具体动作姿态+运动轨迹、冲击特效+粒子效果、环境互动、画面风格。（用中文，100-200字，要足够详细以直接用于视频生成）"
    }
  ]
}`;

// 渲染维度提示文本
function buildDimHint(scene_dim, char_dim) {
  const s = scene_dim === '3d' ? '三维立体3D场景，volumetric 空间感' : '二维平面2D场景，flat 构图';
  const c = char_dim === '3d' ? '3D建模角色，写实质感' : '2D手绘动画角色，cel-shaded';
  return `场景：${s}；人物：${c}`;
}

// 动作/打斗场景专用视觉提示词增强
function buildActionHint(genre, theme, animStyle) {
  const textToCheck = [genre, theme, animStyle].filter(Boolean).join(' ');
  const isAction = /动作|武侠|打斗|战斗|格斗|功夫|热血|战争|武术|搏击|忍者|机甲|决斗|对决|追击|刺客|仙侠|修仙|剑|玄幻|修真|江湖|门派|宗门|battle|action|fight|combat|martial|wuxia|xianxia|cultivation/i.test(textToCheck);
  if (!isAction) return '';
  return `
【打斗/动作场景生成规范】（极其重要，直接影响视频质量）

1. 场景节奏设计（每个动作场景必须包含以下节奏变化）：
   - 蓄力期：角色准备姿态、武器出鞘、能量积蓄（slow build-up, anticipation pose）
   - 爆发期：连续攻击、高速移动、碰撞冲击（burst of action, rapid strikes）
   - 冲击瞬间：打击命中的关键帧、冲击波、碎片飞溅（impact frame, shockwave）
   - 间歇/反应：受创反应、距离拉开、重新站定（reaction shot, recovery moment）

2. action_type 分类规范（根据场景内容精确选择）：
   - combat：近身格斗，拳脚交锋，刀剑对决，武术搏击，仙侠剑法对决，内力对掌
   - ranged：远程攻击，枪战对射，弓箭齐射，魔法弹幕，法术对轰，灵力远程打击
   - chase：追逐戏，飞车追击，巷道奔跑，高速穿梭，轻功追逐，御剑飞行追击
   - explosion：大规模爆炸，建筑坍塌，炸弹冲击，能量碰撞，法宝自爆，天劫降临
   - power：能量爆发，变身蓄力，大招释放，觉醒时刻，修仙突破境界，功法大成，灵力觉醒
   - stealth：潜行暗杀，偷袭伏击，无声击杀，暗器偷袭，影遁术
   - aerial：空中战斗，飞行追逐，高空坠落，太空作战，御剑飞行空战，腾云驾雾
   - normal：非动作场景，日常对话，静态画面，修炼打坐，宗门日常

3. vfx 视觉特效标签规范（每个动作场景至少标注 3-5 个特效）：
   combat 场景常用：[shockwave, sparks, impact_flash, speed_lines, dust_cloud, afterimage, ground_crack]
   ranged 场景常用：[energy_burst, particle_trail, explosion_ring, lens_flare, fire, lightning]
   chase 场景常用：[speed_lines, motion_blur, dust_cloud, sparks, debris]
   explosion 场景常用：[explosion_ring, debris, fire, shockwave, screen_shake, dust_cloud, ground_crack]
   power 场景常用：[aura_glow, energy_burst, lightning, particle_trail, screen_shake, slow_motion]
   stealth 场景常用：[motion_blur, afterimage, impact_flash, slow_motion]
   aerial 场景常用：[speed_lines, motion_blur, particle_trail, lens_flare, dust_cloud]

4. visual_prompt 动作场景必写要素（全部用中文描述）：
   - 镜头类型：动态跟拍 / 低角度仰拍 / 快速横摇 / 过肩打击镜头 / 战场全景俯瞰 / 冲击瞬间极近特写 / 子弹时间360度环绕 / 摇臂俯冲
   - 运动模糊：速度线、肢体运动模糊、残影拖尾、鬼影回声效果
   - 冲击特效：冲击波环、碎片爆炸、地面龟裂、火花飞溅、能量爆发、镜头震动
   - 打击反馈：白光闪帧、冲击波变形、汗珠/血雾粒子、衣物撕裂、落地烟尘
   - 光影戏剧性：轮廓光、碎片中的体积光、力量释放时的逆光剪影、霓虹能量辉光
   - 环境互动：被打穿的墙壁/地面、断裂的武器、飞散的碎石、水花溅射、火焰蔓延
   - 角色表现：坚毅的表情、战斗姿态、动态的身体角度（绝不静止T-pose）、肌肉绷紧、风吹头发/衣物

5. 镜头编排规则：
   - 场景1 → 远景建立战场空间（广角全景展示场地）
   - 场景2-N → 中近景交替：中景（连招连贯）↔ 特写（表情+冲击细节）↔ 广角（展示位移和环境破坏）
   - 高潮场景 → 先极近特写蓄力，再突然切到广角展示全力一击的冲击波
   - 结尾 → 烟尘中的剪影或特写表情

6. 禁止事项：
   - 禁止静止站立的画面、禁止 T-pose、禁止角色面朝镜头摆 pose
   - 每个场景画面中必须有明确的运动轨迹或冲击瞬间
   - 不要用"两个角色面对面站着"这种静态描述，要用"角色A飞身旋踢，角色B举臂格挡"这种动态描述`;
}

// ——— 快速模式：只需主题 ———
async function generateStory({ theme, genre, duration, language = '中文', scene_dim = '2d', char_dim = '2d', anim_style = '' }) {
  // 根据目标时长合理分配场景数和每场景时长（视频模型单片段通常5-10秒）
  const sceneCount = Math.max(3, Math.round(duration / 10));
  const dimHint = buildDimHint(scene_dim, char_dim);
  const styleHint = anim_style ? `\n画面风格：${anim_style}（visual_prompt 中必须体现此画面风格）` : '';
  const actionHint = buildActionHint(genre, theme, anim_style);
  let slangContext = '';
  try { const { buildSlangContext } = require('./slangService'); slangContext = buildSlangContext(theme); } catch {}
  const perScene = Math.round(duration / sceneCount);
  // 知识库注入：编剧 + 艺术总监 + 氛围 + 分镜 + 文案 + 市场调研（6 层创作视角）
  let kbContext = '';
  try {
    const kb = require('./knowledgeBaseService');
    const parts = [
      kb.buildAgentContext('screenwriter', { genre: genre || theme, maxDocs: 2 }),
      kb.buildAgentContext('art_director', { genre: genre || theme, maxDocs: 1 }),
      kb.buildAgentContext('atmosphere', { genre, maxDocs: 2 }),
      kb.buildAgentContext('storyboard', { genre, maxDocs: 2 }),
      kb.buildAgentContext('copywriter', { genre, maxDocs: 1 }),
      kb.buildAgentContext('market_research', { genre: genre || theme, maxDocs: 1 }),
    ].filter(Boolean);
    if (parts.length) kbContext = '\n\n' + parts.join('\n\n');
  } catch (e) { /* ignore */ }
  const systemPrompt = `你是专业影视编剧和概念美术师，严格按 JSON 格式输出，不要任何额外内容。

关键规则：
1. characters 的 appearance（外貌特征）: 必须详细描述发型发色、脸型五官、体型身高、服装款式颜色、配饰等可视化特征（80-150字），这是生成角色设定图的关键信息。
2. background（背景）: 只描述纯粹的环境场景画面，绝对不能包含任何人物。要详细描绘：具体地点、时间、天气、光线方向和颜色、环境物体细节、氛围感（80-150字），像给画家看的场景说明。
3. visual_prompt（视频画面描述）: 用中文详细描述镜头类型+运动、光影效果、人物动作、画面氛围（100-200字），直接用于视频生成。
4. characters_action（角色动作）: 描述角色在该场景中的具体动作、肢体语言、表情、互动关系（50-100字）。${kbContext}`;
  const userPrompt = `创作视频剧本：
主题：${theme}
风格：${genre}
总时长：${duration}秒，分为 ${sceneCount} 个场景，每个场景约 ${perScene} 秒（所有场景 duration 之和必须等于 ${duration}）
语言：${language}${styleHint}
渲染维度：${dimHint}（visual_prompt 中必须体现此渲染风格）${actionHint}${slangContext}

【重要】每个场景的 visual_prompt 必须用中文描述，必须全程保持完全一致的画面风格（${dimHint}），禁止在不同场景中切换 2D/3D 风格。

直接输出 JSON：
${SCENE_JSON_SCHEMA}`;

  try { return parseJSON(await callLLM(systemPrompt, userPrompt)); }
  catch { throw new Error('剧情生成失败：AI 返回格式异常，请重试'); }
}

// ——— 自定义模式：用户填写结构 ———
async function generateStoryCustom({ title, genre, duration, language = '中文', characters, plot, style_notes, custom_scenes, scene_dim = '2d', char_dim = '2d', anim_style = '' }) {
  const sceneCount = custom_scenes?.length || Math.max(3, Math.round(duration / 10));
  const hasChars = characters?.length > 0;
  const charAppearanceHint = hasChars
    ? `\n【关键要求 - 角色视觉一致性】：
对于每个场景的 visual_prompt，必须包含该场景中出场角色的完整外貌描述（不能仅写角色名，必须直接描写外貌细节：发型/发色、服装颜色与款式、体型、面部特征、种族特征等），确保每个场景中同一角色的外貌描述保持一致。
角色外貌参考：
${characters.map(c => {
  const parts = [`${c.name}`];
  if (c.description) parts.push(c.description);
  if (c.race && c.race !== '人') parts.push(`种族：${c.race}`);
  if (c.species) parts.push(`物种：${c.species}`);
  if (c.imageUrl) parts.push('[已有参考形象图，严格按照描述保持一致]');
  return '- ' + parts.join('，');
}).join('\n')}`
    : '';
  const charNameRule = hasChars
    ? `\n【角色名称规范 — 极其重要】：必须使用用户定义的角色原名，禁止修改、缩写、替换角色名。用户角色列表：${characters.map(c => `"${c.name}"`).join('、')}。scenes 中的 characters 数组必须使用这些原名。`
    : '';
  const systemPrompt = `你是专业影视编剧，严格按 JSON 格式输出，不要任何额外内容。${charAppearanceHint}${charNameRule}`;

  const charText = characters?.length
    ? `\n角色（必须使用原名，禁止改名、缩写或替换）：\n${characters.map(c => {
        let desc = `- ${c.name}（${c.role}）：${c.description || ''}`;
        if (c.race && c.race !== '人') desc += `，种族：${c.race}`;
        if (c.species) desc += `（${c.species}）`;
        if (c.imageUrl) desc += ' [已有参考形象图]';
        return desc;
      }).join('\n')}`
    : '';

  const plotText = plot ? `\n剧情结构：
- 开头：${plot.beginning || ''}
- 发展：${plot.middle || ''}
- 结尾：${plot.ending || ''}` : '';

  const styleText = style_notes ? `\n创作风格/特别要求：${style_notes}` : '';
  const animStyleText = anim_style ? `\n画面风格：${anim_style}（visual_prompt 中必须体现此画面风格）` : '';
  const dimText = `\n渲染维度：${buildDimHint(scene_dim, char_dim)}（visual_prompt 中必须体现）`;
  const actionHint = buildActionHint(genre, title, anim_style);

  const scenesHint = custom_scenes?.length
    ? `\n【用户预设场景 — 必须严格遵守，禁止修改】
以下是用户指定的 ${custom_scenes.length} 个场景，你必须：
① 场景数量必须恰好为 ${custom_scenes.length} 个，不多不少
② 每个场景的 title 必须与用户给定的标题完全一致，一字不改
③ 场景顺序必须与用户给定的顺序完全一致
④ 只需在用户描述的基础上补充 action / visual_prompt / camera / dialogue 等细节
⑤ 禁止自行添加、删除、合并或拆分场景
⑥ 禁止修改场景标题（即使你觉得有更好的标题也不要改）

用户指定的场景：
${custom_scenes.map((s, i) => {
        const parts = [s.description];
        if (s.location) parts.push(`地点：${s.location}`);
        if (s.mood) parts.push(`氛围：${s.mood}`);
        if (s.timeOfDay) parts.push(`时间：${s.timeOfDay}`);
        return `${i + 1}. 标题="${s.title}"：${parts.filter(Boolean).join('，')}`;
      }).join('\n')}`
    : `\n场景数量：${sceneCount}个`;

  const perScene = Math.round(duration / sceneCount);
  const dimHintFull = buildDimHint(scene_dim, char_dim);
  const userPrompt = `根据用户详细设定创作视频剧本：
标题（参考）：${title || '（由AI命名）'}
风格：${genre}
总时长：${duration}秒，分为 ${sceneCount} 个场景，每个场景约 ${perScene} 秒（所有场景 duration 之和必须等于 ${duration}）${charText}${plotText}${styleText}${animStyleText}${dimText}${actionHint}${scenesHint}

【重要】每个场景的 visual_prompt 必须全程保持完全一致的画面风格（${dimHintFull}），禁止在不同场景中切换 2D/3D 风格。
${custom_scenes?.length ? `【再次强调】scenes 数组必须恰好 ${custom_scenes.length} 个元素，每个场景的 title 必须与上方用户指定的标题完全一致，禁止擅自修改。` : ''}
直接输出 JSON：
${SCENE_JSON_SCHEMA}`;

  try {
    const kbQuery = [title, genre, plot, style_notes].filter(Boolean).join(' ');
    const result = parseJSON(await callLLM(systemPrompt, userPrompt, { kb: { scene: 'story', query: kbQuery, limit: 4 } }));
    // 后处理：强制修正场景标题、数量和角色名，防止 AI 擅自修改
    if (custom_scenes?.length && result.scenes?.length) {
      // 修正场景数量：截断多余
      if (result.scenes.length > custom_scenes.length) {
        console.warn(`[StoryService] AI 生成了 ${result.scenes.length} 个场景，用户要求 ${custom_scenes.length} 个，截断多余场景`);
        result.scenes = result.scenes.slice(0, custom_scenes.length);
      }
      // 修正场景标题：强制使用用户指定的标题
      for (let i = 0; i < Math.min(result.scenes.length, custom_scenes.length); i++) {
        if (result.scenes[i].title !== custom_scenes[i].title) {
          console.warn(`[StoryService] 修正场景 ${i + 1} 标题: "${result.scenes[i].title}" → "${custom_scenes[i].title}"`);
          result.scenes[i].title = custom_scenes[i].title;
        }
        result.scenes[i].index = i + 1;
        // 修正场景中引用的地点：如果用户指定了地点
        if (custom_scenes[i].location && !result.scenes[i].location?.includes(custom_scenes[i].location)) {
          result.scenes[i].location = custom_scenes[i].location;
        }
      }
    }
    // 后处理：修正角色名（AI 可能擅自改名）
    if (characters?.length && result.scenes?.length) {
      const userCharNames = characters.map(c => c.name);
      for (const scene of result.scenes) {
        if (!scene.characters?.length) continue;
        // 在 action/dialogue/visual_prompt 中找到 AI 编造的名字并替换回用户原名
        const aiNames = scene.characters.filter(n => !userCharNames.includes(n));
        if (aiNames.length > 0) {
          console.warn(`[StoryService] 检测到 AI 编造角色名: [${aiNames.join(', ')}]，尝试匹配替换`);
          // 尝试通过角色描述/角色关系匹配，如果无法匹配则按顺序替换
          for (const aiName of aiNames) {
            // 简单匹配：角色列表中未使用的名字按相似度替换
            const usedNames = scene.characters.filter(n => userCharNames.includes(n));
            const unusedUserNames = userCharNames.filter(n => !usedNames.includes(n));
            if (unusedUserNames.length > 0) {
              const replacement = unusedUserNames[0];
              console.warn(`[StoryService] 角色名替换: "${aiName}" → "${replacement}"`);
              const idx = scene.characters.indexOf(aiName);
              if (idx !== -1) scene.characters[idx] = replacement;
              // 在文本字段中也替换
              for (const field of ['action', 'dialogue', 'visual_prompt', 'mood', 'camera']) {
                if (scene[field] && typeof scene[field] === 'string') {
                  scene[field] = scene[field].split(aiName).join(replacement);
                }
              }
            }
          }
        }
      }
    }
    return result;
  }
  catch { throw new Error('剧情生成失败：AI 返回格式异常，请重试'); }
}

async function refineScene(scene, userFeedback) {
  const raw = await callLLM(
    `专业影视编剧，根据反馈优化场景，直接输出 JSON。`,
    `原场景：\n${JSON.stringify(scene, null, 2)}\n\n反馈：${userFeedback}\n\n输出修改后 JSON：`,
    { kb: { scene: 'story', query: `${scene.title || ''} ${userFeedback}`, limit: 3 } }
  );
  return parseJSON(raw);
}

// ——— 从剧本解析角色和场景 ———
async function parseScript({ script, genre = 'drama', duration = 60 }) {
  const sceneCount = Math.max(3, Math.floor(duration / 10));
  const systemPrompt = `你是专业影视分镜师和概念美术师。从用户的剧本中精准提取角色和分镜信息。

关键规则：
1. background（背景）: 只描述纯粹的环境场景画面，绝对不能包含任何人物。要详细描绘：具体地点（如"月光下的古老榕树，巨大的树冠遮蔽天空"）、时间（白天/黄昏/夜晚）、天气、光线方向和颜色、环境物体细节、氛围感。描述要像在给画家看的场景说明，让人能直接画出来。
2. characters_action（角色动作）: 描述角色在该场景中的具体动作、肢体语言、表情、互动关系。
3. characters 的 appearance（外貌特征）: 必须详细描述发型发色、脸型五官、体型身高、服装款式颜色、配饰等可视化外貌特征，这是用于生成角色设定图的关键信息。
4. 严格按 JSON 格式输出，不要任何额外内容。`;

  const userPrompt = `从以下剧本中提取角色列表和分镜列表（拆分为 ${sceneCount} 个场景）：

剧本内容：
${script.substring(0, 4000)}

直接输出 JSON：
{
  "characters": [
    { "name": "角色名", "role": "main", "description": "角色性格和背景", "appearance": "详细外貌特征：发型发色、脸型、眼睛颜色、体型、身高、服装款式和颜色、配饰（必须足够具体，用于生成角色设定图）" }
  ],
  "scenes": [
    {
      "title": "场景标题",
      "background": "纯环境背景描述（不含人物！）：具体地点、环境物体细节、时间（白天/黄昏/夜晚）、天气、光线方向和颜色、氛围。像给画家看的场景说明，要能直接画出来（用中文，80-150字）",
      "characters_action": "该场景中角色的具体动作、表情、互动（用中文，50-100字）",
      "characters_in_scene": ["出场角色名1", "出场角色名2"],
      "dialogue": "台词（如有）",
      "camera": "镜头运动：如 特写/中景/远景/推近/拉远/环绕/俯拍/仰拍",
      "mood": "场景情绪氛围",
      "duration": 10
    }
  ]
}

role 只能是：main（主角）、supporting（配角）、villain（反派）、mentor（导师）、other（其他）`;

  try { return parseJSON(await callLLM(systemPrompt, userPrompt)); }
  catch { throw new Error('剧本解析失败：AI 返回格式异常，请重试'); }
}

// ═══ 长篇剧情动画 - 中国国风专用 ═══

// 中国动画风格生成增强提示词
const CHINESE_STYLE_HINTS = {
  xianxia: {
    worldview: '仙侠修真世界观：凡人修仙、筑基→金丹→元婴→化神→大乘→渡劫飞升，宗门体系（外门弟子→内门弟子→核心弟子→长老→掌门），灵力/仙力/法宝/丹药/阵法/天劫',
    combatStyle: '仙侠战斗风格：御剑飞行、法术对轰（五行法术：金木水火土）、法宝碰撞（飞剑/灵器/仙器）、领域对抗、天劫降临、神通大战（大挪移/缩地成寸/天眼通）',
    visualStyle: '画面风格：浮空仙山、云海翻涌、灵气可视化（光点/光柱/光环）、法阵光效、剑气如虹、雷劫紫电、金光护体、仙鹤瑞兽',
    references: '参考作品：《完美世界》《一念永恒》《仙逆》《凡人修仙传》《斗破苍穹》'
  },
  wuxia: {
    worldview: '武侠江湖世界观：江湖门派（少林/武当/峨眉/华山/丐帮）、武功秘籍、内功心法、侠义精神、恩怨情仇、比武招亲、武林大会',
    combatStyle: '武侠战斗风格：轻功飞檐走壁、内力对掌（掌风可视化）、剑法（快剑/重剑/柔剑）、暗器（飞镖/袖箭/毒针）、点穴/解穴、以气御剑',
    visualStyle: '画面风格：竹林/古镇/客栈/烟雨江南、衣袂飘飘、剑光掠影、落叶飞花、墨迹飞溅、月下决斗',
    references: '参考作品：《斗罗大陆》《武动乾坤》《画江湖》系列'
  },
  guoman: {
    worldview: '现代国漫世界观：可融合多元元素（玄幻/科幻/都市/历史），注重角色成长线和情感刻画',
    combatStyle: '国漫战斗风格：流畅的打斗编排、冲击感极强的碰撞特效、慢动作关键帧、速度线和残影、能量波对撞、华丽连招',
    visualStyle: '画面风格：高饱和度色彩、精致人设、华丽特效、电影级分镜、动态虚化背景、粒子特效',
    references: '参考作品：《凡人修仙传》《灵笼》《时光代理人》《雾山五行》'
  },
  guofeng_3d: {
    worldview: '3D国风世界观：高精度3D建模的中国古典/玄幻世界，写实与美化并重',
    combatStyle: '3D国风战斗风格：物理引擎加持的碰撞效果、布料飘动、头发物理、武器光效、环境破坏、3D摄影机运动（环绕/俯冲/穿越）',
    visualStyle: '画面风格：PBR材质渲染、体积光/体积雾、SSS皮肤、动态模糊、景深虚化、HDR光照',
    references: '参考作品：《完美世界》《吞噬星空》《武动乾坤》《斗破苍穹》3D版'
  },
  ink_battle: {
    worldview: '水墨战斗世界观：古典中国画风的动态打斗，黑白水墨为主，点缀朱红/金色',
    combatStyle: '水墨战斗风格：泼墨式冲击波、笔触轨迹的剑气、墨点飞溅代替血液、留白营造空间感、浓淡变化表现远近',
    visualStyle: '画面风格：宣纸质感、毛笔飞白效果、水墨晕染过渡、印章红色点缀、山水远景',
    references: '参考作品：《雾山五行》《中国奇谭》《大圣归来》'
  }
};

/**
 * 长篇剧情动画生成 - 支持分集/分章节
 * 中国国风动画制作模式：按"集"为单位，每集包含起承转合
 */
async function generateLongStory({
  theme, genre, duration, language = '中文',
  scene_dim = '2d', char_dim = '2d', anim_style = '',
  episode_count = 1, episode_index = 1,
  characters = [], plot = {},
  previous_summary = '', style_notes = ''
}) {
  const styleKey = anim_style || '';
  const chineseHint = CHINESE_STYLE_HINTS[styleKey] || null;

  // 长篇集数设定
  const isMultiEpisode = episode_count > 1;
  const sceneCount = Math.max(4, Math.round(duration / 8)); // 长篇每场景稍短，更紧凑
  const perScene = Math.round(duration / sceneCount);
  const dimHint = buildDimHint(scene_dim, char_dim);

  const actionHint = buildActionHint(genre, theme, anim_style);

  // 中国动画风格专用提示
  let chineseStylePrompt = '';
  if (chineseHint) {
    chineseStylePrompt = `
【中国动画风格规范 — 极其重要】
${chineseHint.worldview}
${chineseHint.combatStyle}
${chineseHint.visualStyle}
${chineseHint.references}

中国动画叙事节奏要求：
- 起（铺垫）：环境建立 + 角色登场，占 20% 场景
- 承（发展）：冲突推进 + 角色互动 + 情感铺垫，占 30% 场景
- 转（高潮）：核心战斗/转折事件 + 大量动作场景 + 华丽特效，占 35% 场景
- 合（收尾）：结局/悬念/下集预告，占 15% 场景

国漫角色塑造要求：
- 主角必须有明确的成长弧线或觉醒时刻
- 反派不能是纯粹的恶，要有动机和深度
- 师徒/兄弟/宿敌关系要有情感张力
- 台词要有中国式的哲理或江湖气（避免日系或西式口吻）`;
  }

  // 多集连贯性提示
  let episodePrompt = '';
  if (isMultiEpisode) {
    episodePrompt = `
【长篇连续剧设定】
总集数：${episode_count} 集
当前：第 ${episode_index} 集
${previous_summary ? `前情提要：${previous_summary}` : ''}
${episode_index === 1 ? '要求：第1集需要建立世界观、引入主要角色、制造初始冲突/悬念' : ''}
${episode_index === episode_count ? '要求：最终集需要解决核心冲突、角色弧线收束、给出完满或开放式结局' : ''}
${episode_index > 1 && episode_index < episode_count ? '要求：承接前集剧情，推进主线发展，每集结尾留下悬念引导下集' : ''}
- 每集必须有独立的小高潮，不能只是过渡
- 角色发展要在每集中有可见的变化`;
  }

  // 角色描述
  const charText = characters.length
    ? `\n角色列表：\n${characters.map(c => {
        let desc = `- ${c.name}（${c.role || '角色'}）：${c.description || ''}`;
        if (c.race && c.race !== '人') desc += `，种族：${c.race}`;
        return desc;
      }).join('\n')}`
    : '';

  // 剧情提示
  const plotText = plot.beginning || plot.middle || plot.ending
    ? `\n剧情结构：\n- 开头：${plot.beginning || ''}\n- 发展：${plot.middle || ''}\n- 结尾：${plot.ending || ''}`
    : '';

  const systemPrompt = `你是专业中国动画编剧，精通国产动画的叙事节奏和视觉风格。严格按 JSON 格式输出，不要任何额外内容。`;

  const userPrompt = `创作${isMultiEpisode ? `第${episode_index}集` : ''}视频剧本：
主题：${theme}
风格：${genre}
${isMultiEpisode ? `第 ${episode_index}/${episode_count} 集，` : ''}总时长：${duration}秒，分为 ${sceneCount} 个场景，每个场景约 ${perScene} 秒（所有场景 duration 之和必须等于 ${duration}）
语言：${language}
画面风格：${anim_style}（visual_prompt 中必须体现此画面风格）
渲染维度：${dimHint}（visual_prompt 中必须体现此渲染风格）${charText}${plotText}
${style_notes ? `创作要求：${style_notes}` : ''}${chineseStylePrompt}${episodePrompt}${actionHint}

【重要】每个场景的 visual_prompt 必须全程保持完全一致的画面风格（${dimHint}），禁止在不同场景中切换 2D/3D 风格。

直接输出 JSON：
${SCENE_JSON_SCHEMA}`;

  try {
    const kbQuery = [theme, genre, anim_style, style_notes].filter(Boolean).join(' ');
    const result = parseJSON(await callLLM(systemPrompt, userPrompt, { kb: { scene: 'drama', query: kbQuery, limit: 5 } }));
    // 添加集数元信息
    if (isMultiEpisode) {
      result.episode = episode_index;
      result.total_episodes = episode_count;
    }
    return result;
  }
  catch { throw new Error('长篇剧情生成失败：AI 返回格式异常，请重试'); }
}

module.exports = { generateStory, generateStoryCustom, generateLongStory, refineScene, parseScript, getStoryInfo, callLLM };
