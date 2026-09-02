'use strict';

function isAdmin(user = {}) {
  return String(user.role || '').trim().toLowerCase() === 'admin';
}

/**
 * Administrators see the platform-wide task list by default. `mine=1` is the
 * explicit opt-in for narrowing an administrator back to their own tasks.
 * Ordinary users are always isolated to their own user id.
 */
function resolveListScope(user = {}, query = {}) {
  const userId = String(user.id || user.userId || '').trim();
  const admin = isAdmin(user);
  const mineOnly = admin && String(query.mine || '') === '1';
  return {
    user_id: admin && !mineOnly ? '' : userId,
    scope: admin && !mineOnly ? 'all_users' : 'current_user',
    is_admin: admin,
  };
}

module.exports = { isAdmin, resolveListScope };
