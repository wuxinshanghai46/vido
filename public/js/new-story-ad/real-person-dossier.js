(() => {
  const state = {
    mounted: false,
    identitySource: null,
    outfitSource: null,
    production: null,
    pollTimer: null,
    activeTab: 'identity',
    loadedTaskId: '',
    adoptedFingerprint: '',
    modalOpen: false,
    lastErrorFingerprint: '',
  };

  const $ = selector => document.querySelector(selector);
  const api = () => window.NewStoryAdApi;
  const taskId = () => String(window.__newStoryAdLegacyUI?.state?.taskId || '');

  function notify(message, tone = 'info') {
    if (typeof window.showToast === 'function') window.showToast(message, tone);
    else if (tone === 'error') console.error(message);
  }

  function setModal(open = false) {
    state.modalOpen = open === true;
    const modal = $('#dhNsaRealPersonModal');
    if (modal) {
      modal.hidden = !state.modalOpen;
      modal.setAttribute('aria-hidden', state.modalOpen ? 'false' : 'true');
    }
    document.body.classList.toggle('dh-nsa-workbench-modal-open', state.modalOpen);
    if (state.modalOpen) {
      queueMicrotask(() => $('#dhNsaRealPersonClose')?.focus?.());
      loadProduction({ quiet: true });
    } else {
      $('#dhNsaRealPersonOpen')?.focus?.();
    }
  }

  async function confirmModelCalls({ title, summary, description, calls, confirmLabel }) {
    const confirmAction = window.__newStoryAdLegacyUI?.confirmAction;
    if (typeof confirmAction !== 'function') {
      notify('统一费用确认组件尚未就绪，请稍后重试', 'error');
      return false;
    }
    return (await confirmAction({
      title,
      summary,
      description,
      confirmLabel,
      cancelLabel: '暂不生成',
      tone: 'primary',
      facts: [
        { label: '预计图片模型调用', value: `${calls} 次`, tone: 'warning' },
        { label: '真人来源', value: '私有', tone: 'neutral' },
      ],
      note: '只有点击确认后才会创建任务；取消不会提交模型调用。',
    })) === true;
  }

  function activeJob(production = state.production || {}) {
    return ['candidate', 'dossier', 'action']
      .map(kind => ({ kind, job: production[`${kind}_job`] }))
      .find(item => ['queued', 'running', 'cancelling'].includes(item.job?.status)) || null;
  }

  function setProgress(production = {}) {
    const active = activeJob(production);
    const last = active || ['action', 'dossier', 'candidate']
      .map(kind => ({ kind, job: production[`${kind}_job`] }))
      .find(item => item.job);
    const wrap = $('#dhNsaPersonProductionProgress');
    if (wrap) wrap.hidden = !last?.job;
    const progress = Math.max(0, Math.min(100, Number(last?.job?.progress || 0)));
    const bar = wrap?.querySelector('progress');
    if (bar) bar.value = progress;
    const phase = $('#dhNsaPersonProductionPhase');
    if (phase) phase.textContent = last?.job?.phase || '等待生成';
    const percent = $('#dhNsaPersonProductionPercent');
    if (percent) percent.textContent = `${progress}%`;
    const cancel = $('#dhNsaCancelPersonProduction');
    if (cancel) {
      cancel.hidden = !active;
      cancel.dataset.kind = active?.kind || '';
    }
    if (last?.job?.error?.message) {
      const fingerprint = `${last.kind}:${last.job.status}:${last.job.error.code || ''}:${last.job.error.message}`;
      if (state.lastErrorFingerprint !== fingerprint) {
        state.lastErrorFingerprint = fingerprint;
        notify(last.job.error.message, 'error');
      }
    }
  }

  function imageCard(asset, title, action = null) {
    const card = document.createElement('article');
    const image = document.createElement('img');
    image.src = asset.image_url;
    image.alt = title;
    image.loading = 'lazy';
    const label = document.createElement('b');
    label.textContent = title;
    card.append(image, label);
    if (asset.qa) {
      const score = document.createElement('small');
      score.textContent = `身份 ${Math.round(Number(asset.qa.source_identity_score || 0) * 100)}% · 年龄一致 ${Math.round(Number(asset.qa.adult_age_consistency_score || 0) * 100)}%`;
      card.appendChild(score);
    }
    if (action) card.appendChild(action);
    return card;
  }

  function renderCandidates(production = {}) {
    const wrap = $('#dhNsaPersonCandidates');
    if (!wrap) return;
    wrap.replaceChildren();
    const candidates = production.candidates || [];
    wrap.hidden = !candidates.length;
    candidates.forEach((candidate, index) => {
      const button = document.createElement('button');
      button.className = 'dh-btn dh-btn-primary dh-btn-sm';
      button.type = 'button';
      button.dataset.nsaApproveOutfit = candidate.id;
      button.disabled = candidate.selectable !== true || production.approved_candidate_id === candidate.id;
      button.textContent = production.approved_candidate_id === candidate.id ? '已选为人物锚点' : (candidate.selectable ? '确认这个候选' : '身份校验未通过');
      wrap.appendChild(imageCard(candidate, `换装候选 ${index + 1}`, button));
    });
  }

  function assetsForTab(production = {}, tab = state.activeTab) {
    const dossier = production.dossier || {};
    if (tab === 'identity') return dossier.identity_views || [];
    if (tab === 'body') return dossier.body_views || [];
    if (tab === 'expression') return dossier.expressions || [];
    if (tab === 'action') return [...(dossier.base_actions || []), ...(production.action_assets || [])];
    if (tab === 'wardrobe') return production.approved_anchor ? [{ ...production.approved_anchor, key: production.wardrobe || 'approved_outfit_anchor' }] : [];
    return [];
  }

  function renderDossier(production = {}) {
    const dossierWrap = $('#dhNsaPersonDossier');
    const gallery = $('#dhNsaPersonDossierGallery');
    const actions = $('#dhNsaPersonDossierActions');
    const generate = $('#dhNsaGeneratePersonDossier');
    const approve = $('#dhNsaApprovePersonDossier');
    const generateActions = $('#dhNsaGenerateActionAssets');
    if (actions) actions.hidden = !production.approved_anchor;
    if (generate) generate.hidden = !!production.dossier;
    if (approve) approve.hidden = production.dossier?.status !== 'pending_approval';
    if (generateActions) generateActions.hidden = production.dossier?.status !== 'approved';
    if (!dossierWrap || !gallery) return;
    dossierWrap.hidden = !production.dossier;
    gallery.replaceChildren();
    dossierWrap.querySelectorAll('[data-nsa-dossier-tab]').forEach(button => {
      button.classList.toggle('active', button.dataset.nsaDossierTab === state.activeTab);
    });
    assetsForTab(production).forEach(asset => {
      const contract = asset.contract;
      const label = contract
        ? `镜头 ${Number(contract.shot_index || 0) + 1}：${contract.key_action}`
        : String(asset.key || asset.kind || '人物资产').replace(/_/g, ' ');
      gallery.appendChild(imageCard(asset, label));
    });
    if (production.dossier?.sheet?.image_url) {
      const sheet = document.createElement('a');
      sheet.href = production.dossier.sheet.image_url;
      sheet.target = '_blank';
      sheet.rel = 'noopener';
      sheet.textContent = '查看本地合成的完整人物设定档案';
      gallery.prepend(sheet);
    }
  }

  function render(production = state.production || {}) {
    state.production = production;
    const status = $('#dhNsaRealPersonState');
    if (status) {
      status.textContent = production.dossier?.status === 'approved'
        ? '人物档案已确认'
        : production.dossier
          ? '档案待确认'
          : production.approved_anchor
            ? '人物锚点已确认'
            : production.candidates?.length
              ? '请选择换装候选'
              : state.identitySource
                ? '真人来源已建立'
                : '未建立来源';
    }
    const open = $('#dhNsaRealPersonOpen');
    if (open) open.textContent = state.identitySource || production?.dossier || production?.candidates?.length
      ? '查看 / 继续配置'
      : '配置真人形象';
    setProgress(production);
    renderCandidates(production);
    renderDossier(production);
  }

  function stopPolling() {
    if (state.pollTimer) clearTimeout(state.pollTimer);
    state.pollTimer = null;
  }

  async function loadProduction({ quiet = false } = {}) {
    const id = taskId();
    if (!id) return;
    try {
      const result = await api().request(`/api/new-story-ad/tasks/${encodeURIComponent(id)}/person-production`);
      state.loadedTaskId = id;
      if (result.production?.source_identity_id && !state.identitySource) {
        state.identitySource = { id: result.production.source_identity_id };
      }
      if (result.production?.outfit_reference_id && !state.outfitSource) {
        state.outfitSource = { id: result.production.outfit_reference_id };
      }
      render(result.production);
      if (result.production?.dossier?.status === 'approved' && result.production?.action_job?.status === 'completed') {
        adoptApprovedProduction(result.production);
      }
      if (activeJob(result.production)) {
        state.pollTimer = setTimeout(() => loadProduction({ quiet: true }), 1200);
      } else {
        stopPolling();
      }
    } catch (error) {
      stopPolling();
      if (!quiet) notify(error.message, 'error');
    }
  }

  async function uploadSource(file, kind) {
    if (!file) return;
    if (!$('#dhNsaRealPersonRights')?.checked || !$('#dhNsaRealPersonAdult')?.checked) {
      notify('请先确认真人授权且主体已年满 18 周岁', 'error');
      return;
    }
    const form = new FormData();
    form.append('file', file);
    form.append('kind', kind);
    form.append('rights_confirmed', 'true');
    form.append('adult_confirmed', 'true');
    try {
      const result = await api().request('/api/new-story-ad/real-person-sources', {
        method: 'POST',
        body: form,
        timeoutMs: 120000,
      });
      if (kind === 'identity') {
        state.identitySource = result.source;
        const label = $('#dhNsaRealPersonIdentityName');
        if (label) label.textContent = `${result.source.original_name} · ${result.source.width}×${result.source.height}`;
      } else {
        state.outfitSource = result.source;
        const label = $('#dhNsaOutfitReferenceName');
        if (label) label.textContent = result.source.original_name;
      }
      render();
      notify(kind === 'identity' ? '真人身份来源已安全保存' : '服装参考图已保存', 'success');
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  function mode() {
    return document.querySelector('input[name="dhNsaOutfitMode"]:checked')?.value || 'ai_outfit';
  }

  function setWardrobeAssistStatus(message = '', status = 'idle') {
    const target = $('#dhNsaWardrobeSuggestionStatus');
    if (!target) return;
    target.textContent = message;
    target.className = status && status !== 'idle' ? `is-${status}` : '';
  }

  async function suggestWardrobe() {
    const id = taskId();
    if (!id) {
      setWardrobeAssistStatus('请先完成第一步并生成场景配置，再让 AI 根据当前剧情推荐服装。', 'error');
      notify('请先完成第一步并生成场景配置任务', 'error');
      return false;
    }
    const legacy = window.__newStoryAdLegacyUI;
    const flow = window.NewStoryAdGenerationFlow;
    if (!legacy?.state || typeof legacy.payload !== 'function' || !flow?.requestInlineGeneration) {
      setWardrobeAssistStatus('人物辅助模块尚未就绪，请刷新页面后重试。', 'error');
      return false;
    }
    const button = $('#dhNsaSuggestWardrobe');
    const old = button?.textContent || 'AI 推荐换装';
    if (button) {
      button.disabled = true;
      button.textContent = 'AI 推荐中…';
      button.classList.add('is-generating');
    }
    setWardrobeAssistStatus('正在结合当前人物身份、剧情、场景和商品定位补齐服装要求…', 'running');
    try {
      const body = legacy.payload();
      const profiles = Array.isArray(body.cast_profiles) ? body.cast_profiles : [];
      const current = profiles[0] || {
        id: 'cast_1',
        displayName: body.person_spec?.displayName || '',
        roleName: body.person_spec?.roleName || '',
        appearanceText: body.person_spec?.appearanceText || '',
      };
      const response = await flow.requestInlineGeneration(
        'assist_real_person_wardrobe',
        {
          state: legacy.state,
          api: (path, options) => api().request(path, options),
        },
        {
          label: '正在推荐真人换装方案…',
          showGlobalProgress: false,
          timeoutMs: 120000,
          body: {
            ...body,
            mode: 'person_spec',
            cast_profiles: [current],
            pet_profiles: [],
            assist_subject_target: { kind: 'human', index: 0, id: current.id || 'cast_1' },
          },
        },
      );
      const suggestion = response.cast_profiles?.[0]?.wardrobeText
        || response.cast_profiles?.[0]?.wardrobe_text
        || response.person_spec?.wardrobeText
        || response.person_spec?.wardrobe_text
        || '';
      if (!String(suggestion).trim()) throw new Error('AI 没有返回可用的服装建议，请重试');
      const wardrobe = String(suggestion).trim().slice(0, 1000);
      const input = $('#dhNsaRealPersonWardrobe');
      if (input) {
        input.value = wardrobe;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      }
      if (Array.isArray(legacy.state.castProfiles) && legacy.state.castProfiles[0]) {
        legacy.state.castProfiles[0].wardrobeText = wardrobe;
        legacy.state.castProfiles[0]._generationDirty = true;
        legacy.state.castProfiles[0]._generationDirtyFields = [
          ...new Set([...(legacy.state.castProfiles[0]._generationDirtyFields || []), 'wardrobeText']),
        ];
      }
      setWardrobeAssistStatus('AI 已填写具体换装方案，请检查或修改后再生成候选。', 'success');
      notify('AI 已根据当前剧情补齐换装要求，请确认后再生成图片', 'success');
      return true;
    } catch (error) {
      setWardrobeAssistStatus(`推荐失败：${error.message || '模型服务未响应'}，可以点击重试。`, 'error');
      notify(error.message || 'AI 推荐换装失败', 'error');
      return false;
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = old;
        button.classList.remove('is-generating');
      }
    }
  }

  async function generateCandidates() {
    const id = taskId();
    if (!id) {
      notify('请先完成第一步并生成场景配置任务', 'error');
      return;
    }
    if (!state.identitySource?.id) {
      notify('请先上传授权真人正面照', 'error');
      return;
    }
    if (mode() === 'outfit_reference' && !state.outfitSource?.id) {
      notify('服装参考图模式需要先上传服装参考图', 'error');
      return;
    }
    if (mode() === 'ai_outfit' && !String($('#dhNsaRealPersonWardrobe')?.value || '').trim()) {
      setWardrobeAssistStatus('请先写明需要换成什么衣着，或点击“AI 推荐换装”自动补齐。', 'error');
      notify('请先填写换装要求，或点击“AI 推荐换装”', 'error');
      return;
    }
    if (!await confirmModelCalls({
      title: '生成严格参考换装候选',
      summary: '本次将生成 2 个候选，供人工选择人物锚点。',
      description: '候选会同时参考已授权真人照片与当前服装要求，不会自动继续生成完整人物档案。',
      calls: 2,
      confirmLabel: '确认生成 2 个候选',
    })) return;
    try {
      const result = await api().request(`/api/new-story-ad/tasks/${encodeURIComponent(id)}/person-outfit-candidates`, {
        method: 'POST',
        body: {
          source_id: state.identitySource.id,
          outfit_source_id: state.outfitSource?.id || '',
          mode: mode(),
          wardrobe: $('#dhNsaRealPersonWardrobe')?.value || '',
        },
      });
      render(result.production);
      stopPolling();
      state.pollTimer = setTimeout(() => loadProduction({ quiet: true }), 500);
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function approveCandidate(candidateId) {
    try {
      const result = await api().request(`/api/new-story-ad/tasks/${encodeURIComponent(taskId())}/person-outfit-candidates/${encodeURIComponent(candidateId)}/approve`, { method: 'POST' });
      render(result.production);
      notify('换装候选已锁定为人物锚点', 'success');
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function startDossier() {
    if (!await confirmModelCalls({
      title: '生成完整人物档案',
      summary: '完整档案包含 17 项原子资产。',
      description: '将生成身体视图、身份细节、表情与基础动作；生成后仍需人工确认，才会写入后续分镜。',
      calls: 17,
      confirmLabel: '确认生成完整档案',
    })) return;
    try {
      const result = await api().request(`/api/new-story-ad/tasks/${encodeURIComponent(taskId())}/person-dossiers`, { method: 'POST' });
      render(result.production);
      stopPolling();
      state.pollTimer = setTimeout(() => loadProduction({ quiet: true }), 500);
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function approveDossier() {
    try {
      const result = await api().request(`/api/new-story-ad/tasks/${encodeURIComponent(taskId())}/person-dossiers/approve`, { method: 'POST' });
      render(result.production);
      adoptApprovedProduction(result.production);
      notify('人物档案已确认并写入当前任务，后续分镜将使用该人物资产', 'success');
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  function adoptApprovedProduction(production = {}) {
    const dossier = production.dossier;
    if (dossier?.status !== 'approved') return false;
    const fingerprint = [
      dossier.id,
      dossier.revision,
      production.versions?.action || 0,
      (production.action_assets || []).length,
    ].join(':');
    if (state.adoptedFingerprint === fingerprint) return true;
    const actionViews = (production.action_assets || []).map(item => ({
      view: `action_shot_${Number(item.contract?.shot_index || 0)}`,
      image_url: item.image_url,
      file_url: item.image_url,
      action_contract: item.contract,
    }));
    const asset = {
      id: dossier.id,
      actor_asset_id: dossier.id,
      image_url: dossier.reference_board?.image_url || production.approved_anchor?.image_url || '',
      file_url: dossier.reference_board?.image_url || production.approved_anchor?.image_url || '',
      subject_board_url: dossier.reference_board?.image_url || '',
      view_images: [
        ...(dossier.body_views || []).map(item => ({ view: item.key, image_url: item.image_url, file_url: item.image_url })),
        ...actionViews,
      ],
      extra_image_urls: (dossier.atomic_assets || []).map(item => item.image_url),
      action_assets: production.action_assets || [],
      real_person_reference: true,
      production_usable_actor: true,
      source: 'authorized_real_person_dossier',
      reference_kind: 'authorized_real_actor',
      source_identity_id: production.source_identity_id,
      strict_reference_required: true,
      input_fidelity: 'high',
      dossier_revision: dossier.revision,
    };
    const adopted = window.__newStoryAdLegacyUI?.adoptPersonDossier?.(asset) === true;
    if (adopted) state.adoptedFingerprint = fingerprint;
    return adopted;
  }

  async function startActionAssets() {
    const storyboardShots = window.__newStoryAdLegacyUI?.state?.shots;
    const actionCount = Math.max(1, Math.min(30, Array.isArray(storyboardShots) ? storyboardShots.length : 0));
    if (!await confirmModelCalls({
      title: '生成逐镜动作参考',
      summary: '只为当前分镜中确有需要的动作生成三联图。',
      description: '每个动作资产调用 1 次图片模型，实际数量以当前分镜动作合同为准。',
      calls: `最多 ${actionCount}`,
      confirmLabel: '确认生成动作参考',
    })) return;
    try {
      const result = await api().request(`/api/new-story-ad/tasks/${encodeURIComponent(taskId())}/person-action-assets`, { method: 'POST' });
      render(result.production);
      stopPolling();
      state.pollTimer = setTimeout(() => loadProduction({ quiet: true }), 500);
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function cancelProduction(kind) {
    if (!kind) return;
    try {
      const result = await api().request(`/api/new-story-ad/tasks/${encodeURIComponent(taskId())}/person-production/${encodeURIComponent(kind)}/cancel`, { method: 'POST' });
      render(result.production);
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  function bind() {
    if (state.mounted) return;
    state.mounted = true;
    document.addEventListener('click', event => {
      if (event.target?.closest?.('#dhNsaRealPersonOpen')) setModal(true);
      if (event.target?.closest?.('#dhNsaRealPersonClose, [data-nsa-real-person-close]')) setModal(false);
      if (event.target?.closest?.('#dhNsaRealPersonIdentityPick')) $('#dhNsaRealPersonIdentityFile')?.click();
      if (event.target?.closest?.('#dhNsaOutfitReferencePick')) $('#dhNsaOutfitReferenceFile')?.click();
      if (event.target?.closest?.('#dhNsaSuggestWardrobe')) suggestWardrobe();
      if (event.target?.closest?.('#dhNsaGenerateOutfitCandidates')) generateCandidates();
      if (event.target?.closest?.('#dhNsaGeneratePersonDossier')) startDossier();
      if (event.target?.closest?.('#dhNsaApprovePersonDossier')) approveDossier();
      if (event.target?.closest?.('#dhNsaGenerateActionAssets')) startActionAssets();
      const cancel = event.target?.closest?.('#dhNsaCancelPersonProduction');
      if (cancel) cancelProduction(cancel.dataset.kind);
      const approve = event.target?.closest?.('[data-nsa-approve-outfit]');
      if (approve) approveCandidate(approve.dataset.nsaApproveOutfit);
      const tab = event.target?.closest?.('[data-nsa-dossier-tab]');
      if (tab) {
        state.activeTab = tab.dataset.nsaDossierTab;
        renderDossier(state.production || {});
      }
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && state.modalOpen) setModal(false);
    });
    document.addEventListener('change', event => {
      if (event.target?.id === 'dhNsaRealPersonIdentityFile') {
        const file = event.target.files?.[0];
        event.target.value = '';
        uploadSource(file, 'identity');
      }
      if (event.target?.id === 'dhNsaOutfitReferenceFile') {
        const file = event.target.files?.[0];
        event.target.value = '';
        uploadSource(file, 'outfit');
      }
      if (event.target?.name === 'dhNsaOutfitMode') {
        const row = $('#dhNsaOutfitReferenceRow');
        if (row) row.hidden = mode() !== 'outfit_reference';
      }
    });
    const taskWatcher = setInterval(() => {
      const id = taskId();
      if (id && id !== state.loadedTaskId && !activeJob()) loadProduction({ quiet: true });
      if (!document.documentElement.contains($('#dhNsaRealPersonStudio'))) clearInterval(taskWatcher);
    }, 1500);
  }

  window.NewStoryAdRealPersonDossier = {
    bind,
    loadProduction,
    setModal,
    suggestWardrobe,
    current: () => state.production,
  };
  document.addEventListener('new-story-ad:mount', bind);
  if (document.readyState !== 'loading') bind();
})();
