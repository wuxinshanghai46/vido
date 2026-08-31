import { emptyState, escapeHtml, mediaPreview, setButtonBusy, toast } from '../components/ui.js?v=20260831-production-v342';
import { bindMoreMedia, moreMediaButton } from './finalMediaPagination.js?v=20260831-production-v342';
import { bindGenerationModelPicker, loadGenerationModelPicker } from './generationModelPicker.js?v=20260831-production-v342';
import { request } from '../api.js?v=20260831-production-v342';
import { bindSoundDesign, soundDesignMarkup } from './finalSoundDesignView.js?v=20260831-production-v342';

function itemIndex(item = {}, index = 0) {
  const value = Number(item.shot_index ?? item.shotIndex ?? item.index);
  return Number.isFinite(value) ? (value === index ? index + 1 : value) : index + 1;
}

function mediaCard(item, index, kind) {
  const number = itemIndex(item, index);
  return `<article class="generation-card card">
    <div class="generation-media">${mediaPreview(item, { label: `${kind} ${number}`, width: 640, symbol: kind })}</div>
    <div class="generation-copy"><b>SH${String(number).padStart(2, '0')}</b><span>${escapeHtml(item.status || item.qa_status || '已生成')}</span></div>
  </article>`;
}

function finalVideoUrl(item = {}) {
  return item.video_url || item.videoUrl || item.url || '';
}

function finalVideoPlayer(item = {}, poster = '') {
  const url = finalVideoUrl(item);
  if (!url) return '<div class="media-placeholder final-video-empty"><span>成片文件尚未就绪</span></div>';
  return `<video class="final-video" src="${escapeHtml(url)}" poster="${escapeHtml(poster)}" controls preload="none" playsinline aria-label="最终成片">您的浏览器暂不支持视频播放。</video>`;
}

function preflightDialog(preflight = {}) {
  const cost = preflight.cost_plan || {};
  const blockers = Array.isArray(preflight.blockers) ? preflight.blockers : [];
  const shotCount = Array.isArray(preflight.shots) ? preflight.shots.length : 0;
  const complexityRequired = Number(preflight.execution_summary?.high_risk_unit_count || 0) > 0;
  return `<div class="modal-backdrop" data-preflight-modal>
    <section class="modal card" role="dialog" aria-modal="true" aria-labelledby="preflightTitle">
      <div class="card-head"><div><h2 id="preflightTitle">确认视频生成</h2><p>只有点击最终确认后才会提交视频模型。</p></div><button class="icon-btn" type="button" data-close-preflight>×</button></div>
      <div class="card-body">
        <div class="preflight-grid">
          <div><span>计划镜头</span><b>${shotCount}</b></div>
          <div><span>生成模式</span><b>${escapeHtml(preflight.mode || 'economy')}</b></div>
          <div><span>预计上限</span><b>${Number(cost.maximum_cost_rmb || 0).toFixed(2)} 元</b></div>
        </div>
        ${blockers.length ? `<div class="inline-error"><b>当前不能提交：</b>${blockers.map(item => escapeHtml(item.message || item)).join('；')}</div>` : ''}
        <label class="confirm-check"><input type="checkbox" data-cost-confirm> 我已核对镜头数量和费用上限，本次生成将产生实际调用。</label>
        ${complexityRequired ? '<label class="confirm-check"><input type="checkbox" data-complexity-confirm> 我已复核复杂镜头的动作、主体与运镜。</label>' : ''}
        <div class="form-actions"><button class="btn" type="button" data-close-preflight>取消</button><button class="btn primary" type="button" data-submit-video ${blockers.length ? 'disabled' : ''}>确认并开始生成</button></div>
      </div>
    </section>
  </div>`;
}

