let closeActiveDialog = null;

/**
 * 打开与剧情广告主题一致的轻量对话框。
 * 返回 true、输入文本或 null，不依赖浏览器原生弹窗。
 */
function openDialog(options = {}) {
  closeActiveDialog?.(null);
  return new Promise(resolve => {
    const previousFocus = document.activeElement;
    const backdrop = document.createElement('div');
    backdrop.className = 'platform-dialog-backdrop';
    backdrop.innerHTML = `
      <section class="platform-dialog" role="dialog" aria-modal="true" aria-labelledby="platformDialogTitle">
        <header><span class="platform-dialog-mark">VIDO</span><button class="icon-btn" type="button" data-dialog-cancel aria-label="关闭">×</button></header>
        <div class="platform-dialog-content">
          <h2 id="platformDialogTitle"></h2>
          <p data-dialog-message></p>
          ${options.input ? `<label class="field"><span></span>${options.multiline ? '<textarea class="textarea" data-dialog-input></textarea>' : '<input class="input" data-dialog-input>'}</label><small class="platform-dialog-error" data-dialog-error></small>` : ''}
        </div>
        <footer>
          <button class="btn" type="button" data-dialog-cancel></button>
          <button class="btn primary ${options.danger ? 'danger' : ''}" type="button" data-dialog-confirm></button>
        </footer>
      </section>`;

    const panel = backdrop.querySelector('.platform-dialog');
    const input = backdrop.querySelector('[data-dialog-input]');
    backdrop.querySelector('#platformDialogTitle').textContent = options.title || '请确认';
    backdrop.querySelector('[data-dialog-message]').textContent = options.message || '';
    backdrop.querySelector('[data-dialog-confirm]').textContent = options.confirmText || '确认';
    backdrop.querySelectorAll('[data-dialog-cancel]').forEach((button, index) => {
      if (index) button.textContent = options.cancelText || '取消';
    });
    if (input) {
      input.value = options.value || '';
      input.placeholder = options.placeholder || '';
      if (options.maxLength) input.maxLength = Number(options.maxLength);
      if (options.multiline) input.rows = Number(options.rows || 6);
      backdrop.querySelector('.field span').textContent = options.inputLabel || '输入内容';
    }

    let finished = false;
    const finish = value => {
      if (finished) return;
      finished = true;
      document.removeEventListener('keydown', onKeydown);
      document.body.classList.remove('story-dialog-open');
      backdrop.remove();
      closeActiveDialog = null;
      previousFocus?.focus?.();
      resolve(value);
    };
    const submitDialog = () => {
      if (!input) return finish(true);
      const value = input.value.trim();
      if (options.required !== false && !value) {
        backdrop.querySelector('[data-dialog-error]').textContent = options.requiredMessage || '请先输入内容。';
        input.focus();
        return;
      }
      finish(value || null);
    };
    const onKeydown = event => {
      if (event.key === 'Escape') finish(null);
      const submitWithEnter = !options.multiline && event.key === 'Enter' && input && !event.shiftKey;
      const submitMultiline = options.multiline && event.key === 'Enter' && input && (event.ctrlKey || event.metaKey);
      if (submitWithEnter || submitMultiline) {
        event.preventDefault();
        submitDialog();
      }
      if (event.key === 'Tab') {
        const focusable = [...panel.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled])')];
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };

    backdrop.addEventListener('click', event => {
      if (event.target === backdrop || event.target.closest('[data-dialog-cancel]')) finish(null);
      if (event.target.closest('[data-dialog-confirm]')) submitDialog();
    });
    document.addEventListener('keydown', onKeydown);
    document.body.classList.add('story-dialog-open');
    document.body.appendChild(backdrop);
    closeActiveDialog = finish;
    (input || backdrop.querySelector('footer [data-dialog-cancel]')).focus();
  });
}

export function confirmDialog(message, options = {}) {
  return openDialog({ ...options, message, input: false }).then(Boolean);
}

export function promptDialog(title, options = {}) {
  return openDialog({ ...options, title, input: true });
}
