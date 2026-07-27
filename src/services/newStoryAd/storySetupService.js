function assertConfirmed(context = {}, targetStage = '') {
  const stage = String(targetStage || '').trim().toLowerCase();
  if (!['blueprint', 'storyboard', 'script_package'].includes(stage)) return context;
  if (String(context.request_source || '') !== 'new_story_ad_legacy_style_ui') return context;
  if (context.story_setup_confirmed === true) return context;
  const error = new Error('请先确认人物与场景形象，再进入剧情设置并确认后生成剧本');
  error.code = 'STORY_SETUP_REQUIRED';
  error.status = 422;
  error.retryable = false;
  throw error;
}

module.exports = { assertConfirmed };
