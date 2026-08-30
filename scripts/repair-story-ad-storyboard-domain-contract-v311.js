#!/usr/bin/env node
'use strict';

const USAGE = 'Usage: node scripts/repair-story-ad-storyboard-domain-contract-v311.js <taskId> --shots 5,6 [--apply]';
const DOMAIN_FIELDS = ['scene_domain_contract', 'subject_count_contract', 'decisive_moment'];

function usage(message = '') {
  if (message) console.error(message);
  console.error(USAGE);
}

function parseArgs(argv = []) {
  let taskId = '';
  let shotsValue = '';
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || '').trim();
    if (!arg) continue;
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--shots') {
      shotsValue = String(argv[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (arg.startsWith('--shots=')) {
      shotsValue = arg.slice('--shots='.length).trim();
      continue;
    }
    if (arg.startsWith('-')) throw Object.assign(new Error(`未知参数：${arg}`), { code: 'INVALID_ARGUMENTS', exitCode: 2 });
    if (!taskId) taskId = arg;
    else throw Object.assign(new Error(`多余的位置参数：${arg}`), { code: 'INVALID_ARGUMENTS', exitCode: 2 });
  }
  const shots = [...new Set(shotsValue.split(/[,，\s]+/u)
    .map(value => Number(value))
    .filter(value => Number.isInteger(value) && value > 0))].sort((left, right) => left - right);
  if (!taskId || !shotsValue || !shots.length) {
    throw Object.assign(new Error(!taskId ? '缺少 taskId' : '缺少有效的 --shots 镜头编号'), {
      code: 'USAGE', exitCode: 2, showUsage: true,
    });
  }
  return { taskId, shots, apply };
}

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value = '', max = 160) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function shotNumber(shot = {}, index = 0) {
  return Number(shot.shot_index || shot.index || index + 1) || index + 1;
}

function imageUrl(image = {}) {
  return clean(image.image_url || image.imageUrl || image.url, 1600);
}

function domainProjection(shot = {}) {
  return {
    scene_domain_contract: shot.scene_domain_contract || null,
    subject_count_contract: shot.subject_count_contract || null,
    decisive_moment: clean(shot.decisive_moment, 900),
  };
}

function withoutDomainFields(shot = {}) {
  const result = { ...shot };
  DOMAIN_FIELDS.forEach(field => delete result[field]);
  return result;
}

function summarizeGate(state = {}) {
  return {
    ready: state.ready === true,
    total: Math.max(0, Number(state.total || 0) || 0),
    confirmed: Math.max(0, Number(state.confirmed || 0) || 0),
    missing_indexes: list(state.missing_indexes).map(Number).filter(Number.isFinite).sort((a, b) => a - b),
    stale_indexes: list(state.stale_indexes).map(Number).filter(Number.isFinite).sort((a, b) => a - b),
    stale_reasons: state.stale_reasons && typeof state.stale_reasons === 'object' ? state.stale_reasons : {},
  };
}

