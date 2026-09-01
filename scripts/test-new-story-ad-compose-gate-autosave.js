const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-nsa-compose-autosave-'));
process.env.OUTPUT_DIR = tempDir;
process.env.DB_ENABLED = '0';

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
['public/js/new-story-ad/video-boundaries.js', 'public/js/new-story-ad/step-navigation.js', 'public/js/new-story-ad/button-state.js', 'public/js/new-story-ad/task-store.js', 'public/js/new-story-ad/task-persistence.js', 'public/js/new-story-ad/state-sync.js']
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
assert.strictEqual(context.window.NewStoryAdStepNavigation.canOpenStep(5, { state: invalidState }), true);
assert.strictEqual(context.window.NewStoryAdStepNavigation.canOpenStep(6, { state: invalidState }), false);
assert.strictEqual(context.window.NewStoryAdStepNavigation.keyframeReadiness({ state: keyframeReadyState }).ready, true);
assert.strictEqual(context.window.NewStoryAdStepNavigation.composeReadiness({ state: keyframeReadyState }).ready, false);
assert.strictEqual(context.window.NewStoryAdStepNavigation.canOpenStep(5, { state: keyframeReadyState }), true);
assert.strictEqual(context.window.NewStoryAdStepNavigation.canOpenStep(6, { state: keyframeReadyState }), true);
assert.strictEqual(context.window.NewStoryAdStepNavigation.composeReadiness({ state: validState }).ready, true);
assert.strictEqual(context.window.NewStoryAdStepNavigation.canOpenStep(5, { state: validState }), true);
assert.strictEqual(context.window.NewStoryAdStepNavigation.canOpenStep(6, { state: validState }), true);
const boundaryBlocks = ['block-a', 'block-b', 'block-b', 'block-c', 'block-c', 'block-d'];
const boundaryGapState = { ...keyframeReadyState, videoClips: validState.videoClips.map((clip, index) => ({ ...clip, scene_block_id: boundaryBlocks[index] })) };
delete boundaryGapState.videoClips[3].cross_shot_qa;
const boundaryGapReadiness = context.window.NewStoryAdStepNavigation.composeReadiness({ state: boundaryGapState });
assert.strictEqual(boundaryGapReadiness.ready, false);
assert.deepStrictEqual(Array.from(boundaryGapReadiness.boundaries.missing_indexes), [3]);
assert.match(boundaryGapReadiness.message, /跨生成单元衔接未审核/);
const retryReadyState = { ...validState, taskStatus: 'failed', taskError: '上次封装失败', taskErrorCode: 'UNKNOWN', generationProgress: { stage: 'compose', status: 'failed' } };
const retryPresentation = context.window.NewStoryAdStepNavigation.composePresentation({ state: retryReadyState });
assert.strictEqual(retryPresentation.retry_ready, true);
assert.strictEqual(retryPresentation.failed, false, 'a preserved compose failure must become retry-ready after all current clips pass QA');
const preservedClipsButVideoFailedState = {
  ...validState,
  taskStatus: 'failed',
  taskError: '第 2 镜供应商未创建视频任务',
  taskErrorCode: 'INPUT_PERSON_PRIVACY',
  mediaResult: {
    outcome: 'partial_failed',
    compose: { status: 'blocked' },
    title: '第 1–6 镜历史片段仍保留；本次第 2 镜生成失败',
    failure_text: '第 2 镜在供应商任务创建前失败；第 4 镜尚未执行。',
    compose_text: '最终封装已阻止。',
  },
};
const blockedCompose = context.window.NewStoryAdStepNavigation.composeReadiness({ state: preservedClipsButVideoFailedState });
const blockedPresentation = context.window.NewStoryAdStepNavigation.composePresentation({ state: preservedClipsButVideoFailedState, compose: blockedCompose });
assert.strictEqual(blockedCompose.materials_ready, true, 'preserved historical clips may still pass their old QA');
assert.strictEqual(blockedCompose.ready, false, 'a structured video failure must override preserved clip readiness');
assert.match(blockedCompose.message, /第 2 镜在供应商任务创建前失败/);
assert.strictEqual(blockedPresentation.failed, true);
assert.strictEqual(blockedPresentation.action_ready, false);

