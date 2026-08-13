#!/usr/bin/env node
'use strict';

const contracts = require('../src/services/newStoryAd/goldenProjectContractService');
const storage = require('../src/services/newStoryAd/storageService');

const args = process.argv.slice(2);
const value = name => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : ''; };
const projectId = value('project');
const taskId = value('task');
if (!projectId || !taskId) throw new Error('用法：--project <golden-project-id> --task <task-id>');
const report = contracts.validateResult(
  contracts.byId(projectId),
  contracts.bundleFromStorage(storage, taskId),
  { require_real_evidence: true },
);
console.log(JSON.stringify(report, null, 2));
if (!report.release_eligible) process.exitCode = 1;
