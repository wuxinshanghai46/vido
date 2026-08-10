import { elapsedTimeTag, escapeHtml } from '../components/ui.js?v=20260810-a-v154';

const CONTRACT_LABELS = Object.freeze({
  story: '故事理解',
  timeline: '镜头事件',
  cast: '人物与宠物',
  scenes: '场景与事件',
  brand_audio: '商品、品牌与声音',
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
    return `<span class="reference-contract-state ${completed === total ? 'is-complete' : 'is-missing'}"><b>语义合同</b><small>${completed}/${total} 项${completed === total ? '已完成并保留' : '已完成，缺失项待补齐'}</small></span>`;
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

export function referenceProgress(reference = {}) {
  if (!reference.analysis_id) return '';
  const status = String(reference.status || '').toLowerCase();
  const active = ['uploading', 'importing', 'uploaded', 'queued', 'running', 'cancelling'].includes(status);
  const completed = status === 'completed';
  const completedInvalid = completed && reference.analysis_valid !== true;
  const failed = status === 'failed';
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
    completed: completedInvalid ? '镜头读取完成，深度识别未通过' : '参考视频分析完成',
    failed: completeEvidence ? '镜头证据已保留，语义整理待补齐' : '参考视频分析失败',
    cancelled: '参考视频分析已取消', sync_interrupted: '状态同步暂时中断',
  };
  const numeric = Math.max(0, Math.min(100, Number(reference.progress || 0) || 0));
  const percent = completed ? 100 : numeric;
  const phase = completedInvalid ? '深度识别未通过质量校验，旧结果已停止使用' : String(reference.phase || labels[status] || '等待分析').trim();
  const tone = failed || completedInvalid ? 'is-failed' : (completed ? 'is-completed' : (cancelled || interrupted ? 'is-cancelled' : 'is-active'));
  const hasDeepReport = !!(
    Object.keys(reference.reference_understanding?.story_bible || reference.reference_understanding?.story_summary || reference.story_bible || {}).length
    || (reference.reference_understanding?.story_events || reference.reference_understanding?.causal_chain || reference.story_events)?.length
    || (reference.reference_understanding?.character_arcs || reference.reference_understanding?.characters || reference.character_arcs)?.length
    || (reference.reference_understanding?.scene_narratives || reference.reference_understanding?.scenes || reference.scene_narratives)?.length
  );
  const baseNote = interrupted
    ? '状态同步暂时中断，页面正在自动重连；已停止本地耗时计数，任务仍由服务器继续处理。'
    : completed
      ? (completedInvalid
        ? '本次深度识别没有通过质量校验，旧结果不会进入后续制作。原视频已保留；已校验镜头证据会尽量保留，无需更换或重新上传。'
        : (hasDeepReport
          ? '深度理解报告已就绪。请核对故事、人物、场景、品牌、镜头与声音证据；确认前不会进入后续资产创建。'
          : '广告目标已自动填入；故事、人物/动物、场景、分镜和机位已分配到后续对应环节。'))
      : (failed
        ? (reference.error || '本次分析没有完成，请按下方保留状态继续处理。')
        : (cancelled ? '分析已经停止，当前未完成的结果不会进入后续制作环节。' : '正在后台读取和理解视频；完成后会自动填写广告目标，并把其他结果分配到对应制作环节。'));
  const retryMinutes = Math.ceil(Math.max(0, Number(reference.retry_after_ms || 0) || 0) / 60000);
  const note = [
    baseNote,
    partialEvidence ? `已完成 ${batchCompleted}/${batchTotal} 批，重试只会继续读取剩余 ${batchTotal - batchCompleted} 批。` : '',
    completeEvidence && (failed || completedInvalid) ? `镜头证据已完成 ${batchCompleted}/${batchTotal} 批；不会重读图片，只补缺失语义合同。` : '',
    Number(semanticProgress.total || 0) > 0 ? `语义合同已完成 ${Number(semanticProgress.completed || 0)}/${Number(semanticProgress.total || 0)} 项，已完成内容不会被覆盖。` : '',
    failed && retryMinutes > 0 ? `备用模型正在限流保护中，建议约 ${retryMinutes} 分钟后继续。` : '',
  ].filter(Boolean).join(' ');
  const canReuseEvidence = reference.visual_evidence_reusable === true || completeEvidence;
  const retryLabel = reference.semantic_result_reusable === true
    ? '复用已保留结果重新校验'
    : (canReuseEvidence
      ? '仅补齐缺失语义（不重读镜头）'
      : (completedInvalid || cancelled ? '重新识别当前视频' : (partialEvidence ? `继续读取缺失镜头（${batchCompleted}/${batchTotal} 批）` : '重新读取镜头证据')));
  const retry = (failed || cancelled || completedInvalid) && reference.client_pending !== true
    ? `<button class="btn" type="button" data-reference-retry>${retryLabel}</button>` : '';
  const finishedAt = reference.completed_at || reference.failed_at || reference.cancelled_at || reference.sync_interrupted_at || reference.updated_at || '';
  return `<section class="reference-progress-card ${tone}" aria-live="polite">
    <div class="reference-progress-head"><span><b>${escapeHtml(labels[status] || '参考视频状态')}</b><small>${escapeHtml(reference.filename || '当前参考视频')}</small></span><span class="reference-progress-stats">${elapsedTimeTag({ startedAt: reference.started_at, finishedAt, active })}<strong>${percent}%</strong></span></div>
    <div class="reference-progress-phase"><span class="reference-progress-pulse" aria-hidden="true"></span>${escapeHtml(phase)}</div>
    <div class="reference-progress-track" role="progressbar" aria-label="参考视频分析进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><i style="width:${percent}%"></i></div>
    ${recoveryBreakdown({ batchTotal, batchCompleted, semanticProgress })}
    <div class="reference-progress-foot"><p>${escapeHtml(note)}</p>${retry}</div>
  </section>`;
}

export const _private = { contractBreakdown, recoveryBreakdown, CONTRACT_LABELS };
