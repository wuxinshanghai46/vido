import { request } from '../api.js?v=20260827-production-v233i';

async function preflight(bundle = {}, generationPayload = {}, apply = false, proofToken = '') {
  const taskId = bundle?.project?.id || '';
  return request(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/subject-recovery-preflight`, {
    method: 'POST', body: { apply, expected_proof_token: proofToken, generation_payload: generationPayload },
  });
}

export async function ensureSubjectRecoveryReady({ bundle, generationPayload, button, host, setButtonBusy, toast } = {}) {
  try {
    setButtonBusy(button, true, '正在安全检查已保留图片…');
    let result = await preflight(bundle, generationPayload);
    if (result.state === 'safe_rebase_available') result = await preflight(bundle, generationPayload, true, result.proof_token);
    if (result.safe_to_continue) return true;
    const detail = host?.querySelector?.('[data-recovery-preflight-result]');
    if (detail) {
      detail.hidden = false;
      detail.textContent = result.differences?.map(item => item.message).filter(Boolean).join('；') || '当前内容存在差异，已停止生成。';
    }
    toast('安全检查未通过，未提交生成，也不会产生模型费用。', 'warning'); return false;
  } catch (error) { toast(error.message, 'danger'); return false; }
  finally { setButtonBusy(button, false); }
}
