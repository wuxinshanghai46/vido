import { escapeHtml } from '../components/ui.js?v=20260814-reference-recovery-v33';

function ageRows(profile = {}) {
  const rows = Array.isArray(profile.age_states) ? profile.age_states : [];
  return rows.length ? rows : [{
    id: `${profile.id || 'cast'}_age_base`, name: '基础年龄状态',
    apparent_age: profile.apparent_age || profile.age || '', story_state: '', scene_ids: [], change_notes: '',
  }];
}

function ageEditor(state = {}, index = 0) {
  return `<fieldset class="person-age-state" data-age-state data-age-index="${index}">
    <legend><span>状态 ${index + 1}</span><b>${escapeHtml(state.name || `年龄状态 ${index + 1}`)}</b></legend>
    <input type="hidden" name="age_state_${index}_id" value="${escapeHtml(state.id || '')}">
    <input type="hidden" name="age_state_${index}_story_state_id" value="${escapeHtml(state.story_state_id || '')}">
    <div class="form-grid two"><label><span>状态名称</span><input name="age_state_${index}_name" value="${escapeHtml(state.name || '')}" required></label><label><span>外观年龄</span><input name="age_state_${index}_apparent_age" value="${escapeHtml(state.apparent_age || '')}" placeholder="如：25岁、55~65岁" required></label></div>
    <label><span>剧情阶段</span><input name="age_state_${index}_story_state" value="${escapeHtml(state.story_state || '')}" placeholder="如：千年后、晚年"></label>
    <input type="hidden" name="age_state_${index}_scene_ids" value="${escapeHtml((state.scene_ids || []).join(','))}">
    <label><span>仅允许发生的年龄变化</span><textarea name="age_state_${index}_change_notes" rows="2">${escapeHtml(state.change_notes || '')}</textarea></label>
    <button class="btn small person-age-state-remove" type="button" data-remove-age-state>删除状态</button>
  </fieldset>`;
}

export function renderPersonEvolutionEditor(profile = {}) {
  const continuity = String(profile.identity_continuity || 'same_person');
  const agingMode = String(profile.aging_mode || (continuity === 'reincarnation' ? 'reincarnation' : 'fixed'));
  const option = (value, label, current) => `<option value="${value}" ${current === value ? 'selected' : ''}>${label}</option>`;
  const states = ageRows(profile);
  return `<section class="person-evolution-editor" data-person-evolution-editor>
    <div class="drawer-section-head"><div><h3>人物状态演化</h3><p>身份、服装、年龄和剧情状态分别管理；换装不会重建身份母版。</p></div><span>${states.length} 个年龄状态</span></div>
    <input type="hidden" name="identity_id" value="${escapeHtml(profile.identity_id || profile.id || '')}">
    <input type="hidden" name="lineage_identity_id" value="${escapeHtml(profile.lineage_identity_id || profile.source_identity_id || profile.id || '')}">
    <div class="form-grid two"><label><span>身份关系</span><select name="identity_continuity">${option('same_person', '同一人物', continuity)}${option('reincarnation', '转世新身份', continuity)}${option('independent', '独立人物', continuity)}</select></label><label><span>年龄变化方式</span><select name="aging_mode">${option('fixed', '固定外观年龄', agingMode)}${option('natural_aging', '同一人物自然变老', agingMode)}${option('ageless', '时间经过但容颜不老', agingMode)}${option('reincarnation', '转世为新身份', agingMode)}</select></label></div>
    <div data-age-state-list>${states.map(ageEditor).join('')}</div>
    <button class="btn small" type="button" data-add-age-state>添加年龄状态</button>
  </section>`;
}

function reindex(list) {
  [...list.querySelectorAll('[data-age-state]')].forEach((card, index) => {
    card.dataset.ageIndex = String(index);
    card.querySelector('legend span').textContent = `状态 ${index + 1}`;
    card.querySelectorAll('[name]').forEach(field => { field.name = field.name.replace(/^age_state_\d+_/, `age_state_${index}_`); });
  });
  const badge = list.closest('[data-person-evolution-editor]')?.querySelector('.drawer-section-head>span');
  if (badge) badge.textContent = `${list.querySelectorAll('[data-age-state]').length} 个年龄状态`;
}

export function bindPersonEvolutionForm(form) {
  const editor = form?.querySelector('[data-person-evolution-editor]');
  const list = editor?.querySelector('[data-age-state-list]');
  if (!editor || !list) return;
  editor.querySelector('[data-add-age-state]')?.addEventListener('click', () => {
    const index = list.querySelectorAll('[data-age-state]').length;
    list.insertAdjacentHTML('beforeend', ageEditor({ id: `age_${Date.now()}`, name: `年龄状态 ${index + 1}` }, index));
    reindex(list);
  });
  editor.addEventListener('click', event => {
    const button = event.target.closest('[data-remove-age-state]');
    if (!button || list.querySelectorAll('[data-age-state]').length <= 1) return;
    button.closest('[data-age-state]')?.remove();
    reindex(list);
  });
}

export function collectPersonEvolutionValues(values = {}, profile = {}) {
  const indices = [...new Set(Object.keys(values).map(key => key.match(/^age_state_(\d+)_/)?.[1]).filter(value => value !== undefined).map(Number))].sort((a, b) => a - b);
  return {
    identity_id: String(values.identity_id || profile.identity_id || profile.id || '').trim(),
    lineage_identity_id: String(values.lineage_identity_id || profile.lineage_identity_id || profile.source_identity_id || profile.id || '').trim(),
    identity_continuity: String(values.identity_continuity || profile.identity_continuity || 'same_person').trim(),
    aging_mode: String(values.aging_mode || profile.aging_mode || 'fixed').trim(),
    apparent_age: String(values.age || profile.apparent_age || profile.age || '').trim(),
    age_states: indices.map((index, order) => ({
      id: String(values[`age_state_${index}_id`] || `${profile.id || 'cast'}_age_${order + 1}`).trim(),
      story_state_id: String(values[`age_state_${index}_story_state_id`] || `${profile.id || 'cast'}_state_${order + 1}`).trim(),
      name: String(values[`age_state_${index}_name`] || `年龄状态 ${order + 1}`).trim(),
      apparent_age: String(values[`age_state_${index}_apparent_age`] || '').trim(),
      story_state: String(values[`age_state_${index}_story_state`] || '').trim(),
      scene_ids: String(values[`age_state_${index}_scene_ids`] || '').split(',').map(value => value.trim()).filter(Boolean),
      change_notes: String(values[`age_state_${index}_change_notes`] || '').trim(),
    })).filter(state => state.apparent_age),
  };
}

export function renderPersonEvolutionSummary(profile = {}) {
  const states = ageRows(profile);
  const mode = ({ fixed: '固定年龄', natural_aging: '自然变老', ageless: '容颜不老', reincarnation: '转世新身份' })[profile.aging_mode] || '固定年龄';
  return `<div class="person-evolution-summary"><span>${escapeHtml(mode)}</span>${states.map(state => `<b>${escapeHtml(state.name || '年龄状态')} · ${escapeHtml(state.apparent_age || '')}</b>`).join('')}</div>`;
}
