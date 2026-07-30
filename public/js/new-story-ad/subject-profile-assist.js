(() => {
  function clean(value = '', max = 800) {
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    const normalized = String(value).trim();
    return normalized === '[object Object]' ? '' : normalized.slice(0, max);
  }

  const FIELD_LABELS = {
    displayName: '姓名',
    roleName: '剧情身份',
    appearanceText: '外貌气质',
    wardrobeText: '服装',
    hairMakeupText: '发型妆造',
    negativeText: '禁止项',
  };
  const REPLACEABLE_AUTHORITIES = new Set(['reference_direction', 'reference_safety', 'system_default']);

  function profileUserEditedFields(profile = {}) {
    return new Set(
      profile.user_edited_fields || profile.userEditedFields || profile._userEditedFields || [],
    );
  }

  function fieldsNeedingAssist(state = {}, profile = {}) {
    const authority = profile.field_authority || profile.fieldAuthority || {};
    const edited = profileUserEditedFields(profile);
    return Object.keys(FIELD_LABELS).filter(key => {
      if (edited.has(key) || authority[key] === 'user') return false;
      if (!clean(profile[key], 1000)) return true;
      if (REPLACEABLE_AUTHORITIES.has(authority[key])) return true;
      return false;
    });
  }

  function recordManualEdit(state = {}, target = {}) {
    const index = Number(target.dataset?.nsaSubjectIndex);
    const field = clean(target.dataset?.nsaSubjectField, 80);
    if (target.dataset?.nsaSubjectKind !== 'cast' || !Number.isInteger(index) || !field) return;
    const profile = state.castProfiles?.[index];
    if (!profile) return;
    profile.field_authority = { ...(profile.field_authority || profile.fieldAuthority || {}), [field]: 'user' };
    profile.user_edited_fields = [...new Set([...profileUserEditedFields(profile), field])];
  }

  function mergeHumanProfile(state = {}, index = 0, response = {}, requestedFields = []) {
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
    const keys = Object.keys(FIELD_LABELS);
    const replaceable = new Set(
      response.assist_replaceable_fields
        || response.assistReplaceableFields
        || requestedFields,
    );
    const applied = keys.filter(key => replaceable.has(key) && clean(candidate[key]));
    if (!applied.length) return false;
    const next = { ...candidate, ...current, id: currentProfile.id };
    keys.forEach(key => {
      next[key] = applied.includes(key)
        ? clean(candidate[key])
        : clean(currentProfile[key]);
    });
    next.field_authority = {
      ...(currentProfile.field_authority || currentProfile.fieldAuthority || {}),
      ...Object.fromEntries(applied.map(key => [key, 'ai_generated'])),
    };
    next.user_edited_fields = [...profileUserEditedFields(currentProfile)];
    next.name = next.displayName;
    next._generationDirty = true;
    next._generationDirtyFields = [...new Set([...(current._generationDirtyFields || []), ...applied])];
    state.castProfiles[index] = next;
    return true;
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
    const targetFields = fieldsNeedingAssist(state, current);
    if (!targetFields.length) {
      setAssistStatus(state, index, 'success', '该人物已经是详细设定，且没有可安全改写的参考方向或空白字段。');
      renderAll?.();
      toast?.('该人物详细设定已完整；手动修改字段不会被 AI 覆盖。', 'info');
      return false;
    }
    setAssistStatus(state, index, 'running', `正在根据当前剧情完善：${targetFields.map(key => FIELD_LABELS[key]).join('、')}…`);
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
          assist_replaceable_fields: targetFields,
           },
            showGlobalProgress: false,
            exclusive: false,
            channel: 'person_assist',
            editDomain: 'person',
           timeoutMs: 120000,
        },
      );
      const changed = mergeHumanProfile(state, index, response, targetFields);
      const next = ui.normalizeHumanProfile(state.castProfiles[index], index);
      const filled = targetFields.filter(key => clean(next[key]));
      setAssistStatus(
        state,
        index,
        changed ? 'success' : 'idle',
        changed
          ? `已完善 ${filled.length} 项：${filled.map(key => FIELD_LABELS[key]).join('、')}。`
          : 'AI 已返回，但没有形成达到详细度标准的可写入人物设定。',
      );
      if (changed) onChanged?.();
      renderAll?.();
      toast?.(changed ? `已完善${current.displayName || `人物 ${index + 1}`}的详细设定，手动修改字段和其他主体未改动` : '该人物没有可安全完善的字段', changed ? 'success' : 'info');
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
    fieldsNeedingAssist,
    recordManualEdit,
    setAssistStatus,
  };
})();
