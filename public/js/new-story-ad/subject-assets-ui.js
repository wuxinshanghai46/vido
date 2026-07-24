(() => {
  function castProfiles(asset, { actorUrls, actorReferenceKind } = {}) {
    const members = Array.isArray(asset?.cast_assets) ? asset.cast_assets : [];
    if (!members.length) return null;
    return members.map((member, index) => {
      const urls = actorUrls(member);
      const profile = member.subject_profile && typeof member.subject_profile === 'object' ? member.subject_profile : {};
      return {
        ...profile,
        id: member.actor_id || member.id || `cast_${index + 1}`,
        name: profile.displayName || member.name || `人物${index + 1}`,
        displayName: profile.displayName || member.name || `人物${index + 1}`,
        roleName: profile.roleName || member.cast_role || member.role || `角色${index + 1}`,
        sourceType: actorReferenceKind(member),
        assetId: member.actor_asset_id || member.id || '',
        actor_asset_id: member.actor_asset_id || member.id || '',
        actor_id: member.actor_id || '',
        referenceImageUrl: member.image_url || urls[0] || '',
        image_url: member.image_url || urls[0] || '',
        extra_image_urls: urls.slice(1),
        view_images: Array.isArray(member.view_images) ? member.view_images : [],
        person_contract: member.person_contract || null,
        identityLock: { face: true, outfit: true, body: true },
      };
    });
  }
  function petProfiles(state, person, required) {
    if (!required) return [];
    return Array.isArray(state.petProfiles) ? state.petProfiles : [];
  }
  function assetCastMode(rawMode = '', count = 0, currentMode = '') {
    const raw = String(rawMode || '').toLowerCase();
    const current = String(currentMode || '').toLowerCase();
    if (raw === 'human_pet' || current === 'human_pet') return 'human_pet';
    if (['single', 'dual', 'group'].includes(raw)) return raw;
    const people = Math.max(0, Number(count) || 0);
    return people >= 3 ? 'group' : (people === 2 ? 'dual' : 'single');
  }
  function counts(spec = {}, animalOnly = false, state = {}) {
    const castProfiles = Array.isArray(state.castProfiles) ? state.castProfiles : [];
    const petProfiles = Array.isArray(state.petProfiles) ? state.petProfiles : [];
    const peopleDefault = spec.castMode === 'dual' ? 2 : (spec.castMode === 'single' ? 1 : castProfiles.length);
    const petDefault = ['animal', 'human_pet'].includes(spec.castMode) ? petProfiles.length : 0;
    const people = animalOnly ? 0 : Math.max(0, Math.min(12, Math.round(Number(spec.expectedPeople || peopleDefault) || 0)));
    const pets = ['animal', 'human_pet'].includes(spec.castMode)
      ? Math.max(0, Math.min(8, Math.round(Number(spec.expectedAnimals || petDefault) || 0)))
      : 0;
    return { people, pets, total: people + pets };
  }
  function clean(value = '', max = 800) {
    return String(value ?? '').trim().slice(0, max);
  }
  function normalizeHumanProfile(source = {}, index = 0) {
    return {
      ...source,
      id: clean(source.id || source.cast_id || source.castId || `cast_${index + 1}`, 80),
      displayName: clean(source.displayName || source.name || '', 120),
      name: clean(source.displayName || source.name || '', 120),
      roleName: clean(source.roleName || source.role || '', 120),
      appearanceText: clean(source.appearanceText || source.appearance?.userPrompt || source.appearance || '', 800),
      wardrobeText: clean(source.wardrobeText || source.wardrobe?.userPrompt || source.outfit || '', 600),
      hairMakeupText: clean(source.hairMakeupText || source.hairMakeup?.userPrompt || '', 400),
      negativeText: clean(source.negativeText || source.negative || '', 400),
    };
  }
  function normalizePetProfile(source = {}, index = 0) {
    return {
      ...source,
      id: clean(source.id || source.pet_id || source.petId || `pet_${index + 1}`, 80),
      name: clean(source.name || '', 120),
      type: clean(source.type || source.species || '', 120),
      breed: clean(source.breed || '', 160),
      appearance: clean(source.appearance || source.description || '', 600),
      reference_images: Array.isArray(source.reference_images) ? source.reference_images : [],
    };
  }
  function reconcileProfiles(state = {}, spec = {}) {
    const target = counts(spec, spec.castMode === 'animal', state);
    const existingHumans = Array.isArray(state.castProfiles) ? state.castProfiles : [];
    const existingPets = Array.isArray(state.petProfiles) ? state.petProfiles : [];
    state.castProfiles = Array.from({ length: target.people }, (_, index) => {
      const source = existingHumans[index] || {};
      const single = target.people === 1;
      return normalizeHumanProfile({
        ...source,
        displayName: source.displayName || source.name || (single ? spec.displayName : ''),
        roleName: source.roleName || source.role || (single ? spec.roleName : ''),
        appearanceText: source.appearanceText || source.appearance?.userPrompt || (single ? spec.appearanceText : ''),
        wardrobeText: source.wardrobeText || source.wardrobe?.userPrompt || source.outfit || (single ? spec.wardrobeText : ''),
        hairMakeupText: source.hairMakeupText || source.hairMakeup?.userPrompt || (single ? spec.hairMakeupText : ''),
        negativeText: source.negativeText || (single ? spec.negativeText : ''),
      }, index);
    });
    state.petProfiles = Array.from({ length: target.pets }, (_, index) => {
      const source = existingPets[index] || {};
      const single = target.pets === 1;
      return normalizePetProfile({
        ...source,
        type: source.type || source.species || (single ? spec.petType : ''),
        appearance: source.appearance || source.description || (single ? spec.petDescription : ''),
      }, index);
    });
    return target;
  }
  function profileErrors(state = {}, spec = {}) {
    const target = counts(spec, spec.castMode === 'animal', state);
    const errors = [];
    if (spec.castMode === 'single' && target.people !== 1) errors.push('单人模式的人物数量必须为 1');
    if (spec.castMode === 'dual' && target.people !== 2) errors.push('双人模式的人物数量必须为 2');
    if (spec.castMode === 'multi' && target.people < 3) errors.push('多人模式必须填写 3-12 的精确人数');
    if (['no_human', 'animal'].includes(spec.castMode) && target.people !== 0) errors.push('当前模式不能包含人物');
    if (!['animal', 'human_pet'].includes(spec.castMode) && target.pets !== 0) errors.push('当前模式不能包含宠物');
    if (spec.castMode === 'animal' && target.pets < 1) errors.push('纯宠物模式必须填写精确宠物数量');
    if (spec.castMode === 'human_pet' && (target.people < 1 || target.pets < 1)) errors.push('人物 + 宠物模式必须分别填写精确人数和宠物数量');
    if (!['no_human', 'animal'].includes(spec.castMode) && target.people < 1) errors.push('请填写 1-12 的精确人物数量');
    if ((state.castProfiles || []).length !== target.people) errors.push(`需要 ${target.people} 份独立人物档案`);
    if ((state.petProfiles || []).length !== target.pets) errors.push(`需要 ${target.pets} 份独立宠物档案`);
    (state.castProfiles || []).forEach((raw, index) => {
      const item = normalizeHumanProfile(raw, index);
      const missing = [
        ['姓名', item.displayName],
        ['身份/角色', item.roleName],
        ['外貌', item.appearanceText],
        ['服装', item.wardrobeText],
        ['发型/妆造', item.hairMakeupText],
      ].filter(([, value]) => !value).map(([label]) => label);
      if (missing.length) errors.push(`人物 ${index + 1} 缺少：${missing.join('、')}`);
    });
    (state.petProfiles || []).forEach((raw, index) => {
      const item = normalizePetProfile(raw, index);
      const missing = [['类型/品种', item.type], ['外观特征', item.appearance]]
        .filter(([, value]) => !value).map(([label]) => label);
      if (missing.length) errors.push(`宠物 ${index + 1} 缺少：${missing.join('、')}`);
    });
    const allIds = [...(state.castProfiles || []), ...(state.petProfiles || [])].map(item => item.id).filter(Boolean);
    if (new Set(allIds).size !== allIds.length) errors.push('人物和宠物的稳定 ID 不能重复');
    return errors;
  }
  function updateProfileFromField(state = {}, target = {}) {
    const kind = target.dataset?.nsaSubjectKind;
    const index = Number(target.dataset?.nsaSubjectIndex);
    const field = target.dataset?.nsaSubjectField;
    if (!['cast', 'pet'].includes(kind) || !Number.isInteger(index) || !field) return false;
    const list = kind === 'cast' ? state.castProfiles : state.petProfiles;
    if (!Array.isArray(list) || !list[index]) return false;
    list[index] = { ...list[index], [field]: clean(target.value, 800) };
    if (kind === 'cast' && field === 'displayName') list[index].name = list[index].displayName;
    return true;
  }
  function subjectEditorHtml(state = {}, spec = {}, escapeHtml = value => String(value)) {
    const target = reconcileProfiles(state, spec);
    if (!target.total) return '<div class="dh-luxgen-empty"><b>当前无需主体档案</b><span>无人物模式不会提交人物或宠物生成。</span></div>';
    const field = (kind, index, key, label, value, options = {}) => `<label class="${options.wide ? 'dh-luxgen-person-text-field' : ''}">
      <span>${escapeHtml(label)}</span>
      ${options.textarea
        ? `<textarea class="dh-input dh-luxgen-person-textarea" data-nsa-subject-kind="${kind}" data-nsa-subject-index="${index}" data-nsa-subject-field="${key}" maxlength="${options.max || 600}" placeholder="${escapeHtml(options.placeholder || '')}">${escapeHtml(value || '')}</textarea>`
        : `<input class="dh-input" data-nsa-subject-kind="${kind}" data-nsa-subject-index="${index}" data-nsa-subject-field="${key}" maxlength="${options.max || 120}" value="${escapeHtml(value || '')}" placeholder="${escapeHtml(options.placeholder || '')}">`}
    </label>`;
    const humans = (state.castProfiles || []).map((raw, index) => {
      const item = normalizeHumanProfile(raw, index);
      return `<details class="dh-nsa-subject-profile" open>
        <summary><b>人物 ${index + 1}</b><span>${escapeHtml(item.displayName || item.roleName || '资料待补齐')}</span></summary>
        <div class="dh-luxgen-person-spec">
          ${field('cast', index, 'displayName', '姓名 / 称呼', item.displayName, { placeholder: '如：妈妈林悦、孩子小满' })}
          ${field('cast', index, 'roleName', '剧情身份 / 关系', item.roleName, { placeholder: '如：母亲、8岁女儿、品牌顾问' })}
          ${field('cast', index, 'appearanceText', '独立外貌 / 年龄 / 气质', item.appearanceText, { textarea: true, wide: true, max: 800 })}
          ${field('cast', index, 'wardrobeText', '独立服装 / 鞋 / 配饰', item.wardrobeText, { textarea: true, wide: true, max: 600 })}
          ${field('cast', index, 'hairMakeupText', '独立发型 / 妆造', item.hairMakeupText, { textarea: true, wide: true, max: 400 })}
          ${field('cast', index, 'negativeText', '该人物禁止项（选填）', item.negativeText, { textarea: true, wide: true, max: 400 })}
        </div>
      </details>`;
    }).join('');
    const pets = (state.petProfiles || []).map((raw, index) => {
      const item = normalizePetProfile(raw, index);
      return `<details class="dh-nsa-subject-profile" open>
        <summary><b>宠物 ${index + 1}</b><span>${escapeHtml(item.name || item.type || '资料待补齐')}</span></summary>
        <div class="dh-luxgen-person-spec">
          ${field('pet', index, 'name', '名字（选填）', item.name)}
          ${field('pet', index, 'type', '类型 / 品种', item.type, { placeholder: '如：金毛犬、英短猫' })}
          ${field('pet', index, 'breed', '细分品种（选填）', item.breed)}
          ${field('pet', index, 'appearance', '独立毛色 / 体型 / 花纹 / 项圈', item.appearance, { textarea: true, wide: true, max: 600 })}
        </div>
      </details>`;
    }).join('');
    const errors = profileErrors(state, spec);
    return `<div class="dh-nsa-subject-profile-head"><b>逐主体独立档案</b><small>每个人物和宠物只使用自己的描述生成，不能共用外貌、服装或妆造。</small></div>
      ${errors.length ? `<div class="dh-task-warning">${escapeHtml(errors.join('；'))}</div>` : '<div class="dh-task-ok">逐主体档案数量和必填信息完整</div>'}
      ${humans}${pets}`;
  }
  function renderProfiles(host, state = {}, spec = {}, escape = value => String(value)) {
    if (host) host.innerHTML = subjectEditorHtml(state, spec, escape);
  }
  function adoptAssistedProfiles(state = {}, response = {}, spec = {}) {
    if (Array.isArray(response?.cast_profiles)) state.castProfiles = response.cast_profiles;
    if (Array.isArray(response?.pet_profiles)) state.petProfiles = response.pet_profiles;
    return reconcileProfiles(state, spec);
  }
  function confirmOptions({ people, pets, total }) {
    return {
      title: '生成独立主体资产', summary: `${people}个人物 + ${pets}个宠物`,
      description: '系统将为每个主体分别生成一套四视图身份资产并逐一验证，不会用同一张人物图代替多人或宠物。',
      confirmLabel: `确认生成 ${total} 套`,
      facts: [{ value: String(total), label: '图片模型提交', tone: 'warning' }, { value: String(total), label: '逐主体一致性验证', tone: 'neutral' }],
      note: '取消后服务端会在当前调用边界停止；已完成的主体检查点会保留，使用相同任务与设定重试时不会重复生成。',
    };
  }
  function progressStages(total) {
    return [
      { at: 0, percent: 10, message: `已提交 ${total} 份主体身份资产，服务端正在逐个生成四视图。` },
      { at: 8000, percent: 36, message: '正在生成并拆分人物 / 宠物四视图；取消后不会继续提交新的模型调用。' },
      { at: 18000, percent: 66, message: '正在逐个执行身份、外观与跨视图一致性验证。' },
      { at: 32000, percent: 84, message: '正在汇总已验证资产，并写入当前任务一致性合同。' },
    ];
  }
  function initialProgress(total) {
    return { active: true, startedAt: Date.now(), label: '主体身份资产', percent: 10, message: `已提交 ${total} 份主体身份资产，服务端正在逐个生成四视图。` };
  }
  function verificationTarget({ people, pets, personContract, petContract }) {
    const peopleReady = people === 0 || personContract?.status === 'verified';
    const petsReady = pets === 0 || petContract?.status === 'verified';
    return { passed: peopleReady && petsReady, contract: !peopleReady ? personContract : (!petsReady ? petContract : (personContract || petContract)), label: !peopleReady ? '人物' : '宠物' };
  }
  function petGrid(profiles, { escapeHtml, assetThumbUrl } = {}) {
    if (!Array.isArray(profiles) || !profiles.length) return '';
    return `<div class="dh-lux-actor-cast-grid">${profiles.map((pet, index) => {
      const refs = Array.isArray(pet.reference_images) ? pet.reference_images : [];
      const url = pet.image_url || refs[0] || '';
      return `<span>${url ? `<img src="${escapeHtml(assetThumbUrl(url, 320))}" alt="${escapeHtml(pet.name || `宠物${index + 1}`)}" loading="lazy" decoding="async">` : '<i class="dh-lux-actor-cast-placeholder">未生成</i>'}<b>${escapeHtml(pet.name || pet.type || `宠物${index + 1}`)}</b></span>`;
    }).join('')}</div>`;
  }
  window.NewStoryAdSubjectAssetsUI = {
    castProfiles, petProfiles, assetCastMode, counts, normalizeHumanProfile, normalizePetProfile,
    reconcileProfiles, profileErrors, updateProfileFromField, subjectEditorHtml, renderProfiles, adoptAssistedProfiles,
    confirmOptions, progressStages, initialProgress, verificationTarget, petGrid,
  };
})();
