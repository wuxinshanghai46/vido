const STRATEGIES = Object.freeze([
  'single_view',
  'image_derived',
  'atlas_2x2',
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
    atlas: 'atlas_2x2',
    grid: 'atlas_2x2',
    '2x2': 'atlas_2x2',
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
  const qualityTier = String(options.qualityTier || '').trim().toLowerCase();
  const resolution = String(options.resolution || '').trim().toLowerCase();
  const finalQuality = qualityTier === 'final' || qualityTier === 'high'
    || resolution === '4k' || resolution === '2160p';
  let selected = requested;
  let fallbackReason = '';

  if (requested === 'auto') {
    if (uploadedViewCount >= Math.max(2, requiredViews.length || 2)) selected = 'uploaded_views';
    else selected = finalQuality ? 'image_derived' : 'atlas_2x2';
  }

  if (!STRATEGIES.includes(selected)) {
    fallbackReason = 'unsupported_strategy';
    selected = 'atlas_2x2';
  }
  if (['orbit_extract', 'path_extract'].includes(selected) && !videoAcquisitionEnabled) {
    fallbackReason = 'video_acquisition_not_enabled';
    selected = 'atlas_2x2';
  }

  return {
    requested,
    selected,
    fallback_reason: fallbackReason,
    required_views: requiredViews,
    uploaded_view_count: uploadedViewCount,
    video_acquisition_enabled: videoAcquisitionEnabled,
    quality_tier: qualityTier,
    resolution,
    native_view_quality: selected === 'image_derived',
  };
}

module.exports = { STRATEGIES, normalizeStrategy, resolveSceneViewStrategy };
