'use strict';

const crypto = require('crypto');

function normalize(value = '', max = 12000) {
  return String(value ?? '')
    .replace(/\r\n?|\u2028|\u2029/g, '\n')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map(line => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
    .slice(0, max);
}

function metrics(value = '') {
  const text = normalize(value);
  const paragraphs = text ? text.split(/\n\s*\n/).filter(part => part.trim()).length : 0;
  const sections = (text.match(/(?:^|\n)\s*(?:【[^】]+】|#{1,6}\s+|\d+[.、]\s*)/g) || []).length;
  return {
    characters: [...text].length,
    newlines: (text.match(/\n/g) || []).length,
    paragraphs,
    sections,
    sha256: crypto.createHash('sha256').update(text, 'utf8').digest('hex'),
  };
}

function assertEquivalent(expected = '', actual = '') {
  const expectedMetrics = metrics(expected);
  const actualMetrics = metrics(actual);
  const equal = expectedMetrics.sha256 === actualMetrics.sha256
    && expectedMetrics.characters === actualMetrics.characters
    && expectedMetrics.newlines === actualMetrics.newlines
    && expectedMetrics.paragraphs === actualMetrics.paragraphs
    && expectedMetrics.sections === actualMetrics.sections;
  if (!equal) {
    const error = new Error('内容目标保存后的字符、换行或段落与提交内容不一致，已停止后续生成。');
    error.code = 'BRIEF_READBACK_MISMATCH';
    error.status = 409;
    error.retryable = true;
    error.expected_metrics = expectedMetrics;
    error.actual_metrics = actualMetrics;
    throw error;
  }
  return actualMetrics;
}

function versions(source = {}, current = '') {
  const existing = source && typeof source === 'object' ? source : {};
  const normalizedCurrent = normalize(current, 5000);
  return {
    original: normalize(existing.original || normalizedCurrent, 5000),
    current: normalizedCurrent,
    assisted: normalize(existing.assisted || '', 5000),
    rendered: normalize(existing.rendered || normalizedCurrent, 5000),
    structured: existing.structured && typeof existing.structured === 'object' ? existing.structured : null,
  };
}

module.exports = { normalize, metrics, assertEquivalent, versions };
