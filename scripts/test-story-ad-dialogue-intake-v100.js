#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const asModule = source => import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

async function main() {
  const dialogueSource = read('public/story-ad/views/briefDialoguePanel.js')
    .replace(/^import[^\n]+\n/, 'const escapeHtml = value => String(value ?? "");\n');
  const dialogue = await asModule(dialogueSource);
  const explicitSettings = await asModule(read('public/story-ad/views/briefExplicitSettings.js'));
  const referenceQuestionSource = read('public/story-ad/views/briefReferenceQuestion.js');

  assert.deepEqual(
    explicitSettings.extractExplicitBriefSettings('做一条60秒、16:9横屏、4K清晰度的现代剧情短片'),
    { target_duration: 60, output_ratio: '16:9', video_resolution: '4K' },
    '用户明确写出的成片规格必须直接识别，不能再次逐项追问',
  );
  assert.deepEqual(
    explicitSettings.extractExplicitBriefSettings('做一条120秒9:16的中国古代真人实拍广告，史实写实，具体时期：唐朝，地区：中国长安'),
    {
      target_duration: 120,
      output_ratio: '9:16',
      world_family: 'chinese_historical',
      visual_medium: 'live_action',
      world_fidelity: 'historical_realism',
      world_period: '唐朝',
      world_region: '中国长安',
    },
    '用户明确写出的世界、媒介、真实度、时期和地区必须进入同一份确认数据',
  );
  assert.deepEqual(
    dialogue.dialogueIntakeState({ name: '完整项目', mode: 'narrative_story', idea: '完整剧情', ideaReady: true, referenceAttached: true }),
    { ready: true, missing: [], next: '' },
    '已经附加参考材料的完整输入不得重复追问参考材料',
  );
  assert.deepEqual(
    dialogue.dialogueIntakeState({ name: '无参考项目', mode: 'commercial_subject', idea: '完整广告要求', ideaReady: true, referenceSkipped: true }),
    { ready: true, missing: [], next: '' },
    '用户明确选择无参考材料后必须可以继续',
  );
  assert.deepEqual(
    dialogue.dialogueIntakeState({ name: '待补参考项目', mode: 'commercial_subject', idea: '完整广告要求', ideaReady: true }),
    { ready: false, missing: ['reference'], next: 'reference' },
    '只有参考材料尚未决定时才应追问参考入口',
  );
  assert.match(referenceQuestionSource, /data-reference-choice="upload"[^>]*>上传视频<\/button>/, '对话内必须提供上传参考视频入口');
  assert.match(referenceQuestionSource, /data-reference-choice="link"[^>]*>添加链接<\/button>/, '对话内必须提供参考链接入口');
  assert.match(referenceQuestionSource, /data-reference-choice="none"[^>]*>没有，继续<\/button>/, '对话内必须提供无参考继续入口');
  assert.match(dialogueSource, /conversation\.querySelector\('\[data-reference-question\]'\)/, '同一次对话不得重复插入参考问题');
  assert.match(dialogueSource, /referenceAttached \|\| referenceSkipped/, '已附参考或已明确跳过时不得再次追问');
  assert.doesNotMatch(dialogue.briefDialogueMarkup({ brief: {} }, { isNew: true }), /class="brief-message/, '新项目对话必须默认空白，由用户先发起');
  assert.deepEqual(
    dialogue.dialogueProgressState({ mode: 'narrative_story' }),
    { percent: 20, complete: { mode: true, idea: false, name: false, reference: false, confirm: false } },
    '只选择内容类型时必须是可解释的 20%，不得使用写死的 38%',
  );
  assert.deepEqual(
    dialogue.dialogueProgressState({ name: '项目', mode: 'narrative_story', idea: '完整内容', ideaReady: true, referenceSkipped: true }),
    { percent: 90, complete: { mode: true, idea: true, name: true, reference: true, confirm: false } },
    '确认前的立项准备度必须由五项明确权重计算',
  );

  const briefView = read('public/story-ad/views/briefView.js');
  assert.doesNotMatch(briefView, /<aside class="brief-side-column">/, '目标页不得保留独立高级配置侧栏');
  assert.doesNotMatch(briefView, /<h2>高级配置<\/h2>/, '目标页不得再把高级配置作为独立必经区域');
  assert.match(briefView, /<dialog class="brief-settings-modal"[\s\S]*参考材料与识别信息[\s\S]*<\/dialog>/, '可选精调项必须收进手动设置 modal');
  assert.doesNotMatch(briefView, /<details[^>]*data-brief-settings/, '手动设置不得继续以内联 details 占用页面高度');

  console.log(JSON.stringify({ passed: true, checks: 17, scope: 'story-ad-dialogue-intake-v100', model_calls: 0 }));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
