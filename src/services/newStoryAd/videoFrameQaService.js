const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const modelGateway = require('./modelGateway');
const jsonRepair = require('./jsonRepairService');
const mediaAdapter = require('./mediaAdapter');
const cancellation = require('./cancellationContext');
const personIdentity = require('./personIdentityContractService');
const petIdentity = require('./petIdentityContractService');
const productIdentity = require('./productIdentityContractService');
const motionAwareEdit = require('./motionAwareEditService');
const { cleanText } = require('./contextBuilder');
const contractFreshness = require('./keyframeContractFreshnessService');

const FRAME_POINTS = [0, 0.25, 0.5, 0.75, 1];
const VIDEO_FRAME_QA_POLICY_VERSION = 'story-ad-video-frame-qa-v6';
const FRAME_DIMENSIONS = {
  person_pass: ['person_identity', '人物身份与造型'],
  product_pass: ['product_identity', '产品与主体一致性'],
  scene_pass: ['scene_consistency', '场景与环境一致性'],
  action_pass: ['action_fulfillment', '动作与镜头意图'],
  people_count_pass: ['people_count', '出镜人数'],
  animal_count_pass: ['animal_count', '出镜宠物/动物数量'],
  pet_identity_pass: ['pet_identity', '宠物身份与外观一致性'],
  text_watermark_pass: ['text_watermark', '文字或水印'],
  anatomy_physics_pass: ['anatomy_physics', '人体与物体运动物理'],
  temporal_stability_pass: ['temporal_stability', '跨帧稳定与闪烁'],
  rendering_intent_pass: ['rendering_intent', '画面媒介与真实感意图'],
};
const CROSS_DIMENSIONS = {
  person_position_score: ['person_position', '人物位置连续性'],
  wardrobe_score: ['wardrobe', '服装与造型连续性'],
  prop_state_score: ['prop_state', '道具与主体状态连续性'],
  scene_score: ['scene_continuity', '相邻场景连续性'],
  screen_direction_score: ['screen_direction', '运动与视线方向连续性'],
  action_continuity_score: ['action_continuity', '动作承接连续性'],
};
const TEMPORAL_EVIDENCE_DIMENSIONS = {
  entity_identity: '实体身份一致性',
  relation_continuity: '实体关系连续性',
  state_transition: '状态变化完整性',
  invariant_preservation: '不变量保持',
  intended_change_only: '仅发生预期变化',
  spatial_topology: '空间拓扑一致性',
  event_completion: '事件完成证据',
};

function failedDimensionDetails(values = {}, mapping = {}, threshold = null) {
  return Object.entries(mapping).filter(([key]) => (
    threshold === null ? values[key] === false : Number(values[key] || 0) < threshold
  )).map(([key, [code, label]]) => ({ key, code, label }));
}

function temporalEvidenceOf(shot = {}, contract = {}) {
  return contract.temporal_evidence_lock
    || shot.temporal_evidence
    || (shot.temporal_state ? { shot_state: shot.temporal_state } : null);
}

function requiredTemporalDimensions(temporalEvidence = null, { hasScene = false } = {}) {
  const state = temporalEvidence?.shot_state || {};
  const required = [];
  if ((state.entity_refs || []).length) required.push('entity_identity');
  if ((state.relation_refs || []).length) required.push('relation_continuity');
  if ((state.state_before || []).length || (state.state_after || []).length) required.push('state_transition');
  if ((state.invariants || []).length) required.push('invariant_preservation', 'intended_change_only');
  else if ((state.intended_changes || []).length) required.push('intended_change_only');
  if (hasScene) required.push('spatial_topology');
  if ((state.event_refs || []).length || (state.evidence_requirements || []).length) required.push('event_completion');
  return [...new Set(required)];
}

function normalizeTemporalEvidenceChecks(parsed = {}, required = [], {
  minimumEvidencePoints = 1,
  transitionEvidencePoints = minimumEvidencePoints,
  maxFrameIndex = Number.POSITIVE_INFINITY,
  maxTimeSec = Number.POSITIVE_INFINITY,
} = {}) {
  const source = parsed.evidence_checks && typeof parsed.evidence_checks === 'object'
    ? parsed.evidence_checks
    : {};
  const checks = {};
  required.forEach((key) => {
    const raw = source[key] && typeof source[key] === 'object' ? source[key] : {};
    const evidence = cleanText(raw.evidence || raw.reason || '', 500);
    const frameIndexes = Array.isArray(raw.frame_indexes)
      ? [...new Set(raw.frame_indexes.map(Number).filter(value => Number.isInteger(value) && value >= 0 && value <= maxFrameIndex))].slice(0, 8)
      : [];
    const timeSec = Array.isArray(raw.time_sec)
      ? [...new Set(raw.time_sec.map(Number).filter(value => Number.isFinite(value) && value >= 0 && value <= maxTimeSec).map(value => Number(value.toFixed(3))))].slice(0, 8)
      : [];
    const requiredPoints = ['state_transition', 'event_completion'].includes(key)
      ? transitionEvidencePoints
      : minimumEvidencePoints;
    const observedPoints = Math.max(frameIndexes.length, timeSec.length);
    checks[key] = {
      pass: raw.pass === true && !!evidence && observedPoints >= requiredPoints,
      evidence,
      frame_indexes: frameIndexes,
      time_sec: timeSec,
      required_evidence_points: requiredPoints,
      observed_evidence_points: observedPoints,
    };
  });
  const failed = required.filter(key => checks[key]?.pass !== true);
  return {
    checks,
    failed,
    failure_labels_zh: failed.map(key => TEMPORAL_EVIDENCE_DIMENSIONS[key] || key),
    pass: failed.length === 0,
  };
}

