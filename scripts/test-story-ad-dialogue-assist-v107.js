#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const service = require('../src/services/newStoryAd/briefDialogueAssistService');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

async function main() {
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
  assert.match(service.systemPrompt(), /每轮只追问 1 个/);
  assert.match(service.systemPrompt(), /问询顺序必须连贯/);
  assert.match(service.systemPrompt(), /suggested_answers/);
  assert.match(service.systemPrompt(), /不得是“继续补充”“都可以”“其他”/);
  assert.match(service.systemPrompt(), /不能等用户反问才意识到/);
  assert.match(service.systemPrompt('【动态检索到的知识】导演提问方法'), /只用于改善提问方法/);
  assert.match(service.systemPrompt('【动态检索到的知识】导演提问方法'), /不得照搬其中案例/);

  const incomplete = JSON.stringify({
    reply: '这个故事的主要人物分别是谁？',
    question_topic: 'subject_identity',
    idea_ready: false,
    missing_topics: ['主要人物', '关键事件'],
    next_step: 'idea_details',
    suggested_answers: ['先讲两人的关系', '先讲冲突如何发生', '先讲最后的结局'],
    coverage: {},
  });
  assert.equal(service.validateRaw(incomplete), true);
  const incompleteResponse = service.buildResponse({ parsed: JSON.parse(incomplete), modelResult: { used_model: 'stub' }, body: { accumulated_idea: '我想做剧情短片' } });
  assert.equal(incompleteResponse.idea_ready, false);
  assert.deepEqual(incompleteResponse.missing_topics, ['主要人物']);
  assert.deepEqual(incompleteResponse.suggested_answers, ['先讲两人的关系', '先讲冲突如何发生', '先讲最后的结局']);
  assert.equal(incompleteResponse.next_step, 'idea_details');
  assert.deepEqual(incompleteResponse.model_meta, { used_model: 'stub', fallback_used: undefined, failed_models: undefined });
  assert.deepEqual(incompleteResponse.coverage, {
    subject: { status: 'missing', evidence: '' }, structure: { status: 'missing', evidence: '' },
    audience_intent: { status: 'missing', evidence: '' }, world_context: { status: 'missing', evidence: '' },
    visual_direction: { status: 'missing', evidence: '' },
  });

  const completeIdea = '林夏与周远在雨夜车站告别；两人从重逢到互相释然；面向经历遗憾的年轻观众；当代上海雨夜；真人写实电影感';
  const ready = JSON.stringify({
    reply: '请选择成片时长、画幅和清晰度。',
    idea_ready: true,
    missing_topics: [],
    next_step: 'specifications',
    suggested_answers: [],
    coverage: {
      subject: { status: 'explicit', evidence: '林夏与周远' },
      structure: { status: 'explicit', evidence: '从重逢到互相释然' },
      audience_intent: { status: 'explicit', evidence: '经历遗憾的年轻观众' },
      world_context: { status: 'explicit', evidence: '当代上海雨夜' },
      visual_direction: { status: 'explicit', evidence: '真人写实电影感' },
    },
  });
  assert.equal(service.validateRaw(ready, { accumulatedIdea: completeIdea }), true);
  assert.equal(service.buildResponse({ parsed: JSON.parse(ready), body: { accumulated_idea: completeIdea } }).next_step, 'specifications');
  const inventedEvidence = JSON.parse(ready);
  inventedEvidence.coverage.world_context.evidence = '唐代长安';
  assert.equal(service.buildResponse({ parsed: inventedEvidence, body: { accumulated_idea: completeIdea } }).idea_ready, false, '不在用户累计设想中的证据不得放行');
  const genericEvidence = JSON.parse(ready);
  genericEvidence.coverage.world_context.evidence = '古代';
  genericEvidence.coverage.visual_direction.evidence = '电影感';
  assert.equal(service.buildResponse({ parsed: genericEvidence, body: { accumulated_idea: `${completeIdea} 古代 电影感` } }).idea_ready, false, '宽泛时代和视觉词不得冒充可执行制作方向');

  const crossEraIdea = `${completeIdea} 男女主从古代穿越千年到了现代`;
  const crossEra = service.buildResponse({ parsed: JSON.parse(ready), body: { accumulated_idea: crossEraIdea } });
  assert.equal(crossEra.idea_ready, false, '跨时代人物连续性未回答时不得进入规格');
  assert.deepEqual(crossEra.missing_topics, ['跨时代人物连续性']);
  assert.match(crossEra.dialogue_reply, /现代后.*长相和年龄怎么变化/);
  assert.equal(crossEra.suggested_answers.length, 3);
  assert.equal(service.impliedDecisionGap(`${crossEraIdea}，人物容貌基本不变，只改变服装与气质`), null, '用户回答人物连续性后不得重复追问');
  let impliedModelCalls = 0;
  const immediateCrossEra = await service.run({
    body: { accumulated_idea: crossEraIdea, user_message: '继续问需要确认的内容', content_mode: 'narrative_story' },
    modelGateway: { async generateText() { impliedModelCalls += 1; throw new Error('不应调用'); } },
  });
  assert.equal(impliedModelCalls, 0, '可确定的内容特有问题必须即时返回，不等待模型');
  assert.equal(immediateCrossEra.model_meta.deterministic, true);
  assert.match(immediateCrossEra.dialogue_reply, /现代后.*长相和年龄怎么变化/);
  assert.equal(immediateCrossEra.question_topic, 'character_continuity');

  const repeatedOpposition = JSON.stringify({
    reply: '目前最影响剧情的是古代线反派身份，你希望他是江湖仇家、邪派首领还是朝廷鹰犬？',
    question_topic: 'opposition',
    idea_ready: false,
    missing_topics: ['反派身份与动机'],
    next_step: 'idea_details',
    suggested_answers: ['江湖仇家', '邪派首领', '朝廷鹰犬'],
    coverage: {},
  });
  assert.equal(service.validateRaw(repeatedOpposition, { accumulatedIdea: '古代武侠故事', completedTopics: [] }), true);
  assert.equal(service.validateRaw(repeatedOpposition, { accumulatedIdea: '古代武侠故事，反派是江湖仇家', completedTopics: ['opposition'] }), false, '用户回答过的决策必须在模型候选校验阶段被拒绝');
  assert.equal(service.validateRaw(repeatedOpposition, { accumulatedIdea: '古代武侠故事', history: [{ role: 'assistant', content: JSON.parse(repeatedOpposition).reply }] }), false, '与最近一轮完全相同的助手回复不得再次展示');
  assert.equal(service.displayableReply('我记下了你的回答，接下来继续确认。'), false);
  assert.equal(service.displayableReply('你希望他们第一次相遇时是什么关系？'), true);
  assert.deepEqual(service.cleanTopics(['opposition', 'opposition', 'unknown']), ['opposition']);
  const missingTopic = JSON.stringify({ ...JSON.parse(repeatedOpposition), question_topic: '' });
  assert.equal(service.validateRaw(missingTopic, { accumulatedIdea: '古代武侠故事', completedTopics: [] }), true, '模型漏回稳定问题字段时应从实际问题语义补全，不应废弃整段专业回答');
  assert.equal(service.buildResponse({ parsed: JSON.parse(missingTopic), body: { accumulated_idea: '古代武侠故事' } }).question_topic, 'opposition');

  let capturedOptions = null;
  const fastResult = await service.run({
    body: { accumulated_idea: completeIdea, user_message: '就按真人写实电影感', content_mode: 'narrative_story' },
    modelGateway: { async generateText(options) { capturedOptions = options; return { text: ready, used_model: 'stub/flash', latency_ms: 12 }; } },
  });
  assert.equal(capturedOptions.stage, 'new_story_ad.brief_dialogue');
  assert.equal(capturedOptions.timeoutMs, 8000);
  assert.equal(capturedOptions.maxCandidates, 2);
  assert.deepEqual(capturedOptions.structuredOutput, { mode: 'json_object' });
  assert.equal(fastResult.next_step, 'specifications');
  assert.match(capturedOptions.systemPrompt, /动态检索到的知识|五类制作依据/, '导演对话必须把当前内容送入知识检索后形成系统上下文');
  const recovered = await service.run({
    body: { accumulated_idea: '男女主跨越千年相爱，反派是觊觎女主家族秘宝的权贵', user_message: '反派是觊觎女主家族秘宝的权贵', content_mode: 'narrative_story', completed_topics: ['opposition'] },
    modelGateway: { async generateText() { const error = new Error('invalid'); error.code = 'MODEL_ATTEMPTS_EXHAUSTED'; error.failed_models = ['one', 'two']; throw error; } },
  });
  assert.equal(recovered.question_topic, 'plot_trigger');
  assert.match(recovered.dialogue_reply, /第一次出手/);
  assert.doesNotMatch(recovered.dialogue_reply, /没有取得可靠|请补充最影响制作/);
  assert.doesNotMatch(recovered.dialogue_reply, /我记下了|我理解了|接下来/);
  assert.equal(recovered.model_meta.deterministic, true);
  const commercialIdea = '为不锈钢板材制作商业广告，突出耐刮和耐污，在设计师展厅展示产品细节';
  const commercialRecovered = await service.run({
    body: {
      accumulated_idea: commercialIdea,
      user_message: '设计师拿着样板展示，但不要加入人物故事',
      content_mode: 'commercial_subject',
      completed_topics: ['subject_identity'],
    },
    modelGateway: { async generateText() { const error = new Error('invalid'); error.code = 'MODEL_ATTEMPTS_EXHAUSTED'; throw error; } },
  });
  assert.equal(commercialRecovered.question_topic, 'subject_motivation');
  assert.match(commercialRecovered.dialogue_reply, /核心卖点/);
  assert.doesNotMatch(JSON.stringify(commercialRecovered), /两人的关系|感情|相爱|反派|秘宝|穿越/);
  const leakedCommercial = service.buildResponse({
    parsed: {
      reply: '冲突升级后，两人的关系怎么变化？',
      question_topic: 'plot_development',
      suggested_answers: ['一起追查，感情逐渐加深', '互相隐瞒，信任彻底破裂'],
      missing_topics: ['人物关系'],
      idea_ready: false,
      next_step: 'idea_details',
      coverage: {},
    },
    body: { accumulated_idea: commercialIdea, content_mode: 'commercial_subject' },
  });
  assert.equal(leakedCommercial.question_topic, 'subject_identity');
  assert.match(leakedCommercial.dialogue_reply, /产品或服务/);
  assert.doesNotMatch(JSON.stringify(leakedCommercial), /两人的关系|感情|相爱|反派|秘宝|穿越/);
  assert.equal(service.impliedDecisionGap(`${commercialIdea}，古代工艺与现代工厂对比`, [], 'commercial_subject'), null, '商业广告不得因古今画面对比触发剧情人物连续性问题');
  assert.match(service.systemPrompt('', 'commercial_subject'), /广告与剧情短片必须使用不同问询合同/);
  assert.match(service.systemPrompt('', 'commercial_subject'), /不能主动添加爱情或其它情感线/);
  const relationshipRecovery = service.recoveryResponse({ completed_topics: ['subject_identity'] });
  const motivationRecovery = service.recoveryResponse({ completed_topics: ['subject_identity', 'subject_relationship'] });
  assert.equal(relationshipRecovery.question_topic, 'subject_relationship');
  assert.equal(motivationRecovery.question_topic, 'subject_motivation');
  assert.notEqual(relationshipRecovery.dialogue_reply, motivationRecovery.dialogue_reply, '不同问题主题不得复用同一句恢复文案');
  const toneRecovery = service.recoveryResponse({ completed_topics: [...service.DIALOGUE_TOPICS].slice(0, 12) });
  assert.match(toneRecovery.dialogue_reply, /画面看起来/);
  assert.deepEqual(toneRecovery.suggested_answers, ['像真实电影一样自然', '画面柔美，有古风意境', '场面宏大，像传奇故事']);
  const reviewResult = service.buildResponse({ parsed: JSON.parse(ready), body: { accumulated_idea: completeIdea, specifications_confirmed: true, reference_skipped: true } });
  assert.equal(reviewResult.next_step, 'review', '规格与参考都完成后下一步必须由状态机确定，不能听从模型重复插入阶段');

  const dialogueSource = read('public/story-ad/views/briefDialoguePanel.js');
  const referenceDialogueStateSource = read('public/story-ad/views/briefReferenceDialogueState.js');
  const guidedResumeSource = read('public/story-ad/views/briefGuidedResume.js');
  const briefViewSource = read('public/story-ad/views/briefView.js');
  const dialogueRuntimeSource = read('public/story-ad/views/briefDialogueRuntime.js');
  const css = read('public/story-ad/dialogue-theme.css');
  const storyService = read('src/services/newStoryAd/storyAdService.js');
  assert.match(dialogueSource, /streamMessage/);
  assert.match(dialogueSource, /setTimeout\(resolve, 22\)/);
  assert.match(dialogueSource, /brief-thinking-dots/);
  assert.doesNotMatch(dialogueSource, /textNode\.textContent = '…'/);
  assert.doesNotMatch(dialogueSource, /这轮没有取得可靠的专业审阅结果/);
  assert.match(dialogueSource, /data-dialogue-reference title="添加参考材料">参考/);
  assert.match(dialogueSource, /data-reference-dialogue-status/);
  assert.match(referenceDialogueStateSource, /参考链接未能开始分析/);
  assert.match(referenceDialogueStateSource, /请求编号/);
  assert.match(briefViewSource, /syncReferenceDialogueStatus/);
  assert.match(briefViewSource, /读取与分析进度已显示在对话中/);
  assert.match(briefViewSource, /loadBundle\(createdProjectId, 'summary,reference'\)/, '新建项目添加链接前只允许读取摘要与参考域，不能让全量工作区阻断分析任务创建');
  assert.doesNotMatch(briefViewSource, /loadBundle\(createdProjectId, 'all'\)/, '链接创建前不得加载无关的人物、场景和分镜大域');
  assert.doesNotMatch(dialogueSource, /data-dialogue-reference title="添加参考材料">＋/);
  assert.doesNotMatch(dialogueSource, /我记下了/);
  assert.match(dialogueSource, /data-dialogue-expand/);
  assert.match(dialogueSource, /appendSuggestions/);
  assert.match(dialogueSource, /result\?\.suggested_answers/);
  assert.match(dialogueSource, /completed_topics: \[\.\.\.completedTopics\]/);
  assert.match(dialogueSource, /completedTopics\.add\(activeQuestionTopic\)/);
  assert.match(guidedResumeSource, /answers: \['真人实拍', '国风二维动画', '电影级三维动画'\]/);
  assert.doesNotMatch(guidedResumeSource, /克制而写实|诗意留白|宏大奇幻/);
  assert.match(dialogueSource, /dialogueProgressState/);
  assert.match(css, /resize:vertical/);
  assert.match(css, /@keyframes brief-thinking-wave/);
  assert.match(css, /\.brief-attach\{display:grid;place-items:center/);
  assert.match(css, /brief-quick-actions button\{[^}]*font-size:11px/, '快捷选择按钮不得继承平台大字号');
  assert.match(css, /brief-send\{[^}]*font-size:12px/, '发送按钮必须使用紧凑字号');
  assert.match(css, /view-host\.brief-dialogue-view/);
  assert.match(css, /padding-block:26px 0/, '立项页底部不得保留无内容的装饰空白');
  assert.match(css, /border-radius:20px 20px 0 0/, '铺满视口底部时不得保留悬浮卡片式底部圆角');
  assert.match(briefViewSource, /briefDialogueAssist\(\(\) => createdProjectId\)/);
  assert.match(dialogueRuntimeSource, /mode: 'brief_dialogue'/);
  assert.match(storyService, /briefDialogueAssist\.run\(\{ body, modelGateway, taskId \}\)/);
  assert.doesNotMatch(storyService, /briefDialogueAssist\.validateRaw/, '对话模型与 JSON 修复接线必须下沉到独立服务');

  console.log(JSON.stringify({ passed: true, checks: 76, scope: 'story-ad-dialogue-assist-v107', real_model_calls: 0 }));
}

main().catch(error => { console.error(error); process.exit(1); });
