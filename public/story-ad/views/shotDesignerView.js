import { request } from '../api.js';
import { emptyState, escapeHtml, mediaPreview, setButtonBusy, toast } from '../components/ui.js';

const FIELD_GROUPS = [
  ['场景与机位', [
    ['scene_id', '场景 ID'], ['scene_zone', '空间区域'], ['scene_view', '场景镜位'], ['camera_id', '机位 ID'],
  ]],
  ['画面与镜头', [
    ['shot_size', '景别'], ['camera_angle', '俯仰角'], ['lens_mm', '焦段（mm）', 'number'],
    ['depth_of_field', '景深'], ['composition', '构图'], ['subject_position', '主体位置'],
  ]],
  ['运镜与衔接', [
    ['camera_movement', '运镜'], ['entry_frame_state', '起始状态'], ['exit_frame_state', '结束状态'],
    ['screen_direction', '运动方向'], ['eyeline', '视线'], ['camera_axis', '摄影轴线'],
    ['transition_type', '与下镜衔接'], ['transition_reason', '衔接原因'],
  ]],
];

function shotNumber(shot = {}, index = 0) {
  return Number(shot.shot_index || shot.index || index + 1) || index + 1;
}

function shotMedia(bundle, selected, selectedIndex) {
  const keyframes = Array.isArray(bundle?.generation?.keyframes) ? bundle.generation.keyframes : [];
  const keyframe = keyframes.find((item, index) => (
    Number(item.shot_index ?? item.shotIndex ?? item.index ?? index) === selectedIndex
    || Number(item.shot_index ?? item.shotIndex ?? item.index ?? index + 1) === selectedIndex + 1
  ));
  const sketch = bundle?.storyboard?.sketches?.find(item => Number(item.shot_index) === shotNumber(selected, selectedIndex));
  return keyframe || sketch || {};
}

function fieldEditor(shot, definition) {
  const [name, label, type = 'text'] = definition;
  const value = shot[name] ?? '';
  return `<label class="field"><span>${escapeHtml(label)}</span><input class="input" type="${type}" data-shot-field="${name}" value="${escapeHtml(value)}"></label>`;
}

function collectShot(host, original) {
  const next = { ...original, _nsa_user_edited_fields: { ...(original._nsa_user_edited_fields || {}) } };
  host.querySelectorAll('[data-shot-field]').forEach(input => {
    const key = input.dataset.shotField;
    const value = input.type === 'number' ? (Number(input.value) || '') : input.value.trim();
    if (next[key] !== value) next._nsa_user_edited_fields[key] = true;
    next[key] = value;
  });
  next.visual_description = next.visual;
  next.duration_sec = Math.max(1, Number(next.duration) || Number(next.duration_sec) || 3);
  next.duration = next.duration_sec;
  return next;
}

