const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const composites = require('../src/services/newStoryAd/dossierCompositeService');
const pipeline = require('../src/services/pipelineModelService');
const sketches = require('../src/services/storyAdWorkspace/storyboardSketchService');
const storage = require('../src/services/newStoryAd/storageService');
const mediaAdapter = require('../src/services/newStoryAd/mediaAdapter');
const sharp = require('sharp');

function loadBrowserModule(file, exposed) {
  const source = read(file).replace(/^import\s+.*?;\s*$/gm, '').replace(/\bexport\s+/g, '');
  const sandbox = { document: {}, globalThis: {} };
  vm.runInNewContext(`${source}\nglobalThis.__tested = { ${exposed.join(', ')} };`, sandbox, { filename: file });
  return sandbox.globalThis.__tested;
}

async function main() {
  const explicit = composites.explicitAccessoryDefinitions({ wardrobeText: '珍珠耳环，银色高跟鞋；不佩戴项链和腕表' });
  assert.deepEqual(explicit.map(item => item.key), ['ear_accessories', 'shoes'], '否定描述中的项链/腕表不得被误判为实际穿戴');

  const atomicAssets = [
    { id: 'front', kind: 'body', key: 'front', image_url: '/asset/front.png' },
    { id: 'three', kind: 'body', key: 'three_quarter', image_url: '/asset/three.png' },
    { id: 'face', kind: 'identity', key: 'face_front', image_url: '/asset/face.png' },
    { id: 'profile', kind: 'identity', key: 'face_profile', image_url: '/asset/profile.png' },
  ];
  const calls = [];
  const checkpoints = {};
  const fakeMedia = {
    async generateImage(input) {
      calls.push(input);
      return { image_url: `/generated/${calls.length}.png`, provider_used: 'deyunai/gpt-image-2' };
    },
  };
  const common = {
    taskId: 'detail-task', assetId: 'person-1', atomicAssets, revision: 2,
    profile: { wardrobeText: '珍珠耳环，银色高跟鞋；不佩戴项链和腕表' },
    loadCheckpoint: async key => checkpoints[key],
    saveCheckpoint: async (key, value) => { checkpoints[key] = value; },
  };
  const wearable = await composites.generateWearableDetails(common, { mediaAdapter: fakeMedia });
  const wardrobe = await composites.generateWardrobeDetails(common, { mediaAdapter: fakeMedia });
  assert.equal(wearable.length, 2);
  assert.equal(wardrobe.length, 4);
  assert.equal(calls.length, 6);
  assert(calls.every(call => call.stage.startsWith('new_story_ad.person_dossier_') && call.resolution === '2K' && call.requireReferences === true));
  const wearableCalls = calls.filter(call => call.stage === 'new_story_ad.person_dossier_wearable_accessory');
  const wardrobeCalls = calls.filter(call => call.stage === 'new_story_ad.person_dossier_wardrobe_detail');
  assert.equal(wearableCalls.length, 2);
  assert.equal(wardrobeCalls.length, 4);
  assert(wearableCalls.every(call => /独立物件/.test(call.prompt) && /不出现人物头像、身体、手、衣服/.test(call.prompt)));
  assert(wearableCalls.every(call => call.singleAttempt === false && /纯净暖白背景/.test(call.auditSafePrompt)), '配饰审核拒绝必须允许备用图片路由使用安全提示继续生成');
  assert(wardrobeCalls.every(call => /独立白底陈列|白底平铺|材质细节板|分别独立陈列/.test(call.prompt) && /不出现人物/.test(call.prompt)));
  await composites.generateWearableDetails(common, { mediaAdapter: fakeMedia });
  await composites.generateWardrobeDetails(common, { mediaAdapter: fakeMedia });
  assert.equal(calls.length, 6, '检查点恢复不得重复产生图片调用');

  const auditedReferenceName = `audited-wearable-${process.pid}.png`;
  const auditedReferencePath = mediaAdapter.assetPathFromName(auditedReferenceName);
  await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#334455' } }).png().toFile(auditedReferencePath);
  const auditedCheckpoints = {};
  try {
    const recoveredWearable = await composites.generateWearableDetails({
      taskId: 'audited-wearable-recovery', assetId: 'person-audit', revision: 1,
      atomicAssets: [{ id: 'front-audit', kind: 'body', key: 'front', image_url: mediaAdapter.publicAssetUrl(auditedReferenceName) }],
      profile: { wardrobeText: '银色高跟鞋' },
      loadCheckpoint: async key => auditedCheckpoints[key],
      saveCheckpoint: async (key, value) => { auditedCheckpoints[key] = value; },
    }, {
      mediaAdapter: {
        ...mediaAdapter,
        async generateImage() {
          throw Object.assign(new Error('provider attempts exhausted after timeout and audit'), {
            code: 'IMAGE_ATTEMPTS_EXHAUSTED',
            attempts: [
              { code: 'TIMEOUT_OR_NETWORK', billing_state: 'not_billed', provider_task_id: '' },
              { code: 'PROVIDER_CONTENT_AUDIT', billing_state: 'not_billed', provider_task_id: '' },
            ],
          });
        },
      },
    });
    assert.equal(recoveredWearable.length, 1);
    assert.equal(recoveredWearable[0].derived_locally, true);
    assert.equal(recoveredWearable[0].evidence_mode, 'authoritative_person_crop');
    assert.equal(recoveredWearable[0].recovery_reason, 'PROVIDER_CONTENT_AUDIT');
  } finally {
    fs.rmSync(auditedReferencePath, { force: true });
  }

  assert.equal(pipeline.getStageDefaults('new_story_ad.storyboard_sketch')[0].model_id, 'gpt-image-2');
  assert(pipeline.NEW_STORY_AD_IMAGE_STAGE_IDS.has('new_story_ad.storyboard_sketch'));

  const ui = loadBrowserModule('public/story-ad/components/ui.js', ['generationProgressPanel', 'mediaPreview']);
  const lightbox = loadBrowserModule('public/story-ad/views/mediaLightbox.js', ['nextLightboxIndex', 'preloadLightboxUrl']);
  const preview = ui.mediaPreview({ thumbnail_url: '/thumb/a.jpg', image_url: '/full/a.png' }, { zoomable: true, zoomGroup: 'g' });
  assert.match(preview, /data-media-zoom-url="\/full\/a\.png"/);
  assert.match(preview, /src="\/thumb\/a\.jpg\?thumb=/);
  assert.equal(lightbox.nextLightboxIndex(1, 1, 4), 2);
  assert.equal(lightbox.nextLightboxIndex(3, 1, 4), 0);
  assert.equal(lightbox.nextLightboxIndex(0, -1, 4), 3);
  const loadedLightboxUrl = await lightbox.preloadLightboxUrl('/thumb/next.png', () => {
    const candidate = {};
    Object.defineProperty(candidate, 'src', { set(value) { this.loaded = value; this.onload(); } });
    return candidate;
  });
  assert.equal(loadedLightboxUrl, '/thumb/next.png', '灯箱必须先确认下一张预览已加载，再同步替换主图与字幕');
  const failedProgress = ui.generationProgressPanel({
    project: { status: 'failed', stage: 'storyboard_failed', active_generation_id: '', error: '审核失败' },
    generation: { progress: { stage: 'storyboard', status: 'failed', phase: 'review_failed', completed: 4, total: 4, percent: 100, current_index: 4, message: '审核失败' } },
  });
  assert.match(failedProgress, /文字分镜质量审核未通过|自动审核未通过，生成已经停止/);
  assert.match(failedProgress, /已停止/);
  assert.doesNotMatch(failedProgress, /正在生成第 4 镜/);
  assert.doesNotMatch(failedProgress, /project-progress-track/);
  const css = read('public/story-ad/workspace.css');
  assert.match(css, /\.media-lightbox-nav\.is-prev\{left:22px\}/);
  assert.match(css, /\.media-lightbox-strip/);
  assert.match(css, /\.media-lightbox\.is-switching figure>img\{opacity:0\}/, '切图期间不得继续显示上一张图片造成字幕与图片错位');

  const view = read('public/story-ad/views/storyboardView.js');
  assert.match(view, /批量重生成文字分镜/);
  assert.match(view, /批量生成全部缺失线稿/);
  assert.match(view, /批量重生成全部线稿/);
  assert.match(view, /regenerate_all: regenerateAll/);
  assert.doesNotMatch(view, /<span>线稿<\/span><span>剧情与动作/);
  assert.match(view, /下一步：线稿分镜/);
  assert.match(view, /sketches\/generate-batch/);
  assert.match(view, /结果显示在下方镜头卡片中/);
  assert.match(view, /data-board-tab=\"sketches\"/);
  assert.match(view, /storyboard-sketch-grid/);
  assert.match(view, /sketchGate\.ready/);
  assert.match(view, /bindMediaLightbox\(host\)/);
  const assetCenterView = read('public/story-ad/views/assetCenterView.js');
  assert.doesNotMatch(assetCenterView, /COMPETITOR METHOD|本片广告结构与竞品方法/);

  const original = {
    getTask: storage.getTask,
    getOutput: storage.getOutput,
    saveOutput: storage.saveOutput,
  };
  const outputs = {
    storyboard_table: [1, 2, 3].map(index => ({ shot_index: index, title: `镜头${index}`, visual: `画面${index}`, action: `动作${index}`, purpose: `推进故事节点${index}`, scene_id: 'scene-a', characters: [{ id: 'actor-a' }], entry_frame_state: `承接状态${index}`, exit_frame_state: `退出状态${index}`, screen_direction: '从画左向画右', object_states: `道具状态${index}` })),
    storyboard_sketches: [],
    storyboard_meta: { status: 'ready' },
    quality_review: { passed: true, blocking_issues: [], rewrite_issues: [] },
    keyframe_contracts: [1, 2, 3].map(index => ({ shot_index: index, scene_lock: { scene_id: 'scene-a', scene_view: 'master' } })),
    scene_assets: [{ id: 'scene-a', scene_id: 'scene-a', name: '故事发生地', story_purpose: '人物在这里完成冲突与和解', image_url: '/scene.png', view_images: [{ key: 'master', image_url: '/scene-master.png' }] }],
    context: { output_ratio: '16:9', person_asset: { id: 'actor-a', image_url: '/person.png' } },
    blueprint: { title: '回到故乡', logline: '两位旧友在故事发生地重逢并和解', theme: '和解与重新出发' },
  };
  const batchCalls = [];
  const batchProgressHistory = [];
  try {
    let taskState = { id: 'batch-task', content_revision: 1, request: {}, active_generation_id: '', status: 'done', stage: 'keyframe_contract_ready' };
    storage.getTask = () => taskState;
    storage.getOutput = (taskId, kind) => outputs[kind];
    storage.saveOutput = (taskId, kind, value) => {
      outputs[kind] = value;
      if (kind === 'storyboard_sketch_batch') batchProgressHistory.push(JSON.parse(JSON.stringify(value)));
      return value;
    };
    const batchMedia = { async generateImage(input) { batchCalls.push(input); return { image_url: `/sketch/${input.shotIndex + 1}.png`, provider_used: 'mock' }; } };
    const first = await sketches.generateSketchBatch('batch-task', { confirmed: true, client_request_id: 'batch-1' }, { mediaAdapter: batchMedia });
    assert.equal(first.completed, 3);
    assert.equal(outputs.storyboard_sketches.length, 3);
    assert.equal(outputs.storyboard_sketch_batch.status, 'succeeded');
    assert.equal(outputs.storyboard_sketch_batch.completed, 3);
    assert.deepEqual(outputs.storyboard_sketch_batch.completed_indexes, [1, 2, 3]);
    assert(batchProgressHistory.some(item => item.status === 'running' && item.completed === 0));
    assert(batchProgressHistory.some(item => item.status === 'running' && item.completed === 1));
    assert(batchProgressHistory.some(item => item.status === 'running' && item.completed === 2));
    assert.equal(sketches.getSketchBatch('batch-task').progress.status, 'succeeded');
    const second = await sketches.generateSketchBatch('batch-task', { confirmed: true, client_request_id: 'batch-2' }, { mediaAdapter: batchMedia });
    assert.equal(second.requested, 0);
    assert.equal(batchCalls.length, 3, '重试批次不得覆盖已完成线稿');
    assert(batchCalls.every(call => call.requireReferences === true && call.inputFidelity === 'high'));
    assert(batchCalls.every(call => call.referenceImages.length >= 2));
    assert(batchCalls.every(call => /附件参考图是当前任务.*权威资产/.test(call.prompt)));
    assert(batchCalls.every(call => /故事与连续性权威/.test(call.prompt)));
    assert(batchCalls.every(call => /人物在这里完成冲突与和解/.test(call.prompt)));
    assert(batchCalls[1].prompt.includes('退出状态1') && batchCalls[1].prompt.includes('承接状态3'), '中间镜必须同时包含前后镜连续性');
    assert(outputs.storyboard_sketches.every(item => item.story_context_fingerprint && item.source_content_revision === 1));

    outputs.storyboard_sketches = [];
    outputs.quality_review = { passed: false, blocking_issues: ['人物合同缺失'], rewrite_issues: [] };
    outputs.storyboard_meta = { status: 'failed' };
    taskState = { ...taskState, status: 'failed', stage: 'storyboard_failed', generation_progress: { phase: 'review_failed' } };
    const callsBeforeGate = batchCalls.length;
    await assert.rejects(
      sketches.generateSketchBatch('batch-task', { confirmed: true, client_request_id: 'blocked-batch' }, { mediaAdapter: batchMedia }),
      error => error.code === 'STORYBOARD_REVIEW_REQUIRED',
    );
    await assert.rejects(
      sketches.generateSketch('batch-task', 1, { confirmed: true }, { mediaAdapter: batchMedia }),
      error => error.code === 'STORYBOARD_REVIEW_REQUIRED',
    );
    assert.equal(batchCalls.length, callsBeforeGate, '审核失败不得触发任何线稿图片调用');
    outputs.storyboard_meta = { status: 'ready' };
    taskState = { ...taskState, status: 'done', stage: 'keyframe_contract_ready', generation_progress: { phase: 'persisted' } };
    outputs.quality_review = { passed: false, blocking_issues: [], rewrite_issues: [] };
    await assert.rejects(
      sketches.generateSketchBatch('batch-task', { confirmed: true, client_request_id: 'explicit-review-failure' }, { mediaAdapter: batchMedia }),
      error => error.code === 'STORYBOARD_REVIEW_REQUIRED',
    );
    assert.equal(batchCalls.length, callsBeforeGate, '明确的 passed=false 即使没有错误列表也不得触发线稿模型');
    outputs.quality_review = { passed: true, blocking_issues: [], rewrite_issues: [] };
    outputs.storyboard_meta = { status: 'ready' };
    taskState = { ...taskState, status: 'done', stage: 'keyframe_contract_ready', generation_progress: { phase: 'persisted' } };

    let failingCall = 0;
    const failingMedia = {
      async generateImage(input) {
        failingCall += 1;
        if (failingCall === 2) {
          const error = new Error('模拟第二镜失败');
          error.code = 'MOCK_IMAGE_FAILURE';
          throw error;
        }
        return { image_url: `/failed-batch/${input.shotIndex + 1}.png`, provider_used: 'mock' };
      },
    };
    await assert.rejects(
      sketches.generateSketchBatch('batch-task', { confirmed: true, client_request_id: 'batch-fail' }, { mediaAdapter: failingMedia }),
      /模拟第二镜失败/,
    );
    assert.equal(outputs.storyboard_sketch_batch.status, 'failed');
    assert.equal(outputs.storyboard_sketch_batch.completed, 1);
    assert.equal(outputs.storyboard_sketches.length, 1);
    const recoveryCalls = [];
    const recovery = await sketches.generateSketchBatch('batch-task', { confirmed: true, client_request_id: 'batch-recover' }, {
      mediaAdapter: { async generateImage(input) { recoveryCalls.push(input); return { image_url: `/recovered/${input.shotIndex + 1}.png`, provider_used: 'mock' }; } },
    });
    assert.equal(recovery.requested, 2);
    assert.equal(recovery.completed, 2);
    assert.equal(recoveryCalls.length, 2, '失败恢复只允许补生成缺失镜头');
    assert.equal(outputs.storyboard_sketches.length, 3);
  } finally {
    storage.getTask = original.getTask;
    storage.getOutput = original.getOutput;
    storage.saveOutput = original.saveOutput;
  }

  console.log(JSON.stringify({ passed: true, generated_detail_calls: calls.length, detail_checkpoints: Object.keys(checkpoints).length, sketch_batch_calls: batchCalls.length, lightbox_hd_source: true, image2_stage_configured: true }));
}

main().catch(error => { console.error(error); process.exit(1); });
