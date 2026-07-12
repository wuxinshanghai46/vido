const storage = require('../src/services/newStoryAd/storageService');
const sceneAssets = require('../src/services/newStoryAd/sceneAssetService');

async function main() {
  const db = storage.readDb();
  const rows = (db.outputs || []).filter(row => row.kind === 'scene_assets' && Array.isArray(row.payload) && row.payload.length);
  const summary = { scanned_tasks: rows.length, migrated_tasks: 0, migrated_views: 0, failed_tasks: [] };
  for (const row of rows) {
    const remoteCount = row.payload.flatMap(asset => asset?.view_images || [])
      .filter(view => /^https?:\/\//i.test(String(view?.url || view?.image_url || ''))).length;
    if (!remoteCount) continue;
    try {
      const localized = await sceneAssets.localizeSceneAssets(row.payload, { taskId: row.task_id });
      sceneAssets.saveSceneAssetsToTask(row.task_id, localized);
      summary.migrated_tasks += 1;
      summary.migrated_views += remoteCount;
    } catch (error) {
      summary.failed_tasks.push({ task_id: row.task_id, error: String(error.message || error).slice(0, 300) });
    }
  }
  console.log(JSON.stringify(summary));
  if (summary.failed_tasks.length) process.exitCode = 1;
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
