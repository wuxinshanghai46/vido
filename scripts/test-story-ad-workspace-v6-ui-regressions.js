'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function loadBrowserModule(file, exposed, globals = {}) {
  const source = read(file)
    .replace(/^import\s+.*?;\s*$/gm, '')
    .replace(/\bexport\s+/g, '');
  const sandbox = { ...globals };
  vm.runInNewContext(`${source}\nglobalThis.__tested = { ${exposed.join(', ')} };`, sandbox, { filename: file });
  return sandbox.__tested;
}

const escapeHtml = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');
const mediaPreview = item => item?.media_url || item?.image_url
  ? `<img class="media" src="${escapeHtml(item.media_url || item.image_url)}">`
  : '<div class="media-placeholder"></div>';

const assets = read('public/story-ad/views/assetCenterView.js');
assert.match(assets, /reference-dossier-board/);
assert.match(assets, /参考档案预览/);
assert.match(assets, /查看原始四视图/);

const assetModule = loadBrowserModule(
  'public/story-ad/views/assetCenterView.js',
  ['assetCard', 'personAssetState', 'subjectNeedsGeneration', 'sceneDetails', 'subjectGenerationPayload'],
  { escapeHtml, mediaPreview, request() { throw new Error('UI render test must not call request'); }, confirmDialog() { return false; } },
);
const legacyPerson = {
  id: 'legacy-person', kind: 'person', name: '历史人物', status: 'verified', role: '体验者',
  view_images: ['front', 'side', 'back', 'action'].map(key => ({ key, image_url: `/${key}.png` })),
};
assert.equal(assetModule.personAssetState(legacyPerson), 'legacy_views');
assert.equal(assetModule.subjectNeedsGeneration({ ...legacyPerson, kind: '' }, 'human'), true, '人物是否需生成不得依赖 item.kind');
assert.equal(assetModule.subjectNeedsGeneration({ ...legacyPerson, kind: '' }, 'pet'), false, '动物四视图仍属于已生成，不得套用人物 dossier 规则');
const legacyCard = assetModule.assetCard(legacyPerson, 'people');
assert.match(legacyCard, /历史四视图/);
assert.match(legacyCard, /生成完整人物档案/);
assert.match(legacyCard, /data-generate-asset="legacy-person"/);

const completePerson = { ...legacyPerson, dossier_sheet: { image_url: '/dossier.png' } };
assert.equal(assetModule.personAssetState(completePerson), 'complete_dossier');
const completeCard = assetModule.assetCard(completePerson, 'people');
assert.match(completeCard, /完整档案/);
assert.doesNotMatch(completeCard, /data-generate-asset=/);

const precisePayload = assetModule.subjectGenerationPayload({
  project: { id: 'precise-person-task' },
  brief: { text: '人物精确生成测试' },
  assets: {
    people: [
      { ...legacyPerson, id: 'selected-legacy', asset_id: 'selected-legacy', subject_id: 'person-selected', profile: { id: 'person-selected' } },
      { ...legacyPerson, id: 'unselected-legacy', asset_id: 'unselected-legacy', subject_id: 'person-unselected', profile: { id: 'person-unselected' } },
      { id: 'missing-person', asset_id: 'missing-person', subject_id: 'person-missing', view_images: [], profile: { id: 'person-missing' } },
    ],
    animals: [],
  },
}, { id: 'selected-legacy', asset_id: 'selected-legacy', subject_id: 'person-selected' }, 'request-1');
assert.deepEqual(Array.from(precisePayload.subject_targets, item => item.id), ['person-selected', 'person-missing'], '单人物生成只允许选中人物和真正缺失主体，不得扩大到未选历史四视图');
assert(!precisePayload.subject_targets.some(item => item.id === 'person-unselected'), '未选历史人物必须原样保留，避免额外付费');

const unverifiedProductCard = assetModule.assetCard({ id: 'product-1', name: '商品图', image_url: '/product.png', status: 'unverified' }, 'products');
assert.match(unverifiedProductCard, /data-verify-product="product-1"/);
assert.match(unverifiedProductCard, /验证商品素材/);
const verifiedProductCard = assetModule.assetCard({ id: 'product-1', name: '商品图', image_url: '/product.png', status: 'verified' }, 'products');
assert.doesNotMatch(verifiedProductCard, /data-verify-product=/);