/** 挂载逐镜设计页，所有字段直接编辑现有 storyboard_table。 */
export async function mount(host, context) {
  const { bundle, store, route } = context;
  const shots = Array.isArray(bundle?.storyboard?.shots) ? bundle.storyboard.shots : [];
  if (!shots.length) {
    host.innerHTML = `<section class="view-head"><div><h1>镜头设计</h1><p>逐镜设置必须建立在真实文字分镜上。</p></div></section><section class="card">${emptyState({
      title: '还没有可设计的镜头',
      body: '先在分镜台生成并确认文字分镜。',
      action: '返回分镜台',
      actionId: 'back-storyboard',
    })}</section>`;
    host.querySelector('[data-empty-action="back-storyboard"]')?.addEventListener('click', () => context.navigate(`/story-ad/projects/${encodeURIComponent(bundle.project.id)}?view=storyboard`));
    return;
  }
  const requested = Math.max(1, Number(route.params.get('shot')) || 1);
  const selectedIndex = Math.max(0, shots.findIndex((shot, index) => shotNumber(shot, index) === requested));
  const selected = shots[selectedIndex];
  const media = shotMedia(bundle, selected, selectedIndex);
  const previous = shots[selectedIndex - 1] || null;
  const next = shots[selectedIndex + 1] || null;
  host.innerHTML = `
    <section class="view-head compact">
      <div><h1>镜头设计</h1><p>逐镜确认场景、机位、构图、运镜、起止状态和相邻镜头衔接。</p></div>
      <div class="view-actions"><button class="btn" type="button" data-ai-shot>AI 补齐当前镜头</button><button class="btn primary" type="button" data-save-shot>保存当前镜头</button></div>
    </section>
    <div class="shot-designer">
      <aside class="shot-rail card">
        <div class="card-head"><div><h2>${shots.length} 个镜头</h2><p>点击切换，画布不使用假数据。</p></div></div>
        <div class="shot-rail-list">${shots.map((shot, index) => {
          const number = shotNumber(shot, index);
          return `<button class="shot-rail-item ${index === selectedIndex ? 'active' : ''}" type="button" data-select-shot="${number}">
            <b>SH${String(number).padStart(2, '0')} · ${escapeHtml(shot.title || `镜头 ${number}`)}</b>
            <span>${escapeHtml(shot.scene_id || shot.scene_zone || '未绑定场景')} · ${Number(shot.duration || shot.duration_sec || 0) || '—'} 秒</span>
            <small>${escapeHtml(shot.transition_type || shot.camera_movement || '待确认镜头参数')}</small>
          </button>`;
        }).join('')}</div>
      </aside>
      <section class="shot-preview-column">
        <article class="card shot-preview-card">
          <div class="card-head"><div><h2>SH${String(shotNumber(selected, selectedIndex)).padStart(2, '0')} · ${escapeHtml(selected.title || '当前镜头')}</h2><p>${escapeHtml(selected.purpose || selected.objective || '')}</p></div></div>
          <div class="shot-preview-media">${mediaPreview(media, { label: selected.title || '当前镜头', width: 960, symbol: '预览' })}</div>
          <div class="card-body form-grid">
            <label class="field full"><span>画面说明</span><textarea class="textarea" rows="4" data-shot-field="visual">${escapeHtml(selected.visual || selected.visual_description || '')}</textarea></label>
            <label class="field full"><span>人物 / 商品动作</span><textarea class="textarea" rows="3" data-shot-field="action">${escapeHtml(selected.action || '')}</textarea></label>
            <label class="field"><span>时长（秒）</span><input class="input" type="number" min="1" max="15" data-shot-field="duration" value="${Number(selected.duration || selected.duration_sec || 3) || 3}"></label>
            <label class="field"><span>旁白或台词</span><input class="input" data-shot-field="voiceover" value="${escapeHtml(selected.voiceover || selected.narration || '')}"></label>
          </div>
        </article>
        <article class="card continuity-card">
          <div class="card-head"><div><h2>相邻镜头连续性</h2><p>用真实前后镜检查动作、主体状态、光线、视线和运动方向。</p></div></div>
          <div class="continuity-grid">
            <div><span>上一镜交出</span><p>${escapeHtml(previous?.exit_frame_state || previous?.visual || '没有上一镜')}</p></div>
            <strong aria-hidden="true">→</strong>
            <div><span>当前镜进入</span><p>${escapeHtml(selected.entry_frame_state || '尚未填写')}</p></div>
            <div><span>当前镜交出</span><p>${escapeHtml(selected.exit_frame_state || '尚未填写')}</p></div>
            <strong aria-hidden="true">→</strong>
            <div><span>下一镜进入</span><p>${escapeHtml(next?.entry_frame_state || next?.visual || '没有下一镜')}</p></div>
          </div>
        </article>
      </section>
      <aside class="shot-settings card">
        <div class="card-head"><div><h2>镜头参数</h2><p>空字段可由 AI 补齐，也可手动锁定。</p></div></div>
        <div class="card-body settings-groups">
          ${FIELD_GROUPS.map(([title, fields]) => `<section><h3>${escapeHtml(title)}</h3><div class="form-grid">${fields.map(field => fieldEditor(selected, field)).join('')}</div></section>`).join('')}
        </div>
      </aside>
    </div>`;

  host.querySelectorAll('[data-select-shot]').forEach(button => button.addEventListener('click', () => {
    context.navigate(`/story-ad/projects/${encodeURIComponent(bundle.project.id)}?view=shot&shot=${encodeURIComponent(button.dataset.selectShot)}`);
  }));

  const saveCurrent = async button => {
    try {
      setButtonBusy(button, true, '保存中…');
      const nextShots = shots.map((shot, index) => index === selectedIndex ? collectShot(host, shot) : shot);
      await store.saveStoryboard(nextShots);
      toast('当前镜头已保存。', 'success');
      await context.refreshShell();
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      setButtonBusy(button, false);
    }
  };
  host.querySelector('[data-save-shot]').addEventListener('click', event => saveCurrent(event.currentTarget));
  host.querySelector('[data-ai-shot]').addEventListener('click', async event => {
    const button = event.currentTarget;
    try {
      setButtonBusy(button, true, '正在补齐…');
      const currentShot = collectShot(host, selected);
      const data = await request('/api/new-story-ad/assist', {
        method: 'POST',
        body: {
          mode: 'shot_settings',
          task_id: bundle.project.id,
          shot_assist_context: {
            previous_shot: previous,
            current_shot: currentShot,
            next_shot: next,
            scene_assets: bundle.assets?.scenes || [],
          },
        },
        timeoutMs: 180000,
      });
      const nextShots = shots.map((shot, index) => index === selectedIndex ? { ...currentShot, ...(data.shot_settings || {}) } : shot);
      await store.saveStoryboard(nextShots);
      toast('当前镜头参数已补齐并保存。', 'success');
      await context.refreshShell();
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      setButtonBusy(button, false);
    }
  });
}
