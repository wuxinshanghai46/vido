import { setButtonBusy, toast } from '../components/ui.js?v=20260824-production-v201aj';

export function moreMediaButton(catalog = {}, kind = 'keyframes', label = '继续加载') {
  return catalog?.has_more
    ? `<div class="form-actions"><button class="btn" type="button" data-load-more-media="${kind}">${label}</button></div>`
    : '';
}

export function bindMoreMedia(host, context) {
  host.querySelectorAll('[data-load-more-media]').forEach(button => button.addEventListener('click', async event => {
    const target = event.currentTarget;
    try {
      setButtonBusy(target, true, '正在加载…');
      await context.store.loadMoreMedia(target.dataset.loadMoreMedia, 24);
      await context.refreshCurrentView();
    } catch (error) {
      toast(error.message, 'danger');
      setButtonBusy(target, false);
    }
  }));
}
