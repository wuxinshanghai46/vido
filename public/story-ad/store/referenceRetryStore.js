import { beginReferenceRetry, restoreReferenceRetry } from './referenceReplacementState.js?v=20260901-production-v370';

async function runReferenceRetry(deps, path, body, missingMessage) {
  const { request, state, set, applyReferenceLiveState, syncReferencePolling } = deps;
  const analysisId = state.bundle?.reference?.analysis_id || '';
  if (!analysisId) throw new Error(missingMessage);
  const previousReference = beginReferenceRetry(state, set);
  try {
    const data = await request(`/api/new-story-ad/reference-video-analyses/${encodeURIComponent(analysisId)}/${path}`, {
      method: 'POST',
      body,
    });
    const analysis = data.analysis || {};
    applyReferenceLiveState(analysis);
    syncReferencePolling(true);
    set({ saving: false });
    return analysis;
  } catch (error) {
    restoreReferenceRetry(state, set, previousReference, error);
    throw error;
  }
}

export function retryReferenceAnalysisRequest(deps, options = {}) {
  return runReferenceRetry(deps, 'reanalyze', {
    extended_analysis_confirmed: options.extended_analysis_confirmed === true,
    preflight_fingerprint: String(options.preflight_fingerprint || ''),
    acknowledge_billing_unknown: options.acknowledge_billing_unknown === true,
  }, '当前没有可重新整理的参考视频。');
}

export function retryReferenceImportRequest(deps) {
  return runReferenceRetry(deps, 'reimport', {}, '当前没有可重新读取的参考链接。');
}

export async function cancelReferenceAnalysisRequest(deps) {
  const { request, state, set, applyReferenceLiveState, syncReferencePolling } = deps;
  const analysisId = state.bundle?.reference?.analysis_id || '';
  if (!analysisId) throw new Error('当前没有可停止的参考视频分析。');
  set({ saving: true });
  try {
    const data = await request(`/api/new-story-ad/reference-video-analyses/${encodeURIComponent(analysisId)}/cancel`, {
      method: 'POST',
      body: {},
    });
    const analysis = data.analysis || {};
    applyReferenceLiveState(analysis);
    syncReferencePolling(true);
    set({ saving: false });
    return analysis;
  } catch (error) {
    set({ saving: false });
    throw error;
  }
}
