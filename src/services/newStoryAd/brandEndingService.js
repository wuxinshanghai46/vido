const BRAND_ENDING_VERSION = 'scene-integrated-brand-ending-v1';
const LOGO_VISUAL_PATTERN = /(?:品牌\s*)?(?:logo|标识|商标|品牌字样)/i;
const NEGATED_LOGO_PATTERN = /(?:不要|禁止|不得|避免|不出现|不生成).{0,16}(?:品牌\s*)?(?:logo|标识|商标|品牌字样)/i;

function clean(value = '', max = 600) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max).trim() : text;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function validAsset(asset = null) {
  if (!asset || typeof asset !== 'object') return false;
  return Boolean(clean(asset.file_url || asset.image_url || asset.url, 1000));
}

function enabled(ctx = {}) {
  const overlay = ctx.brand_overlay || ctx.brandOverlay || {};
  return overlay.enabled === true
    && overlay.authorization_confirmed === true
    && validAsset(overlay.asset);
}

function assertReady(ctx = {}) {
  if (ctx.brand_overlay?.enabled !== true || enabled(ctx)) return true;
  const error = new Error('已上传 Logo，但尚未完成有效授权确认。请确认授权或删除 Logo 后再生成剧本。');
  error.code = 'BRAND_ASSET_AUTHORIZATION_REQUIRED';
  error.status = 422;
  error.retryable = false;
  throw error;
}

function positionLabel(position = '') {
  return ({
    top_left: '左上角',
    top_right: '右上角',
    center: '画面中央',
    bottom_left: '左下角',
    bottom_center: '底部居中',
    bottom_right: '右下角',
  })[position] || '底部居中';
}

function contract(ctx = {}) {
  if (!enabled(ctx)) return { enabled: false, version: BRAND_ENDING_VERSION };
  const overlay = ctx.brand_overlay || ctx.brandOverlay || {};
  const position = clean(overlay.position || 'bottom_center', 40);
  return {
    enabled: true,
    version: BRAND_ENDING_VERSION,
    mode: 'last_scene_hold',
    scene_integration: 'reuse_last_approved_scene_and_final_frame',
    position,
    position_label: positionLabel(position),
    width_percent: Math.max(8, Math.min(45, Number(overlay.width_percent || 22) || 22)),
    hold_duration_sec: Math.max(0.5, Math.min(15, Number(overlay.end_duration_sec || 3) || 3)),
    safe_area: {
      position,
      avoid_people_product_subtitle_overlap: true,
      preserve_last_scene: true,
    },
    generation_rule: 'generate_scene_and_subjects_only; never render or imitate the logo',
    finalization_rule: 'append a frozen hold of the final approved scene frame and overlay the exact authorized asset',
  };
}

function sanitizeLogoDirective(value = '', replacement = '') {
  const text = String(value || '');
  if (!LOGO_VISUAL_PATTERN.test(text) || NEGATED_LOGO_PATTERN.test(text)) return text;
  const clauses = text.split(/(?<=[。！？；;!?])/).filter(Boolean);
  const kept = clauses.filter(clause => !LOGO_VISUAL_PATTERN.test(clause) || NEGATED_LOGO_PATTERN.test(clause));
  if (kept.length) return kept.join('').trim();
  return replacement;
}

function sanitizeLayers(layers = [], replacement = '') {
  const rows = Array.isArray(layers) ? layers : [];
  return rows.map(layer => {
    const content = sanitizeLogoDirective(layer?.content || '', '');
    return content ? { ...layer, content } : null;
  }).filter(Boolean).concat(replacement ? [{ type: 'brand_safe_area', content: replacement }] : []);
}

function withoutLogoRefs(state = {}) {
  if (!state || typeof state !== 'object') return state;
  return {
    ...state,
    entity_refs: (Array.isArray(state.entity_refs) ? state.entity_refs : [])
      .filter(ref => !LOGO_VISUAL_PATTERN.test(String(ref || ''))),
  };
}

function applyToBlueprint(blueprint = {}, ctx = {}) {
  const result = clone(blueprint);
  if (!Array.isArray(result.beats) || !result.beats.length) return result;
  const active = enabled(ctx);
  const ending = contract(ctx);
  result.beats = result.beats.map((beat, index) => {
    const last = index === result.beats.length - 1;
    const replacement = last
      ? (active
        ? `最后镜头保持当前故事场景与主体关系，在${ending.position_label}预留无遮挡的品牌安全区；授权原图仅在最终成片阶段叠加。`
        : '最后镜头在当前故事场景中自然收束，不预留或生成视觉品牌标识。')
      : '';
    const next = { ...(beat || {}) };
    ['plot', 'visual', 'story_visual', 'promo_visual', 'visual_proof', 'action'].forEach(field => {
      if (next[field]) next[field] = sanitizeLogoDirective(next[field], replacement);
    });
    next.visual_layers = sanitizeLayers(next.visual_layers, last && active ? replacement : '');
    delete next.brand_ending;
    if (last && active) next.brand_ending = ending;
    return next;
  });
  result.brand_ending = active ? ending : { enabled: false, version: BRAND_ENDING_VERSION };
  return result;
}

function applyToShots(shots = [], ctx = {}) {
  const rows = Array.isArray(shots) ? shots.map(shot => ({ ...(shot || {}) })) : [];
  if (!rows.length) return rows;
  const active = enabled(ctx);
  const ending = contract(ctx);
  return rows.map((shot, index) => {
    const last = index === rows.length - 1;
    const replacement = last
      ? (active
        ? `保持当前最后场景和主体关系，在${ending.position_label}预留无遮挡品牌安全区；画面模型不得生成标识。`
        : '保持当前最后场景自然收束，不生成或预留视觉品牌标识。')
      : '';
    ['visual', 'story_visual', 'promo_visual', 'material_usage', 'action'].forEach(field => {
      if (shot[field]) shot[field] = sanitizeLogoDirective(shot[field], replacement);
    });
    shot.visual_layers = sanitizeLayers(shot.visual_layers, last && active ? replacement : '');
    shot.temporal_state = withoutLogoRefs(shot.temporal_state || {});
    if (shot.temporal_evidence?.shot_state) {
      shot.temporal_evidence = {
        ...shot.temporal_evidence,
        shot_state: withoutLogoRefs(shot.temporal_evidence.shot_state),
      };
    }
    delete shot.brand_ending;
    if (last && active) {
      shot.brand_ending = ending;
      shot.composition = clean(`${shot.composition || ''}；${ending.position_label}保留品牌安全区，人物、商品和字幕不得遮挡`, 180);
      shot.subject_position = clean(`${shot.subject_position || ''}；主体避开${ending.position_label}品牌安全区`, 160);
      shot.exit_frame_state = clean(`${shot.exit_frame_state || shot.action_end || ''}；镜头在当前场景中稳定停留，供品牌结尾使用`, 260);
    }
    return shot;
  });
}

module.exports = {
  BRAND_ENDING_VERSION,
  enabled,
  assertReady,
  contract,
  applyToBlueprint,
  applyToShots,
  sanitizeLogoDirective,
};
