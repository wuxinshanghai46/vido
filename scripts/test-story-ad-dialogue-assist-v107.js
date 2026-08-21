#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const service = require('../src/services/newStoryAd/briefDialogueAssistService');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

function main() {
  assert.equal(service.isMode('brief_dialogue'), true);
  assert.throws(() => service.assertInput({}), error => error.code === 'BRIEF_DIALOGUE_MESSAGE_EMPTY');
  assert.doesNotThrow(() => service.assertInput({ user_message: '我想做一个雨夜重逢的故事' }));

  const prompt = service.userPrompt({
    content_mode: 'narrative_story',
    accumulated_idea: '林夏在雨夜车站等待多年未见的周远，希望故事让人感到遗憾后的释然。',
    user_message: '结尾两个人没有复合，但互相道别。',
    history: [{ role: 'user', content: '这是一个克制的爱情故事' }],
  });
  assert.match(prompt, /雨夜车站/);
  assert.match(prompt, /没有复合/);
  assert.match(prompt, /最近对话/);
  assert.match(service.systemPrompt(), /不要逐项询问/);
  assert.match(service.systemPrompt(), /只追问最关键的 1 至 2 个缺口/);
  assert.match(service.systemPrompt(), /规格确认后 next_step 才能进入 reference/);
  assert.match(service.systemPrompt(), /不能把系统默认值说成用户已经确认/);

  const incomplete = JSON.stringify({
    reply: '我理解你想做剧情短片，但目前只有类型。主要人物是谁，发生了什么关键事件？',
    idea_ready: false,
    missing_topics: ['主要人物', '关键事件'],
    next_step: 'idea_details',
  });
  assert.equal(service.validateRaw(incomplete), true);
  assert.deepEqual(service.buildResponse({ parsed: JSON.parse(incomplete), modelResult: { used_model: 'stub' } }), {
    dialogue_reply: '我理解你想做剧情短片，但目前只有类型。主要人物是谁，发生了什么关键事件？',
    idea_ready: false,
    missing_topics: ['主要人物', '关键事件'],
    next_step: 'idea_details',
    model_meta: { used_model: 'stub', fallback_used: undefined, failed_models: undefined },
  });

  const ready = JSON.stringify({
    reply: '我理解这是林夏与周远在雨夜告别、最终释然的克制爱情故事。接下来先确认成片时长、画幅和清晰度。',
    idea_ready: true,
    missing_topics: [],
    next_step: 'specifications',
  });
  assert.equal(service.validateRaw(ready), true);
  assert.equal(service.buildResponse({ parsed: JSON.parse(ready) }).next_step, 'specifications');

  const dialogueSource = read('public/story-ad/views/briefDialoguePanel.js');
  const briefViewSource = read('public/story-ad/views/briefView.js');
  const dialogueRuntimeSource = read('public/story-ad/views/briefDialogueRuntime.js');
  const css = read('public/story-ad/dialogue-theme.css');
  const storyService = read('src/services/newStoryAd/storyAdService.js');
  assert.match(dialogueSource, /streamMessage/);
  assert.match(dialogueSource, /setTimeout\(resolve, 22\)/);
  assert.match(dialogueSource, /data-dialogue-expand/);
  assert.match(dialogueSource, /dialogueProgressState/);
  assert.match(css, /resize:vertical/);
  assert.match(css, /view-host\.brief-dialogue-view/);
  assert.match(css, /padding-block:26px 0/, '立项页底部不得保留无内容的装饰空白');
  assert.match(css, /border-radius:20px 20px 0 0/, '铺满视口底部时不得保留悬浮卡片式底部圆角');
  assert.match(briefViewSource, /briefDialogueAssist\(\(\) => createdProjectId\)/);
  assert.match(dialogueRuntimeSource, /mode: 'brief_dialogue'/);
  assert.match(storyService, /briefDialogueAssist\.run\(\{ body, modelGateway, taskId \}\)/);
  assert.doesNotMatch(storyService, /briefDialogueAssist\.validateRaw/, '对话模型与 JSON 修复接线必须下沉到独立服务');

  console.log(JSON.stringify({ passed: true, checks: 22, scope: 'story-ad-dialogue-assist-v107', real_model_calls: 0 }));
}

try { main(); } catch (error) { console.error(error); process.exit(1); }
