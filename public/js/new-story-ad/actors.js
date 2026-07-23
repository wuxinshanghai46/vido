(() => {
  const VIEW_LABELS = {
    front: '正面',
    side: '侧面',
    back: '背面',
    action: '动作',
  };

  function cleanUrl(value = '') {
    const raw = String(value || '').trim();
    if (!raw || /^blob:/i.test(raw) || /^data:/i.test(raw)) return raw;
    return raw;
  }

  function collectUrls(asset = {}) {
    const urls = [];
    const push = value => {
      const url = cleanUrl(value);
      if (url && !urls.includes(url)) urls.push(url);
    };
    const walk = value => {
      if (!value) return;
      if (typeof value === 'string') return push(value);
      if (Array.isArray(value)) return value.forEach(walk);
      if (typeof value !== 'object') return;
      push(value.image_url || value.imageUrl || value.file_url || value.url || value.previewUrl || '');
      [
        value.extra_image_urls,
        value.extra_images,
        value.image_urls,
        value.images,
        value.view_images,
        value.views,
        value.cast_assets,
      ].forEach(walk);
    };
    walk(asset);
    return urls;
  }

  function viewKey(value = '', index = 0) {
    const raw = String(value || '').toLowerCase();
    if (/front|frontal|main|primary|正面/.test(raw)) return 'front';
    if (/side|profile|semi|half|侧面|半侧/.test(raw)) return 'side';
    if (/back|rear|背面/.test(raw)) return 'back';
    if (/action|pose|gesture|motion|动作/.test(raw)) return 'action';
    return ['front', 'side', 'back', 'action'][Number(index) || 0] || `view_${index + 1}`;
  }

  function viewLabel(key = '', index = 0) {
    return VIEW_LABELS[key] || `参考 ${Number(index) + 1}`;
  }

  function viewEntries(asset = {}) {
    const metadata = asset?.metadata || {};
    const sourceViews = Array.isArray(asset?.view_images) && asset.view_images.length
      ? asset.view_images
      : (Array.isArray(metadata.view_images) ? metadata.view_images : []);
    const entries = [];
    const seen = new Set();
    const push = (view, index = entries.length) => {
      const url = cleanUrl(typeof view === 'string' ? view : (view?.url || view?.image_url || view?.imageUrl || view?.file_url || view?.previewUrl || ''));
      if (!url || seen.has(url)) return;
      seen.add(url);
      const key = viewKey(typeof view === 'string' ? '' : (view?.key || view?.view || view?.label || ''), index);
      entries.push({
        key,
        label: (typeof view === 'object' && view?.label && !/^(front|side|back|action)$/i.test(String(view.label))) ? view.label : viewLabel(key, index),
        url,
      });
    };
    sourceViews.forEach(push);
    if (!entries.length) collectUrls(asset).slice(0, 4).forEach((url, index) => push({ url, key: viewKey('', index) }, index));
    return entries;
  }

  function referenceKind(asset = {}) {
    const metadata = asset.metadata || {};
    const source = String(asset.source || metadata.source || asset.type || '').toLowerCase();
    const kind = String(asset.reference_kind || metadata.reference_kind || '').toLowerCase();
    const text = [source, kind, asset.name, asset.description, metadata.name, metadata.prompt]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (/real_photo|uploaded_photo|uploaded_person_reference|human_photo|authorized_real_actor|licensed_actor|真人照片|授权真人|真人演员/.test(text)) return 'real_photo';
    if (/synthetic_realistic_actor|generated_real_actor|realistic_actor|local_actor_library_generated|真人感演员|真人演员包/.test(text)) return 'synthetic_realistic_actor';
    if (/ai_generated|person_sheet|generated|ai/.test(text)) return 'ai_generated';
    return kind || 'unknown';
  }

  function referenceLabel(asset = {}) {
    const kind = referenceKind(asset);
    if (kind === 'real_photo') return '真人照片参考';
    if (kind === 'synthetic_realistic_actor') return '拟真一致性演员';
    if (kind === 'ai_generated') return 'AI 拟真演员参考';
    return '演员参考';
  }

  function genderValue(value = '') {
    const raw = String(value || '').toLowerCase();
    if (/female|woman|girl|女/.test(raw)) return 'female';
    if (/male|man|boy|男/.test(raw)) return 'male';
    return '';
  }

  function ageValue(value = '') {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    if (/^young_adult$|25\s*(?:-|–|—|至|到)\s*32|(?:二十六|二十七|二十八|二十九|三十|三十一|三十二)岁/.test(raw)) return 'young_adult';
    if (/young_adult_17_25|17\s*(?:-|–|—|至|到)\s*25|(?:十七|十八|十九|二十|二十一|二十二|二十三|二十四|二十五)岁/.test(raw)) return 'young_adult_17_25';
    if (/adult_30_40|30\s*(?:-|–|—|至|到)\s*40/.test(raw)) return 'adult_30_40';
    if (/middle_40_55|40\s*(?:-|–|—|至|到)\s*55/.test(raw)) return 'middle_40_55';
    if (/senior_55_plus|55\+|55岁以上|五十五岁以上/.test(raw)) return 'senior_55_plus';
    if (/teen_13_17|13\s*(?:-|–|—|至|到)\s*17/.test(raw)) return 'teen_13_17';
    return '';
  }

  function formatElapsedText(ms = 0) {
    const sec = Math.max(0, Math.round(Number(ms) / 1000) || 0);
    if (sec >= 60) return `${Math.floor(sec / 60)}分${String(sec % 60).padStart(2, '0')}秒`;
    return `${sec}秒`;
  }

  function progressHtml(progress = {}, escapeHtml = value => String(value || '')) {
    if (!progress || !progress.active) return '';
    const startedAt = Number(progress.startedAt || 0) || Date.now();
    const elapsed = Math.max(0, Date.now() - startedAt);
    const basePct = Math.round(Number(progress.percent) || 10);
    const softPct = basePct >= 82 ? Math.min(94, basePct + Math.floor(Math.max(0, elapsed - 22000) / 9000)) : basePct;
    const pct = Math.max(8, Math.min(96, softPct));
    return `<div class="dh-lux-person-progress">
      <div class="dh-lux-person-progress-head">
        <b>${escapeHtml(progress.label || '正在生成演员包')}</b>
        <span class="dh-lux-person-progress-stat"><em>耗时 ${escapeHtml(formatElapsedText(elapsed))}</em><i>${pct}%</i></span>
      </div>
      <div class="dh-lux-person-progress-track" aria-hidden="true"><i style="width:${pct}%"></i></div>
      <small>${escapeHtml(progress.message || '已提交生成请求，正在生成第 1/4 张。')}</small>
    </div>`;
  }

  window.NewStoryAdActors = {
    VIEW_LABELS,
    collectUrls,
    viewKey,
    viewLabel,
    viewEntries,
    referenceKind,
    referenceLabel,
    genderValue,
    ageValue,
    progressHtml,
  };
})();
