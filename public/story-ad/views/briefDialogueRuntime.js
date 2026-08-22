import { request } from '../api.js?v=20260823-production-contract-v167';

export function bindBriefViewport(host) {
  host.classList?.add('brief-dialogue-view');
  const sync = () => {
    const top = Math.max(0, Math.round(host.getBoundingClientRect?.().top || 64));
    host.style?.setProperty('--brief-view-height', `calc(100dvh - ${top}px)`);
  };
  sync();
  window.addEventListener('resize', sync);
  const progressHost = host.parentElement?.querySelector?.('.project-progress-host');
  const observer = typeof ResizeObserver === 'function' && progressHost ? new ResizeObserver(sync) : null;
  observer?.observe(progressHost);
  return () => {
    observer?.disconnect();
    window.removeEventListener('resize', sync);
    host.classList?.remove('brief-dialogue-view');
    host.style?.removeProperty('--brief-view-height');
  };
}

export function briefDialogueAssist(taskId) {
  return payload => request('/api/new-story-ad/assist', {
    method: 'POST',
    timeoutMs: 90000,
    body: { mode: 'brief_dialogue', task_id: taskId() || '', ...payload },
  });
}
