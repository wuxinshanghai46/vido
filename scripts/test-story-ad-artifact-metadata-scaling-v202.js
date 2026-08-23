'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const basePath = require.resolve('../src/repositories/baseRepository');
const repositoryPath = require.resolve('../src/repositories/contentRecordRepository');
const base = require(basePath);
const originalRequireDatabase = base.requireDatabase;
let selectedSql = '';
let selectedParams = [];
base.requireDatabase = () => ({
  prepare(sql) {
    selectedSql = String(sql);
    return {
      all(...args) {
        selectedParams = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
        return Array.from({ length: 1200 }, (_, index) => ({ id: `artifact_${index}` }));
      },
    };
  },
});
delete require.cache[repositoryPath];
const records = require(repositoryPath);
const ids = records.listIds('new_story_ad_artifacts', { project_id: 'large-task' });
assert.equal(ids.length, 1200);
assert.match(selectedSql, /SELECT\s+id\s+FROM content_records/i);
assert.doesNotMatch(selectedSql, /payload_json/i, 'metadata scan must not stream full historical asset plans through the SQLite bridge');
assert.deepEqual(selectedParams, ['new_story_ad_artifacts', 'large-task']);
base.requireDatabase = originalRequireDatabase;
delete require.cache[repositoryPath];

const storageSource = fs.readFileSync(path.join(root, 'src/services/newStoryAd/storageService.js'), 'utf8');
const authoritySource = fs.readFileSync(path.join(root, 'src/services/newStoryAd/authorityLifecycleService.js'), 'utf8');
assert(storageSource.includes('contentRecords.listIds(COLLECTIONS.artifacts'), 'artifact listing must start from projected ids');
assert(storageSource.includes('listArtifactIds(taskId).map(getArtifact)'), 'large artifact payloads must be loaded one at a time');
assert(!authoritySource.includes('storage.listArtifacts(taskId).forEach'), 'authority promotion must not aggregate every historical payload');

const jobs = require('../src/services/newStoryAd/jobService');
assert.notEqual(jobs.classifyFailure(new Error('sqlite bridge overflow near record 403abc')).code, 'AUTH_CONFIG',
  'digits inside storage records must not be misclassified as an HTTP credential failure');
assert.equal(jobs.classifyFailure(new Error('provider returned HTTP 403 Unauthorized')).code, 'AUTH_CONFIG');

console.log(JSON.stringify({ passed: true, projected_artifact_ids: ids.length, full_payload_scan: false,
  false_auth_classification_blocked: true, model_calls: 0, media_calls: 0 }));
