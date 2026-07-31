import { request } from '../api.js';
import { emptyState, escapeHtml, mediaPreview, setButtonBusy, toast } from '../components/ui.js';
import { confirmDialog } from '../components/dialog.js';

/** 输出文字分镜表格行。 */
function shotRow(shot = {}, index = 0) {
  const shotIndex = Number(shot.shot_index || shot.index || index + 1) || index + 1;
  const bindings = [
    shot.scene_id || shot.scene_asset_id,
    shot.camera_id,
    ...(Array.isArray(shot.character_ids) ? shot.character_ids : []),
  ].filter(Boolean);
  return `<div class="shot-row" data-storyboard-shot="${shotIndex}">
    <b>SH${String(shotIndex).padStart(2, '0')}</b>
    <div class="media-placeholder"><span>线稿待确认</span></div>
    <span class="shot-copy"><b>${escapeHtml(shot.title || `镜头 ${shotIndex}`)}</b><small>${escapeHtml(shot.visual || shot.visual_description || shot.action || '')}</small></span>
    <span>${escapeHtml(shot.voiceover || shot.narration || '—')}</span>
    <span class="binding-chips">${bindings.length ? bindings.map(value => `<span class="chip ok">${escapeHtml(value)}</span>`).join('') : '<span class="chip">未绑定</span>'}</span>
    <button class="btn small" type="button" data-edit-shot="${shotIndex}">编辑</button>
  </div>`;
}

/** 输出逐镜线稿确认卡。 */
function sketchCard(shot, sketch = {}, index = 0) {
  const shotIndex = Number(shot.shot_index || shot.index || index + 1) || index + 1;
  return `<article class="card sketch-card" data-sketch-shot="${shotIndex}">
    <div class="card-head"><div><h2>SH${String(shotIndex).padStart(2, '0')} · ${escapeHtml(shot.title || `镜头 ${shotIndex}`)}</h2><p>${escapeHtml(shot.visual || shot.visual_description || shot.action || '')}</p></div><span class="status-tag is-${sketch.status === 'confirmed' ? 'success' : 'neutral'}">${escapeHtml(sketch.status === 'confirmed' ? '已确认' : (sketch.status === 'skipped' ? '已跳过' : '待确认'))}</span></div>
    <div class="card-body two-column">
      <div>${mediaPreview(sketch, { label: `镜头 ${shotIndex} 线稿`, width: 720, symbol: '线稿' })}</div>
      <div class="form-grid">
        <label class="field full"><span>构图约束</span><textarea class="textarea" rows="6" data-sketch-notes placeholder="确认主体数量、站位、景别、视线和运动方向。">${escapeHtml(sketch.composition_notes || '')}</textarea></label>
        <div class="field full sketch-action-bar">
          <input class="hidden-input" type="file" accept="image/png,image/jpeg,image/webp" data-sketch-file>
          <div class="sketch-actions" role="group" aria-label="镜头 ${shotIndex} 线稿操作">
            <button class="btn ${sketch.image_url ? '' : 'primary'}" type="button" data-generate-sketch>${sketch.image_url ? '重新生成' : '生成线稿'}</button>
            <button class="btn" type="button" data-upload-sketch>上传线稿</button>
            <button class="btn quiet" type="button" data-skip-sketch>跳过本镜</button>
            <button class="btn primary sketch-confirm-action" type="button" data-confirm-sketch>确认构图</button>
          </div>
        </div>
      </div>
    </div>
  </article>`;
}

