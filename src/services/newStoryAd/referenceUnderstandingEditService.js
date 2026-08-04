const crypto = require('crypto');

const EDITABLE_FIELDS = {
  overview: [
    /^reference_understanding\.story_summary\.(narrative_mode|narrative_mode_reason|logline|short_synopsis|full_synopsis|theme|central_conflict|trigger|turning_point|climax|resolution|brand_function|cta)$/,
    /^reference_understanding\.(inferences|unknowns)\.\d+\.(claim|reason|question)$/,
  ],
  timeline: [/^reference_understanding\.causal_chain\.\d+\.(subject|action|motivation|result)$/],
  characters: [/^reference_understanding\.characters\.\d+\.(role|narrative_function|relationships|initial_state|goal|obstacle|key_decision|final_state|emotional_arc)$/],
  scenes: [/^reference_understanding\.scenes\.\d+\.(narrative_function|entry_transition|state_change|exit_transition)$/],
  brand: [/^reference_understanding\.brand_role\.(subject|story_function|visible_claims|proof_moments|cta)$/],
  camera: [/^camera_intents\.\d+\.(description|narrative_purpose)$/],
  audio: [/^reference_understanding\.audio_visual\.alignments\.\d+\.(spoken_text|visual|function)$/],
};

const LIST_FIELDS = new Set(['relationships', 'emotional_arc', 'visible_claims', 'proof_moments']);
const NARRATIVE_MODES = new Set(['narrative_story', 'showcase_montage', 'unclassified']);

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function text(value, max = 1200) {
  return String(value ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max);
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((out, key) => {
    out[key] = stableObject(value[key]);
    return out;
  }, {});
}

function fingerprint(reference = {}) {
  return crypto.createHash('sha256').update(JSON.stringify(stableObject({
    reference_understanding: reference.reference_understanding || null,
    camera_intents: reference.camera_intents || [],
  }))).digest('hex');
}

function referenceId(value = {}) {
  return text(value.analysis_id || value.id, 120);
}

function assertEditableReference(reference = {}) {
  if (!referenceId(reference) || reference.status !== 'completed' || reference.analysis_quality?.valid !== true) {
    const error = new Error('参考内容尚未完成有效识别，不能保存修改');
    error.code = 'REFERENCE_UNDERSTANDING_EDIT_NOT_READY';
    error.status = 409;
    error.retryable = false;
    throw error;
  }
  if (!reference.reference_understanding || typeof reference.reference_understanding !== 'object') {
    const error = new Error('当前参考内容没有可编辑的深度理解报告');
    error.code = 'REFERENCE_UNDERSTANDING_MISSING';
    error.status = 422;
    error.retryable = false;
    throw error;
  }
}

function overrideMatches(reference = {}, override = {}) {
  return !!override
    && referenceId(reference) === text(override.analysis_id, 120)
    && fingerprint(reference) === text(override.base_fingerprint, 80);
}

function applyOverride(reference = {}, override = null) {
  if (!overrideMatches(reference, override)) return reference;
  const editable = override.reference && typeof override.reference === 'object' ? override.reference : {};
  return {
    ...reference,
    ...clone(editable),
    analysis_id: referenceId(reference),
    status: reference.status,
    progress: reference.progress,
    analysis_quality: {
      ...(reference.analysis_quality || {}),
      ...(editable.analysis_quality || {}),
      valid: reference.analysis_quality?.valid === true,
      user_edited: true,
    },
  };
}

function pathAllowed(tab, path) {
  return (EDITABLE_FIELDS[tab] || []).some(pattern => pattern.test(path));
}

function pathTarget(root, path) {
  const segments = path.split('.');
  const leaf = segments.pop();
  let target = root;
  for (const segment of segments) {
    if (Array.isArray(target)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= target.length) return null;
      target = target[index];
    } else if (target && typeof target === 'object' && Object.prototype.hasOwnProperty.call(target, segment)) {
      target = target[segment];
    } else {
      return null;
    }
  }
  return target && typeof target === 'object' ? { target, leaf } : null;
}

function normalizedValue(path, value) {
  const field = path.split('.').pop();
  if (field === 'narrative_mode') return NARRATIVE_MODES.has(String(value)) ? String(value) : 'unclassified';
  if (LIST_FIELDS.has(field)) return String(value ?? '').split(/\r?\n|；/).map(item => text(item, 500)).filter(Boolean).slice(0, 48);
  return text(value, field === 'full_synopsis' ? 5000 : 1200);
}

