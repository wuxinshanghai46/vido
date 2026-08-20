export function bindBriefSettingsModal(host) {
  const modal = host.querySelector('[data-brief-settings-modal]');
  let trigger = null;
  const close = () => { if (modal?.open) modal.close(); };
  const open = source => {
    if (!modal) return;
    trigger = source || document.activeElement;
    if (!modal.open) modal.showModal();
    modal.querySelector('form input, form select, form textarea, form button')?.focus();
  };
  const restoreFocus = () => {
    const source = trigger;
    trigger = null;
    if (source?.isConnected && typeof source.focus === 'function') source.focus();
  };
  const closeFromBackdrop = event => { if (event.target === modal) close(); };
  modal?.addEventListener('close', restoreFocus);
  modal?.addEventListener('click', closeFromBackdrop);
  const closeButtons = [...host.querySelectorAll('[data-brief-settings-close]')];
  closeButtons.forEach(button => button.addEventListener('click', close));
  return {
    modal, open, close,
    destroy() {
      modal?.removeEventListener('close', restoreFocus);
      modal?.removeEventListener('click', closeFromBackdrop);
      closeButtons.forEach(button => button.removeEventListener('click', close));
    },
  };
}
