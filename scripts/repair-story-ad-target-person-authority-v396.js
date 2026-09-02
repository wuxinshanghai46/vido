#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const storage = require('../src/services/newStoryAd/storageService');
const storyAdService = require('../src/services/newStoryAd/storyAdService');
const assetPlan = require('../src/services/newStoryAd/assetPlanService');
const personPrompt = require('../src/services/newStoryAd/personGenerationPromptService');

const TARGET_TASK_ID = 'b83fa67c-244a-4869-b3cc-df282fad5c59';
const TARGET_TITLE = '佛山智造 · 不锈钢品牌广告';
const TARGET_PERSON_ID = 'char_chenmo';
const EXPECTED_HASHES = Object.freeze({
  appearanceText: '070eb5108bc8f25124899ce471aa1d60f8cca0646e9bdb12ccf95b952086dde8',
  wardrobeText: '32a3038e9a256abac74e428b13aad6d498291d9938725a4ae1488f348927aaec',
  hairMakeupText: '273d42450bd0e3c577126105fe31eeed1e29eee9f044b909a18261c36c36fdcb',
  negativeText: '5494fe05be81cc878b8fb3bef95db4ab21e398cc7436251e631b920b88a6d792',
  generation_prompt: 'de37c13a5ada070ac20846f1902b762519e277a1051198c39cb67728e5ba6d90',
});

const CLEAN_FIELDS = Object.freeze({
  appearanceText: '25岁东亚女性，鹅蛋脸型，五官端正自然，双眼干净有神，身形匀称偏修长，肩颈线条利落，体态挺拔。皮肤保留真实商业广告质感、自然毛孔与细微肤色变化；整体气质安静克制，神态自然专注，带有商业展示场景中的审美判断感。',
  wardrobeText: '固定穿哑光米白色短袖针织上衣，搭配高腰深灰色直筒西裤和黑色皮革低跟鞋；双耳固定佩戴小号银色圆钉耳饰，不佩戴项链、手链、戒指、帽子、眼镜和发带。服装、鞋履、颜色、材质和配饰在全部视图中保持一致。',
  hairMakeupText: '固定黑色及肩中长直发，中分，发尾微内扣，自然垂落且不扎发；固定自然通勤淡妆，薄透底妆、浅棕色柔和眉形、自然眼妆与裸粉色唇色；不佩戴帽子、眼镜及任何发饰。',
  negativeText: '禁止改变25岁女性身份、脸型、五官、体型比例、肤色基调、发型发色、分缝和妆容；禁止增减、更换、变色或移动上衣、西裤、低跟鞋、耳饰及其他配饰；禁止出现紫色晚礼服、黑色高跟鞋或第二套服装；禁止过度磨皮、塑料肤质、夸张表情、张口说话、畸形手指、肢体错位、服装穿模、文字、水印和无关人物。',
});

