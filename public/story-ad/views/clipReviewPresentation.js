import { escapeHtml, mediaPreview } from '../components/ui.js?v=20260904-production-v459';

export function finalVideoUrl(item = {}) { return item.video_url || item.videoUrl || item.url || ''; }

export function finalVideoPlayer(item = {}, poster = '') {
  const url = finalVideoUrl(item);
  if (!url) return '<div class="media-placeholder final-video-empty"><span>成片文件尚未就绪</span></div>';
  return `<video class="final-video" src="${escapeHtml(url)}" poster="${escapeHtml(poster)}" controls preload="none" playsinline aria-label="初版成片">您的浏览器暂不支持视频播放。</video>`;
}

function itemIndex(item = {}, index = 0) {
  const value = Number(item.shot_index ?? item.shotIndex ?? item.index);
  return Number.isFinite(value) ? (value === index ? index + 1 : value) : index + 1;
}

export function mediaCard(item, index, kind) {
  const number = itemIndex(item, index);
  const isVideo = kind === '视频' || item.media_type === 'video' || Boolean(item.video_url || item.videoUrl);
  const failed = item.qa_pass === false || item.status === 'qa_failed' || item.qa_status === 'failed';
  const passed = item.qa_pass === true || item.status === 'qa_passed' || item.qa_status === 'passed';
  const status = failed ? '审片未通过' : (passed ? '审片通过' : (item.status || item.qa_status || '已生成'));
  const reasons = failed && Array.isArray(item.qa_failure_labels_zh) && item.qa_failure_labels_zh.length
    ? `<small>${item.qa_failure_labels_zh.map(escapeHtml).join(' · ')}</small>` : '';
  return `<article class="generation-card card${isVideo ? ' is-video' : ''}${failed ? ' is-review-failed' : ''}"><div class="generation-media">${mediaPreview(item, { label: `${kind} ${number}`, width: 640, symbol: kind, controls: isVideo })}</div><div class="generation-copy"><div><b>SH${String(number).padStart(2, '0')}</b>${reasons}</div><span>${escapeHtml(status)}</span></div></article>`;
}

export function clipReviewState(clips, shotCount) {
  const generated = clips.filter(item => item && (item.video_url || item.videoUrl || item.original_url || item.status !== 'pending'));
  const passed = generated.filter(item => item.qa_pass === true || item.status === 'qa_passed' || item.qa_status === 'passed');
  const failed = generated.filter(item => item.qa_pass === false || item.status === 'qa_failed' || item.qa_status === 'failed');
  const pending = generated.filter(item => !passed.includes(item) && !failed.includes(item));
  const remaining = Math.max(0, shotCount - generated.length);
  return {
    generated,
    passed,
    failed,
    pending,
    remaining,
    ready: shotCount > 0 && passed.length >= shotCount,
    action: failed.length ? `重新生成未通过镜头（${failed.length}）`
      : (remaining ? `继续生成剩余分镜视频（${remaining}）`
        : (pending.length ? `重新审片已生成视频（${pending.length}）` : '生成分镜视频')),
  };
}
