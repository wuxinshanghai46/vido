(() => {
  const VIEW_LABELS = {
    master: '主视角',
    reverse: '反向/侧向',
    interaction: '互动位',
    detail: '材质细节',
  };

  // 默认四镜位只服务旧场景资产；V2.0 优先读取每个任务自己的开放视图清单。
  const VIEW_ORDER = ['master', 'reverse', 'interaction', 'detail'];

  const SCENE_ZONE_LABELS = {
    'central interaction zone': '中央交互区',
    'background data wall zone': '背景数据墙区域',
    'foreground interaction zone': '前景交互区',
    'entrance zone': '入口区',
    'display zone': '展示区',
    'product display zone': '产品展示区',
    'detail zone': '细节区',
    'work zone': '工作区',
  };

  const SCENE_ZONE_TOKENS = {
    central: '中央', center: '中央', background: '背景', foreground: '前景',
    data: '数据', wall: '墙', interaction: '交互', entrance: '入口', display: '展示',
    product: '产品', detail: '细节', work: '工作', operation: '操作', main: '主',
    stage: '舞台', counter: '柜台', desk: '工作台', corridor: '通道', zone: '区域', area: '区域',
  };

  function clean(value = '', max = 1000) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function sceneId(asset = {}, index = 0) {
    return clean(asset.scene_id || asset.id || `scene_${index + 1}`, 120);
  }

  function sceneName(asset = {}, index = 0) {
    return clean(asset.name || `场景 ${index + 1}`, 120);
  }

  function sceneViews(asset = {}) {
    const declared = (Array.isArray(asset.view_images) ? asset.view_images : [])
      .map((view, index) => ({
        key: clean(view?.key || view?.view || `view_${index + 1}`, 40),
        label: clean(view?.label || view?.name || '', 80),
      }))
      .filter(view => view.key && view.key !== 'layout');
    return declared.length ? declared : VIEW_ORDER.map(key => ({ key, label: VIEW_LABELS[key] || key }));
  }

  function viewValue(value = '', index = 0, asset = {}) {
    const raw = clean(value, 40);
    const views = sceneViews(asset);
    if (views.some(view => view.key === raw)) return raw;
    return views[index % views.length]?.key || raw || 'master';
  }

  function sceneZoneLabel(value = '') {
    const raw = clean(value, 160);
    if (!raw || /[\u3400-\u9fff]/.test(raw)) return raw;
    const normalized = raw.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (SCENE_ZONE_LABELS[normalized]) return SCENE_ZONE_LABELS[normalized];
    const tokens = normalized.split(' ');
    if (tokens.length && tokens.every(token => SCENE_ZONE_TOKENS[token])) {
      return tokens.map(token => SCENE_ZONE_TOKENS[token]).join('').replace(/区域区域/g, '区域');
    }
    return raw;
  }

  function shotZoneId(shot = {}) {
    return clean(shot.scene_zone_id || shot.zone_id || (Array.isArray(shot.zone_ids) ? shot.zone_ids[0] : ''), 100);
  }

  function shotZoneLabel(shot = {}) {
    return sceneZoneLabel(shot.scene_zone_label_zh || shot.zone_label_zh || shot.scene_zone || '');
  }

  function normalizeShotBinding(shot = {}, sceneAssets = [], index = 0) {
    if (!shot || typeof shot !== 'object') return shot;
    const assets = Array.isArray(sceneAssets) ? sceneAssets : [];
    if (!assets.length) return shot;
    const existing = clean(shot.scene_id || shot.sceneId || shot.scene_asset_id || shot.sceneAssetId, 120);
    const matchedIndex = assets.findIndex((asset, assetIndex) => sceneId(asset, assetIndex) === existing);
    // 多场景任务必须由用户或模型明确绑定，不能再按镜头序号静默回退到某个场景。
    if (assets.length > 1 && matchedIndex < 0) {
      shot.scene_id = '';
      shot.scene_asset_id = '';
      if (!shot.scene_view) shot.scene_view = viewValue('', index);
      if (!shot.scene_zone) shot.scene_zone = clean(shot.purpose || shot.title || `第 ${index + 1} 镜区域`, 160);
      return shot;
    }
    const selectedIndex = matchedIndex >= 0 ? matchedIndex : 0;
    const selected = assets[selectedIndex];
    const id = sceneId(selected, selectedIndex);

    // 只给缺失字段补默认值，不覆盖用户已经手动选择的场景绑定。
    if (!shot.scene_id) shot.scene_id = id;
    if (!shot.scene_asset_id) shot.scene_asset_id = shot.scene_id;
    if (!shot.scene_name) shot.scene_name = sceneName(selected, selectedIndex);
    if (!shot.scene_view) shot.scene_view = viewValue('', index, selected);
    if (!shot.scene_zone) shot.scene_zone = clean(shot.purpose || shot.title || `第 ${index + 1} 镜区域`, 160);
    if (!shot.scene_zone_id) shot.scene_zone_id = shotZoneId(shot);
    if (!shot.scene_zone_label_zh) shot.scene_zone_label_zh = shotZoneLabel(shot);
    return shot;
  }

  function normalizeShots(shots = [], sceneAssets = []) {
    return (Array.isArray(shots) ? shots : []).map((shot, index) => normalizeShotBinding(shot, sceneAssets, index));
  }

  function optionHtml(value, label, selected, escapeHtml) {
    const esc = typeof escapeHtml === 'function' ? escapeHtml : (x => String(x || ''));
    return `<option value="${esc(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${esc(label)}</option>`;
  }

  const TRANSITION_LABELS = {
    none: '无转场（首镜）',
    hard_cut: '直接切换',
    cut_on_action: '动作切换',
    match_cut: '匹配切换',
    dissolve: '短叠化',
    fade: '淡出 / 淡入',
  };

  function transitionRecommendation(shot = {}, index = 0) {
    const stored = shot.transition_recommendation && typeof shot.transition_recommendation === 'object'
      ? shot.transition_recommendation
      : {};
    if (index === 0) return { type: 'none', duration_sec: 0, reason: '首镜不需要前置转场' };
    return {
      type: clean(stored.type || shot.transition_type || 'hard_cut', 40),
      duration_sec: Number(stored.duration_sec ?? shot.transition_duration_sec ?? 0) || 0,
      reason: clean(stored.reason || shot.transition_reason || '按分镜连续性自动推荐', 240),
    };
  }

  function bindingHtml({ shot = {}, index = 0, sceneAssets = [], escapeHtml } = {}) {
    const esc = typeof escapeHtml === 'function' ? escapeHtml : (x => String(x || ''));
    const assets = Array.isArray(sceneAssets) ? sceneAssets : [];
    if (!assets.length) {
      return `<div class="dh-nsa-frame-scene is-empty" data-nsa-editor-section="scene">
        <b>场景绑定</b><span>当前任务还没有场景空间锁；生成场景四视图后，每个分镜会绑定到对应场景。</span>
      </div>`;
    }

    const currentScene = clean(shot.scene_id || shot.scene_asset_id || (assets.length === 1 ? sceneId(assets[0], 0) : ''), 120);
    const selectedAssetIndex = assets.findIndex((asset, assetIndex) => sceneId(asset, assetIndex) === currentScene);
    const selectedAsset = assets[selectedAssetIndex >= 0 ? selectedAssetIndex : 0] || {};
    const availableViews = sceneViews(selectedAsset);
    const currentView = viewValue(shot.scene_view, index, selectedAsset);
    const recommendation = transitionRecommendation(shot, index);
    const currentTransition = index === 0 ? 'none' : clean(shot.transition_type || recommendation.type || 'hard_cut', 40);
    const duration = Math.max(0, Math.min(2, Number(
      shot.transition_duration_sec ?? recommendation.duration_sec ?? 0,
    ) || 0));
    const audioBridge = clean(shot.audio_bridge || '', 180);
    const audioDuration = Math.max(0, Math.min(1.5, Number(
      shot.audio_bridge_duration_sec ?? (audioBridge ? 0.35 : 0),
    ) || 0));
    const transitionSource = clean(shot.transition_source || (shot._nsa_user_edited_fields?.transition_type ? 'authored' : 'recommended'), 40);
    return `<div class="dh-nsa-frame-scene" data-nsa-editor-section="scene">
      <div class="dh-nsa-frame-scene-title">
        <b>场景与转场导演</b>
        <span>${assets.length > 1 ? '多场景任务：空间切换与转场分别验收。' : '单场景任务：保持空间连续性，并按动作与构图选择切点。'}</span>
      </div>
      <label>
        <span>绑定场景</span>
        <select class="dh-input" data-nsa-shot-index="${index}" data-nsa-shot-field="scene_id">
          ${assets.length > 1 ? optionHtml('', '请选择本镜头场景（必选）', currentScene, esc) : ''}
          ${assets.map((asset, assetIndex) => optionHtml(sceneId(asset, assetIndex), `场景 ${assetIndex + 1} · ${sceneName(asset, assetIndex)}`, currentScene, esc)).join('')}
        </select>
      </label>
      <label>
        <span>场景视角</span>
        <select class="dh-input" data-nsa-shot-index="${index}" data-nsa-shot-field="scene_view">
          ${availableViews.map(view => optionHtml(view.key, view.label || VIEW_LABELS[view.key] || view.key, currentView, esc)).join('')}
        </select>
      </label>
      <label>
        <span>场景区域</span>
        <input class="dh-input" value="${esc(shotZoneLabel(shot))}" placeholder="例如：入口区、展示区、互动位、细节区，按当前任务填写" data-nsa-shot-index="${index}" data-nsa-shot-field="scene_zone">
      </label>
      <label>
        <span>转场类型</span>
        <select class="dh-input" data-nsa-shot-index="${index}" data-nsa-shot-field="transition_type" ${index === 0 ? 'disabled' : ''}>
          ${Object.entries(TRANSITION_LABELS).map(([value, label]) => optionHtml(value, label, currentTransition, esc)).join('')}
        </select>
      </label>
      <label>
        <span>转场时长（秒）</span>
        <input class="dh-input" type="number" min="0" max="2" step="0.05" value="${esc(duration)}" data-nsa-shot-index="${index}" data-nsa-shot-field="transition_duration_sec" ${index === 0 ? 'disabled' : ''}>
      </label>
      <label class="is-wide">
        <span>转场原因</span>
        <input class="dh-input" value="${esc(clean(shot.transition_reason || recommendation.reason || '', 240))}" placeholder="说明这次切换承担的叙事作用" data-nsa-shot-index="${index}" data-nsa-shot-field="transition_reason" ${index === 0 ? 'disabled' : ''}>
      </label>
      <label class="is-wide">
        <span>匹配锚点（匹配切换时必填）</span>
        <input class="dh-input" value="${esc(clean(shot.transition_match_anchor || '', 180))}" placeholder="例如：人物抬手方向、圆形产品轮廓、画面中心门框" data-nsa-shot-index="${index}" data-nsa-shot-field="transition_match_anchor" ${index === 0 ? 'disabled' : ''}>
      </label>
      <label class="is-wide">
        <span>跨镜声音桥</span>
        <input class="dh-input" value="${esc(audioBridge)}" placeholder="仅写需要提前进入下一场景的环境声或音效；留空则不混入" data-nsa-shot-index="${index}" data-nsa-shot-field="audio_bridge" ${index === 0 ? 'disabled' : ''}>
      </label>
      <label>
        <span>声音提前量（秒）</span>
        <input class="dh-input" type="number" min="0" max="1.5" step="0.05" value="${esc(audioDuration)}" data-nsa-shot-index="${index}" data-nsa-shot-field="audio_bridge_duration_sec" ${index === 0 ? 'disabled' : ''}>
      </label>
      <div class="dh-nsa-transition-recommendation is-${esc(transitionSource)}">
        <b>${transitionSource === 'recommended' ? '系统推荐' : '用户设定'}</b>
        <span>${esc(`${TRANSITION_LABELS[recommendation.type] || recommendation.type} · ${recommendation.reason}`)}</span>
        ${transitionSource === 'recommended' ? '<em>修改任一转场参数后，以你的设定为准</em>' : '<em>已覆盖自动推荐</em>'}
      </div>
    </div>`;
  }

  window.NewStoryAdStoryboard = {
    VIEW_LABELS,
    normalizeShotBinding,
    normalizeShots,
    sceneZoneLabel,
    shotZoneId,
    shotZoneLabel,
    transitionRecommendation,
    bindingHtml,
  };
})();
