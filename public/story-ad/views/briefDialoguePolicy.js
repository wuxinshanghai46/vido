const COMMERCIAL_TOPICS = new Set([
  'subject_identity', 'subject_motivation', 'commercial_evidence', 'audience_intent',
  'world_region_rules', 'visual_medium', 'visual_tone',
]);

const NARRATIVE_TOPICS = new Set([
  'subject_identity', 'subject_relationship', 'subject_motivation', 'opposition',
  'plot_trigger', 'plot_development', 'climax_ending', 'audience_intent',
  'world_era', 'world_region_rules', 'character_continuity', 'visual_medium', 'visual_tone',
]);

export function allowedDialogueTopics(mode = '') {
  return mode === 'commercial_subject' ? COMMERCIAL_TOPICS : NARRATIVE_TOPICS;
}

export function sanitizeDialogueTopics(values = [], mode = '') {
  const allowed = allowedDialogueTopics(mode);
  return [...new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim()).filter(value => allowed.has(value)))];
}

export function dialogueQuestionBudget(mode = '') {
  return mode === 'commercial_subject' ? 2 : 3;
}

export function dialogueBudgetReached(values = [], mode = '') {
  return sanitizeDialogueTopics(values, mode).length >= dialogueQuestionBudget(mode);
}

export function referenceDialoguePhase(reference = {}) {
  const status = String(reference.status || '').toLowerCase();
  if (!reference.analysis_id && !['importing', 'uploading', 'queued', 'running'].includes(status)) return 'none';
  if (status === 'completed' && reference.analysis_valid === true) return 'ready';
  if (['failed', 'cancelled', 'incomplete'].includes(status) || status === 'completed') return 'blocked';
  return 'active';
}
