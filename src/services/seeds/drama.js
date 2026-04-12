/**
 * 网剧/漫剧知识库 seed
 *
 * 覆盖：爽文/男频/女频/悬疑/情感/恐怖六大赛道 + 80 集标准短剧结构 +
 * 付费钩子位置 + ReelShort 海外化 + 甜宠/战神/重生/穿越细分公式 +
 * K-drama/日漫/三幕剧节奏 + 投流素材逻辑
 */

module.exports = [

  // —— v1 原有条目（保留 id）——
  {
    id: 'kb_drama_ai_comic_5genes',
    collection: 'drama',
    subcategory: '爆款公式',
    title: 'AI 漫剧选题 5 个爆款基因（平台抢要选题公式）',
    summary: '让 AI 漫剧被平台主动推的 5 条基因：强冲突、反转、情绪极值、高辨识度人设、可续订结构。',
    content: `5 个爆款基因：
1) 强冲突前置：前 3 秒出现尖锐对立（身份/阶级/感情/生死）
2) 反转锚点：每集必须至少 1 次反转（身份/动机/真相）
3) 情绪极值：把情绪拉到"哭/爽/怒/怕"四种极端之一，避免中庸
4) 高辨识度人设：角色 1 句话能说清（霸总/废柴/复仇千金/重生大佬）
5) 可续订结构：每集结尾留"未完成感"——悬念 / 情感空缺 / 新敌人登场
配套：画面统一锚点（光线+色调+角色锁定），让系列感明显。`,
    tags: ['漫剧', '选题', '爆款公式', '网剧'],
    keywords: ['viral formula', 'conflict', 'twist', 'hook', 'cliffhanger', '续订'],
    prompt_snippets: [
      'sharp conflict established in the opening 3 seconds',
      'cliffhanger ending with unresolved emotional tension',
      'highly recognizable character archetype',
    ],
    applies_to: ['screenwriter', 'director'],
    source: '抖音 @金枝玉叶带你AI出圈《AI漫剧选题公式：5个爆款基因》合成整理',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_drama_shuangwen',
    collection: 'drama',
    subcategory: '爽文',
    title: '爽文写作套路（打脸 / 装逼 / 逆袭 / 即时反馈）',
    summary: '爽文 = 反差 + 即时反馈 + 连环打脸。读者爽感必须在每 30 秒兑现一次。',
    content: `核心要素：
- 主角初始被轻视（废物/废柴/落魄），触发反差势能
- 每一次冲突都要"即时反馈"——不许隔 2 集才报仇
- 打脸节奏：轻视→反驳→打脸→围观者惊呼 / 下跪 / 道歉
- 身份披露三段式：暗示→半露→全露（通常在第 3/5/7 镜）
- 禁忌：不要让主角长时间失败；不要让主角独自闷骚，一定要有"围观者"放大反应
镜头建议：仰角主角 + 俯角反派 + 围观者面部特写。`,
    tags: ['爽文', '打脸', '逆袭', '网剧'],
    keywords: ['face slap', 'power fantasy', 'instant gratification', 'revenge arc'],
    prompt_snippets: [
      'low angle hero shot, high angle villain shot',
      'shocked reaction close-ups of bystanders',
      'reveal of hidden identity with lighting shift',
    ],
    applies_to: ['screenwriter', 'director'],
    source: '网文爽文写作通用套路',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_drama_nanpin',
    collection: 'drama',
    subcategory: '男频文',
    title: '男频文：升级/战斗/兄弟/权谋四大主轴',
    summary: '男频 = 能力升级 + 战斗张力 + 兄弟情谊 + 权谋博弈。核心是"掌控感"。',
    content: `主轴：
1) 升级：从 0 到 1 再到 N，每一次升级必须有"肉眼可见的变化"（武器/气场/穿着/手下）
2) 战斗：一对一 → 一对多 → 团战，逐级放大
3) 兄弟：一定要有背叛与救赎的情感支点
4) 权谋：势力/帮派/家族三选一，每集有一次"布局揭晓"
视觉建议：冷色硬光 + 高对比 + 慢动作战斗 + 粒子特效（火花/风暴/能量冲击波）。`,
    tags: ['男频', '升级流', '战斗', '权谋'],
    keywords: ['power progression', 'combat', 'brotherhood', 'political intrigue'],
    prompt_snippets: [
      'cold harsh lighting, high contrast, sparks flying',
      'slow motion combat with energy shockwave',
      'epic wide shot revealing hero with his army',
    ],
    applies_to: ['screenwriter', 'director'],
    source: '网文男频通用套路',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_drama_nvpin',
    collection: 'drama',
    subcategory: '女频文',
    title: '女频文：重生/甜宠/古偶/豪门四大赛道',
    summary: '女频 = 情感浓度 + 颜值供给 + 命运感 + 人设反差。核心是"被选中的代入感"。',
    content: `四大赛道：
1) 重生：开局回到关键时间点，必须在前 30 秒交代"我回来了"的决绝感
2) 甜宠：糖点密集，每 1-2 分钟一次肢体接触或眼神特写
3) 古偶：服化道 + 绝美空镜 + 慢动作回眸
4) 豪门：身份落差 + 商战碾压 + 家族暗战
视觉建议：暖金光 + 浅景深 + 特写 + 柔焦；男主出场必须慢动作 + 逆光 + rim light。`,
    tags: ['女频', '重生', '甜宠', '古偶', '豪门'],
    keywords: ['rebirth', 'sweet romance', 'ancient costume', 'elite family', 'rim light'],
    prompt_snippets: [
      'warm golden hour lighting, shallow depth of field',
      'slow motion hero reveal with back light rim',
      'close-up on trembling hand, cinematic bokeh',
    ],
    applies_to: ['screenwriter', 'director'],
    source: '网文女频通用套路',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_drama_xuanyi',
    collection: 'drama',
    subcategory: '悬疑文',
    title: '悬疑文：伏笔 / 反转 / 信息差三板斧',
    summary: '悬疑 = 读者与主角的信息差博弈。每集必须埋 2 个伏笔、揭 1 个反转。',
    content: `核心技法：
- 伏笔必须"可回看"：第一次出现像无意的细节，第二次出现时引爆
- 反转必须"可验证"：反转之后回去看，前面的线索都成立
- 信息差管理：读者知道的要比主角多（紧张）或少（震惊）
- 节奏建议：每 3 个镜头出现一个"异常点"（声音/眼神/物品错位）
视觉建议：低光 + 冷蓝调 + 顶光压迫 + 手持微抖 + 特写异常细节。`,
    tags: ['悬疑', '反转', '伏笔', '信息差'],
    keywords: ['mystery', 'twist', 'foreshadow', 'handheld', 'top light'],
    prompt_snippets: [
      'dim low-key lighting, cool blue palette, harsh top light',
      'handheld camera with subtle tension',
      'rack focus from misplaced object to character reaction',
    ],
    applies_to: ['screenwriter', 'director'],
    source: '悬疑类型写作通用技法',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_drama_qinggan',
    collection: 'drama',
    subcategory: '情感文',
    title: '情感文：泪点公式（失去 - 重逢 - 错过）',
    summary: '情感类型最强的三种泪点：失去至亲、久别重逢、擦肩而过。',
    content: `三大泪点：
1) 失去：必须先建立温暖日常，再破坏（失去的是"已经拥有的"）
2) 重逢：分别 + 时间流逝 + 不期而遇，越克制越催泪
3) 错过：两人在同一空间因为 0.5 秒的时差错开
配套：长镜头 + 慢动作 + 钢琴曲 + 雨声 / 风声 + 微表情特写。避免配乐过早起，让观众先静默再情绪爆发。`,
    tags: ['情感', '泪点', '催泪公式'],
    keywords: ['loss', 'reunion', 'missed by seconds', 'emotional beat'],
    prompt_snippets: [
      'long take slow motion, soft piano, rain ambience',
      'micro expression close-up on trembling lip',
      'two characters passing each other missing by seconds',
    ],
    applies_to: ['screenwriter', 'director'],
    source: '情感类型写作通用技法',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_drama_kongbu',
    collection: 'drama',
    subcategory: '恐怖小说',
    title: '恐怖/惊悚：不要吓人，要让人自己吓自己',
    summary: '最高级的恐怖是"暗示 + 声音 + 留白"，而不是直接展示鬼怪。',
    content: `原则：
- 暗示 > 展示：镜子里一闪而过、门缝里一只眼、地板吱呀声
- 声音先于画面：1-2 秒的环境音异常（低频嗡鸣/远处哭声）比画面更有效
- 节奏反差：长时间寂静 + 突发尖锐声
- 视觉语言：画面边缘留黑 / 景深切割 / 过曝惨白 / 色彩去饱和
- 禁忌：不要用 jumpscare 堆叠，更不要一开始就把怪物完整露脸
常用元素：雾 fog、低频环境音 ambient drone、闪烁灯 flicker、血迹 blood smear。`,
    tags: ['恐怖', '惊悚', '氛围恐怖'],
    keywords: ['horror', 'fog', 'drone ambience', 'flicker', 'suggest not show'],
    prompt_snippets: [
      'dim corridor with volumetric fog, flickering fluorescent light',
      'distant unsettling ambient drone, silence then sudden sharp sound',
      'desaturated cold palette, deep shadows swallowing the edges',
    ],
    applies_to: ['screenwriter', 'director', 'atmosphere'],
    source: '恐怖类型通用创作原则',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_drama_opening_hook',
    collection: 'drama',
    subcategory: '开篇钩子',
    title: '开篇 3 秒钩子六种范式',
    summary: '六种被验证的前 3 秒钩子：冲突 / 反常 / 悬念 / 数字 / 疑问 / 视觉奇观。',
    content: `六种钩子：
1) 冲突型：一巴掌 / 摔门 / 推搡，直接进入对峙
2) 反常型：西装革履的男主在菜市场卖鱼
3) 悬念型：手机震动 + 一条未读消息（不给看内容）
4) 数字型："我死过一次"/"这是我第 1024 次重生"
5) 疑问型：角色直面镜头说"你相信命运吗"
6) 视觉奇观型：不合常理的画面（漂浮的茶杯 / 下雪的夏天）
一集中只用一种，不要叠加。`,
    tags: ['开篇', '钩子', 'hook'],
    keywords: ['opening hook', 'first 3 seconds', 'attention grab'],
    prompt_snippets: [
      'opening shot: sudden slap, freeze frame',
      'opening shot: anomaly in a mundane setting',
      'character breaks the fourth wall, direct address to camera',
    ],
    applies_to: ['screenwriter', 'director'],
    source: '短剧/漫剧开篇通用套路',
    lang: 'zh',
    enabled: true,
  },

  // ═══════════════════════════════════════════════════
  // —— v2 新增 ——
  // ═══════════════════════════════════════════════════

  {
    id: 'kb_drama_v2_80ep_structure',
    collection: 'drama',
    subcategory: '爆款公式',
    title: '80/100 集标准短剧结构（红果/番茄/DramaBox/ReelShort 通用）',
    summary: '中文短剧产业化的"黄金 80 集曲线"：10-10-10-10-40 五段式，每段有固定功能。',
    content: `2024-2025 红果短剧、番茄短剧、DramaBox、ReelShort 产业化后形成的标准 80 集（或 100 集）结构：

**Part 1: 埋雷期 (第 1-10 集)**
- 功能：建立主角处境 + 核心矛盾 + 身份反差
- 每集时长：60-90 秒
- 必做事：
  - 第 1 集前 8 秒确定主角"谁被谁欺负了"
  - 第 3 集埋下主角的"隐藏身份"
  - 第 7-8 集首次"亮底牌"
  - 第 10 集结尾出现"转折信号"（电话响/人物登场/消息）
- 情绪：压抑 + 被动

**Part 2: 反击期 (第 11-20 集)**
- 功能：主角开始小规模打脸 + 暴露实力
- 每集 1-2 个爽点
- 核心事件："第一次当众亮相" + "第一次让反派震惊"
- 情绪：初爽 + 期待

**Part 3: 升级期 (第 21-30 集)**
- 功能：引入更大敌人 / 阶层上升
- 新配角加入（伙伴 / 情敌 / 大 Boss）
- 情绪：紧张 + 升级快感

**Part 4: 高潮期 (第 31-40 集)**
- 功能：集中爆发矛盾，多条线合流
- 每集必须有 3 个以上爽点
- 情绪：连续爽点 + 情感高潮

**Part 5: 收尾期 (第 41-80 集)**
- 功能：持续爽点 + 新反派循环
- 每 10 集一个小高潮 + 一个新反派
- 第 75 集左右最终决战
- 第 78-80 集大团圆或开放结局

**付费转化关键点**（免费剧模式）：
- 第 8-12 集：首次付费关口（通常因情感高潮）
- 第 20 集：第二付费关口（反击爽点）
- 第 35 集：第三付费关口（高潮前）
每个付费点必须是一集结尾的"悬念钩子"，不能是平缓段。`,
    tags: ['短剧', '结构', '80集', 'ReelShort', '红果', '番茄'],
    keywords: ['short drama structure', 'reelshort', 'dramabox', '红果短剧', '番茄短剧', 'paywall', 'episode pacing'],
    prompt_snippets: [
      'establishing shot of humiliated protagonist, oppressive lighting',
      'first face-slap reveal with shocked bystander reactions',
      'cliffhanger shot of phone ringing with mysterious message',
    ],
    applies_to: ['screenwriter', 'director'],
    source: '红果短剧 / 番茄短剧 / DramaBox / ReelShort 2024-2025 产业化公开结构分析',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_drama_v2_paywall_hooks',
    collection: 'drama',
    subcategory: '爆款公式',
    title: '短剧付费转化钩子地图（付费位置 × 情绪触发）',
    summary: '短剧付费率 = 钩子强度 × 情绪断点位置。第 8-12 集是黄金付费位。',
    content: `短剧行业付费模型的数据规律（2024-2025 年数据汇总）：

**付费位置经验公式**
| 付费集数 | 情绪类型 | 断点类型 | 转化率 |
|---|---|---|---|
| 8-12 集 | 情感极值 | 主角第一次强烈情绪 | **最高** 8-15% |
| 16-20 集 | 爽感极值 | 主角第一次大打脸 | 5-10% |
| 25-30 集 | 悬念极值 | 身份/身世大揭秘 | 4-8% |
| 35-40 集 | 关系极值 | 主要 CP 第一次亲密 | 3-6% |

**钩子断点的 5 种典型形态**

**#1 身份揭露钩**
上一集结尾：陌生人说出主角真名"你就是那个 XX 吧？"
下一集开头：反派震惊"怎么可能？！"

**#2 情感崩塌钩**
上一集结尾：主角亲眼看到爱人与他人亲密
下一集开头：主角的眼泪特写 + 内心独白"原来一切都是假的"

**#3 生死危机钩**
上一集结尾：主角被刀指向喉咙 / 掉下悬崖
下一集开头：救星从天而降 / 主角睁眼在陌生房间

**#4 真相反转钩**
上一集结尾：出现与之前信息矛盾的新证据
下一集开头：主角回忆 + 真相揭露（往往是最信任的人背叛）

**#5 财富突变钩**
上一集结尾：主角银行账户弹出超大数字 / 收到房契遗产
下一集开头：主角去银行确认 + 周围人表情变化

**付费钩子的禁忌**：
- 不要在平缓段付费（比如日常对话）
- 不要在已经大爽过之后 1 集内付费（情绪疲劳）
- 不要连续 2 个付费点都是同类型（钩子多样化）
- 不要付费墙后还继续铺垫（付费后 3 分钟内必须给爽点）`,
    tags: ['付费', '转化', '钩子', '短剧'],
    keywords: ['paywall', 'conversion', 'cliffhanger', 'payment hook', 'short drama monetization'],
    prompt_snippets: [
      'shock reveal moment with dramatic music sting, cliffhanger freeze frame',
      'tear-filled close-up with heart-breaking realization',
      'knife to throat extreme close-up with terrified eyes',
    ],
    applies_to: ['screenwriter', 'director'],
    source: '国内短剧平台 2024-2025 付费数据公开分析',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_drama_v2_reelshort_localization',
    collection: 'drama',
    subcategory: '爆款公式',
    title: 'ReelShort / DramaBox 海外短剧本土化公式',
    summary: '海外短剧不是简单翻译，而是题材重构：狼人/吸血鬼/CEO/Luna/Alpha 是主赛道。',
    content: `中文短剧出海（ReelShort / DramaBox / GoodShort / FlexTV）2023-2025 爆款题材：

**Top 1: 狼人/Werewolf / Luna / Alpha**
- 核心设定：Werewolf 部落 / Alpha-Luna 命运配对 / 排斥异族
- 典型钩子："I was rejected by my fated mate and found out I'm the Alpha's daughter"
- 美学：森林 / 月光 / 爪子特写 / 冷蓝调 / 火堆
- 代表作：《The Divorced Billionaire Heiress》《The Double Life of My Billionaire Husband》

**Top 2: 吸血鬼 / Vampire / Blood Lord**
- 核心设定：古老家族 / 血亲契约 / 永生之殇
- 典型钩子："My vampire ex is now my boss and I'm engaged to his brother"
- 美学：哥特 / 黑白红 / 十字架 / 烛光

**Top 3: 亿万富翁 CEO / Billionaire CEO**
- 核心设定：霸总 / 契约婚姻 / 私生子 / 豪门恩怨
- 典型钩子："The maid who caught my CEO husband cheating is actually my long-lost sister"
- 美学：摩天大楼 / 豪车 / 晚宴 / 西装

**Top 4: 复仇重生 / Revenge Rebirth**
- 核心设定：被害后重生 / 改命复仇
- 典型钩子："Reborn as my own twin sister, I'll destroy the man who killed me"
- 美学：闪回对比 / 冷暖色切换 / 前世今生剪辑

**Top 5: 豪门私生子 / Secret Heir**
- 核心设定：不知道自己是豪门后代 / DNA 鉴定
- 典型钩子："My son's pediatrician turned out to be his billionaire grandfather"
- 美学：生日派对 / 医院 / 豪宅揭露

**本土化禁忌**：
- **不要直接翻译中文霸总台词**（"你是我的女人" → 美国观众出戏）
- 中文"宫斗"不适合欧美，改为"家族秘密"
- 日本女演员必须用韩美混血脸，美国观众审美偏向混血
- 英语剧中不要出现中文书法 / 中国元素（除非是华裔主角线）
- 狼人设定必须加"命运之爱 fated mate"，不要纯血统论

**本土化建议**：
- 美国市场：Luna/Alpha > Vampire > Billionaire CEO
- 英国市场：Royal / Aristocrat > Regency Romance
- 西语市场：Telenovela 风格 + Luna/Alpha
- 东南亚市场：中国风 + 现代都市`,
    tags: ['海外', 'reelshort', 'dramabox', '狼人', '吸血鬼', '霸总'],
    keywords: ['reelshort', 'dramabox', 'overseas short drama', 'werewolf', 'luna alpha', 'billionaire ceo', 'fated mate', 'rebirth revenge'],
    prompt_snippets: [
      'moonlit forest with transformed werewolf, glowing amber eyes, Alpha pose',
      'gothic vampire mansion with candlelight and red velvet drapes',
      'billionaire CEO in Manhattan penthouse with city skyline view',
      'rebirth flashback with split screen past and present self',
    ],
    applies_to: ['screenwriter', 'director', 'atmosphere'],
    source: 'ReelShort / DramaBox 2023-2025 全球收入 Top 题材公开分析',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_drama_v2_tiangchong_top10',
    collection: 'drama',
    subcategory: '女频文',
    title: '甜宠霸总 Top 10 爆款钩子（2024 年数据验证）',
    summary: '2024 全年爆款甜宠霸总剧的开篇钩子共性：10 种套路 cover 80% 的头部作品。',
    content: `**#1 契约婚姻钩**
"我需要一个临时妻子 / 为了继承权，你愿意嫁给我吗"
视觉：签合同特写 / 钻戒 / 豪华办公室

**#2 误认身份钩**
"我以为她是普通女孩，直到我发现她是……"
视觉：反差镜头（咖啡馆 → 家族会议）

**#3 重生复仇钩**
"重生回到婚礼前一天，我要让所有对不起我的人付出代价"
视觉：倒带回忆 / 冷笑特写 / 改换造型

**#4 豪门私生女钩**
"从小在孤儿院长大的我，原来是豪门遗失的千金"
视觉：DNA 鉴定书 / 家族合照 / 震惊反应

**#5 双面人生钩**
"白天是小职员，晚上是集团 CEO / 黑客 / 设计师"
视觉：换装 montage / 镜子两面 / 跟踪镜头

**#6 失忆初恋钩**
"我失忆了，但他记得我们的每一个细节"
视觉：旧照片 / 定情物 / 眼神追忆

**#7 怀孕逃跑钩**
"怀着豪门继承人，我连夜出逃隐姓埋名 5 年"
视觉：雨夜 / 抱着孩子的背影 / 5 年后再相遇

**#8 全家冤枉钩**
"全家都不信我，只有他知道我是被冤枉的"
视觉：家庭餐桌对立 / 冷眼 / 他独自撑伞走过来

**#9 超能力觉醒钩**
"我能听到所有人的心声 / 预知未来 / 穿梭时空"
视觉：耳朵特写 / 光线波纹 / 慢镜头

**#10 替身闺蜜钩**
"我替闺蜜嫁给她的未婚夫，结果……"
视觉：婚纱换人 / 面纱揭开 / 新郎愣住

**AI 漫剧套用**：挑 1 个钩子后锁定，角色 / 服装 / 色调 / 音乐全部匹配。不要在一部剧中同时用 2 种钩子。`,
    tags: ['甜宠', '霸总', '钩子', '女频'],
    keywords: ['sweet romance', 'ceo husband', 'contract marriage', 'rebirth', 'hidden identity', 'secret pregnancy'],
    prompt_snippets: [
      'contract marriage signing with expensive fountain pen and diamond ring',
      'rebirth awakening scene with cold vengeful smile',
      'hidden billionaire CEO revealing identity in dramatic moment',
      'pregnant woman fleeing in rain holding small bag',
    ],
    applies_to: ['screenwriter', 'director'],
    source: '2024 中国短剧平台头部甜宠霸总作品开篇结构分析',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_drama_v2_rebirth_5s',
    collection: 'drama',
    subcategory: '女频文',
    title: '重生文开局 5 秒定律',
    summary: '重生文必须在前 5 秒完成 3 件事：回到哪一刻 / 前世结局 / 今生决心。',
    content: `重生文作为女频第一赛道，有严格的开局公式。前 5 秒必须完成：

**T=0s：回到哪一刻**
- 字幕浮现："重生回到了……"
- 镜头：主角睁眼 / 闹钟 / 日历 / 手机屏
- 关键元素：时间戳（"那一天的早上 7 点"）

**T=1-2s：前世结局快闪**
- 快速闪回 3 个画面：被害 / 绝望 / 最后一眼
- 风格：模糊 / 冷调 / 慢动作
- 声音：心跳 / 尖叫 / 枪声
- 要让观众瞬间理解"之前发生了什么"

**T=3-4s：今生决心**
- 主角表情变化：恐惧 → 决绝
- 内心独白（字幕或旁白）："这一世，我不会再……"
- 肢体动作：握紧拳头 / 擦干眼泪 / 撕掉照片

**T=5s：起手式**
- 做一件改变前世命运的"第一个动作"
- 例：打电话取消订婚 / 摔掉结婚照 / 出门上车

**关键视觉语言**：
- 前世用低饱和冷调
- 今生用正常饱和暖调
- 过渡用闪白或色彩反转
- 重生瞬间配急促弦乐 + 心跳声

**错误示范**：
- 主角醒来先发呆 10 秒
- 用大段旁白解释"我是谁从哪里来"
- 前世快闪太长（超过 2 秒）
- 不给前世死因（观众没代入感）`,
    tags: ['重生', '开局', '女频', '5秒定律'],
    keywords: ['rebirth', 'opening formula', '5 second rule', 'female lead', 'transmigration'],
    prompt_snippets: [
      'eyes snapping open with sudden realization, quick cut to calendar date',
      'rapid flashback montage of past life death, desaturated cold tones',
      'determined face transformation from fear to cold resolve',
      'clenched fist close-up with tear-stained face',
    ],
    applies_to: ['screenwriter', 'director'],
    source: '国内重生题材短剧 2023-2025 开场结构分析',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_drama_v2_warlord_formula',
    collection: 'drama',
    subcategory: '男频文',
    title: '战神/龙王/赘婿/兵王公式（低开高走爽文）',
    summary: '男频最大赛道的共同结构：被轻视 → 隐藏身份 → 亮底牌 → 降维打击，每集 3-5 次打脸。',
    content: `战神 / 龙王 / 赘婿 / 兵王 / 都市至尊 / 医圣 等题材共享同一个底层结构：

**主角设定**
- 表面：上门女婿 / 废物 / 司机 / 保安 / 清洁工 / 外卖员
- 真实：特种兵王 / 龙组组长 / 一代战神 / 医学至尊 / 神级黑客
- 年龄：30-40 岁（代入感最强）

**Part A: 屈辱开局（1-3 集）**
- 家族会议被羞辱 / 同学聚会被嘲讽 / 岳父岳母赶走
- 情绪底线：观众愤怒到极点
- 关键：主角全程隐忍不出手

**Part B: 首次亮剑（4-8 集）**
- 因保护亲人 / 解决危机 被迫出手
- 用最小动作完成最大反差（例：一指点晕对方）
- 围观者集体震惊
- 情绪：爽 + 震撼

**Part C: 身份初露（9-15 集）**
- 老战友 / 老部下出现喊"XX 先生"
- 真实身份开始被部分角色知道
- 每次披露都带来新一波震撼

**Part D: 面对更大敌人（16-30 集）**
- 引入国际势力 / 古武家族 / 商业巨头
- 不断刷新"主角到底有多强"的下限
- 每 3 集一次大场面
- 每 5 集揭露一个新身份层级

**视觉锚点**：
- 主角：低调西装 / 白衬衫 / 沉稳表情
- 反派：奢华西装 / 夸张配饰 / 嚣张表情
- 战斗：极简慢动作 + 精准一击 + 对手惊恐特写
- 场景：家族客厅 / 酒店宴会 / 董事会议室

**禁忌**：
- 主角不要太早出手（前 3 集必须忍）
- 不要给主角失败镜头
- 不要让反派比主角聪明
- 不要让女主质疑主角

**经典开场公式**：
"我在 XX 地方被 XX 人羞辱，他们不知道我的另一个身份是 XX"`,
    tags: ['战神', '龙王', '赘婿', '兵王', '男频'],
    keywords: ['warlord', 'dragon king', 'son-in-law', 'veteran', 'hidden identity', 'face slap', 'male power fantasy'],
    prompt_snippets: [
      'humble-looking middle-aged man in plain clothes ignored at family dinner',
      'single minimal gesture defeating arrogant opponent, shocked onlookers',
      'old comrades in military uniform saluting protagonist with reverence',
      'luxury villa confrontation with protagonist slowly revealing true power',
    ],
    applies_to: ['screenwriter', 'director'],
    source: '中国男频战神题材 2020-2025 爆款共性结构',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_drama_v2_xuanyi_density',
    collection: 'drama',
    subcategory: '悬疑文',
    title: '悬疑反转密度表（每 1000 字 / 60 秒的信息量）',
    summary: '悬疑节奏 = 伏笔密度 + 反转密度。短剧每 60 秒至少 1 反转，每 30 秒至少 1 线索。',
    content: `**悬疑密度公式**
\`\`\`
60 秒一集 = 1 次小反转 + 2-3 个线索 + 1 个异常点
90 秒一集 = 2 次小反转 + 4-5 个线索 + 1 个大悬念
每 10 集 = 1 次阶段性真相 + 1 个新谜团
\`\`\`

**线索类型**
- **物证**：一个信物 / 一张照片 / 一段录音 / 一件物品错位
- **言证**：一句话的含义 / 证人口误 / 不自然的沉默
- **行动证**：一次回头 / 一次接电话 / 一次换座位
- **环境证**：时间不对 / 地点不对 / 天气不对

**反转层级**
| 层级 | 频率 | 功能 |
|---|---|---|
| 微反转 | 每 15 秒 | 小范围信息修正（原来不是 A 是 B） |
| 场反转 | 每集 1 次 | 改变主角对局面的理解 |
| 人反转 | 每 3 集 1 次 | 改变角色关系（好人变坏人） |
| 世界反转 | 每 10 集 1 次 | 改变整个故事基调（现实变超自然） |

**伏笔使用法则**
- 伏笔第一次出现：**无意**（镜头给到但不聚焦）
- 伏笔第二次出现：**加强**（镜头停留 0.5 秒）
- 伏笔第三次出现：**引爆**（配合反转，观众 "啊！"）

**悬疑必备的 4 种镜头**
1. **误导镜头**：故意引导观众注意错误的地方
2. **延时镜头**：反派一个动作慢放 2 秒，让观众怀疑
3. **空镜头**：突然停 1 秒给一个静止画面，提示"这里有线索"
4. **眼神镜头**：角色眼神飘忽，暗示隐藏信息

**悬疑对白特征**
- 句尾留白（"那件事……算了"）
- 双关语（一句话两种理解）
- 突然沉默（停 2 秒）
- 答非所问（转移话题 = 隐藏信息）`,
    tags: ['悬疑', '反转', '密度', '伏笔'],
    keywords: ['mystery density', 'twist frequency', 'clue planting', 'misdirection shot', 'red herring'],
    prompt_snippets: [
      'subtle misdirection shot of background character acting suspicious',
      'delayed action shot with 2 second freeze on ambiguous gesture',
      'eye line flicker suggesting hidden knowledge',
      'silent hold on significant object for 0.5 seconds',
    ],
    applies_to: ['screenwriter', 'director'],
    source: '悬疑类型 2020-2025 短剧节奏公开分析',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_drama_v2_emotional_beats',
    collection: 'drama',
    subcategory: '情感文',
    title: '情感短剧泪点时间轴（30 分钟剧情的情绪曲线）',
    summary: '情感剧不能一直哭，要有"铺垫 - 小哭 - 平缓 - 大哭 - 余韵"五段曲线。',
    content: `**30 分钟情感剧的黄金情绪曲线**

\`\`\`
0min  ┤■
3min  ┤■■■■ ← 初次情感波动（小哭点）
7min  ┤■■
14min ┤■■■■■■ ← 误会爆发（第一个泪崩）
18min ┤■■
22min ┤■■■■■■■■ ← 情感高潮（大哭点）
27min ┤■■■■ ← 金句 + 和解
30min ┤■■
\`\`\`

**5 个关键情绪节点**

**#1 情感铺垫 (0-3min)**
- 日常温暖画面：牵手 / 一起吃饭 / 看电影
- 柔光 + 暖色 + 轻音乐
- 建立"失去前的美好"

**#2 第一次小哭 (3-5min)**
- 导火索：一句玩笑话被误解 / 一个电话 / 一次回头
- 小泪 1 滴（特写）
- 避免大哭（留给后面）

**#3 平缓过渡 (5-14min)**
- 展开双线故事，铺垫真相
- 情绪曲线下压
- 让观众"以为没事了"（情绪陷阱）

**#4 误会爆发（14-16min）**
- 真相被错误理解
- 第一次大争吵 / 摔门 / 雨中奔跑
- 观众开始跟着哭
- 配乐弦乐骤起

**#5 情感高潮（22-25min）**
- 真相大白 / 再次相遇 / 最后一眼
- 慢动作 + 沉默 + 钢琴 + 特写
- 观众泪崩点
- **此处时长必须够**：至少 90 秒的情绪宣泄

**#6 金句收尾（27-30min）**
- 一句押韵金句或对白
- 画面静止 3 秒
- 片尾曲接入
- 给观众"回味"的时间

**泪点设计禁忌**：
- 不要一开场就哭（观众没感情基础）
- 不要连续 2 个哭点之间隔少于 8 分钟
- 不要每次都用同一个泪点类型（要变化）
- 不要配乐过早起（会提前剧透情绪）
- 不要在高潮后立刻 CTA（让观众回味）`,
    tags: ['情感', '泪点', '时间轴', '情绪曲线'],
    keywords: ['emotional beats', 'tear jerker', 'crying moments', 'emotion curve', 'romance pacing'],
    prompt_snippets: [
      'warm soft lighting of happy couple eating together, nostalgic feeling',
      'single tear rolling down cheek in extreme close-up, ambient room light',
      'argument in the rain, slow motion, piano overlay',
      'final goodbye look with trembling lips and watering eyes',
    ],
    applies_to: ['screenwriter', 'director'],
    source: '情感类型短剧 2023-2025 高口碑作品节奏分析',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_drama_v2_shuangpin_density',
    collection: 'drama',
    subcategory: '爽文',
    title: '爽点密度公式（每 45 秒一爽点法则）',
    summary: '爽文短剧核心 KPI 就是"爽点密度"，每 45 秒必须给一次情绪兑现。',
    content: `**爽点定义**：让观众产生"爽了""舒服""出气了""解气了"的情绪兑现瞬间。

**密度标准**（90 秒一集）：
- 最低：2 个爽点 / 集
- 标准：3 个爽点 / 集
- 爆款：5 个爽点 / 集（几乎 20 秒一次）

**爽点 7 大类型**

**Type 1: 打脸爽**
反派嚣张 → 被主角一击制服 → 反派下跪 / 崩溃
典型节奏：5s 铺垫 + 3s 出手 + 10s 反应

**Type 2: 身份爽**
反派："你算什么东西" → 知情人出现喊"XX 先生" → 反派脸色惨白

**Type 3: 实力爽**
不可能完成的事（治病 / 解决危机 / 战斗）→ 主角一招完成 → 所有人震惊

**Type 4: 豪爽**
主角一次性挥霍巨款 / 买下整个商场 / 让反派倾家荡产

**Type 5: 认亲爽**
被轻视的主角被发现是豪门子弟 / 重要人物 / 国家英雄

**Type 6: 复仇爽**
曾经伤害主角的人遭到精确报应（失业 / 破产 / 被抛弃）

**Type 7: 护短爽**
主角的家人被欺负 → 主角第一时间出手保护 → 欺负者被打脸

**密度配比（一集的 3-5 个爽点）**
\`\`\`
[0-20s]  Type 1 或 Type 2（开场必爽）
[20-40s] Type 3 或 Type 4
[40-60s] 平缓铺垫下一个
[60-75s] Type 5 或 Type 6（最强爽点）
[75-90s] Type 7 + 下集钩子
\`\`\`

**爽点加强技法**
- **围观放大**：爽点发生时给围观者 3 秒惊恐 / 敬畏 / 震惊特写
- **慢动作**：关键动作慢放 1.5-2 倍
- **音效加持**：打耳光必须脆响 / 砸桌必须巨响 / 脚步必须重音
- **反派下跪**：最强 finisher，不到万不得已不用

**爽点禁忌**：
- 不要主角自爽（必须有受害者 / 见证者）
- 不要爽点之后立刻进入文戏
- 不要一集只有一种爽点类型
- 不要让主角解释自己很强（要让别人说）`,
    tags: ['爽点', '密度', '爽文', '打脸'],
    keywords: ['satisfaction density', 'face slap frequency', 'power fantasy pacing', 'bystander reaction'],
    prompt_snippets: [
      'triple reaction shot of shocked bystanders with zoom-in effect',
      'slow motion single strike taking down arrogant opponent',
      'villain falling to knees in disbelief, close-up on terrified face',
      'protagonist throwing cash on the table, casual overwhelming power move',
    ],
    applies_to: ['screenwriter', 'director'],
    source: '爽文短剧 2022-2025 头部作品爽点节奏分析',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_drama_v2_ads_psycho',
    collection: 'drama',
    subcategory: '爆款公式',
    title: '短剧投流素材的 ROI 导向结构（巨量引擎 / 磁力金牛逻辑）',
    summary: '投流素材 ≠ 正片，投流是"让用户 3 秒内决定要不要继续"，逻辑完全不同。',
    content: `短剧投流（巨量引擎、磁力金牛、千川）的素材结构与正片完全不同。

**投流素材的核心 KPI**：
- ROI (Return on Ad Spend)
- CTR (Click-Through Rate)
- 完播率 (15 秒内)
- 付费转化率

**投流素材黄金结构（15-30 秒）**

**[0-2s] 最强钩子**
- 出主角最惨 / 最爽 / 最反差的瞬间
- 配合大字幕 + 高能 BGM
- 用"你绝对猜不到接下来……"

**[2-6s] 冲突展示**
- 3-4 秒的核心剧情冲突
- 必须让观众立刻理解"谁和谁在对立"

**[6-12s] 爽点预告**
- 展示一个"爽点承诺"（主角即将开始反击）
- 画面必须给 1 次"主角强"的细节

**[12-18s] 付费诱饵**
- "想看主角如何打脸全家？点击下方链接"
- "第 X 集更精彩"
- 配合福利："前 100 名免费"

**[18-25s] 行动呼吁**
- 大字幕 + 箭头 + 二维码
- "立即观看"
- 配合紧迫感："限时免费"

**投流素材的题材偏好（2024-2025 数据）**
| 题材 | CTR | 付费率 | 建议 |
|---|---|---|---|
| 战神/龙王 | 高 | 高 | **主力投放** |
| 重生复仇 | 高 | 中 | 主力 |
| 甜宠霸总 | 中 | 高 | 主力 |
| 悬疑反转 | 中 | 低 | 辅助 |
| 恐怖惊悚 | 低 | 低 | 不建议投流 |

**投流素材的 7 个转化话术**
1. "家人们，这个剧真的绝了"
2. "我熬夜看完了，强烈推荐"
3. "男主太帅了，前 100 集免费"
4. "这部剧爽到爆炸，已经看了 3 遍"
5. "女主逆袭太过瘾"
6. "更新太快了，根本追不上"
7. "第 X 集神反转，完全想不到"

**禁忌**：
- 不要用正片第 1 集开头（太慢）
- 不要用剧透性过强的高潮（用户看了就不想付费）
- 不要剪辑感太强（要自然过渡）
- 不要配乐过强（会被风控）`,
    tags: ['投流', '广告', 'ROI', '巨量引擎'],
    keywords: ['ads creative', 'roas', 'traffic acquisition', 'ocean engine', 'short drama marketing'],
    prompt_snippets: [
      'shocking face slap moment with bold yellow subtitle overlay',
      'dramatic zoom-in on cash being thrown, price text explosion',
      'male lead revealing hidden identity with audience reaction shot',
    ],
    applies_to: ['screenwriter', 'director'],
    source: '巨量引擎 / 磁力金牛 / 千川 2023-2025 短剧投流公开案例',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_drama_v2_kdrama_tempo',
    collection: 'drama',
    subcategory: '情感文',
    title: 'K-drama 韩剧节奏范式（起承转合 16 集结构）',
    summary: '韩剧标准 16 集结构：4-4-4-4 四段式，每段节奏功能清晰。',
    content: `韩剧作为全球剧集工业顶尖代表，其 16 集标准结构（每集 60-70 分钟）是 AI 漫剧连续剧的最佳参考。

**第 1-4 集：起 (Establishing)**
- 世界观 + 主角设定
- 男女主命运相遇（必须在第 1 集末尾或第 2 集）
- 埋下核心秘密（第 3-4 集揭露一部分）
- 情绪：好奇 + 浪漫开端
- 代表场景：初遇雨中 / 地铁错过 / 电梯尴尬

**第 5-8 集：承 (Building)**
- 情感升温，但有外部阻碍（前男女友 / 家族 / 事业）
- 男女主产生 CP 感，但未确定关系
- 第 7-8 集通常有"第一次亲密"（第一次吻 / 拥抱 / 表白）
- 情绪：甜蜜 + 暗流涌动
- 代表场景：醉酒告白 / 生日惊喜 / 雨夜 confession

**第 9-12 集：转 (Twisting)**
- 秘密暴露 / 第三者介入 / 误会升级
- 男女主第一次重大分歧
- 第 10-11 集分手 or 重大背叛
- 情绪：痛苦 + 失落
- 代表场景：机场送别 / 大雨争吵 / 摔门离去

**第 13-16 集：合 (Resolving)**
- 真相大白
- 第 14 集重逢或和解
- 第 15 集最终考验
- 第 16 集大团圆（但可能留开放结局）
- 情绪：感动 + 释怀
- 代表场景：多年后重逢 / 婚礼 / 海边拥抱

**韩剧视觉范式**
- 暖色调 + 浅景深 + 柔光
- 大量咖啡馆 / 海边 / 雪景 / 樱花场景
- 男主出场必有慢动作
- 女主流泪必有钢琴 BGM
- 每集结尾必留钩子（下集预告）

**K-drama 必备 10 个标志性镜头**
1. 雨中撑伞（男主举伞）
2. 手腕捉回（女主回头）
3. 背后拥抱（窗边）
4. 自动贩卖机告白
5. 耳环整理（男主为女主）
6. 雪中奔跑
7. 出租车追赶
8. 咖啡机偶遇
9. 公交车站等待
10. 机场分别`,
    tags: ['K-drama', '韩剧', '16集', '起承转合'],
    keywords: ['korean drama', 'k-drama', '16 episodes', 'romance tempo', 'umbrella scene', 'wrist grab'],
    prompt_snippets: [
      'warm romantic lighting, shallow depth of field, cherry blossom background',
      'male lead holding umbrella over female lead in slow motion rain',
      'back hug by the window with city lights, soft piano music',
      'wrist grab pull back moment with surprised eye contact',
    ],
    applies_to: ['screenwriter', 'director'],
    source: '韩剧 2015-2025 经典作品结构与镜头语言分析',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_drama_v2_three_act',
    collection: 'drama',
    subcategory: '爆款公式',
    title: '电影化三幕剧结构（好莱坞黄金模板）',
    summary: '三幕剧 25%-50%-25% 比例：建立 → 对抗 → 解决。AI 短片/漫剧电影化必备。',
    content: `三幕剧是好莱坞电影 100 年验证的叙事骨架，适用于任何 2-15 分钟的 AI 短片或 30-60 分钟的漫剧单集。

**第一幕：建立 (Act 1, 25%)**

*Sequence 1 - 开场 (5%)*
- 建立世界 + 主角日常
- 暗示核心问题
- 视觉锚点：展示主角"正常生活"

*Sequence 2 - 召唤 (10%)*
- 激励事件 (Inciting Incident) 出现
- 主角被迫面对冒险
- 例：意外收到消息 / 某人到访 / 失去重要之物

*Sequence 3 - 跨越 (10%)*
- Plot Point 1：主角做出决定，离开舒适区
- 无法回头
- 视觉：送别 / 启程 / 新环境

**第二幕：对抗 (Act 2, 50%)**

*Sequence 4 - 小试身手 (12.5%)*
- 主角遇到新世界的规则
- 结交盟友或遇到敌人
- 小成功 + 小失败

*Sequence 5 - 中点反转 (12.5%)*
- Midpoint：关键事件改变游戏
- 主角得到新信息 / 新能力 / 新威胁
- 情绪从上升转为下降

*Sequence 6 - 迫近黑暗 (12.5%)*
- 敌人反攻 / 盟友背叛
- 主角连续失败

*Sequence 7 - 全面失败 (12.5%)*
- All is Lost 时刻（~75%）
- 主角跌至谷底
- 看似不可能翻盘
- 视觉：阴天 / 独坐 / 废墟

**第三幕：解决 (Act 3, 25%)**

*Sequence 8 - 灵感乍现 (10%)*
- Plot Point 2：主角找到新方法
- 重整旗鼓
- 配乐回升

*Sequence 9 - 最终决战 (10%)*
- Climax 对决
- 用第一幕埋下的伏笔
- 主角改变了（弧光完成）

*Sequence 10 - 新平衡 (5%)*
- Resolution 收尾
- 新常态 / 或开放结局
- 情绪：释怀 + 满足

**AI 漫剧应用建议**：
- 30 秒短片 = 浓缩三幕（7.5s / 15s / 7.5s）
- 90 秒一集 = 三幕（22s / 45s / 22s）
- 10 集连续剧 = 三幕（2-3 集 / 4-5 集 / 2-3 集）
- 80 集长剧 = 每 8-10 集一个小三幕 + 总体三幕`,
    tags: ['三幕剧', '好莱坞', '结构', '电影化'],
    keywords: ['three act structure', 'hollywood', 'act 1 act 2 act 3', 'midpoint', 'all is lost', 'climax'],
    prompt_snippets: [
      'establishing shot of protagonist ordinary life, golden hour warm light',
      'inciting incident close-up with sudden dramatic lighting change',
      'midpoint revelation scene with complete mood shift',
      'all is lost moment in desaturated cold lighting, protagonist alone',
      'climactic final confrontation with heightened music and tight framing',
    ],
    applies_to: ['screenwriter', 'director'],
    source: '好莱坞三幕剧理论（Syd Field, Blake Snyder, Robert McKee）',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_drama_v2_anime_tempo',
    collection: 'drama',
    subcategory: '爆款公式',
    title: '日系动漫节奏三板斧（热血 / 治愈 / 恋爱）',
    summary: '日系动漫三大主流节奏：热血每集 1 次觉醒、治愈每集 1 次温暖、恋爱每集 1 次心动。',
    content: `**热血动漫节奏**（《鬼灭之刃》《进击的巨人》《咒术回战》）
- 每集 22 分钟 = A 部 (11min) + B 部 (11min)
- A 部：日常 / 铺垫
- B 部：战斗 / 高潮
- 每集必须有"一次觉醒"（主角突破 / 新技能 / 新形态）
- 战斗镜头占比 30-50%
- 慢动作 + 特写 + 特效 + 喊招名

**治愈动漫节奏**（《夏目友人帐》《夏日口袋妖怪》《银之匙》）
- 每集 22 分钟 = 单元剧结构
- 一集一个小故事，完整起承转合
- 节奏缓慢，每 5 分钟一个情感点
- 大量空镜 + 风景 + 风声 + 鸟鸣
- 角色表情变化慢，情绪克制

**恋爱动漫节奏**（《你的名字》《果然我的青春恋爱喜剧搞错了》《辉夜大小姐》）
- 每集 22 分钟 = 铺垫 + 心动 + 余韵
- 每集必须有"一次心动瞬间"（特写 / 慢动作 / 钢琴）
- 男女主角独处场景占比 50%+
- 大量脸红 / 结巴 / 眼神躲闪 / 手指互碰

**日系动漫的通用视觉语言**
- 色彩：高饱和 + 明亮
- 光影：日式柔光 + 明显阴影
- 风格：赛璐璐动画 / Cel shading
- 构图：大量空镜头 + 远景 + 近景交替
- 季节感：樱花 / 夏蝉 / 红叶 / 雪花

**日系动漫的节奏禁忌**
- 不要全程同速度（观众会疲劳）
- 不要缺少空镜（日系需要呼吸）
- 不要配音过满（留白很重要）
- 不要大反派早出现（热血除外）

**AI 漫剧选日系动漫风格的关键词**
\`\`\`
Japanese anime style, cel shading, vibrant colors,
soft warm light, dramatic shadows,
expressive character design, detailed backgrounds,
Studio Ghibli / Makoto Shinkai / Kyoto Animation style,
nostalgic summer atmosphere
\`\`\``,
    tags: ['日系动漫', '节奏', '热血', '治愈', '恋爱'],
    keywords: ['anime tempo', 'shounen', 'iyashikei', 'romance anime', 'ghibli', 'makoto shinkai', 'kyoto animation'],
    prompt_snippets: [
      'Japanese anime style cel shading, vibrant colors, sharp character lines',
      'shounen battle scene with speed lines and energy effects',
      'iyashikei serene countryside with warm sunset and cicadas',
      'romantic anime blushing close-up with shimmering eyes',
    ],
    applies_to: ['screenwriter', 'director', 'atmosphere'],
    source: '日本动画工业 1990-2025 主流节奏与视觉语言分析',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_drama_v2_IP_adaptation',
    collection: 'drama',
    subcategory: '爆款公式',
    title: '网文 IP 改编短剧的"砍 - 留 - 加"三字诀',
    summary: '网文改编 ≠ 逐章翻拍。核心是"砍冗余、留爽点、加视觉"。',
    content: `网文（起点 / 晋江 / 番茄 / 知乎盐选）改编为短剧的实战法则：

**砍：必须删掉的内容**
- 长篇内心独白（视觉不表现）
- 背景设定大段讲解（世界观靠画面带出）
- 次要角色 A/B/C（合并成 1-2 个）
- 重复的打斗（只保留关键战）
- 不推进剧情的对话

**留：必须保留的黄金段落**
- 开场钩子
- 关键爽点（打脸 / 亮身份 / 报仇）
- 核心 CP 线（只留最重要的 3-5 个节点）
- 大反派对决
- 结局决战

**加：必须新增的视觉化内容**
- 角色视觉细节（小说只写"她穿得很美"，短剧必须拍出细节）
- 空间感（场景位置关系必须清晰）
- 反应镜头（小说靠文字，短剧靠表情）
- 道具 / 环境线索（增强可信度）
- 音乐情绪（小说没配乐，短剧必须）

**改编节奏比例**
| 原作类型 | 原作字数 | 改编集数 | 每集对应 |
|---|---|---|---|
| 短篇网文 | 5 万字 | 20 集 | 2500 字 |
| 中篇网文 | 30 万字 | 60 集 | 5000 字 |
| 长篇网文 | 100 万字 | 80 集 | 12500 字 |
| 超长网文 | 300 万字+ | 必须大砍 | 只取主线 |

**改编误区**
- 忠实原作 ≠ 逐字翻拍（长篇必须砍）
- 保留所有梗 ≠ 观众能接受（短剧观众没看过原作）
- 原作的"爽感"方法在短剧可能不适用（文字爽点 ≠ 视觉爽点）
- 必须考虑平台限制（付费模式、时长限制、审核）

**改编前的评估清单**
- [ ] 这个 IP 有没有强视觉化场景？
- [ ] 核心冲突能用 3 个镜头讲清吗？
- [ ] 男女主颜值能否支撑观众追看？
- [ ] 爽点能否在 60 秒内兑现？
- [ ] 原作粉丝会不会强烈抵制删改？`,
    tags: ['网文', 'IP', '改编', '短剧'],
    keywords: ['novel adaptation', 'ip conversion', 'web novel', 'screenplay adaptation'],
    prompt_snippets: [
      'visual expansion of internal monologue into reaction shots and symbolic imagery',
      'merged composite scene combining multiple book chapters into one visual sequence',
    ],
    applies_to: ['screenwriter', 'director'],
    source: '起点/晋江/番茄/知乎盐选 2022-2025 改编短剧案例',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_drama_v2_series_universe',
    collection: 'drama',
    subcategory: '爆款公式',
    title: '漫剧系列化 / 宇宙化策略（一个世界多部戏）',
    summary: '单部爆款 → 宇宙化：同世界观多主角、跨剧客串、时间线串联。',
    content: `漫剧作为 AI 驱动的快速生产内容，系列化是放大影响力的最佳策略。

**系列化 3 种范式**

**#1 同世界观多主角（漫威模式）**
- 建立一个统一的世界观（如：赛博朋克 2077 / 修仙大陆 / 都市异能）
- 每部戏主角不同
- 角色之间偶尔客串互动
- 例：《战神系列》的龙王 → 战神 → 医圣 → 兵王

**#2 时间线串联（权游模式）**
- 同一个家族 / 组织的跨代故事
- 第一季爷爷辈，第二季父亲辈，第三季主角辈
- 视觉连贯（建筑 / 服饰 / 家徽）
- 例：豪门恩怨剧的三代传承

**#3 平行宇宙（奇异博士模式）**
- 同一角色在不同设定中
- 古装 / 现代 / 末世 / 校园
- 角色本质不变，遭遇不同
- 适合甜宠 CP，延长生命周期

**宇宙化的 5 个核心锚点**
1. **统一 LOGO** — 每部戏开头 3 秒品牌 LOGO
2. **统一 BGM 主题** — 所有作品共享一段标志性音乐
3. **统一色彩基调** — 暖金 / 冷蓝 / 青橙 三选一 lock
4. **统一角色设计语言** — 发型 / 服装 / 妆容共享美学
5. **统一标题格式** — "XX 之 XX" / "XX 的 XX"

**宇宙化的商业价值**
- 老 IP 反哺新剧（关联推荐）
- 老角色客串拉回老观众
- 合集推广降低获客成本
- 衍生品开发（漫画 / 有声书 / 小说）

**常见错误**
- 世界观前后矛盾（不同剧人物设定冲突）
- 过度客串影响新剧独立性
- 忽视新观众，每部都假设观众看过前作
- 没有"入坑序列"引导

**AI 漫剧系列化 checklist**
- [ ] 是否有角色 bible 和世界观文档？
- [ ] 每部戏 5 秒内能否让新观众看懂？
- [ ] 老粉彩蛋不影响主线理解？
- [ ] 是否统一了视觉锚点？`,
    tags: ['系列化', '宇宙', 'IP', '漫剧'],
    keywords: ['series universe', 'cinematic universe', 'ip extension', 'franchise', 'crossover'],
    prompt_snippets: [
      'unified brand logo opening with distinctive musical sting',
      'cross-series character cameo with knowing look to camera',
      'consistent color palette and visual language across series',
    ],
    applies_to: ['screenwriter', 'director'],
    source: '好莱坞 MCU / 权游 / 漫威 + 国内漫剧系列化案例',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_drama_v2_compound_hook',
    collection: 'drama',
    subcategory: '开篇钩子',
    title: '复合钩子策略（一个开场同时给两种钩子）',
    summary: '单一钩子已被观众审美疲劳，2024-2025 爆款开始用"悬念+情感"或"冲突+反转"的双钩子。',
    content: `单一钩子已经不足以应对观众的疲劳，2024-2025 年头部短剧开始使用"复合钩子"——一个开场同时触发两种情绪。

**复合钩子 6 组组合**

**#1 悬念 + 情感**
"她不知道，此刻坐在婚礼现场的，是那个 5 年前死去的他"
- 触发好奇（为什么活着？）
- 触发情感（久别重逢的震撼）

**#2 冲突 + 反转**
"所有人都在嘲笑被离婚的她，却没人知道她真正的身份"
- 触发同情（被欺负）
- 触发期待（即将反击）

**#3 爽感 + 悬念**
"他当众掌掴反派家族族长，只用了 0.5 秒 —— 因为他是……"
- 触发爽感（打脸）
- 触发好奇（神秘身份）

**#4 恐惧 + 好奇**
"凌晨 3 点，她第 7 次醒来在同一个房间，但今天不一样"
- 触发恐惧（恐怖氛围）
- 触发好奇（今天有什么不同）

**#5 浪漫 + 悲伤**
"这是他们相遇的第一天，也是他活着的最后一天"
- 触发浪漫（初遇心动）
- 触发悲伤（死亡预告）

**#6 权威 + 反差**
"这个扫地的老头，是全世界最顶级的顾问"
- 触发反差（身份错位）
- 触发敬畏（真实实力）

**复合钩子的 3 秒实现法**

**镜头 1 (0-1s)**: 建立"常态"
**镜头 2 (1-2s)**: 打破常态（给一个关键线索）
**镜头 3 (2-3s)**: 制造复合情绪（旁白或字幕确认双钩子）

**复合钩子的禁忌**
- 不要超过 2 种情绪（3 种会让观众分心）
- 不要 2 种情绪冲突（例：同时要搞笑和悲伤）
- 不要节奏太快（观众来不及消化）
- 不要剧透太多（只给线索，不给答案）`,
    tags: ['复合钩子', '开场', '双钩子'],
    keywords: ['compound hook', 'dual hook', 'multi-emotion opening', 'opening shot strategy'],
    prompt_snippets: [
      'wedding scene with mysterious hidden figure, dual emotional tone',
      'humiliated protagonist with mysterious glow of hidden identity',
      'shocking slap moment that is revealed to be part of larger plot',
    ],
    applies_to: ['screenwriter', 'director'],
    source: '2024-2025 头部短剧开场复合钩子案例分析',
    lang: 'zh',
    enabled: true,
  },

  // ═══════════════════════════════════════════════════
  // —— v3 新增：小说主力赛道（穿越/古装/末日/仙侠/玄幻/武侠/重生完整/校园/职场/萌宝/异世界/都市异能）——
  // ═══════════════════════════════════════════════════

  {
    id: 'kb_drama_v3_chuanyue',
    collection: 'drama',
    subcategory: '穿越文',
    title: '穿越文完整公式（古穿今 / 今穿古 / 魂穿 / 身穿 / 系统流）',
    summary: '穿越文 5 种主流设定：古穿今 / 今穿古 / 魂穿 / 身穿 / 系统流。核心是"现代知识 × 异世规则"的降维打击。',
    content: `穿越文是网文三大支柱之一（穿越 / 重生 / 系统），2020-2025 短剧化后形成成熟体系。

**五大分支与差异**

**#1 今穿古（最主流）**
- 现代女性 / 男性穿越到古代
- 金手指：现代知识 + 普通话 + 数学 + 医学 + 卫生学
- 代表题材：女主穿越成古代小媳妇用现代知识开酒楼 / 男主穿越成皇子用现代军事理论征战
- 视觉锚点：古装 + 现代思维的反差（例：讲普通话、说"我的天啊"、不习惯跪）
- 开场公式："一觉醒来，我成了 XX 朝代的 XX"

**#2 古穿今**
- 古代人穿越到现代
- 冲突：不会用手机 / 地铁 / 红绿灯 / 电影
- 萌点：误把微波炉当作神器 / 把电视里的人当真人
- 代表：格格穿越到都市 / 将军穿越到高中
- 视觉锚点：古装人物惊讶看现代物品的特写
- 开场公式："本宫是哪里？为何这般神奇？"

**#3 魂穿（灵魂穿越）**
- 只有灵魂过去，借用另一个人的身体
- 必须立刻适应新身份
- 冲突：原身份的人际关系 / 记忆断层
- 代表：魂穿到冷宫嫔妃身上 / 魂穿到植物人身上
- 关键场景：第一次照镜子发现不是自己
- 开场公式："这不是我的脸！"

**#4 身穿（整个人穿越）**
- 整个人（含现代物品）穿越
- 金手指：手机 / 笔记本 / 药品 / 武器
- 通常手机还有电、有 4G 信号（忽视物理）
- 代表：带着系统穿越 / 带着智能手机到清朝
- 视觉锚点：古装场景中突兀的现代道具

**#5 系统流（穿越 + 金手指系统）**
- 穿越后激活"系统"
- 系统给任务、给奖励、给积分
- 积分可兑换：现代物品 / 武功 / 技能 / 美貌
- 代表：穿越后签到系统 / 反派洗白系统 / 种田致富系统
- 视觉：虚拟 UI 面板悬浮（半透明蓝绿色字体）
- 开场公式："叮！检测到宿主穿越，系统激活中……"

**穿越文 4 大爆款钩子**

1. **穿前身份反差**：现代顶尖医生 → 古代不被待见的庶女
2. **身体待遇反差**：原主被虐死 → 主角强势反击
3. **时代认知反差**：用现代知识震惊古人
4. **感情反差**：原主被渣男抛弃 → 主角冷静重组关系

**穿越文视觉语言**
- 穿越瞬间：眩光 / 旋涡 / 黑白闪烁
- 古代场景：暖金光 + 浅景深 + 丝绸质感
- 现代元素对比：冷蓝色手机屏 + 古代烛光暖色
- 系统 UI：半透明蓝绿色悬浮面板、数字跳动

**穿越文禁忌**
- 不要 3 集内还在懵逼状态（观众烦）
- 不要过度解释世界观（边走边讲）
- 不要金手指无限强（要有限制）
- 不要忘记现代身份设定（容易 OOC）`,
    tags: ['穿越', '穿越文', '古穿今', '今穿古', '系统流'],
    keywords: ['transmigration', 'time travel', 'isekai chinese', 'system cultivation', 'modern knowledge cheat'],
    prompt_snippets: [
      'character transmigration moment with swirling energy vortex, ancient temple background',
      'modern woman in ancient Chinese clothing looking at her reflection in bronze mirror in shock',
      'semi-transparent blue-green holographic system UI panel floating next to character',
      'ancient Chinese palace setting with modern iPhone glowing in character\'s hand, anachronism shot',
    ],
    applies_to: ['screenwriter', 'director', 'atmosphere'],
    source: '起点/晋江/番茄 2015-2025 穿越题材发展史 + 短剧改编案例',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_drama_v3_guzhuang',
    collection: 'drama',
    subcategory: '古装文',
    title: '古装/古偶剧美学与节奏公式（宫斗 / 权谋 / 江湖 / 古偶四大流派）',
    summary: '古装剧四大流派：宫斗（后宫争宠）/ 权谋（朝堂博弈）/ 江湖（侠客武林）/ 古偶（纯粹恋爱）。服化道 + 空镜是核心。',
    content: `古装剧是中国电视剧独有的类型体系，2010-2025 年从《甄嬛传》到《琅琊榜》到《长月烬明》形成成熟美学。

**四大流派区分**

**#1 宫斗剧（后宫争宠）**
- 代表：《甄嬛传》《延禧攻略》《如懿传》
- 核心矛盾：嫔妃之间争宠 + 家族利益
- 节奏：慢热铺垫 + 爆发对决
- 场景：后宫 / 御花园 / 寝殿
- 关键元素：眼神 / 请安 / 一句双关 / 暗器
- 视觉：金红 + 烛光 + 精致服饰

**#2 权谋剧（朝堂博弈）**
- 代表：《琅琊榜》《庆余年》《风起陇西》
- 核心矛盾：派系斗争 + 家国情仇
- 节奏：复杂信息密度 + 局中局
- 场景：朝堂 / 密室 / 军帐
- 关键元素：眼线 / 密信 / 反间 / 刺杀
- 视觉：冷青 + 大烛台 + 棋局 + 竹简

**#3 江湖剧（侠客武林）**
- 代表：《雪中悍刀行》《山河令》《莲花楼》
- 核心矛盾：江湖恩仇 + 武林秘籍
- 节奏：打斗 + 情感交替
- 场景：客栈 / 竹林 / 悬崖 / 瀑布
- 关键元素：剑 / 酒 / 吹笛 / 月光 / 桃花
- 视觉：水墨 + 留白 + 轻功 + 飘逸

**#4 古偶剧（纯粹恋爱）**
- 代表：《东宫》《苍兰诀》《长月烬明》《与凤行》
- 核心矛盾：仙魔 / 人神 / 两族 / 身份
- 节奏：甜虐循环
- 场景：瑶池 / 魔殿 / 仙山 / 海底
- 关键元素：红绳 / 簪子 / 令牌 / 玉佩 / 回眸一笑
- 视觉：仙气 + 长发飘飞 + 光效 + 霞光

**古装剧 6 大视觉必备**

**1. 精美服化道**
- 头饰 / 簪子 / 步摇
- 妆容层次（眉黛 / 花钿 / 口脂）
- 服装织物（绸缎 / 纱 / 锦）
- 腰间配饰（玉佩 / 香囊 / 荷包）

**2. 大量空镜**
- 飞檐上的铃铛
- 飘落的花瓣
- 烛火摇曳
- 雨打芭蕉
- 倒影涟漪

**3. 慢动作回眸**
- 女主第一次出现必慢动作
- 配背光 + 风吹头发
- 3-5 秒长镜头

**4. 行礼仪式感**
- 作揖 / 行礼 / 请安
- 节奏要慢 + 庄重

**5. 道具特写**
- 玉佩 / 簪子 / 信物
- 反复在关键时刻出现
- 承载情感记忆

**6. 古风书法字幕**
- 章节名用毛笔字
- 人名介绍用竖版
- 地名标注古风

**古装剧 Prompt 模板**
\`\`\`
ancient Chinese historical drama cinematography,
intricate silk hanfu with embroidered details,
soft warm candlelight in royal palace chamber,
wooden lattice window casting shadow patterns,
delicate jade hair ornaments, flowing long black hair,
shallow depth of field, cinematic wide shot,
Chinese period drama aesthetic, "Story of Yanxi Palace" style,
warm amber and deep red palette, slow motion
\`\`\`

**古装剧节奏禁忌**
- 不要现代口语
- 不要快节奏剪辑
- 不要忽略礼仪
- 不要中西混搭（除非是架空）`,
    tags: ['古装', '古偶', '宫斗', '权谋', '江湖'],
    keywords: ['chinese period drama', 'hanfu', 'palace intrigue', 'wuxia', 'xianxia romance', 'yanxi palace', 'langya bang'],
    prompt_snippets: [
      'intricate embroidered silk hanfu, soft warm candlelight, royal palace chamber',
      'slow motion hair reveal with backlight and wind, ancient Chinese beauty',
      'jade hair ornaments, flowing black hair, shallow depth of field',
      'Chinese period drama cinematography, warm amber and deep red palette',
    ],
    applies_to: ['screenwriter', 'director', 'atmosphere'],
    source: '中国古装剧 2010-2025 视觉美学 + 四大流派结构分析',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_drama_v3_moris',
    collection: 'drama',
    subcategory: '末日文',
    title: '末日/废土/丧尸文完整公式（6 种末日设定 × 人性考验）',
    summary: '末日文 = 资源稀缺 + 规则崩塌 + 人性拷问。6 种主流末日设定：丧尸 / 核战 / 瘟疫 / 灾害 / 异兽 / AI 叛变。',
    content: `末日文（Post-Apocalyptic）是近年中国网文和短剧的增速最快赛道之一（2022-2025）。核心是在崩塌的世界中考验人性。

**6 种主流末日设定**

**#1 丧尸末日**
- 代表：《我叫白小飞》《末日曙光》《The Walking Dead》《All of Us Are Dead》
- 触发：病毒爆发 → 人类变丧尸
- 核心矛盾：幸存者之间的资源争夺 + 丧尸围攻
- 视觉：血腥 + 废墟 + 霓虹失灵的城市

**#2 核战末日**
- 代表：《Fallout》《Mad Max》《流浪地球》
- 触发：核弹爆炸 → 辐射 + 变异
- 核心矛盾：水、食物、辐射药物稀缺
- 视觉：橙红天空 / 沙漠 / 破旧防毒面具

**#3 瘟疫末日**
- 代表：《致命文件》《Contagion》《Station Eleven》
- 触发：神秘病毒 → 大规模死亡
- 核心矛盾：隔离 + 猜疑 + 谁是感染者
- 视觉：口罩 + 防护服 + 空荡街道

**#4 自然灾害末日**
- 代表：《后天》《2012》《惊涛骇浪》
- 触发：气候崩溃 / 冰河 / 洪水 / 火山
- 核心矛盾：逃亡 + 家人失散
- 视觉：浮冰 / 洪水 / 火山灰 / 暴风雪

**#5 异兽 / 怪物末日**
- 代表：《Cloverfield》《Pacific Rim》《寄生兽》《Attack on Titan》
- 触发：巨兽出现 / 外星入侵
- 核心矛盾：凡人 vs 巨大威胁
- 视觉：巨大尺度对比 + 摧毁感

**#6 AI 叛变末日**
- 代表：《Terminator》《The Matrix》《西部世界》
- 触发：AI 觉醒攻击人类
- 核心矛盾：技术恐惧 + 幸存者联盟
- 视觉：冷金属 + 机械 + 红色扫描光

**末日文 5 大必备情节**

**1. 末日瞬间**
- 前 1 秒还是日常（咖啡、地铁、办公室）
- 下 1 秒天崩地裂
- 视觉反差最大化
- 配乐骤停 → 轰鸣

**2. 幸存者集结**
- 各色人物汇聚（老人 / 小孩 / 孕妇 / 医生 / 士兵）
- 每个人有"末日前身份"
- 为后续冲突埋伏笔

**3. 资源争夺**
- 食物 / 水 / 药品 / 武器 / 油
- 道德拷问：救人还是自保
- 最黑暗的戏往往在"最后一罐罐头"

**4. 庇护所**
- 临时庇护所的搭建
- 规则制定（谁做饭 / 谁放哨 / 谁领导）
- 庇护所内部的阴谋

**5. 外出冒险**
- 必须离开安全区获取资源
- 遇到外部威胁（丧尸 / 匪帮 / 怪物）
- 返回时往往少人或携带新成员

**末日文的 3 种人性拷问**

- **电车难题**：牺牲一人救多人？
- **信任崩塌**：曾经的朋友因饥饿偷窃
- **权力腐化**：庇护所领导变独裁者

**视觉 Prompt 模板 - 末日城市**
\`\`\`
post-apocalyptic abandoned city street, overgrown with vegetation,
rusted cars and broken windows, dust particles in air,
lone survivor walking with backpack and rifle,
desaturated grey and rust color palette,
overcast sky with distant smoke columns,
Mad Max meets Last of Us aesthetic,
cinematic wide shot, somber atmosphere
\`\`\`

**视觉 Prompt 模板 - 丧尸围攻**
\`\`\`
horde of zombies surrounding boarded-up window,
inside dark survivor shelter lit by candles and flashlights,
tense standoff, sound of scratching on walls,
cold blue night with warm interior orange glow,
Walking Dead cinematography style,
handheld camera with tension
\`\`\`

**视觉 Prompt 模板 - 核废土**
\`\`\`
radioactive wasteland under burnt orange sky,
wearing tattered gas mask and leather jacket,
walking across cracked earth toward ruined city skyline,
Fallout / Mad Max aesthetic,
amber and rust palette, atmospheric haze, 65mm anamorphic
\`\`\`

**末日文禁忌**
- 不要前 3 集还没末日（观众等不及）
- 不要反派太弱（失去紧迫感）
- 不要主角全能（要有代价）
- 不要太黑暗（观众需要希望火种）`,
    tags: ['末日', '废土', '丧尸', '核战', '瘟疫'],
    keywords: ['apocalypse', 'post-apocalyptic', 'zombie', 'wasteland', 'fallout', 'mad max', 'walking dead', 'survival'],
    prompt_snippets: [
      'post-apocalyptic abandoned city, overgrown vegetation, rusted cars',
      'horde of zombies surrounding boarded-up window, cold blue night',
      'radioactive wasteland, burnt orange sky, gas mask, cracked earth',
      'Mad Max meets Last of Us aesthetic, desaturated rust palette',
    ],
    applies_to: ['screenwriter', 'director', 'atmosphere'],
    source: '末日题材网文 + 国际末日影视 2000-2025 案例综合',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_drama_v3_rebirth_full',
    collection: 'drama',
    subcategory: '重生文',
    title: '重生文完整结构（前世 → 觉醒 → 改命 → 复仇 → 超越）五幕剧',
    summary: '重生文不只是开局，完整结构是五幕剧：前世铺垫 → 重生觉醒 → 改命布局 → 精准复仇 → 跨越前世。',
    content: `重生文是中国女频最大赛道之一。不同于 v2 的"开局 5 秒定律"，本条目提供完整的 5 幕剧长篇结构。

**五幕剧结构**

**Act 1: 前世铺垫 (5-10%)**

**1.1 前世痛点建立**
- 闪回展示前世最痛苦的时刻
- 被害 / 被抛弃 / 被背叛 / 失去所爱
- 必须让观众第一时间共情
- 视觉：冷色 / 模糊 / 雨 / 血

**1.2 前世死亡瞬间**
- 仪式感强的死亡场面
- 慢动作 + 配乐
- 主角眼中最后看到的"仇人嘴脸"
- 视觉：倒地 + 镜头倾斜 + 黑屏

**Act 2: 重生觉醒 (10-15%)**

**2.1 睁眼瞬间**
- 回到关键时间点（婚礼前 / 家族变故前 / 第一次见渣男前）
- 视觉反差：冷色 → 暖色
- 心跳声 → 呼吸声 → 真实环境音

**2.2 身份确认**
- 看日历 / 问时间 / 摸自己的脸
- 确认"真的回来了"
- 情绪从恐惧 → 决绝

**2.3 初步测试**
- 做一件前世不敢做的小事
- 确认自己有"先知"能力
- 情绪：震撼 → 兴奋

**Act 3: 改命布局 (30-40%)**

**3.1 列仇人清单**
- 前世害过自己的人一一点名
- 每人有独立恩怨线
- 女主 / 男主冷笑特写

**3.2 重置关系**
- 断绝渣男 / 渣闺蜜
- 结识前世的真朋友
- 避开前世的坑

**3.3 积累资源**
- 利用先知优势（股票 / 房产 / 项目）
- 建立经济基础
- 小成就快速兑现

**3.4 显露锋芒**
- 第一次展示"变了的自己"
- 让仇人第一次惊讶
- 关键对白："上辈子我没看清，这辈子我不会放过你们"

**Act 4: 精准复仇 (40-60%)**

**4.1 单点打击**
- 逐个击破仇人
- 每个仇人有独特的报复方式
- 用对方最得意的事击垮对方

**4.2 连环反转**
- 仇人反击 → 女主早有准备
- 每次反转都让仇人更震惊

**4.3 高潮对决**
- 最大仇人的终极对决
- 通常在仇人婚礼 / 庆典 / 商业发布会
- 当众揭露真相

**4.4 仇人崩溃**
- 仇人倾家荡产 / 进监狱 / 疯 / 死
- 报应要具体 + 合法 + 可视

**Act 5: 跨越前世 (10-15%)**

**5.1 找到真爱**
- 前世忽略的温柔男配
- 或重新遇见的初恋
- 重生后学会识人

**5.2 事业巅峰**
- 超越前世的高度
- 商业帝国 / 影后 / 顶级医生

**5.3 释怀前世**
- 站在高处回望过去
- 告别前世的自己
- 最后一句独白："这一世，我活成了自己想要的样子"

**重生文的视觉锚点系统**

**前世色：冷蓝灰 + 低饱和 + 雾气**
**今生色：暖金红 + 高饱和 + 清晰**
**仇人色：毒紫 + 血红 + 高对比**
**真爱色：柔暖白 + 薄荷绿 + 自然光**

**重生文节奏法则**
- 每集必须有 1 次"前世闪回"（触发复仇动机）
- 每集必须有 1 次"今生对比"（证明改变）
- 每 3 集必须有 1 个仇人被击倒
- 第一个仇人必须在第 5 集内被解决（立威）

**重生文禁忌**
- 不要忘记前世细节（观众会对照）
- 不要让女主心软原谅仇人
- 不要前世渣男回头被接受
- 不要过度虐主（重生就是来爽的）
- 不要最后一集才复仇完（高潮前置）`,
    tags: ['重生', '重生文', '复仇', '女频', '五幕剧'],
    keywords: ['rebirth', 'reincarnation', 'second life', 'revenge arc', 'past life flashback', 'female rebirth'],
    prompt_snippets: [
      'past life flashback in cold desaturated blue grey with fog',
      'rebirth awakening moment, eyes snapping open, warm golden light',
      'cold vengeful smile close-up, crystal clear vision of enemies',
      'revenge climax scene with enemy falling to knees in disbelief',
      'final look back at past self, standing on top of world, warm sunset',
    ],
    applies_to: ['screenwriter', 'director'],
    source: '中国女频重生文 2015-2025 头部作品完整结构分析',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_drama_v3_xianxia',
    collection: 'drama',
    subcategory: '仙侠文',
    title: '仙侠/修仙文美学与修炼体系（筑基→元婴→化神→渡劫→飞升）',
    summary: '仙侠 = 修炼境界 + 仙门宗派 + 法宝神通 + 天道规则 + 虐恋情深。《苍兰诀》《长月烬明》《莲花楼》是代表。',
    content: `仙侠是中国独有的大类型，融合武侠、神话、修真。近年代表作：《花千骨》《三生三世》《陈情令》《苍兰诀》《长月烬明》《与凤行》。

**修炼境界体系（通用）**

\`\`\`
凡人 → 练气 → 筑基 → 金丹 → 元婴 → 化神 → 渡劫 → 大乘 → 飞升
\`\`\`

每升一阶都要"渡劫"（雷劫 / 心魔劫 / 情劫），是剧情高潮锚点。

**仙侠六大视觉元素**

**1. 宗门圣地**
- 云海仙山
- 悬浮古建
- 瀑布云烟
- 飞檐白雪
- 灵气可视化（金色粒子）

**2. 法宝 / 灵器**
- 神剑（飞剑 / 御剑术）
- 仙扇 / 玉简 / 玉佩
- 灵兽（凤凰 / 麒麟 / 神龙）
- 法阵（地上发光符文）

**3. 神通法术**
- 御剑飞行（人物站在剑上飞）
- 结印 / 掐诀
- 喷火 / 冰冻 / 雷电
- 天地变色
- 招式有名（九天玄雷 / 冰火两仪诀）

**4. 仙魔对立**
- 仙：白衣 + 清冷 + 高山 + 白昼
- 魔：黑衣 + 邪魅 + 幽冥 + 黑夜
- 中间有情感纠葛
- 视觉色调对比强烈

**5. 天道与劫数**
- "天道"是最终规则
- 渡劫 = 考验
- 情劫 = 爱而不得
- 天雷 = 审判

**6. 服饰**
- 长袍 / 飞鱼服 / 道袍
- 长发及腰
- 仙气飘飘（slow motion 头发飞）
- 束发玉冠

**仙侠剧 Prompt 模板**
\`\`\`
Chinese xianxia cultivation drama cinematography,
ethereal mountain peak above sea of clouds,
young cultivator in flowing white robes standing on floating sword,
long black hair blown by wind, sword aura glowing blue,
ancient pavilions hidden in mist below,
golden particles of spiritual energy floating in air,
soft diffused magical light, shallow depth of field,
inspired by "Love Between Fairy and Devil" and "Till the End of the Moon",
cinematic wide shot, mystical atmosphere, slow motion
\`\`\`

**仙侠剧标志性场景**

- **初见**：男女主在桃林 / 竹林 / 月下
- **拜师**：师尊高位 + 徒弟跪拜
- **修炼突破**：闭关 + 灵气汇聚 + 突破瞬间
- **双修**：两人灵气交融，场景被光笼罩
- **天雷**：黑云密布 + 金色雷电 + 庄严面对
- **飞升**：金光垂下 + 主角缓缓上升
- **生死别离**：为对方挡雷 / 挡剑 / 挡魔

**仙侠剧虐恋公式**
- 天道注定不能在一起
- 身份对立（仙魔 / 师徒 / 兄妹 / 敌对宗门）
- 为了苍生必须放弃爱情
- 最后一刻大团圆或 bittersweet 结局

**仙侠剧禁忌**
- 不要现代口语（除非穿越）
- 不要打戏太写实（要飘逸）
- 不要特效 low（必须精致）
- 不要忽略境界设定（逻辑崩塌）`,
    tags: ['仙侠', '修仙', '修真', '古偶', '玄幻'],
    keywords: ['xianxia', 'cultivation', 'immortal', 'sword fairy', 'love between fairy and devil', 'till end of moon', 'eternal love'],
    prompt_snippets: [
      'Chinese xianxia cultivator in flowing white robes on floating sword',
      'ethereal mountain peak above sea of clouds, golden spiritual energy particles',
      'ancient pavilions in mist, sword aura glowing, long black hair wind',
      '"Love Between Fairy and Devil" aesthetic, mystical atmosphere',
    ],
    applies_to: ['screenwriter', 'director', 'atmosphere'],
    source: '中国仙侠剧 2015-2025 头部作品视觉美学分析',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_drama_v3_xuanhuan',
    collection: 'drama',
    subcategory: '玄幻文',
    title: '玄幻奇幻文（西式奇幻 vs 东方玄幻 对比）',
    summary: '玄幻 = 架空世界 + 超自然力量 + 种族冲突。分东方玄幻（鬼斧/大陆文）和西式奇幻（魔法/精灵/龙）。',
    content: `玄幻是比仙侠更宽的类型，包含架空世界的一切超自然设定。

**东方玄幻 vs 西式奇幻**

**东方玄幻**（《斗破苍穹》《吞噬星空》《雪中悍刀行》《完美世界》）
- 设定：灵气 / 气海 / 丹田 / 武魂 / 异兽
- 世界：大陆 / 宗派 / 王朝 / 无数国家
- 主角：废物逆袭 / 升级打怪
- 视觉：东方水墨 + 传统服饰 + 武术

**西式奇幻**（《魔戒》《权游》《龙与地下城》）
- 设定：魔法 / 元素 / 精灵 / 矮人 / 龙 / 兽人
- 世界：中世纪欧洲 + 奇幻物种
- 主角：小人物成英雄
- 视觉：中世纪 + 哥特 + 剑与魔法

**玄幻的 5 大核心设定**

**1. 力量体系**
- 等级明确（斗气 / 魔法等级 / 武魂等级）
- 可量化 / 可升级
- 有明确的"天花板"和"金手指"

**2. 种族**
- 人 / 兽 / 妖 / 魔 / 神
- 种族有固定特征
- 跨种族恋爱常见（禁忌美）

**3. 异能 / 魔法**
- 五行（金木水火土）
- 元素（风火水土雷冰光暗）
- 需要修炼 / 天赋
- 每个人有"唯一"能力

**4. 地图 / 世界观**
- 多个大陆 / 王国
- 历史悠久
- 古老遗迹 / 禁地
- 秘境 / 地下城

**5. 反派**
- 魔王 / 邪神 / 远古恐怖
- 复活 / 封印 / 苏醒
- 世界危机

**玄幻剧 Prompt 模板 - 东方玄幻**
\`\`\`
Chinese xuanhuan fantasy drama, ancient mystical continent,
young cultivator with martial soul glowing behind him,
ancient beast hovering protectively,
jagged mountain peaks and misty forests background,
Battle Through the Heavens / Soul Land aesthetic,
traditional Chinese fantasy painting style,
epic wide shot, mystical atmosphere, dramatic lighting
\`\`\`

**玄幻剧 Prompt 模板 - 西式奇幻**
\`\`\`
Western high fantasy epic, medieval castle on cliff,
knight in armor with glowing enchanted sword,
dragon flying over mountain range at sunset,
elven archer in forest with bow,
Lord of the Rings / Game of Thrones aesthetic,
cinematic wide shot, epic scale, detailed armor and costumes
\`\`\`

**玄幻剧节奏**
- 第一集必须展示力量体系（如：主角被检测魂力为 0）
- 第 3-5 集激活金手指
- 第 10 集首次展示真实力量
- 每 5 集挑战更强对手
- 每 10 集突破一个大境界

**玄幻剧禁忌**
- 不要设定不自洽
- 不要主角无限变强（要有成长曲线）
- 不要忽略力量体系规则
- 不要特效粗糙`,
    tags: ['玄幻', '奇幻', '斗破', '魔戒'],
    keywords: ['xuanhuan', 'fantasy', 'battle through heavens', 'soul land', 'lord of the rings', 'game of thrones', 'high fantasy'],
    prompt_snippets: [
      'Chinese xuanhuan cultivator with martial soul glowing behind him',
      'Battle Through the Heavens Soul Land aesthetic, epic mountain',
      'Western fantasy knight with enchanted sword, medieval castle',
      'Lord of the Rings epic wide shot, cinematic dramatic lighting',
    ],
    applies_to: ['screenwriter', 'director', 'atmosphere'],
    source: '东西方玄幻题材 2000-2025 顶尖作品分析',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_drama_v3_wuxia',
    collection: 'drama',
    subcategory: '武侠文',
    title: '武侠文（金庸 / 古龙 / 黄易 三派美学）',
    summary: '武侠 = 江湖 + 武功 + 侠义 + 恩仇。三派：金庸儒家正统 / 古龙诗意浪漫 / 黄易玄幻博学。',
    content: `武侠是华语文化独特类型。三大宗师开创三种截然不同的美学。

**金庸派（儒家正统武侠）**
- 代表：《射雕英雄传》《神雕侠侣》《天龙八部》《笑傲江湖》《倚天屠龙记》
- 主角：大侠风范 / 家国情怀 / 兼济天下
- 武功：招式繁复 / 有名有姓 / 内功深厚
- 场景：塞外大漠 / 江南烟雨 / 少林武当
- 氛围：儒家 + 侠义 + 浪漫
- 视觉：服饰考究 / 历史感 / 山水壮美

**古龙派（诗意浪漫武侠）**
- 代表：《陆小凤传奇》《楚留香》《多情剑客无情剑》《小李飞刀》
- 主角：冷面孤傲 / 大隐于市 / 一剑封喉
- 武功：重意境 / 一招制敌 / 不讲招式
- 场景：客栈 / 月下 / 刀光一闪
- 氛围：寂寞 + 浪漫 + 宿命
- 视觉：暗黑 + 简洁 + 诗意 + 留白

**黄易派（玄幻博学武侠）**
- 代表：《大唐双龙传》《寻秦记》《破碎虚空》
- 主角：成长型 / 博学多才 / 超越凡人
- 武功：融合道家 / 佛家 / 修真
- 场景：盛唐 / 战国 / 异界
- 氛围：博学 + 奇幻 + 穿越
- 视觉：历史正剧 + 奇幻元素

**武侠三绝招**

**#1 轻功（身法）**
- 草上飞
- 提纵术
- 凌波微步
- 踏雪无痕
- 视觉：人物脚尖点水不沉 / 跃上瓦片 / 树枝飞驰

**#2 剑术**
- 一剑光寒十四州
- 剑气纵横
- 万剑归宗
- 视觉：剑光闪烁 / 剑气可视化 / 一剑定乾坤

**#3 内功**
- 降龙十八掌
- 六脉神剑
- 九阳神功
- 视觉：掌风 / 气流扭曲 / 运功时的汗珠

**武侠剧 Prompt 模板 - 金庸派**
\`\`\`
Chinese wuxia cinematography, Jin Yong style,
young swordsman in white hanfu on ancient city wall,
wind blowing long hair and sleeves dramatically,
snow-capped mountains in distance, historical Song dynasty setting,
Jin Yong novel aesthetic, epic romantic martial arts atmosphere,
cinematic wide shot, golden hour lighting, slow motion
\`\`\`

**武侠剧 Prompt 模板 - 古龙派**
\`\`\`
Gu Long style wuxia noir, lone swordsman in dark tavern,
single candle lighting his face, rain outside window,
cold stare, sword resting on table,
high contrast chiaroscuro, deep shadows,
poetic minimalist atmosphere,
"The Sentimental Swordsman" aesthetic,
cinematic close-up, melancholic mood
\`\`\`

**武侠剧节奏（90 分钟单集电影结构）**
- 0-10 min: 江湖背景 + 主角登场
- 10-25 min: 恩怨伏笔 + 第一次交手
- 25-50 min: 历练成长 + 感情线
- 50-75 min: 大反派现身 + 师门秘密
- 75-90 min: 终极对决 + 儒家圆满 / 古龙悲情

**武侠剧视觉必备**
- 风 (风吹起头发和衣袍)
- 雨 (雨中决斗)
- 雪 (雪中别离)
- 月 (月下独酌 / 决斗)
- 酒 (江湖儿女必喝酒)
- 马 (大漠奔马)
- 剑 (主角的佩剑是第二主角)`,
    tags: ['武侠', '金庸', '古龙', '江湖'],
    keywords: ['wuxia', 'jin yong', 'gu long', 'huang yi', 'martial arts novel', 'chinese swordsman', 'jianghu'],
    prompt_snippets: [
      'Jin Yong wuxia swordsman in white hanfu on ancient city wall',
      'Gu Long noir lone swordsman in dark tavern, single candle',
      'wind blowing long hair and sleeves, snow-capped mountains',
      'poetic martial arts atmosphere, rain outside window duel',
    ],
    applies_to: ['screenwriter', 'director', 'atmosphere'],
    source: '金庸 / 古龙 / 黄易三大武侠宗师 + 影视改编 1960-2025 分析',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_drama_v3_campus',
    collection: 'drama',
    subcategory: '校园文',
    title: '校园青春文（甜美校园 / 暗黑校园 / 热血校园 / 青春伤痕）',
    summary: '校园题材 = 第一次心动 + 升学压力 + 友情撕裂 + 家庭矛盾。四大子流派的视觉与节奏完全不同。',
    content: `校园题材是 Z 世代观众最易代入的类型，2020-2025 不断升温。

**四大子流派**

**#1 甜美校园**（《致我们单纯的小美好》《最好的我们》《一生一世》）
- 核心：纯纯的恋爱
- 色调：暖白 / 浅粉 / 薄荷绿
- 场景：教室 / 操场 / 图书馆 / 天台 / 食堂
- 节奏：慢热 + 甜
- 视觉：夏日阳光 + 校服 + 单车 + 橘子汽水

**#2 暗黑校园**（《少年的你》《悲伤逆流成河》）
- 核心：校园欺凌 / 抑郁 / 自杀
- 色调：冷灰 / 阴郁 / 对比强
- 场景：黑暗厕所 / 废弃楼梯 / 阴雨街道
- 节奏：压抑 + 爆发
- 视觉：手持晃动 + 近景特写 + 冷光

**#3 热血校园**（《灌篮高手》《排球少年》《风犬少年》）
- 核心：运动 / 社团 / 竞赛
- 色调：鲜艳饱和 + 汗水光影
- 场景：球场 / 比赛现场 / 训练房
- 节奏：快 + 慢动作高潮
- 视觉：汗滴 + 肌肉线条 + 特效 + 慢镜头

**#4 青春伤痕**（《阳光姐妹淘》《狗十三》《七月与安生》）
- 核心：成长 / 背叛 / 别离 / 意外
- 色调：怀旧暖黄 + 老照片质感
- 场景：90 年代街头 / 老式教室 / 老家
- 节奏：回忆 + 现实交替
- 视觉：胶片质感 + 长镜头 + 家庭场景

**校园必备 10 场戏**

1. **第一次见面**（操场 / 走廊 / 图书馆）
2. **上课偷看**（女主侧脸被阳光照亮）
3. **雨中借伞**（或者淋雨分享）
4. **第一次牵手**（课桌下 / 操场边）
5. **考试压力**（深夜书桌 / 模拟考）
6. **家长反对**（父母找上门）
7. **友情撕裂**（闺蜜变情敌 / 背叛）
8. **运动会**（比赛 + 相互支持）
9. **毕业分别**（机场 / 火车站 / 学校门口）
10. **多年后重逢**（咖啡馆 / 同学聚会 / 婚礼）

**校园剧 Prompt 模板 - 甜美校园**
\`\`\`
sunny Chinese high school campus in summer,
female student in white and blue school uniform,
shy smile, walking across playground under warm sunlight,
cherry blossoms or cicadas in background,
shallow depth of field, golden hour lighting,
"A Love So Beautiful" aesthetic,
nostalgic youth atmosphere, soft pastel palette
\`\`\`

**校园剧 Prompt 模板 - 暗黑校园**
\`\`\`
bullied student curled up in empty stairwell,
harsh fluorescent light from above, deep shadows,
handheld unstable camera, close-up on trembling hands,
cold desaturated blue-grey palette,
"Better Days" cinematography aesthetic,
oppressive atmosphere, emotional rawness
\`\`\`

**校园剧节奏**
- 每集必须有 1 个"甜点"（手指碰到 / 眼神交汇 / 书的传递）
- 每 3 集必须有 1 个"情感波动"（吵架 / 误会 / 感动）
- 每 5 集必须有 1 个"身份转变"（表白 / 分手 / 重逢）
- 最后一集必须回到开头场景（环形结构）`,
    tags: ['校园', '青春', '初恋', '高中'],
    keywords: ['campus', 'youth', 'high school', 'first love', 'a love so beautiful', 'better days', 'school uniform'],
    prompt_snippets: [
      'sunny Chinese high school campus in summer, female student in uniform',
      'shy smile under warm sunlight, nostalgic youth atmosphere',
      'bullied student curled up in empty stairwell, handheld camera',
      'shallow depth of field, golden hour, pastel palette',
    ],
    applies_to: ['screenwriter', 'director', 'atmosphere'],
    source: '中国校园青春剧 2015-2025 头部作品分析',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_drama_v3_workplace',
    collection: 'drama',
    subcategory: '职场文',
    title: '职场精英剧（金融 / 律政 / 医疗 / 科技 / 广告五大行业）',
    summary: '职场剧 = 行业专业度 + 权谋斗争 + 感情纠葛 + 人物成长。行业的真实感决定成败。',
    content: `职场剧 2015-2025 的演变：从《杜拉拉升职记》到《三十而已》到《狂飙》。

**五大职场子类型**

**#1 金融圈**（《大时代》《华尔街》《投资疑云》）
- 场景：交易所 / 玻璃办公楼 / 高层会议室
- 服装：深色西装 + 领带 + 高级手表
- 冲突：收购 / 对冲 / 操纵 / 黑幕
- 节奏：快 + 数据密集
- 视觉：冷蓝 + 金色 + 多屏幕特写

**#2 律政圈**（《精英律师》《Law & Order》《Suits》）
- 场景：法庭 / 律所会议室 / 当事人家
- 服装：西装 + 律师袍
- 冲突：法律对决 / 证据 / 辩护
- 节奏：对话密集 + 长镜头
- 视觉：法庭正襟危坐 / 律所玻璃隔断

**#3 医疗圈**（《豪斯医生》《Grey's Anatomy》《急诊室的故事》《心术》）
- 场景：急诊室 / 手术室 / 病房
- 服装：白大褂 + 手术服
- 冲突：生死抢救 / 医患矛盾 / 医院权力
- 节奏：紧张 + 温情
- 视觉：无影灯 / 监护仪 / 绿色手术服

**#4 科技创业**（《硅谷》《WeCrashed》《初创玩家》）
- 场景：共享办公 / 白板间 / 车库 / 咖啡馆
- 服装：T 恤 + 帽衫 + 运动鞋
- 冲突：投资 / 估值 / 创始人矛盾 / 市场
- 节奏：快 + 信息密集
- 视觉：极简北欧风 + 蓝白 + 代码屏幕

**#5 广告 / 创意**（《广告狂人 Mad Men》《第三情》）
- 场景：创意公司 / 提案室 / 酒会
- 服装：时尚 + 个性穿搭
- 冲突：创意撕裂 / 客户压力 / 同行竞争
- 节奏：灵感闪现 + 熬夜场
- 视觉：花哨的办公室 + 大量白板 + 咖啡杯

**职场剧通用 7 大场景**

1. **新人入职**（紧张 + 迷茫）
2. **被老员工刁难**
3. **首次立功**（加班 / 灵感突破）
4. **面对甲方**（提案 / 谈判）
5. **办公室政治**（站队 / 排挤）
6. **感情线**（上司 or 同事 or 对手）
7. **大危机**（项目失败 / 辞职 / 跳槽）

**职场剧的 5 层冲突**

- **任务冲突**：能否完成工作
- **人际冲突**：与同事 / 领导 / 下属
- **家庭冲突**：工作 vs 家庭
- **价值冲突**：理想 vs 现实
- **行业冲突**：整个行业的大趋势

**职场剧 Prompt 模板 - 金融**
\`\`\`
sleek Hong Kong financial district trading floor,
young analyst in tailored suit staring at multiple monitors,
stock charts glowing, tension on face,
cool blue corporate palette, floor-to-ceiling windows,
city skyline visible, cinematic close-up,
"Billions" meets "Big Short" aesthetic
\`\`\`

**职场剧 Prompt 模板 - 医疗**
\`\`\`
tense hospital operating room, surgeons in green scrubs,
bright overhead surgical lights, medical instruments gleaming,
focused eyes above masks, heart monitor beeping,
intense atmospheric lighting,
"Grey's Anatomy" cinematography, cinematic wide to close-up
\`\`\`

**职场剧禁忌**
- 不要行业细节错（会被行业内人嘲笑）
- 不要全是恋爱（失去行业感）
- 不要反派太脸谱化
- 不要主角无能就成功`,
    tags: ['职场', '金融', '律政', '医疗', '创业'],
    keywords: ['workplace drama', 'finance', 'legal', 'medical', 'startup', 'mad men', 'suits', 'billions'],
    prompt_snippets: [
      'sleek financial district trading floor with multiple monitors',
      'hospital operating room, surgeons in green scrubs, bright lights',
      'startup co-working space with whiteboards and sticky notes',
      'law firm glass conference room, depositions and legal documents',
    ],
    applies_to: ['screenwriter', 'director', 'atmosphere'],
    source: '中外职场剧 2000-2025 头部作品行业分析',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_drama_v3_baby_fluff',
    collection: 'drama',
    subcategory: '爆款公式',
    title: '萌宝/亲子文公式（隐藏身孕 + 萌娃认亲 + 甜宠进阶）',
    summary: '萌宝文 = 意外怀孕 + 孩子长大 + 霸总偶遇 + 认亲揭露 + 家庭复合。2024 短剧最强赛道之一。',
    content: `萌宝文是 2023-2025 爆款赛道，融合了甜宠 + 复仇 + 温情多个元素。

**标准情节结构**

**Part 1: 前世伏笔 (第 1-5 集)**
- 女主与霸总男主有一夜情 or 真爱
- 因误会 / 家族反对 / 第三者介入分开
- 女主发现怀孕

**Part 2: 独自生产 (第 6-10 集)**
- 女主隐瞒身孕
- 独自面对生产 (通常雨夜 + 抱着孩子)
- 5 年后时间跳跃

**Part 3: 母子日常 (第 11-15 集)**
- 女主成为单亲妈妈 (通常自主创业成功)
- 萌娃 4-5 岁，天真可爱 + 有主角光环
- 萌娃有爸爸的特征 (眼睛 / 酒窝 / 发色)

**Part 4: 再次相遇 (第 16-20 集)**
- 男主在某个场合偶遇女主 + 孩子
- 男主注意到孩子与自己相似
- 疑惑但不敢问

**Part 5: 萌娃认亲 (第 21-30 集)**
- 萌娃主动接近男主 ("叔叔你真帅" / "你像我画的爸爸")
- DNA 鉴定 or 意外暴露真相
- 男主震惊 → 愤怒 → 心痛

**Part 6: 男主追妻 (第 31-40 集)**
- 男主疯狂追求女主
- 女主冷淡 / 拒绝
- 用萌娃当"桥梁"

**Part 7: 前任反派 (第 41-50 集)**
- 前第三者 / 白月光出现阻挠
- 试图伤害萌娃
- 被男主果断制止

**Part 8: 家族阻碍 (第 51-60 集)**
- 男主家族不接受女主和萌娃
- 考验期 / 羞辱
- 女主赢得家族认可

**Part 9: 大团圆 (第 61-80 集)**
- 婚礼
- 二胎 / 领证
- 家庭日常甜蜜结局

**萌宝必备萌点**

1. **神同款外貌**：萌娃和男主如出一辙 (所有人都看出来)
2. **熟练的称呼**：萌娃第一次见男主就喊"爸爸"
3. **童言童语**：说出让大人心碎的话 ("妈妈说爸爸不要我们了")
4. **保护妈妈**：萌娃挡在女主前面说"不许欺负我妈妈"
5. **机智反杀**：萌娃用童稚方式戳穿反派
6. **可爱崩溃**：萌娃哭的时候特写
7. **讨好爷爷奶奶**：萌娃主动讨好长辈
8. **识破真爱**：萌娃认可爸爸的伴侣

**萌宝剧 Prompt 模板**
\`\`\`
adorable 5 year old Asian boy hugging his mother's legs,
looking up with big innocent eyes,
both wearing matching warm tones, tender mother-son moment,
soft golden afternoon light, shallow depth of field,
emotional close-up, Chinese short drama aesthetic,
warm heartwarming atmosphere
\`\`\`

**萌宝剧禁忌**
- 萌娃不要过度早熟（违和）
- 不要萌娃哭戏太多（观众疲劳）
- 不要男主永远找不到（要有"靠近"的节奏）
- 不要女主一直苦情（要有反击）`,
    tags: ['萌宝', '亲子', '甜宠', '霸总'],
    keywords: ['cute baby', 'secret pregnancy', 'single mother', 'hidden child', 'ceo father', 'reunion drama'],
    prompt_snippets: [
      'adorable 5 year old Asian boy hugging his mother protectively',
      'rainy night pregnant woman holding a small bag, fleeing',
      'ceo looking at young boy who resembles him, shocked realization',
      'family reunion at luxurious mansion, warm emotional atmosphere',
    ],
    applies_to: ['screenwriter', 'director'],
    source: '2023-2025 中国萌宝题材短剧头部作品结构分析',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_drama_v3_isekai',
    collection: 'drama',
    subcategory: '穿越文',
    title: '日系异世界 (Isekai) 穿越公式',
    summary: '日系异世界 = 现代 otaku 转生到魔法世界 + 游戏系统 + 后宫 + 魔王勇者。《Re:Zero》《Overlord》《Mushoku Tensei》等。',
    content: `Isekai（异世界）是日本近 10 年最火的类型，已深度影响中国 AI 漫剧。

**经典套路**

**触发方式**（各有经典场景）
- **卡车之神**：过马路被卡车撞死（《No Game No Life》）
- **猝死键盘前**：熬夜打游戏去世
- **隧道穿越**：进入神秘隧道（《千与千寻》《你的名字》）
- **召唤仪式**：被王国勇者召唤（《Re:Zero》）
- **游戏变现实**：沉迷游戏后世界变成游戏（《Overlord》《Sword Art Online》）

**到达异世界后**
- 保留现代记忆
- 可能降级成婴儿 / 幼儿（《Mushoku Tensei》）
- 可能有独特技能（修理技能变万能）
- 可能是魔王 / 勇者 / 转生魔物

**异世界 6 大必备设定**

1. **魔法体系**
- 属性（火水风土光暗）
- 等级（见习 / 中级 / 高级 / 大魔导师）
- 咏唱（唱魔法名才能发动）

2. **冒险者公会**
- 发任务
- 分等级（F-SSS）
- 聚集异能者

3. **种族**
- 人类 / 精灵 / 矮人 / 兽人 / 龙 / 魔族
- 跨种族恋爱常见
- 种族歧视作为社会议题

4. **王国 / 帝国政治**
- 多个王国
- 公主 / 贵族 / 骑士
- 战争与和平

5. **魔王 / 勇者**
- 勇者被召唤对抗魔王
- 主角往往不是被召唤的勇者
- 真相往往：魔王才是好人

6. **后宫**
- 女主多人围绕
- 精灵 / 兽娘 / 魔法师 / 圣女 / 冒险者
- 男主通常"稳定"不选边

**Isekai 5 种主流叙事**

- **游戏化**：有 HP/MP/EXP/技能树（《SAO》《盾之勇者》）
- **转生婴儿化**：重活一遍（《Mushoku Tensei》《No Game No Life》）
- **能力作弊化**：主角一开始就无敌（《Overlord》《Slime》）
- **反复死亡化**：死后时间回溯（《Re:Zero》）
- **日常系**：异世界经营（《Restaurant to Another World》）

**Isekai Prompt 模板**
\`\`\`
Japanese isekai anime style, young hero in medieval fantasy armor,
floating game-style HP/MP status window next to him,
magical forest with glowing mushrooms and crystal lights,
dragon soaring in background, adventure party of diverse races,
cel shading, vibrant fantasy colors,
"Mushoku Tensei" meets "Overlord" aesthetic,
cinematic wide shot, epic fantasy adventure
\`\`\`

**Isekai 的本地化建议**

- 中国观众接受度高
- 要保留游戏化元素（观众期待）
- 主角不要太弱（要有金手指）
- 异世界要有"东方元素"可选（仙侠 Isekai）`,
    tags: ['isekai', '异世界', '日系', '穿越'],
    keywords: ['isekai', 'another world', 'transmigration anime', 'rezero', 'overlord', 'mushoku tensei', 'sword art online'],
    prompt_snippets: [
      'Japanese isekai anime style, hero in medieval fantasy armor',
      'floating game-style HP/MP status window next to character',
      'magical forest with glowing mushrooms and crystal lights',
      'dragon in background, diverse adventure party, cel shading',
    ],
    applies_to: ['screenwriter', 'director', 'atmosphere'],
    source: '日系异世界动漫 / 轻小说 2010-2025 头部作品分析',
    lang: 'zh-en',
    enabled: true,
  },
  {
    id: 'kb_drama_v3_urban_power',
    collection: 'drama',
    subcategory: '男频文',
    title: '都市异能/天眼/赌石/鉴宝文（男频都市异能公式）',
    summary: '都市异能 = 都市背景 + 特殊能力 + 暴富 / 追美 / 打脸。天眼赌石 / 透视 / 鉴宝是经典套路。',
    content: `都市异能是男频都市的分支，2018-2025 在短剧中极火爆。

**5 种经典异能类型**

**#1 天眼 / 透视**
- 能看到物品本质 / 内部结构
- 经典场景：赌石 / 古玩市场 / 赌博
- 代表套路：主角用透视一眼看出赝品 / 玉石中的翡翠
- 金手指：鉴定 / 检测 / 预知

**#2 鉴宝 / 古玩**
- 祖传鉴宝能力或系统
- 场景：古玩店 / 拍卖会 / 鉴宝节目
- 套路：主角发现没人识别的宝贝 + 一夜暴富
- 道具：古玩 / 瓷器 / 字画 / 玉器

**#3 医术异能**
- 神医能治所有绝症
- 场景：医院 / 富豪家 / 诊所
- 套路：西医束手 → 主角一针搞定
- 金手指：祖传 / 系统 / 空间戒指

**#4 预知未来**
- 能看到未来片段
- 场景：股市 / 赌场 / 竞赛
- 套路：前世记忆 / 系统提示 / 占卜
- 金手指：时间差套利

**#5 空间 / 储物**
- 拥有私人空间 / 储物戒指
- 场景：超市 / 市场 / 战场
- 套路：空间囤货 / 空间种植 / 救人
- 金手指：无限储存 + 时间静止

**都市异能标准情节**

**Part 1: 觉醒 (第 1-3 集)**
- 主角是废物 / 普通人
- 意外获得能力（祖传 / 雷劈 / 系统 / 古物）
- 不信 → 测试 → 确认

**Part 2: 初试牛刀 (第 4-10 集)**
- 用能力解决小问题（治病 / 找东西 / 鉴定）
- 获得第一桶金
- 周围人开始注意到

**Part 3: 打脸日常 (第 11-30 集)**
- 各种看不起主角的人被打脸
- 每 2-3 集一个反派
- 每次都用能力碾压

**Part 4: 扩大格局 (第 31-50 集)**
- 从小打小闹到商业帝国
- 引来家族 / 势力 / 国外组织
- 能力升级

**Part 5: 情感收获 (第 51-80 集)**
- 各种美女主动靠近
- 建立后宫或一生一世
- 家庭团圆 / 事业巅峰

**都市异能的视觉锚点**

- **能力触发**：眼睛变色 / 手心发光 / 空间扭曲
- **发现宝物**：特写物品 → 主角眼神变化 → UI 显示价值
- **打脸时刻**：反派嚣张 → 主角一招 → 反派崩溃
- **展示能力**：慢动作 + 特效 + 旁人惊恐

**Prompt 模板**
\`\`\`
urban fantasy protagonist in modern Chinese city,
eyes glowing subtly, supernatural ability activating,
holding ancient artifact with X-ray vision effect revealing internal structure,
jade stone glowing from within, antique market background,
casual modern clothes with one unique accessory,
"cheat" power fantasy aesthetic,
cinematic medium shot, dramatic lighting
\`\`\`

**都市异能禁忌**
- 不要能力太夸张（失去都市感）
- 不要主角傻白甜（要有城府）
- 不要反派太强（失去爽感）
- 不要滥用能力（要有限制）`,
    tags: ['都市异能', '天眼', '鉴宝', '透视'],
    keywords: ['urban fantasy', 'x-ray vision', 'jade gambling', 'antique appraisal', 'modern cultivation', 'cheat ability'],
    prompt_snippets: [
      'protagonist with glowing eyes activating supernatural ability',
      'holding jade stone with internal glow effect, antique market',
      'ancient artifact with x-ray vision revealing internal treasures',
      'urban modern Chinese setting with supernatural element',
    ],
    applies_to: ['screenwriter', 'director'],
    source: '中国都市异能男频文 2018-2025 头部作品分析',
    lang: 'zh',
    enabled: true,
  },
];