/** 挂载生成与成片页，所有付费调用均保留明确预检和用户确认。 */
export async function mount(host, context) {
  const { bundle, store } = context;
  const generation = bundle?.generation || {};
  const shots = bundle?.storyboard?.shots || [];
  const approvedFrames = Array.isArray(generation.approved_frames) ? generation.approved_frames : [];
  const clips = Array.isArray(generation.clips) ? generation.clips : [];
  const [soundDesign, timeline] = await Promise.all([
    request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/sound-design`).catch(() => ({ shots: [], profiles: [], assets: [], timeline: [], ledger: [], production: {} })),
    request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/timeline`).catch(() => ({ items: [] })),
  ]);
  const finalVideo = generation.final_video || (bundle?.project?.final_video_url ? {
    video_url: bundle.project.final_video_url,
    status: '已生成',
  } : null);
  const finalUrl = finalVideoUrl(finalVideo || {});
  const posterUrl = finalVideo?.poster_url || finalVideo?.thumbnail_url || approvedFrames.find(item => item.thumbnail_url || item.image_url || item.imageUrl)?.thumbnail_url || approvedFrames.find(item => item.image_url || item.imageUrl)?.image_url || approvedFrames.find(item => item.imageUrl)?.imageUrl || '';
  const downloadUrl = finalUrl ? `${finalUrl}${finalUrl.includes('?') ? '&' : '?'}download=1` : '';
  const mediaCatalog = generation.media_catalog || {};
  const clipTotal = Number(mediaCatalog.clips?.total || clips.length);
  const videoModelPicker = await loadGenerationModelPicker(bundle.project.id, 'new_story_ad.video', { label: '视频模型' });
  host.innerHTML = `
    <section class="view-head">
      <div><h1>声音、视频、剪辑与合成</h1><p>已确认分镜直接作为视频首帧；先完成全部声音试听，再生成视频并在时间线完成剪辑与合成。</p></div>
      <div class="view-actions">
        ${approvedFrames.length ? `${videoModelPicker.html}<button class="btn" type="button" data-generate-video>生成分镜视频</button>` : '<button class="btn" type="button" data-back-storyboard>返回补充分镜</button>'}
        ${clips.length ? '<button class="btn primary" type="button" data-compose>按时间线合成成片</button>' : ''}
      </div>
    </section>
    <div class="production-lanes" aria-label="生产轨道"><span data-production-lane><b>分镜</b><small>${approvedFrames.length}/${shots.length}</small></span><span data-production-lane><b>声音确认</b><small>${soundDesign.production?.approved ? '已确认' : '待确认'}</small></span><span data-production-lane><b>分镜视频</b><small>${clips.length}/${shots.length}</small></span><span data-production-lane><b>剪辑合成</b><small>${finalVideo ? '已完成' : '待完成'}</small></span></div>
    <div class="guide"><b>怎么操作：</b>无需再次生成关键帧。先在声音工作台完成旁白/多人对白、场景音效和 BGM 的试听确认，再进行视频费用预检；视频完成后可逐镜调整裁剪、速度、原声和转场，最后本地合成导出。</div>
    ${finalVideo ? `<section class="card final-player">
      <div class="card-head"><div><h2>最终成片</h2><p>${escapeHtml(finalVideo.status || '已生成')} · 播放器保持源视频比例</p></div>${finalUrl ? `<a class="btn primary final-download" href="${escapeHtml(downloadUrl)}" download="${escapeHtml(finalVideo.filename || 'vido-final.mp4')}" aria-label="下载原始成片"><span aria-hidden="true">↓</span><span><b>下载原始成片</b><small>保留原始比例和清晰度</small></span></a>` : ''}</div>
      <div class="final-media">${finalVideoPlayer(finalVideo, posterUrl)}</div>
    </section>` : ''}
    ${soundDesignMarkup(soundDesign)}
    <details class="card generation-section generation-details">
      <summary class="card-head"><div><h2>已确认分镜 / 视频首帧</h2><p>${approvedFrames.length}/${shots.length} · 直接进入图生视频，不产生二次生图费用</p></div><span class="details-chevron" aria-hidden="true">⌄</span></summary>
      <div class="card-body">${approvedFrames.length ? `<div class="generation-grid">${approvedFrames.map((item, index) => mediaCard(item, index, '首帧')).join('')}</div>` : emptyState({ title: '分镜尚未完整', body: '请返回分镜页逐镜生成或重绘，然后确认镜头设计。' })}</div>
    </details>
    <section class="card generation-section">
      <div class="card-head"><div><h2>视频片段</h2><p>已加载 ${clips.length}/${clipTotal}</p></div></div>
      <div class="card-body">${clips.length ? `<div class="generation-grid">${clips.map((item, index) => mediaCard(item, index, '视频')).join('')}</div>${moreMediaButton(mediaCatalog.clips, 'clips', '继续加载视频片段')}` : emptyState({
        title: '还没有视频片段',
        body: soundDesign.production?.approved ? '声音已确认，可以进行视频预检并提交生成。' : '请先在上方试听并确认全部声音，再提交视频生成。',
      })}</div>
    </section>
    ${clips.length ? `<section class="card generation-section"><div class="card-head"><div><h2>智能剪辑时间线</h2><p>逐镜裁剪首尾、调整速度和原声，并选择镜头转场；保存后合成会按此时间线执行。</p></div><button class="btn" type="button" data-save-timeline>保存时间线</button></div><div class="card-body"><div class="sound-journey-list" data-edit-timeline>${clips.map((clip, index) => { const edit = timeline.items?.[index] || {}; return `<article data-timeline-row data-shot-index="${index + 1}"><b>SH${String(index + 1).padStart(2, '0')}</b><span><label>裁头 <input type="number" min="0" step="0.1" value="${Number(edit.trim_start_sec || 0)}" data-trim-start></label><label>裁尾 <input type="number" min="0" step="0.1" value="${Number(edit.trim_end_sec || 0)}" data-trim-end></label></span><span><label>速度 <input type="number" min="0.5" max="2" step="0.05" value="${Number(edit.speed || 1)}" data-clip-speed></label><label>原声音量 <input type="range" min="0" max="1" step="0.05" value="${Number(edit.clip_volume ?? 1)}" data-clip-volume></label><label><input type="checkbox" ${edit.muted ? 'checked' : ''} data-clip-muted> 静音</label></span><span><label>转场 <select data-transition-type>${[['hard_cut','硬切'],['cut_on_action','动作切'],['match_cut','匹配切'],['dissolve','叠化'],['fade','淡入淡出']].map(([value,label]) => `<option value="${value}" ${edit.transition_type === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>时长 <input type="number" min="0" max="2" step="0.05" value="${Number(edit.transition_duration_sec ?? 0.35)}" data-transition-duration></label></span></article>`; }).join('')}</div></div></section>` : ''}
    <div data-modal-host></div>`;

  const selectedVideoModel = bindGenerationModelPicker(host, videoModelPicker);

  bindSoundDesign(host, { bundle, store, refreshShell: context.refreshShell });

  const run = async (button, path, pending, success) => {
    try {
      setButtonBusy(button, true, pending, { elapsed: true });
      await store.runStage(path);
      toast(success, 'success');
      await context.refreshShell();
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      setButtonBusy(button, false);
    }
  };
  host.querySelector('[data-back-storyboard]')?.addEventListener('click', () => context.navigate(`/story-ad/projects/${encodeURIComponent(bundle.project.id)}?view=storyboard`));
  host.querySelector('[data-compose]')?.addEventListener('click', event => run(event.currentTarget, 'compose', '正在提交…', '成片合成任务已提交。'));
  host.querySelector('[data-save-timeline]')?.addEventListener('click', async event => {
    const items = [...host.querySelectorAll('[data-timeline-row]')].map(row => ({ shot_index: Number(row.dataset.shotIndex), trim_start_sec: Number(row.querySelector('[data-trim-start]')?.value || 0), trim_end_sec: Number(row.querySelector('[data-trim-end]')?.value || 0), speed: Number(row.querySelector('[data-clip-speed]')?.value || 1), clip_volume: Number(row.querySelector('[data-clip-volume]')?.value ?? 1), muted: row.querySelector('[data-clip-muted]')?.checked === true, transition_type: row.querySelector('[data-transition-type]')?.value || 'hard_cut', transition_duration_sec: Number(row.querySelector('[data-transition-duration]')?.value || 0) }));
    try { setButtonBusy(event.currentTarget, true, '保存中…'); await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/timeline`, { method: 'PUT', body: { items } }); toast('剪辑时间线已保存。', 'success'); } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(event.currentTarget, false); }
  });
  bindMoreMedia(host, context);

  host.querySelector('[data-generate-video]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    try {
      setButtonBusy(button, true, '正在预检…');
      const videoModelRoute = selectedVideoModel();
      if (!videoModelRoute) throw new Error('请先选择本次视频生成模型');
      const preflight = await store.videoPreflight('economy', videoModelRoute);
      const complexityRequired = Number(preflight.execution_summary?.high_risk_unit_count || 0) > 0;
      const modalHost = host.querySelector('[data-modal-host]');
      modalHost.innerHTML = preflightDialog(preflight);
      const close = () => { modalHost.innerHTML = ''; };
      modalHost.querySelectorAll('[data-close-preflight]').forEach(item => item.addEventListener('click', close));
      modalHost.querySelector('[data-submit-video]')?.addEventListener('click', async submitEvent => {
        const submit = submitEvent.currentTarget;
        if (!modalHost.querySelector('[data-cost-confirm]')?.checked) {
          toast('请先确认镜头数量与费用上限。', 'warning');
          return;
        }
        if (complexityRequired && !modalHost.querySelector('[data-complexity-confirm]')?.checked) {
          toast('请先完成复杂镜头复核。', 'warning');
          return;
        }
        try {
          setButtonBusy(submit, true, '正在提交…', { elapsed: true });
          await store.startVideo(preflight, {
            complexity_review_confirmed: !complexityRequired || modalHost.querySelector('[data-complexity-confirm]')?.checked,
            video_model_route: videoModelRoute,
          });
          close();
          toast('视频生成任务已提交。', 'success');
          await context.refreshShell();
        } catch (error) {
          toast(error.message, 'danger');
          setButtonBusy(submit, false);
        }
      });
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      setButtonBusy(button, false);
    }
  });
}
