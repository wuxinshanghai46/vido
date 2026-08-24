'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const dialogue = require('../src/services/newStoryAd/briefDialogueAssistService');
const pipeline = require('../src/services/pipelineModelService');
const routing = require('./configure-story-ad-image-routing-v203');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n/g, '\n');
const importModule = relative => import(`data:text/javascript;base64,${Buffer.from(read(relative)).toString('base64')}`);

async function main() {
  const desired = routing.ROUTE.map(item => `${item.provider_id}/${item.model_id}`);
  assert.deepEqual(desired, ['smscrw/gpt-image-2', 'webang-maas/gpt-image-2', 'deyunai/gpt-image-2']);
  const configured = routing.configureStages({ stages: {
    'new_story_ad.person_sheet': [
      { provider_id: 'deyunai', model_id: 'gpt-image-2', enabled: true },
      { provider_id: 'apismile', model_id: 'gpt-image-2', enabled: true },
    ],
  } }, ['new_story_ad.person_sheet']);
  assert.deepEqual(
    configured.stages['new_story_ad.person_sheet'].filter(item => item.enabled).map(item => `${item.provider_id}/${item.model_id}`),
    desired,
    '图片候选必须固定为 SMSCRW、微众、漫路',
  );
  assert.deepEqual(
    pipeline.getStageDefaults('new_story_ad.person_sheet').filter(item => item.enabled).map(item => `${item.provider_id}/${item.model_id}`),
    desired,
    '没有保存配置时也必须使用相同默认顺序',
  );

  const personRoute = read('src/routes/newStoryAd/personPlanGenerationRoute.js');
  const mainRoutes = read('src/routes/newStoryAd.js');
  const propRoutes = read('src/routes/newStoryAd/propRoutes.js');
  assert.doesNotMatch(personRoute, /assertLegacyMutationAllowed/, '当前人物生成入口不得再被当作旧入口拦截');
  for (const stage of ['scene_panorama', 'scene_panorama_batch', 'product_asset', 'scene_config', 'scene_plan']) {
    assert.doesNotMatch(mainRoutes, new RegExp(`assertLegacyMutationAllowed\\(req\\.params\\.id, '${stage}'\\)`), `${stage} 当前入口不得再显示旧入口错误`);
  }
  assert.doesNotMatch(propRoutes, /assertLegacyMutationAllowed/, '当前道具入口不得再被当作旧入口拦截');
  assert.match(mainRoutes, /assertLegacyMutationAllowed\(req\.params\.id, 'visual_assets'\)/, '真正停用的合并写入口仍必须在服务端阻断');

  const durationModule = await importModule('public/story-ad/views/briefDurationOptions.js');
  assert.deepEqual([...durationModule.BRIEF_DURATION_OPTIONS], [15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 480, 600]);
  assert.equal(durationModule.durationLabel(45), '45 秒');
  assert.equal(durationModule.durationLabel(180), '3 分钟');
  assert.equal(durationModule.durationLabel(300), '5 分钟');
  assert.equal(durationModule.durationLabel(480), '8 分钟');
  assert.equal(durationModule.durationLabel(600), '10 分钟');
  assert.match(read('public/story-ad/views/briefSpecificationQuestion.js'), /BRIEF_DURATION_OPTIONS/);
  assert.match(read('public/story-ad/views/briefView.js'), /durationOptionsMarkup/);

  const idea = '让女设计师拿着板材样品从展厅外进入，先穿过钢材门厅，再展示展厅全景和墙面样板，最后金粉聚合成品牌标志。';
  const parsed = {
    creative_direction: '开场跟拍设计师从外景进入钢材门厅，用材质特写衔接展厅全景，再切墙面样板对比，最后以金粉聚合品牌标志收束。',
    reply: '这条广告最希望观众记住哪个核心卖点？',
    question_topic: 'subject_motivation',
    suggested_answers: ['突出板材设计效果', '突出材质与工艺', '突出品牌服务能力'],
    missing_topics: ['核心卖点'], idea_ready: false, next_step: 'idea_details', coverage: {},
  };
  assert.equal(dialogue.creativeApproachRequested({ user_message: idea }), true);
  assert.equal(dialogue.validateRaw(JSON.stringify(parsed), {
    accumulatedIdea: idea, contentMode: 'commercial_subject', requireCreativeDirection: true,
  }), true);
  const response = dialogue.buildResponse({ parsed, modelResult: { used_model: 'fixture' }, body: {
    accumulated_idea: idea, user_message: idea, content_mode: 'commercial_subject',
  } });
  assert.match(response.dialogue_reply, /^大概会这样做：/);
  assert.match(response.dialogue_reply, /钢材门厅/);
  assert.match(response.dialogue_reply, /核心卖点/);
  assert.equal(response.creative_direction, parsed.creative_direction);
  assert.match(dialogue.systemPrompt('', 'commercial_subject'), /creative_direction/);
  assert.match(dialogue.userPrompt({ accumulated_idea: idea, user_message: idea, content_mode: 'commercial_subject' }), /开场、推进、重点画面与收尾构想/);

  console.log(JSON.stringify({ passed: true, checks: 29, scope: 'story-ad-user-feedback-v203', model_calls: 0 }));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
