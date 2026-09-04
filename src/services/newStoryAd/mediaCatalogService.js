'use strict';

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;

function clean(value, max = 1200) { return String(value ?? '').trim().slice(0, max); }
function list(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }
function boundedOffset(value) { return Math.max(0, Number(value) || 0); }
function boundedLimit(value) { return Math.max(1, Math.min(MAX_LIMIT, Number(value) || DEFAULT_LIMIT)); }

function imagePreview(url = '', width = 480) {
  const value = clean(url);
  if (!value || !value.startsWith('/api/new-story-ad/assets/')) return value;
  return `${value}${value.includes('?') ? '&' : '?'}thumb=${Math.max(160, Math.min(960, Number(width) || 480))}`;
}

function item(kind, source = {}, index = 0) {
  const imageUrl = clean(source.thumbnail_url || source.image_url || source.imageUrl || source.poster_url || source.posterUrl);
  const videoUrl = clean(source.video_url || source.videoUrl || source.file_url || (/\.mp4(?:\?|$)/i.test(clean(source.url)) ? source.url : ''));
  const audioUrl = clean(source.audio_url || source.audioUrl || (/\.(?:mp3|wav|m4a)(?:\?|$)/i.test(clean(source.url)) ? source.url : ''));
  const originalUrl = videoUrl || audioUrl || imageUrl || clean(source.url || source.file_path);
  const qaFailed = source.qa?.pass === false || source.qa_status === 'failed' || source.lifecycle === 'qa_failed';
  const qaPassed = source.qa?.pass === true || source.qa_status === 'passed' || source.lifecycle === 'qa_passed';
  return {
    id: clean(source.permanent_id || source.id || source.candidate_id || source.provider_task_id || `${kind}_${index + 1}`, 200),
    kind,
    index: Number(source.index ?? source.shot_index ?? index) + (source.index === undefined && source.shot_index === undefined ? 1 : 0),
    title: clean(source.title || source.name || source.label || `${kind} ${index + 1}`, 160),
    status: clean(qaFailed ? 'qa_failed' : (qaPassed ? 'qa_passed' : (source.lifecycle || source.status || (originalUrl ? 'ready' : 'pending'))), 60),
    preview_url: imagePreview(imageUrl || clean(source.first_frame_url || source.firstFrameUrl), 480),
    poster_url: imagePreview(clean(source.poster_url || source.posterUrl || imageUrl), 640),
    original_url: originalUrl,
    thumbnail_url: imagePreview(imageUrl || clean(source.first_frame_url || source.firstFrameUrl), 480),
    image_url: imagePreview(imageUrl, 640),
    video_url: videoUrl,
    audio_url: audioUrl,
    media_type: videoUrl ? 'video' : (audioUrl ? 'audio' : 'image'),
    duration_sec: Math.max(0, Number(source.duration_sec || source.duration || 0) || 0),
    billing_state: clean(source.billing_state || source.last_attempt_billing_state, 40),
    provider_submission_state: clean(source.provider_submission_state, 60),
    qa_pass: qaFailed ? false : (qaPassed ? true : null),
    qa_failure_labels_zh: list(source.qa?.failure_labels_zh || source.qa_failure_labels_zh).map(value => clean(value, 80)).slice(0, 6),
    updated_at: clean(source.updated_at || source.created_at, 50),
  };
}

function rows(outputs = {}, kind = 'all') {
  const groups = {
    keyframes: list(outputs.keyframes).map((entry, index) => item('keyframe', entry, index)),
    clips: list(outputs.video_clips).map((entry, index) => item('clip', entry, index)),
    audio: list(outputs.sound_journey || outputs.tts_audio?.segments).map((entry, index) => item('audio', entry, index)),
  };
  if (kind === 'keyframes' || kind === 'keyframe') return groups.keyframes;
  if (kind === 'clips' || kind === 'clip' || kind === 'video') return groups.clips;
  if (kind === 'audio') return groups.audio;
  return [...groups.keyframes, ...groups.clips, ...groups.audio];
}

function page(outputs = {}, options = {}) {
  const kind = clean(options.kind || 'all', 30).toLowerCase();
  const offset = boundedOffset(options.offset);
  const limit = boundedLimit(options.limit);
  const all = rows(outputs, kind);
  const selected = all.slice(offset, offset + limit);
  return {
    schema_version: 1,
    kind,
    offset,
    limit,
    total: all.length,
    has_more: offset + selected.length < all.length,
    next_offset: offset + selected.length < all.length ? offset + selected.length : null,
    items: selected,
  };
}

module.exports = { DEFAULT_LIMIT, MAX_LIMIT, boundedLimit, imagePreview, item, rows, page };
