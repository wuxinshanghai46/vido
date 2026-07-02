/**
 * 剧情广告行业知识 seed。
 *
 * 中文注释：这些条目只提供行业边界、证据类型和禁止漂移，不提供固定剧情模板。
 * 新行业可以继续按同一 schema 追加，不需要改生成链路。
 */
module.exports = [
  {
    id: 'kb_luxury_ad_industry_contract_method_20260702',
    collection: 'production',
    industry_ids: ['all'],
    subcategory: '剧情广告行业合同',
    title: '剧情广告行业合同写法：边界、证据、禁区',
    summary: '行业知识只能帮助消歧，不能替代客户 brief。每条合同必须包含行业边界、可见证据、禁止漂移和 QA 门槛。',
    content: `行业合同不是模板库，不允许把客户需求改成固定行业场景。

合同必须回答四个问题：
1. 行业边界：本次客户选择或系统推断的行业是什么，细分行业是什么。
2. 主体证据：画面里哪些可见元素能证明广告主体属于该行业。
3. 禁止漂移：哪些默认场景、道具、角色、UI、货架、仓库、厨房、展厅、办公室不能被模型擅自引入。
4. QA 门槛：如果画面行业、主体证据或用户禁止项不匹配，应直接失败并返回真实原因。

生成规则：
- 剧情先服从客户 brief，再用行业合同消除歧义。
- 行业合同只约束边界，不给模型补写固定镜头。
- 同一份合同必须贯穿剧情、分镜、图片提示词、QA 和项目恢复。
- 客户补充说明优先于通用行业知识，客户禁止项必须进入 hard negative。`,
    tags: ['剧情广告', '行业合同', '提示词', 'QA', '不兜底'],
    keywords: ['industry contract', '广告行业', '主体证据', '禁止漂移', 'QA', '客户brief'],
    prompt_snippets: [
      'Use industry knowledge only as boundary and evidence; do not convert it into a fixed scene template.',
      'Reject if the generated image changes the selected industry, evidence carrier, or customer forbidden items.',
      'Customer brief first; industry contract second; generic industry defaults never override the brief.',
    ],
    applies_to: ['screenwriter', 'director', 'storyboard', 'prompt_engineer', 'art_director'],
    source: 'VIDO local product rule, 2026-07-02',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_luxury_ad_industry_materials_vs_kitchen_20260702',
    collection: 'production',
    industry_ids: ['building_materials', 'home_living', 'real_estate'],
    subcategory: '建材与材料行业',
    title: '不锈钢/金属材料广告：建材材料与厨房厨具消歧',
    summary: '不锈钢、钢材、金属板材如果客户指向建筑装饰材料，画面证据应是样板、墙板、立面、材质纹理和设计应用，而不是锅具、水槽或厨房。',
    content: `适用于建材、建筑装饰、金属材料、墙板、幕墙、外立面、样板墙等需求。

可见证据：
- 样板墙、材料展板、板材边缘、拉丝/蚀刻/镜面/高档金属纹理。
- 墙面、立面、护墙板、商业空间装饰或设计咨询场景。
- 设计师/客户可以出现，但必须围绕材料证据互动，不要变成泛导购。

禁止漂移：
- 不要把不锈钢材料变成锅具、水槽、水龙头、厨房台面或餐饮后厨。
- 不要把材料广告变成普通仓库钢卷、工厂原料堆放，除非客户明确要求制造/仓储。
- 不要用无关奢侈品、化妆品、手机或 UI 替代材料主体。

QA：
主画面必须证明“这是建筑/装饰/材料用途”。如果主体证据变成厨房厨具或消费品，应失败。`,
    tags: ['建材', '不锈钢', '金属材料', '行业消歧', '剧情广告'],
    keywords: ['不锈钢', '钢材', '金属板材', '建材', '材料展厅', '样板墙', '厨房', '厨具', '水槽'],
    prompt_snippets: [
      'architectural material evidence: sample wall, metal panels, brushed stainless texture, facade cladding, interior wall application',
      'hard negative: kitchen sink, cookware, pot, pan, faucet, restaurant kitchen unless explicitly requested',
    ],
    applies_to: ['screenwriter', 'director', 'storyboard', 'prompt_engineer', 'art_director'],
    source: 'VIDO local troubleshooting: steel material drift, 2026-07-02',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_luxury_ad_industry_software_ai_workflow_20260702',
    collection: 'production',
    industry_ids: ['digital_software', 'ai_technology'],
    subcategory: '软件与AI行业',
    title: '软件/SaaS/AI 广告：真实工作流证据优先，禁止假 UI 堆砌',
    summary: '软件、AI、SaaS 和智能产品广告要拍真实使用者、任务、结果和业务流程，不能只生成抽象 dashboard、代码屏或科幻实验室。',
    content: `适用于软件、SaaS、App、AI 产品、智能硬件、云服务、开发者工具等需求。

可见证据：
- 用户角色正在完成任务：创作、审核、客服、运营、财务、设计、研发、生产调度等。
- 界面只能作为使用证据，不是装饰。需要写清载体、任务、输入、结果和前后变化。
- AI 产品要体现结果状态、自动化前后对比、人机协作或真实应用场景。

禁止漂移：
- 不要默认写代码屏、炫光仪表盘、悬浮 UI、通用办公室、科幻实验室。
- 不要把 AI 自动改成机器人、扫地机、智能家居或手机 App，除非客户明确要求。
- 不要让假可读文字成为主体证据。

QA：
如果只有漂亮 UI 但没有业务任务、用户动作或结果证明，应判定为弱匹配。`,
    tags: ['软件', 'SaaS', 'AI', '工作流', 'UI QA'],
    keywords: ['软件', 'SaaS', 'App', 'AI', '人工智能', '工作流', 'dashboard', 'UI', '机器人'],
    prompt_snippets: [
      'real workflow evidence: user role, task input, interface moment, result state, before-after business proof',
      'hard negative: generic dashboard, floating UI decoration, sci-fi lab, unrelated robot, fake readable text',
    ],
    applies_to: ['screenwriter', 'director', 'storyboard', 'prompt_engineer', 'art_director'],
    source: 'VIDO local industry prompt rule, 2026-07-02',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_luxury_ad_industry_commerce_finance_logistics_20260702',
    collection: 'production',
    industry_ids: ['ecommerce_retail', 'finance', 'logistics'],
    subcategory: '电商金融物流行业',
    title: '电商/金融/物流广告：行业证据与合规禁区',
    summary: '电商要有商品与购买触点，金融要有服务和风险边界，物流要有货物与流程节点；不能互相串行业。',
    content: `电商/零售：
- 证据：真实商品、导购或主播动作、门店/陈列、开箱、购买触点、交付体验。
- 禁止：无商品纯 UI、仓库单据替代所有画面、把商品改成无关行业道具。

金融/保险：
- 证据：客户需求、专业沟通、风险保障、服务流程、家庭或企业决策场景。
- 禁止：承诺收益、夸大财富、股票大屏恐吓、把金融科技写成普通软件 dashboard。

物流/供应链：
- 证据：包裹/货物、扫码、分拣、车辆、交接、冷链温控、时效节点。
- 禁止：电商直播替代物流、普通办公室替代流程、无货物的抽象系统图。

QA：
必须看到本行业的业务动作和结果证据。如果只出现另一个行业的默认道具，应失败。`,
    tags: ['电商', '金融', '物流', '合规', '剧情广告'],
    keywords: ['电商', '零售', '直播', '金融', '保险', '物流', '供应链', '仓储', '冷链'],
    prompt_snippets: [
      'commerce evidence: real product, shelf/display, unboxing, guide action, purchase touchpoint',
      'finance evidence: customer need, professional consultation, risk boundary, service proof; no guaranteed returns',
      'logistics evidence: parcel, cargo, scan, sorting, vehicle, handoff, cold-chain temperature proof',
    ],
    applies_to: ['screenwriter', 'director', 'storyboard', 'prompt_engineer', 'art_director'],
    source: 'VIDO local industry prompt rule, 2026-07-02',
    lang: 'zh',
    enabled: true,
  },
  {
    id: 'kb_luxury_ad_industry_manufacturing_pet_game_20260702',
    collection: 'production',
    industry_ids: ['industrial_manufacturing', 'pet', 'game_entertainment'],
    subcategory: '制造宠物游戏行业',
    title: '工业制造/宠物/游戏广告：不要被默认真人导购或软件场景污染',
    summary: '工业制造看设备和工艺，宠物看宠物和照护，游戏看玩法和玩家体验；不要强行套真人主持、办公室或货架。',
    content: `工业制造：
- 证据：设备、产线、材料、工艺动作、检测、工程师操作、质量/效率结果。
- 禁止：家居厨房、美妆零售、金融咨询、无关科幻机器人。

宠物：
- 证据：宠物主体、食品/用品、护理动作、宠物店/医疗/服务结果。
- 禁止：把宠物食品拍成人类餐饮，把宠物用品拍成母婴用品或普通家居空镜。

游戏/娱乐：
- 证据：玩法、角色/IP、玩家反应、直播互动、社区氛围、设备或观看触点。
- 禁止：企业软件 dashboard、电商货架、金融大厅、无关办公室模板。

QA：
主体必须是本行业的真实使用/体验证据；如果变成默认真人口播、纯货架或纯办公室，应失败。`,
    tags: ['工业制造', '宠物', '游戏', '行业消歧', '剧情广告'],
    keywords: ['工业制造', '设备', '产线', '宠物', '宠物食品', '宠物用品', '游戏', '手游', '直播娱乐'],
    prompt_snippets: [
      'manufacturing evidence: equipment, production line, engineer action, inspection proof, process result',
      'pet evidence: visible pet, feeding/care action, pet product, service outcome',
      'game evidence: gameplay, character/IP, player reaction, livestream/community interaction',
    ],
    applies_to: ['screenwriter', 'director', 'storyboard', 'prompt_engineer', 'art_director'],
    source: 'VIDO local industry prompt rule, 2026-07-02',
    lang: 'zh',
    enabled: true,
  },
];
