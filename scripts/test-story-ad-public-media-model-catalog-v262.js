#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const selection = require('../src/services/newStoryAd/mediaGenerationModelSelectionService');
const migration = require('./migrate-story-ad-public-media-models-v262');

const IMAGE_STAGES = [
  'new_story_ad.person_sheet', 'new_story_ad.person_dossier_atlas',
  'new_story_ad.prop_dossier_atlas', 'new_story_ad.product_asset',
  'new_story_ad.scene_asset', 'new_story_ad.scene_panorama',
  'new_story_ad.storyboard_image', 'new_story_ad.keyframe',
];
const IMAGE_LABELS = [
  'Image · SZ', 'Image · WB', 'Image · DY',
  'Nano Banana · SZ', 'Nano Banana · WB', 'Nano Banana · DY',
];
const VIDEO_LABELS = ['Seedance · DY', 'Seedance · SZ', 'Seedance · WB'];
const labels = rows => rows.map(row => `${row.public_name} · ${row.provider_code}`);
const configuredImage = selection.PUBLIC_MEDIA_CHOICES.image.map((choice, index) => ({
  route: choice.execution_route,
  provider_id: choice.execution_route.split('/')[0],
  model_id: choice.execution_route.split('/')[1],
  media_type: 'image',
  priority: index + 1,
  available: true,
}));
const configuredVideo = selection.PUBLIC_MEDIA_CHOICES.video.map((choice, index) => ({
  route: choice.execution_route,
  provider_id: choice.execution_route.split('/')[0],
  model_id: choice.execution_route.split('/')[1],
  media_type: 'video',
  priority: index + 1,
  available: true,
}));

for (const stage of IMAGE_STAGES) {
  const catalog = selection.publicCatalog(stage, configuredImage);
  assert.equal(catalog.schema_version, 3);
  assert.deepEqual(labels(catalog.models), IMAGE_LABELS);
  assert(catalog.models.every(model => !model.provider_id && !model.provider_name && !model.model_id && !model.model_name));
  assert.equal(catalog.default_selection, 'image-sz');
}
assert.throws(() => selection.publicCatalog('new_story_ad.story_flow_sketch', configuredImage), error => error.code === 'MEDIA_GENERATION_MODEL_STAGE_INVALID');

assert.deepEqual(selection.PUBLIC_MEDIA_CHOICES.image.map(choice => choice.execution_route), [
  'smscrw/gpt-image-2',
  'webang-maas/gpt-image-2',
  'deyunai/gpt-image-2',
  'smscrw/gemini-3.1-flash-image-preview',
  'webang-maas/gemini-2.5-flash-image',
  'deyunai/gemini-2.5-flash-image',
]);
assert.deepEqual(selection.PUBLIC_MEDIA_CHOICES.video.map(choice => choice.execution_route), [
  'deyunai/doubao-seedance-2-0-260128',
  'smscrw/doubao-seedance-2-0-260128',
  'webang-seedance/doubao-seedance-2-0-260128',
]);

const videoCatalog = selection.publicCatalog('new_story_ad.video', configuredVideo);
assert.deepEqual(labels(videoCatalog.models), VIDEO_LABELS);
assert.equal(videoCatalog.default_selection, 'seedance-dy');

const image = selection.applyResolvedSelection({}, selection.resolveSelection('new_story_ad.scene_asset', 'image-sz', configuredImage));
const nano = selection.applyResolvedSelection({}, selection.resolveSelection('new_story_ad.scene_asset', 'nano-dy', configuredImage));
const video = selection.applyResolvedSelection({}, selection.resolveSelection('new_story_ad.video', 'seedance-dy', configuredVideo));
assert.equal(image.image_model, 'smscrw/gpt-image-2');
assert.equal(nano.image_model, 'deyunai/gemini-2.5-flash-image');
assert.equal(video.video_model_route, 'deyunai/doubao-seedance-2-0-260128');
assert.equal(image.single_attempt, true);
assert.equal(nano.max_scene_retries, 0);
assert.throws(() => selection.resolveSelection('new_story_ad.scene_asset', 'smscrw/gpt-image-2', configuredImage), error => error.code === 'MEDIA_GENERATION_MODEL_SELECTION_INVALID');
assert.throws(() => selection.resolveSelection('new_story_ad.scene_asset', 'seedream', configuredImage), error => error.code === 'MEDIA_GENERATION_MODEL_SELECTION_INVALID');

const migrated = migration.desiredModels([
  { provider_id: 'smscrw', model_id: 'doubao-seedance-2-0-260128', priority: 1, enabled: true },
  { provider_id: 'deyunai', model_id: 'doubao-seedance-2-0-fast-260128', priority: 2, enabled: true },
]);
assert.deepEqual(migrated.slice(0, 3).map(migration.key), [
  'deyunai/doubao-seedance-2-0-260128',
  'smscrw/doubao-seedance-2-0-260128',
  'webang-seedance/doubao-seedance-2-0-260128',
]);
assert.deepEqual(migration.desiredModels(migrated), migrated);

let savedConfig = null;
const stageRows = {
  'new_story_ad.video': [
    { provider_id: 'smscrw', model_id: 'doubao-seedance-2-0-260128', priority: 1, enabled: true },
    { provider_id: 'deyunai', model_id: 'doubao-seedance-2-0-fast-260128', priority: 2, enabled: true },
  ],
  'new_story_ad.sound_generation': [
    { provider_id: 'smscrw', model_id: 'doubao-seedance-2-0-260128', priority: 1, enabled: true },
  ],
};
const migrationReport = migration.migrate({ apply: true, pipelineService: {
  getStageConfig: stage => stageRows[stage],
  getStageDefaults: () => [{ provider_id: 'volcengine', model_id: 'doubao-seedance-2-0-260128', enabled: false }],
  validateStageModel: () => ({ ok: true, reason: 'runnable' }),
  loadConfig: () => ({ stages: { untouched: [{ provider_id: 'x', model_id: 'y' }] } }),
  saveConfig: config => { savedConfig = config; },
} });
assert.equal(migrationReport.schema_version, 2);
assert(savedConfig?.stages?.untouched);
assert(savedConfig.stages['new_story_ad.video'].some(model => migration.key(model) === 'volcengine/doubao-seedance-2-0-260128'));
assert.throws(() => migration.migrate({ apply: true, pipelineService: {
  getStageConfig: stage => stageRows[stage],
  getStageDefaults: () => [],
  validateStageModel: () => ({ ok: false, reason: 'provider_auth_missing' }),
  loadConfig: () => { throw new Error('validation must happen before load'); },
  saveConfig: () => { throw new Error('validation must happen before save'); },
} }), error => error.code === 'PUBLIC_MEDIA_MODEL_MIGRATION_VALIDATION_FAILED');

const picker = fs.readFileSync(path.join(__dirname, '..', 'public/story-ad/views/generationModelPicker.js'), 'utf8');
assert(picker.includes('model.provider_code'));
assert(picker.includes('catalog.default_selection'));
assert(!picker.includes('generationProviderInitials'));

console.log(JSON.stringify({
  passed: true, image_stages: IMAGE_STAGES.length, image_choices: IMAGE_LABELS,
  default_image: 'Image · SZ', video_choices: VIDEO_LABELS, default_video: 'Seedance · DY',
  raw_provider_routes_rejected: true, migration_idempotent: true, migration_atomic: true, provider_calls: 0,
}));
