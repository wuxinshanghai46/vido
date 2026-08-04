function projectSceneWorldAssets(rawWorldAssets = {}, sceneId = '', helpers = {}) {
  const { clean, list, mediaUrl } = helpers;
  const panoramas = list(rawWorldAssets.panoramas).slice(0, 12).map((panorama, panoramaIndex) => ({
    id: clean(panorama.id || `${sceneId}:panorama:${panoramaIndex + 1}`, 140),
    kind: clean(panorama.kind || 'equirectangular_panorama', 80),
    status: clean(panorama.status, 60),
    projection: clean(panorama.projection, 60),
    image_url: mediaUrl(panorama),
    width: Math.max(0, Number(panorama.width || 0) || 0),
    height: Math.max(0, Number(panorama.height || 0) || 0),
    aspect_ratio: clean(panorama.aspect_ratio, 20),
    sha256: clean(panorama.sha256, 80),
    source_fingerprint: clean(panorama.source_fingerprint, 80),
    source_scene_revision: Math.max(0, Number(panorama.source_scene_revision || 0) || 0),
    source_view_key: clean(panorama.source_view_key, 80),
    contract_version: Math.max(0, Number(panorama.contract_version || 0) || 0),
    qa: panorama.qa && typeof panorama.qa === 'object' ? {
      pass: panorama.qa.pass === true,
      source_fidelity_score: Number(panorama.qa.source_fidelity_score || 0) || 0,
      geometry_consistency_score: Number(panorama.qa.geometry_consistency_score || 0) || 0,
      wraparound_consistency_score: Number(panorama.qa.wraparound_consistency_score || 0) || 0,
      projection_consistency_score: Number(panorama.qa.projection_consistency_score || 0) || 0,
      seam_error: Number(panorama.qa.seam_error || 0) || 0,
      mismatch_reasons: list(panorama.qa.mismatch_reasons).slice(0, 12).map(value => clean(value, 220)),
    } : null,
    derived_views: list(panorama.derived_views).slice(0, 12).map((view, derivedIndex) => ({
      key: clean(view.key || `panorama_view_${derivedIndex + 1}`, 80),
      label: clean(view.label || `全景视角 ${derivedIndex + 1}`, 100),
      camera_id: clean(view.camera_id, 120),
      image_url: mediaUrl(view),
      yaw: Number(view.yaw || 0) || 0,
      pitch: Number(view.pitch || 0) || 0,
      fov: Number(view.fov || 82) || 82,
      projection: clean(view.projection, 80),
      derived_locally: view.derived_locally === true,
      parent_sha256: clean(view.parent_sha256, 80),
      sha256: clean(view.sha256, 80),
    })).filter(view => view.image_url),
  })).filter(panorama => panorama.image_url);
  return {
    schema_version: Math.max(1, Number(rawWorldAssets.schema_version || 1) || 1),
    panorama_url: clean(rawWorldAssets.panorama_url || panoramas[0]?.image_url, 1200),
    panoramas,
    authority_mode: clean(rawWorldAssets.authority_mode, 60),
    models: list(rawWorldAssets.models || rawWorldAssets.spatial_models).slice(0, 12).map(model => ({
      id: clean(model?.id, 120),
      kind: clean(model?.kind || model?.format, 80),
      url: mediaUrl(model),
      status: clean(model?.status, 60),
      source_scene_revision: Math.max(0, Number(model?.source_scene_revision || 0) || 0),
    })).filter(model => model.url),
  };
}

module.exports = { projectSceneWorldAssets };