function projectedGate({ beforeGate, migratedShots, images, changedShotNumbers, lineage }) {
  const before = summarizeGate(beforeGate);
  const stale = new Set(before.stale_indexes);
  const reasons = Object.fromEntries(Object.entries(before.stale_reasons || {}).map(([key, value]) => [key, list(value)]));
  const imagesByShot = new Map(list(images).map(image => [Number(image.shot_index), image]));
  const legacyCompatibilityIndexes = [];
  const newlyStaleIndexes = [];

  migratedShots.forEach((shot, index) => {
    const number = shotNumber(shot, index);
    if (!changedShotNumbers.has(number)) return;
    const image = imagesByShot.get(number);
    if (!imageUrl(image)) return;
    const lineageVersion = Math.max(0, Number(image.lineage_schema_version || 0) || 0);
    const expectedFingerprints = lineageVersion >= 2
      ? [lineage.shotContractFingerprint(shot, index)]
      : [lineage.legacyShotContractFingerprint(shot, index), lineage.shotContractFingerprint(shot, index)];
    if (expectedFingerprints.includes(clean(image.shot_contract_fingerprint, 160))) {
      if (lineageVersion < 2) legacyCompatibilityIndexes.push(number);
      return;
    }
    if (!stale.has(number)) newlyStaleIndexes.push(number);
    stale.add(number);
    reasons[number] = [...new Set([...(reasons[number] || []), 'SHOT_CONTRACT_CHANGED'])];
  });

  const staleIndexes = [...stale].sort((a, b) => a - b);
  const confirmed = Math.max(0, before.total - before.missing_indexes.length - staleIndexes.length);
  return {
    ready: before.total > 0 && before.missing_indexes.length === 0 && staleIndexes.length === 0,
    total: before.total,
    confirmed,
    missing_indexes: before.missing_indexes,
    stale_indexes: staleIndexes,
    stale_reasons: reasons,
    newly_stale_indexes: newlyStaleIndexes.sort((a, b) => a - b),
    legacy_compatibility_indexes: [...new Set(legacyCompatibilityIndexes)].sort((a, b) => a - b),
  };
}