function runFfmpeg(args) {
  if (!ffmpegPath) return Promise.reject(new Error('ffmpeg-static is unavailable'));
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    const signal = cancellation.signal();
    let stderr = '';
    const abort = () => child.kill('SIGKILL');
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) return reject(signal.reason || new Error('Frame extraction aborted'));
      if (code === 0) return resolve();
      reject(new Error(stderr.split(/\r?\n/).filter(Boolean).slice(-5).join(' | ') || `ffmpeg exited ${code}`));
    });
  });
}

async function extractReviewFrames({ taskId = '', clip = {}, index = 0 } = {}) {
  const sourceInput = clip.scene_block_source_file && fs.existsSync(clip.scene_block_source_file)
    ? clip.scene_block_source_file
    : (clip.file_path || clip.filePath || '');
  const input = sourceInput;
  if (!input || !fs.existsSync(input)) {
    const error = new Error(`第 ${index + 1} 镜视频文件不存在，无法执行抽帧 QA`);
    error.code = 'VIDEO_FILE_MISSING';
    throw error;
  }
  const duration = Math.max(0.2, Number(clip.duration_sec || clip.duration || 5) || 5);
  const sourceOffset = sourceInput === clip.scene_block_source_file ? Number(clip.scene_block_start_sec || 0) : 0;
  const sourceDuration = sourceInput === clip.scene_block_source_file
    ? Number(clip.scene_block_edit_evidence?.planned_duration_sec || clip.scene_block_end_sec || duration)
    : duration;
  const motionEvidence = await motionAwareEdit.analyzeMotionSamples(input, { startSec: 0, durationSec: sourceDuration, fps: 6 });
  const localSamples = motionEvidence.samples
    .filter(sample => Number(sample.second) >= sourceOffset && Number(sample.second) <= sourceOffset + duration)
    .map(sample => ({ ...sample, second: Number(sample.second) - sourceOffset }));
  const representativeTimes = motionAwareEdit.chooseRepresentativeTimes(localSamples, duration, FRAME_POINTS.length);
  const frames = [];
  for (let i = 0; i < representativeTimes.length; i += 1) {
    cancellation.throwIfCancelled(taskId);
    const second = representativeTimes[i];
    const point = FRAME_POINTS[i] ?? (duration > 0 ? Number((second / duration).toFixed(4)) : 0);
    const filename = `video_qa_${String(taskId).replace(/[^a-z0-9_-]/ig, '_')}_${index + 1}_${i}_${Date.now()}.jpg`;
    const output = path.join(mediaAdapter.ASSET_DIR, filename);
    fs.mkdirSync(mediaAdapter.ASSET_DIR, { recursive: true });
    await runFfmpeg(['-y', '-ss', (second + sourceOffset).toFixed(3), '-i', input, '-frames:v', '1', '-q:v', '3', output]);
    frames.push({
      point, second, filename, file_path: output, image_url: mediaAdapter.publicAssetUrl(filename),
      selection: 'dense_full_timeline_motion_representative',
      sampled_timeline_ratio: duration > 0 ? Number((second / duration).toFixed(4)) : 0,
      local_motion_evidence: {
        policy_version: motionEvidence.policy_version,
        method: motionEvidence.method,
        fps: motionEvidence.fps,
        analyzed_frame_count: motionEvidence.frame_count,
        sample_count: motionEvidence.samples.length,
        analysis_cache_hit: motionEvidence.cache_hit === true,
        source_range_start_sec: sourceOffset,
        source_range_duration_sec: duration,
      },
    });
  }
  return frames;
}

function frameEvidenceUsable(frame = {}) {
  const imageUrl = cleanText(frame.image_url || frame.imageUrl || '', 1000);
  const filePath = cleanText(frame.file_path || frame.filePath || '', 1000);
  if (!imageUrl) return false;
  return !filePath || fs.existsSync(filePath);
}

function hasReviewFrameEvidence(qa = {}) {
  const frames = Array.isArray(qa.frames) ? qa.frames : [];
  return frames.length > 0
    && frameEvidenceUsable(frames[0])
    && frameEvidenceUsable(frames[frames.length - 1]);
}

function evidenceError(index = 0, cause = null) {
  const error = new Error(`第 ${index + 1} 镜缺少可用的首尾帧证据，已在付费视频提交前停止`);
  error.code = 'VIDEO_QA_EVIDENCE_MISSING';
  error.status = 409;
  error.retryable = false;
  error.details = { shot_index: index + 1, cause_code: cause?.code || '' };
  return error;
}

/** Backfill reused boundary clips locally before any paid provider submission. */
function boundaryEvidenceIndexes({ clips = [], targetIndexes = [], includeTargetIndexes = [] } = {}) {
  const count = Array.isArray(clips) ? clips.length : 0;
  const targets = new Set((Array.isArray(targetIndexes) ? targetIndexes : [])
    .map(Number).filter(index => Number.isInteger(index) && index >= 0));
  const included = new Set((Array.isArray(includeTargetIndexes) ? includeTargetIndexes : [])
    .map(Number).filter(index => targets.has(index) && index < count));
  for (const index of targets) {
    if (index > 0 && index - 1 < count && !targets.has(index - 1)) included.add(index - 1);
    if (index + 1 < count && !targets.has(index + 1)) included.add(index + 1);
  }
  return [...included].sort((a, b) => a - b);
}

