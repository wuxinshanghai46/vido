/**
 * Project-owned workflow methods adapted from external/ljg-skills-md.
 *
 * These entries are method knowledge only. They must not call external skill
 * code, change model routing, replace existing flows, or invent fixed content.
 */

module.exports = [
  {
    id: 'kb_ljg_video_roundtable_qa_20260624',
    collection: 'production',
    subcategory: 'ljg_workflow_video',
    title: '视频脚本的圆桌质询与 QA 自检方法',
    summary: '把 ljg-roundtable 与 ljg-qa 的方法转成视频脚本自检：生成剧本后、生成分镜前，围绕卖点、用户动机、镜头可拍性和信息密度做质询。',
    content: `适用位置：剧情广告、数字人视频、漫剧和短视频脚本已经生成后，进入分镜前。

使用原则：
- 不新增独立流程，不替换现有剧本生成；只作为脚本审查方法注入给编剧、导演、分镜和文案 agent。
- 先问清楚这条视频到底要解决什么问题、让观众相信什么、最后做什么动作。
- 每个镜头必须回答一个具体问题：为什么现在看、画面里发生什么、演员在做什么、商品或服务证据在哪里。
- 卖点辩论只允许来自用户需求、已确认素材、剧本和知识库，不得搬运历史行业模板。
- QA 结论必须可执行：保留、改写、删除、补镜头或补证据；不要只写“增强感染力”。

检查清单：
1. 卖点是否落在用户真实需求上，而不是空泛宣传。
2. 剧本是否有起承转合、冲突或信息推进，不是旁白堆砌。
3. 镜头是否可拍：地点、人物动作、商品证据、声音或字幕都有明确对象。
4. 如果有人物，人物身份、服装、发型、年龄、地域和禁止项必须继承当前人物设定。
5. 每个镜头进入分镜前都要有一句“为什么这一镜必须存在”的理由。`,
    tags: ['ljg-roundtable', 'ljg-qa', '视频脚本', '分镜前自检', '卖点辩论'],
    keywords: ['roundtable', 'qa', 'script review', 'storyboard preflight', 'video agent'],
    prompt_snippets: [
      '在生成分镜前，用圆桌质询方式检查剧本：卖点、观众动机、镜头可拍性、商品证据和人物一致性。',
      '每条 QA 必须给出可执行动作：保留、改写、删除、补镜头、补证据。',
      '不要把 ljg 方法变成新流程或固定模板，只作为现有 agent 的审稿方法。',
    ],
    applies_to: ['screenwriter', 'director', 'storyboard', 'copywriter', 'digital_human', 'prompt_engineer'],
    source: 'Adapted from external/ljg-skills-md: ljg-roundtable, ljg-qa.',
    lang: 'zh-CN',
    enabled: true,
  },
  {
    id: 'kb_ljg_novel_relationship_writing_qa_20260624',
    collection: 'drama',
    subcategory: 'ljg_workflow_novel',
    title: '小说人物关系、章节写作与 QA 方法',
    summary: '把 ljg-relationship、ljg-writes、ljg-qa 转成小说创作检查：人设、大纲、章节正文生成后，检查关系张力、因果链和章节质量。',
    content: `适用位置：AI 小说的人设、人物关系图、大纲、章节正文生成或改写之后。

使用原则：
- 不替换现有小说生成链路；只给小说 agent 增加关系诊断和章节质量审查方法。
- 人物关系不是卡片列表，而是欲望、秘密、误会、利益、亏欠、权力和情感变化的结构。
- 每章必须有选择、阻力、代价、信息变化或关系变化，不能只是事件流水账。
- QA 问题要尖锐具体：这一章谁想要什么、谁阻止、代价是什么、结尾留下什么新问题。
- 不允许为了补齐关系而编造用户没有给出的背景；缺口要记录为缺口，再由后续模型或用户补充。

检查清单：
1. 人物有没有欲望和边界，还是只有标签。
2. 关系线有没有变化，还是一直停在“朋友/敌人/恋人”的静态描述。
3. 大纲章节之间有没有因果链。
4. 正文有没有现场感、对白潜台词和动作推进。
5. 章节结尾有没有具体悬念、代价或关系反转。`,
    tags: ['ljg-relationship', 'ljg-writes', 'ljg-qa', 'AI小说', '人物关系', '章节质量'],
    keywords: ['novel relationship', 'chapter qa', 'writing engine', 'relationship graph'],
    prompt_snippets: [
      '用人物关系诊断检查：欲望、秘密、误会、利益、亏欠、权力和情感变化。',
      '章节 QA 必须问：谁想要什么、谁阻止、付出什么代价、信息或关系发生什么变化。',
      '不能为补齐关系而写死设定；缺失信息要作为缺口记录。',
    ],
    applies_to: ['screenwriter', 'editor', 'prompt_engineer', 'character_consistency'],
    source: 'Adapted from external/ljg-skills-md: ljg-relationship, ljg-writes, ljg-qa.',
    lang: 'zh-CN',
    enabled: true,
  },
  {
    id: 'kb_ljg_image_card_present_20260624',
    collection: 'production',
    subcategory: 'ljg_workflow_image_card',
    title: '图文卡片、海报、长图和信息图生成方法',
    summary: '把 ljg-card 与 ljg-present 的方法接入为图文视觉产出知识：适合宣传卡、信息图、长图和演示页，不替代真人演员包或分镜关键帧模型。',
    content: `适用位置：用户明确要图文卡片、海报、长图、信息图、演示页、知识卡片或社媒图时。

边界：
- 不用于替代真人演员包、商品图、分镜关键帧或图生视频模型。
- 不自动插入现有剧情广告链路；只有当任务目标是图文视觉物料时使用。
- 输出应先确定信息层级，再做视觉布局，避免只做漂亮背景。

方法：
1. 先把内容压成一个主标题、三个以内核心信息块和一个明确行动或结论。
2. 选择形式：海报、长图、信息图、白板、演示页或大字页。
3. 每张图只服务一个传播目的：解释、对比、总结、发布、引导或展示。
4. 文案必须短、具体、可读；不要把完整文章硬塞进一张图。
5. 视觉要匹配业务场景：SaaS/CRM/运营工具保持克制清晰，内容宣传可以更强视觉冲击。`,
    tags: ['ljg-card', 'ljg-present', '图片卡片', '海报', '长图', '信息图'],
    keywords: ['visual card', 'poster', 'infographic', 'presentation', 'social image'],
    prompt_snippets: [
      '当用户要图文卡片、海报、长图或信息图时，先确定信息层级，再生成视觉方案。',
      '不要用 ljg-card 替代演员包、商品图、分镜关键帧或图生视频模型。',
      '每张图只解决一个传播目的，文字短、具体、可读。',
    ],
    applies_to: ['art_director', 'copywriter', 'prompt_engineer', 'digital_human'],
    source: 'Adapted from external/ljg-skills-md: ljg-card, ljg-present.',
    lang: 'zh-CN',
    enabled: true,
  },
];
