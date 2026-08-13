'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const audit = require('./audit-new-story-ad-systemic-state-remote');

const source = fs.readFileSync(path.join(__dirname, 'audit-new-story-ad-systemic-state-remote.js'), 'utf8');
const remoteSource = audit.remoteAuditSource();
const command = audit.buildRemoteCommand();
assert(source.includes("require('ssh2')"), 'remote audit must connect through SSH');
assert(source.includes('connectionOptions({ host, port, username })'), 'remote audit must use resolved production SSH settings');
assert(!source.includes("path.resolve(process.cwd(), 'src/services/newStoryAd/storageService')"), 'remote audit must not read the local database');
assert(remoteSource.includes("require('./src/services/newStoryAd/storageService')"), 'audit must read storage inside the remote app directory');
assert(remoteSource.includes("source: 'production_ssh'"), 'audit evidence must identify its remote source');
assert(command.includes('/opt/vido/app') && command.includes('node -e'), 'audit command must execute read-only code in the production app');
assert(!remoteSource.includes('save') && !remoteSource.includes('update') && !remoteSource.includes('create'), 'remote audit source must remain read-only');
console.log(JSON.stringify({ passed: true, production_ssh: true, read_only: true, local_db_blocked: true }));
