'use strict';

const storage = require('../src/services/newStoryAd/storageService');
const dossier = require('../src/services/newStoryAd/dossierCompositeService');

function taskIdFromArgs(argv = process.argv.slice(2)) {
  const positional = argv.find(value => value && !value.startsWith('--'));
  return String(process.env.VIDO_TASK_ID || positional || '').trim();
}

function active(task = {}) {
  return Boolean(task.active_generation_id) || ['queued', 'running', 'processing'].includes(String(task.status || '').toLowerCase());
}

async function main() {
  const taskId = taskIdFromArgs();
  const apply = process.argv.includes('--apply');
  const force = process.argv.includes('--force');
  if (!taskId) throw new Error('Usage: node scripts/repair-story-ad-wearable-details.js <task-id> [--apply] [--force]');
  const task = storage.getTask(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  if (apply && active(task)) throw new Error('Task has an active generation; repair stopped.');
  const context = storage.getOutput(taskId, 'context') || {};
  const personAsset = context.person_asset && typeof context.person_asset === 'object' ? context.person_asset : null;
  if (!personAsset) throw new Error('Task has no person asset.');
  const castAssets = Array.isArray(personAsset.cast_assets) && personAsset.cast_assets.length
    ? personAsset.cast_assets
    : [personAsset];
  const candidates = castAssets.map((asset, index) => ({
    index,
    id: String(asset.id || asset.actor_asset_id || asset.actor_id || `person-${index + 1}`),
    atomic_count: Array.isArray(asset.atomic_assets) ? asset.atomic_assets.length : 0,
    existing_count: Array.isArray(asset.accessory_details) ? asset.accessory_details.length : 0,
    wardrobe_count: Array.isArray(asset.wardrobe_details?.items) ? asset.wardrobe_details.items.length : 0,
  })).filter(item => item.atomic_count > 0 && (force || item.existing_count === 0 || item.wardrobe_count === 0));
  const modelCallsBefore = storage.getTaskBundle(taskId).model_calls.length;
  if (!apply) {
    console.log(JSON.stringify({ task_id: taskId, apply: false, force, candidates, model_calls: modelCallsBefore }));
    return;
  }
  const nextCastAssets = castAssets.slice();
  const repaired = [];
  for (const candidate of candidates) {
    const asset = nextCastAssets[candidate.index];
    const revision = Math.max(1, Number(asset.person_revision || asset.revision || 1) || 1);
    const details = await dossier.composeWearableDetails({
      taskId,
      assetId: candidate.id,
      anchor: asset.approved_anchor || asset.anchor || {},
      atomicAssets: asset.atomic_assets || [],
      revision,
    });
    const wardrobeDetails = await dossier.composeWardrobeDetails({
      taskId,
      assetId: candidate.id,
      anchor: asset.approved_anchor || asset.anchor || {},
      atomicAssets: asset.atomic_assets || [],
      revision,
    });
    if (details.length !== 4) throw new Error(`Expected 4 wearable details for ${candidate.id}, got ${details.length}`);
    if (wardrobeDetails.length !== 4) throw new Error(`Expected 4 wardrobe details for ${candidate.id}, got ${wardrobeDetails.length}`);
    nextCastAssets[candidate.index] = {
      ...asset,
      accessory_details: details,
      wardrobe_details: {
        ...(asset.wardrobe_details || {}),
        source: 'finished_atomic_asset_local_crops',
        description: asset.subject_profile?.wardrobeText || asset.wardrobe_details?.description || '',
        items: wardrobeDetails,
        model_call_count: 0,
      },
    };
    repaired.push({
      asset_id: candidate.id,
      accessory_count: details.length,
      accessory_keys: details.map(item => item.key),
      wardrobe_count: wardrobeDetails.length,
      wardrobe_keys: wardrobeDetails.map(item => item.key),
    });
  }
  if (repaired.length) {
    const nextPersonAsset = Array.isArray(personAsset.cast_assets) && personAsset.cast_assets.length
      ? { ...personAsset, cast_assets: nextCastAssets }
      : nextCastAssets[0];
    storage.saveOutput(taskId, 'context', { ...context, person_asset: nextPersonAsset });
  }
  const modelCallsAfter = storage.getTaskBundle(taskId).model_calls.length;
  if (modelCallsAfter !== modelCallsBefore) throw new Error(`Model call count changed: ${modelCallsBefore} -> ${modelCallsAfter}`);
  console.log(JSON.stringify({ task_id: taskId, apply: true, repaired, model_calls_before: modelCallsBefore, model_calls_after: modelCallsAfter }));
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
