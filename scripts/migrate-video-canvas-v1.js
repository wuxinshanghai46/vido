#!/usr/bin/env node
require('dotenv').config();
const migration = require('../src/services/videoCanvas/migrationService');

const apply = process.argv.includes('--apply');
const result = apply ? migration.migrate({ includeAll: true }) : migration.preview({ includeAll: true });
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', result }, null, 2));
if (apply && result.failed?.length) process.exitCode = 1;
