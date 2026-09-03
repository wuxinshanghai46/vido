import { emptyState, escapeHtml, mediaPreview, setButtonBusy, toast } from '../components/ui.js?v=20260903-production-v419';
import { bindMoreMedia, moreMediaButton } from './finalMediaPagination.js?v=20260903-production-v419';
import { bindGenerationModelPicker, loadGenerationModelPicker } from './generationModelPicker.js?v=20260903-production-v419';

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

/** 第 7 步只负责逐镜视频生成与初版合成，不渲染任何剪辑控件。 */
export async function mount(host, context) {
  const { bundle, store } = context;
  const generation = bundle?.generation || {};
  const shots = bundle?.storyboard?.shots || [];
  const approvedFrames = Array.isArray(generation.approved_frames) ? generation.approved_frames : [];
  const clips = Array.isArray(generation.clips) ? generation.clips : [];
  const framesReady = shots.length > 0 && approvedFrames.length >= shots.length;
  const storyboardComplete = bundle?.storyboard?.image_gate?.ready === true;
  const storyboardAction = storyboardComplete ? '返回分镜页确认' : '返回人物场景分镜生成首帧';
  const storyboardHint = storyboardComplete ? '分镜图片已齐全，请返回分镜页确认后继续，无需重新生成图片。' : '请返回分镜页逐镜生成或重绘，然后确认镜头设计。';
  const finalVideo = generation.final_video || (bundle?.project?.final_video_url ? { video_url: bundle.project.final_video_url, status: '已生成' } : null);
  const posterUrl = finalVideo?.poster_url || finalVideo?.thumbnail_url || approvedFrames.find(item => item.thumbnail_url || item.image_url || item.imageUrl)?.thumbnail_url || approvedFrames.find(item => item.image_url || item.imageUrl)?.image_url || '';
  const mediaCatalog = generation.media_catalog || {};
  const clipTotal = Number(mediaCatalog.clips?.total || clips.length);
  const videoModelPicker = await loadGenerationModelPicker(bundle.project.id, 'new_story_ad.video', { label: '视频模型' });
  host.innerHTML = `
    <section class="view-head post-production-head"><div><span class="stage-kicker">第 7 步</span><h1>视频与合成</h1><p>使用已确认分镜生成逐镜视频；全部镜头完成后合成为初版成片。本页不提供剪辑。</p></div><div class="view-actions">${!framesReady && !finalVideo ? `<button class="btn primary" type="button" data-back-storyboard>${storyboardAction}</button>` : ''}${framesReady && !finalVideo ? `${videoModelPicker.html}<button class="btn" type="button" data-generate-video>生成分镜视频</button>` : ''}${clips.length && !finalVideo ? '<button class="btn primary" type="button" data-compose>合成初版成片</button>' : ''}${finalVideo ? '<button class="btn primary" type="button" data-open-editor>进入成片剪辑</button>' : ''}</div></section>
    <div class="post-stage-summary"><span class="is-complete"><b>✓</b><em>声音</em><small>已确认</small></span><span class="is-current"><b>2</b><em>视频与合成</em><small>${finalVideo ? '初版成片已完成' : `${clips.length}/${shots.length} 个镜头`}</small></span><span><b>3</b><em>成片剪辑</em><small>${finalVideo ? '现在可以进入' : '初版成片生成后出现'}</small></span></div>
    ${finalVideo ? `<section class="card final-player"><div class="card-head"><div><h2>初版成片</h2><p>先完整观看，再进入独立剪辑页调整节奏和转场。</p></div></div><div class="final-media">${finalVideoPlayer(finalVideo, posterUrl)}</div></section>` : ''}
    <details class="card generation-section generation-details"><summary class="card-head"><div><h2>已确认分镜 / 视频首帧</h2><p>${approvedFrames.length}/${shots.length} · 直接进入图生视频，不重复生成图片</p></div><span class="details-chevron" aria-hidden="true">⌄</span></summary><div class="card-body">${approvedFrames.length ? `<div class="generation-grid">${approvedFrames.map((item, index) => mediaCard(item, index, '首帧')).join('')}</div>` : emptyState({ title: storyboardComplete ? '分镜待确认' : '分镜尚未完整', body: storyboardHint, action: storyboardAction, actionId: 'back-storyboard' })}</div></details>
    <section class="card generation-section"><div class="card-head"><div><h2>分镜视频</h2><p>已完成 ${clips.length}/${clipTotal || shots.length}</p></div></div><div class="card-body">${clips.length ? `<div class="generation-grid">${clips.map((item, index) => mediaCard(item, index, '视频')).join('')}</div>${moreMediaButton(mediaCatalog.clips, 'clips', '继续加载视频片段')}` : emptyState({ title: '还没有分镜视频', body: framesReady ? '声音已确认。选择视频模型后，点击生成分镜视频。' : (storyboardComplete ? storyboardHint : `还缺少 ${Math.max(0, shots.length - approvedFrames.length)} 张已确认首帧，请先返回人物场景分镜生成并确认。`), action: framesReady ? '' : storyboardAction, actionId: framesReady ? '' : 'back-storyboard' })}</div></section>
    ${bundle.permissions?.can_view_errors === true && bundle.project?.technical_diagnostics?.error ? `<details class="card"><summary>具体失败原因（授权账号可见）</summary><div class="card-body"><p>${escapeHtml(bundle.project.technical_diagnostics.error)}</p><small>${escapeHtml(bundle.project.technical_diagnostics.error_code || '')}</small></div></details>` : ''}`;

  const selectedVideoModel = bindGenerationModelPicker(host, videoModelPicker);
  host.querySelectorAll('[data-back-storyboard], [data-empty-action="back-storyboard"]').forEach(button => button.addEventListener('click', () => {
    context.navigate(`/story-ad/projects/${encodeURIComponent(bundle.project.id)}?view=storyboard`);
  }));
  const run = async (button, path, pending, success) => { try { setButtonBusy(button, true, pending, { elapsed: true }); await store.runStage(path); toast(success, 'success'); await context.refreshShell(); } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(button, false); } };
  host.querySelector('[data-compose]')?.addEventListener('click', event => run(event.currentTarget, 'compose', '正在合成初版成片…', '初版成片合成任务已提交。'));
  host.querySelector('[data-open-editor]')?.addEventListener('click', () => context.navigate(`/story-ad/projects/${encodeURIComponent(bundle.project.id)}?view=edit`));
  bindMoreMedia(host, context);
  host.querySelector('[data-generate-video]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    if (button.dataset.submitting === 'true') return;
    try {
      const videoModelRoute = selectedVideoModel();
      if (!videoModelRoute) return toast('请先选择视频模型。', 'warning');
      button.dataset.submitting = 'true';
      setButtonBusy(button, true, '正在提交…', { elapsed: true });
      await store.startVideo({ video_model_route: videoModelRoute });
      toast('视频生成任务已提交。', 'success');
      await context.refreshShell();
    } catch (error) { toast(bundle.permissions?.can_view_errors === true ? error.message : '视频生成失败。', 'danger'); } finally { delete button.dataset.submitting; setButtonBusy(button, false); }
  });
}
