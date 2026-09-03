export async function mount(host, context) { context.navigate(`/story-ad/projects/${encodeURIComponent(context.bundle.project.id)}?view=edit`, { replace: true }); }
