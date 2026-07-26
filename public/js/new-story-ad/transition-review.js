(() => {
  const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const unique = (values = []) => [...new Set(values.filter(value => value !== null && value !== undefined && String(value).trim() !== ''))];

  function qaFrames(clip = {}) {
    return (Array.isArray(clip.qa?.frames) ? clip.qa.frames : []).map(frame => ({
      url: frame?.image_url || frame?.imageUrl || frame?.url || '',
      seconds: number(frame?.second, 0),
      point: number(frame?.point, 0),
    })).filter(frame => frame.url);
  }

  function boundaryEvidence(previousClip = null, currentClip = null) {
    const previousFrames = qaFrames(previousClip || {});
    const currentFrames = qaFrames(currentClip || {});
    return {
      complete: previousFrames.length > 0 && currentFrames.length > 0,
      tail: previousFrames.at(-1) || null,
      head: currentFrames[0] || null,
    };
  }

  function boundaryHtml(member = 0, {
    clipAt,
    shots = [],
    escapeHtml = value => String(value || ''),
    mediaPlaceholder = () => '',
  } = {}) {
    if (member <= 1) return '<div class="dh-nsa-review-boundary is-first"><b>相邻交接证据</b><span>这是广告首个片段，没有上一片段尾帧。</span></div>';
    const currentClip = clipAt?.(member - 1) || {};
    const evidence = boundaryEvidence(clipAt?.(member - 2), currentClip);
    const qa = currentClip.cross_shot_qa || null;
    const currentShot = shots?.[member - 1] || {};
    const transitionType = qa?.transition_type || currentShot.transition_type || 'hard_cut';
    const mode = qa?.boundary_mode || (qa?.same_scene === false ? 'intentional_scene_change' : 'same_scene_continuity');
    const verdict = qa?.pass === true
      ? { tone: 'pass', label: '转场验收通过' }
      : (qa?.pass === false ? { tone: 'fail', label: '转场验收未通过' } : { tone: 'pending', label: '转场尚未验收' });
    const reasons = unique([
      ...(Array.isArray(qa?.failure_labels_zh) ? qa.failure_labels_zh : []),
      ...(Array.isArray(qa?.problems) ? qa.problems : []),
    ]).slice(0, 4);
    return `<div class="dh-nsa-review-boundary ${evidence.complete ? 'is-complete' : 'is-incomplete'}">
      <div class="dh-nsa-review-boundary-head"><div><b>相邻交接证据</b><span>${evidence.complete ? '上一片段尾帧 / 当前片段首帧，可直接核对实际切换。' : '交接证据未完成：尾帧或首帧抽帧数据缺失。'}</span></div><em class="is-${escapeHtml(verdict.tone)}">${escapeHtml(verdict.label)}</em></div>
      <div class="dh-nsa-transition-verdict">
        <span><small>验收模式</small><b>${escapeHtml(mode === 'intentional_scene_change' ? '跨场景意图验收' : '同场景连续性验收')}</b></span>
        <span><small>执行方式</small><b>${escapeHtml(transitionType)}</b></span>
        <span><small>匹配锚点</small><b>${escapeHtml(qa?.transition_match_anchor || currentShot.transition_match_anchor || '不适用')}</b></span>
        ${reasons.length ? `<p>${escapeHtml(reasons.join('；'))}</p>` : '<p>暂无结构化失败原因。</p>'}
      </div>
      <div class="dh-nsa-review-boundary-grid">
        <section><small>上一片段尾帧${evidence.tail ? ` · ${number(evidence.tail.seconds).toFixed(2)}s` : ''}</small>${mediaPlaceholder(evidence.tail?.url || '', 'image', '尾帧证据未完成', escapeHtml)}</section>
        <section><small>当前片段首帧${evidence.head ? ` · ${number(evidence.head.seconds).toFixed(2)}s` : ''}</small>${mediaPlaceholder(evidence.head?.url || '', 'image', '首帧证据未完成', escapeHtml)}</section>
      </div>
    </div>`;
  }

  const api = { qaFrames, boundaryEvidence, boundaryHtml };
  if (typeof window !== 'undefined') window.NewStoryAdTransitionReview = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
