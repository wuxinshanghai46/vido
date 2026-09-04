import { emptyState, escapeHtml, mediaPreview, setButtonBusy, toast } from '../components/ui.js?v=20260904-production-v427';
import { bindMoreMedia, moreMediaButton } from './finalMediaPagination.js?v=20260904-production-v427';
import { bindGenerationModelPicker, loadGenerationModelPicker } from './generationModelPicker.js?v=20260904-production-v427';

function itemIndex(item = {}, index = 0) {
  const value = Number(item.shot_index ?? item.shotIndex ?? item.index);
  return Number.isFinite(value) ? (value === index ? index + 1 : value) : index + 1;
}

function mediaCard(item, index, kind) {
  const number = itemIndex(item, index);
  const isVideo = kind === '视频' || item.media_type === 'video' || Boolean(item.video_url || item.videoUrl);
  const failed = item.qa_pass === false || item.status === 'qa_failed' || item.qa_status === 'failed';
  const passed = item.qa_pass === true || item.status === 'qa_passed' || item.qa_status === 'passed';
  const status = failed ? '审片未通过' : (passed ? '审片通过' : (item.status || item.qa_status || '已生成'));
  const reasons = failed && Array.isArray(item.qa_failure_labels_zh) && item.qa_failure_labels_zh.length
    ? `<small>${item.qa_failure_labels_zh.map(escapeHtml).join(' · ')}</small>` : '';
  return `<article class="generation-card card${isVideo ? ' is-video' : ''}${failed ? ' is-review-failed' : ''}"><div class="generation-media">${mediaPreview(item, { label: `${kind} ${number}`, width: 640, symbol: kind, controls: isVideo })}</div><div class="generation-copy"><div><b>SH${String(number).padStart(2, '0')}</b>${reasons}</div><span>${escapeHtml(status)}</span></div></article>`;
}

function finalVideoUrl(item = {}) { return item.video_url || item.videoUrl || item.url || ''; }

function finalVideoPlayer(item = {}, poster = '') {
  const url = finalVideoUrl(item);
  if (!url) return '<div class="media-placeholder final-video-empty"><span>成片文件尚未就绪</span></div>';
  return `<video class="final-video" src="${escapeHtml(url)}" poster="${escapeHtml(poster)}" controls preload="none" playsinline aria-label="初版成片">您的浏览器暂不支持视频播放。</video>`;
}

