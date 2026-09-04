import { generationElapsedTimeTag, emptyState, escapeHtml, setButtonBusy, toast } from '../components/ui.js?v=20260904-production-v448';
import { bindMoreMedia, moreMediaButton } from './finalMediaPagination.js?v=20260904-production-v448';
import { bindGenerationModelPicker, loadGenerationModelPicker } from './generationModelPicker.js?v=20260904-production-v448';
import { clipReviewState, finalVideoPlayer, finalVideoUrl, mediaCard } from './clipReviewPresentation.js?v=20260904-production-v448';

export async function mount(host, context) {
  const { bundle, store } = context;
  const generation = bundle?.generation || {};
  const shots = bundle?.storyboard?.shots || [];
  const approvedFrames = Array.isArray(generation.approved_frames) ? generation.approved_frames : [];
  const clips = Array.isArray(generation.clips) ? generation.clips : [];
  const clipReview = clipReviewState(clips, shots.length);
  const passedClips = clipReview.passed, failedClips = clipReview.failed;
  const framesReady = shots.length > 0 && approvedFrames.length >= shots.length;
  const clipsReady = clipReview.ready;
  const storyboardComplete = bundle?.storyboard?.image_gate?.ready === true;
  const storyboardAction = storyboardComplete ? '返回分镜页确认' : '返回人物场景分镜生成首帧';
  const storyboardHint = storyboardComplete ? '分镜图片已齐全，请返回分镜页确认后继续，无需重新生成图片。' : '请返回分镜页逐镜生成或重绘，然后确认镜头设计。';
  const finalVideo = generation.final_video || (bundle?.project?.final_video_url ? { video_url: bundle.project.final_video_url, status: '已生成' } : null);
  const posterUrl = finalVideo?.poster_url || finalVideo?.thumbnail_url || approvedFrames.find(item => item.thumbnail_url || item.image_url || item.imageUrl)?.thumbnail_url || approvedFrames.find(item => item.image_url || item.imageUrl)?.image_url || '';
  const mediaCatalog = generation.media_catalog || {};
  const videoModelPicker = await loadGenerationModelPicker(bundle.project.id, 'new_story_ad.video', { label: '视频模型' });
  const primaryAction = !framesReady && !finalVideo
    ? `<button class="btn primary" type="button" data-back-storyboard>${storyboardAction}</button>`
    : (framesReady && !finalVideo && clipsReady
      ? '<button class="btn primary" type="button" data-compose>合成初版成片</button>'
      : (framesReady && !finalVideo ? `${videoModelPicker.html}<button class="btn primary" type="button" data-generate-video>${clipReview.action}</button>` : ''));
  host.innerHTML = `
    <section class="view-head post-production-head"><div><span class="stage-kicker">第 6 步</span><h1>视频与合成</h1><p>使用已确认分镜生成逐镜视频；全部镜头审片通过后才能合成为初版成片。</p></div><div class="view-actions">${primaryAction}${finalVideo ? `<a class="btn" href="${escapeHtml(`${finalVideoUrl(finalVideo)}${finalVideoUrl(finalVideo).includes('?') ? '&' : '?'}download=1`)}" download="${escapeHtml(finalVideo.filename || 'vido-final.mp4')}">直接下载</a><button class="btn primary" type="button" data-open-editor>进入视频剪辑</button>` : ''}</div></section>
    <div data-video-feedback-host></div>
    ${finalVideo ? `<section class="card final-player"><div class="card-head"><div><h2>初版成片</h2><p>可直接下载，也可在独立剪辑弹窗中调整节奏、声音和转场。</p></div></div><div class="final-media">${finalVideoPlayer(finalVideo, posterUrl)}</div></section>` : ''}
    <details class="card generation-section generation-details"><summary class="card-head"><div><h2>已确认分镜 / 视频首帧</h2><p>${approvedFrames.length}/${shots.length} · 直接进入图生视频，不重复生成图片</p></div><span class="details-chevron" aria-hidden="true">⌄</span></summary><div class="card-body">${approvedFrames.length ? `<div class="generation-grid">${approvedFrames.map((item, index) => mediaCard(item, index, '首帧')).join('')}</div>` : emptyState({ title: storyboardComplete ? '分镜待确认' : '分镜尚未完整', body: storyboardHint, action: storyboardAction, actionId: 'back-storyboard' })}</div></details>
    <section class="card generation-section"><div class="card-head"><div><h2>分镜视频</h2><p>已生成 ${clips.length}/${shots.length} · 审片通过 ${passedClips.length}/${shots.length}${failedClips.length ? ` · 未通过 ${failedClips.length}` : ''}</p></div></div><div class="card-body">${clips.length ? `<div class="generation-grid video-review-grid">${clips.map((item, index) => mediaCard(item, index, '视频')).join('')}</div>${moreMediaButton(mediaCatalog.clips, 'clips', '继续加载视频片段')}` : `<div data-video-empty>${emptyState({ title: '还没有分镜视频', body: framesReady ? '选择视频模型后，生成包含剧情声音的分镜视频。' : (storyboardComplete ? storyboardHint : `还缺少 ${Math.max(0, shots.length - approvedFrames.length)} 张已确认首帧，请先返回人物场景分镜生成并确认。`), action: framesReady ? '' : storyboardAction, actionId: framesReady ? '' : 'back-storyboard' })}</div>`}</div></section>
    <div data-video-submit-feedback role="alert"></div>`;

  const selectedVideoModel = bindGenerationModelPicker(host, videoModelPicker);
  host.querySelectorAll('[data-back-storyboard], [data-empty-action="back-storyboard"]').forEach(button => button.addEventListener('click', () => {
    context.navigate(`/story-ad/projects/${encodeURIComponent(bundle.project.id)}?view=storyboard`);
  }));
  const run = async (button, path, pending, success) => { try { setButtonBusy(button, true, pending, { elapsed: true }); await store.runStage(path); toast(success, 'success'); await context.refreshShell(); } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(button, false); } };
  host.querySelector('[data-compose]')?.addEventListener('click', event => run(event.currentTarget, 'compose', '正在合成初版成片…', '初版成片合成任务已提交。'));
  const openEditor = async () => {
    const editor = await import('./finalEditView.js?v=20260904-production-v448');
    return editor.openEditorModal(context);
  };
  host.querySelector('[data-open-editor]')?.addEventListener('click', () => openEditor().catch(error => toast(error.message, 'danger')));
  bindMoreMedia(host, context);
  host.querySelector('[data-generate-video]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    if (button.dataset.submitting === 'true') return;
    try {
      const videoModelRoute = selectedVideoModel();
      if (!videoModelRoute) return toast('请先选择视频模型。', 'warning');
      button.dataset.submitting = 'true';
      const feedback = host.querySelector('[data-video-submit-feedback]');
      if (feedback) feedback.innerHTML = '';
      setButtonBusy(button, true, '正在提交…', { elapsed: true });
      await store.startVideo({ video_model_route: videoModelRoute });
      toast('视频生成任务已提交。', 'success');
      await context.refreshShell();
    } catch (error) {
      toast('视频提交未完成。', 'danger');
      const target = host.querySelector('[data-video-submit-feedback]');
      if (target) target.innerHTML = `<section class="project-generation-progress is-failed"><b>视频提交未完成</b><p>请核对上方任务状态；若仍在生成中，请勿重复提交。</p>${bundle.permissions?.can_view_errors === true ? `<details><summary>具体失败原因（授权账号可见）</summary><p>${escapeHtml(error.message)}</p></details>` : ''}</section>`;
      try { await store.refreshSections?.('summary'); } catch {}
    } finally { delete button.dataset.submitting; setButtonBusy(button, false); }
  });
  const disposeFeedback = bindVideoGenerationFeedback(host, context, escapeHtml);
  if (context.route?.params?.get('editor') === '1' && finalVideo) queueMicrotask(() => openEditor().catch(error => toast(error.message, 'danger')));
  return disposeFeedback;
}

