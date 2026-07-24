const SECTION_LABELS = new Set([
  '广告主题',
  '核心故事线',
  '人物与宠物设定',
  '人物设定',
  '宠物设定',
  '场景设定',
  '产品卖点',
  '核心卖点',
  '目标受众',
  '叙事节奏',
  '画面风格',
  '禁止项',
  '补充要求',
]);

function decodeEscapedLayout(value = '') {
  return String(value || '')
    .replace(/\\r\\n|\\n|\\r/g, '\n')
    .replace(/\\t/g, ' ');
}

function stripMarkdownLayout(value = '') {
  return String(value || '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '• ');
}

function formatSectionLine(line = '') {
  const match = String(line).match(/^\s*(?:【([^】]+)】|([^：:\n]{2,18}))\s*[：:]\s*(.*)$/);
  if (!match) return String(line).trim();
  const label = String(match[1] || match[2] || '').trim();
  const content = String(match[3] || '').trim();
  if (!SECTION_LABELS.has(label)) return String(line).trim();
  return content ? `【${label}】${content}` : `【${label}】`;
}

function formatAssistedBrief(value = '', max = 3000) {
  const normalized = stripMarkdownLayout(decodeEscapedLayout(value))
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  if (!normalized) return '';

  const lines = normalized
    .split(/\n+/)
    .map(formatSectionLine)
    .filter(Boolean);
  const output = [];
  for (const line of lines) {
    const isSection = /^【[^】]+】/.test(line);
    if (isSection && output.length && output[output.length - 1] !== '') output.push('');
    output.push(line);
  }
  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

module.exports = {
  decodeEscapedLayout,
  stripMarkdownLayout,
  formatAssistedBrief,
};
