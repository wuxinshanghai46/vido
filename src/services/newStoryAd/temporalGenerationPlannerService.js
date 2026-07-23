const crypto = require('crypto');

const POLICY_VERSION = 'story-ad-temporal-generation-planner-v2';

function text(value = '', max = 240) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function durationOf(shot = {}) {
  return Math.max(1, Math.min(15, Number(shot.duration_sec || shot.duration || 3) || 3));
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function temporalState(shot = {}, contract = {}) {
  return contract.temporal_evidence_lock?.shot_state
    || shot.temporal_evidence?.shot_state
    || shot.temporal_state
    || {};
}

function sceneIdentity(shot = {}, contract = {}) {
  const lock = contract.scene_lock || {};
  return text(shot.scene_id || shot.scene_asset_id || lock.scene_id, 120);
}

function hasEditorialBoundary(shot = {}, { linked = false } = {}) {
  const transition = text(shot.transition_type || shot.transition, 80).toLowerCase();
  if (/jump.?cut|smash.?cut|fade|dissolve|montage|flash|black/.test(transition)) return true;
  return !linked && /hard.?cut/.test(transition);
}

function explicitContinuityLink(previousShot = {}, shot = {}, previousContract = {}, contract = {}) {
  const current = temporalState(shot, contract);
  const previous = temporalState(previousShot, previousContract);
  const links = Array.isArray(current.continuity_links) ? current.continuity_links.filter(Boolean) : [];
  if (links.length) return { linked: true, source: 'temporal_evidence_link', links };
  if (shot.requires_previous_frame === true || contract.continuity_lock?.requires_previous_frame === true) {
    return { linked: true, source: 'previous_frame_contract', links: [] };
  }
  const previousAfter = Array.isArray(previous.state_after) ? previous.state_after.filter(Boolean) : [];
  const currentBefore = Array.isArray(current.state_before) ? current.state_before.filter(Boolean) : [];
  const sharedState = previousAfter.filter(value => currentBefore.includes(value));
  return sharedState.length
    ? { linked: true, source: 'matching_authored_state', links: sharedState }
    : { linked: false, source: '', links: [] };
}

/**
 * 连续组只依据当前任务写出的时序链接、场景身份和剪辑边界形成。
 * 这里不识别“跑鞋、瑜伽、医美”等行业词，也不包含行业专用动作表。
 */
function buildContinuityClusters(shots = [], contracts = []) {
  const list = Array.isArray(shots) ? shots : [];
  const clusters = [];
  let current = null;
  list.forEach((shot, index) => {
    const contract = contracts[index] || {};
    const previousShot = list[index - 1] || null;
    const previousContract = contracts[index - 1] || {};
    const link = previousShot
      ? explicitContinuityLink(previousShot, shot, previousContract, contract)
      : { linked: false, source: '', links: [] };
    const previousScene = sceneIdentity(previousShot || {}, previousContract);
    const currentScene = sceneIdentity(shot, contract);
    // 两个镜头都未绑定场景 ID 时，显式时序链接仍可建立连续组；
    // 一旦任一方有场景 ID，则必须严格相等，防止跨场景误合并。
    const sameScene = !!previousShot
      && ((!previousScene && !currentScene) || (!!previousScene && previousScene === currentScene));
    const joinsPrevious = !!previousShot && sameScene && link.linked && !hasEditorialBoundary(shot, { linked: link.linked });
    if (!current || !joinsPrevious) {
      current = {
        id: `continuity-cluster-${clusters.length + 1}`,
        member_indexes: [index],
        scene_identity: sceneIdentity(shot, contract),
        continuity_edges: [],
      };
      clusters.push(current);
    } else {
      current.member_indexes.push(index);
      current.continuity_edges.push({
        from_index: index - 1,
        to_index: index,
        source: link.source,
        links: link.links,
      });
    }
  });
  return clusters.map(cluster => ({
    ...cluster,
    fingerprint: fingerprint(cluster),
  }));
}

function providerCapabilities(options = {}) {
  const maxTemporalAnchors = Math.max(1, Number(
    options.max_temporal_anchors
      || options.maxTemporalAnchors
      || options.provider_temporal_reference_count
      || options.providerTemporalReferenceCount
      || 1,
  ) || 1);
  return {
    supports_continuous_generation: options.supports_continuous_generation === true
      || options.supportsContinuousGeneration === true
      || options.provider_supports_temporal_multi_keyframe === true
      || options.providerSupportsTemporalMultiKeyframe === true,
    max_temporal_anchors: maxTemporalAnchors,
    max_duration_sec: Math.max(5, Math.min(30, Number(options.max_continuous_duration || options.maxContinuousDuration || 15) || 15)),
    adapter_supports_temporal_anchor_binding: options.adapter_supports_temporal_anchor_binding === true
      || options.adapterSupportsTemporalAnchorBinding === true,
  };
}

function buildGenerationUnits(shots = [], contracts = [], options = {}) {
  const clusters = buildContinuityClusters(shots, contracts);
  const capabilities = providerCapabilities(options);
  const units = [];
  clusters.forEach(cluster => {
    const duration = cluster.member_indexes.reduce((sum, index) => sum + durationOf(shots[index] || {}), 0);
    const canStayContinuous = cluster.member_indexes.length > 1
      && capabilities.supports_continuous_generation
      && capabilities.adapter_supports_temporal_anchor_binding
      && capabilities.max_temporal_anchors >= cluster.member_indexes.length
      && duration <= capabilities.max_duration_sec;
    if (canStayContinuous) {
      const payload = {
        mode: 'continuous',
        member_indexes: cluster.member_indexes,
        continuity_edges: cluster.continuity_edges,
        duration_sec: duration,
      };
      units.push({
        id: `temporal-unit-${cluster.member_indexes[0] + 1}-${cluster.member_indexes.at(-1) + 1}-${fingerprint(payload).slice(0, 10)}`,
        ...payload,
        required_temporal_anchors: cluster.member_indexes.length,
        split_reason: '',
      });
      return;
    }
    cluster.member_indexes.forEach((index, position) => {
      const edge = position > 0 ? cluster.continuity_edges[position - 1] : null;
      const splitReason = cluster.member_indexes.length <= 1
        ? 'no_adjacent_temporal_link'
        : (!capabilities.supports_continuous_generation
          ? 'provider_continuous_generation_unverified'
          : (!capabilities.adapter_supports_temporal_anchor_binding
            ? 'adapter_temporal_anchor_binding_unavailable'
            : (capabilities.max_temporal_anchors < cluster.member_indexes.length
              ? 'provider_temporal_anchor_capacity_insufficient'
              : 'continuous_duration_limit_exceeded')));
      units.push({
        id: `temporal-unit-${index + 1}-${fingerprint({ index, splitReason, edge }).slice(0, 10)}`,
        mode: 'independent_with_handoff',
        member_indexes: [index],
        continuity_edges: edge ? [edge] : [],
        duration_sec: durationOf(shots[index] || {}),
        required_temporal_anchors: 1,
        handoff_required: !!edge,
        split_reason: splitReason,
      });
    });
  });
  return {
    policy_version: POLICY_VERSION,
    provider_capabilities: capabilities,
    continuity_clusters: clusters,
    generation_units: units,
    fingerprint: fingerprint({ capabilities, clusters, units }),
  };
}

function unitForIndex(plan = {}, index = 0) {
  return (plan.generation_units || []).find(unit => unit.member_indexes?.includes(index)) || null;
}

module.exports = {
  POLICY_VERSION,
  temporalState,
  explicitContinuityLink,
  buildContinuityClusters,
  providerCapabilities,
  buildGenerationUnits,
  unitForIndex,
};