/** 挂载分镜台。 */
export async function mount(host, context) {
  const { bundle, store } = context;
  const shots = Array.isArray(bundle?.storyboard?.shots) ? bundle.storyboard.shots : [];
  const sketches = Array.isArray(bundle?.storyboard?.sketches) ? bundle.storyboard.sketches : [];
  const sketchByShot = new Map(sketches.map(item => [Number(item.shot_index), item]));
  host.innerHTML = `
    <section class="view-head">
      <div><h1>分镜台</h1><p>文字分镜决定剧情和动作；线稿只确认构图与衔接，不直接生成付费视频。</p></div>
      <div class="view-actions">${shots.length ? '<button class="btn primary" type="button" data-open-shot-design>进入镜头设计</button>' : '<button class="btn primary" type="button" data-generate-storyboard>生成文字分镜</button>'}</div>
    </section>
    <div class="guide">线稿可逐镜生成、上传或跳过；确认后构图约束会写入现有分镜并使关键帧合同按版本重建。</div>
    <div class="tabs">
      <button class="tab active" type="button" data-board-tab="shots">文字分镜 ${shots.length}</button>
      <button class="tab" type="button" data-board-tab="sketches">线稿确认 ${sketches.filter(item => item.status === 'confirmed').length}/${shots.length}</button>
    </div>
    <section data-board-panel="shots">
      ${shots.length ? `<div class="card shot-table">
        <div class="shot-row header"><span>镜头</span><span>线稿</span><span>剧情与动作</span><span>旁白 / 台词</span><span>绑定资产</span><span>操作</span></div>
        ${shots.map(shotRow).join('')}
      </div>` : `<div class="card">${emptyState({
        title: '还没有文字分镜',
        body: '先确认剧情蓝图，再生成与剧情情节点一一对应的镜头。',
        action: '生成文字分镜',
        actionId: 'generate-storyboard',
      })}</div>`}
    </section>
    <section data-board-panel="sketches" hidden>
      ${shots.length ? `<div class="beat-list">${shots.map((shot, index) => sketchCard(shot, sketchByShot.get(Number(shot.shot_index || shot.index || index + 1)) || {}, index)).join('')}</div>` : `<div class="card">${emptyState({ title: '没有可确认的镜头', body: '生成文字分镜后再处理线稿。' })}</div>`}
    </section>`;

  host.querySelectorAll('[data-board-tab]').forEach(button => {
    button.addEventListener('click', () => {
      host.querySelectorAll('[data-board-tab]').forEach(item => item.classList.toggle('active', item === button));
      host.querySelectorAll('[data-board-panel]').forEach(panel => { panel.hidden = panel.dataset.boardPanel !== button.dataset.boardTab; });
    });
  });

  const generateStoryboard = async button => {
    try {
      setButtonBusy(button, true, '正在提交…');
      await store.runStage('storyboard');
      toast('文字分镜生成任务已提交。', 'success');
      await context.refreshShell();
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      setButtonBusy(button, false);
    }
  };
  host.querySelector('[data-generate-storyboard]')?.addEventListener('click', event => generateStoryboard(event.currentTarget));
  host.querySelector('[data-empty-action="generate-storyboard"]')?.addEventListener('click', event => generateStoryboard(event.currentTarget));
  host.querySelector('[data-open-shot-design]')?.addEventListener('click', () => context.navigate(`/story-ad/projects/${encodeURIComponent(bundle.project.id)}?view=shot`));
  host.querySelectorAll('[data-edit-shot]').forEach(button => button.addEventListener('click', () => context.navigate(`/story-ad/projects/${encodeURIComponent(bundle.project.id)}?view=shot&shot=${encodeURIComponent(button.dataset.editShot)}`)));

  /** 保存某一镜线稿，并保留其它镜头状态。 */
  async function saveSketch(card, patch) {
    const shotIndex = Number(card.dataset.sketchShot);
    const current = sketchByShot.get(shotIndex) || { id: `storyboard-sketch-${shotIndex}`, shot_index: shotIndex, status: 'draft' };
    const next = {
      ...current,
      ...patch,
      shot_index: shotIndex,
      composition_notes: card.querySelector('[data-sketch-notes]')?.value?.trim() || patch.composition_notes || current.composition_notes || '',
    };
    sketchByShot.set(shotIndex, next);
    await store.saveSketches([...sketchByShot.values()]);
    await context.refreshShell();
  }

  host.querySelectorAll('[data-sketch-shot]').forEach(card => {
    const shotIndex = Number(card.dataset.sketchShot);
    card.querySelector('[data-upload-sketch]').addEventListener('click', () => card.querySelector('[data-sketch-file]').click());
    card.querySelector('[data-sketch-file]').addEventListener('change', async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const uploaded = await store.upload(file, 'storyboard_sketch');
        const asset = uploaded.asset || uploaded.data;
        await saveSketch(card, { status: 'draft', image_url: asset.image_url || asset.url || '', source: 'upload' });
        toast('线稿已上传。', 'success');
      } catch (error) {
        toast(error.message, 'danger');
      }
    });
    card.querySelector('[data-skip-sketch]').addEventListener('click', async () => {
      try {
        await saveSketch(card, { status: 'skipped' });
        toast(`镜头 ${shotIndex} 已跳过线稿。`, 'success');
      } catch (error) { toast(error.message, 'danger'); }
    });
    card.querySelector('[data-confirm-sketch]').addEventListener('click', async event => {
      const button = event.currentTarget;
      try {
        setButtonBusy(button, true, '确认中…');
        await saveSketch(card, { status: 'confirmed' });
        toast(`镜头 ${shotIndex} 构图已确认。`, 'success');
      } catch (error) {
        toast(error.message, 'danger');
      } finally {
        setButtonBusy(button, false);
      }
    });
    card.querySelector('[data-generate-sketch]').addEventListener('click', async event => {
      if (!await confirmDialog(`将为镜头 ${shotIndex} 调用一次图片生成，用于低成本线稿确认。`, {
        title: '生成镜头线稿',
        confirmText: '确认生成',
      })) return;
      const button = event.currentTarget;
      try {
        setButtonBusy(button, true, '生成中…');
        const data = await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/sketches/${shotIndex}/generate`, {
          method: 'POST',
          body: { confirmed: true },
          timeoutMs: 360000,
        });
        sketchByShot.set(shotIndex, data.sketch);
        toast(`镜头 ${shotIndex} 线稿已生成。`, 'success');
        await context.refreshShell();
      } catch (error) {
        toast(error.message, 'danger');
      } finally {
        setButtonBusy(button, false);
      }
    });
  });
}
