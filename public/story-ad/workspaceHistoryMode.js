const VIEW_PROGRESS = Object.freeze(['brief', 'assets', 'scene', 'plot', 'storyboard', 'final']);

export function routeProgressIndex(view = '') {
  return VIEW_PROGRESS.indexOf(view === 'shot' ? 'final' : view);
}

export function historicalStepReadOnly(bundle = {}, route = {}) {
  if (route.isNew || route.view === 'workflow') return false;
  const routeIndex = routeProgressIndex(route.view);
  const progressIndexes = [
    routeProgressIndex(bundle?.project?.workspace || ''),
    routeProgressIndex(bundle?.navigation?.current || ''),
    ...Object.entries(bundle?.navigation?.steps || {})
      .filter(([, state]) => state?.completed === true)
      .map(([view]) => routeProgressIndex(view)),
  ].filter(index => index >= 0);
  return routeIndex >= 0 && Math.max(0, ...progressIndexes) > routeIndex;
}

export function applyHistoricalReadonlyControls(host) {
  const result = { protected: 0, safe: 0 };
  host.querySelectorAll('button, input, select, textarea').forEach(control => {
    if (control.matches('[data-history-safe]')) {
      result.safe += 1;
      return;
    }
    control.disabled = true;
    control.dataset.historicalReadonly = 'true';
    result.protected += 1;
  });
  return result;
}
