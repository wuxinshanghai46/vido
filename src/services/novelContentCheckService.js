const db = require('../models/database');

const TYPO_PATTERNS = [
  ['在也', '再也'],
  ['在见', '再见'],
  ['再所不惜', '在所不惜'],
  ['必竟', '毕竟'],
  ['既使', '即使'],
  ['即然', '既然'],
  ['因该', '应该'],
  ['以经', '已经'],
  ['一但', '一旦'],
  ['其它', '其他'],
  ['登陆', '登录'],
  ['做坐', '坐'],
  ['的地', '的/地'],
  ['得的', '得/的']
].map(([word, suggestion]) => ({ word, suggestion }));

const BASE_SENSITIVE_TERMS = [
  { word: '台独', category: '政治敏感' },
  { word: '港独', category: '政治敏感' },
  { word: '藏独', category: '政治敏感' },
  { word: '法轮功', category: '政治敏感' },
  { word: '贩毒', category: '违法犯罪' },
  { word: '吸毒', category: '违法犯罪' },
  { word: '冰毒', category: '违法犯罪' },
  { word: '海洛因', category: '违法犯罪' },
  { word: '洗钱', category: '违法犯罪' },
  { word: '赌博', category: '违法犯罪' },
  { word: '赌球', category: '违法犯罪' },
  { word: '卖淫', category: '违法犯罪' },
  { word: '嫖娼', category: '违法犯罪' },
  { word: '强奸', category: '成人与暴力' },
  { word: '轮奸', category: '成人与暴力' },
  { word: '乱伦', category: '成人与暴力' },
  { word: '幼女', category: '未成年人风险' },
  { word: '自杀教程', category: '自伤风险' },
  { word: '割腕教程', category: '自伤风险' },
  { word: '杀人教程', category: '暴力风险' },
  { word: '爆炸物制作', category: '危险行为' }
];

let cachedTerms = null;
let cachedAt = 0;

function cleanText(value) {
  return typeof value === 'string' ? value : '';
}

function normalizeTerm(term) {
  if (!term) return null;
  if (typeof term === 'string') {
    const word = term.trim();
    return word ? { word, category: '知识库词库' } : null;
  }
  const word = String(term.word || term.term || term.keyword || '').trim();
  if (!word) return null;
  return {
    word,
    category: term.category || term.type || '知识库词库',
    source: term.source || term.platform || ''
  };
}

function parseTermsFromDoc(doc = {}) {
  const terms = [];
  for (const item of [...(doc.terms || []), ...(doc.sensitive_terms || [])]) {
    const term = normalizeTerm(item);
    if (term) terms.push(term);
  }
  const content = cleanText(doc.content);
  if (content) {
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [word, category] = trimmed.split(/[,\t，|]/).map(part => part && part.trim());
      const term = normalizeTerm({ word, category: category || doc.subcategory || '知识库词库', source: doc.source });
      if (term) terms.push(term);
    }
  }
  return terms;
}

function loadSensitiveTerms() {
  if (cachedTerms && Date.now() - cachedAt < 60_000) return cachedTerms;
  const byWord = new Map(BASE_SENSITIVE_TERMS.map(term => [term.word, term]));
  try {
    const docs = db.listKnowledgeDocs({ collection: 'drama', enabledOnly: true })
      .filter(doc => {
        const tags = [...(doc.tags || []), ...(doc.keywords || [])].map(item => String(item).toLowerCase());
        return doc.subcategory === 'novel_sensitive_terms' || tags.includes('novel_sensitive_terms') || tags.includes('sensitive_terms');
      });
    for (const doc of docs) {
      for (const term of parseTermsFromDoc(doc)) {
        if (!byWord.has(term.word)) byWord.set(term.word, term);
      }
    }
  } catch {}
  cachedTerms = [...byWord.values()].sort((a, b) => b.word.length - a.word.length);
  cachedAt = Date.now();
  return cachedTerms;
}

function findTermMatches(content, terms, kind) {
  const text = cleanText(content);
  const matches = [];
  for (const term of terms) {
    if (!term.word) continue;
    let start = 0;
    while (start < text.length) {
      const index = text.indexOf(term.word, start);
      if (index < 0) break;
      matches.push({
        type: kind,
        word: term.word,
        category: term.category || '',
        suggestion: term.suggestion || '',
        start: index,
        end: index + term.word.length
      });
      start = index + Math.max(term.word.length, 1);
    }
  }
  return matches;
}

function findDuplicateMatches(content) {
  const text = cleanText(content);
  const matches = [];
  const duplicatePhrase = /([\u4e00-\u9fa5]{2,6})(?:[，,、\s]*)\1/g;
  let match;
  while ((match = duplicatePhrase.exec(text))) {
    matches.push({
      type: 'typo',
      word: match[0],
      category: '疑似重复',
      suggestion: match[1],
      start: match.index,
      end: match.index + match[0].length
    });
  }
  const duplicatePunctuation = /([，。！？；、])\1+/g;
  while ((match = duplicatePunctuation.exec(text))) {
    matches.push({
      type: 'typo',
      word: match[0],
      category: '重复标点',
      suggestion: match[1],
      start: match.index,
      end: match.index + match[0].length
    });
  }
  return matches;
}

function uniqueMatches(matches) {
  const seen = new Set();
  return matches
    .sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start))
    .filter(match => {
      const key = `${match.type}:${match.start}:${match.end}:${match.word}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function checkTypos(content) {
  const matches = uniqueMatches([
    ...findTermMatches(content, TYPO_PATTERNS, 'typo'),
    ...findDuplicateMatches(content)
  ]);
  return {
    type: 'typo',
    count: matches.length,
    matches
  };
}

function checkSensitive(content) {
  const matches = uniqueMatches(findTermMatches(content, loadSensitiveTerms(), 'sensitive'));
  return {
    type: 'sensitive',
    count: matches.length,
    matches,
    dictionary_count: loadSensitiveTerms().length
  };
}

module.exports = {
  checkSensitive,
  checkTypos,
  loadSensitiveTerms
};
