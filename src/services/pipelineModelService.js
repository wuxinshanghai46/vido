/**
 * Pipeline 模型路由服务
 *
 * 职责：维护「数字人/网剧/爆款复刻」每个环节使用哪些模型 + 优先级。
 *
 * 配置存储：outputs/pipeline_model_config.json
 *   {
 *     "stages": {
 *       "avatar.image_gen": [
 *         { "provider_id": "volces", "model_id": "...", "priority": 1, "enabled": true }
 *       ],
 *       ...
 *     }
 *   }
 *
 * 业务 service 用法：
 *   const pms = require('./pipelineModelService');
 *   const m = pms.pickModel('avatar.image_gen');
 *   if (m) callImageAPI(m.provider_id, m.model_id, ...);
 */

const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.resolve(__dirname, '../../outputs/pipeline_model_config.json');

// ─── Stage 元数据 ───
const PIPELINE_SCHEMA = {
  '数字人': [
    { id: 'avatar.describe',     name: 'Step1 形象描述 AI 扩写',  type: 'story', desc: '把用户简单描述扩写成 200 字详细形象 brief' },
    { id: 'avatar.image_gen',    name: 'Step1 形象图生成',         type: 'image', desc: '基于描述生成数字人形象图（Seedream/SD/DALL-E）' },
    { id: 'avatar.sample_video', name: 'Step2 动态样片',           type: 'video', desc: '让形象图动起来生成预览样片（即梦/CogVideoX）' },
    { id: 'avatar.lip_sync',     name: 'Step3 数字人合成',         type: 'avatar', desc: '形象+音频→口型同步视频（Wan-Animate/即梦 Omni/飞影）' },
    { id: 'avatar.tts',          name: '数字人配音 TTS',           type: 'tts',   desc: '把脚本合成音频（火山/讯飞/阿里 CosyVoice 等）' },
  ],
  '网剧': [
    { id: 'drama.script',          name: '剧本 / 分镜生成',          type: 'story', desc: '编剧 LLM，输出剧本+分镜 JSON' },
    { id: 'drama.character_image', name: '角色形象图',               type: 'image', desc: '为每个角色生成统一形象图' },
    { id: 'drama.scene_image',     name: '场景背景图',               type: 'image', desc: '为每个场景生成背景图' },
    { id: 'drama.video_clip',      name: '视频片段生成',             type: 'video', desc: '每段镜头生成视频（Kling/Sora/Veo/Seedance）' },
    { id: 'drama.tts',             name: '剧本配音 TTS',             type: 'tts',   desc: '角色配音' },
  ],
  '爆款复刻': [
    { id: 'replicate.extract',  name: '原视频文案提取 + 分析',     type: 'story', desc: '抓取视频后调 LLM 分析钩子/痛点/CTA' },
    { id: 'replicate.rewrite',  name: 'AI 改写新文案',             type: 'story', desc: '保留原节奏改写文案' },
    { id: 'replicate.tts',      name: '复刻配音 TTS',              type: 'tts',   desc: '用克隆音色或预设音色合成新配音' },
    { id: 'replicate.avatar',   name: '数字人合成（可选）',        type: 'avatar', desc: '配音 + 形象 → 完整视频成片' },
  ],
  '剧情/故事生成': [
    { id: 'story.generate',     name: '故事/剧情主生成',           type: 'story', desc: '所有 callLLM 默认入口' },
    { id: 'story.parse_script', name: '剧本解析为场景 JSON',       type: 'story', desc: '把自由文本剧本结构化' },
  ],
  'AI 图片生成': [
    { id: 'imggen.t2i',         name: '文生图主链路',              type: 'image', desc: 'AI 图片生成模块的默认 image 模型' },
    { id: 'imggen.i2v',         name: '图生视频主链路',            type: 'video', desc: 'I2V 模块的默认 video 模型' },
  ],
};

