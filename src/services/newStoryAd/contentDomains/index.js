'use strict';

const commercial = require('./commercialDomain');
const narrative = require('./narrativeDomain');

const DOMAINS = Object.freeze({
  [commercial.mode]: commercial,
  [narrative.mode]: narrative,
});

function normalizeMode(value = '') {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['commercial_subject', 'commercial_ad', 'advertisement', 'ad'].includes(normalized)) return 'commercial_subject';
  if (['narrative_story', 'story', 'plot'].includes(normalized)) return 'narrative_story';
  return '';
}

function modeError(value = '') {
  const missing = !String(value || '').trim();
  const error = new Error(missing
    ? '请先明确选择“广告”或“剧情”，当前任务已停止。'
    : `无法识别内容类型“${String(value).slice(0, 60)}”，当前任务已停止。`);
  error.code = missing ? 'CONTENT_MODE_REQUIRED' : 'CONTENT_MODE_INVALID';
  error.status = 422;
  error.retryable = false;
  return error;
}

function resolve(value = '') {
  const normalized = normalizeMode(value);
  if (!normalized || !DOMAINS[normalized]) throw modeError(value);
  return DOMAINS[normalized];
}

function snapshot(value = '') {
  const domain = resolve(value);
  return {
    id: domain.id,
    version: domain.version,
    mode: domain.mode,
    label: domain.label,
    objective: domain.objective,
    required_sections: [...domain.required_sections],
    script_fields: [...domain.script_fields],
    prompt_rules: [...domain.prompt_rules],
    forbidden: [...domain.forbidden],
  };
}

function assertSelected(context = {}) {
  const value = context.content_mode || context.contentMode || context.product_presentation?.mode;
  const domain = resolve(value);
  if (context.content_mode_source && context.content_mode_source !== 'user') {
    const error = new Error('内容类型尚未由用户确认，请先选择“广告”或“剧情”。');
    error.code = 'CONTENT_MODE_NOT_CONFIRMED';
    error.status = 422;
    error.retryable = false;
    throw error;
  }
  return domain;
}

function promptBlock(value = '') {
  const domain = resolve(value);
  return [
    `内容领域：${domain.label}（${domain.id}@${domain.version}）。`,
    `唯一目标：${domain.objective}。`,
    `必须覆盖：${domain.required_sections.join('、')}。`,
    `规则：${domain.prompt_rules.join('；')}。`,
    `禁止：${domain.forbidden.join('；')}。`,
  ].join('\n');
}

module.exports = { DOMAINS, normalizeMode, resolve, snapshot, assertSelected, promptBlock };
