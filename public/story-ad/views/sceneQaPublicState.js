const QA_SERVICE_FAILURE = /视觉模型全部失败|VISION_QA|PROVIDER_RESPONSE_INVALID|RATE_LIMIT|(?:smscrw|webang-maas|zhipu|deyunai)[/]/i;

function text(value = '') { return String(value || '').trim(); }
function list(value) { return Array.isArray(value) ? value : []; }

function unavailableCauseMessage(item = {}) {
  const labels = {
    timeout: '审核接口超时',
    invalid_response: '返回格式不完整',
    rate_limited: '请求频率受限',
    no_valid_result: '没有取得有效审核结论',
  };
  const causes = [...new Set(list(item.qa?.failure_categories).map(value => labels[text(value)]).filter(Boolean))];
  return causes.length ? `${causes.join('、')}。图片已保留，本次不会重新生成图片。` : '审核服务没有取得有效结论。图片已保留，本次不会重新生成图片。';
}

export function publicSceneQaReason(value = '') {
  const reason = text(value);
  if (!reason) return '';
  if (QA_SERVICE_FAILURE.test(reason)) return '审核服务暂时没有返回有效结论；场景图片已保留，可以稍后重新审核。';
  if (/Active Plan|active_plan|person_plan_stale|scene_plan_stale|bundle_mismatch/i.test(reason)) {
    return '当前项目的生成版本正在同步，或已有任务正在处理；请等待后刷新重试。';
  }
  return reason;
}

export function sceneQaPublicState(item = {}) {
  if (item.qa?.full_space_lock === true) return { kind: 'unknown', title: '', message: '' };
  const rawReasons = [item.qa?.error, ...list(item.qa?.reasons), ...list(item.repair_plan?.reasons)]
    .map(text).filter(Boolean);
  const verificationState = text(item.qa?.verification_state || item.verification?.state || item.qa?.space_lock_status).toLowerCase();
  const explicitUnavailable = item.qa?.qa_unavailable === true || ['unavailable', 'service_unavailable'].includes(verificationState);
  const explicitContentFailure = ['rejected', 'failed', 'content_failed'].includes(verificationState);
  const serviceUnavailable = explicitUnavailable
    || (!explicitContentFailure && rawReasons.some(reason => QA_SERVICE_FAILURE.test(reason)));
  const action = text(item.repair_plan?.action);
  if (serviceUnavailable) return {
    kind: 'service_unavailable', title: '审核暂不可用，图片已保留',
    message: unavailableCauseMessage(item),
  };
  if (action === 'reverify') return {
    kind: 'evidence_pending', title: 'QA 尚未定位到具体图片',
    message: '先重新审核取得逐图证据；不会重新生成图片。',
  };
  if (['regenerate_failed_views', 'rebuild_atlas', 'regenerate_full_scene'].includes(action)) return {
    kind: 'content_failed', title: '场景内容质量未通过',
    message: '已定位到需要补图或重建的内容；其余成功图片继续保留。',
  };
  return { kind: 'unknown', title: '', message: '' };
}

export function sceneQaRows(item = {}) {
  const named = list(item.scene_card?.qa_checks);
  if (named.length) return named;
  const qa = item.qa || {};
  return [['空间锁', qa.full_space_lock], ['需求匹配', qa.requirement_pass], ['跨视角一致性', qa.cross_view_pass],
    ['空间覆盖', qa.spatial_pass], ['机位设计', qa.camera_pass], ['摄影真实感', qa.realism_pass]]
    .filter(([, pass]) => pass !== undefined && pass !== null)
    .map(([label, pass]) => ({ label, pass, reasons: [] }));
}

export function sceneQaFailureDetails(item = {}) {
  const failed = sceneQaRows(item).filter(row => row.pass === false);
  const reasons = [...failed.flatMap(row => list(row.reasons)), ...list(item.repair_plan?.reasons), ...list(item.qa?.reasons)]
    .map(publicSceneQaReason).filter(Boolean);
  return { labels: [...new Set(failed.map(row => text(row.label)).filter(Boolean))], reasons: [...new Set(reasons)].slice(0, 6) };
}
