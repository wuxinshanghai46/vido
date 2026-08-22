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
  assert.match(failedProgress, /确认费用风险，仅重试语义/);
  assert.match(failedProgress, /没有自动切换备用模型，避免重复付费/);
  const recoveryMarkup = briefDialogueMarkup({
    brief: { content_mode: 'commercial_subject', content_mode_source: 'user', text: '不锈钢板材广告' },
    reference: { analysis_id: 'failed-billing-reference', status: 'failed' },
  }, {}, { referenceProgressMarkup: failedProgress });
  assert.match(recoveryMarkup, /brief-conversation-scroll[\s\S]*data-reference-progress-host/,
    '失败恢复操作必须位于可滚动对话区内，不能落在桌面裁剪容器之外');

  const narrativeMarkup = briefDialogueMarkup({
    brief: { content_mode: 'narrative_story', content_mode_source: 'user', text: '雨夜重逢故事' },
  }, {});
  assert.match(narrativeMarkup, /可执行剧情/);
  assert.match(narrativeMarkup, /确认设想，生成剧情与对白/);

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
    modelGateway: { async generateText() { gatewayCalls += 1; throw new Error('达到预算后不应调用模型'); } },
  });
  assert.equal(compact.idea_ready, true);
  assert.equal(compact.next_step, 'specifications');
  assert.equal(gatewayCalls, 0);

  console.log(JSON.stringify({
    passed: true,
    checks: 21,
    scope: 'story-ad-dialogue-domain-reference-v127',
    real_model_calls: 0,
    paid_generation_calls: 0,
  }));
}

main().catch(error => { console.error(error); process.exit(1); });
