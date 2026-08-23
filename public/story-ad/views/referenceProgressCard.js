import { elapsedTimeTag, escapeHtml } from '../components/ui.js?v=20260824-production-v201o';

const CONTRACT_LABELS = Object.freeze({
  story: '内容主线',
  timeline: '镜头顺序',
  cast: '人物与动物',
  scenes: '场景安排',
  brand_audio: '商品与声音',
});

function contractBreakdown(semanticProgress = {}) {
  const total = Math.max(0, Number(semanticProgress.total || 0) || 0);
  if (!total) return '';
  const completed = Math.max(0, Math.min(total, Number(semanticProgress.completed || 0) || 0));
  const contracts = semanticProgress.contracts && typeof semanticProgress.contracts === 'object'
    ? semanticProgress.contracts : {};
  const missing = new Set((Array.isArray(semanticProgress.missing_contracts)
    ? semanticProgress.missing_contracts : []).map(String));
  const hasNamedStates = Object.keys(CONTRACT_LABELS).some(key => (
    Object.prototype.hasOwnProperty.call(contracts, key) || missing.has(key)
  ));
  if (!hasNamedStates) {
    return `<span class="reference-contract-state ${completed === total ? 'is-complete' : 'is-missing'}"><b>内容整理</b><small>${completed}/${total} 项${completed === total ? '已完成并保留' : '已完成，缺失项待补齐'}</small></span>`;
  }
  return Object.entries(CONTRACT_LABELS).map(([key, label]) => {
    const state = contracts[key] && typeof contracts[key] === 'object' ? contracts[key] : {};
    const complete = state.complete === true || (!missing.has(key) && missing.size > 0);
    return `<span class="reference-contract-state ${complete ? 'is-complete' : 'is-missing'}" data-semantic-contract="${key}"><b>${escapeHtml(label)}</b><small>${complete ? '已完成并保留' : '待定向补齐'}</small></span>`;
  }).join('');
}

function recoveryBreakdown({ batchTotal, batchCompleted, semanticProgress }) {
  const semantic = contractBreakdown(semanticProgress);
  if (!batchTotal && !semantic) return '';
  const evidenceComplete = batchTotal > 0 && batchCompleted === batchTotal;
  const evidence = batchTotal > 0
    ? `<span class="reference-contract-state ${evidenceComplete ? 'is-complete' : 'is-missing'}"><b>镜头证据</b><small>${batchCompleted}/${batchTotal} 批${evidenceComplete ? '已完整保留' : '已保留，剩余批次待读取'}</small></span>`
    : '';
  return `<div class="reference-contract-breakdown" aria-label="参考分析分项状态">${evidence}${semantic}</div>`;
}

function failedUserCopy({ errorCode = '', completeEvidence = false, billingUnknown = false } = {}) {
  if (/TIMEOUT|NETWORK|ECONNRESET|DISCONNECT|超时|网络中断/i.test(errorCode)) {
    return completeEvidence
      ? `视频画面已经全部保存，但最后的内容整理因网络响应中断没有完成。${billingUnknown ? '系统没有自动重复请求，避免可能产生两次费用。' : ''}`
      : '本次读取因网络响应中断没有完成，已经成功保存的部分不会丢失。';
  }
  if (/QUALITY|CONTRACT|INCOMPLETE/i.test(errorCode)) {
    return completeEvidence
      ? '视频画面已经全部保存，但内容摘要还有缺项，未完成的结果不会进入后续制作。'
      : '这次识别结果不够完整，未完成的内容不会进入后续制作。';
  }
  return completeEvidence
    ? '视频画面已经全部保存，但最后的内容整理没有完成。你可以跳过参考继续，也可以稍后重新整理。'
    : '这次参考视频没有完整读完，已经完成的部分会继续保留。';
}

