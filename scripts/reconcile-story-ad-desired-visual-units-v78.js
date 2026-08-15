#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const reconciler = require('../src/services/newStoryAd/visualAssetDesiredUnitReconciliationService');

function value(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find(arg => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : '';
}

function main() {
  const taskId = value('task') || value('task-id');
  if (!taskId) throw new Error('必须提供 --task <task-id>。');
  const resolutionFile = value('resolutions');
  const resolutions = resolutionFile
    ? JSON.parse(fs.readFileSync(path.resolve(resolutionFile), 'utf8'))
    : {};
  const result = reconciler.reconcileTask({
    taskId,
    resolutions,
    expectedRevisions: Object.fromEntries(Object.entries(resolutions).map(([key, row]) => [key, row.expected_revision || row.expectedRevision || 0])),
    apply: process.argv.includes('--apply'),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

try { main(); } catch (error) {
  process.stderr.write(`${JSON.stringify({ success: false, code: error.code || 'DESIRED_UNIT_RECONCILIATION_FAILED', error: error.message })}\n`);
  process.exitCode = 1;
}
