const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const context = {
  window: {},
  document: {
    querySelector: () => null,
    querySelectorAll: () => [],
  },
  URLSearchParams,
  location: { search: '', href: 'http://localhost/digital-human.html', pathname: '/digital-human.html', hash: '' },
  history: { replaceState: () => {} },
  localStorage: { getItem: () => '', setItem: () => {}, removeItem: () => {} },
};
context.window.NewStoryAdKeyframes = {
  status(frames = [], shots = []) {
    const total = Math.max(frames.length, shots.length);
    const fresh = frames.filter(frame => frame?.image_url && !frame.regeneration_error && frame.qa_policy_version >= 2 && frame.qa?.pass === true).length;
    return { total, fresh_pass: fresh, needs_regeneration: Math.max(0, total - fresh) };
  },
};
vm.createContext(context);
['public/js/new-story-ad/step-navigation.js', 'public/js/new-story-ad/button-state.js', 'public/js/new-story-ad/task-store.js', 'public/js/new-story-ad/task-persistence.js', 'public/js/new-story-ad/state-sync.js']
  .forEach(file => vm.runInContext(read(file), context, { filename: file }));

const shots = Array.from({ length: 6 }, (_, index) => ({ index: index + 1 }));
const accepted = () => ({ image_url: '/frame.png', current_generation_status: 'accepted', qa_policy_version: 2, qa: { pass: true } });
const approvedClip = index => ({
  shot_index: index,
  video_url: `/shot-${index + 1}.mp4`,
  lineage_fingerprint: `lineage-${index + 1}`,
  qa: { pass: true },
  cross_shot_qa: { pass: true },
});
const invalidState = {
  shots,
  keyframes: [accepted(), accepted(), { ...accepted(), regeneration_error: 'QA failed' }, { ...accepted(), regeneration_error: 'QA failed' }, accepted(), accepted()],
  storyboardStatus: { ready: true },
};
const keyframeReadyState = { shots, keyframes: shots.map(accepted), storyboardStatus: { ready: true }, videoClips: [] };
const validState = { ...keyframeReadyState, videoClips: shots.map((_, index) => approvedClip(index)) };
assert.strictEqual(context.window.NewStoryAdStepNavigation.keyframeReadiness({ state: invalidState }).ready, false);
assert.strictEqual(context.window.NewStoryAdStepNavigation.composeReadiness({ state: invalidState }).ready, false);
assert.strictEqual(context.window.NewStoryAdStepNavigation.canOpenStep(5, { state: invalidState }), false);
assert.strictEqual(context.window.NewStoryAdStepNavigation.keyframeReadiness({ state: keyframeReadyState }).ready, true);
assert.strictEqual(context.window.NewStoryAdStepNavigation.composeReadiness({ state: keyframeReadyState }).ready, false);
assert.strictEqual(context.window.NewStoryAdStepNavigation.canOpenStep(5, { state: keyframeReadyState }), false);
assert.strictEqual(context.window.NewStoryAdStepNavigation.composeReadiness({ state: validState }).ready, true);
assert.strictEqual(context.window.NewStoryAdStepNavigation.canOpenStep(5, { state: validState }), true);

const buttons = {
  '#dhNsaAdText': { value: '足够长的剧情广告需求' },
  '#dhNsaAdGoCompose': fakeButton(),
  '#dhNsaAdConfirmGenerate': fakeButton(),
  '#dhNsaAdGenerateShotVideos': fakeButton(),
  '#dhNsaAdRegenerateAllShotVideos': fakeButton(),
};
context.window.NewStoryAdButtonState.updateLocks({
  state: invalidState,
  within: selector => buttons[selector] || null,
  getPersonSpec: () => '',
});
assert.strictEqual(buttons['#dhNsaAdGoCompose'].disabled, true);
assert.strictEqual(buttons['#dhNsaAdConfirmGenerate'].disabled, true);
assert.strictEqual(buttons['#dhNsaAdGenerateShotVideos'].disabled, true);
assert.strictEqual(buttons['#dhNsaAdRegenerateAllShotVideos'].disabled, true);

context.window.NewStoryAdButtonState.updateLocks({
  state: keyframeReadyState,
  within: selector => buttons[selector] || null,
  getPersonSpec: () => '',
});
assert.strictEqual(buttons['#dhNsaAdGenerateShotVideos'].disabled, false);
assert.strictEqual(buttons['#dhNsaAdRegenerateAllShotVideos'].disabled, false);
assert.strictEqual(buttons['#dhNsaAdGoCompose'].disabled, true);

