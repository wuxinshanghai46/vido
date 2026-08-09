'use strict';

const fs = require('fs');
const path = require('path');
const releaseBundle = require('./storyAdReleaseBundleService');

const CONTROL_PATH = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, '../../outputs'), 'story_ad_release_control.json');

function read() {
  try { return JSON.parse(fs.readFileSync(CONTROL_PATH, 'utf8')); } catch {
    const identity = releaseBundle.identity();
    return {
      state: 'active', active_bundle_id: identity.bundle_id, epoch: 1,
      updated_at: new Date().toISOString(), initialized_from_runtime: true,
    };
  }
}

function write(next = {}) {
  const current = read();
  const record = {
    ...current,
    ...next,
    epoch: Math.max(1, Number(next.epoch || current.epoch || 1) || 1),
    updated_at: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(CONTROL_PATH), { recursive: true });
  const temp = `${CONTROL_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, CONTROL_PATH);
  return record;
}

function transition({ state, bundleId = '', expectedEpoch = 0 } = {}) {
  const current = read();
  if (expectedEpoch && Number(current.epoch) !== Number(expectedEpoch)) {
    const error = new Error(`发布 epoch 已变化：${current.epoch}`);
    error.code = 'RELEASE_EPOCH_CONFLICT';
    throw error;
  }
  const nextState = String(state || '').trim();
  if (!['draining', 'active', 'rollback'].includes(nextState)) throw new Error(`无效发布状态：${nextState}`);
  return write({
    state: nextState,
    active_bundle_id: bundleId || current.active_bundle_id || '',
    epoch: Number(current.epoch || 0) + 1,
  });
}

function writeEligibility(runtimeBundleId = '') {
  const control = read();
  const currentBundle = runtimeBundleId || releaseBundle.identity().bundle_id;
  const allowed = control.state === 'active' && control.active_bundle_id === currentBundle;
  return {
    allowed,
    state: control.state,
    epoch: Number(control.epoch || 0),
    active_bundle_id: control.active_bundle_id || '',
    runtime_bundle_id: currentBundle,
  };
}

module.exports = { CONTROL_PATH, read, write, transition, writeEligibility };
