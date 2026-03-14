require('dotenv').config();
const fs = require('fs');
const path = require('path');

const SETTINGS_PATH = path.join(__dirname, '../../outputs/settings.json');

// 预设供应商模板（用于"快速添加"下拉）
const PROVIDER_PRESETS = {
  openai:      { name: 'OpenAI',       api_url: 'https://api.openai.com/v1',                  defaultModels: [{ id: 'gpt-4o', name: 'GPT-4o', type: 'chat', use: 'story' }, { id: 'gpt-4o-mini', name: 'GPT-4o Mini', type: 'chat', use: 'story' }, { id: 'dall-e-3', name: 'DALL-E 3', type: 'image', use: 'image' }, { id: 'sora-2-pro', name: 'Sora 2 Pro（25秒·故事板·物理仿真最强）', type: 'video', use: 'video' }, { id: 'sora-2', name: 'Sora 2（旗舰·高质量）', type: 'video', use: 'video' }, { id: 'sora-2-mini', name: 'Sora 2 Mini（轻量·快速）', type: 'video', use: 'video' }, { id: 'tts-1', name: 'TTS-1', type: 'tts', use: 'tts' }] },
  deepseek:    { name: 'DeepSeek',     api_url: 'https://api.deepseek.com/v1',                 defaultModels: [{ id: 'deepseek-chat', name: 'DeepSeek Chat V3', type: 'chat', use: 'story' }, { id: 'deepseek-reasoner', name: 'DeepSeek R1', type: 'chat', use: 'story' }] },
  zhipu:       { name: '智谱 AI',      api_url: 'https://open.bigmodel.cn/api/paas/v4',        defaultModels: [{ id: 'cogview-3-flash', name: 'CogView-3-Flash', type: 'image', use: 'image' }, { id: 'cogvideox-flash', name: 'CogVideoX-Flash', type: 'video', use: 'video' }] },
  stability:   { name: 'Stability AI', api_url: 'https://api.stability.ai/v2beta',             defaultModels: [{ id: 'sd3.5-large', name: 'SD 3.5 Large', type: 'image', use: 'image' }, { id: 'sd3.5-large-turbo', name: 'SD 3.5 Turbo', type: 'image', use: 'image' }] },
  replicate:   { name: 'Replicate',    api_url: 'https://api.replicate.com/v1',                defaultModels: [{ id: 'flux-schnell', name: 'FLUX.1 Schnell', type: 'image', use: 'image' }, { id: 'flux-dev', name: 'FLUX.1 Dev', type: 'image', use: 'image' }, { id: 'wan-2-1', name: 'Wan 2.1', type: 'video', use: 'video' }] },
  huggingface: { name: 'HuggingFace',  api_url: 'https://api-inference.huggingface.co',        defaultModels: [{ id: 'modelscope-t2v', name: 'ModelScope T2V', type: 'video', use: 'video' }] },
  anthropic:   { name: 'Anthropic',    api_url: 'https://api.anthropic.com/v1',                defaultModels: [{ id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', type: 'chat', use: 'story' }, { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', type: 'chat', use: 'story' }] },
  qwen:        { name: '通义千问',      api_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModels: [{ id: 'qwen-max', name: 'Qwen Max', type: 'chat', use: 'story' }, { id: 'qwen-vl-max', name: 'Qwen VL Max', type: 'image', use: 'image' }] },
  // ——— 视频生成 ———
  fal:         { name: 'FAL.ai',       api_url: 'https://fal.run',                              defaultModels: [{ id: 'fal-ai/wan/v2.2/14b/text-to-video', name: 'Wan 2.2-14B（2D动画·最新版）', type: 'video', use: 'video' }, { id: 'fal-ai/wan/v2.1/1.3b/text-to-video', name: 'Wan 2.1-1.3B（2D动画·快速·免费）', type: 'video', use: 'video' }, { id: 'fal-ai/wan/v2.1/14b/text-to-video', name: 'Wan 2.1-14B（2D动画·高质量）', type: 'video', use: 'video' }, { id: 'fal-ai/kling-video/v1.6/standard/text-to-video', name: 'Kling 1.6 Standard（2D/3D动画）', type: 'video', use: 'video' }, { id: 'fal-ai/kling-video/v1.6/pro/text-to-video', name: 'Kling 1.6 Pro（高质量动画）', type: 'video', use: 'video' }, { id: 'fal-ai/ltx-video', name: 'LTX Video（2D·极速生成）', type: 'video', use: 'video' }, { id: 'fal-ai/ltx-video/v2', name: 'LTX-2（NVIDIA RTX优化·4K）', type: 'video', use: 'video' }, { id: 'fal-ai/hunyuan-video', name: 'HunyuanVideo（腾讯·高质量2D）', type: 'video', use: 'video' }, { id: 'fal-ai/hunyuan-video/v1.5', name: 'HunyuanVideo 1.5（开源SOTA·8.3B）', type: 'video', use: 'video' }] },
  runway:      { name: 'Runway ML',    api_url: 'https://api.dev.runwayml.com',                 defaultModels: [{ id: 'gen3a_turbo', name: 'Gen-3 Alpha Turbo（3D快速）', type: 'video', use: 'video' }, { id: 'gen4_turbo', name: 'Gen-4 Turbo（3D旗舰）', type: 'video', use: 'video' }, { id: 'gen4.5', name: 'Gen-4.5（最新旗舰·Elo最高·Motion Brush）', type: 'video', use: 'video' }, { id: 'gen4.5_turbo', name: 'Gen-4.5 Turbo（快速·高级镜头控制）', type: 'video', use: 'video' }] },
  luma:        { name: 'Luma AI',      api_url: 'https://api.lumalabs.ai',                      defaultModels: [{ id: 'ray-3', name: 'Ray3（原生HDR·4K升频·最长60秒）', type: 'video', use: 'video' }, { id: 'ray-2', name: 'Dream Machine Ray-2（3D）', type: 'video', use: 'video' }, { id: 'ray-2-720p', name: 'Dream Machine Ray-2 720p', type: 'video', use: 'video' }] },
  vidu:        { name: 'Vidu AI',     api_url: 'https://api.vidu.com',                        defaultModels: [{ id: 'vidu-q3', name: 'Vidu Q3（极快动漫·最长120秒·原生音频对话）', type: 'video', use: 'video' }, { id: 'vidu-q3-realistic', name: 'Vidu Q3 写实模式（120秒）', type: 'video', use: 'video' }] },
  minimax:     { name: 'MiniMax',      api_url: 'https://api.minimaxi.chat',                    defaultModels: [{ id: 'video-02', name: 'Hailuo 2.3（动漫/游戏CG/水墨风最佳·物理引擎）', type: 'video', use: 'video' }, { id: 'video-02-anime', name: 'Hailuo 2.3 动漫模式（专用2D动画优化）', type: 'video', use: 'video' }, { id: 'video-01', name: 'Hailuo Video-01（2D动画）', type: 'video', use: 'video' }, { id: 'video-01-live2d', name: 'Hailuo Video-01 Live2D（2D动漫）', type: 'video', use: 'video' }, { id: 'speech-01-turbo', name: 'MiniMax TTS Turbo（中文优质）', type: 'tts', use: 'tts' }, { id: 'speech-01-hd', name: 'MiniMax TTS HD（高清语音）', type: 'tts', use: 'tts' }] },
  kling:       { name: 'Kling AI',     api_url: 'https://api-beijing.klingai.com',               defaultModels: [{ id: 'kling-v3', name: 'Kling 3.0（4K/60fps·6镜头故事板·原生音频·2分钟）', type: 'video', use: 'video' }, { id: 'kling-v2-master', name: 'Kling V2 Master（旗舰）', type: 'video', use: 'video' }, { id: 'kling-v2.5-turbo-pro', name: 'Kling 2.5 Turbo Pro（快速·动作好）', type: 'video', use: 'video' }, { id: 'kling-v1-6', name: 'Kling v1.6（2D/3D动画）', type: 'video', use: 'video' }] },
  jimeng:      { name: '即梦AI',      api_url: 'https://visual.volcengineapi.com',               defaultModels: [
    { id: 'jimeng_vgfm_t2v_l20_pro',   name: '文生视频3.0 Pro（高质量写实）',  type: 'video', use: 'video' },
    { id: 'jimeng_vgfm_t2v_l20',       name: '文生视频3.0（标准）',            type: 'video', use: 'video' },
    { id: 'jimeng_vgfm_t2v_l20_lite',  name: '文生视频3.0 Lite（轻量快速）',   type: 'video', use: 'video' },
    { id: 'jimeng_vgfm_i2v_l20_pro',   name: '图生视频3.0 Pro（高质量）',      type: 'video', use: 'video' },
    { id: 'jimeng_vgfm_i2v_l20',       name: '图生视频3.0（标准）',            type: 'video', use: 'video' },
    { id: 'high_aes_general_v21_L',    name: '文生图2.1（通用高级版）',        type: 'image', use: 'image' },
    { id: 'high_aes_general_v20_L',    name: '文生图2.0（通用高级版）',        type: 'image', use: 'image' },
    { id: 't2i_xl_sft',                name: '文生图XL（2K超清）',             type: 'image', use: 'image' },
    { id: 'high_aes',                  name: '文生图1.3（通用版）',            type: 'image', use: 'image' },
  ] },
  pika:        { name: 'Pika',         api_url: 'https://api.pika.art',                          defaultModels: [{ id: 'pika-2.1', name: 'Pika 2.1 Turbo（风格化·VFX特效丰富）', type: 'video', use: 'video' }, { id: 'pika-2.1-effects', name: 'Pika 2.1 特效模式（爆炸/火焰/粒子）', type: 'video', use: 'video' }, { id: 'pika-2.0', name: 'Pika 2.0（2D/3D高质量）', type: 'video', use: 'video' }, { id: 'pika-1.5', name: 'Pika 1.5（快速）', type: 'video', use: 'video' }] },
  seedance:    { name: 'Seedance',    api_url: 'https://queue.fal.run',                          defaultModels: [
    { id: 'fal-ai/seedance/video/text-to-video', name: 'Seedance 1.x T2V（动作优秀·原生音频）', type: 'video', use: 'video' },
    { id: 'fal-ai/seedance/video/image-to-video', name: 'Seedance 1.x I2V（图生视频·动作优秀）', type: 'video', use: 'video' },
    { id: 'fal-ai/seedance/v2/text-to-video', name: 'Seedance 2.0 T2V（12文件多模态·动作最强·角色一致性）', type: 'video', use: 'video' },
    { id: 'fal-ai/seedance/v2/image-to-video', name: 'Seedance 2.0 I2V（多参考图·角色一致性引擎）', type: 'video', use: 'video' },
  ] },
  veo:         { name: 'Google Veo',  api_url: 'https://generativelanguage.googleapis.com/v1beta', defaultModels: [
    { id: 'veo-3.1', name: 'Veo 3.1（广播级画质·原生音频·最强照片写实·$0.40/s）', type: 'video', use: 'video' },
    { id: 'veo-3.1-fast', name: 'Veo 3.1 Fast（快速·$0.15/s）', type: 'video', use: 'video' },
    { id: 'veo-3', name: 'Veo 3（高质量·音频同步）', type: 'video', use: 'video' },
  ] },
  // ——— 语音合成 ———
  elevenlabs:  { name: 'ElevenLabs',   api_url: 'https://api.elevenlabs.io/v1',                 defaultModels: [{ id: 'eleven_multilingual_v2', name: 'Multilingual v2（多语言高质）', type: 'tts', use: 'tts' }, { id: 'eleven_flash_v2_5', name: 'Flash v2.5（极速）', type: 'tts', use: 'tts' }] },
  fishaudio:   { name: 'Fish Audio',   api_url: 'https://api.fish.audio/v1',                    defaultModels: [{ id: 'speech-1.5', name: 'Fish Speech 1.5（中文/多语言·极自然）', type: 'tts', use: 'tts' }] },
  volcengine:  { name: '火山引擎(豆包)', api_url: 'https://openspeech.bytedance.com/api/v1',   defaultModels: [
    { id: 'zh_female_tianmei', name: '甜美女声（天美）', type: 'tts', use: 'tts' },
    { id: 'zh_male_chunhou',  name: '醇厚男声（醇厚）', type: 'tts', use: 'tts' },
    { id: 'zh_female_story',  name: '故事女声',         type: 'tts', use: 'tts' },
    { id: 'zh_child_girl',    name: '童声女孩',         type: 'tts', use: 'tts' },
    { id: 'zh_male_rap',      name: '说唱男声',         type: 'tts', use: 'tts' },
  ] },
  baidu:       { name: '百度语音',       api_url: 'https://tsn.baidu.com',                     defaultModels: [
    { id: '0',    name: '度小美（标准女声）', type: 'tts', use: 'tts' },
    { id: '1',    name: '度小宇（标准男声）', type: 'tts', use: 'tts' },
    { id: '3',    name: '度逍遥（情感男声）', type: 'tts', use: 'tts' },
    { id: '4',    name: '度丫丫（可爱女童）', type: 'tts', use: 'tts' },
    { id: '5003', name: '度米朵（情感女声）', type: 'tts', use: 'tts' },
    { id: '106',  name: '度博文（情感男声）', type: 'tts', use: 'tts' },
  ] },
  'aliyun-tts': { name: '阿里云CosyVoice', api_url: 'https://dashscope.aliyuncs.com/api/v1',  defaultModels: [
    { id: 'longxiaochun', name: '龙小纯（温柔女声）', type: 'tts', use: 'tts' },
    { id: 'longcheng',    name: '龙城（沉稳男声）',   type: 'tts', use: 'tts' },
    { id: 'longhua',      name: '龙华（儒雅男声）',   type: 'tts', use: 'tts' },
    { id: 'longwan',      name: '龙婉（粤语女声）',   type: 'tts', use: 'tts' },
    { id: 'longyu',       name: '龙宇（重庆话男声）', type: 'tts', use: 'tts' },
  ] },
  xunfei: { name: '科大讯飞', api_url: 'wss://tts-api.xfyun.cn/v2/tts', defaultModels: [
    { id: 'xiaoyan', name: '小燕（温柔女声）', type: 'tts', use: 'tts' },
    { id: 'aisjiuxu', name: '许久（沉稳男声）', type: 'tts', use: 'tts' },
    { id: 'aisxping', name: '小萍（甜美女声）', type: 'tts', use: 'tts' },
    { id: 'aisjinger', name: '晶儿（清亮女声）', type: 'tts', use: 'tts' },
    { id: 'aisbabyxu', name: '许小宝（童声）', type: 'tts', use: 'tts' },
    { id: 'x4_lingxiaoli_assist', name: '凌小乐（助手女声）', type: 'tts', use: 'tts' },
    { id: 'x4_lingfeizhe_oral', name: '凌飞哲（自然男声）', type: 'tts', use: 'tts' },
  ] },
  // ——— 数字人 ———
  heygen: { name: 'HeyGen', api_url: 'https://api.heygen.com', defaultModels: [
    { id: 'avatar-v3', name: 'Avatar 3.0（照片级·全身·手势）', type: 'avatar', use: 'avatar' },
    { id: 'avatar-v2', name: 'Avatar 2.0（标准数字人）', type: 'avatar', use: 'avatar' },
    { id: 'streaming-avatar', name: 'Streaming Avatar（实时交互）', type: 'avatar', use: 'avatar' },
  ] },
  'did': { name: 'D-ID', api_url: 'https://api.d-id.com', defaultModels: [
    { id: 'talks', name: 'Talks（照片驱动说话）', type: 'avatar', use: 'avatar' },
    { id: 'clips', name: 'Clips（数字人视频片段）', type: 'avatar', use: 'avatar' },
    { id: 'live-portrait', name: 'Live Portrait（实时驱动）', type: 'avatar', use: 'avatar' },
  ] },
  synthesia: { name: 'Synthesia', api_url: 'https://api.synthesia.io/v2', defaultModels: [
    { id: 'personal-avatar', name: 'Personal Avatar（定制形象）', type: 'avatar', use: 'avatar' },
    { id: 'stock-avatar', name: 'Stock Avatar（预设形象）', type: 'avatar', use: 'avatar' },
  ] },
  custom:      { name: '',             api_url: '',                                              defaultModels: [] },
};