// 代码 fallback 默认链路（当用户没在 admin 里手动配置时，作为预填展示）
//   注意：这只是"建议默认值"，实际业务还是按各 service 内部的 fallback 逻辑跑
const STAGE_DEFAULTS = {
  // 数字人
  'avatar.describe':     [{ provider_id: 'deyunai', model_id: 'gpt-4o-mini', priority: 1, enabled: true }],
  'avatar.image_gen':    [
    { provider_id: 'deyunai', model_id: 'nano-banana', priority: 1, enabled: true },
    { provider_id: 'volcengine', model_id: 'doubao-seedream-5-0-260128', priority: 2, enabled: true },
  ],
  'avatar.sample_video': [{ provider_id: 'volcengine', model_id: 'jimeng_realman_avatar_picture_omni_v15', priority: 1, enabled: true }],
  'avatar.lip_sync':     [
    { provider_id: 'volcengine', model_id: 'jimeng_realman_avatar_picture_omni_v15', priority: 1, enabled: true },
    { provider_id: 'dashscope', model_id: 'wan2.2-animate-move', priority: 2, enabled: true },
  ],
  'avatar.tts':          [
    { provider_id: 'aliyun-tts', model_id: 'cosyvoice-v3.5-plus', priority: 1, enabled: true },
    { provider_id: 'aliyun-tts', model_id: 'cosyvoice-v3-flash', priority: 2, enabled: true },
  ],
  // 网剧
  'drama.script':        [{ provider_id: 'deepseek', model_id: 'deepseek-chat', priority: 1, enabled: true }],
  'drama.character_image': [{ provider_id: 'volcengine', model_id: 'doubao-seedream-5-0-260128', priority: 1, enabled: true }],
  'drama.scene_image':   [{ provider_id: 'jimeng', model_id: 'jimeng_t2i_v30', priority: 1, enabled: true }],
  'drama.video_clip':    [
    { provider_id: 'api-key-20260404180437', model_id: 'doubao-seedance-2-0-260128', priority: 1, enabled: true },
    { provider_id: 'jimeng', model_id: 'jimeng_t2v_v30', priority: 2, enabled: true },
  ],
  'drama.tts':           [{ provider_id: 'aliyun-tts', model_id: 'cosyvoice-v3-flash', priority: 1, enabled: true }],
  // 爆款复刻
  'replicate.extract':   [{ provider_id: 'deepseek', model_id: 'deepseek-chat', priority: 1, enabled: true }],
  'replicate.rewrite':   [{ provider_id: 'deepseek', model_id: 'deepseek-chat', priority: 1, enabled: true }],
  'replicate.tts':       [{ provider_id: 'aliyun-tts', model_id: 'cosyvoice-v3-flash', priority: 1, enabled: true }],
  'replicate.avatar':    [{ provider_id: 'volcengine', model_id: 'jimeng_realman_avatar_picture_omni_v15', priority: 1, enabled: true }],
  // 故事
  'story.generate':      [{ provider_id: 'deepseek', model_id: 'deepseek-chat', priority: 1, enabled: true }],
  'story.parse_script':  [{ provider_id: 'deepseek', model_id: 'deepseek-chat', priority: 1, enabled: true }],
  // AI 图片
  'imggen.t2i':          [{ provider_id: 'volcengine', model_id: 'doubao-seedream-5-0-260128', priority: 1, enabled: true }],
  'imggen.i2v':          [{ provider_id: 'jimeng', model_id: 'jimeng_i2v_first_v30', priority: 1, enabled: true }],
};

function listDefaults() { return STAGE_DEFAULTS; }
function getStageDefaults(stageId) { return STAGE_DEFAULTS[stageId] || []; }

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const c = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      return { stages: c.stages || {} };
    }
  } catch {}
  return { stages: {} };
}

function saveConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

function listSchema() { return PIPELINE_SCHEMA; }

function getStageConfig(stageId) {
  return loadConfig().stages[stageId] || [];
}

function setStageConfig(stageId, models) {
  const config = loadConfig();
  config.stages = config.stages || {};
  // 校验：每条必须有 provider_id + model_id，priority 不能重复
  const validated = (models || [])
    .filter(m => m && m.provider_id && m.model_id)
    .map((m, i) => ({
      provider_id: String(m.provider_id),
      model_id: String(m.model_id),
      priority: Number.isFinite(+m.priority) ? +m.priority : i + 1,
      enabled: m.enabled !== false,
    }))
    .sort((a, b) => a.priority - b.priority);
  config.stages[stageId] = validated;
  saveConfig(config);
  return validated;
}

/**
 * 业务调用：pickModel(stageId)
 *   按优先级返回第一个 enabled 的模型
 *   返回 null 表示没配置（业务方应回退到自己原来的硬编码默认）
 */
function pickModel(stageId) {
  const list = getStageConfig(stageId);
  return list.find(m => m.enabled) || null;
}

/** 拿到该 stage 的所有 enabled 模型（按优先级） — 用于 fallback 链 */
function pickAllEnabled(stageId) {
  return getStageConfig(stageId).filter(m => m.enabled);
}

/** 列出 settings.providers 中所有可用模型（按 use 字段过滤） */
function listAvailableModels(useType) {
  try {
    const { loadSettings } = require('./settingsService');
    const settings = loadSettings();
    const out = [];
    (settings.providers || []).forEach(p => {
      if (!p.enabled) return;
      (p.models || []).forEach(m => {
        if (m.enabled === false) return;
        // useType: image/video/tts/story/avatar — 'avatar' 我们映射到 video 或 image
        const matches = useType === 'avatar' ? ['video', 'image', 'avatar'].includes(m.use)
                      : useType === 'story'  ? ['story', 'chat', 'llm'].includes(m.use)
                      : m.use === useType;
        if (matches || useType === 'all') {
          out.push({
            provider_id: p.id,
            provider_name: p.name,
            model_id: m.id,
            model_name: m.name || m.id,
            use: m.use,
          });
        }
      });
    });
    return out;
  } catch { return []; }
}

module.exports = {
  PIPELINE_SCHEMA,
  STAGE_DEFAULTS,
  listSchema,
  listDefaults,
  getStageDefaults,
  loadConfig,
  saveConfig,
  getStageConfig,
  setStageConfig,
  pickModel,
  pickAllEnabled,
  listAvailableModels,
};