const outputs = { storyboard_table: shots, keyframes: invalidState.keyframes, tts_audio: { tracks: [] } };
assert.strictEqual(context.window.NewStoryAdTaskStore.resumeStep({ stage: 'video_failed' }, outputs, { ready: true }), 4);
assert.strictEqual(context.window.NewStoryAdTaskStore.resumeStep({ stage: 'tts_ready' }, { ...outputs, keyframes: validState.keyframes }, { ready: true }), 5);
assert.strictEqual(context.window.NewStoryAdTaskStore.resumeStep({ stage: 'video_ready' }, { ...outputs, keyframes: validState.keyframes, video_clips: validState.videoClips }, { ready: true }), 4);
assert.strictEqual(context.window.NewStoryAdTaskPersistence.progressStageForState({ currentStep: 5, shots }), 'keyframe_contract_ready');
assert.strictEqual(context.window.NewStoryAdTaskPersistence.progressStageForState({ currentStep: 5, shots, keyframes: validState.keyframes }), 'keyframes_ready');
const missingStoryboardState = {};
context.window.NewStoryAdStateSync.detectMissingStoryboardOutput(missingStoryboardState, { storyboard_meta: { status: 'ready' } });
assert.strictEqual(missingStoryboardState.restoreErrorCode, 'STORYBOARD_OUTPUT_MISSING');
context.window.NewStoryAdStateSync.detectMissingStoryboardOutput(missingStoryboardState, { storyboard_table: shots, storyboard_meta: { status: 'ready' } });
assert.strictEqual(missingStoryboardState.restoreErrorCode, '');

const html = read('public/digital-human.html');
assert(!/id="dhNsaAdSaveDraftStep[2345]"/.test(html), 'manual progress save buttons must be removed');
assert(/data-nsa-autosave-status hidden/.test(html), 'routine autosave status must stay hidden');
assert(html.includes('id="dhNsaAdComposeGate"'), 'persistent compose gate must exist');
assert(html.includes('id="dhNsaAdGenerateShotVideos"'), 'step 4 must own storyboard video generation');
assert(html.includes('id="dhNsaAdRegenerateAllShotVideos"'), 'step 4 must provide an explicit full video regeneration action');
assert(html.includes('生成前优化方案'), 'cost-aware video preflight action must be clearly labeled');
assert(html.includes('连续运镜方案'), 'continuous camera plan action must be clearly labeled');
['dhNsaAdGenerateFinalFrames', 'dhNsaAdRegenerateAllShotVideos', 'dhNsaAdGenerateShotVideos'].forEach((id) => {
  const tag = html.match(new RegExp(`<button[^>]+id="${id}"[^>]*>`))?.[0] || '';
  assert(tag.includes('dh-nsa-step4-generate-action'), `${id} must use the neutral step-4 action style`);
  assert(!tag.includes('dh-btn-primary'), `${id} must not look selected before the user clicks it`);
});
assert(html.includes('data-nsa-cast-mode-quick="no_human"'), 'no-human mode must be directly visible instead of hidden only in a select');
assert(html.includes('配音（选填）'), 'voiceover must be visibly optional');
assert(html.includes('背景音乐（选填）'), 'BGM must be visibly optional');
assert(html.includes('id="dhNsaAdBgmClear"'), 'BGM must provide an explicit no-music action');

