function text(value) {
  return String(value || '').trim();
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function chapterText(chapter = {}) {
  return text(chapter.content || chapter.text || chapter.body || chapter.draft || chapter.markdown || '');
}

function displayWordCount(value = '') {
  return String(value || '').replace(/\s+/g, '').length;
}

function splitParagraphs(value = '') {
  return String(value || '').split(/\n{2,}|\r?\n/).map(text).filter(Boolean);
}

function splitSentences(value = '') {
  return String(value || '')
    .split(/(?<=[。！？!?；;…])|\n+/)
    .map(text)
    .filter(Boolean);
}

function countMatches(value = '', pattern) {
  return (String(value || '').match(pattern) || []).length;
}

function topFrequentWords(value = '', limit = 20) {
  const stop = new Set(['一个', '一种', '这个', '那个', '他们', '她们', '我们', '你们', '自己', '没有', '不是', '已经', '只是', '还是', '然后', '因为', '所以', '但是', '如果', '时候']);
  const words = String(value || '').match(/[\u4e00-\u9fa5]{2,4}|[A-Za-z]{3,}/g) || [];
  const counts = new Map();
  for (const raw of words) {
    const word = raw.toLowerCase();
    if (stop.has(word)) continue;
    counts.set(word, (counts.get(word) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }));
}

function openingPatterns(sentences = []) {
  const patterns = sentences.slice(0, 80).map(sentence => {
    const first = text(sentence).slice(0, 8);
    if (/^[“"「]/.test(first)) return '对白开场';
    if (/^(清晨|夜里|黄昏|雨|风|雪|灯|窗|门|街|屋)/.test(first)) return '环境开场';
    if (/^(他|她|我|你|少年|女孩|男人|女人|老人|主角)/.test(first)) return '人物动作开场';
    if (/^(忽然|突然|就在|直到|当|那一刻)/.test(first)) return '事件推进开场';
    return first;
  }).filter(Boolean);
  const counts = new Map();
  for (const item of patterns) counts.set(item, (counts.get(item) || 0) + 1);
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([pattern, count]) => ({ pattern, count }));
}

function punctuationRhythm(value = '') {
  const total = Math.max(1, displayWordCount(value));
  const marks = {
    comma: countMatches(value, /[，,]/g),
    period: countMatches(value, /[。\.]/g),
    question: countMatches(value, /[？?]/g),
    exclamation: countMatches(value, /[！!]/g),
    ellipsis: countMatches(value, /…|\.{3,}/g),
    dash: countMatches(value, /——|--/g),
    quote: countMatches(value, /[“”"「」『』]/g)
  };
  return {
    ...marks,
    density_per_100_chars: Number(((Object.values(marks).reduce((a, b) => a + b, 0) / total) * 100).toFixed(2))
  };
}

function addRevisionLearning(profile = {}, event = {}) {
  const history = arr(profile.revision_learning).slice(-19);
  const before = text(event.before || event.source || '');
  const after = text(event.after || event.result || '');
  if (!before || !after) return profile;
  const beforeSentences = splitSentences(before);
  const afterSentences = splitSentences(after);
  return {
    ...profile,
    revision_learning: history.concat([{
      learned_at: new Date().toISOString(),
      source: event.source || 'user_revision',
      instruction: text(event.instruction),
      before_chars: displayWordCount(before),
      after_chars: displayWordCount(after),
      sentence_delta: afterSentences.length - beforeSentences.length,
      word_delta: displayWordCount(after) - displayWordCount(before)
    }]),
    updated_at: new Date().toISOString()
  };
}

function buildAuthorProfile(novel = {}, source = 'user_saved_chapters') {
  const chapters = arr(novel.chapters)
    .map((chapter, index) => ({ ...chapter, index: Number(chapter.index || index + 1) || index + 1, content: chapterText(chapter) }))
    .filter(chapter => chapter.content.length >= 80);
  const corpus = chapters.map(chapter => chapter.content).join('\n\n');
  const sentences = splitSentences(corpus);
  const paragraphs = splitParagraphs(corpus);
  const sentenceLengths = sentences.map(displayWordCount).filter(Boolean);
  const paragraphLengths = paragraphs.map(displayWordCount).filter(Boolean);
  const totalChars = displayWordCount(corpus);
  const shortCount = sentenceLengths.filter(n => n <= 12).length;
  const longCount = sentenceLengths.filter(n => n >= 32).length;
  const dialogueChars = (corpus.match(/[“「][\s\S]*?[”」]/g) || []).reduce((sum, item) => sum + displayWordCount(item), 0);
  const avg = list => list.length ? list.reduce((sum, n) => sum + n, 0) / list.length : 0;
  const previous = novel.author_profile || {};
  return {
    version: 1,
    source,
    updated_at: new Date().toISOString(),
    sample_chapter_count: chapters.length,
    sample_word_count: totalChars,
    avg_sentence_length: Number(avg(sentenceLengths).toFixed(1)),
    short_sentence_ratio: Number((sentenceLengths.length ? shortCount / sentenceLengths.length : 0).toFixed(3)),
    long_sentence_ratio: Number((sentenceLengths.length ? longCount / sentenceLengths.length : 0).toFixed(3)),
    avg_paragraph_length: Number(avg(paragraphLengths).toFixed(1)),
    dialogue_ratio: Number((totalChars ? dialogueChars / totalChars : 0).toFixed(3)),
    frequent_words: topFrequentWords(corpus, 20),
    opening_patterns: openingPatterns(sentences),
    punctuation_rhythm: punctuationRhythm(corpus),
    revision_learning: arr(previous.revision_learning).slice(-20)
  };
}

function profilePrompt(profile = {}) {
  if (!profile || !Number(profile.sample_word_count)) return '';
  const frequentWords = arr(profile.frequent_words).slice(0, 12).map(item => item.word).join('、');
  const openings = arr(profile.opening_patterns).slice(0, 5).map(item => item.pattern).join('、');
  const revisions = arr(profile.revision_learning).slice(-5).map(item => {
    const delta = item.word_delta > 0 ? `扩写${item.word_delta}字` : item.word_delta < 0 ? `压缩${Math.abs(item.word_delta)}字` : '字数持平';
    return `${item.instruction || '用户改写'}：${delta}`;
  }).join('；');
  return `【本书作者写作画像】
已学习 ${profile.sample_chapter_count || 0} 章、约 ${profile.sample_word_count || 0} 字的用户正文。
- 平均句长：${profile.avg_sentence_length || 0} 字；短句比例：${Math.round((profile.short_sentence_ratio || 0) * 100)}%；长句比例：${Math.round((profile.long_sentence_ratio || 0) * 100)}%。
- 平均段落长度：${profile.avg_paragraph_length || 0} 字；对白比例：${Math.round((profile.dialogue_ratio || 0) * 100)}%。
- 常用词/意象：${frequentWords || '暂无'}。
- 开句习惯：${openings || '暂无'}。
- 标点节奏：逗号 ${profile.punctuation_rhythm?.comma || 0}，句号 ${profile.punctuation_rhythm?.period || 0}，问号 ${profile.punctuation_rhythm?.question || 0}，叹号 ${profile.punctuation_rhythm?.exclamation || 0}，省略号 ${profile.punctuation_rhythm?.ellipsis || 0}。
${revisions ? `- 用户改写习惯：${revisions}。` : ''}
写作时请贴近上述句长、段落、对白密度、常用词和开句节奏；不要机械模仿，优先保持剧情事实、人物动机和章节任务。`;
}

module.exports = {
  buildAuthorProfile,
  addRevisionLearning,
  profilePrompt
};
