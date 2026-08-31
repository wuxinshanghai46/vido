'use strict';

const contentRecords = require('../repositories/contentRecordRepository');

const STORY_CALL_COLLECTION = 'new_story_ad_model_calls';

function clean(value = '') { return String(value ?? '').trim(); }
function number(value = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }

function categoryFor(call = {}) {
  const text = `${clean(call.stage)} ${clean(call.model_id)}`.toLowerCase();
  if (/video|seedance|sora|veo|kling|hailuo/.test(text)) return 'video';
  if (/image|keyframe|storyboard_image|seedream|imagen|flux|gpt-image/.test(text)) return 'image';
  if (/tts|speech|audio|voice/.test(text)) return 'tts';
  return 'llm';
}

function projectStoryCall(call = {}) {
  const timestamp = clean(call.created_at || call.started_at || call.updated_at);
  const provider = clean(call.provider_id || call.provider);
  const model = clean(call.model_id || call.model);
  const stage = clean(call.stage || call.operation);
  const successful = clean(call.status || call.state).toLowerCase() === 'success';
  return {
    id: `new-story-ad:${clean(call.id)}`,
    timestamp,
    provider,
    model,
    category: categoryFor(call),
    input_tokens: number(call.input_tokens),
    output_tokens: number(call.output_tokens),
    total_tokens: number(call.total_tokens || (number(call.input_tokens) + number(call.output_tokens))),
    video_seconds: number(call.video_seconds),
    image_count: number(call.image_count),
    tts_chars: number(call.tts_chars),
    cost_usd: number(call.cost_usd),
    duration_ms: number(call.latency_ms || call.duration_ms),
    status: successful ? 'success' : 'fail',
    usage_source: clean(call.usage_source) || 'authoritative_story_call_ledger',
    billing_state: clean(call.billing_state),
    source: STORY_CALL_COLLECTION,
    operation: stage,
    workflow_id: clean(call.generation_id),
    step_id: clean(call.shot_index),
    user_id: clean(call.user_id),
    agent_id: stage || 'new_story_ad',
    request_id: clean(call.provider_request_id || call.provider_task_id || call.provider_submission_id || call.id),
    project_id: clean(call.project_id || call.task_id),
    error_msg: clean(call.error_message || call.error_msg || call.error),
  };
}

function storyCallRecords() {
  try {
    return contentRecords.list(STORY_CALL_COLLECTION).map(projectStoryCall).filter(row => row.timestamp);
  } catch (error) {
    // The legacy JSON-only development mode may not have the SQLite collection.
    if (/database|sqlite|content_records|no such table/i.test(clean(error?.message))) return [];
    throw error;
  }
}

function sameProviderRequest(left = {}, right = {}) {
  const a = clean(left.request_id); const b = clean(right.request_id);
  return Boolean(a && b && a === b);
}

function mergeUsageRecords(legacy = [], story = []) {
  const merged = [...legacy];
  story.forEach(row => {
    if (!merged.some(existing => sameProviderRequest(existing, row))) merged.push(row);
  });
  return merged.sort((a, b) => clean(b.timestamp).localeCompare(clean(a.timestamp)));
}

function matches(row = {}, filter = {}) {
  if (filter.from && clean(row.timestamp) < filter.from) return false;
  if (filter.to && clean(row.timestamp) > filter.to) return false;
  for (const field of ['provider', 'model', 'category', 'agent_id', 'status']) {
    if (filter[field] && clean(row[field]) !== clean(filter[field])) return false;
  }
  return true;
}

function listUnified(legacy = [], filter = {}) {
  return mergeUsageRecords(legacy, storyCallRecords()).filter(row => matches(row, filter));
}

module.exports = {
  STORY_CALL_COLLECTION,
  categoryFor,
  projectStoryCall,
  mergeUsageRecords,
  matches,
  listUnified,
  storyCallRecords,
};
