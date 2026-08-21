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

  console.log(JSON.stringify({
    passed: true,
    checks: 12,
    scope: 'story-ad-dialogue-domain-reference-v127',
    real_model_calls: 0,
    paid_generation_calls: 0,
  }));
}

main().catch(error => { console.error(error); process.exit(1); });
