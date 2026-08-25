const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const personProviderAssets = require('../src/services/newStoryAd/personProviderAssetLifecycleService');
const productAssets = require('../src/services/newStoryAd/productAssetGenerationService');
const videoAdapter = require('../src/services/newStoryAd/videoAdapter');
const deyunaiService = require('../src/services/deyunaiService');
const storage = require('../src/services/newStoryAd/storageService');

function qa() {
  return {
    pass: true,
    source_identity_score: 0.95,
    cross_view_identity_score: 0.93,
    adult_age_consistency_score: 0.94,
    wardrobe_consistency_score: 0.92,
    body_proportion_score: 0.91,
    reasons: [],
  };
}

function atomic(kind, key) {
  return { id: `${kind}_${key}`, kind, key, image_url: `/asset/${kind}_${key}.png` };
}

async function main() {
  const production = {
    source_identity_id: 'source_abc',
    approved_anchor: { image_url: '/asset/anchor.png' },
    person_profile: { displayName: '测试人物', roleName: '母亲', age: '30-35岁', appearanceText: '自然亲和', wardrobeText: '浅色家居服' },
    dossier: {
      id: 'dossier_1', revision: 2, schema_version: 3, status: 'approved', qa: qa(),
      body_views: ['front', 'three_quarter', 'side', 'back'].map(key => atomic('body', key)),
      identity_views: ['face_front', 'face_three_quarter', 'face_profile', 'hair_back'].map(key => atomic('identity', key)),
      expressions: ['neutral', 'natural_smile', 'focused', 'doubtful', 'surprised', 'relaxed_approved'].map(key => atomic('expression', key)),
      base_actions: ['neutral_stand', 'natural_walk', 'sit_and_rise', 'reach_and_hold', 'present_product', 'interact_with_prop'].map(key => atomic('action', key)),
      atomic_assets: [], category_atlases: [], sheet: { image_url: '/asset/dossier.png' }, reference_board: { image_url: '/asset/board.png' },
    },
  };
  production.dossier.atomic_assets = [...production.dossier.body_views, ...production.dossier.identity_views, ...production.dossier.expressions, ...production.dossier.base_actions];
  const approved = personProviderAssets.buildApprovedRealPersonAsset(production);
  assert.equal(approved.actor_id, 'real_person_source_abc');
  assert.equal(approved.person_contract.status, 'verified');
  assert.equal(approved.view_images.length, 4);
  assert.equal(approved.base_actions.length, 6);
  assert.equal(approved.real_person_reference, true);

  const fakeRows = [];
  const upserted = personProviderAssets.upsertActorAsset({
    db: { updateAsset(id, row) { fakeRows.push({ id, row }); } },
    userId: 'user-1', actor: approved, patch: { deyunai_asset_id: 'provider-real-1' },
    ensureActor(userId, actor) { return { ...actor, user_id: userId }; },
  });
  assert.equal(upserted.user_id, 'user-1');
  assert.equal(upserted.metadata.deyunai_asset_id, 'provider-real-1');
  assert.equal(fakeRows.length, 1);

  const originalEnsure = deyunaiService.ensurePersonImageAsset;
  const originalGetOutput = storage.getOutput;
  const originalSaveOutput = storage.saveOutput;
  const originalUpdateTask = storage.updateTask;
  const saved = {};
  const uploads = [];
  const members = [1, 2].map(index => ({
    id: `actor_asset_${index}`, actor_asset_id: `actor_asset_${index}`, actor_id: `actor_${index}`,
    image_url: `/asset/person_${index}.png`, view_images: [{ key: 'front', url: `/asset/person_${index}.png` }],
    person_contract: { status: 'verified', cross_view_qa: { pass: true, identity_score: .95, age_score: .95, wardrobe_score: .95, body_score: .95, mismatch_reasons: [] } },
  }));
  const bundleContract = {
    contract_type: 'cast_bundle', status: 'verified', expected_people: 2,
    cross_view_qa: { pass: true, member_count_pass: true }, member_contracts: members.map(item => item.person_contract),
  };
  const context = { cast_mode: 'dual', expected_people: 2, person_asset: { id: 'cast', actor_id: 'cast', cast_assets: members, person_contract: bundleContract }, person_contract: bundleContract };
  try {
    deyunaiService.ensurePersonImageAsset = async input => {
      uploads.push(input);
      return { asset_id: `provider_${uploads.length}`, asset_url: `https://provider/${uploads.length}`, status: 'Active', group_id: `group_${uploads.length}`, group_type: input.groupType, source_url: input.sourceUrl };
    };
    storage.getOutput = (taskId, kind) => saved[kind] || (kind === 'context' ? context : null);
    storage.saveOutput = (taskId, kind, value) => { saved[kind] = value; return value; };
    storage.updateTask = (taskId, patch) => { saved.task = patch; return patch; };
    const provider = await videoAdapter.prepareDeyunaiPersonAsset({ taskId: 'task-provider-multi', ctx: context, options: { asset_base_url: 'https://vido.example.com' } });
    assert.equal(uploads.length, 2, '每个演员都必须独立上传厂商人物资产');
    assert.deepEqual(provider.asset_ids, ['provider_1', 'provider_2']);
    assert.equal(saved.context.person_asset.cast_assets[1].deyunai_asset_id, 'provider_2');
  } finally {
    deyunaiService.ensurePersonImageAsset = originalEnsure;
    storage.getOutput = originalGetOutput;
    storage.saveOutput = originalSaveOutput;
    storage.updateTask = originalUpdateTask;
  }

  const fakeStore = {
    task: { id: 'product-task', request: { product_subject: '桌面服务机器人', revisions: {} }, generation_started_at: new Date().toISOString() },
    outputs: {}, progress: [],
    getTask() { return this.task; }, getOutput(id, kind) { return this.outputs[kind] || (kind === 'context' ? this.task.request : null); },
    saveOutput(id, kind, value) { this.outputs[kind] = value; },
    updateTask(id, patch) { this.task = { ...this.task, ...patch }; if (patch.generation_progress) this.progress.push(patch.generation_progress); },
  };
  const fakeMedia = {
    async generateImage(input) { await input.onProgress?.({ percent: 45, phase: 'provider_running' }); return { image_url: '/asset/product_atlas.png', provider_used: 'mock' }; },
    async splitReferenceSheet({ viewKeys }) { return viewKeys.map(key => ({ key, image_url: `/asset/product_${key}.png` })); },
  };
  const product = await productAssets.generateProductAsset('product-task', {}, { generationId: 'gen-product' }, {
    storage: fakeStore, mediaAdapter: fakeMedia,
    revisionService: { invalidateOutputs() { return []; } },
    productIdentity: { buildProductContract(ctx, options) { return { status: 'unverified', product_revision: options.revision, reference_images: [ctx.product_asset.image_url] }; } },
  });
  assert.equal(product.product_asset.view_images.length, 4);
  assert.equal(fakeStore.task.generation_progress.percent, 100);
  assert.equal(fakeStore.task.generation_progress.status, 'completed');

  const ui = read('public/story-ad/views/assetCenterView.js');
  const planningUi = read('public/story-ad/views/assetCenterPlanningDetails.js');
  const personFormUi = read('public/story-ad/views/assetCenterPersonForm.js');
  const personSourceUi = read('public/story-ad/views/assetCenterPersonSources.js');
  const dossierShowcase = read('public/story-ad/views/personDossierShowcase.js');
  const sharedUi = read('public/story-ad/components/ui.js');
  const mediaLightboxUi = read('public/story-ad/views/mediaLightbox.js');
  const workspaceCss = read('public/story-ad/workspace.css');
  ['data-generate-subject-assets', 'data-select-person', 'data-upload-real-person'].forEach(marker => {
    const source = marker === 'data-generate-subject-assets' ? `${ui}\n${read('public/story-ad/views/assetCenterStageView.js')}` : ui;
    assert(source.includes(marker), `缺少人物来源入口 ${marker}`);
  });
  assert(!ui.includes("['props', '道具']"), '道具不得作为顶级资产分组');
  assert(!ui.includes("mediaSection('可复用原子素材'"), '不得展示底层可复用原子素材');
  assert(personFormUi.includes('data-person-edit') && personFormUi.includes('name="generation_prompt"'), '人物点击后必须直接打开完整提示词编辑器');
  assert(!planningUi.includes('data-owned-prop-form'), '随身道具不得保留提示词之外的第二套表单');
  assert(personSourceUi.includes('rights_confirmed') && personSourceUi.includes('adult_confirmed'), '真人上传必须携带授权与成年确认');
  assert(ui.includes("store.runStage('person-plan'") && ui.includes("store.runStage('product-assets'") && ui.includes("store.runStage('scene-assets'"), '人物必须先走可轮询的真实规划任务，商品和场景保持独立后台任务');
  ['基本信息', '形象展示', '表情记录', '服装拆解', '配饰与鞋履单品', '人物细节', '动作档案', '角色介绍'].forEach(label => assert(dossierShowcase.includes(label), `参考版人物档案缺少 ${label}`));
  assert(dossierShowcase.includes('2K 独立细节图') && dossierShowcase.includes('历史裁切图 · 建议重生成高清档案'), '人物档案必须区分高清独立细节和历史裁切图');
  assert(planningUi.includes('personDossierShowcase(item)') && planningUi.includes('bindMediaLightbox(drawer)'), '完整档案必须采用参考版布局并绑定图片灯箱');
  assert(sharedUi.includes('data-media-zoom-url') && mediaLightboxUi.includes("event.key === 'ArrowRight'"), '单图必须支持点击放大和键盘切换');
  assert(workspaceCss.includes('.character-dossier-primary') && workspaceCss.includes('.media-lightbox'), '人物档案和大图灯箱样式必须存在');

  console.log(JSON.stringify({ passed: true, real_person_views: approved.view_images.length, action_categories: approved.base_actions.length, provider_assets: uploads.length, product_views: product.product_asset.view_images.length, reference_layout: true, image_lightbox: true }));
}

main().catch(error => { console.error(error); process.exit(1); });
