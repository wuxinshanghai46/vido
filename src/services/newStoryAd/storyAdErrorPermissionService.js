'use strict';

const authStore = require('../../models/authStore');

const ERROR_PERMISSION_KEYS = Object.freeze([
  'enterprise:luxury_ad_pipeline_debug:view_errors',
  'platform:luxury_ad_pipeline_debug:view_errors',
  'luxury_ad_pipeline_debug:view_errors',
]);

function list(value) { return Array.isArray(value) ? value.filter(item => typeof item === 'string') : []; }

function canViewErrors(user = {}, store = authStore) {
  const roleId = String(user.role || '').trim();
  if (roleId.toLowerCase() === 'admin') return true;
  const account = store.getUserById?.(user.id || user.userId || '') || {};
  const role = store.getRoleById?.(roleId || account.role || '') || {};
  const permissions = new Set([...list(account.permissions), ...list(user.permissions), ...list(role.permissions)]);
  return permissions.has('*') || ERROR_PERMISSION_KEYS.some(key => permissions.has(key));
}

module.exports = { ERROR_PERMISSION_KEYS, canViewErrors };
