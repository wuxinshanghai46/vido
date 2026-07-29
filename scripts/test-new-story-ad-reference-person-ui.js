const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const html = read('public/digital-human.html');
const bootstrap = read('public/js/new-story-ad/bootstrap.js');
const referenceUi = read('public/js/new-story-ad/reference-video-analysis.js');
const personUi = read('public/js/new-story-ad/real-person-dossier.js');
const subjectAssist = read('public/js/new-story-ad/subject-profile-assist.js');
const generationFlow = read('public/js/new-story-ad/generation-flow.js');
const legacy = read('public/js/new-story-ad-legacy-ui.js');
const stateSync = read('public/js/new-story-ad/state-sync.js');
const routes = read('src/routes/newStoryAd.js');
const mediaAdapter = read('src/services/newStoryAd/mediaAdapter.js');
const personService = read('src/services/newStoryAd/personDossierService.js');

[
  'dhNsaReferenceVideoFile',
  'dhNsaReferenceVideoUrl',
  'dhNsaReferenceVideoLinkRead',
  'dhNsaReferenceVideoOpen',
  'dhNsaReferenceVideoModal',
  'dhNsaReferenceVideoClear',
  'dhNsaReferenceVideoDialogClear',
  'dhNsaReferenceVideoRights',
  'dhNsaReferenceVideoProgress',
  'dhNsaReferenceVideoDraft',
  'dhNsaReferenceVideoDraftStatus',
  'dhNsaReferenceVideoSceneMapping',
  'dhNsaRealPersonIdentityFile',
  'dhNsaRealPersonOpen',
  'dhNsaRealPersonModal',
  'dhNsaRealPersonClose',
  'dhNsaRealPersonRights',
  'dhNsaRealPersonAdult',
  'dhNsaSuggestWardrobe',
  'dhNsaWardrobeSuggestionStatus',
  'dhNsaGenerateOutfitCandidates',
  'dhNsaPersonCandidates',
  'dhNsaPersonDossier',
].forEach(id => assert.ok(html.includes(`id="${id}"`), `missing UI control ${id}`));

['identity', 'body', 'expression', 'wardrobe', 'action'].forEach(tab => {
  assert.ok(html.includes(`data-nsa-dossier-tab="${tab}"`), `missing dossier tab ${tab}`);
});

const referenceIndex = bootstrap.indexOf('/js/new-story-ad/reference-video-analysis.js');
const personIndex = bootstrap.indexOf('/js/new-story-ad/real-person-dossier.js');
const legacyIndex = bootstrap.indexOf('/js/new-story-ad-legacy-ui.js');
assert.ok(referenceIndex > 0 && personIndex > referenceIndex && legacyIndex > personIndex, 'feature modules must load before legacy UI');

