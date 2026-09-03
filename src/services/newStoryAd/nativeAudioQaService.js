'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { spawn } = require('child_process');
const ffmpeg = require('ffmpeg-static'), ffprobe = require('ffprobe-static').path;
const pipeline = require('../pipelineModelService'), adapters = require('./providerAdapterRegistry');
const storage = require('./storageService'), cancellation = require('./cancellationContext');
const native = require('./nativeAudioWorkflowService');
const POLICY = 'native-speech-and-lip-sync-v1';
const STAGE = 'new_story_ad.video_audio_qa';
const fail = (code, message) => Object.assign(new Error(message), { code, status: 422, retryable: false });
const normalized = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

function candidate() {
  if (process.env.NEW_STORY_AD_MOCK_LLM === '1') throw fail('VIDEO_AUDIO_QA_TEST_FIXTURE_REQUIRED', '测试必须注入真实音视频质检夹具，禁止调用生产模型。');
  const model = pipeline.pickAllEnabledWithDefault(STAGE).find(item => /^gemini-(?:2\.5|3)/.test(item.model_id || ''));
  if (!model) throw fail('VIDEO_AUDIO_QA_UNAVAILABLE', '缺少能读取实际音频与口型画面序列的质检模型，已在视频生成前停止。');
  try { adapters.resolveTextAdapter({ ...model, _capability: 'vision' }); }
  catch (error) { throw fail('VIDEO_AUDIO_QA_UNAVAILABLE', `声音与口型检测服务不可用：${error.message}`); }
  return model;
}
function execute(binary, args, includeStderr = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true }); let out = '', err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
    const signal = cancellation.signal(), abort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', data => { out += data; }); child.stderr.on('data', data => { err += data; });
    child.on('error', reject); child.on('close', code => { clearTimeout(timer); signal?.removeEventListener('abort', abort); code === 0 ? resolve(includeStderr ? out + err : out) : reject(fail('VIDEO_AUDIO_EVIDENCE_FAILED', err.slice(-800))); });
  });
}
function evaluate(result = {}, shot = {}, duration = 0) {
  const expected = native.speech(shot), dialogue = expected.some(unit => unit.kind === 'dialogue');
  const rows = Array.isArray(result.utterances) ? result.utterances : [];
  const problems = [];
  if (!Number.isFinite(duration) || duration <= 0) problems.push('视频时长证据无效');
  if (result.audio_observed !== true) problems.push('没有确认实际音轨');
  if (normalized(rows.map(row => row.text).join('')) !== normalized(expected.map(unit => unit.text).join(''))) problems.push('实际台词与剧情不一致，存在漏词、重复或多说');
  let previousEnd = -1;
  for (const row of rows) {
    if (!Number.isFinite(row.start_sec) || !Number.isFinite(row.end_sec) || row.start_sec < 0 || row.end_sec <= row.start_sec || row.end_sec > duration - 0.35 || row.start_sec < previousEnd - 0.05) problems.push('台词越过镜头边界或说话顺序异常');
    previousEnd = row.end_sec;
    if (row.complete !== true) problems.push('句尾或发音未完整结束');
  }
  if (!Number.isFinite(result.transcription_confidence) || result.transcription_confidence < 0.9 || (expected.length && !rows.length)) problems.push('语音证据不足');
  if (dialogue && (result.lip_sync?.verified !== true || !Number.isFinite(result.lip_sync?.confidence) || result.lip_sync.confidence < 0.9 || !Number.isFinite(result.lip_sync?.max_offset_ms) || Math.abs(result.lip_sync.max_offset_ms) > 120)) problems.push('出镜对白口型没有通过实际音视频同步检查');
  if (dialogue && result.speaker_assignment_correct !== true) problems.push('说话人物或对白轮次不一致');
  return { pass: !problems.length, policy: POLICY, problems: [...new Set(problems)], utterances: rows, lip_sync: result.lip_sync || null, observed_duration_sec: duration };
}
async function reviewEvidence({ taskId, clip, shot, index, generate = adapters.generateText, modelFor = candidate } = {}) {
  const file = clip.file_path;
  if (!file || !fs.existsSync(file)) throw fail('VIDEO_AUDIO_SOURCE_MISSING', '缺少可核验的原视频。');
  const sha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const signature = signatureFor(sha, shot);
  const kind = `native_audio_qa:${signature}`;
  const prior = storage.getOutput(taskId, kind);
  if (prior?.signature === signature) return prior;
  const units = native.speech(shot), dialogue = units.some(unit => unit.kind === 'dialogue');
  const directory = path.join(path.dirname(file), 'audio-qa', signature);
  fs.mkdirSync(directory, { recursive: true });
  const info = JSON.parse(await execute(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]));
  const duration = Number(info.format?.duration || 0);
  if (!(duration > 0)) throw fail('VIDEO_AUDIO_SOURCE_INVALID', '视频时长无效。');
  if (!info.streams?.some(stream => stream.codec_type === 'audio')) {
    if (native.wantsSound(shot)) throw fail('VIDEO_NATIVE_AUDIO_MISSING', '视频缺少真实音轨。');
    const qa = { pass: true, policy: POLICY, signature, file_sha256: sha, utterances: [], observed_duration_sec: duration, verified_silent: true };
    storage.saveOutput(taskId, kind, qa); return qa;
  }
  if (!native.wantsSound(shot)) {
    const level = await execute(ffmpeg, ['-hide_banner', '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], true);
    const peak = /max_volume:\s*(-?\d+(?:\.\d+)?|-inf)\s*dB/.exec(level);
    if (peak && (peak[1] === '-inf' || Number(peak[1]) <= -80)) {
      const qa = { pass: true, policy: POLICY, signature, file_sha256: sha, utterances: [], observed_duration_sec: duration, verified_silent: true };
      storage.saveOutput(taskId, kind, qa); return qa;
    }
  }
  const model = modelFor();
  const audio = path.join(directory, 'audio.wav');
  await execute(ffmpeg, ['-y', '-i', file, '-vn', '-ac', '1', '-ar', '16000', audio]);
  const parts = [{ type: 'text', text: `Listen to the ACTUAL supplied audio. Transcribe every spoken word verbatim, in order, with start_sec/end_sec and complete (false for clipped speech). Do not invent words. Video duration=${duration} seconds. ${dialogue ? 'The numbered frames cover the same audio at 12 frames/second, frame 1 at 0 seconds. Inspect actual mouth motion against phonemes, speaker turns and voice. If temporal evidence or mouth visibility is insufficient, lip_sync.verified MUST be false. Speaker roles: ' + JSON.stringify(units.map(unit => ({ kind: unit.kind, speaker: unit.speaker }))) : 'Speech is off-screen narration; mouth synchronization is not required.'} Return ONLY JSON: {"audio_observed":boolean,"transcription_confidence":0..1,"utterances":[{"text":string,"start_sec":number,"end_sec":number,"complete":boolean}],"speaker_assignment_correct":boolean,"lip_sync":{"verified":boolean,"max_offset_ms":number|null,"confidence":0..1}}. Music, ambient noise and singing are not substitutes for speech; transcribe unrequested speech too.` }, { type: 'input_audio', input_audio: { data: fs.readFileSync(audio).toString('base64'), format: 'wav' } }];
  if (dialogue) {
    await execute(ffmpeg, ['-y', '-i', file, '-vf', 'fps=12,scale=640:-2', '-frames:v', String(Math.ceil(duration * 12)), '-q:v', '5', path.join(directory, 'frame-%03d.jpg')]);
    for (const frame of fs.readdirSync(directory).filter(name => /^frame-\d+\.jpg$/.test(name)).sort()) parts.push({ type: 'text', text: frame }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${fs.readFileSync(path.join(directory, frame)).toString('base64')}` } });
  }
  const started = Date.now();
  try {
    const response = await generate({ model: { ...model, _stageId: STAGE, _capability: 'vision' }, systemPrompt: 'You are an audio and audiovisual synchronization examiner. Never infer missing audio evidence from text or image captions.', userPrompt: parts[0].text, messages: [{ role: 'user', content: parts }], maxTokens: 3500, retryEmptyResponse: false, temperature: 0, timeoutMs: 120000, signal: cancellation.signal() });
    const parsed = JSON.parse(String(response.text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
    const qa = { ...evaluate(parsed, shot, duration), signature, file_sha256: sha, checked_at: new Date().toISOString(), used_model: `${model.provider_id}/${model.model_id}` };
    storage.saveModelCall({ task_id: taskId, stage: STAGE, provider_id: model.provider_id, model_id: model.model_id, status: 'success', latency_ms: Date.now() - started, provider_submission_state: 'completed', billing_state: 'confirmed', shot_index: index });
    storage.saveOutput(taskId, kind, qa); return qa;
  } catch (error) {
    storage.saveModelCall({ task_id: taskId, stage: STAGE, provider_id: model.provider_id, model_id: model.model_id, status: 'failed', latency_ms: Date.now() - started, error_code: error.code || 'VIDEO_AUDIO_QA_FAILED', error_message: error.message, billing_state: 'unknown', shot_index: index });
    storage.saveOutput(taskId, kind, { pass: false, policy: POLICY, signature, file_sha256: sha, problems: ['声音/口型质检未完成，禁止自动重复调用'], error_code: error.code || 'VIDEO_AUDIO_QA_FAILED' });
    throw fail('VIDEO_AUDIO_QA_FAILED', `音频或口型质检未能完成，当前镜头不能通过：${error.message}`);
  }
}
const inFlight = new Map();
function review(options = {}) {
  const key = JSON.stringify([options.taskId, options.clip?.file_path, native.speech(options.shot), native.wantsSound(options.shot)]);
  if (inFlight.has(key)) return inFlight.get(key);
  const work = reviewEvidence(options).finally(() => inFlight.delete(key));
  inFlight.set(key, work); return work;
}
function assertVerified(clip, shot) {
  const qa = clip?.native_audio_qa;
  if (!qa?.pass || qa.policy !== POLICY || !clip?.file_path || !fs.existsSync(clip.file_path) || qa.file_sha256 !== crypto.createHash('sha256').update(fs.readFileSync(clip.file_path)).digest('hex') || qa.signature !== signatureFor(qa.file_sha256, shot)) throw fail('VIDEO_AUDIO_QA_REQUIRED', '当前视频缺少与实际文件、台词一致的声音/口型验收，不能合成。');
  return qa;
}
function signatureFor(sha, shot) { return storage.canonicalFingerprint({ sha, speech: native.speech(shot), sound_required: native.wantsSound(shot), policy: POLICY }); }
async function reviewFinal({ taskId, candidate: movie, shots }) {
  const folder = path.join(path.dirname(movie.file_path), 'audio-qa', crypto.createHash('sha256').update(fs.readFileSync(movie.file_path)).digest('hex'));
  fs.mkdirSync(folder, { recursive: true });
  let start = 0;
  for (let index = 0; index < shots.length; index++) {
    start -= Number(movie.transitionPlan[index]?.overlap_sec || 0);
    const duration = movie.durations[index], file = path.join(folder, `edited-shot-${index + 1}.mp4`);
    await execute(ffmpeg, ['-y', '-ss', start.toFixed(3), '-i', movie.file_path, '-t', Number(duration).toFixed(3), '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-c:a', 'aac', file]);
    const qa = await review({ taskId, clip: { file_path: file }, shot: shots[index], index });
    if (!qa.pass) throw fail('EDITED_AUDIO_QA_FAILED', `第 ${index + 1} 镜修改后的声音或口型未通过验收，保留原成片。`);
    start += duration;
  }
}
module.exports = { POLICY, STAGE, candidate, evaluate, review, reviewFinal, assertVerified, signatureFor, normalized };