const ui = read('public/js/new-story-ad-legacy-ui.js');
assert(ui.includes("el.hidden = status !== 'error'"), 'autosave UI must only appear when saving fails');
assert(ui.includes('data-nsa-candidate-override'), 'rejected keyframes must offer an explicit human override action');
assert(ui.includes('/manual-accept'), 'human override must call the auditable manual acceptance endpoint');
assert(ui.includes("person_spec: noHuman ? { castMode: 'no_human' } : person"), 'no-human payload must suppress stale person details');
assert(ui.includes('assetPayloadList({ includePerson: !noHuman })'), 'no-human payload must exclude person reference assets');
assert(ui.includes('不使用配音（选填）'), 'voice picker must immediately offer a no-voiceover choice');
assert(ui.includes("api(`/api/avatar/voice-list${query}`)"), 'normal voice loading must reuse browser/server cache');
assert(ui.includes("sessionStorage.setItem('vido_nsa_voice_catalog'"), 'voice catalog must be cached for later opens');
assert(ui.includes('include_voiceover: !!state.voiceId'), 'media payload must explicitly disable voiceover when no voice is selected');
assert(ui.includes("if (state.voiceId && !await runStage('tts', button))"), 'legacy media chain must skip TTS without a selected voice');
assert(!ui.includes("if (!await runStage('video', button)) return;"), 'step 5 must not regenerate storyboard videos');
assert(ui.includes('预计付费提交'), 'video generation must disclose paid provider units before confirmation');
assert(ui.includes('confirmVideoPreflight'), 'all storyboard video actions must load a server preflight before generation');
assert(ui.includes('function confirmNsaAction'), 'video cost confirmation must use an in-product modal');
assert(!ui.includes('window.confirm'), 'story-ad actions must not use poor browser-native confirmation dialogs');
assert(ui.includes('点击取消不会改变按钮和任务状态'), 'full regeneration modal must explain that cancellation has no side effects');
assert(ui.includes("querySelectorAll('.is-busy, [aria-busy=\"true\"]')"), 'successful cancellation must immediately clear the triggering button busy state');
assert(ui.includes('视频尚未生成'), 'each storyboard row must distinguish missing video output');
assert(ui.includes('视频已生成，等待审核'), 'each storyboard row must distinguish generated video awaiting review');
assert(ui.includes('videoShotStatuses'), 'the UI must hydrate persisted per-shot video lifecycle state');
assert(ui.includes('正在恢复任务</b>'), 'compose view must show a restore state instead of a false missing-storyboard warning');
assert(ui.includes('任务内容读取失败'), 'restore failures must be visible instead of leaving an empty editor');
assert(ui.includes('const mediaFailed = !mediaActive'), 'a new active generation must hide the previous batch failure banner');
assert(ui.includes('videoFailureDetails(clips)'), 'failed video QA must expose per-shot reasons to the task owner');
assert(ui.includes('复审现有视频，不自动重做'), 'incremental repair must clearly preserve and re-review existing rejected media');
assert(ui.includes('不会自动付费重做'), 'repair confirmation must disclose that failed re-review does not trigger paid regeneration');
assert(ui.includes('分镜视频不会在本步骤重新生成'), 'step 5 failure copy must make the no-video-regeneration boundary explicit');
assert(ui.includes('NewStoryAdTaskStore.resumeStep(bundle.task'), 'task restore must derive the current step from persisted server progress');
assert(!ui.includes('requestedStep === 3 && storyboardReady ? 4 : requestedStep'), 'task restore must not automatically advance from the URL step');
assert(ui.includes('data-nsa-media-result-state'), 'media result must display an explicit success, running, incomplete or failed state');
assert(ui.includes('最终成片没有生成，因此这里不会出现成片播放器'), 'failed media result must explain why no player is visible');
assert(ui.includes('有效镜头 ${approvedVideoShots}/${totalVideoShots}'), 'media result must report QA-approved shots instead of raw clip array length');
assert(!ui.includes('clips.length ? `视频镜头 ${clips.length} 条`'), 'raw clip records must never be presented as successful video shots');

const generationFlow = read('public/js/new-story-ad/generation-flow.js');
assert(generationFlow.includes("return runStage('compose', ctx)"), 'step 5 chain must end in composition only');
assert(generationFlow.includes('visual_only: true'), 'step 4 storyboard video generation must be explicitly visual-only');
assert(generationFlow.includes('force_regenerate_all: regenerateAll'), 'full regeneration button must send an explicit server flag');

const wizardCss = read('public/css/digital-human-wizard.css');
assert(wizardCss.includes('.dh-nsa-step4-generate-action.is-generating'), 'only the actively running step-4 action should receive the highlighted style');
assert(wizardCss.includes('.dh-nsa-confirm-panel'), 'video confirmation must use a responsive product modal');
assert(wizardCss.includes('.dh-nsa-video-status-badge'), 'each storyboard row must visibly label video state');
const route = read('src/routes/newStoryAd.js');
assert(route.includes("queueTaskStage(req, res, 'media'"), 'server must queue the complete media chain');
assert(route.includes("missing_only: true"), 'media retries must preserve completed video clips');
assert(route.includes("router.get('/tasks/:id/video/preflight'"), 'server must expose a zero-generation video preflight endpoint');
assert(route.includes('service.assertVideoPreflightConfirmation(req.params.id, body)'), 'server must reject unconfirmed or stale video plans before queueing');

