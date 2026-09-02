'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const { personCoverUrl } = require('../src/services/storyAdWorkspace/projectBundleService');
const { restoreGeneratedDossierFields } = require('../src/routes/newStoryAd/subjectAssetPersistence');
const personIdentity = require('../src/services/newStoryAd/personIdentityContractService');

function loadBrowserModule(file, exposed, globals = {}) {
  const source = read(file)
    .replace(/^import\s+.*?;\s*$/gm, '')
    .replace(/\bexport\s+/g, '');
  const sandbox = { ...globals };
  vm.runInNewContext(`${source}\nglobalThis.__tested = { ${exposed.join(', ')} };`, sandbox, { filename: file });
  return sandbox.__tested;
}

const escapeHtml = value => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const mediaPreview = (item = {}) => item.image_url ? `<img src="${escapeHtml(item.image_url)}">` : '<i>empty</i>';

async function main() {
  const assetCenter = read('public/story-ad/views/assetCenterView.js');
  assert.doesNotMatch(assetCenter, /onGenerateScene:\s*generateScene/u,
    '人物完整视图入口不得求值一个未定义的场景生成回调');

  const dossierUi = loadBrowserModule('public/story-ad/views/personDossierShowcase.js', ['personDossierShowcase'], { escapeHtml, mediaPreview });
  const rendered = dossierUi.personDossierShowcase({
    id: 'person-1', name: '陈默', visual_asset_contract_version: 2,
    native_masters: { face: { image_url: '/face.png' }, body: { image_url: '/body.png' } },
    dossier_sheet: { image_url: '/dossier-with-scene.png', layout: 'elegant_character_archive_v5' },
    view_images: [{ key: 'front', image_url: '/front.png' }],
    base_actions: [{ key: 'natural_walk', image_url: '/action.png' }],
    profile: {},
  });
  assert.match(rendered, /data-global-image-state="person_only"/u);
  assert.match(rendered, /character-dossier-hero[^>]*[\s\S]*?<img src="\/body\.png">/u,
    '完整视图首屏必须优先单人物身体母版，不能优先可能异常的头像图或合成档案');

  const projectedCover = personCoverUrl({
    cover_image_url: '/dossier-with-scene.png',
    dossier_sheet: { image_url: '/dossier-with-scene.png' },
    native_masters: { face: { image_url: '/face.png' }, body: { image_url: '/body.png' } },
  }, []);
  assert.equal(projectedCover, '/body.png', '工作区人物卡必须投影单人物身体母版而不是合成档案');

  const restored = restoreGeneratedDossierFields([{}], [{
    cover_image_url: '/dossier-with-scene.png', dossier_sheet: { image_url: '/dossier-with-scene.png' },
    native_masters: { face: { image_url: '/face.png' }, body: { image_url: '/body.png' } }, identity_views: [], body_views: [],
  }])[0];
  assert.equal(restored.cover_image_url, '/body.png', '持久化时必须保存单人物身体封面');

  const cardUi = loadBrowserModule('public/story-ad/views/sceneDossierCard.js', ['assetCardMedia'], { escapeHtml, mediaPreview });
  const card = cardUi.assetCardMedia({
    name: '陈默',
    native_masters: { face: { image_url: '/bad-face-contact-sheet.png' }, body: { image_url: '/body.png' } },
    dossier_sheet: { image_url: '/dossier.png' },
  }, 'people');
  assert.match(card, /src="\/body\.png"/u, '人物卡必须默认显示单人物身体母版');
  assert.doesNotMatch(card, /bad-face-contact-sheet/u, '人物卡不得优先显示误标为头像的拼图');

  const workspaceCss = read('public/story-ad/workspace.css');
  assert.match(workspaceCss,
    /\.asset-card\.is-subject \.asset-card-person-entry \.media\{[^}]*height:210px;[^}]*object-fit:cover;[^}]*object-position:center 24%/u,
    '人物卡半身裁切规则必须比主体素材通用 contain 规则更具体，并固定为卡片预览高度');

  const legacyQa = personIdentity.normalizeQa({
    pass: true, identity_score: 1, age_score: 1, wardrobe_score: 1, body_score: 1,
    photographic_realism_score: 1, checked_at: '2026-09-01T00:00:00.000Z',
  });
  assert.equal(legacyQa.pass, true, '新增背景字段不得无条件推翻已有审核合同');
  const freshMissingBackgroundQa = personIdentity.normalizeQa({
    pass: true, identity_score: 1, age_score: 1, wardrobe_score: 1, body_score: 1,
    photographic_realism_score: 1,
  }, { fresh: true });
  assert.equal(freshMissingBackgroundQa.pass, false, '新审核缺少背景检查字段时必须失败');
  const freshSceneQa = personIdentity.normalizeQa({
    pass: true, identity_score: 1, age_score: 1, wardrobe_score: 1, body_score: 1,
    photographic_realism_score: 1, studio_background_score: 0.3,
  }, { fresh: true });
  assert.equal(freshSceneQa.pass, false, '人物动作图混入场景背景时必须被审核拒绝');

  const compiler = require('../src/services/newStoryAd/personDossierCompiler');
  assert.match(compiler.categoryPrompt({ kind: 'action', keys: ['natural_walk'], columns: 1, rows: 1, instruction: 'walk' }),
    /same plain light-gray casting studio.*No scene/iu,
    '人物动作生成源头必须明确禁止剧情场景');

  console.log('story-ad person view contract v404: 12 assertions passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
