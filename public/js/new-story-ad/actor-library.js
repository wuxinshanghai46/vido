(() => {
  function defaultEscape(value = '') {
    return String(value || '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[ch]));
  }

  async function open({
    api,
    escapeHtml = defaultEscape,
    withAuthQuery = value => value,
    actorUrls = asset => window.NewStoryAdActors?.collectUrls?.(asset) || [],
    actorReferenceLabel = asset => window.NewStoryAdActors?.referenceLabel?.(asset) || '演员参考',
    personGenderValue = value => window.NewStoryAdActors?.genderValue?.(value) || '',
    onSelect,
    toast = () => {},
  } = {}) {
    if (typeof api !== 'function') throw new Error('演员库接口未初始化');
    let items = [];
    let activeGenderFilter = 'all';
    const old = document.getElementById('__dh_nsa_actor_library');
    if (old) old.remove();
    const mask = document.createElement('div');
    mask.id = '__dh_nsa_actor_library';
    mask.style.cssText = 'position:fixed;inset:0;z-index:19000;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:24px';
    mask.innerHTML = `<div style="width:min(960px,96vw);max-height:86vh;overflow:hidden;background:#111318;border:1px solid rgba(255,255,255,.14);border-radius:14px;color:#fff;box-shadow:0 18px 60px rgba(0,0,0,.45);display:flex;flex-direction:column">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.1)">
        <div><b>选择真人演员/演员库</b><div style="font-size:12px;color:rgba(255,255,255,.62);margin-top:3px">选择授权真人或已入库人物参考；后续剧本、分镜和关键帧会使用同一个人物参考。</div></div>
        <button type="button" data-nsa-actor-close style="border:0;background:transparent;color:#fff;font-size:20px;cursor:pointer">×</button>
      </div>
      <div data-nsa-actor-tabs style="display:flex;gap:8px;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.08)">
        <button type="button" data-nsa-actor-filter="all" style="border:1px solid rgba(89,213,255,.55);background:linear-gradient(135deg,#39c7f3,#78e277);color:#06131a;border-radius:999px;padding:7px 16px;font-weight:800;cursor:pointer">全部</button>
        <button type="button" data-nsa-actor-filter="female" style="border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#fff;border-radius:999px;padding:7px 16px;font-weight:800;cursor:pointer">女</button>
        <button type="button" data-nsa-actor-filter="male" style="border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#fff;border-radius:999px;padding:7px 16px;font-weight:800;cursor:pointer">男</button>
      </div>
      <div data-nsa-actor-body style="padding:14px;overflow:auto;display:flex;flex-direction:column;gap:12px">
        <div style="padding:28px;text-align:center;color:rgba(255,255,255,.72)">正在加载演员库...</div>
      </div>
    </div>`;
    document.body.appendChild(mask);

    const close = () => mask.remove();
    const bodyEl = mask.querySelector('[data-nsa-actor-body]');
    const tabEl = mask.querySelector('[data-nsa-actor-tabs]');
    const actorGender = asset => personGenderValue(asset.gender || asset.detected_gender || asset.metadata?.gender || asset.metadata?.detected_gender || '');

    const updateTabs = () => {
      tabEl?.querySelectorAll('[data-nsa-actor-filter]').forEach(btn => {
        const active = btn.dataset.nsaActorFilter === activeGenderFilter;
        btn.style.border = active ? '1px solid rgba(89,213,255,.55)' : '1px solid rgba(255,255,255,.14)';
        btn.style.background = active ? 'linear-gradient(135deg,#39c7f3,#78e277)' : 'rgba(255,255,255,.06)';
        btn.style.color = active ? '#06131a' : '#fff';
      });
    };

    const renderRows = () => {
      updateTabs();
      if (!bodyEl) return;
      const filtered = activeGenderFilter === 'all' ? items : items.filter(asset => actorGender(asset) === activeGenderFilter);
      if (!filtered.length) {
        bodyEl.innerHTML = `<div style="padding:30px;text-align:center;color:rgba(255,255,255,.72)">${activeGenderFilter === 'all' ? '演员库还没有可选人物。真人演员请先上传真人参考；AI 拟真演员可先生成演员包后入库。' : '当前分类没有可选演员。'}</div>`;
        return;
      }
      bodyEl.innerHTML = filtered.map(asset => {
        const urls = actorUrls(asset).slice(0, 4);
        const refLabel = actorReferenceLabel(asset);
        const genderLabel = actorGender(asset) === 'female' ? '女' : (actorGender(asset) === 'male' ? '男' : '');
        const desc = String(asset.description || asset.metadata?.description || '可作为剧情广告人物一致性参考')
          .replace(/\s+/g, ' ')
          .replace(/CONSISTENT REAL CAMPAIGN CHARACTER ASSET:?/ig, '一致性演员参考')
          .replace(/Preserve face identity[\s\S]*$/i, '保持人物身份一致')
          .slice(0, 120);
        const imageStrip = urls.length
          ? urls.map((url, index) => `<span style="width:104px;height:140px;border-radius:8px;overflow:hidden;background:#0c1018;border:1px solid rgba(255,255,255,.10);display:flex;align-items:center;justify-content:center;flex-shrink:0"><img src="${escapeHtml(withAuthQuery(url))}" alt="视图${index + 1}" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:contain;background:#05070b"></span>`).join('')
          : '<span style="width:104px;height:140px;border-radius:8px;background:#1b2230;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:rgba(255,255,255,.7)">无预览</span>';
        return `<button type="button" data-nsa-actor-material="${escapeHtml(asset.id || asset.actor_asset_id || '')}" style="width:100%;display:grid;grid-template-columns:minmax(220px,456px) minmax(0,1fr);gap:14px;text-align:left;align-items:center;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:#fff;border-radius:12px;padding:12px;min-height:168px;cursor:pointer">
          <span style="display:flex;gap:8px;overflow:hidden">${imageStrip}</span>
          <span style="min-width:0;display:block">
            <b style="display:block;font-size:16px;line-height:1.25;margin-bottom:8px">${escapeHtml(asset.name || '角色素材')}</b>
            <small style="display:block;color:rgba(255,255,255,.72);line-height:1.55;margin-bottom:8px">${escapeHtml([refLabel, genderLabel, `${actorUrls(asset).length || 1} 张参考图`].filter(Boolean).join(' · '))}</small>
            <small style="display:block;color:rgba(255,255,255,.58);line-height:1.5;max-height:44px;overflow:hidden">${escapeHtml(desc || '可作为剧情广告人物一致性参考')}</small>
          </span>
        </button>`;
      }).join('');
    };

    mask.addEventListener('click', e => {
      if (e.target === mask || e.target.closest('[data-nsa-actor-close]')) return close();
      const filterBtn = e.target.closest('[data-nsa-actor-filter]');
      if (filterBtn) {
        activeGenderFilter = filterBtn.dataset.nsaActorFilter || 'all';
        renderRows();
        return;
      }
      const btn = e.target.closest('[data-nsa-actor-material]');
      if (!btn) return;
      const asset = items.find(x => String(x.id || x.actor_asset_id || '') === String(btn.dataset.nsaActorMaterial || ''));
      if (!asset) return;
      if (typeof onSelect === 'function') onSelect(asset);
      close();
    });

    try {
      const r = await api('/api/assets?type=character&limit=120&fast=1');
      items = Array.isArray(r?.data) ? r.data : [];
    } catch (err) {
      if (bodyEl) bodyEl.innerHTML = `<div style="padding:28px;text-align:center;color:#ffb4b4">角色素材库加载失败：${escapeHtml(err.message || err)}</div>`;
      toast('角色素材库加载失败：' + (err.message || err), 'error');
      return;
    }
    renderRows();
  }

  window.NewStoryAdActorLibrary = { open };
})();

