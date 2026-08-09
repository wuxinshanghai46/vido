'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-task-visibility-v95-'));
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';
process.env.DB_READ_PRIMARY = '0';
process.env.DB_DUAL_WRITE = '0';
process.env.DB_JSON_FALLBACK = '1';

const storage = require('../src/services/newStoryAd/storageService');
const sceneContracts = require('../src/services/newStoryAd/assetPlanSceneContractService');
const sceneBinding = require('../src/services/newStoryAd/sceneBindingService');
const dashboard = require('../src/routes/dashboard')._test;
const jobs = require('../src/services/newStoryAd/jobService');

try {
  const common = {
    user_id: 'user-independent-tasks',
    brief: '同一个创作需求也必须保留为两个独立任务',
    request: { target_duration: 90, output_ratio: '9:16' },
  };
  storage.createTask({ id: 'independent-task-a', title: '第一次创作', ...common });
  storage.createTask({ id: 'independent-task-b', title: '重新创作', ...common });
  const listed = storage.listTasks({ userId: common.user_id, limit: 200 });
  assert.deepStrictEqual(new Set(listed.map(item => item.id)), new Set(['independent-task-a', 'independent-task-b']), '相同内容的不同任务 ID 不得在任务中心数据源合并');

  assert.equal(dashboard.isUnfinishedTask({ module: 'new-story-ad', status_group: 'failed', retryable: false }), true, '剧情广告失败任务必须保留在待继续列表');
  assert.equal(dashboard.isUnfinishedTask({ module: 'create', status_group: 'failed', retryable: false }), false, '本次变更不得扩大其它模块的既有失败任务范围');

  const repaired = sceneContracts.closeAssetPlanSceneContracts({
    scene_mode: 'multi',
    spaces: [
      { name: '古代竹海', description: '竹林深处设石径、溪流与相遇空地' },
      { id: 'shared_scene', name: '古代祭台', description: '山巅祭台与石阶', scene_spec: { layoutText: '祭台中央连接石阶入口' } },
      { id: 'shared_scene', name: '现代竹海', description: '现代竹海保留旧石径作为轮回锚点', scene_spec: { negativeText: '禁止无关人物和文字水印' } },
    ],
  }, { content_mode: 'narrative_story' });
  const normalized = sceneBinding.normalizeScenePlan(repaired);
  assert.doesNotThrow(() => sceneBinding.assertScenePlanContract(normalized));
  assert.equal(normalized.spaces.length, 3);
  assert.equal(new Set(normalized.spaces.map(space => space.id)).size, 3, '缺失或重复空间 ID 必须稳定修复');
  normalized.spaces.forEach(space => {
    ['layoutText', 'materialLightText', 'interactionText', 'negativeText'].forEach(key => assert(String(space.scene_spec[key] || '').trim(), `${space.name} 缺少 ${key}`));
  });
  assert.equal(normalized.spaces[0].name, '古代竹海');
  assert.match(normalized.spaces[0].scene_spec.layoutText, /竹林深处/);
  assert.equal(repaired.scene_contract_completion.repaired_space_count, 3);
  assert.equal(repaired.scene_contract_completion.content_mode, 'narrative_story');
  assert.doesNotMatch(JSON.stringify(repaired), /广告主体|商业配色|人物或商品/, '纯剧情场景补全不得注入广告语义');
  assert.match(JSON.stringify(repaired), /故事时代|叙事主体/, '纯剧情场景必须使用叙事合同补全');
  const commercial = sceneContracts.closeAssetPlanSceneContracts({
    spaces: [{ id: 'showroom', name: '品牌展厅', description: '入口连接中央产品展台' }],
  }, { content_mode: 'commercial_subject' });
  assert.match(JSON.stringify(commercial), /广告主体|商业配色|人物或商品/, '广告场景必须继续保留商业合同，不得被故事分支覆盖');
  assert.throws(
    () => sceneBinding.assertScenePlanContract(sceneBinding.normalizeScenePlan(sceneContracts.closeAssetPlanSceneContracts({ scene_mode: 'multi', spaces: [] }))),
    error => error?.code === 'SCENE_CONFIG_SPACE_CONTRACT_INVALID',
    '模型完全没有返回物理空间时仍必须阻断，不能静默伪造一个场景',
  );

  const details = jobs.sanitizedFailureDetails({ details: {
    scene_mode: 'multi', space_count: 1,
    incomplete_spaces: [{ space_id: 'scene-a', missing_fields: ['interactionText', 'negativeText'] }],
    duplicate_space_ids: ['scene-a'],
  } });
  assert(details.some(item => item.code === 'SCENE_SPEC_INCOMPLETE' && /interactionText/.test(item.message)));
  assert(details.some(item => item.code === 'SCENE_SPACE_ID_DUPLICATE'));

  const dashboardUi = fs.readFileSync(path.join(__dirname, '../public/js/dashboard-workbench.js'), 'utf8');
  const dashboardHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.match(dashboardUi, /<h2>当前任务<\/h2>/);
  assert.match(dashboardUi, /state\.unfinished\.slice\(0, 3\)/);
  assert.doesNotMatch(dashboardUi, /wb-toggle-tasks|showAllTasks|查看全部未完成/, '当前任务区域不得再展开全部任务');
  assert.match(dashboardHtml, /dashboard-workbench\.js\?v=20260808-current-tasks-v97/, '首页必须更新工作台脚本缓存键，避免生产继续加载旧版展开逻辑');

  console.log(JSON.stringify({
    passed: true,
    independent_same_content_tasks: listed.length,
    repaired_scene_contracts: normalized.spaces.length,
    unique_scene_ids: new Set(normalized.spaces.map(space => space.id)).size,
    failed_story_task_visible: true,
    narrative_commercial_isolation: true,
    dashboard_visible_tasks: 3,
    real_model_calls: 0,
  }, null, 2));
} finally {
  fs.rmSync(outputDir, { recursive: true, force: true });
}
