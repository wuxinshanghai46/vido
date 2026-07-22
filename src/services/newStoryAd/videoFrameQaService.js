const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const modelGateway = require('./modelGateway');
const jsonRepair = require('./jsonRepairService');
const mediaAdapter = require('./mediaAdapter');
const cancellation = require('./cancellationContext');
const personIdentity = require('./personIdentityContractService');
const productIdentity = require('./productIdentityContractService');
const motionAwareEdit = require('./motionAwareEditService');
const { cleanText } = require('./contextBuilder');
const contractFreshness = require('./keyframeContractFreshnessService');

const FRAME_POINTS = [0, 0.25, 0.5, 0.75, 1];
const FRAME_DIMENSIONS = {
  person_pass: ['person_identity', '人物身份与造型'],
  product_pass: ['product_identity', '产品与主体一致性'],
  scene_pass: ['scene_consistency', '场景与环境一致性'],
  action_pass: ['action_fulfillment', '动作与镜头意图'],
  people_count_pass: ['people_count', '出镜人数'],
  text_watermark_pass: ['text_watermark', '文字或水印'],
};
const CROSS_DIMENSIONS = {
  person_position_score: ['person_position', '人物位置连续性'],
  wardrobe_score: ['wardrobe', '服装与造型连续性'],
  prop_state_score: ['prop_state', '道具与主体状态连续性'],
  scene_score: ['scene_continuity', '相邻场景连续性'],
  screen_direction_score: ['screen_direction', '运动与视线方向连续性'],
  action_continuity_score: ['action_continuity', '动作承接连续性'],
};

