'use strict';

function clean(value = '', max = 240) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max); }
function list(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }

function project(contract = {}) {
  const verificationState = clean(contract.verification?.state || contract.verification?.status, 80).toLowerCase();
  return {
    full_space_lock: contract.full_space_lock === true ? true : (contract.full_space_lock === false ? false : null),
    space_lock_status: clean(contract.space_lock_status, 80),
    qa_unavailable: contract.qa_unavailable === true || verificationState === 'unavailable',
    verification_state: verificationState,
    checked_at: clean(contract.verification?.checked_at || contract.verification?.updated_at, 80),
    error_code: clean(contract.qa_error_code, 120),
    error: clean(contract.qa_error, 300),
    missing_fields: list(contract.qa_missing_fields).slice(0, 12).map(field => clean(field, 160)),
    requirement_pass: contract.requirement_qa?.pass,
    cross_view_pass: contract.cross_view_qa?.pass,
    spatial_pass: contract.spatial_coverage_qa?.pass,
    camera_pass: contract.camera_design_qa?.pass,
    realism_pass: contract.photographic_realism_qa?.pass,
    reasons: [
      ...list(contract.qa_schema_issues).map(issue => issue?.message || issue?.field),
      ...(contract.qa_error ? [contract.qa_error] : []),
      ...list(contract.verification?.reasons),
      ...list(contract.requirement_qa?.mismatch_reasons),
      ...list(contract.cross_view_qa?.mismatch_reasons),
      ...list(contract.spatial_coverage_qa?.reasons || contract.spatial_coverage_qa?.mismatch_reasons),
      ...list(contract.camera_design_qa?.reasons || contract.camera_design_qa?.mismatch_reasons),
      ...list(contract.photographic_realism_qa?.reasons || contract.photographic_realism_qa?.mismatch_reasons),
    ].slice(0, 20).map(reason => clean(reason, 220)),
  };
}

module.exports = { project };
