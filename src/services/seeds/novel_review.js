/**
 * Novel review and platform-safety knowledge.
 * Sensitive-word terms here are an initial maintainable seed, not a claim that
 * any specific platform officially published this exact list.
 */

module.exports = [
  {
    id: 'kb_novel_sensitive_terms_seed_20260624',
    collection: 'drama',
    subcategory: 'novel_sensitive_terms',
    title: 'AI小说内容审核基础敏感词库',
    summary: '用于 AI 小说章节的敏感词检测。词条可在知识库继续补充，检测服务会读取 subcategory=novel_sensitive_terms 的启用条目。',
    content: [
      '台独,政治敏感',
      '港独,政治敏感',
      '藏独,政治敏感',
      '法轮功,政治敏感',
      '贩毒,违法犯罪',
      '吸毒,违法犯罪',
      '冰毒,违法犯罪',
      '海洛因,违法犯罪',
      '洗钱,违法犯罪',
      '赌博,违法犯罪',
      '赌球,违法犯罪',
      '卖淫,违法犯罪',
      '嫖娼,违法犯罪',
      '强奸,成人与暴力',
      '轮奸,成人与暴力',
      '乱伦,成人与暴力',
      '幼女,未成年人风险',
      '自杀教程,自伤风险',
      '割腕教程,自伤风险',
      '杀人教程,暴力风险',
      '爆炸物制作,危险行为'
    ].join('\n'),
    tags: ['AI小说', '内容审核', '敏感词', 'novel_sensitive_terms', 'sensitive_terms'],
    keywords: ['sensitive_terms', 'novel_sensitive_terms', 'platform review', 'content moderation'],
    prompt_snippets: [],
    applies_to: ['screenwriter', 'editor', 'prompt_engineer'],
    source: 'VIDO maintainable seed; extend with verified public/community terms through the knowledge base.',
    lang: 'zh',
    enabled: true
  }
];
