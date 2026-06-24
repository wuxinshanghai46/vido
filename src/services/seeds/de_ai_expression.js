/**
 * De-AI expression rules distilled from lijigang/ljg-skills md branch.
 *
 * Source used as reference only:
 * https://github.com/lijigang/ljg-skills
 *
 * These docs are intentionally principles, not fixed output text. They should
 * affect user-visible wording and creative prompts, not JSON schemas, API
 * parameters, or model routing.
 */

module.exports = [
  {
    id: 'kb_de_ai_expression_plain_language_20260624',
    collection: 'production',
    subcategory: '去 AI 化表达',
    title: '用户可见文本的去 AI 化表达纪律',
    summary: '把 AI 生成的剧本、小说、口播、广告文案和说明文字改成像真人会说的话：口语、具体、诚实、少套话。',
    content: `这条知识只约束用户会读到的自然语言，不改变 JSON 字段、代码、接口参数或模型配置。

核心检验：
- 口语检验：读出声来，如果不像在跟一个聪明朋友说话，就重写。
- 一句一事：一句话只推进一个意思，长句拆短。
- 具体优先：名词要看得见，动词要有动作；少用空泛形容词。
- 开头给理由：第一句直接让人知道为什么要看，不铺垫。
- 不填充：删掉开场白、拐杖词、夸大象征和机械连接词。
- 诚实：不编经历，不替群体发言，不确定就说不确定。

需要删除或改写的常见 AI 痕迹：
- “值得注意的是”“此外”“总而言之”“深入一层”“最深的一层是”等元评论。
- “充满活力”“具有重要意义”“打造沉浸式体验”“赋能未来”等宣传腔。
- 为了显得全面而罗列，导致每一点都很浅。
- 听起来像金句但没有信息量的句子。

写作方式：
- 心里放一个具体的人，写给他，不写给“广大用户”。
- 能用日常话说清的，不用术语；术语必须出现时，先用白话解释。
- 场景能说明问题时，用场景，不用抽象判断。
- 同一种句式不要反复出现，避免机器感。`,
    tags: ['去AI化', '自然语言', '文案', '剧本', '小说', '口播'],
    keywords: ['de-ai', 'plain language', 'human voice', 'copywriting', 'screenplay', 'novel writing', 'anti ai tone'],
    prompt_snippets: [
      '只对用户可见文本应用去 AI 化表达纪律；不得改动 JSON 字段、接口参数、模型配置或必填结构。',
      '输出前做口语检验：不像真人对聪明朋友说的话就重写。',
      '删除机械连接词、元评论、宣传腔和空泛形容词；每句都要推进具体信息。',
      '不要编造经历、数据或群体共识；不确定就明确写不确定。',
    ],
    applies_to: ['screenwriter', 'copywriter', 'editor', 'localizer', 'digital_human', 'prompt_engineer'],
    source: 'Adapted from lijigang/ljg-skills md branch (ljg-plain, ljg-writes), project-owned KB seed.',
    lang: 'zh-CN',
    enabled: true,
  },
  {
    id: 'kb_de_ai_expression_visual_prompt_20260624',
    collection: 'production',
    subcategory: '去 AI 化表达',
    title: '人物、分镜和视频提示词的去 AI 化视觉约束',
    summary: '给人物、分镜、视频和广告画面提示词加“真实、具体、可拍”的约束，减少塑料 AI 脸、泛化场景和宣传片模板感。',
    content: `这条知识用于人物设定、分镜、视频提示词和画面质检的用户可见描述。它不是固定模板，必须随剧情、行业、人物身份、年龄、地域和参考素材变化。

人物提示词：
- 人物描述要服务剧情，不预设固定性别、年龄、职业或种族。
- 外貌、服装、发型、气质必须来自当前广告需求、人物设定、上传参考或演员库信息。
- 避免“精致 AI 脸”“过度磨皮”“夸张舞台妆”“无关职业制服”。
- 服装约束要具体但可执行：上衣、下装/裙装、鞋、颜色、材质、配饰分别说明。

场景和分镜提示词：
- 把镜头落到可拍场景：地点、光线、人物动作、商品证据、环境细节要一致。
- 不用空泛词堆质感；每个风格词都要能转成画面。
- 不把广告需求写成纯 UI 海报、纯 3D CG 或没有生活痕迹的样板间，除非用户明确要求。
- 商品入镜要符合当前控制项：出现频率、锁定强度、展示方式和禁止项。

输出检查：
- 当前剧情换了，人物和画面描述也必须随之变化。
- 如果用户填写了穿着、外貌、发型或禁止项，后续人物包和分镜都必须尊重这些约束。
- 不把“自然真实”写死成某一套脸、衣服或场景。`,
    tags: ['去AI化', '人物一致性', '分镜', '视频提示词', '广告画面'],
    keywords: ['de-ai visual prompt', 'realistic actor', 'storyboard prompt', 'video prompt', 'character consistency', 'anti plastic ai face'],
    prompt_snippets: [
      '人物与画面必须从当前剧情、广告需求、参考图和用户填写字段推导，不能套固定性别、年龄、职业、服装或场景。',
      '把抽象风格改成可拍细节：地点、光线、动作、商品证据、服装材质、环境物件。',
      '避免塑料 AI 脸、过度磨皮、夸张表情、无关职业制服、纯 UI 海报或无生活痕迹样板场景。',
      '用户填写的外貌、穿着、发型和禁止项是硬约束，后续人物包、分镜和质检都要继承。',
    ],
    applies_to: ['prompt_engineer', 'character_consistency', 'digital_human', 'director', 'storyboard', 'art_director', 'atmosphere', 'screenwriter'],
    source: 'Adapted from lijigang/ljg-skills md branch (ljg-plain, ljg-writes), project-owned KB seed.',
    lang: 'zh-CN',
    enabled: true,
  },
];
