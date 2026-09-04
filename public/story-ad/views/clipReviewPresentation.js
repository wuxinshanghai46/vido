import { escapeHtml, mediaPreview } from '../components/ui.js?v=20260904-production-v433';

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
  const passed = clips.filter(item => item.qa_pass === true || item.status === 'qa_passed' || item.qa_status === 'passed');
  const failed = clips.filter(item => item.qa_pass === false || item.status === 'qa_failed' || item.qa_status === 'failed');
  return {
    passed,
    failed,
    ready: shotCount > 0 && passed.length >= shotCount,
    action: failed.length ? `重新生成未通过镜头（${failed.length}）`
      : (clips.length ? `继续生成分镜视频（${Math.max(0, shotCount - passed.length)}）` : '生成分镜视频'),
  };
}
