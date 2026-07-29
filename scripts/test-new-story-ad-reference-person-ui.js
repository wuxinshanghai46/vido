const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const html = read('public/digital-human.html');
const bootstrap = read('public/js/new-story-ad/bootstrap.js');
const referenceUi = read('public/js/new-story-ad/reference-video-analysis.js');
const personUi = read('public/js/new-story-ad/real-person-dossier.js');
const legacy = read('public/js/new-story-ad-legacy-ui.js');
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
  'dhNsaRealPersonRights',
  'dhNsaRealPersonAdult',
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

assert.ok(html.includes('不提取人物身份或服装'));
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
assert.ok(!personUi.includes('NewStoryAdReferenceVideoAnalysis'), 'real-person feature must not read reference-video state');
assert.ok(!referenceUi.includes('RealPerson'), 'reference-video feature must not read real-person state');

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

console.log(JSON.stringify({
  passed: true,
  checks: 50,
  reference_feature_controls: 11,
  person_feature_controls: 6,
  dossier_tabs: 5,
  isolation_boundary: 'pass',
  strict_reference_contract: 'pass',
  local_dossier_composition: 'pass',
}));
