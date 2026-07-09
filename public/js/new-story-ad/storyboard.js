(() => {
  const VIEW_LABELS = {
    master: '主视角',
    reverse: '反向/侧向',
    interaction: '互动位',
    detail: '材质细节',
  };

  const VIEW_ORDER = ['master', 'reverse', 'interaction', 'detail'];

  function clean(value = '', max = 1000) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function sceneId(asset = {}, index = 0) {
    return clean(asset.scene_id || asset.id || `scene_${index + 1}`, 120);
  }

  function sceneName(asset = {}, index = 0) {
    return clean(asset.name || `场景 ${index + 1}`, 120);
  }

  function viewValue(value = '', index = 0) {
    const raw = clean(value, 40);
    if (VIEW_ORDER.includes(raw)) return raw;
    return VIEW_ORDER[index % VIEW_ORDER.length] || 'master';
  }

  function normalizeShotBinding(shot = {}, sceneAssets = [], index = 0) {
    if (!shot || typeof shot !== 'object') return shot;
    const assets = Array.isArray(sceneAssets) ? sceneAssets : [];
    if (!assets.length) return shot;
    const existing = clean(shot.scene_id || shot.sceneId || shot.scene_asset_id || shot.sceneAssetId, 120);
    const matchedIndex = Math.max(0, assets.findIndex((asset, assetIndex) => sceneId(asset, assetIndex) === existing));
    const selectedIndex = matchedIndex >= 0 ? matchedIndex : Math.min(index, assets.length - 1);
    const selected = assets[selectedIndex] || assets[0];
    const id = sceneId(selected, selectedIndex);

    // 只给缺失字段补默认值，不覆盖用户已经手动选择的场景绑定。
    if (!shot.scene_id) shot.scene_id = id;
    if (!shot.scene_asset_id) shot.scene_asset_id = shot.scene_id;
    if (!shot.scene_name) shot.scene_name = sceneName(selected, selectedIndex);
    if (!shot.scene_view) shot.scene_view = viewValue('', index);
    if (!shot.scene_zone) shot.scene_zone = clean(shot.purpose || shot.title || `第 ${index + 1} 镜区域`, 160);
    return shot;
  }

  function normalizeShots(shots = [], sceneAssets = []) {
    return (Array.isArray(shots) ? shots : []).map((shot, index) => normalizeShotBinding(shot, sceneAssets, index));
  }

  function optionHtml(value, label, selected, escapeHtml) {
    const esc = typeof escapeHtml === 'function' ? escapeHtml : (x => String(x || ''));
    return `<option value="${esc(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${esc(label)}</option>`;
  }

  function bindingHtml({ shot = {}, index = 0, sceneAssets = [], escapeHtml } = {}) {
    const esc = typeof escapeHtml === 'function' ? escapeHtml : (x => String(x || ''));
    const assets = Array.isArray(sceneAssets) ? sceneAssets : [];
    if (!assets.length) {
      return `<div class="dh-nsa-frame-scene is-empty">
        <b>场景绑定</b><span>当前任务还没有场景空间锁；生成场景四视图后，每个分镜会绑定到对应场景。</span>
      </div>`;
    }

    const currentScene = clean(shot.scene_id || shot.scene_asset_id || sceneId(assets[Math.min(index, assets.length - 1)] || {}, index), 120);
    const currentView = viewValue(shot.scene_view, index);
    return `<div class="dh-nsa-frame-scene">
      <div class="dh-nsa-frame-scene-title">
        <b>场景绑定</b>
        <span>${assets.length > 1 ? '多场景任务：可为本镜选择空间、视角和转场原因。' : '单场景任务：本镜锁定当前任务唯一空间。'}</span>
      </div>
      <label>
        <span>绑定场景</span>
        <select class="dh-input" data-nsa-shot-index="${index}" data-nsa-shot-field="scene_id">
          ${assets.map((asset, assetIndex) => optionHtml(sceneId(asset, assetIndex), `场景 ${assetIndex + 1} · ${sceneName(asset, assetIndex)}`, currentScene, esc)).join('')}
        </select>
      </label>
      <label>
        <span>场景视角</span>
        <select class="dh-input" data-nsa-shot-index="${index}" data-nsa-shot-field="scene_view">
          ${VIEW_ORDER.map(key => optionHtml(key, VIEW_LABELS[key] || key, currentView, esc)).join('')}
        </select>
      </label>
      <label>
        <span>场景区域</span>
        <input class="dh-input" value="${esc(clean(shot.scene_zone || '', 160))}" placeholder="例如：入口区、展示区、互动位、细节区，按当前任务填写" data-nsa-shot-index="${index}" data-nsa-shot-field="scene_zone">
      </label>
      <label>
        <span>转场原因</span>
        <input class="dh-input" value="${esc(clean(shot.transition_reason || '', 240))}" placeholder="跨场景时说明为什么切换；单场景可留空" data-nsa-shot-index="${index}" data-nsa-shot-field="transition_reason">
      </label>
    </div>`;
  }

  window.NewStoryAdStoryboard = {
    VIEW_LABELS,
    normalizeShotBinding,
    normalizeShots,
    bindingHtml,
  };
})();
