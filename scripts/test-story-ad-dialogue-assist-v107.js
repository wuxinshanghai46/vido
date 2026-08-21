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
  assert.match(service.systemPrompt(), /五类制作依据/);
  assert.match(service.systemPrompt(), /古代.*不能单独算 world_context/);
  assert.match(service.systemPrompt(), /evidence 必须是从当前累计设想中原样摘取/);
  assert.match(service.systemPrompt(), /规格确认后 next_step 才能进入 reference/);
  assert.match(service.systemPrompt(), /不能把系统默认值说成用户已经确认/);

  const incomplete = JSON.stringify({
    reply: '我理解你想做剧情短片，但目前只有类型。主要人物是谁，发生了什么关键事件？',
    idea_ready: false,
    missing_topics: ['主要人物', '关键事件'],
    next_step: 'idea_details',
    coverage: {},
  });
  assert.equal(service.validateRaw(incomplete), true);
  const incompleteResponse = service.buildResponse({ parsed: JSON.parse(incomplete), modelResult: { used_model: 'stub' }, body: { accumulated_idea: '我想做剧情短片' } });
  assert.equal(incompleteResponse.idea_ready, false);
  assert.deepEqual(incompleteResponse.missing_topics, ['主要人物', '关键事件']);
  assert.equal(incompleteResponse.next_step, 'idea_details');
  assert.deepEqual(incompleteResponse.model_meta, { used_model: 'stub', fallback_used: undefined, failed_models: undefined });
  assert.deepEqual(incompleteResponse.coverage, {
    subject: { status: 'missing', evidence: '' }, structure: { status: 'missing', evidence: '' },
    audience_intent: { status: 'missing', evidence: '' }, world_context: { status: 'missing', evidence: '' },
    visual_direction: { status: 'missing', evidence: '' },
  });

  const completeIdea = '林夏与周远在雨夜车站告别；两人从重逢到互相释然；面向经历遗憾的年轻观众；当代上海雨夜；真人写实电影感';
  const ready = JSON.stringify({
    reply: '我理解这是林夏与周远在雨夜告别、最终释然的克制爱情故事。接下来先确认成片时长、画幅和清晰度。',
    idea_ready: true,
    missing_topics: [],
    next_step: 'specifications',
    coverage: {
      subject: { status: 'explicit', evidence: '林夏与周远' },
      structure: { status: 'explicit', evidence: '从重逢到互相释然' },
      audience_intent: { status: 'explicit', evidence: '经历遗憾的年轻观众' },
      world_context: { status: 'explicit', evidence: '当代上海雨夜' },
      visual_direction: { status: 'explicit', evidence: '真人写实电影感' },
    },
  });
  assert.equal(service.validateRaw(ready), true);
  assert.equal(service.buildResponse({ parsed: JSON.parse(ready), body: { accumulated_idea: completeIdea } }).next_step, 'specifications');
  const inventedEvidence = JSON.parse(ready);
  inventedEvidence.coverage.world_context.evidence = '唐代长安';
  assert.equal(service.buildResponse({ parsed: inventedEvidence, body: { accumulated_idea: completeIdea } }).idea_ready, false, '不在用户累计设想中的证据不得放行');
  const genericEvidence = JSON.parse(ready);
  genericEvidence.coverage.world_context.evidence = '古代';
  genericEvidence.coverage.visual_direction.evidence = '电影感';
  assert.equal(service.buildResponse({ parsed: genericEvidence, body: { accumulated_idea: `${completeIdea} 古代 电影感` } }).idea_ready, false, '宽泛时代和视觉词不得冒充可执行制作方向');

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
  assert.match(css, /brief-quick-actions button\{[^}]*font-size:11px/, '快捷选择按钮不得继承平台大字号');
  assert.match(css, /brief-send\{[^}]*font-size:12px/, '发送按钮必须使用紧凑字号');
  assert.match(css, /view-host\.brief-dialogue-view/);
  assert.match(css, /padding-block:26px 0/, '立项页底部不得保留无内容的装饰空白');
  assert.match(css, /border-radius:20px 20px 0 0/, '铺满视口底部时不得保留悬浮卡片式底部圆角');
  assert.match(briefViewSource, /briefDialogueAssist\(\(\) => createdProjectId\)/);
  assert.match(dialogueRuntimeSource, /mode: 'brief_dialogue'/);
  assert.match(storyService, /briefDialogueAssist\.run\(\{ body, modelGateway, taskId \}\)/);
  assert.doesNotMatch(storyService, /briefDialogueAssist\.validateRaw/, '对话模型与 JSON 修复接线必须下沉到独立服务');

  console.log(JSON.stringify({ passed: true, checks: 28, scope: 'story-ad-dialogue-assist-v107', real_model_calls: 0 }));
}

try { main(); } catch (error) { console.error(error); process.exit(1); }
