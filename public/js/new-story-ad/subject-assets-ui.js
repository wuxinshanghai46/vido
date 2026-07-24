(() => {
  function castProfiles(asset, { actorUrls, actorReferenceKind } = {}) {
    const members = Array.isArray(asset?.cast_assets) ? asset.cast_assets : [];
    if (!members.length) return null;
    return members.map((member, index) => {
      const urls = actorUrls(member);
      return {
        id: member.actor_id || member.id || `cast_${index + 1}`,
        name: member.name || `人物${index + 1}`,
        displayName: member.name || `人物${index + 1}`,
        roleName: member.cast_role || member.role || `角色${index + 1}`,
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
    if (Array.isArray(state.petProfiles) && state.petProfiles.length) return state.petProfiles;
    return [{ id: 'pet_1', type: person.petType || '按广告需求判断', appearance: person.petDescription || '', reference_images: [] }];
  }
  function counts(spec = {}, animalOnly = false) {
    const people = animalOnly ? 0 : (Number(spec.expectedPeople || 0) || (spec.castMode === 'dual' ? 2 : 1));
    const pets = ['animal', 'human_pet'].includes(spec.castMode) ? (Number(spec.expectedAnimals || 0) || 1) : 0;
    return { people, pets, total: people + pets };
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
  window.NewStoryAdSubjectAssetsUI = { castProfiles, petProfiles, counts, confirmOptions, progressStages, initialProgress, verificationTarget, petGrid };
})();
