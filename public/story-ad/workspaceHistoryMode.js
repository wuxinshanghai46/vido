const VIEW_PROGRESS = Object.freeze(['brief', 'assets', 'scene', 'plot', 'storyboard', 'final']);

export const HISTORICAL_READONLY_SAFE_ACTION_SELECTOR = '[data-historical-readonly-action="safe"]';

export function routeProgressIndex(view = '') {
  if (view === 'shot') return VIEW_PROGRESS.indexOf('final');
  return VIEW_PROGRESS.indexOf(view);
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
  const furthestIndex = progressIndexes.length ? Math.max(...progressIndexes) : 0;
  return routeIndex >= 0 && furthestIndex > routeIndex;
}

export function applyHistoricalReadonlyControls(host) {
  const result = { protected: 0, safe: 0 };
  host?.querySelectorAll?.('button, input, select, textarea')?.forEach(control => {
    if (control.matches(HISTORICAL_READONLY_SAFE_ACTION_SELECTOR)) {
      result.safe += 1;
      return;
    }
    control.disabled = true;
    control.dataset.historicalReadonly = 'true';
    result.protected += 1;
  });
  return result;
}
