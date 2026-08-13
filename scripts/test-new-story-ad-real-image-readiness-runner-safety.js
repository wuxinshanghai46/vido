#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const script = path.resolve(__dirname, 'run-new-story-ad-real-image-to-video-readiness.js');
const source = fs.readFileSync(script, 'utf8');
const denied = spawnSync(process.execPath, [script, '--budget-rmb=10'], { encoding: 'utf8' });
assert.notStrictEqual(denied.status, 0);
assert.match(`${denied.stdout}${denied.stderr}`, /REAL_IMAGE_PAID_CONFIRMATION_REQUIRED/);
const oversized = spawnSync(process.execPath, [script, '--confirm-paid', '--budget-rmb=10.01'], { encoding: 'utf8' });
assert.notStrictEqual(oversized.status, 0);
assert.match(`${oversized.stdout}${oversized.stderr}`, /REAL_IMAGE_BUDGET_MUST_BE_BETWEEN_0_AND_10_RMB/);
assert.match(source, /reservePerImageRmb = 2/);
assert.match(source, /maxImageSubmissions !== 3/);
assert.match(source, /NEW_STORY_AD_IMAGE_MAX_CANDIDATES = '1'/);
assert.match(source, /pipeline_model_config\.json/);
assert.match(source, /NEW_STORY_AD_V3_PAID_VIDEO_ENABLED = '0'/);
assert.match(source, /videoAdapter\.generateSceneBlockVideos = async/);
assert.match(source, /REAL_IMAGE_RUN_VIDEO_CALL_FORBIDDEN/);
assert.match(source, /verify-existing-run/);
assert.match(source, /\^\\d\{14\}\$/);
assert.match(source, /video_provider: 'deyunai'/);
assert.match(source, /video_model: 'doubao-seedance-2-0-260128'/);
assert.match(source, /paidBudget\.assertWithinBudget/);
assert.match(source, /singleAttempt: true/);
assert.match(source, /imageModel: 'deyunai\/gpt-image-2'/);
assert.doesNotMatch(source, /generateVideoStage\s*\(/);
assert.doesNotMatch(source, /composeStage\s*\(/);
console.log(JSON.stringify({ passed: true, explicit_paid_confirmation: true, hard_budget_cap_rmb: 10, fixed_image_submissions: 3, one_candidate_per_image: true, paid_video_hard_disabled: true, no_video_or_compose_call: true }));
