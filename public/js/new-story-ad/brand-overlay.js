(() => {
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
    const clear = within?.('#dhNsaAdBrandLogoClear');
    const brand = state.brandLogoAsset || null;
    if (host) {
      const url = previewUrl(brand);
      host.innerHTML = url
        ? `<button type="button" class="dh-luxgen-product-card ${brand.uploading ? 'uploading' : ''}" data-nsa-brand-logo-preview title="点击预览品牌 Logo">
            <img src="${escapeHtml(url)}" alt="${escapeHtml(brand.name || '品牌 Logo')}">
            <b>授权品牌 Logo</b><span>${escapeHtml(brand.uploading ? '上传中' : (brand.name || '已上传'))}</span>
          </button>`
        : '<div class="dh-luxgen-product-empty">未上传品牌 Logo</div>';
    }
    if (clear) {
      clear.hidden = !brand;
      clear.disabled = !!brand?.uploading || !!state.busy;
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

  window.NewStoryAdBrandOverlay = { payload, reset, hydrate, render, upload, handleChange, handleClick, handleFileChange };
})();
