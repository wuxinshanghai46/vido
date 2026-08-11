import { escapeHtml } from '../components/ui.js?v=20260811-ui-v190';

function rows(profile = {}) {
  const source = Array.isArray(profile.look_profiles) ? profile.look_profiles : [];
  if (source.length) return source;
  return [{
    id: `${profile.id || 'cast'}_look_1`, name: '默认造型', story_state: '', scene_ids: [], scene_names: [],
    wardrobeText: profile.wardrobeText || '', hairMakeupText: profile.hairMakeupText || '', negativeText: profile.negativeText || '',
  }];
}

function lookEditor(look = {}, index = 0) {
  const scenes = Array.isArray(look.scene_names) && look.scene_names.length ? look.scene_names : (look.scene_ids || []);
  const storyState = String(look.story_state || '').trim();
  const sceneLabels = scenes.map(scene => storyState && !String(scene).includes(storyState) ? `${storyState} · ${scene}` : scene);
  const richness = String(look.style_richness || 'auto');
  const richnessOption = (value, label) => `<option value="${value}" ${richness === value ? 'selected' : ''}>${label}</option>`;
  return `<fieldset class="person-look-card" data-person-look data-look-index="${index}">
    <legend><span>造型 ${index + 1}</span><b>${escapeHtml(look.name || `造型 ${index + 1}`)}</b></legend>
    <input type="hidden" name="look_${index}_id" value="${escapeHtml(look.id || '')}">
    <input type="hidden" name="look_${index}_scene_ids" value="${escapeHtml((look.scene_ids || []).join(','))}">
    <input type="hidden" name="look_${index}_scene_names" value="${escapeHtml((look.scene_names || []).join(','))}">
    <div class="form-grid two"><label><span>造型名称</span><input name="look_${index}_name" value="${escapeHtml(look.name || '')}" required></label><label><span>时代 / 剧情状态</span><input name="look_${index}_story_state" value="${escapeHtml(look.story_state || '')}"></label></div>
    <label><span>华丽程度（AI 帮写和图片生成都会遵守）</span><select name="look_${index}_style_richness">${richnessOption('auto', '根据人物与剧情自动判断')}${richnessOption('restrained', '朴素克制')}${richnessOption('refined', '精致雅致')}${richnessOption('ornate_luxurious', '华丽华贵')}</select></label>
    <p class="person-look-scenes"><span>适用场景 / 剧情状态</span><b>${escapeHtml(sceneLabels.join('、') || storyState || '未限定场景，将按剧情分析')}</b></p>
    <label><span>服装 / 鞋 / 配饰</span><textarea name="look_${index}_wardrobeText" rows="3" required>${escapeHtml(look.wardrobeText || '')}</textarea></label>
    <label><span>该造型发型 / 妆造</span><textarea name="look_${index}_hairMakeupText" rows="2">${escapeHtml(look.hairMakeupText || '')}</textarea></label>
    <label><span>该造型禁止项</span><textarea name="look_${index}_negativeText" rows="2">${escapeHtml(look.negativeText || '')}</textarea></label>
    <button class="btn small person-look-remove" type="button" data-remove-person-look>删除该造型</button>
  </fieldset>`;
}

export function renderPersonLookEditors(profile = {}) {
  return `<section class="person-look-editor" data-person-look-editor><div class="drawer-section-head"><div><h3>人物造型</h3><p>同一时代可有多套造型；古今人物分别建档。</p></div><span>${rows(profile).length} 套</span></div><div data-person-look-list>${rows(profile).map(lookEditor).join('')}</div><button class="btn small" type="button" data-add-person-look>添加造型</button></section>`;
}

export function renderPersonLookTiles(item = {}) {
  const looks = item.profile?.look_profiles || [];
  return looks.length > 1 ? `<div class="person-look-tiles">${looks.map((look, index) => `<section class="person-look-tile"><span>${index + 1}</span><p><b>${escapeHtml(look.name || `造型 ${index + 1}`)}</b><small>${escapeHtml(look.story_state || '独立造型')}</small></p></section>`).join('')}</div>` : '';
}

