'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const projection = require('../src/services/newStoryAd/sceneCheckpointProjectionService');
const sceneWorlds = require('../src/services/storyAdWorkspace/sceneWorldService');

const fiveViews = ['master', 'reverse', 'interaction', 'detail', 'layout']
  .map(key => ({ key, label: key, image_url: `/persisted-${key}.png`, url: `/persisted-${key}.png` }));
const projected = projection.projectSceneAssets([
  { kind: 'scene_config', payload: { spaces: [{ id: 'showroom', name: '现代展示厅' }] } },
  { kind: 'scene_assets', payload: [{ id: 'showroom', space_id: 'showroom', image_url: '/persisted-master.png', view_images: fiveViews }] },
  {
    kind: 'scene_asset_checkpoint:showroom',
    payload: {
      scene_id: 'showroom', status: 'review_required', metadata: { space_id: 'showroom', mode: 'repair' },
      views: {
        master: { status: 'succeeded', image_url: '/latest-master.png' },
        reverse: { status: 'succeeded', image_url: '/latest-reverse.png' },
        interaction: { status: 'succeeded', image_url: '/latest-interaction.png' },
        detail: { status: 'succeeded', image_url: '/latest-detail.png' },
        layout: { status: 'failed', error_code: 'PROVIDER_TIMEOUT', billing_state: 'not_submitted' },
      },
    },
  },
]);
assert.equal(projected.length, 1);
assert.equal(projected[0].view_images.length, 5, 'a failed repair checkpoint must not shrink persisted current-plan assets');
assert.equal(projected[0].view_images.find(view => view.key === 'layout').image_url, '/persisted-layout.png');
assert.equal(projected[0].view_images.find(view => view.key === 'master').image_url, '/latest-master.png');

const worlds = sceneWorlds.buildSceneWorlds({ assets: { scenes: [{
  id: 'showroom', name: '现代展示厅', view_images: fiveViews,
  cameras: [{ id: 'camera-master', label: '主机位' }, { id: 'camera-interaction', label: '互动机位' }],
}] } });
assert.equal(worlds[0].source_asset.layout_image_url, '/persisted-layout.png');
assert.deepEqual(worlds[0].cameras[0].pose.position, [], 'missing camera position must not become a fabricated circular coordinate');
assert.deepEqual(worlds[0].cameras[0].pose.look_at, [], 'missing look-at data must remain unplanned');
assert.equal(worlds[0].cameras[0].pose.planned, false);

const authoritySource = fs.readFileSync(path.join(root, 'public/story-ad/views/sceneWorldAuthorityPlan.js'), 'utf8');
const sandbox = { list: value => Array.isArray(value) ? value : [], esc: value => String(value ?? '') };
vm.runInNewContext(`${authoritySource.replace(/^import\s+.*?;\s*$/gm, '').replace(/\bexport\s+/g, '')}\nglobalThis.people=scenePeopleRows;`, sandbox);
const people = sandbox.people({ production_manifest: { character_world_matrix: [{
  character_id: 'person-1', name: '陈默', cells: [{ world_id: 'showroom', presence: 'confirmed', blocking_position: [0.4, 0.6], entry_point: [0.1, 0.9], route_points: [[0.2, 0.8]], exit_point: [0.9, 0.1] }],
}] } }, { id: 'showroom' });
assert.deepEqual({ x: people[0].position.x, y: people[0].position.y }, { x: 0.4, y: 0.6 });
assert.equal(people[0].routePoints.length, 1);

const viewSource = fs.readFileSync(path.join(root, 'public/story-ad/views/sceneWorldView.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/story-ad/workspace.css'), 'utf8');
assert.match(viewSource, /scene-world-layout-overlay/);
assert.match(viewSource, /showLayout\(layoutNode, 'structure'\)/);
assert.match(viewSource, /不显示伪造点/);
assert.doesNotMatch(viewSource, /mode === 'structure'\) return layoutNode \? showPhoto/);
assert.match(css, /scene-world-photo-strip\{display:grid/);
assert.doesNotMatch(css, /scene-world-photo-strip\{[^}]*overflow-x:auto/);
assert.match(css, /grid-template-columns:repeat\(auto-fit,minmax\(110px,1fr\)\)/);

console.log(JSON.stringify({
  passed: true,
  projected_views: projected[0].view_images.length,
  persisted_layout_restored: true,
  fabricated_camera_points: 0,
  responsive_thumbnail_grid: true,
  real_layout_overlay: true,
}, null, 2));
