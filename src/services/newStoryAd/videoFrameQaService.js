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
const { cleanText } = require('./contextBuilder');

const FRAME_POINTS = [0, 0.25, 0.5, 0.75, 1];

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
  const input = clip.file_path || clip.filePath || '';
  if (!input || !fs.existsSync(input)) {
    const error = new Error(`第 ${index + 1} 镜视频文件不存在，无法执行抽帧 QA`);
    error.code = 'VIDEO_FILE_MISSING';
    throw error;
  }
  const duration = Math.max(0.2, Number(clip.duration_sec || clip.duration || 5) || 5);
  const frames = [];
  for (let i = 0; i < FRAME_POINTS.length; i += 1) {
    cancellation.throwIfCancelled(taskId);
    const point = FRAME_POINTS[i];
    const second = Math.max(0, Math.min(duration - 0.05, duration * point));
    const filename = `video_qa_${String(taskId).replace(/[^a-z0-9_-]/ig, '_')}_${index + 1}_${i}_${Date.now()}.jpg`;
    const output = path.join(mediaAdapter.ASSET_DIR, filename);
    fs.mkdirSync(mediaAdapter.ASSET_DIR, { recursive: true });
    await runFfmpeg(['-y', '-ss', second.toFixed(3), '-i', input, '-frames:v', '1', '-q:v', '3', output]);
    frames.push({ point, second, filename, file_path: output, image_url: mediaAdapter.publicAssetUrl(filename) });
  }
  return frames;
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
  const acceptedKeyframeRef = humanApproved ? mediaAdapter.absolutePublicImageUrl(keyframe.image_url || keyframe.imageUrl || '') : '';
  const references = humanApproved
    ? [acceptedKeyframeRef, personRef, productRef].filter(Boolean)
    : [sceneRef.url || sceneRef.image_url || '', personRef, productRef].filter(Boolean);
  const expectedPeople = expectedPeopleForShot(ctx, shot);
  const result = await gateway.generateVision({
    taskId,
    stage: 'new_story_ad.video_frame_qa',
    imageUrls: [...references, ...frames.map(frame => mediaAdapter.absolutePublicImageUrl(frame.image_url))].slice(0, 8),
    systemPrompt: [
      'You are a strict multi-frame commercial video inspector for a general-purpose platform.',
      'The first optional images are current-task scene/person/product references. The remaining images are ordered samples from one generated clip.',
      'The task may cover any lawful industry, scene, person, product or visual medium. Never impose a fixed template. Return strict JSON only.',
    ].join('\n'),
    userPrompt: `Current task contracts: ${JSON.stringify({ person: ctx.person_contract || null, product: ctx.product_contract || null, scene: contract.scene_lock || null })}\nHuman-approved keyframe: ${JSON.stringify(humanApproved ? { authoritative: true, reason: keyframe.qa?.override_reason || keyframe.manual_acceptance?.reason || 'user approved current visual' } : { authoritative: false })}\nShot: ${JSON.stringify({ title: shot.title, visual: shot.visual, action: shot.action, characters: shot.characters, duration: shot.duration, expected_people: expectedPeople })}\nHard rules: if a human-approved keyframe is authoritative, judge scene/material/layout consistency against that accepted keyframe and do not reject intentional seams, panel layout, crop or starting subject presence merely because they conflict with older automated scene observations. Still reject drift away from the accepted keyframe, wrong action, identity/product changes, unexpected people or watermarks. If a verified person contract exists, every visible principal person must match it; reject any replacement, extra principal person, identity drift or wardrobe drift. If expected_people is 0, reject any visible human. If expected_people is a number, people_count_pass is true only when the visible principal cast count matches it. Return {"pass":boolean,"person_pass":boolean,"product_pass":boolean,"scene_pass":boolean,"action_pass":boolean,"people_count_pass":boolean,"text_watermark_pass":boolean,"problems":string[],"retry_instruction":string}. Use true for a dimension only when it is genuinely not applicable.`,
    maxTokens: 3000,
  });
  const parsed = await repair.parseOrRepair({ raw: result.text, expected: 'object', modelGateway: gateway, taskId, stage: 'new_story_ad.json_repair' });
  const problems = Array.isArray(parsed.problems) ? parsed.problems.map(value => cleanText(value, 300)).filter(Boolean) : [];
  const normalized = {
    ...parsed,
    person_pass: personIdentity.shotPersonRequired(ctx, shot, contract) ? parsed.person_pass === true : true,
    product_pass: productIdentity.productRequired(ctx) ? parsed.product_pass === true : true,
    scene_pass: parsed.scene_pass === true,
    action_pass: parsed.action_pass === true,
    people_count_pass: parsed.people_count_pass === true,
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
    accepted_provenance_watermark: decision.accepted_provenance_watermark,
    retry_instruction: cleanText(parsed.retry_instruction || '', 800),
    frames,
    checked_at: new Date().toISOString(),
    used_model: result.used_model,
  };
}

async function reviewCrossShot({ taskId = '', previous = null, current = null, previousShot = {}, currentShot = {}, ctx = {}, gateway = modelGateway, repair = jsonRepair } = {}) {
  if (!previous?.frames?.length || !current?.frames?.length) return { pass: true, status: 'not_applicable', problems: [] };
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
  const pass = parsed.pass === true && scores.every(key => normalized[key] >= 0.7) && !problems.length;
  return { pass, status: pass ? 'verified' : 'rejected', ...normalized, problems, checked_at: new Date().toISOString(), used_model: result.used_model };
}

module.exports = { FRAME_POINTS, extractReviewFrames, reviewDecision, expectedPeopleForShot, reviewVideoClip, reviewCrossShot };
