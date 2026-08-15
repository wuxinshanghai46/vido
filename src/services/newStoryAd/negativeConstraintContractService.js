'use strict';

const CONTRACT_VERSION = 'negative-constraint-v1';
const DENY_MODAL = '(?:禁止|不得|不要|避免|不能|严禁|不允许)';
const REQUIRE_MODAL = '(?:必须|务必|应当|需要)';
const MODAL = `(?:${DENY_MODAL}|${REQUIRE_MODAL})`;

function normalizedText(value = '') {
  return String(value || '').normalize('NFKC').replace(/\r\n?/g, '\n').trim();
}

function clauses(value = '') {
  return normalizedText(value)
    .replace(new RegExp(`[，,](?=\\s*${MODAL})`, 'gu'), '；')
    .split(/[；;。.!！?？\n]+/u)
    .map(row => row.trim()).filter(Boolean);
}

function clauseContract(value = '', source = 'profile') {
  const text = normalizedText(value);
  const deny = new RegExp(`^\\s*${DENY_MODAL}\\s*`, 'u');
  const require = new RegExp(`^\\s*${REQUIRE_MODAL}\\s*`, 'u');
  const polarity = deny.test(text) ? 'deny' : (require.test(text) ? 'require' : 'unspecified');
  const body = text.replace(deny, '').replace(require, '')
    .replace(/[\s，,、；;。.!！?？:“”"'‘’（）()【】\[\]]+/gu, '').toLowerCase();
  return {
    category: polarity === 'deny' ? 'visual_exclusion' : (polarity === 'require' ? 'visual_requirement' : 'unclassified_constraint'),
    polarity, tokens: body ? [body] : [], canonical: body, source,
  };
}

function compileNegativeConstraintContract(value = '', { source = 'profile' } = {}) {
  const unique = new Map();
  clauses(value).map(row => clauseContract(row, source)).filter(row => row.canonical)
    .forEach(row => unique.set(`${row.polarity}:${row.canonical}`, row));
  return { version: CONTRACT_VERSION, source, constraints: [...unique.values()] };
}

function compareNegativeConstraintContracts(previous = '', current = '', options = {}) {
  const before = compileNegativeConstraintContract(previous, { source: options.previousSource || 'checkpoint' });
  const after = compileNegativeConstraintContract(current, { source: options.currentSource || 'current_profile' });
  const oldKeys = new Set(before.constraints.map(row => `${row.polarity}:${row.canonical}`));
  const oldByBody = new Map(before.constraints.map(row => [row.canonical, row.polarity]));
  const added = after.constraints.filter(row => !oldKeys.has(`${row.polarity}:${row.canonical}`));
  const conflicts = added.filter(row => oldByBody.has(row.canonical) && oldByBody.get(row.canonical) !== row.polarity);
  const compatible = added.length === 0;
  return {
    version: CONTRACT_VERSION, compatible,
    relation: compatible
      ? (before.constraints.length === after.constraints.length ? 'equivalent' : 'monotonic_relaxation')
      : (conflicts.length ? 'conflict' : 'restriction_added'),
    previous: before, current: after, added, conflicts,
  };
}

module.exports = { CONTRACT_VERSION, clauseContract, compileNegativeConstraintContract, compareNegativeConstraintContracts };
