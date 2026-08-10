'use strict';

const MAX_AGE = 1000000;
const PRESET_LABELS = {
  infant_0_1: '0~1岁', toddler_1_3: '1~3岁', child_4_7: '4~7岁', child_8_12: '8~12岁',
  teen_13_17: '13~17岁', young_adult_17_25: '17~25岁', young_adult: '25~32岁',
  adult_30_40: '30~40岁', middle_40_55: '40~55岁', senior_55_plus: '55岁以上',
};

function clean(value = '', max = 80) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function rangeValues(value = '') {
  const match = clean(value).match(/^(?:年龄|实际年龄|外观年龄)?\s*(\d{1,7})\s*(?:~|～|-|—|–|至|到)\s*(\d{1,7})\s*(?:岁|周岁)?$/u);
  if (!match) return null;
  const min = Number(match[1]);
  const max = Number(match[2]);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max > MAX_AGE || min > max) return null;
  return { min, max };
}

function exactValue(value = '') {
  const match = clean(value).match(/^(?:年龄|实际年龄)?\s*(\d{1,7})\s*(?:岁|周岁)?$/u);
  if (!match) return null;
  const years = Number(match[1]);
  return Number.isInteger(years) && years >= 0 && years <= MAX_AGE ? years : null;
}

function normalize(input = '', options = {}) {
  const source = input && typeof input === 'object'
    ? clean(input.value || input.display_text || input.displayText || input.label || '')
    : clean(input);
  if (!source || source === 'auto' || source === 'match_brief') {
    return { schema_version: 1, mode: 'auto', value: 'match_brief', display_text: '', source: options.source || 'auto' };
  }
  if (PRESET_LABELS[source]) {
    return { schema_version: 1, mode: 'preset_range', value: source, display_text: PRESET_LABELS[source], source: options.source || 'legacy_preset' };
  }
  const range = rangeValues(source);
  if (range) {
    const display = `${range.min}~${range.max}岁`;
    return { schema_version: 1, mode: 'range', value: display, display_text: display, min_years: range.min, max_years: range.max, source: options.source || 'user' };
  }
  const exact = exactValue(source);
  if (exact !== null) {
    const display = `${exact}岁`;
    return { schema_version: 1, mode: 'exact', value: display, display_text: display, exact_years: exact, source: options.source || 'user' };
  }
  if (options.strict === true) {
    const error = new Error('年龄请填写确切年龄（如 22岁）或年龄区间（如 18~25岁）。');
    error.code = 'PERSON_AGE_FORMAT_INVALID';
    throw error;
  }
  return { schema_version: 1, mode: 'legacy_text', value: source, display_text: source, source: options.source || 'legacy' };
}

function promptLock(input = '') {
  const contract = normalize(input);
  if (contract.mode === 'exact') return `Age lock: exactly ${contract.exact_years} years old. Preserve this exact apparent maturity in every view and shot.`;
  if (contract.mode === 'range') return `Age-range lock: apparent age must remain between ${contract.min_years} and ${contract.max_years} years old. Choose one stable facial-maturity anchor inside this interval and preserve it across every view and shot.`;
  if (contract.mode === 'preset_range') return `Age-range lock: ${contract.display_text}. Preserve one stable apparent maturity inside this interval across every view and shot.`;
  if (contract.mode === 'legacy_text') return `Age lock: ${contract.display_text}. Treat the user's wording as authoritative.`;
  return 'Age lock: infer only from the confirmed script and character relationship, then preserve one stable apparent maturity across every view and shot.';
}

function containsAgeExpression(value = '') {
  const text = clean(value, 1200);
  return /(?<!\d)\d{1,7}\s*(?:~|～|-|—|–|至|到)\s*\d{1,7}\s*(?:岁|周岁)/u.test(text)
    || /(?<![\d~～\-—–至到])\d{1,7}\s*(?:岁|周岁)/u.test(text);
}

module.exports = { MAX_AGE, PRESET_LABELS, normalize, promptLock, containsAgeExpression };
