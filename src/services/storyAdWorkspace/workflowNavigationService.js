'use strict';

const sceneVisualAcceptance = require('../newStoryAd/sceneVisualAcceptanceService');

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
  const soundApproval = outputs.audio_production_approval || {};
  const soundReady = soundApproval.confirmed === true && Boolean(soundApproval.signature);
  const assetSetupComplete = context.asset_setup_confirmed === true
    || storyboardReady || keyframesReady || clipsReady || finalReady;
  const acceptance = outputs[sceneVisualAcceptance.OUTPUT_KIND];
  const acceptanceAllowsNavigation = !acceptance
    || ['accepted', 'superseded_by_qa'].includes(String(acceptance.status || ''));
  const sceneSetupComplete = (context.scene_setup_confirmed === true && acceptanceAllowsNavigation)
    || storyboardReady || keyframesReady || clipsReady || finalReady;
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
      final_videos: finalReady ? 1 : 0,
    },
    asset_plan_eligibility: planEligibility,
    steps: {
      brief: step(true, briefInputReady, '', 'plot'),
      plot: step(briefInputReady || blueprintReady, blueprintReady, referenceAttached && !referenceReady
        ? '请等待参考视频分析成功并确认理解结果。'
        : '请先通过对话确认项目名称、内容类型和核心设想。', 'assets'),
      assets: step(blueprintReady || assetPlanReady, assetSetupComplete, '请先生成并确认详细剧情与对白。', 'scene'),
      scene: step(assetSetupComplete, sceneSetupComplete, '请先确认人物资产。', 'storyboard'),
      storyboard: step(sceneSetupComplete && blueprintReady, storyboardReady && shotDesignComplete, '请先生成并确认全部场景。', 'compose'),
      sound: step(finalReady, soundReady, '请先合成初版成片，再在剪辑中修改声音。', 'edit'),
      compose: step(shotDesignComplete, finalReady, '请先完成并确认全部镜头设计。', 'edit'),
      edit: step(finalReady, Boolean(outputs.edit_timeline), '请先生成视频片段并合成初版成片。', ''),
      final: step(shotDesignComplete, finalReady, '请先完成并确认全部镜头设计。', ''),
      workflow: step(true, finalReady, '', ''),
    },
  };
  result.current = ['brief', 'plot', 'assets', 'scene', 'storyboard', 'compose', 'edit']
    .find(view => result.steps[view].enabled && !result.steps[view].completed) || 'edit';
  return result;
}

module.exports = { build };