const sceneWithCameraImage = assetModule.sceneDetails({
  name: '客厅',
  view_images: [{ key: 'cam-a', image_url: '/camera-a.png' }],
  cameras: [{ id: 'camera-a', view_id: 'cam-a', label: '低机位' }, { id: 'camera-b', view_id: 'cam-b', label: '备用机位' }],
});
assert.match(sceneWithCameraImage, /src="\/camera-a\.png"/);
assert.match(sceneWithCameraImage, /该机位图未生成/);
assert.match(sceneWithCameraImage, /scene-camera-card has-image/);
assert.match(sceneWithCameraImage, /scene-camera-card is-missing-image/);

const generateFunction = assets.slice(assets.indexOf('const generate = async'), assets.indexOf("host.querySelectorAll('[data-asset-filter]"));
assert(generateFunction.indexOf('confirmDialog') >= 0, '人物生成必须包含显式确认');
assert(generateFunction.indexOf('confirmDialog') < generateFunction.indexOf("request('/api/new-story-ad/subject-assets'"), '确认必须发生在模型请求前');
const verifyProductFunction = assets.slice(assets.indexOf('const verifyProduct = async'), assets.indexOf("host.querySelectorAll('[data-asset-filter]"));
assert(verifyProductFunction.indexOf('confirmDialog') >= 0, '商品视觉验证必须包含显式费用确认');
assert(verifyProductFunction.indexOf('confirmDialog') < verifyProductFunction.indexOf('/product-verify'), '商品验证确认必须发生在视觉模型请求前');

const plot = read('public/story-ad/views/plotRoomView.js');
assert.match(plot, /mode:\s*'story_beat'/);
assert.match(plot, /AI 帮写/);
assert.match(plot, /confirmDialog\('删除后/);
assert.match(plot, /beat-actions/);

const storyboard = read('public/story-ad/views/storyboardView.js');
assert.match(storyboard, /sketch-action-bar/);
assert.match(storyboard, /class="sketch-actions"/);
assert.doesNotMatch(storyboard, /sketch-media-actions/);
assert.match(storyboard, /shot-inline-editor/, '文字分镜必须在当前分镜台直接编辑');
assert.match(storyboard, /data-save-inline-shot/, '逐镜编辑必须有当前行保存入口');
assert.doesNotMatch(storyboard, /data-edit-shot[^\n]+context\.navigate/, '逐镜编辑不得再跳转到镜头设计页');
assert.match(storyboard, /friendlyBindings/, '绑定资产必须显示用户可理解的名称而非裸 ID');
const sketchActions = storyboard.slice(storyboard.indexOf('class="sketch-actions"'), storyboard.indexOf('</div>', storyboard.indexOf('class="sketch-actions"')));
const sketchOrder = ['data-generate-sketch', 'data-upload-sketch', 'data-skip-sketch', 'data-confirm-sketch'].map(token => sketchActions.indexOf(token));
assert(sketchOrder.every(index => index >= 0), '线稿四个操作必须属于同一个 DOM 操作组');
assert.deepEqual([...sketchOrder].sort((a, b) => a - b), sketchOrder, '线稿操作的 DOM/键盘顺序必须为生成、上传、跳过、确认');

const shot = read('public/story-ad/views/shotDesignerView.js');
assert.match(shot, /拍摄机位/);
assert.match(shot, /平视/);
assert.match(shot, /浅景深（主体清楚）/);
assert.match(shot, /shot-readable-summary/);
assert.match(shot, /查看技术标识/);
assert.doesNotMatch(shot, /\['scene_id', '场景 ID'\]/);

const finalView = read('public/story-ad/views/finalView.js');
assert.match(finalView, /class="final-video"[^>]*controls/);
assert.match(finalView, /下载原始成片/);
assert.match(finalView, /preload="none"/, '最终成片首屏不得默认拉取视频流');
assert.match(finalView, /poster=/, '最终成片应优先展示轻量封面');
assert.match(finalView, /<details class="card generation-section generation-details">/);
assert.doesNotMatch(finalView, /mediaPreview\(finalVideo/);

const workspaceCss = read('public/story-ad/workspace.css');
const platformCss = read('public/story-ad/styles.css');
assert.match(workspaceCss, /\.final-video\s*\{[^}]*width:\s*auto;[^}]*max-width:\s*100%;[^}]*height:\s*auto;/s);
assert.match(workspaceCss, /\.sketch-actions\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/s);
assert.match(workspaceCss, /\.scene-camera-media \.media[^}]*object-fit:\s*contain/s);

