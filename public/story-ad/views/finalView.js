import { emptyState, escapeHtml, mediaPreview, setButtonBusy, toast } from '../components/ui.js?v=20260902-production-v390';
import { bindMoreMedia, moreMediaButton } from './finalMediaPagination.js?v=20260902-production-v390';
import { bindGenerationModelPicker, loadGenerationModelPicker } from './generationModelPicker.js?v=20260902-production-v390';

function itemIndex(item = {}, index = 0) {
  const value = Number(item.shot_index ?? item.shotIndex ?? item.index);
  return Number.isFinite(value) ? (value === index ? index + 1 : value) : index + 1;
}

function mediaCard(item, index, kind) {
  const number = itemIndex(item, index);
  return `<article class="generation-card card"><div class="generation-media">${mediaPreview(item, { label: `${kind} ${number}`, width: 640, symbol: kind })}</div><div class="generation-copy"><b>SH${String(number).padStart(2, '0')}</b><span>${escapeHtml(item.status || item.qa_status || '已生成')}</span></div></article>`;
}

function finalVideoUrl(item = {}) { return item.video_url || item.videoUrl || item.url || ''; }

function finalVideoPlayer(item = {}, poster = '') {
  const url = finalVideoUrl(item);
  if (!url) return '<div class="media-placeholder final-video-empty"><span>成片文件尚未就绪</span></div>';
  return `<video class="final-video" src="${escapeHtml(url)}" poster="${escapeHtml(poster)}" controls preload="none" playsinline aria-label="初版成片">您的浏览器暂不支持视频播放。</video>`;
}

function preflightDialog(preflight = {}) {
  const cost = preflight.cost_plan || {};
  const blockers = Array.isArray(preflight.blockers) ? preflight.blockers : [];
  const shotCount = Array.isArray(preflight.shots) ? preflight.shots.length : 0;
  const complexityRequired = Number(preflight.execution_summary?.high_risk_unit_count || 0) > 0;
  return `<div class="modal-backdrop" data-preflight-modal><section class="modal card" role="dialog" aria-modal="true" aria-labelledby="preflightTitle"><div class="card-head"><div><h2 id="preflightTitle">确认视频生成</h2><p>只有点击最终确认后才会提交视频模型。</p></div><button class="icon-btn" type="button" data-close-preflight>×</button></div><div class="card-body"><div class="preflight-grid"><div><span>计划镜头</span><b>${shotCount}</b></div><div><span>生成模式</span><b>${escapeHtml(preflight.mode || 'economy')}</b></div><div><span>预计上限</span><b>${Number(cost.maximum_cost_rmb || 0).toFixed(2)} 元</b></div></div>${blockers.length ? `<div class="inline-error"><b>当前不能提交：</b>${blockers.map(item => escapeHtml(item.message || item)).join('；')}</div>` : ''}<label class="confirm-check"><input type="checkbox" data-cost-confirm> 我已核对镜头数量和费用上限，本次生成将产生实际调用。</label>${complexityRequired ? '<label class="confirm-check"><input type="checkbox" data-complexity-confirm> 我已复核复杂镜头的动作、主体与运镜。</label>' : ''}<div class="form-actions"><button class="btn" type="button" data-close-preflight>取消</button><button class="btn primary" type="button" data-submit-video ${blockers.length ? 'disabled' : ''}>确认并开始生成</button></div></div></section></div>`;
}

