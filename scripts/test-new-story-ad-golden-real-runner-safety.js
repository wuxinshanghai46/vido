#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const script = path.resolve(__dirname, 'run-new-story-ad-golden-real-text.js');
const source = fs.readFileSync(script, 'utf8');
const denied = spawnSync(process.execPath, [script, '--budget-rmb=50'], { encoding: 'utf8' });
assert.notStrictEqual(denied.status, 0);
assert.match(`${denied.stdout}${denied.stderr}`, /REAL_GOLDEN_PAID_CONFIRMATION_REQUIRED/);
const oversized = spawnSync(process.execPath, [script, '--confirm-paid', '--budget-rmb=50.01'], { encoding: 'utf8' });
assert.notStrictEqual(oversized.status, 0);
assert.match(`${oversized.stdout}${oversized.stderr}`, /REAL_GOLDEN_BUDGET_MUST_BE_BETWEEN_0_AND_50_RMB/);
assert.match(source, /NEW_STORY_AD_TEXT_MAX_CANDIDATES = '1'/);
assert.match(source, /actual_provider_charge_rmb: null/);
assert.match(source, /assertBudget\(1\)/);
assert.match(source, /gatewayCallsStarted \+ 1/);
assert.match(source, /modelGateway\.generateText = async/);
assert.doesNotMatch(source, /generateKeyframesStage|generateVideoStage|composeStage/);
console.log(JSON.stringify({ passed: true, explicit_paid_confirmation: true, hard_budget_cap_rmb: 50, one_candidate_per_text_stage: true, no_media_calls: true, unknown_actual_charge_not_fabricated: true }));
