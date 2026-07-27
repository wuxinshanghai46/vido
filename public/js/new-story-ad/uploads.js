(() => {
  async function upload({ api, file, role = 'asset' } = {}) {
    if (!file) throw new Error('请选择文件');
    if (typeof api !== 'function') throw new Error('上传接口未初始化');
    const fd = new FormData();
    fd.append('role', role);
    fd.append('file', file);
    const r = await api('/api/new-story-ad/upload', { method: 'POST', body: fd });
    const asset = r.asset || r.data || {};
    const url = asset.image_url || asset.file_url || r.image_url || r.file_url || r.url || '';
    if (!url) throw new Error('上传成功但没有返回文件地址');
    return {
      ...asset,
      url,
      image_url: asset.image_url || (asset.mimetype?.startsWith?.('audio/') ? '' : url),
      file_url: asset.file_url || url,
      name: asset.name || file.name || role,
    };
  }

  async function detectPersonGender({ api, imageUrl = '', compactUrl = value => String(value || '').trim() } = {}) {
    if (typeof api !== 'function') return '';
    const url = compactUrl(imageUrl);
    if (!url) return '';
    try {
      const r = await api('/api/dh/images/detect-gender', { method: 'POST', body: { imageUrl: url } });
      const gender = String(r?.gender || '').toLowerCase();
      return gender === 'male' || gender === 'female' ? gender : '';
    } catch {
      return '';
    }
  }

  function localImageAsset(file, fallbackName = '') {
    if (!file) return null;
    return {
      name: file.name || fallbackName || '上传素材',
      previewUrl: URL.createObjectURL(file),
      uploading: true,
    };
  }

  window.NewStoryAdUploads = {
    upload,
    detectPersonGender,
    localImageAsset,
  };
})();
