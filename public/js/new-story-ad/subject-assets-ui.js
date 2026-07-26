(() => {
  const VIEW_LABELS = {
    front: '正面',
    side: '侧面',
    back: '背面',
    action: '动作',
  };

  /** 统一读取人物或宠物的四视图；单人、双人、多人和宠物共用同一数据合同。 */
  function subjectViews(asset = {}) {
    const raw = [
      ...(Array.isArray(asset.view_images) ? asset.view_images : []),
      ...(Array.isArray(asset.reference_images) ? asset.reference_images : []),
    ];
    const seen = new Set();
    return raw.map((view, index) => {
      const item = view && typeof view === 'object' ? view : {};
      const key = clean(item.key || item.view || ['front', 'side', 'back', 'action'][index] || `view_${index + 1}`, 40);
      const url = clean(typeof view === 'string' ? view : (item.url || item.image_url || item.imageUrl || ''), 1000);
      return { key, label: clean(item.label || VIEW_LABELS[key] || `视图 ${index + 1}`, 80), url };
    }).filter(view => view.url && !seen.has(view.url) && seen.add(view.url));
  }

  /** 汇总当前任务全部主体；每个成员保持自己的视图数组，不按模式复制展示分支。 */
  function subjectMembers(personAsset = null, petProfiles = []) {
    const cast = Array.isArray(personAsset?.cast_assets) && personAsset.cast_assets.length
      ? personAsset.cast_assets
      : (personAsset ? [personAsset] : []);
    const pets = Array.isArray(petProfiles) ? petProfiles : [];
    return [
      ...cast.map((asset, index) => ({ kind: 'person', asset, name: asset.name || asset.cast_role || `人物${index + 1}` })),
      ...pets.map((asset, index) => ({ kind: 'pet', asset, name: asset.name || asset.type || `宠物${index + 1}` })),
    ];
  }

  function subjectGalleryKey(kind = 'person', asset = {}, index = 0) {
    const id = asset.actor_id || asset.actor_asset_id || asset.pet_id || asset.asset_library_id
      || asset.material_id || asset.id || subjectViews(asset)[0]?.url
      || `${asset.name || asset.cast_role || asset.type || 'subject'}_${index + 1}`;
    return `${kind}:${clean(id, 260)}`;
  }

  /** 渲染按需加载的统一主体图库；首图立即显示，四视图仅在展开时请求缩略图。 */
  function subjectGalleryHtml(personAsset = null, petProfiles = [], {
    escapeHtml = value => String(value),
    assetThumbUrl = value => value,
    openKeys = null,
  } = {}) {
    const members = subjectMembers(personAsset, petProfiles);
    if (!members.length) return '';
    return `<div class="dh-nsa-subject-gallery">${members.map(({ kind, asset, name }, memberIndex) => {
      const views = subjectViews(asset);
      const mainUrl = asset.image_url || views[0]?.url || '';
      const title = `${name} · ${kind === 'pet' ? '宠物' : '人物'}参考`;
      const galleryKey = subjectGalleryKey(kind, asset, memberIndex);
      const isOpen = openKeys?.has?.(galleryKey) === true;
      const viewGrid = views.length > 1
        ? `<details class="dh-nsa-subject-views" data-nsa-subject-gallery data-nsa-subject-gallery-key="${escapeHtml(galleryKey)}"${isOpen ? ' open' : ''}>
            <summary data-nsa-subject-gallery-toggle aria-expanded="${isOpen ? 'true' : 'false'}"><span data-nsa-subject-gallery-label>${isOpen ? '收起四视图' : '查看四视图'}</span><em>${views.length} 张</em></summary>
            <div class="dh-lux-actor-views">${views.map((view, viewIndex) => `<button type="button" data-nsa-subject-preview-url="${escapeHtml(view.url)}" data-nsa-subject-preview-title="${escapeHtml(`${name} · ${view.label}`)}" title="${escapeHtml(view.label)}">
              <img ${isOpen ? 'src' : 'data-src'}="${escapeHtml(assetThumbUrl(view.url, 280))}" alt="${escapeHtml(`${name} ${view.label}`)}" loading="lazy" decoding="async">
              <span>${escapeHtml(view.label)}</span>
            </button>`).join('')}</div>
          </details>`
        : '';
      return `<article class="dh-nsa-subject-member" data-nsa-subject-kind="${kind}" data-nsa-subject-index="${memberIndex}">
        ${mainUrl ? `<button type="button" class="dh-nsa-subject-main" data-nsa-subject-preview-url="${escapeHtml(mainUrl)}" data-nsa-subject-preview-title="${escapeHtml(title)}">
          <img src="${escapeHtml(assetThumbUrl(mainUrl, 360))}" alt="${escapeHtml(name)}" loading="lazy" decoding="async">
        </button>` : '<i class="dh-lux-actor-cast-placeholder">未生成</i>'}
        <div class="dh-nsa-subject-member-copy"><b>${escapeHtml(name)}</b><small>${kind === 'pet' ? '宠物身份资产' : '人物身份资产'} · ${views.length || 1} 张参考</small></div>
        ${viewGrid}
      </article>`;
    }).join('')}</div>`;
  }

  function loadGalleryImages(container = null) {
    if (!container?.querySelectorAll) return 0;
    let loaded = 0;
    container.querySelectorAll('img[data-src]').forEach(image => {
      if (!image.dataset.src) return;
      image.src = image.dataset.src;
      delete image.dataset.src;
      loaded += 1;
    });
    return loaded;
  }

  function handleGalleryClick(event, host, openPreview, openKeys = null) {
    const target = event?.target;
    const toggle = target?.closest?.('[data-nsa-subject-gallery-toggle]');
    if (toggle && host?.contains?.(toggle)) {
      const gallery = toggle.closest('[data-nsa-subject-gallery]');
      const key = gallery?.dataset?.nsaSubjectGalleryKey || '';
      const nextOpen = gallery?.open !== true;
      if (key && openKeys?.add && openKeys?.delete) {
        if (nextOpen) openKeys.add(key);
        else openKeys.delete(key);
      }
      toggle.setAttribute?.('aria-expanded', nextOpen ? 'true' : 'false');
      const label = toggle.querySelector?.('[data-nsa-subject-gallery-label]');
      if (label) label.textContent = nextOpen ? '收起四视图' : '查看四视图';
      if (nextOpen) requestAnimationFrame(() => loadGalleryImages(gallery));
      return true;
    }
    const preview = target?.closest?.('[data-nsa-subject-preview-url]');
    if (!preview || !host?.contains?.(preview)) return false;
    event.preventDefault();
    event.stopPropagation();
    const url = preview.dataset.nsaSubjectPreviewUrl || '';
    if (url && typeof openPreview === 'function') {
      openPreview(url, preview.dataset.nsaSubjectPreviewTitle || '主体参考');
    }
    return true;
  }

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
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    const normalized = String(value).trim();
    return normalized === '[object Object]' ? '' : normalized.slice(0, max);
  }
  function firstProfileText(values = [], max = 800) {
    for (const value of values) {
      const normalized = clean(value, max);
      if (normalized) return normalized;
    }
    return '';
  }
  function humanProfileTexts(source = {}) {
    const contract = source.person_contract && typeof source.person_contract === 'object'
      ? source.person_contract
      : {};
    return {
      appearanceText: firstProfileText([
        source.appearanceText,
        source.appearance?.userPrompt,
        source.appearance?.description,
        contract.identity?.face_description,
        source.face_description,
        source.description,
      ], 800),
      wardrobeText: firstProfileText([
        source.wardrobeText,
        source.wardrobe?.userPrompt,
        source.wardrobe?.description,
        source.outfit,
        contract.wardrobe?.description,
      ], 600),
      hairMakeupText: firstProfileText([
        source.hairMakeupText,
        source.hairMakeup?.userPrompt,
        source.hairMakeup?.description,
        contract.appearance?.hair_style,
        source.hair_style,
      ], 400),
      negativeText: firstProfileText([source.negativeText, source.negative], 400),
    };
  }
  function normalizeHumanProfile(source = {}, index = 0) {
    const resolved = humanProfileTexts(source);
    return {
      ...source,
      id: clean(source.id || source.cast_id || source.castId || `cast_${index + 1}`, 80),
      displayName: clean(source.displayName || source.name || '', 120),
      name: clean(source.displayName || source.name || '', 120),
      roleName: clean(source.roleName || source.role || '', 120),
      ...resolved,
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
        appearanceText: humanProfileTexts(source).appearanceText || (single ? spec.appearanceText : ''),
        wardrobeText: humanProfileTexts(source).wardrobeText || (single ? spec.wardrobeText : ''),
        hairMakeupText: humanProfileTexts(source).hairMakeupText || (single ? spec.hairMakeupText : ''),
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
    const previous = clean(list[index][field], 800);
    const value = clean(target.value, 800);
    const dirtyFields = new Set(Array.isArray(list[index]._generationDirtyFields) ? list[index]._generationDirtyFields : []);
    if (previous !== value) dirtyFields.add(field);
    list[index] = {
      ...list[index],
      [field]: value,
      _generationDirty: dirtyFields.size > 0,
      _generationDirtyFields: [...dirtyFields],
    };
    if (kind === 'cast' && field === 'displayName') list[index].name = list[index].displayName;
    return true;
  }

  function syncProfileFieldsFromDom(state = {}, scope = document) {
    if (!scope?.querySelectorAll) return 0;
    let updated = 0;
    scope.querySelectorAll('[data-nsa-subject-field]').forEach(target => {
      if (updateProfileFromField(state, target)) updated += 1;
    });
    return updated;
  }

  function selectionItems(state = {}) {
    const humans = Array.isArray(state.castProfiles) ? state.castProfiles : [];
    const pets = Array.isArray(state.petProfiles) ? state.petProfiles : [];
    const personAsset = state.actorAsset || state.personAsset || {};
    const castAssets = Array.isArray(personAsset.cast_assets) ? personAsset.cast_assets : [];
    const reusable = (asset, kind) => !!(asset && (kind === 'human' ? asset.actor_id || asset.id : asset.pet_id || asset.id)
      && subjectViews(asset).length >= 4);
    const assetState = (raw, canReuse) => ({
      selected: raw?._generationDirty === true || !canReuse,
      reusable: canReuse, required: !canReuse, disabled: !canReuse,
    });
    const items = [
      ...humans.map((raw, index) => {
        const item = normalizeHumanProfile(raw, index);
        const asset = castAssets.find(candidate => [candidate.actor_id, candidate.id, candidate.actor_asset_id].includes(item.id)) || castAssets[index];
        const canReuse = reusable(asset, 'human');
        return {
          key: `human:${item.id || index + 1}`,
          kind: 'human',
          index,
          id: item.id,
          title: item.displayName || `人物 ${index + 1}`,
          status: item.wardrobeText ? `服装：${item.wardrobeText}` : (item.roleName || '人物四视图'),
          action: '重生四视图',
          ...assetState(raw, canReuse),
        };
      }),
      ...pets.map((raw, index) => {
        const item = normalizePetProfile(raw, index);
        const canReuse = reusable(raw, 'pet');
        return {
          key: `pet:${item.id || index + 1}`,
          kind: 'pet',
          index,
          id: item.id,
          title: item.name || item.type || `宠物 ${index + 1}`,
          status: item.appearance ? `特征：${item.appearance}` : (item.type || '宠物四视图'),
          action: '重生四视图',
          ...assetState(raw, canReuse),
        };
      }),
    ];
    const anyDirty = items.some(item => item.selected);
    return items.map(item => ({
      ...item,
      selected: anyDirty ? item.selected : false,
    }));
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
          <div class="dh-nsa-subject-profile-actions"><button type="button" class="dh-btn dh-btn-ghost dh-btn-sm" data-nsa-subject-assist-index="${index}">AI 辅助补齐该人物</button><small>只填当前人物的空白字段，不改动其他人物、宠物或已有四视图。</small></div>
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
  function confirmOptions({ people, pets, total, state = {} }) {
    const items = selectionItems(state);
    const initialCount = items.filter(item => item.selected).length;
    return {
      title: '生成独立主体资产', summary: `${people}个人物 + ${pets}个宠物`,
      description: '请勾选本次需要重新生成的主体。未勾选的人物或宠物会原样保留，不会再次提交图片模型。',
      confirmLabel: initialCount ? `确认生成所选 ${initialCount} 套` : '请先选择主体',
      facts: [{ value: String(initialCount), label: '当前选中提交', tone: 'warning' }, { value: String(total - initialCount), label: '保留原有资产', tone: 'neutral' }],
      items: items.map(item => ({ ...item, selectable: true, checked: item.selected })),
      note: '弹窗会显示当前即将提交的服装或外观文本；请先核对“裙子”等修改已经完整显示，再确认生成。',
      readSelection(modal) {
        const selected = Array.from(modal.querySelectorAll('[data-nsa-confirm-item]:checked'))
          .map(input => {
            const item = items.find(candidate => candidate.key === input.value);
            return item ? { kind: item.kind, index: item.index, id: item.id } : null;
          })
          .filter(Boolean);
        return selected.length
          ? { value: selected }
          : { error: '请至少选择一个需要重新生成的人物或宠物' };
      },
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
    subjectViews, subjectMembers, subjectGalleryKey, subjectGalleryHtml, loadGalleryImages, handleGalleryClick,
    castProfiles, petProfiles, assetCastMode, counts, humanProfileTexts, normalizeHumanProfile, normalizePetProfile,
    reconcileProfiles, profileErrors, updateProfileFromField, subjectEditorHtml, renderProfiles, adoptAssistedProfiles,
    syncProfileFieldsFromDom, selectionItems, confirmOptions, progressStages, initialProgress, verificationTarget, petGrid,
  };
})();
