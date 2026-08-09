#!/usr/bin/env node
'use strict';

const control = require('../src/services/storyAdReleaseControlService');
const bundle = require('../src/services/storyAdReleaseBundleService').identity();

const args = process.argv.slice(2);
const value = name => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : '';
};

const state = value('state');
if (!state) {
  console.log(JSON.stringify({ ...control.read(), runtime_bundle_id: bundle.bundle_id }));
  process.exit(0);
}
const record = control.transition({
  state,
  bundleId: value('bundle') || (state === 'active' ? bundle.bundle_id : ''),
  expectedEpoch: Number(value('expected-epoch') || 0),
});
console.log(JSON.stringify(record));