const videoStage = value => /^(video|video_repair|media|compose|final_video)(_|$)/.test(String(value || '').replace(/^new_story_ad\./, ''));
const time = value => Date.parse(value || '') || 0;

export function videoGenerationFeedback(bundle = {}) {
  const project = bundle.project || {}, generation = bundle.generation || {};
  const progress = project.generation_progress || generation.progress || {};
  const relevant = videoStage(progress.stage || project.active_stage || project.stage);
  const total = bundle.storyboard?.shots?.length || 0;
  const saved = Number(generation.media_catalog?.clips?.total ?? generation.clips?.length ?? 0);
  const completed = Math.max(saved, relevant ? Number(progress.qa_passed || 0) : 0);
  const reportedPercent = Number(progress.percent);
  const percent = Math.max(0, Math.min(100, Number.isFinite(reportedPercent)
    ? Math.round(reportedPercent)
    : (total ? Math.round((completed / total) * 100) : 0)));
  const active = relevant && (Boolean(project.active_generation_id) || ['queued', 'running', 'processing'].includes(project.status));
  const submission = project.video_submission_failure;
  const latestStart = Math.max(time(progress.started_at), time(project.generation_started_at), time(project.generation_queued_at));
  const rejected = !active && submission && time(submission.finished_at) > latestStart;
  const failed = !active && (rejected || (relevant && ['failed', 'blocked', 'error'].includes(project.status || progress.status)));
  const stopped = !active && relevant && ['cancelled', 'stopped'].includes(project.status || progress.status);
  const composing = /compose|final_video/.test(progress.stage || project.stage || '');
  const final = generation.final_video?.video_url || generation.final_video?.videoUrl || project.final_video_url;
  let status = 'idle', title = '尚未开始生成视频', message = '选择视频模型后，点击“生成分镜视频”。';
  if (active) {
    status = 'running'; title = composing ? '初版成片合成中' : (['queued'].includes(project.status) ? '视频任务已提交，等待生成' : '视频生成中');
    message = '任务仍在处理中，完成后会自动更新结果，请勿重复提交。';
  } else if (failed) {
    status = 'failed'; title = composing ? '初版成片合成失败' : (completed ? '视频部分完成，本次生成失败' : '视频生成失败');
    message = completed ? '已生成的视频已保留，本次任务已停止。' : '本次未生成成功的视频，任务已停止。';
  } else if (stopped) {
    status = 'stopped'; title = '视频生成已停止'; message = '已完成的视频已保留。';
  } else if (final || (total > 0 && completed >= total)) {
    status = 'succeeded'; title = final ? '初版成片合成成功' : '分镜视频生成成功'; message = final ? '成片已保存。' : '全部分镜视频已生成并保存。';
  } else if (completed) {
    status = 'partial'; title = '视频部分完成'; message = '已生成的视频已保存，其余镜头尚未完成。';
  } else if (relevant && ['done', 'succeeded', 'completed'].includes(project.status || progress.status)) {
    status = 'incomplete'; title = '视频生成未完成'; message = '任务已结束，但尚无成功的视频结果。';
  }
  const diagnostics = bundle.permissions?.can_view_errors === true && failed
    ? (rejected ? submission.technical_diagnostics : project.technical_diagnostics) : null;
  if (failed && diagnostics?.operator_error) message = diagnostics.operator_error;
  return { status, title, message, completed, total, percent: active ? Math.max(2, percent) : percent, active, diagnostics };
}