function sameNumbers(left = [], right = []) {
  const a = [...new Set(list(left).map(Number).filter(Number.isFinite))].sort((x, y) => x - y);
  const b = [...new Set(list(right).map(Number).filter(Number.isFinite))].sort((x, y) => x - y);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

async function main() {
  let cli;
  try {
    cli = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (error.showUsage || error.code === 'INVALID_ARGUMENTS') usage(error.message);
    process.exitCode = error.exitCode || 2;
    return;
  }

  // Imports are intentionally deferred until after CLI validation so a usage-only
  // dry run cannot initialize storage or any project runtime.
  const storage = require('../src/services/newStoryAd/storageService');
  const scenePlanningAuthority = require('../src/services/newStoryAd/scenePlanningAuthorityService');
  const sceneDomainContract = require('../src/services/newStoryAd/sceneDomainContractService');
  const lineage = require('../src/services/newStoryAd/storyboardImageLineageService');
  const imageGate = require('../src/services/storyAdWorkspace/storyboardImageConfirmationGateService');

  const task = storage.getTask(cli.taskId);
  if (!task) throw Object.assign(new Error('项目不存在'), { code: 'TASK_NOT_FOUND', exitCode: 3 });
  if (cli.apply && task.active_generation_id) {
    throw Object.assign(new Error('当前任务存在活动生成，已拒绝并发迁移'), {
      code: 'ACTIVE_GENERATION_BLOCKED', exitCode: 4,
    });
  }

  const beforeShots = list(storage.getOutput(cli.taskId, 'storyboard_table'));
  if (!beforeShots.length) throw Object.assign(new Error('权威 storyboard_table 为空'), {
    code: 'STORYBOARD_TABLE_EMPTY', exitCode: 4,
  });
  const contextOutput = storage.getOutput(cli.taskId, 'context');
  const context = contextOutput && typeof contextOutput === 'object' ? contextOutput : (task.request || {});
  const storedSceneAssets = storage.getOutput(cli.taskId, 'scene_assets');
  const rawSceneAssets = list(storedSceneAssets).length ? list(storedSceneAssets) : list(context.scene_assets);
  const sceneConfig = storage.getOutput(cli.taskId, 'scene_config') || context.scene_config || context.scene_plan || {};
  const overrides = storage.getOutput(cli.taskId, 'scene_world_overrides') || {};
  const sceneAssets = scenePlanningAuthority.enrichSceneAssets(rawSceneAssets, sceneConfig, context, overrides);
  const sceneById = new Map(sceneAssets.map((asset, index) => [scenePlanningAuthority.idOf(asset, index), asset]));

  const shotRows = beforeShots.map((shot, index) => ({ shot, index, number: shotNumber(shot, index) }));
  const duplicateNumbers = shotRows.filter((row, index, rows) => rows.findIndex(other => other.number === row.number) !== index)
    .map(row => row.number);
  if (duplicateNumbers.length) throw Object.assign(new Error(`storyboard_table 存在重复镜头编号：${[...new Set(duplicateNumbers)].join('、')}`), {
    code: 'DUPLICATE_SHOT_INDEX', exitCode: 4,
  });
  const shotByNumber = new Map(shotRows.map(row => [row.number, row]));
  const missingSelected = cli.shots.filter(number => !shotByNumber.has(number));
  if (missingSelected.length) throw Object.assign(new Error(`没有找到选中镜头：${missingSelected.join('、')}`), {
    code: 'SELECTED_SHOT_NOT_FOUND', exitCode: 4, details: { missing_shot_indexes: missingSelected },
  });

  const selected = new Set(cli.shots);
  const migrations = new Map();
  shotRows.forEach(row => {
    if (!selected.has(row.number)) return;
    const sceneId = clean(row.shot.scene_id || row.shot.scene_asset_id, 120);
    const sceneAsset = sceneById.get(sceneId);
    if (!sceneId || !sceneAsset) throw Object.assign(new Error(`第 ${row.number} 镜缺少有效权威场景绑定：${sceneId || '空'}`), {
      code: 'SCENE_AUTHORITY_MISSING', exitCode: 4, details: { shot_index: row.number, scene_id: sceneId },
    });
    const planningContract = scenePlanningAuthority.contractForShot(sceneAsset, row.shot);
    const domainContract = sceneDomainContract.compile({
      shot: row.shot,
      sceneAsset,
      scenePlanningContract: planningContract,
      context,
    });
    if (!domainContract.fingerprint || !domainContract.decisive_moment || !domainContract.subject_counts) {
      throw Object.assign(new Error(`第 ${row.number} 镜的场景域合同编译不完整`), {
        code: 'SCENE_DOMAIN_CONTRACT_INCOMPLETE', exitCode: 4, details: { shot_index: row.number },
      });
    }
    migrations.set(row.index, {
      ...row.shot,
      scene_domain_contract: domainContract,
      subject_count_contract: domainContract.subject_counts,
      decisive_moment: domainContract.decisive_moment,
    });
  });

  const migratedShots = beforeShots.map((shot, index) => migrations.get(index) || shot);
  const changes = shotRows.filter(row => selected.has(row.number)).map(row => {
    const next = migratedShots[row.index];
    const fieldsChanged = DOMAIN_FIELDS.filter(field => (
      storage.canonicalFingerprint(domainProjection({ [field]: row.shot[field] })[field])
      !== storage.canonicalFingerprint(domainProjection({ [field]: next[field] })[field])
    ));
    return {
      shot_index: row.number,
      array_index: row.index,
      scene_id: clean(next.scene_id || next.scene_asset_id, 120),
      changed: fieldsChanged.length > 0,
      fields_changed: fieldsChanged,
      before: {
        scene_domain_contract_fingerprint: clean(row.shot.scene_domain_contract?.fingerprint, 160),
        subject_count_contract: row.shot.subject_count_contract || null,
        decisive_moment: clean(row.shot.decisive_moment, 900),
      },
      after: {
        scene_domain_contract_fingerprint: clean(next.scene_domain_contract?.fingerprint, 160),
        subject_count_contract: next.subject_count_contract || null,
        decisive_moment: clean(next.decisive_moment, 900),
      },
    };
  });
  const changedShotNumbers = new Set(changes.filter(change => change.changed).map(change => change.shot_index));
  const changedArrayIndexes = changes.filter(change => change.changed).map(change => change.array_index);

  const imagesBefore = list(storage.getOutput(cli.taskId, 'storyboard_images'));
  const imagesFingerprintBefore = storage.canonicalFingerprint(imagesBefore);
  const modelCallsBefore = list(storage.listModelCalls(cli.taskId)).length;
  const gateBefore = imageGate.inspect(cli.taskId);
  const projected = projectedGate({
    beforeGate: gateBefore,
    migratedShots,
    images: imagesBefore,
    changedShotNumbers,
    lineage,
  });

  let applied = false;
  if (cli.apply && changedShotNumbers.size) {
    storage.withWriteBatch(() => {
      storage.saveOutput(cli.taskId, 'storyboard_table', migratedShots);
    });
    applied = true;
  }

  const shotsAfter = list(storage.getOutput(cli.taskId, 'storyboard_table'));
  const imagesAfter = list(storage.getOutput(cli.taskId, 'storyboard_images'));
  const modelCallsAfter = list(storage.listModelCalls(cli.taskId)).length;
  const actualGate = cli.apply ? summarizeGate(imageGate.inspect(cli.taskId)) : null;
  const nonSelectedUnchanged = beforeShots.every((shot, index) => selected.has(shotNumber(shot, index))
    || storage.canonicalFingerprint(shot) === storage.canonicalFingerprint(shotsAfter[index]));
  const selectedOnlyDomainFieldsChanged = beforeShots.every((shot, index) => !selected.has(shotNumber(shot, index))
    || storage.canonicalFingerprint(withoutDomainFields(shot)) === storage.canonicalFingerprint(withoutDomainFields(shotsAfter[index])));
  const imagesUnchanged = imagesFingerprintBefore === storage.canonicalFingerprint(imagesAfter);
  const modelCallDelta = modelCallsAfter - modelCallsBefore;
  const staleMatch = !cli.apply || sameNumbers(projected.stale_indexes, actualGate?.stale_indexes || []);
  const safetyOk = nonSelectedUnchanged && selectedOnlyDomainFieldsChanged && imagesUnchanged && modelCallDelta === 0 && staleMatch;

  const report = {
    ok: safetyOk,
    task_id: cli.taskId,
    mode: cli.apply ? 'apply' : 'dry_run',
    applied,
    selected_shot_indexes: cli.shots,
    changed_shot_indexes: [...changedShotNumbers].sort((a, b) => a - b),
    unchanged_selected_shot_indexes: changes.filter(change => !change.changed).map(change => change.shot_index),
    changes,
    authority_sources: {
      storyboard_table: 'output:storyboard_table',
      scene_assets: list(storedSceneAssets).length ? 'output:scene_assets' : 'context.scene_assets',
      context: contextOutput && typeof contextOutput === 'object' ? 'output:context' : 'task.request',
      scene_config: storage.getOutput(cli.taskId, 'scene_config') ? 'output:scene_config' : 'context.scene_config_or_scene_plan',
      overrides: 'output:scene_world_overrides',
      enriched_scene_count: sceneAssets.length,
      assignment_revision: Math.max(0, Number(overrides.assignment_revision || 0) || 0),
    },
    image_gate: {
      before: summarizeGate(gateBefore),
      projected_after: projected,
      actual_after: actualGate,
      projected_actual_stale_match: staleMatch,
    },
    safety: {
      provider_calls_triggered: 0,
      paid_calls_triggered: 0,
      model_calls_before: modelCallsBefore,
      model_calls_after: modelCallsAfter,
      model_call_delta: modelCallDelta,
      storyboard_images_before: imagesBefore.length,
      storyboard_images_after: imagesAfter.length,
      storyboard_images_unchanged: imagesUnchanged,
      deleted_images: 0,
      delete_output_calls: 0,
      non_selected_shots_unchanged: nonSelectedUnchanged,
      selected_shots_only_domain_fields_changed: selectedOnlyDomainFieldsChanged,
      keyframe_contracts_updated: false,
      downstream_outputs_deleted: [],
    },
  };
  console.log(JSON.stringify(report, null, 2));
  if (!safetyOk) process.exitCode = 5;
}

main().catch(error => {
  console.error(JSON.stringify({
    ok: false,
    code: error.code || 'STORYBOARD_DOMAIN_CONTRACT_MIGRATION_FAILED',
    error: error.message,
    details: error.details || null,
    provider_calls_triggered: 0,
    paid_calls_triggered: 0,
  }, null, 2));
  process.exitCode = error.exitCode || 1;
});