function sha256(value = '') {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function cleanProfile(profile = {}) {
  const editable = new Set(Array.isArray(profile.user_edited_fields) ? profile.user_edited_fields : []);
  ['appearanceText', 'wardrobeText', 'hairMakeupText', 'negativeText', 'generation_prompt'].forEach(key => editable.delete(key));
  const authority = { ...(profile.field_authority || {}) };
  Object.keys(CLEAN_FIELDS).forEach(key => { authority[key] = 'system_default'; });
  delete authority.generation_prompt;
  const looks = Array.isArray(profile.look_profiles) ? profile.look_profiles : [];
  const next = {
    ...profile,
    ...CLEAN_FIELDS,
    appearance: { ...(profile.appearance || {}), userPrompt: CLEAN_FIELDS.appearanceText },
    wardrobe: { ...(profile.wardrobe || {}), userPrompt: CLEAN_FIELDS.wardrobeText },
    hairMakeup: { ...(profile.hairMakeup || {}), userPrompt: CLEAN_FIELDS.hairMakeupText },
    outfit: CLEAN_FIELDS.wardrobeText,
    user_edited_fields: [...editable],
    field_authority: authority,
    generation_prompt_source: 'compiled_from_profile',
    look_profiles: looks.map((look, index) => index ? look : ({
      ...look,
      wardrobeText: CLEAN_FIELDS.wardrobeText,
      hairMakeupText: CLEAN_FIELDS.hairMakeupText,
      negativeText: CLEAN_FIELDS.negativeText,
    })),
  };
  delete next.generation_prompt;
  delete next.generationPrompt;
  return personPrompt.project(next);
}

function assertExpectedSource(task, profile) {
  if (!task || task.id !== TARGET_TASK_ID || task.title !== TARGET_TITLE) throw new Error('目标任务身份不匹配，拒绝迁移');
  if (task.active_generation_id) throw new Error(`目标任务存在活动生成 ${task.active_generation_id}，拒绝迁移`);
  if (!profile || profile.id !== TARGET_PERSON_ID) throw new Error('目标人物身份不匹配，拒绝迁移');
  for (const [field, expected] of Object.entries(EXPECTED_HASHES)) {
    if (sha256(profile[field]) !== expected) throw new Error(`${field} 已变化，拒绝覆盖未经复核的新数据`);
  }
}

async function run(taskId, { apply = false } = {}, deps = {}) {
  const store = deps.storage || storage;
  const service = deps.storyAdService || storyAdService;
  const planService = deps.assetPlan || assetPlan;
  const task = store.getTask(taskId);
  const context = store.getOutput(taskId, 'context') || task?.request || {};
  const profile = (context.cast_profiles || []).find(item => item?.id === TARGET_PERSON_ID);
  assertExpectedSource(task, profile);
  const cleaned = cleanProfile(profile);
  planService.assertDetailedPersonProfiles([cleaned]);
  const report = {
    ok: true,
    task_id: taskId,
    mode: apply ? 'apply' : 'dry_run',
    source_content_revision: Number(task.content_revision || 1),
    person_id: cleaned.id,
    generated_prompt_hash: sha256(cleaned.generation_prompt),
    contradictory_purple_dress_removed: !/紫色晚礼服|黑色高跟鞋/u.test(cleaned.wardrobeText),
    negative_rule_retained: /禁止出现紫色晚礼服/u.test(cleaned.negativeText),
    provider_calls: 0,
  };
  if (!apply) return report;
  const beforeCalls = store.listModelCalls(taskId).length;
  const castProfiles = context.cast_profiles.map(item => item?.id === TARGET_PERSON_ID ? cleaned : item);
  const updated = await service.updateTaskRequest(taskId, {
    cast_profiles: castProfiles,
    person_spec: {
      ...(context.person_spec || {}),
      appearanceText: cleaned.appearanceText,
      wardrobeText: cleaned.wardrobeText,
      hairMakeupText: cleaned.hairMakeupText,
      negativeText: cleaned.negativeText,
      look_profiles: cleaned.look_profiles,
    },
    changed_domains: ['person'],
    save_progress: true,
    change_scope: 'person',
    progress_stage: 'scene_config_done',
    base_content_revision: task.content_revision,
    asset_setup_confirmed: false,
  }, { id: task.user_id || '', userId: task.user_id || '' });
  planService.persistIndependentPersonProfiles(taskId, [cleaned], {
    migration: 'target_person_authority_v396',
    model_call_count: 0,
  });
  store.deleteOutput(taskId, 'person_contract');
  store.deleteOutput(taskId, 'person_visual_refresh');
  store.deleteOutput(taskId, 'person_plan_recovery_diagnostic');
  store.updateTask(taskId, {
    status: 'working',
    stage: 'scene_config_done',
    active_stage: '', active_generation_id: '',
    error: '', error_code: '', support_id: '', retryable: false,
    generation_progress: null,
  });
  const after = store.getTask(taskId);
  const finalContext = store.getOutput(taskId, 'context') || {};
  const finalProfile = (finalContext.cast_profiles || []).find(item => item?.id === TARGET_PERSON_ID);
  const afterCalls = store.listModelCalls(taskId).length;
  if (!finalProfile || sha256(finalProfile.generation_prompt) !== sha256(cleaned.generation_prompt)) throw new Error('迁移后人物提示词未成为当前权威');
  if (afterCalls !== beforeCalls) throw new Error('迁移意外触发了模型调用');
  return {
    ...report,
    applied: true,
    content_revision: after.content_revision,
    stage: after.stage,
    status: after.status,
    invalidated_outputs: updated.invalidated_outputs || [],
    model_calls_before: beforeCalls,
    model_calls_after: afterCalls,
    model_call_delta: afterCalls - beforeCalls,
  };
}

async function main() {
  const taskId = String(process.argv[2] || '');
  if (taskId !== TARGET_TASK_ID) throw new Error(`usage: node scripts/repair-story-ad-target-person-authority-v396.js ${TARGET_TASK_ID} [--apply]`);
  console.log(JSON.stringify(await run(taskId, { apply: process.argv.includes('--apply') }), null, 2));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });

module.exports = { TARGET_TASK_ID, TARGET_PERSON_ID, EXPECTED_HASHES, CLEAN_FIELDS, sha256, cleanProfile, assertExpectedSource, run };
