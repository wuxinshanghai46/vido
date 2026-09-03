'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.OUTPUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-v413-'));
process.env.DB_ENABLED = '0';
const storage = require('../src/services/newStoryAd/storageService');
const flow = require('../src/services/storyAdWorkspace/storyFlowContractService');
const alignment = require('../src/services/newStoryAd/storyboardFlowConsistencyService');
const images = require('../src/services/storyAdWorkspace/storyboardSketchService');
const visual = require('../src/services/newStoryAd/storyboardVisualQaService');
const subject = require('../src/services/newStoryAd/storyboardSubjectQaService');

async function main() {
  const people = [{ character_id: 'person-1', name: '演员甲', look_ids: [] }];
  assert.deepEqual(flow.peopleForBeat({ subject_type: 'product_only', action: '镜头移动，展示纹理样片', spoken_line: '演员甲的选择' }, people), []);
  assert.deepEqual(flow.peopleForBeat({ subject_type: 'product_only', action: '演员甲驻足观察' }, people), ['person-1']);
  const scenes = [{ scene_id: 'home', name: '客厅', story_purpose: '纹理材料展示' }, { scene_id: 'expo', name: '展台', story_purpose: '纹理与颜色展示' }];
  assert.equal(flow.plannedSceneForBeat({ sceneConfig: {} }, { scene: '展示墙前', action: '伸手触摸纹理' }, 1, scenes), '');
  assert.equal(flow.plannedSceneForBeat({ sceneConfig: { spaces: [{ id: 'home', covered_beat_ids: ['2'] }] } }, { scene: '展示墙前' }, 1, scenes), 'home');
  const contract = { contract_fingerprint: 'flow-413', people, units: [{ beat_id: 'b1', scene_id: 'home', character_ids: ['person-1'] }, { beat_id: 'b2', scene_id: 'expo', character_ids: [] }] };
  const shots = alignment.rebaseWhenPresent([{ index: 1, source_beat_id: 'b1' }, { index: 2, source_beat_id: 'b2', characters: [{ name: '演员甲' }], expected_people: 1 }], contract).shots;
  assert.deepEqual(shots.map(s => s.expected_people), [1, 0]);
  assert.equal(shots[1].no_person, true);
  assert.equal(alignment.inspect(shots, contract).ok, true);
  assert.equal(alignment.inspect([{ ...shots[0], expected_people: 0 }, shots[1]], contract).ok, false);
  const id = 'long-task-' + 'a'.repeat(150);
  const ctx = { cast_mode: 'no_human', scene_setup_confirmed: true, scene_assets: [] };
  storage.createTask({ id, status: 'draft', request: ctx });
  storage.saveOutput(id, 'context', ctx);
  storage.saveOutput(id, 'blueprint', { beats: [1, 2].map(n => ({ id: `b${n}`, title: `镜头${n}` })) });
  flow.confirmSystem(id, flow.draft(id).units, {});
  storage.saveOutput(id, 'storyboard_table', [1, 2].map(n => ({ index: n, expected_people: 0, characters: [], title: `镜头${n}`, action: '物体静止' })));
  storage.saveOutput(id, 'storyboard_meta', { status: 'ready' });
  storage.saveOutput(id, 'keyframe_contracts', [{ shot_index: 1 }, { shot_index: 2 }]);
  const names = [];
  const deps = {
    mediaAdapter: { generateImage: async ({ filename }) => { names.push(filename); await new Promise(r => setTimeout(r, 10)); return { image_url: `/generated/${filename}.png` }; } },
    compositionService: { assertSingleFrame: async () => {} },
    subjectQaService: { assert: async () => ({ pass: true, policy_version: subject.QA_POLICY_VERSION }) },
    visualQaService: { review: async ({ shot }) => ({ pass: shot.index === 1, policy_version: visual.POLICY_VERSION, identity_fingerprint: visual.identityFingerprint(ctx) }) },
  };
  await assert.rejects(images.generateSketchBatch(id, { confirmed: true }, deps), e => e.code === 'STORYBOARD_VISUAL_QA_REJECTED');
  assert.equal(names.length, 2);
  assert.equal(new Set(names).size, 2);
  assert(names.every(n => n.length < 96));
  assert.equal(storage.getOutput(id, 'storyboard_images').length, 1);
  const candidates = storage.listOutputs(id).filter(o => o.kind.startsWith('storyboard_image_candidate:'));
  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates.map(c => c.payload.status).sort(), ['rejected', 'verified']);
  assert.equal(storage.getOutput(id, 'storyboard_image_batch').succeeded, 1);
  assert.equal(storage.getOutput(id, 'storyboard_image_batch').processed, 2);
  const gate = require('../src/services/storyAdWorkspace/storyboardImageConfirmationGateService');
  assert.equal(gate.inspect(id).ready, false);
  const service = require('../src/services/newStoryAd/storyAdService');
  const ttsAdapter = require('../src/services/newStoryAd/ttsAdapter');
  const originalGenerate = ttsAdapter.generateVoiceover;
  let ttsCalls = 0;
  ttsAdapter.generateVoiceover = async () => { ttsCalls += 1; throw new Error('unexpected paid TTS'); };
  try { await assert.rejects(service.generateTtsStage(id, { include_voiceover: true, voice_id: 'fixture-voice' }), e => e.code === 'AUDIO_EDIT_FINAL_REQUIRED'); }
  finally { ttsAdapter.generateVoiceover = originalGenerate; }
  assert.equal(ttsCalls, 0);
  await images.generateSketch(id, 2, { confirmed: true, review_only: true }, { ...deps, visualQaService: { review: async () => ({ pass: true, policy_version: visual.POLICY_VERSION, identity_fingerprint: visual.identityFingerprint(ctx) }) } });
  assert.equal(names.length, 2, '重新质检不能再调用图片模型');
  assert.equal(storage.getOutput(id, 'storyboard_images').length, 2);
  const repair = require('../src/services/newStoryAd/storyboardAuthorityRepairService');
  storage.saveOutput(id, 'storyboard_table', storage.getOutput(id, 'storyboard_table').map((shot, i) => ({ ...shot, source_beat_id: `b${i + 1}`, shot_id: `shot-${i + 1}`, voiceover: `旁白${i + 1}` })));
  storage.saveOutput(id, 'tts_audio', { tracks: [{ shot_id: 'shot-1', text: '旁白1', audio_url: '/existing-1.mp3' }, { shot_id: 'shot-2', text: '旁白2', audio_url: '/existing-2.mp3' }] });
  const audio = storage.canonicalFingerprint(storage.getOutput(id, 'tts_audio'));
  storage.saveOutput(id, 'scene_assets', [{ scene_id: 'home', name: '客厅', image_url: '/home.png' }]);
  storage.saveOutput(id, 'scene_config', { spaces: [{ id: 'home', name: '客厅' }] });
  const bindings = [{ beat_id: 'b1', scene_id: 'home' }, { beat_id: 'b2', scene_id: 'home' }];
  const planned = repair.plan(id, bindings);
  assert.throws(() => repair.apply(id, bindings, 'stale'), /任务状态已改变/);
  const repaired = repair.apply(id, bindings, planned.sourceFingerprint);
  assert.equal(repaired.audio_unchanged, true);
  assert.equal(storage.canonicalFingerprint(storage.getOutput(id, 'tts_audio')), audio);
  assert.equal(repaired.images_preserved, 2);
  assert.equal(repaired.provider_calls, 0);
  console.log(JSON.stringify({ passed: true, model_calls: 0, generated_candidates: 2, published_after_review: 2, long_id_and_parallel: true, repair_audio_preserved: true, tts_blocked_before_payment: true }));
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => fs.rmSync(process.env.OUTPUT_DIR, { recursive: true, force: true }));
