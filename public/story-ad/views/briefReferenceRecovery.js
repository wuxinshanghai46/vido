import { setButtonBusy, toast } from '../components/ui.js?v=20260827-production-v235c';
import { confirmDialog } from '../components/dialog.js?v=20260827-production-v235c';

export function bindBriefReferenceRecovery(host, { store, context } = {}) {
  const handleReferenceCancel = async event => {
    const button = event.target.closest('[data-reference-cancel]');
    if (!button || button.disabled) return;
    const confirmed = await confirmDialog('停止后会保留已经读取成功的镜头证据，不会继续调用后续模型。之后可以选择继续分析、跳过参考或更换链接。', {
      title: '停止参考视频分析？',
      confirmText: '停止分析',
    });
    if (!confirmed) return;
    try {
      setButtonBusy(button, true, '正在停止…');
      await store.cancelReferenceAnalysis();
      toast('已提交停止请求，已读取成功的内容会保留。', 'success');
    } catch (error) {
      toast(error.message, 'danger');
      setButtonBusy(button, false);
    }
  };

  const handleReferenceAbandon = async event => {
    const button = event.target.closest('[data-reference-abandon]');
    if (!button || button.disabled) return;
    const confirmed = await confirmDialog('将从当前项目移除这个参考视频。你已经填写的创意内容、成片规格和已回答问题都会保留，接下来不会再次询问是否使用参考。', {
      title: '跳过这个参考？',
      confirmText: '跳过并继续',
    });
    if (!confirmed) return;
    try {
      setButtonBusy(button, true, '正在跳过…');
      await store.removeReference();
      toast('已跳过这个参考，之前确认的内容都已保留。', 'success');
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
    const importFailure = ['failed', 'cancelled'].includes(String(currentReference.status || '').toLowerCase())
      && currentReference.source?.input_type === 'url'
      && !currentReference.source?.read_method
      && !currentReference.visual_evidence_reusable;
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
    const retryMessage = importFailure
      ? '原链接视频尚未生成分析副本，也没有调用识别模型。系统会重新读取原链接；如果原视频超过 200MB，会自动生成受控大小的分析副本。是否继续？'
      : billingUnknown
      ? `上一次内容整理请求已经发出，但系统没有收到完整结果，因此暂时无法确认是否计费。${Number(batchProgress.total || 0) > 0 ? `已完成的 ${Number(batchProgress.completed || 0)}/${Number(batchProgress.total || 0)} 批视频画面都会保留` : '已经读取成功的视频画面都会保留'}。如果继续，系统不会重新读取画面，只会再发起一次内容整理，并可能新增一次费用。是否继续？`
      : extendedConfirmation
      ? `系统已免费检测到 ${Number(preflight.segment_count || 0)} 个取证片段，需要 ${Number(preflight.batch_count || 0)} 批视觉读取；普通分析包含 10 批，本次将增加 ${Number(preflight.extra_batch_count || 0)} 批。确认后会完整读取全部片段，并按批保存进度；失败重试不会重复读取已通过批次。是否继续？`
      : completedInvalid
      ? (reusable
        ? '不需要更换或重新上传。系统会保留当前视频、撤下本次不完整结果，并使用已保存画面重新整理内容，可能产生一次新费用。是否继续？'
        : '不需要更换或重新上传。系统会保留当前视频并重新读取和整理内容，可能产生新的分析费用。是否继续？')
      : (semanticReusable
      ? '画面证据和语义整理结果都已完整保存，本次只重新校验场景与分镜映射，不再调用模型，是否继续？'
      : (reusable
        ? '当前视频画面已经完整保存，本次不会重新读取；系统只补齐没有整理完成的内容，可能产生一次新费用。是否继续？'
        : (partialEvidence
          ? `已完成 ${batchProgress.completed}/${batchProgress.total} 批镜头证据，本次只处理剩余 ${batchProgress.remaining || (batchProgress.total - batchProgress.completed)} 批，不会重跑已通过批次。若模型再次漏读同批画面，系统会把该批拆成单帧补读，因此实际视觉调用次数可能高于剩余批次数。是否继续？`
          : '当前证据没有通过逐帧完整性校验，本次将重新检测镜头并调用视觉与语义模型，可能产生新的模型费用。是否继续？')));
    let confirmed = false;
    try {
      confirmed = await confirmDialog(retryMessage, {
        title: importFailure ? '重新读取参考链接' : (billingUnknown ? '确认可能新增一次模型费用' : (extendedConfirmation ? '确认分批分析参考视频' : (completedInvalid ? '重新识别当前视频' : (semanticReusable ? '重新校验参考视频' : (reusable ? '继续补齐语义结构' : '重新读取镜头证据'))))),
        confirmText: importFailure ? '重新读取链接' : (billingUnknown ? '确认风险，仅重试语义' : (extendedConfirmation ? `确认读取 ${Number(preflight.batch_count || 0)} 批` : (completedInvalid ? '确认重新识别' : (semanticReusable ? '确认重新校验' : (reusable ? '确认重新整理' : '确认重新分析'))))),
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
      if (importFailure) {
        await store.retryReferenceImport();
      } else if (extendedConfirmation) {
        await store.retryReferenceAnalysis({
          extended_analysis_confirmed: true,
          preflight_fingerprint: String(preflight.fingerprint || ''),
        });
      } else {
        await store.retryReferenceAnalysis({ acknowledge_billing_unknown: billingUnknown });
      }
      toast(importFailure ? '已重新读取原链接，进度会继续显示在当前对话下方。' : (extendedConfirmation ? `已确认 ${Number(preflight.batch_count || 0)} 批完整分析；已通过批次会持续保存。` : (completedInvalid ? '已保留当前视频并开始重新识别，无需重新上传。' : (semanticReusable ? '已复用现有结果开始重新校验，不会再次调用模型。' : (reusable ? '已复用完整镜头证据，只继续补齐语义结构。' : '已开始重新检测并分析镜头证据。')))), 'success');
    } catch (error) {
      toast(error.message, 'danger');
      setButtonBusy(button, false);
    } finally {
      referenceRetryPending = false;
    }
  };

  host.addEventListener('click', handleReferenceCancel);
  host.addEventListener('click', handleReferenceAbandon);
  host.addEventListener('click', handleReferenceRetry);
  return () => {
    host.removeEventListener('click', handleReferenceCancel);
    host.removeEventListener('click', handleReferenceAbandon);
    host.removeEventListener('click', handleReferenceRetry);
  };
}
