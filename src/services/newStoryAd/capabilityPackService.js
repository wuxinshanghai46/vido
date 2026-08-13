'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PACK_PATH = path.resolve(__dirname, '../../../config/story-ad-capability-packs.json');
let cached = null;
let cachedMtime = 0;

function clean(value, max = 120) {
  return String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_').slice(0, max);
}
function fail(message, code, status = 422, details = {}) {
  const error = new Error(message); error.code = code; error.status = status; error.retryable = false;
  Object.assign(error, details); return error;
}
function readRegistry() {
  const stat = fs.statSync(PACK_PATH);
  if (!cached || Number(stat.mtimeMs) !== cachedMtime) {
    const parsed = JSON.parse(fs.readFileSync(PACK_PATH, 'utf8'));
    if (Number(parsed.schema_version || 0) !== 1) throw fail('能力包配置版本不受支持', 'CAPABILITY_PACK_SCHEMA_UNSUPPORTED', 500);
    cached = parsed; cachedMtime = Number(stat.mtimeMs);
  }
  return cached;
}
function normalizeContentForm(value = '') {
  const key = clean(value);
  const aliases = {
    ad: 'commercial_live_action', commercial: 'commercial_live_action', commercial_subject: 'commercial_live_action',
    story: 'narrative_live_action', narrative: 'narrative_live_action', narrative_story: 'narrative_live_action',
    comic: 'comic_narrative', comic_story: 'comic_narrative', animation: 'comic_narrative', animated_story: 'comic_narrative',
  };
  return aliases[key] || key;
}
function inferContentForm(context = {}) {
  const explicit = normalizeContentForm(context.content_form || context.contentForm);
  if (explicit) return explicit;
  const production = clean(context.production_mode || context.productionMode);
  if (['comic_narrative', 'motion_comic', 'animation', 'animated'].includes(production)) return 'comic_narrative';
  const mode = clean(context.content_mode || context.contentMode || context.product_presentation?.mode);
  return mode === 'narrative_story' ? 'narrative_live_action' : 'commercial_live_action';
}
function resolve(context = {}) {
  const registry = readRegistry();
  const contentFormId = inferContentForm(context);
  const contentForm = registry.content_forms[contentFormId];
  if (!contentForm) throw fail(`未知内容形态 ${contentFormId}`, 'CONTENT_FORM_INVALID', 422, { content_form: contentFormId });
  const requestedMode = clean(context.content_mode || context.contentMode || context.product_presentation?.mode);
  if (requestedMode && requestedMode !== contentForm.content_mode) {
    throw fail('内容形态与广告/剧情类型冲突，已在生成前停止', 'CONTENT_FORM_MODE_CONFLICT', 409, {
      content_form: contentFormId, expected_content_mode: contentForm.content_mode, actual_content_mode: requestedMode,
    });
  }
  const industryId = clean(context.industry_profile || context.industryProfile || context.industry || 'generic');
  const industry = registry.industry_profiles[industryId];
  if (!industry) throw fail(`未知行业能力包 ${industryId}`, 'INDUSTRY_PROFILE_INVALID', 422, { industry_profile: industryId });
  const snapshot = {
    schema_version: registry.schema_version,
    content_form_id: contentFormId, content_form: { ...contentForm },
    story_structure_id: contentForm.story_structure, story_structure: { ...registry.story_structures[contentForm.story_structure] },
    scene_prototype_id: contentForm.scene_prototype, scene_prototype: { ...registry.scene_prototypes[contentForm.scene_prototype] },
    industry_profile_id: industryId, industry_profile: { ...industry },
  };
  snapshot.fingerprint = crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  return snapshot;
}
function promptBlock(context = {}) {
  const pack = resolve(context);
  return [
    `内容形态：${pack.content_form.label}（${pack.content_form_id}）。`,
    `剧情结构：${pack.story_structure_id}；节拍=${pack.story_structure.beats.join(' > ')}。`,
    `场景原型：${pack.scene_prototype_id}；必填=${pack.scene_prototype.required_fields.join('、')}。`,
    `行业能力包：${pack.industry_profile.label}（${pack.industry_profile_id}）；证据=${pack.industry_profile.evidence_types.join('、')}。`,
    `禁止：${pack.story_structure.forbidden.join('、')}。行业提示只能补充用户事实，不得覆盖人物、地点、场景或剧情。`,
  ].join('\n');
}

module.exports = { PACK_PATH, readRegistry, normalizeContentForm, inferContentForm, resolve, promptBlock };
