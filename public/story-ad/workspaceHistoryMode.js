const VIEW_PROGRESS = Object.freeze(['brief', 'assets', 'scene', 'plot', 'storyboard', 'final']);

export function routeProgressIndex(view = '') {
  if (view === 'shot') return VIEW_PROGRESS.indexOf('final');
  return VIEW_PROGRESS.indexOf(view);
}

export function historicalStepReadOnly(bundle = {}, route = {}) {
  if (route.isNew || route.view === 'workflow') return false;
  const routeIndex = routeProgressIndex(route.view);
  const currentIndex = routeProgressIndex(bundle?.navigation?.current || bundle?.project?.workspace || 'brief');
  return routeIndex >= 0 && currentIndex > routeIndex;
}
