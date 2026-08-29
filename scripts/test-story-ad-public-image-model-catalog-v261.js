#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const selection = require('../src/services/newStoryAd/mediaGenerationModelSelectionService');

const IMAGE_STAGES = [
  'new_story_ad.person_sheet', 'new_story_ad.person_dossier_atlas',
  'new_story_ad.prop_dossier_atlas', 'new_story_ad.product_asset',
  'new_story_ad.scene_asset', 'new_story_ad.scene_panorama',
  'new_story_ad.storyboard_sketch', 'new_story_ad.keyframe',
];

for (const stage of IMAGE_STAGES) {
  const catalog = selection.catalog(stage);
  assert.equal(catalog.schema_version, 2);
  assert.deepEqual(catalog.models.map(model => model.route), ['image', 'nano-banana']);
  assert.deepEqual(catalog.models.map(model => model.public_name), ['Image', 'Nano Banana']);
  assert(catalog.models.every(model => model.media_type === 'image'));
  assert(catalog.models.every(model => !model.provider_id && !model.provider_name && !model.model_id && !model.model_name));
}

const image = selection.applySelection('new_story_ad.scene_asset', { image_model: 'image' });
const nano = selection.applySelection('new_story_ad.scene_asset', { image_model: 'nano-banana' });
assert.equal(image.image_model, 'smscrw/gpt-image-2');
assert.equal(nano.image_model, 'deyunai/gemini-2.5-flash-image');
assert.equal(image.single_attempt, true);
assert.equal(nano.max_scene_retries, 0);
assert.throws(
  () => selection.applySelection('new_story_ad.scene_asset', { image_model: 'smscrw/gpt-image-2' }),
  error => error.code === 'MEDIA_GENERATION_MODEL_SELECTION_INVALID',
);
assert.throws(
  () => selection.applySelection('new_story_ad.scene_asset', { image_model: 'seedream' }),
  error => error.code === 'MEDIA_GENERATION_MODEL_SELECTION_INVALID',
);

const video = selection.catalog('new_story_ad.video');
assert(video.models.length > 0);
assert(video.models.every(model => model.route.includes('/')));

const picker = fs.readFileSync(path.join(__dirname, '..', 'public/story-ad/views/generationModelPicker.js'), 'utf8');
assert(picker.includes('model.public_name'));
assert(picker.includes("catalog.media_type === 'video'"));
assert(!picker.includes("'gemini-2.5-flash-image':"));
assert(!picker.includes("'gpt-image-2':"));

console.log(JSON.stringify({
  passed: true,
  image_stages: IMAGE_STAGES.length,
  public_choices: ['Image', 'Nano Banana'],
  image_execution_route: image.image_model,
  nano_execution_route: nano.image_model,
  raw_provider_routes_rejected: true,
  provider_image_calls: 0,
}));
