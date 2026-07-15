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
['public/js/new-story-ad/step-navigation.js', 'public/js/new-story-ad/button-state.js', 'public/js/new-story-ad/task-store.js', 'public/js/new-story-ad/task-persistence.js']
  .forEach(file => vm.runInContext(read(file), context, { filename: file }));

const shots = Array.from({ length: 6 }, (_, index) => ({ index: index + 1 }));
const accepted = () => ({ image_url: '/frame.png', current_generation_status: 'accepted', qa_policy_version: 2, qa: { pass: true } });
const invalidState = {
  shots,
  keyframes: [accepted(), accepted(), { ...accepted(), regeneration_error: 'QA failed' }, { ...accepted(), regeneration_error: 'QA failed' }, accepted(), accepted()],
  storyboardStatus: { ready: true },
};
const validState = { shots, keyframes: shots.map(accepted), storyboardStatus: { ready: true } };
assert.strictEqual(context.window.NewStoryAdStepNavigation.composeReadiness({ state: invalidState }).ready, false);
assert.strictEqual(context.window.NewStoryAdStepNavigation.canOpenStep(5, { state: invalidState }), false);
assert.strictEqual(context.window.NewStoryAdStepNavigation.composeReadiness({ state: validState }).ready, true);
assert.strictEqual(context.window.NewStoryAdStepNavigation.canOpenStep(5, { state: validState }), true);

const buttons = {
  '#dhNsaAdText': { value: '足够长的剧情广告需求' },
  '#dhNsaAdGoCompose': fakeButton(),
  '#dhNsaAdConfirmGenerate': fakeButton(),
};
context.window.NewStoryAdButtonState.updateLocks({
  state: invalidState,
  within: selector => buttons[selector] || null,
  getPersonSpec: () => '',
});
assert.strictEqual(buttons['#dhNsaAdGoCompose'].disabled, true);
assert.strictEqual(buttons['#dhNsaAdConfirmGenerate'].disabled, true);

const outputs = { storyboard_table: shots, keyframes: invalidState.keyframes, tts_audio: { tracks: [] } };
assert.strictEqual(context.window.NewStoryAdTaskStore.resumeStep({ stage: 'video_failed' }, outputs, { ready: true }), 4);
assert.strictEqual(context.window.NewStoryAdTaskStore.resumeStep({ stage: 'tts_ready' }, { ...outputs, keyframes: validState.keyframes }, { ready: true }), 5);
assert.strictEqual(context.window.NewStoryAdTaskPersistence.progressStageForState({ currentStep: 5, shots }), 'keyframe_contract_ready');
assert.strictEqual(context.window.NewStoryAdTaskPersistence.progressStageForState({ currentStep: 5, shots, keyframes: validState.keyframes }), 'keyframes_ready');

const html = read('public/digital-human.html');
assert(!/id="dhNsaAdSaveDraftStep[2345]"/.test(html), 'manual progress save buttons must be removed');
assert(html.includes('data-nsa-autosave-status'), 'autosave status must be visible');
assert(html.includes('id="dhNsaAdComposeGate"'), 'persistent compose gate must exist');

const service = read('src/services/newStoryAd/storyAdService.js');
const ttsBlock = service.slice(service.indexOf('async function generateTtsStage'), service.indexOf('async function generateVideoStage'));
assert(ttsBlock.indexOf('assertVideoInputsReady') >= 0, 'TTS must enforce media QA preflight');
assert(ttsBlock.indexOf('assertVideoInputsReady') < ttsBlock.indexOf('ttsAdapter.generateVoiceover'), 'QA preflight must run before paid TTS');

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