const buttons = {
  '#dhNsaAdText': { value: '足够长的剧情广告需求' },
  '#dhNsaAdConfirmGenerate': fakeButton(),
  '#dhNsaAdGenerateShotVideos': fakeButton(),
};
context.window.NewStoryAdButtonState.updateLocks({
  state: invalidState,
  within: selector => buttons[selector] || null,
  getPersonSpec: () => '',
});
assert.strictEqual(buttons['#dhNsaAdConfirmGenerate'].disabled, true);
assert.strictEqual(buttons['#dhNsaAdGenerateShotVideos'].disabled, true);

context.window.NewStoryAdButtonState.updateLocks({
  state: keyframeReadyState,
  within: selector => buttons[selector] || null,
  getPersonSpec: () => '',
});
assert.strictEqual(buttons['#dhNsaAdGenerateShotVideos'].disabled, false);
context.window.NewStoryAdButtonState.updateLocks({ state: boundaryGapState, within: selector => buttons[selector] || null, getPersonSpec: () => '' });
assert.strictEqual(buttons['#dhNsaAdConfirmGenerate'].disabled, true, 'missing cross-unit QA must disable final composition');
context.window.NewStoryAdButtonState.updateLocks({ state: retryReadyState, within: selector => buttons[selector] || null, getPersonSpec: () => '' });
assert.strictEqual(buttons['#dhNsaAdConfirmGenerate'].disabled, false);
assert.strictEqual(buttons['#dhNsaAdConfirmGenerate'].classList.contains('is-next'), true);
assert.strictEqual(buttons['#dhNsaAdConfirmGenerate'].textContent, '下一步：封装最终成片 →');
context.window.NewStoryAdButtonState.updateLocks({ state: preservedClipsButVideoFailedState, within: selector => buttons[selector] || null, getPersonSpec: () => '' });
assert.strictEqual(buttons['#dhNsaAdConfirmGenerate'].disabled, true, 'a failed current attempt must disable final composition even when old clips remain');
assert.strictEqual(buttons['#dhNsaAdConfirmGenerate'].classList.contains('is-next'), false);
assert.strictEqual(buttons['#dhNsaAdConfirmGenerate'].textContent, '封装最终成片');
const selectedButton = fakeButton('生成整条广告视频');
context.window.NewStoryAdButtonState.setButtonBusy(selectedButton, true, '生成整条广告视频中...');
assert.strictEqual(selectedButton.classList.contains('is-selected'), true);
assert.strictEqual(selectedButton.attributes['aria-pressed'], 'true');
assert.strictEqual(selectedButton.attributes['aria-busy'], 'true');
context.window.NewStoryAdButtonState.setButtonBusy(selectedButton, false);
assert.strictEqual(selectedButton.classList.contains('is-selected'), false);
assert.strictEqual(selectedButton.attributes['aria-pressed'], 'false');

const outputs = { storyboard_table: shots, keyframes: invalidState.keyframes, tts_audio: { tracks: [] } };
assert.strictEqual(context.window.NewStoryAdTaskStore.resumeStep({ stage: 'video_failed' }, outputs, { ready: true }), 6);
assert.strictEqual(context.window.NewStoryAdTaskStore.resumeStep({ stage: 'tts_ready' }, { ...outputs, keyframes: validState.keyframes }, { ready: true }), 6);
assert.strictEqual(context.window.NewStoryAdTaskStore.resumeStep({ stage: 'video_ready' }, { ...outputs, keyframes: validState.keyframes, video_clips: validState.videoClips }, { ready: true }), 6);
assert.strictEqual(context.window.NewStoryAdTaskPersistence.progressStageForState({ currentStep: 5, shots }), 'keyframe_contract_ready');
assert.strictEqual(context.window.NewStoryAdTaskPersistence.progressStageForState({ currentStep: 5, shots, keyframes: validState.keyframes }), 'keyframes_ready');
const authoritativeFrames = shots.map((_, index) => ({ ...accepted(), image_url: `/authoritative-${index}.png` }));
authoritativeFrames[2] = { ...authoritativeFrames[2], contract_outdated: true, current_generation_status: 'outdated' };
const storyboardSaveState = {
  keyframes: shots.map((_, index) => ({ ...accepted(), image_url: `/stale-${index}.png` })),
  review: { status: 'stale' },
  ttsAudio: { tracks: [{ file_path: '/stale.wav' }] },
  videoClips: [{ video_url: '/stale.mp4' }],
  finalVideo: { video_url: '/stale-final.mp4' },
};
context.window.NewStoryAdTaskPersistence.syncStoryboardArtifacts(storyboardSaveState, {
  keyframes: authoritativeFrames,
  quality_review: null,
  tts_audio: null,
  video_clips: [],
  final_video: null,
});
assert.deepStrictEqual(JSON.parse(JSON.stringify(storyboardSaveState.keyframes)), authoritativeFrames,
  'storyboard autosave must adopt the complete server frame list instead of clearing every card');
