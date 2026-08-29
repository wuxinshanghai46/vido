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
  'new_story_ad.storyboard_sketch', 'new_story_ad.keyframe',
];
const IMAGE_LABELS = [
  'Image · SZ', 'Image · WB', 'Image · DY',
  'Nano Banana · SZ', 'Nano Banana · WB', 'Nano Banana · DY',
];
const VIDEO_LABELS = ['Seedance · DY', 'Seedance · SZ', 'Seedance · WB'];
const labels = rows => rows.map(row => `${row.public_name} · ${row.provider_code}`);

for (const stage of IMAGE_STAGES) {
  const catalog = selection.catalog(stage);
  assert.equal(catalog.schema_version, 3);
  assert.deepEqual(labels(catalog.models), IMAGE_LABELS);
  assert(catalog.models.every(model => !model.provider_id && !model.provider_name && !model.model_id && !model.model_name));
  const imageSz = catalog.models.find(model => model.route === 'image-sz');
  assert.equal(catalog.default_selection, imageSz.available ? 'image-sz' : '');
}

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

const syntheticVideo = selection.publicRows('new_story_ad.video', [
  { route: 'deyunai/doubao-seedance-2-0-260128', available: true },
  { route: 'smscrw/doubao-seedance-2-0-260128', available: true },
  { route: 'webang-seedance/doubao-seedance-2-0-260128', available: true },
]);
assert.deepEqual(labels(syntheticVideo), VIDEO_LABELS);

const image = selection.applySelection('new_story_ad.scene_asset', { image_model: 'image-sz' });
const nano = selection.applySelection('new_story_ad.scene_asset', { image_model: 'nano-dy' });
const video = selection.applySelection('new_story_ad.video', { video_model_route: 'seedance-dy' });
assert.equal(image.image_model, 'smscrw/gpt-image-2');
assert.equal(nano.image_model, 'deyunai/gemini-2.5-flash-image');
assert.equal(video.video_model_route, 'deyunai/doubao-seedance-2-0-260128');
assert.equal(image.single_attempt, true);
assert.equal(nano.max_scene_retries, 0);
assert.throws(() => selection.applySelection('new_story_ad.scene_asset', { image_model: 'smscrw/gpt-image-2' }), error => error.code === 'MEDIA_GENERATION_MODEL_SELECTION_INVALID');
assert.throws(() => selection.applySelection('new_story_ad.scene_asset', { image_model: 'seedream' }), error => error.code === 'MEDIA_GENERATION_MODEL_SELECTION_INVALID');

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

const picker = fs.readFileSync(path.join(__dirname, '..', 'public/story-ad/views/generationModelPicker.js'), 'utf8');
assert(picker.includes('model.provider_code'));
assert(picker.includes('catalog.default_selection'));
assert(!picker.includes('generationProviderInitials'));

console.log(JSON.stringify({
  passed: true, image_stages: IMAGE_STAGES.length, image_choices: IMAGE_LABELS,
  default_image: 'Image · SZ', video_choices: VIDEO_LABELS, default_video: 'Seedance · DY',
  raw_provider_routes_rejected: true, migration_idempotent: true, provider_calls: 0,
}));
