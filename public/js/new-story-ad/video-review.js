(() => {
  const P0_DIMENSIONS = new Set([
    'person_identity',
    'product_identity',
    'people_count',
    'action_fulfillment',
    'scene_consistency',
    'scene_continuity',
    'scene_topology',
    'person_position',
    'wardrobe',
    'prop_state',
    'screen_direction',
    'action_continuity',
    'frame_evidence',
    'identity',
  ]);
  const MINOR_MANUAL_ACCEPT_DIMENSIONS = new Set(['composition', 'framing', 'minor_visual_polish', 'color_tone']);

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function unique(values = []) {
    return [...new Set(values.filter(value => value !== null && value !== undefined && String(value).trim() !== ''))];
  }

  function unitMembers(unit = {}) {
    if (Array.isArray(unit.shots) && unit.shots.length) {
      return unique(unit.shots.map(Number).filter(value => Number.isInteger(value) && value > 0)).sort((a, b) => a - b);
    }
    if (Array.isArray(unit.member_indexes) && unit.member_indexes.length) {
      return unique(unit.member_indexes.map(value => Number(value) + 1).filter(value => Number.isInteger(value) && value > 0)).sort((a, b) => a - b);
    }
    return [];
  }

  function failureDimensions(clip = {}, status = {}) {
    return unique([
      ...(Array.isArray(clip.qa?.failure_dimensions) ? clip.qa.failure_dimensions : []),
      ...(Array.isArray(clip.cross_shot_qa?.failure_dimensions) ? clip.cross_shot_qa.failure_dimensions : []),
      ...(Array.isArray(status.qa_failure_dimensions) ? status.qa_failure_dimensions : []),
      ...(Array.isArray(status.cross_shot_failure_dimensions) ? status.cross_shot_failure_dimensions : []),
    ].map(value => String(value || '').trim().toLowerCase()));
  }

  function isP0Failure(clip = {}, status = {}) {
    const dimensions = failureDimensions(clip, status);
    return !dimensions.length || dimensions.some(dimension => P0_DIMENSIONS.has(dimension) || !MINOR_MANUAL_ACCEPT_DIMENSIONS.has(dimension));
  }

  function isManualAcceptAllowed(clip = {}) {
    const failedRows = [clip.qa, clip.cross_shot_qa].filter(qa => qa && qa.pass === false);
    const dimensions = unique(failedRows.flatMap(qa => (
      Array.isArray(qa.failure_dimensions) ? qa.failure_dimensions : []
    )).map(value => String(value || '').trim().toLowerCase()));
    if (!failedRows.length) return true;
    return dimensions.length > 0 && dimensions.every(dimension => MINOR_MANUAL_ACCEPT_DIMENSIONS.has(dimension));
  }

  function failureTime(clip = {}, status = {}) {
    const sources = [clip.qa || {}, clip.cross_shot_qa || {}, clip, status];
    const keys = ['failure_time_sec', 'timestamp_sec', 'time_sec', 'at_sec'];
    for (const source of sources) {
      for (const key of keys) {
        const value = Number(source?.[key]);
        if (Number.isFinite(value) && value >= 0) return { known: true, seconds: value };
      }
    }
    return { known: false, seconds: null };
  }

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

  function costUnitFor(unit = {}, costPlan = {}) {
    const units = Array.isArray(costPlan.units) ? costPlan.units : [];
    const id = String(unit.id || '');
    const byId = units.find(item => String(item.generation_unit_id || '') === id);
    if (byId) return byId;
    const indexes = new Set(unitMembers(unit).map(value => value - 1));
    return units.find(item => (item.edit_shot_indexes || []).some(index => indexes.has(Number(index)))) || null;
  }

  function selectionSummary(preflight = {}, selectedIds = []) {
    const units = Array.isArray(preflight.units) ? preflight.units : [];
    const selected = new Set((selectedIds || []).map(String));
    const chosen = units.filter(unit => selected.has(String(unit.id || '')));
    const costPlan = preflight.cost_plan || {};
    const ratio = number(costPlan.estimated_cost_rmb) > 0
      ? Math.max(1, number(costPlan.maximum_cost_rmb) / number(costPlan.estimated_cost_rmb))
      : Math.max(1, number(costPlan.safety_factor, 1));
    let estimatedCost = 0;
    let billableSeconds = 0;
    let paidUnits = 0;
    chosen.forEach(unit => {
      if (unit.paid === false) return;
      paidUnits += 1;
      const costUnit = costUnitFor(unit, costPlan);
      estimatedCost += number(costUnit?.estimated_cost_rmb);
      billableSeconds += number(costUnit?.billable_seconds, number(unit.duration_sec));
    });
    const indexes = unique(chosen.flatMap(unit => unitMembers(unit).map(value => value - 1))).map(Number).sort((a, b) => a - b);
    return {
      unitCount: chosen.length,
      paidUnits,
      localUnits: chosen.length - paidUnits,
      billableSeconds,
      estimatedCost: Number(estimatedCost.toFixed(2)),
      maximumCost: Number((estimatedCost * ratio).toFixed(2)),
      indexes,
      unitIds: chosen.map(unit => String(unit.id || '')),
    };
  }

  function selectionHtml(preflight = {}, escapeHtml = value => String(value || '')) {
    const units = Array.isArray(preflight.units) ? preflight.units : [];
    const zeroCostOnly = Array.isArray(preflight.blockers) && preflight.blockers.length > 0
      && number(preflight.zero_cost_action_count) > 0;
    const rows = units.map((unit, index) => {
      const members = unitMembers(unit);
      const cost = costUnitFor(unit, preflight.cost_plan || {});
      const seconds = unit.paid === false ? number(unit.duration_sec) : number(cost?.billable_seconds, number(unit.duration_sec));
      const expected = unit.paid === false ? 0 : number(cost?.estimated_cost_rmb);
      const disabled = zeroCostOnly && unit.paid !== false;
      return `<label class="dh-nsa-rework-unit ${disabled ? 'is-disabled' : ''}">
        <input type="checkbox" data-nsa-video-unit value="${escapeHtml(unit.id || `unit-${index + 1}`)}" ${disabled ? 'disabled' : ''}>
        <span><b>${escapeHtml(unit.title || `生成单元 ${index + 1}`)}</b><small>${escapeHtml(members.length ? `包含镜头 ${members.join('、')}` : '成员镜头信息未完成')} · ${escapeHtml(unit.label || (unit.paid === false ? '本地处理' : '一次模型生成'))}</small></span>
        <em>${seconds.toFixed(0)} 秒 · ${unit.paid === false ? '¥0.00' : `预计 ¥${expected.toFixed(2)}`}</em>
      </label>`;
    }).join('');
    return `<section class="dh-nsa-rework-picker" data-nsa-rework-picker>
      <div class="dh-nsa-rework-picker-head"><div><b>选择本次生成 / 重做单元</b><span>连续生成单元是付费与提交边界；成员镜头只用于审片，不会被分别提交。</span></div><button type="button" class="dh-btn dh-btn-ghost dh-btn-sm" data-nsa-select-all-units>全选可用单元</button></div>
      <div class="dh-nsa-rework-unit-list">${rows || '<div class="dh-task-empty-note">预检没有返回可选择的生成单元，信息未完成。</div>'}</div>
      <div class="dh-nsa-rework-totals" data-nsa-rework-totals>尚未选择：不会提交生成</div>
      <label class="dh-nsa-rework-ack"><input type="checkbox" data-nsa-rework-ack><span>我确认选择这些连续生成单元，并进入下一步读取精确费用；当前候选估算不作为最终授权。</span></label>
      <div class="dh-nsa-audio-preflight-error" data-nsa-confirm-error hidden></div>
    </section>`;
  }

  function totalsText(summary = {}) {
    if (!summary.unitCount) return '尚未选择：不会提交生成';
    return `预计重做 ${summary.paidUnits} 个付费单元 / ${summary.billableSeconds.toFixed(0)} 秒 · 预计 ¥${summary.estimatedCost.toFixed(2)} · 最高 ¥${summary.maximumCost.toFixed(2)} · 自动重试 0`;
  }

  function bindSelection(modal, preflight = {}) {
    const update = () => {
      const ids = [...modal.querySelectorAll('[data-nsa-video-unit]:checked')].map(input => input.value);
      const summary = selectionSummary(preflight, ids);
      const totals = modal.querySelector('[data-nsa-rework-totals]');
      if (totals) totals.textContent = totalsText(summary);
      const error = modal.querySelector('[data-nsa-confirm-error]');
      if (error) error.hidden = true;
    };
    modal.querySelectorAll('[data-nsa-video-unit]').forEach(input => input.addEventListener('change', update));
    modal.querySelector('[data-nsa-rework-ack]')?.addEventListener('change', update);
    modal.querySelector('[data-nsa-select-all-units]')?.addEventListener('click', () => {
      modal.querySelectorAll('[data-nsa-video-unit]:not(:disabled)').forEach(input => { input.checked = true; });
      update();
    });
    update();
  }

  function readSelection(modal, preflight = {}) {
    const ids = [...modal.querySelectorAll('[data-nsa-video-unit]:checked')].map(input => input.value);
    const summary = selectionSummary(preflight, ids);
    if (!summary.unitCount || !summary.indexes.length) return { error: '请至少选择一个生成单元；未选择时不会提交。' };
    if (!modal.querySelector('[data-nsa-rework-ack]')?.checked) return { error: '请确认所选连续生成单元，再进入精确费用预检。' };
    return { value: summary };
  }

  function costConfirmationHtml(preflight = {}, escapeHtml = value => String(value || '')) {
    const units = Array.isArray(preflight.units) ? preflight.units : [];
    const summary = selectionSummary(preflight, units.map(unit => unit.id));
    const rows = units.map((unit, index) => {
      const members = unitMembers(unit);
      const cost = costUnitFor(unit, preflight.cost_plan || {});
      return `<div class="dh-nsa-scoped-cost-row"><span><b>${escapeHtml(unit.title || `生成单元 ${index + 1}`)}</b><small>${escapeHtml(members.length ? `镜头 ${members.join('、')}` : '成员信息未完成')}</small></span><em>${unit.paid === false ? '本地处理 · ¥0.00' : `${number(cost?.billable_seconds, number(unit.duration_sec)).toFixed(0)} 秒 · ¥${number(cost?.estimated_cost_rmb).toFixed(2)}`}</em></div>`;
    }).join('');
    return `<section class="dh-nsa-scoped-cost" data-nsa-scoped-cost>
      <div class="dh-nsa-scoped-cost-head"><b>二次确认：精确执行范围与费用</b><span>以下数据来自按所选镜头重新计算的 scoped preflight；提交时只使用这份指纹与费用上限。</span></div>
      <div class="dh-nsa-scoped-cost-rows">${rows}</div>
      <div class="dh-nsa-rework-totals">${escapeHtml(totalsText(summary))}</div>
      <label class="dh-nsa-rework-ack"><input type="checkbox" data-nsa-scoped-cost-ack><span>我确认只提交以上连续生成单元，并接受这里显示的最高费用；自动付费重试为 0。</span></label>
      <div class="dh-nsa-audio-preflight-error" data-nsa-confirm-error hidden></div>
    </section>`;
  }

  function readCostConfirmation(modal, preflight = {}) {
    const units = Array.isArray(preflight.units) ? preflight.units : [];
    const summary = selectionSummary(preflight, units.map(unit => unit.id));
    if (!units.length || !summary.indexes.length) return { error: '精确预检没有返回生成单元，本次不会提交。' };
    if (!modal.querySelector('[data-nsa-scoped-cost-ack]')?.checked) return { error: '请二次确认精确执行范围、费用上限和“自动重试 0”。' };
    return { value: summary };
  }

  function mediaPlaceholder(url = '', kind = 'video', label = '', escapeHtml = value => String(value || '')) {
    if (!url) return `<div class="dh-nsa-review-missing">${escapeHtml(label || '媒体证据未完成')}</div>`;
    return `<div class="dh-nsa-review-media-placeholder" data-nsa-review-media="${escapeHtml(kind)}" data-src="${escapeHtml(url)}" data-label="${escapeHtml(label)}"><span>${escapeHtml(label || '展开后加载媒体证据')}</span></div>`;
  }

  function boundaryHtml(member = 0, { clipAt, escapeHtml } = {}) {
    if (member <= 1) return '<div class="dh-nsa-review-boundary is-first"><b>相邻交接证据</b><span>这是广告首个片段，没有上一片段尾帧。</span></div>';
    const evidence = boundaryEvidence(clipAt?.(member - 2), clipAt?.(member - 1));
    return `<div class="dh-nsa-review-boundary ${evidence.complete ? 'is-complete' : 'is-incomplete'}">
      <div><b>相邻交接证据</b><span>${evidence.complete ? '上一片段尾帧 / 当前片段首帧，可核对位置、人物、场景和运动方向。' : '交接证据未完成：尾帧或首帧抽帧数据缺失。'}</span></div>
      <div class="dh-nsa-review-boundary-grid">
        <section><small>上一片段尾帧${evidence.tail ? ` · ${number(evidence.tail.seconds).toFixed(2)}s` : ''}</small>${mediaPlaceholder(evidence.tail?.url || '', 'image', '尾帧证据未完成', escapeHtml)}</section>
        <section><small>当前片段首帧${evidence.head ? ` · ${number(evidence.head.seconds).toFixed(2)}s` : ''}</small>${mediaPlaceholder(evidence.head?.url || '', 'image', '首帧证据未完成', escapeHtml)}</section>
      </div>
    </div>`;
  }

  function memberHtml(member = 0, { failureDetails = [], shots = [], clipAt, viewAt, escapeHtml = value => String(value || '') } = {}) {
    const clip = clipAt?.(member - 1) || {};
    const view = viewAt?.(member - 1) || {};
    const failure = failureDetails.find(item => item.index === member) || null;
    const clipUrl = clip.video_url || clip.videoUrl || '';
    const timeText = failure?.time?.known
      ? `失败时间：${number(failure.time.seconds).toFixed(2)} 秒`
      : '失败时间：未完成定位（当前仅有抽帧审核结论）';
    const accept = failure && !failure.p0
      ? `<button type="button" class="dh-btn dh-btn-ghost dh-btn-sm" data-nsa-video-accept="${member - 1}">人工接受此片段</button>`
      : '';
    const failureHtml = failure ? `<div class="dh-nsa-video-unit-failure ${failure.p0 ? 'is-p0' : ''}">
      <div><b>${failure.p0 ? 'P0 阻断：不可人工接受' : '质量审核未通过'}</b><span>${escapeHtml(failure.reason)}</span><small>${escapeHtml(timeText)}</small>${failure.dimensions.length ? `<small>结构化维度：${escapeHtml(failure.dimensions.join('、'))}</small>` : '<small>结构化失败维度未完成</small>'}</div>${accept}
    </div>` : '<div class="dh-nsa-review-pass-note">当前没有失败结论；仍请完整播放并核对片段。</div>';
    return `<article class="dh-nsa-review-member is-${escapeHtml(view.tone || 'missing')}">
      <div class="dh-nsa-review-member-head"><div><b>镜头 ${member} · ${escapeHtml(shots?.[member - 1]?.title || '未命名片段')}</b><span>${escapeHtml(view.label || '状态未完成')}</span></div><em>${escapeHtml(view.shortLabel || '未知')}</em></div>
      ${mediaPlaceholder(clipUrl, 'video', clipUrl ? `播放镜头 ${member} 切分片段` : `镜头 ${member} 片段播放器未完成`, escapeHtml)}
      ${failureHtml}
      ${boundaryHtml(member, { clipAt, escapeHtml })}
    </article>`;
  }

  function unitReviewHtml(unit = {}, options = {}) {
    const { failureDetails = [], escapeHtml = value => String(value || '') } = options;
    const failures = failureDetails.filter(item => unit.members?.includes(item.index));
    return `<details data-nsa-unit-review><summary>展开审片：生成母片、${unit.members?.length || 0} 个成员片段、失败与交接证据${failures.length ? ` · ${failures.length} 个问题` : ''}</summary>
      <div class="dh-nsa-unit-review-body">
        <section class="dh-nsa-unit-source"><b>本生成单元母片</b><span>${unit.sourceUrl ? '这是一次模型生成的原始连续母片；成员片段由它切分而来。' : '原始连续母片地址未返回，证据未完成。'}</span>${mediaPlaceholder(unit.sourceUrl, 'video', '播放本生成单元母片', escapeHtml)}</section>
        <div class="dh-nsa-review-members">${(unit.members || []).map(member => memberHtml(member, options)).join('')}</div>
      </div>
    </details>`;
  }

  function hydrateReviewDetails(details) {
    if (!details?.open || details.dataset.nsaReviewHydrated === '1') return;
    details.dataset.nsaReviewHydrated = '1';
    details.querySelectorAll('[data-nsa-review-media]').forEach(placeholder => {
      const url = placeholder.dataset.src || '';
      if (!url) return;
      if (placeholder.dataset.nsaReviewMedia === 'image') {
        const image = document.createElement('img');
        image.loading = 'lazy'; image.alt = placeholder.dataset.label || '质检证据'; image.src = url;
        placeholder.replaceWith(image); return;
      }
      const video = document.createElement('video');
      video.controls = true; video.playsInline = true; video.preload = 'none'; video.src = url;
      video.setAttribute('aria-label', placeholder.dataset.label || '视频片段');
      placeholder.replaceWith(video);
    });
  }

  function bindReviewDetails(host) {
    host?.querySelectorAll('[data-nsa-unit-review]').forEach(details => {
      details.addEventListener('toggle', () => hydrateReviewDetails(details));
      hydrateReviewDetails(details);
    });
  }

  const api = {
    P0_DIMENSIONS,
    unitMembers,
    failureDimensions,
    isP0Failure,
    isManualAcceptAllowed,
    failureTime,
    qaFrames,
    boundaryEvidence,
    selectionSummary,
    selectionHtml,
    bindSelection,
    readSelection,
    totalsText,
    costConfirmationHtml,
    readCostConfirmation,
    unitReviewHtml,
    hydrateReviewDetails,
    bindReviewDetails,
  };
  if (typeof window !== 'undefined') window.NewStoryAdVideoReview = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