assert.strictEqual(storyboardSaveState.review, null);
assert.strictEqual(storyboardSaveState.ttsAudio, null);
assert.deepStrictEqual(Array.from(storyboardSaveState.videoClips), []);
assert.strictEqual(storyboardSaveState.finalVideo, null);
let sceneHydrateCalls = 0;
context.window.NewStoryAdSceneAssets = {
  hydrate(state, { request = {}, outputs = {}, response = {} } = {}) {
    sceneHydrateCalls += 1;
    state.sceneAssets = outputs.scene_assets || response.scene_assets || request.scene_assets || [];
  },
};
const projectedPartialScene = {
  id: 'space_home',
  space_id: 'space_home',
  partial_checkpoint: true,
  completed_view_keys: ['master'],
  failed_view_keys: ['layout'],
  view_images: [{ key: 'master', url: '/home-master.png' }],
};
const rawStoredScene = {
  id: 'space_home',
  space_id: 'space_home',
  image_url: '/home-master.png',
  view_images: [{ key: 'master', url: '/home-master.png' }],
};
const autosaveHydrationState = {
  taskId: 'scene-autosave-projection-regression',
  sceneAssets: [projectedPartialScene],
  castProfiles: [],
  petProfiles: [],
  referenceAssets: [],
};
context.window.NewStoryAdStateSync.normalizeBundle({
  task: { id: 'scene-autosave-projection-regression', status: 'working', stage: 'scene_config_done' },
  context: { scene_assets: [rawStoredScene] },
}, { state: autosaveHydrationState });
assert.strictEqual(sceneHydrateCalls, 0,
  'a progress-save response without explicit scene_assets output must not replace the current checkpoint projection with raw context');
assert.strictEqual(autosaveHydrationState.sceneAssets[0].partial_checkpoint, true,
  'the selected partial scene must remain resumable after silent autosave');
context.window.NewStoryAdStateSync.normalizeBundle({
  task: { id: 'scene-autosave-projection-regression', status: 'working', stage: 'scene_config_done' },
  outputs: { scene_assets: [{ ...projectedPartialScene, completed_view_keys: ['master', 'layout'] }] },
}, { state: autosaveHydrationState });
assert.strictEqual(sceneHydrateCalls, 1,
  'an explicit scene_assets output must still replace the current projection');
assert.deepStrictEqual(Array.from(autosaveHydrationState.sceneAssets[0].completed_view_keys), ['master', 'layout']);
const missingStoryboardState = {};
context.window.NewStoryAdStateSync.detectMissingStoryboardOutput(missingStoryboardState, { storyboard_meta: { status: 'ready' } });
assert.strictEqual(missingStoryboardState.restoreErrorCode, 'STORYBOARD_OUTPUT_MISSING');
context.window.NewStoryAdStateSync.detectMissingStoryboardOutput(missingStoryboardState, { storyboard_table: shots, storyboard_meta: { status: 'ready' } });
assert.strictEqual(missingStoryboardState.restoreErrorCode, '');