function assertRequired(reference = {}) {
  const understanding = reference.reference_understanding || {};
  const story = understanding.story_summary || {};
  const failures = [];
  if (!text(story.logline, 700)) failures.push('一句话故事不能为空');
  if (!text(story.full_synopsis, 5000)) failures.push('完整故事介绍不能为空');
  (understanding.causal_chain || []).forEach((item, index) => {
    if (!text(item?.action, 700)) failures.push(`时间线事件 ${index + 1} 的动作不能为空`);
  });
  (understanding.characters || []).forEach((item, index) => {
    if (!text(item?.role, 200)) failures.push(`人物 ${index + 1} 的角色不能为空`);
  });
  (understanding.scenes || []).forEach((item, index) => {
    if (!text(item?.narrative_function, 700)) failures.push(`场景 ${index + 1} 的叙事作用不能为空`);
  });
  if (!text(understanding.brand_role?.subject, 500)) failures.push('商品或品牌主体不能为空');
  if (!text(understanding.brand_role?.story_function, 700)) failures.push('商品或品牌的故事职责不能为空');
  if (failures.length) {
    const error = new Error(`参考内容修改不完整：${failures.join('；')}`);
    error.code = 'REFERENCE_UNDERSTANDING_EDIT_INVALID';
    error.status = 422;
    error.retryable = false;
    error.failures = failures;
    throw error;
  }
}

function joined(value) {
  return (Array.isArray(value) ? value : []).map(item => typeof item === 'string' ? item : (item?.relationship || item?.text || '')).filter(Boolean).join('；');
}

function buildGeneratedBrief(reference = {}) {
  const understanding = reference.reference_understanding || {};
  const story = understanding.story_summary || {};
  const brand = understanding.brand_role || {};
  const characters = (understanding.characters || []).map((item, index) => `${index + 1}. ${item.role}${item.narrative_function ? `；剧情职责：${item.narrative_function}` : ''}`).join('\n');
  const scenes = (understanding.scenes || []).map((item, index) => `${index + 1}. ${item.scene_id || `场景 ${index + 1}`}；${item.narrative_function || ''}`).join('\n');
  return [
    `【参考内容事实】广告主体：${brand.subject || reference.source_facts?.product_or_service || '待确认主体'}；实际空间：${reference.source_facts?.environment || '以参考报告场景为准'}`,
    `【广告目标】${story.brand_function || brand.story_function || story.logline}`,
    `【完整剧情】${story.full_synopsis}`,
    `【人物提示词】${characters || '参考内容没有需要进入故事的人物。'}`,
    `【场景提示词】${scenes || reference.source_facts?.environment || '以参考内容中的实际空间为准。'}`,
    `【核心卖点】${joined(brand.visible_claims) || brand.story_function || story.brand_function}`,
  ].join('\n').slice(0, 3800);
}

function reproject(reference = {}, editRevision = 1) {
  const next = clone(reference);
  const understanding = next.reference_understanding || {};
  const story = understanding.story_summary || {};
  const brand = understanding.brand_role || {};
  next.reference_understanding = {
    ...understanding,
    user_edit_revision: editRevision,
    user_edited_at: new Date().toISOString(),
    completeness: { ...(understanding.completeness || {}), semantic_source: 'user_corrected' },
  };
  next.source_facts = { ...(next.source_facts || {}), product_or_service: brand.subject || next.source_facts?.product_or_service || '' };
  next.story_outline = {
    ...(next.story_outline || {}),
    logline: story.logline || '',
    opening: story.trigger || next.story_outline?.opening || '',
    development: story.short_synopsis || next.story_outline?.development || '',
    turning_point: story.turning_point || '',
    climax: story.climax || '',
    resolution: story.resolution || '',
  };
  next.plot_beats = (understanding.causal_chain || []).map((item, index) => ({
    ...(next.plot_beats?.[index] || {}),
    range: item.range || next.plot_beats?.[index]?.range || [0, 0],
    purpose: [item.subject, item.action, item.motivation, item.result].filter(Boolean).join('；'),
    user_corrected: true,
  }));
  next.character_prompts = (next.character_prompts || []).map((item, index) => {
    const corrected = (understanding.characters || []).find(row => row.character_id && row.character_id === item.id) || understanding.characters?.[index];
    return corrected ? {
      ...item,
      role: corrected.role || item.role,
      narrative_function: corrected.narrative_function || '',
      story_profile: [corrected.initial_state, corrected.goal, corrected.obstacle, corrected.key_decision, corrected.final_state].filter(Boolean).join('；'),
      user_corrected: true,
    } : item;
  });
  next.scene_prompts = (next.scene_prompts || []).map(item => {
    const corrected = (understanding.scenes || []).find(row => row.scene_id && row.scene_id === item.id);
    return corrected ? { ...item, camera_purpose: corrected.narrative_function || item.camera_purpose, narrative_state_change: corrected.state_change || '', user_corrected: true } : item;
  });
  next.generated_brief = buildGeneratedBrief(next);
  next.analysis_quality = { ...(next.analysis_quality || {}), valid: true, user_edited: true };
  return next;
}

