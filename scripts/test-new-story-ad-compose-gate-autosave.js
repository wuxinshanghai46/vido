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
assert(html.includes('data-nsa-cast-mode-quick="no_human"'), 'no-human mode must be directly visible instead of hidden only in a select');
assert(html.includes('配音（选填）'), 'voiceover must be visibly optional');
assert(html.includes('背景音乐（选填）'), 'BGM must be visibly optional');
assert(html.includes('id="dhNsaAdBgmClear"'), 'BGM must provide an explicit no-music action');

const ui = read('public/js/new-story-ad-legacy-ui.js');
assert(ui.includes('data-nsa-candidate-override'), 'rejected keyframes must offer an explicit human override action');
assert(ui.includes('/manual-accept'), 'human override must call the auditable manual acceptance endpoint');
assert(ui.includes("person_spec: noHuman ? { castMode: 'no_human' } : person"), 'no-human payload must suppress stale person details');
assert(ui.includes('assetPayloadList({ includePerson: !noHuman })'), 'no-human payload must exclude person reference assets');
assert(ui.includes('不使用配音（选填）'), 'voice picker must immediately offer a no-voiceover choice');
assert(ui.includes("api(`/api/avatar/voice-list${query}`)"), 'normal voice loading must reuse browser/server cache');
assert(ui.includes("sessionStorage.setItem('vido_nsa_voice_catalog'"), 'voice catalog must be cached for later opens');
assert(ui.includes('include_voiceover: !!state.voiceId'), 'media payload must explicitly disable voiceover when no voice is selected');
assert(ui.includes("if (state.voiceId && !await runStage('tts', button))"), 'legacy media chain must skip TTS without a selected voice');
assert(ui.includes('正在恢复任务</b>'), 'compose view must show a restore state instead of a false missing-storyboard warning');
assert(ui.includes('任务内容读取失败'), 'restore failures must be visible instead of leaving an empty editor');

const generationFlow = read('public/js/new-story-ad/generation-flow.js');
assert(generationFlow.includes("return runStage('media', ctx)"), 'primary media chain must be owned by one resumable server job');
const route = read('src/routes/newStoryAd.js');
assert(route.includes("queueTaskStage(req, res, 'media'"), 'server must queue the complete media chain');
assert(route.includes("missing_only: true"), 'media retries must preserve completed video clips');

const service = read('src/services/newStoryAd/storyAdService.js');
const ttsBlock = service.slice(service.indexOf('async function generateTtsStage'), service.indexOf('async function generateVideoStage'));
assert(ttsBlock.indexOf('assertVideoInputsReady') >= 0, 'TTS must enforce media QA preflight');
assert(ttsBlock.indexOf('assertVideoInputsReady') < ttsBlock.indexOf('ttsAdapter.generateVoiceover'), 'QA preflight must run before paid TTS');
assert(ttsBlock.indexOf('if (!includeVoiceover)') < ttsBlock.indexOf('ttsAdapter.generateVoiceover'), 'disabled voiceover must return before any paid TTS call');
const videoBlock = service.slice(service.indexOf('async function generateVideoStage'), service.indexOf('async function composeStage'));
assert(videoBlock.includes('ttsAudio = silentTtsOutput()'), 'video generation must use empty audio tracks when voiceover is disabled');
const composeBlock = service.slice(service.indexOf('async function composeStage'), service.indexOf('async function runFull'));
assert(composeBlock.includes('hasBgmAssetOption'), 'explicit no-BGM selection must not restore an older BGM from task context');
assert(composeBlock.includes('const composeVoiceId = resolveTtsVoiceId'), 'explicit no-voice selection must persist through compose');

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