const html = read('public/digital-human.html');
assert(html.includes('bootstrap.js?v=20260731-reference-grounding-v2'), 'the page shell must bust cached compose UI assets after deployment');
assert(!/id="dhNsaAdSaveDraftStep[2345]"/.test(html), 'manual progress save buttons must be removed');
assert(/data-nsa-autosave-status hidden/.test(html), 'routine autosave status must stay hidden');
assert(html.includes('id="dhNsaAdComposeGate"'), 'persistent compose gate must exist');
assert(html.includes('id="dhNsaAdGenerateShotVideos"'), 'step 4 must own the one-click whole-ad video workflow');
assert(!html.includes('id="dhNsaAdRegenerateAllShotVideos"'), 'the UI must not expose a second per-shot/full-regeneration path');
assert(html.includes('生成整条广告视频'), 'the single video action must clearly describe the whole-ad workflow');
assert(!html.includes('高质量逐镜方案') && !html.includes('生成前优化方案'), 'obsolete per-shot plan actions must be removed');
['dhNsaAdGenerateFinalFrames', 'dhNsaAdGenerateShotVideos'].forEach((id) => {
  const tag = html.match(new RegExp(`<button[^>]+id="${id}"[^>]*>`))?.[0] || '';
  assert(tag.includes('dh-nsa-step4-generate-action'), `${id} must use the explicit step-4 action state style`);
});
assert(html.includes('data-nsa-cast-mode-quick="no_human"'), 'no-human mode must be directly visible instead of hidden only in a select');
assert(html.includes('配音（选填）'), 'voiceover must be visibly optional');
assert(html.includes('背景音乐（选填）'), 'BGM must be visibly optional');
assert(html.includes('id="dhNsaAdBgmClear"'), 'BGM must provide an explicit no-music action');

const currentFinalView = read('public/story-ad/views/finalView.js');
const currentStore = read('public/story-ad/store/projectStore.js');
assert(currentFinalView.includes("store.videoPreflight('economy', videoModelRoute)"), '现行视频入口必须先执行绑定所选模型的零生成预检');
assert(currentFinalView.includes('data-cost-confirm'), '现行视频入口必须明确确认费用上限');
assert(currentFinalView.includes('data-complexity-confirm'), '复杂镜头必须有独立人工复核确认');
assert(currentStore.includes('confirmed_cost_limit_rmb: Number(cost.maximum_cost_rmb || 0)'), '确认的费用上限必须提交给服务端');
assert(currentFinalView.indexOf("store.videoPreflight('economy', videoModelRoute)") < currentFinalView.indexOf('store.startVideo(preflight'), '预检必须发生在付费视频提交之前');

const generationFlow = read('public/js/new-story-ad/generation-flow.js');
assert(generationFlow.includes("return runStage('compose', ctx)"), 'step 5 chain must end in composition only');
assert(generationFlow.includes('visual_only: true'), 'step 4 storyboard video generation must be explicitly visual-only');
assert(generationFlow.includes('force_regenerate_all: regenerateAll'), 'full regeneration button must send an explicit server flag');
assert(generationFlow.includes("video_generation_mode: state.videoGenerationMode || 'quality'"), 'whole-ad media payload must use the approved continuous quality plan');

const wizardCss = read('public/css/digital-human-wizard.css');
assert(wizardCss.includes('.dh-nsa-step4-generate-action.is-generating'), 'only the actively running step-4 action should receive the highlighted style');
assert(wizardCss.includes('.dh-nsa-step4-generate-action.is-selected'), 'the clicked action must have a persistent high-contrast selected state');
assert(wizardCss.includes('.dh-nsa-confirm-panel'), 'video confirmation must use a responsive product modal');
assert(wizardCss.includes('.dh-nsa-video-unit-list'), 'step 5 must visibly group real video generation units');
assert(wizardCss.includes('#dhNsaAdConfirmGenerate.is-next:not(:disabled)'), 'ready-to-compose must have a dedicated high-contrast primary action');
const bootstrap = read('public/js/new-story-ad/bootstrap.js');
assert(bootstrap.includes("const SCRIPT_VERSION = '20260731-reference-grounding-v2'"), 'lazy-loaded story-ad modules must use the same cache-busting version');
assert(bootstrap.indexOf('/video-boundaries.js') < bootstrap.indexOf('/task-store.js'), 'boundary policy must load before task restore and compose readiness');

const progressSave = require('../src/services/newStoryAd/taskProgressSaveService');
const autosaveSceneAssets = progressSave.mergeAutosaveSceneAssets([
  { id: 'space_park', scene_id: 'space_park', space_id: 'space_park', name: '公园', image_url: '/park-1.png', view_images: ['/park-1.png'] },
  { id: 'space_home', scene_id: 'space_home', space_id: 'space_home', name: '住宅', image_url: '/home-1.png', view_images: ['/home-1.png'] },
  { id: 'space_orphan', scene_id: 'space_orphan', space_id: 'space_orphan', name: '历史审计资产', image_url: '/old-1.png', audit_only: true, view_images: ['/old-1.png'] },
], [
  { id: 'space_park', scene_id: 'space_park', space_id: 'space_park', name: '公园（已编辑）', image_url: '/park-new.png', view_images: ['/park-new.png'] },
  { id: 'space_home', scene_id: 'space_home', space_id: 'space_home', name: '住宅', image_url: '/home-1.png', view_images: ['/home-1.png'] },
]);
assert.deepStrictEqual(autosaveSceneAssets.map(asset => asset.space_id), ['space_park', 'space_home', 'space_orphan'],
  'a projected scene autosave must preserve stored assets that are not visible in the current scene plan');