async function ensureBoundaryFrameEvidence({ taskId = '', clips = [], targetIndexes = [], includeTargetIndexes = [] } = {}) {
  const next = Array.isArray(clips) ? clips.slice() : [];
  const boundaryIndexes = boundaryEvidenceIndexes({ clips: next, targetIndexes, includeTargetIndexes });
  const backfilledIndexes = [];
  for (const index of boundaryIndexes) {
    const clip = next[index] || {};
    if (clip.qa?.pass !== true || !(clip.file_path || clip.filePath || clip.scene_block_source_file)) {
      throw evidenceError(index);
    }
    if (hasReviewFrameEvidence(clip.qa)) continue;
    let frames = [];
    try {
      frames = await extractReviewFrames({ taskId, clip, index });
    } catch (error) {
      throw evidenceError(index, error);
    }
    const qa = { ...clip.qa, frames, evidence_backfilled_locally_at: new Date().toISOString() };
    if (!hasReviewFrameEvidence(qa)) throw evidenceError(index);
    next[index] = { ...clip, qa };
    backfilledIndexes.push(index);
  }
  return { clips: next, backfilled_indexes: backfilledIndexes, boundary_indexes: boundaryIndexes };
}

function aggregatePass(parsed = {}) {
  const legacyDimensions = ['person_pass', 'product_pass', 'scene_pass', 'action_pass', 'people_count_pass', 'text_watermark_pass'];
  const qualityDimensions = ['anatomy_physics_pass', 'temporal_stability_pass', 'rendering_intent_pass'];
  const petDimensions = ['animal_count_pass', 'pet_identity_pass'];
  return parsed.pass === true
    && legacyDimensions.every(key => parsed[key] === true)
    && qualityDimensions.every(key => parsed[key] !== false)
    && petDimensions.every(key => parsed[key] !== false);
}

function reviewDecision(parsed = {}, problems = [], clip = {}) {
  const provider = String(clip.provider_used || clip.providerUsed || '').toLowerCase();
  const zhipuProvenance = provider.startsWith('zhipu/');
  const warnings = [];
  const blockingProblems = [];
  let acceptedProvenanceWatermark = false;
  for (const problem of problems) {
    const value = cleanText(problem, 300);
    if (zhipuProvenance && /(?:watermark|ai\s*生成|水印|lower\s+right|右下角)/i.test(value)) {
      acceptedProvenanceWatermark = true;
      warnings.push(value);
      continue;
    }
    if (parsed.product_pass !== false && /(?:not\s+validated|cannot\s+validate|unable\s+to\s+validate).*(?:missing|without).*(?:reference|qa\s+data)|(?:missing|without).*(?:reference|qa\s+data).*(?:product|specification)/i.test(value)) {
      warnings.push(value);
      continue;
    }
    blockingProblems.push(value);
  }
  const coreDimensionsPass = ['person_pass', 'product_pass', 'scene_pass', 'action_pass', 'people_count_pass']
    .every(key => parsed[key] === true)
    && ['anatomy_physics_pass', 'temporal_stability_pass', 'rendering_intent_pass'].every(key => parsed[key] !== false)
    && ['animal_count_pass', 'pet_identity_pass'].every(key => parsed[key] !== false);
  const normalPass = aggregatePass(parsed);
  const provenanceOnlyPass = acceptedProvenanceWatermark
    && parsed.text_watermark_pass === false
    && coreDimensionsPass;
  return {
    pass: (normalPass || provenanceOnlyPass) && blockingProblems.length === 0,
    problems: blockingProblems,
    warnings,
    accepted_provenance_watermark: acceptedProvenanceWatermark,
  };
}

function expectedPeopleForShot(ctx = {}, shot = {}) {
  const explicit = Number(shot.expected_people || shot.person_count || ctx.expected_people || ctx.person_asset?.expected_people || 0);
  if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit);
  if (Object.prototype.hasOwnProperty.call(shot, 'characters') && Array.isArray(shot.characters)) {
    return shot.characters.filter(Boolean).length;
  }
  const mode = String(ctx.cast_mode || ctx.person_asset?.cast_mode || '').toLowerCase();
  if (mode === 'single') return 1;
  if (mode === 'dual') return 2;
  if (['no_human', 'animal'].includes(mode)) return 0;
  return null;
}

function peopleProblemMatchesApprovedKeyframe(problem = '') {
  return /expected\s+no\s+(?:visible\s+)?human|unexpected\s+(?:principal\s+)?(?:human|person|people)\s+(?:presence|visible)|people\s+count\s+mismatch|partial\s+(?:human\s+)?(?:person|hand|arm|body)|presence\s+of\s+(?:a\s+)?(?:hand|arm|body)|(?:hand|arm|body).*(?:not\s+part\s+of|conflicts?\s+with|violates?|avoid\s+visible)|new\s+visible\s+body\s+parts?|visible\s+human.*expected_people\s*(?:is|=)\s*0/i.test(String(problem || ''));
}

