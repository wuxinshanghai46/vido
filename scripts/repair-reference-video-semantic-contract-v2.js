#!/usr/bin/env node
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const referenceVideo = require('../src/services/newStoryAd/referenceVideoAnalysisService');
const storyAd = require('../src/services/newStoryAd');
const assetPlan = require('../src/services/newStoryAd/assetPlanService');
const storage = require('../src/services/newStoryAd/storageService');
const sqlite = require('../src/db/sqlite');

function arg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? String(process.argv[index + 1] || '') : fallback;
}

function copyIfExists(source, targetDir) {
  if (!source || !fs.existsSync(source)) return '';
  const target = path.join(targetDir, path.basename(source));
  fs.copyFileSync(source, target);
  return target;
}

function referenceTaskRecord(analysis = {}) {
  const result = analysis.result && typeof analysis.result === 'object' ? analysis.result : {};
  return {
    analysis_id: analysis.id || analysis.analysis_id || '',
    status: analysis.status || '',
    progress: Math.max(0, Math.min(100, Number(analysis.progress || 0) || 0)),
    phase: String(analysis.phase || '').trim(),
    started_at: analysis.started_at || '',
    updated_at: analysis.updated_at || '',
    completed_at: analysis.completed_at || '',
    failed_at: analysis.failed_at || '',
    cancelled_at: analysis.cancelled_at || '',
    checkpoints: Array.isArray(analysis.checkpoints) ? analysis.checkpoints.slice(-12) : [],
    source: analysis.source || null,
    error: analysis.error || null,
    visual_evidence_reusable: analysis.visual_evidence_reusable === true,
    semantic_result_reusable: analysis.semantic_result_reusable === true,
    schema_version: Number(result.schema_version || analysis.schema_version || 3) || 3,
    analysis_scope: result.analysis_scope || analysis.analysis_scope || 'reference_content_and_creative_structure',
    generated_brief: result.generated_brief || analysis.generated_brief || '',
    summary: result.summary || analysis.summary || '',
    source_facts: result.source_facts || analysis.source_facts || {},
    analysis_quality: result.analysis_quality || analysis.analysis_quality || {},
    story_outline: result.story_outline || analysis.story_outline || {},
    plot_beats: result.plot_beats || analysis.plot_beats || [],
    character_prompts: result.character_prompts || analysis.character_prompts || [],
    animal_prompts: result.animal_prompts || analysis.animal_prompts || [],
    scene_prompts: result.scene_prompts || analysis.scene_prompts || [],
    shot_breakdown: result.shot_breakdown || analysis.shot_breakdown || [],
    camera_intents: result.camera_intents || analysis.camera_intents || [],
    character_actions: result.character_actions || analysis.character_actions || [],
    animal_actions: result.animal_actions || analysis.animal_actions || [],
    prompt_suggestions: result.prompt_suggestions || analysis.prompt_suggestions || [],
    scene_view_mapping: analysis.scene_view_mapping || null,
    identity_extraction_allowed: false,
  };
}

function backupState(record, taskId) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const targetDir = path.resolve(process.env.OUTPUT_DIR || './outputs', 'backups', 'reference-semantic-v2', `${stamp}-${taskId}`);
  fs.mkdirSync(targetDir, { recursive: true });
  const files = [];
  files.push(copyIfExists(path.join(referenceVideo._private.analysisDir(record.user_id, record.id), 'record.json'), targetDir));
  files.push(copyIfExists(storage.DB_PATH, targetDir));
  const dbConfig = sqlite.getDbConfig();
  if (dbConfig.enabled) {
    files.push(copyIfExists(dbConfig.path, targetDir));
    files.push(copyIfExists(`${dbConfig.path}-wal`, targetDir));
    files.push(copyIfExists(`${dbConfig.path}-shm`, targetDir));
  }
  return { directory: targetDir, files: files.filter(Boolean) };
}

async function main() {
  const analysisId = arg('analysis');
  const taskId = arg('task');
  const userId = arg('user');
  const apply = process.argv.includes('--apply');
  const expectedPeople = arg('expect-people');
  const expectedAnimals = arg('expect-animals');
  if (!analysisId || !taskId || !userId) {
    throw new Error('用法：--analysis <ID> --task <ID> --user <ID> [--expect-people N] [--expect-animals N] --apply');
  }
  if (!apply) throw new Error('这是写操作；核对参数后必须显式添加 --apply。');
  const user = { id: userId };
  const task = storyAd.assertTaskOwner(taskId, user);
  if (String(task.active_generation_id || '').trim()) {
    throw new Error(`任务存在活动生成 ${task.active_generation_id}，已停止修复以避免并发覆盖。`);
  }
  const record = referenceVideo._private.readRecord(userId, analysisId);
  if (!record) throw new Error('参考视频分析记录不存在。');
  if (record.user_id !== userId) throw new Error('参考视频分析记录不属于目标用户。');

  const backup = backupState(record, taskId);
  const modelCallsBefore = storage.readDb().model_calls.length;
  const previousContext = storage.getOutput(taskId, 'context') || task.request || {};
  const previousScenePlan = storage.getOutput(taskId, 'scene_config');
  const rebuilt = await referenceVideo.rebuildStoredAnalysis(analysisId, user);
  const flattened = referenceTaskRecord(rebuilt);
  const currentTask = storage.getTask(taskId);
  const updated = storyAd.updateTaskRequest(taskId, {
    reference_video_analysis: flattened,
    brief: flattened.story_outline?.logline || flattened.summary || flattened.generated_brief,
    brief_source: 'reference_analysis',
    base_content_revision: currentTask.content_revision,
  }, user);
  const projection = await assetPlan.projectReferenceIntake(taskId, {
    previous_context: previousContext,
    existing_scene_plan: previousScenePlan,
    reference_analysis: flattened,
  });
  const scenePlan = await assetPlan.generate(taskId);
  const context = storage.getOutput(taskId, 'context') || updated.context;
  const modelCallsAfter = storage.readDb().model_calls.length;
  const result = {
    analysis_id: analysisId,
    task_id: taskId,
    backup,
    semantic_contract: rebuilt.semantic_contract_migration,
    analysis_quality_valid: rebuilt.result?.analysis_quality?.valid === true,
    human_count: Number(rebuilt.result?.source_facts?.human_count || 0),
    narrative_animal_presence: rebuilt.result?.source_facts?.narrative_animal_presence === true,
    character_prompt_count: rebuilt.result?.character_prompts?.length || 0,
    animal_prompt_count: rebuilt.result?.animal_prompts?.length || 0,
    projected_people: context.cast_profiles?.length || 0,
    projected_animals: context.pet_profiles?.length || 0,
    cast_mode: context.cast_mode,
    scene_count: scenePlan?.spaces?.length || 0,
    shot_count: flattened.shot_breakdown.length,
    projection_applied: projection.projected === true,
    model_call_delta: modelCallsAfter - modelCallsBefore,
  };
  if (expectedPeople !== '' && result.projected_people !== Number(expectedPeople)) {
    throw new Error(`人物数量核对失败：预期 ${expectedPeople}，实际 ${result.projected_people}。备份位于 ${backup.directory}`);
  }
  if (expectedAnimals !== '' && result.projected_animals !== Number(expectedAnimals)) {
    throw new Error(`动物数量核对失败：预期 ${expectedAnimals}，实际 ${result.projected_animals}。备份位于 ${backup.directory}`);
  }
  if (result.model_call_delta !== 0) {
    throw new Error(`修复期间出现 ${result.model_call_delta} 次模型调用；已停止并保留备份 ${backup.directory}`);
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