/** 第 6 步只负责逐镜视频生成与初版合成，不渲染任何剪辑控件。 */
export async function mount(host, context) {
  const { bundle, store } = context;
  const generation = bundle?.generation || {};
  const shots = bundle?.storyboard?.shots || [];
  const approvedFrames = Array.isArray(generation.approved_frames) ? generation.approved_frames : [];
  const clips = Array.isArray(generation.clips) ? generation.clips : [];
  const passedClips = clips.filter(item => item.qa_pass === true || item.status === 'qa_passed' || item.qa_status === 'passed');
  const failedClips = clips.filter(item => item.qa_pass === false || item.status === 'qa_failed' || item.qa_status === 'failed');
  const framesReady = shots.length > 0 && approvedFrames.length >= shots.length;
  const clipsReady = shots.length > 0 && passedClips.length >= shots.length;
  const storyboardComplete = bundle?.storyboard?.image_gate?.ready === true;
  const storyboardAction = storyboardComplete ? '返回分镜页确认' : '返回人物场景分镜生成首帧';
  const storyboardHint = storyboardComplete ? '分镜图片已齐全，请返回分镜页确认后继续，无需重新生成图片。' : '请返回分镜页逐镜生成或重绘，然后确认镜头设计。';
  const finalVideo = generation.final_video || (bundle?.project?.final_video_url ? { video_url: bundle.project.final_video_url, status: '已生成' } : null);
  const posterUrl = finalVideo?.poster_url || finalVideo?.thumbnail_url || approvedFrames.find(item => item.thumbnail_url || item.image_url || item.imageUrl)?.thumbnail_url || approvedFrames.find(item => item.image_url || item.imageUrl)?.image_url || '';
  const mediaCatalog = generation.media_catalog || {};
  const videoModelPicker = await loadGenerationModelPicker(bundle.project.id, 'new_story_ad.video', { label: '视频模型' });
  const generationAction = failedClips.length
    ? `重新生成未通过镜头（${failedClips.length}）`
    : (clips.length ? `继续生成分镜视频（${Math.max(0, shots.length - passedClips.length)}）` : '生成分镜视频');
  const primaryAction = !framesReady && !finalVideo
    ? `<button class="btn primary" type="button" data-back-storyboard>${storyboardAction}</button>`
    : (framesReady && !finalVideo && clipsReady
      ? '<button class="btn primary" type="button" data-compose>合成初版成片</button>'
      : (framesReady && !finalVideo ? `${videoModelPicker.html}<button class="btn primary" type="button" data-generate-video>${generationAction}</button>` : ''));
  host.innerHTML = `
    <section class="view-head post-production-head"><div><span class="stage-kicker">第 6 步</span><h1>视频与合成</h1><p>使用已确认分镜生成逐镜视频；全部镜头审片通过后才能合成为初版成片。本页不提供剪辑。</p></div><div class="view-actions">${primaryAction}${finalVideo ? '<button class="btn primary" type="button" data-open-editor>进入成片剪辑</button>' : ''}</div></section>
    <div data-video-feedback-host></div>
    <div class="post-stage-summary"><span class="is-complete"><b>✓</b><em>分镜</em><small>已确认</small></span><span class="is-current"><b>2</b><em>视频与合成</em><small>${finalVideo ? '初版成片已完成' : `${passedClips.length}/${shots.length} 镜审片通过`}</small></span><span><b>3</b><em>成片剪辑</em><small>${finalVideo ? '现在可以进入' : '初版成片生成后出现'}</small></span></div>
    ${finalVideo ? `<section class="card final-player"><div class="card-head"><div><h2>初版成片</h2><p>先完整观看，再进入独立剪辑页调整节奏和转场。</p></div></div><div class="final-media">${finalVideoPlayer(finalVideo, posterUrl)}</div></section>` : ''}
    <details class="card generation-section generation-details"><summary class="card-head"><div><h2>已确认分镜 / 视频首帧</h2><p>${approvedFrames.length}/${shots.length} · 直接进入图生视频，不重复生成图片</p></div><span class="details-chevron" aria-hidden="true">⌄</span></summary><div class="card-body">${approvedFrames.length ? `<div class="generation-grid">${approvedFrames.map((item, index) => mediaCard(item, index, '首帧')).join('')}</div>` : emptyState({ title: storyboardComplete ? '分镜待确认' : '分镜尚未完整', body: storyboardHint, action: storyboardAction, actionId: 'back-storyboard' })}</div></details>
    <section class="card generation-section"><div class="card-head"><div><h2>分镜视频</h2><p>已生成 ${clips.length}/${shots.length} · 审片通过 ${passedClips.length}/${shots.length}${failedClips.length ? ` · 未通过 ${failedClips.length}` : ''}</p></div></div><div class="card-body">${clips.length ? `<div class="generation-grid video-review-grid">${clips.map((item, index) => mediaCard(item, index, '视频')).join('')}</div>${moreMediaButton(mediaCatalog.clips, 'clips', '继续加载视频片段')}` : `<div data-video-empty>${emptyState({ title: '还没有分镜视频', body: framesReady ? '选择视频模型后，生成包含剧情声音的分镜视频。' : (storyboardComplete ? storyboardHint : `还缺少 ${Math.max(0, shots.length - approvedFrames.length)} 张已确认首帧，请先返回人物场景分镜生成并确认。`), action: framesReady ? '' : storyboardAction, actionId: framesReady ? '' : 'back-storyboard' })}</div>`}</div></section>
    <div data-video-submit-feedback role="alert"></div>`;

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
      try { await store.refreshSections?.('summary'); } catch { /* Keep the submission result visible when status refresh is unavailable. */ }
    } finally { delete button.dataset.submitting; setButtonBusy(button, false); }
  });
  return bindVideoGenerationFeedback(host, context, escapeHtml);
}

const videoStage = value => /^(video|video_repair|media|compose|final_video)(_|$)/.test(String(value || '').replace(/^new_story_ad\./, ''));
const time = value => Date.parse(value || '') || 0;

/** A processed/failed unit is never counted as a playable video. */
export function videoGenerationFeedback(bundle = {}) {
  const project = bundle.project || {}, generation = bundle.generation || {};
  const progress = project.generation_progress || generation.progress || {};
  const relevant = videoStage(progress.stage || project.active_stage || project.stage);
  const total = bundle.storyboard?.shots?.length || 0;
  const saved = Number(generation.media_catalog?.clips?.total ?? generation.clips?.length ?? 0);
  const completed = Math.max(saved, relevant ? Number(progress.qa_passed || 0) : 0);
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
  return { status, title, message, completed, total, active, diagnostics };
}

export function videoGenerationFeedbackMarkup(bundle, escapeHtml) {
  const view = videoGenerationFeedback(bundle);
  if (view.status === 'idle') return '';
  const details = view.diagnostics?.error ? `<details data-authorized-error-details><summary>具体失败原因（授权账号可见）</summary><p>${escapeHtml(view.diagnostics.error)}</p><small>${escapeHtml(view.diagnostics.error_code || '')}</small></details>` : '';
  return `<section class="project-generation-progress ${view.status === 'failed' ? 'is-failed' : ''}" data-video-feedback="${view.status}" role="${view.status === 'failed' ? 'alert' : 'status'}" aria-live="polite"><div class="project-progress-head"><div><b>${escapeHtml(view.title)}</b><span>视频成功 ${view.completed}/${view.total}</span></div></div><p>${escapeHtml(view.message)}</p>${details}</section>`;
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
