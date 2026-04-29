/**
 * 时代/题材锚点知识库 seed（era_anchors）
 *
 * 目的：锁定小说→剧本→分镜→视觉各环节的"时代不可漂移"约束。
 * 每个条目给出：
 *   - forbidden_elements：该时代/题材下禁止出现的元素（现代文物/错代道具/错代建筑）
 *   - required_elements：该时代/题材下必然出现的视觉锚点
 *   - visual_anchors：服化道/建筑/器物/光影关键词（英文 prompt 锚点）
 *   - avoid_prompts：禁止注入 AI 生图/分镜 prompt 的关键词黑名单
 *
 * 注入策略：运行时由 era_detector agent 识别出 era/dynasty/genre_tags
 * 后，buildAgentContext 按 genre 参数排序检索相关条目，注入到 4 个
 * 下游 Agent（screenwriter/director/visual/art_director）。
 */

module.exports = [

  // ═════════════════════════════════════════
  // 0. era_detector Agent 自身的方法论
  // ═════════════════════════════════════════
  {
    id: 'kb_era_detector_methodology',
    collection: 'era_anchors',
    subcategory: '时代检测方法论',
    title: '时代/题材检测 — 从小说文本提取 setting_lock 的方法论',
    summary: '从小说标题+简介+正文提取时代/朝代/题材，产出结构化 setting_lock，用于锁定下游全链路。',
    content: `任务：将任意中文小说文本（标题、简介、或正文片段）解析为结构化的 setting_lock 对象，作为整个漫剧生成流程的"时代契约"。

【输入信号】
1. 标题/简介中的显式时代词：古代、古装、唐代、宋朝、大明、穿越、民国、现代、末日、未来、赛博朋克、修仙、仙侠、武侠、江湖、架空…
2. 人名风格：林黛玉/慕容复/狐妖→古装；张伟/李娜→现代；凯瑟琳→西方；叶凡/唐三→玄幻常见
3. 物件/场景关键词：马车、宫墙、毛笔、剑、飞剑、灵石、阵法→古风；手机、汽车、地铁、WiFi、便利店→现代；机甲、外骨骼、赛博义肢→未来
4. 称谓/话术：本宫、朕、小的、娘子、夫君、公子、郎君、义父→古装；先生、女士、老板、经理→近现代
5. 世界观词：修真界、宗门、门派、灵气、渡劫→仙侠；帮派、武林、客栈→武侠；废土、变异、辐射→末日

【输出规范 — setting_lock JSON】
{
  "era": "ancient|near_modern|modern|future|xianxia|wuxia|post_apocalyptic|cyberpunk|alt_history|unknown",
  "era_cn": "古代|近代|现代|未来|仙侠|武侠|末日|赛博朋克|架空|未知",
  "dynasty": "唐|宋|元|明|清|春秋战国|三国|魏晋|民国|null",
  "genre_tags": ["古偶","宫廷","权谋","仙侠","玄幻","穿越","重生","都市","校园","末日","科幻"],
  "time_period_cn": "可选：如'盛唐开元年间'、'明朝嘉靖年间'、'民国二十年'、'近未来2045年'",
  "location_hint": "可选：'中原江南'、'大漠孤烟'、'海外仙山'、'废土都市'",
  "forbidden_elements": ["禁止出现的元素数组，如古代禁止：手机、汽车、电灯、西装、塑料、空调、玻璃窗"],
  "required_elements": ["必须出现的视觉锚点，如唐代必须：襦裙、幞头、木制家具、油灯、宣纸、毛笔"],
  "style_anchors": ["服化道风格关键词（中英双语），如：汉服 hanfu、宫墙 palace walls、朱红廊柱 vermillion columns"],
  "avoid_prompts_en": ["分镜/视觉生图 prompt 黑名单（英文），如：smartphone, car, modern skyscraper, business suit, neon signs"],
  "confidence": 0.0-1.0
}

【判定原则】
- 优先显式信号：标题/简介带明确朝代词 → 直接采纳
- 混合信号（如穿越）：era=ancient，但 genre_tags 加 "穿越"，required_elements 保留现代对比元素
- 低置信度时 era="unknown"，不瞎猜；要求用户手动校正
- 架空玄幻：era="xianxia"或"alt_history"，避免绑死具体朝代
- 严禁用 "现代/都市" 作为 古代题材的回退值`,
    tags: ['era_detector', '时代检测', '方法论', 'setting_lock'],
    keywords: ['era detection', 'dynasty', 'genre classification', 'setting anchor'],
    applies_to: ['era_detector'],
    source: 'VIDO 内部方法论 2026-04-16',
    lang: 'zh',
    enabled: true,
  },

  // ═════════════════════════════════════════
  // 1. 古代通用
  // ═════════════════════════════════════════
  {
    id: 'kb_era_ancient_general',
    collection: 'era_anchors',
    subcategory: '古代通用',
    title: '古代题材 — 禁忌与必现元素清单',
    summary: '古代/古装题材的全局硬约束：禁止一切现代工业文明产物，必须出现传统视觉锚点。',
    content: `【绝对禁止出现（视觉/台词/道具）】
- 电子产品：手机、电脑、电视、摄像头、手表、耳机、充电器、数据线
- 现代交通：汽车、自行车、摩托、地铁、飞机、高铁、红绿灯、柏油马路
- 现代建筑：高楼大厦、玻璃幕墙、水泥路、空调外机、广告牌、霓虹灯
- 现代材质：塑料、不锈钢、橡胶、化纤布料、拉链、纽扣（除明清外）
- 现代服装：西装、牛仔裤、T恤、运动鞋、墨镜、领带、高跟鞋（尖头靴除外）
- 现代食品：可乐、巧克力、咖啡、意面、披萨、罐头
- 现代词汇（台词禁用）：先生、女士、经理、老板、老公、老婆、警察、医生、学校、公司、元/块（货币用"两/文/钱/贯"）
- 现代光源：电灯、霓虹、LED、荧光棒

【必须出现的视觉锚点】
- 建筑：青砖黛瓦、雕花木窗、朱漆廊柱、飞檐斗拱、木门门环、石阶、园林
- 服饰：交领/对襟、束腰、宽袖、襦裙/曲裾/袍服、发髻/发冠、玉佩、腰带
- 器物：瓷器、木桌、铜镜、砚台、毛笔、宣纸、灯笼、油灯、烛台、扇子、算盘
- 交通：马车、轿子、帆船、步行
- 货币：铜钱、碎银、银锭、金锭
- 光源：油灯、蜡烛、灯笼、月光、火把

【称谓与语言】
- 自称：在下/本王/本宫/朕/微臣/小的/奴家/妾身
- 他称：公子/姑娘/郎君/娘子/先生（古义：老师）/官人/大人
- 敬语：请、恳请、斗胆、恕罪、有劳、多谢
- 时辰：辰时/午时/三更/五更/黎明/日暮，而非"早上8点"

【视觉色调】
- 首选：青绿山水 / 朱红金黄 / 水墨黑白 / 朦胧月色
- 光线：自然光为主，室内油灯暖黄，夜晚月光冷蓝`,
    tags: ['古代', '古装', '禁忌清单', '必现元素', 'ancient'],
    keywords: ['ancient chinese', 'forbidden modern', 'hanfu', 'palace', 'wuxia setting'],
    prompt_snippets: [
      'ancient chinese setting, no modern elements',
      'hanfu traditional robes, wooden furniture, oil lamps',
      'vermillion columns, black-tiled roof, stone courtyard',
      'strict no: phones, cars, electric lights, modern clothing',
    ],
    applies_to: ['screenwriter', 'director', 'visual', 'art_director', 'atmosphere'],
    source: 'VIDO era_anchors 2026-04-16',
    lang: 'zh',
    enabled: true,
  },

  // ═════════════════════════════════════════
  // 2. 唐代
  // ═════════════════════════════════════════
  {
    id: 'kb_era_tang',
    collection: 'era_anchors',
    subcategory: '唐代',
    title: '唐代（618-907） — 盛世气象视觉锚点',
    summary: '唐代：开放、华丽、国际化。襦裙齐胸、圆领袍、幞头、胡风、木构大殿、大明宫、丝路。',
    content: `【服饰】
- 女：高腰襦裙（齐胸襦裙）、帔帛（披帛飘带）、花钿、斜红、翠眉、倭堕髻、高髻
- 男：圆领袍（官员紫绯绿青）、幞头、革带、乌皮靴
- 胡风：胡服、翻领窄袖袍（盛唐流行波斯/粟特元素）

【建筑】
- 宫殿：大明宫、兴庆宫 — 鸱尾屋脊、朱红梁柱、歇山顶、木构大殿
- 街市：长安/洛阳里坊制、朱雀大街、东西两市
- 园林：曲江池、芙蓉园

【器物】
- 瓷器：唐三彩、越窑青瓷、邢窑白瓷
- 家具：矮榻、胡床（马扎）、屏风、食案
- 乐器：琵琶、箜篌、羌笛
- 书法：楷书成熟期（颜柳欧褚）

【禁止出现（唐代特有禁忌）】
- 椅子（盛唐后期才从胡床演化出高足家具，早中唐禁用现代椅子造型）
- 八仙桌（元明才流行）
- 瓜皮帽、长辫（清代特有）
- 明式家具（留给明代）

【色彩】
朱红、鹅黄、石绿、天青、赭石 — 五色繁华感

【台词风格】
"妾"、"某"、"郎君"、"娘子"，避免过度文言化，唐代口语相对白话`,
    tags: ['唐代', '盛唐', '大唐', '襦裙', '幞头', 'Tang dynasty'],
    keywords: ['tang dynasty', 'gaoyao ruqun', 'putou', 'changan', 'daming palace'],
    prompt_snippets: [
      'Tang dynasty China, high-waisted ruqun dress with piped scarf',
      'male officials in round-collar robes and putou headwear',
      'Daming palace hall with vermillion columns and black tile roof',
      'foreign Sogdian/Persian influence, cosmopolitan Chang\'an street',
    ],
    applies_to: ['screenwriter', 'director', 'visual', 'art_director'],
    source: 'VIDO era_anchors 2026-04-16',
    lang: 'zh',
    enabled: true,
  },

  // ═════════════════════════════════════════
  // 3. 宋代
  // ═════════════════════════════════════════
  {
    id: 'kb_era_song',
    collection: 'era_anchors',
    subcategory: '宋代',
    title: '宋代（960-1279） — 雅致文气的视觉锚点',
    summary: '宋代：文人气质、素雅清淡。褙子、抹胸、直脚幞头、汴京繁华、清明上河图风情。',
    content: `【服饰】
- 女：褙子（长对襟外衣）、抹胸、百迭裙、合欢髻、不戴帔帛（唐风已退）
- 男：圆领袍 + 直脚幞头（长翅官帽）、直裰、东坡巾
- 士人：儒衫、方巾、布鞋

【建筑】
- 城市：汴京（开封）、临安（杭州）、廊桥、勾栏瓦舍
- 风格：相比唐更内敛，白墙黛瓦、木构细雕
- 参考：《清明上河图》

【器物】
- 瓷器：五大名窑（汝官哥钧定）— 素净釉色为主
- 家具：开始有真正的桌椅、高足家具成熟
- 文具：文房四宝精致化、端砚徽墨

【禁止】
- 唐代胡服胡风
- 大红大紫浓烈色（宋尚素雅）
- 清代满服元素

【色彩】
月白、烟青、淡赭、素绢白、淡墨 — 极简文人色

【氛围】
书卷气、市井烟火气并存，《清明上河图》的俗雅共存感`,
    tags: ['宋代', '宋朝', '褙子', '清明上河图', 'Song dynasty'],
    keywords: ['song dynasty', 'beizi', 'literati style', 'kaifeng'],
    prompt_snippets: [
      'Song dynasty China, elegant beizi long outer robe',
      'literati in simple scholar\'s robes and square cap',
      'Bianjing riverside scene, whitewashed walls, tile roofs',
      'muted palette, ink-wash aesthetic',
    ],
    applies_to: ['screenwriter', 'director', 'visual', 'art_director'],
    source: 'VIDO era_anchors 2026-04-16',
    lang: 'zh',
    enabled: true,
  },

  // ═════════════════════════════════════════
  // 4. 明代
  // ═════════════════════════════════════════
  {
    id: 'kb_era_ming',
    collection: 'era_anchors',
    subcategory: '明代',
    title: '明代（1368-1644） — 庄重规整的视觉锚点',
    summary: '明代：程朱理学、规整庄重。马面裙、比甲、乌纱帽、明式家具、紫禁城。',
    content: `【服饰】
- 女：袄裙（上袄下裙）、马面裙、比甲、云肩、发髻包头、金银首饰
- 男：直身、道袍、贴里、乌纱帽（官员）、网巾（庶民）
- 禁服：庶民不得用绸缎、龙凤纹

【建筑】
- 皇家：紫禁城（1420 建成）、太和殿、黄琉璃瓦、汉白玉栏
- 民居：徽派白墙黛瓦、四合院
- 园林：拙政园、留园、苏式园林成熟期

【器物】
- 家具：明式家具黄金期（黄花梨、紫檀、楠木）— 简洁线条
- 瓷器：青花瓷鼎盛（宣德青花、成化斗彩、嘉万五彩）
- 书画：文徵明、唐寅、仇英、董其昌

【禁止】
- 清代辫子马褂
- 近代西洋元素
- 明代皇家黄色禁用于民间

【色彩】
明黄（皇家）、朱红、墨青、雅白 — 对比鲜明

【制度细节】
- 五等爵、文武官分品、补子制度（文官禽、武官兽）
- 科举：童生→秀才→举人→进士`,
    tags: ['明代', '明朝', '马面裙', '青花瓷', '紫禁城', 'Ming dynasty'],
    keywords: ['ming dynasty', 'mamian qun', 'forbidden city', 'ming furniture'],
    prompt_snippets: [
      'Ming dynasty China, horse-face pleated skirt (mamian qun)',
      'officials in black gauze cap (wushamao) with rank badge',
      'Forbidden City with yellow glazed tile, white marble balustrades',
      'classical Ming furniture, huanghuali wood, clean lines',
    ],
    applies_to: ['screenwriter', 'director', 'visual', 'art_director'],
    source: 'VIDO era_anchors 2026-04-16',
    lang: 'zh',
    enabled: true,
  },

  // ═════════════════════════════════════════
  // 5. 清代
  // ═════════════════════════════════════════
  {
    id: 'kb_era_qing',
    collection: 'era_anchors',
    subcategory: '清代',
    title: '清代（1644-1911） — 满汉交融视觉锚点',
    summary: '清代：满服马褂、旗装、男辫女两把头、紫禁城、圆明园、晚清洋务。',
    content: `【服饰】
- 女（满）：旗装、两把头/大拉翅（后期）、花盆底鞋
- 女（汉）：袄裙简化、裹小脚、弓鞋
- 男：马褂 + 长袍、瓜皮帽、辫子（垂辫→粗辫）、顶戴花翎（官员）
- 晚清：马蹄袖、补服

【建筑】
- 宫廷：紫禁城、圆明园、颐和园
- 民居：北方四合院、徽派、岭南骑楼（广式，晚清）
- 晚清：租界西洋建筑（上海、天津）

【器物】
- 瓷器：粉彩、珐琅彩、雍正官窑
- 家具：清式家具（繁复雕饰，区别于明式简洁）
- 晚清引入：钟表、玻璃窗、洋油灯、西式家具（仅权贵）

【禁止】
- 明代网巾、束发（清初"留发不留头"）
- 民国旗袍收腰版（旗装是宽松A字形）

【色彩】
明黄皇家、石青吉服、玄色朝服、金线刺绣繁复

【台词】
- 自称：奴才（满人/包衣）、微臣（汉臣）、本宫（妃嫔）、哀家（太后）、朕
- 敬称：万岁爷、皇上、主子、格格、贝勒`,
    tags: ['清代', '清朝', '旗装', '辫子', '紫禁城', 'Qing dynasty'],
    keywords: ['qing dynasty', 'qizhuang', 'queue braid', 'manchu dress'],
    prompt_snippets: [
      'Qing dynasty China, Manchu qizhuang dress, liangbatou hairstyle',
      'male wearing magua and queue braid, melon-skin cap',
      'imperial court with yellow tile, embroidered dragon robes',
      'late Qing: foreign concessions, western-style street lamps',
    ],
    applies_to: ['screenwriter', 'director', 'visual', 'art_director'],
    source: 'VIDO era_anchors 2026-04-16',
    lang: 'zh',
    enabled: true,
  },

  // ═════════════════════════════════════════
  // 6. 民国
  // ═════════════════════════════════════════
  {
    id: 'kb_era_minguo',
    collection: 'era_anchors',
    subcategory: '民国',
    title: '民国（1912-1949） — 中西交融的视觉锚点',
    summary: '民国：旗袍、长衫、西装革履、上海滩、十里洋场、黄包车、老式电话、留声机。',
    content: `【服饰】
- 女：改良旗袍（收腰贴身）、学生装（白衫黑裙）、烫发、旗袍开衩
- 男：长衫+马褂（传统）、西装三件套（新潮）、中山装、礼帽、皮鞋
- 军警：军装、大檐帽、皮靴

【建筑】
- 上海：外滩万国建筑群、石库门、弄堂
- 北平：胡同四合院
- 混搭：西洋小楼、民国公馆

【器物】
- 交通：黄包车、人力车、电车（上海）、老式汽车（仅富豪）
- 家电：留声机、座钟、座机电话、煤油灯→电灯过渡
- 文具：钢笔、墨水瓶、老式打字机

【禁止】
- 清代辫子（1912 后剪辫）
- 现代元素：手机、电视、空调、电脑、塑料、霓虹LED（虽有霓虹但仅限上海租界且风格老旧）

【台词】
- 保留古雅：先生、小姐、少爷、太太、姨太太
- 引入新词：同学、老师、报社、学堂、洋行`,
    tags: ['民国', '旗袍', '上海滩', 'Republican era'],
    keywords: ['republican china', 'qipao', 'shanghai bund', 'changshan'],
    prompt_snippets: [
      'Republican China 1920s-30s, women in fitted qipao dress',
      'men in changshan long gown or western three-piece suit',
      'Shanghai Bund buildings, rickshaw, vintage trams',
      'sepia tones, art deco interiors, gramophone',
    ],
    applies_to: ['screenwriter', 'director', 'visual', 'art_director'],
    source: 'VIDO era_anchors 2026-04-16',
    lang: 'zh',
    enabled: true,
  },

  // ═════════════════════════════════════════
  // 7. 仙侠/修真
  // ═════════════════════════════════════════
  {
    id: 'kb_era_xianxia',
    collection: 'era_anchors',
    subcategory: '仙侠',
    title: '仙侠/修真 — 飞剑宗门灵气的视觉锚点',
    summary: '仙侠：古代底色 + 法器飞剑 + 灵气特效 + 宗门洞府。禁现代，允神异。',
    content: `【世界观核心】
- 修真境界：练气→筑基→金丹→元婴→化神→炼虚→合体→大乘→渡劫
- 宗门组织：正道宗门（门派、长老、掌门、真人）/ 魔道魔门
- 法宝体系：飞剑、法器、灵石、丹药、法阵、传送阵

【服饰】
- 道袍（白/青/玄）、羽衣、霓裳、仙鹤服、束发玉冠
- 女性：广袖长裙、束带玉佩、飘带
- 魔修：黑袍红纹、鬼面、骨饰

【场景】
- 宗门：山巅洞府、灵山福地、亭台水榭、云雾缭绕
- 秘境：异界空间、时空错乱、上古遗迹
- 战斗场：剑气纵横、灵力冲击波、法阵光影

【特效锚点】
- 飞剑 flying sword、御剑 riding sword in flight
- 灵气 qi energy, spiritual wisps
- 渡劫 heavenly tribulation lightning
- 法阵 magic array, glowing runes

【禁止】
- 现代科技一切元素
- 具体朝代（仙侠往往架空或泛指古风）
- 过度写实的暴力

【色彩】
青蓝灵气、金色剑光、紫雷黑云、云雾白`,
    tags: ['仙侠', '修真', '玄幻', '飞剑', 'xianxia', 'cultivation'],
    keywords: ['xianxia', 'cultivation', 'flying sword', 'immortal sect'],
    prompt_snippets: [
      'xianxia cultivation world, Taoist robes flowing in wind',
      'flying sword with blue qi energy trails',
      'mountain sect with pavilions above cloud sea',
      'thunder tribulation descending from dark purple sky',
    ],
    applies_to: ['screenwriter', 'director', 'visual', 'art_director'],
    source: 'VIDO era_anchors 2026-04-16',
    lang: 'zh',
    enabled: true,
  },

  // ═════════════════════════════════════════
  // 8. 武侠/江湖
  // ═════════════════════════════════════════
  {
    id: 'kb_era_wuxia',
    collection: 'era_anchors',
    subcategory: '武侠',
    title: '武侠/江湖 — 侠客客栈门派的视觉锚点',
    summary: '武侠：写实古代背景（通常宋明）+ 武林门派 + 客栈江湖。轻功+内力，不飞仙。',
    content: `【世界观核心】
- 武林：名门正派 vs 邪教魔教
- 江湖：客栈、镖局、帮派、丐帮
- 武功：内力、轻功、点穴、剑法、拳掌
- 兵器：剑、刀、枪、鞭、暗器、折扇、判官笔

【服饰】
- 侠客：劲装（束腰短打）、披风、布靴、额带
- 女侠：白衣如雪 / 红衣似火 + 剑穗 + 发带
- 江湖老手：长衫 + 酒壶 + 竹笠（浪迹感）

【场景】
- 客栈：二层木楼、长条桌、酒坛、铜钱柜台、说书先生
- 镖局：挂旗、马车、镖师聚会
- 竹林/雪山/大漠（常见比武地）
- 城镇：青石板路、酒旗、药铺、铁匠铺

【禁止】
- 仙侠法宝（飞剑要有边界 — 武侠只有轻功与内力，不飞仙）
- 现代科技
- 过度神异（不发光，不瞬移）

【运镜风格】
- 李安《卧虎藏龙》竹林戏：长镜头 + 轻功慢速
- 徐克《笑傲江湖》：快切 + 剑光 + 气势
- 王家卫《一代宗师》：雨夜慢镜 + 水花`,
    tags: ['武侠', '江湖', '客栈', '侠客', 'wuxia', 'martial arts'],
    keywords: ['wuxia', 'jianghu', 'martial arts', 'inn', 'sword hero'],
    prompt_snippets: [
      'wuxia martial arts, hero in robes with sword',
      'traditional inn (kezhan) with wooden stairs and lanterns',
      'bamboo forest duel, slow-motion leaping',
      'rain night, sword gleam, dramatic silhouettes',
    ],
    applies_to: ['screenwriter', 'director', 'visual', 'art_director'],
    source: 'VIDO era_anchors 2026-04-16',
    lang: 'zh',
    enabled: true,
  },

  // ═════════════════════════════════════════
  // 9. 古偶/宫廷
  // ═════════════════════════════════════════
  {
    id: 'kb_era_guou',
    collection: 'era_anchors',
    subcategory: '古偶',
    title: '古偶/宫廷言情 — 唯美古装的视觉锚点',
    summary: '古偶：精致华丽>历史考证。服饰可夸张、灯光必柔焦、滤镜偏冷青或暖金。',
    content: `【美学原则】
- 服饰可"戏说"：融合唐宋明元素，追求华丽唯美而非严谨考据
- 光影柔焦：大量柔光 + 轻柔纱幔 + 窗花透光
- 色调统一：全集通常锁定一种主色（青/蓝/粉/金）

【视觉招牌】
- 宫廷：红墙金瓦、雕梁画栋、长廊、宫女列队
- 皇后/贵妃：凤冠霞帔、点翠珠钗、繁复华服
- 皇子王爷：蟒袍玉带、折扇、佩玉
- 后宫：屏风、香炉、宫灯、美人榻
- 园林：假山、池塘、荷花、亭台、鸟语

【情感场景】
- 廊下擦肩回眸（慢镜 + 飘落花瓣）
- 月下抚琴（琴瑟和鸣 + 烛光）
- 雨中倾诉（湿发 + 睫毛雨滴特写）
- 宫变夜火（红灯笼 + 刀光 + 奔跑裙摆）

【对白风格】
- 文雅克制、欲言又止
- 禁忌表白（身份差距）
- 诗词引用增加文气（如李清照/纳兰性德句）

【禁止】
- 过度写实的暴力 / 血腥
- 现代思维台词（"你开心就好""我支持你")
- 过度历史考证的正剧感`,
    tags: ['古偶', '宫廷', '言情', '古装偶像', 'guou', 'costume drama'],
    keywords: ['palace romance', 'costume drama', 'imperial harem', 'glam ancient'],
    prompt_snippets: [
      'palace romance drama, ornate imperial robes, jeweled headdress',
      'soft-focus lighting, silk curtains, petals in the air',
      'moonlit courtyard scene, romantic slow-motion glance',
      'crimson palace walls, gold tile roof, flowing dress shot',
    ],
    applies_to: ['screenwriter', 'director', 'visual', 'art_director'],
    source: 'VIDO era_anchors 2026-04-16',
    lang: 'zh',
    enabled: true,
  },

  // ═════════════════════════════════════════
  // 10. 穿越
  // ═════════════════════════════════════════
  {
    id: 'kb_era_chuanyue',
    collection: 'era_anchors',
    subcategory: '穿越',
    title: '穿越题材 — 古今双约束',
    summary: '穿越：双时代并存。主场景锁定目标时代，仅用主角内心独白/回闪呈现现代对比。',
    content: `【双时代约束】
- **主时空**（穿越后的古代/未来）占 >95% 画面 — 视觉必须严格遵守目标时代锁定
- **对比元素**只能通过：
  - 主角内心独白（台词区分）
  - 短暂回闪（<2 秒蒙太奇）
  - 主角出现"现代思维"但无现代物件（如"地铁""手机"仅能嘴说，不能出现画面）

【现代元素出现规则】
- ✅ 允许：主角独白中提到手机、地铁、奶茶等
- ❌ 禁止：画面真的出现现代物件（除回忆闪回 <2 秒）
- ✅ 允许：主角穿越瞬间穿现代服装（<1 秒过渡镜头）
- ❌ 禁止：古代场景里持续出现现代服装或手机

【常见穿越类型】
1. 现代→古代：最常见。主角初期惊讶反差（马桶、厕所、洗澡、食物、称谓）
2. 古代→现代：相反视角，古代服饰在现代街头的反差
3. 平行架空：穿越到架空朝代，不绑定真实历史

【标志性桥段】
- 穿越瞬间：车祸/电击/昏迷 → 睁眼见古装人
- 初见反差：主角对古人喊"手机""110"，古人一脸懵
- 融入过渡：换装 + 学礼仪 + 语言适配
- 身份获取：沦为丫鬟/被逼婚/冒充贵女

【画面比例建议】
- 开篇 1 分钟：现代场景（办公室/车祸/医院）
- 穿越过渡：10 秒旋转/光效/昏迷
- 主体 90%：目标时代场景
- 结尾可选：回现代 or 留古代`,
    tags: ['穿越', '穿越文', '架空', 'time travel'],
    keywords: ['time travel', 'modern to ancient', 'dual timeline'],
    prompt_snippets: [
      'time traveler in ancient setting, modern mindset vs ancient visual',
      'brief modern flashback transition (<2 seconds)',
      'main scene strictly ancient, modern only in monologue',
    ],
    applies_to: ['screenwriter', 'director', 'visual', 'art_director'],
    source: 'VIDO era_anchors 2026-04-16',
    lang: 'zh',
    enabled: true,
  },

  // ═════════════════════════════════════════
  // 11. 现代/都市
  // ═════════════════════════════════════════
  {
    id: 'kb_era_modern',
    collection: 'era_anchors',
    subcategory: '现代',
    title: '现代/都市 — 2020s 当代背景视觉锚点',
    summary: '现代：智能手机、新能源车、高楼玻璃幕墙、便利店、咖啡馆、写字楼。',
    content: `【服饰】
- 职场：西装、通勤风、衬衫 + 半裙、运动鞋通勤
- 日常：T恤牛仔、卫衣、羽绒服、运动套装
- 配饰：AirPods、智能手表、机械键盘

【建筑/场景】
- 城市：CBD 玻璃幕墙、地铁站、高架桥、网红咖啡馆
- 家居：开放式厨房、岛台、北欧风 / 日式极简 / 工业风
- 校园：现代大学、图书馆、食堂、操场

【器物】
- 电子：iPhone、MacBook、无线充电、扫地机器人
- 交通：地铁、新能源车、共享单车、电动车
- 食饮：瑞幸/星巴克、喜茶、外卖盒饭、便利店饭团

【台词风格】
- 口语化：老板、同事、室友、甲方、项目、KPI
- 网络梗：好的哥、内卷、躺平、社畜、打工人、emo
- 职场话：对齐、拉通、赋能、颗粒度、抓手

【禁止】
- 古装元素
- 明显过时符号（BB机、大哥大、老式自行车 — 除非 90s 怀旧）
- 西方场景（除非明确国际化背景）

【色调风格】
- 都市冷调：青蓝滤镜 + 霓虹 + 雨夜
- 小清新：高亮白 + 淡粉 + 柔光
- 职场冷峻：灰蓝 + 金属光 + 玻璃反光`,
    tags: ['现代', '都市', '当代', 'modern', 'urban'],
    keywords: ['contemporary china', 'urban', 'smartphone', 'CBD'],
    prompt_snippets: [
      'modern China 2020s, smartphone, glass skyscrapers',
      'coffee shop interior, natural light, MacBook on table',
      'subway station, rush hour, people in business casual',
      'neon-lit urban night, rainy street, cinematic',
    ],
    applies_to: ['screenwriter', 'director', 'visual', 'art_director'],
    source: 'VIDO era_anchors 2026-04-16',
    lang: 'zh',
    enabled: true,
  },

  // ═════════════════════════════════════════
  // 12. 末日/废土
  // ═════════════════════════════════════════
  {
    id: 'kb_era_apocalypse',
    collection: 'era_anchors',
    subcategory: '末日',
    title: '末日/废土 — 灾变后世界的视觉锚点',
    summary: '末日：文明崩塌 + 资源稀缺 + 变异生物/丧尸。破败工业 + 粗糙皮革。',
    content: `【世界观】
- 触发：核战、病毒、丧尸、天灾、外星入侵、AI 叛乱
- 文明状态：部落化、资源争夺、黑市、军阀
- 能源：汽油稀缺、改装车、太阳能

【服饰】
- 实用主义：皮衣皮裤、防毒面具、护目镜、绷带
- 拼接感：金属补丁、铆钉、撕裂布料
- 武器随身：改装枪、棒球棍、斧头、弓弩

【场景】
- 废墟都市：断壁残垣、生锈汽车、破广告牌、野草丛生
- 避难所：地下工事、简陋营地、塑料帐篷、油桶火堆
- 荒原：沙漠化大地、辐射尘、干涸河床

【色调】
- 昏黄沙尘、铁锈橙、焦土黑、偶尔霓虹光点（末日文明残留）
- 雾霾天 + 橙红日落 + 毒气绿

【参考美学】
- 《疯狂的麦克斯》沙漠废土
- 《最后生还者》植被入侵都市
- 《辐射》地堡文化
- 《流浪地球》地下城

【禁止】
- 干净明亮的和平场景（除回忆）
- 古装/仙侠元素
- 食物丰饶（末日一定资源稀缺）`,
    tags: ['末日', '废土', '丧尸', '灾变', 'post-apocalyptic'],
    keywords: ['post apocalyptic', 'wasteland', 'mad max', 'zombie'],
    prompt_snippets: [
      'post-apocalyptic wasteland, rusted cars, overgrown ruins',
      'survivor in leather and gas mask, scavenged gear',
      'abandoned city reclaimed by nature, dust storm',
      'orange dusty sky, industrial decay, Mad Max aesthetic',
    ],
    applies_to: ['screenwriter', 'director', 'visual', 'art_director'],
    source: 'VIDO era_anchors 2026-04-16',
    lang: 'zh',
    enabled: true,
  },

  // ═════════════════════════════════════════
  // 13. 赛博朋克/未来
  // ═════════════════════════════════════════
  {
    id: 'kb_era_cyberpunk',
    collection: 'era_anchors',
    subcategory: '赛博朋克',
    title: '赛博朋克/近未来 — 霓虹高科技的视觉锚点',
    summary: '赛博朋克：High tech low life。霓虹雨夜、大企业、义体改造、全息广告。',
    content: `【世界观】
- 时代：2050-2200 近未来
- 社会：大企业垄断、贫富悬殊、街头混乱
- 科技：AI 义体、脑机接口、全息投影、飞行车
- 亚文化：黑客、雇佣兵、街头帮派

【服饰】
- 主角：战术服 + 霓虹细节、机械义肢、发光纹身、侧剃发型
- 企业白领：剪裁西装 + 耳机全息显示器
- 街头：皮衣+金属配饰、鲜艳假发、浓妆

【场景】
- 城市：霓虹广告、巨型全息投影、雨夜街道、飞行车道
- 室内：蓝紫霓虹光、屏幕墙、胶囊公寓
- 对比：闪耀上层+肮脏下层（高低层次对立）

【色调】
- 三色主调：青蓝 + 品红 + 荧光黄绿
- 雨水反射霓虹 = 标志视觉

【参考】
- 《银翼杀手 2049》洛杉矶
- 《赛博朋克 2077》夜之城
- 《攻壳机动队》新港市
- 士郎正宗、大友克洋美学

【禁止】
- 明亮日常的田园 / 自然
- 古代元素（除非"东方赛博朋克"融合）`,
    tags: ['赛博朋克', '未来', '近未来', 'cyberpunk', 'sci-fi'],
    keywords: ['cyberpunk', 'neon', 'cybernetic', 'futuristic'],
    prompt_snippets: [
      'cyberpunk city, neon signs, rainy night street',
      'character with cybernetic implants, glowing tattoos',
      'holographic ads, flying cars, dense urban density',
      'blade runner aesthetic, cyan magenta color palette',
    ],
    applies_to: ['screenwriter', 'director', 'visual', 'art_director'],
    source: 'VIDO era_anchors 2026-04-16',
    lang: 'zh',
    enabled: true,
  },

  // ═════════════════════════════════════════
  // 14. 架空奇幻（西方风）
  // ═════════════════════════════════════════
  {
    id: 'kb_era_fantasy',
    collection: 'era_anchors',
    subcategory: '西方奇幻',
    title: '西方奇幻 — 中世纪魔法的视觉锚点',
    summary: '西方奇幻：城堡骑士、法师法杖、精灵矮人、龙与地下城。托尔金/冰与火/巫师美学。',
    content: `【种族】
- 人类骑士、精灵弓手、矮人战士、半身人盗贼
- 龙、兽人、哥布林、巨魔、不死族

【服饰/装备】
- 骑士：板甲、链甲、战袍 + 纹章盾牌
- 法师：袍服、法杖、魔法书、水晶球
- 贵族：欧式宫廷服、皮草披风、珠宝

【场景】
- 城堡：石砌高塔、城墙、吊桥、王座大厅
- 村庄：茅草屋、铁匠铺、酒馆、集市
- 魔法场所：法师塔、地下城、古遗迹

【色调】
- 中世纪：土黄、石灰、火炬橙 + 披风红
- 魔法：蓝紫光芒、符文金光

【禁止】
- 中国风元素
- 现代科技
- 火药时代武器（奇幻传统停留于冷兵器 + 魔法）

【参考】
- 《指环王》托尔金世界
- 《权力的游戏》冰火
- 《巫师 3》斯拉夫奇幻`,
    tags: ['西方奇幻', '中世纪', '魔法', 'fantasy', 'medieval'],
    keywords: ['western fantasy', 'medieval', 'knights', 'magic'],
    prompt_snippets: [
      'medieval fantasy, knight in plate armor with heraldic shield',
      'elf archer in forest, intricate leather armor',
      'wizard tower with glowing runes, spellbook on pedestal',
      'Tolkien-esque landscape, stone castle, banners',
    ],
    applies_to: ['screenwriter', 'director', 'visual', 'art_director'],
    source: 'VIDO era_anchors 2026-04-16',
    lang: 'zh',
    enabled: true,
  },

  // ═════════════════════════════════════════
  // 15. 校园/青春
  // ═════════════════════════════════════════
  {
    id: 'kb_era_campus',
    collection: 'era_anchors',
    subcategory: '校园',
    title: '校园/青春 — 现代中学/大学的视觉锚点',
    summary: '校园：制服 + 教室 + 操场 + 樱花林荫。年代区分：80s/90s/00s/10s/20s。',
    content: `【年代细分 — 避免混搭】
- **80s/90s**：绿军装书包、二八自行车、黑白电视、老式教室黑板
- **00s**：红白蓝校服、MP3、诺基亚、肥大校裤、非主流
- **10s**：智能手机、平板、英语外教、国际班
- **20s**：iPad、AirPods、短视频、00后语言、AI 辅导

【服饰】
- 校服：运动款（中国特色宽松套装）、或 JK/制服风（日韩影响）
- 休闲：T恤、牛仔、卫衣
- 特殊：毕业典礼学位服、文艺汇演礼服

【场景】
- 教室：黑板/白板、课桌椅、书本、粉笔、值日表
- 操场：跑道、升旗台、篮球场、单双杠
- 功能室：图书馆、实验室、多媒体教室
- 校园景观：樱花道、银杏林、林荫小径

【情感桥段】
- 暗恋：递纸条、课间偷看、奶茶递送
- 竞争：考试排名、选拔、比赛
- 毕业：抛学士帽、签名、KTV、散伙饭

【禁止】
- 古装元素（除非穿越校园）
- 年代混搭（80s 场景混 iPhone）`,
    tags: ['校园', '青春', '学生', 'campus', 'youth'],
    keywords: ['school campus', 'students', 'youth drama'],
    prompt_snippets: [
      'modern Chinese high school, students in tracksuit uniform',
      'classroom with blackboard, rows of desks, sunlight through window',
      'school hallway, cherry blossoms outside, youth aesthetic',
      'campus gate, bicycle racks, after-class rush',
    ],
    applies_to: ['screenwriter', 'director', 'visual', 'art_director'],
    source: 'VIDO era_anchors 2026-04-16',
    lang: 'zh',
    enabled: true,
  },

];
