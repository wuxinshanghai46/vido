#!/usr/bin/env node
'use strict';

const migration = require('../src/services/newStoryAd/systemicMigrationService');

const commit = process.argv.includes('--commit');
const report = commit ? migration.apply() : migration.plan(require('../src/services/newStoryAd/storageService').readDb());
console.log(JSON.stringify(report, null, 2));
if (commit && !report.ok) process.exitCode = 1;