function keyframeIsCurrentAndApproved(keyframe = {}, contract = {}) {
  return !!(keyframe.image_url || keyframe.imageUrl || keyframe.url)
    && keyframe.qa?.pass === true
    && (!contract.contract_fingerprint || contractFreshness.artifactMatchesContract(keyframe, contract));
}

function reconcileExistingApprovedPartialPersonQa({ qa = {}, keyframe = {}, contract = {} } = {}) {
  const presence = String(keyframe.qa?.person?.person_presence || keyframe.person_presence || '').trim().toLowerCase();
  const humanApproved = keyframe.qa?.manual_override === true || keyframe.current_generation_status === 'manual_accepted';
  const dimensions = Array.isArray(qa.failure_dimensions) ? qa.failure_dimensions.filter(Boolean) : [];
  const problems = Array.isArray(qa.problems) ? qa.problems.filter(Boolean) : [];
  const contractOnlyConflict = keyframeIsCurrentAndApproved(keyframe, contract)
    && humanApproved
    && presence === 'partial'
    && qa.pass === false
    && qa.action_pass === true
    && dimensions.length > 0
    && dimensions.every(value => ['people_count', 'person_identity', 'scene_consistency'].includes(value))
    && problems.length > 0
    && problems.every(peopleProblemMatchesApprovedKeyframe);
  if (!contractOnlyConflict) return null;
  return {
    ...qa,
    pass: true,
    status: 'verified_by_saved_contract',
    person_pass: true,
    scene_pass: true,
    people_count_pass: true,
    animal_count_pass: true,
    pet_identity_pass: true,
    keyframe_people_match: true,
    unexpected_people_added: false,
    problems: [],
    warnings: [...new Set([...(Array.isArray(qa.warnings) ? qa.warnings : []), ...problems])],
    failure_dimensions: [],
    failure_labels_zh: [],
    retry_instruction: '',
    decision_source: 'saved_keyframe_contract_reconciliation',
    checked_at: new Date().toISOString(),
  };
}

function deterministicLocalMotionQa({ clip = {}, keyframe = {}, contract = {} } = {}) {
  if (clip.mode !== 'deterministic_local_camera_motion' || !keyframeIsCurrentAndApproved(keyframe, contract)) return null;
  return {
    pass: true,
    status: 'verified_deterministic_local_motion',
    person_pass: true,
    product_pass: true,
    scene_pass: true,
    action_pass: true,
    people_count_pass: true,
    text_watermark_pass: true,
    problems: [],
    warnings: [],
    failure_dimensions: [],
    failure_labels_zh: [],
    frames: [],
    decision_source: 'deterministic_pixel_transform_of_approved_keyframe',
    checked_at: new Date().toISOString(),
    used_model: 'none/local-ffmpeg-contract',
  };
}

async function verifyDeterministicLocalMotionClip({ taskId = '', clip = {}, keyframe = {}, contract = {}, index = 0 } = {}) {
  const base = deterministicLocalMotionQa({ clip, keyframe, contract });
  if (!base) return null;
  const frames = await extractReviewFrames({ taskId, clip, index });
  if (frames.length < 2) {
    return {
      ...base,
      pass: false,
      status: 'rejected_missing_local_frame_evidence',
      problems: ['Local deterministic clip did not yield enough technical frame evidence.'],
      failure_dimensions: ['frame_evidence'],
      failure_labels_zh: ['视频帧证据'],
      frames,
    };
  }
  return { ...base, frames, local_motion_evidence: frames[0].local_motion_evidence };
}

