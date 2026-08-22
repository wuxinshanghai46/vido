export function dialogueIntakeState({ name = '', mode = '', idea = '', ideaReady, castIntentConfirmed = false, specificationsConfirmed = false, referenceAttached = false, referenceSkipped = false } = {}) {
  const missing = [];
  if (!mode) missing.push('mode');
  if (!idea) missing.push('idea');
  else if (ideaReady !== true) missing.push('idea_details');
  if (idea && ideaReady === true && mode === 'commercial_subject' && !castIntentConfirmed) missing.push('cast');
  if (idea && ideaReady === true && (mode !== 'commercial_subject' || castIntentConfirmed) && !specificationsConfirmed) missing.push('specifications');
  if (idea && ideaReady === true && specificationsConfirmed && !referenceAttached && !referenceSkipped) missing.push('reference');
  if (!name) missing.push('name');
  return {
    ready: Boolean(name && mode && idea && ideaReady === true && (mode !== 'commercial_subject' || castIntentConfirmed) && specificationsConfirmed && (referenceAttached || referenceSkipped)),
    missing,
    next: missing[0] || '',
  };
}

export function dialogueProgressState({ name = '', mode = '', idea = '', ideaReady = false, castIntentConfirmed = false, specificationsConfirmed = false, referenceAttached = false, referenceSkipped = false, confirmed = false } = {}) {
  const complete = {
    mode: Boolean(mode), idea: Boolean(idea && ideaReady), name: Boolean(name),
    cast: mode !== 'commercial_subject' || castIntentConfirmed,
    specifications: Boolean(specificationsConfirmed),
    reference: Boolean(referenceAttached || referenceSkipped), confirm: Boolean(confirmed),
  };
  const weights = { mode: 15, idea: 30, name: 10, cast: 10, specifications: 15, reference: 10, confirm: 10 };
  return { percent: Object.keys(weights).reduce((sum, key) => sum + (complete[key] ? weights[key] : 0), 0), complete };
}
