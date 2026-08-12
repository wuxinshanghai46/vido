'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

function loadBrowserModule(file, exposed) {
  const source = read(file).replace(/^import\s+.*?;\s*$/gm, '').replace(/\bexport\s+/g, '');
  const sandbox = { document: {}, globalThis: {} };
  vm.runInNewContext(`${source}\nglobalThis.__tested = { ${exposed.join(', ')} };`, sandbox, { filename: file });
  return sandbox.globalThis.__tested;
}

const ui = loadBrowserModule('public/story-ad/components/ui.js', ['generationProgressPanel']);
const failed = ui.generationProgressPanel({
  project: {
    status: 'failed', stage: 'visual_assets',
    error: '支持编号：secret-support-id。deyunai/gpt-image-2（供应商：500/image2O100IFR）',
  },
  generation: {
    progress: {
      status: 'failed', stage: 'visual_assets', billing_state: 'unknown',
      message: '支持编号：secret-support-id。deyunai/gpt-image-2（供应商：500/image2O100IFR）',
    },
  },
}, 'assets');
assert.match(failed, /生成中断（计费待核对）/);
assert.doesNotMatch(failed, /secret-support-id|deyunai|gpt-image-2|image2O100IFR|失败详情/);

const panorama = read('public/story-ad/views/panoramaGeneration.js');
assert.doesNotMatch(panorama, /当前供应商金额计费未配置|本地机位投影0次|深度0次|空间重建0次|不是6DoF自由移动空间/);
assert.match(panorama, /将基于当前场景图生成360全景并完成质量检查/);

const projection = read('src/services/storyAdWorkspace/projectBundleService.js');
assert.match(projection, /text:\s*clean\(context\.brief \|\| raw\.task\.brief, 5000\)/);
assert.doesNotMatch(projection, /text:\s*clean\(context\.brief \|\| raw\.task\.brief, 3000\)/);

const deyunai = require('../src/services/deyunaiService');
const generationBody = deyunai.buildGptImage2RequestBody({
  prompt: 'original landscape', n: 1, size: '1920x1080', referenceImages: [],
});
assert.deepEqual(Object.keys(generationBody).sort(), ['n', 'output_format', 'prompt', 'size']);
assert.equal(generationBody.size, '1536x1024');
assert.equal(generationBody.stream, undefined);
assert.equal(generationBody.partial_images, undefined);
assert.equal(generationBody.background, undefined);
assert.equal(generationBody.quality, undefined);

const editBody = deyunai.buildGptImage2RequestBody({
  prompt: 'original adult portrait',
  referenceImages: Array.from({ length: 8 }, (_, index) => `https://assets.example.com/${index}.jpg`),
  inputFidelity: 'high',
});
assert.equal(editBody.images.length, 6);
assert.equal(editBody.input_fidelity, 'high');
assert(editBody.images.every(item => /^https:\/\//.test(item.image_url)));

const mediaAdapter = require('../src/services/newStoryAd/mediaAdapter');
const safePrompt = mediaAdapter.domesticGptImage2ReviewPrompt('古代少女遭遇致命暗器，衣袖有鲜血。');
assert.match(safePrompt, /成年女性（明确年龄20岁以上）/);
assert.doesNotMatch(safePrompt, /少女|致命暗器|鲜血/);
assert.match(safePrompt, /Domestic image review contract:/);
const candidate = mediaAdapter.promptForImageCandidate('古代少女遭遇致命暗器。', { modelId: 'gpt-image-2' });
assert.match(candidate, /成年女性（明确年龄20岁以上）/);

console.log(JSON.stringify({
  passed: true,
  hidden_internal_failure_details: true,
  panorama_copy_simplified: true,
  brief_roundtrip_limit: 5000,
  image2_generation_fields: Object.keys(generationBody).sort(),
  image2_reference_cap: editBody.images.length,
  domestic_review_rewrite: true,
}));
