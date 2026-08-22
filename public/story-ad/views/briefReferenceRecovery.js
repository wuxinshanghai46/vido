import { setButtonBusy, toast } from '../components/ui.js?v=20260822-reference-failure-recovery-v146';
import { confirmDialog } from '../components/dialog.js?v=20260822-reference-failure-recovery-v146';

export function bindBriefReferenceRecovery(host, { store, context } = {}) {
  const handleReferenceAbandon = async event => {
    const button = event.target.closest('[data-reference-abandon]');
    if (!button || button.disabled) return;
    const confirmed = await confirmDialog('系统会解除当前项目的参考视频，并保留你已经手动填写的内容。已完成的镜头证据将不再用于这个项目；之后可以重新添加参考视频。是否不使用本次参考继续？', {
      title: '不使用参考继续',
      confirmText: '不使用参考，继续填写',
    });
    if (!confirmed) return;
    try {
      setButtonBusy(button, true, '正在解除…');
      await store.removeReference();
      toast('已解除失败的参考视频，现在可以继续输入并完成立项。', 'success');
      await context.refreshShell();
    } catch (error) {
      toast(error.message, 'danger');
      setButtonBusy(button, false);
    }
  };

  let referenceRetryPending = false;
  const handleReferenceRetry = async event => {
    const button = event.target.closest('[data-reference-retry]');
    if (!button || referenceRetryPending || button.disabled) return;
    referenceRetryPending = true;
    setButtonBusy(button, true, '正在确认…');
    const currentReference = store.state.bundle?.reference || {};
    const extendedConfirmation = String(currentReference.error_code || currentReference.error?.code || '')
      === 'REFERENCE_VIDEO_EXTENDED_ANALYSIS_CONFIRMATION_REQUIRED';
    const preflight = currentReference.analysis_preflight && typeof currentReference.analysis_preflight === 'object'
      ? currentReference.analysis_preflight
      : {};
    const batchProgress = currentReference.evidence_batch_progress || {};
    const completeEvidence = Number(batchProgress.total || 0) > 0 && Number(batchProgress.completed || 0) === Number(batchProgress.total || 0);
    const reusable = currentReference.visual_evidence_reusable === true || completeEvidence;
    const semanticReusable = store.state.bundle?.reference?.semantic_result_reusable === true;
    const billingUnknown = String(currentReference.billing_state || '').toLowerCase() === 'unknown'
      || String(currentReference.provider_submission_state || '').toLowerCase() === 'submitted_unknown';
    const completedInvalid = currentReference.status === 'completed' && currentReference.analysis_valid !== true;
    const partialEvidence = Number(batchProgress.completed || 0) > 0 && Number(batchProgress.completed || 0) < Number(batchProgress.total || 0);
    const retryMessage = billingUnknown
      ? `上一次语义模型请求已发出，但供应商没有返回可确认的计费结果；它可能已经产生费用。${Number(batchProgress.total || 0) > 0 ? `已完成的 ${Number(batchProgress.completed || 0)}/${Number(batchProgress.total || 0)} 批镜头证据都会保留` : '已通过校验的镜头证据都会保留'}，本次只重新调用语义整理模型，不会重读图片，但可能新增一次模型费用。是否明确承担这次重试风险并继续？`
      : extendedConfirmation
      ? `系统已免费检测到 ${Number(preflight.segment_count || 0)} 个取证片段，需要 ${Number(preflight.batch_count || 0)} 批视觉读取；普通分析包含 10 批，本次将增加 ${Number(preflight.extra_batch_count || 0)} 批。确认后会完整读取全部片段，并按批保存进度；失败重试不会重复读取已通过批次。是否继续？`
      : completedInvalid
      ? (reusable
        ? '不需要更换或重新上传。系统会保留当前视频、撤下本次不合格结果，复用已校验的镜头证据并重新调用语义识别模型，可能产生新的模型费用。是否继续？'
        : '不需要更换或重新上传。系统会保留当前视频、撤下本次不合格结果，并重新调用视觉与语义识别模型，可能产生新的模型费用。是否继续？')
      : (semanticReusable
      ? '画面证据和语义整理结果都已完整保存，本次只重新校验场景与分镜映射，不再调用模型，是否继续？'
      : (reusable
        ? '当前逐帧镜头证据已经通过完整性校验，本次不会重读图片；系统会保留最佳语义候选，只补齐未通过的语义合同，可能产生缺项修复的模型费用。是否继续？'
        : (partialEvidence
          ? `已完成 ${batchProgress.completed}/${batchProgress.total} 批镜头证据，本次只处理剩余 ${batchProgress.remaining || (batchProgress.total - batchProgress.completed)} 批，不会重跑已通过批次。若模型再次漏读同批画面，系统会把该批拆成单帧补读，因此实际视觉调用次数可能高于剩余批次数。是否继续？`
          : '当前证据没有通过逐帧完整性校验，本次将重新检测镜头并调用视觉与语义模型，可能产生新的模型费用。是否继续？')));
    let confirmed = false;
    try {
      confirmed = await confirmDialog(retryMessage, {
        title: billingUnknown ? '确认可能新增一次模型费用' : (extendedConfirmation ? '确认分批分析参考视频' : (completedInvalid ? '重新识别当前视频' : (semanticReusable ? '重新校验参考视频' : (reusable ? '继续补齐语义结构' : '重新读取镜头证据')))),
        confirmText: billingUnknown ? '确认风险，仅重试语义' : (extendedConfirmation ? `确认读取 ${Number(preflight.batch_count || 0)} 批` : (completedInvalid ? '确认重新识别' : (semanticReusable ? '确认重新校验' : (reusable ? '确认重新整理' : '确认重新分析')))),
      });
    } catch (error) {
      referenceRetryPending = false;
      setButtonBusy(button, false);
      toast(error.message, 'danger');
      return;
    }
    if (!confirmed) {
      referenceRetryPending = false;
      setButtonBusy(button, false);
      return;
    }
    try {
      setButtonBusy(button, true, extendedConfirmation ? '正在启动分批分析…' : (completedInvalid ? '正在重新识别…' : (semanticReusable ? '正在重新校验…' : (reusable ? '正在重新整理…' : '正在重新分析…'))), { elapsed: true });
      if (extendedConfirmation) {
        await store.retryReferenceAnalysis({
          extended_analysis_confirmed: true,
          preflight_fingerprint: String(preflight.fingerprint || ''),
        });
      } else {
        await store.retryReferenceAnalysis({ acknowledge_billing_unknown: billingUnknown });
      }
      toast(extendedConfirmation ? `已确认 ${Number(preflight.batch_count || 0)} 批完整分析；已通过批次会持续保存。` : (completedInvalid ? '已保留当前视频并开始重新识别，无需重新上传。' : (semanticReusable ? '已复用现有结果开始重新校验，不会再次调用模型。' : (reusable ? '已复用完整镜头证据，只继续补齐语义结构。' : '已开始重新检测并分析镜头证据。'))), 'success');
    } catch (error) {
      toast(error.message, 'danger');
      setButtonBusy(button, false);
    } finally {
      referenceRetryPending = false;
    }
  };

  host.addEventListener('click', handleReferenceAbandon);
  host.addEventListener('click', handleReferenceRetry);
  return () => {
    host.removeEventListener('click', handleReferenceAbandon);
    host.removeEventListener('click', handleReferenceRetry);
  };
}
