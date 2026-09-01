'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const releaseIntegrity = require('./storyAdReleaseIntegrityService');
const topology = require('./newStoryAd/narrativeTopologyCompilerService');

const ROOT = path.resolve(__dirname, '../..');
const RELEASE_PATH = path.join(ROOT, 'config', 'story-ad-release.json');
const RUNTIME_MANIFEST_PATH = path.join(ROOT, 'config', 'story-ad-runtime-manifest.json');
const COMPATIBLE_CONTRACT_EDGES = new Map([
  // V7 separates user-facing flow/sketch stages; V8 moves that binding inside
  // storyboard generation. Neither transition changes the persisted
  // person/scene Active Plan contract. A task may skip one or more releases,
  // so compatibility must be proven across every adjacent edge instead of
  // relying on the immediately previous production version.
  ['story-scene-platform-v6', new Set(['story-scene-platform-v7'])],
  ['story-scene-platform-v7', new Set(['story-scene-platform-v8'])],
  // V9 adds the downstream audio-first final-media flow. It does not change
  // the persisted person/scene Active Plan schema, fingerprint contract or
  // coverage contract, so an exact V8 plan can be promoted without a model
  // call or rebuilding any existing image/video/audio artifact.
  ['story-scene-platform-v8', new Set(['story-scene-platform-v9'])],
]);

function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

function sha(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function identity() {
  const release = readJson(RELEASE_PATH);
  const runtimeManifest = readJson(RUNTIME_MANIFEST_PATH);
  const components = {
    build_id: String(release.build_id || ''),
    contract_version: String(release.contract_version || ''),
    runtime_hash: runtimeManifest.files?.length ? releaseIntegrity.manifestFingerprint(runtimeManifest) : '',
    artifact_id: String(runtimeManifest.artifact_id || ''),
    source_snapshot_hash: String(runtimeManifest.source_snapshot_hash || ''),
    source_revision: String(runtimeManifest.source_revision || ''),
    source_tree: String(runtimeManifest.source_tree || ''),
    source_ref: String(runtimeManifest.source_ref || ''),
    upstream_ref: String(runtimeManifest.upstream_ref || ''),
    remote_sync_verified: runtimeManifest.remote_sync_verified === true,
    lockfile_sha256: String(runtimeManifest.lockfile_sha256 || ''),
    node_major: Number(String(runtimeManifest.node_version || process.version).replace(/^v/, '').split('.')[0]) || 0,
    node_runtime_version: String(runtimeManifest.node_runtime?.version || runtimeManifest.node_version || ''),
    node_runtime_platform: String(runtimeManifest.node_runtime?.platform || ''),
    node_runtime_sha256: String(runtimeManifest.node_runtime?.sha256 || ''),
    story_facts_schema_version: topology.STORY_FACTS_SCHEMA_VERSION,
    normalizer_version: topology.NORMALIZER_VERSION,
    topology_compiler_version: topology.TOPOLOGY_COMPILER_VERSION,
    validator_version: 'story-scene-validator-v6',
    scene_layer_contract_version: 'scene-layer-contract-v6',
    reference_expansion_contract_version: 'reference-evidence-expansion-v6',
    storyboard_coverage_contract_version: 'story-beat-shot-coverage-v6',
    model_routing_policy_version: 'pipeline-model-routing-v3',
    persistence_schema_version: 'story-ad-layered-lineage-v3',
    migration_set_id: 'story-ad-v6-checkpoint-lineage-v3',
    billing_policy_version: 'generation-permit-v1',
  };
  return { ...components, bundle_id: sha(components) };
}

function envelope(extra = {}) {
  const current = identity();
  return {
    producer_bundle_id: current.bundle_id,
    build_id: current.build_id,
    contract_version: current.contract_version,
    runtime_hash: current.runtime_hash,
    story_facts_schema_version: current.story_facts_schema_version,
    normalizer_version: current.normalizer_version,
    topology_compiler_version: current.topology_compiler_version,
    validator_version: current.validator_version,
    scene_layer_contract_version: current.scene_layer_contract_version,
    reference_expansion_contract_version: current.reference_expansion_contract_version,
    storyboard_coverage_contract_version: current.storyboard_coverage_contract_version,
    ...extra,
  };
}

function compatibleContractTransition(fromVersion = '', toVersion = '') {
  const from = String(fromVersion || '').trim();
  const to = String(toVersion || '').trim();
  if (!from || !to || from === to) return false;
  const pending = [from];
  const visited = new Set();
  while (pending.length) {
    const current = pending.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    for (const next of COMPATIBLE_CONTRACT_EDGES.get(current) || []) {
      if (next === to) return true;
      if (!visited.has(next)) pending.push(next);
    }
  }
  return false;
}

module.exports = { identity, envelope, sha, canonical, compatibleContractTransition };
