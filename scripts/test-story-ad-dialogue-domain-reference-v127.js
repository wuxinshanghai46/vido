#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL, fileURLToPath } = require('url');

const root = path.join(__dirname, '..');
const context = vm.createContext({ console, URL, setTimeout, clearTimeout });
const cache = new Map();

async function loadModule(filePath) {
  const absolute = path.resolve(filePath);
  if (cache.has(absolute)) return cache.get(absolute);
  const module = new vm.SourceTextModule(fs.readFileSync(absolute, 'utf8'), {
    context,
    identifier: pathToFileURL(absolute).href,
    initializeImportMeta(meta) { meta.url = pathToFileURL(absolute).href; },
  });
  cache.set(absolute, module);
  await module.link(async (specifier, referencingModule) => {
    const cleanSpecifier = String(specifier).split('?')[0];
    return loadModule(path.resolve(path.dirname(fileURLToPath(referencingModule.identifier)), cleanSpecifier));
  });
  await module.evaluate();
  return module;
}

async function main() {
  const module = await loadModule(path.join(root, 'public/story-ad/views/briefDialoguePanel.js'));
  const { briefDialogueMarkup, referenceDialogueStatus } = module.namespace;
  const progressModule = await loadModule(path.join(root, 'public/story-ad/views/referenceProgressCard.js'));
  const replacementModule = await loadModule(path.join(root, 'public/story-ad/store/referenceReplacementState.js'));
  const runningReference = {
    analysis_id: 'reference-v127', status: 'running', progress: 42, phase: '正在分析产品画面',
  };
  const status = referenceDialogueStatus(runningReference);
  assert.match(status, /正在分析产品画面/);
  assert.match(status, /42%/);
  assert.match(status, /本对话/);

  const commercialMarkup = briefDialogueMarkup({
    brief: {
      content_mode: 'commercial_subject', content_mode_source: 'user', text: '不锈钢板材广告',
    },
    reference: runningReference,
  }, {});
  assert.match(commercialMarkup, /可执行广告方案/);
  assert.match(commercialMarkup, /确认设想，生成广告脚本/);
  assert.match(commercialMarkup, /data-reference-dialogue-status/);
  const emptyReferenceMarkup = briefDialogueMarkup({ brief: {} }, {});
  assert.match(emptyReferenceMarkup, /data-reference-progress-host/,
    '新项目必须预留对话内进度宿主，添加参考后才能无刷新原位显示状态');
  assert.doesNotMatch(commercialMarkup, /确认设想，生成剧情与对白/);

  const failedProgress = progressModule.namespace.referenceProgress({
    analysis_id: 'failed-billing-reference',
    status: 'failed',
    progress: 82,
    error: '语义整理超时',
    billing_state: 'unknown',
    provider_submission_state: 'submitted_unknown',
    visual_evidence_reusable: true,
    evidence_batch_progress: { total: 10, completed: 10, remaining: 0, failed: 0 },
  });
  assert.match(failedProgress, /data-reference-abandon/);
  assert.match(failedProgress, /跳过这个参考/);
  assert.match(failedProgress, />重新整理内容<\/button>/);
  assert.doesNotMatch(failedProgress, /重新整理内容（可能计费）/);
  assert.match(failedProgress, /系统没有自动重复请求，避免可能产生两次费用/);
  assert.doesNotMatch(failedProgress, /new_story_ad|apismile|gpt-5\.5|TIMEOUT_OR_NETWORK|语义合同/,
    '失败卡默认视图不得暴露模型、供应商、内部阶段或合同术语');
  assert.match(failedProgress, /is-recovery/);
  assert.doesNotMatch(failedProgress, /role="progressbar"/, '终态恢复卡不得继续占用大面积进度条');
  const importFailureProgress = progressModule.namespace.referenceProgress({
    analysis_id: 'failed-import-reference',
    status: 'failed',
    source: { input_type: 'url', display_url: 'https://www.liblib.tv/detail/example' },
    error: { code: 'REFERENCE_VIDEO_TOO_LARGE' },
  });
  assert.match(importFailureProgress, />重新读取链接<\/button>/);
  assert.match(importFailureProgress, /尚未调用识别模型/);
  const recoveryMarkup = briefDialogueMarkup({
    brief: { content_mode: 'commercial_subject', content_mode_source: 'user', text: '不锈钢板材广告' },
    reference: { analysis_id: 'failed-billing-reference', status: 'failed' },
  }, {}, { referenceProgressMarkup: failedProgress });
  assert.match(recoveryMarkup, /brief-conversation-scroll[\s\S]*data-reference-progress-host/,
    '失败恢复操作必须位于可滚动对话区内，不能落在桌面裁剪容器之外');

  let finishRemoval;
  const optimisticState = {
    bundle: { project: { id: 'task-optimistic' }, brief: { brief_intake: { creative_brief_confirmed: true, reference_decision: '' } }, reference: { analysis_id: 'reference-old', status: 'failed' }, revisions: { content: 3, client_edit_seq: 4 } },
    referenceReplacementSeq: 0,
  };
  const set = patch => Object.assign(optimisticState, patch);
  const removal = replacementModule.namespace.removeProjectReference({
    state: optimisticState,
    set,
    stopPolling() {},
    request: () => new Promise(resolve => { finishRemoval = resolve; }),
    applyMutationResult: () => optimisticState.bundle,
  });
  assert.deepEqual(optimisticState.bundle.reference, {}, '用户确认跳过后恢复卡必须立即消失，不等待服务器清理完成');
  assert.equal(optimisticState.bundle.brief.brief_intake.reference_decision, 'skipped', '后台删除期间必须先记录本地跳过决定，避免再次追问');
  finishRemoval({ success: true, reference_removed: true });
  await removal;
  const failedState = {
    bundle: { project: { id: 'task-rollback' }, brief: { brief_intake: { reference_decision: '' } }, reference: { analysis_id: 'reference-rollback', status: 'failed' }, revisions: { content: 2, client_edit_seq: 1 } },
    referenceReplacementSeq: 0,
  };
  await assert.rejects(() => replacementModule.namespace.removeProjectReference({
    state: failedState,
    set: patch => Object.assign(failedState, patch),
    stopPolling() {},
    request: async () => { throw new Error('synthetic detach failure'); },
    applyMutationResult: () => failedState.bundle,
  }), /synthetic detach failure/);
  assert.equal(failedState.bundle.reference.analysis_id, 'reference-rollback', '服务器解绑失败时必须恢复原卡片，不能假装成功');
  assert.equal(failedState.bundle.brief.brief_intake.reference_decision, '', '服务器解绑失败时必须恢复原参考决定');

  const briefProjection = require('../src/services/storyAdWorkspace/briefProjectionService');
  const projectedBrief = briefProjection.project({
    brief: '已确认广告设想',
    brief_intake: {
      creative_brief_confirmed: true, specifications_confirmed: true, reference_decision: 'skipped',
      completed_dialogue_topics: ['audience_intent', 'commercial_evidence'], active_dialogue_topic: '',
    },
  }, {}, value => String(value || '').trim());
  assert.deepEqual(projectedBrief.brief_intake, {
    creative_brief_confirmed: true, specifications_confirmed: true, reference_decision: 'skipped',
    completed_dialogue_topics: ['audience_intent', 'commercial_evidence'], active_dialogue_topic: '',
    dialogue_history: [],
    cast_intent: {
      confirmed: false,
      mode: 'auto',
      expected_people: 0,
      participants: [],
      source: '',
    },
  }, '工作区摘要投影必须携带完整对话进度，刷新后不得退回旧问题');

  const narrativeMarkup = briefDialogueMarkup({
    brief: { content_mode: 'narrative_story', content_mode_source: 'user', text: '雨夜重逢故事' },
  }, {});
  assert.match(narrativeMarkup, /可执行剧情/);
  assert.match(narrativeMarkup, /确认设想，生成剧情与对白/);

  const briefViewSource = fs.readFileSync(path.join(root, 'public/story-ad/views/briefView.js'), 'utf8');
  const linkHandlerSource = briefViewSource.slice(
    briefViewSource.indexOf('async function handleReferenceLink'),
    briefViewSource.indexOf('dialogueCleanup = bindBriefDialogueWorkflow'),
  );
  assert.doesNotMatch(linkHandlerSource, /refreshShell|navigate\(/,
    '添加参考链接后不得重挂载页面或重置当前对话滚动位置');
  assert.match(briefViewSource, /if \(role !== 'reference'\) \{[\s\S]{0,180}refreshShell/,
    '本地参考视频上传必须跳过整页刷新，同时保留其他材料原有刷新流程');
  assert.match(briefViewSource, /route\.isNew = false;[\s\S]{0,180}render: false/,
    '新项目首次添加参考后必须静默切换规范 URL，不能重建对话 DOM');
  const appSource = fs.readFileSync(path.join(root, 'public/story-ad/app.js'), 'utf8');
  assert.match(appSource, /if \(options\.render === false\) return;/,
    '静默规范 URL 必须由路由器显式支持');
  const recoverySource = fs.readFileSync(path.join(root, 'public/story-ad/views/briefReferenceRecovery.js'), 'utf8');
  assert.match(recoverySource, /importFailure[\s\S]*retryReferenceImport\(\)/,
    '链接导入失败必须重新读取链接，不能误入缺少本地文件的重新分析入口');

  const failed = referenceDialogueStatus({
    analysis_id: 'failed-v127', status: 'failed', error: '链接需要登录（请求编号：qa-127）',
  });
  assert.match(failed, /参考视频分析失败/);
  assert.match(failed, /请求编号：qa-127/);

  const service = require('../src/services/newStoryAd/briefDialogueAssistService');
  assert.deepStrictEqual(
    service.cleanTopicsForMode(['plot_trigger', 'subject_identity', 'subject_motivation'], 'commercial_subject'),
    ['subject_identity', 'subject_motivation'],
  );
  let gatewayCalls = 0;
  const compact = await service.run({
    body: {
      user_message: '突出品牌的专业能力', accumulated_idea: '不锈钢板材品牌广告', content_mode: 'commercial_subject',
      completed_topics: ['plot_trigger', 'subject_identity', 'subject_motivation'], specifications_confirmed: false,
    },
    modelGateway: { async generateText() {
      gatewayCalls += 1;
      return {
        text: JSON.stringify({
          response_mode: 'question',
          reply: '为了把专业能力拍得可信，准备用哪组真实画面证明这个卖点？',
          question_topic: 'commercial_evidence',
          covered_topics: [],
          cast_intent: { status: 'missing', decision: '', expected_people: 0, participants: [], evidence: '' },
          suggested_answers: ['展示真实使用过程和结果', '用细节特写呈现材质与工艺'],
          coverage: {},
          idea_ready: false,
          missing_topics: ['commercial_evidence'],
          next_step: 'idea_details',
        }),
        used_model: 'mock/dialogue',
        fallback_used: false,
        failed_models: [],
      };
    } },
  });
  assert.equal(compact.idea_ready, false);
  assert.equal(compact.next_step, 'idea_details');
  assert.match(compact.dialogue_reply, /哪组真实画面/);
  assert.equal(gatewayCalls, 1, '自由反馈不得再被旧问题数量静默截断');

  console.log(JSON.stringify({
    passed: true,
    checks: 39,
    scope: 'story-ad-dialogue-domain-reference-v127',
    real_model_calls: 0,
    paid_generation_calls: 0,
  }));
}

main().catch(error => { console.error(error); process.exit(1); });
