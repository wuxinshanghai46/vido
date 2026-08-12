'use strict';

/**
 * Derive the sequential workspace state from persisted outputs only. A view is
 * enabled by completion of its immediate upstream step; UI routes consume the
 * same contract, so sidebar clicks and direct URLs cannot diverge.
 */
function build({ task = {}, context = {}, outputs = {}, counts = {}, clean, list } = {}) {
  const reference = context.reference_video_analysis && typeof context.reference_video_analysis === 'object'
    ? context.reference_video_analysis
    : {};
  const referenceAttached = Boolean(reference.id || reference.analysis_id || context.reference_video_analysis_id);
  const referenceReady = !referenceAttached || (
    clean(reference.status, 40).toLowerCase() === 'completed'
    && reference.analysis_quality?.valid === true
  );
  const briefInputReady = Boolean(clean(context.project_name || task.title, 120)
    && clean(context.brief || task.brief, 3000)
    && referenceReady);
  const planEligibility = outputs.asset_plan_eligibility && typeof outputs.asset_plan_eligibility === 'object'
    ? outputs.asset_plan_eligibility
    : { eligible: false, issues: ['active_plan_eligibility_missing'] };
  const assetPlanReady = planEligibility.eligible === true
    && Boolean(outputs.asset_plan
      && Array.isArray(outputs.asset_plan.cast_profiles)
      && Array.isArray(outputs.asset_plan.scene_plan?.spaces)
      && outputs.asset_plan.scene_plan.spaces.length);
  const blueprintReady = Boolean(outputs.blueprint && list(outputs.blueprint.beats).length);
  const storyboardReady = list(outputs.storyboard_table).length > 0;
  const keyframesReady = list(outputs.keyframes).length > 0;
  const clipsReady = list(outputs.video_clips).length > 0;
  const finalReady = Boolean(outputs.final_video?.video_url || outputs.final_video?.videoUrl);
  const assetSetupComplete = context.asset_setup_confirmed === true
    || blueprintReady || storyboardReady || keyframesReady || clipsReady || finalReady;
  const shotDesignComplete = context.shot_design_confirmed === true || keyframesReady || clipsReady || finalReady;
  const step = (enabled, completed, blocker, nextView) => ({
    enabled,
    completed,
    blocker: enabled ? '' : blocker,
    next_view: nextView,
  });
  const result = {
    counts: {
      ...counts,
      shots: list(outputs.storyboard_table).length,
      keyframes: list(outputs.keyframes).length,
      clips: list(outputs.video_clips).length,
    },
    asset_plan_eligibility: planEligibility,
    steps: {
      brief: step(true, assetPlanReady, '', 'assets'),
      assets: step(briefInputReady || assetPlanReady, assetSetupComplete, referenceAttached && !referenceReady
        ? '请等待参考视频分析成功后再创建资产。'
        : '请先填写项目名称和内容目标。', 'scene'),
      scene: step(assetSetupComplete, assetSetupComplete, '请先在人物资产中确认人物、动物和必要展示主体。', 'plot'),
      plot: step(assetSetupComplete, blueprintReady, '请先确认人物资产与场景世界的文字规划。', 'storyboard'),
      storyboard: step(blueprintReady, storyboardReady && shotDesignComplete, '请先在第 4 步生成或保存剧本。', 'final'),
      final: step(shotDesignComplete, finalReady, '请先完成并确认全部镜头设计。', ''),
      workflow: step(true, finalReady, '', ''),
    },
  };
  result.current = ['brief', 'assets', 'scene', 'plot', 'storyboard', 'final']
    .find(view => result.steps[view].enabled && !result.steps[view].completed) || 'final';
  return result;
}

module.exports = { build };
