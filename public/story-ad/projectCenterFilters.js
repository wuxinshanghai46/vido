export function matchingProjectIds(projects = [], query = {}) {
  const name = String(query.taskName || '').trim().toLocaleLowerCase('zh-CN');
  return new Set(projects.filter(project => {
    const type = String(project.type || '');
    return (!name || String(project.title || '').toLocaleLowerCase('zh-CN').includes(name))
      && (query.taskType === 'all' || (query.taskType === 'unset' ? !type : type === query.taskType))
      && (query.stage === 'all' || project.stage === query.stage);
  }).map(project => String(project.id)));
}

export function applyProjectVisibility(scope, visibleIds, loading = false) {
  scope.querySelectorAll('.project-row[data-project-id]').forEach(row => {
    row.hidden = !visibleIds.has(String(row.dataset.projectId));
  });
  const empty = scope.querySelector('[data-query-empty]');
  if (empty) empty.hidden = visibleIds.size > 0 || loading;
}