async function reviewVideoClip({ taskId = '', clip = {}, shot = {}, keyframe = {}, contract = {}, ctx = {}, index = 0, gateway = modelGateway, repair = jsonRepair } = {}) {
  const frames = await extractReviewFrames({ taskId, clip, index });
  if (process.env.NEW_STORY_AD_MOCK_LLM === '1') {
    return { pass: true, status: 'verified', qa_policy_version: VIDEO_FRAME_QA_POLICY_VERSION, frames, person_pass: true, product_pass: true, scene_pass: true, action_pass: true, people_count_pass: true, animal_count_pass: true, pet_identity_pass: true, text_watermark_pass: true, anatomy_physics_pass: true, temporal_stability_pass: true, rendering_intent_pass: true, problems: [], checked_at: new Date().toISOString(), used_model: 'mock/new-story-ad-video-frame-qa' };
  }
  const sceneRef = contract.scene_lock?.view_images?.find(view => view.key === contract.scene_lock?.scene_view)
    || contract.scene_lock?.view_images?.[0] || {};
  const personRef = Object.values((ctx.person_contract || ctx.person_asset?.person_contract || {}).reference_views || {}).find(Boolean) || '';
  const productRef = (ctx.product_contract?.reference_images || [])[0] || '';
  const petRefs = (Array.isArray(ctx.pet_profiles) ? ctx.pet_profiles : [])
    .flatMap(profile => Array.isArray(profile?.reference_images) ? profile.reference_images : [])
    .filter(Boolean);
  const humanApproved = keyframe.qa?.manual_override === true || keyframe.current_generation_status === 'manual_accepted';
  const currentKeyframeAccepted = !!(keyframe.image_url || keyframe.imageUrl)
    && keyframe.qa?.pass === true
    && (!contract.contract_fingerprint || contractFreshness.artifactMatchesContract(keyframe, contract));
  const acceptedKeyframeRef = currentKeyframeAccepted ? mediaAdapter.absolutePublicImageUrl(keyframe.image_url || keyframe.imageUrl || '') : '';
  const references = currentKeyframeAccepted
    ? [acceptedKeyframeRef, personRef, productRef, ...petRefs].filter(Boolean)
    : [sceneRef.url || sceneRef.image_url || '', personRef, productRef, ...petRefs].filter(Boolean);
  const keyframePersonPresence = String(keyframe.qa?.person?.person_presence || keyframe.person_presence || '').trim().toLowerCase();
  const approvedPartialPerson = currentKeyframeAccepted && keyframePersonPresence === 'partial';
  const expectedPeople = ['person', 'partial'].includes(keyframePersonPresence)
    ? Math.max(1, Number(expectedPeopleForShot(ctx, shot) || 0))
    : expectedPeopleForShot(ctx, shot);
  const expectedAnimals = petIdentity.expectedAnimalsForShot(ctx, shot);
  const petRequired = expectedAnimals > 0;
  const temporalEvidence = temporalEvidenceOf(shot, contract);
  const requiredEvidenceDimensions = requiredTemporalDimensions(temporalEvidence, {
    hasScene: !!contract.scene_lock,
  });
  const result = await gateway.generateVision({
    taskId,
    stage: 'new_story_ad.video_frame_qa',
    imageUrls: [...references, ...frames.map(frame => mediaAdapter.absolutePublicImageUrl(frame.image_url))].slice(0, 8),
    systemPrompt: [
      'You are a strict multi-frame commercial video inspector for a general-purpose platform.',
      'The first optional images are current-task scene/person/product references. The remaining images are ordered samples from one generated clip.',
      'The task may cover any lawful industry, scene, person, product or visual medium. Never impose a fixed template. Return strict JSON only.',
    ].join('\n'),
    userPrompt: `Current task contracts: ${JSON.stringify({ person: ctx.person_contract || null, pet: ctx.pet_contract || null, product: ctx.product_contract || null, scene: contract.scene_lock || null, temporal_evidence: temporalEvidence })}\nCurrent approved keyframe: ${JSON.stringify(currentKeyframeAccepted ? { authoritative: true, human_override: humanApproved, expected_person_presence: keyframePersonPresence || 'unknown', reason: keyframe.qa?.override_reason || keyframe.manual_acceptance?.reason || 'current contract-matched keyframe passed QA' } : { authoritative: false })}\nShot: ${JSON.stringify({ title: shot.title, visual: shot.visual, action: shot.action, characters: shot.characters, pets: shot.pets || [], duration: shot.duration, expected_people: expectedPeople, expected_animals: expectedAnimals, expected_person_presence: keyframePersonPresence || null, surface_topology: shot.surface_topology || null })}\nHard rules: if the current approved keyframe is authoritative, judge scene geometry, material topology, seams, panel layout, crop, starting subject placement, and any already-visible partial person/body part against that keyframe. Reject added seams, wall segmentation, ceiling/floor reconstruction, material replacement or any other visible drift away from it, even when older scene observations differ. The structured expected_person_presence value comes from the already-approved keyframe review and is authoritative: when it is partial, the hand/arm/body part already present in the approved keyframe is allowed and must not be treated as a newly introduced person merely because characters is empty. In that case set keyframe_people_match=true and people_count_pass=true when the clip preserves that partial-person state. Still reject a genuinely new principal person, wrong action, identity/product changes or watermarks. If a verified person contract exists, every visible principal person must match it; reject any replacement, extra principal person, identity drift or wardrobe drift. If no authoritative keyframe exists and expected_people is 0, reject any visible human. If expected_people is a number, people_count_pass is true only when the visible principal cast count matches it or the approved keyframe visibly proves the authored partial-person state. Judge pets independently from people: animal_count_pass is true only when the visible pet/animal count equals expected_animals; pet_identity_pass is true only when every required pet preserves the declared species/breed, coat color and texture, body size, age impression, facial markings, collar/accessories and unique identifiers across all sampled frames. Reject added, missing, replaced, recolored, duplicated or merged pets. When expected_animals is 0, reject any newly added pet/animal. action_pass is true only when the authored action visibly progresses through a physically plausible start, interaction/movement phase and causal result; reject teleporting, morphing, sliding without contact, disappearing/duplicated subjects, reversed events, frozen-photo motion or a result with no visible cause. anatomy_physics_pass requires stable hands, limbs, faces, contacts and object mass without fusion or impossible deformation. temporal_stability_pass requires no identity/texture/background flicker, boiling edges, intermittent objects or exposure pumping. rendering_intent_pass requires the frames to match the authored medium (photoreal, stylized, animation, etc.); for photoreal people reject waxy skin, painted hair, glassy eyes and synthetic lighting. For required V2.0 dimensions ${JSON.stringify(requiredEvidenceDimensions)}, return evidence_checks[key]={"pass":boolean,"evidence":"what is visibly proved","frame_indexes":[ordered sample indexes],"time_sec":[visible times]}. Every required dimension needs at least two distinct timeline points; state_transition and event_completion need at least three distinct start/middle/result points. Missing visible proof is false; never infer proof from the prompt. Return {"pass":boolean,"person_pass":boolean,"product_pass":boolean,"scene_pass":boolean,"action_pass":boolean,"people_count_pass":boolean,"animal_count_pass":boolean,"pet_identity_pass":boolean,"keyframe_people_match":boolean,"unexpected_people_added":boolean,"unexpected_animals_added":boolean,"text_watermark_pass":boolean,"anatomy_physics_pass":boolean,"temporal_stability_pass":boolean,"rendering_intent_pass":boolean,"evidence_checks":object,"problems":string[],"retry_instruction":string}. Use true only when the dimension visibly passes or is genuinely not applicable.`,
    maxTokens: 3000,
  });
  const parsed = await repair.parseOrRepair({ raw: result.text, expected: 'object', modelGateway: gateway, taskId, stage: 'new_story_ad.json_repair' });
  let problems = Array.isArray(parsed.problems) ? parsed.problems.map(value => cleanText(value, 300)).filter(Boolean) : [];
  const structuredPartialPeopleMatch = approvedPartialPerson
    && humanApproved
    && problems.length > 0
    && problems.every(peopleProblemMatchesApprovedKeyframe)
    && parsed.action_pass === true;
  const approvedPeopleMatch = currentKeyframeAccepted
    && ((parsed.keyframe_people_match === true && parsed.unexpected_people_added !== true) || structuredPartialPeopleMatch);
  if (approvedPeopleMatch) {
    problems = problems.filter(problem => !peopleProblemMatchesApprovedKeyframe(problem));
  }
  const normalized = {
    ...parsed,
    pass: parsed.pass === true || approvedPeopleMatch,
    person_pass: personIdentity.shotPersonRequired(ctx, shot, contract) ? parsed.person_pass === true : true,
    product_pass: productIdentity.shotProductProofRequired(ctx, shot, contract) ? parsed.product_pass === true : true,
    scene_pass: parsed.scene_pass === true || structuredPartialPeopleMatch,
    action_pass: parsed.action_pass === true,
    people_count_pass: parsed.people_count_pass === true || approvedPeopleMatch,
    animal_count_pass: petRequired ? parsed.animal_count_pass === true : parsed.unexpected_animals_added !== true,
    pet_identity_pass: petRequired ? parsed.pet_identity_pass === true : true,
    text_watermark_pass: parsed.text_watermark_pass === true,
    anatomy_physics_pass: parsed.anatomy_physics_pass === true,
    temporal_stability_pass: parsed.temporal_stability_pass === true,
    rendering_intent_pass: parsed.rendering_intent_pass === true,
  };
  const decision = reviewDecision(normalized, problems, clip);
  const temporalDecision = normalizeTemporalEvidenceChecks(parsed, requiredEvidenceDimensions, {
    minimumEvidencePoints: 2,
    transitionEvidencePoints: 3,
    maxFrameIndex: frames.length - 1,
    maxTimeSec: Math.max(0, ...frames.map(frame => Number(frame.second) || 0)) + 0.1,
  });
  const legacyFailures = failedDimensionDetails(normalized, FRAME_DIMENSIONS);
  const temporalProblems = temporalDecision.failed.map(key => `${TEMPORAL_EVIDENCE_DIMENSIONS[key] || key}缺少可见证据`);
  return {
    qa_policy_version: VIDEO_FRAME_QA_POLICY_VERSION,
    pass: decision.pass && temporalDecision.pass,
    status: decision.pass && temporalDecision.pass ? 'verified' : 'rejected',
    person_pass: normalized.person_pass,
    product_pass: normalized.product_pass,
    scene_pass: normalized.scene_pass,
    action_pass: normalized.action_pass,
    people_count_pass: normalized.people_count_pass,
    text_watermark_pass: normalized.text_watermark_pass || decision.accepted_provenance_watermark,
    anatomy_physics_pass: normalized.anatomy_physics_pass,
    temporal_stability_pass: normalized.temporal_stability_pass,
    rendering_intent_pass: normalized.rendering_intent_pass,
    problems: [...decision.problems, ...temporalProblems],
    warnings: decision.warnings,
    keyframe_people_match: approvedPeopleMatch,
    unexpected_people_added: parsed.unexpected_people_added === true && !structuredPartialPeopleMatch,
    unexpected_animals_added: parsed.unexpected_animals_added === true,
    animal_count_pass: normalized.animal_count_pass,
    pet_identity_pass: normalized.pet_identity_pass,
    accepted_provenance_watermark: decision.accepted_provenance_watermark,
    retry_instruction: cleanText(parsed.retry_instruction || (temporalProblems.length ? `请修复：${temporalProblems.join('；')}` : ''), 800),
    evidence_checks: temporalDecision.checks,
    hard_failures: [
      ...legacyFailures.map(item => ({ dimension: item.code, label_zh: item.label, evidence: '' })),
      ...temporalDecision.failed.map(key => ({
        dimension: key,
        label_zh: TEMPORAL_EVIDENCE_DIMENSIONS[key] || key,
        evidence: temporalDecision.checks[key]?.evidence || '',
      })),
    ],
    failure_dimensions: [...legacyFailures.map(item => item.code), ...temporalDecision.failed],
    failure_labels_zh: [...legacyFailures.map(item => item.label), ...temporalDecision.failure_labels_zh],
    contract_fingerprint: String(contract.contract_fingerprint || ''),
    frames,
    checked_at: new Date().toISOString(),
    used_model: result.used_model,
  };
}

