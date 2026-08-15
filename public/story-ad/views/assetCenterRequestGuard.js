export function createPersonPlanRequestGuard(requestKey = '') {
  let active = false;
  return { get active() { return active; }, async run(operation) {
    if (active) return { skipped: true, request_key: requestKey };
    active = true;
    try { return await operation(requestKey); } finally { active = false; }
  } };
}

export function createKeyedRequestGuard(createGuard = createPersonPlanRequestGuard) {
  const guards = new Map();
  return { async run(key, requestKey, operation, onSkipped) {
    const guard = guards.get(key) || createGuard(requestKey);
    guards.set(key, guard);
    if (guard.active) return onSkipped?.();
    const result = await guard.run(operation);
    if (result === true) guards.delete(key);
    return result;
  } };
}
