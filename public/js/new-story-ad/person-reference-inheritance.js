(() => {
  const text = value => String(value || '').trim();

  function reset(state = {}) {
    state.personSpecSource = null;
    state.personConstraintEditorOpen = false;
  }

  function markManual(state = {}) {
    state.personSpecSource = {
      ...(state.personSpecSource || {}),
      kind: 'manual',
      manualOverride: true,
    };
  }

  function applyReference({
    state = {},
    projection = {},
    analysisId = '',
    getPersonSpec,
    writeAllFields,
    markSourceDirty,
    renderAll,
    scheduleAutoSave,
  } = {}) {
    if (state.personSpecSource?.manualOverride === true) return false;
    const spec = projection.personSpec && typeof projection.personSpec === 'object' ? projection.personSpec : {};
    const profiles = Array.isArray(projection.castProfiles) ? projection.castProfiles : [];
    const defaults = {
      castMode: ['auto'],
      gender: ['auto'],
      age: ['match_brief'],
      origin: ['match_brief'],
    };
    let changed = 0;
    Object.entries(spec).forEach(([key, rawValue]) => {
      const value = text(rawValue);
      if (!value) return;
      const current = text(getPersonSpec?.(key));
      if (current && !(defaults[key] || []).includes(current)) return;
      if (current === value) return;
      writeAllFields?.(`[data-nsa-person-spec="${key}"]`, value);
      changed += 1;
    });
    const currentProfiles = Array.isArray(state.castProfiles) ? state.castProfiles : [];
    const referenceOwned = currentProfiles.length > 0
      && currentProfiles.every(item => text(item?.id).startsWith('reference_cast_'));
    if ((currentProfiles.length === 0 || referenceOwned) && profiles.length
      && JSON.stringify(currentProfiles) !== JSON.stringify(profiles)) {
      state.castProfiles = profiles.map(item => ({ ...item }));
      changed += 1;
    } else if (spec.castMode === 'no_human' && referenceOwned) {
      state.castProfiles = [];
      changed += 1;
    }
    state.personSpecSource = {
      kind: 'reference_video',
      analysisId: text(analysisId),
      manualOverride: false,
    };
    state.personConstraintEditorOpen = false;
    renderAll?.();
    if (!changed) return false;
    markSourceDirty?.('person');
    scheduleAutoSave?.('reference_video_person_projection');
    return true;
  }

  function sync({
    state = {},
    root,
    within,
    all,
    getPersonSpec,
    writeAllFields,
  } = {}) {
    const castMode = text(getPersonSpec?.('castMode'));
    const fixedPeople = castMode === 'single' ? '1' : (castMode === 'dual' ? '2' : '');
    if (fixedPeople && text(getPersonSpec?.('expectedPeople')) !== fixedPeople) {
      writeAllFields?.('[data-nsa-person-spec="expectedPeople"]', fixedPeople);
    }
    if (['no_human', 'animal'].includes(castMode) && text(getPersonSpec?.('expectedPeople'))) {
      writeAllFields?.('[data-nsa-person-spec="expectedPeople"]', '');
    }
    all?.('[data-nsa-people-count-field]', root?.()).forEach(element => {
      element.hidden = !['group', 'human_pet'].includes(castMode);
    });
    const expanded = state.personConstraintEditorOpen === true;
    const editor = within?.('#dhNsaPersonConstraintEditor');
    if (editor) editor.hidden = !expanded;
    const toggle = within?.('#dhNsaPersonConstraintToggle');
    if (toggle) {
      toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      toggle.textContent = expanded ? '收起人物设定' : '修改人物设定';
    }
    const profiles = Array.isArray(state.castProfiles) ? state.castProfiles : [];
    const roles = profiles.map(item => text(item?.roleName || item?.displayName || item?.name)).filter(Boolean);
    const count = Number(getPersonSpec?.('expectedPeople') || 0)
      || (castMode === 'single' ? 1 : (castMode === 'dual' ? 2 : profiles.length));
    const source = state.personSpecSource || {};
    const noHuman = castMode === 'no_human';
    const animalOnly = castMode === 'animal';
    const roleText = roles.join('、') || text(getPersonSpec?.('roleName'));
    const title = within?.('#dhNsaPersonInferenceTitle');
    if (title) {
      title.textContent = noHuman
        ? '已确认：不需要人物出镜'
        : (animalOnly
          ? '已确认：以动物 / 宠物为主体'
          : (source.manualOverride
            ? `已使用你的设定：${count || '待定'} 位人物`
            : (source.kind === 'reference_video'
              ? `已根据参考内容识别：${count || '待定'} 位人物`
              : '人物将按当前内容自动判断')));
    }
    const description = within?.('#dhNsaPersonInferenceDescription');
    if (description) {
      description.textContent = noHuman
        ? '后续只生成产品、空间或品牌画面，人物素材与人数不会进入生成。'
        : (roleText
          ? `${roleText}${text(getPersonSpec?.('age')) && getPersonSpec('age') !== 'match_brief' ? '；表观年龄按已识别或已确认的范围执行' : ''}。需要调整时点击“修改人物设定”。`
          : '参考视频或广告需求识别完成后，这里会显示人物数量、角色和表演描述；不修改就沿用自动结果。');
    }
  }

  function toggle(state = {}, syncControls = () => {}) {
    state.personConstraintEditorOpen = state.personConstraintEditorOpen !== true;
    syncControls();
  }

  window.NewStoryAdPersonReferenceInheritance = { reset, markManual, applyReference, sync, toggle };
})();
