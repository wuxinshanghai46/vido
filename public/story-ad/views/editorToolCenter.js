export function editorProjectActions(project, deleting, escapeHtml) {
  if (deleting) return '<span class="project-delete-state" role="status"><i></i>正在彻底删除</span>';
  return `<span class="project-actions"><button class="btn small primary" type="button" data-open-project="${escapeHtml(project.id)}">打开剪辑</button></span>`;
}

export function editorEmptyState(hasVisibleProjects) {
  return `<div class="table-empty" data-query-empty ${hasVisibleProjects ? 'hidden' : ''}><b>还没有可剪辑的成片</b><span>完成分镜视频并合成成片后，会在这里出现。</span></div>`;
}

export function editorBanner() {
  return '<div><h1>视频剪辑</h1><p>选择已生成成片的项目，在独立弹窗中剪辑；原分镜和成片会保留。</p></div><button class="btn" type="button" data-workbench>返回工作台</button>';
}
