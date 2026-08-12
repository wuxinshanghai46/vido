export function normalizeBriefText(value = '') {
  return String(value ?? '')
    .replace(/\r\n?|\u2028|\u2029/g, '\n')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map(line => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
    .slice(0, 5000);
}

function fingerprint(value = '') {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function briefTextMetrics(value = '') {
  const text = normalizeBriefText(value);
  return {
    characters: [...text].length,
    newlines: (text.match(/\n/g) || []).length,
    paragraphs: text ? text.split(/\n\s*\n/).filter(part => part.trim()).length : 0,
    sections: (text.match(/(?:^|\n)\s*(?:【[^】]+】|#{1,6}\s+|\d+[.、]\s*)/g) || []).length,
    fingerprint: fingerprint(text),
  };
}

export function assertBriefReadback(expected = '', actual = '') {
  const before = briefTextMetrics(expected);
  const after = briefTextMetrics(actual);
  if (before.fingerprint !== after.fingerprint
    || before.characters !== after.characters
    || before.newlines !== after.newlines
    || before.paragraphs !== after.paragraphs
    || before.sections !== after.sections) {
    throw new Error('内容目标服务器回读不一致，已停止创建人物与场景方案；原编辑内容仍保留在页面中。');
  }
  return after;
}
