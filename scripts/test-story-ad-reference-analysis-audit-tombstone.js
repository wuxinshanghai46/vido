#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.OUTPUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-reference-tombstone-'));
process.env.DB_ENABLED = '0';
const storage = require('../src/services/newStoryAd/storageService');
const analyses = require('../src/services/newStoryAd/referenceVideoAnalysisService');

try {
  storage.saveModelCall({
    id: 'call-reference-1', task_id: 'task-reference-1', stage: 'new_story_ad.reference_video_synthesis',
    provider_id: 'stub', model_id: 'stub-model', status: 'failed', billing_state: 'unknown',
    provider_submission_state: 'submitted_unknown', provider_request_id: 'provider-request-1',
  });
  const tombstone = analyses.writeAuditTombstone({
    id: 'analysis-reference-1', task_id: 'task-reference-1', user_id: 'user-1', status: 'failed',
    source: { filename: 'private-video.mp4' }, result: { private_content: 'must-not-be-retained' },
  }, { id: 'user-1' }, 'test_delete');
  const file = path.join(analyses.ROOT_DIR, '_audit_tombstones', 'analysis-reference-1.json');
  assert.equal(fs.existsSync(file), true);
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(stored.billing_states[0], 'unknown');
  assert.equal(stored.provider_request_ids[0], 'provider-request-1');
  assert.equal(stored.content_retained, false);
  assert.equal(JSON.stringify(stored).includes('private-video.mp4'), false);
  assert.equal(tombstone.record_digest.length, 64);
  console.log(JSON.stringify({ passed: true, billing_audit_retained: true, private_content_removed: true }));
} finally {
  fs.rmSync(process.env.OUTPUT_DIR, { recursive: true, force: true });
}
