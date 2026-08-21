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
  const specificationQuestionSource = read('public/story-ad/views/briefSpecificationQuestion.js');

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
  assert.equal(explicitSettings.isBriefConfirmationReply('按这个'), true, '规格确认短回答必须本地立即识别');
  assert.equal(explicitSettings.isNoReferenceReply('没有'), true, '无参考短回答必须本地立即识别');
  assert.equal(explicitSettings.isNoReferenceReply('女主没有选择复合'), false, '剧情内容中的否定句不得误判为无参考');
  assert.deepEqual(
    dialogue.dialogueIntakeState({ name: '完整项目', mode: 'narrative_story', idea: '完整剧情', ideaReady: true, specificationsConfirmed: true, referenceAttached: true }),
    { ready: true, missing: [], next: '' },
    '已经附加参考材料的完整输入不得重复追问参考材料',
  );
  assert.deepEqual(
    dialogue.dialogueIntakeState({ name: '无参考项目', mode: 'commercial_subject', idea: '完整广告要求', ideaReady: true, specificationsConfirmed: true, referenceSkipped: true }),
    { ready: true, missing: [], next: '' },
    '用户明确选择无参考材料后必须可以继续',
  );
  assert.deepEqual(
    dialogue.dialogueIntakeState({ name: '待补规格项目', mode: 'commercial_subject', idea: '完整广告要求', ideaReady: true }),
    { ready: false, missing: ['specifications'], next: 'specifications' },
    '核心内容完成后必须先确认成片规格，系统默认值不能直接放行',
  );
  assert.deepEqual(
    dialogue.dialogueIntakeState({ name: '待补参考项目', mode: 'commercial_subject', idea: '完整广告要求', ideaReady: true, specificationsConfirmed: true }),
    { ready: false, missing: ['reference'], next: 'reference' },
    '规格明确后且参考材料尚未决定时才应追问参考入口',
  );
  assert.match(specificationQuestionSource, /data-specification-choice="confirm"[^>]*>确认当前规格<\/button>/, '对话内必须提供成片规格确认入口');
  assert.match(specificationQuestionSource, /data-specification-choice="adjust"[^>]*>调整规格<\/button>/, '对话内必须提供成片规格修改入口');
  assert.match(referenceQuestionSource, /data-reference-choice="upload"[^>]*>上传视频<\/button>/, '对话内必须提供上传参考视频入口');
  assert.match(referenceQuestionSource, /data-reference-choice="link"[^>]*>添加链接<\/button>/, '对话内必须提供参考链接入口');
  assert.match(referenceQuestionSource, /data-reference-choice="none"[^>]*>没有，继续<\/button>/, '对话内必须提供无参考继续入口');
  assert.match(referenceQuestionSource, /产品实拍、品牌视觉、竞品视频或镜头节奏参考/, '商业参考问题必须结合商业内容类型');
  assert.match(referenceQuestionSource, /人物形象、时代氛围、影片画面或镜头参考/, '剧情参考问题必须结合剧情内容类型');
  assert.match(dialogueSource, /conversation\.querySelector\('\[data-reference-question\]'\)/, '同一次对话不得重复插入参考问题');
  assert.match(dialogueSource, /referenceAttached \|\| referenceSkipped/, '已附参考或已明确跳过时不得再次追问');
  assert.ok(dialogueSource.indexOf("intakeBefore.next === 'reference'") < dialogueSource.indexOf('const previous ='), '参考阶段的短回答必须在写入核心创意和模型调用前处理');
  assert.match(dialogueSource, /isNoReferenceReply\(text\)/, '“没有参考”必须走本地即时判断');
  assert.doesNotMatch(dialogue.briefDialogueMarkup({ brief: {} }, { isNew: true }), /class="brief-message/, '新项目对话必须默认空白，由用户先发起');
  assert.equal((dialogue.briefDialogueMarkup({ brief: {} }, { isNew: true }).match(/建议·待确认/g) || []).length, 3, '默认时长、画幅和清晰度都必须明确标为建议且等待确认');
  assert.equal((dialogue.briefDialogueMarkup({ brief: { brief_intake: { specifications_confirmed: true } } }).match(/用户已确认/g) || []).length, 3, '只有持久化的明确确认状态才能显示用户已确认');
  assert.match(dialogueSource, /specificationsConfirmed = String\(control\('specifications_confirmed'\)/, '已有项目不得按路由状态自动冒充规格已确认');
  assert.match(dialogueSource, /explicitSpecificationKeys\.size === explicitSettings\.OUTPUT_SETTING_KEYS\.length/, '只修改一项规格不得把整组规格标为确认');
  assert.deepEqual(
    dialogue.dialogueProgressState({ mode: 'narrative_story' }),
    { percent: 15, complete: { mode: true, idea: false, name: false, specifications: false, reference: false, confirm: false } },
    '只选择内容类型时必须是可解释的 15%，不得使用写死进度',
  );
  assert.deepEqual(
    dialogue.dialogueProgressState({ name: '项目', mode: 'narrative_story', idea: '完整内容', ideaReady: true, specificationsConfirmed: true, referenceSkipped: true }),
    { percent: 90, complete: { mode: true, idea: true, name: true, specifications: true, reference: true, confirm: false } },
    '确认前的立项准备度必须包含成片规格确认',
  );

  const briefView = read('public/story-ad/views/briefView.js');
  assert.doesNotMatch(briefView, /<aside class="brief-side-column">/, '目标页不得保留独立高级配置侧栏');
  assert.doesNotMatch(briefView, /<h2>高级配置<\/h2>/, '目标页不得再把高级配置作为独立必经区域');
  assert.match(briefView, /<dialog class="brief-settings-modal"[\s\S]*参考材料与识别信息[\s\S]*<\/dialog>/, '可选精调项必须收进手动设置 modal');
  assert.doesNotMatch(briefView, /<details[^>]*data-brief-settings/, '手动设置不得继续以内联 details 占用页面高度');

  console.log(JSON.stringify({ passed: true, checks: 30, scope: 'story-ad-dialogue-intake-v100', model_calls: 0 }));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