assert.strictEqual(autosaveSceneAssets[0].name, '公园（已编辑）',
  'the incoming visible scene must still replace the matching stable-id record');
assert.strictEqual(autosaveSceneAssets[2].audit_only, true,
  'historical or orphaned scene evidence must survive a normal progress autosave');
const failedComposeTask = { status: 'failed', stage: 'compose_failed', error: 'ffmpeg failed', error_code: 'UNKNOWN', support_id: 'support-1' };
assert.deepStrictEqual(progressSave.taskPatch(failedComposeTask, { progressStage: 'video_ready', changeScope: 'none' }), {},
  'an unchanged autosave must not rewrite terminal failure status while retaining its error fields');
const editedFailurePatch = progressSave.taskPatch(failedComposeTask, { progressStage: 'video_ready', changeScope: 'source' });
assert.strictEqual(editedFailurePatch.status, 'working');
assert.strictEqual(editedFailurePatch.error_code, '');
assert.strictEqual(editedFailurePatch.generation_progress, null);
const storage = require('../src/services/newStoryAd/storageService');
const storyAdService = require('../src/services/newStoryAd/storyAdService');
storyAdService.createTask({
  task_id: 'scene-assets-autosave-authority',
  brief: 'scene asset autosave authority regression',
  cast_mode: 'no_human',
}, { id: 'owner-1' });
storage.saveOutput('scene-assets-autosave-authority', 'scene_assets', autosaveSceneAssets);
storage.saveOutput('scene-assets-autosave-authority', 'context', {
  ...storage.getOutput('scene-assets-autosave-authority', 'context'),
  scene_assets: autosaveSceneAssets,
});
storyAdService.updateTaskRequest('scene-assets-autosave-authority', {
  brief: 'scene asset autosave authority regression',
  cast_mode: 'no_human',
  scene_assets: [
    { id: 'space_park', scene_id: 'space_park', space_id: 'space_park', name: '公园（再次编辑）', image_url: '/park-final.png', view_images: ['/park-final.png'] },
    { id: 'space_home', scene_id: 'space_home', space_id: 'space_home', name: '住宅', image_url: '/home-1.png', view_images: ['/home-1.png'] },
  ],
  change_scope: 'none',
  save_progress: true,
  progress_stage: 'scene_config_done',
  progress_snapshot: {
    scene_assets: [
      { id: 'space_park', scene_id: 'space_park', space_id: 'space_park', name: '公园（再次编辑）', image_url: '/park-final.png', view_images: ['/park-final.png'] },
      { id: 'space_home', scene_id: 'space_home', space_id: 'space_home', name: '住宅', image_url: '/home-1.png', view_images: ['/home-1.png'] },
    ],
  },
}, { id: 'owner-1' });
const persistedAutosaveSceneAssets = storage.getOutput('scene-assets-autosave-authority', 'scene_assets');
assert.deepStrictEqual(persistedAutosaveSceneAssets.map(asset => asset.space_id), ['space_park', 'space_home', 'space_orphan'],
  'a normal progress save must preserve the complete server-authoritative scene asset set');
assert.strictEqual(persistedAutosaveSceneAssets[0].name, '公园（已编辑）',
  'a browser progress snapshot must not overwrite a server-authoritative generated scene asset');
assert.deepStrictEqual(storage.getOutput('scene-assets-autosave-authority', 'context').scene_assets.map(asset => asset.scene_id || asset.space_id),
  ['space_park', 'space_home', 'space_orphan'],
  'the task context mirror must use the same server-authoritative scene assets');
