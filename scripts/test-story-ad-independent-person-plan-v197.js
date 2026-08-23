'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-person-plan-v197-'));
process.env.OUTPUT_DIR = outputDir;

const storage = require('../src/services/newStoryAd/storageService');
const gateway = require('../src/services/newStoryAd/modelGateway');
const service = require('../src/services/newStoryAd/storyAdService');
const publication = require('../src/services/newStoryAd/assetPlanPublicationService');
const permit = require('../src/services/newStoryAd/generationPermitService');
const tts = require('../src/services/newStoryAd/ttsAdapter');
const originalGenerate = gateway.generateText;

const rich = id => ({
  id, displayName: id === 'p1' ? '林岚' : '陈先生', roleName: id === 'p1' ? '空间设计师' : '客户', age: id === 'p1' ? '25岁' : '42岁', ethnicity: '东亚外貌设计',
  appearanceText: `${id === 'p1' ? '25岁女性，鹅蛋脸、舒展眉眼与清晰下颌线' : '42岁男性，方圆脸、浓眉深眼与稳重下颌线'}；身形比例自然、肩背挺直；肤色保留真实细微纹理，目光专注，神态沉静可信。`,
  wardrobeText: '深炭灰羊毛西装外套搭配象牙白棉质衬衫和同色直筒长裤，黑色低跟皮鞋；固定佩戴银色腕表且无其它配饰，颜色、面料纹理和版型跨视图一致。',
  hairMakeupText: '深棕色短发保持自然侧分与固定发色；自然底妆保留肤质，眉形清晰、唇色自然；不佩戴眼镜、帽子、发饰和其它首饰。',
  negativeText: '禁止改变年龄、性别、脸型、五官和人物身份；禁止变换发型发色、妆容、服装、鞋履、颜色和配饰；禁止网红脸、塑料皮肤、过度磨皮、畸形肢体及多余人物。',
  look_profiles: [{ id: `${id}_look`, name: '基础造型', story_state: '当前剧情', scene_ids: [], wardrobeText: '深炭灰羊毛西装外套搭配象牙白棉质衬衫和同色直筒长裤，黑色低跟皮鞋；固定佩戴银色腕表且无其它配饰，颜色、面料纹理和版型跨视图一致。', hairMakeupText: '深棕色短发保持自然侧分与固定发色；自然底妆保留肤质，眉形清晰、唇色自然；不佩戴眼镜、帽子、发饰和其它首饰。', negativeText: '禁止改变年龄、脸型与五官，禁止换装、换发型、换妆容、增减鞋履配饰或改变颜色，禁止塑料皮肤和畸形肢体。', style_richness: 'refined' }],
});