export function referenceProgress(reference = {}) {
  if (!reference.analysis_id) return '';
  const status = String(reference.status || '').toLowerCase();
  const active = ['uploading', 'importing', 'uploaded', 'queued', 'running', 'cancelling'].includes(status);
  const completed = status === 'completed';
  const completedInvalid = completed && reference.analysis_valid !== true;
  const failed = status === 'failed';
  const errorCode = String(reference.error_code || reference.error?.code || '');
  const extendedConfirmation = failed && errorCode === 'REFERENCE_VIDEO_EXTENDED_ANALYSIS_CONFIRMATION_REQUIRED';
  const preflight = reference.analysis_preflight && typeof reference.analysis_preflight === 'object'
    ? reference.analysis_preflight
    : {};
  const cancelled = status === 'cancelled';
  const interrupted = status === 'sync_interrupted';
  const batchProgress = reference.evidence_batch_progress && typeof reference.evidence_batch_progress === 'object' ? reference.evidence_batch_progress : {};
  const batchTotal = Math.max(0, Number(batchProgress.total || 0) || 0);
  const batchCompleted = Math.max(0, Math.min(batchTotal, Number(batchProgress.completed || 0) || 0));
  const partialEvidence = batchTotal > 0 && batchCompleted > 0 && batchCompleted < batchTotal;
  const completeEvidence = batchTotal > 0 && batchCompleted === batchTotal;
  const semanticProgress = reference.semantic_contract_progress && typeof reference.semantic_contract_progress === 'object' ? reference.semantic_contract_progress : {};
  const labels = {
    uploading: '正在上传参考视频', importing: '正在读取参考链接', uploaded: '视频已就绪，等待分析', queued: '已进入分析队列',
    running: '正在分析参考视频', cancelling: '正在停止分析',
    completed: completedInvalid ? '视频画面已保存，内容整理未通过' : '参考视频分析完成',
    failed: extendedConfirmation ? '视频内容较多，等待确认分批读取' : (completeEvidence ? '视频画面已保存，内容整理未完成' : '参考视频读取未完成'),
    cancelled: '参考视频分析已取消', sync_interrupted: '状态同步暂时中断',
  };
  const numeric = Math.max(0, Math.min(100, Number(reference.progress || 0) || 0));
  const percent = completed ? 100 : numeric;
  const phase = extendedConfirmation
    ? `已免费预检 ${Number(preflight.segment_count || 0)} 个片段，确认后按 ${Number(preflight.batch_count || 0)} 批完整读取`
    : (completedInvalid ? '内容整理未通过完整性检查' : (failed && completeEvidence
      ? '画面读取已完成，最后的内容整理暂时中断'
      : String(reference.phase || labels[status] || '等待分析').trim()));
  const tone = (failed && !extendedConfirmation) || completedInvalid ? 'is-failed' : (completed ? 'is-completed' : (cancelled || interrupted || extendedConfirmation ? 'is-cancelled' : 'is-active'));
  const hasDeepReport = !!(
    Object.keys(reference.reference_understanding?.story_bible || reference.reference_understanding?.story_summary || reference.story_bible || {}).length
    || (reference.reference_understanding?.story_events || reference.reference_understanding?.causal_chain || reference.story_events)?.length
    || (reference.reference_understanding?.character_arcs || reference.reference_understanding?.characters || reference.character_arcs)?.length
    || (reference.reference_understanding?.scene_narratives || reference.reference_understanding?.scenes || reference.scene_narratives)?.length
  );
  const billingUnknown = String(reference.billing_state || '').toLowerCase() === 'unknown'
    || String(reference.provider_submission_state || '').toLowerCase() === 'submitted_unknown';
  const baseNote = interrupted
    ? '状态同步暂时中断，页面正在自动重连；已停止本地耗时计数，任务仍由服务器继续处理。'
    : completed
      ? (completedInvalid
        ? '这次内容整理没有通过完整性检查，未完成的结果不会进入后续制作。原视频和已校验画面都已保留，无需重新上传。'
        : (hasDeepReport
          ? '深度理解报告已就绪。请核对故事、人物、场景、品牌、镜头与声音证据；确认前不会进入后续资产创建。'
          : '广告目标已自动填入；故事、人物/动物、场景、分镜和机位已分配到后续对应环节。'))
      : (extendedConfirmation
        ? `本次比普通分析多 ${Number(preflight.extra_batch_count || 0)} 批；尚未启动任何收费分析。确认后会完整读取全部片段，并逐批保存成功结果。`
        : (failed
        ? failedUserCopy({ errorCode: `${errorCode} ${reference.error || ''}`, completeEvidence, billingUnknown })
        : (cancelled ? '分析已经停止，当前未完成的结果不会进入后续制作环节。' : '正在后台读取和理解视频；完成后会自动填写广告目标，并把其他结果分配到对应制作环节。')));
  const retryMinutes = Math.ceil(Math.max(0, Number(reference.retry_after_ms || 0) || 0) / 60000);
  const note = [
    baseNote,
    partialEvidence ? `已完成 ${batchCompleted}/${batchTotal} 批，重试只会继续读取剩余 ${batchTotal - batchCompleted} 批。` : '',
    completeEvidence && (failed || completedInvalid) ? `镜头画面已完成 ${batchCompleted}/${batchTotal} 批；不会重新读取，只补未完成的内容整理。` : '',
    Number(semanticProgress.total || 0) > 0 ? `内容整理已完成 ${Number(semanticProgress.completed || 0)}/${Number(semanticProgress.total || 0)} 项，已完成内容不会被覆盖。` : '',
    failed && retryMinutes > 0 ? `系统当前处理较忙，建议约 ${retryMinutes} 分钟后再继续。` : '',
  ].filter(Boolean).join(' ');
  const canReuseEvidence = reference.visual_evidence_reusable === true || completeEvidence;
  const retryLabel = extendedConfirmation
    ? `确认分批分析（${Number(preflight.batch_count || 0)} 批）`
    : (reference.semantic_result_reusable === true
    ? '复用已保留结果重新校验'
    : (canReuseEvidence
      ? '重新整理内容'
      : (completedInvalid || cancelled ? '重新识别当前视频' : (partialEvidence ? `继续读取缺失镜头（${batchCompleted}/${batchTotal} 批）` : '重新读取镜头证据'))));
  const retry = (failed || cancelled || completedInvalid) && reference.client_pending !== true
    ? `<button class="btn" type="button" data-reference-retry>${retryLabel}</button>` : '';
  const abandon = (failed || cancelled || completedInvalid) && reference.client_pending !== true
    ? '<button class="btn" type="button" data-reference-abandon>跳过这个参考</button>' : '';
  const finishedAt = reference.completed_at || reference.failed_at || reference.cancelled_at || reference.sync_interrupted_at || reference.updated_at || '';
  const recovery = failed || cancelled || completedInvalid;
  return `<section class="reference-progress-card ${tone}${recovery ? ' is-recovery' : ''}" aria-live="polite">
    <div class="reference-progress-head"><span><b>${escapeHtml(labels[status] || '参考视频状态')}</b><small>${escapeHtml(reference.filename || '当前参考视频')}</small></span>${recovery ? '' : `<span class="reference-progress-stats">${elapsedTimeTag({ startedAt: reference.started_at, finishedAt, active })}<strong>${percent}%</strong></span>`}</div>
    <div class="reference-progress-phase"><span class="reference-progress-pulse" aria-hidden="true"></span>${escapeHtml(phase)}</div>
    ${recovery ? '' : `<div class="reference-progress-track" role="progressbar" aria-label="参考视频分析进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><i style="width:${percent}%"></i></div>`}
    ${recoveryBreakdown({ batchTotal, batchCompleted, semanticProgress })}
    <div class="reference-progress-foot"><p>${escapeHtml(note)}</p><div class="reference-progress-actions">${abandon}${retry}</div></div>
  </section>`;
}

export const _private = { contractBreakdown, recoveryBreakdown, failedUserCopy, CONTRACT_LABELS };
