#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, '.tmp', 'new-story-ad-blueprint-lifecycle');
fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = 'false';
process.env.DB_DUAL_WRITE = 'false';
process.env.DB_READ_PRIMARY = 'false';

const storage = require('../src/services/newStoryAd/storageService');
const modelGateway = require('../src/services/newStoryAd/modelGateway');
const blueprintService = require('../src/services/newStoryAd/blueprintService');
const blueprintProgress = require('../src/services/newStoryAd/blueprintProgressService');
const storyService = require('../src/services/newStoryAd/storyAdService');
const jobService = require('../src/services/newStoryAd/jobService');
const cancellation = require('../src/services/newStoryAd/cancellationContext');

const premiumBlueprint = {
  story_title: '雨停前的交付',
  logline: '交付前连接突然中断，林清禾改用当前任务主体完成验证，终于在雨停前发出结果。',
  characters: [{ name: '林清禾', role: '项目负责人', description: '当前任务原创人物' }],
  beats: [
    { beat_index: 1, role: '冲突', plot: '窗外下雨，交付页面的连接状态变红。', action: '林清禾停下输入并检查错误来源。', spoken_line: '客户十分钟后就要当场看结果，偏偏最后一条关键链路又断了。' },
    { beat_index: 2, role: '转折', plot: '当前任务主体完成验证，状态由红转绿。', action: '她重新连接并确认核心步骤。', spoken_line: '先锁定真正的错误源，再把最关键的一步完整重新跑通。' },
    { beat_index: 3, role: '结果', plot: '结果页完整出现，发送时间早于截止线。', action: '她核对结果后点击发送。', spoken_line: '赶上了，结果、时间和预算现在都能清楚对得上。' },
  ],
};

premiumBlueprint.causal_contract_required = true;
premiumBlueprint.narrative_contract = {
  version: 'causal-story-v1',
  arc_type: 'conflict_resolution',
  setup: '交付前连接中断，任务尚未完成。',
  trigger: '负责人切换到当前任务主体并重新验证关键链路。',
  progression: '连接状态恢复，核心步骤重新跑通。',
  result: '结果在截止时间前完成并发送。',
  beat_refs: {
    setup: [1],
    trigger: [2],
    progression: [2],
    result: [3],
  },
};
[
  {
    causal_role: 'setup',
    state_before: ['交付任务仍在进行'],
    state_after: ['连接中断且时间紧迫'],
    intended_changes: ['确认失败边界'],
    visible_evidence: ['连接状态变红和截止倒计时'],
  },
  {
    causal_role: 'evidence',
    state_before: ['关键链路不可用'],
    state_after: ['关键链路恢复可用'],
    intended_changes: ['完成验证并恢复连接'],
    visible_evidence: ['连接状态由红转绿'],
  },
  {
    causal_role: 'resolution',
    state_before: ['链路已经恢复'],
    state_after: ['结果完成并成功发送'],
    intended_changes: ['完成交付'],
    visible_evidence: ['完整结果页和发送时间'],
  },
].forEach((causalFields, index) => Object.assign(premiumBlueprint.beats[index], causalFields));

