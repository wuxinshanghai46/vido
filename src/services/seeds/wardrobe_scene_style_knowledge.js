/**
 * 人物装束与场景风格知识（2026-08-08）
 *
 * 来源：用户提供的 26 篇微信公众号公开文章，经逐篇阅读后按 VIDO 的
 * 多造型、人物视觉合同、场景物理合同与运行时检索方式重新整理。
 * 这里只保存可复用的结构和选择规则，不复制原文提示词。
 */

const SOURCE_URLS = [
  'https://mp.weixin.qq.com/s/gB-MMOtlylxPbRSg6QLuEA',
  'https://mp.weixin.qq.com/s/K05OrCpO3wsyqpBcEMKY7g',
  'https://mp.weixin.qq.com/s/ZUzrwxhyY6CrHh96Eoo3TA',
  'https://mp.weixin.qq.com/s/TlYMWbM2KUqx0QHvEXITmQ',
  'https://mp.weixin.qq.com/s/XFarvON67zF4uUy3WzV9_Q',
  'https://mp.weixin.qq.com/s/5HQd-ZVq_ohe9TZASDBj3A',
  'https://mp.weixin.qq.com/s/AGMnzz0MEl7Xw7XbfqBD-w',
  'https://mp.weixin.qq.com/s/SLLgg8w-qL2ab3GMXnSH3g',
  'https://mp.weixin.qq.com/s/Kxi83NBQn2-O7kd52BekhA',
  'https://mp.weixin.qq.com/s/ls1q1F51yv6uN7Ku6FGbTg',
  'https://mp.weixin.qq.com/s/kX-xcx5HY8WndE5pyzBzhw',
  'https://mp.weixin.qq.com/s/31fxZzEHL4Tmd1imtQoG5Q',
  'https://mp.weixin.qq.com/s/bVIs8-46DOAm2hQMK9g4CQ',
  'https://mp.weixin.qq.com/s/SFuEF5UyclqRXp0pru7d0Q',
  'https://mp.weixin.qq.com/s/EWczmsHppl9na_GBIES8Rg',
  'https://mp.weixin.qq.com/s/-vJPI_kGUXCefK9L8ofYNQ',
  'https://mp.weixin.qq.com/s/5Q8n-JNcNPPJACZsbsUUHg',
  'https://mp.weixin.qq.com/s/5lLG6X3B3Ge4gtkvF3QE0w',
  'https://mp.weixin.qq.com/s/228zYjWBYCTtSaud-SAcGw',
  'https://mp.weixin.qq.com/s/GHO6TBUZXleXRk_VuDaFmw',
  'https://mp.weixin.qq.com/s/HdtXc7-Uu9DcHaYx_J-E3Q',
  'https://mp.weixin.qq.com/s/A0aIZxv28U9rNra9iwqRIQ',
  'https://mp.weixin.qq.com/s/I_pLe9m67PcAunUZFIuZTw',
  'https://mp.weixin.qq.com/s/sWUoSU7kR5ZzESR-s4NUjw',
  'https://mp.weixin.qq.com/s/82FByXzGzo1LiP0JWJ-X7w',
  'https://mp.weixin.qq.com/s/5TIOROeF1PJKBMohvT4tRw',
];

const common = {
  collection: 'digital_human',
  applies_to: ['character_consistency', 'prompt_engineer', 'art_director', 'director', 'project_assistant'],
  lang: 'zh',
  enabled: true,
  source_urls: SOURCE_URLS,
  source: '用户提供的 26 篇微信公众号人物设定、古今服饰、发型、场景与镜头文章；VIDO 结构化整理，2026-08-08',
};

