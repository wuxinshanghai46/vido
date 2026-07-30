(() => {
  const registry = new Map();
  const labels = {
    body: '全身视图',
    identity: '身份近照',
    expression: '表情',
    action: '基础动作',
  };
  const clean = (value = '', max = 1000) => String(value || '').trim().slice(0, max);
  const escape = (value = '') => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function items(asset = {}) {
    return (Array.isArray(asset.atomic_assets) ? asset.atomic_assets : [])
      .map((item, index) => ({
        kind: clean(item.kind || 'reference', 40),
        key: clean(item.key || `item_${index + 1}`, 80),
        label: clean(item.label || item.key || `素材 ${index + 1}`, 100),
        url: clean(item.image_url || item.url),
      }))
      .filter(item => item.url);
  }

  function register(key, entry) {
    if (key && entry?.asset) registry.set(String(key), entry);
  }

  function close() {
    document.querySelector('[data-nsa-dossier-modal]')?.remove();
  }

  function open(asset = {}, name = '', assetThumbUrl = value => value) {
    const rows = items(asset);
    const cover = asset.cover_image_url || asset.dossier_sheet?.image_url || '';
    if (!rows.length) return false;
    close();
    const modal = document.createElement('div');
    modal.className = 'dh-nsa-dossier-modal';
    modal.dataset.nsaDossierModal = 'true';
    modal.innerHTML = `<div class="dh-nsa-dossier-dialog" role="dialog" aria-modal="true" aria-label="${escape(name || '人物档案')}">
      <header><div><b>${escape(name || '人物档案')}</b><small>17项原子素材与本地组合大图</small></div><button type="button" data-nsa-dossier-close aria-label="关闭">×</button></header>
      <div class="dh-nsa-dossier-scroll">
        ${cover ? `<section><h4>组合大图</h4><a href="${escape(cover)}" target="_blank" rel="noopener"><img class="dh-nsa-dossier-cover" src="${escape(assetThumbUrl(cover, 1200))}" alt="${escape(name)} 组合大图"></a></section>` : ''}
        ${['body', 'identity', 'expression', 'action'].map(kind => {
          const group = rows.filter(item => item.kind === kind);
          if (!group.length) return '';
          return `<section><h4>${labels[kind] || kind} · ${group.length}张</h4><div class="dh-nsa-dossier-grid">${group.map(item => `<a href="${escape(item.url)}" target="_blank" rel="noopener"><img src="${escape(assetThumbUrl(item.url, 420))}" alt="${escape(item.label)}" loading="lazy"><span>${escape(item.label)}</span></a>`).join('')}</div></section>`;
        }).join('')}
      </div>
    </div>`;
    modal.addEventListener('click', event => {
      if (event.target === modal || event.target.closest('[data-nsa-dossier-close]')) close();
    });
    document.body.appendChild(modal);
    return true;
  }

  function openByKey(key = '') {
    const entry = registry.get(String(key));
    return entry ? open(entry.asset, entry.name, entry.assetThumbUrl) : false;
  }

  function progressStages(total) {
    return [
      { at: 0, percent: 10, message: `已提交 ${total} 份主体身份资产，人物将按4类图集生成17项档案。` },
      { at: 8000, percent: 36, message: '正在有限并发生成并拆分人物档案图集；宠物仍生成独立身份四视图。' },
      { at: 18000, percent: 66, message: '正在逐个执行身份、外观与跨视图一致性验证。' },
      { at: 32000, percent: 84, message: '正在汇总已验证资产，并写入当前任务一致性合同。' },
    ];
  }

  function initialProgress(total) {
    return { active: true, startedAt: Date.now(), label: '主体身份资产', percent: 10, message: `已提交 ${total} 份主体身份资产，人物将生成17项完整档案。` };
  }

  window.NewStoryAdPersonDossierUI = { items, register, open, openByKey, close, progressStages, initialProgress };
})();
