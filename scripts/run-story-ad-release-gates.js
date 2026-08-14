#!/usr/bin/env node
'use strict';

const path = require('path');
const planner = require('./lib/storyAdReleaseGatePlanner');
const runtimeManifest = require('../config/story-ad-runtime-manifest.json');

function argument(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find(value => String(value).startsWith(prefix));
  if (inline) return String(inline).slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? String(process.argv[index + 1] || '') : '';
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const baseRevision = argument('base');
  const targetRevision = argument('target') || runtimeManifest.source_revision;
  const sourceTree = argument('tree') || runtimeManifest.source_tree;
  const plan = planner.createPlan({ root, baseRevision, targetRevision, sourceTree });
  const result = await planner.runPlan(root, plan);
  console.log(`RELEASE_GATE_SUMMARY=${JSON.stringify(result)}`);
}

if (require.main === module) main().catch(error => {
  console.error(`RELEASE_GATE_FAILED=${JSON.stringify({ message: error.message || String(error) })}`);
  process.exitCode = 1;
});

module.exports = { argument, main };