const workflowModule = loadBrowserModule(
  'public/story-ad/views/workflowView.js',
  ['graphNode', 'structuredNodeDetail'],
  { escapeHtml, mediaPreview, request() { throw new Error('UI render test must not call request'); } },
);
Object.assign(workflowModule, loadBrowserModule(
  'public/story-ad/views/workflowInlineEditor.js',
  ['inlineNodeEditor'],
  { escapeHtml },
));
const fullBrief = '完整需求正文'.repeat(80);
const briefNode = { id: 'brief:1', type: 'brief', title: '广告目标', subtitle: '短摘要', detail: { full_text: fullBrief }, position: { x: 0, y: 0 } };
const briefCard = workflowModule.graphNode(briefNode);
assert.match(briefCard, /node-text-preview is-brief/);
assert.doesNotMatch(briefCard, /media-placeholder/);
assert.match(workflowModule.structuredNodeDetail(briefNode), new RegExp(fullBrief.slice(0, 120)));

const storyDetail = workflowModule.structuredNodeDetail({
  type: 'story', subtitle: '故事摘要', detail: { logline: '一次改变认知的体验', beats: [{ title: '开场', content: '人物进入场景' }, { title: '证明', content: '产品完成展示' }] },
});
assert.match(storyDetail, /剧情情节点/);
assert.match(storyDetail, /人物进入场景/);
const storyEditor = workflowModule.inlineNodeEditor({ type: 'story' }, {
  story: { blueprint: { story_title: '原故事', logline: '原概述', beats: [{ title: '开场', visual: '人物进入' }] } },
});
assert.match(storyEditor, /data-node-inline-editor/);
assert.match(storyEditor, /data-save-node-inline/);
assert.match(storyEditor, /人物进入/);

const shotWithSketch = workflowModule.graphNode({
  id: 'shot:1', type: 'shot', title: '推开窗户', subtitle: '人物走近窗边', media_url: '/sketch-1.png', detail: {}, position: { x: 0, y: 0 },
});
assert.match(shotWithSketch, /src="\/sketch-1\.png"/);
assert.doesNotMatch(shotWithSketch, /node-text-preview/);
assert.match(shotWithSketch, /node-media-summary/);
assert.match(shotWithSketch, /人物走近窗边/);

const workflowCss = read('public/story-ad/workflow.css');
assert.match(workflowCss, /\.node-text-preview p\s*\{[^}]*-webkit-line-clamp:\s*3/s);
assert.match(workflowCss, /\.graph-node \.node-media-summary\s*\{[^}]*-webkit-line-clamp:\s*2/s);
assert.match(workflowCss, /\.node-readable-section > p\s*\{[^}]*white-space:\s*pre-wrap/s);

const uiSource = read('public/story-ad/components/ui.js').replace(/\bexport\s+/g, '');
const sandbox = {};
vm.runInNewContext(`${uiSource}\nglobalThis.__mediaPreview = mediaPreview; globalThis.__generationProgressPanel = generationProgressPanel;`, sandbox, { filename: 'story-ad-ui-contract.js' });
assert.match(sandbox.__mediaPreview({ media_url: '/api/assets/frame' }, { label: '帧' }), /<img/);
assert.match(sandbox.__mediaPreview({ media_url: '/api/media/final', type: 'final' }, { label: '成片' }), /<video/);
assert.match(sandbox.__mediaPreview({ thumbnail_url: '/api/assets/poster', video_url: '/api/media/clip' }, { label: '视频浏览' }), /<img/);
const progressPanel = sandbox.__generationProgressPanel({
  project: { active_generation_id: 'gen-1' },
  generation: { progress: { stage: 'keyframes', status: 'running', completed: 2, total: 6, active_indexes: [3, 4], percent: 33 } },
});
assert.match(progressPanel, /33%/);
assert.match(progressPanel, /已完成 2\/6/);
assert.match(progressPanel, /正在生成第 3、4 镜/);
assert.match(progressPanel, /data-cancel-generation/);

const storeSource = read('public/story-ad/store/projectStore.js');
assert.match(storeSource, /generation_progress:\s*progressTask\.generation_progress/, '轻量轮询必须把完整进度合并回 V6 bundle');
assert.match(storeSource, /progressRevision/, '轮询必须使用独立进度 revision，不能误用内容 revision');
const appSource = read('public/story-ad/app.js');
assert.match(appSource, /store\.syncProgressPolling\(\)/, '页面内切换后必须恢复当前任务的进度轮询');
assert.match(appSource, /generationProgressPanel/, '所有制作步骤必须共享同一个可见进度条');

assert.match(platformCss, /\.btn:focus-visible[^}]*outline/s, '按钮必须有清晰键盘指向效果');
assert.match(workspaceCss, /\[aria-selected="true"\]/, '可选择按钮必须有持久选中效果');

console.log('story-ad workspace v6 UI regression contracts passed');
