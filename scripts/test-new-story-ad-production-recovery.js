const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const sharp = require('sharp');

const modelGateway = require('../src/services/newStoryAd/modelGateway');
const { checkpointMatches } = require('../src/services/newStoryAd/blueprintLifecycleService');
const { buildContext } = require('../src/services/newStoryAd/contextBuilder');
const { normalizeBrandOverlay, applyBrandOverlay } = require('../src/services/newStoryAd/composeService');

async function main() {
  const generationFlowSource = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad/generation-flow.js'), 'utf8');
  const runStageSource = generationFlowSource.slice(
    generationFlowSource.indexOf('async function runStage'),
    generationFlowSource.indexOf('async function cancelStage'),
  );
  assert.ok(
    runStageSource.indexOf("startStageProgress?.(stage, '正在保存最新内容并执行生成预检...')")
      < runStageSource.indexOf('await flushForGeneration'),
    '点击后必须先显示保存/预检进度，再等待保存完成',
  );
  const legacySource = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad-legacy-ui.js'), 'utf8');
  const flushSource = legacySource.slice(
    legacySource.indexOf('async function flushForGeneration'),
    legacySource.indexOf('function generationFlowContext'),
  );
  assert.ok(flushSource.includes('persistAutoSaveChanges({ ensureFullDraft: true })'));
  assert.ok(!/persistAutoSaveChanges\(\{ ensureFullDraft: true \}\);[\s\S]{0,300}saveCurrentTaskProgress/.test(flushSource));

  const blueprintCandidates = modelGateway.candidatesForStage('new_story_ad.blueprint')
    .map(item => `${item.provider_id}/${item.model_id}`);
  const repairCandidates = modelGateway.candidatesForStage('new_story_ad.blueprint_structure_repair')
    .map(item => `${item.provider_id}/${item.model_id}`);
  assert.deepStrictEqual(repairCandidates.slice(0, blueprintCandidates.length), blueprintCandidates);

  const task = { content_revision: 7, active_input_fingerprint: 'fp-same' };
  const checkpoint = {
    reusable: true,
    content_revision: 7,
    input_fingerprint: 'fp-same',
    payload: { beats: [{ beat_index: 1 }] },
  };
  assert.strictEqual(checkpointMatches(checkpoint, task, 'fp-same'), true);
  assert.strictEqual(checkpointMatches(checkpoint, { ...task, content_revision: 8 }, 'fp-same'), false);
  assert.strictEqual(checkpointMatches(checkpoint, task, 'fp-other'), false);

  const context = buildContext({
    brief: '九个镜头的品牌剧情广告，结尾预留 Logo 落版',
    brand_overlay: {
      enabled: true,
      authorization_confirmed: true,
      asset: { id: 'logo-1', url: '/api/new-story-ad/assets/logo.png' },
      position: 'bottom_right',
      width_percent: 24,
      end_duration_sec: 2,
    },
  });
  assert.strictEqual(context.brand_overlay.enabled, true);
  assert.strictEqual(context.brand_overlay.authorization_confirmed, true);
  assert.strictEqual(context.brand_overlay.position, 'bottom_right');

  assert.throws(
    () => normalizeBrandOverlay({ enabled: true, authorization_confirmed: false, asset: { url: '/x.png' } }),
    error => error.code === 'BRAND_ASSET_AUTHORIZATION_REQUIRED',
  );

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nsa-brand-overlay-'));
  try {
    const input = path.join(tempDir, 'input.mp4');
    const logo = path.join(tempDir, 'logo.png');
    const output = path.join(tempDir, 'output.mp4');
    const createVideo = spawnSync(ffmpegPath, [
      '-y', '-f', 'lavfi', '-i', 'color=c=#203040:s=640x360:d=1.5',
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
      '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', input,
    ], { encoding: 'utf8' });
    assert.strictEqual(createVideo.status, 0, createVideo.stderr);
    await sharp({
      create: { width: 240, height: 90, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).composite([{
      input: Buffer.from('<svg width="240" height="90"><rect x="4" y="4" width="232" height="82" rx="18" fill="#34f5c5"/><text x="120" y="58" text-anchor="middle" font-size="38" font-family="Arial" fill="#071014">BRAND</text></svg>'),
    }]).png().toFile(logo);
    await applyBrandOverlay(input, {
      enabled: true,
      file_path: logo,
      position: 'bottom_right',
      width_percent: 24,
      margin_percent: 5,
      end_duration_sec: 1,
    }, output);
    assert.ok(fs.existsSync(output) && fs.statSync(output).size > 1000);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log('new-story-ad production recovery regression passed: route/checkpoint/logo overlay');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
