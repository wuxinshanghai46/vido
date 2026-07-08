(() => {
  const VIEW_LABELS = {
    master: '主视角',
    reverse: '反向/侧向',
    interaction: '互动位',
    detail: '材质细节',
  };

  const clean = (value = '', max = 1000) => String(value || '').trim().slice(0, max);
  const root = () => document.getElementById('dhNewStoryAdLegacyMount') || document;

  function specPayload() {
    const scope = root();
    const value = key => clean(scope.querySelector(`[data-nsa-scene-spec="${key}"]`)?.value || '', key === 'negativeText' ? 500 : 600);
    return {
      mode: clean(scope.querySelector('#dhNsaAdSceneMode')?.value || 'auto', 40),
      layoutText: value('layoutText'),
      materialLightText: value('materialLightText'),
      interactionText: value('interactionText'),
      negativeText: value('negativeText'),
    };
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
    return changed;
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
    const views = Array.isArray(asset.view_images)
      ? asset.view_images.map(normalizeView).filter(view => view.url || view.image_url)
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
    const viewLabel = ['主视角', '反向/侧向', '互动位', '材质细节'][current - 1] || `视角 ${current}`;
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
              <b>正在生成场景四视图：第 ${view.current}/${view.total} 张</b>
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
          <b>未生成场景四视图</b>
          <span>可在生成剧本前先锁定当前任务的空间布局、材质和光线；不需要固定空间的任务可以跳过。</span>
        </div>
      </div>`;
      return;
    }
    const selectedIndex = Math.max(0, Math.min(assets.length - 1, Number(state.sceneSelectedIndex || 0) || 0));
    state.sceneSelectedIndex = selectedIndex;
    const asset = assets[selectedIndex];
    const views = asset.view_images || [];
    const mainUrl = asset.url || asset.image_url || views[0]?.url || views[0]?.image_url || '';
    host.innerHTML = `<div class="dh-nsa-scene-list">
      ${assets.length > 1 ? `<div class="dh-nsa-scene-tabs">
        ${assets.map((item, index) => `<button type="button" class="${index === selectedIndex ? 'active' : ''}" data-nsa-scene-select="${index}">
          <b>场景 ${index + 1}</b><span>${escapeHtml(item.name || '任务场景')}</span>
        </button>`).join('')}
      </div>` : ''}
      <div class="dh-nsa-scene-card">
        <button type="button" class="dh-nsa-scene-thumb dh-nsa-scene-main-preview" data-nsa-scene-preview="${selectedIndex}:0">
          ${mainUrl ? `<img src="${escapeHtml(mainUrl)}" alt="${escapeHtml(asset.name || `任务场景 ${selectedIndex + 1}`)}">` : '空间'}
        </button>
        <div class="dh-nsa-scene-body">
          <div class="dh-nsa-scene-head">
            <div>
              <b>${escapeHtml(asset.name || `任务场景 ${selectedIndex + 1}`)}</b>
              <span>${escapeHtml([`场景 ${selectedIndex + 1}/${assets.length}`, asset.lock_strength ? `锁定强度：${asset.lock_strength}` : '', `${views.length || 1} 张空间参考`].filter(Boolean).join(' · '))}</span>
            </div>
            <em>已绑定当前任务</em>
          </div>
          <div class="dh-nsa-scene-views">
            ${views.slice(0, 4).map((view, index) => {
              const url = view.url || view.image_url || '';
              return `<button type="button" class="dh-nsa-scene-view" data-nsa-scene-preview="${selectedIndex}:${index}">
                ${url ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(view.label || `视角 ${index + 1}`)}">` : ''}
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
    if (assets.length) state.sceneAssets = assets;
    const spec = request.scene_spec || request.sceneSpec || outputs.context?.scene_spec || response.context?.scene_spec || null;
    if (spec && typeof spec === 'object') {
      Object.entries(spec).forEach(([key, value]) => {
        const el = root().querySelector(`[data-nsa-scene-spec="${key}"]`);
        if (el && value !== undefined && value !== null) el.value = String(value);
      });
      const mode = root().querySelector('#dhNsaAdSceneMode');
      if (mode && spec.mode) mode.value = String(spec.mode);
    }
    return assets;
  }

  async function generate({
    state,
    ensureTask,
    api,
    payload: buildPayload,
    renderAll,
    setBusy,
    setButtonBusy,
    toast,
    button,
    append = false,
  } = {}) {
    if (!state || typeof ensureTask !== 'function' || typeof api !== 'function') return false;
    const label = append ? '追加场景四视图中...' : '生成场景四视图中...';
    const stages = [
      { at: 0, percent: 10, completed: 0, current: 1, message: '已完成 0/4 张，正在生成第 1/4 张：主视角。' },
      { at: 2500, percent: 28, completed: 0, current: 1, message: '已完成 0/4 张，正在生成第 1/4 张：主视角。' },
      { at: 8500, percent: 52, completed: 1, current: 2, message: '已完成 1/4 张，正在生成第 2/4 张：反向/侧向。' },
      { at: 15000, percent: 74, completed: 2, current: 3, message: '已完成 2/4 张，正在生成第 3/4 张：互动位。' },
      { at: 21500, percent: 88, completed: 3, current: 4, message: '已完成 3/4 张，正在生成第 4/4 张：材质细节。' },
    ];
    const setProgressStage = () => {
      const start = state.sceneGenerationProgress?.startedAt || Date.now();
      const elapsed = Date.now() - start;
      let stage = stages[0];
      stages.forEach(item => { if (elapsed >= item.at) stage = item; });
      state.sceneGenerationProgress = {
        active: true,
        total: 4,
        startedAt: start,
        ...stage,
      };
      renderAll?.();
    };
    state.sceneGenerationProgress = { active: true, total: 4, percent: 10, completed: 0, current: 1, startedAt: Date.now(), message: stages[0].message };
    const timer = setInterval(setProgressStage, 1000);
    setBusy?.(true, label);
    setButtonBusy?.(button, true, label);
    renderAll?.();
    try {
      const taskId = await ensureTask();
      const body = typeof buildPayload === 'function' ? buildPayload() : {};
      const currentIndex = Math.max(0, Math.min((state.sceneAssets || []).length - 1, Number(state.sceneSelectedIndex || 0) || 0));
      const currentAsset = !append && Array.isArray(state.sceneAssets) ? state.sceneAssets[currentIndex] : null;
      const r = await api(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/scene-assets`, {
        method: 'POST',
        body: {
          ...body,
          scene_spec: specPayload(),
          scene_assets: payload(state),
          scene_id: append ? undefined : (currentAsset?.scene_id || currentAsset?.id || undefined),
          lock_strength: 'standard',
        },
      });
      state.sceneAssets = normalizeAssets(r.scene_assets || r.bundle?.outputs?.scene_assets || []);
      state.sceneSelectedIndex = append ? Math.max(0, state.sceneAssets.length - 1) : currentIndex;
      state.sceneGenerationProgress = null;
      renderAll?.();
      toast?.(append ? '新场景四视图已追加并绑定当前任务' : '当前场景四视图已生成并绑定当前任务', 'success');
      return true;
    } catch (err) {
      state.sceneGenerationProgress = null;
      renderAll?.();
      toast?.(err.message || '场景四视图生成失败', 'error');
      return false;
    } finally {
      clearInterval(timer);
      setButtonBusy?.(button, false);
      setBusy?.(false);
    }
  }

  window.NewStoryAdSceneAssets = {
    normalizeAssets,
    specPayload,
    applySpecSuggestion,
    render,
    payload,
    hydrate,
    generate,
  };
})();
