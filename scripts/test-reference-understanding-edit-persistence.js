'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-reference-edit-persistence-'));
process.env.OUTPUT_DIR = tempRoot;

const storyAd = require('../src/services/newStoryAd');
const edits = require('../src/services/newStoryAd/referenceUnderstandingEditService');
const confirmations = require('../src/services/storyAdWorkspace/referenceUnderstandingConfirmationService');

function reference() {
  return {
    schema_version: 6,
    analysis_id: 'analysis-persist-1',
    status: 'completed', progress: 100,
    analysis_quality: { valid: true, visual_evidence_complete: true },
    source_facts: { product_or_service: '定制家具', environment: '住宅空间' },
    story_outline: { logline: '家具改造故事' },
    plot_beats: [{ range: [0, 3], purpose: '发现问题' }],
    scene_prompts: [{ id: 'scene-1', environment: '住宅空间' }],
    camera_intents: [{ id: 'camera-1', movement: 'push in' }],
    character_prompts: [{ id: 'character-1', role: '屋主' }],
    reference_understanding: {
      contract_version: 'reference-understanding-v6', schema_version: 6,
      story_summary: { logline: '旧故事', full_synopsis: '屋主发现问题，选择定制家具并完成安装，最终确认空间更实用。' },
      causal_chain: [{ subject: '屋主', action: '选择方案', result: '完成安装', evidence_refs: ['F001'] }],
      characters: [{ character_id: 'character-1', role: '屋主', evidence_refs: ['F001'] }],
      scenes: [{ scene_id: 'scene-1', narrative_function: '承载改造过程', evidence_refs: ['F001'] }],
      brand_role: { subject: '定制家具', story_function: '解决空间问题', visible_claims: ['适配空间'] },
      audio_visual: { alignments: [] }, facts: [], inferences: [], unknowns: [],
      completeness: { valid: true, story_complete: true, cause_chain_complete: true, failures: [] },
    },
  };
}

try {
  const owner = { id: 'reference-editor-owner' };
  const task = storyAd.createTask({ project_name: '参考内容编辑持久化', brief: '用户手填广告目标', brief_source: 'user' }, owner).task;
  const base = reference();
  const attached = storyAd.updateTaskRequest(task.id, {
    reference_video_analysis: base,
    base_content_revision: task.content_revision,
  }, owner);
  const confirmed = confirmations.confirm(task.id, attached.context, {
    analysis_id: base.analysis_id,
    base_revision: attached.content_revision,
    confirmation: 'authoritative_input',
  }, { user: owner });
  assert.equal(confirmed.status, 'confirmed');
  const edited = edits.createOverride(base, null, {
    tab: 'overview', base_edit_revision: 0,
    fields: { 'reference_understanding.story_summary.logline': '用户修正后的家具改造故事' },
  }, { user: owner });
  const updated = storyAd.updateTaskRequest(task.id, {
    reference_video_analysis: edited.reference,
    reference_understanding_override: edited.override,
    base_content_revision: attached.content_revision,
  }, owner, { referenceUnderstandingEdit: true });

  assert.equal(updated.context.reference_understanding_override.edit_revision, 1);
  assert.equal(updated.context.reference_video_analysis.reference_understanding.user_edit_revision, 1, '上下文摘要必须保留用户修订版本');
  assert.equal(updated.context.reference_video_analysis.reference_understanding.story_summary.logline, '用户修正后的家具改造故事');
  assert.equal(updated.context.brief, '用户手填广告目标', '参考内容编辑不得覆盖已有用户广告目标');
  assert.equal(updated.context.brief_source, 'user');
  assert.equal(updated.content_revision, attached.content_revision + 1, '同一分析内的语义修订必须提升项目内容版本');
  assert.ok(updated.changed_domains.includes('source'), '参考内容修订必须进入 source 变更域');
  assert.ok(updated.invalidated_outputs.includes('blueprint'), '参考内容修订必须失效旧剧情等下游产物');
  assert.notEqual(confirmations.inspect(task.id, updated.context).status, 'confirmed', '用户修订后旧确认必须失效');
  assert.doesNotThrow(() => storyAd.updateTaskRequest(task.id, {
    ...updated.context,
    base_content_revision: updated.content_revision,
    save_progress: true,
  }, owner), '自动保存原样带回现存修订时必须允许');
  assert.throws(() => storyAd.updateTaskRequest(task.id, {
    reference_understanding_override: { ...edited.override, edit_revision: 99 },
  }, owner), error => error.code === 'REFERENCE_UNDERSTANDING_OVERRIDE_FORBIDDEN');

  console.log(JSON.stringify({ passed: true, checks: 12, content_revision: updated.content_revision, invalidated_outputs: updated.invalidated_outputs.length, model_call_count: 0 }));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
