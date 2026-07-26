(() => {
  function clean(value = '', max = 800) {
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    const normalized = String(value).trim();
    return normalized === '[object Object]' ? '' : normalized.slice(0, max);
  }

  function mergeHumanProfile(state = {}, index = 0, response = {}) {
    const ui = window.NewStoryAdSubjectAssetsUI;
    if (!ui || !Array.isArray(state.castProfiles) || !state.castProfiles[index]) return false;
    const current = state.castProfiles[index];
    const currentProfile = ui.normalizeHumanProfile(current, index);
    const candidates = Array.isArray(response.cast_profiles || response.castProfiles)
      ? (response.cast_profiles || response.castProfiles)
      : [];
    const targetId = clean(response.assist_subject_target?.id || response.assistSubjectTarget?.id || currentProfile.id, 80);
    const candidate = ui.normalizeHumanProfile(
      candidates.find(profile => clean(profile?.id || profile?.cast_id || profile?.castId, 80) === targetId)
        || candidates[0]
        || {},
      index,
    );
    const keys = ['displayName', 'roleName', 'appearanceText', 'wardrobeText', 'hairMakeupText', 'negativeText'];
    const filled = keys.filter(key => !clean(currentProfile[key]) && clean(candidate[key]));
    if (!filled.length) return false;
    const next = { ...candidate, ...current, id: currentProfile.id };
    keys.forEach(key => { next[key] = clean(currentProfile[key]) || clean(candidate[key]); });
    next.name = next.displayName;
    next._generationDirty = true;
    next._generationDirtyFields = [...new Set([...(current._generationDirtyFields || []), ...filled])];
    state.castProfiles[index] = next;
    return true;
  }

  async function assistHumanProfile({
    state = {}, index = 0, api, buildPayload, collectSpec, renderAll, setButtonBusy, toast, button, onChanged,
  } = {}) {
    const ui = window.NewStoryAdSubjectAssetsUI;
    if (!ui || typeof api !== 'function' || !Array.isArray(state.castProfiles) || !state.castProfiles[index]) return false;
    ui.syncProfileFieldsFromDom?.(state, document);
    const current = ui.normalizeHumanProfile(state.castProfiles[index], index);
    setButtonBusy?.(button, true, '补齐中...');
    try {
      const response = await api('/api/new-story-ad/assist', {
        method: 'POST',
        body: {
          ...(typeof buildPayload === 'function' ? buildPayload() : {}),
          mode: 'person_spec',
          person_spec: typeof collectSpec === 'function' ? collectSpec() : {},
          cast_profiles: state.castProfiles,
          pet_profiles: state.petProfiles || [],
          assist_subject_target: { kind: 'human', index, id: current.id },
        },
      });
      const changed = mergeHumanProfile(state, index, response);
      if (changed) onChanged?.();
      renderAll?.();
      toast?.(changed ? `已只补齐${current.displayName || `人物 ${index + 1}`}的空白资料，其他主体未改动` : '该人物没有可补齐的空白字段', changed ? 'success' : 'info');
      return changed;
    } catch (error) {
      toast?.(error.message || '单人物辅助补齐失败', 'error');
      return false;
    } finally {
      setButtonBusy?.(button, false);
    }
  }

  window.NewStoryAdSubjectProfileAssist = { mergeHumanProfile, assistHumanProfile };
})();
