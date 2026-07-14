const STRATEGIES = Object.freeze([
  'single_view',
  'image_derived',
  'orbit_extract',
  'path_extract',
  'uploaded_views',
]);

function normalizeStrategy(value = 'auto') {
  const normalized = String(value || 'auto').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const aliases = {
    single: 'single_view',
    image: 'image_derived',
    derived: 'image_derived',
    orbit: 'orbit_extract',
    '360': 'orbit_extract',
    path: 'path_extract',
    upload: 'uploaded_views',
    uploaded: 'uploaded_views',
  };
  return aliases[normalized] || normalized;
}

function resolveSceneViewStrategy(options = {}) {
  const requested = normalizeStrategy(options.requested || 'auto');
  const requiredViews = Array.isArray(options.requiredViews) ? options.requiredViews.filter(Boolean) : [];
  const uploadedViewCount = Math.max(0, Number(options.uploadedViewCount) || 0);
  const videoAcquisitionEnabled = options.videoAcquisitionEnabled === true;
  let selected = requested;
  let fallbackReason = '';

  if (requested === 'auto') {
    if (uploadedViewCount >= Math.max(2, requiredViews.length || 2)) selected = 'uploaded_views';
    else if (requiredViews.length <= 1) selected = 'single_view';
    else selected = 'image_derived';
  }

  if (!STRATEGIES.includes(selected)) {
    fallbackReason = 'unsupported_strategy';
    selected = requiredViews.length <= 1 ? 'single_view' : 'image_derived';
  }
  if (['orbit_extract', 'path_extract'].includes(selected) && !videoAcquisitionEnabled) {
    fallbackReason = 'video_acquisition_not_enabled';
    selected = requiredViews.length <= 1 ? 'single_view' : 'image_derived';
  }

  return {
    requested,
    selected,
    fallback_reason: fallbackReason,
    required_views: requiredViews,
    uploaded_view_count: uploadedViewCount,
    video_acquisition_enabled: videoAcquisitionEnabled,
  };
}

module.exports = { STRATEGIES, normalizeStrategy, resolveSceneViewStrategy };
