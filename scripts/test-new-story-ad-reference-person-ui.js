const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const html = read('public/digital-human.html');
const bootstrap = read('public/js/new-story-ad/bootstrap.js');
const assetLoader = read('public/js/new-story-ad/bootstrap-asset-loader.js');
const referenceUi = read('public/js/new-story-ad/reference-video-analysis.js');
const personInheritance = read('public/js/new-story-ad/person-reference-inheritance.js');
const personUi = read('public/js/new-story-ad/real-person-dossier.js');
const subjectAssist = read('public/js/new-story-ad/subject-profile-assist.js');
const generationFlow = read('public/js/new-story-ad/generation-flow.js');
const stateSync = read('public/js/new-story-ad/state-sync.js');
const contextBuilder = read('src/services/newStoryAd/contextBuilder.js');
const routes = read('src/routes/newStoryAd.js');
const personMediaRoutes = read('src/routes/newStoryAd/personMediaRoutes.js');
const mediaAdapter = read('src/services/newStoryAd/mediaAdapter.js');
const personService = read('src/services/newStoryAd/personDossierService.js');
const dossierComposite = read('src/services/newStoryAd/dossierCompositeService.js');

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
  'dhNsaPersonInference',
  'dhNsaPersonInferenceTitle',
  'dhNsaPersonInferenceDescription',
  'dhNsaPersonConstraintToggle',
  'dhNsaPersonConstraintEditor',
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
const personInheritanceIndex = bootstrap.indexOf('/js/new-story-ad/person-reference-inheritance.js');
assert.ok(personInheritanceIndex > 0 && referenceIndex > personInheritanceIndex, 'reference-analysis modules must keep their current dependency order');
assert.ok(!bootstrap.includes('/js/new-story-ad-legacy-ui.js'), 'current bootstrap must not load the retired client');
assert.ok(!bootstrap.includes('/js/new-story-ad/real-person-dossier.js') && bootstrap.includes('bootstrap-asset-loader.js')
  && bootstrap.includes('loadAssetModules') && assetLoader.includes('/js/new-story-ad/real-person-dossier.js'),
  'person production studio must be isolated behind the step-2 lazy loader');

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
assert.ok(referenceUi.includes('广告需求写入精简剧情摘要，人物和场景细节已分别写入各自档案'));
assert.ok(referenceUi.includes("const text = String(result?.generated_brief || '').trim()"));
assert.ok(!referenceUi.includes("const prefix = '【参考视频分析补充】"), 'structured reference details must not be appended into the main brief');
assert.ok(referenceUi.includes('map-scene-views'));
assert.ok(html.includes('id="dhNsaAdText" maxlength="5000"'), 'complete editable analysis brief must not be truncated to the former 1800-character limit');
assert.ok(html.includes('只向你展示人物、场景、剧情和内容描述'));
assert.ok(!html.includes('反推完整剧情、原创人物提示词、场景提示词、动作、机位与运镜'));
assert.ok(html.includes('id="dhNsaPersonConstraintEditor" hidden'));
assert.ok(html.includes('data-nsa-people-count-field hidden'));
assert.ok(html.includes('<span>人物构成</span>'));
assert.ok(!html.includes('<span>精确人数</span>'));
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
assert.ok(stateSync.includes('request.person_context?.spec_source'));
assert.ok(contextBuilder.includes('spec_source: personSpecSource'));
assert.ok(referenceUi.includes('function adoptReferenceAnalysis'));
assert.ok(referenceUi.includes('function referenceScenePlan'));
assert.ok(referenceUi.includes("source: 'reference_video_analysis'"));
assert.ok(referenceUi.includes('referenceScenePlan(result, analysis.id)'));
assert.ok(referenceUi.includes('function userVisibleReferenceText'));
assert.ok(referenceUi.includes('function referencePersonProjection'));
assert.ok(!referenceUi.includes("target.hidden = false;\n      target.replaceChildren();"), 'internal camera mapping must not be exposed in the requirement UI');
assert.ok(personInheritance.includes('personConstraintEditorOpen'));
assert.ok(personInheritance.includes('manualOverride'));
assert.ok(personInheritance.includes('reference_video_person_projection'));
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