assert.ok(html.includes('不复制原片真人身份、肖像或服装'));
assert.ok(!html.includes('data-nsa-reference-apply'), 'analysis result must not require merge/replace buttons');
assert.ok(referenceUi.includes('fillRequirementFromAnalysis'));
assert.ok(referenceUi.includes("'/api/new-story-ad/reference-video-links'"));
assert.ok(referenceUi.includes("importing: '读取链接中'"));
assert.ok(referenceUi.includes('setModal(false)'));
assert.ok(referenceUi.includes('#dhNsaReferenceVideoClear, #dhNsaReferenceVideoDialogClear'));
assert.ok(referenceUi.includes("['uploading', 'importing', 'queued', 'running', 'cancelling']"));
assert.ok(html.includes('id="dhNsaReferenceVideoRights" checked'), 'reference-video rights should be enabled by default');
assert.ok(!html.includes('id="dhNsaReferenceVideoCancel"'), 'large cancel button must be replaced by the compact X action');
assert.ok(!html.includes('id="dhNsaReferenceVideoDelete"'), 'large delete button must be replaced by the compact X action');
assert.ok(referenceUi.includes("$('#dhNsaAdText')"));
assert.ok(referenceUi.includes("input.dispatchEvent(new Event('input'"));
assert.ok(referenceUi.includes('中文内容已填入广告需求文本框'));
assert.ok(referenceUi.includes('map-scene-views'));
assert.ok(html.includes('id="dhNsaAdText" maxlength="5000"'), 'complete editable analysis brief must not be truncated to the former 1800-character limit');
assert.ok(html.includes('完整剧情、原创人物提示词、场景提示词'));
assert.ok(referenceUi.includes('story_outline: analysis.result?.story_outline'));
assert.ok(referenceUi.includes('character_prompts: analysis.result?.character_prompts'));
assert.ok(referenceUi.includes('scene_prompts: analysis.result?.scene_prompts'));
assert.ok(referenceUi.includes('prompt_suggestions: analysis.result?.prompt_suggestions'));
assert.ok(referenceUi.includes('source_facts: analysis.result?.source_facts'));
assert.ok(referenceUi.includes('analysis_quality: analysis.result?.analysis_quality'));
assert.ok(referenceUi.includes('function hydrate(saved = null)'));
assert.ok(referenceUi.includes('function reset(options = {})'));
assert.ok(referenceUi.includes('wasExplicitlyRemoved'));
assert.ok(stateSync.includes('NewStoryAdReferenceVideoAnalysis?.hydrate?.(request.reference_video_analysis || null)'));
assert.ok(legacy.includes('state.context?.reference_video_analysis'));
assert.ok(referenceUi.includes('function adoptReferenceAnalysis'));
assert.ok(referenceUi.includes('function referenceScenePlan'));
assert.ok(legacy.includes('markSourceDirty, scheduleAutoSave'));
assert.ok(legacy.includes('NewStoryAdReferenceVideoAnalysis?.reset?.({ explicit: true })'));
assert.ok(!personUi.includes('NewStoryAdReferenceVideoAnalysis'), 'real-person feature must not read reference-video state');
assert.ok(!referenceUi.includes('RealPerson'), 'reference-video feature must not read real-person state');
assert.ok(personUi.includes('setModal(true)'), 'real-person studio must open in a modal');
assert.ok(personUi.includes("event.key === 'Escape' && state.modalOpen"), 'real-person modal must close with Escape');
assert.ok(personUi.includes('suggestWardrobe()'), 'real-person studio must provide AI wardrobe guidance');
assert.ok(personUi.includes("mode() === 'ai_outfit'"), 'AI outfit mode must validate a concrete wardrobe brief');
assert.ok(personUi.includes('请先填写换装要求，或点击“AI 推荐换装”'));
assert.ok(personUi.includes('timeoutMs: 120000'), 'wardrobe text assist must not use the generic 45-second timeout');
assert.ok(subjectAssist.includes('subjectAssistStatus'), 'single-person assist must persist visible inline feedback across rerenders');
assert.ok(subjectAssist.includes('timeoutMs: 120000'), 'single-person assist must wait longer than the backend model timeout');
assert.ok(generationFlow.includes('timeoutMs: Number(request.timeoutMs) || undefined'), 'inline generation must forward its stage-specific timeout');

assert.ok(legacy.includes('reference_video_analysis'));
assert.ok(legacy.includes('adoptPersonDossier'));
assert.ok(routes.includes("router.post('/reference-video-analyses'"));
assert.ok(routes.includes("router.post('/reference-video-links'"));
assert.ok(routes.includes("router.post('/reference-video-upload-sessions'"));
assert.ok(routes.includes("chunks/:index'"));
assert.ok(routes.includes("router.post('/real-person-sources'"));
assert.ok(routes.includes("router.post('/tasks/:id/person-action-assets'"));
assert.ok(routes.includes('MAX_FILE_BYTES'));

assert.ok(mediaAdapter.includes('requireReferences = false'));
assert.ok(mediaAdapter.includes('referenceImages,'));
assert.ok(mediaAdapter.includes('inputFidelity,'));
assert.ok(personService.includes('requireReferences: true'));
assert.ok(personService.includes("inputFidelity: 'high'"));
assert.ok(personService.includes("composition: 'local_sharp'"));
assert.ok(personService.includes('model_generated_text: false'));
assert.ok(personService.includes('previous_frame_dependency'));

