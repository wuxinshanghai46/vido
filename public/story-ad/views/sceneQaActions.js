export function sceneActionErrorMessage(error = {}) {
  const raw = String(error?.message || error || '').trim();
  const code = String(error?.code || error?.data?.code || '').toUpperCase();
  if (/input_fingerprint_mismatch|content_revision_mismatch/i.test(raw)) {
    return '项目内容已经更新，请重新确认人物和场景方案后再继续；已有素材不会被删除，本次没有提交新的模型调用。';
  }
  if (/bundle_mismatch|person_plan_stale|scene_plan_stale/i.test(raw)) {
    return '当前项目仍使用旧版人物或场景方案，请先同步当前版本方案；已有素材不会被删除，本次没有提交新的模型调用。';
  }
  if (code === 'GENERATION_ACTIVE_PLAN_REQUIRED' || /Active Plan|active_plan/i.test(raw)) {
    return '请先完成当前项目的人物和场景方案确认；本次没有提交新的模型调用。';
  }
  if (/SCENE_(?:VISUAL_)?QA|VISION_QA|视觉模型全部失败|PROVIDER_RESPONSE_INVALID|RATE_LIMIT|(?:smscrw|webang-maas|zhipu|deyunai)\//i.test(`${code} ${raw}`)) {
    return '场景图片已保留，但审核服务暂时没有完成。可以稍后重新审核；重新审核不会重新生成图片。';
  }
  return raw || '当前场景操作没有完成，请稍后重试。';
}

export async function submitSceneFix({ context, controllerFor, cardFor, scene, button, refresh = true, billingAuthorized = false, promptFlushed = false }) {
  const error = new Error('旧单场景修复交互已停用；请使用统一“继续完成场景”。');
  error.code = 'LEGACY_SCENE_FIX_DISABLED';
  error.status = 410;
  throw error;
}

export function bindSceneQaActions() {}