async function main() {
  const originalGenerateText = modelGateway.generateText;
  modelGateway.generateText = async () => ({
    text: JSON.stringify(premiumBlueprint),
    used_model: 'test/original-blueprint',
    fallback_used: false,
    failed_models: [],
  });
  try {
    const context = {
      request_id: 'blueprint-lifecycle-task',
      brief: '为当前任务主体制作一条完全原创、无第三方品牌和公众人物的剧情广告。',
      original_brief: '原创剧情广告，不使用第三方 IP。',
      product_subject: '当前任务主体',
      target_duration: 24,
      output_ratio: '9:16',
      cast_mode: 'single',
      forbidden: ['第三方 IP', '公众人物', '未经授权 Logo'],
      characters: premiumBlueprint.characters,
      assets: [],
      scene_assets: [],
    };
    const milestones = [];
    const generated = await blueprintService.generateBlueprint(context, {
      taskId: 'blueprint-lifecycle-task',
      onProgress: progress => milestones.push(progress),
    });
    assert.equal(generated.beats.length, 3);
    assert.equal(generated.narrative_contract.version, 'causal-story-v1');
    assert(generated.beats.every(beat => beat.causal_role && beat.visible_evidence.length));
    assert.deepEqual(milestones.map(item => item.completed), [1, 2, 3, 4, 5]);
    assert.equal(milestones.at(-1).phase, 'quality_approved');
    assert.equal(generated.model_meta.rights_pass, true);

    storage.createTask({
      id: 'blueprint-lifecycle-task',
      brief: context.brief,
      status: 'running',
      stage: 'blueprint',
      request: context,
    });
    storage.saveOutput('blueprint-lifecycle-task', 'context', context);
    storage.updateTask('blueprint-lifecycle-task', {
      active_stage: 'blueprint',
      active_generation_id: 'generation-blueprint-current',
      generation_started_at: new Date().toISOString(),
    });
    const persisted = await storyService.generateBlueprintStage('blueprint-lifecycle-task', {
      generationId: 'generation-blueprint-current',
    });
    const task = storage.getTask('blueprint-lifecycle-task');
    assert.equal(persisted.beats.length, 3);
    assert.equal(storage.getOutput('blueprint-lifecycle-task', 'blueprint').beats.length, 3);
    assert.equal(task.generation_progress.stage, 'blueprint');
    assert.equal(task.generation_progress.phase, 'persisted');
    assert.equal(task.generation_progress.completed, 6);
    assert.equal(task.generation_progress.total, 6);
    assert.equal(task.generation_progress.percent, 100);
    assert.equal(jobService.stageBudgetMs('blueprint'), 480000);

    storage.updateTask('blueprint-lifecycle-task', { active_stage: '', active_generation_id: '' });
    const before = storage.getTask('blueprint-lifecycle-task').generation_progress;
    assert.equal(blueprintProgress.update('blueprint-lifecycle-task', {
      phase: 'late_write', completed: 2, total: 6,
    }, { generationId: 'generation-blueprint-current' }), null);
    assert.deepEqual(storage.getTask('blueprint-lifecycle-task').generation_progress, before, '超时或取消后的迟到回调不得覆盖终态');

    const deadline = cancellation.cancelledError({ cancelReason: 'deadline', stage: 'blueprint' });
    assert.equal(deadline.code, 'STAGE_DEADLINE_EXCEEDED');
    assert.match(deadline.message, /没有产生可用剧本.*重新生成剧本/);
    const auditFailure = jobService.classifyFailure(Object.assign(new Error('content audit'), { code: 'PROVIDER_CONTENT_AUDIT' }));
    assert.equal(auditFailure.retryable, false);
    assert.match(auditFailure.message, /停止继续调用.*品牌\/IP.*公众人物/);

    const modelGatewaySource = fs.readFileSync(path.join(root, 'src/services/newStoryAd/modelGateway.js'), 'utf8');
    assert(modelGatewaySource.includes("'PROVIDER_CONTENT_AUDIT', 'INVALID_PROVIDER_INPUT'].includes(classified.code)) break"));
    const stepNavigationSource = fs.readFileSync(path.join(root, 'public/js/new-story-ad/step-navigation.js'), 'utf8');
    assert(stepNavigationSource.includes("if (step === 3) return !!state.blueprint;"));
    const generationFlowSource = fs.readFileSync(path.join(root, 'public/js/new-story-ad/generation-flow.js'), 'utf8');
    const sandbox = { window: {}, setTimeout, clearTimeout, Promise, Date };
    vm.runInNewContext(generationFlowSource, sandbox, { filename: 'generation-flow.js' });
    assert.equal(sandbox.window.NewStoryAdGenerationFlow.blueprintIsReady({ outputs: {} }, { blueprint: null }), false);
    assert.equal(sandbox.window.NewStoryAdGenerationFlow.blueprintIsReady({ outputs: { blueprint: { beats: [] } } }, {}), false);
    assert.equal(sandbox.window.NewStoryAdGenerationFlow.blueprintIsReady({ outputs: { blueprint: { beats: [{ beat_index: 1 }] } } }, {}), true);
    const uiSource = fs.readFileSync(path.join(root, 'public/js/new-story-ad-legacy-ui.js'), 'utf8');
    assert(uiSource.includes('本次剧本没有生成成功'));
    assert(uiSource.includes('syncBlueprintFailureHost'));
    const taskStoreSource = fs.readFileSync(path.join(root, 'public/js/new-story-ad/task-store.js'), 'utf8');
    assert(taskStoreSource.includes('人物、场景和已通过的空间验证均已保留'));
    assert(taskStoreSource.includes("state.taskErrorCode === 'STAGE_DEADLINE_EXCEEDED'"));
    console.log('new story ad blueprint lifecycle: ok');
  } finally {
    modelGateway.generateText = originalGenerateText;
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
