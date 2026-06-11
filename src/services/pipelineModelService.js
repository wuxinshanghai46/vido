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
  '商品数字人': [
    { id: 'product_avatar.describe',     name: '商品卖点 / 口播脚本',       type: 'story',  desc: '根据商品名称、卖点、目标人群生成商品数字人口播文案' },
    { id: 'product_avatar.person_image', name: '商品数字人底图生成',       type: 'image',  desc: '生成或扩展商品数字人的人物形象底图' },
    { id: 'product_avatar.fuse_image',   name: '商品融合形象图',           type: 'avatar', desc: '人物图 + 商品图融合，默认 Topview Product Avatar V3' },
    { id: 'product_avatar.marketing_video', name: '商品介绍片生成',        type: 'video',  desc: '商品数字人成片，默认 Topview Product Avatar Image2Video；也可配置 Seedance 链路' },
    { id: 'product_avatar.tts',          name: '商品口播 TTS',             type: 'tts',    desc: '商品介绍文案配音' },
  ],
  '广告数字人': [
    { id: 'ad_avatar.copy',          name: '广告文案 / 分镜拆解',       type: 'story',  desc: '把广告主题、空间、镜头要求拆成数字人广告分镜' },
    { id: 'ad_avatar.keyframe',      name: '广告展示画面 / 关键帧',     type: 'image',  desc: '生成广告数字人的展示画面、收束画面或关键帧' },
    { id: 'ad_avatar.marketing_video', name: '广告数字人视频生成',      type: 'video',  desc: '广告数字人成片，优先 Topview Marketing Video，失败后走当前数字人/Seedance 链路' },
    { id: 'ad_avatar.lip_sync',      name: '广告数字人口型合成',        type: 'avatar', desc: '广告数字人形象 + 口播音频的口型同步合成' },
    { id: 'ad_avatar.tts',           name: '广告口播 TTS',              type: 'tts',    desc: '广告口播文案配音' },
  ],
  '剧情广告': [
    { id: 'luxury_ad.scene_config', name: '1-2 广告需求 / 场景配置', type: 'story', desc: '把一句话广告需求整理成场景顺序、人物/主体来源和素材清单' },
    { id: 'luxury_ad.script',       name: '3 剧本生成',             type: 'story', desc: '按时间段生成画面、动作、台词、目的、情绪和声音说明' },
    { id: 'luxury_ad.storyboard_director', name: '3.5 分镜导演 / 视觉合同', type: 'story', desc: '把已确认剧本转成每镜可执行视觉合同、参考图策略和生图/质检约束' },
    { id: 'luxury_ad.reference_analyze', name: '3.6 参考图分类 / 资产合同', type: 'vlm', desc: '分析上传图属于人物、行业场景、主体证据或风格，作为分镜生成前的资产合同' },
    { id: 'luxury_ad.person_sheet', name: '3.7 演员三视图 / 人物设定', type: 'image', desc: '按基础信息或剧本人物表生成固定演员三视图，供后续分镜保持人物一致' },
    { id: 'luxury_ad.presenter_seed', name: '3.7 真人讲解员种子图', type: 'image', desc: '剧情需要真人但没有人物参考时，先生成统一讲解员参考图' },
    { id: 'luxury_ad.scene_seed', name: '3.8 行业场景种子图', type: 'image', desc: '剧情需要明确空间但没有场景参考时，按行业和剧情生成对应场景约束图' },
    { id: 'luxury_ad.subject_evidence_seed', name: '3.9 主体证据种子图', type: 'image', desc: '把上传主体参考转成符合剧情场景的可见证据，避免参考图直接主导成错误场景' },
    { id: 'luxury_ad.keyframe',     name: '4 分镜生成 / 画面',       type: 'image', desc: '根据剧本生成产品/人物/场景一致的分镜画面' },
    { id: 'luxury_ad.keyframe_qa',  name: '4 分镜视觉质检',         type: 'vlm', desc: '多模态检查分镜图是否严格匹配已确认剧本、主体和镜头要求' },
    { id: 'luxury_ad.keyframe_repair', name: '4 分镜 QA 修正 / 重试', type: 'story', desc: '把 QA 失败原因编译成下一次生图的明确修正指令，不跳过质检' },
    { id: 'luxury_ad.video',        name: '5 广告合成 / 图生视频',   type: 'video', desc: '用 Seedance/Topview 图生视频把分镜画面串成镜头' },
    { id: 'luxury_ad.tts',          name: '5 广告合成 / 配音 TTS',   type: 'tts',   desc: '剧情广告旁白、口播或字幕配音' },
    { id: 'luxury_ad.post',         name: '5 广告合成 / 字幕后期',   type: 'video', desc: '镜头拼接、字幕、调色、片尾包装等后期处理' },
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
  'avatar.sample_video': [
    { provider_id: 'topview', model_id: 'topview-avatar4-fast', priority: 1, enabled: true },
    { provider_id: 'topview', model_id: 'topview-image2video-pro', priority: 2, enabled: true },
    { provider_id: 'volcengine', model_id: 'jimeng_realman_avatar_picture_omni_v15', priority: 3, enabled: true },
  ],
  'avatar.lip_sync':     [
    { provider_id: 'topview', model_id: 'topview-avatar4', priority: 1, enabled: true },
    { provider_id: 'topview', model_id: 'topview-avatar4-fast', priority: 2, enabled: true },
    { provider_id: 'hifly', model_id: 'hifly', priority: 3, enabled: true },
    { provider_id: 'volcengine', model_id: 'jimeng_realman_avatar_picture_omni_v15', priority: 4, enabled: true },
    { provider_id: 'dashscope', model_id: 'wan2.2-animate-move', priority: 5, enabled: true },
  ],
  'avatar.tts':          [
    { provider_id: 'aliyun-tts', model_id: 'cosyvoice-v3.5-plus', priority: 1, enabled: true },
    { provider_id: 'aliyun-tts', model_id: 'cosyvoice-v3-flash', priority: 2, enabled: true },
  ],
  // 商品数字人
  'product_avatar.describe': [{ provider_id: 'deyunai', model_id: 'gpt-4o-mini', priority: 1, enabled: true }],
  'product_avatar.person_image': [
    { provider_id: 'deyunai', model_id: 'nano-banana', priority: 1, enabled: true },
    { provider_id: 'volcengine', model_id: 'doubao-seedream-5-0-260128', priority: 2, enabled: true },
  ],
  'product_avatar.fuse_image': [
    { provider_id: 'topview', model_id: 'topview-product-avatar-v3', priority: 1, enabled: true },
    { provider_id: 'replicate', model_id: 'flux-kontext-multi-pro', priority: 2, enabled: true },
    { provider_id: 'replicate', model_id: 'instantid', priority: 3, enabled: true },
  ],
  'product_avatar.marketing_video': [
    { provider_id: 'topview', model_id: 'topview-product-avatar-i2v', priority: 1, enabled: true },
    { provider_id: 'volcengine', model_id: 'doubao-seedance-2-0-260128', priority: 2, enabled: true },
  ],
  'product_avatar.tts': [
    { provider_id: 'aliyun-tts', model_id: 'cosyvoice-v3.5-plus', priority: 1, enabled: true },
    { provider_id: 'aliyun-tts', model_id: 'cosyvoice-v3-flash', priority: 2, enabled: true },
  ],
  // 广告数字人
  'ad_avatar.copy': [{ provider_id: 'deyunai', model_id: 'gpt-4o-mini', priority: 1, enabled: true }],
  'ad_avatar.keyframe': [
    { provider_id: 'deyunai', model_id: 'nano-banana', priority: 1, enabled: true },
    { provider_id: 'volcengine', model_id: 'doubao-seedream-5-0-260128', priority: 2, enabled: true },
  ],
  'ad_avatar.marketing_video': [
    { provider_id: 'topview', model_id: 'topview-m2v', priority: 1, enabled: true },
    { provider_id: 'volcengine', model_id: 'doubao-seedance-2-0-260128', priority: 2, enabled: true },
  ],
  'ad_avatar.lip_sync': [
    { provider_id: 'topview', model_id: 'topview-avatar4', priority: 1, enabled: true },
    { provider_id: 'topview', model_id: 'topview-avatar4-fast', priority: 2, enabled: true },
    { provider_id: 'hifly', model_id: 'hifly', priority: 3, enabled: true },
  ],
  'ad_avatar.tts': [
    { provider_id: 'aliyun-tts', model_id: 'cosyvoice-v3.5-plus', priority: 1, enabled: true },
    { provider_id: 'aliyun-tts', model_id: 'cosyvoice-v3-flash', priority: 2, enabled: true },
  ],
  // 剧情广告
  // 中文说明：剧本、分镜导演和修复阶段负责生成“业务无关的视觉合同”，
  // 需要更强的结构化视觉推理模型优先；DeepSeek 只作为末位后备，避免把具体行业场景写死。
  'luxury_ad.scene_config': [
    { provider_id: 'deyunai', model_id: 'gemini-2.5-pro', priority: 1, enabled: true },
    { provider_id: 'deyunai', model_id: 'claude-sonnet-4-6', priority: 2, enabled: true },
    { provider_id: 'deyunai', model_id: 'gpt-4o', priority: 3, enabled: true },
    { provider_id: 'deyunai', model_id: 'gemini-2.5-flash', priority: 4, enabled: true },
    { provider_id: 'deepseek', model_id: 'deepseek-chat', priority: 20, enabled: true },
  ],
  'luxury_ad.script': [
    { provider_id: 'deyunai', model_id: 'gemini-2.5-pro', priority: 1, enabled: true },
    { provider_id: 'deyunai', model_id: 'claude-sonnet-4-6', priority: 2, enabled: true },
    { provider_id: 'deyunai', model_id: 'gpt-4o', priority: 3, enabled: true },
    { provider_id: 'deyunai', model_id: 'gemini-2.5-flash', priority: 4, enabled: true },
    { provider_id: 'deepseek', model_id: 'deepseek-chat', priority: 20, enabled: true },
  ],
  'luxury_ad.storyboard_director': [
    { provider_id: 'deyunai', model_id: 'gemini-2.5-pro', priority: 1, enabled: true },
    { provider_id: 'deyunai', model_id: 'claude-sonnet-4-6', priority: 2, enabled: true },
    { provider_id: 'deyunai', model_id: 'gpt-4o', priority: 3, enabled: true },
    { provider_id: 'deyunai', model_id: 'gemini-2.5-flash', priority: 4, enabled: true },
    { provider_id: 'deepseek', model_id: 'deepseek-chat', priority: 20, enabled: true },
  ],
  'luxury_ad.reference_analyze': [
    { provider_id: 'deyunai', model_id: 'gemini-2.5-flash', priority: 1, enabled: true },
    { provider_id: 'deyunai', model_id: 'gemini-2.5-pro', priority: 2, enabled: true },
    { provider_id: 'zhipu', model_id: 'glm-4v-flash', priority: 20, enabled: true },
  ],
  'luxury_ad.presenter_seed': [
    { provider_id: 'deyunai', model_id: 'gpt-image-2', priority: 1, enabled: true },
    { provider_id: 'deyunai', model_id: 'nano-banana-pro', priority: 2, enabled: true },
    { provider_id: 'deyunai', model_id: 'nano-banana', priority: 3, enabled: true },
    { provider_id: 'deyunai', model_id: 'qwen-image', priority: 4, enabled: true },
    { provider_id: 'topview', model_id: 'topview-nano-banana-pro', priority: 20, enabled: false },
  ],
  'luxury_ad.person_sheet': [
    { provider_id: 'deyunai', model_id: 'gpt-image-2', priority: 1, enabled: true },
    { provider_id: 'deyunai', model_id: 'nano-banana-pro', priority: 2, enabled: true },
    { provider_id: 'deyunai', model_id: 'nano-banana', priority: 3, enabled: true },
    { provider_id: 'deyunai', model_id: 'qwen-image', priority: 4, enabled: true },
    { provider_id: 'topview', model_id: 'topview-gpt-image-2', priority: 20, enabled: false },
    { provider_id: 'topview', model_id: 'topview-nano-banana-pro', priority: 21, enabled: false },
  ],
  'luxury_ad.scene_seed': [
    { provider_id: 'deyunai', model_id: 'gpt-image-2', priority: 1, enabled: true },
    { provider_id: 'deyunai', model_id: 'nano-banana-pro', priority: 2, enabled: true },
    { provider_id: 'deyunai', model_id: 'nano-banana', priority: 3, enabled: true },
    { provider_id: 'deyunai', model_id: 'qwen-image', priority: 4, enabled: true },
    { provider_id: 'topview', model_id: 'topview-seedream-5', priority: 20, enabled: false },
  ],
  'luxury_ad.subject_evidence_seed': [
    { provider_id: 'deyunai', model_id: 'gpt-image-2', priority: 1, enabled: true },
    { provider_id: 'deyunai', model_id: 'qwen-image-edit', priority: 2, enabled: true },
    { provider_id: 'deyunai', model_id: 'qwen-image', priority: 3, enabled: true },
    { provider_id: 'deyunai', model_id: 'nano-banana-pro', priority: 4, enabled: true },
    { provider_id: 'topview', model_id: 'topview-gpt-image-2', priority: 20, enabled: false },
  ],
  'luxury_ad.copy': [
    { provider_id: 'deepseek', model_id: 'deepseek-chat', priority: 1, enabled: true },
    { provider_id: 'deyunai', model_id: 'gemini-2.5-flash', priority: 2, enabled: true },
  ],
  'luxury_ad.keyframe': [
    { provider_id: 'deyunai', model_id: 'gpt-image-2', priority: 1, enabled: true },
    { provider_id: 'deyunai', model_id: 'nano-banana-pro', priority: 2, enabled: true },
    { provider_id: 'deyunai', model_id: 'nano-banana', priority: 3, enabled: true },
    { provider_id: 'deyunai', model_id: 'qwen-image-edit', priority: 4, enabled: true },
    { provider_id: 'deyunai', model_id: 'qwen-image', priority: 5, enabled: true },
    { provider_id: 'deyunai', model_id: 'doubao-seedream-4-0-250828', priority: 6, enabled: true },
    { provider_id: 'deyunai', model_id: 'imagen-4', priority: 7, enabled: true },
    { provider_id: 'deyunai', model_id: 'flux-pro', priority: 8, enabled: true },
    { provider_id: 'topview', model_id: 'topview-gpt-image-2', priority: 20, enabled: false },
    { provider_id: 'topview', model_id: 'topview-nano-banana-pro', priority: 21, enabled: false },
    { provider_id: 'topview', model_id: 'topview-seedream-5', priority: 22, enabled: false },
    { provider_id: 'topview', model_id: 'topview-nano-banana-2', priority: 23, enabled: false },
  ],
  'luxury_ad.keyframe_qa': [
    { provider_id: 'deyunai', model_id: 'gemini-2.5-flash', priority: 1, enabled: true },
    { provider_id: 'deyunai', model_id: 'gemini-2.5-pro', priority: 2, enabled: true },
    { provider_id: 'deyunai', model_id: 'gemini-2.0-flash', priority: 3, enabled: true },
    { provider_id: 'deyunai', model_id: 'claude-sonnet-4-6', priority: 4, enabled: true },
    { provider_id: 'deyunai', model_id: 'gpt-4o', priority: 5, enabled: true },
    { provider_id: 'deyunai', model_id: 'gpt-4o-mini', priority: 6, enabled: true },
    { provider_id: 'deyunai', model_id: 'gemini-3.1-flash-lite-preview', priority: 7, enabled: true },
    { provider_id: 'zhipu', model_id: 'glm-4v-flash', priority: 20, enabled: true },
    { provider_id: 'zhipu', model_id: 'glm-4v', priority: 21, enabled: true },
    { provider_id: 'zhipu', model_id: 'glm-4.5v', priority: 22, enabled: true },
    { provider_id: 'zhipu', model_id: 'glm-4.6v', priority: 23, enabled: true },
  ],
  'luxury_ad.keyframe_repair': [
    { provider_id: 'deyunai', model_id: 'gemini-2.5-pro', priority: 1, enabled: true },
    { provider_id: 'deyunai', model_id: 'claude-sonnet-4-6', priority: 2, enabled: true },
    { provider_id: 'deyunai', model_id: 'gpt-4o', priority: 3, enabled: true },
    { provider_id: 'deyunai', model_id: 'gemini-2.5-flash', priority: 4, enabled: true },
    { provider_id: 'deepseek', model_id: 'deepseek-chat', priority: 20, enabled: true },
  ],
  'luxury_ad.video': [
    { provider_id: 'webang-seedance', model_id: 'doubao-seedance-2-0-260128', priority: 1, enabled: true },
    { provider_id: 'webang-seedance', model_id: 'doubao-seedance-2-0-fast-260128', priority: 2, enabled: true },
    { provider_id: 'topview', model_id: 'topview-image2video-pro', priority: 20, enabled: false },
    { provider_id: 'topview', model_id: 'topview-image2video-best', priority: 21, enabled: false },
    { provider_id: 'volcengine', model_id: 'doubao-seedance-2-0-260128', priority: 5, enabled: false },
    { provider_id: 'deyunai', model_id: 'kling-v2.5-turbo-pro', priority: 6, enabled: false },
    { provider_id: 'deyunai', model_id: 'hailuo-02-fast', priority: 7, enabled: false },
  ],
  'luxury_ad.tts': [
    { provider_id: 'aliyun-tts', model_id: 'cosyvoice-v3.5-plus', priority: 1, enabled: true },
    { provider_id: 'aliyun-tts', model_id: 'cosyvoice-v3-flash', priority: 2, enabled: true },
  ],
  'luxury_ad.post': [
    { provider_id: 'local', model_id: 'ffmpeg-effects', priority: 1, enabled: true },
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

function pickModelWithDefault(stageId) {
  return pickModel(stageId) || (getStageDefaults(stageId).find(m => m.enabled) || null);
}

/** 拿到该 stage 的所有 enabled 模型（按优先级） — 用于 fallback 链 */
function pickAllEnabled(stageId) {
  return getStageConfig(stageId).filter(m => m.enabled);
}

function pickAllEnabledWithDefault(stageId) {
  const configured = pickAllEnabled(stageId);
  return configured.length ? configured : getStageDefaults(stageId).filter(m => m.enabled);
}

function isVlmCapableModel(provider, model) {
  const use = String(model?.use || '').toLowerCase();
  const type = String(model?.type || '').toLowerCase();
  if (['vlm', 'vision', 'visual'].includes(use) || ['vlm', 'vision', 'visual'].includes(type)) return true;
  if (['image', 'video', 'tts', 'audio', 'music', 'embedding', 'avatar'].includes(use)
    || ['image', 'video', 'tts', 'audio', 'music', 'embedding', 'avatar'].includes(type)) return false;

  const providerText = `${provider?.id || ''} ${provider?.preset || ''} ${provider?.name || ''}`.toLowerCase();
  const modelText = `${model?.id || ''} ${model?.name || ''}`.toLowerCase();
  const isDeyunai = providerText.includes('deyunai') || providerText.includes('漫路');
  if (!isDeyunai) return false;

  // DeyunAI exposes several multimodal models as chat/story models. They can
  // accept image_url messages and are valid candidates for strict visual QA.
  return [
    /^gpt-4o(?:$|-)/,
    /^gemini-(?:2\.0|2\.5|3\.1)/,
    /^claude-(?:3|sonnet)/,
    /qwen.*vl/,
    /vision/,
    /multimodal|多模态/,
  ].some(rx => rx.test(modelText));
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
                      : useType === 'vlm'    ? isVlmCapableModel(p, m)
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
  pickModelWithDefault,
  pickAllEnabled,
  pickAllEnabledWithDefault,
  listAvailableModels,
};
