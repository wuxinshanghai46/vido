const crypto = require('crypto');

function clean(value = '', limit = 300) {
  return String(value || '').trim().slice(0, limit);
}

function normalizedGender(value = '') {
  const raw = clean(value, 40).toLowerCase();
  if (/female|woman|girl|女/.test(raw)) return 'female';
  if (/male|man|boy|男/.test(raw)) return 'male';
  return 'neutral';
}

function deliveryDirection(profile = {}) {
  const existing = clean(profile.voice_tone || profile.voice?.direction || '', 300);
  if (existing) return existing;
  const age = clean(profile.age_contract?.display_text || profile.age || profile.age_range || '', 40);
  const role = clean(profile.roleName || profile.role || '人物', 80);
  const performance = clean(profile.performanceText || profile.performance || '', 100);
  return [
    `${role}${age ? `，${age}` : ''}；使用自然、清晰、有呼吸停连的中文口语表演`,
    performance ? `情绪和节奏跟随人物表演：${performance}` : '情绪随剧情推进变化，避免机械播报和过度广告腔',
    '对白优先保证字词清楚、句尾完整，并为后续口型同步保留稳定语速',
  ].join('。').slice(0, 300);
}

function eligiblePacks(voicePacks) {
  try {
    const catalog = voicePacks.loadCatalog();
    return (catalog.voices || []).filter(row => (
      row && row.clonable === true && row.rights_status === 'user_confirmed_licensed'
      && /^vp_[a-f0-9]{16,64}$/i.test(String(row.id || ''))
    ));
  } catch {
    return [];
  }
}

function choosePack(rows = [], profile = {}, userId = '') {
  if (!rows.length) return null;
  const gender = normalizedGender(profile.gender || profile.sex);
  const matched = gender === 'neutral' ? rows : rows.filter(row => normalizedGender(row.gender) === gender);
  const pool = matched.length ? matched : rows;
  const identity = clean(profile.id || profile.identity_id || profile.displayName || profile.name || 'person', 160);
  const digest = crypto.createHash('sha256').update(`${userId}\n${identity}`).digest();
  return pool[digest.readUInt32BE(0) % pool.length] || null;
}

function applyAccountVoiceAssignments(context = {}, options = {}, overrides = {}) {
  const voicePacks = overrides.voicePacks || require('../voicePackService');
  const userId = clean(options.userId || context.user_id || context.userId || '', 160);
  const rows = eligiblePacks(voicePacks);
  const currentProfiles = Array.isArray(context.cast_profiles) ? context.cast_profiles : [];
  const speakers = { ...(context.voice_assignments?.speakers || {}) };
  let changed = false;
  const castProfiles = currentProfiles.map(profile => {
    const existingVoiceId = clean(profile.voice_id || profile.voice?.voice_id || '', 160);
    const selected = existingVoiceId ? null : choosePack(rows, profile, userId);
    const voiceId = existingVoiceId || clean(selected?.id || '', 160);
    const voiceTone = deliveryDirection(profile);
    if (voiceId && profile.voice_id !== voiceId) changed = true;
    if (voiceTone && profile.voice_tone !== voiceTone) changed = true;
    if (voiceId) {
      const stableId = clean(profile.id || profile.identity_id || '', 120);
      const displayName = clean(profile.displayName || profile.name || '', 120);
      if (stableId && speakers[stableId] !== voiceId) { speakers[stableId] = voiceId; changed = true; }
      if (displayName && speakers[displayName] !== voiceId) { speakers[displayName] = voiceId; changed = true; }
    }
    return {
      ...profile,
      voice_id: voiceId,
      voice_tone: voiceTone,
      voice_binding: voiceId ? {
        mode: 'account_authorized_pack',
        source_voice_pack_id: voiceId,
        display_name: clean(selected?.name || profile.voice_binding?.display_name || '账号授权音色', 120),
        registration: /^vp_/i.test(voiceId) ? 'on_first_use' : 'ready',
      } : {
        mode: 'account_authorized_pack',
        status: rows.length ? 'unmatched' : 'authorized_pack_unavailable',
      },
    };
  });
  const narrator = clean(context.voice_assignments?.narrator || '', 160)
    || clean(choosePack(rows, { id: 'narrator', gender: 'neutral' }, userId)?.id || '', 160);
  if (narrator && narrator !== context.voice_assignments?.narrator) changed = true;
  return {
    context: {
      ...context,
      cast_profiles: castProfiles,
      voice_assignments: { ...(context.voice_assignments || {}), narrator, speakers },
    },
    changed,
    pack_count: rows.length,
    assigned_count: castProfiles.filter(profile => profile.voice_id).length,
  };
}

function applyAndPersistContext(context = {}, options = {}, overrides = {}) {
  const projection = applyAccountVoiceAssignments(context, options, overrides);
  const storage = overrides.storage;
  if (projection.changed && storage && options.taskId) {
    storage.saveOutput(options.taskId, 'context', projection.context, {
      content_revision: options.contentRevision,
    });
    storage.updateTask(options.taskId, {
      request: projection.context,
      updated_at: new Date().toISOString(),
    });
  }
  return projection.context;
}

module.exports = { applyAccountVoiceAssignments, applyAndPersistContext, choosePack, deliveryDirection, normalizedGender };
