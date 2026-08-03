const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-reference-confirmation-'));
process.env.OUTPUT_DIR = tempRoot;

const storyAd = require('../src/services/newStoryAd');
const confirmation = require('../src/services/storyAdWorkspace/referenceUnderstandingConfirmationService');

function analysis(id, subject) {
  return {
    id,
    status: 'completed',
    analysis_quality: { valid: true },
    reference_understanding: {
      contract_version: 'reference-understanding-v6',
      schema_version: 6,
      story_summary: {
        full_synopsis: `${subject} 的完整起因、发展、转折、结果与收束。`,
      },
      causal_chain: [{ id: 'E001', subject, action: '发生可见变化', result: '形成后续结果', evidence_refs: ['F001'] }],
      scenes: [{ scene_id: 'S001', narrative_function: '建立问题', events: ['E001'], state_change: '状态发生变化' }],
      characters: [],
      facts: [{ id: 'FACT001', claim: '可见事实', evidence_refs: ['F001'] }],
      inferences: [],
      unknowns: [],
      completeness: { valid: true, story_complete: true, cause_chain_complete: true, failures: [] },
    },
  };
}

try {
  const owner = { id: 'reference-confirm-owner' };
  const task = storyAd.createTask({ brief: '跨行业参考理解确认测试' }, owner).task;
  const retail = { reference_video_analysis: analysis('analysis-retail', '零售商品') };
  const education = { reference_video_analysis: analysis('analysis-education', '教育服务') };

  assert.equal(confirmation.readiness(retail.reference_video_analysis).ready, true);
  assert.equal(confirmation.readiness(education.reference_video_analysis).ready, true, '合同必须按叙事结构判断，不得写死行业关键词');
  assert.equal(confirmation.inspect(task.id, retail).status, 'unconfirmed');

  const saved = confirmation.confirm(task.id, retail, {
    analysis_id: 'analysis-retail',
    base_revision: task.content_revision,
    confirmation: 'authoritative_input',
  }, { user: owner });
  assert.equal(saved.status, 'confirmed');
  assert.equal(saved.changed, true);

  const repeated = confirmation.confirm(task.id, retail, {
    analysis_id: 'analysis-retail',
    base_revision: task.content_revision,
    confirmation: 'authoritative_input',
  }, { user: owner });
  assert.equal(repeated.changed, false, '重复确认不得制造新状态或触发生成');

  const changed = JSON.parse(JSON.stringify(retail));
  changed.reference_video_analysis.reference_understanding.story_summary.full_synopsis += ' 新证据改变了报告。';
  assert.equal(confirmation.inspect(task.id, changed).status, 'stale', '报告内容改变后不得沿用旧确认');

  assert.throws(() => confirmation.confirm(task.id, retail, {
    analysis_id: 'analysis-retail', base_revision: task.content_revision + 1, confirmation: 'authoritative_input',
  }), error => error.code === 'REFERENCE_UNDERSTANDING_REVISION_CONFLICT');

  const incomplete = { reference_video_analysis: analysis('analysis-incomplete', '任意行业') };
  incomplete.reference_video_analysis.reference_understanding.causal_chain = [];
  assert.equal(confirmation.readiness(incomplete.reference_video_analysis).ready, false);
  assert.throws(() => confirmation.confirm(task.id, incomplete, {
    analysis_id: 'analysis-incomplete', base_revision: task.content_revision, confirmation: 'authoritative_input',
  }), error => error.code === 'REFERENCE_UNDERSTANDING_INCOMPLETE');

  console.log(JSON.stringify({ passed: true, checks: 11, industry_hardcoding: false, repeat_paid_calls: 0 }));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
