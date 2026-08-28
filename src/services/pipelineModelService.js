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
const axios = require('axios');
const sqliteConfig = require('../db/sqlite');
const appKv = require('../repositories/appKvRepository');

const OUTPUT_DIR = process.env.OUTPUT_DIR
  ? path.resolve(process.env.OUTPUT_DIR)
  : path.resolve(__dirname, '../../outputs');
const CONFIG_FILE = path.join(OUTPUT_DIR, 'pipeline_model_config.json');

// ─── Stage 元数据 ───
const PIPELINE_SCHEMA = {
  '声音资产': [
    { id: 'voice.enrollment', name: '授权素材自动注册', type: 'tts', desc: '用户首次使用授权声音素材时，按账号注册为永久可复用音色；后续生成自动复用并防止重复计费' },
  ],
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
    { id: 'luxury_ad.person_sheet', name: '3.7 演员三视图 / 人物设定', type: 'image', desc: '按基础信息或剧本人物表生成一致性演员三视图，供后续分镜保持人物一致' },
    { id: 'luxury_ad.presenter_seed', name: '3.7 人物一致性种子图', type: 'image', desc: '剧情需要真人但没有人物参考时，先按剧本推导人物一致性参考图' },
    { id: 'luxury_ad.scene_seed', name: '3.8 行业场景种子图', type: 'image', desc: '剧情需要明确空间但没有场景参考时，按行业和剧情生成对应场景约束图' },
    { id: 'luxury_ad.subject_evidence_seed', name: '3.9 主体证据种子图', type: 'image', desc: '把上传主体参考转成符合剧情场景的可见证据，避免参考图直接主导成错误场景' },
    { id: 'luxury_ad.keyframe',     name: '4 分镜生成 / 画面',       type: 'image', desc: '根据剧本生成产品/人物/场景一致的分镜画面' },
    { id: 'luxury_ad.keyframe_qa',  name: '4 分镜视觉质检',         type: 'vlm', desc: '多模态检查分镜图是否严格匹配已确认剧本、主体和镜头要求' },
    { id: 'luxury_ad.keyframe_repair', name: '4 分镜 QA 修正 / 重试', type: 'story', desc: '把 QA 失败原因编译成下一次生图的明确修正指令，不跳过质检' },
    { id: 'luxury_ad.video',        name: '5 广告合成 / 图生视频',   type: 'video', desc: '用 Seedance/Topview 图生视频把分镜画面串成镜头' },
    { id: 'luxury_ad.tts',          name: '5 广告合成 / 配音 TTS',   type: 'tts',   desc: '剧情广告旁白、口播或字幕配音' },
    { id: 'luxury_ad.post',         name: '5 广告合成 / 字幕后期',   type: 'video', desc: '镜头拼接、字幕、调色、片尾包装等后期处理' },
  ],
  '新剧情广告': [
  { id: 'new_story_ad.reference_video_transcript', name: '0 参考视频语音转写', type: 'asr', desc: '在镜头预算预检通过后转写参考视频声音，并记录供应商提交与计费状态' },
  { id: 'new_story_ad.reference_video_vision', name: '0 参考视频内容识别', type: 'vlm', desc: '读取参考视频证据帧，生成可编辑的人物、场景、剧情与镜头分析草稿' },
  { id: 'new_story_ad.reference_video_synthesis', name: '0.1 参考证据语义总编', type: 'story', desc: '综合全部证据帧，区分广告产品与环境，并按独立物理空间整理人物、场景和剧情' },
  { id: 'new_story_ad.asset_plan', name: '1 统一资产计划', type: 'story', desc: '一次规划人物、道具、场景和故事种子；默认继承场景配置文本路由' },
  { id: 'new_story_ad.person_plan_character', name: '1.0 独立人物方案补齐', type: 'story', desc: '按人物独立并发补齐外观、穿着、发妆、配饰、造型和禁止项；每个人物单独记录调用与恢复状态' },
  { id: 'new_story_ad.scene_config', name: '1 场景配置', type: 'story', desc: '把任务需求整理成独立上下文、主体、人物、素材和禁止项，不继承旧任务' },
    { id: 'new_story_ad.story_facts', name: '1.1 纯剧情事实深化', type: 'story', desc: '只生成剧情因果和结构化制作变化事实；场景键与拓扑由平台确定性编译' },
    { id: 'new_story_ad.story_facts_compact_retry', name: '1.2 剧情事实紧凑重试', type: 'story', desc: '仅在首轮为空或 JSON 截断且没有可修复基线时，紧凑重试一次完整剧情事实' },
    { id: 'new_story_ad.story_facts_repair', name: '1.3 剧情事实定向修复', type: 'story', desc: '只补齐缺失或不确定的剧情事实字段，不重跑已合格故事' },
    { id: 'new_story_ad.asset_plan_missing_sections_recovery', name: '1.3 资产计划缺失区段恢复', type: 'story', desc: '只恢复人物、道具或故事事实等缺失区段，不覆盖已合格检查点' },
    { id: 'new_story_ad.asset_plan_section_patch', name: '1.3.1 资产计划精确区段补丁', type: 'story', desc: '一次只补一个经合同确认缺失的区段；显式空数组、内容模式和检查点代际均在合并前校验' },
    { id: 'new_story_ad.asset_plan_scene_recovery', name: '1.4 旧场景区段恢复（兼容）', type: 'story', desc: '兼容历史任务的场景区段恢复；新纯剧情拓扑不再调用模型' },
    { id: 'new_story_ad.asset_plan_story_development', name: '1.5 旧故事深化（兼容）', type: 'story', desc: '历史调用记录兼容；新任务使用纯剧情事实深化阶段' },
    { id: 'new_story_ad.asset_plan_scene_coverage_recovery', name: '1.6 旧场景覆盖恢复（停用）', type: 'story', desc: '只用于历史审计；新流程由平台确定性编译且不调用模型' },
    { id: 'new_story_ad.blueprint', name: '2 剧情蓝图', type: 'story', desc: '生成角色、剧情 beat、可见证据和商业叙事结构' },
    { id: 'new_story_ad.blueprint_structure_repair', name: '2.1 剧情蓝图结构修复', type: 'story', desc: '只修复蓝图节拍数量和结构字段' },
    { id: 'new_story_ad.blueprint_language_repair', name: '2.2 剧情蓝图语言修复', type: 'story', desc: '只修复非中文或语言不一致字段' },
    { id: 'new_story_ad.blueprint_polish', name: '2.3 剧情蓝图质量修订', type: 'story', desc: '根据质量问题定向修订蓝图' },
    { id: 'new_story_ad.storyboard_table', name: '3 分镜表', type: 'story', desc: '把剧情蓝图拆成逐镜可执行分镜表，包含画面、动作、对白、旁白和时长' },
    { id: 'new_story_ad.storyboard_fill_missing', name: '3.0 分镜缺失镜头补齐', type: 'story', desc: '只补齐缺失剧情节拍对应的镜头' },
    { id: 'new_story_ad.storyboard_rewrite', name: '3.1 分镜表重写', type: 'story', desc: '根据商用 QA 的可改写问题重写分镜表，不改变任务边界' },
    { id: 'new_story_ad.storyboard_language_repair', name: '3.1.1 分镜语言修复', type: 'story', desc: '只修复分镜中的语言字段' },
    { id: 'new_story_ad.scene_config_language_repair', name: '1.7 场景配置语言修复', type: 'story', desc: '只修复场景配置中的语言字段' },
    { id: 'new_story_ad.qa', name: '3.2 商用 QA', type: 'story', desc: '检查剧情边界、角色一致性、镜头可拍性和广告主体可见证据' },
    { id: 'new_story_ad.json_repair', name: '结构化 JSON 修复', type: 'story', desc: '只修复模型 JSON 结构，不改写业务内容' },
    { id: 'new_story_ad.assist', name: '需求辅助改写', type: 'story', desc: '把用户粗略需求清洗成可生成的新剧情广告任务单' },
    { id: 'new_story_ad.brief_dialogue', name: '立项实时对话', type: 'story', desc: '快速理解用户当前回答并主动提出一个内容化下一问' },
    { id: 'new_story_ad.person_sheet', name: '演员三视图 / 人物资产', type: 'image', desc: '生成或兜底选择可复用的拟真演员参考资产' },
    { id: 'new_story_ad.person_dossier_atlas', name: '人物档案分类图集', type: 'image', desc: '生成人物档案中的分类视觉图集' },
    { id: 'new_story_ad.person_dossier_expression', name: '人物表情动作库', type: 'image', desc: '按人物身份和当前造型生成六类可复用表情资产，进入统一制作图谱的表演绑定' },
    { id: 'new_story_ad.person_dossier_action', name: '人物身体动作库', type: 'image', desc: '按人物身份、完整穿搭和随身物生成六类全身动作资产，进入逐镜动作起止合同' },
    { id: 'new_story_ad.person_dossier_native_master', name: '人物档案原生主视图', type: 'image', desc: '生成人物档案的独立主视图资产' },
    { id: 'new_story_ad.person_dossier_wearable_accessory', name: '人物可穿戴配件细节', type: 'image', desc: '生成人物档案中的可穿戴配件细节图' },
    { id: 'new_story_ad.person_dossier_wardrobe_detail', name: '人物服装细节', type: 'image', desc: '生成人物档案中的服装材质与款式细节图' },
    { id: 'new_story_ad.pet_dossier', name: '动物档案图集', type: 'image', desc: '生成动物主体的可复用身份图集' },
    { id: 'new_story_ad.prop_dossier_atlas', name: '道具档案图集', type: 'image', desc: '生成故事道具的可复用视觉图集' },
    { id: 'new_story_ad.product_asset', name: '商品主体资产', type: 'image', desc: '生成商业主体或商品的权威参考资产' },
    { id: 'new_story_ad.storyboard_sketch', name: '剧情广告分镜线稿', type: 'image', desc: '在文字分镜之后批量生成构图线稿，供镜头设计确认' },
    { id: 'new_story_ad.scene_asset', name: '场景五视图 / 空间资产（兼容）', type: 'image', desc: '历史场景图片调用兼容入口；新任务按母图、主视角和增强视图分别路由' },
    { id: 'new_story_ad.scene_extension_atlas', name: '场景空间母图', type: 'image', desc: '生成可渐进派生主视角与空间增强视图的统一母图，不直接伪造360全景' },
    { id: 'new_story_ad.scene_extension_master', name: '场景基础主视角', type: 'image', desc: '生成场景基础可用主视角；成功后独立保存，不受后续增强视图失败影响' },
    { id: 'new_story_ad.scene_extension_layout', name: '场景俯视布局增强', type: 'image', desc: '在基础主视角之上渐进补充俯视布局与可行动区域' },
    { id: 'new_story_ad.scene_extension_reverse', name: '场景反向/侧向增强', type: 'image', desc: '在同一物理空间内补充反向或侧向机位' },
    { id: 'new_story_ad.scene_extension_interaction', name: '场景互动位增强', type: 'image', desc: '补充人物、动物、商品或道具可交互的空间机位' },
    { id: 'new_story_ad.scene_extension_detail', name: '场景材质细节增强', type: 'image', desc: '补充同一空间的材质与局部细节证据' },
    { id: 'new_story_ad.scene_panorama', name: '场景360全景', type: 'image', desc: '从权威场景主视图扩展无缝2:1经纬全景，作为跨方向镜头的同一空间来源' },
    { id: 'new_story_ad.scene_panorama_qa', name: '场景360全景质检', type: 'vlm', desc: '检查原图保真、空间结构、环形接缝和本地机位投影一致性' },
    { id: 'new_story_ad.person_consistency_qa', name: '人物身份一致性质检', type: 'vlm', desc: '检查人物参考与候选资产身份一致性' },
    { id: 'new_story_ad.person_dossier_qa', name: '人物档案质检', type: 'vlm', desc: '检查人物档案视图和设定一致性' },
    { id: 'new_story_ad.person_keyframe_qa', name: '人物关键帧质检', type: 'vlm', desc: '检查关键帧中的人物身份与造型一致性' },
    { id: 'new_story_ad.pet_consistency_qa', name: '动物一致性质检', type: 'vlm', desc: '检查动物参考与生成画面一致性' },
    { id: 'new_story_ad.product_consistency_qa', name: '商品一致性质检', type: 'vlm', desc: '检查商品资产一致性' },
    { id: 'new_story_ad.product_keyframe_qa', name: '商品关键帧质检', type: 'vlm', desc: '检查关键帧中的商品证据一致性' },
    { id: 'new_story_ad.scene_vision', name: '场景视觉理解', type: 'vlm', desc: '读取场景视觉证据并形成结构化描述' },
    { id: 'new_story_ad.scene_consistency_qa', name: '场景一致性质检', type: 'vlm', desc: '检查场景资产与当前场景合同一致性' },
    { id: 'new_story_ad.scene_camera_qa', name: '场景机位质检', type: 'vlm', desc: '检查机位图是否属于同一物理空间' },
    { id: 'new_story_ad.video_frame_qa', name: '视频帧质检', type: 'vlm', desc: '检查视频关键帧与镜头合同一致性' },
    { id: 'new_story_ad.cross_shot_visual_qa', name: '跨镜头连续性质检', type: 'vlm', desc: '检查相邻镜头人物、场景、动作和道具连续性' },
    { id: 'new_story_ad.scene_depth', name: '场景深度估计（可选6DoF）', type: 'image', desc: '仅在用户明确需要镜头平移或真实走位时估计深度，不用于3DoF原地环视' },
    { id: 'new_story_ad.scene_spatial_reconstruction', name: '场景空间重建（可选6DoF）', type: 'image', desc: '由全景、深度和多观察点建立可移动空间；没有几何证据时保持不可用' },
    { id: 'new_story_ad.scene_spatial_qa', name: '场景空间质检（可选6DoF）', type: 'vlm', desc: '检查几何、遮挡、导航网格与机位路径；未通过时不会开放平移和人物走位' },
    { id: 'new_story_ad.keyframe', name: '4 关键帧图片', type: 'image', desc: '按分镜表和关键帧合同生成画面资产' },
    { id: 'new_story_ad.video', name: '5 图生视频', type: 'video', desc: '后续按关键帧合同生成视频镜头' },
    { id: 'new_story_ad.tts', name: '5 配音 TTS', type: 'tts', desc: '后续按分镜表生成旁白、对白或字幕配音' },
    { id: 'new_story_ad.lip_sync', name: '5 出镜对白逐字口型', type: 'avatar', desc: '关键帧人物 + 已生成对白音频 → 逐字口型同步视频；出镜对白镜头强制使用' },
    { id: 'new_story_ad.sound_generation', name: '5 环境声 / 音效 / 音乐生成', type: 'video', desc: '使用支持 generate_audio 的音视频模型生成与镜头同步的真实声音，并与对白音轨混合' },
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
const NEW_STORY_AD_TEXT_DEFAULTS = [
  { provider_id: 'smscrw', model_id: 'claude-sonnet-4-6', priority: 1, enabled: true },
  { provider_id: 'apismile', model_id: 'gpt-5.5', priority: 2, enabled: true },
  { provider_id: 'webang-maas', model_id: 'gpt-5.6-terra', priority: 3, enabled: true },
  { provider_id: 'apismile', model_id: 'gemini-2.5-pro', priority: 4, enabled: true },
  { provider_id: 'apismile', model_id: 'gemini-2.5-flash', priority: 5, enabled: true },
  { provider_id: 'aiapi', model_id: 'deepseek-chat', priority: 6, enabled: true },
  { provider_id: 'deyunai', model_id: 'gemini-2.5-pro', priority: 7, enabled: true },
  { provider_id: 'webang-maas', model_id: 'gpt-5.6-sol', priority: 8, enabled: false },
  { provider_id: 'webang-maas', model_id: 'gpt-5.6-luna', priority: 9, enabled: false },
  { provider_id: 'webang-maas', model_id: 'gemini-3.5-flash', priority: 10, enabled: false },
  { provider_id: 'webang-maas', model_id: 'claude-opus-5', priority: 11, enabled: false },
  { provider_id: 'webang-maas', model_id: 'gemini-2.5-flash', priority: 12, enabled: false },
  { provider_id: 'webang-maas', model_id: 'gemini-2.5-pro', priority: 13, enabled: false },
  { provider_id: 'deepseek', model_id: 'deepseek-chat', priority: 14, enabled: false },
  { provider_id: 'deyunai', model_id: 'claude-sonnet-4-6', priority: 15, enabled: false },
  { provider_id: 'deyunai', model_id: 'gpt-4o', priority: 16, enabled: false },
  { provider_id: 'deyunai', model_id: 'gemini-2.5-flash', priority: 17, enabled: false },
];
const NEW_STORY_AD_DIALOGUE_DEFAULTS = [
  { provider_id: 'smscrw', model_id: 'claude-sonnet-4-6', priority: 1, enabled: true },
  { provider_id: 'apismile', model_id: 'gemini-2.5-flash', priority: 2, enabled: true },
  { provider_id: 'webang-maas', model_id: 'gpt-5.6-luna', priority: 3, enabled: true },
  { provider_id: 'aiapi', model_id: 'deepseek-chat', priority: 4, enabled: true },
  { provider_id: 'deyunai', model_id: 'gemini-2.5-flash', priority: 5, enabled: true },
];
const NEW_STORY_AD_REFERENCE_VISION_DEFAULTS = [
  { provider_id: 'smscrw', model_id: 'claude-sonnet-4-6', priority: 1, enabled: true },
  { provider_id: 'deyunai', model_id: 'gemini-2.5-flash', priority: 2, enabled: true },
  { provider_id: 'zhipu', model_id: 'glm-4.6v-flash', priority: 3, enabled: true },
  { provider_id: 'apismile', model_id: 'gemini-2.5-pro', priority: 4, enabled: true },
  { provider_id: 'apismile', model_id: 'gemini-2.5-flash', priority: 5, enabled: true },
  { provider_id: 'webang-maas', model_id: 'gemini-2.5-flash', priority: 6, enabled: true },
];
const NEW_STORY_AD_CONSISTENCY_VISION_DEFAULTS = [
  { provider_id: 'smscrw', model_id: 'claude-sonnet-4-6', priority: 1, enabled: true },
  { provider_id: 'deyunai', model_id: 'claude-sonnet-4-6', priority: 2, enabled: true },
  { provider_id: 'webang-maas', model_id: 'gemini-2.5-flash', priority: 3, enabled: true },
  { provider_id: 'zhipu', model_id: 'glm-4.6v-flash', priority: 4, enabled: true },
];
const NEW_STORY_AD_IMAGE_STAGE_IDS = new Set([
  'new_story_ad.person_sheet',
  'new_story_ad.person_dossier_atlas',
  'new_story_ad.person_dossier_expression',
  'new_story_ad.person_dossier_action',
  'new_story_ad.person_dossier_native_master',
  'new_story_ad.person_dossier_wearable_accessory',
  'new_story_ad.person_dossier_wardrobe_detail',
  'new_story_ad.pet_dossier',
  'new_story_ad.prop_dossier_atlas',
  'new_story_ad.product_asset',
  'new_story_ad.scene_asset',
  'new_story_ad.scene_extension_atlas',
  'new_story_ad.scene_extension_master',
  'new_story_ad.scene_extension_layout',
  'new_story_ad.scene_extension_reverse',
  'new_story_ad.scene_extension_interaction',
  'new_story_ad.scene_extension_detail',
  'new_story_ad.scene_panorama',
  'new_story_ad.keyframe',
  'new_story_ad.storyboard_sketch',
]);
const NEW_STORY_AD_REQUIRED_IMAGE_MODEL = 'gpt-image-2';
const NEW_STORY_AD_PANORAMA_REQUIRED_CAPABILITIES = Object.freeze([
  'image_generation',
  'reference_preserving',
  'panorama_outpaint',
  'equirectangular_2to1',
  'wraparound_consistency',
  'source_view_preserving',
]);
const NEW_STORY_AD_IMAGE_DEFAULTS = [
  { provider_id: 'smscrw', model_id: 'gpt-image-2', priority: 1, enabled: true },
  { provider_id: 'webang-maas', model_id: 'gpt-image-2', priority: 2, enabled: true },
  { provider_id: 'deyunai', model_id: 'gpt-image-2', priority: 3, enabled: true },
  { provider_id: 'apismile', model_id: 'gpt-image-2', priority: 4, enabled: false },
];

const STAGE_DEFAULTS = {
  'voice.enrollment':    [{ provider_id: 'aliyun-tts', model_id: 'cosyvoice-v3.5-plus', priority: 1, enabled: true }],
  // 数字人
  'avatar.describe':     [{ provider_id: 'deyunai', model_id: 'gpt-4o-mini', priority: 1, enabled: false }],
  'avatar.image_gen':    [
    { provider_id: 'deyunai', model_id: 'nano-banana', priority: 1, enabled: false },
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
  'product_avatar.describe': [{ provider_id: 'deyunai', model_id: 'gpt-4o-mini', priority: 1, enabled: false }],
  'product_avatar.person_image': [
    { provider_id: 'deyunai', model_id: 'nano-banana', priority: 1, enabled: false },
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
  'ad_avatar.copy': [{ provider_id: 'deyunai', model_id: 'gpt-4o-mini', priority: 1, enabled: false }],
  'ad_avatar.keyframe': [
    { provider_id: 'deyunai', model_id: 'nano-banana', priority: 1, enabled: false },
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
    { provider_id: 'apismile', model_id: 'gpt-5.5', priority: 1, enabled: true },
    { provider_id: 'apismile', model_id: 'gemini-2.5-pro', priority: 2, enabled: true },
    { provider_id: 'apismile', model_id: 'gemini-2.5-flash', priority: 3, enabled: true },
    { provider_id: 'webang-maas', model_id: 'gemini-2.5-flash', priority: 4, enabled: false },
    { provider_id: 'webang-maas', model_id: 'gemini-2.5-pro', priority: 5, enabled: false },
    { provider_id: 'deepseek', model_id: 'deepseek-chat', priority: 6, enabled: true },
    { provider_id: 'deyunai', model_id: 'gemini-2.5-pro', priority: 7, enabled: false },
    { provider_id: 'deyunai', model_id: 'claude-sonnet-4-6', priority: 8, enabled: false },
    { provider_id: 'deyunai', model_id: 'gpt-4o', priority: 9, enabled: false },
    { provider_id: 'deyunai', model_id: 'gemini-2.5-flash', priority: 10, enabled: false },
  ],
  'luxury_ad.script': [
    { provider_id: 'apismile', model_id: 'gpt-5.5', priority: 1, enabled: true },
    { provider_id: 'apismile', model_id: 'gemini-2.5-pro', priority: 2, enabled: true },
    { provider_id: 'apismile', model_id: 'gemini-2.5-flash', priority: 3, enabled: true },
    { provider_id: 'webang-maas', model_id: 'gemini-2.5-flash', priority: 4, enabled: false },
    { provider_id: 'webang-maas', model_id: 'gemini-2.5-pro', priority: 5, enabled: false },
    { provider_id: 'deepseek', model_id: 'deepseek-chat', priority: 6, enabled: true },
    { provider_id: 'deyunai', model_id: 'gemini-2.5-pro', priority: 7, enabled: false },
    { provider_id: 'deyunai', model_id: 'claude-sonnet-4-6', priority: 8, enabled: false },
    { provider_id: 'deyunai', model_id: 'gpt-4o', priority: 9, enabled: false },
    { provider_id: 'deyunai', model_id: 'gemini-2.5-flash', priority: 10, enabled: false },
  ],
  'luxury_ad.storyboard_director': [
    { provider_id: 'apismile', model_id: 'gpt-5.5', priority: 1, enabled: true },
    { provider_id: 'apismile', model_id: 'gemini-2.5-pro', priority: 2, enabled: true },
    { provider_id: 'apismile', model_id: 'gemini-2.5-flash', priority: 3, enabled: true },
    { provider_id: 'webang-maas', model_id: 'gemini-2.5-flash', priority: 4, enabled: false },
    { provider_id: 'webang-maas', model_id: 'gemini-2.5-pro', priority: 5, enabled: false },
    { provider_id: 'deepseek', model_id: 'deepseek-chat', priority: 6, enabled: true },
    { provider_id: 'deyunai', model_id: 'gemini-2.5-pro', priority: 7, enabled: false },
    { provider_id: 'deyunai', model_id: 'claude-sonnet-4-6', priority: 8, enabled: false },
    { provider_id: 'deyunai', model_id: 'gpt-4o', priority: 9, enabled: false },
    { provider_id: 'deyunai', model_id: 'gemini-2.5-flash', priority: 10, enabled: false },
  ],
  'luxury_ad.reference_analyze': [
    { provider_id: 'apismile', model_id: 'gemini-2.5-flash', priority: 1, enabled: true },
    { provider_id: 'apismile', model_id: 'gemini-2.5-pro', priority: 2, enabled: true },
    { provider_id: 'deyunai', model_id: 'gemini-2.5-flash', priority: 3, enabled: false },
    { provider_id: 'deyunai', model_id: 'gemini-2.5-pro', priority: 4, enabled: false },
    { provider_id: 'zhipu', model_id: 'glm-4v-flash', priority: 5, enabled: true },
  ],
  'luxury_ad.presenter_seed': [
    { provider_id: 'webang-maas', model_id: 'gpt-image-2', priority: 1, enabled: false },
    { provider_id: 'webang-maas', model_id: 'gemini-3.1-flash-image-preview', priority: 2, enabled: false },
    { provider_id: 'webang-maas', model_id: 'gemini-3.0-pro-image-preview', priority: 3, enabled: false },
    { provider_id: 'webang-maas', model_id: 'gemini-2.5-flash-image', priority: 4, enabled: false },
    { provider_id: 'apismile', model_id: 'gpt-image-2', priority: 5, enabled: true },
    { provider_id: 'bridgellm', model_id: 'gpt-image-2', priority: 6, enabled: false },
    { provider_id: 'deyunai', model_id: 'gpt-image-2', priority: 7, enabled: false },
    { provider_id: 'deyunai', model_id: 'nano-banana-pro', priority: 8, enabled: false },
    { provider_id: 'deyunai', model_id: 'nano-banana', priority: 9, enabled: false },
    { provider_id: 'deyunai', model_id: 'qwen-image', priority: 10, enabled: false },
    { provider_id: 'topview', model_id: 'topview-nano-banana-pro', priority: 11, enabled: false },
  ],
  'luxury_ad.person_sheet': [
    { provider_id: 'webang-maas', model_id: 'gpt-image-2', priority: 1, enabled: false },
    { provider_id: 'webang-maas', model_id: 'gemini-3.1-flash-image-preview', priority: 2, enabled: false },
    { provider_id: 'webang-maas', model_id: 'gemini-3.0-pro-image-preview', priority: 3, enabled: false },
    { provider_id: 'webang-maas', model_id: 'gemini-2.5-flash-image', priority: 4, enabled: false },
    { provider_id: 'apismile', model_id: 'gpt-image-2', priority: 5, enabled: true },
    { provider_id: 'bridgellm', model_id: 'gpt-image-2', priority: 6, enabled: false },
    { provider_id: 'deyunai', model_id: 'gpt-image-2', priority: 7, enabled: false },
    { provider_id: 'deyunai', model_id: 'nano-banana-pro', priority: 8, enabled: false },
    { provider_id: 'deyunai', model_id: 'nano-banana', priority: 9, enabled: false },
    { provider_id: 'deyunai', model_id: 'qwen-image', priority: 10, enabled: false },
    { provider_id: 'topview', model_id: 'topview-gpt-image-2', priority: 11, enabled: false },
    { provider_id: 'topview', model_id: 'topview-nano-banana-pro', priority: 12, enabled: false },
  ],
  'luxury_ad.scene_seed': [
    { provider_id: 'webang-maas', model_id: 'gpt-image-2', priority: 1, enabled: false },
    { provider_id: 'webang-maas', model_id: 'gemini-3.1-flash-image-preview', priority: 2, enabled: false },
    { provider_id: 'webang-maas', model_id: 'gemini-3.0-pro-image-preview', priority: 3, enabled: false },
    { provider_id: 'webang-maas', model_id: 'gemini-2.5-flash-image', priority: 4, enabled: false },
    { provider_id: 'apismile', model_id: 'gpt-image-2', priority: 5, enabled: true },
    { provider_id: 'bridgellm', model_id: 'gpt-image-2', priority: 6, enabled: false },
    { provider_id: 'deyunai', model_id: 'gpt-image-2', priority: 7, enabled: false },
    { provider_id: 'deyunai', model_id: 'nano-banana-pro', priority: 8, enabled: false },
    { provider_id: 'deyunai', model_id: 'nano-banana', priority: 9, enabled: false },
    { provider_id: 'deyunai', model_id: 'qwen-image', priority: 10, enabled: false },
    { provider_id: 'topview', model_id: 'topview-seedream-5', priority: 11, enabled: false },
  ],
  'luxury_ad.subject_evidence_seed': [
    { provider_id: 'webang-maas', model_id: 'gpt-image-2', priority: 1, enabled: false },
    { provider_id: 'webang-maas', model_id: 'gemini-3.1-flash-image-preview', priority: 2, enabled: false },
    { provider_id: 'webang-maas', model_id: 'gemini-3.0-pro-image-preview', priority: 3, enabled: false },
    { provider_id: 'webang-maas', model_id: 'gemini-2.5-flash-image', priority: 4, enabled: false },
    { provider_id: 'apismile', model_id: 'gpt-image-2', priority: 5, enabled: true },
    { provider_id: 'bridgellm', model_id: 'gpt-image-2', priority: 6, enabled: false },
    { provider_id: 'deyunai', model_id: 'gpt-image-2', priority: 7, enabled: false },
    { provider_id: 'deyunai', model_id: 'qwen-image-edit', priority: 8, enabled: false },
    { provider_id: 'deyunai', model_id: 'qwen-image', priority: 9, enabled: false },
    { provider_id: 'deyunai', model_id: 'nano-banana-pro', priority: 10, enabled: false },
    { provider_id: 'topview', model_id: 'topview-gpt-image-2', priority: 11, enabled: false },
  ],
  'luxury_ad.copy': [
    { provider_id: 'apismile', model_id: 'gpt-5.5', priority: 1, enabled: true },
    { provider_id: 'apismile', model_id: 'gemini-2.5-pro', priority: 2, enabled: true },
    { provider_id: 'apismile', model_id: 'gemini-2.5-flash', priority: 3, enabled: true },
    { provider_id: 'webang-maas', model_id: 'gemini-2.5-flash', priority: 4, enabled: false },
    { provider_id: 'webang-maas', model_id: 'gemini-2.5-pro', priority: 5, enabled: false },
    { provider_id: 'deepseek', model_id: 'deepseek-chat', priority: 6, enabled: true },
    { provider_id: 'deyunai', model_id: 'gemini-2.5-flash', priority: 7, enabled: false },
  ],
  'luxury_ad.keyframe': [
    { provider_id: 'webang-maas', model_id: 'gpt-image-2', priority: 1, enabled: false },
    { provider_id: 'webang-maas', model_id: 'gemini-3.1-flash-image-preview', priority: 2, enabled: false },
    { provider_id: 'webang-maas', model_id: 'gemini-3.0-pro-image-preview', priority: 3, enabled: false },
    { provider_id: 'webang-maas', model_id: 'gemini-2.5-flash-image', priority: 4, enabled: false },
    { provider_id: 'apismile', model_id: 'gpt-image-2', priority: 5, enabled: true },
    { provider_id: 'bridgellm', model_id: 'gpt-image-2', priority: 6, enabled: false },
    { provider_id: 'deyunai', model_id: 'gpt-image-2', priority: 7, enabled: false },
    { provider_id: 'deyunai', model_id: 'nano-banana-pro', priority: 8, enabled: false },
    { provider_id: 'deyunai', model_id: 'nano-banana', priority: 9, enabled: false },
    { provider_id: 'deyunai', model_id: 'qwen-image-edit', priority: 10, enabled: false },
    { provider_id: 'deyunai', model_id: 'qwen-image', priority: 11, enabled: false },
    { provider_id: 'deyunai', model_id: 'doubao-seedream-4-0-250828', priority: 12, enabled: false },
    { provider_id: 'deyunai', model_id: 'imagen-4', priority: 13, enabled: false },
    { provider_id: 'deyunai', model_id: 'flux-pro', priority: 14, enabled: false },
    { provider_id: 'topview', model_id: 'topview-gpt-image-2', priority: 15, enabled: false },
    { provider_id: 'topview', model_id: 'topview-nano-banana-pro', priority: 16, enabled: false },
    { provider_id: 'topview', model_id: 'topview-seedream-5', priority: 17, enabled: false },
    { provider_id: 'topview', model_id: 'topview-nano-banana-2', priority: 18, enabled: false },
  ],
  'luxury_ad.keyframe_qa': [
    { provider_id: 'webang-maas', model_id: 'gemini-2.5-flash', priority: 1, enabled: false },
    { provider_id: 'webang-maas', model_id: 'gemini-2.5-pro', priority: 2, enabled: false },
    { provider_id: 'deyunai', model_id: 'gemini-2.5-flash', priority: 3, enabled: false },
    { provider_id: 'deyunai', model_id: 'gemini-2.5-pro', priority: 4, enabled: false },
    { provider_id: 'deyunai', model_id: 'gpt-4o', priority: 5, enabled: false },
    { provider_id: 'deyunai', model_id: 'gemini-3.1-flash-lite-preview', priority: 6, enabled: false },
  ],
  'luxury_ad.keyframe_repair': [
    { provider_id: 'webang-maas', model_id: 'gemini-2.5-flash', priority: 1, enabled: false },
    { provider_id: 'webang-maas', model_id: 'gemini-2.5-pro', priority: 2, enabled: false },
    { provider_id: 'deyunai', model_id: 'gemini-2.5-pro', priority: 3, enabled: false },
    { provider_id: 'deyunai', model_id: 'claude-sonnet-4-6', priority: 4, enabled: false },
    { provider_id: 'deyunai', model_id: 'gpt-4o', priority: 5, enabled: false },
    { provider_id: 'deyunai', model_id: 'gemini-2.5-flash', priority: 6, enabled: false },
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
  // 新剧情广告
  'new_story_ad.reference_video_transcript': [
    { provider_id: 'openai', model_id: 'whisper-1', priority: 1, enabled: true },
  ],
  'new_story_ad.reference_video_vision': NEW_STORY_AD_REFERENCE_VISION_DEFAULTS,
  'new_story_ad.reference_video_synthesis': NEW_STORY_AD_TEXT_DEFAULTS,
  'new_story_ad.story_facts': NEW_STORY_AD_TEXT_DEFAULTS,
  'new_story_ad.story_facts_compact_retry': NEW_STORY_AD_TEXT_DEFAULTS,
  'new_story_ad.story_facts_repair': NEW_STORY_AD_TEXT_DEFAULTS,
  'new_story_ad.person_consistency_qa': NEW_STORY_AD_CONSISTENCY_VISION_DEFAULTS,
  'new_story_ad.person_dossier_qa': NEW_STORY_AD_CONSISTENCY_VISION_DEFAULTS,
  'new_story_ad.product_consistency_qa': NEW_STORY_AD_CONSISTENCY_VISION_DEFAULTS,
  'new_story_ad.scene_vision': NEW_STORY_AD_CONSISTENCY_VISION_DEFAULTS,
  'new_story_ad.scene_consistency_qa': NEW_STORY_AD_CONSISTENCY_VISION_DEFAULTS,
  'new_story_ad.scene_panorama_qa': NEW_STORY_AD_CONSISTENCY_VISION_DEFAULTS,
  'new_story_ad.scene_spatial_qa': NEW_STORY_AD_CONSISTENCY_VISION_DEFAULTS,
  'new_story_ad.asset_plan': NEW_STORY_AD_TEXT_DEFAULTS,
  'new_story_ad.person_plan_character': NEW_STORY_AD_TEXT_DEFAULTS,
  'new_story_ad.asset_plan_missing_sections_recovery': NEW_STORY_AD_TEXT_DEFAULTS,
  'new_story_ad.asset_plan_section_patch': NEW_STORY_AD_TEXT_DEFAULTS,
  'new_story_ad.asset_plan_scene_recovery': NEW_STORY_AD_TEXT_DEFAULTS,
  'new_story_ad.asset_plan_story_development': NEW_STORY_AD_TEXT_DEFAULTS,
  'new_story_ad.asset_plan_scene_coverage_recovery': [],
  'new_story_ad.scene_config': NEW_STORY_AD_TEXT_DEFAULTS,
  'new_story_ad.scene_config_language_repair': NEW_STORY_AD_TEXT_DEFAULTS,
  'new_story_ad.blueprint': NEW_STORY_AD_TEXT_DEFAULTS,
  'new_story_ad.blueprint_structure_repair': NEW_STORY_AD_TEXT_DEFAULTS,
  'new_story_ad.blueprint_language_repair': NEW_STORY_AD_TEXT_DEFAULTS,
  'new_story_ad.blueprint_polish': NEW_STORY_AD_TEXT_DEFAULTS,
  'new_story_ad.storyboard_table': NEW_STORY_AD_TEXT_DEFAULTS,
  'new_story_ad.storyboard_fill_missing': NEW_STORY_AD_TEXT_DEFAULTS,
  'new_story_ad.storyboard_rewrite': NEW_STORY_AD_TEXT_DEFAULTS,
  'new_story_ad.storyboard_language_repair': NEW_STORY_AD_TEXT_DEFAULTS,
  'new_story_ad.qa': NEW_STORY_AD_TEXT_DEFAULTS,
  'new_story_ad.json_repair': NEW_STORY_AD_TEXT_DEFAULTS,
  'new_story_ad.assist': NEW_STORY_AD_TEXT_DEFAULTS,
  'new_story_ad.brief_dialogue': NEW_STORY_AD_DIALOGUE_DEFAULTS,
  'new_story_ad.person_keyframe_qa': NEW_STORY_AD_CONSISTENCY_VISION_DEFAULTS,
  'new_story_ad.pet_consistency_qa': NEW_STORY_AD_CONSISTENCY_VISION_DEFAULTS,
  'new_story_ad.product_keyframe_qa': NEW_STORY_AD_CONSISTENCY_VISION_DEFAULTS,
  'new_story_ad.scene_camera_qa': NEW_STORY_AD_CONSISTENCY_VISION_DEFAULTS,
  'new_story_ad.video_frame_qa': NEW_STORY_AD_CONSISTENCY_VISION_DEFAULTS,
  'new_story_ad.cross_shot_visual_qa': NEW_STORY_AD_CONSISTENCY_VISION_DEFAULTS,
  'new_story_ad.person_sheet': NEW_STORY_AD_IMAGE_DEFAULTS,
  'new_story_ad.person_dossier_atlas': NEW_STORY_AD_IMAGE_DEFAULTS,
  'new_story_ad.person_dossier_expression': NEW_STORY_AD_IMAGE_DEFAULTS,
  'new_story_ad.person_dossier_action': NEW_STORY_AD_IMAGE_DEFAULTS,
  'new_story_ad.person_dossier_native_master': NEW_STORY_AD_IMAGE_DEFAULTS,
  'new_story_ad.person_dossier_wearable_accessory': NEW_STORY_AD_IMAGE_DEFAULTS,
  'new_story_ad.person_dossier_wardrobe_detail': NEW_STORY_AD_IMAGE_DEFAULTS,
  'new_story_ad.pet_dossier': NEW_STORY_AD_IMAGE_DEFAULTS,
  'new_story_ad.prop_dossier_atlas': NEW_STORY_AD_IMAGE_DEFAULTS,
  'new_story_ad.product_asset': NEW_STORY_AD_IMAGE_DEFAULTS,
  'new_story_ad.scene_asset': NEW_STORY_AD_IMAGE_DEFAULTS,
  'new_story_ad.scene_extension_atlas': NEW_STORY_AD_IMAGE_DEFAULTS,
  'new_story_ad.scene_extension_master': NEW_STORY_AD_IMAGE_DEFAULTS,
  'new_story_ad.scene_extension_layout': NEW_STORY_AD_IMAGE_DEFAULTS,
  'new_story_ad.scene_extension_reverse': NEW_STORY_AD_IMAGE_DEFAULTS,
  'new_story_ad.scene_extension_interaction': NEW_STORY_AD_IMAGE_DEFAULTS,
  'new_story_ad.scene_extension_detail': NEW_STORY_AD_IMAGE_DEFAULTS,
  'new_story_ad.scene_panorama': NEW_STORY_AD_IMAGE_DEFAULTS,
  'new_story_ad.scene_depth': [],
  'new_story_ad.scene_spatial_reconstruction': [],
  'new_story_ad.keyframe': NEW_STORY_AD_IMAGE_DEFAULTS,
  'new_story_ad.storyboard_sketch': NEW_STORY_AD_IMAGE_DEFAULTS,
  'new_story_ad.video': [
    { provider_id: 'smscrw', model_id: 'doubao-seedance-2-0-260128', priority: 1, enabled: true },
    { provider_id: 'deyunai', model_id: 'doubao-seedance-2-0-260128', priority: 2, enabled: true },
    { provider_id: 'deyunai', model_id: 'doubao-seedance-2-0-fast-260128', priority: 3, enabled: true },
    { provider_id: 'topview', model_id: 'topview-image2video-pro', priority: 4, enabled: false },
    { provider_id: 'volcengine', model_id: 'doubao-seedance-2-0-260128', priority: 5, enabled: false },
  ],
  'new_story_ad.tts': [
    { provider_id: 'aliyun-tts', model_id: 'cosyvoice-v3.5-plus', priority: 1, enabled: true },
    { provider_id: 'aliyun-tts', model_id: 'cosyvoice-v3-flash', priority: 2, enabled: true },
  ],
  'new_story_ad.lip_sync': [
    { provider_id: 'deyunai', model_id: 'doubao-seedance-2-0-260128', priority: 1, enabled: true },
    { provider_id: 'topview', model_id: 'topview-avatar4', priority: 2, enabled: true },
    { provider_id: 'topview', model_id: 'topview-avatar4-fast', priority: 3, enabled: true },
    { provider_id: 'hifly', model_id: 'hifly', priority: 4, enabled: true },
    { provider_id: 'volcengine', model_id: 'jimeng_realman_avatar_picture_omni_v15', priority: 5, enabled: true },
  ],
  'new_story_ad.sound_generation': [
    { provider_id: 'smscrw', model_id: 'doubao-seedance-2-0-260128', priority: 1, enabled: true },
    { provider_id: 'deyunai', model_id: 'doubao-seedance-2-0-260128', priority: 2, enabled: true },
    { provider_id: 'deyunai', model_id: 'doubao-seedance-2-0-fast-260128', priority: 3, enabled: true },
    { provider_id: 'volcengine', model_id: 'doubao-seedance-2-0-260128', priority: 4, enabled: false },
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

function isNewStoryAdImageStage(stageId = '') {
  return NEW_STORY_AD_IMAGE_STAGE_IDS.has(String(stageId || '').trim());
}

function isStageModelAllowed(stageId = '', model = {}) {
  if (!isNewStoryAdImageStage(stageId)) return true;
  if (String(stageId || '').trim() === 'new_story_ad.scene_panorama') {
    const capabilityService = require('./modelCapabilityService');
    return capabilityService.modelCapabilityReport(model, NEW_STORY_AD_PANORAMA_REQUIRED_CAPABILITIES).supported;
  }
  // Paid story-ad media is selected explicitly by the task owner. Keep the
  // panorama capability contract, but do not silently force every other image
  // stage back to one model after the user selected a different configured
  // image route.
  return true;
}

function filterStageModels(stageId = '', models = []) {
  const list = Array.isArray(models) ? models : [];
  return list.filter(model => isStageModelAllowed(stageId, model));
}

function sanitizePipelineConfig(config = {}) {
  const stages = { ...(config.stages || {}) };
  for (const stageId of NEW_STORY_AD_IMAGE_STAGE_IDS) {
    if (!Array.isArray(stages[stageId])) continue;
    stages[stageId] = filterStageModels(stageId, stages[stageId]).map((model, index) => ({
      ...model,
      priority: index + 1,
    }));
  }
  return { stages };
}

function listDefaults() { return STAGE_DEFAULTS; }
function getStageDefaults(stageId) { return filterStageModels(stageId, STAGE_DEFAULTS[stageId] || []); }

function isStrictPipelineManagedStage(stageId) {
  const id = String(stageId || '').trim();
  return id.startsWith('new_story_ad.');
}

function preferDeyunaiForNonVideoStages(stages = {}, defaults = {}) {
  const next = {};
  const stageIds = new Set([...Object.keys(defaults || {}), ...Object.keys(stages || {})]);
  for (const stageId of stageIds) {
    const models = stages?.[stageId] || [];
    const list = Array.isArray(models) ? models.filter(Boolean).map(model => ({ ...model })) : [];
    const meta = getStageMeta(stageId);
    if (isStrictPipelineManagedStage(stageId) || !list.length || String(meta?.type || '').toLowerCase() === 'video') {
      next[stageId] = list;
      continue;
    }
    const existingKeys = new Set(list.map(model =>
      `${String(model.provider_id || '').trim().toLowerCase()}/${String(model.model_id || '').trim().toLowerCase()}`
    ));
    const defaultDeyunai = (defaults?.[stageId] || [])
      .filter(model => String(model?.provider_id || '').trim().toLowerCase() === 'deyunai')
      .filter(model => {
        const key = `${String(model.provider_id || '').trim().toLowerCase()}/${String(model.model_id || '').trim().toLowerCase()}`;
        return key && !existingKeys.has(key);
      })
      .map(model => ({ ...model, enabled: true }));
    if (defaultDeyunai.length) list.push(...defaultDeyunai);
    const preferred = [];
    const others = [];
    for (const model of list) {
      const item = { ...model };
      if (String(item.provider_id || '').trim().toLowerCase() === 'deyunai') {
        item.enabled = true;
        preferred.push(item);
      } else {
        others.push(item);
      }
    }
    next[stageId] = [...preferred, ...others].map((model, index) => ({
      ...model,
      priority: index + 1,
    }));
  }
  return next;
}

Object.assign(STAGE_DEFAULTS, preferDeyunaiForNonVideoStages(STAGE_DEFAULTS));

function loadConfig() {
  const dbConfig = sqliteConfig.getDbConfig();
  if (dbConfig.enabled && dbConfig.readPrimary) {
    try {
      const c = appKv.get('pipeline_model_config.full', null);
      if (c) return sanitizePipelineConfig(c);
      if (!dbConfig.jsonFallback) return { stages: {} };
    } catch (error) {
      if (!dbConfig.jsonFallback) throw error;
    }
  }
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const c = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      return sanitizePipelineConfig(c);
    }
  } catch {}
  return { stages: {} };
}

function saveConfig(config) {
  const dbConfig = sqliteConfig.getDbConfig();
  const normalized = sanitizePipelineConfig(config);
  if (dbConfig.enabled) appKv.set('pipeline_model_config.full', normalized);
  if (dbConfig.enabled && dbConfig.readPrimary && !dbConfig.dualWrite) return;
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(normalized, null, 2), 'utf8');
}

function listSchema() { return PIPELINE_SCHEMA; }

function getStageConfig(stageId) {
  return loadConfig().stages[stageId] || [];
}

function hasStageConfig(stageId) {
  const stages = loadConfig().stages || {};
  return Object.prototype.hasOwnProperty.call(stages, stageId);
}

function getStageMeta(stageId) {
  for (const group of Object.values(PIPELINE_SCHEMA)) {
    const found = (group || []).find(item => item.id === stageId);
    if (found) return found;
  }
  return null;
}

function _providerPresetHasModel(provider = {}, modelId = '') {
  const id = String(modelId || '').trim().toLowerCase();
  if (!id) return false;
  try {
    const { PROVIDER_PRESETS } = require('./settingsService');
    const presetId = String(provider.preset || provider.id || '').trim();
    const preset = PROVIDER_PRESETS?.[presetId];
    return Array.isArray(preset?.defaultModels)
      && preset.defaultModels.some(m => String(m?.id || '').trim().toLowerCase() === id);
  } catch {
    return false;
  }
}

function _findProviderForRouting(providerId = '') {
  try {
    const { loadSettings } = require('./settingsService');
    const target = String(providerId || '').trim().toLowerCase();
    return (loadSettings().providers || []).find(p =>
      p && p.enabled !== false
      && [p.id, p.preset].filter(Boolean).some(v => String(v).trim().toLowerCase() === target)
    ) || null;
  } catch {
    return null;
  }
}

function _findProviderInSettings(settings = {}, providerId = '') {
  const target = String(providerId || '').trim().toLowerCase();
  if (!target) return null;
  return (settings.providers || []).find(p =>
    p && p.enabled !== false
    && [p.id, p.preset].filter(Boolean).some(v => String(v).trim().toLowerCase() === target)
  ) || null;
}

function _findPresetModel(provider = {}, modelId = '') {
  const target = String(modelId || '').trim().toLowerCase();
  if (!target) return null;
  try {
    const { PROVIDER_PRESETS } = require('./settingsService');
    const presetId = String(provider.preset || provider.id || '').trim();
    const preset = PROVIDER_PRESETS?.[presetId];
    return (preset?.defaultModels || []).find(m =>
      String(m?.id || '').trim().toLowerCase() === target
    ) || null;
  } catch {
    return null;
  }
}

function ensureProviderModelsEnabledForStage(models = []) {
  const input = Array.isArray(models) ? models : [];
  const targets = input
    .filter(m => m && m.enabled !== false && m.provider_id && m.model_id)
    .map(m => ({
      provider_id: String(m.provider_id).trim(),
      model_id: String(m.model_id).trim(),
    }))
    .filter(m => m.provider_id && m.model_id);

  if (!targets.length) return [];

  try {
    const { loadSettings, saveSettings } = require('./settingsService');
    const settings = loadSettings();
    let changed = false;
    const autoEnabled = [];

    for (const target of targets) {
      const provider = _findProviderInSettings(settings, target.provider_id);
      if (!provider) continue;
      provider.models = Array.isArray(provider.models) ? provider.models : [];
      const model = provider.models.find(m =>
        String(m?.id || '').trim().toLowerCase() === target.model_id.toLowerCase()
      );

      if (model) {
        if (model.enabled === false) {
          model.enabled = true;
          changed = true;
          autoEnabled.push({ ...target, action: 'enabled_existing_provider_model' });
        }
        continue;
      }

      const presetModel = _findPresetModel(provider, target.model_id);
      if (!presetModel) continue;
      provider.models.push({ ...presetModel, id: target.model_id, enabled: true });
      changed = true;
      autoEnabled.push({ ...target, action: 'added_preset_provider_model' });
    }

    if (changed) saveSettings(settings);
    return autoEnabled;
  } catch {
    return [];
  }
}

function _modelUseMatchesStage(stageType = '', provider = {}, model = {}) {
  const type = String(stageType || '').toLowerCase();
  const use = String(model.use || model.type || '').toLowerCase();
  const modelText = `${model.id || model.model_id || ''} ${model.name || ''}`.toLowerCase();
  if (!type || type === 'all') return true;
  if (type === 'story') return ['story', 'chat', 'llm'].includes(use);
  if (type === 'vlm') {
    return isVlmCapableModel(provider, model)
      || ['story', 'chat', 'llm', 'vlm', 'vision', 'visual'].includes(use)
      || /gemini|gpt-4o|claude|glm-4v|glm-4\.5v|glm-4\.6v|qwen.*vl|vision|multimodal|多模态/.test(modelText);
  }
  if (type === 'avatar') return ['avatar', 'video', 'image'].includes(use);
  return use === type;
}

function _providerAuthReady(providerId = '', provider = null) {
  const id = String(providerId || '').trim().toLowerCase();
  if (!provider) return false;
  if (id === 'topview' || String(provider.id || '').toLowerCase() === 'topview') {
    return !!(_providerApiKey(providerId, provider) || process.env.TOPVIEW_API_KEY)
      && !!(provider.topview_uid || provider.api_uid || provider.uid || process.env.TOPVIEW_UID);
  }
  return !!_providerApiKey(providerId, provider);
}

function _providerApiKey(providerId = '', provider = null) {
  try {
    const { getApiKey } = require('./settingsService');
    return getApiKey(provider?.id) || getApiKey(providerId) || provider?.api_key || '';
  } catch {
    return provider?.api_key || '';
  }
}

function _providerBaseUrl(provider = {}) {
  return String(provider.base_url || provider.api_url || '').trim().replace(/\/$/, '');
}

function _stageNeedsModelCatalogValidation(stageId = '') {
  const meta = getStageMeta(stageId);
  return ['story', 'vlm', 'image'].includes(String(meta?.type || '').toLowerCase());
}

function validateStageModel(stageId, model = {}) {
  const providerId = String(model.provider_id || '').trim();
  const modelId = String(model.model_id || '').trim();
  if (!providerId || !modelId) return { ok: false, reason: 'missing_provider_or_model' };
  if (!isStageModelAllowed(stageId, model)) return { ok: false, reason: 'stage_requires_gpt_image_2' };
  const provider = _findProviderForRouting(providerId);
  if (!provider) return { ok: false, reason: 'provider_not_enabled_or_missing' };
  if (!_providerAuthReady(providerId, provider)) return { ok: false, reason: 'provider_auth_missing' };

  const models = Array.isArray(provider.models) ? provider.models : [];
  const explicit = models.find(m => String(m?.id || '').trim().toLowerCase() === modelId.toLowerCase());
  if (explicit?.enabled === false) return { ok: false, reason: 'model_disabled_in_provider' };
  if (!explicit && !_providerPresetHasModel(provider, modelId)) return { ok: false, reason: 'model_not_in_provider_list' };

  const stageMeta = getStageMeta(stageId);
  const providerModel = explicit || { id: modelId, use: stageMeta?.type || model.use || '' };
  if (!_modelUseMatchesStage(stageMeta?.type, provider, providerModel)) {
    return { ok: false, reason: `model_use_mismatch_for_${stageMeta?.type || 'stage'}` };
  }
  return { ok: true, reason: 'runnable' };
}

async function validateStageModelLive(stageId, model = {}, options = {}) {
  const staticReport = validateStageModel(stageId, model);
  if (!staticReport.ok) return staticReport;
  if (options.live === false || !_stageNeedsModelCatalogValidation(stageId)) return staticReport;

  const providerId = String(model.provider_id || '').trim();
  const modelId = String(model.model_id || '').trim();
  const provider = _findProviderForRouting(providerId);
  const baseUrl = _providerBaseUrl(provider);
  const key = _providerApiKey(providerId, provider);
  if (!baseUrl) return staticReport;
  if (!key) return { ok: false, reason: 'provider_auth_missing' };

  try {
    const response = await axios.get(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      timeout: Math.max(1500, Math.min(12000, Number(options.timeoutMs) || 8000)),
      validateStatus: status => status >= 200 && status < 500,
    });
    if (response.status < 200 || response.status >= 300) {
      return { ok: true, reason: `runnable_static_catalog_unverified_http_${response.status}` };
    }
    const data = Array.isArray(response.data?.data) ? response.data.data : null;
    if (!data) return { ok: true, reason: 'runnable_static_catalog_unverified_response' };
    if (!data.length) return { ok: false, reason: 'provider_models_empty' };
    const found = data.some(item => String(item?.id || item?.model || '').trim().toLowerCase() === modelId.toLowerCase());
    if (!found) return { ok: false, reason: 'model_not_available_from_provider_models' };
    return { ok: true, reason: 'runnable_live_catalog' };
  } catch (error) {
    const code = error?.code || error?.response?.status || 'request_failed';
    return { ok: true, reason: `runnable_static_catalog_unverified_${code}` };
  }
}

function setStageConfig(stageId, models) {
  const input = Array.isArray(models) ? models : [];
  const allowedInput = filterStageModels(stageId, input);
  const autoEnabled = ensureProviderModelsEnabledForStage(allowedInput);
  const config = loadConfig();
  config.stages = config.stages || {};
  const rejected = input
    .filter(model => model && model.provider_id && model.model_id && !isStageModelAllowed(stageId, model))
    .map(model => ({ ...model, reason: 'stage_requires_gpt_image_2' }));
  const seen = new Set();
  const validated = allowedInput
    .filter(m => m && m.provider_id && m.model_id)
    .filter(m => {
      const key = `${String(m.provider_id).trim().toLowerCase()}/${String(m.model_id).trim().toLowerCase()}`;
      if (seen.has(key)) {
        rejected.push({ ...m, reason: 'duplicate_model' });
        return false;
      }
      seen.add(key);
      const report = validateStageModel(stageId, m);
      if (!report.ok) rejected.push({ ...m, reason: report.reason });
      return report.ok;
    })
    .map((m, i) => {
      const item = {
        provider_id: String(m.provider_id),
        model_id: String(m.model_id),
        priority: Number.isFinite(+m.priority) ? +m.priority : i + 1,
        enabled: m.enabled !== false,
      };
      if (Array.isArray(m.capabilities)) {
        item.capabilities = m.capabilities.map(String).filter(Boolean);
      } else if (m.capabilities && typeof m.capabilities === 'object') {
        item.capabilities = Object.fromEntries(
          Object.entries(m.capabilities).map(([key, value]) => [String(key), value === true])
        );
      }
      ['actor_sheet_full_body', 'portrait_aspect_lock'].forEach(key => {
        if (m[key] === true || m[key] === false) item[key] = m[key] === true;
      });
      return item;
    })
    .sort((a, b) => a.priority - b.priority);
  config.stages[stageId] = validated;
  saveConfig(config);
  return { models: validated, rejected, auto_enabled_models: autoEnabled };
}

async function setStageConfigAsync(stageId, models, options = {}) {
  const input = Array.isArray(models) ? models : [];
  const allowedInput = filterStageModels(stageId, input);
  const autoEnabled = ensureProviderModelsEnabledForStage(allowedInput);
  const config = loadConfig();
  config.stages = config.stages || {};
  const rejected = input
    .filter(model => model && model.provider_id && model.model_id && !isStageModelAllowed(stageId, model))
    .map(model => ({ ...model, reason: 'stage_requires_gpt_image_2' }));
  const seen = new Set();
  const validated = [];
  for (let i = 0; i < allowedInput.length; i += 1) {
    const m = allowedInput[i];
    if (!m || !m.provider_id || !m.model_id) continue;
    const key = `${String(m.provider_id).trim().toLowerCase()}/${String(m.model_id).trim().toLowerCase()}`;
    if (seen.has(key)) {
      rejected.push({ ...m, reason: 'duplicate_model' });
      continue;
    }
    seen.add(key);
    const report = await validateStageModelLive(stageId, m, options);
    if (!report.ok) {
      rejected.push({ ...m, reason: report.reason });
      continue;
    }
    const item = {
      provider_id: String(m.provider_id),
      model_id: String(m.model_id),
      priority: Number.isFinite(+m.priority) ? +m.priority : i + 1,
      enabled: m.enabled !== false,
    };
    if (Array.isArray(m.capabilities)) {
      item.capabilities = m.capabilities.map(String).filter(Boolean);
    } else if (m.capabilities && typeof m.capabilities === 'object') {
      item.capabilities = Object.fromEntries(
        Object.entries(m.capabilities).map(([capKey, value]) => [String(capKey), value === true])
      );
    }
    ['actor_sheet_full_body', 'portrait_aspect_lock'].forEach(flagKey => {
      if (m[flagKey] === true || m[flagKey] === false) item[flagKey] = m[flagKey] === true;
    });
    validated.push(item);
  }
  config.stages[stageId] = validated.sort((a, b) => a.priority - b.priority);
  saveConfig(config);
  return { models: config.stages[stageId], rejected, auto_enabled_models: autoEnabled };
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
  if (hasStageConfig(stageId)) return pickModel(stageId);
  return getStageDefaults(stageId).find(m => m.enabled) || null;
}

/** 拿到该 stage 的所有 enabled 模型（按优先级） — 用于 fallback 链 */
function pickAllEnabled(stageId) {
  return getStageConfig(stageId).filter(m => m.enabled);
}

function pickAllEnabledWithDefault(stageId) {
  if (hasStageConfig(stageId)) return pickAllEnabled(stageId);
  return getStageDefaults(stageId).filter(m => m.enabled);
}

function isVlmCapableModel(provider, model) {
  const use = String(model?.use || '').toLowerCase();
  const type = String(model?.type || '').toLowerCase();
  if (['vlm', 'vision', 'visual'].includes(use) || ['vlm', 'vision', 'visual'].includes(type)) return true;
  if (['image', 'video', 'tts', 'audio', 'music', 'embedding', 'avatar'].includes(use)
    || ['image', 'video', 'tts', 'audio', 'music', 'embedding', 'avatar'].includes(type)) return false;

  const providerText = `${provider?.id || ''} ${provider?.preset || ''} ${provider?.name || ''}`.toLowerCase();
  const modelText = `${model?.id || ''} ${model?.name || ''}`.toLowerCase();
  const isCompatibleMultimodalGateway = providerText.includes('deyunai')
    || providerText.includes('漫路')
    || providerText.includes('smscrw')
    || providerText.includes('szznai')
    || providerText.includes('ai.smscrw.cn');
  if (!isCompatibleMultimodalGateway) return false;

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

function listAvailableModelsForStage(stageId = '') {
  const meta = getStageMeta(stageId);
  return filterStageModels(stageId, listAvailableModels(meta?.type || 'all'));
}

module.exports = {
  PIPELINE_SCHEMA,
  STAGE_DEFAULTS,
  NEW_STORY_AD_IMAGE_STAGE_IDS,
  NEW_STORY_AD_REQUIRED_IMAGE_MODEL,
  NEW_STORY_AD_PANORAMA_REQUIRED_CAPABILITIES,
  listSchema,
  listDefaults,
  getStageDefaults,
  getStageMeta,
  isStrictPipelineManagedStage,
  isNewStoryAdImageStage,
  isStageModelAllowed,
  filterStageModels,
  sanitizePipelineConfig,
  preferDeyunaiForNonVideoStages,
  loadConfig,
  saveConfig,
  getStageConfig,
  hasStageConfig,
  setStageConfig,
  setStageConfigAsync,
  validateStageModel,
  validateStageModelLive,
  pickModel,
  pickModelWithDefault,
  pickAllEnabled,
  pickAllEnabledWithDefault,
  listAvailableModels,
  listAvailableModelsForStage,
};
