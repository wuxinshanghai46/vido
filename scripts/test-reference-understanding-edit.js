'use strict';

const assert = require('assert');
const edits = require('../src/services/newStoryAd/referenceUnderstandingEditService');
const sync = require('../src/services/newStoryAd/referenceAnalysisTaskSyncService');

function baseReference() {
  return {
    analysis_id: 'analysis-edit-1',
    status: 'completed',
    progress: 100,
    analysis_quality: { valid: true },
    generated_brief: '旧广告目标',
    source_facts: { product_or_service: '定制家具', environment: '住宅空间' },
    story_outline: { logline: '旧故事' },
    plot_beats: [{ range: [0, 3], purpose: '旧事件' }],
    character_prompts: [{ id: 'character-1', role: '屋主' }],
    scene_prompts: [{ id: 'scene-1', camera_purpose: '建立环境' }],
    camera_intents: [{ id: 'camera-1', movement: 'push in', evidence_refs: ['F001'] }],
    reference_understanding: {
      story_summary: {
        narrative_mode: 'narrative_story',
        logline: '屋主发现旧家具不合用并完成改造。',
        short_synopsis: '发现问题并解决。',
        full_synopsis: '屋主先发现旧家具不合用，随后选择定制方案，安装后确认空间更实用。',
        trigger: '发现旧家具不合用',
        turning_point: '选择定制方案',
        climax: '完成安装',
        resolution: '确认空间更实用',
        brand_function: '帮助解决空间问题',
      },
      causal_chain: [{ id: 'event-1', subject: '屋主', action: '选择定制方案', motivation: '改善空间', result: '家具完成安装', evidence_refs: ['F001'] }],
      characters: [{ character_id: 'character-1', role: '屋主', narrative_function: '提出需求', initial_state: '不满意', final_state: '满意', evidence_refs: ['F001'] }],
      scenes: [{ scene_id: 'scene-1', narrative_function: '承载问题与结果', state_change: '从杂乱到整洁', evidence_refs: ['F001'] }],
      brand_role: { subject: '定制家具', story_function: '解决空间问题', visible_claims: ['按空间定制'], proof_moments: ['安装完成'], cta: '预约咨询', evidence_refs: ['F001'] },
      audio_visual: { alignments: [{ spoken_text: '让空间更合用', visual: '家具安装完成', function: '结果收束', evidence_refs: ['F001'] }] },
      inferences: [{ claim: '屋主希望提高空间利用率', reason: '根据选择和结果推断', evidence_refs: ['F001'] }],
      unknowns: [{ question: '具体预算是多少？' }],
      completeness: { valid: true },
    },
  };
}

const base = baseReference();
const first = edits.createOverride(base, null, {
  tab: 'overview',
  base_edit_revision: 0,
  fields: {
    'reference_understanding.story_summary.logline': '屋主通过定制家具把低效空间改造成舒适起居区。',
  },
}, { user: { id: 'editor-1' } });

assert.equal(first.edit_revision, 1);
assert.equal(first.changed_fields, 1);
assert.equal(first.reference.reference_understanding.story_summary.logline, '屋主通过定制家具把低效空间改造成舒适起居区。');
assert.equal(first.reference.reference_understanding.causal_chain[0].evidence_refs[0], 'F001', '用户修订不得丢失原始证据引用');
assert.equal(first.reference.reference_understanding.completeness.semantic_source, 'user_corrected');
assert.match(first.reference.generated_brief, /屋主先发现旧家具不合用/);
assert.equal(edits.applyOverride(base, first.override).generated_brief, first.reference.generated_brief, '相同权威分析必须稳定重放用户修订');

const changedBase = baseReference();
changedBase.reference_understanding.story_summary.logline = '新的权威分析';
assert.equal(edits.applyOverride(changedBase, first.override).reference_understanding.story_summary.logline, '新的权威分析', '新分析不得错误套用旧修订');

assert.throws(() => edits.createOverride(base, first.override, {
  tab: 'overview', base_edit_revision: 0,
  fields: { 'reference_understanding.story_summary.logline': '过期窗口内容' },
}), error => error.code === 'REFERENCE_UNDERSTANDING_EDIT_CONFLICT');

assert.throws(() => edits.createOverride(base, null, {
  tab: 'brand', base_edit_revision: 0,
  fields: { 'reference_understanding.story_summary.logline': '越权字段' },
}), error => error.code === 'REFERENCE_UNDERSTANDING_EDIT_FIELD_FORBIDDEN');

assert.throws(() => edits.createOverride(base, null, {
  tab: 'overview', base_edit_revision: 0,
  fields: { 'reference_understanding.story_summary.full_synopsis': '' },
}), error => error.code === 'REFERENCE_UNDERSTANDING_EDIT_INVALID');

const manualBriefPatch = sync.completionPatch({
  brief: '用户自己填写的广告目标',
  brief_source: 'user',
  reference_understanding_override: first.override,
}, base);
assert.equal(manualBriefPatch.brief, undefined, '参考修订不得覆盖用户手填广告目标');
assert.equal(manualBriefPatch.reference_video_analysis.reference_understanding.story_summary.logline, first.reference.reference_understanding.story_summary.logline);

const referenceBriefPatch = sync.completionPatch({
  brief: '旧识别目标',
  brief_source: 'reference_analysis',
  reference_understanding_override: first.override,
}, base);
assert.equal(referenceBriefPatch.brief, first.reference.generated_brief, '参考来源目标应随用户修订重新投影');

console.log(JSON.stringify({
  passed: true,
  checks: 15,
  edit_revision: first.edit_revision,
  changed_fields: first.changed_fields,
  model_call_count: 0,
}));
