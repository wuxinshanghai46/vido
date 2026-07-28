(() => {
  const OPTIONS = [
    ['match_brief', '按剧情关系判断'],
    ['infant_0_1', '婴儿 / 0-1'],
    ['toddler_1_3', '幼儿 / 1-3'],
    ['child_4_7', '儿童 / 4-7'],
    ['child_8_12', '少儿 / 8-12'],
    ['teen_13_17', '青少年 / 13-17'],
    ['young_adult_17_25', '年轻成人 / 17-25'],
    ['young_adult', '青年 / 25-32'],
    ['adult_30_40', '成熟青年 / 30-40'],
    ['middle_40_55', '中年 / 40-55'],
    ['senior_55_plus', '年长 / 55+'],
  ];
  const LABELS = {
    infant_0_1: '0-1岁婴儿年龄感',
    toddler_1_3: '1-3岁幼儿年龄感',
    child_4_7: '4-7岁儿童年龄感',
    child_8_12: '8-12岁少儿年龄感',
    teen_13_17: '13-17岁青少年年龄感',
    young_adult_17_25: '17-25岁年轻成人年龄感',
    young_adult: '25-32岁青年年龄感',
    adult_30_40: '30-40岁成熟青年年龄感',
    middle_40_55: '40-55岁中年年龄感',
    senior_55_plus: '55岁以上年长者年龄感',
  };
  function alignText(text = '', age = '', max = 800) {
    const label = LABELS[String(age || '')];
    if (!label) return String(text || '').trim().slice(0, max);
    const remainder = String(text || '')
      .replace(/\d{1,2}\s*(?:-|—|–|至|到|~)\s*\d{1,2}\s*岁?/g, '')
      .replace(/(?:年龄(?:约为|为|约)?|约|大约|看起来)?\s*\d{1,2}\s*(?:岁|周岁)(?:左右|上下)?/g, '')
      .replace(/(?:0-1|1-3|4-7|8-12|13-17|17-25|25-32|30-40|40-55)\s*岁?[^，。；]{0,10}(?:年龄感|婴儿|幼儿|儿童|少儿|青少年|成人|青年|中年|年长者)?/g, '')
      .replace(/^[\s，、；:：的]+|[\s，、；]+$/g, '')
      .replace(/[，、；]{2,}/g, '，');
    return `${label}，${remainder || '外貌、体态、肤质和表情应符合该年龄阶段的真实商业人物特征'}`.slice(0, max);
  }
  function invalidateAsset(state = {}) {
    const mark = asset => {
      if (!asset || typeof asset !== 'object') return asset;
      return {
        ...asset,
        production_usable_actor: false,
        _generationDirty: true,
        person_contract: asset.person_contract && typeof asset.person_contract === 'object'
          ? { ...asset.person_contract, status: 'outdated', invalidated_reason: 'person_profile_changed' }
          : asset.person_contract,
      };
    };
    const same = state.personAsset && state.personAsset === state.actorAsset;
    state.personAsset = mark(state.personAsset);
    state.actorAsset = same ? state.personAsset : mark(state.actorAsset);
  }
  function apply(state = {}, spec = {}, { scope = null, markDirty = false, normalizeProfile = value => value } = {}) {
    const age = String(spec.age || '').trim();
    const appearance = alignText(spec.appearanceText, age);
    if (scope?.querySelectorAll && appearance && appearance !== String(spec.appearanceText || '').trim()) {
      scope.querySelectorAll('[data-nsa-person-spec="appearanceText"]').forEach(field => { field.value = appearance; });
      spec.appearanceText = appearance;
    }
    if (!Array.isArray(state.castProfiles)) return spec;
    const single = state.castProfiles.length === 1;
    let changed = false;
    state.castProfiles = state.castProfiles.map((raw, index) => {
      const profile = normalizeProfile(raw, index);
      const effectiveAge = single ? (age || profile.age) : (profile.age || 'match_brief');
      const nextAppearance = alignText(single && spec.appearanceText ? spec.appearanceText : profile.appearanceText, effectiveAge);
      const dirtyFields = new Set(Array.isArray(profile._generationDirtyFields) ? profile._generationDirtyFields : []);
      if (markDirty && nextAppearance !== profile.appearanceText) dirtyFields.add('appearanceText');
      if (effectiveAge !== profile.age || nextAppearance !== profile.appearanceText) changed = true;
      return {
        ...profile, age: effectiveAge, appearanceText: nextAppearance,
        appearance: { ...(profile.appearance || {}), ageRange: effectiveAge, userPrompt: nextAppearance },
        ...(dirtyFields.size ? { _generationDirty: true, _generationDirtyFields: [...dirtyFields] } : {}),
      };
    });
    if (markDirty && changed) invalidateAsset(state);
    return spec;
  }
  function updateProfile(list = [], index = 0, value = '', target = null) {
    if (!list[index]) return false;
    const aligned = alignText(list[index].appearanceText, value);
    const dirtyFields = new Set(Array.isArray(list[index]._generationDirtyFields) ? list[index]._generationDirtyFields : []);
    dirtyFields.add('age'); dirtyFields.add('appearanceText');
    list[index] = {
      ...list[index], age: value, appearanceText: aligned,
      appearance: { ...(list[index].appearance || {}), ageRange: value, userPrompt: aligned },
      _generationDirty: true, _generationDirtyFields: [...dirtyFields],
    };
    const appearanceField = target?.closest?.('.dh-nsa-subject-profile')?.querySelector?.('[data-nsa-subject-field="appearanceText"]');
    if (appearanceField) appearanceField.value = aligned;
    return true;
  }
  function selectHtml(index, value, escapeHtml = String) {
    return `<label><span>该人物年龄</span><select class="dh-input" data-nsa-subject-kind="cast" data-nsa-subject-index="${index}" data-nsa-subject-field="age">${OPTIONS.map(([key, label]) => `<option value="${key}" ${String(value || 'match_brief') === key ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select></label>`;
  }
  window.NewStoryAdPersonAgeAuthority = { OPTIONS, LABELS, alignText, apply, updateProfile, selectHtml, invalidateAsset };
})();
