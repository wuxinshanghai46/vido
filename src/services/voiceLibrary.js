/**
 * 公开 TTS 音色库 — 各供应商已公开的可用音色清单
 *
 * 来源：官方文档公开的 voice id 列表
 *   - 科大讯飞 https://www.xfyun.cn/doc/tts/online_tts/API.html
 *   - 火山引擎豆包 https://www.volcengine.com/docs/6561/97465
 *   - 阿里云 CosyVoice https://help.aliyun.com/zh/isi/
 *   - MiniMax Speech https://platform.minimaxi.com/document
 *   - ElevenLabs https://elevenlabs.io/voice-library
 *   - 智谱 GLM-TTS https://open.bigmodel.cn/
 *
 * 音色 id 会被作为 voiceId 透传给 ttsService，由对应 provider 处理
 */

const PUBLIC_VOICE_LIBRARY = {
  // ── 科大讯飞（需 APPID:APISecret:APIKey 格式 key）──
  xunfei: [
    { id: 'xiaoyan',    name: '小燕（温柔女声）',   gender: 'female', tag: '温柔' },
    { id: 'aisjiuxu',   name: '许久（沉稳男声）',   gender: 'male',   tag: '沉稳' },
    { id: 'aisxping',   name: '小萍（甜美女声）',   gender: 'female', tag: '甜美' },
    { id: 'aisjinger',  name: '晶儿（清亮女声）',   gender: 'female', tag: '清亮' },
    { id: 'aisbabyxu',  name: '许小宝（童声）',     gender: 'child',  tag: '童声' },
    { id: 'aisxle',     name: '凌小乐（助手女声）', gender: 'female', tag: '助手' },
    { id: 'aisfzh',     name: '凌飞哲（自然男声）', gender: 'male',   tag: '自然' },
    { id: 'x4_yeting',  name: '聆飞皓（中年男声）', gender: 'male',   tag: '中年' },
    { id: 'x4_xiaoyan', name: '聆小燕（亲和女声）', gender: 'female', tag: '亲和' },
    { id: 'x4_lingxiaoya_em', name: '聆小雅（情感女声）', gender: 'female', tag: '情感' },
    { id: 'x4_xiaoguo', name: '聆小琨（播音男声）', gender: 'male',   tag: '播音' },
    { id: 'x4_pengfei', name: '聆鹏飞（故事男声）', gender: 'male',   tag: '故事' },
  ],

  // ── 火山引擎（豆包 TTS，voice_type 格式 BV****_streaming）──
  volcengine: [
    { id: 'BV700_streaming', name: '灿灿（甜美）',     gender: 'female', tag: '甜美' },
    { id: 'BV700_V2_streaming', name: '灿灿v2',       gender: 'female', tag: '升级版' },
    { id: 'BV705_streaming', name: '甜美小源',         gender: 'female', tag: '甜美' },
    { id: 'BV001_streaming', name: '通用女声',         gender: 'female', tag: '通用' },
    { id: 'BV002_streaming', name: '通用男声',         gender: 'male',   tag: '通用' },
    { id: 'BV005_streaming', name: '温柔淑女',         gender: 'female', tag: '温柔' },
    { id: 'BV009_streaming', name: '知性女声',         gender: 'female', tag: '知性' },
    { id: 'BV011_streaming', name: '亲切女声',         gender: 'female', tag: '亲切' },
    { id: 'BV034_streaming', name: '甜宠少御',         gender: 'female', tag: '甜宠' },
    { id: 'BV406_streaming', name: '新闻女声',         gender: 'female', tag: '新闻' },
    { id: 'BV407_streaming', name: '促销女声',         gender: 'female', tag: '促销' },
    { id: 'BV006_streaming', name: '磁性男声',         gender: 'male',   tag: '磁性' },
    { id: 'BV004_streaming', name: '开朗青年',         gender: 'male',   tag: '开朗' },
    { id: 'BV113_streaming', name: '阳光青年',         gender: 'male',   tag: '阳光' },
    { id: 'BV115_streaming', name: '儒雅青年',         gender: 'male',   tag: '儒雅' },
    { id: 'BV213_streaming', name: '霸气青叔',         gender: 'male',   tag: '霸气' },
    { id: 'BV503_streaming', name: '亲切男声',         gender: 'male',   tag: '亲切' },
    { id: 'BV504_streaming', name: '新闻男声',         gender: 'male',   tag: '新闻' },
    { id: 'BV515_streaming', name: '促销男声',         gender: 'male',   tag: '促销' },
    { id: 'BV025_streaming', name: '知性姐姐',         gender: 'female', tag: '知性' },
    { id: 'BV061_streaming', name: '天才童声',         gender: 'child',  tag: '童声' },
    { id: 'BV064_streaming', name: '智慧老者',         gender: 'male',   tag: '长者' },
  ],

  // ── 阿里云 CosyVoice ──
  'aliyun-tts': [
    { id: 'longxiaochun',  name: '龙小春（邻家女孩）',  gender: 'female', tag: '邻家' },
    { id: 'longxiaoxia',   name: '龙小夏（知性女友）',  gender: 'female', tag: '知性' },
    { id: 'longwan',       name: '龙婉（温柔旁白）',    gender: 'female', tag: '旁白' },
    { id: 'longcheng',     name: '龙橙（活力少年）',    gender: 'male',   tag: '少年' },
    { id: 'longhua',       name: '龙华（儿童）',        gender: 'child',  tag: '儿童' },
    { id: 'longshu',       name: '龙书（标准男声）',    gender: 'male',   tag: '标准' },
    { id: 'longxiaocheng', name: '龙小诚（温暖男声）',  gender: 'male',   tag: '温暖' },
    { id: 'longxiang',     name: '龙祥（新闻男声）',    gender: 'male',   tag: '新闻' },
    { id: 'loongbella',    name: 'Bella（英文女声）',   gender: 'female', tag: '英文' },
    { id: 'loongstella',   name: 'Stella（活泼女声）',  gender: 'female', tag: '活泼' },
  ],

  // ── 百度 TTS ──
  baidu: [
    { id: '0',   name: '度小美（女声）',     gender: 'female', tag: '标准' },
    { id: '1',   name: '度小宇（男声）',     gender: 'male',   tag: '标准' },
    { id: '3',   name: '度逍遥（男声）',     gender: 'male',   tag: '磁性' },
    { id: '4',   name: '度丫丫（童声）',     gender: 'child',  tag: '童声' },
    { id: '5003','name': '度米朵（萝莉女声）',gender: 'female', tag: '萝莉' },
    { id: '5118',name: '度小鹿（甜美女声）', gender: 'female', tag: '甜美' },
    { id: '106', name: '度博文（专业男声）', gender: 'male',   tag: '专业' },
    { id: '110', name: '度小童（活泼男童）', gender: 'child',  tag: '男童' },
    { id: '111', name: '度小萌（萌妹女声）', gender: 'female', tag: '萌妹' },
    { id: '5',   name: '度小娇（女声）',     gender: 'female', tag: '温柔' },
  ],

  // ── MiniMax Speech ──
  minimax: [
    { id: 'male-qn-qingse',    name: '青涩青年音色', gender: 'male',   tag: '青涩' },
    { id: 'male-qn-jingying',  name: '精英青年音色', gender: 'male',   tag: '精英' },
    { id: 'male-qn-badao',     name: '霸道青年音色', gender: 'male',   tag: '霸道' },
    { id: 'male-qn-daxuesheng',name: '青年大学生',   gender: 'male',   tag: '学生' },
    { id: 'female-shaonv',     name: '少女音色',     gender: 'female', tag: '少女' },
    { id: 'female-yujie',      name: '御姐音色',     gender: 'female', tag: '御姐' },
    { id: 'female-chengshu',   name: '成熟女性',     gender: 'female', tag: '成熟' },
    { id: 'female-tianmei',    name: '甜美女性',     gender: 'female', tag: '甜美' },
    { id: 'presenter_male',    name: '男性主持人',   gender: 'male',   tag: '主持' },
    { id: 'presenter_female',  name: '女性主持人',   gender: 'female', tag: '主持' },
    { id: 'audiobook_male_1',  name: '男性有声书1',  gender: 'male',   tag: '有声书' },
    { id: 'audiobook_female_1',name: '女性有声书1',  gender: 'female', tag: '有声书' },
    { id: 'Speech_01_Turbo',   name: 'Speech 01 Turbo', gender: 'neutral', tag: '极速' },
  ],

  // ── ElevenLabs（英文为主，部分多语言）──
  elevenlabs: [
    { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel（美式女声）',   gender: 'female', tag: '美式' },
    { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi（活力女声）',     gender: 'female', tag: '活力' },
    { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella（柔和女声）',    gender: 'female', tag: '柔和' },
    { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni（温暖男声）',   gender: 'male',   tag: '温暖' },
    { id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli（年轻女声）',     gender: 'female', tag: '年轻' },
    { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh（深沉男声）',     gender: 'male',   tag: '深沉' },
    { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold（美式男声）',   gender: 'male',   tag: '美式' },
    { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam（标准男声）',     gender: 'male',   tag: '标准' },
    { id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam（随和男声）',      gender: 'male',   tag: '随和' },
  ],

  // ── 智谱 GLM-TTS ──
  zhipu: [
    { id: 'female-sweet',  name: '甜美女声',    gender: 'female', tag: '甜美' },
    { id: 'female-pro',    name: '专业女声',    gender: 'female', tag: '专业' },
    { id: 'female-young',  name: '青春女声',    gender: 'female', tag: '青春' },
    { id: 'male-mature',   name: '成熟男声',    gender: 'male',   tag: '成熟' },
    { id: 'male-young',    name: '青年男声',    gender: 'male',   tag: '青年' },
    { id: 'male-deep',     name: '磁性男声',    gender: 'male',   tag: '磁性' },
    { id: 'child',         name: '童声',        gender: 'child',  tag: '童声' },
    { id: 'glm-tts',       name: 'GLM-TTS 合成',gender: 'neutral',tag: '默认' },
  ],

  // ── Fish Audio（用户克隆声音放这里）──
  fishaudio: [
    { id: 'fish-default',  name: 'Fish 默认',    gender: 'neutral', tag: '默认' },
  ],

  // ── OpenAI TTS ──
  openai: [
    { id: 'alloy',   name: 'Alloy（中性）',  gender: 'neutral', tag: '中性' },
    { id: 'echo',    name: 'Echo（男声）',   gender: 'male',    tag: '标准' },
    { id: 'fable',   name: 'Fable（英式）',  gender: 'male',    tag: '英式' },
    { id: 'onyx',    name: 'Onyx（深沉）',   gender: 'male',    tag: '深沉' },
    { id: 'nova',    name: 'Nova（女声）',   gender: 'female',  tag: '标准' },
    { id: 'shimmer', name: 'Shimmer（柔和）',gender: 'female',  tag: '柔和' },
  ],
};

module.exports = { PUBLIC_VOICE_LIBRARY };
