const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-person-dossier-test-'));
process.env.OUTPUT_DIR = tempRoot;
process.env.NEW_STORY_AD_MOCK_LLM = '1';
process.env.NEW_STORY_AD_MOCK_IMAGE = '1';

const mediaAdapter = require('../src/services/newStoryAd/mediaAdapter');
const calls = [];
const originalGenerate = mediaAdapter.generateActorReference;
mediaAdapter.generateActorReference = async options => {
  calls.push(options);
  return originalGenerate(options);
};
const service = require('../src/services/newStoryAd/personDossierService');
const subjectReferences = require('../src/services/newStoryAd/subjectReferenceService');

async function waitFor(taskId, user, kind, statuses, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const production = service.getProduction(taskId, user);
    if (statuses.includes(production[`${kind}_job`]?.status)) return production;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${kind}`);
}

async function makeUpload(name, color) {
  const filePath = path.join(tempRoot, name);
  await sharp({
    create: { width: 900, height: 1200, channels: 3, background: color },
  }).png().toFile(filePath);
  return {
    path: filePath,
    originalname: name,
    mimetype: 'image/png',
    size: fs.statSync(filePath).size,
  };
}

async function main() {
  const user = { id: 'person-dossier-test-user' };
  const taskId = 'person-dossier-test-task';
  const identity = await service.createSource({
    file: await makeUpload('identity.png', '#ddaa88'),
    body: { kind: 'identity', rights_confirmed: 'true', adult_confirmed: 'true' },
    user,
  });
  const outfit = await service.createSource({
    file: await makeUpload('outfit.png', '#335577'),
    body: { kind: 'outfit', rights_confirmed: 'true', adult_confirmed: 'true' },
    user,
  });
  assert.strictEqual(identity.immutable, true);
  assert.strictEqual(identity.public_library_visible, false);
  assert.strictEqual(identity.local_path, undefined);

  const started = service.startCandidates({
    taskId,
    user,
    sourceId: identity.id,
    outfitSourceId: outfit.id,
    mode: 'outfit_reference',
    wardrobe: 'navy jacket, white sneakers',
  });
  assert.strictEqual(started.accepted, true);
  const duplicateStart = service.startCandidates({
    taskId,
    user,
    sourceId: identity.id,
    outfitSourceId: outfit.id,
    mode: 'outfit_reference',
    wardrobe: 'navy jacket, white sneakers',
  });
  assert.strictEqual(duplicateStart.duplicate, true);
  const candidatesDone = await waitFor(taskId, user, 'candidate', ['completed', 'failed']);
  assert.strictEqual(candidatesDone.candidate_job.status, 'completed', JSON.stringify(candidatesDone.candidate_job.error || {}));
  assert.strictEqual(candidatesDone.candidates.length, 2);
  assert.ok(candidatesDone.candidates.every(item => item.strict_reference_required && item.input_fidelity === 'high'));
  assert.ok(candidatesDone.candidates.every(item => item.qa.source_identity_score >= 0.86));
  assert.strictEqual(candidatesDone.invalidations[0].reason, 'wardrobe_changed');
  assert.deepStrictEqual(candidatesDone.invalidations[0].preserves, ['scene_assets', 'script_text']);

  const approved = service.approveCandidate({
    taskId,
    candidateId: candidatesDone.candidates[0].id,
    user,
  });
  assert.strictEqual(approved.approved_anchor.immutable_for_person_revision, true);

  const dossierStarted = service.startDossier({ taskId, user });
  assert.strictEqual(dossierStarted.accepted, true);
  const dossierDone = await waitFor(taskId, user, 'dossier', ['completed', 'failed']);
  assert.strictEqual(dossierDone.dossier_job.status, 'completed', JSON.stringify(dossierDone.dossier_job.error || {}));
  assert.strictEqual(dossierDone.dossier.body_views.length, 4);
  assert.strictEqual(dossierDone.dossier.identity_views.length, 4);
  assert.strictEqual(dossierDone.dossier.expressions.length, 6);
  assert.strictEqual(dossierDone.dossier.base_actions.length, 3);
  assert.strictEqual(dossierDone.dossier.atomic_assets.length, 17);
  assert.strictEqual(dossierDone.dossier.category_atlases.length, 4);
  assert.strictEqual(dossierDone.dossier.generation_summary.planned_provider_calls, 4);
  assert.strictEqual(dossierDone.dossier.generation_summary.provider_calls_this_run, 4);
  assert.strictEqual(dossierDone.dossier.sheet.composition, 'local_sharp');
  assert.strictEqual(dossierDone.dossier.sheet.model_generated_text, false);
  assert.strictEqual(dossierDone.dossier.reference_board.composition, 'local_sharp_reference_compiler');
  assert.strictEqual(dossierDone.dossier.reference_board.provider_reference_slot_cost, 1);
  assert.ok(fs.existsSync(mediaAdapter.assetPathFromName(dossierDone.dossier.reference_board.filename)));
  assert.strictEqual(dossierDone.dossier.qa.pass, true);
  assert.ok(dossierDone.dossier.qa.source_identity_score >= 0.86);
  assert.ok(dossierDone.dossier.qa.cross_view_identity_score >= 0.84);
  assert.ok(dossierDone.dossier.qa.wardrobe_consistency_score >= 0.86);
  assert.ok(dossierDone.dossier.qa.action_physics_score >= 0.8);
  assert.ok(fs.existsSync(mediaAdapter.assetPathFromName(dossierDone.dossier.sheet.filename)));

  const dossierApproved = service.approveDossier({ taskId, user });
  assert.strictEqual(dossierApproved.dossier.status, 'approved');
  assert.strictEqual(dossierApproved.dossier.production_usable_actor, true);

  const actionStarted = service.startActionAssets({
    taskId,
    user,
    storyboard: [{
      shot_index: 0,
      action_start: '自然站立',
      action: '右手拿起产品并展示',
      action_end: '产品停在胸前',
      dominant_hand: 'right',
      prop_contact: '右手完整握持产品',
      screen_direction: 'left_to_right',
      eyeline: '产品',
      expression_change: '专注到认可',
      scene_zone: 'interaction_zone',
    }],
  });
  assert.strictEqual(actionStarted.accepted, true);
  const actionDone = await waitFor(taskId, user, 'action', ['completed', 'failed']);
  assert.strictEqual(actionDone.action_job.status, 'completed', JSON.stringify(actionDone.action_job.error || {}));
  assert.strictEqual(actionDone.action_assets.length, 1);
  assert.strictEqual(actionDone.action_assets[0].contract.dominant_hand, 'right');
  assert.ok(actionDone.action_assets[0].contract.previous_frame_dependency);
  const compiledRefs = subjectReferences.keyframeReferenceUrls({
    person_asset: {
      image_url: dossierDone.dossier.reference_board.image_url,
      view_images: [{
        key: 'action_shot_0',
        image_url: actionDone.action_assets[0].image_url,
      }],
    },
    assets: [{ type: 'product', image_url: '/product.png' }],
  }, {
    includePerson: true,
    includeProduct: true,
    sceneReference: '/scene.png',
    previousFrame: { image_url: '/previous.png' },
    shot: { shot_index: 0 },
  });
  assert.ok(compiledRefs.length <= 4);
  assert.ok(compiledRefs.includes(actionDone.action_assets[0].image_url));
  assert.ok(compiledRefs.includes(dossierDone.dossier.reference_board.image_url));

  assert.strictEqual(calls.length, 7, '2 outfit candidates + 4 dossier atlases + 1 lazy action triptych');
  assert.ok(calls.every(call => call.requireReferences === true), 'all derived person generations must require references');
  assert.ok(calls.every(call => call.inputFidelity === 'high'), 'all derived person generations must use high fidelity');
  assert.ok(calls.every(call => Array.isArray(call.referenceImages) && call.referenceImages.length >= 1));
  assert.strictEqual(
    fs.readdirSync(mediaAdapter.ASSET_DIR).some(name => name.startsWith('identity_bridge_') || name.startsWith('outfit_bridge_')),
    false,
    'temporary public provider bridges must be deleted',
  );

  const contracts = service.deriveActionContracts([{ action: '拿起产品' }]);
  assert.ok(contracts[0].start_pose && contracts[0].end_pose && contracts[0].required_scene_zone);

  console.log(JSON.stringify({
    passed: true,
    checks: 50,
    strict_reference_calls: calls.length,
    outfit_candidates: candidatesDone.candidates.length,
    atomic_assets: dossierDone.dossier.atomic_assets.length,
    action_triptychs: actionDone.action_assets.length,
    public_identity_source: false,
    model_generated_dossier_text: false,
  }));
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    mediaAdapter.generateActorReference = originalGenerate;
    const resolved = path.resolve(tempRoot);
    if (resolved.startsWith(path.resolve(os.tmpdir()))) fs.rmSync(resolved, { recursive: true, force: true });
  });