export function videoGenerationFeedbackMarkup(bundle, escapeHtml) {
  const view = videoGenerationFeedback(bundle);
  if (view.status === 'idle') return '';
  const details = view.diagnostics?.error ? `<details data-authorized-error-details><summary>具体失败原因（授权账号可见）</summary><p>${escapeHtml(view.diagnostics.error)}</p><small>${escapeHtml(view.diagnostics.error_code || '')}</small></details>` : '';
  const progress = view.active ? `<div class="project-progress-track ${view.percent <= 2 ? 'is-indeterminate' : ''}" aria-hidden="true"><i style="width:${view.percent}%"></i></div>` : '';
  const elapsed = generationElapsedTimeTag(bundle.project, view.active);
  return `<section class="project-generation-progress ${view.status === 'failed' ? 'is-failed' : ''}" data-video-feedback="${view.status}" role="${view.status === 'failed' ? 'alert' : 'status'}" aria-live="polite"><div class="project-progress-head"><div><b>${escapeHtml(view.title)}</b><span>视频成功 ${view.completed}/${view.total}${view.active ? ` · ${view.percent}%` : ''}</span></div><span class="project-progress-stats">${elapsed}</span></div>${progress}<p>${escapeHtml(view.message)}</p>${details}</section>`;
}

export function syncVideoGenerationControls(bundle, scope = document) {
  const view = videoGenerationFeedback(bundle);
  if (view.status !== 'idle') scope.querySelectorAll?.('[data-video-submit-feedback]').forEach(node => { node.innerHTML = ''; });
  scope.querySelectorAll?.('[data-video-empty]').forEach(node => { node.hidden = view.status !== 'idle'; });
  scope.querySelectorAll?.('[data-generate-video], [data-compose]').forEach(button => { if (button.dataset.submitting !== 'true') button.disabled = view.active; });
}

export function bindVideoGenerationFeedback(host, { bundle, store }, escapeHtml) {
  const taskId = bundle.project.id;
  const render = state => {
    const current = state?.bundle || bundle;
    if (current.project?.id !== taskId) return;
    const panel = host.querySelector('[data-video-feedback-host]');
    if (panel) panel.innerHTML = videoGenerationFeedbackMarkup(current, escapeHtml);
    syncVideoGenerationControls(current, host);
  };
  render(store.state);
  return store.subscribe?.(render) || (() => {});
}
