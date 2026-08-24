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
const detailCalls = [];
const originalGenerate = mediaAdapter.generateActorReference;
const originalGenerateImage = mediaAdapter.generateImage;
mediaAdapter.generateActorReference = async options => {
  calls.push(options);
  return originalGenerate(options);
};
mediaAdapter.generateImage = async options => {
  detailCalls.push(options);
  return originalGenerateImage(options);
};
const originalRenameSync = fs.renameSync;
let simulatedWindowsRenameLock = false;
fs.renameSync = (from, to) => {
  if (process.platform === 'win32' && !simulatedWindowsRenameLock && String(from).includes(`${path.sep}tasks${path.sep}`)) {
    simulatedWindowsRenameLock = true;
    const error = new Error('simulated Windows file lock');
    error.code = 'EPERM';
    throw error;
  }
  return originalRenameSync(from, to);
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
  const taskId = `person-dossier-test-task-${'long-id-segment-'.repeat(7)}`;
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
  if (process.platform === 'win32') assert.strictEqual(simulatedWindowsRenameLock, true, '必须覆盖 Windows 原子重命名瞬时文件锁');
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
  assert.strictEqual(dossierDone.dossier.base_actions.length, 6);
  assert.strictEqual(dossierDone.dossier.accessory_details.length, 1);
  assert.deepStrictEqual(dossierDone.dossier.accessory_details.map(item => item.key), ['shoes']);
  assert.ok(dossierDone.dossier.accessory_details.every(item => item.kind === 'wearable_accessory' && item.derived_locally === false && item.evidence_mode === 'isolated_catalog_generation' && item.model_call_count === 1));
  assert.strictEqual(dossierDone.dossier.accessory_evidence_trace.model_call_count, 1);
  const isolatedAccessoryCalls = detailCalls.filter(call => call.stage === 'new_story_ad.person_dossier_wearable_accessory');
  assert.strictEqual(isolatedAccessoryCalls.length, 1);
  assert.match(isolatedAccessoryCalls[0].prompt, /独立物件/);
  assert.match(isolatedAccessoryCalls[0].prompt, /不出现人物头像、身体、手、衣服/);
  assert.ok(dossierDone.dossier.accessory_details.every(item => fs.existsSync(mediaAdapter.assetPathFromName(item.filename))));
  assert.strictEqual(dossierDone.dossier.wardrobe_details.items.length, 4);
  assert.deepStrictEqual(dossierDone.dossier.wardrobe_details.items.map(item => item.key), [
    'outfit_silhouette', 'neckline_cut', 'fabric_drape', 'hem_and_footwear',
  ]);
  assert.ok(dossierDone.dossier.wardrobe_details.items.every(item => item.kind === 'wardrobe_detail' && item.derived_locally === false && item.detail_mode === 'generated_high_resolution' && item.model_call_count === 1));
  assert.ok(dossierDone.dossier.wardrobe_details.items.every(item => fs.existsSync(mediaAdapter.assetPathFromName(item.filename))));
  const dossierComposites = require('../src/services/newStoryAd/dossierCompositeService');
  const checkpointService = require('../src/services/newStoryAd/assetGenerationCheckpointService');
  const auditReferenceFilename = 'provider-audit-wardrobe-reference.png';
  await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#334455' } })
    .png().toFile(mediaAdapter.assetPathFromName(auditReferenceFilename));
  const auditCheckpoints = new Map();
  let auditCalls = 0;
  const recoveredWardrobe = await dossierComposites.generateWardrobeDetails({
    taskId: 'provider-audit-wardrobe-recovery',
    assetId: 'actor-audit',
    atomicAssets: [{ id: 'body-front-audit', kind: 'body', key: 'front', image_url: mediaAdapter.publicAssetUrl(auditReferenceFilename) }],
    definitions: [{ key: 'neckline_cut', label: '领口与肩部剪裁', aspectRatio: '4:3', referenceKinds: [['body', 'front']] }],
    loadCheckpoint: async key => auditCheckpoints.get(key) || null,
    saveCheckpoint: async (key, value) => auditCheckpoints.set(key, value),
  }, {
    checkpointService,
    mediaAdapter: {
      ...mediaAdapter,
      generateImage: async () => {
        auditCalls += 1;
        const error = new Error('provider rejected wardrobe detail');
        error.code = 'PROVIDER_CONTENT_AUDIT';
        throw error;
      },
    },
  });
  assert.strictEqual(auditCalls, 1, 'the provider audit path must stop after the first rejected request');
  assert.strictEqual(recoveredWardrobe.length, 1);
  assert.strictEqual(recoveredWardrobe[0].derived_locally, true);
  assert.strictEqual(recoveredWardrobe[0].detail_mode, 'local_reference_crop_after_provider_audit');
  assert.strictEqual(recoveredWardrobe[0].recovery_reason, 'PROVIDER_CONTENT_AUDIT');
  assert.ok(fs.existsSync(mediaAdapter.assetPathFromName(recoveredWardrobe[0].filename)));
  assert.strictEqual([...auditCheckpoints.values()][0].status, 'completed');
  assert.strictEqual(dossierDone.dossier.atomic_assets.length, 20);
  assert.strictEqual(dossierDone.dossier.category_atlases.length, 4);
  assert.strictEqual(dossierDone.dossier.quality_status, 'native_masters_ready');
  assert.ok(dossierDone.dossier.native_masters.face.image_url);
  assert.ok(dossierDone.dossier.native_masters.body.image_url);
  assert.ok(dossierDone.dossier.native_masters.face.native_resolution && !dossierDone.dossier.native_masters.face.locally_split);
  assert.strictEqual(dossierDone.dossier.generation_summary.planned_provider_calls, 6);
  assert.strictEqual(dossierDone.dossier.generation_summary.provider_calls_this_run, 6);
  assert.strictEqual(dossierDone.dossier.generation_summary.native_master_count, 2);
  assert.strictEqual(dossierDone.dossier.sheet.composition, 'local_sharp');
  assert.strictEqual(dossierDone.dossier.sheet.model_generated_text, false);
  assert.strictEqual(dossierDone.dossier.sheet.layout, 'elegant_character_archive_v5');
  assert.strictEqual(dossierDone.dossier.sheet.visual_theme, 'elegant_double_border_botanical_archive');
  assert.strictEqual(dossierDone.dossier.sheet.width, 1800);
  assert.strictEqual(dossierDone.dossier.sheet.height, 2400);
  assert.deepStrictEqual(dossierDone.dossier.sheet.sections, [
    'basic_info', 'turnaround', 'expressions', 'wardrobe', 'accessories',
    'details', 'keywords', 'actions', 'role_intro', 'usage_constraints',
  ]);
  assert.strictEqual(dossierDone.dossier.sheet.detail_crop_count, 0);
  assert.strictEqual(dossierDone.dossier.sheet.detail_crop_source, 'hair_makeup_only; wearable_objects_generated_as_isolated_catalog');
  assert.strictEqual(dossierDone.dossier.sheet.generated_wardrobe_count, 4);
  assert.strictEqual(dossierDone.dossier.sheet.generated_accessory_count, 1);
  assert.strictEqual(dossierDone.dossier.sheet.isolated_accessory_count, 1);
  assert.ok(dossierDone.dossier.sheet.generated_detail_count >= 3);
  assert.strictEqual(dossierDone.dossier.reference_board.composition, 'local_sharp_reference_compiler');
  assert.strictEqual(dossierDone.dossier.reference_board.provider_reference_slot_cost, 1);
  assert.ok(fs.existsSync(mediaAdapter.assetPathFromName(dossierDone.dossier.reference_board.filename)));
  assert.strictEqual(dossierDone.dossier.qa.pass, true);
  assert.ok(dossierDone.dossier.qa.source_identity_score >= 0.86);
  assert.ok(dossierDone.dossier.qa.cross_view_identity_score >= 0.84);
  assert.ok(dossierDone.dossier.qa.wardrobe_consistency_score >= 0.86);
  assert.ok(dossierDone.dossier.qa.action_physics_score >= 0.8);
  assert.ok(fs.existsSync(mediaAdapter.assetPathFromName(dossierDone.dossier.sheet.filename)));
  const dossierStageCounts = calls.reduce((counts, call) => {
    if (![
      'new_story_ad.person_dossier_atlas',
      'new_story_ad.person_dossier_expression',
      'new_story_ad.person_dossier_action',
    ].includes(call.stage)) return counts;
    counts[call.stage] = (counts[call.stage] || 0) + 1;
    return counts;
  }, {});
  const dossierCalls = calls.filter(call => dossierStageCounts[call.stage]);
  assert.deepStrictEqual(dossierStageCounts, {
    'new_story_ad.person_dossier_atlas': 2,
    'new_story_ad.person_dossier_expression': 1,
    'new_story_ad.person_dossier_action': 1,
  }, 'four dossier atlases must remain routed through their three managed model stages');
  assert.strictEqual(
    new Set(dossierCalls.map(call => mediaAdapter.safeFilename(call.filename))).size,
    4,
    'maximum-length task and asset ids must retain four unique concurrent atlas filenames',
  );
  assert.strictEqual(
    new Set(dossierDone.dossier.atomic_assets.map(item => item.filename)).size,
    20,
    'maximum-length task and asset ids must retain 20 unique locally split filenames',
  );

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

  assert.strictEqual(calls.length, 9, '2 outfit candidates + 4 dossier atlases + 2 native masters + 1 lazy action triptych');
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
    checks: 54,
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
    mediaAdapter.generateImage = originalGenerateImage;
    const resolved = path.resolve(tempRoot);
    if (process.env.KEEP_PERSON_DOSSIER_FIXTURE === '1') console.log(`PERSON_DOSSIER_FIXTURE=${resolved}`);
    else if (resolved.startsWith(path.resolve(os.tmpdir()))) fs.rmSync(resolved, { recursive: true, force: true });
  });
