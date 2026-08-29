import { request } from '../api.js?v=20260829-production-v279d';
import { elapsedTimeTag, emptyState, escapeHtml, mediaPreview, setButtonBusy, toast } from '../components/ui.js?v=20260829-production-v279d';
import { bindGenerationModelPicker, loadGenerationModelPicker } from './generationModelPicker.js?v=20260829-production-v279d';

function progressMarkup(progress = null) {
  if (!progress) return '';
  const requested = Math.max(0, Number(progress.requested || 0));
  const completed = Math.max(0, Number(progress.completed || 0));
  const failed = Math.max(0, Number(progress.failed || 0));
  const percent = Math.max(0, Math.min(100, Number(progress.percent || 0)));
  const status = String(progress.status || 'running');
  return `<div class="sketch-batch-progress is-${escapeHtml(status)}" role="status" aria-live="polite">
    <div class="sketch-batch-progress-head"><b>${status === 'failed' ? '流向线稿部分失败' : (status === 'succeeded' ? '流向线稿已生成' : '正在并行生成剧情流向线稿')}</b><span>${completed}/${requested}${failed ? ` · 失败 ${failed}` : ''} · ${percent}%</span></div>
    <div class="progress-track"><i style="width:${percent}%"></i></div>
    <small>${escapeHtml(progress.message || '')} ${elapsedTimeTag({ startedAt: progress.started_at, finishedAt: progress.finished_at, active: ['queued', 'running'].includes(status) })}</small>
  </div>`;
}

function flowCard(beat = {}, sketch = {}, index = 0) {
  const beatIndex = Number(beat.beat_index || beat.index || index + 1) || index + 1;
  return `<article class="card sketch-card sketch-tile flow-sketch-card" id="flow-beat-${beatIndex}" tabindex="-1">
    <div class="sketch-tile-media">${mediaPreview(sketch, { label: `剧情节点 ${beatIndex} · ${beat.title || ''}`, width: 960, symbol: '流向线稿', zoomable: true, zoomGroup: 'story-flow-sketches' })}<span class="sketch-shot-number">B${String(beatIndex).padStart(2, '0')}</span></div>
    <div class="sketch-tile-copy"><div><small>第 ${beatIndex} 个剧情节点</small><h2>${escapeHtml(beat.title || `剧情节点 ${beatIndex}`)}</h2><p>${escapeHtml(beat.plot || beat.visual || beat.story_visual || beat.action || '')}</p></div><span class="status-tag is-${sketch.status === 'confirmed' ? 'success' : 'neutral'}">${sketch.status === 'confirmed' ? '已确认' : (sketch.image_url ? '待整体确认' : '待生成')}</span></div>
  </article>`;
}

function sequenceRail(beats = [], sketches = []) {
  const generated = new Set(sketches.filter(item => item.image_url).map(item => Number(item.beat_index)));
  return `<nav class="flow-sequence-rail" aria-label="剧情流向节点">${beats.map((beat, index) => {
    const beatIndex = Number(beat.beat_index || beat.index || index + 1) || index + 1;
    return `<button type="button" class="flow-sequence-node ${generated.has(beatIndex) ? 'is-generated' : ''}" data-flow-jump="${beatIndex}" title="${escapeHtml(beat.title || `剧情节点 ${beatIndex}`)}"><b>${String(beatIndex).padStart(2, '0')}</b><span>${escapeHtml(beat.title || `节点 ${beatIndex}`)}</span></button>`;
  }).join('')}</nav>`;
}

