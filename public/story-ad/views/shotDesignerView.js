import { request } from '../api.js';
import { emptyState, escapeHtml, mediaPreview, setButtonBusy, toast } from '../components/ui.js';

const FIELD_GROUPS = [
  ['场景与机位', [
    ['scene_id', '使用场景'], ['scene_zone', '空间区域'], ['scene_view', '拍摄视角'], ['camera_id', '拍摄机位'],
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

const VALUE_OPTIONS = {
  scene_view: [['master', '主视角'], ['reverse', '反向视角'], ['interaction', '互动动作位'], ['detail', '材质细节位'], ['layout', '空间布局位']],
  shot_size: [['extreme_wide', '大远景'], ['wide', '全景'], ['full', '全身景'], ['medium', '中景'], ['medium_close', '中近景'], ['close_up', '特写'], ['extreme_close_up', '大特写'], ['macro', '微距']],
  camera_angle: [['eye_level', '平视'], ['high_angle', '俯拍'], ['low_angle', '仰拍'], ['overhead', '顶拍'], ['dutch', '倾斜镜头'], ['over_shoulder', '过肩视角'], ['pov', '主观视角']],
  depth_of_field: [['deep', '深景深（前后都清楚）'], ['medium', '中等景深'], ['shallow', '浅景深（主体清楚）'], ['ultra_shallow', '极浅景深（背景强虚化）']],
  composition: [['center_frame', '中心构图'], ['rule_of_thirds', '三分构图'], ['symmetry', '对称构图'], ['leading_lines', '引导线构图'], ['negative_space', '留白构图']],
  subject_position: [['center_frame', '画面中央'], ['left_third', '左侧三分位'], ['right_third', '右侧三分位'], ['foreground', '画面前景'], ['background', '画面后景']],
  camera_movement: [['static', '固定机位'], ['pan', '水平摇镜'], ['tilt', '上下摇镜'], ['dolly_in', '缓慢推近'], ['dolly_out', '缓慢拉远'], ['tracking', '跟随拍摄'], ['handheld', '手持跟拍'], ['orbit', '环绕拍摄']],
  screen_direction: [['left_to_right', '从左向右'], ['right_to_left', '从右向左'], ['toward_camera', '朝向镜头'], ['away_from_camera', '远离镜头'], ['static', '无明显方向']],
  transition_type: [['none', '不指定'], ['hard_cut', '直接切换'], ['cut_on_action', '动作衔接切换'], ['match_cut', '相似画面匹配切换'], ['dissolve', '叠化'], ['fade', '淡入淡出']],
};

const LONG_FIELDS = new Set(['entry_frame_state', 'exit_frame_state', 'transition_reason', 'eyeline', 'camera_axis']);

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

function sceneAsset(bundle, shot) {
  const scenes = Array.isArray(bundle?.assets?.scenes) ? bundle.assets.scenes : [];
  return scenes.find(item => String(item.id) === String(shot.scene_id || shot.scene_asset_id || '')) || null;
}

function dynamicOptions(bundle, shot, name) {
  const scenes = Array.isArray(bundle?.assets?.scenes) ? bundle.assets.scenes : [];
  const scene = sceneAsset(bundle, shot);
  if (name === 'scene_id') return scenes.map(item => [item.id, item.name || item.description || '未命名场景']);
  if (name === 'scene_zone') return (scene?.zones || []).map(item => [item.id || item.label, item.label || item.purpose || '未命名区域']);
  if (name === 'camera_id') return (scene?.cameras || []).map(item => [item.id || item.view_id, [item.label, item.role].filter(Boolean).join(' · ') || '未命名机位']);
  if (name === 'scene_view') {
    const cameraViews = (scene?.cameras || []).map(item => [item.view_id || item.id, item.label || item.role || '场景视角']);
    return [...cameraViews, ...(VALUE_OPTIONS.scene_view || [])];
  }
  return VALUE_OPTIONS[name] || [];
}

function friendlyValue(bundle, shot, name, value) {
  if (value === undefined || value === null || value === '') return '待选择';
  return dynamicOptions(bundle, shot, name).find(([id]) => String(id) === String(value))?.[1]
    || String(value).replace(/_/g, ' ');
}

function fieldEditor(bundle, shot, definition) {
  const [name, label, type = 'text'] = definition;
  const value = shot[name] ?? '';
  const options = dynamicOptions(bundle, shot, name);
  if (options.length) {
    const normalized = new Map(options.filter(([id]) => id).map(([id, text]) => [String(id), String(text || id)]));
    if (value !== '' && !normalized.has(String(value))) normalized.set(String(value), friendlyValue(bundle, shot, name, value));
    return `<label class="field"><span>${escapeHtml(label)}</span><select class="select" data-shot-field="${name}"><option value="">请选择</option>${[...normalized].map(([id, text]) => `<option value="${escapeHtml(id)}" ${String(value) === id ? 'selected' : ''}>${escapeHtml(text)}</option>`).join('')}</select></label>`;
  }
  if (LONG_FIELDS.has(name)) return `<label class="field full"><span>${escapeHtml(label)}</span><textarea class="textarea" rows="3" data-shot-field="${name}">${escapeHtml(value)}</textarea></label>`;
  return `<label class="field"><span>${escapeHtml(label)}</span><input class="input" type="${type}" data-shot-field="${name}" value="${escapeHtml(value)}" title="${escapeHtml(value)}"></label>`;
}

function shotSummary(bundle, shot) {
  return [
    ['场景与机位', `${friendlyValue(bundle, shot, 'scene_id', shot.scene_id || shot.scene_asset_id)} · ${friendlyValue(bundle, shot, 'scene_zone', shot.scene_zone)} · ${friendlyValue(bundle, shot, 'camera_id', shot.camera_id)}`],
    ['画面方式', `${friendlyValue(bundle, shot, 'shot_size', shot.shot_size)} · ${friendlyValue(bundle, shot, 'camera_angle', shot.camera_angle)} · ${Number(shot.lens_mm) ? `${Number(shot.lens_mm)}mm` : '焦段待定'} · ${friendlyValue(bundle, shot, 'depth_of_field', shot.depth_of_field)}`],
    ['运动与衔接', `${friendlyValue(bundle, shot, 'camera_movement', shot.camera_movement)} · ${friendlyValue(bundle, shot, 'transition_type', shot.transition_type)}`],
  ];
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
      <div class="view-actions"><button class="btn" type="button" data-ai-shot>AI 帮我完善镜头</button><button class="btn primary" type="button" data-save-shot>保存当前镜头</button></div>
    </section>
    <div class="shot-designer">
      <aside class="shot-rail card">
        <div class="card-head"><div><h2>${shots.length} 个镜头</h2><p>点击切换，画布不使用假数据。</p></div></div>
        <div class="shot-rail-list">${shots.map((shot, index) => {
          const number = shotNumber(shot, index);
          return `<button class="shot-rail-item ${index === selectedIndex ? 'active' : ''}" type="button" data-select-shot="${number}" aria-pressed="${index === selectedIndex ? 'true' : 'false'}">
            <b>SH${String(number).padStart(2, '0')} · ${escapeHtml(shot.title || `镜头 ${number}`)}</b>
            <span>${escapeHtml(friendlyValue(bundle, shot, 'scene_id', shot.scene_id || shot.scene_asset_id))} · ${Number(shot.duration || shot.duration_sec || 0) || '—'} 秒</span>
            <small>${escapeHtml(`${friendlyValue(bundle, shot, 'shot_size', shot.shot_size)} · ${friendlyValue(bundle, shot, 'camera_movement', shot.camera_movement)}`)}</small>
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
        <div class="card-head"><div><h2>镜头怎么拍</h2><p>优先显示普通人能理解的名称，选择后仍保存原有标准值。</p></div></div>
        <div class="card-body settings-groups">
          <section class="shot-readable-summary"><h3>当前拍摄摘要</h3>${shotSummary(bundle, selected).map(([label, value]) => `<div><span>${escapeHtml(label)}</span><p>${escapeHtml(value)}</p></div>`).join('')}</section>
          ${FIELD_GROUPS.map(([title, fields]) => `<section><h3>${escapeHtml(title)}</h3><div class="form-grid">${fields.map(field => fieldEditor(bundle, selected, field)).join('')}</div></section>`).join('')}
          <details class="technical-details"><summary>查看技术标识</summary><dl><div><dt>场景标识</dt><dd>${escapeHtml(selected.scene_id || selected.scene_asset_id || '未设置')}</dd></div><div><dt>机位标识</dt><dd>${escapeHtml(selected.camera_id || '未设置')}</dd></div></dl></details>
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