function createOverride(baseReference = {}, existingOverride = null, body = {}, options = {}) {
  assertEditableReference(baseReference);
  const tab = text(body.tab, 30);
  if (!Object.prototype.hasOwnProperty.call(EDITABLE_FIELDS, tab)) {
    const error = new Error('不支持修改当前参考内容栏目');
    error.code = 'REFERENCE_UNDERSTANDING_EDIT_TAB_INVALID';
    error.status = 400;
    throw error;
  }
  const currentRevision = overrideMatches(baseReference, existingOverride) ? Math.max(0, Number(existingOverride.edit_revision || 0) || 0) : 0;
  const expectedRevision = Math.max(0, Number(body.base_edit_revision || body.baseEditRevision || 0) || 0);
  if (expectedRevision !== currentRevision) {
    const error = new Error(`参考内容已经更新为修改版本 ${currentRevision}，当前版本 ${expectedRevision} 不能覆盖最新内容`);
    error.code = 'REFERENCE_UNDERSTANDING_EDIT_CONFLICT';
    error.status = 409;
    error.retryable = false;
    error.current_edit_revision = currentRevision;
    throw error;
  }
  const fields = body.fields && typeof body.fields === 'object' && !Array.isArray(body.fields) ? body.fields : {};
  const entries = Object.entries(fields);
  if (!entries.length || entries.length > 200) {
    const error = new Error('没有收到可保存的参考内容修改');
    error.code = 'REFERENCE_UNDERSTANDING_EDIT_EMPTY';
    error.status = 400;
    throw error;
  }
  const current = clone(applyOverride(baseReference, existingOverride));
  let changed = 0;
  for (const [path, rawValue] of entries) {
    if (!pathAllowed(tab, path)) {
      const error = new Error(`当前栏目不能修改字段：${path}`);
      error.code = 'REFERENCE_UNDERSTANDING_EDIT_FIELD_FORBIDDEN';
      error.status = 400;
      throw error;
    }
    const resolved = pathTarget(current, path);
    if (!resolved) {
      const error = new Error(`参考内容字段已经变化，请刷新后再修改：${path}`);
      error.code = 'REFERENCE_UNDERSTANDING_EDIT_FIELD_STALE';
      error.status = 409;
      throw error;
    }
    const value = normalizedValue(path, rawValue);
    if (JSON.stringify(resolved.target[resolved.leaf]) !== JSON.stringify(value)) {
      resolved.target[resolved.leaf] = value;
      changed += 1;
    }
  }
  if (!changed) {
    const error = new Error('参考内容没有发生变化');
    error.code = 'REFERENCE_UNDERSTANDING_EDIT_UNCHANGED';
    error.status = 400;
    throw error;
  }
  assertRequired(current);
  const editRevision = currentRevision + 1;
  const edited = reproject(current, editRevision);
  const override = {
    schema_version: 1,
    analysis_id: referenceId(baseReference),
    base_fingerprint: fingerprint(baseReference),
    edit_revision: editRevision,
    edited_tab: tab,
    reference: {
      reference_understanding: edited.reference_understanding,
      camera_intents: edited.camera_intents || [],
      source_facts: edited.source_facts || {},
      story_outline: edited.story_outline || {},
      plot_beats: edited.plot_beats || [],
      character_prompts: edited.character_prompts || [],
      scene_prompts: edited.scene_prompts || [],
      generated_brief: edited.generated_brief || '',
      analysis_quality: edited.analysis_quality || {},
    },
    updated_at: new Date().toISOString(),
    updated_by: text(options.user?.id || options.user?.userId, 120),
  };
  return { reference: applyOverride(baseReference, override), override, changed_fields: changed, edit_revision: editRevision };
}

module.exports = {
  EDITABLE_FIELDS,
  applyOverride,
  createOverride,
  fingerprint,
  overrideMatches,
  _private: { assertRequired, buildGeneratedBrief, pathAllowed, reproject },
};
