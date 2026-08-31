import { setButtonBusy, toast } from '../components/ui.js?v=20260831-production-v321';

const QA_SERVICE_FAILURE = /视觉模型全部失败|VISION_QA|PROVIDER_RESPONSE_INVALID|RATE_LIMIT|(?:smscrw|webang-maas|zhipu|deyunai)[/]/i;

function text(value = '') { return String(value || '').trim(); }
function list(value) { return Array.isArray(value) ? value : []; }

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
  const unavailableTitle = rawReasons.some(reason => /缺少|SCHEMA|PROVIDER_RESPONSE_INVALID/i.test(reason))
    ? '审核结果不完整，图片已保留'
    : (rawReasons.some(reason => /TIMEOUT|超时/i.test(reason))
      ? '审核响应超时，图片已保留'
      : '审核服务未返回结论，图片已保留');
  if (serviceUnavailable) return {
    kind: 'service_unavailable', title: unavailableTitle,
    message: `${text(item.qa?.failure_summary) || '未定位到具体图片'}，不代表图片不合格；可重新审核或使用当前图片继续。`,
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

export function bindSceneConfirmAction(host, context) {
  host.querySelector('[data-confirm-scenes]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    setButtonBusy(button, true, '正在确认…');
    try {
      await context.store.updateRequest({ scene_setup_confirmed: true }, { skipRefresh: true });
      const refreshed = await context.store.refreshSections('summary,assets,story,shots');
      if (refreshed?.navigation?.steps?.flow?.enabled === false) throw new Error(refreshed.navigation.steps.flow.blocker || '剧情流向确认步骤尚未解锁');
      context.navigate(`/story-ad/projects/${encodeURIComponent(context.bundle.project.id)}?view=flow`);
    } catch (error) {
      toast(error.message || '确认场景失败', 'error');
      setButtonBusy(button, false);
    }
  });
}
