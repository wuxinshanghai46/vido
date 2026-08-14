const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-reference-confirmation-'));
process.env.OUTPUT_DIR = tempRoot;

const storyAd = require('../src/services/newStoryAd');
const confirmation = require('../src/services/storyAdWorkspace/referenceUnderstandingConfirmationService');
const storage = require('../src/services/newStoryAd/storageService');
const taskSync = require('../src/services/newStoryAd/referenceAnalysisTaskSyncService');
const assetPlan = require('../src/services/newStoryAd/assetPlanService');
const projectBundles = require('../src/services/storyAdWorkspace/projectBundleService');
const authorityRepair = require('./repair-story-ad-reference-authority');
const authoritativeReference = require('../src/services/storyAdWorkspace/authoritativeReferenceProjectionService');
const referenceVideoAnalyses = require('../src/services/newStoryAd/referenceVideoAnalysisService');

function analysis(id, subject) {
  return {
    id,
    analysis_id: id,
    schema_version: 6,
    status: 'completed',
    progress: 100,
    completed_at: '2026-08-14T00:00:00.000Z',
    analysis_quality: { valid: true, visual_evidence_complete: true },
    source_facts: { product_or_service: subject, environment: '可见测试环境' },
    story_outline: { logline: `${subject} 完整故事` },
    plot_beats: [{ id: 'beat-1', action: '发生可见变化' }],
    scene_prompts: [{ id: 'scene-prompt-1', description: '可见测试环境' }],
    camera_intents: [{ id: 'camera-1', description: '固定机位' }],
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
      audio_visual: { ocr: [{ text: `${subject} 旧字幕`, evidence_refs: ['F001'] }] },
      completeness: { valid: true, story_complete: true, cause_chain_complete: true, failures: [] },
    },
  };
}

async function main() {
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
  assert.equal(authorityRepair.confirmationWasInvalidated({ wouldChange: true, beforeStatus: 'confirmed', afterStatus: 'stale' }), true);
  assert.equal(authorityRepair.confirmationWasInvalidated({ wouldChange: true, beforeStatus: 'confirmed', afterStatus: 'unconfirmed' }), true,
    '修订服务删除旧确认时，unconfirmed 也属于安全失效状态');
  assert.equal(authorityRepair.confirmationWasInvalidated({ wouldChange: true, beforeStatus: 'confirmed', afterStatus: 'confirmed' }), false,
    '指纹变化后仍 confirmed 必须触发修复失败');

  assert.throws(() => confirmation.confirm(task.id, retail, {
    analysis_id: 'analysis-retail', base_revision: task.content_revision + 1, confirmation: 'authoritative_input',
  }), error => error.code === 'REFERENCE_UNDERSTANDING_REVISION_CONFLICT');

  const incomplete = { reference_video_analysis: analysis('analysis-incomplete', '任意行业') };
  incomplete.reference_video_analysis.reference_understanding.causal_chain = [];
  assert.equal(confirmation.readiness(incomplete.reference_video_analysis).ready, false);
  assert.throws(() => confirmation.confirm(task.id, incomplete, {
    analysis_id: 'analysis-incomplete', base_revision: task.content_revision, confirmation: 'authoritative_input',
  }), error => error.code === 'REFERENCE_UNDERSTANDING_INCOMPLETE');

  const syncTask = storyAd.createTask({ brief: '终态理解同步指纹测试', brief_source: 'user' }, owner).task;
  const oldTerminal = analysis('analysis-terminal-sync', '终态同步');
  const changedTerminal = JSON.parse(JSON.stringify(oldTerminal));
  changedTerminal.reference_understanding.audio_visual.ocr.push({
    text: '分析状态和进度不变时新增的 OCR 证据', evidence_refs: ['F002'],
  });
  storage.saveOutput(syncTask.id, 'context', {
    brief: '终态理解同步指纹测试',
    content: '终态理解同步指纹测试',
    brief_source: 'user',
    reference_video_analysis: oldTerminal,
    reference_analysis_projection: { fingerprint: assetPlan.referenceProjectionFingerprint(changedTerminal) },
  }, { content_revision: syncTask.content_revision });
  const syncResult = await taskSync.syncTerminalAnalysis({ task_id: syncTask.id }, changedTerminal);
  const syncedContext = storage.getOutput(syncTask.id, 'context');
  assert.equal(syncResult.model_call_count, 0, '理解指纹同步不得调用模型');
  assert.equal(syncedContext.reference_video_analysis.reference_understanding.audio_visual.ocr.length, 2,
    '状态、进度和完成时间不变时，OCR/理解指纹变化仍必须同步到持久化 context');

  const bundleTask = storyAd.createTask({ project_name: '确认后 bundle 回读测试', brief: '确认后 bundle 回读测试' }, owner).task;
  const staleContextAnalysis = analysis('analysis-authoritative-snapshot', '旧投影');
  let authoritativeAnalysis = analysis('analysis-authoritative-snapshot', '权威投影');
  authoritativeAnalysis.task_id = bundleTask.id;
  authoritativeAnalysis.user_id = owner.id;
  storage.saveOutput(bundleTask.id, 'context', {
    ...(bundleTask.request || {}),
    reference_video_analysis: staleContextAnalysis,
  }, { content_revision: bundleTask.content_revision });
  const originalGet = referenceVideoAnalyses.get;
  const originalTaskRecord = referenceVideoAnalyses.taskRecord;
  try {
    referenceVideoAnalyses.get = () => authoritativeAnalysis;
    referenceVideoAnalyses.taskRecord = value => value;
    const authoritativeSnapshot = authoritativeReference.snapshot(
      storage.getTask(bundleTask.id),
      storage.getOutput(bundleTask.id, 'context'),
    );
    assert.equal(authoritativeSnapshot.source, 'analysis_record');
    const authoritativeSaved = confirmation.confirm(bundleTask.id, authoritativeSnapshot.context, {
      analysis_id: authoritativeAnalysis.id,
      base_revision: bundleTask.content_revision,
      confirmation: 'authoritative_input',
    }, { user: owner });
    assert.equal(authoritativeSaved.status, 'confirmed');
    const confirmedBundle = projectBundles.buildProjectBundle(bundleTask.id, { sections: 'summary,reference' });
    assert.equal(confirmedBundle.reference.understanding_confirmation.status, 'confirmed',
      '确认接口与 bundle 必须使用同一权威快照，确认后回读仍为 confirmed');

    authoritativeAnalysis = JSON.parse(JSON.stringify(authoritativeAnalysis));
    authoritativeAnalysis.reference_understanding.audio_visual.ocr.push({
      text: '确认后新增证据', evidence_refs: ['F003'],
    });
    const changedBundle = projectBundles.buildProjectBundle(bundleTask.id, { sections: 'summary,reference' });
    assert.equal(changedBundle.reference.understanding_confirmation.status, 'stale',
      '权威理解指纹真实变化后，旧确认必须变为 stale');
  } finally {
    referenceVideoAnalyses.get = originalGet;
    referenceVideoAnalyses.taskRecord = originalTaskRecord;
  }

  console.log(JSON.stringify({ passed: true, checks: 20, industry_hardcoding: false, repeat_paid_calls: 0 }));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
