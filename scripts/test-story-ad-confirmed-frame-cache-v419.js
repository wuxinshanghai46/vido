'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const frameRows = Array.from({ length: 7 }, (_, i) => ({ shot_index: i + 1, image_url: `/frame-${i + 1}.png` }));
function setup(id, request) {
  const sandbox = { request, createStoryboardLiveRefresh: () => async () => {}, console, setTimeout, clearTimeout };
  vm.createContext(sandbox);
  vm.runInContext(source('public/story-ad/store/projectBundleStore.js') + '\n' + source('public/story-ad/store/projectStore.js') + '\nglobalThis.store = createProjectStore();', sandbox);
  const store = sandbox.store;
  store.state.bundle = { project: { id }, revisions: { content: 21 }, brief: { shot_design_confirmed: false }, storyboard: { shots: frameRows, image_gate: { ready: true } }, generation: { approved_frames: [] } };
  store.state.bundleSections = ['all'];
  return store;
}
async function main() {
  const id = 'confirmation-' + 'a'.repeat(160);
  let confirmed = false, mediaReads = 0;
  const store = setup(id, async (url, options = {}) => {
    if (options.method === 'PUT') { confirmed = options.body.shot_design_confirmed; return { task: { id, content_revision: 21 }, context: { shot_design_confirmed: confirmed } }; }
    const media = /media|all/.test(decodeURIComponent(url));
    if (media) mediaReads++;
    return { bundle: { project: { id }, revisions: { content: 21 }, brief: { shot_design_confirmed: confirmed }, ...(media ? { generation: { approved_frames: confirmed ? frameRows : [] } } : {}) } };
  });
  await store.updateRequest({ shot_design_confirmed: true }, { refreshSections: 'summary' });
  await store.prefetchBundle(id, 'media');
  assert.equal(store.state.bundle.generation.approved_frames.length, 7, 'confirmation at unchanged content revision must refresh video frames');
  assert.equal(mediaReads, 1);
  await store.updateRequest({ shot_design_confirmed: false }, { refreshSections: 'summary' });
  await store.prefetchBundle(id, 'media');
  assert.equal(store.state.bundle.generation.approved_frames.length, 0, 'revoking confirmation must invalidate approved frames');
  const raceId = 'race-' + 'b'.repeat(160), old = deferred(); let readCount = 0;
  const raced = setup(raceId, async (url, options = {}) => {
    if (options.method === 'PUT') return { task: { id: raceId, content_revision: 21 }, context: { shot_design_confirmed: true } };
    if (decodeURIComponent(url).endsWith('sections=all') && ++readCount === 1) return old.promise;
    return { bundle: { project: { id: raceId }, revisions: { content: 21 }, brief: { shot_design_confirmed: true }, generation: { approved_frames: frameRows } } };
  });
  raced.state.bundleSections = ['summary'];
  const stale = raced.prefetchBundle(raceId, 'all');
  await raced.updateRequest({ shot_design_confirmed: true });
  await raced.prefetchBundle(raceId, 'all');
  old.resolve({ bundle: { project: { id: raceId }, revisions: { content: 21 }, brief: { shot_design_confirmed: false }, generation: { approved_frames: [] } } });
  await stale;
  assert.equal(raced.state.bundle.brief.shot_design_confirmed, true, 'late pre-confirmation prefetch cannot overwrite confirmation');
  assert.equal(raced.state.bundle.generation.approved_frames.length, 7);
  const ui = { bindVideoGenerationFeedback: () => () => {}, emptyState: x => JSON.stringify(x), escapeHtml: String, mediaPreview: () => '', bindMoreMedia: () => {}, moreMediaButton: () => '', loadGenerationModelPicker: async () => ({ html: '' }), bindGenerationModelPicker: () => () => '' };
  vm.createContext(ui); vm.runInContext(source('public/story-ad/views/finalView.js') + '\nglobalThis.render = mount;', ui);
  const host = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null };
  await ui.render(host, { bundle: { project: { id }, storyboard: { shots: frameRows, image_gate: { ready: true } }, brief: { shot_design_confirmed: false }, generation: { approved_frames: [] } }, store: {} });
  assert.match(host.innerHTML, /返回分镜页确认/);
  assert.doesNotMatch(host.innerHTML, /还缺少 7 张|请返回分镜页逐镜生成或重绘/);
  console.log(JSON.stringify({ passed: true, same_revision_confirmation: true, revocation: true, late_prefetch_race: true, long_task_ids: true, confirmation_copy: true, model_calls: 0 }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
