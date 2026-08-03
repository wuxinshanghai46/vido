function restoreGeneratedDossierFields(persistedCast = [], generatedCast = []) {
  return persistedCast.map((row, index) => {
    const generated = generatedCast[index] || {};
    return {
      ...row,
      cover_image_url: generated.cover_image_url || generated.dossier_sheet?.image_url || row.image_url || '',
      dossier_sheet: generated.dossier_sheet || null,
      dossier_schema_version: generated.dossier_schema_version || 0,
      quality_status: generated.quality_status || 'legacy_view_only',
      native_masters: generated.native_masters || {},
      category_atlases: Array.isArray(generated.category_atlases) ? generated.category_atlases : [],
      atomic_assets: Array.isArray(generated.atomic_assets) ? generated.atomic_assets : [],
      body_views: Array.isArray(generated.body_views) ? generated.body_views : [],
      identity_views: Array.isArray(generated.identity_views) ? generated.identity_views : [],
      expressions: Array.isArray(generated.expressions) ? generated.expressions : [],
      base_actions: Array.isArray(generated.base_actions) ? generated.base_actions : [],
      generation_summary: generated.generation_summary || null,
      person_contract: generated.person_contract || row.person_contract || row.metadata?.person_contract || null,
      subject_profile: generated.subject_profile || row.subject_profile || row.metadata?.subject_profile || null,
      cast_member_index: index + 1,
      cast_role: generated.cast_role || row.cast_role || `角色${index + 1}`,
    };
  });
}

module.exports = { restoreGeneratedDossierFields };