/** 第 7 步只负责逐镜视频生成与初版合成，不渲染任何剪辑控件。 */
export async function mount(host, context) {
  const { bundle, store } = context;
  const generation = bundle?.generation || {};
  const shots = bundle?.storyboard?.shots || [];
  const approvedFrames = Array.isArray(generation.approved_frames) ? generation.approved_frames : [];
  const clips = Array.isArray(generation.clips) ? generation.clips : [];
  const finalVideo = generation.final_video || (bundle?.project?.final_video_url ? { video_url: bundle.project.final_video_url, status: '已生成' } : null);
  const posterUrl = finalVideo?.poster_url || finalVideo?.thumbnail_url || approvedFrames.find(item => item.thumbnail_url || item.image_url || item.imageUrl)?.thumbnail_url || approvedFrames.find(item => item.image_url || item.imageUrl)?.image_url || '';
  const mediaCatalog = generation.media_catalog || {};
  const clipTotal = Number(mediaCatalog.clips?.total || clips.length);
  const videoModelPicker = await loadGenerationModelPicker(bundle.project.id, 'new_story_ad.video', { label: '视频模型' });
  host.innerHTML = `
    <section class="view-head post-production-head"><div><span class="stage-kicker">第 7 步</span><h1>视频与合成</h1><p>使用已确认分镜生成逐镜视频；全部镜头完成后合成为初版成片。本页不提供剪辑。</p></div><div class="view-actions">${approvedFrames.length && !finalVideo ? `${videoModelPicker.html}<button class="btn" type="button" data-generate-video>生成分镜视频</button>` : ''}${clips.length && !finalVideo ? '<button class="btn primary" type="button" data-compose>合成初版成片</button>' : ''}${finalVideo ? '<button class="btn primary" type="button" data-open-editor>进入成片剪辑</button>' : ''}</div></section>
    <div class="post-stage-summary"><span class="is-complete"><b>✓</b><em>声音</em><small>已确认</small></span><span class="is-current"><b>2</b><em>视频与合成</em><small>${finalVideo ? '初版成片已完成' : `${clips.length}/${shots.length} 个镜头`}</small></span><span><b>3</b><em>成片剪辑</em><small>${finalVideo ? '现在可以进入' : '初版成片生成后出现'}</small></span></div>
    ${finalVideo ? `<section class="card final-player"><div class="card-head"><div><h2>初版成片</h2><p>先完整观看，再进入独立剪辑页调整节奏和转场。</p></div></div><div class="final-media">${finalVideoPlayer(finalVideo, posterUrl)}</div></section>` : ''}
    <details class="card generation-section generation-details"><summary class="card-head"><div><h2>已确认分镜 / 视频首帧</h2><p>${approvedFrames.length}/${shots.length} · 直接进入图生视频，不重复生成图片</p></div><span class="details-chevron" aria-hidden="true">⌄</span></summary><div class="card-body">${approvedFrames.length ? `<div class="generation-grid">${approvedFrames.map((item, index) => mediaCard(item, index, '首帧')).join('')}</div>` : emptyState({ title: '分镜尚未完整', body: '请返回分镜页逐镜生成或重绘，然后确认镜头设计。' })}</div></details>
    <section class="card generation-section"><div class="card-head"><div><h2>分镜视频</h2><p>已完成 ${clips.length}/${clipTotal || shots.length}</p></div></div><div class="card-body">${clips.length ? `<div class="generation-grid">${clips.map((item, index) => mediaCard(item, index, '视频')).join('')}</div>${moreMediaButton(mediaCatalog.clips, 'clips', '继续加载视频片段')}` : emptyState({ title: '还没有分镜视频', body: '声音已确认。选择视频模型并完成费用预检后，才能提交真实视频生成。' })}</div></section>
    <div data-modal-host></div>`;

  const selectedVideoModel = bindGenerationModelPicker(host, videoModelPicker);
  const run = async (button, path, pending, success) => { try { setButtonBusy(button, true, pending, { elapsed: true }); await store.runStage(path); toast(success, 'success'); await context.refreshShell(); } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(button, false); } };
  host.querySelector('[data-compose]')?.addEventListener('click', event => run(event.currentTarget, 'compose', '正在合成初版成片…', '初版成片合成任务已提交。'));
  host.querySelector('[data-open-editor]')?.addEventListener('click', () => context.navigate(`/story-ad/projects/${encodeURIComponent(bundle.project.id)}?view=edit`));
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
        if (!modalHost.querySelector('[data-cost-confirm]')?.checked) return toast('请先确认镜头数量与费用上限。', 'warning');
        if (complexityRequired && !modalHost.querySelector('[data-complexity-confirm]')?.checked) return toast('请先完成复杂镜头复核。', 'warning');
        try { setButtonBusy(submit, true, '正在提交…', { elapsed: true }); await store.startVideo(preflight, { complexity_review_confirmed: !complexityRequired || modalHost.querySelector('[data-complexity-confirm]')?.checked, video_model_route: videoModelRoute }); close(); toast('视频生成任务已提交。', 'success'); await context.refreshShell(); } catch (error) { toast(error.message, 'danger'); setButtonBusy(submit, false); }
      });
    } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(button, false); }
  });
}