storyAdService.createTask({ task_id: 'failed-compose-autosave', brief: '保持封装失败真实状态' }, { id: 'owner-1' });
storage.updateTask('failed-compose-autosave', { error: 'ffmpeg failed', error_code: 'UNKNOWN', support_id: 'support-1', generation_progress: { stage: 'compose', status: 'failed' } });
storage.updateTask('failed-compose-autosave', { status: 'failed', stage: 'compose_failed' });
storyAdService.updateTaskRequest('failed-compose-autosave', { brief: '保持封装失败真实状态', change_scope: 'none', save_progress: true, progress_stage: 'video_ready' }, { id: 'owner-1' });
const persistedFailedCompose = storage.getTask('failed-compose-autosave');
assert.strictEqual(persistedFailedCompose.status, 'failed');
assert.strictEqual(persistedFailedCompose.stage, 'compose_failed');
assert.strictEqual(persistedFailedCompose.error_code, 'UNKNOWN');
assert.strictEqual(persistedFailedCompose.support_id, 'support-1');
storyAdService.createTask({
  task_id: 'completed-autosave-authority',
  brief: 'completed autosave authority regression',
  cast_mode: 'no_human',
  voice_id: 'voice-original',
  subtitle: true,
  bgm_volume: 0.16,
}, { id: 'owner-1' });
storage.saveOutput('completed-autosave-authority', 'final_video', { video_url: '/outputs/final-authoritative.mp4' });
storage.updateTask('completed-autosave-authority', { status: 'done', stage: 'final_video_ready', saved_progress: false });
storyAdService.updateTaskRequest('completed-autosave-authority', {
  brief: 'completed autosave authority regression',
  cast_mode: 'no_human',
  voice_id: '',
  subtitle: false,
  bgm_volume: 0.3,
  change_scope: 'none',
  save_progress: true,
  progress_stage: 'video_ready',
  progress_snapshot: { final_video: null },
}, { id: 'owner-1' });
assert.strictEqual(storage.getOutput('completed-autosave-authority', 'final_video').video_url, '/outputs/final-authoritative.mp4',
  'an unconfirmed stale autosave must preserve the authoritative completed output');
assert.strictEqual(storage.getOutput('completed-autosave-authority', 'context').voice_id, 'voice-original');
assert.strictEqual(storage.getOutput('completed-autosave-authority', 'context').subtitle, true);
assert.strictEqual(storage.getTask('completed-autosave-authority').status, 'done');
assert.strictEqual(storage.getTask('completed-autosave-authority').stage, 'final_video_ready');
assert.strictEqual(storage.getTask('completed-autosave-authority').saved_progress, false);
assert.strictEqual(storyAdService.taskSummary(storage.getTask('completed-autosave-authority'), { detailed: false }).status, 'done',
  'summary-only task-center reads must recognize the persisted final output');
assert.strictEqual(storyAdService.listTaskSummaries({ userId: 'owner-1' }).tasks
  .find(task => task.id === 'completed-autosave-authority').status, 'done');
storyAdService.updateTaskRequest('completed-autosave-authority', {
  brief: 'completed autosave authority regression',
  cast_mode: 'no_human',
  subtitle: false,
  media_change_scope: 'compose',
  change_scope: 'none',
  save_progress: true,
  progress_stage: 'final_video_ready',
}, { id: 'owner-1' });
assert.strictEqual(storage.getOutput('completed-autosave-authority', 'final_video'), null,
  'an explicitly confirmed compose-setting edit must invalidate the old final output');
assert.strictEqual(storage.getTask('completed-autosave-authority').status, 'working');
assert.strictEqual(storage.getTask('completed-autosave-authority').stage, 'video_ready');
const missingFinalTask = storage.createTask({
  id: 'missing-final-must-not-complete',
  title: 'missing final regression',
  user_id: 'owner-1',
  status: 'done',
  stage: 'final_video_ready',
});
assert.strictEqual(storyAdService.taskSummary(missingFinalTask).status, 'working',
  'a terminal stage label without a persisted final output must not appear completed');
const route = read('src/routes/newStoryAd.js');
const mediaPipeline = read('src/services/newStoryAd/mediaPipelineService.js');
assert(route.includes("queueTaskStage(req, res, 'media'"), 'server must queue the complete media chain');
assert(mediaPipeline.includes('missing_only: true'), 'media retries must preserve completed video clips');
assert(mediaPipeline.includes('visual_only: true'), 'whole-ad media generation must keep paid video clips visual-only');
assert(mediaPipeline.indexOf('generateTtsStage') < mediaPipeline.indexOf('generateVideoStage'), 'selected TTS must be validated before paid video generation');
assert(route.includes("router.get('/tasks/:id/video/preflight'"), 'server must expose a zero-generation video preflight endpoint');
assert(route.includes('service.assertVideoPreflightConfirmation(req.params.id, body)'), 'server must reject unconfirmed or stale video plans before queueing');

