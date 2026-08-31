#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-platform-skill-v72-'));
process.env.OUTPUT_DIR = tempDir;
process.env.DB_ENABLED = '0';

const service = require('../src/services/newStoryAd/storyAdService');
const storage = require('../src/services/newStoryAd/storageService');
const modelGateway = require('../src/services/newStoryAd/modelGateway');
const panorama = require('../src/services/newStoryAd/scenePanoramaService');
const { contextPrompt } = require('../src/services/newStoryAd/contextBuilder');

async function main() {
  const ad = service.createTask({ task_id: 'skill-ad', brief: '为东方香氛制作一条真实广告', content_mode: 'commercial_subject', content_mode_source: 'user', product_subject: '东方香氛' }, { id: 'owner' });
  const story = service.createTask({ task_id: 'skill-story', brief: '两位姐妹在古镇重逢并和解', content_mode: 'narrative_story', content_mode_source: 'user', product_subject: '' }, { id: 'owner' });
  assert.equal(ad.context.content_skill.id, 'vido.story_ad.commercial_subject');
  assert.equal(ad.context.content_skill.runtime, 'vido_server');
  assert.equal(story.context.content_skill.id, 'vido.story_ad.narrative_story');
  assert.match(contextPrompt(story.context), /不得凭空添加商品|禁止.*商品/);

  const originalGenerateText = modelGateway.generateText;
  let captured;
  modelGateway.generateText = async input => {
    captured = input;
    return {
      text: JSON.stringify({ experience_plan: {
        requested_mode: 'director_3d', source_mode: 'existing_assets', observation_point_target: 3,
        route_brief: '从古镇牌坊建立全景，再沿石板路跟随姐妹走到茶馆门前，最后环绕两人完成和解的站位。',
        required_zones: ['古镇牌坊', '石板路', '茶馆门前'], camera_path: ['全景建立', '跟随推进', '环绕收束'],
        actor_path: ['姐妹从牌坊走向茶馆'], constraints: ['保持从画左向画右的行动方向'],
        capability_boundary: '本方案是结构化3D导演预演，不代表真实6DoF几何重建。',
      } }),
      used_model: 'mock-text', fallback_used: false, failed_models: [],
    };
  };
  try {
    const assisted = await service.assistBrief({
      task_id: 'skill-story', mode: 'scene_experience', brief: story.context.brief,
      content_mode: 'narrative_story', target_scene: { id: 'scene-1', name: '古镇', story_purpose: '姐妹重逢' },
      scene_experience: { requested_mode: 'director_3d', source_mode: 'existing_assets', observation_point_target: 1 },
      user_instruction: '我不懂3D，请帮我规划人物怎么走、镜头怎么看',
    }, { id: 'owner' });
    assert.equal(assisted.experience_plan.requested_mode, 'director_3d');
    assert.equal(assisted.experience_plan.observation_point_target, 3);
    assert.match(assisted.experience_plan.capability_boundary, /不代表真实6DoF/);
    assert(assisted.knowledge_policy?.snapshot_id, 'task-bound AI assist must pin and report the KB snapshot');
    assert.match(captured.systemPrompt, /scene_experience/);
    assert.match(captured.userPrompt, /平台内容 Skill：纯剧情内容生成/);
    assert.match(captured.userPrompt, /古镇|姐妹重逢/);
  } finally {
    modelGateway.generateText = originalGenerateText;
  }

  const expected = { plan_fingerprint: 'fingerprint-current', model_call_plan: { panorama_generation: 1, panorama_qa: 1 } };
  assert.equal(panorama.assertConfirmedPlan({ cost_confirmation: true, plan_fingerprint: 'fingerprint-current' }, expected), expected);
  assert.throws(() => panorama.assertConfirmedPlan({ cost_confirmation: true, plan_fingerprint: 'stale' }, expected), error => error.code === 'PANORAMA_COST_CONFIRMATION_REQUIRED');

  const assetView = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/assetCenterView.js'), 'utf8');
  const assetAssist = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/assetCenterAssist.js'), 'utf8');
  const planning = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/assetCenterPlanningDetails.js'), 'utf8');
  const world = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/sceneWorldView.js'), 'utf8');
  const worldPlanner = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/sceneWorldExperiencePlanner.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../public/story-ad/app.js'), 'utf8');
  assert.match(`${assetView}\n${assetAssist}`, /AI 帮写人物设定/);
  assert.match(planning, /AI 帮写场景设定/);
  assert.match(world, /选择360 \/ 3D模式/);
  assert.doesNotMatch(world, /AI 完善规划/, '场景世界入口必须使用现行空间能力选择合同，不得恢复旧 AI 完善按钮');
  assert.match(worldPlanner, /AI 完善规划/);
  assert.match(worldPlanner, /3D导演预演（结构化）/);
  assert.match(worldPlanner, /当前未配置重建供应商/);
  assert.match(app, /data-delete-project/);
  assert.match(app, /彻底删除项目/);

  console.log('story ad platform skills and AI assists v72: ok');
}

main().finally(() => fs.rmSync(tempDir, { recursive: true, force: true })).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