module.exports = [
  {
    ...common,
    id: 'kb_wardrobe_closed_contract_20260808',
    subcategory: '造型合同',
    title: '人物造型闭环：从一句描述到可生成的结构化服装合同',
    summary: '任何男女、时代或地域造型都必须闭合到服装制式、鞋袜、配饰、配色、材质纹样和妆发；多造型按 look 独立保存。',
    content: `一套可生成、可验收、可跨镜复用的人物造型必须明确：
1. 服装制式：完整连体服；或上装+下装；或有明确层次的成套体系。记录单品类型、轮廓、领型、袖型、衣长、门襟、开衩、腰线和可见层次。
2. 鞋袜：类型、颜色、材质和高度；赤脚也必须是明确设定，不能留给模型猜。
3. 配饰：发饰、耳饰、颈饰、腕饰、腰饰、帽、眼镜、手袋等逐项记录类型、材质、颜色、位置和左右侧；无配饰时记录明确空清单。
4. 配色与材料：主色、辅色、点缀色；面料、光泽、透明度、纹理尺度、刺绣或印花位置。
5. 妆发：长度、分区、束发方式、刘海、发饰、妆面与年龄气质；妆发必须属于当前造型，不得只放人物全局字段。
6. 禁止项：容易与当前时代、身份或文化体系冲突的服装、饰品、发型和现代物件。

同一人物换装、跨时代或经历明确状态变化时，一个人物身份下建立多个独立 look_profiles。每个 look 有稳定 ID、故事状态和 scene_ids，禁止把两套衣服压进同一个 wardrobeText，也禁止用“室内时/必要时/偶尔佩戴”等条件句制造随机变化。`,
    tags: ['人物造型', '服装合同', '多造型', '鞋履', '配饰', '材质', '结构化'],
    keywords: ['wardrobe contract', 'garment system', 'look profile', 'footwear', 'accessory inventory'],
    prompt_snippets: ['先输出当前 look 的结构化 wardrobe_contract，再写自然语言提示词；结构合同缺任何一项都不得进入人物图片生成。'],
    runtime_policy: {
      schema_version: 1,
      rules: [{
        id: 'person-structured-wardrobe-contract', version: 1, status: 'active', priority: 96,
        stages: ['person_dossier'], asset_types: ['person'], enforcement: 'hard', conflict_key: 'person_wardrobe_completeness',
        instruction: 'For every look, preserve a structured wardrobe contract covering one complete garment system, footwear, an explicit accessory inventory or explicit none, palette, materials/pattern placement, hair/makeup and negative constraints. Keep different eras or story states in separate stable look IDs bound to their scenes.',
        negative: 'mixed look states, incomplete garment system, missing footwear or accessory decision, ungrounded era or cultural symbol',
        qa_checks: ['every look has a complete structured wardrobe contract', 'different eras and story states remain separate and scene-bound'],
      }],
    },
  },
  {
    ...common,
    id: 'kb_wardrobe_chinese_historical_20260808',
    subcategory: '中国古代服饰',
    title: '中国古代男女装束：先定服制，再定角色气质',
    summary: '覆盖古代男女基础服制、仙侠、武侠、宫廷、江湖、异域、妖族和敦煌方向，避免跨朝代与跨文化乱搭。',
    content: `中国古代造型不能停留在“古装美女/古装男子”。先判断真实朝代或架空古代，再按身份、阶层、职业、年龄和行动需求选择一套完整体系。

女性常用完整体系：襦裙（含齐胸、齐腰、交领或对襟等明确结构）、袄裙、褙子组合、马面裙组合、礼服或宫廷分层装束。男性常用完整体系：圆领袍、直裰/道袍、长衫、短打、武人便装或礼制服。每套都要补齐鞋履、袜履、腰带、发式发冠/簪钗或明确无饰、内外层次、主辅色、面料和纹样位置。

风格分流：
- 仙侠：云感、清冷、灵气或神性可以通过轮廓、发饰、法器、色系和场景共同表达；不能只堆飘带。
- 武侠/江湖：行动便利、束袖或层次清楚，鞋靴与腰带要支持移动；武器属于独立道具合同。
- 宫廷：身份等级由面料、纹样、冠饰和礼制层次表达；不等于满身金色。
- 异域、妖族、敦煌：必须明确文化来源或架空规则，控制图案、珠饰、头饰、肤感和色谱，不拼贴无关民族与宗教符号。

发型同样是身份语言：双丫髻适合少女，盘髻/凤冠用于明确礼仪状态，高束或高马尾偏行动型，半束发偏文雅，男子冠发、半束、发带、高马尾分别服务不同身份。不得把现代影楼盘发、现代首饰和智能设备混入古代画面。`,
    tags: ['古代男女', '汉服', '襦裙', '齐胸襦裙', '长衫', '圆领袍', '仙侠', '武侠', '敦煌'],
    keywords: ['Chinese historical costume', 'ruqun', 'qixiong ruqun', 'changshan', 'yuanlingpao', 'xianxia', 'wuxia'],
    prompt_snippets: ['先确定朝代/架空规则与人物身份，再从一个服制体系生成服装、鞋履、冠饰、色彩、材质和禁忌，禁止朝代混搭。'],
  },
  {
    ...common,
    id: 'kb_wardrobe_republican_china_20260808',
    subcategory: '民国服饰',
    title: '民国男女装束：年代、地域、阶层与场合四项对齐',
    summary: '女性旗袍/袄裙/学生装与男性长衫/中山装/西装分别成套，避免现代礼服和古代冠饰串入。',
    content: `民国不是一个单一“复古滤镜”。先确定大致年代、城市或地区、人物阶层与场合，再选装束。

女性可选旗袍、袄裙、学生装、职业装或海派礼服；明确领型、袖长、衣长、开衩、滚边、扣饰、鞋袜、手袋和发型。男性可选长衫、长衫马褂、中山装、西装三件套、学生装或工装；明确门襟、裤型、皮鞋/布鞋、帽饰、眼镜或明确无饰。

妆发与身份联动：学生、知识女性、社交名媛、店员、工人、军政人员不能共用同一发型和配饰模板。禁止现代修身晚礼服、当代智能穿戴、现代影楼盘发、古代凤冠和无依据军装混入。`,
    tags: ['民国', '旗袍', '长衫', '中山装', '学生装', '海派', '男女装'],
    keywords: ['Republican China fashion', 'qipao', 'changshan', 'zhongshan suit', 'Shanghai 1930s'],
    prompt_snippets: ['民国造型必须先写年代、地域、身份和场合，再闭合服装、鞋袜、发型与配饰；不得直接套“复古”。'],
  },
  {
    ...common,
    id: 'kb_wardrobe_modern_contemporary_20260808',
    subcategory: '现代服饰',
    title: '现代男女装束：职业、场合、版型和身份语言',
    summary: '覆盖商务、通勤、休闲、街头、校园、运动和正式场合，并用发型与配饰建立人物可辨识度。',
    content: `现代人物先按职业、年龄、场合和气质选择商务、通勤、休闲、街头、校园、运动或正式礼服体系。女性和男性都不能只写“时尚穿搭”，必须落实到上装+下装或连体服、鞋袜、配饰、色彩、面料与版型。

发型字段至少包括长度、分区、刘海、层次、纹理和束发方式；必要时加发饰、职业和使用场景。男士侧分、纹理短发、露额造型、半束发分别偏向整洁、利落、成熟或艺术感；女士低马尾、锁骨发、松弛盘发、层次短发分别可表达温柔、清冷、成熟、干练或活力。发型是身份语言，不是独立于人物的装饰。

人物资产需固定正面、侧面、背面、表情、服装拆解、配饰和材质证据；同一 look 的三视图必须同服装、同鞋履、同配饰、同发型。`,
    tags: ['现代男女', '商务', '通勤', '街头', '校园', '发型', '人物资产卡'],
    keywords: ['modern wardrobe', 'business casual', 'streetwear', 'campus style', 'modern hairstyle'],
    prompt_snippets: ['把职业、年龄、场合和气质翻译为可验证的单品、版型、鞋履、配饰、配色、材质和发型，不使用空泛时尚形容词。'],
  },
  {
    ...common,
    id: 'kb_wardrobe_international_styles_20260808',
    subcategory: '国外服饰',
    title: '国外与跨文化装束：地区、年代、场合、身份缺一不可',
    summary: '区分现代国际都市、欧美历史、日韩校园及其它地区体系，防止“国外风”变成跨文化拼贴。',
    content: `“国外风格”信息不足，不能直接生成带强文化符号的服装。先明确地区、年代、场合和人物身份；若用户只说国外风，可采用当代国际都市基础款并保持文化中性，再由用户继续细化。

现代欧美、英伦学院、法式日常、意式商务、美式休闲、韩国校园、日本校园或传统装束、欧洲历史服装、南亚、中东、拉丁与非洲地区都必须分别建立自己的服装体系。历史欧洲还要继续区分中世纪、摄政、维多利亚、爱德华或二十世纪具体年代。

每套仍遵守统一闭环：服装制式、鞋袜、配饰/明确无饰、色彩、材质、妆发和禁忌。禁止把不同时代与地区的标志性单品混搭；不得凭外貌或国籍刻板印象添加宗教、民族、军政或仪式符号。`,
    tags: ['国外风格', '欧美', '英伦', '法式', '韩式', '日式', '跨文化', '历史服装'],
    keywords: ['international wardrobe', 'European historical fashion', 'Korean campus', 'cross-cultural styling'],
    prompt_snippets: ['国外风先落实地区、年代、场合与身份；不明确时使用文化中性的当代国际都市基础款，禁止擅加民族宗教符号。'],
  },
  {
    ...common,
    collection: 'atmosphere',
    id: 'kb_scene_pastoral_healing_20260808',
    subcategory: '田园治愈',
    title: '田园治愈短片：用生活事件、时间光线与空间锚点构成故事',
    summary: '以种菜、摘果、家务、邻里用餐等可观察事件组织清晨、午后、收获和傍晚场景，不只套暖色滤镜。',
    content: `田园治愈题材的重点是一致人物、细致生活场景和温馨安静的乡村背景。可围绕种菜、摘果、养鸡、做家务或与邻居用餐推进情感。

场景至少写清：
- 清晨：菜地、花草、露珠、低角度日光和一天开始的动作。
- 午后：树荫、木桌、茶具/书本或具体劳作后的停歇，斑驳光影形成慢节奏。
- 收获：作物、竹篮、泥土、工具和双手动作，建立劳动成果的可见变化。
- 傍晚：乡间路径、栅栏、炊烟、夕阳方向和人物归家/相聚路线。

每个场景必须把布局、材质、光线、互动点、故事前后状态和人物路线结构化；服装按季节和劳动需要选择，禁止只写“治愈、电影感、8K”而没有可拍摄事实。`,
    tags: ['田园', '治愈', '生活流', '乡村', '时间光线', '场景状态', '行动路线'],
    keywords: ['pastoral healing', 'rural life', 'morning garden', 'harvest', 'sunset path'],
    prompt_snippets: ['用具体生活事件和可见状态变化组织田园场景：地点、时间、光线、物件、动作锚点与路线必须同时存在。'],
  },
  {
    ...common,
    collection: 'storyboard',
    id: 'kb_scene_cinematic_emotion_20260808',
    subcategory: '场景与镜头表达',
    title: '场景情绪要拆成角色、空间、光线、机位和可观察表演',
    summary: '避免只写“电影感”；用场景事实、镜头尺度、光线方向和动作表情形成可拍摄的情绪。',
    content: `同一人物和场景的情绪表达必须可观察：眼神停留、嘴角、眉部、呼吸、手部动作、身体重心和行动节奏。不能只给“悲伤、愤怒、治愈”等标签。

场景提示按五项拆分：角色当前状态；物理场景与道具；主光方向、色温和天气；景别、机位、镜头运动；动作和情绪的可见结果。近景承担情绪压力，远景建立人物与空间关系，冷蓝和负空间可表达隔离，逆光、雨、尘与遮挡只能在剧情支持时增强张力。

线稿和分镜必须引用同一 scene_id、look_id、互动锚点和故事状态，才能真正衔接故事，而不是每格重新生成一张漂亮图片。`,
    tags: ['电影感', '情绪表演', '镜头', '场景', '分镜', '线稿', '连续性'],
    keywords: ['cinematic scene', 'observable emotion', 'shot scale', 'lighting direction', 'story state'],
    prompt_snippets: ['不要只写电影感；明确角色状态、物理空间、光线方向、机位景别、动作与可见结果，并绑定稳定 scene_id 和 look_id。'],
  },
];