function failedDimensionDetails(values = {}, mapping = {}, threshold = null) {
  return Object.entries(mapping).filter(([key]) => (
    threshold === null ? values[key] === false : Number(values[key] || 0) < threshold
  )).map(([key, [code, label]]) => ({ key, code, label }));
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
async function ensureBoundaryFrameEvidence({ taskId = '', clips = [], targetIndexes = [] } = {}) {
  const next = Array.isArray(clips) ? clips.slice() : [];
  const targets = new Set((Array.isArray(targetIndexes) ? targetIndexes : [])
    .map(Number).filter(index => Number.isInteger(index) && index >= 0));
  const boundaryIndexes = [...targets]
    .filter(index => index > 0 && !targets.has(index - 1))
    .map(index => index - 1)
    .sort((a, b) => a - b);
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
  const dimensions = ['person_pass', 'product_pass', 'scene_pass', 'action_pass', 'people_count_pass', 'text_watermark_pass'];
  return parsed.pass === true && dimensions.every(key => parsed[key] === true);
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
    .every(key => parsed[key] === true);
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
    return { pass: true, status: 'verified', frames, person_pass: true, product_pass: true, scene_pass: true, action_pass: true, people_count_pass: true, text_watermark_pass: true, problems: [], checked_at: new Date().toISOString(), used_model: 'mock/new-story-ad-video-frame-qa' };
  }
  const sceneRef = contract.scene_lock?.view_images?.find(view => view.key === contract.scene_lock?.scene_view)
    || contract.scene_lock?.view_images?.[0] || {};
  const personRef = Object.values((ctx.person_contract || ctx.person_asset?.person_contract || {}).reference_views || {}).find(Boolean) || '';
  const productRef = (ctx.product_contract?.reference_images || [])[0] || '';
  const humanApproved = keyframe.qa?.manual_override === true || keyframe.current_generation_status === 'manual_accepted';
  const currentKeyframeAccepted = !!(keyframe.image_url || keyframe.imageUrl)
    && keyframe.qa?.pass === true
    && (!contract.contract_fingerprint || contractFreshness.artifactMatchesContract(keyframe, contract));
  const acceptedKeyframeRef = currentKeyframeAccepted ? mediaAdapter.absolutePublicImageUrl(keyframe.image_url || keyframe.imageUrl || '') : '';
  const references = currentKeyframeAccepted
    ? [acceptedKeyframeRef, personRef, productRef].filter(Boolean)
    : [sceneRef.url || sceneRef.image_url || '', personRef, productRef].filter(Boolean);
  const keyframePersonPresence = String(keyframe.qa?.person?.person_presence || keyframe.person_presence || '').trim().toLowerCase();
  const approvedPartialPerson = currentKeyframeAccepted && keyframePersonPresence === 'partial';
  const expectedPeople = ['person', 'partial'].includes(keyframePersonPresence)
    ? Math.max(1, Number(expectedPeopleForShot(ctx, shot) || 0))
    : expectedPeopleForShot(ctx, shot);
  const result = await gateway.generateVision({
    taskId,
    stage: 'new_story_ad.video_frame_qa',
    imageUrls: [...references, ...frames.map(frame => mediaAdapter.absolutePublicImageUrl(frame.image_url))].slice(0, 8),
    systemPrompt: [
      'You are a strict multi-frame commercial video inspector for a general-purpose platform.',
      'The first optional images are current-task scene/person/product references. The remaining images are ordered samples from one generated clip.',
      'The task may cover any lawful industry, scene, person, product or visual medium. Never impose a fixed template. Return strict JSON only.',
    ].join('\n'),
    userPrompt: `Current task contracts: ${JSON.stringify({ person: ctx.person_contract || null, product: ctx.product_contract || null, scene: contract.scene_lock || null })}\nCurrent approved keyframe: ${JSON.stringify(currentKeyframeAccepted ? { authoritative: true, human_override: humanApproved, expected_person_presence: keyframePersonPresence || 'unknown', reason: keyframe.qa?.override_reason || keyframe.manual_acceptance?.reason || 'current contract-matched keyframe passed QA' } : { authoritative: false })}\nShot: ${JSON.stringify({ title: shot.title, visual: shot.visual, action: shot.action, characters: shot.characters, duration: shot.duration, expected_people: expectedPeople, expected_person_presence: keyframePersonPresence || null, surface_topology: shot.surface_topology || null })}\nHard rules: if the current approved keyframe is authoritative, judge scene geometry, material topology, seams, panel layout, crop, starting subject placement, and any already-visible partial person/body part against that keyframe. Reject added seams, wall segmentation, ceiling/floor reconstruction, material replacement or any other visible drift away from it, even when older scene observations differ. The structured expected_person_presence value comes from the already-approved keyframe review and is authoritative: when it is partial, the hand/arm/body part already present in the approved keyframe is allowed and must not be treated as a newly introduced person merely because characters is empty. In that case set keyframe_people_match=true and people_count_pass=true when the clip preserves that partial-person state. Still reject a genuinely new principal person, wrong action, identity/product changes or watermarks. If a verified person contract exists, every visible principal person must match it; reject any replacement, extra principal person, identity drift or wardrobe drift. If no authoritative keyframe exists and expected_people is 0, reject any visible human. If expected_people is a number, people_count_pass is true only when the visible principal cast count matches it or the approved keyframe visibly proves the authored partial-person state. Return {"pass":boolean,"person_pass":boolean,"product_pass":boolean,"scene_pass":boolean,"action_pass":boolean,"people_count_pass":boolean,"keyframe_people_match":boolean,"unexpected_people_added":boolean,"text_watermark_pass":boolean,"problems":string[],"retry_instruction":string}. Use true for a dimension only when it is genuinely not applicable.`,
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
    product_pass: productIdentity.productRequired(ctx) ? parsed.product_pass === true : true,
    scene_pass: parsed.scene_pass === true || structuredPartialPeopleMatch,
    action_pass: parsed.action_pass === true,
    people_count_pass: parsed.people_count_pass === true || approvedPeopleMatch,
    text_watermark_pass: parsed.text_watermark_pass === true,
  };
  const decision = reviewDecision(normalized, problems, clip);
  return {
    pass: decision.pass,
    status: decision.pass ? 'verified' : 'rejected',
    person_pass: normalized.person_pass,
    product_pass: normalized.product_pass,
    scene_pass: normalized.scene_pass,
    action_pass: normalized.action_pass,
    people_count_pass: normalized.people_count_pass,
    text_watermark_pass: normalized.text_watermark_pass || decision.accepted_provenance_watermark,
    problems: decision.problems,
    warnings: decision.warnings,
    keyframe_people_match: approvedPeopleMatch,
    unexpected_people_added: parsed.unexpected_people_added === true && !structuredPartialPeopleMatch,
    accepted_provenance_watermark: decision.accepted_provenance_watermark,
    retry_instruction: cleanText(parsed.retry_instruction || '', 800),
    failure_dimensions: failedDimensionDetails(normalized, FRAME_DIMENSIONS).map(item => item.code),
    failure_labels_zh: failedDimensionDetails(normalized, FRAME_DIMENSIONS).map(item => item.label),
    contract_fingerprint: String(contract.contract_fingerprint || ''),
    frames,
    checked_at: new Date().toISOString(),
    used_model: result.used_model,
  };
}

async function reviewCrossShot({ taskId = '', previous = null, current = null, previousShot = {}, currentShot = {}, ctx = {}, gateway = modelGateway, repair = jsonRepair } = {}) {
  if (!hasReviewFrameEvidence(previous || {}) || !hasReviewFrameEvidence(current || {})) return {
    pass: false,
    status: 'rejected_missing_frame_evidence',
    code: 'VIDEO_QA_EVIDENCE_MISSING',
    error_code: 'VIDEO_QA_EVIDENCE_MISSING',
    problems: ['Adjacent-shot continuity QA requires both previous-tail and current-head frame evidence.'],
    failure_dimensions: ['frame_evidence'],
    failure_labels_zh: ['相邻镜头帧证据'],
    checked_at: new Date().toISOString(),
    used_model: 'none/local-evidence-gate',
  };
  if (process.env.NEW_STORY_AD_MOCK_LLM === '1') return { pass: true, status: 'verified', problems: [], checked_at: new Date().toISOString(), used_model: 'mock/new-story-ad-cross-shot-video-qa' };
  const previousTail = previous.frames[previous.frames.length - 1];
  const currentHead = current.frames[0];
  const result = await gateway.generateVision({
    taskId,
    stage: 'new_story_ad.cross_shot_visual_qa',
    imageUrls: [previousTail, currentHead].map(frame => mediaAdapter.absolutePublicImageUrl(frame.image_url)),
    systemPrompt: 'You are a strict adjacent-shot continuity inspector for a general-purpose commercial video platform. Return strict JSON only and judge only the current task.',
    userPrompt: `Previous shot: ${JSON.stringify(previousShot)}\nCurrent shot: ${JSON.stringify(currentShot)}\nContracts: ${JSON.stringify({ person: ctx.person_contract || null, product: ctx.product_contract || null })}\nReturn {"pass":boolean,"person_position_score":0..1,"wardrobe_score":0..1,"prop_state_score":0..1,"scene_score":0..1,"screen_direction_score":0..1,"action_continuity_score":0..1,"problems":string[]}.`,
    maxTokens: 2200,
  });
  const parsed = await repair.parseOrRepair({ raw: result.text, expected: 'object', modelGateway: gateway, taskId, stage: 'new_story_ad.json_repair' });
  const problems = Array.isArray(parsed.problems) ? parsed.problems.map(value => cleanText(value, 300)).filter(Boolean) : [];
  const scores = ['person_position_score', 'wardrobe_score', 'prop_state_score', 'scene_score', 'screen_direction_score', 'action_continuity_score'];
  const normalized = Object.fromEntries(scores.map(key => [key, Math.max(0, Math.min(1, Number(parsed[key]) || 0))]));
  const failed = failedDimensionDetails(normalized, CROSS_DIMENSIONS, 0.7);
  const pass = parsed.pass === true && !failed.length && !problems.length;
  const retryInstruction = cleanText(parsed.retry_instruction || [
    failed.length ? `Repair continuity dimensions: ${failed.map(item => item.code).join(', ')}.` : '',
    problems.length ? `Observed problems: ${problems.join('; ')}.` : '',
  ].filter(Boolean).join(' '), 1000);
  return {
    pass, status: pass ? 'verified' : 'rejected', ...normalized, problems,
    failure_dimensions: failed.map(item => item.code),
    failure_labels_zh: failed.map(item => item.label),
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
  FRAME_DIMENSIONS,
  CROSS_DIMENSIONS,
  failedDimensionDetails,
  extractReviewFrames,
  frameEvidenceUsable,
  hasReviewFrameEvidence,
  ensureBoundaryFrameEvidence,
  reviewDecision,
  expectedPeopleForShot,
  peopleProblemMatchesApprovedKeyframe,
  keyframeIsCurrentAndApproved,
  reconcileExistingApprovedPartialPersonQa,
  deterministicLocalMotionQa,
  verifyDeterministicLocalMotionClip,
  reviewVideoClip,
  reviewCrossShot,
  crossShotFailure,
};
