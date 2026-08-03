'use strict';

/** Keep persisted model text untouched while repairing truncated age tails for workspace display. */
function normalizeAppearanceAgeText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 800).replace(
    /(年龄\s*(?:约为|为|约|大约)?\s*\d{1,3})\s*[-—–]\s*(?=[，,。；;]|$)/g,
    '$1岁',
  );
}

module.exports = { normalizeAppearanceAgeText };