function crossShotBoundaryMode(previousShot = {}, currentShot = {}) {
  const previousSceneId = cleanText(previousShot.scene_id || previousShot.sceneId || '', 120);
  const currentSceneId = cleanText(currentShot.scene_id || currentShot.sceneId || '', 120);
  const sameScene = !previousSceneId || !currentSceneId || previousSceneId === currentSceneId;
  return {
    same_scene: sameScene,
    mode: sameScene ? 'same_scene_continuity' : 'intentional_scene_change',
    transition_type: cleanText(currentShot.transition_type || currentShot.transition || 'hard_cut', 40).toLowerCase(),
    transition_reason: cleanText(currentShot.transition_reason || '', 240),
    match_anchor: cleanText(
      currentShot.transition_match_anchor || currentShot.match_anchor || '',
      180,
    ),
  };
}

async function reviewCrossShot({ taskId = '', previous = null, current = null, previousShot = {}, currentShot = {}, previousLineageFingerprint = '', currentLineageFingerprint = '', ctx = {}, gateway = modelGateway, repair = jsonRepair } = {}) {
  const lineageBinding = { previous_lineage_fingerprint: String(previousLineageFingerprint || ''), current_lineage_fingerprint: String(currentLineageFingerprint || '') };
  const boundary = crossShotBoundaryMode(previousShot, currentShot);
  if (!hasReviewFrameEvidence(previous || {}) || !hasReviewFrameEvidence(current || {})) return {
    pass: false,
    status: 'rejected_missing_frame_evidence',
    qa_policy_version: VIDEO_FRAME_QA_POLICY_VERSION,
    ...lineageBinding,
    code: 'VIDEO_QA_EVIDENCE_MISSING',
    error_code: 'VIDEO_QA_EVIDENCE_MISSING',
    problems: ['Adjacent-shot continuity QA requires both previous-tail and current-head frame evidence.'],
    failure_dimensions: ['frame_evidence'],
    failure_labels_zh: ['相邻镜头帧证据'],
    checked_at: new Date().toISOString(),
    used_model: 'none/local-evidence-gate',
  };
  if (process.env.NEW_STORY_AD_MOCK_LLM === '1') return { pass: true, status: 'verified', qa_policy_version: VIDEO_FRAME_QA_POLICY_VERSION, ...lineageBinding, ...boundary, boundary_mode: boundary.mode, problems: [], checked_at: new Date().toISOString(), used_model: 'mock/new-story-ad-cross-shot-video-qa' };
  const previousTail = previous.frames[previous.frames.length - 1];
  const currentHead = current.frames[0];
  const previousTemporal = temporalEvidenceOf(previousShot, {});
  const currentTemporal = temporalEvidenceOf(currentShot, {});
  let requiredEvidenceDimensions = [...new Set([
    ...requiredTemporalDimensions(previousTemporal, { hasScene: !!previousShot.scene_id }),
    ...requiredTemporalDimensions(currentTemporal, { hasScene: !!currentShot.scene_id }),
  ])];
  if (!boundary.same_scene) {
    requiredEvidenceDimensions = requiredEvidenceDimensions.filter(key => key !== 'spatial_topology');
  }
  const crossSceneSchema = '{"pass":boolean,"person_identity_score":0..1,"wardrobe_score":0..1,"prop_intent_score":0..1,"transition_readability_score":0..1,"direction_intent_score":0..1,"action_transition_score":0..1,"match_anchor_score":0..1|null,"evidence_checks":object,"problems":string[]}';
  const sameSceneSchema = '{"pass":boolean,"person_position_score":0..1,"wardrobe_score":0..1,"prop_state_score":0..1,"scene_score":0..1,"screen_direction_score":0..1,"action_continuity_score":0..1,"evidence_checks":object,"problems":string[]}';
  const result = await gateway.generateVision({
    taskId,
    stage: 'new_story_ad.cross_shot_visual_qa',
    imageUrls: [previousTail, currentHead].map(frame => mediaAdapter.absolutePublicImageUrl(frame.image_url)),
    systemPrompt: `You are a strict adjacent-shot transition inspector for a general-purpose commercial video platform. Boundary mode is ${boundary.mode}. Return strict JSON only and judge only the current task.`,
    userPrompt: `Boundary contract: ${JSON.stringify(boundary)}\nPrevious shot: ${JSON.stringify(previousShot)}\nCurrent shot: ${JSON.stringify(currentShot)}\nContracts: ${JSON.stringify({ person: ctx.person_contract || null, product: ctx.product_contract || null, previous_temporal_evidence: previousTemporal, current_temporal_evidence: currentTemporal })}\nCompare the previous tail and current head. ${boundary.same_scene
      ? 'These shots stay in one scene. Enforce spatial, subject, prop, screen-direction and action continuity.'
      : 'These shots intentionally change scenes. Do NOT require the background, layout, camera position or subject screen position to remain the same. Judge whether the intended change is readable, identities and required state are preserved, the authored transition reason is supported, and cut_on_action or match_cut has visible boundary evidence.'} For required V2.0 dimensions ${JSON.stringify(requiredEvidenceDimensions)}, return evidence_checks[key]={"pass":boolean,"evidence":"visible comparison evidence","frame_indexes":[0,1]}. Do not infer evidence from text. Return ${boundary.same_scene ? sameSceneSchema : crossSceneSchema}.`,
    maxTokens: 2200,
  });
  const parsed = await repair.parseOrRepair({ raw: result.text, expected: 'object', modelGateway: gateway, taskId, stage: 'new_story_ad.json_repair' });
  const problems = Array.isArray(parsed.problems) ? parsed.problems.map(value => cleanText(value, 300)).filter(Boolean) : [];
  if (boundary.transition_type === 'match_cut' && !boundary.match_anchor) {
    problems.push('匹配切换缺少可验证的匹配锚点');
  }
  if (!boundary.same_scene && !boundary.transition_reason) {
    problems.push('跨场景切换缺少明确的叙事原因');
  }
  const scores = boundary.same_scene
    ? ['person_position_score', 'wardrobe_score', 'prop_state_score', 'scene_score', 'screen_direction_score', 'action_continuity_score']
    : ['person_identity_score', 'wardrobe_score', 'prop_intent_score', 'transition_readability_score', 'direction_intent_score', 'action_transition_score'];
  if (!boundary.same_scene && boundary.transition_type === 'match_cut') scores.push('match_anchor_score');
  const normalized = Object.fromEntries(scores.map(key => [key, Math.max(0, Math.min(1, Number(parsed[key]) || 0))]));
  const crossSceneDimensions = {
    person_identity_score: ['person_identity', '人物身份保持'],
    wardrobe_score: ['wardrobe', '服装与造型保持'],
    prop_intent_score: ['prop_intent', '道具状态与预期变化'],
    transition_readability_score: ['transition_readability', '跨场景切换可读性'],
    direction_intent_score: ['direction_intent', '运动方向与切换意图'],
    action_transition_score: ['action_transition', '动作切换承接'],
    match_anchor_score: ['match_anchor', '匹配锚点'],
  };
  const failed = failedDimensionDetails(
    normalized,
    boundary.same_scene ? CROSS_DIMENSIONS : crossSceneDimensions,
    0.7,
  );
  const temporalDecision = normalizeTemporalEvidenceChecks(parsed, requiredEvidenceDimensions, {
    minimumEvidencePoints: 2,
    transitionEvidencePoints: 2,
    maxFrameIndex: 1,
  });
  const pass = parsed.pass === true && !failed.length && temporalDecision.pass && !problems.length;
  const retryInstruction = cleanText(parsed.retry_instruction || [
    failed.length ? `Repair continuity dimensions: ${failed.map(item => item.code).join(', ')}.` : '',
    temporalDecision.failed.length ? `Repair V2.0 evidence dimensions: ${temporalDecision.failed.join(', ')}.` : '',
    problems.length ? `Observed problems: ${problems.join('; ')}.` : '',
  ].filter(Boolean).join(' '), 1000);
  return {
    qa_policy_version: VIDEO_FRAME_QA_POLICY_VERSION,
    ...lineageBinding,
    boundary_mode: boundary.mode,
    same_scene: boundary.same_scene,
    transition_type: boundary.transition_type,
    transition_reason: boundary.transition_reason,
    transition_match_anchor: boundary.match_anchor,
    pass, status: pass ? 'verified' : 'rejected', ...normalized,
    problems: [
      ...problems,
      ...temporalDecision.failed.map(key => `${TEMPORAL_EVIDENCE_DIMENSIONS[key] || key}缺少跨镜可见证据`),
    ],
    evidence_checks: temporalDecision.checks,
    hard_failures: [
      ...failed.map(item => ({ dimension: item.code, label_zh: item.label, evidence: '' })),
      ...temporalDecision.failed.map(key => ({
        dimension: key,
        label_zh: TEMPORAL_EVIDENCE_DIMENSIONS[key] || key,
        evidence: temporalDecision.checks[key]?.evidence || '',
      })),
    ],
    failure_dimensions: [...failed.map(item => item.code), ...temporalDecision.failed],
    failure_labels_zh: [...failed.map(item => item.label), ...temporalDecision.failure_labels_zh],
    retry_instruction: retryInstruction,
    checked_at: new Date().toISOString(), used_model: result.used_model,
  };
}

