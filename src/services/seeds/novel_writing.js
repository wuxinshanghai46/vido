/**
 * AI novel writing craft seed.
 * Original synthesis from public writing-craft material and user feedback.
 * Keep this as method knowledge, not copied novel text.
 */

module.exports = [
  {
    id: 'kb_novel_anti_ai_prose_scene_dialogue_20260621',
    collection: 'drama',
    subcategory: 'novel_writing',
    title: 'AI小说去AI味：场景化、对白潜台词、人物动作与网文追读力',
    summary: '章节正文必须像小说现场，而不是剧情报告。用场景目标、阻力、动作、对白潜台词、感官锚点和代价推进情节，减少总结腔和泛化心理描写。',
    content: `写作目标：
1. 让正文读起来像人在现场经历，而不是助理在解释剧情。
2. 每段至少承担一个功能：揭示人物、增加压力、推进空间动作、暴露线索、制造关系张力、设置或回收钩子。
3. 开场从麻烦、决定、发现、对峙、不安进入，不用背景说明慢慢铺。

去AI味禁忌：
- 少用“然后、接着、开始、意识到、心中一震、气氛变得紧张、他感到一阵、仿佛一切都改变了”等总结腔。
- 不用空泛心理标签代替戏：不要只说害怕、震惊、愤怒，要写身体反应、动作停顿、误导性回答、物件细节、关系变化。
- 不堆形容词，不写万能金句，不写像总结报告一样的转场。
- 不让人物用对白解释彼此都知道的信息。

场景化方法：
- 把大纲事件翻译成“谁想要什么、谁阻挡、空间里发生什么、什么物件被触碰或改变、主角做出什么选择、付出什么代价”。
- 细节只选 2-4 个，与情绪和剧情压力绑定，例如气味、手感、声音、光线、某件物品的位置变化。
- 用深 POV：描写必须经过视角人物的恐惧、欲望、偏见、记忆和身体状态过滤。

对白方法：
- 每句对白都要有目的：试探、威胁、回避、谈判、撒谎、套话、确认关系、压低对方地位。
- 让人物说话有差异：词汇、停顿、反问、短句/长句、沉默、绕开重点。
- 对白后必须改变信息、权力、情绪或信任，不能只是寒暄或解释设定。

网文节奏：
- 危险、冲突、发现用短句和短段；压迫、观察、暧昧、迟疑可以用稍长句。
- 章尾留下具体的新问题、代价、威胁或关系变化，而不是抽象“危机才刚刚开始”。
- 爽点/悬疑/情感都必须落在人物选择和后果上，不要只喊口号。`,
    tags: ['AI小说', '去AI味', '网文', '对白', '人物描写', '场景化', '章节写作'],
    keywords: [
      'anti ai prose',
      'novel writing',
      'scene writing',
      'dialogue subtext',
      'character voice',
      'deep pov',
      'sensory detail',
      'web novel pacing',
      'summary-like prose',
      'plastic dialogue'
    ],
    prompt_snippets: [
      'Write the scene as lived experience, not as a plot report.',
      'Convert each outline beat into visible action, resistance, dialogue subtext, sensory detail, and consequence.',
      'Every line of dialogue must change power, emotion, information, trust, or concealment.',
      'Replace generic emotion labels with body reaction, gesture, silence, object detail, or conflict action.',
      'Before output, remove assistant-like explanation, summary-chain prose, fake profundity, and decorative adjective stacking.'
    ],
    applies_to: ['screenwriter', 'editor', 'prompt_engineer'],
    source: 'Public writing craft synthesis: scene writing, show-dont-tell, dialogue subtext, character voice, web-novel pacing; Codex session user feedback 2026-06-21.',
    lang: 'zh',
    enabled: true
  }
];