(async () => {
  const taskId = 'independent-person-plan-v197';
  const context = { brief: '林岚向陈先生讲解空间方案', content_mode: 'commercial_subject', cast_mode: 'dual', expected_people: 2, planning_cast_count: 2, visual_asset_count: 2, cast_profiles: [
    { id: 'p1', displayName: '林岚', roleName: '空间设计师', age: '25岁' },
    { id: 'p2', displayName: '陈先生', roleName: '客户', age: '42岁' },
  ], pet_profiles: [], prop_assets: [], scene_assets: [], person_spec: { castMode: 'dual', expectedPeople: 2 }, forbidden: [], characters: [], shot_count: 5, target_duration: 30 };
  storage.createTask({ id: taskId, brief: context.brief, content_revision: 1, request: context });
  storage.saveOutput(taskId, 'context', context);
  let active = 0, peak = 0, calls = 0;
  gateway.generateText = async options => {
    assert.equal(options.stage, 'new_story_ad.person_plan_character');
    calls += 1; active += 1; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 35));
    const id = options.userPrompt.includes('本次只完善目标人物：{"index":1') ? 'p2' : 'p1';
    active -= 1;
    return { text: JSON.stringify({ person_spec: { castMode: 'dual', expectedPeople: 2 }, cast_profiles: [rich(id)], pet_profiles: [] }), used_model: 'test/person-plan', fallback_used: false, failed_models: [] };
  };
  const result = await service.updatePersonPlan(taskId, { generation_id: 'gen-v197' });
  assert.equal(result.length, 2);
  assert.equal(calls, 2, '两个角色必须各自调用一次人物方案模型');
  assert.equal(peak, 2, '两个角色必须同步处于执行态，而不是前一个完成后再启动下一个');
  const eligibility = publication.eligibility(taskId, { fingerprint: publication.activeRecord(taskId).fingerprint });
  assert.equal(eligibility.person.eligible, true, '人物域 Active Plan 必须可用');
  assert.equal(eligibility.eligible, false, '场景未规划时全局计划必须保持不可用');
  const issued = permit.issue(taskId, 'subject_assets', { idempotencyKey: 'v197-subjects' });
  assert(issued?.permit_id, '人物域方案必须可以授权人物图片生成');
  assert.throws(() => permit.issue(taskId, 'storyboard', { idempotencyKey: 'v197-board' }), error => error.code === 'GENERATION_ACTIVE_PLAN_REQUIRED');
  assert.equal(storage.getOutput(taskId, 'person_plan_character_checkpoints'), null, '完整发布后必须清理临时检查点，显式重生成不能永远复用旧方案');
  const speechUnits = tts.shotSpeechUnits({ speech_mode: 'on_camera_dialogue', dialogue_lines: [{ speaker_id: 'p1', speaker: '林岚', line: '请看这块材料。' }] }, '', { speakers: { p1: 'voice-linlan' } });
  assert.deepEqual(speechUnits, [{ speaker: '林岚', speaker_id: 'p1', text: '请看这块材料。', voice_id: 'voice-linlan', kind: 'dialogue' }], '线稿分镜保存的说话人和对白必须直接进入多音色 TTS 单元');
  const subjectSource = fs.readFileSync(path.join(__dirname, '../src/services/newStoryAd/subjectAssetBundleService.js'), 'utf8');
  assert.match(subjectSource, /generationConcurrency\.map\([\s\S]*subject_people:[\s\S]*humans\.map/, '人物图片必须按主体并行调度');
  assert.doesNotMatch(subjectSource, /for \(let index = 0; index < humans\.length/, '人物图片不得退回串行 for/await 链路');
  const storyboardSource = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/storyboardView.js'), 'utf8');
  assert.match(storyboardSource, /对白与声音表演[\s\S]*data-shot-speech-mode[\s\S]*dialogue_lines/, '声音与对白设置必须位于线稿分镜并持久化下游字段');
  const personFormSource = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/assetCenterPersonForm.js'), 'utf8');
  assert.doesNotMatch(personFormSource, /renderPersonVoiceBinding|声音与对白表演/, '人物外观生成表单不得再显示声音与对白设置');

  const retryTaskId = 'independent-person-plan-retry-v197';
  storage.createTask({ id: retryTaskId, brief: context.brief, content_revision: 1, request: context });
  storage.saveOutput(retryTaskId, 'context', context);
  let failSecond = true, retryCalls = 0;
  gateway.generateText = async options => {
    retryCalls += 1;
    const id = options.userPrompt.includes('本次只完善目标人物：{"index":1') ? 'p2' : 'p1';
    await new Promise(resolve => setTimeout(resolve, 20));
    if (id === 'p2' && failSecond) { const error = new Error('simulated independent failure'); error.code = 'TIMEOUT_OR_NETWORK'; throw error; }
    return { text: JSON.stringify({ person_spec: { castMode: 'dual', expectedPeople: 2 }, cast_profiles: [rich(id)], pet_profiles: [] }), used_model: 'test/person-plan', fallback_used: false, failed_models: [] };
  };
  await assert.rejects(service.updatePersonPlan(retryTaskId, { generation_id: 'gen-retry-1' }), error => error.code === 'TIMEOUT_OR_NETWORK');
  const partial = storage.getOutput(retryTaskId, 'person_plan_character_checkpoints');
  assert.equal(partial.p1.status, 'done', '一个人物失败时另一个人物成功方案必须保存');
  assert.equal(partial.p2.status, 'failed');
  failSecond = false;
  const callsBeforeRetry = retryCalls;
  const retried = await service.updatePersonPlan(retryTaskId, { generation_id: 'gen-retry-2' });
  assert.equal(retried.length, 2);
  assert.equal(retryCalls - callsBeforeRetry, 1, '重试必须只调用失败人物，已成功人物从检查点恢复');
  console.log(JSON.stringify({ passed: true, model_calls: calls, peak_concurrency: peak, person_domain_eligible: true, global_plan_eligible: false, tts_dialogue_units: speechUnits.length, partial_success_preserved: true, retry_missing_only_calls: retryCalls - callsBeforeRetry, paid_model_calls: 0 }));
})().finally(() => {
  gateway.generateText = originalGenerate;
  fs.rmSync(outputDir, { recursive: true, force: true });
});
