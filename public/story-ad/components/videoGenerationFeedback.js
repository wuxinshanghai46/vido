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
