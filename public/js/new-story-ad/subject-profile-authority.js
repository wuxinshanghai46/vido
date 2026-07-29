(() => {
  const ui = () => window.NewStoryAdSubjectAssetsUI;
  const clean = value => String(value || '').trim();

  function canonicalPersonSpec(spec = {}, state = {}) {
    const next = { ...spec };
    const keys = ['displayName', 'appearanceText', 'wardrobeText', 'hairMakeupText', 'negativeText'];
    const profiles = Array.isArray(state.castProfiles) ? state.castProfiles : [];
    if (profiles.length === 1) {
      const profile = ui()?.normalizeHumanProfile?.(profiles[0], 0) || {};
      keys.forEach(key => { next[key] = clean(profile[key]); });
    } else if (profiles.length > 1) keys.forEach(key => delete next[key]);
    return next;
  }

  function validationHtml(state = {}, spec = {}, escapeHtml = value => String(value)) {
    const errors = ui()?.profileErrors?.(state, spec) || [];
    return errors.length
      ? `<div class="dh-task-warning">${escapeHtml(errors.join('；'))}</div>`
      : '<div class="dh-task-ok">逐主体档案数量和必填信息完整</div>';
  }

  function refreshProfileValidation(scope, state = {}, spec = {}, escapeHtml = value => String(value)) {
    if (!scope?.querySelector) return false;
    const host = scope.querySelector('[data-nsa-subject-validation]');
    if (host) host.innerHTML = validationHtml(state, spec, escapeHtml);
    (state.castProfiles || []).forEach((raw, index) => {
      const item = ui()?.normalizeHumanProfile?.(raw, index) || {};
      const summary = scope.querySelector(`[data-nsa-subject-summary-index="${index}"]`);
      if (summary) summary.textContent = item.displayName || item.roleName || '资料待补齐';
    });
    return !!host;
  }

  window.NewStoryAdSubjectProfileAuthority = { canonicalPersonSpec, validationHtml, refreshProfileValidation };
})();