assert.ok(routes.includes("router.post('/reference-video-analyses'"));
assert.ok(routes.includes("router.post('/reference-video-links'"));
assert.ok(routes.includes("router.post('/reference-video-upload-sessions'"));
assert.ok(routes.includes("chunks/:index'"));
assert.ok(routes.includes("router.post('/real-person-sources'"));
assert.ok(routes.includes("require('./newStoryAd/personMediaRoutes')"), '主路由必须注册拆分后的人物媒体路由');
assert.ok(personMediaRoutes.includes("router.post('/tasks/:id/person-action-assets'"), '人物动作素材入口必须由人物媒体子路由唯一承载');
assert.ok(routes.includes('MAX_FILE_BYTES'));

assert.ok(mediaAdapter.includes('requireReferences = false'));
assert.ok(mediaAdapter.includes('referenceImages,'));
assert.ok(mediaAdapter.includes('inputFidelity,'));
assert.ok(personService.includes('requireReferences: true'));
assert.ok(personService.includes("inputFidelity: 'high'"));
assert.ok(dossierComposite.includes("composition: 'local_sharp'"), '人物组合大图必须由拆分后的本地 Sharp 服务生成');
assert.ok(dossierComposite.includes('model_generated_text: false'), '组合大图不得再次调用模型生成文字');
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
vm.runInNewContext(personInheritance, browser, { filename: 'person-reference-inheritance.js' });
vm.runInNewContext(referenceUi, browser, { filename: 'reference-video-analysis.js' });
const referenceModule = browser.window.NewStoryAdReferenceVideoAnalysis;
const inheritanceModule = browser.window.NewStoryAdPersonReferenceInheritance;
assert.ok(referenceModule);
assert.ok(inheritanceModule);
const inheritedState = { castProfiles: [], personSpecSource: null };
const inheritedFields = { castMode: 'auto', expectedPeople: '', gender: 'auto', age: 'match_brief', origin: 'match_brief', roleName: '' };
let inheritedSaves = 0;
assert.strictEqual(inheritanceModule.applyReference({
  state: inheritedState,
  projection: {
    personSpec: { castMode: 'single', expectedPeople: '1', roleName: '产品展示者' },
    castProfiles: [{ id: 'reference_cast_1', roleName: '产品展示者' }],
  },
  analysisId: 'ref_people_1',
  getPersonSpec: key => inheritedFields[key] || '',
  writeAllFields: (selector, value) => {
    const key = selector.match(/="([^"]+)"/)?.[1];
    if (key) inheritedFields[key] = String(value);
  },
  renderAll: () => {},
  markSourceDirty: () => {},
  scheduleAutoSave: () => { inheritedSaves += 1; },
}), true);
assert.strictEqual(inheritedFields.castMode, 'single');
assert.strictEqual(inheritedFields.expectedPeople, '1');
assert.strictEqual(inheritedState.personSpecSource.kind, 'reference_video');
assert.strictEqual(inheritedSaves, 1);
inheritanceModule.markManual(inheritedState);
assert.strictEqual(inheritanceModule.applyReference({
  state: inheritedState,
  projection: { personSpec: { castMode: 'dual', expectedPeople: '2' }, castProfiles: [] },
  getPersonSpec: key => inheritedFields[key] || '',
  writeAllFields: () => { throw new Error('manual override must not be overwritten'); },
}), false);
assert.strictEqual(inheritedFields.castMode, 'single');
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
  character_prompts: [{
    role: '成年女性产品展示者',
    narrative_function: '触摸并展示墙板',
    age_range: '30-40岁',
    appearance_direction: '自然可信的商业展示者',
    wardrobe_direction: '原创绿色长裙',
    performance_style: '动作克制自然',
  }],
  scene_prompts: [{ location_type: '高端客厅金属墙板展示空间' }],
  camera_intents: [{ movement: 'slow_push_in' }],
});
assert.strictEqual(referenceModule.current().id, 'ref_restore_1');
assert.strictEqual(referenceModule.taskPayload().source_facts.product_or_service, '304不锈钢金属装饰墙板');
assert.strictEqual(referenceModule.taskPayload().analysis_quality.valid, true);
const visibleText = referenceModule.userVisibleReferenceText({
  summary: '镜头展示墙板，主机位保持固定',
  source_facts: {
    product_or_service: '304不锈钢金属装饰墙板',
    environment: '高端客厅',
    human_presence: true,
    human_actions: ['人物触摸墙板，主机位保持固定'],
  },
  story_outline: {
    logline: '人物展示金属墙板',
    opening: '开场镜头展示高端客厅',
    development: '镜头推进到金属纹理',
    resolution: '人物完成产品展示',
  },
  plot_beats: [{ purpose: '建立产品与空间关系' }],
  character_prompts: [{
    role: '成年女性产品展示者',
    age_range: '30-40岁',
    appearance_direction: '自然可信',
    wardrobe_direction: '原创绿色长裙',
    performance_style: '触摸墙板',
  }],
  scene_prompts: [{
    location_type: '高端客厅',
    layout_prompt: '墙板居中，沙发位于前景',
    material_light_prompt: '金属墙板与暖色灯光',
    interaction_prompt: '人物触摸墙板，主机位保持墙面尺度',
  }],
  camera_intents: [{ movement: 'slow_push_in' }],
});
['【人物】', '【场景】', '【剧情】', '【内容描述】'].forEach(section => assert.ok(visibleText.includes(section)));
assert.ok(!/(?:机位|运镜|景别|焦段)/.test(visibleText), 'user-visible reference text must hide internal camera instructions');
const personProjection = referenceModule.referencePersonProjection({
  source_facts: { human_presence: true },
  character_prompts: [{
    role: '成年女性产品展示者',
    age_range: '30-40岁',
    appearance_direction: '自然可信',
    wardrobe_direction: '原创绿色长裙',
    negative_prompt: '不复制原片真人身份',
  }],
});
assert.strictEqual(personProjection.personSpec.castMode, 'single');
assert.strictEqual(personProjection.personSpec.expectedPeople, '1');
assert.strictEqual(personProjection.personSpec.origin, 'match_brief');
assert.strictEqual(personProjection.castProfiles[0].roleName, '成年女性产品展示者');
const creativeInput = {
  value: '',
  maxLength: 4000,
  dispatchEvent: () => {},
};
browser.document.querySelector = selector => selector === '#dhNsaAdCreativeDirection' ? creativeInput : null;
let projectedPlan = null;
let dirtyCount = 0;
let autosaveCount = 0;
let projectedPeople = null;
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
  applyReferencePersonProjection: projection => {
    projectedPeople = projection;
    return true;
  },
};
assert.strictEqual(referenceModule.adoptReferenceAnalysis(referenceModule.current()), true);
assert.ok(creativeInput.value.includes('恢复后的完整故事'));
assert.strictEqual(projectedPlan.advertised_subject, '304不锈钢金属装饰墙板');
assert.strictEqual(projectedPlan.spaces[0].name, '高端客厅金属墙板展示空间');
assert.strictEqual(projectedPeople.personSpec.castMode, 'single');
assert.strictEqual(projectedPeople.castProfiles[0].roleName, '成年女性产品展示者');
assert.strictEqual(dirtyCount, 1);
assert.strictEqual(autosaveCount, 1);
assert.strictEqual(referenceModule.taskPayloadOrSaved({ analysis_id: 'stale' }).analysis_id, 'ref_restore_1');
const staleRequirement = {
  value: '【参考内容事实】广告主体：上一个白色跑车模型\n【完整剧情】旧剧情\n【人物提示词】无\n【场景提示词】红色沙发客厅',
  dispatchEvent: () => {},
};
browser.document.querySelector = selector => {
  if (selector === '#dhNsaAdText') return staleRequirement;
  if (selector === '#dhNsaAdCreativeDirection') return creativeInput;
  return null;
};
referenceModule.beginNewSource();
assert.strictEqual(staleRequirement.value, '', 'selecting a new reference must remove the prior analysis-generated brief');
assert.strictEqual(referenceModule.taskPayloadOrSaved({ analysis_id: 'stale_completed' }), null);
assert.match(
  referenceUi,
  /clearAutomaticRequirement\(\);\r?\n\s+window\.__newStoryAdLegacyUI\?\.markSourceDirty\?\.\('source'\);/,
  'removing a reference must clear auto-filled requirements and mark the source dirty on every line-ending style',
);
referenceModule.hydrate({
  analysis_id: 'ref_failed_current',
  status: 'failed',
  source: { original_name: '保时捷718.mp4', size_bytes: 82809251 },
  error: { code: 'REFERENCE_VIDEO_ANALYSIS_SEMANTIC_INVALID', retryable: true },
});
assert.strictEqual(
  referenceModule.taskPayloadOrSaved({ analysis_id: 'stale_completed', status: 'completed' }).analysis_id,
  'ref_failed_current',
  'a failed current reference must never fall back to a completed analysis from the previous source',
);
assert.strictEqual(referenceModule.taskPayloadOrSaved({ analysis_id: 'stale_completed' }).status, 'failed');
assert.match(referenceModule.generationBlockMessage(), /分析未完成/);
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
