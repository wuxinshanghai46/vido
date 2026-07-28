(() => {
  const MAX_LOGO_BYTES = 10 * 1024 * 1024;
  const LOGO_EXTENSIONS = /\.(png|jpe?g|webp)$/i;
  const LOGO_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

  function logoActionIcon(kind = 'preview') {
    if (kind === 'delete') {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5"/></svg>';
    }
    if (kind === 'upload') {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7 9m5-5 5 5M5 15v4h14v-4"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4 4M10.5 8v5m-2.5-2.5h5"/></svg>';
  }

  function validateLogoFile(file) {
    if (!file) return { ok: false, message: '请选择 Logo 图片。' };
    const type = String(file.type || '').toLowerCase();
    const name = String(file.name || '');
    if (!LOGO_MIME_TYPES.has(type) || !LOGO_EXTENSIONS.test(name)) {
      return { ok: false, message: 'Logo 仅支持 PNG、JPG、JPEG 或 WebP 图片。' };
    }
    if (Number(file.size || 0) > MAX_LOGO_BYTES) {
      return { ok: false, message: 'Logo 图片大小不能超过 10MB。' };
    }
    return { ok: true, message: '' };
  }

  function payload(state = {}) {
    return {
      enabled: !!state.brandLogoAsset,
      authorization_confirmed: state.brandLogoAuthorized === true,
      asset: state.brandLogoAsset || null,
      position: state.brandLogoPosition || 'bottom_center',
      width_percent: Number(state.brandLogoWidth || 22),
      margin_percent: 5,
      end_duration_sec: Number(state.brandLogoDuration || 3),
    };
  }

  function reset(state, revokePreview = () => {}) {
    revokePreview(state.brandLogoAsset);
    state.brandLogoAsset = null;
    state.brandLogoAuthorized = false;
    state.brandLogoPosition = 'bottom_center';
    state.brandLogoWidth = 22;
    state.brandLogoDuration = 3;
  }

  function hydrate(state, request = {}) {
    const overlay = request.brand_overlay || request.brandOverlay || {};
    state.brandLogoAsset = overlay.asset ? {
      ...overlay.asset,
      previewUrl: overlay.asset.previewUrl || overlay.asset.image_url || overlay.asset.url || overlay.asset.file_url || '',
    } : null;
    state.brandLogoAuthorized = overlay.authorization_confirmed === true;
    state.brandLogoPosition = overlay.position || 'bottom_center';
    state.brandLogoWidth = Number(overlay.width_percent || 22) || 22;
    state.brandLogoDuration = Number(overlay.end_duration_sec || 3) || 3;
  }

  function render(state, { within, previewUrl, escapeHtml, setFieldValue } = {}) {
    const host = within?.('#dhNsaAdBrandLogoAsset');
    const brand = state.brandLogoAsset || null;
    if (host) {
      const url = previewUrl(brand);
      host.innerHTML = url
        ? `<div class="dh-nsa-brand-logo-preview ${brand.uploading ? 'uploading' : ''}">
            <button type="button" class="dh-nsa-brand-logo-image" data-nsa-brand-logo-preview aria-label="预览品牌 Logo">
              <img src="${escapeHtml(url)}" alt="${escapeHtml(brand.name || '品牌 Logo')}">
            </button>
            <div class="dh-nsa-brand-logo-actions">
              <button type="button" data-nsa-brand-logo-preview aria-label="放大预览 Logo" title="放大预览">${logoActionIcon('preview')}</button>
              <button type="button" id="dhNsaAdBrandLogoClear" aria-label="删除 Logo" title="删除 Logo" ${brand.uploading || state.busy ? 'disabled' : ''}>${logoActionIcon('delete')}</button>
            </div>
            <div class="dh-nsa-brand-logo-meta">
              <span title="${escapeHtml(brand.name || '已上传 Logo')}">${escapeHtml(brand.uploading ? 'Logo 上传中…' : (brand.name || '已上传 Logo'))}</span>
              <button type="button" id="dhNsaAdBrandLogoUpload" ${brand.uploading || state.busy ? 'disabled' : ''}>更换图片</button>
            </div>
          </div>`
        : `<button type="button" class="dh-nsa-brand-logo-upload" id="dhNsaAdBrandLogoUpload">
            <span class="dh-nsa-brand-logo-upload-icon">${logoActionIcon('upload')}</span>
            <b>点击上传 Logo 图片</b>
            <small>支持 PNG、JPG、JPEG、WebP，大小不超过 10MB</small>
          </button>`;
    }
    const authorized = within?.('#dhNsaAdBrandLogoAuthorized');
    if (authorized) authorized.checked = state.brandLogoAuthorized === true;
    setFieldValue?.('#dhNsaAdBrandLogoPosition', state.brandLogoPosition || 'bottom_center');
    setFieldValue?.('#dhNsaAdBrandLogoWidth', state.brandLogoWidth || 22);
    setFieldValue?.('#dhNsaAdBrandLogoDuration', state.brandLogoDuration || 3);
  }

  async function upload(file, deps = {}) {
    if (!file) return;
    const { state, revokePreview, markMediaDirty, renderAssets, toast, uploadAsset, scheduleAutoSave } = deps;
    const validation = validateLogoFile(file);
    if (!validation.ok) {
      toast(validation.message, 'error');
      return;
    }
    revokePreview(state.brandLogoAsset);
    state.brandLogoAsset = { name: file.name || '品牌 Logo', previewUrl: URL.createObjectURL(file), uploading: true };
    markMediaDirty('compose');
    renderAssets();
    toast('品牌 Logo 正在上传...');
    try {
      const asset = await uploadAsset(file, 'brand_logo');
      revokePreview(state.brandLogoAsset);
      state.brandLogoAsset = { ...asset, role: 'brand_logo', previewUrl: asset.image_url || asset.url, uploading: false };
      renderAssets();
      scheduleAutoSave('brand_logo_upload');
      toast('品牌 Logo 已上传；确认授权后只会在最终合成阶段叠加', 'success');
    } catch (error) {
      state.brandLogoAsset = { ...state.brandLogoAsset, uploading: false, failed: true };
      renderAssets();
      toast(error.message || '品牌 Logo 上传失败', 'error');
    }
  }

  function handleChange(target, deps = {}) {
    const { state, markMediaDirty, scheduleAutoSave } = deps;
    const fields = {
      dhNsaAdBrandLogoAuthorized: () => { state.brandLogoAuthorized = !!target.checked; },
      dhNsaAdBrandLogoPosition: () => { state.brandLogoPosition = target.value || 'bottom_center'; },
      dhNsaAdBrandLogoWidth: () => { state.brandLogoWidth = Math.max(8, Math.min(45, Number(target.value || 22) || 22)); },
      dhNsaAdBrandLogoDuration: () => { state.brandLogoDuration = Math.max(0.5, Math.min(15, Number(target.value || 3) || 3)); },
    };
    const update = fields[target?.id];
    if (!update) return false;
    update();
    state.finalVideo = null;
    markMediaDirty('compose');
    scheduleAutoSave(target.id.replace('dhNsaAdBrandLogo', 'brand_logo_').toLowerCase());
    return true;
  }

  function handleClick(target, deps = {}) {
    const { state, within, revokePreview, markMediaDirty, renderAssets, scheduleAutoSave, toast, openPreview, previewUrl } = deps;
    if (target?.closest?.('[data-nsa-brand-logo-preview]')) {
      openPreview(previewUrl(state.brandLogoAsset), state.brandLogoAsset?.name || '品牌 Logo');
      return true;
    }
    if (target?.closest?.('#dhNsaAdBrandLogoUpload')) {
      within('#dhNsaAdBrandLogoFile')?.click();
      return true;
    }
    if (target?.closest?.('#dhNsaAdBrandLogoClear')) {
      reset(state, revokePreview);
      state.finalVideo = null;
      markMediaDirty('compose');
      renderAssets();
      scheduleAutoSave('brand_logo_clear');
      toast('品牌 Logo 已删除', 'success');
      return true;
    }
    return false;
  }

  function handleFileChange(target, deps = {}) {
    if (target?.id !== 'dhNsaAdBrandLogoFile') return false;
    const file = target.files?.[0];
    target.value = '';
    upload(file, deps);
    return true;
  }

  window.NewStoryAdBrandOverlay = {
    payload,
    reset,
    hydrate,
    render,
    upload,
    handleChange,
    handleClick,
    handleFileChange,
    validateLogoFile,
    MAX_LOGO_BYTES,
  };
})();
