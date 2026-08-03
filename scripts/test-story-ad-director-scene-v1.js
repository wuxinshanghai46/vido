const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-director-scene-'));
process.env.OUTPUT_DIR = tempRoot;
const director = require('../src/services/storyAdWorkspace/directorSceneService');
const packs = require('../src/services/newStoryAd/shotReferencePackService');
const storage = require('../src/services/newStoryAd/storageService');

try {
  const taskId = 'director-scene-test-task';
  const world = {
    id: 'world-generic-1', revision: 3,
    source_asset: { source_revision: 7, image_url: '/assets/scene.jpg', layout_image_url: '/assets/layout.jpg' },
    zones: [{ id: 'zone-a', bounds: { x: 0, y: 0, width: 4, depth: 6 } }],
    cameras: [{ id: 'camera-a', lens: '50mm', pose: { position: [3, 2, 4], look_at: [0, 1, 0] } }],
  };
  const bundle = { assets: { people: [{ id: 'person-a', subject_id: 'person-a', revision: 2, name: '通用人物', image_url: '/assets/person.jpg' }], products: [{ id: 'product-a', revision: 4, image_url: '/assets/product.jpg' }] } };
  const initial = director.resolve(taskId, bundle, world, {});
  assert.strictEqual(initial.status, 'draft');
  assert.strictEqual(initial.entities.length, 2);
  const saved = director.save(taskId, bundle, world, {
    entities: initial.entities,
    cameras: initial.cameras,
    snapshots: [{ snapshot_id: 'snapshot-a', camera_id: 'camera-a', image_url: '/assets/director.png', sha256: 'abc123' }],
  }, { expected_revision: initial.revision });
  assert.strictEqual(saved.status, 'active_verified');
  assert.strictEqual(saved.revision, 2);
  assert.strictEqual(director.activeSnapshot(taskId, world.id, { source_revision: 7, camera_id: 'camera-a' }).image_url, '/assets/director.png');
  assert.strictEqual(director.activeSnapshot(taskId, world.id, { source_revision: 8 }), null, 'stale scene source may not reuse an old director snapshot');
  assert.throws(() => director.save(taskId, bundle, world, {}, { expected_revision: 1 }), error => error.code === 'DIRECTOR_SCENE_REVISION_CONFLICT' && error.current_director_revision === 2);
  const stale = director.resolve(taskId, bundle, { ...world, revision: 4 }, {});
  assert.strictEqual(stale.status, 'stale_input');
  assert.strictEqual(stale.compatibility_status, 'stale_source');

  const pack = packs.compile({
    taskId, shotIndex: 0,
    ctx: { person_asset: { native_masters: { face: { image_url: '/assets/native-face.jpg' } } }, assets: [{ type: 'product', image_url: '/assets/product.jpg' }] },
    shot: { id: 'shot-1', scene_id: world.id, camera_id: 'camera-a', characters: ['person-a'], visual: '人物展示商品' },
    contract: { fingerprint: 'contract-1' }, sceneAsset: { id: world.id, revision: 7 },
    sceneReference: '/assets/scene.jpg', includePerson: true, includeProduct: true, providerLimit: 4,
  });
  assert.strictEqual(pack.status, 'active_verified');
  assert.strictEqual(pack.references[0].role, 'director_composition');
  assert.strictEqual(pack.references[0].url, '/assets/director.png');
  assert(pack.references.some(reference => reference.url === '/assets/native-face.jpg'));
  assert.strictEqual(storage.getOutput(taskId, packs.OUTPUT_KIND)[0].fingerprint, pack.fingerprint);
  console.log(JSON.stringify({ passed: true, checks: 14, director_revision: saved.revision, compiled_references: pack.references.length, stale_source_blocked: true }));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