const service = read('src/services/newStoryAd/storyAdService.js');
assert(!service.includes('persistProgressSnapshot(taskId, progressSnapshot)'),
  'normal autosave must not persist browser-provided generated outputs');
assert(service.includes('sceneAuthority.currentState({ storage, taskId, task, normalizeScenePlan })'),
  'autosave must resolve scene assets through the current authoritative lineage');
assert(!service.includes("storage.getOutput(taskId, 'scene_assets') || previousCtx.scene_assets"),
  'invalidated context scene assets must never be promoted back into the current lineage');
const ttsStart = service.indexOf('async function generateTtsStage');
const ttsBlock = service.slice(ttsStart, service.indexOf('/** 编译通用执行方案', ttsStart));
assert(ttsBlock.indexOf('assertVideoInputsReady') < 0, 'TTS must not be blocked by person/keyframe video QA that is unrelated to audio generation');
assert(ttsBlock.indexOf('ensureStoryboardForMedia') >= 0 && ttsBlock.indexOf('ensureStoryboardForMedia') < ttsBlock.indexOf('ttsAdapter.generateVoiceover'), 'TTS must still require the authoritative storyboard before a paid voice call');
assert(ttsBlock.includes('ttsProgress.create') && ttsBlock.includes('onCheckpoint: progress.checkpoint'), 'TTS must publish real checkpoint progress for the sound page');
assert(ttsBlock.indexOf('if (!includeVoiceover)') < ttsBlock.indexOf('ttsAdapter.generateVoiceover'), 'disabled voiceover must return before any paid TTS call');
const videoBlock = service.slice(service.indexOf('async function generateVideoStage'), service.indexOf('async function composeStage'));
assert(videoBlock.includes('ttsAudio = ttsContract.silentOutput()'), 'video generation must use empty audio tracks when voiceover is disabled');
assert(videoBlock.includes('videoLineage.buildShotLineage'), 'every clip must be linked to the current storyboard/person/product/scene/keyframe/audio contract');
assert(videoBlock.includes('videoRepairPolicy.buildRepairPlan'), 'QA failures must use bounded structured auto-repair');
assert(videoBlock.includes('sceneBlockService.buildSceneBlocks'), 'video stage must derive compatible generation units from current spatial contracts');
assert(videoBlock.includes('videoAdapter.generateSceneBlockVideos'), 'video generation must submit isolated generation units through the compatibility adapter');
assert(videoBlock.includes('const forceRegenerateAll = !zeroCostOnly'), 'server video stage must recognize confirmed high-quality regeneration while preserving zero-cost-only mode');
assert(videoBlock.includes('const maxRepairs = 0'), 'paid video generation must never retry automatically');
assert(videoBlock.includes('video_cost_authorization') || service.includes('video_cost_authorization'), 'paid video generation must persist RMB cost authorization');
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
assert(composeBlock.includes('const composeVoiceId = ttsContract.resolveVoiceId'), 'explicit no-voice selection must persist through compose');

const composeService = read('src/services/newStoryAd/composeService.js');
assert(composeService.includes('async function muxVoiceTrack'), 'step 5 must mix voice locally without regenerating visual clips');
assert(composeService.includes('ttsAudio = {}'), 'composition must accept the optional TTS tracks');

const contextBuilder = read('src/services/newStoryAd/contextBuilder.js');
assert(contextBuilder.includes('include_voiceover: includeVoiceover'), 'optional voiceover choice must persist with the task');

console.log('NEW_STORY_AD_COMPOSE_GATE_AUTOSAVE_TEST_OK');

function fakeButton(textContent = '') {
  const classes = new Set();
  const attributes = {};
  return {
    disabled: false,
    title: '',
    textContent,
    dataset: {},
    attributes,
    classList: {
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
      add(...names) { names.forEach(name => classes.add(name)); },
      remove(...names) { names.forEach(name => classes.delete(name)); },
      contains(name) { return classes.has(name); },
    },
    setAttribute(name, value) { attributes[name] = String(value); },
    removeAttribute(name) { delete attributes[name]; },
  };
}