const service = read('src/services/newStoryAd/storyAdService.js');
const ttsBlock = service.slice(service.indexOf('async function generateTtsStage'), service.indexOf('async function generateVideoStage'));
assert(ttsBlock.indexOf('assertVideoInputsReady') >= 0, 'TTS must enforce media QA preflight');
assert(ttsBlock.indexOf('assertVideoInputsReady') < ttsBlock.indexOf('ttsAdapter.generateVoiceover'), 'QA preflight must run before paid TTS');
assert(ttsBlock.indexOf('if (!includeVoiceover)') < ttsBlock.indexOf('ttsAdapter.generateVoiceover'), 'disabled voiceover must return before any paid TTS call');
const videoBlock = service.slice(service.indexOf('async function generateVideoStage'), service.indexOf('async function composeStage'));
assert(videoBlock.includes('ttsAudio = silentTtsOutput()'), 'video generation must use empty audio tracks when voiceover is disabled');
assert(videoBlock.includes('videoLineage.buildShotLineage'), 'every clip must be linked to the current storyboard/person/product/scene/keyframe/audio contract');
assert(videoBlock.includes('videoRepairPolicy.buildRepairPlan'), 'QA failures must use bounded structured auto-repair');
assert(videoBlock.includes('sceneBlockService.buildSceneBlocks'), 'video stage must derive generic continuous blocks from current spatial contracts');
assert(videoBlock.includes('videoAdapter.generateSceneBlockVideos'), 'video generation must submit scene blocks instead of always submitting independent shots');
assert(videoBlock.includes('const forceRegenerateAll = !zeroCostOnly'), 'server video stage must recognize confirmed continuous/full regeneration while preserving zero-cost-only mode');
assert(videoBlock.includes('if (forceRegenerateAll || forcedIndexSet.has(index))'), 'full and explicit single-shot regeneration must bypass successful clip reuse');
assert(videoBlock.includes('requestedIndexSet && !requestedIndexSet.has(index)'), 'single-shot video regeneration must not submit unrelated shots');
assert(videoBlock.includes('const reviewExistingOnly ='), 'missing-only repair must distinguish existing rejected media from genuinely missing media');
assert(videoBlock.includes('videoLineage.clipHasMediaFile(existingClip)'), 'existing rejected media must be retained for zero-cost re-review');
assert(videoBlock.includes('pendingReviewIndexes.push(index)'), 'matching rejected media must enter QA review before any provider generation');
assert(service.includes('function acceptVideoClipOverride'), 'failed videos must support explicit human acceptance without another generation');
const composeBlock = service.slice(service.indexOf('async function composeStage'), service.indexOf('async function runFull'));
assert(!composeBlock.includes('generateVideoStage(taskId'), 'composition must never call the paid visual video generator');
assert(composeBlock.includes("storage.getOutput(taskId, 'video_clips')"), 'composition must consume already-approved step 4 clips');
assert(composeBlock.includes('hasBgmAssetOption'), 'explicit no-BGM selection must not restore an older BGM from task context');
assert(composeBlock.includes('const composeVoiceId = resolveTtsVoiceId'), 'explicit no-voice selection must persist through compose');

const composeService = read('src/services/newStoryAd/composeService.js');
assert(composeService.includes('async function muxVoiceTrack'), 'step 5 must mix voice locally without regenerating visual clips');
assert(composeService.includes('ttsAudio = {}'), 'composition must accept the optional TTS tracks');

const contextBuilder = read('src/services/newStoryAd/contextBuilder.js');
assert(contextBuilder.includes('include_voiceover: includeVoiceover'), 'optional voiceover choice must persist with the task');

console.log('NEW_STORY_AD_COMPOSE_GATE_AUTOSAVE_TEST_OK');

function fakeButton() {
  const classes = new Set();
  return {
    disabled: false,
    title: '',
    classList: {
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
      add(...names) { names.forEach(name => classes.add(name)); },
      remove(...names) { names.forEach(name => classes.delete(name)); },
    },
    setAttribute() {},
    removeAttribute() {},
  };
}