export async function mount(host, context) {
  const { bundle, store } = context;
  const beats = Array.isArray(bundle?.story?.blueprint?.beats) ? bundle.story.blueprint.beats : [];
  const flow = bundle?.story_flow || { sketches: [], batch: null, gate: { ready: false, confirmed: 0, total: beats.length } };
  const sketches = Array.isArray(flow.sketches) ? flow.sketches : [];
  const byBeat = new Map(sketches.map(item => [Number(item.beat_index), item]));
  const generated = beats.filter((beat, index) => byBeat.get(Number(beat.beat_index || beat.index || index + 1))?.image_url).length;
  const allGenerated = beats.length > 0 && generated === beats.length;
  const active = ['queued', 'running'].includes(String(flow.batch?.status || ''));
  const picker = await loadGenerationModelPicker(bundle.project.id, 'new_story_ad.story_flow_sketch', { label: '线稿模型' });
  host.innerHTML = `<section class="workspace-page storyboard-page flow-sketch-page">
    <div class="page-heading storyboard-heading flow-sketch-head"><div><h1>剧情流向线稿</h1><p>整项任务共 ${beats.length} 个剧情节点，每个节点生成 1 张单画面草图；${beats.length} 张依次组成完整剧情流向。</p></div>
      <div class="storyboard-heading-actions">${picker.html}
        ${flow.gate?.ready
          ? `<button class="btn primary" type="button" data-open-storyboard>进入人物场景分镜</button>`
          : (allGenerated
            ? '<button class="btn primary" type="button" data-confirm-flow>确认全部流向线稿</button>'
            : `<button class="btn primary" type="button" data-generate-flow ${active ? 'disabled' : ''}>${active ? '正在生成…' : `生成流向线稿（${Math.max(0, beats.length - generated)}）`}</button>`)}
      </div></div>
    <div data-flow-progress>${progressMarkup(flow.batch)}</div>
    <div class="guide flow-sketch-guide"><b>一节点一张图</b><span>不是四格或九宫格。这里只看事件顺序、动作因果和前后衔接；全部确认后再进入人物、场景、动作与机位分镜。</span></div>
    ${beats.length ? sequenceRail(beats, sketches) : ''}
    ${beats.length ? `<div class="storyboard-sketch-grid">${beats.map((beat, index) => flowCard(beat, byBeat.get(Number(beat.beat_index || beat.index || index + 1)) || {}, index)).join('')}</div>` : `<div class="card">${emptyState({ title: '还没有剧情节点', body: '请先返回剧情与对白，生成并确认完整剧情。' })}</div>`}
  </section>`;

  const selectedModel = bindGenerationModelPicker(host, picker);
  let pollTimer = null;
  let disposed = false;
  const stopPolling = () => { if (pollTimer) clearTimeout(pollTimer); pollTimer = null; };
  const poll = async () => {
    if (disposed) return;
    try {
      const data = await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/flow-sketches/generate-batch`);
      const progressHost = host.querySelector('[data-flow-progress]');
      if (progressHost) progressHost.innerHTML = progressMarkup(data.progress);
      if (['queued', 'running'].includes(String(data.progress?.status || ''))) {
        pollTimer = setTimeout(poll, 1200);
      } else {
        stopPolling();
        await store.refreshSections('summary,assets,story,shots');
        context.refreshShell();
      }
    } catch (error) {
      stopPolling();
      toast(error.message, 'danger');
    }
  };

  host.querySelector('[data-generate-flow]')?.addEventListener('click', async event => {
    const model = selectedModel();
    if (!model) return toast('请先选择本次线稿模型。', 'warning');
    setButtonBusy(event.currentTarget, true, '正在启动…');
    try {
      await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/flow-sketches/generate-batch`, {
        method: 'POST',
        body: { confirmed: true, image_model: model, client_request_id: globalThis.crypto?.randomUUID?.() || `${Date.now()}` },
      });
      toast('剧情流向线稿已经并行开始生成。', 'success');
      await poll();
    } catch (error) {
      setButtonBusy(event.currentTarget, false);
      toast(error.message, 'danger');
    }
  });
  host.querySelector('[data-confirm-flow]')?.addEventListener('click', async event => {
    setButtonBusy(event.currentTarget, true, '正在确认…');
    try {
      await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/flow-sketches/confirm`, { method: 'POST', body: {} });
      await store.refreshSections('summary,assets,story,shots');
      context.navigate(`/story-ad/projects/${encodeURIComponent(bundle.project.id)}?view=storyboard`);
    } catch (error) {
      setButtonBusy(event.currentTarget, false);
      toast(error.message, 'danger');
    }
  });
  host.querySelector('[data-open-storyboard]')?.addEventListener('click', () => context.navigate(`/story-ad/projects/${encodeURIComponent(bundle.project.id)}?view=storyboard`));
  host.querySelectorAll('[data-flow-jump]').forEach(button => button.addEventListener('click', () => {
    const card = host.querySelector(`#flow-beat-${button.dataset.flowJump}`);
    if (!card) return;
    host.querySelectorAll('.flow-sketch-card.is-focused').forEach(item => item.classList.remove('is-focused'));
    card.classList.add('is-focused');
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.focus({ preventScroll: true });
    globalThis.setTimeout(() => card.classList.remove('is-focused'), 1400);
  }));
  if (active) void poll();
  return () => { disposed = true; stopPolling(); };
}