// .env 到供应商 ID 的映射（用于自动初始化）
const ENV_SEED_MAP = [
  { envKey: 'DEEPSEEK_API_KEY',    presetId: 'deepseek'  },
  { envKey: 'OPENAI_API_KEY',      presetId: 'openai'    },
  { envKey: 'ZHIPU_API_KEY',       presetId: 'zhipu'     },
  { envKey: 'STABILITY_API_KEY',   presetId: 'stability' },
  { envKey: 'REPLICATE_API_KEY',   presetId: 'replicate' },
  { envKey: 'HUGGINGFACE_API_KEY', presetId: 'huggingface' },
  { envKey: 'CLAUDE_API_KEY',      presetId: 'anthropic'   },
  { envKey: 'FAL_API_KEY',         presetId: 'fal'         },
  { envKey: 'RUNWAY_API_KEY',      presetId: 'runway'      },
  { envKey: 'LUMA_API_KEY',        presetId: 'luma'        },
  { envKey: 'VIDU_API_KEY',        presetId: 'vidu'        },
  { envKey: 'MINIMAX_API_KEY',     presetId: 'minimax'     },
  { envKey: 'KLING_API_KEY',       presetId: 'kling'       },
  { envKey: 'JIMENG_API_KEY',      presetId: 'jimeng'      },
  { envKey: 'PIKA_API_KEY',        presetId: 'pika'          },
  { envKey: 'SEEDANCE_API_KEY',    presetId: 'seedance'      },
  { envKey: 'VEO_API_KEY',         presetId: 'veo'           },
  { envKey: 'ELEVENLABS_API_KEY',  presetId: 'elevenlabs'  },
  { envKey: 'FISHAUDIO_API_KEY',   presetId: 'fishaudio'   },
  { envKey: 'VOLCENGINE_TTS_KEY', presetId: 'volcengine'  },
  { envKey: 'BAIDU_TTS_KEY',      presetId: 'baidu'       },
  { envKey: 'ALIYUN_TTS_KEY',     presetId: 'aliyun-tts'  },
  { envKey: 'HEYGEN_API_KEY',     presetId: 'heygen'      },
  { envKey: 'DID_API_KEY',        presetId: 'did'         },
  { envKey: 'SYNTHESIA_API_KEY',  presetId: 'synthesia'   },
];

function loadSettings() {
  if (fs.existsSync(SETTINGS_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    } catch {}
  }
  // 首次启动：从 .env 自动初始化
  return seedFromEnv();
}

function seedFromEnv() {
  const providers = [];
  for (const { envKey, presetId } of ENV_SEED_MAP) {
    const key = process.env[envKey];
    if (key) {
      const preset = PROVIDER_PRESETS[presetId];
      providers.push({
        id: presetId,
        name: preset.name,
        api_url: preset.api_url,
        api_key: key,
        enabled: true,
        models: preset.defaultModels.map(m => ({ ...m, enabled: true })),
        last_tested: null,
        test_status: null,
        created_at: new Date().toISOString(),
      });
    }
  }
  const data = { providers, mcps: [], skills: [] };
  saveSettings(data);
  return data;
}

function saveSettings(data) {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// 获取某供应商的 API Key（供其他 service 调用）
function getApiKey(providerId) {
  try {
    const settings = loadSettings();
    const p = settings.providers.find(p => p.id === providerId && p.enabled);
    return p?.api_key || '';
  } catch { return ''; }
}

module.exports = { loadSettings, saveSettings, getApiKey, PROVIDER_PRESETS };
