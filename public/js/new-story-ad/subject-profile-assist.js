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

  const FIELD_LABELS = {
    displayName: '姓名',
    roleName: '剧情身份',
    appearanceText: '外貌气质',
    wardrobeText: '服装',
    hairMakeupText: '发型妆造',
    negativeText: '禁止项',
  };

  function blankProfileFields(profile = {}) {
    return Object.keys(FIELD_LABELS).filter(key => !clean(profile[key]));
  }

  function setAssistStatus(state = {}, index = 0, status = 'idle', message = '') {
    state.subjectAssistStatus = {
      ...(state.subjectAssistStatus && typeof state.subjectAssistStatus === 'object' ? state.subjectAssistStatus : {}),
      [index]: { status, message, updatedAt: Date.now() },
    };
  }

  async function assistHumanProfile({
    state = {}, index = 0, api, buildPayload, collectSpec, renderAll, setBusy, setButtonBusy, toast, button, onChanged,
  } = {}) {
    const ui = window.NewStoryAdSubjectAssetsUI;
    if (!ui || typeof api !== 'function' || !Array.isArray(state.castProfiles) || !state.castProfiles[index]) return false;
    ui.syncProfileFieldsFromDom?.(state, document);
    const current = ui.normalizeHumanProfile(state.castProfiles[index], index);
    const blanksBefore = blankProfileFields(current);
    if (!blanksBefore.length) {
      setAssistStatus(state, index, 'success', '该人物必填资料已完整，没有需要补齐的空白字段。');
      renderAll?.();
      toast?.('该人物资料已完整；如需改写，请直接修改对应字段。', 'info');
      return false;
    }
    setAssistStatus(state, index, 'running', `正在根据当前剧情补齐：${blanksBefore.map(key => FIELD_LABELS[key]).join('、')}…`);
    renderAll?.();
    setButtonBusy?.(button, true, '补齐中...');
    try {
      const response = await window.NewStoryAdGenerationFlow.requestInlineGeneration(
        'assist_person_profile',
        { state, api, renderAll, setBusy },
        {
          label: `补齐${current.displayName || `人物 ${index + 1}`}资料中...`,
          body: {
          ...(typeof buildPayload === 'function' ? buildPayload() : {}),
          mode: 'person_spec',
          person_spec: typeof collectSpec === 'function' ? collectSpec() : {},
          cast_profiles: state.castProfiles,
          pet_profiles: state.petProfiles || [],
          assist_subject_target: { kind: 'human', index, id: current.id },
           },
            showGlobalProgress: false,
            exclusive: false,
            channel: 'person_assist',
            editDomain: 'person',
           timeoutMs: 120000,
        },
      );
      const changed = mergeHumanProfile(state, index, response);
      const next = ui.normalizeHumanProfile(state.castProfiles[index], index);
      const filled = blanksBefore.filter(key => clean(next[key]));
      setAssistStatus(
        state,
        index,
        changed ? 'success' : 'idle',
        changed
          ? `已补齐 ${filled.length} 项：${filled.map(key => FIELD_LABELS[key]).join('、')}。`
          : 'AI 已返回，但当前人物没有可安全写入的空白字段。',
      );
      if (changed) onChanged?.();
      renderAll?.();
      toast?.(changed ? `已只补齐${current.displayName || `人物 ${index + 1}`}的空白资料，其他主体未改动` : '该人物没有可补齐的空白字段', changed ? 'success' : 'info');
      return changed;
    } catch (error) {
      setAssistStatus(
        state,
        index,
        'error',
        error?.code === 'USER_CANCELLED'
          ? '本次辅助补齐已取消，没有写入人物档案。'
          : `补齐失败：${error.message || '模型服务未响应'}，可以点击重试。`,
      );
      renderAll?.();
      toast?.(error.message || '单人物辅助补齐失败', 'error');
      return false;
    } finally {
      setButtonBusy?.(button, false);
    }
  }

  window.NewStoryAdSubjectProfileAssist = {
    mergeHumanProfile,
    assistHumanProfile,
    blankProfileFields,
    setAssistStatus,
  };
})();