function crossShotFailure(qa = {}, index = 1) {
  const code = qa.error_code || qa.code || 'CROSS_SHOT_CONTINUITY_FAILED';
  return {
    code,
    message: code === 'VIDEO_QA_EVIDENCE_MISSING'
      ? `镜头 ${index}→${index + 1} 交接审核缺少尾帧或首帧证据`
      : '相邻镜头视觉连续性 QA 未通过',
  };
}

module.exports = {
  FRAME_POINTS,
  VIDEO_FRAME_QA_POLICY_VERSION,
  FRAME_DIMENSIONS,
  CROSS_DIMENSIONS,
  TEMPORAL_EVIDENCE_DIMENSIONS,
  failedDimensionDetails,
  temporalEvidenceOf,
  requiredTemporalDimensions,
  normalizeTemporalEvidenceChecks,
  extractReviewFrames,
  frameEvidenceUsable,
  hasReviewFrameEvidence,
  boundaryEvidenceIndexes,
  ensureBoundaryFrameEvidence,
  reviewDecision,
  expectedPeopleForShot,
  expectedAnimalsForShot: petIdentity.expectedAnimalsForShot,
  peopleProblemMatchesApprovedKeyframe,
  keyframeIsCurrentAndApproved,
  reconcileExistingApprovedPartialPersonQa,
  deterministicLocalMotionQa,
  verifyDeterministicLocalMotionClip,
  reviewVideoClip,
  crossShotBoundaryMode,
  reviewCrossShot,
  crossShotFailure,
};