function reindex(container) {
  [...container.querySelectorAll('[data-person-look]')].forEach((card, index) => {
    card.dataset.lookIndex = String(index);
    card.querySelector('legend span').textContent = `造型 ${index + 1}`;
    card.querySelectorAll('[name]').forEach(field => { field.name = field.name.replace(/^look_\d+_/, `look_${index}_`); });
  });
  const badge = container.closest('[data-person-look-editor]')?.querySelector('.drawer-section-head>span');
  if (badge) badge.textContent = `${container.querySelectorAll('[data-person-look]').length} 套`;
}

export function bindPersonLookForm(form) {
  const editor = form?.querySelector('[data-person-look-editor]');
  const list = editor?.querySelector('[data-person-look-list]');
  if (!editor || !list) return;
  editor.querySelector('[data-add-person-look]')?.addEventListener('click', () => {
    const index = list.querySelectorAll('[data-person-look]').length;
    list.insertAdjacentHTML('beforeend', lookEditor({ id: `look_${Date.now()}`, name: `造型 ${index + 1}` }, index));
    reindex(list);
  });
  editor.addEventListener('click', event => {
    const button = event.target.closest('[data-remove-person-look]');
    if (!button) return;
    if (list.querySelectorAll('[data-person-look]').length <= 1) return;
    button.closest('[data-person-look]')?.remove();
    reindex(list);
  });
}

export function collectPersonLookValues(values = {}, profile = {}) {
  const indices = [...new Set(Object.keys(values).map(key => key.match(/^look_(\d+)_/)?.[1]).filter(value => value !== undefined).map(Number))].sort((a, b) => a - b);
  const existingById = new Map((Array.isArray(profile.look_profiles) ? profile.look_profiles : [])
    .map(look => [String(look?.id || ''), look]));
  const looks = indices.map((index, order) => {
    const id = String(values[`look_${index}_id`] || `${profile.id || 'cast'}_look_${order + 1}`).trim();
    return {
      ...(existingById.get(id) || {}),
      id,
      name: String(values[`look_${index}_name`] || `造型 ${order + 1}`).trim(),
      story_state: String(values[`look_${index}_story_state`] || '').trim(),
      scene_ids: String(values[`look_${index}_scene_ids`] || '').split(',').map(value => value.trim()).filter(Boolean),
      scene_names: String(values[`look_${index}_scene_names`] || '').split(',').map(value => value.trim()).filter(Boolean),
      wardrobeText: String(values[`look_${index}_wardrobeText`] || '').trim(),
      hairMakeupText: String(values[`look_${index}_hairMakeupText`] || '').trim(),
      negativeText: String(values[`look_${index}_negativeText`] || '').trim(),
      style_richness: String(values[`look_${index}_style_richness`] || 'auto').trim(),
      source: 'user_edit',
    };
  }).filter(look => look.wardrobeText);
  const base = Object.fromEntries(Object.entries(values).filter(([key]) => !/^look_\d+_/.test(key)));
  const ageInput = String(base.age || '').trim();
  const range = ageInput.match(/^(?:年龄|实际年龄|外观年龄)?\s*(\d{1,7})\s*(?:~|～|-|—|–|至|到)\s*(\d{1,7})\s*(?:岁|周岁)?$/u);
  const exact = ageInput.match(/^(?:年龄|实际年龄)?\s*(\d{1,7})\s*(?:岁|周岁)?$/u);
  if (range) base.age = `${Number(range[1])}~${Number(range[2])}岁`;
  else if (exact) base.age = `${Number(exact[1])}岁`;
  else if (!ageInput) base.age = 'match_brief';
  return {
    ...base,
    look_profiles: looks,
    wardrobeText: looks[0]?.wardrobeText || '',
    hairMakeupText: looks[0]?.hairMakeupText || base.hairMakeupText || '',
  };
}

export function applyGeneratedPersonLooks(form, generated = {}) {
  const looks = Array.isArray(generated.look_profiles) ? generated.look_profiles : [];
  const editor = form?.querySelector('[data-person-look-editor]');
  const list = editor?.querySelector('[data-person-look-list]');
  if (!list || !looks.length) return false;
  list.innerHTML = looks.map(lookEditor).join('');
  reindex(list);
  return true;
}
