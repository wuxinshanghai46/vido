'use strict';

const crypto = require('crypto');

function clean(value = '', max = 1000) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

function messageId(item = {}, index = 0) {
  const supplied = clean(item.id || item.message_id || '', 80);
  if (supplied) return supplied;
  return `dialogue_${crypto.createHash('sha256').update(`${index}|${item.role || ''}|${item.content || ''}|${item.topic || ''}`).digest('hex').slice(0, 16)}`;
}

function normalizeHistory(value = []) {
  const rows = Array.isArray(value) ? value : [];
  const seen = new Set();
  return rows.slice(-60).map((item, index) => {
    const role = item?.role === 'assistant' ? 'assistant' : 'user';
    const content = clean(item?.content || item?.text || '', 1200);
    const id = messageId(item, index);
    if (!content || seen.has(id)) return null;
    seen.add(id);
    return {
      id,
      seq: Math.max(1, Number(item?.seq || index + 1) || index + 1),
      role,
      content,
      topic: clean(item?.topic || item?.question_topic || '', 40),
      selected_answer: item?.selected_answer === true,
      selected_value: clean(item?.selected_value || '', 300),
      suggested_answers: (Array.isArray(item?.suggested_answers) ? item.suggested_answers : []).map(value => clean(value, 300)).filter(Boolean).slice(0, 6),
      interaction_type: clean(item?.interaction_type || (item?.suggested_answers?.length ? 'choice' : 'text'), 40),
      answered: item?.answered === true || !!item?.selected_value,
      created_at: clean(item?.created_at || '', 40),
    };
  }).filter(Boolean).map((item, index) => ({ ...item, seq: index + 1 }));
}

function normalizeCastIntent(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const allowedModes = new Set(['no_human', 'single', 'dual', 'multi', 'auto']);
  const mode = allowedModes.has(clean(source.mode, 30)) ? clean(source.mode, 30) : 'auto';
  const participants = (Array.isArray(source.participants) ? source.participants : []).slice(0, 12).map((item, index) => ({
    id: clean(item?.id || `participant_${index + 1}`, 80),
    name: clean(item?.name || '', 80),
    role: clean(item?.role || item?.label || '', 120),
    gender: clean(item?.gender || 'unknown', 30),
    age_range: clean(item?.age_range || item?.age || '', 40),
    description: clean(item?.description || '', 360),
    on_screen: item?.on_screen !== false,
  })).filter(item => item.name || item.role || item.description);
  const expectedPeople = mode === 'no_human' ? 0 : Math.max(0, Number(source.expected_people ?? participants.length) || 0);
  return {
    confirmed: source.confirmed === true,
    mode,
    expected_people: expectedPeople,
    participants,
    source: clean(source.source || '', 40),
  };
}

function dialogueContext(history = []) {
  const rows = normalizeHistory(history);
  if (!rows.length) return '';
  return rows.map(item => `${item.role === 'assistant' ? '导演助理' : '用户'}${item.topic ? `〔${item.topic}〕` : ''}：${item.content}`).join('\n');
}

module.exports = { dialogueContext, normalizeCastIntent, normalizeHistory };
