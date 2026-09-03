'use strict';
const crypto = require('crypto');

// This is the exact cast serialization used by the planning-input contract.
// Storage fingerprints omit transient keys, including nested QA timestamps;
// they cannot serve as a marker for this full generated-profile projection.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}
function fingerprint(profiles = []) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(profiles))).digest('hex');
}
module.exports = { fingerprint };
