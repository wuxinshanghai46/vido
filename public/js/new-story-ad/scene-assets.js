(() => {
  const VIEW_LABELS = {
    master: '主视角',
    reverse: '反向/侧向',
    interaction: '互动位',
    detail: '材质细节',
    layout: '俯视布局',
  };

  const clean = (value = '', max = 1000) => String(value || '').trim().slice(0, max);
  const root = () => document.getElementById('dhNewStoryAdLegacyMount') || document;

  function verificationView(asset = {}) {
    const contract = asset.scene_contract && typeof asset.scene_contract === 'object' ? asset.scene_contract : {};
    const qa = asset.cross_view_qa || contract.cross_view_qa || {};
    const requirementQa = asset.requirement_qa || contract.requirement_qa || {};
    const details = asset.verification || contract.verification || {};
    const reasons = [...new Set([
      ...(Array.isArray(details.reasons) ? details.reasons : []),
      ...(Array.isArray(qa.mismatch_reasons) ? qa.mismatch_reasons : []),
      ...(Array.isArray(requirementQa.mismatch_reasons) ? requirementQa.mismatch_reasons : []),
    ].map(value => clean(value, 240)).filter(Boolean))].slice(0, 6);
    const scores = [
      ['空间', qa.scene_consistency_score],
      ['结构', qa.geometry_consistency_score || qa.anchor_consistency_score],
      ['材质', qa.material_consistency_score || qa.material_match_score],
      ['需求布局', requirementQa.layout_match_score],
      ['需求材质/光线', requirementQa.material_light_match_score],
      ['互动空间', requirementQa.interaction_match_score],
      ['表面结构', requirementQa.surface_topology_match_score],
      ['禁止项', requirementQa.negative_compliance_score],
    ].map(([label, value]) => ({ label, value: Number(value) }))
      .filter(item => Number.isFinite(item.value) && item.value > 0)
      .map(item => ({ ...item, percent: Math.round(Math.max(0, Math.min(1, item.value)) * 100) }));
    if (contract.status === 'verified' && qa.pass === true && requirementQa.pass === true) {
      return { tone: 'verified', label: '空间锁已验证', message: details.message || '当前场景版本已通过需求符合度与跨视图一致性验证', reasons: [], scores };
    }
    if (contract.status === 'rejected') {
      return { tone: 'rejected', label: '场景验证未通过', message: details.message || reasons[0] || '场景未满足原始要求或跨视图不一致', reasons, scores };
    }
    if (details.state === 'unavailable' || contract.qa_unavailable === true) {
      return { tone: 'unavailable', label: '场景验证异常', message: details.message || '视觉审核暂时不可用，请稍后重试', reasons };
    }
    return { tone: 'unverified', label: '空间锁待验证', message: details.message || '首次使用或场景版本变化后需要验证一次', reasons };
  }

  function verificationDetailsHtml(view = {}, escapeHtml = value => value) {
    const lines = [view.message, ...(view.reasons || []).filter(reason => reason !== view.message)].filter(Boolean);
    if (!lines.length || view.tone === 'verified') return '';
    return `<div class="dh-nsa-verification-details is-${escapeHtml(view.tone || 'unverified')}"><b>${escapeHtml(view.label)}</b>${(view.scores || []).length ? `<div class="dh-nsa-verification-scores">${view.scores.map(item => `<em>${escapeHtml(item.label)} ${item.percent}%</em>`).join('')}</div>` : ''}${lines.map(line => `<span>${escapeHtml(line)}</span>`).join('')}</div>`;
  }

  function specPayload() {
    const scope = root();
    const value = key => clean(scope.querySelector(`[data-nsa-scene-spec="${key}"]`)?.value || '', key === 'negativeText' ? 500 : 600);
    return {
      mode: clean(scope.querySelector('#dhNsaAdSceneMode')?.value || 'auto', 40),
      layoutText: value('layoutText'),
      materialLightText: value('materialLightText'),
      interactionText: value('interactionText'),
      negativeText: value('negativeText'),
      surfaceTopology: {
        mode: value('surfaceTopology.mode') || 'auto',
        seam_policy: value('surfaceTopology.seam_policy') || 'auto',
        finish_distribution: value('surfaceTopology.finish_distribution') || 'auto',
        notes: value('surfaceTopology.notes'),
      },
    };
  }

  function hasContinuousSurfaceIntent(spec = {}) {
    const topology = spec.surfaceTopology || spec.surface_topology || {};
    const text = [spec.layoutText, spec.materialLightText, spec.negativeText, topology.notes].filter(Boolean).join(' ');
    return /一整面|整面(?:连续|完整)|连续(?:、|，|和|且)?完整|完整(?:、|，|和|且)?连续|一面完整的?(?:背景)?墙|连续基面|无缝(?:墙|基面|表面)|single\s+(?:continuous|uninterrupted)\s+(?:wall|surface|plane)|one\s+(?:continuous|uninterrupted)\s+(?:wall|surface|plane)|no\s+(?:visible\s+)?(?:panel|module|tile|grid|seam)/i.test(text)
      || /(?:禁止|不得|不要|严禁|避免)[^。；;]{0,48}(?:模块化|模块|拼板|板块|网格墙|样品墙|展示墙|可见接缝|拼缝)/i.test(text);
  }

  function reconcileSurfaceIntent(spec = {}, { syncControls = false } = {}) {
    const source = spec && typeof spec === 'object' ? spec : {};
    const current = source.surfaceTopology || source.surface_topology || {};
    if (!hasContinuousSurfaceIntent(source)) return { spec: source, changed: false };
    const topology = {
      ...current,
      mode: 'continuous',
      seam_policy: 'hidden',
      finish_distribution: current.finish_distribution === 'sample_comparison'
        ? 'regional'
        : (current.finish_distribution || 'auto'),
    };
    const changed = current.mode !== topology.mode
      || current.seam_policy !== topology.seam_policy
      || current.finish_distribution !== topology.finish_distribution;
    const next = { ...source, surfaceTopology: topology };
    if (syncControls && changed) applySpec(next, { clearMissing: false });
    return { spec: next, changed };
  }

  function requiresLayoutView(spec = {}) {
    const text = [spec.layoutText, spec.interactionText, spec.surfaceTopology?.notes].filter(Boolean).join(' ');
    if (/俯视|俯拍|鸟瞰|顶视|平面图|轴测|空间全貌|top.?down|bird.?s.?eye|floor.?plan|axonometric/i.test(text)) return true;
    if (/多区域|多个区域|跨区域|多入口|多个入口|双入口|多空间|多个空间|长运镜|连续穿行|跨区走位/i.test(text)) return true;
    const zoneHints = text.match(/主展示区|展示区|互动区|行动区|操作区|接待区|入口区|出口区|通道|走廊|前厅|后场|工作区|休息区|厨房|客厅/g) || [];
    return new Set(zoneHints).size >= 3 && /动线|路径|走位|穿行|进入|离开|绕行|连续摄影机/i.test(text);
  }

  function averagePercent(qa = {}, keys = []) {
    const values = keys.map(key => Number(qa?.[key])).filter(Number.isFinite);
    if (!values.length) return 0;
    return Math.round((values.reduce((sum, value) => sum + Math.max(0, Math.min(1, value)), 0) / values.length) * 100);
  }

  function applySpecSuggestion(spec = {}) {
    const scope = root();
    let changed = false;
    Object.entries(spec || {}).forEach(([key, value]) => {
      const el = scope.querySelector(`[data-nsa-scene-spec="${key}"]`);
      const text = clean(value || '', 700);
      if (el && text && !clean(el.value || '', 10)) {
        el.value = text;
        changed = true;
      }
    });
    const topology = spec.surfaceTopology || spec.surface_topology || {};
    ['mode', 'seam_policy', 'finish_distribution', 'notes'].forEach(key => {
      const el = scope.querySelector(`[data-nsa-scene-spec="surfaceTopology.${key}"]`);
      const value = topology[key] ?? topology[key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())];
      const text = clean(value || '', 300);
      const current = clean(el?.value || '', 60);
      if (el && text && (!current || current === 'auto')) {
        el.value = text;
        changed = true;
      }
    });
    return changed;
  }

  function applySpec(spec = {}, options = {}) {
    const scope = root();
    const clearMissing = options.clearMissing !== false;
    const source = spec && typeof spec === 'object' ? spec : {};
    ['layoutText', 'materialLightText', 'interactionText', 'negativeText'].forEach(key => {
      const el = scope.querySelector(`[data-nsa-scene-spec="${key}"]`);
      if (!el) return;
      const value = source[key];
      if (value !== undefined && value !== null) {
        el.value = String(value);
      } else if (clearMissing) {
        el.value = '';
      }
    });
    const topology = source.surfaceTopology || source.surface_topology || {};
    ['mode', 'seam_policy', 'finish_distribution', 'notes'].forEach(key => {
      const el = scope.querySelector(`[data-nsa-scene-spec="surfaceTopology.${key}"]`);
      if (!el) return;
      const value = topology[key] ?? topology[key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())];
      if (value !== undefined && value !== null) el.value = String(value);
      else if (clearMissing) el.value = key === 'notes' ? '' : 'auto';
    });
    const mode = scope.querySelector('#dhNsaAdSceneMode');
    if (mode) {
      if (source.mode) mode.value = String(source.mode);
      else if (clearMissing) mode.value = 'auto';
    }
  }

  function clearSpecInputs() {
    applySpec({}, { clearMissing: true });
  }

  function normalizeView(view = {}, index = 0) {
    const key = clean(view.key || view.view || ['master', 'reverse', 'interaction', 'detail'][index] || `view_${index + 1}`, 40);
    const url = clean(view.url || view.image_url || view.imageUrl || view.file_url || '', 1000);
    return {
      ...view,
      key,
      label: clean(view.label || VIEW_LABELS[key] || `视角 ${index + 1}`, 80),
      url,
      image_url: clean(view.image_url || url, 1000),
    };
  }

  function normalizeAsset(asset = {}, index = 0) {
    if (!asset || typeof asset !== 'object') return null;
    const rawViews = Array.isArray(asset.view_images)
      ? asset.view_images
      : (Array.isArray(asset.views) ? asset.views : []);
    const views = rawViews.length
      ? rawViews.map(normalizeView).filter(view => view.url || view.image_url)
      : [];
    const url = clean(asset.image_url || asset.url || views[0]?.url || views[0]?.image_url || '', 1000);
    if (!url && !views.length) return null;
    return {
      ...asset,
      id: clean(asset.id || asset.scene_id || `scene_${index + 1}`, 120),
      scene_id: clean(asset.scene_id || asset.id || `scene_${index + 1}`, 120),
      name: clean(asset.name || `任务场景 ${index + 1}`, 120),
      lock_strength: clean(asset.lock_strength || asset.lockStrength || 'standard', 40),
      image_url: url,
      url,
      view_images: views,
      view_count: Number(asset.view_count || views.length || (url ? 1 : 0)) || 0,
      scene_revision: Math.max(1, Number(asset.scene_revision || asset.sceneRevision || 1) || 1),
      scene_contract: asset.scene_contract && typeof asset.scene_contract === 'object' ? asset.scene_contract : null,
      cross_view_qa: asset.cross_view_qa || asset.scene_contract?.cross_view_qa || null,
      requirement_qa: asset.requirement_qa || asset.scene_contract?.requirement_qa || null,
      layout_contract: asset.layout_contract || asset.scene_contract?.layout_contract || null,
    };
  }

  function normalizeAssets(input = []) {
    const raw = Array.isArray(input) ? input : [];
    return raw.map(normalizeAsset).filter(Boolean);
  }

  function escapeHtml(value = '') {
    return String(value || '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[ch]));
  }

  function thumbUrl(url = '', width = 480) {
    const raw = String(url || '').trim();
    if (!/^\/api\/new-story-ad\/assets\//i.test(raw)) return raw;
    const size = Math.max(160, Math.min(960, Number(width) || 480));
    return `${raw}${raw.includes('?') ? '&' : '?'}thumb=${size}`;
  }

  function formatElapsedText(ms = 0) {
    const sec = Math.max(0, Math.round(Number(ms) / 1000) || 0);
    if (sec >= 60) return `${Math.floor(sec / 60)}分${String(sec % 60).padStart(2, '0')}秒`;
    return `${sec}秒`;
  }

  function sceneProgressView(progress = {}) {
    const startedAt = Number(progress.startedAt || 0) || Date.now();
    const elapsed = Math.max(0, Date.now() - startedAt);
    const total = Math.max(1, Number(progress.total || 4) || 4);
    const completed = Math.max(0, Math.min(total, Number(progress.completed || 0) || 0));
    const current = Math.max(1, Math.min(total, Number(progress.current || completed + 1) || 1));
    const pct = Math.max(8, Math.min(96, Math.round(Number(progress.percent || ((completed / total) * 100)) || 18)));
    const viewLabel = ['主视角', '反向/侧向', '互动位', '材质细节', '俯视布局'][current - 1] || `视角 ${current}`;
    return {
      pct,
      completed,
      current,
      total,
      viewLabel,
      elapsedText: formatElapsedText(elapsed),
      message: progress.message || `已完成 ${completed}/${total} 张，正在生成第 ${current}/${total} 张：${viewLabel}。`,
    };
  }

  function render({ host, state = {} } = {}) {
    if (!host) return;
    const assets = normalizeAssets(state.sceneAssets || []);
    const progress = state.sceneGenerationProgress || null;
    if (progress?.active) {
      const view = sceneProgressView(progress);
      host.innerHTML = `<div class="dh-nsa-scene-card">
        <div class="dh-nsa-scene-thumb">生成中</div>
        <div class="dh-nsa-scene-body">
          <div class="dh-lux-person-progress">
            <div class="dh-lux-person-progress-head">
              <b>正在生成场景参考：第 ${view.current}/${view.total} 张</b>
              <span class="dh-lux-person-progress-stat"><em>耗时 ${escapeHtml(view.elapsedText)}</em><i>${view.pct}%</i></span>
            </div>
            <div class="dh-lux-person-progress-track" aria-hidden="true"><i style="width:${view.pct}%"></i></div>
            <small>${escapeHtml(view.message)}</small>
          </div>
        </div>
      </div>`;
      return;
    }
    if (!assets.length) {
      host.innerHTML = `<div class="dh-nsa-scene-card is-empty">
        <div class="dh-nsa-scene-thumb">空间</div>
        <div class="dh-nsa-scene-body">
          <b>未生成场景参考</b>
          <span>可在生成剧本前先锁定当前任务的空间布局、材质和光线；复杂场景会自动增加俯视布局参考。</span>
        </div>
      </div>`;
      return;
    }
    const selectedIndex = Math.max(0, Math.min(assets.length - 1, Number(state.sceneSelectedIndex || 0) || 0));
    state.sceneSelectedIndex = selectedIndex;
    const asset = assets[selectedIndex];
    const views = asset.view_images || [];
    const mainUrl = asset.url || asset.image_url || views[0]?.url || views[0]?.image_url || '';
    const contract = asset.scene_contract || {};
    const qa = asset.cross_view_qa || contract.cross_view_qa || {};
    const requirementQa = asset.requirement_qa || contract.requirement_qa || {};
    const qaPassed = contract.status === 'verified' && qa.pass === true && requirementQa.pass === true;
    const qaScore = Number(qa.scene_consistency_score || 0);
    const requirementScore = averagePercent(requirementQa, ['layout_match_score', 'material_light_match_score', 'interaction_match_score', 'surface_topology_match_score', 'negative_compliance_score']);
    const crossViewScore = averagePercent(qa, ['scene_consistency_score', 'geometry_consistency_score', 'material_consistency_score']);
    const sceneVerification = verificationView(asset);
    const canReverify = !qaPassed && ['unavailable', 'unverified'].includes(sceneVerification.tone);
    host.innerHTML = `<div class="dh-nsa-scene-list">
      ${assets.length ? `<div class="dh-nsa-scene-tabs">
        ${assets.map((item, index) => `<div class="dh-nsa-scene-tab ${index === selectedIndex ? 'active' : ''}">
          <button type="button" data-nsa-scene-select="${index}">
            <b>场景 ${index + 1}</b><span>${escapeHtml(item.name || '任务场景')}</span>
          </button>
          <button type="button" class="dh-nsa-scene-delete" data-nsa-scene-delete="${index}" aria-label="删除场景 ${index + 1}">×</button>
        </div>`).join('')}
      </div>` : ''}
      <div class="dh-nsa-scene-card">
        <button type="button" class="dh-nsa-scene-thumb dh-nsa-scene-main-preview" data-nsa-scene-preview="${selectedIndex}:0">
          ${mainUrl ? `<img src="${escapeHtml(thumbUrl(mainUrl, 560))}" alt="${escapeHtml(asset.name || `任务场景 ${selectedIndex + 1}`)}" loading="eager" decoding="async" fetchpriority="high">` : '空间'}
        </button>
        <div class="dh-nsa-scene-body">
          <div class="dh-nsa-scene-head">
            <div>
              <b>${escapeHtml(asset.name || `任务场景 ${selectedIndex + 1}`)}</b>
              <span>${escapeHtml([`场景 ${selectedIndex + 1}/${assets.length}`, `版本 r${asset.scene_revision || 1}`, asset.lock_strength ? `锁定强度：${asset.lock_strength}` : '', STRATEGY_LABELS[asset.view_strategy] || '', `${views.length || 1} 张空间参考`, requirementScore ? `需求符合度 ${requirementScore}%` : '', crossViewScore || qaScore ? `跨视图一致性 ${crossViewScore || Math.round(qaScore * 100)}%` : ''].filter(Boolean).join(' · '))}</span>
            </div>
            <em>${escapeHtml(sceneVerification.label)}</em>
          </div>
          ${!qaPassed && state.taskId ? `<div class="dh-nsa-verification-row"><span class="dh-nsa-verification-badge is-${escapeHtml(sceneVerification.tone)}">未验证场景不会进入关键帧</span>${canReverify ? `<button type="button" class="dh-btn dh-btn-ghost dh-btn-sm" data-nsa-scene-verify="${escapeHtml(asset.scene_id || asset.id)}">再次验证（不重新生成）</button>` : ''}${sceneVerification.tone === 'rejected' ? '<span class="dh-nsa-verification-hint">请修改场景设定后重新生成当前场景，失败图片已保留供对照</span>' : ''}</div>${verificationDetailsHtml(sceneVerification, escapeHtml)}` : ''}
          <div class="dh-nsa-scene-views">
            ${views.slice(0, 5).map((view, index) => {
              const url = view.url || view.image_url || '';
              return `<button type="button" class="dh-nsa-scene-view" data-nsa-scene-preview="${selectedIndex}:${index}">
                ${url ? `<img src="${escapeHtml(thumbUrl(url, 360))}" alt="${escapeHtml(view.label || `视角 ${index + 1}`)}" loading="lazy" decoding="async">` : ''}
                <b>${escapeHtml(view.label || VIEW_LABELS[view.key] || `视角 ${index + 1}`)}</b>
              </button>`;
            }).join('')}
          </div>
        </div>
      </div>
    </div>`;
  }

  function payload(state = {}) {
    return normalizeAssets(state.sceneAssets || []);
  }

  function hydrate(state = {}, { request = {}, outputs = {}, response = {} } = {}) {
    const assets = normalizeAssets(
      outputs.scene_assets
      || response.scene_assets
      || request.scene_assets
      || request.sceneAssets
      || [],
    );
    state.sceneAssets = assets;
    const spec = request.scene_spec || request.sceneSpec || outputs.context?.scene_spec || response.context?.scene_spec || null;
    applySpec(spec, { clearMissing: true });
    return assets;
  }

  async function generate({
    state,
    ensureTask,
    api,
    payload: buildPayload,
    normalizeBundle,
    renderAll,
    setBusy,
    setButtonBusy,
    toast,
    button,
    append = false,
  } = {}) {
    if (!state || typeof ensureTask !== 'function' || typeof api !== 'function') return false;
    const reconciled = reconcileSurfaceIntent(specPayload(), { syncControls: true });
    const sceneSpec = reconciled.spec;
    if (reconciled.changed) {
      toast?.('检测到完整连续墙面要求，已自动改为“连续完整表面 + 隐藏可见拼缝”', 'info');
    }
    const layoutRequired = requiresLayoutView(sceneSpec);
    const totalViews = layoutRequired ? 5 : 4;
    const label = append ? '追加场景参考中...' : '生成场景参考中...';
    const stageLabels = ['主视角', '反向/侧向', '互动位', '材质细节', '俯视布局'].slice(0, totalViews);
    const stages = [{ at: 0, percent: 10, completed: 0, current: 1 }];
    stageLabels.forEach((viewLabel, index) => {
      if (index === 0) return;
      stages.push({
        at: 2500 + ((index - 1) * 7000),
        percent: Math.min(92, 24 + (index * Math.round(68 / totalViews))),
        completed: index,
        current: index + 1,
        message: `已完成 ${index}/${totalViews} 张，正在生成第 ${index + 1}/${totalViews} 张：${viewLabel}。`,
      });
    });
    stages[0].message = `已完成 0/${totalViews} 张，正在生成第 1/${totalViews} 张：主视角。`;
    const setProgressStage = () => {
      const start = state.sceneGenerationProgress?.startedAt || Date.now();
      const elapsed = Date.now() - start;
      let stage = stages[0];
      stages.forEach(item => { if (elapsed >= item.at) stage = item; });
      state.sceneGenerationProgress = {
        active: true,
        total: totalViews,
        startedAt: start,
        ...stage,
      };
      renderAll?.();
    };
    state.sceneGenerationProgress = { active: true, total: totalViews, percent: 10, completed: 0, current: 1, startedAt: Date.now(), message: stages[0].message };
    const timer = setInterval(setProgressStage, 1000);
    setBusy?.(true, label);
    setButtonBusy?.(button, true, label);
    renderAll?.();
    try {
      const taskId = await ensureTask();
      const body = typeof buildPayload === 'function' ? buildPayload() : {};
      const currentIndex = Math.max(0, Math.min((state.sceneAssets || []).length - 1, Number(state.sceneSelectedIndex || 0) || 0));
      const currentAsset = !append && Array.isArray(state.sceneAssets) ? state.sceneAssets[currentIndex] : null;
      const submitted = await api(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/scene-assets`, {
        method: 'POST',
        body: {
          ...body,
          scene_spec: sceneSpec,
          include_layout_view: layoutRequired,
          scene_assets: payload(state),
          scene_id: append ? undefined : (currentAsset?.scene_id || currentAsset?.id || undefined),
          lock_strength: 'standard',
        },
      });
      const r = submitted.job && window.NewStoryAdGenerationFlow?.waitForStage
        ? await window.NewStoryAdGenerationFlow.waitForStage(taskId, 'scene_asset', { api })
        : submitted;
      if (typeof normalizeBundle === 'function') normalizeBundle(r);
      state.sceneAssets = normalizeAssets(r.scene_assets || r.outputs?.scene_assets || r.bundle?.outputs?.scene_assets || []);
      state.sceneSelectedIndex = append ? Math.max(0, state.sceneAssets.length - 1) : currentIndex;
      state.sceneGenerationProgress = null;
      renderAll?.();
      const updatedAsset = state.sceneAssets[state.sceneSelectedIndex] || {};
      const verificationResult = verificationView(updatedAsset);
      toast?.(
        verificationResult.tone === 'verified'
          ? (append ? '新场景参考已生成、自动验证并绑定当前任务' : '当前场景参考已生成、自动验证并绑定当前任务')
          : (verificationResult.message || verificationResult.label),
        verificationResult.tone === 'verified' ? 'success' : (verificationResult.tone === 'unavailable' ? 'warning' : 'error'),
      );
      return true;
    } catch (err) {
      state.sceneGenerationProgress = null;
      renderAll?.();
      toast?.(err.message || '场景参考生成失败', 'error');
      return false;
    } finally {
      clearInterval(timer);
      setButtonBusy?.(button, false);
      setBusy?.(false);
    }
  }

  async function verify({ state, api, normalizeBundle, renderAll, setButtonBusy, toast, button, sceneId } = {}) {
    if (!state?.taskId || !sceneId) return false;
    setButtonBusy?.(button, true, '验证中...');
    try {
      const response = await api(`/api/new-story-ad/tasks/${encodeURIComponent(state.taskId)}/scene-assets/${encodeURIComponent(sceneId)}/verify`, { method: 'POST', body: {} });
      if (typeof normalizeBundle === 'function' && response.bundle) normalizeBundle(response);
      state.sceneAssets = normalizeAssets(response.scene_assets || response.outputs?.scene_assets || state.sceneAssets || []);
      renderAll?.();
      const updated = state.sceneAssets.find(asset => String(asset.scene_id || asset.id) === String(sceneId)) || response.scene_asset || {};
      const result = verificationView(updated);
      toast?.(result.message || result.label, result.tone === 'verified' ? 'success' : (result.tone === 'unavailable' ? 'warning' : 'error'));
      return result.tone === 'verified';
    } catch (error) {
      toast?.(error.message || '场景重新验证失败', 'error');
      return false;
    } finally {
      setButtonBusy?.(button, false);
    }
  }

  window.NewStoryAdSceneAssets = {
    normalizeAssets,
    thumbUrl,
    specPayload,
    hasContinuousSurfaceIntent,
    reconcileSurfaceIntent,
    requiresLayoutView,
    applySpec,
    clearSpecInputs,
    applySpecSuggestion,
    render,
    payload,
    hydrate,
    generate,
    verify,
  };
  const STRATEGY_LABELS = {
    single_view: '单视角',
    image_derived: '母场景图片派生',
    orbit_extract: '环绕视频抽帧',
    path_extract: '路径视频抽帧',
    uploaded_views: '用户多视图',
  };
})();
