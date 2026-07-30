(() => {
  const api = (...args) => window.NewStoryAdApi.request(...args);
  let bound = false;
  let pollToken = 0;

  function uiState() {
    return window.__newStoryAdLegacyUI?.state || {};
  }

  function escapeHtml(value = '') {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function thumb(url = '', width = 420) {
    if (!url || !url.includes('/api/new-story-ad/assets/')) return url;
    return `${url}${url.includes('?') ? '&' : '?'}w=${width}`;
  }

  function assets() {
    const state = uiState();
    return Array.isArray(state.propAssets) ? state.propAssets : [];
  }

  function setAssets(rows = []) {
    const state = uiState();
    state.propAssets = Array.isArray(rows) ? rows : [];
    render();
  }

  function render() {
    const host = document.getElementById('dhNsaPropAssets');
    if (!host) return;
    const rows = assets();
    if (!rows.length) {
      host.innerHTML = '<div class="dh-luxgen-empty"><b>还没有独立道具</b><span>剧情需要持有、移动或改变状态的物件，应先在这里建立档案。</span></div>';
      return;
    }
    host.innerHTML = rows.map((prop, index) => {
      const cover = prop.cover_image_url || prop.image_url || '';
      const states = Array.isArray(prop.state_views) ? prop.state_views.length : 0;
      return `<article class="dh-nsa-prop-card">
        <button type="button" data-nsa-prop-open="${index}">${cover ? `<img src="${escapeHtml(thumb(cover, 420))}" alt="${escapeHtml(prop.name)}" loading="lazy">` : '<i>无封面</i>'}</button>
        <div><b>${escapeHtml(prop.name || `道具${index + 1}`)}</b><small>${escapeHtml(prop.type || 'story_prop')} · ${prop.view_images?.length || 0}视图${states ? ` · ${states}状态` : ''}</small><span>${escapeHtml(prop.material || prop.description || '')}</span></div>
      </article>`;
    }).join('');
    rows.forEach((prop, index) => {
      if (prop.status !== 'planned_not_generated') return;
      const info = host.querySelectorAll('.dh-nsa-prop-card > div')[index];
      if (!info) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'dh-nsa-prop-generate';
      button.dataset.nsaPropGenerate = String(index);
      button.textContent = '生成道具档案';
      info.appendChild(button);
    });
  }

  function openDetails(index) {
    const prop = assets()[index];
    if (!prop) return;
    document.querySelector('[data-nsa-prop-modal]')?.remove();
    const views = [
      ...(Array.isArray(prop.view_images) ? prop.view_images : []),
      ...(Array.isArray(prop.state_views) ? prop.state_views : []),
    ];
    const modal = document.createElement('div');
    modal.className = 'dh-nsa-dossier-modal';
    modal.dataset.nsaPropModal = 'true';
    modal.innerHTML = `<div class="dh-nsa-dossier-dialog" role="dialog" aria-modal="true">
      <header><div><b>${escapeHtml(prop.name || '道具档案')}</b><small>外观、状态、归属、接触与逐镜时间线</small></div><button type="button" data-nsa-prop-close>×</button></header>
      <div class="dh-nsa-dossier-scroll">
        <section><h4>视觉资产</h4><div class="dh-nsa-dossier-grid">${views.map(view => {
          const url = view.image_url || view.url || '';
          return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener"><img src="${escapeHtml(thumb(url, 480))}" loading="lazy"><span>${escapeHtml(view.label || view.key || '道具视图')}</span></a>`;
        }).join('')}</div></section>
        <section><h4>身份与交互合同</h4><pre>${escapeHtml(JSON.stringify({
          type: prop.type,
          material: prop.material,
          scale: prop.scale,
          quantity: prop.quantity,
          owner_id: prop.owner_id,
          scene_id: prop.scene_id,
          placement: prop.placement,
          hand_contact: prop.hand_contact,
          states: prop.states,
        }, null, 2))}</pre></section>
        <section><h4>逐镜状态</h4><pre>${escapeHtml(JSON.stringify(prop.shot_timeline || [], null, 2))}</pre></section>
      </div>
    </div>`;
    modal.addEventListener('click', event => {
      if (event.target === modal || event.target.closest('[data-nsa-prop-close]')) modal.remove();
    });
    document.body.appendChild(modal);
  }

  function editor(open) {
    const element = document.getElementById('dhNsaPropEditor');
    if (element) element.hidden = !open;
  }

  function field(name) {
    return document.querySelector(`[data-nsa-prop-field="${name}"]`);
  }

  function payload() {
    const interaction = String(field('interaction')?.value || '').trim();
    return {
      id: `prop_${Date.now()}`,
      name: String(field('name')?.value || '').trim(),
      type: String(field('type')?.value || 'story_prop'),
      description: String(field('description')?.value || '').trim(),
      material: String(field('material')?.value || '').trim(),
      states: String(field('states')?.value || '').split(/[，,]/).map(value => value.trim()).filter(Boolean),
      hand_contact: interaction,
      placement: interaction,
      revision: 1,
    };
  }

  async function load() {
    const taskId = uiState().taskId;
    if (!taskId) return setAssets([]);
    const response = await api(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/prop-assets`);
    setAssets(response.prop_assets || []);
  }

  async function poll(taskId, propId, token) {
    const started = Date.now();
    while (token === pollToken && Date.now() - started < 10 * 60 * 1000) {
      const response = await api(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/prop-assets`);
      const rows = response.prop_assets || [];
      setAssets(rows);
      const asset = rows.find(item => String(item.id || item.prop_id) === String(propId));
      if (asset && asset.status !== 'planned_not_generated'
        && ((asset.view_images || []).length || asset.cover_image_url || asset.image_url)) return true;
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    return false;
  }

  async function submit(prop, button, closeEditor = false) {
    const state = uiState();
    if (!state.taskId) throw new Error('请先创建并保存当前剧情广告任务');
    if (!prop.name || !prop.description) throw new Error('请填写道具名称和外观描述');
    if (prop.type === 'fixed_scene_object') throw new Error('场景固定物件请写入下方场景锚点，不重复生成道具图片');
    button.disabled = true;
    const original = button.textContent;
    button.textContent = '正在提交…';
    try {
      await api(`/api/new-story-ad/tasks/${encodeURIComponent(state.taskId)}/prop-assets`, {
        method: 'POST',
        body: prop,
        timeoutMs: 30000,
      });
      button.textContent = '正在生成…';
      const token = ++pollToken;
      const completed = await poll(state.taskId, prop.id, token);
      if (!completed) throw new Error('道具任务仍在后台执行，请稍后刷新查看');
      if (closeEditor) editor(false);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  async function generate(button) {
    return submit(payload(), button, true);
  }

  function bind() {
    if (bound) return;
    const studio = document.getElementById('dhNsaPropStudio');
    if (!studio) return;
    bound = true;
    document.getElementById('dhNsaAddProp')?.addEventListener('click', () => editor(true));
    document.getElementById('dhNsaCancelProp')?.addEventListener('click', () => editor(false));
    document.getElementById('dhNsaGenerateProp')?.addEventListener('click', event => {
      generate(event.currentTarget).catch(error => {
        if (typeof window.showToast === 'function') window.showToast(error.message, 'error');
        else console.error('[new-story-ad prop]', error);
      });
    });
    studio.addEventListener('click', event => {
      const generateButton = event.target.closest('[data-nsa-prop-generate]');
      if (generateButton) {
        const prop = assets()[Number(generateButton.dataset.nsaPropGenerate)];
        submit(prop, generateButton).catch(error => {
          if (typeof window.showToast === 'function') window.showToast(error.message, 'error');
          else console.error('[new-story-ad prop]', error);
        });
        return;
      }
      const button = event.target.closest('[data-nsa-prop-open]');
      if (button) openDetails(Number(button.dataset.nsaPropOpen));
    });
    render();
    load().catch(() => {});
  }

  window.NewStoryAdPropAssets = { bind, render, load, assets, setAssets, openDetails };
  document.addEventListener('new-story-ad:mount', bind);
  document.addEventListener('new-story-ad:asset-studio-ready', bind);
  document.addEventListener('new-story-ad:restore-finished', () => load().catch(() => {}));
  if (document.readyState !== 'loading') bind();
})();
