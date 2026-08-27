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
      get(...args) {
        selectedParams = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
        return { present: 1 };
      },
      all(...args) {
        selectedParams = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
        if (/SELECT\s+payload_json/i.test(selectedSql)) return [
          { payload_json: JSON.stringify({ id: 'storyboard-1', task_id: 'large-task', kind: 'storyboard_table', payload: [{ shot: 1 }] }) },
          { payload_json: JSON.stringify({ id: 'context-1', task_id: 'large-task', kind: 'context', payload: {} }) },
        ];
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
const storyboardArtifacts = records.listByProjectAndKind('new_story_ad_artifacts', 'large-task', 'storyboard_table');
assert.equal(storyboardArtifacts.length, 1);
assert.equal(storyboardArtifacts[0].id, 'storyboard-1');
assert.match(selectedSql, /project_id\s*=\s*\?/i);
assert.match(selectedSql, /payload_json\s+LIKE\s+\?/i);
assert.doesNotMatch(selectedSql, /json_extract/i, 'baseline production SQLite must not require JSON1');
assert.deepEqual(selectedParams, ['new_story_ad_artifacts', 'large-task', '%\"kind\":\"storyboard_table\"%']);
assert.equal(records.hasAny('new_story_ad_artifacts'), true);
assert.match(selectedSql, /SELECT\s+1\s+AS present/i);
assert.doesNotMatch(selectedSql, /payload_json/i, 'seed detection must not deserialize an existing collection');
base.requireDatabase = originalRequireDatabase;
delete require.cache[repositoryPath];

const storageSource = fs.readFileSync(path.join(root, 'src/services/newStoryAd/storageService.js'), 'utf8');
const authoritySource = fs.readFileSync(path.join(root, 'src/services/newStoryAd/authorityLifecycleService.js'), 'utf8');
assert(storageSource.includes('contentRecords.listIds(COLLECTIONS.artifacts'), 'artifact listing must start from projected ids');
assert(storageSource.includes('contentRecords.hasAny(collection)'), 'SQLite seed detection must use metadata existence checks');
assert(!storageSource.includes('const existing = contentRecords.list(collection)'), 'seed detection must not load every payload');
assert(storageSource.includes('listArtifactIds(taskId).map(getArtifact)'), 'large artifact payloads must be loaded one at a time');
assert(storageSource.includes('contentRecords.listByProjectAndKind(COLLECTIONS.artifacts'), 'typed artifact reads must filter inside SQLite before payload hydration');
assert(storageSource.includes('sqliteBatchDb = { changes: new Map() }'), 'SQLite write batches must use a touched-row overlay');
assert(!storageSource.includes('const before = readDb()'), 'SQLite write batches must not snapshot every historical payload');
assert(storageSource.includes('contentRecords.applyAtomicChanges(changes)'), 'touched rows must still commit atomically');
assert(!authoritySource.includes('storage.listArtifacts(taskId).forEach'), 'authority promotion must not aggregate every historical payload');

const jobs = require('../src/services/newStoryAd/jobService');
assert.notEqual(jobs.classifyFailure(new Error('sqlite bridge overflow near record 403abc')).code, 'AUTH_CONFIG',
  'digits inside storage records must not be misclassified as an HTTP credential failure');
assert.equal(jobs.classifyFailure(new Error('provider returned HTTP 403 Unauthorized')).code, 'AUTH_CONFIG');

const releaseCheckSource = fs.readFileSync(path.join(root, 'scripts/check-new-story-ad-active-tasks.js'), 'utf8');
const repositorySource = fs.readFileSync(path.join(root, 'src/repositories/contentRecordRepository.js'), 'utf8');
const sqliteSource = fs.readFileSync(path.join(root, 'src/db/sqlite.js'), 'utf8');
assert(releaseCheckSource.includes('storage.listActiveTaskStates(1000)'), 'release task check must use projected task state');
assert(releaseCheckSource.includes('storage.listUnknownBillingStates(2000)'), 'release billing check must use projected billing state');
assert(!releaseCheckSource.includes('storage.readDb()'), 'release checks must not materialize the full database');
assert(!repositorySource.includes('json_extract('), 'production Python SQLite does not provide JSON1; projected checks must use baseline SQLite');
assert(repositorySource.includes(`payload_json LIKE '%"active_generation_id"%'`), 'active task scan must filter candidate rows in SQLite');
assert(repositorySource.includes(`payload_json LIKE '%"billing_state":"unknown"%'`), 'billing scan must filter candidate rows in SQLite');
assert(sqliteSource.indexOf('PRAGMA busy_timeout = 5000') < sqliteSource.indexOf('current_journal_mode = conn.execute("PRAGMA journal_mode")'),
  'Python SQLite bridge must set busy timeout before inspecting journal mode');
assert(sqliteSource.includes('if str(current_journal_mode).lower() != "wal"'),
  'Python SQLite bridge must not reassign WAL mode on every short-lived connection');

console.log(JSON.stringify({ passed: true, projected_artifact_ids: ids.length, full_payload_scan: false,
  seed_payload_scan: false, release_db_snapshot_scan: false, write_batch_full_snapshot: false,
  false_auth_classification_blocked: true, model_calls: 0, media_calls: 0 }));