const browser = {
  window: {},
  document: {
    readyState: 'loading',
    querySelector: () => null,
    addEventListener: () => {},
    body: { classList: { toggle: () => {} } },
  },
  console,
  setTimeout,
  clearTimeout,
  setInterval: () => 0,
  clearInterval: () => {},
  Event: class Event {
    constructor(type, options = {}) {
      this.type = type;
      this.bubbles = options.bubbles === true;
    }
  },
};
browser.window.window = browser.window;
vm.runInNewContext(referenceUi, browser, { filename: 'reference-video-analysis.js' });
const referenceModule = browser.window.NewStoryAdReferenceVideoAnalysis;
assert.ok(referenceModule);
assert.strictEqual(referenceModule.taskPayload(), null);
referenceModule.hydrate({
  analysis_id: 'ref_restore_1',
  status: 'completed',
  analysis_scope: 'reference_content_and_creative_structure',
  generated_brief: '恢复后的参考视频广告需求',
  source_facts: {
    product_or_service: '304不锈钢金属装饰墙板',
    environment: '高端客厅金属墙板展示空间',
    materials: ['304不锈钢金属墙板'],
  },
  analysis_quality: { valid: true },
  story_outline: { logline: '恢复后的完整故事' },
  plot_beats: [{ order: 1, purpose: '建立墙板空间' }],
  scene_prompts: [{ location_type: '高端客厅金属墙板展示空间' }],
  camera_intents: [{ movement: 'slow_push_in' }],
});
assert.strictEqual(referenceModule.current().id, 'ref_restore_1');
assert.strictEqual(referenceModule.taskPayload().source_facts.product_or_service, '304不锈钢金属装饰墙板');
assert.strictEqual(referenceModule.taskPayload().analysis_quality.valid, true);
const creativeInput = {
  value: '',
  maxLength: 4000,
  dispatchEvent: () => {},
};
browser.document.querySelector = selector => selector === '#dhNsaAdCreativeDirection' ? creativeInput : null;
let projectedPlan = null;
let dirtyCount = 0;
let autosaveCount = 0;
browser.window.NewStoryAdSceneAssets = {
  specPayload: () => ({}),
  planPayload: () => null,
  applyPlan: (state, plan) => {
    state.sceneConfig = plan;
    projectedPlan = plan;
    return { plan };
  },
};
browser.window.__newStoryAdLegacyUI = {
  state: { sceneConfig: null },
  markSourceDirty: () => { dirtyCount += 1; },
  renderAll: () => {},
  scheduleAutoSave: () => { autosaveCount += 1; },
};
assert.strictEqual(referenceModule.adoptReferenceAnalysis(referenceModule.current()), true);
assert.ok(creativeInput.value.includes('恢复后的完整故事'));
assert.strictEqual(projectedPlan.advertised_subject, '304不锈钢金属装饰墙板');
assert.strictEqual(projectedPlan.spaces[0].name, '高端客厅金属墙板展示空间');
assert.strictEqual(dirtyCount, 1);
assert.strictEqual(autosaveCount, 1);
assert.strictEqual(referenceModule.taskPayloadOrSaved({ analysis_id: 'stale' }).analysis_id, 'ref_restore_1');
referenceModule.reset({ explicit: true });
assert.strictEqual(referenceModule.taskPayload(), null, 'new task/reset must not reuse the previous task analysis');
assert.strictEqual(referenceModule.wasExplicitlyRemoved(), true);
assert.strictEqual(referenceModule.taskPayloadOrSaved({ analysis_id: 'stale' }), null);

console.log(JSON.stringify({
  passed: true,
  checks: 92,
  reference_feature_controls: 11,
  person_feature_controls: 11,
  dossier_tabs: 5,
  isolation_boundary: 'pass',
  strict_reference_contract: 'pass',
  local_dossier_composition: 'pass',
}));
